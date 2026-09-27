# Roadmap

What v0.1 does today: loaded through Orca's plugin system and rendering in real
Discord (see [README](README.md)). This file tracks what is **not** done yet and
why, grounded in the Orca plugin API and Discord Rich Presence behavior.

Status legend: **Done** · **Next** (ready to build) · **Later** (needs a
decision or dependency) · **Blocked** (no supported path yet).

## Distribution

| Status | Item | Notes |
| --- | --- | --- |
| Next | Commit the built `dist/main.mjs` | Orca's installer **never runs a build** (`plugin-install.ts`: "No script execution during install, ever"), so a git install fails artifact validation while `dist/` is git-ignored. Either commit `dist/` or document local-path install as the only path. |
| Next | Document install methods per audience | Git URL install (`https://github.com/aksalatdev/orca-discord-presence.git#main` — the `#ref` is required) vs local-path (clone + `pnpm build`). |
| Later | Publish to a marketplace | Requires publishing to a marketplace source (e.g. `stablyai/orca-plugins`) and Discord app approval. Out of scope for v0.1. |

## Configuration

| Status | Item | Notes |
| --- | --- | --- |
| Next | In-Orca client ID configuration | Today the user must hand-edit `config.json`. A sandboxed panel may only call `workspace.readContext`, `terminal.sendText`, `notifications.show`, so a settings UI needs a worker roundtrip (panel → command) or a `settings:own` store. |
| Later | Ship a shared public client ID | One Discord application ID baked in (or in the manifest example) so users need no setup. Trade-off: Discord restricts unapproved applications to ~50 testers. |

## Discord presence

| Status | Item | Notes |
| --- | --- | --- |
| Next (manual) | Upload the App Icon in the Developer Portal | Discord shows the App Icon as the large image by default; while unset the "Playing" card shows a placeholder. Cannot be automated from the plugin. |
| Later | Rich Presence art assets and buttons | `assets.large_image` / `assets.small_image` / `buttons` in the `SET_ACTIVITY` payload. Requires per-app asset uploads; explicitly out of scope for v0.1. |

## Platform

| Status | Item | Notes |
| --- | --- | --- |
| Later | Verify macOS and Linux | Unix socket discovery (`$XDG_RUNTIME_DIR` / `$TMPDIR` / `$TMP` / `$TEMP` / `/tmp`) is implemented but only Windows named pipes have been exercised. |
| Later | Real-Discord integration test | The controlled-peer tests run in CI-safe isolation; a real Discord smoke needs a desktop Discord client and a live application ID, so it stays a manual check. |

## Lifecycle

| Status | Item | Notes |
| --- | --- | --- |
| Blocked | Automatic presence start | Orca activates a worker only on a registered command or a manifest-subscribed event; there is no host hook that runs at app startup. `Start Presence` remains the entry point. |
| Next | Live branch/worktree updates | The active-context check is a 60-second refresh (no focus- or branch-change event exists in the plugin API), so the display can lag up to the refresh interval. |

## Explicitly out of scope for v0.1

Automatic startup hooks, private-state inspection, repository scanning,
file/editor details, prompts or terminal content in presence, aggregate agent
dashboards, OAuth, join/spectate, telemetry, and publishing/releasing.
