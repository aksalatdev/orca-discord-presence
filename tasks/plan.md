# v0.1 implementation plan

The user approved the Phase 1 architecture and requested implementation. Requirements are in `SPEC.md`; tasks are tracked in `tasks/todo.md` and the session checklist.

## Order and acceptance

1. **Compatibility gate** — inspect and smoke the published Discord IPC candidate before adopting it. Prove absent-client failure, peer disconnect notification, and disposal without leaked timers. Use only a temporary local IPC peer, outside the repository. If the candidate contradicts lifecycle requirements, stop and report; do not patch dependency internals or switch transport silently.
2. **Presence mapping** — create TypeScript/pnpm/esbuild/Vitest configuration and `src/presence.ts` with adjacent boundary tests. Map nullable context and observed status to bounded Discord text with a stable timestamp. Verify with `pnpm build`, `pnpm typecheck`, and focused tests.
3. **Discord lifecycle** — add `src/discord.ts` and lifecycle tests. One connection attempt, bounded retry, deduplicated/coalesced sends, resend after reconnect, and bounded idempotent shutdown. Verify build, types, tests, and a real Node IPC smoke.
4. **Orca integration** — add root manifest, `src/main.ts`, and integration tests. Default activation, named deactivation, manifest events, Start Presence command, and exactly one non-overlapping 60-second refresh. Configuration must accept a real public Discord application ID without a hardcoded fake. Verify build, types, and event/repeated-start/disposal scenarios.
5. **Host verification and review** — load the built plugin through Settings → Plugins → Development → Add path; review permissions; exercise real Discord when configured. Review lifecycle races, resource usage, dependency weight, and public API boundaries. Update README to implemented and actually verified behavior.

## Checkpoints

- Compatibility must pass before choosing the runtime dependency.
- Build and relevant tests must pass after each code slice before the next.
- Completion requires built-entry runtime evidence; missing real Discord or UI proof must be reported, never inferred from tests.

## Risks

- Candidate IPC client may retain timers or fail to report disconnect: prove before adoption.
- Experimental Orca API or installed version may differ: stop on contradictory behavior.
- No public Discord application ID supplied: finish configuration support but do not claim real Discord verification.
- No automatic activation/persistent-worker contract: document event/command activation and approved refresh compromise.

All design and final integration decisions remain with the Astra Medium coordinator. Use Orca CLI for runtime coordination. Do not spawn workers for these sequential slices unless a genuinely independent, narrowly specified task makes it worthwhile.

## Compatibility gate result — blocked

Published `@xhayper/discord-rpc@1.5.1` was installed with `pnpm install --ignore-scripts` in a temporary directory, not this repository. A Node smoke used a unique Windows named pipe, completed the client's IPC handshake with a controlled READY response, closed the peer, waited 200 ms, called public `client.destroy()`, and observed timer cleanup after another 50 ms. Timer creation/clear instrumentation did not alter transport behavior.

`node probe.mjs` exited with code 1:

```json
{"phase":"connected","connected":true,"intervalCount":3}
{"phase":"peer-closed","connected":false,"disconnectedEvents":0,"intervalCount":3}
{"phase":"destroyed","disconnectedEvents":0,"intervalCount":3,"timeoutCount":1}
```

This demonstrates missing disconnect notification and retained timers after public disposal in the controlled peer-close scenario. It is not a test against Discord Desktop, nor proof that all close modes fail. Source inspection also showed a five-second transport heartbeat and an early return when closing an already-closed socket.

The user subsequently approved a bounded replacement evaluation. Results follow; no runtime dependency has been adopted.

## Replacement evaluation — no candidate selected

