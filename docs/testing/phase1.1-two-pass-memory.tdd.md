# Phase 1.1 two-pass memory influence: TDD and live evidence

Date: 2026-07-19

Production integration: 2026-07-20

## User journeys

1. As an eval owner, I need the first model call retained and graded separately
   so a fallback final answer cannot hide a failed educator.
2. As a runtime designer, I need paired full-history and recent-window controls
   so I can route a second call only where it adds memory value.
3. As a reviewer, I need provider failures, truncation, cost, and latency kept
   separate from model-quality comparisons.
4. As a grader maintainer, I need to re-apply corrected deterministic rules to
   an existing paid artifact without changing its model outputs or telemetry.

## RED/GREEN evidence

| Guarantee | RED evidence | GREEN evidence |
|---|---|---|
| Educator uses exact schema rather than basic JSON mode | Phase 1.1 test failed: received `json_object` and no reasoning control | Strict named `json_schema` plus `reasoning.enabled=false`; focused tests pass |
| Length-finished analysis is rejected and withheld | Test received a length-finished brief as usable influence | Runner records truncation and passes no brief to call two |
| Compact briefs finish within the provider limit | Excluded pilot: 44/54 educator calls failed at exactly 700 output tokens | Constrained schema + 1,000-token headroom; six-scenario sweep 6/6, final window briefs 18/18 |
| Rule grader handles multi-token evidence and valid wording variants | `must-include-all` and privacy/deadline wording tests failed | New check kind and scoped variants pass; paid outputs regraded offline |
| Transient provider errors do not decide causal delta | Test counted an HTTP 429 pair as a model harm | Reliability still reports the failure; paired comparison excludes that cell |
| Discarded placebo has no transmission metric | Test reported 1.0 transmission despite withholding the brief | Placebo retains brief accuracy but transmission is `null` |

Focused GREEN commands:

```powershell
pnpm exec vitest run tests/evals/phase11Eval.test.ts tests/providers/openAICompatibleProvider.test.ts
pnpm typecheck
```

Focused result at harness landing: 23 tests passed and TypeScript completed with
no errors. The production-integration verification below supersedes the older
repository-wide counts.

## Live evidence

- Invalid pilot excluded: 108 runs / 180 calls, but 44 of 54 evidence analyses
  were truncated at the 700-token cap.
- Acceptance sweep: six scenarios, 6/6 schema-valid and check-complete briefs,
  no truncation, known cost $0.0600.
- Accepted v2: 108 runs / 180 calls, exact model `qwen/qwen3.7-max`.
- Regraded `evidence-brief-window`: 18/18 strict, 18/18 brief correctness,
  six paired rescues, zero harms versus 12/18 `single-window`.
- Regraded `evidence-brief-full`: 16/18, the same end-to-end result as
  `single-full`; its small infrastructure-clean movement is not distinguishable
  from the stronger discarded-analysis placebo movement.
- Three upstream HTTP 429 calls are retained in reliability telemetry and
  excluded from their paired causal cells.
- Valid v2 known cost: $1.1480, with unavailable usage for the three 429 calls.

The local artifacts are intentionally ignored under
`evals/phase1.1/artifacts/`. The research interpretation is in
[`../research/two-pass-memory-influence.md`](../research/two-pass-memory-influence.md).

## Production integration

The accepted result is now the sole active two-call runtime behavior:

- `evidence-brief` stays at one call for short branches and makes two calls only
  when more than four prior messages exist;
- call one reads the wider source-tagged active branch and returns the strict
  evidence schema used by the accepted evaluation;
- call two uses the same selected model, the four-message recent window, and the
  validated brief;
- analysis can neither propose nor persist state, and its private output is not
  written to the player transcript, rolling summary, card memory, or lineage;
- malformed, truncated, empty, provider-failed, over-budget, or unknown-citation
  analysis is withheld and the visible request returns to its ordinary full-context path;
- the old `full` and `economical` settings are migration aliases only. There is
  no separate economical-model route in the live turn pipeline.

The production RED tests first demonstrated that the old policy always scheduled
a hidden call, allowed a different model, wrote inferred continuity into durable
state, and lacked strict source/schema validation. The GREEN implementation adds
module-level schema and citation checks, policy boundary tests, hook-level
fail-open/non-persistence coverage, settings migration coverage, and UI telemetry
integration for the `memory-evidence` phase.

Production GREEN commands:

```powershell
pnpm exec vitest run tests/runtime/memoryEvidenceBrief.test.ts tests/runtime/hiddenContinuityPolicy.test.ts tests/app/useTurnGeneration.test.tsx tests/app/SettingsSection.test.tsx tests/app/appHelpers.test.ts tests/app/modelCallRecordValidation.test.ts tests/app/TurnDeltaPanel.test.tsx tests/ui/AppModelTelemetry.test.tsx tests/ui/App.core.test.tsx
pnpm typecheck
pnpm lint
pnpm test
pnpm eval:phase1
pnpm eval:phase1.1
pnpm audit:prod
```

Production result: 9 focused files / 62 tests passed; TypeScript and lint passed;
the full suite passed 99 files / 724 tests; both deterministic eval gates passed;
Phase 1.1 reported `liveCallsMade: 0`; and the production audit found no known
vulnerabilities. The legacy Phase 1 gate emitted a non-fatal Vite WebSocket port
warning and still completed successfully.

## Coverage and known gaps

- Deterministic memory checks are complete for the six scoped challenge types.
- Blind human prose, agency, continuity, and pairwise preference ratings are not
  complete; no subjective quality win is claimed.
- Three repetitions and six scenarios are an exploratory stability floor, not
  a universal Qwen claim.
- The matrix has a full-context discarded-analysis placebo but no separate
  recent-window discarded-analysis arm. The six systematic rescues on omitted
  update/deadline facts provide a clear mechanism, but a future confirmatory
  lane should add that placebo before broad production rollout.
- No checkpoint commits were created because the workspace already contained
  the user's uncommitted implementation work; the RED/GREEN commands and output
  are preserved here instead.
