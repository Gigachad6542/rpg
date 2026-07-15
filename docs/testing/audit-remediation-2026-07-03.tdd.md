# Audit Remediation TDD Evidence

Historical wording correction (2026-07-14): the command retained the compatibility
name `desktop:installed-smoke`, but it used `msiexec /a` administrative extraction
and did not prove normal installer registration, upgrade, repair, or uninstall.

## Source

User request: implement the audit remediation plan for share-safe exports, image-provider
persistence, Rust advisory posture, desktop installed smoke validation, wrapper cleanup, and
production docs.

## User Journeys

1. As a player sharing a runtime bundle, I want exports to omit compiled prompts even when local
   prompt-debug logging is enabled.
2. As a desktop user recovering local ComfyUI settings, I want safe image workflow settings to
   persist locally without ever saving API keys, unknown secret fields, or secret-bearing workflow
   JSON.
3. As a release maintainer, I want the generated Windows bundle staged and launched under a clean
   temp profile, with repository creation verified before I trust the release lane.
4. As a maintainer returning to the project, I want the outer wrapper root cleaned up so the inner
   `C:\Users\Dwthe\rpg project` is the only repository surface.

## RED/GREEN Summary

| Behavior | Test target | RED evidence | GREEN evidence |
|---|---|---|---|
| Runtime exports strip compiled prompts regardless of prompt-debug settings | `tests/app/runtimeDataBundle.test.ts` | Focused test failed because `compiledPrompt` leaked when `promptDebugLogs` was true | Focused suite passed after adding export-only prompt-run sanitization |
| Image provider persistence drops secrets and keeps only safe allowlisted fields | `tests/app/runtimeRepositoryStore.test.ts`, `tests/app/coverageGaps.test.ts` | Focused tests failed because raw `imageProviderSettings` reached repository/Tauri payloads | Focused suite passed after routing persistence through `sanitizePersistedImageProviderSettings` |
| Rust snapshot boundaries sanitize image provider settings | `src-tauri/src/runtime_repository.rs` tests | Targeted Rust test failed because `apiKey` persisted in `imageProviderSettings` | Targeted Rust test passed after adding Rust sanitizer and load/save cleanup |
| Release gate includes MSI-payload smoke | `tests/release/releaseWorkflow.test.ts` | Release workflow test failed because `desktop:installed-smoke` was absent | Test passed after adding the script and including it in `verify:release` |
| Extracted bundle creates durable repository under isolated app data | `pnpm desktop:installed-smoke` | Initial script failed until the smoke app-data override initialized the temp SQLite repository | MSI-payload smoke passed after temp-confined Rust initialization and script path correction |

## Validation

| Command | Result |
|---|---|
| `pnpm typecheck` | PASS |
| `pnpm lint` | PASS |
| `pnpm test` | PASS, 31 files and 227 tests |
| `pnpm test:coverage` | PASS, 31 files and 227 tests; 99.2% statements/lines, 93.02% branches in the standalone run |
| `pnpm e2e` | PASS, 1 Chromium smoke test |
| `pnpm audit:prod` | PASS, no known production npm vulnerabilities |
| `pnpm rust:audit` | PASS, 17 allowed Rust advisory warnings |
| `pnpm rust:test` | PASS, 16 Rust tests |
| `pnpm rust:clippy` | PASS with `-D warnings` |
| `pnpm desktop:build` | PASS, MSI and NSIS bundles built |
| `pnpm desktop:smoke` | PASS |
| `pnpm desktop:installed-smoke` | PASS, MSI administratively extracted into temp root and SQLite DB created under isolated temp profile |
| `pnpm verify:release` | PASS, full release gate including MSI-payload smoke; coverage reported 99.2% statements/lines and 93.01% branches |

## Notes

The dependency refresh updated the Tauri JavaScript package line to `@tauri-apps/api` 2.11.1 and
`@tauri-apps/cli` 2.11.4. The targeted Rust refresh moved patch-level Tauri crates such as `tauri`
2.11.5 and `tauri-runtime-wry` 2.11.4, but it did not remove the GTK/WebKitGTK advisory chain, so
the 17 Rust warnings remain formally accepted controlled-beta debt.
