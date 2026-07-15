# Phase 3: Competitive Conversion

Status: implemented; packaged local-provider discovery repaired and verified
through the real Tauri bridge (2026-07-14)

## Outcome

A new user can launch a playable local demo in one click, understand what is
ready, import common character-card and lorebook exports without exposing a
general-purpose network fetcher, and manage a growing local library and long
chat history without losing control of navigation.

The canonical user-facing product name is **Local-First RPG**. Internal package
and database identifiers remain stable where renaming them would break upgrades.

## Acceptance contract

### First useful session

- Ship one complete sample RPG with an opening scene, rules, initial state, and
  active lore.
- Ship three creation templates that populate the existing hidden creation
  form; applying a template never creates a card until the user confirms.
- Show a readiness checklist for content, active card, and text provider.
- A single `Start mock demo` action selects the sample, activates the mock text
  provider, creates or selects its local chat, and opens play. It performs no
  network request and no model call.

### Local inference discovery

- Probe only fixed loopback candidates for Ollama (`11434`), LM Studio (`1234`),
  llama.cpp server (`8080`), and KoboldCpp (`5001`).
- Read only their OpenAI-compatible `/v1/models` response, with a short timeout,
  bounded response size, bounded model count, and bounded model identifiers.
- Never scan ports, accept a discovery URL from imported content, download a
  model, start a process, or mutate a local server.
- Model downloading/management is deferred. It requires a separate signed-model,
  checksum, disk-budget, and process-sandbox contract before implementation.

### Imports and trust boundaries

- Character cards: Tavern V1/V2/V3 PNG and JSON, including compatible exports
  from SillyTavern and RisuAI; direct Chub character URLs use the existing fixed
  Chub API bridge.
- Lorebooks: Chub arrays, Character Card embedded books, and SillyTavern/Risu
  object-or-array entry exports.
- Imported text is inert data. It is rendered through React text nodes and is
  never treated as HTML, JavaScript, a URL to fetch, or a local command.
- File sizes, JSON characters, entry counts, key counts, and field lengths are
  bounded. Invalid records are rejected or dropped with an inspectable status.
- Explicit legacy `whole_word: false` behavior remains substring-compatible;
  new or unspecified imports use boundary-aware literal matching.

### Library and chat usability

- Cards can be searched by name, summary, character, and tags; filtered by tag,
  favorites, and archive visibility; and marked favorite or archived.
- Chats can be renamed, archived/restored, and exported locally as versioned
  JSON. Archived chats are hidden by default but remain persisted.
- The transcript renders a bounded recent window with an explicit `Show earlier`
  action.
- Auto-follow occurs only while the reader is near the bottom. Scrolling upward
  disables follow until `Jump to latest` is selected.

### Disclosure and product surfaces

- ComfyUI endpoints, workflow JSON, prompt-debug retention, and prompt internals
  live behind advanced disclosure.
- About, version, help, support, and update-policy surfaces use the canonical
  name. The displayed version is injected from `package.json` at build time.

## Verification gates

- Pure behavior and security-boundary tests run in `pnpm verify`.
- UI tests cover the one-click demo, advanced disclosure, library controls,
  chat management, and non-forced transcript following.
- Existing persistence/import fixtures prove old snapshots still normalize.
- `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm audit --prod`, Rust tests,
  and Rust clippy must pass before the GREEN implementation commit.

The current working-tree release evidence is summarized in the
[testing evidence ledger](../testing/README.md) and
[production plan](../production-plan.md). Local discovery
detects fixed loopback servers and model IDs only; it does not download models,
manage inference processes, or make the overall product a zero-configuration
local-model runtime.
