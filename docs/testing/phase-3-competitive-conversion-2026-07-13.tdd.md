# Phase 3 Competitive Conversion Evidence

Date: 2026-07-13

Scope: starter conversion, local-provider discovery, secure interoperable imports,
library and chat usability, long-transcript behavior, advanced disclosure, and
canonical product surfaces.

## Result

Phase 3 is implemented and locally verified. A fresh user now sees onboarding
even though the bundled starter library is present, can enter the complete
Ashfall Crossing sample through a network-free mock demo, and can start from
three guided creation templates.

The product imports Character Card V1/V2/V3 JSON or PNG files used by compatible
SillyTavern and RisuAI exports, compatible object-or-array lorebook exports, and
Chub cards through the fixed Chub API bridge. This run verified parsers and UI
flows with local fixtures; it did not sign into or automate third-party sites.
Chub is the only direct website URL importer. Other services remain file-import
paths so imported content cannot turn the app into a general-purpose fetcher.

## Follow-up correction (2026-07-14)

The original implementation evidence below is historical. A packaged-app audit
later found that `discover_local_text_providers` existed in the renderer and
Rust handler but was absent from the Tauri app manifest and default capability,
so the marketed desktop discovery action was denied by ACL. The manifest,
capability, generated permission schemas, and release-flow regression coverage
were repaired. That full release gate passed with 69 files / 620 tests, and
the current MSI product flow successfully invoked the command through the real
packaged WebView.

The latest 2026-07-14 full gate passed in 223.3 seconds with 96 files / 693
tests, 92.18% statements/lines, 89.05% branches, and 93.65% functions. The
original Phase 3 conversion counts below remain historical.

## RED checkpoint

Commit: `47d22b5` (`test: define phase 3 conversion contract`)

Command:

```text
pnpm vitest run tests/app/phase3Conversion.test.ts --project app
```

Expected result: the suite failed because `src/app/starterContent` and the other
Phase 3 behavior modules did not exist.

## GREEN checkpoint

Commit: `9f2d913` (`feat: deliver phase 3 competitive conversion`)

Focused result:

```text
pnpm vitest run tests/app/phase3Conversion.test.ts tests/app/cardImport.test.ts tests/app/startupPersistencePolicy.test.ts --project app
3 test files passed
42 tests passed
```

Aggregate result:

```text
pnpm verify
PASS in 59.7 seconds
69 test files / 618 tests passed
Phase 1 deterministic eval: passed
Phase 1.1 offline eval: passed, 100 lore decisions, 3 long campaigns
Production build: passed
Production dependency audit: no known vulnerabilities
Rust tests: 34 passed, 1 signed-release-only Keychain test ignored
Rust clippy: passed with -D warnings
```

Additional checks:

- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check` passed.
- `git diff --check` passed before the GREEN commit.
- Intended current user-facing product surfaces used `Local-First RPG`.
  Internal binary/database identifiers and dated historical records retain
  legacy names where compatibility or evidence integrity requires them; public
  release artifact names and titles were reconciled on 2026-07-14.
- The secret-pattern review found only intentional fake `sk-*` test fixtures.

## Implemented product behavior

- Bundled complete RPG: `Ashfall Crossing`, with opening, state, quest,
  inventory, rules, entities, tags, and four active lore entries.
- Templates: choice-driven mystery, survival expedition, and character drama.
- Readiness checklist: playable content, active card, and text provider.
- Mock demo: selects or restores the sample and its chat, switches to the mock
  provider, and makes no network or model call.
- Local inference discovery: fixed loopback `/v1/models` probes for Ollama, LM
  Studio, llama.cpp server, and KoboldCpp, with no port scan or model mutation.
- Library: search, tag filter, favorites, archive visibility, tags editing, and
  persistent normalization.
- Chats: rename, archive/restore, and versioned local JSON export.
- Transcript: recent 120-message window, explicit history expansion, scroll-up
  detection, and an explicit jump-to-latest control.
- Disclosure: ComfyUI workflow/settings and prompt diagnostics/previews are
  closed advanced sections by default.
- Product surfaces: `Local-First RPG`, build-time version, About, help, support,
  and manual signed-update links.

## Security boundaries

- Desktop local discovery accepts no renderer URL. It uses four compiled
  loopback endpoints, a 900 ms request timeout, disabled redirects, a 512 KiB
  response limit, at most 100 model IDs, and control-character/length checks.
- Browser fallback uses the same fixed candidates, aborts slow requests,
  disables redirects, and bounds response text before JSON parsing.
- Character files are capped at 8 MiB; card and lorebook JSON are capped at two
  million characters; imported fields, lists, keys, and lorebook entries are
  bounded.
- Direct imports accept only HTTPS `chub.ai` or `www.chub.ai` character URLs;
  lookalike hosts and HTTP URLs are rejected.
- Imported text remains React-rendered data. No dynamic HTML, script execution,
  arbitrary imported URL fetch, process launch, or credential storage was added.

## Deliberate deferral

The app detects existing local inference servers but does not download models,
install llama.cpp, or manage inference processes. That path remains deferred
until signed-model provenance, checksums, disk budgets, cancellation, upgrades,
and process sandboxing have an explicit product and security contract.
