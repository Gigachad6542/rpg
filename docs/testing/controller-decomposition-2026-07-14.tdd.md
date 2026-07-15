# Controller Decomposition TDD Evidence

Date: 2026-07-14  
Scope: extract telemetry capture/record construction and authoritative RPG
state diffs from the application component.

## RED

Two new suites failed at module resolution because the controller-owned behavior
had no independent modules:

```text
pnpm exec vitest run tests/app/modelCallTelemetryAdapter.test.ts tests/app/authoritativeStateMutations.test.ts
```

## GREEN

- `modelCallTelemetryAdapter.ts` owns generated/streamed call capture, outcome
  classification, cost records, and monotonic duration helpers.
- Completed streams now provide their terminal usage directly to telemetry;
  the App-level post-pipeline fallback remains a defensive compatibility path.
- `authoritativeStateMutations.ts` owns deterministic diffs for location,
  health, inventory, quests, flags, and known places.
- `App.tsx` first fell from 3,369 to 3,222 lines without changing UI behavior.

Verification:

```text
3 files / 13 tests passed
pnpm typecheck
pnpm lint
```

The 13 tests include all nine existing application telemetry integrations plus
the four new focused tests.

## Second extraction

RED: `tests/app/appControllerHelpers.test.ts` failed because the new helper
module did not exist.

GREEN: legacy persona-prompt migration, abort classification, card/persona lore
entry disabling, and imported-message counting moved to
`appControllerHelpers.ts`. Its four focused tests and all 81 main App tests
passed (85 total); typecheck and lint remained green. `App.tsx` is now 3,178
lines.

## Third extraction

RED: `tests/app/runtimeCardFactory.test.ts` failed at module resolution because
card construction still lived inside the React controller.

GREEN: `runtimeCardFactory.ts` now owns draft normalization, default/custom
player-rule composition, initial lore/story entities, and RPG-state defaults.
The controller allocates the ID and applies the returned card. Two focused
factory tests and all 81 main App tests passed; typecheck and lint remained
green. `App.tsx` is now 3,140 lines.

## Fourth extraction

RED: `tests/app/providerController.test.ts` failed because secure-key and
ComfyUI selection policy had no independent module.

GREEN: `providerController.ts` now owns secure-storage preflight, hosted-key
storage/forget results, secret-free return values, and ComfyUI checkpoint
selection/status. Four focused policy tests and all 81 main App tests passed.
The App test suite also caught and prevented an initial synchronous-status
timing regression before the extraction landed. Typecheck and lint are green;
`App.tsx` is now 3,077 lines.

## Fifth extraction

RED: `tests/app/assetService.test.ts` failed because configured image execution
still existed only inside the React controller.

GREEN: `assetService.ts` now owns provider construction, quality normalization,
prompt-only behavior, malformed-output handling, and desktop durable-asset URL
replacement. Four focused service tests and all 81 main App tests passed;
typecheck and lint are green. `App.tsx` is now 3,022 lines.

## Sixth extraction

RED: `tests/app/runtimeSnapshotHydration.test.ts` failed because startup and
recovery normalization had no shared module.

GREEN: `runtimeSnapshotHydration.ts` now provides one normalization policy for
browser startup, repository hydration, and restore points, including chat-derived
card state, prompt-debug retention, provider/persona parsing, and active media.
Two focused hydration tests and all 81 App integration tests passed; typecheck
and lint are green. `App.tsx` is now 2,945 lines.

## Rust repository validation extraction

RED: `tests/runtime/rustRepositoryArchitecture.test.ts` failed because
`runtime_repository/validation.rs` did not exist.

GREEN: snapshot caps, recursive value/ID validation, provider-reference
sanitization, ComfyUI workflow secret detection, and image-provider
sanitization now live in the dedicated Rust validation module. The top-level
repository authority fell from 3,789 to 3,497 lines. The architecture contract,
all 35 Rust tests (34 passed and the signed-release-only Keychain smoke ignored),
`cargo fmt`, and clippy with `-D warnings` passed.

RED: the second Rust architecture contract failed because
`runtime_repository/schema.rs` did not exist.

GREEN: the ordered migration ledger, schema SQL, historical-constraint
preflights, table rebuilds, backup-before-migration behavior, and integrity
checks now live in the schema module. The top-level repository authority is now
2,848 lines, with 666 lines of schema evolution isolated behind two internal
entry points. Both architecture contracts, all 35 Rust tests (34 passed and one
release-only ignore), formatting, and clippy passed.

