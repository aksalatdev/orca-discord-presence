# orca-discord-presence

A Discord Rich Presence plugin for Orca ADE. Shows what you are currently doing
in Orca as your Discord status, over local IPC (no OAuth, no HTTP, no
standalone app).

## Status

v0.1 is implemented and verified end-to-end: loaded through Orca's plugin
system (status "Running") and rendering in real Discord.

## What it shows

- using Orca ADE
- focused workspace display name and branch, when available
- observed agent activity (labelled as activity, not attributed to a workspace)
- elapsed time since presence started (stable start timestamp)

## How it works

Orca events/context → presence mapping → Discord RPC over a local named pipe
(Windows) or Unix socket (macOS/Linux). The Discord IPC client is implemented
in-repo (zero runtime dependencies) — only the HANDSHAKE/FRAME/CLOSE slice of
the [Discord RPC protocol](https://docs.discord.com/developers/topics/rpc) needed
for Rich Presence.

## Setup

1. Create a Discord application at <https://discord.com/developers/applications>
   and copy its Application ID.
2. In the same app, set **General Information → App Icon** (1024×1024). Discord
   uses the App Icon as the Rich Presence large image by default, so this is
   what replaces the placeholder icon in the "Playing" card.
3. Copy `config.json.example` to `config.json` and set `clientId` to that ID.
4. Build: `pnpm install && pnpm build` (outputs `dist/main.mjs`).
5. Load in Orca: **Settings → Plugins → Development → Add path** → this
   directory → review and grant the requested capabilities
   (`workspace:read`, `events:subscribe`).
6. Run the **Start Presence** command (Orca command palette: `Ctrl+Shift+J`).

> The worker activates lazily on a subscribed event or the command. There is no
> true automatic startup; `Start Presence` is the entry point.

## Development

```
pnpm install      # dev deps only (no runtime deps)
pnpm typecheck    # tsc --noEmit
pnpm test         # vitest run
pnpm build        # esbuild → dist/main.mjs
node scripts/smoke.mjs   # real-Node IPC smoke against the built entry
```

Structure:

- `src/discord.ts` — minimal Discord IPC client (frame codec, discovery,
  handshake, bounded backoff, dedup/coalesce, idempotent shutdown)
- `src/presence.ts` — nullable context + observed status → bounded text
- `src/main.ts` — Orca worker entry (activate/deactivate, events, command,
  60s refresh)

## Verification

- 26 unit/integration tests pass (`pnpm test`).
- `pnpm build` and `pnpm typecheck` are clean.
- `node scripts/smoke.mjs` proves a real HANDSHAKE + SET_ACTIVITY reach a
  controlled named-pipe peer through the compiled bundle.
- Real Discord: the client handshakes with the live `discord-ipc-0` pipe,
  Discord replies `READY`, and `SET_ACTIVITY` is accepted
  (`application_id: 1553769338350342204`, `name: "Orca Presence"`).
- Orca: loaded through Settings → Plugins → Development; the plugin shows
  status "Running" and its presence renders in Discord.

The only remaining manual step is uploading the Discord **App Icon** in the
Developer Portal (the code and manifest already reference the local icon).

## Config

`config.json` at the plugin root:

```json
{ "clientId": "123456789012345678" }
```

`config.json` is git-ignored. Missing or invalid `clientId` makes
`Start Presence` return an error rather than connect.
