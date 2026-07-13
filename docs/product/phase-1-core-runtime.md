# Phase 1 Core Runtime Capability

Status: implementation contract  
Owner: local runtime  
Evidence targets: `evals/phase1/baseline.json` and `evals/phase1/manifest.json`

## Capability

A player can run a local-first RPG turn with an explicit continuity policy, inspect every provider call and its measured usage, and trust that durable state changes are policy-validated, represented in a typed branch-scoped event stream, and verified against turn lineage. Maintainers can replay a redacted 30–50-turn corpus and measure state-mutation precision, knowledge safety, lore retrieval, branch/regeneration continuity, latency, tokens, cost, failures, and state proposals.

## Fixed constraints

- Hidden continuity is configurable as `off`, `economical`, or `full`.
  - `off` performs one visible model call.
  - `economical` performs a hidden call with the configured economical model and a visible call with the selected model.
  - `full` performs both calls with the selected model.
- Retrieval and summary maintenance add no provider calls. A normal turn therefore makes exactly one or two generation calls according to the selected hidden-continuity mode.
- The default mode remains `full` so existing two-call behavior is preserved.
- Every attempted call is recorded by phase with provider, model, phase duration, token usage, usage source, price snapshot or explicit unknown-price status, calculated cost provenance, terminal status, failure category, and state-proposal count.
- Costs derived from estimated token usage are labeled estimated. Calls without usable token evidence are always cost-unknown, even when a price snapshot exists.
- The one user-configured price snapshot belongs to the selected visible model. An economical hidden model with a different identifier remains honestly cost-unknown until a separate exact-model price snapshot is supported; the runtime never reuses the visible model's rate.
- Context budgets are derived from metadata for the exact selected provider and model. Unknown models use an explicit conservative fallback and expose that source in telemetry.
- Runtime rules and knowledge/safety boundaries are required prompt layers. Optional history, lore, memory, retrieval, and summaries are trimmed before a required layer; compilation fails closed if required layers cannot fit.
- Durable game-state changes are represented by validated typed authoritative events and verified against the variant-aware turn lineage. Model-extracted changes remain proposals until policy validation commits them.
- Dice outcomes, deterministic rule decisions, tool results, player actions, and committed state mutations use the same event stream.
- Events, summaries, and retrieved documents are scoped to card, chat, branch, turn, and response variant where applicable. Retrieval is fail-closed across card/chat/branch and visibility boundaries.
- Semantic retrieval is local and deterministic in Phase 1. It uses a small concept lexicon plus feature hashing; it does not claim neural embedding quality and does not contact a provider.
- The recorded eval corpus contains synthetic or explicitly redacted content only. Provider secrets, authorization headers, and raw private prompts are forbidden.

## Implementation contract

### Runtime settings

`RuntimeSettings` owns the hidden-continuity mode and optional economical model identifier. Persisted legacy settings migrate to `full`. Invalid imported values are rejected or normalized to safe defaults.

### Call ledger

Each `PromptRun` stores an ordered call ledger. The visible call remains the compatibility source for the legacy top-level usage field; aggregate usage and cost are derived from the per-call ledger. Failed or aborted hidden calls remain visible as failed attempts even when the visible response continues. `durationMs` is total phase duration, including local parsing and policy work, rather than provider network latency.

### Authoritative event lifecycle

1. A user action creates a `player_action` event.
2. Deterministic validation creates a `rule_decision` event, including matched rule IDs and allow/block result.
3. Dice and tools create `dice_rolled` and `tool_result` events with typed payloads.
4. Hidden and visible model outputs create untrusted state proposals.
5. Policy validation creates `state_committed` events only for accepted changes.
6. Replay projects authoritative state from ordered events for the active branch and variant.

Persisted events are immutable. A branch copies only its valid causal prefix; editing or rebasing a branch drops stale derived events from that new branch while preserving the parent history.

### Continuity memory and retrieval

Rolling summaries are branch-scoped, record their covered message boundary, and are regenerated deterministically when an upstream message is edited. Hybrid retrieval fuses lexical relevance with local vector similarity, then applies scope and visibility filters before ranking. Retrieved IDs and score components are inspectable.

### Evaluation

The Phase 1 corpus contains 36 credential-free offline recordings spanning the production mock, OpenAI-compatible fetch, and stored-secret Tauri invoke adapter paths. It includes grounded and blocked mutations, deliberate knowledge-leak traps, lore hits and false positives, hidden and visible failures, unknown pricing, branches, response variants, regeneration, and prompt-injection resistance. It proves runtime/adapter integration, not live-provider model quality or network performance.

The deterministic scorecard reports:

- mutation precision and recall from expected versus accepted proposal IDs;
- true output-leak and detector-positive rates plus detector precision and recall;
- lore-hit precision and recall;
- branch/regeneration continuity pass rate;
- hidden and visible call counts, latency percentiles, tokens, known cost, unknown-cost calls, failures, and proposal counts;
- corpus/schema/redaction validity.

The scorer exits non-zero when corpus validity fails or release thresholds regress.

## Security and policy boundaries

- Imported corpus and runtime data are schema-validated, size-bounded, and prototype-safe.
- Provider keys remain in the existing session/keychain flow and never enter event, telemetry, prompt-debug, or eval artifacts.
- Price data is an immutable snapshot attached to a call or marked unknown; the runtime never invents a zero cost for an unpriced model.
- Tool results are treated as untrusted input until their tool schema validates them.
- Narrator-only knowledge is never eligible for player/character-visible retrieval.

## Non-goals

- Hosted eval execution or paid live-provider calls in the default test lane.
- A bundled neural embedding model or model-manager UI.
- Phase 2 packaging, signing, notarization, updater, rollback, or SBOM work.
- Phase 3 templates, sample game, library UX, or naming work.
- Replacing SQLite as the desktop continuity authority.

## Resolved decisions

- Representative provider coverage invokes the three production adapter paths with deterministic credential-free transports. Live-provider recording remains a separate, explicit, redacted workflow.
- `full` is the migration/default mode; `off` honestly changes the turn from two calls to one.
- Unknown provider pricing is reported as unknown, never guessed.
- Rolling summaries and semantic features are local deterministic operations, preserving the model-call invariant.

## Handoff

This contract is ready for test-driven implementation. The release evidence is complete only when unit/integration tests, the 30–50-turn scorecard, coverage, lint, typecheck, dependency audit, Rust checks, and the repo verification command pass from the same worktree.
