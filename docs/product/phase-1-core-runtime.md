# Phase 1 Core Runtime Capability

Status: implementation contract  
Owner: local runtime  
Evidence target: `evals/phase1/scorecard.json`

## Capability

A player can run a local-first RPG turn with an explicit continuity policy, inspect every provider call and its measured usage, and trust that durable state changes come only from a typed, branch-scoped authoritative event stream. Maintainers can replay a redacted 30–50-turn corpus and measure state-mutation precision, knowledge safety, lore retrieval, branch/regeneration continuity, latency, tokens, cost, failures, and state proposals.

## Fixed constraints

- Hidden continuity is configurable as `off`, `economical`, or `full`.
  - `off` performs one visible model call.
  - `economical` performs a hidden call with the configured economical model and a visible call with the selected model.
  - `full` performs both calls with the selected model.
- Retrieval and summary maintenance add no provider calls. A normal turn therefore makes exactly one or two generation calls according to the selected hidden-continuity mode.
- The default mode remains `full` so existing two-call behavior is preserved.
- Every attempted call is recorded by phase with provider, model, latency, token usage, usage source, price snapshot or explicit unknown-price status, calculated cost when known, terminal status, failure category, and state-proposal count.
- Context budgets are derived from metadata for the exact selected provider and model. Unknown models use an explicit conservative fallback and expose that source in telemetry.
- Runtime rules and knowledge/safety boundaries are required prompt layers. Optional history, lore, memory, retrieval, and summaries are trimmed before a required layer; compilation fails closed if required layers cannot fit.
- Durable game state is changed only by validated typed authoritative events. Model-extracted changes are proposals until policy validation commits them.
- Dice outcomes, deterministic rule decisions, tool results, player actions, and committed state mutations use the same event stream.
- Events, summaries, and retrieved documents are scoped to card, chat, branch, turn, and response variant where applicable. Retrieval is fail-closed across card/chat/branch and visibility boundaries.
- Semantic retrieval is local and deterministic in Phase 1. It uses an injectable encoder with a built-in feature-hash implementation; it does not claim neural embedding quality and does not contact a provider.
- The recorded eval corpus contains synthetic or explicitly redacted content only. Provider secrets, authorization headers, and raw private prompts are forbidden.

## Implementation contract

### Runtime settings

`RuntimeSettings` owns the hidden-continuity mode and optional economical model identifier. Persisted legacy settings migrate to `full`. Invalid imported values are rejected or normalized to safe defaults.

### Call ledger

Each `PromptRun` stores an ordered call ledger. The visible call remains the compatibility source for the legacy top-level usage field; aggregate usage and cost are derived from the per-call ledger. Failed hidden calls remain visible as failed attempts even when the visible response continues.

### Authoritative event lifecycle

1. A user action creates a `player_action` event.
2. Deterministic validation creates a `rule_decision` event, including matched rule IDs and allow/block result.
3. Dice and tools create `dice_rolled` and `tool_result` events with typed payloads.
4. Hidden and visible model outputs create untrusted state proposals.
5. Policy validation creates `state_commit` events only for accepted changes.
6. Replay projects authoritative state from ordered events for the active branch and variant.

Events are immutable. Corrections append superseding or reversal events; they do not rewrite history.

### Continuity memory and retrieval

Rolling summaries are branch-scoped, record their covered message boundary, and are regenerated deterministically when an upstream message is edited. Hybrid retrieval fuses lexical relevance with local vector similarity, then applies scope and visibility filters before ranking. Retrieved IDs and score components are inspectable.

### Evaluation

The Phase 1 corpus contains 36–48 recorded turns spanning mock, OpenAI-compatible, and stored-secret adapter profiles. It includes normal turns, blocked mutations, deliberate knowledge-leak traps, lore-trigger cases, hidden-call failures, unknown pricing, branches, response variants, and regeneration.

The deterministic scorecard reports:

- mutation precision and recall from expected versus accepted proposal IDs;
- knowledge-leak count and leak-free rate;
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

- Representative provider coverage is adapter-shape coverage in committed recordings; optional live recording is a separate, explicit, redacted workflow.
- `full` is the migration/default mode; `off` honestly changes the turn from two calls to one.
- Unknown provider pricing is reported as unknown, never guessed.
- Rolling summaries and semantic features are local deterministic operations, preserving the model-call invariant.

## Handoff

This contract is ready for test-driven implementation. The release evidence is complete only when unit/integration tests, the 30–50-turn scorecard, coverage, lint, typecheck, dependency audit, Rust checks, and the repo verification command pass from the same worktree.
