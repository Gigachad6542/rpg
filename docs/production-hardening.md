# Production Hardening Notes

## Persistence Authority

SQLite is the desktop continuity authority. Browser mode can still use the full `localStorage`
compatibility snapshot, but the desktop runtime should not write the full cards/messages/prompt
runs snapshot to `localStorage`.

When the runtime chat exists, normalized SQLite tables are the durable read authority for messages,
chat-session message membership, prompt runs, lorebooks, memory, RPG state, and generated map
artifacts. The embedded compatibility snapshot is still saved for imports, older database recovery,
and legacy browser/dev mode, but it must not override normalized rows on desktop reload.

If the runtime chat does not exist, the loader may still use the compatibility snapshot as a legacy
fallback. This keeps older saved data readable while making newly saved desktop data table-first.

## Startup Recovery

Repository data should beat a newer blank browser fallback. This prevents an interrupted desktop
startup or temporary SQLite failure from making a freshly stamped default card mask older real
SQLite continuity.

## Tauri Authority

The desktop persistence layer now goes through typed Rust commands instead of renderer SQL
permissions. Provider-secret commands are narrowed in Rust with provider allowlists, `apiKey`-only
secret names, endpoint matching, prompt and output caps, and a process-local rate limit.

Development-only `databasePath` overrides are confined to a temp runtime workspace and reject
absolute paths or parent traversal. Production builds do not accept the override.

The Tauri CSP intentionally allows loopback HTTP/WebSocket connections for local Vite development
and local image/model providers such as ComfyUI. Hosted provider calls still go through Rust command
validation and provider endpoint allowlists rather than broad renderer fetch privileges.

## Prompt Assembly

The prompt debugger now uses the same `compileTurnPrompt` path as real turn execution. Keep future
debugger changes wired through the turn pipeline request builder so previewed layers, token estimates,
state context, runtime settings, and response contracts do not drift from what the model receives.

## Migration Safety

Each migration now runs inside a transaction. A failed migration should roll back its statements and
must not write a `schema_migrations` success row.

SQLite foreign key enforcement and a 5 second busy timeout are enabled on repository connections.
Core runtime tables now define relation constraints, boolean/role checks, and lookup indexes for the
chat/history, prompt-run, lorebook, memory, RPG-state, and generated-map paths.

Before adding destructive or data-shaping migrations, create a local backup of the SQLite database
from the app data directory and document the forward recovery migration. Production rollbacks should
be forward fixes, not edits to already-applied migration definitions.

On Windows, copy the database while the app is closed. Use the app data directory for installed
builds, or the confined temp dev directory for `databasePath` test databases. Restore by closing the
app, replacing the database with the backup copy, and reopening the app on the same or newer schema.

## Verification

Run the local CI equivalent before releases:

```bash
pnpm verify
```

Run the release-candidate gate before packaging or sharing a build:

```bash
pnpm verify:release
```

This gate includes the Playwright browser smoke test. The smoke opens the seeded RPG card, sends a
mock turn, confirms prompt-debug privacy in the persisted snapshot, reloads, reopens the card, and
confirms the saved transcript is still visible.

For coverage reporting, run:

```bash
pnpm test:coverage
```

The current scoped V8 report is 73.65% statements overall. The largest remaining coverage drag is
type-heavy domain/adapter contract files, not the runtime pipeline. Add thresholds only after
deciding which contract-only modules should count toward executable coverage.

CI installs and runs `cargo-audit` against `src-tauri` so Rust dependency advisories are checked
before merge. Local release verification uses the same tool; current audit output contains allowed
warnings from transitive desktop/GTK-era crates, but no blocking vulnerability failure.
