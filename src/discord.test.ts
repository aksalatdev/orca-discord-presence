// Controlled-peer tests for the Discord IPC client. A local named pipe
// (`\\.\pipe\discord-ipc-test-...`) stands in for Discord: the peer completes
// the HANDSHAKE with a READY frame and acknowledges activity frames. This is a
// controlled peer, not real Discord.
//
// Why real timers: these exercise real named-pipe I/O and the client's
// reconnect backoff against the platform clock. Fake timers would freeze the
// socket connect-timeout and block the actual pipe connection. Where a delay
// is needed (dedup guard), it awaits the real signal first, then a short guard.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { createServer, Socket, type Server } from 'node:net'
import { DiscordPresence, OP, type DiscordPresenceOptions } from './discord'

type Peer = {
  server: Server
  sockets: Set<Socket>
  handshakes: Buffer[]
  activities: Buffer[]
}

let active: Peer[] = []

afterEach(() => {
  for (const peer of active.splice(0)) {
    for (const socket of peer.sockets) socket.destroy()
    peer.server.close()
  }
})

function testPipe(index: number): string {
  // Stable per test file run: the server and client must resolve the SAME
  // path, so the id is fixed rather than randomized per call.
  const id = `${process.pid}-${index}-fixed`
  return process.platform === 'win32'
    ? `\\\\?\\pipe\\discord-ipc-test-${index}-${id}`
    : `/tmp/discord-ipc-test-${index}-${id}`
}

function frame(opcode: number, json: string): Buffer {
  const payload = Buffer.from(json, 'utf8')
  const header = Buffer.alloc(8)
  header.writeUInt32LE(opcode, 0)
  header.writeUInt32LE(payload.length, 4)
  return Buffer.concat([header, payload])
}

function startPeer(index: number): Promise<Peer> {
  return new Promise((resolve) => {
    const path = testPipe(index)
    const server = createServer((socket) => {
      const peer = serverPeer
      peer.sockets.add(socket)
      socket.on('data', (data) => {
        const opcode = data.readUInt32LE(0)
        const json = data.subarray(8).toString('utf8')
        if (opcode === OP.HANDSHAKE) {
          peer.handshakes.push(data)
          socket.write(frame(OP.FRAME, JSON.stringify({ cmd: 'DISPATCH', evt: 'READY' })))
        } else if (opcode === OP.FRAME && json.includes('SET_ACTIVITY')) {
          peer.activities.push(data)
        }
      })
    })
    const serverPeer: Peer = { server, sockets: new Set(), handshakes: [], activities: [] }
    server.listen(path, () => {
      active.push(serverPeer)
      resolve(serverPeer)
    })
  })
}

function makeClient(options: Partial<DiscordPresenceOptions> = {}): DiscordPresence {
  return new DiscordPresence({
    clientId: '123456789012345678',
    connectTimeoutMs: 100,
    handshakeTimeoutMs: 1_000,
    baseBackoffMs: 200,
    maxBackoffMs: 400,
    activityFlushMs: 50,
    // Redirect discovery to the single test pipe regardless of index.
    pipePath: () => testPipe(0),
    ...options
  })
}

/** Read the SET_ACTIVITY command JSON out of a captured frame. */
function activityJson(data: Buffer): { cmd: string; args: { activity: Record<string, unknown> } } {
  return JSON.parse(data.subarray(8).toString('utf8'))
}

