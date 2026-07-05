# Domain Coverage Consolidation TDD Evidence

## Source

User request: scan the older uncovered files and fix the blockers, not just a partial subset.

## User Journeys

1. As a maintainer, I want `src/domain` to expose the split domain contracts, so imports do not silently use stale aggregate types.
2. As a maintainer, I want executable low-coverage helpers covered by tests, so provider and persistence behavior stays protected.
3. As a maintainer, I want pure type-only contracts excluded from coverage, so coverage reflects executable risk instead of empty interface files.

## RED/GREEN Summary

| Behavior | Test target | RED evidence | GREEN evidence |
|---|---|---|---|
| Domain barrel exposes split registries instead of the old stale aggregate model | `tests/domain/domain.test.ts` | Focused suite failed because `CHARACTER_ORIGINS` was undefined from `src/domain` | Same focused suite passed after replacing `src/domain/index.ts` with a barrel |
| JSON driver helpers preserve fallback behavior | `tests/db/driver.test.ts` | New characterization coverage was absent | Focused suite passed with JSON serialize/parse fallback coverage |
| Local endpoint adapter blocks unsafe unauthenticated non-loopback calls and supports loopback chat completions | `tests/providers/localEndpointAdapter.test.ts` | New characterization coverage was absent | Focused suite passed with loopback success and non-loopback refusal coverage |
| Pure contract files are not counted as uncovered executable code | `vite.config.ts` coverage excludes | Coverage report previously included type-only/adapter contract files | Coverage report now excludes type-only contracts while keeping executable modules tested |

## Validation

| Command | Result |
|---|---|
| `pnpm exec vitest run tests\domain\domain.test.ts tests\db\driver.test.ts tests\providers\localEndpointAdapter.test.ts` before implementation | FAIL, `CHARACTER_ORIGINS` was undefined |
| `pnpm exec vitest run tests\domain\domain.test.ts tests\db\driver.test.ts tests\providers\localEndpointAdapter.test.ts` after implementation | PASS, 9 tests |
| `pnpm typecheck` | PASS |
| `pnpm lint` | PASS |
| `pnpm test` | PASS, 143 tests |
| `pnpm build` | PASS |
| `pnpm test:coverage` | PASS, 143 tests; aggregate coverage reported 88.52% statements and 88.52% lines |

## Coverage Scope

`src/domain/index.ts` is now a pure barrel over the split domain files. `src/domain/prompt.ts` now includes the missing `pre_history_directive` prompt layer kind used by the app prompt assembly path.

The coverage exclude list is limited to pure type-only or contract-only files: `src/db/types.ts`, `src/domain/ids.ts`, `src/providers/ImageModelAdapter.ts`, and `src/providers/TextModelAdapter.ts`.
