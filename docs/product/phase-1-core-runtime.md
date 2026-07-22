# Phase 1 Core Runtime Capability

Status: implementation contract  
Owner: local runtime  
Evidence targets: `evals/phase1/baseline.json`, `evals/phase1/manifest.json`, and `evals/phase1.1/manifest.json`

## Capability

A player can run a local-first RPG turn with an explicit memory policy, inspect every provider call and its measured usage, and trust that durable state changes are policy-validated, represented in a typed branch-scoped event stream, and verified against turn lineage. Maintainers can replay credential-free runtime coverage and separately evaluate whether a private first-call evidence brief improves a windowed second call.

## Fixed constraints

- Two-model-call memory has one supported behavior: `evidence-brief`.
  - `off` always performs one visible model call.
  - `evidence-brief` also performs one visible call while the active branch has four or fewer prior messages.
  - Once older messages would fall outside that four-message window, `evidence-brief` first asks the same selected model for a private evidence brief, then gives the visible call the recent window plus the validated brief.
- Retrieval and summary maintenance add no provider calls. A normal turn therefore makes one call unless the conditional evidence-brief boundary is crossed.
- The default mode is `evidence-brief`. Persisted legacy `full` and `economical` values migrate to it, and the legacy economical-model field is ignored by the live runtime.
- The first call receives source-tagged card state and the wider active-branch transcript. It must return strict JSON with bounded evidence, knowledge boundaries, uncertainties, constraints, and a response plan.
- The brief is an untrusted, fallible aid. It is never player-visible, never persisted into memory, transcript, or state, cannot authorize a state change, and produces zero state proposals.
- Invalid JSON, schema failure, an unknown source citation, empty output, truncation, provider failure, or source context that cannot fit the selected model's input budget causes a fail-open return to the normal full-context visible request without a brief.
- Every attempted call is recorded by phase with provider, model, phase duration, token usage, usage source, price snapshot or explicit unknown-price status, calculated cost provenance, terminal status, failure category, and state-proposal count.
- Qwen3.7-Max visible calls explicitly request returned reasoning. Their total
  output envelope is 4,000 tokens because provider-reported reasoning consumes
  output budget alongside visible prose. The strict evidence extractor keeps
  reasoning disabled and its separately tested 1,000-token output cap.
- Persisted call telemetry records safe reasoning proof, not raw reasoning. A
  returned plaintext/summary trace can be opened behind a private/spoiler
  disclosure during the current session only; encrypted, token-only, and
  unavailable provider responses remain distinguishable.
- Costs derived from estimated token usage are labeled estimated. Calls without usable token evidence are cost-unknown even when a price snapshot exists.
- Price snapshots are resolved by exact model id. Both evidence and visible phases use the selected model's immutable snapshot; a missing exact-model snapshot remains cost-unknown.
- Context budgets are derived from metadata for the exact selected provider and model. Unknown models use an explicit conservative fallback and expose that source in telemetry.
- Runtime rules and knowledge/safety boundaries are required prompt layers. Optional history, lore, memory, retrieval, and summaries are trimmed before a required layer; compilation fails closed if required layers cannot fit.
- Durable game-state changes are validated typed authoritative events verified against variant-aware turn lineage. Model-extracted changes remain proposals until policy validation commits them.
- Events, summaries, and retrieved documents are scoped to card, chat, branch, turn, and response variant where applicable. Retrieval fails closed across card, chat, branch, and visibility boundaries.
- Semantic retrieval is local and deterministic in Phase 1. It uses a small concept lexicon plus feature hashing, makes no neural-quality claim, and does not contact a provider.
- Eval corpora contain synthetic or explicitly redacted content only. Provider secrets, authorization headers, and raw private prompts are forbidden.

## Implementation contract

### Runtime settings

`RuntimeSettings` owns the two-model-call memory mode. The active values are `off` and `evidence-brief`. Persisted `full` and `economical` values are accepted only for migration and normalize to `evidence-brief`; the old economical model identifier remains parseable for compatibility but has no routing effect.

