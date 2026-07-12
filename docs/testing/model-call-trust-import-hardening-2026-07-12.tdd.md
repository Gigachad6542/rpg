# Model Call, Trust Boundary, and Import Hardening TDD Evidence

Date: 2026-07-12

## Scope

- Preserve the intentional two-call turn design while making both calls observable.
- Record provider, model, input/output/total tokens, duration, and status for continuity preparation and the visible response.
- Put app-owned runtime authority in the provider system role and keep imported or user-authored content in user context.
- Prevent terminal extraction JSON from appearing in streamed player-visible prose.
- Reject malformed, oversized, or duplicate-heavy runtime imports and remove unsafe imported URLs.
- Keep desktop restore snapshots out of webview storage and state the provider privacy boundary accurately.

## RED / GREEN Checkpoints

| Behavior | RED evidence | GREEN evidence |
| --- | --- | --- |
| Two existing model calls have a persistent, visible usage ledger | `d177134`: telemetry was absent and the turn panel rendered nothing without state proposals | `89b97d6`: exactly two phase records persist through browser, TypeScript SQLite, and Rust SQLite paths; the turn panel shows combined and per-call usage |
| Hidden-call failure remains fail-open and observable | `d177134`: the visible response completed but no failed first-phase record existed | `89b97d6`: a zero-token error record is retained beside the successful visible call |
| Runtime authority uses a genuine system prompt | `d177134`: adapter `systemPrompt` was undefined | `ebfb262`: fixed app authority and the response contract are sent at system priority; card, persona, lore, and history remain user content |
| Extraction JSON never flashes during streaming | `d177134`: the last stream callback contained the terminal fenced extraction object | `ebfb262`: partial and complete terminal extraction fences are withheld while the raw response still feeds final validation |
| Runtime imports fail closed at shared boundaries | `d177134`: malformed nested data, duplicate IDs, count limits, a 10 MiB payload, imported image URLs, and URL userinfo were accepted | `89b97d6`: centralized Zod validation, byte/count limits, ID checks, image URL removal, and credential-free URL sanitization are enforced |
| Desktop restore snapshots avoid webview local storage | `d177134`: no desktop persistence policy existed and onboarding overstated key privacy | `e34a866`: desktop restore points are session-scoped, rotating SQLite backups remain durable, and the copy accurately describes provider transmission |

## Verification

| Command | Result |
| --- | --- |
| `pnpm verify` | PASS: typecheck, ESLint, 56 Vitest files / 474 tests, production build, production dependency audit, 30 Rust tests, and Clippy with warnings denied |
| `pnpm test:coverage` | PASS: 92.38% statements/lines, 88.83% branches, 93.98% functions; 56 files / 474 tests |
| `pnpm exec vitest run tests/app/runtimeRepositoryStore.test.ts` | PASS: 7 tests, including two-call metadata through the TypeScript repository |
| `cargo test --manifest-path src-tauri/Cargo.toml runtime_repository::tests::normalized_rows_win_over_stale_snapshot_blob` | PASS: two-call metadata survives the normalized Rust SQLite path |
| `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` | PASS |
| `git diff --check` | PASS |

## Notes

- No additional model request was introduced. The first phase is the existing continuity-preparation call and the second is the existing player-visible response call.
- The legacy top-level prompt-run `usage` remains the visible-response usage for compatibility. `modelCalls` is the authoritative per-phase ledger and combined-total source.
- Desktop UI restore points are intentionally session-only in this tranche; rotating SQLite backups remain the durable recovery mechanism across restarts.
