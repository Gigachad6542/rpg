# Phase 1.1 Live Quality and Retrieval TDD evidence

Date: 2026-07-13
Source: user-provided Phase 1.1 acceptance criteria; no external plan file.

## User journeys

- As a maintainer, I can run identical synthetic scenarios through `off`,
  `economical`, and `full` against strong hosted, economical hosted, and local
  OpenAI-compatible targets, so the second call can be judged on quality,
  latency, tokens, and cost.
- As a player, generic lore keys do not activate inside unrelated words, while
  explicitly imported substring behavior remains compatible.
- As an author, I can use aliases, see overbroad-key warnings, and inspect why a
  lore entry activated.
- As a maintainer, I can validate 100 labeled lore decisions and three long
  campaign fixtures without making a paid model call.
- As an operator, I can attach exact immutable pricing to both the visible and
  routed economical models without borrowing one model's rate for another.

## RED / GREEN report

| Behavior | RED evidence | GREEN evidence | Guarantee |
| --- | --- | --- | --- |
| Boundary-aware literals | Focused Vitest run: `gate` activated for `investigate` | `tests/runtime/loreTriggerEngine.test.ts`: 29 passed | Ordinary literal keys use Unicode-aware token boundaries |
| Broad-key secondary rule | Focused Vitest run: `go` activated without a secondary key | Same 29-test suite passed | Automatically broad literals require a secondary match |
| Alias and provenance | RED: exported functions were absent | Same suite passed | Alias/entity-name matches expose primary, secondary, scopes, and a human-readable reason |
| Exact economical pricing | RED: routed snapshot resolved to `undefined` | `tests/runtime/modelCallTelemetry.test.ts`: 17 passed | Resolution is by exact model id across visible/economical snapshots |
| Live artifact contract | RED: `src/evals/phase11Eval.ts` was absent | `tests/evals/phase11Eval.test.ts`: 7 passed | One/two-call invariant, phase metrics, redaction, blind score, and pairwise preference are schema-gated |
| Incremental value report | Final review RED: `comparisonVsOff` was absent | Same 7-test suite passed | Two-call modes report mean added tokens, duration, and provenance-aware cost per run against `off` |
| Paid-call boundary | RED: live script was absent | Phase 1.1 eval tests passed | Live execution requires `readyForPaidRuns` and an explicit acknowledgement; example config fails before `fetch` |
| Lore exit bar | New deterministic corpus | `pnpm eval:phase1.1`: 100 decisions, precision 1.00, recall 1.00 | Regression bar exceeds >=0.90 precision and >=0.95 recall |
| Long-session fixtures | New deterministic fixtures | `pnpm eval:phase1.1`: 60, 55, and 75 turns | Every fixture includes edit, regeneration, branch, restart, and model switching |
| Corrected Phase 1 reproducer | `pnpm eval:phase1` rejected corpus drift | `pnpm eval:phase1:update` then `pnpm eval:phase1` passed | The 36-turn corpus now reproduces `gate` inside `investigate` and reports lore precision/recall 1.00/1.00 |

## Test specification

| # | What is guaranteed | Test or command | Type | Result |
| ---: | --- | --- | --- | --- |
| 1 | `off` has one visible call; `economical` and `full` have one hidden then one visible call | `tests/evals/phase11Eval.test.ts` | schema/integration | PASS |
| 2 | Hidden/visible TTFT, duration, tokens, cost, failures, proposals, and quality remain separate | `tests/evals/phase11Eval.test.ts` | schema/scoring | PASS |
| 3 | Credential material is redacted and raw keys cannot enter config artifacts | `tests/evals/phase11Eval.test.ts` plus production secret scan | security | PASS |
| 4 | `gate` does not match `investigate`; explicit substring compatibility still can | `tests/runtime/loreTriggerEngine.test.ts` | unit | PASS |
| 5 | Aliases, broad-key requirements, warnings, and trigger reasons work | `tests/runtime/loreTriggerEngine.test.ts` | unit/UI contract | PASS |
| 6 | Economical pricing resolves only for its exact model | `tests/runtime/modelCallTelemetry.test.ts`, `tests/app/appHelpers.test.ts` | unit/integration | PASS |
| 7 | Expanded lore corpus clears the objective exit bar | `pnpm eval:phase1.1` | deterministic product eval | PASS: 100/100 correct |
| 8 | Three long-session fixtures cover disruptive continuity operations | `pnpm eval:phase1.1` | deterministic fixture gate | PASS |
| 9 | Existing runtime behavior remains covered | `pnpm test:coverage` | regression/coverage | PASS: 67 files, 595 tests |

## Coverage and security

- `pnpm test:coverage`: PASS, 91.49% statements/lines, 88.27% branches,
  94.24% functions.
- `pnpm lint`: PASS.
- `pnpm typecheck`: PASS.
- `pnpm build`: PASS.
- `pnpm audit:prod`: PASS, no known production dependency vulnerabilities.
- `pnpm verify`: PASS twice (98.4-second cold run; 39.7-second final warm run),
  including 595 Vitest tests, both deterministic eval gates, the production
  build, 32 Rust tests, and Clippy with warnings denied.
- Secret-pattern review found only intentional redaction fixtures; no production
  key or credential was added.

## Known gap and required live evidence

No live provider call was made during implementation or verification. Therefore
there is not yet an honest `off` / `economical` / `full` quality winner or cost
recommendation. The live runner and blind-judgment format are ready, but a
maintainer must replace all example endpoints/models/prices, confirm the exact
pricing snapshot, opt into paid calls, and collect judgments. Deterministic
state/safety outcomes should be repeated to `pass^3` before using those results
as release evidence.

## Merge evidence

- RED checkpoint: `d6f1b8f` (`test: define phase 1.1 live quality and lore precision gates`).
- GREEN checkpoint: recorded after the final `pnpm verify` result on this branch.
