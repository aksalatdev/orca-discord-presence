# v0.1 tasks

- [x] Confirm configured Astra Medium primary and available Orca CLI runtime; bind orchestration run.
- [x] Record approved specification and implementation order.
- [x] Bounded replacement evaluation: probed `discord-rpc` 4.0.1 and `@nyabsi/minimal-discord-rpc` 1.0.2; both rejected. Evidence in `plan.md`.
- [x] Select a lifecycle-safe Discord client: in-repo minimal IPC client (zero runtime dependencies), approved after review.
- [x] Mapping: nullable context, bounded text, observed agent status, stable timestamps. Build, typecheck, and focused Vitest tests pass.
- [x] Discord: deduplication, coalescing, reconnect, and clean shutdown. Build, typecheck, lifecycle tests, and IPC smoke pass.
- [x] Orca: manifest, lazy events, Start Presence, configuration, and single 60-second context refresh. Build, typecheck, and integration tests pass.
- [x] Verify built plugin against real Discord (handshake + presence accepted).
- [x] Final review and README matching implemented behavior; no generated junk or unnecessary dependencies.

## Remaining

- [ ] Load-through-Orca-development-UI evidence is recorded by the operator (requires the interactive desktop UI).

## Tests, last run

`pnpm typecheck` clean; `pnpm test` 26 passed; `pnpm build` clean; `node scripts/smoke.mjs` OK.

## v0.2 Git distribution preparation

- [x] Keep the built worker in the release tree, use a per-user config file,
  add MIT licensing, and align the package and manifest at 0.2.0.
- [x] Harden context-refresh failures and IPC frame, reconnect, and shutdown
  handling; extend controlled-peer coverage.
- [x] Document privacy and the manual Discord Application ID step.
- [x] Check the v0.2 bundle against local Discord Desktop on Windows: `READY`
  handshake succeeded and the temporary presence was cleared.
- [ ] Verify the Git install in real Orca and Discord, then publish the
  `v0.2.0` tag. Verify macOS and Linux before claiming those platforms.
