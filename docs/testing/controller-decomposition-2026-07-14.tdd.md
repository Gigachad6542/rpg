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
- `App.tsx` fell from 3,369 to 3,222 lines without changing UI behavior.

Verification:

```text
3 files / 13 tests passed
pnpm typecheck
pnpm lint
```

The 13 tests include all nine existing application telemetry integrations plus
the four new focused tests.
