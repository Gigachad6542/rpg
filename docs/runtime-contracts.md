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

## Provider Boundary

Provider calls must preserve the BYOK boundary:

- Browser/dev keys stay session-only in React state.
- Desktop keys are stored through OS secure storage and used by Rust commands.
- React receives secret references, never raw stored secrets.
- Hosted provider endpoints remain allowlisted.
- Prompt/model/output sizes stay capped at the system boundary.
- Provider status and diagnostics text are redacted before export or support sharing.

## Versioning Rule

Add or loosen optional fields without changing the export schema version. Bump the export or diagnostics schema version when a supported reader could misinterpret required fields, security meaning, or recovery behavior.
