# Orca Discord Presence

A local Discord Rich Presence plugin for Orca ADE. It reads the focused Orca
workspace and observed agent status, then sends a presence to Discord Desktop
through Discord's local IPC socket. It uses no OAuth, HTTP service, or runtime
dependency.

## Install from Git

1. In Orca, open **Settings → Plugins**, enable the plugin system, and choose
   **Install plugin → Git URL**. Use
   `https://github.com/aksalatdev/orca-discord-presence.git#v0.2.0`.
   This URL becomes available when the `v0.2.0` tag is published. Review and
   grant `workspace:read` and `events:subscribe`.
2. Create your own application at the [Discord Developer Portal](https://discord.com/developers/applications)
   and copy its **Application ID**. An App Icon is optional but replaces the
   placeholder image in Discord. The Application ID is public, not a secret.
3. Create `config.json` in `.orca-discord-presence` under your user home folder:
   `%USERPROFILE%\.orca-discord-presence\config.json` on Windows, or
   `~/.orca-discord-presence/config.json` on macOS/Linux. Its contents are:

   ```json
   { "clientId": "123456789012345678" }
   ```

   Replace the example with your own 17–20 digit Application ID. This file
   lives outside Orca's versioned plugin install, so updates do not erase it.
4. Run **Start Presence** from Orca's command palette. Discord Desktop must be
   running locally. The plugin connects and reconnects automatically while the
   Orca worker is active.

No Node.js or pnpm installation is needed when installing from Git. Creating a
Discord application and the local config file is still required.

**Privacy:** After you run Start Presence, your focused workspace display name
and branch may be visible to people who can see your Discord activity. Agent
status is labelled as observed activity and is not attributed to that
workspace. Do not start the plugin if those names should stay private.

The worker activates lazily from a subscribed event or the Start Presence
command. Orca does not provide an automatic app-startup hook for this plugin.
The branch display can lag by up to 60 seconds.

## What it shows

- Orca ADE use and elapsed time since Start Presence.
- Focused workspace display name and branch, when available.
- Observed agent activity, without claiming it belongs to that workspace.

No workspace file contents, prompts, terminal text, or Discord credentials are
read or sent. The plugin reads only its local config file and the declared Orca
context/events. Presence data goes to the local Discord client, which controls
its visibility under your Discord activity settings.

## Develop from a local clone

Use Node.js 22 or newer and pnpm from the repository root. Install the locked
development dependencies, then build the bundled worker with `pnpm install`
and `pnpm build`. Add the clone through **Settings → Plugins → Development →
Add path**. A `config.json` in the clone root takes precedence over the user
home config for local development; it is git-ignored.

For a local check, run `pnpm typecheck`, `pnpm test`, `pnpm build`, then
`node scripts/smoke.mjs`. The smoke script uses a controlled Discord IPC peer;
it is not a live Discord test. The generated source map is kept locally, while
`dist/main.mjs` must be committed for Orca's Git installer, which does not build
plugins during installation.

## Verification and current limits

- TypeScript typecheck, 33 Vitest tests, bundle build, and built-artifact IPC
  smoke pass on Windows with Node 22.
- The v0.2 bundle completed a `READY` handshake with local Discord Desktop on
  Windows using the developer's existing config and then cleared its activity.
- The earlier v0.1 bundle loaded through Orca's development UI and rendered in
  real Discord on Windows. The v0.2 Git install still needs a fresh-install
  check in Orca before a public release.
- Unix socket support exists, but real Discord on macOS and Linux has not yet
  been verified. Do not claim either platform as tested until it is.
- The plugin uses only public Orca plugin API capabilities. The API remains
  experimental, so future Orca versions may need compatibility updates.

See [SPEC.md](SPEC.md) for the accepted behavior and [ROADMAP.md](ROADMAP.md)
for remaining work. This project is licensed under [MIT](LICENSE).
