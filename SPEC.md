# orca-discord-presence v0.1

## v0.2 public distribution extension

The v0.1 runtime contract and dependency rationale below remain in force. v0.2
adds a Git-installable release without a shared Discord application ID:

- Ship the self-contained `dist/main.mjs` in Git because Orca's installer never
  runs a build. Use the immutable `v0.2.0` Git tag for the first public install.
- Each user supplies their own Discord Application ID in
  `~/.orca-discord-presence/config.json`. Keep the root `config.json` as a local
  development override. Both files use the same validated `{ "clientId": "..." }`
  shape; neither is committed with a real ID.
- Keep explicit Start Presence consent. The setup guide must explain that
  workspace display name and branch can appear in Discord activity.
- Preserve the existing two Orca capabilities and zero runtime dependencies.
  Bound IPC frame memory, clean up timed-out connection attempts, surface safe
  Discord error diagnostics, and keep failed context refreshes nonfatal.
- A release claim for a platform requires a native Orca-to-Discord check on
  that platform. The v0.2 implementation does not by itself establish macOS or
  Linux compatibility.

## Objective and approved scope

An Orca ADE plugin providing Discord Desktop Rich Presence through local IPC. It is not an OMP plugin or a standalone Discord application.

Architecture: Orca events/context → presence mapping → Discord RPC. TypeScript compiled to Node-compatible JavaScript; pnpm, esbuild, Vitest. No UI framework, backend, server, database, private Orca APIs, or custom IPC protocol without discussion.

## Confirmed Orca capabilities

Source baseline: [Orca 27b823f934f7](https://github.com/stablyai/orca/tree/27b823f934f739bc85914dd717b776835f60bcf7), package version 1.4.214. Local CLI reports running Orca 1.4.215; actual plugin loading still requires verification.

- Root `orca-plugin.json`, manifest version 1 and plugin API 1; Node worker entry with default `activate(orca)` and named `deactivate()`.
- `workspace.readContext` returns nullable display name, branch, and terminal IDs. Requires `workspace:read`.
- Public events: `worktree.created`, `worktree.removed`, `agent.status.changed`; subscribe with `events:subscribe` and manifest contributions.
- Workers activate lazily on a command or manifest-subscribed event, not automatically at app startup.
- Five-minute host-observed idle timeout. Host API calls count as activity; Discord sockets do not. Orderly shutdown has a two-second grace period.
- Workers run locally with Node builtins, permitting Discord named pipes/Unix sockets.
- Development: Settings → Plugins → Development → enter this directory → Add path; enable plugin system and review permissions.

## Requirements and acceptance

- Show Orca ADE use, workspace display name and branch when available; omit unavailable information.
- Agent status must be labelled as observed activity, not attributed to the active workspace without evidence. No initial agent-state snapshot is available.
- Subscribe to public events for lazy activation. Provide Start Presence as fallback. Do not advertise true automatic startup.
- One non-overlapping 60-second context refresh; event-triggered work coalesced. This approved refresh also prevents host idle disposal under the current implementation.
- Stable Discord activity start timestamp, not periodic elapsed-time updates.
- Deduplicate equivalent presence and coalesce bursts. Republish current state after reconnection.
- Missing Discord is nonfatal. Use bounded backoff with one pending reconnect timer; no overlapping connects.
- On deactivation, cancel timers, suppress late asynchronous work, clear presence where possible, and close IPC within the host shutdown grace.
- Minimal runtime dependencies. Evaluate the existing `@xhayper/discord-rpc` IPC client before adopting it; reliability takes priority over size. No OAuth or external HTTP communication.

## Assumptions and known limitations

- A valid Discord application/client ID must be configured before a real Discord connection can be verified; none has been provided. No secrets or tokens are needed for ordinary local Rich Presence.
- Workspace display name is not necessarily a repository/project name. No focus-change or branch-change event exists; display can lag by up to the refresh interval.
- Active context omits worktree ID, preventing reliable joins to agent event worktree IDs. Events describe observations, not a complete fleet snapshot.
- An open worker means the plugin is running, not that Orca has OS foreground focus.
- Worker API is experimental. Native platform IPC discovery and disposal require runtime checks; package metadata alone does not establish reliability.
- Real Orca loading and real Discord display are distinct from unit tests or a controlled local IPC peer.

## Out of scope

Automatic startup hooks, private-state inspection, repository scanning, file/editor details, prompts or terminal content in presence, aggregate agent dashboards, OAuth, join/spectate, images requiring new assets, telemetry, and publishing/releasing this project.

## Structure and commands

Planned source files: `src/presence.ts`, `src/discord.ts`, `src/main.ts`; adjacent `*.test.ts` files. Root manifest and build configuration; concise user README. Generated `dist/` and local configuration ignored.

Planned checks: `pnpm build`, `pnpm typecheck`, `pnpm test`. Focused checks: `pnpm test -- src/presence.test.ts` (and corresponding lifecycle test files). No lint framework is required for this small project.

Style: small functions with explicit state, no generic event bus or dependency injection framework. Example: `const startedAt = Date.now();` is recorded once per presence session, not on every update.

## Verification and boundaries

Use Vitest for mapping boundaries, deduplication, reconnect races, and shutdown. Smoke the built entry, then load through Orca's development UI and exercise Discord if prerequisites are present. Always distinguish controlled-peer proof from actual Discord proof.

Always build and test each meaningful increment. Ask before changing transport, dependencies beyond the approved candidate/toolchain, or lifecycle workarounds. Never commit secrets, generated dependencies/build output, or bypass the public Orca plugin API. If observed Orca or Discord behavior contradicts the approved assumptions, stop and report it rather than patching around it.
