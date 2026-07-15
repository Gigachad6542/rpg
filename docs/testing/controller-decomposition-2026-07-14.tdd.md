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
