import { describe, it, expect } from 'vitest'
import { buildPresence, type WorkspaceContext, type AgentStatus } from './presence'

const T0 = 1_700_000_000_000

describe('buildPresence', () => {
  it('shows display name and branch with a stable start timestamp', () => {
    const context: WorkspaceContext = { displayName: 'orca-discord-presence', branch: 'main' }
    const snapshot = buildPresence(context, null, T0)

    expect(snapshot.startedAt).toBe(T0)
    expect(snapshot.activity.details).toBe('orca-discord-presence · main')
    expect(snapshot.activity.timestamps?.start).toBe(Math.floor(T0 / 1000))
  })

  it('normalizes a full refs/heads branch ref to the branch name', () => {
    const context: WorkspaceContext = { displayName: 'repo', branch: 'refs/heads/feature/x' }
    const snapshot = buildPresence(context, null, T0)

    expect(snapshot.activity.details).toBe('repo · feature/x')
  })

  it('normalizes a remote-tracking branch ref', () => {
    const context: WorkspaceContext = { displayName: 'repo', branch: 'refs/remotes/origin/main' }
    expect(buildPresence(context, null, T0).activity.details).toBe('repo · main')
  })

  it('omits the branch when it equals the display name', () => {
    const context: WorkspaceContext = { displayName: 'main', branch: 'refs/heads/main' }
    expect(buildPresence(context, null, T0).activity.details).toBe('main')
  })

  it('omits the branch when unavailable', () => {
    expect(buildPresence({ displayName: 'Project' }, null, T0).activity.details).toBe('Project')
  })

  it('falls back when there is no workspace context', () => {
    const snapshot = buildPresence(null, null, T0)
    expect(snapshot.activity.details).toBe('Using Orca ADE')
  })

  it('labels observed agent activity without attributing a workspace', () => {
    const snapshot = buildPresence(null, { state: 'working' }, T0)
    expect(snapshot.activity.state).toBe('Agent working')
    expect(snapshot.activity.details).toBe('Using Orca ADE')
  })

  it('treats non-working agent states as plain Orca use', () => {
    expect(buildPresence({ displayName: 'P' }, { state: 'done' }, T0).activity.state).toBe(
      'In Orca ADE'
    )
  })

  it('truncates a long workspace line to the field limit', () => {
    const long = 'x'.repeat(300)
    const snapshot = buildPresence({ displayName: long, branch: 'main' }, null, T0)

    expect(snapshot.activity.details!.length).toBeLessThanOrEqual(128)
    expect(snapshot.activity.details!.endsWith('…')).toBe(true)
  })

  it('keeps a stable start timestamp across updates', () => {
    const context: WorkspaceContext = { displayName: 'A' }
    const first = buildPresence(context, null, T0)
    const second = buildPresence(context, { state: 'working' }, T0)

    expect(second.startedAt).toBe(first.startedAt)
    expect(second.activity.timestamps?.start).toBe(first.activity.timestamps?.start)
  })

  it('treats blank-string fields as unavailable', () => {
    expect(buildPresence({ displayName: '  ', branch: ' ' }, null, T0).activity.details).toBe(
      'Using Orca ADE'
    )
  })

  it('emits a non-null agent status shape from the plugin event', () => {
    const status: AgentStatus = { state: 'working' }
    const snapshot = buildPresence({ displayName: 'W', branch: 'feat' }, status, T0)
    expect(snapshot.activity.state).toBe('Agent working')
  })
})
