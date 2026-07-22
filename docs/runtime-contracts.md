# Runtime Contracts

These contracts protect saved player data and provider safety while the RPG runtime keeps changing.

## Runtime Export Bundle

Runtime exports use this envelope:

```json
{
  "schema": "rpg.runtime.export",
  "version": 1,
  "exportedAt": "2026-07-01T00:00:00.000Z",
  "app": {
    "name": "rpg",
    "exportFormat": "runtime-bundle"
  },
  "snapshot": {}
}
```

The embedded snapshot currently uses local snapshot `version: 2`. Import accepts only the supported export schema/version and a valid snapshot shape.

Export sanitization must keep these guarantees:

- Raw provider API keys are never included.
- Provider settings contain secret references only after validation.
- Runtime exports never include compiled prompts. Local persistence may retain compiled prompts only
  when prompt debug logs are enabled.
- Image provider settings persist only allowlisted non-secret fields. `workflowJson` may be kept in
  local persistence for ComfyUI recovery, but it is dropped if it contains secret-like keys or raw
  token-looking values, and it is omitted from runtime exports.
- Generated map artifacts keep user-visible metadata and result URIs, but do not add provider secrets.
- Unknown future snapshot fields should not be required for import unless the export schema version changes.

## Diagnostics Bundle

Diagnostics use this envelope:

```json
{
  "schema": "rpg.runtime.diagnostics",
  "version": 1,
  "exportedAt": "2026-07-01T00:00:00.000Z",
  "app": {
    "name": "rpg"
  }
}
```

Diagnostics are for support triage, not gameplay recovery. They may include counts, backend/status labels, provider mode/model identifiers, and runtime setting booleans. They must not include chat message bodies, compiled prompts, user prompt text, raw secrets, raw secret references, or full card definitions.

## Local Snapshot

The browser compatibility snapshot key is `local-cards-runtime:v2`; the snapshot payload version is `2`.

The snapshot exists for browser/dev reloads, imports, and legacy recovery. Desktop continuity should prefer normalized SQLite tables when available. The seeded blank RPG card intentionally returns to the idle "open a saved card" startup state and can be reopened from the card library.

## SQLite Repository

SQLite normalized tables are the durable desktop source for cards, chats, messages, prompt runs, lorebooks, memory, RPG state, and generated map artifacts.

Schema migrations are forward-only. Already-applied migration definitions should not be edited; add a new migration or code-level forward fix. Any migration that drops, rewrites, or denormalizes data needs backup/restore notes in the release notes.

## Desktop Single-Writer Policy

Desktop persistence is single-window by contract:

- `tauri.conf.json` declares exactly one application window labeled `main`.
- The default capability grants repository and secret commands only to `main`.
- Renderer and Rust source must not create additional WebView windows.
- The renderer snapshot save queue serializes/coalesces writes from that one
  window before they cross the Tauri command boundary.

Adding another writable window requires a new concurrency design (for example,
snapshot revisions with compare-and-swap) and migration/recovery tests. Merely
granting the existing persistence capability to another label is prohibited.

## Provider Boundary

Provider calls must preserve the BYOK boundary:

- Browser/dev keys stay session-only in React state.
- Desktop keys are stored through OS secure storage and used by Rust commands.
- React receives secret references, never raw stored secrets.
- Hosted provider endpoints remain allowlisted.
- Prompt/model/output sizes stay capped at the system boundary.
- Provider status and diagnostics text are redacted before export or support sharing.
- Session-key and local OpenAI-compatible adapters can stream. Desktop hosted
  keys held in the OS keychain intentionally use a non-streaming Rust command;
  the UI states that replies appear when the request completes, and the turn
  pipeline falls back to `generateText` even when the global streaming
  preference is enabled.
- The visible Qwen3.7-Max request explicitly enables reasoning and requests an
  observable trace. Browser, streaming, and stored-secret desktop paths keep
  reasoning separate from player-visible text. Other model ids retain their
  provider defaults unless explicit capability metadata is added.
- Raw reasoning is private session-only diagnostic data held in a bounded
  recent-trace cache. Prompt runs persist
  only whether reasoning was requested or observed, whether a trace existed or
  was encrypted, and a bounded provider-reported reasoning-token count. Raw
  traces must never enter snapshots, exports, memory, state, or a later prompt.

## Phase 1 Turn Runtime

- Two-model-call memory has one active use case: `evidence-brief`. It makes a private analysis call only when the active branch contains more than four prior messages; `off` and shorter branches make one visible call.
- The analysis call sees the wider active-branch context and returns a strict, source-cited evidence brief. The visible call uses the same selected model, the four most recent prior messages, and that validated brief. The brief is fallible, is never shown to the player, and is never persisted as memory or state.
- Invalid JSON, schema violations, unknown source citations, empty output, provider errors, truncation, and over-budget source context make the brief unusable. The visible call then falls back to the normal full-context path without the brief.
- Every attempted phase retains its model, phase duration, usage source, tokens, context budget, cost provenance, failure, and state-proposal count. Memory-evidence analysis always has zero state proposals. Missing usage or exact-model pricing remains unknown rather than becoming zero.
- Memory-evidence analysis explicitly disables reasoning to preserve the tested
  bounded JSON-extraction behavior. The visible Qwen3.7-Max call explicitly
  enables reasoning and reserves a 4,000-token total output envelope for both
  reasoning and prose. Provider-reported reasoning tokens count as output tokens.
- Context budgets resolve against metadata for the exact routed model. Unknown models use the conservative fallback.
- Runtime rules and knowledge/safety boundaries are required prompt layers and fail closed when they cannot fit.
- Player actions, deterministic rule decisions, dice, tool results, and accepted state mutations use the typed branch-scoped event stream. Replay verifies the RPG projection against the turn lineage before using it.
- Rolling summaries and scoped lexical/feature-hash retrieval are local operations and make no provider call. Retrieval applies card/chat/branch provenance, visibility, score, source-count, and character budgets before prompt assembly.
- The deterministic 36-turn Phase 1 corpus remains part of `pnpm verify` as historical state-policy coverage; it is not evidence for the current second-call tactic. The scoped Phase 1.1 evaluation and production integration tests cover evidence-brief behavior.

## Versioning Rule

Add or loosen optional fields without changing the export schema version. Bump the export or diagnostics schema version when a supported reader could misinterpret required fields, security meaning, or recovery behavior.
