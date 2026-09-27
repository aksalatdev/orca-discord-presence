// Presence mapping: nullable Orca context + observed agent status → bounded
// Discord Rich Presence text with a stable start timestamp.
import type { DiscordActivity } from './discord'

/** Nullable projection of `workspace.readContext` (SPEC/SDK). */
export type WorkspaceContext = {
  displayName?: string
  branch?: string
}

/** Observed agent status payload from `agent.status.changed`. */
export type AgentStatus = {
  state: string
}

export type PresenceSnapshot = {
  activity: DiscordActivity
  /** Stable epoch-milliseconds marker for a presence session. */
  startedAt: number
}

/** Hard cap Discord enforces on `details` (128) and `state` (128). */
const FIELD_LIMIT = 128

const WORKSPACE_FALLBACK = 'Using Orca ADE'
const ACTIVITY_FALLBACK = 'In Orca ADE'

function truncate(value: string, limit = FIELD_LIMIT): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`
}

function hasText(value: string | undefined): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

/**
 * Orca's `workspace.readContext` can report a branch as a full Git ref
 * (`refs/heads/foo`) or a remote-tracking ref (`refs/remotes/origin/foo`)
 * depending on the plumbing path. Show the human branch name.
 */
function normalizeBranch(branch: string): string {
  return branch
    .trim()
    .replace(/^refs\/heads\//, '')
    .replace(/^refs\/remotes\/[^/]+\//, '')
}

/**
 * Build a presence snapshot from the current workspace context and last
 * observed agent state. `startedAt` is supplied by the caller so it stays
 * stable across updates within one presence session.
 *
 * Discord renders `details` as the first line (under the app name) and `state`
 * as the second line, so the workspace goes in `details`.
 */
export function buildPresence(
  context: WorkspaceContext | null,
  status: AgentStatus | null,
  startedAt: number
): PresenceSnapshot {
  const displayName = hasText(context?.displayName) ? context.displayName.trim() : undefined
  const branch = hasText(context?.branch) ? normalizeBranch(context.branch) : undefined

  return {
    activity: {
      details: truncate(workspaceLine(displayName, branch)),
      state: truncate(activityLine(status)),
      timestamps: { start: Math.floor(startedAt / 1000) }
    },
    startedAt
  }
}

/** Workspace line: display name, plus branch when it adds information. */
function workspaceLine(displayName: string | undefined, branch: string | undefined): string {
  if (displayName && branch && branch.toLowerCase() !== displayName.toLowerCase()) {
    return `${displayName} · ${branch}`
  }
  return displayName ?? branch ?? WORKSPACE_FALLBACK
}

/** Activity line: observed agent activity, never tied to the workspace. */
function activityLine(status: AgentStatus | null): string {
  if (status?.state === 'working') return 'Agent working'
  return ACTIVITY_FALLBACK
}
