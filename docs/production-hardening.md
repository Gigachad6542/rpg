# Production Hardening Notes

## Persistence Authority

SQLite is the desktop continuity authority. Browser mode can still use the full `localStorage`
compatibility snapshot, but the desktop runtime should not write the full cards/messages/prompt
runs snapshot to `localStorage`.

The current repository store still keeps a compatibility snapshot in SQLite while also mirroring
selected data into normalized tables. The next persistence hardening step is to choose one durable
read source for messages, prompt runs, lorebooks, memory, and RPG state, then treat the snapshot as
a migration/import fallback only.

## Startup Recovery

Repository data should beat a newer blank browser fallback. This prevents an interrupted desktop
startup or temporary SQLite failure from making a freshly stamped default card mask older real
SQLite continuity.

## Tauri Authority

The desktop persistence layer now goes through typed Rust commands instead of renderer SQL
permissions. Provider-secret commands are narrowed in Rust with provider allowlists, `apiKey`-only
secret names, endpoint matching, prompt and output caps, and a process-local rate limit.

The remaining persistence hardening item is to choose one durable read source for messages, prompt
runs, lorebooks, memory, and RPG state. Keep the compatibility snapshot as migration/import fallback
once the normalized tables become the authority.

## Prompt Assembly

The prompt debugger now uses the same `compileTurnPrompt` path as real turn execution. Keep future
debugger changes wired through the turn pipeline request builder so previewed layers, token estimates,
state context, runtime settings, and response contracts do not drift from what the model receives.

## Migration Safety

Each migration now runs inside a transaction. A failed migration should roll back its statements and
must not write a `schema_migrations` success row.

Before adding destructive or data-shaping migrations, create a local backup of the SQLite database
from the app data directory and document the forward recovery migration. Production rollbacks should
be forward fixes, not edits to already-applied migration definitions.

## Verification

Run the local CI equivalent before releases:

```bash
pnpm verify
```

Also run the packaged desktop build before release candidates:

```bash
pnpm desktop:build
```

For coverage reporting, run:

```bash
pnpm test:coverage
```

The current scoped V8 report is 72.73% statements overall. The largest remaining coverage drag is
type-heavy domain/adapter contract files, not the runtime pipeline. Add thresholds only after
deciding which contract-only modules should count toward executable coverage.

CI installs and runs `cargo-audit` against `src-tauri` so Rust dependency advisories are checked
before merge. Local release verification can use the same tool when it is installed.
