# Local-First AI RPG Runtime

A desktop-first Tauri + React + TypeScript foundation for a local-first AI character and RPG runtime.

The app treats SQLite as the continuity authority. Model providers generate prose and extraction proposals, while local runtime code owns characters, branches, prompt runs, memory, lore, knowledge boundaries, and RPG state.

The UI now starts with one blank RPG card only. Users can define card-local system/pre-history instructions, post-history instructions, player rules, lorebook entries, and optional RPG state without inheriting bundled world or character assumptions.

The main workspace has dedicated tabs for runtime play, card creation, stored lorebooks, API keys, and settings. Character cards support name, description, scenario, greeting, example dialogs, and an in-depth definition/system prompt.

## Development

```bash
pnpm install
pnpm verify
pnpm desktop:open
```

Useful commands:

| Command | Purpose |
|---|---|
| `pnpm dev` | Run the Vite web shell. |
| `pnpm desktop:open` | Run the Tauri desktop app in development. |
| `pnpm typecheck` | Type-check TypeScript without emitting files. |
| `pnpm test` | Run the Vitest suite. |
| `pnpm test:coverage` | Run Vitest with V8 coverage. |
| `pnpm build` | Build the frontend bundle. |
| `pnpm verify` | Run the local CI gate: typecheck, tests, build, npm audit, Rust tests, and clippy. |
| `pnpm verify:desktop` | Run `pnpm verify`, then build the desktop bundle. |
| `pnpm clean` | Remove generated output: `dist`, `coverage`, `src-tauri/target`, and local run logs. |

## Desktop App

```bash
pnpm desktop:open
pnpm desktop:build
```

`desktop:open` launches the Tauri app in development. `desktop:build` creates the openable desktop bundle under `src-tauri/target/release`.

## Providers

Use Qwen3.7-Max through the OpenAI-compatible BYOK provider path. The recommended model id is `qwen3.7-max`.

API keys are bring-your-own-key:

- Browser/dev mode keeps a typed key in React state for the current session only.
- Desktop mode stores keys in the OS keychain and saves only a secret reference in app data.
- Stored desktop keys are not read back into React; generation uses the local Tauri command `generate_text_with_stored_secret`.

For maps, use the Image Provider panel with a local ComfyUI server, usually `http://127.0.0.1:8188`. Paste a ComfyUI workflow exported in API format and use placeholders such as `{{prompt}}`, `{{negative_prompt}}`, `{{width}}`, `{{height}}`, `{{seed}}`, and `{{model}}`.

Use the provider test button after entering a key locally in the app. Do not paste real API keys into source files, tests, shell commands, or chat logs.

Stored-key desktop calls are constrained by the local Tauri backend: provider IDs and endpoints are allowlisted, only `apiKey` secret names are accepted, prompt/model/output sizes are capped, and provider requests are rate-limited before the OS keychain value is read.

## Lorebooks And Settings

The Lorebooks tab shows every stored card lorebook, searches across card names, entry names, keys, and content, exports Chub-compatible JSON, and imports pasted Chub-compatible JSON into the active card.

The Settings tab stores runtime preferences:

- text streaming preference for adapters that support streaming
- emoji ban prompt layer
- user impersonation/persona prompt layer

## Local Storage Layout

The app keeps a compatibility snapshot for quick reloads, and also writes organized local tables:

- `model_provider_configs` for provider metadata and secret references only.
- `characters` for the card library snapshot.
- `messages`, `message_branches`, and `prompt_runs` for runtime history.
- `memory_entries` for card-scoped memory.
- `lorebooks` and `lorebook_entries` for Chub-compatible lorebook data.
- `rpg_state_snapshots` for card-scoped RPG state.
- `image_prompt_runs` for generated map prompts and result URIs.

In browser/dev mode the compatibility snapshot is saved to `localStorage`. In the desktop runtime, normalized SQLite tables are the durable continuity source and the full browser fallback is not written. See `docs/production-hardening.md` for startup recovery, migration, typed Tauri persistence, and release verification.

## Project Docs

Start with `docs/README.md` for the hardening notes and TDD evidence reports.
