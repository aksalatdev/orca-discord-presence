// Orca plugin worker entry (bundled to dist/main.mjs, plain Node). Default
// export receives the `orca` API; the named `deactivate` export runs on shutdown.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { DiscordPresence, type DiscordActivity } from './discord'
import { buildPresence, type WorkspaceContext, type AgentStatus } from './presence'

/** Minimal typed view of the Orca worker API we consume. */
export type Orca = {
  commands: { register(commandId: string, handler: (args?: unknown) => unknown): void }
  events: { on(event: string, handler: (payload: unknown) => void | Promise<void>): void }
  host: { call(method: string, params?: unknown): Promise<unknown> }
  log(message: string): void
}

/** Structural client contract satisfied by DiscordPresence (test seam). */
export type PresenceClient = {
  start(): void
  setActivity(activity: DiscordActivity | null): void
  destroy(): void | Promise<void>
  get isConnected(): boolean
}

export type PluginConfig = { clientId: string | null }

export type ActivateDeps = {
  /** Test seam: construct the Discord client. Defaults to DiscordPresence. */
  createClient?: (clientId: string) => PresenceClient
  /** Test seam: config source. Defaults to local then user config.json. */
  loadConfig?: () => PluginConfig
  refreshIntervalMs?: number
}

const CLIENT_ID_RE = /^\d{17,20}$/
const REFRESH_INTERVAL_MS = 60_000
const START_COMMAND_ID = 'start-presence'

let active: Runtime | null = null

export default function activate(orca: Orca, deps: ActivateDeps = {}): void {
  active = new Runtime(orca, deps)
  active.wire()
}

export async function deactivate(): Promise<void> {
  const runtime = active
  active = null
  await runtime?.dispose()
}

class Runtime {
  private readonly orca: Orca
  private readonly createClient: (clientId: string) => PresenceClient
  private readonly loadConfig: () => PluginConfig
  private readonly refreshIntervalMs: number

  private client: PresenceClient | null = null
  private refreshTimer: NodeJS.Timeout | null = null
  private refreshing = false
  private stopped = false
  private context: WorkspaceContext | null = null
  private status: AgentStatus | null = null
  private startedAt: number | null = null

  constructor(orca: Orca, deps: ActivateDeps) {
    this.orca = orca
    this.createClient = deps.createClient ?? ((clientId) => new DiscordPresence({
      clientId,
      onDiagnostic: (message) => this.log(message)
    }))
    this.loadConfig = deps.loadConfig ?? defaultLoadConfig
    this.refreshIntervalMs = deps.refreshIntervalMs ?? REFRESH_INTERVAL_MS
  }

  wire(): void {
    this.orca.commands.register(START_COMMAND_ID, () => this.start())
    this.orca.events.on('agent.status.changed', (payload) => {
      const state = (payload as { state?: unknown })?.state
      if (typeof state === 'string') this.status = { state }
      this.publish()
    })
    this.orca.events.on('worktree.created', () => void this.refresh())
    this.orca.events.on('worktree.removed', () => void this.refresh())
  }

  private log(message: string): void {
    this.orca.log(`[orca-discord-presence] ${message}`)
  }

  private async start(): Promise<{ ok: boolean; started?: boolean; error?: string }> {
    if (this.client != null) return { ok: true, started: false }
    const { clientId } = this.loadConfig()
    if (clientId == null) {
      this.log('missing clientId: set a Discord application ID in ~/.orca-discord-presence/config.json')
      return { ok: false, error: 'missing clientId' }
    }
    this.startedAt = Date.now()
    this.client = this.createClient(clientId)
    this.client.start()
    await this.refresh()
    // refresh()'s finally schedules the next tick; no timer here.
    return { ok: true, started: true }
  }

  private tick(): void {
    this.refreshTimer = null
    void this.refresh()
  }

  private async refresh(): Promise<void> {
    if (this.stopped) return
    if (this.refreshing) return
    this.refreshing = true
    try {
      try {
        this.context = await this.readContext()
      } catch {
        // A transient host failure must not reject detached event/timer work.
        // Clear the previous workspace instead of leaving stale details visible.
        this.context = null
        this.log('workspace context unavailable; showing generic presence')
      }
      this.publish()
    } finally {
      this.refreshing = false
      if (!this.stopped && this.client != null && this.refreshTimer == null) {
        this.refreshTimer = setTimeout(() => this.tick(), this.refreshIntervalMs)
      }
    }
  }

  private async readContext(): Promise<WorkspaceContext | null> {
    const raw = (await this.orca.host.call('workspace.readContext')) as
      | { displayName?: unknown; branch?: unknown }
      | null
    if (raw == null) return null
    return {
      displayName: typeof raw.displayName === 'string' ? raw.displayName : undefined,
      branch: typeof raw.branch === 'string' ? raw.branch : undefined
    }
  }

  private publish(): void {
    if (this.client == null || this.stopped || this.startedAt == null) return
    this.client.setActivity(buildPresence(this.context, this.status, this.startedAt).activity)
  }

  async dispose(): Promise<void> {
    this.stopped = true
    if (this.refreshTimer != null) {
      clearTimeout(this.refreshTimer)
      this.refreshTimer = null
    }
    const client = this.client
    this.client = null
    await client?.destroy()
  }
}

function validClientId(value: unknown): string | null {
  return typeof value === 'string' && CLIENT_ID_RE.test(value) ? value : null
}

/** The user config stays outside Orca's immutable, versioned plugin install. */
function defaultLoadConfig(): PluginConfig {
  const entryDir = dirname(fileURLToPath(import.meta.url))
  const root = join(entryDir, '..')
  return loadConfigFromPaths([
    join(root, 'config.json'),
    join(homedir(), '.orca-discord-presence', 'config.json')
  ])
}

function loadConfigFromPaths(paths: string[]): PluginConfig {
  for (const path of paths) {
    try {
      const raw: unknown = JSON.parse(readFileSync(path, 'utf8'))
      const clientId = validClientId(
        typeof raw === 'object' && raw !== null ? (raw as { clientId?: unknown }).clientId : null
      )
      if (clientId != null) return { clientId }
    } catch {
      // Missing or malformed candidate; try the next supported location.
    }
  }
  return { clientId: null }
}

export const _internal = { START_COMMAND_ID, REFRESH_INTERVAL_MS, validClientId, loadConfigFromPaths }
export { DiscordPresence } from './discord'
