# Hidden Continuity Fail-Open TDD Evidence

## Source

User report: key runtime parts are not working, including model messages.

## User Journey

As a player, I want the visible model response to still run if the hidden continuity pre-pass fails, so one auxiliary model call cannot break normal chat.

## RED/GREEN Summary

| Behavior | Test target | RED evidence | GREEN evidence |
|---|---|---|---|
| Hidden continuity provider errors return an empty continuity result with a warning instead of throwing | `tests/runtime/hiddenContinuity.test.ts` | `pnpm exec vitest run tests\runtime\hiddenContinuity.test.ts` failed with `runHiddenContinuityPassSafely is not a function` | Same command passed: 4 tests |
| App send path uses fail-open hidden continuity before visible generation | `src/app/App.tsx` plus UI suite | App previously awaited the throwing hidden pass directly | `pnpm exec vitest run tests\ui\App.test.tsx tests\runtime\hiddenContinuity.test.ts` passed: 53 tests |

## Validation

| Command | Result |
|---|---|
| `pnpm exec vitest run tests\runtime\hiddenContinuity.test.ts` | PASS, 4 tests |
| `pnpm exec vitest run tests\ui\App.test.tsx tests\runtime\hiddenContinuity.test.ts` | PASS, 53 tests |
| `pnpm typecheck` | PASS |
| `pnpm lint` | PASS |
| `pnpm test` | PASS, 139 tests |
| `pnpm build` | PASS |
| `pnpm test:coverage` | PASS, 139 tests; aggregate coverage reported 77.97% statements and 77.97% lines because older domain/provider files remain uncovered |
| In-app browser smoke at `http://127.0.0.1:5173/` | PASS, Blank Slate RPG sent a message, received an assistant response, updated character continuity, and logged no console errors |

## Live Finding

The running app was set to `Mock local runtime`, so the visible assistant response was the canned local mock text. Real model responses require switching the LLM Provider runtime mode to an OpenAI-compatible provider and activating a session key or stored key.