### Call ledger

Each `PromptRun` stores an ordered call ledger. The visible call remains the compatibility source for the legacy top-level usage field; aggregate usage and cost are derived from the per-call ledger. Failed memory-evidence calls remain visible as failed attempts even when the full-context visible fallback continues. `durationMs` is total phase duration, including local parsing and validation, rather than provider network latency.

### Authoritative event lifecycle

1. A user action creates a `player_action` event.
2. Deterministic validation creates a `rule_decision` event, including matched rule IDs and allow/block result.
3. Dice and tools create `dice_rolled` and `tool_result` events with typed payloads.
4. Only the visible model output can create untrusted state proposals; memory-evidence analysis creates none.
5. Policy validation creates `state_committed` events only for accepted changes.
6. Replay projects authoritative state from ordered events for the active branch and variant.

Persisted events are immutable. A branch copies only its valid causal prefix; editing or rebasing a branch drops stale derived events from that new branch while preserving the parent history.

### Continuity memory and retrieval

Rolling summaries are branch-scoped, record their covered message boundary, and are regenerated deterministically when an upstream message is edited. Hybrid retrieval fuses lexical relevance with local vector similarity, then applies scope and visibility filters before ranking. Retrieved IDs and score components are inspectable.

### Evaluation

The legacy Phase 1 corpus contains 36 credential-free offline recordings spanning the production mock, OpenAI-compatible fetch, and stored-secret Tauri invoke adapter paths. It remains state-policy and adapter regression coverage, not evidence for the current second-call tactic or live-provider quality.

The Phase 1.1 paired evaluation separately tested the current tactic with `qwen/qwen3.7-max`. The accepted windowed evidence-brief arm scored 18/18 strict checks versus 12/18 for the single-call recent-window control, with six rescues and zero harms. The full-context evidence-brief arm scored the same 16/18 as its single-call full-context control, so the runtime does not spend a second call for that case. These are scoped memory-check results; blind prose-quality review remains open.

The deterministic scorecards report corpus validity, state-policy regressions, separately graded evidence briefs and final replies, call counts, latency, tokens, cost provenance, failures, and paired causal deltas. A scorer exits non-zero when corpus validity fails or release thresholds regress.

## Security and policy boundaries

- Imported corpus and runtime data are schema-validated, size-bounded, and prototype-safe.
- Provider keys remain in the existing session/keychain flow and never enter event, telemetry, prompt-debug, or eval artifacts.
- Raw reasoning traces are bounded, never persisted, never exported, and never
  transmitted from the visible response into the optional first/second-call
  memory exchange. A trace is debugging evidence, not authoritative game state.
- Price data is an immutable snapshot attached to a call or marked unknown; the runtime never invents a zero cost for an unpriced model.
- Tool results are treated as untrusted input until their tool schema validates them.
- Narrator-only knowledge is never eligible for player- or character-visible retrieval.

## Non-goals

- Hosted eval execution or paid live-provider calls in the default test lane.
- A bundled neural embedding model or model-manager UI.
- Replacing SQLite as the desktop continuity authority.
- Claiming universal prose-quality or cross-model gains from the scoped Phase 1.1 result.

## Resolved decisions

- `evidence-brief` is the migration/default mode, but it remains a one-call turn until older context would fall outside the four-message visible window. `off` always makes one call.
- Both calls use the selected model because that is the tested configuration; there is no economical-model route.
- Unknown provider pricing is reported as unknown, never guessed. The Phase 1.1 eval uses exact dated snapshots without changing that rule.
- Rolling summaries and semantic features are local deterministic operations, preserving the model-call invariant.

## Handoff

Release evidence is complete only when unit/integration tests, deterministic eval gates, lint, typecheck, dependency audit, Rust checks, and the repository verification command pass from the same worktree.
