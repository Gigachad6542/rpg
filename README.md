# Local-First RPG

A desktop-first Tauri + React + TypeScript foundation for a local-first AI character and RPG runtime.

The app treats SQLite as the continuity authority. Model providers generate prose and extraction proposals, while local runtime code owns characters, branches, prompt runs, memory, lore, knowledge boundaries, and RPG state.

The UI ships with the complete `Ashfall Crossing` local sample, a blank RPG,
and three guided creation templates. A one-click mock demo is network-free and
makes no model call. Users can still create assumption-free cards with
card-local system/pre-history instructions, post-history instructions, player
rules, lorebook entries, and optional RPG state.

The main workspace has dedicated tabs for runtime play, card creation, stored lorebooks, API keys, and settings. Character cards support name, description, scenario, greeting, example dialogs, and an in-depth definition/system prompt.

## Development

This repo pins its package manager with the `packageManager` field. Enable
[Corepack](https://nodejs.org/api/corepack.html) once (it ships with Node) so the
exact pinned pnpm is provisioned automatically — no manual global pnpm install:

```bash
corepack enable
pnpm install --frozen-lockfile
pnpm verify
pnpm desktop:open
```

Requires Node 22 (`>=22 <25`); Corepack resolves pnpm to the pinned `11.7.0`.
`engine-strict` (`.npmrc`) fails fast on an unsupported Node or pnpm.

Useful commands:

| Command | Purpose |
|---|---|
| `pnpm dev` | Run the Vite web shell. |
| `pnpm desktop:open` | Run the Tauri desktop app in development. |
| `pnpm typecheck` | Type-check TypeScript without emitting files. |
| `pnpm test` | Run the Vitest suite. |
| `pnpm test:coverage` | Run Vitest with V8 coverage. |
| `pnpm e2e` | Run the Playwright functional, automated WCAG A/AA, 320 CSS-pixel reflow, and forced-colors acceptance suite. |
| `pnpm e2e:install` | Install the Playwright Chromium browser used by the acceptance suite. |
| `pnpm build` | Build the frontend bundle. |
| `pnpm verify` | Run the local CI gate: typecheck, lint, tests, Phase 1 runtime eval, build, dependency audit, Rust tests, and clippy. |
| `pnpm verify:release` | Run the Windows release gate: local checks, coverage, browser smoke, audits, Rust checks, desktop packaging, executable and MSI-payload smokes, plus a fail-closed normal NSIS install/reinstall/uninstall lifecycle. |
| `pnpm verify:desktop` | Run `pnpm verify`, then build the desktop bundle. |
| `pnpm desktop:smoke` | Start the release executable and fail if it exits during startup. |
| `pnpm desktop:installed-smoke` | Administratively extract the Windows MSI payload, launch twice with isolated app data, and confirm SQLite startup durability. This is not a real install/uninstall test. |
| `pnpm desktop:installer-lifecycle` | Refuse any pre-existing install, normally install the one current NSIS bundle, launch with isolated SQLite data, reinstall, relaunch, uninstall, and verify registry/filesystem cleanup. |
| `pnpm clean` | Remove generated output: `dist`, `coverage`, `playwright-report`, `test-results`, and `src-tauri/target`. |

## Desktop App

```bash
pnpm desktop:open
pnpm desktop:build
```

`desktop:open` launches the Tauri app in development. `desktop:build` creates the openable desktop bundle under `src-tauri/target/release`.

## Providers

The OpenAI-compatible BYOK path currently presents `qwen3.7-max` as its
recommended model metadata. That recommendation has deterministic contract
coverage but no completed live-provider quality run; treat it as a configurable
default, not a measured quality winner.

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

Start with `docs/README.md` for hardening, release packaging, runtime contracts,
and the current 2026-07-14 production-readiness evidence.
