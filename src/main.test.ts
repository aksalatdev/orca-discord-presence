// Integration tests for the Orca plugin entry: activation wires commands and
// events; Start Presence reads config, starts the client, and schedules exactly
// one non-overlapping refresh; deactivate cancels timers and destroys the
// client. Uses fakes for the host boundary (commands/events/host) and the
// presence client (test seam).
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest'
import type { Orca, PresenceClient, PluginConfig } from './main'
import type { WorkspaceContext } from './presence'
import activate, { deactivate, _internal } from './main'

type Handler = (args?: unknown) => unknown
type EventHandler = (payload: unknown) => void | Promise<void>

function makeFakeClient(): PresenceClient & { start: Mock; setActivity: Mock; destroy: Mock } {
  return {
    start: vi.fn(),
    setActivity: vi.fn(),
    destroy: vi.fn(),
    isConnected: false
  }
}

function makeFakeOrca(): {
  orca: Orca
  commands: Map<string, Handler>
  events: Map<string, EventHandler[]>
  hostCalls: { method: string; params?: unknown }[]
} {
  const commands = new Map<string, Handler>()
  const events = new Map<string, EventHandler[]>()
  const hostCalls: { method: string; params?: unknown }[] = []
  const orca: Orca = {
    commands: {
      register(commandId, handler) {
        commands.set(commandId, handler)
      }
    },
    events: {
      on(event, handler) {
        const list = events.get(event) ?? []
        list.push(handler)
        events.set(event, list)
      }
    },
    host: {
      async call(method, params) {
        hostCalls.push({ method, params })
        if (method === 'workspace.readContext') {
          return { displayName: 'repo', branch: 'main' } as WorkspaceContext
        }
        return undefined
      }
    },
    log: vi.fn()
  }
  return { orca, commands, events, hostCalls }
}

let createClient: Mock
let loadConfig: Mock
let refreshIntervalMs: number

beforeEach(() => {
  createClient = vi.fn()
  loadConfig = vi.fn(() => ({ clientId: '123456789012345678' }) as PluginConfig)
  refreshIntervalMs = _internal.REFRESH_INTERVAL_MS
})

afterEach(async () => {
  await deactivate()
  vi.useRealTimers()
})

function wire() {
  const { orca, commands, events, hostCalls } = makeFakeOrca()
  activate(orca, { createClient, loadConfig, refreshIntervalMs })
  return { orca, commands, events, hostCalls }
}

describe('Orca plugin entry', () => {
  it('registers the Start Presence command and event handlers', () => {
    const { commands, events } = wire()
    expect(commands.has(_internal.START_COMMAND_ID)).toBe(true)
    expect(events.has('agent.status.changed')).toBe(true)
    expect(events.has('worktree.created')).toBe(true)
    expect(events.has('worktree.removed')).toBe(true)
  })

  it('rejects Start Presence when clientId is missing', async () => {
    loadConfig = vi.fn(() => ({ clientId: null }) as PluginConfig)
    const { commands } = wire()
    const result = await commands.get(_internal.START_COMMAND_ID)!()
    expect(result).toEqual({ ok: false, error: 'missing clientId' })
    expect(createClient).not.toHaveBeenCalled()
  })

  it('starts the client and publishes context on Start Presence', async () => {
    const client = makeFakeClient()
    createClient.mockReturnValue(client)
    const { commands, hostCalls } = wire()

    const result = await commands.get(_internal.START_COMMAND_ID)!()

    expect(result).toEqual({ ok: true, started: true })
    expect(createClient).toHaveBeenCalledWith('123456789012345678')
    expect(client.start).toHaveBeenCalledTimes(1)
    expect(hostCalls.some((c) => c.method === 'workspace.readContext')).toBe(true)
    expect(client.setActivity).toHaveBeenCalledTimes(1)
  })

  it('is idempotent on repeated Start Presence', async () => {
    const client = makeFakeClient()
    createClient.mockReturnValue(client)
    const { commands } = wire()

    await commands.get(_internal.START_COMMAND_ID)!()
    const second = await commands.get(_internal.START_COMMAND_ID)!()

    expect(second).toEqual({ ok: true, started: false })
    expect(createClient).toHaveBeenCalledTimes(1)
    expect(client.start).toHaveBeenCalledTimes(1)
  })

  it('schedules exactly one non-overlapping refresh cycle', async () => {
    vi.useFakeTimers()
    const client = makeFakeClient()
    createClient.mockReturnValue(client)
    const { commands, hostCalls } = wire()

    await commands.get(_internal.START_COMMAND_ID)!()
    const readsAfterStart = hostCalls.filter((c) => c.method === 'workspace.readContext').length

    await vi.advanceTimersByTimeAsync(_internal.REFRESH_INTERVAL_MS + 1)
    const readsAfterTick = hostCalls.filter((c) => c.method === 'workspace.readContext').length
    expect(readsAfterTick).toBe(readsAfterStart + 1)

    // A second tick fires one more; the prior tick's timer was cleared first.
    await vi.advanceTimersByTimeAsync(_internal.REFRESH_INTERVAL_MS + 1)
    const readsAfterTwo = hostCalls.filter((c) => c.method === 'workspace.readContext').length
    expect(readsAfterTwo).toBe(readsAfterStart + 2)
  })

  it('updates presence on agent.status.changed', async () => {
    const client = makeFakeClient()
    createClient.mockReturnValue(client)
    const { events, commands } = wire()
    await commands.get(_internal.START_COMMAND_ID)!()
    const before = client.setActivity.mock.calls.length

    await events.get('agent.status.changed')![0]!({ state: 'working' })

    expect(client.setActivity.mock.calls.length).toBe(before + 1)
  })

  it('cancels timers and destroys the client on deactivate', async () => {
    vi.useFakeTimers()
    const client = makeFakeClient()
    createClient.mockReturnValue(client)
    const { commands } = wire()
    await commands.get(_internal.START_COMMAND_ID)!()

    await deactivate()

    expect(client.destroy).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('accepts only a plausible Discord application ID', () => {
    expect(_internal.validClientId('1553769338350342204')).toBe('1553769338350342204')
    expect(_internal.validClientId('  123  ')).toBeNull()
    expect(_internal.validClientId('not-a-snowflake')).toBeNull()
    expect(_internal.validClientId('123')).toBeNull()
    expect(_internal.validClientId(undefined)).toBeNull()
  })
})