describe('DiscordPresence IPC client', () => {
  it('completes handshake and writes SET_ACTIVITY', async () => {
    const peer = await startPeer(0)
    const client = makeClient()
    client.start()
    client.setActivity({ details: 'Working in Orca', state: 'on project' })

    await vi.waitFor(() => expect(peer.handshakes.length).toBeGreaterThan(0))
    await vi.waitFor(() => expect(peer.activities.length).toBeGreaterThan(0))

    const payload = activityJson(peer.activities[0]!)
    expect(payload.cmd).toBe('SET_ACTIVITY')
    expect(payload.args.activity.state).toBe('on project')
    await client.destroy()
  })

  it('deduplicates equivalent activity within the coalescing window', async () => {
    const peer = await startPeer(0)
    const client = makeClient()
    client.start()
    await vi.waitFor(() => expect(peer.handshakes.length).toBeGreaterThan(0))

    client.setActivity({ details: 'A' })
    client.setActivity({ details: 'A' })
    await vi.waitFor(() => expect(peer.activities.length).toBe(1))

    // Guard: let the flush window elapse and confirm no duplicate was sent.
    await new Promise((r) => setTimeout(r, 120))
    expect(peer.activities.length).toBe(1)
    await client.destroy()
  })

  it('coalesces a burst into a single send', async () => {
    const peer = await startPeer(0)
    const client = makeClient()
    client.start()
    await vi.waitFor(() => expect(peer.handshakes.length).toBeGreaterThan(0))

    client.setActivity({ details: 'A' })
    client.setActivity({ details: 'B' })
    client.setActivity({ details: 'C' })
    await vi.waitFor(() => expect(peer.activities.length).toBe(1))

    await new Promise((r) => setTimeout(r, 120))
    expect(peer.activities.length).toBe(1)
    expect(activityJson(peer.activities[0]!).args.activity.details).toBe('C')
    await client.destroy()
  })

  it('cleans up timers and socket on destroy', async () => {
    const peer = await startPeer(0)
    const client = makeClient()
    client.start()
    await vi.waitFor(() => expect(peer.handshakes.length).toBeGreaterThan(0))

    await client.destroy()
    expect(client.isConnected).toBe(false)
    await vi.waitFor(() => expect(peer.activities.length).toBeGreaterThan(0))
    expect(activityJson(peer.activities.at(-1)!).args.activity).toEqual({})
  })

  it('survives an absent peer without throwing', async () => {
    // No peer listening at the test pipe; discovery exhausts the pipe range
    // and schedules a bounded reconnect. Must not throw.
    const client = makeClient()
    client.start()
    await new Promise((r) => setTimeout(r, 150))
    expect(client.isConnected).toBe(false)
    await client.destroy()
  })

  it('destroys sockets that never connect before trying another pipe', async () => {
    const sockets: Socket[] = []
    const client = makeClient({
      connectTimeoutMs: 10,
      baseBackoffMs: 1_000,
      connectSocket: () => {
        const socket = new Socket()
        sockets.push(socket)
        return socket
      }
    })
    client.start()

    await vi.waitFor(() => expect(sockets.length).toBe(10))
    expect(sockets.every((socket) => socket.destroyed)).toBe(true)
    await client.destroy()
  })

  it('reconnects after peer drop and republishes current activity', async () => {
    const peer = await startPeer(0)
    const client = makeClient()
    client.start()
    await vi.waitFor(() => expect(peer.handshakes.length).toBeGreaterThan(0))

    client.setActivity({ details: 'first' })
    await vi.waitFor(() => expect(peer.activities.length).toBe(1))

    // Simulate Discord going away: drop the peer's sockets.
    for (const socket of peer.sockets) socket.destroy()
    await vi.waitFor(() => expect(client.isConnected).toBe(false))

    // The server still accepts new connections, so the client reconnects on
    // the next backoff tick and republishes.
    client.setActivity({ details: 'second' })
    await vi.waitFor(() => expect(peer.activities.length).toBeGreaterThanOrEqual(2))

    await client.destroy()
  })

  it('discards an incomplete frame when reconnecting to a fresh socket', async () => {
    const peer = await startPeer(0)
    const client = makeClient()
    client.start()
    await vi.waitFor(() => expect(peer.handshakes.length).toBe(1))

    const firstSocket = [...peer.sockets][0]!
    await new Promise<void>((resolve) => firstSocket.write(Buffer.from([1, 0, 0, 0]), () => resolve()))
    firstSocket.destroy()
    await vi.waitFor(() => expect(peer.handshakes.length).toBeGreaterThanOrEqual(2))

    client.setActivity({ details: 'after reconnect' })
    await vi.waitFor(() => expect(peer.activities.length).toBe(1))
    expect(activityJson(peer.activities[0]!).args.activity.details).toBe('after reconnect')
    await client.destroy()
  })

  it('rejects an oversized peer frame and reports a safe diagnostic', async () => {
    const peer = await startPeer(0)
    const onDiagnostic = vi.fn()
    const client = makeClient({ onDiagnostic })
    client.start()
    await vi.waitFor(() => expect(peer.handshakes.length).toBe(1))

    const header = Buffer.alloc(8)
    header.writeUInt32LE(OP.FRAME, 0)
    header.writeUInt32LE(1_048_577, 4)
    const socket = [...peer.sockets][0]!
    socket.write(header)

    await vi.waitFor(() => expect(onDiagnostic).toHaveBeenCalledWith(
      'Discord RPC frame exceeded the size limit; reconnecting'
    ))
    await vi.waitFor(() => expect(peer.handshakes.length).toBeGreaterThanOrEqual(2))
    await client.destroy()
  })

  it('reports a Discord ERROR code without logging peer-supplied text', async () => {
    const peer = await startPeer(0)
    const onDiagnostic = vi.fn()
    const client = makeClient({ onDiagnostic })
    client.start()
    await vi.waitFor(() => expect(peer.handshakes.length).toBe(1))

    const socket = [...peer.sockets][0]!
    socket.write(frame(OP.FRAME, JSON.stringify({
      evt: 'ERROR',
      data: { code: 4000, message: 'private peer text' }
    })))

    await vi.waitFor(() => expect(onDiagnostic).toHaveBeenCalledWith(
      'Discord RPC rejected a request (code 4000)'
    ))
    await client.destroy()
  })
})
