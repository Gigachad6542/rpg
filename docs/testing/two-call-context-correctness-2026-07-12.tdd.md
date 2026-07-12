# Two-Call Context Correctness TDD Evidence

Date: 2026-07-12

## Source and interpretation

The user asked to start Phase 1. The repository's historical Phase 1 turn-state work is already complete, so this run started the first unfinished prompt-runtime slice: model-aware budgeting from `docs/remediation-plan.md` Phase 2.2, tracked here as Phase 1A of the new improvement work.

## User journeys

- As a player, I want every turn to stay within the selected model's safe context envelope so long sessions do not fail unpredictably.
- As a player, I want the intentional continuity and visible-response calls to show used-versus-budget input tokens so I can understand utilization.
- As a maintainer, I want trusted analyst/response instructions separated from imported story data so prompt injection cannot gain system priority.
- As a maintainer, I want exactly two generation calls to remain the invariant while budgets and accounting improve.

## RED / GREEN report

| Behavior | RED evidence | GREEN evidence | Guarantee |
| --- | --- | --- | --- |
| Conservative model budget resolution | `3386ba2`: `modelCallBudget` import did not exist | `f06e024`: resolver tests pass | Unknown/local models use a 16k fallback; advertised windows are capped at 32k with output and 512-token safety reserves |
| Hidden-call trust boundary | `3386ba2`: `systemPrompt` was absent and imported/card/history text shared the instruction role | `f06e024`: hidden tests pass | Fixed analyst policy is system text; card, memory, history, proposals, and player action remain user data |
| Hidden input trimming | `3386ba2`: oversized fixture reached 71,178 estimated input tokens against a 1,800-token budget | `f06e024`: hidden tests pass | Oldest optional history/memory is removed first while latest action, card identity, location, and health survive |
| Visible contract and full input budget | `3386ba2`: response contract appeared in both roles and `maxOutputTokens` was undefined | `f06e024`: pipeline tests pass | Response contract appears once at system priority; system plus user input and output reserve fit the envelope |
| Fallback usage accounting | `3386ba2`: browser and desktop adapters counted only user text | `f06e024`: provider tests pass | Fallback estimates include both system and user prompts |
| Utilization telemetry | `3386ba2`: call records lacked budgets and the UI had no utilization rate | `f06e024`: App, panel, repository, import, and Rust round-trip tests pass | Both call records persist an input budget and display used/budget plus percentage without adding a call |

## Test specification

| # | What is guaranteed | Test target | Type | Result |
| --- | --- | --- | --- | --- |
| 1 | Resolver fallback, metadata cap, phase output reserve, and safety margin are deterministic | `tests/runtime/modelCallBudget.test.ts` | Unit | PASS |
| 2 | Hidden prompts separate roles, trim deterministically, preserve essential context, and retain abort/fail-open behavior | `tests/runtime/hiddenContinuity.test.ts` | Unit/integration | PASS |
| 3 | Visible prompt has one response contract and accounts for system plus user input | `tests/runtime/turnPipeline.test.ts` | Integration | PASS |
| 4 | Browser and stored-secret fallback usage includes system tokens | `tests/providers/openAICompatibleProvider.test.ts`, `tests/providers/tauriStoredSecretTextProvider.test.ts` | Unit | PASS |
| 5 | One turn still records exactly two calls with budget telemetry, including hidden failure | `tests/ui/AppModelTelemetry.test.tsx` | UI integration | PASS |
| 6 | Utilization is rendered and budget metadata validates and round-trips | `tests/app/TurnDeltaPanel.test.tsx`, `tests/app/runtimeRepositoryStore.test.ts`, `tests/app/runtimeImportSecurity.test.ts`, Rust repository test | UI/persistence | PASS |

## Verification

| Command | Result |
| --- | --- |
| `pnpm verify` | PASS: typecheck, ESLint, 57 Vitest files / 485 tests, production build, production dependency audit, 30 Rust tests, and Clippy with warnings denied |
| `pnpm test:coverage` | PASS: 92.28% statements/lines, 88.71% branches, 94.07% functions; 57 files / 485 tests |
| `git diff --check` | PASS |

## Known gaps

- Token counts remain conservative `chars / 4` estimates when a provider does not report usage.
- Only the mock narrator and the configured Qwen preset have trusted local context metadata. Arbitrary OpenRouter/local models intentionally use the 16k fallback.
- The app caps automatic context consumption at 32k even when a model advertises more; a user-configurable override can be added later with provider-specific validation.
- Group-scene support and semantic retrieval remain separate product phases. Neither should add generation calls to the per-turn two-call contract.