RED: the third Rust architecture contract failed because the 1,113-line
repository regression corpus still lived inside the production authority.

GREEN: those tests now live in `runtime_repository/tests.rs`; the production
authority is 1,732 lines and the test fixture paths remain explicit. All three
architecture contracts, all 35 Rust tests, formatting, and clippy passed.

RED: the fourth Rust architecture contract failed because normalized snapshot
CRUD still occupied the top-level repository module.

GREEN: load/overlay, save/transaction, normalized-table CRUD, pruning, legacy
compatibility, and JSON row helpers now live in
`runtime_repository/storage.rs`. The command-facing repository authority is
367 lines and the cohesive storage module is 1,382 lines. All four architecture
contracts, all 35 Rust tests, formatting, and clippy passed.

## UI integration suite decomposition

The 4,752-line `tests/ui/App.test.tsx` integration suite was split without
changing its 81 acceptance cases. Shared render, storage, Tauri-mock, and
interaction fixtures now live in the 234-line `App.testHarness.tsx`; behavior
is grouped into independently runnable core (21 tests), chat/lore (19),
providers (21), media (13), and data (7) suites. The largest domain suite is
1,415 lines instead of a single 4,752-line file.

All five suites passed together (5 files / 81 tests), and both `pnpm typecheck`
and `pnpm lint` remained green. The original and split suites contain the same
81 unique test names, providing a mechanical completeness check in addition to
the behavioral run.

## Application chrome extraction

RED: `tests/ui/AppChrome.test.tsx` failed at module resolution because the
sidebar and topbar still lived inside the stateful application controller.

GREEN: `AppChrome.tsx` now owns current-page navigation, theme control, local
save/repository status, active-card context, and runtime header actions. Its two
focused interaction tests and all 81 App integration tests passed; typecheck
and lint remained green. `App.tsx` is now 2,817 lines.

## Chat deletion lifecycle extraction

RED: the focused lifecycle suite could not resolve `chatLifecycle.ts`. Review
of the controller path also showed that confirmed deletion retained only the
card's non-archived chats, silently removing archived sibling history.

GREEN: `deleteActiveChatState` now applies the confirmed deletion atomically
across chats, active selection, card continuity, prompt runs, and generated
media while retaining every archived sibling. Two focused lifecycle tests and
all 19 chat/lore integration tests passed; typecheck and lint remained green.
`App.tsx` is 2,822 lines, with the cross-surface mutation now isolated behind a
typed result instead of distributed React setters.

RED: two additional lifecycle cases failed because archive and restore state
transitions were not exported by the new module.

GREEN: archive and restore now share the same typed card/chat/selection result,
retain older archives, create a fallback only when the last active chat is
archived, and derive the card from the selected continuity branch. All four
lifecycle tests and all 19 chat/lore integration tests passed; typecheck and
lint remained green. The controller is 2,835 lines after explicit typed wiring;
the cohesive lifecycle authority is 138 lines.

## Provider-management hook extraction

RED: commit `d01579f` added three hook contracts and failed at module resolution
because provider/session-key state, secure-storage status, provider health
checks, and ComfyUI startup discovery still lived inside `App.tsx`.

The first implementation passed those focused tests, typecheck, lint, and all
21 provider integrations. The full 81-test App integration run then caught a
real timing regression: changing ComfyUI generation-only settings such as steps
or CFG restarted checkpoint discovery, temporarily marked the provider not
ready, and suppressed automatic character portraits. The test was retained;
the hook now restarts discovery only when mode, endpoint, model, or image API
key changes, while a ref preserves the latest generation settings for the
asynchronous result.

GREEN: commit `2d3aedf` isolates the orchestration in the 225-line
`useProviderManagement.ts`. All 81 App integrations plus the three direct hook
contracts passed; TypeScript and ESLint were clean. `App.tsx` fell from 2,836
to 2,675 lines without changing the provider UI or packaged runtime contract.

The complete release gate passed from the beginning on
`2d3aedff97ef613417231c92c5e31803d080e87e` in 283.0 seconds: 89 files / 672
tests, 91.86% statements/lines, 88.83% branches, 93.49% functions, both
deterministic evals, 14 Playwright journeys, clean production dependency audit,
accepted Rust audit, 34 Rust tests, strict clippy, MSI/NSIS packaging, both
desktop smokes, and the normal installer lifecycle. The packaged WebView
product flow then passed in 14.7 seconds against the rebuilt MSI.
