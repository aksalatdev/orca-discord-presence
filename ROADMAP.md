# Roadmap

The v0.2 source tree includes the built worker for Git installation, a
per-user Discord Application ID path that survives plugin updates, and MIT
licensing. The historical v0.1 dependency decisions remain in [tasks/plan.md](tasks/plan.md).

Status legend: **Release gate** must pass before broad release; **Later** is
outside the first public release; **Blocked** needs a supported host path.

## Release gates

| Item | Acceptance |
| --- | --- |
| Git installation | Publish a `v0.2.0` tag containing `dist/main.mjs`; install that tag in Orca from a fresh clone without Node or pnpm on the user's machine. |
| Windows end-to-end | Verify the tagged Git install, per-user config, Start Presence, Discord display, reconnect, and cleanup with real Orca and Discord. |
| macOS and Linux | Verify each claimed platform with real Orca and Discord; the current controlled-peer tests do not establish native desktop behavior. |
| Release hygiene | Check the final tag for accidental config, credentials, generated dependencies, and mismatched manifest/bundle versions. |

## Later

| Item | Reason |
| --- | --- |
| In-Orca ID entry | The public panel bridge cannot call `settings.set`; the first release uses a documented user config file. |
| Shared Discord Application ID | Users chose their own IDs for the first release. A shared ID needs separate Discord access and distribution validation. |
| Marketplace listing | A separate publishing and review flow, not part of the Git release. |
| Art assets and buttons | Require per-application Discord asset setup or a shared application. |
| Faster branch updates | No public focus or branch-change event is available; the current refresh interval is 60 seconds. |
| Automatic startup | Orca activates workers lazily from commands or subscribed events; no supported startup hook is available. |

The plugin continues to exclude file contents, prompts, terminal text, OAuth,
telemetry, and repository scanning.