Evaluated exactly two replacement packages: [`discord-rpc@4.0.1`](https://registry.npmjs.org/discord-rpc/4.0.1) and [`@nyabsi/minimal-discord-rpc@1.0.2`](https://registry.npmjs.org/@nyabsi/minimal-discord-rpc/1.0.2). The `discord-rich-presence` wrapper was screened out because it delegates to a GitHub dependency on discord-rpc rather than providing an independent transport.

### Probe method

- Node 22.21.0 on Windows; packages installed in a temporary directory with `pnpm install --ignore-scripts --no-optional`. No package or lockfile was added to the project.
- Each scenario ran in its own process: `node probe.mjs <legacy|minimal> <peer|graceful|absent|fragmented>`.
- The unmodified package handled real named-pipe IPC. Test-only redirection mapped its Discord discovery paths to a unique test pipe, avoiding the user's Discord. A controlled peer sent READY and acknowledged activity frames.
- `peer`: successful handshake/activity, peer EOF, observe loss, call public destroy with a 500 ms bound, then explicitly reconnect with a fresh client and republish. `graceful`: destroy while connected. `absent`: no listening peer. `fragmented`: split READY inside its eight-byte header across two writes 50 ms apart.
- Timer instrumentation covered both globals and `node:timers`, including unref'ed timers. Socket tracking counted client-side sockets still open. Test deadlines/delays were excluded.
- The minimal client's activity promise resolves before acknowledgment. Its initial immediate-close probe exposed an in-flight timing case; the final idle-close comparison waited an additional 50 ms for replies. Results below use that settled comparison, not the initial peer-side write-after-end artifact.

| Check | discord-rpc 4.0.1 | @nyabsi/minimal-discord-rpc 1.0.2 |
| --- | --- | --- |
| Full READY handshake and activity write | Passed | Passed; login itself resolves before READY |
| Peer EOF detection | One disconnected event | No close event |
| Destroy after peer EOF | Did not settle within 500 ms | Did not settle within 500 ms |
| Graceful destroy after settled activity | Resolved | Resolved |
| Fresh-instance reconnect and republish | Two handshakes and two activity writes observed | Two handshakes and two activity writes observed |
| Final resources after peer/reconnect sequence | Zero tracked timers, zero open client sockets; first destroy still unresolved | Zero tracked timers, zero open client sockets; first destroy still unresolved |
| Absent peer | Connect rejected; destroy rejected on null socket; 10-second timeout remained registered | Connect rejected; destroy resolved; zero timers/sockets |
| Fragmented READY header | Connect exceeded one-second probe bound; uncaught buffer-offset exception; 10-second timeout remained registered | No READY received, although login resolved; destroy resolved with zero timers/sockets |

The fragmentation errors are additional reliability failures, not merely package-age concerns. No production socket polling, dependency-internal access, or protocol workaround was added.

### Dependency and bundle impact

Measured with esbuild 0.25.12 using a TypeScript client-construction entry, `bundle: true`, `platform: node`, `target: node20`, `format: esm`, minification, and a Node createRequire banner for CommonJS dependencies. No manually excluded runtime dependencies. Build succeeded for both; this is a candidate entry measurement, not a complete plugin bundle.

| Candidate | Minified bytes | Installed runtime graph |
| --- | ---: | --- |
| discord-rpc 4.0.1 | 363,235 | Six packages: client, node-fetch 2.7.0, whatwg-url 5.0.0, tr46 0.0.3, webidl-conversions 3.0.1, ws 7.5.13 |
| @nyabsi/minimal-discord-rpc 1.0.2 | 9,828 | Client only; no runtime dependencies |

The legacy bundle retains guarded optional external imports (including electron, register-scheme, encoding, bufferutil, utf-8-validate); optional dependencies were not installed. The minimal bundle imports only Node builtins. The minimal repository explicitly says no support is provided; npm metadata says GPL-3.0 while the repository reports AGPL-3.0, an additional unresolved adoption concern.

### Decision

Neither evaluated replacement met the lifecycle and reliability gate. Per the user's instruction, research stopped rather than extended. The user then authorized an in-repo minimal IPC client (zero runtime dependencies) as the transport, which is implemented in `src/discord.ts`. Temporary probe code and installed packages were removed after recording evidence.

## Implementation result

All slices are implemented and verified:

- `src/discord.ts` — minimal IPC client: frame codec, pipe discovery, handshake, bounded backoff, dedup/coalesce, idempotent shutdown.
- `src/presence.ts` — nullable context + observed status → bounded text, stable timestamp, branch-ref normalization.
- `src/main.ts` — Orca worker entry: activate/deactivate, event subscriptions, Start Presence command, one non-overlapping 60-second refresh.
- `orca-plugin.json` — manifest v1 (capabilities `workspace:read`, `events:subscribe`).

Evidence: `pnpm typecheck` clean; `pnpm test` 26 passed; `pnpm build` clean; `node scripts/smoke.mjs` OK (controlled peer); real Discord accepted the handshake and `SET_ACTIVITY` (`application_id 1553769338350342204`). Loading through Orca's development UI was performed by the operator; the plugin showed "Running" and the presence rendered in Discord. The 1024×1024 App Icon and matching plugin `icon` are wired; the Discord App Icon upload remains an operator step in the Developer Portal.

