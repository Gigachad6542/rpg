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
