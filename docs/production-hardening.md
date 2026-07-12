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

The installed desktop smoke uses `LOCAL_FIRST_AI_RPG_RUNTIME_APP_DATA_DIR` to force a temporary app
data directory because Windows/Tauri app-data resolution does not honor `APPDATA` alone. The Rust
boundary accepts this override only for absolute paths under the system temp directory.

The Tauri CSP intentionally allows loopback HTTP connections for local Vite development and local
image/model providers such as ComfyUI. Loopback WebSocket access is not enabled by default; add it
only behind a focused review if a future provider path needs it. Hosted provider calls still go
through Rust command validation and provider endpoint allowlists rather than broad renderer fetch
privileges.

Renderer and Rust persistence boundaries both sanitize image provider settings. Only known
non-secret ComfyUI fields are saved, and `workflowJson` is preserved only when it does not contain
secret-like keys or raw-token-looking values. Runtime exports remain stricter and omit
`workflowJson` entirely.

## Prompt Assembly

The prompt debugger now uses the same `compileTurnPrompt` path as real turn execution. Keep future
debugger changes wired through the turn pipeline request builder so previewed layers, token estimates,
state context, runtime settings, and response contracts do not drift from what the model receives.

## Migration Safety

Static migrations run inside transactions. Schema v3 uses an immediate procedural transaction to
rebuild the 11 historically unconstrained tables, because SQLite cannot add foreign keys or CHECKs
in place. A failed migration rolls back and must not write a `schema_migrations` success row.

SQLite foreign key enforcement and a 5 second busy timeout are enabled on repository connections.
Core runtime tables now define relation constraints, boolean/role checks, and lookup indexes for the
chat/history, prompt-run, lorebook, memory, RPG-state, and generated-map paths. Historical v1 and v2
databases receive the same schema through v3, rather than relying on edited v1 DDL.

Before v3 touches a historical database, the repository creates a SQLite-consistent `VACUUM INTO`
backup that includes committed WAL data. Constraint preflight reports only table/field counts and
fails closed on invalid legacy rows; it never deletes or coerces them. Production rollbacks should be
forward fixes, not edits to already-applied migration definitions.

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

This gate includes the Playwright browser smoke test, the Tauri desktop package build, the packaged
executable smoke, and the installed clean-profile smoke. The browser smoke opens the seeded RPG card,
sends a mock turn, confirms prompt-debug privacy in the persisted snapshot, reloads, reopens the
card, and confirms the saved transcript is still visible. The executable smoke starts the release
executable and fails if it exits during startup. The installed smoke stages the generated MSI into a
temporary install root, launches with isolated app-data paths, restarts once, and confirms the runtime
SQLite database is created under that clean profile.

For coverage reporting, run:

```bash
pnpm test:coverage
```

The current scoped V8 report is 99.2% statements overall, 93.01% branches, and 100% functions.
Remaining uncovered lines are mostly defensive UI guards and transitive edge branches rather than
core runtime paths.

CI installs and runs `cargo-audit` against `src-tauri` so Rust dependency advisories are checked
before merge. Local release verification uses the same tool. Current audit output contains allowed
warnings from transitive Tauri/WebKitGTK dependency paths (`tauri`, `tauri-runtime-wry`, `wry`,
`tao`, `muda`, `webkit2gtk`, `gtk`, `glib`, and related GTK3 crates), plus a narrow
`src-tauri/.cargo/audit.toml` exception for `quick-xml` advisories that are pinned by
`plist -> tauri-utils`. The accepted warning class is controlled-beta release debt; remove or narrow
the exceptions as soon as upstream Tauri dependencies publish compatible fixed paths.
