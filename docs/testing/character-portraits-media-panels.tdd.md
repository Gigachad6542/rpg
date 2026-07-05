# Character Portraits and Media Panels TDD Evidence

## Source

User request: automatically generate photos for story characters as they appear, show those photos beside character info, and allow Map, Characters, and Image panels to be open at the same time.

## User Journeys

1. As a player, I want newly discovered story characters to receive portrait artifacts automatically, so the roster gains visual continuity without manual image prompting.
2. As a player, I want portraits displayed beside each tracked character, so the Characters panel is more useful at a glance.
3. As a player, I want Map, Characters, and Image available together, so I can work with world, roster, and image tools without tab switching.
4. As a long-running story user, I want generated character portrait metadata retained across saves, so longer rosters do not quickly lose their media artifacts.

## RED/GREEN Summary

| Behavior | Test target | RED evidence | GREEN evidence |
|---|---|---|---|
| Map, Characters, and Image render together while character portraits are created and persisted | `tests/ui/App.test.tsx` | Focused UI suite failed before implementation because the new panel and portrait expectations were absent | `pnpm exec vitest run tests\ui\App.test.tsx` passed: 49 tests |
| Character portrait metadata survives persistence with a larger media window | `tests/app/localRuntimeStore.test.ts` | Existing compact media retention was sized for the old small map/image set | `pnpm exec vitest run tests\app\localRuntimeStore.test.ts tests\ui\App.test.tsx` passed: 52 tests |

## Validation

| Command | Result |
|---|---|
| `pnpm exec vitest run tests\app\localRuntimeStore.test.ts tests\ui\App.test.tsx` | PASS, 52 tests |
| `pnpm typecheck` | PASS |
| `pnpm lint` | PASS |
| `pnpm test` | PASS, 138 tests |
| `pnpm build` | PASS |
| `pnpm test:coverage` | PASS, 138 tests; aggregate coverage reported 77.88% statements and 77.88% lines because older domain/provider files remain uncovered |
| In-app browser smoke at `http://127.0.0.1:5173/` | PASS, Blank Slate RPG opened with Map, Characters, and Image sections visible together |

## Known Gaps

The coverage command succeeds, but the repository's aggregate coverage remains below 80% because pre-existing domain and provider type/adapter files are still uncovered. The touched app/store areas are covered by focused UI and persistence tests.
