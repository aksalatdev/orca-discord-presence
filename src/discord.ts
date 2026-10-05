// Minimal Discord Rich Presence IPC client — only the HANDSHAKE/FRAME/CLOSE
// slice of the Discord RPC protocol needed for local Rich Presence.
//
// Frame: 4-byte little-endian opcode + 4-byte little-endian length + JSON body.
// Handshake sends {"v":1,"client_id"}; Discord replies with a FRAME carrying
// evt === "READY". SET_ACTIVITY's activity.timestamps.start is Unix SECONDS.
// Protocol: https://docs.discord.com/developers/topics/rpc
import { createConnection, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const OP = {
  HANDSHAKE: 0,
  FRAME: 1,
  CLOSE: 2
} as const

export type DiscordActivity = {
  /** First line of the presence, rendered under the app name. */
  details?: string
  /** Second line of the presence. */
  state?: string
  /** Elapsed-time display; start is a Unix timestamp in SECONDS. */
  timestamps?: { start?: number; end?: number }
}

export type DiscordPresenceOptions = {
  clientId: string
  /** Report transport/protocol failures without exposing activity text. */
  onDiagnostic?: (message: string) => void
  /** Per-pipe connection deadline. */
  connectTimeoutMs?: number
  /** Deadline for the READY reply after HANDSHAKE. */
  handshakeTimeoutMs?: number
  /** Backoff between reconnect attempts (doubles up to maxBackoffMs). */
  baseBackoffMs?: number
  maxBackoffMs?: number
  /** Debounce window that coalesces rapid setActivity bursts. */
  activityFlushMs?: number
  /** Test seam: resolve a pipe index to a filesystem path. */
  pipePath?: (index: number) => string
  /** Test seam: create a socket for one candidate path. */
  connectSocket?: (path: string) => Socket
}

const PIPE_COUNT = 10
const MAX_FRAME_BYTES = 1_048_576
const SHUTDOWN_TIMEOUT_MS = 250

/** Resolve a pipe index to the platform-specific Discord IPC path. */
function defaultPipePath(index: number): string {
  if (process.platform === 'win32') {
    return `\\\\?\\pipe\\discord-ipc-${index}`
  }
  const prefix =
    process.env.XDG_RUNTIME_DIR ||
    process.env.TMPDIR ||
    process.env.TMP ||
    process.env.TEMP ||
    tmpdir()
  return join(prefix, `discord-ipc-${index}`)
}

export class DiscordPresence {
  private readonly clientId: string
  private readonly onDiagnostic?: (message: string) => void
  private readonly connectTimeoutMs: number
  private readonly handshakeTimeoutMs: number
  private readonly baseBackoffMs: number
  private readonly maxBackoffMs: number
  private readonly activityFlushMs: number
  private readonly pipePath: (index: number) => string
  private readonly connectSocket: (path: string) => Socket

  private socket: Socket | null = null
  private connectingSocket: Socket | null = null
  private readBuffer = Buffer.alloc(0)
  private connected = false
  private connecting = false
  private destroyed = false
  private backoffMs: number

  private reconnectTimer: NodeJS.Timeout | null = null
  private flushTimer: NodeJS.Timeout | null = null
  private handshakeTimer: NodeJS.Timeout | null = null
  private handshakeResolve: ((ready: boolean) => void) | null = null

  private pendingActivity: DiscordActivity | null = null
  private lastSent: DiscordActivity | null = null
  private nonce = 0
  private shutdownPromise: Promise<void> | null = null

  constructor(options: DiscordPresenceOptions) {
    this.clientId = options.clientId
    this.onDiagnostic = options.onDiagnostic
    this.connectTimeoutMs = options.connectTimeoutMs ?? 2_000
    this.handshakeTimeoutMs = options.handshakeTimeoutMs ?? 5_000
    this.baseBackoffMs = options.baseBackoffMs ?? 1_000
    this.maxBackoffMs = options.maxBackoffMs ?? 30_000
    this.activityFlushMs = options.activityFlushMs ?? 50
    this.pipePath = options.pipePath ?? defaultPipePath
    this.connectSocket = options.connectSocket ?? ((path) => createConnection({ path }))
    this.backoffMs = this.baseBackoffMs
  }

  get isConnected(): boolean {
    return this.connected
  }

  /** Begin connecting. Idempotent; safe to call repeatedly. */
  start(): void {
    this.connect()
  }

  /** Queue a presence update; coalesced and deduplicated before send. */
  setActivity(activity: DiscordActivity | null): void {
    if (this.destroyed) return
    this.pendingActivity = activity
    if (this.flushTimer == null) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null
        this.flush()
      }, this.activityFlushMs)
    }
  }

  /**
   * Cancel all timers, best-effort clear presence, and close the socket.
   * Idempotent.
   */
  destroy(): Promise<void> {
    if (this.shutdownPromise != null) return this.shutdownPromise
    if (this.destroyed) return Promise.resolve()
    this.destroyed = true
    this.clearTimers()
    this.connectingSocket?.destroy()
    this.connectingSocket = null
    const socket = this.socket
    this.socket = null
    this.readBuffer = Buffer.alloc(0)
    this.connected = false
    this.resolveHandshake(false)
    if (socket == null || socket.destroyed) return Promise.resolve()

    // Flush a clear activity and CLOSE before ending the pipe. A dead peer
    // cannot hold Orca's two-second shutdown grace indefinitely.
    this.shutdownPromise = new Promise<void>((resolve) => {
      const timer = setTimeout(() => socket.destroy(), SHUTDOWN_TIMEOUT_MS)
      socket.once('close', () => {
        clearTimeout(timer)
        resolve()
      })
      try {
        socket.write(this.frame(OP.FRAME, this.activityPayload({})))
        socket.end(this.frame(OP.CLOSE, '{}'))
      } catch {
        socket.destroy()
      }
    })
    return this.shutdownPromise
  }

  // ── connection ──────────────────────────────────────────────────────────

  private connect(): void {
    if (this.connecting || this.connected || this.destroyed) return
    this.connecting = true
    void this.discoverAndHandshake()
      .then((socket) => {
        this.connecting = false
        if (socket == null) this.scheduleReconnect()
      })
      .catch(() => {
        this.connecting = false
        if (!this.connected && !this.destroyed) this.scheduleReconnect()
      })
  }

  private async discoverAndHandshake(): Promise<Socket | null> {
    for (let i = 0; i < PIPE_COUNT; i++) {
      if (this.destroyed) return null
      const socket = await this.connectPipe(i)
      if (socket == null) continue
      if (this.destroyed) {
        socket.destroy()
        return null
      }
      this.socket = socket
      this.readBuffer = Buffer.alloc(0)
      this.attach(socket)
      try {
        socket.write(this.frame(OP.HANDSHAKE, JSON.stringify({ v: 1, client_id: this.clientId })))
      } catch {
        this.socket = null
        socket.destroy()
        continue
      }
      if (await this.waitReady()) {
        return socket
      }
      this.socket = null
      socket.destroy()
    }
    return null
  }

  private connectPipe(index: number): Promise<Socket | null> {
    const { promise, resolve } = Promise.withResolvers<Socket | null>()
    const socket = this.connectSocket(this.pipePath(index))
    this.connectingSocket = socket
    let settled = false
    const settle = (result: Socket | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (this.connectingSocket === socket) this.connectingSocket = null
      resolve(result)
    }
    const timer = setTimeout(() => {
      settle(null)
      socket.destroy()
    }, this.connectTimeoutMs)
    socket.on('error', () => {
      settle(null)
      socket.destroy()
    })
    socket.once('close', () => settle(null))
    socket.once('connect', () => {
      if (this.destroyed || settled) {
        settle(null)
        socket.destroy()
      } else {
        settle(socket)
      }
    })
    return promise
  }

  // ── socket wiring ───────────────────────────────────────────────────────

  private attach(socket: Socket): void {
    socket.on('data', (chunk) => this.onData(socket, chunk))
    // Swallow errors: a lost peer surfaces as 'close', never as an uncaught throw.
    socket.on('error', () => {})
    socket.once('close', () => this.onClose(socket))
  }

  private onClose(socket: Socket): void {
    if (this.socket !== socket) return
    this.socket = null
    this.readBuffer = Buffer.alloc(0)
    this.connected = false
    // A reconnect must republish: drop the "already sent" marker.
    this.lastSent = null
    this.resolveHandshake(false)
    if (!this.destroyed) this.scheduleReconnect()
  }

  private onData(socket: Socket, chunk: Buffer): void {
    if (this.socket !== socket || this.destroyed) return
    if (this.readBuffer.length + chunk.length > MAX_FRAME_BYTES + 8) {
      this.onDiagnostic?.('Discord RPC frame exceeded the size limit; reconnecting')
      socket.destroy()
      return
    }
    this.readBuffer = Buffer.concat([this.readBuffer, chunk])
    while (this.readBuffer.length >= 8) {
      const opcode = this.readBuffer.readUInt32LE(0)
      const length = this.readBuffer.readUInt32LE(4)
      if (length > MAX_FRAME_BYTES) {
        this.onDiagnostic?.('Discord RPC frame exceeded the size limit; reconnecting')
        socket.destroy()
        return
      }
      if (this.readBuffer.length < 8 + length) return
      const payload = this.readBuffer.subarray(8, 8 + length).toString('utf8')
      this.readBuffer = this.readBuffer.subarray(8 + length)
      this.onFrame(opcode, payload)
    }
  }

  private onFrame(opcode: number, json: string): void {
    if (opcode !== OP.FRAME) return
    let parsed: unknown
    try {
      parsed = JSON.parse(json)
    } catch {
      return
    }
    if (typeof parsed !== 'object' || parsed === null) return
    const message = parsed as { evt?: unknown; data?: unknown }
    if (message.evt === 'READY' && this.handshakeResolve != null) {
      this.connected = true
      this.backoffMs = this.baseBackoffMs
      this.resolveHandshake(true)
      this.flush()
    } else if (message.evt === 'ERROR') {
      const data = message.data
      const code = typeof data === 'object' && data !== null
        ? (data as { code?: unknown }).code
        : undefined
      const suffix = typeof code === 'number' && Number.isSafeInteger(code) ? ` (code ${code})` : ''
      this.onDiagnostic?.(`Discord RPC rejected a request${suffix}`)
    }
  }

  private waitReady(): Promise<boolean> {
    const { promise, resolve } = Promise.withResolvers<boolean>()
    this.handshakeResolve = resolve
    this.handshakeTimer = setTimeout(() => this.resolveHandshake(false), this.handshakeTimeoutMs)
    return promise
  }

  private resolveHandshake(ready: boolean): void {
    const resolve = this.handshakeResolve
    this.handshakeResolve = null
    if (this.handshakeTimer) {
      clearTimeout(this.handshakeTimer)
      this.handshakeTimer = null
    }
    resolve?.(ready)
  }

  // ── reconnect ───────────────────────────────────────────────────────────

  private scheduleReconnect(): void {
    if (this.destroyed || this.reconnectTimer != null) return
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect()
    }, this.backoffMs)
    this.backoffMs = Math.min(this.backoffMs * 2, this.maxBackoffMs)
  }

  // ── activity send ───────────────────────────────────────────────────────

  private flush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    if (!this.connected || this.socket == null) return
    const activity = this.pendingActivity
    if (activity == null) return
    if (this.lastSent != null && JSON.stringify(activity) === JSON.stringify(this.lastSent)) {
      return
    }
    this.socket.write(this.frame(OP.FRAME, this.activityPayload(activity)))
    this.lastSent = activity
  }

  private activityPayload(activity: DiscordActivity): string {
    return JSON.stringify({
      cmd: 'SET_ACTIVITY',
      args: { pid: process.pid, activity },
      nonce: this.nextNonce()
    })
  }

  private nextNonce(): string {
    this.nonce += 1
    return `odp-${this.nonce}`
  }

  private frame(opcode: number, json: string): Buffer {
    const payload = Buffer.from(json, 'utf8')
    const header = Buffer.alloc(8)
    header.writeUInt32LE(opcode, 0)
    header.writeUInt32LE(payload.length, 4)
    return Buffer.concat([header, payload])
  }

  private clearTimers(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.flushTimer) {
      clearTimeout(this.flushTimer)
      this.flushTimer = null
    }
    if (this.handshakeTimer) {
      clearTimeout(this.handshakeTimer)
      this.handshakeTimer = null
    }
  }
}
