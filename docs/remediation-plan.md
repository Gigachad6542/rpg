# Remediation Plan — External Review (2026-07-10)

Response plan for the production-readiness review (verdict: ~58/100, controlled Windows
testing only). Every finding below was re-verified against this working tree before
planning; all of them are real. Ordering follows risk: data loss first, state integrity
second, everything else after.

> Historical plan: this document records the July 10 review and its remediation
> trail. The canonical current assessment is `docs/production-plan.md`; the
> latest command evidence is
> `docs/testing/automated-accessibility-pnpm11-2026-07-14.tdd.md`.

## Current reconciliation (2026-07-14)

- The local `pnpm verify:release` gate passes in 268.2 seconds: 88 Vitest files /
  669 tests, 91.85% statements/lines, 88.79% branches, 93.49% functions, both deterministic
  evals, Playwright, JS/Rust audits, 34 Rust tests, clippy, desktop packaging,
  executable smoke, administrative-extraction SQLite smoke, and the normal
  current-user NSIS lifecycle.
- The packaged local-provider discovery ACL gap found on 2026-07-14 is repaired
  and exercised through the real packaged Tauri bridge.
- Public release remains externally unproven: no current exact-commit signed
  Windows run, notarized/stapled macOS run, clean-VM installer lifecycle, or
  previous signed semantic-version migration has been retained. A normal
  current-user NSIS install/reinstall/uninstall lifecycle now passes locally.
- The hosted workflow now independently verifies prior-release publisher,
  timestamp, checksums, provenance, tag commit, and version order, and offers an
  explicitly non-promotable bootstrap prerelease. The current private
  user-owned repository still cannot use GitHub private artifact attestations,
  so the release preflight fails until repository/account state or the approved
  attestation backend changes.
- The original ~58/100 verdict and intermediate counts below are historical
  checkpoints, not current readiness claims.

Legend: each item lists **Fix**, **Files**, **Done when** (acceptance criteria).

## Status (2026-07-12)

**Phase 0 blockers landed** — hydration, avatar size safety, release checksums,
version validation, the Chub desktop proxy, and historical SQLite migrations are in
place and verified:
- 0.1 fail-safe hydration — commit `e527580`
- 0.2 avatar embed budget — commit `ff11765`
- 0.3 release checksums + version guard — `faa62a4`; schema-v2 migration + Chub
  Rust proxy — `008c8e2`. While wiring the Chub command, discovered the Phase 0.1
  `backup_runtime_database` / `archive_runtime_database` commands were registered in
  the handler but missing from `build.rs` and `capabilities/default.json`, so they
  would have been denied in a packaged build — fixed in the same commit.

The schema correction is complete locally in `3024eb0` + `3f4b808`. Schema v3 opens
an exact pre-hardening v1 fixture and the real-risk v2/indexed-but-unconstrained shape,
takes a SQLite-consistent backup, preflights all 19 foreign keys and five CHECK
constraints, rebuilds transactionally, verifies row counts/integrity, and fails closed
without writing v3 when legacy data is invalid. Evidence:
`docs/testing/schema-v3-migration.tdd.md`.

**Phase 1.1 implemented locally** — commits `667d408`, `6034d0d`, `25ff873`,
`62f93b5`, and `1aab5b8` add deterministic composite turn lineages and wire them into
normal generation, regeneration, chat switching, branching, message-edit forks, and
safe variant selection. Legacy chats migrate to a synthetic current-state root; old
variants without trustworthy deltas fail closed. The original verification point was
416 tests and 93.07% statement/line coverage; later phases add more tests and are
verified together below.

**Phase 1.2 implemented locally** — `52e2462` through `e45aeb0` replace circular
narration grounding with provenance-tagged proposals, visible per-turn deltas, and
branch-specific undo. `267d312` + `cd90e4d` make memory consolidation preview-only
until explicit acceptance. `0644c66` + `7710691` add auto/confirm-first/off portrait
policy, default to confirm-first, and require the entity name in player-visible text.
Evidence: `docs/testing/turn-state-provenance.tdd.md`.

**Additional resilience landed locally** — `99ca782` adds routine macOS source/native
CI (not packaged-app proof), and `6d74ea2` + `75fd4b5` add a root React error boundary
with redacted local crash diagnostics. Nothing is pushed automatically.

**Historical 2026-07-12 local gate:** 52 Vitest files / 436 tests passed with 92.96% statement/line,
89.37% branch, and 94.18% function coverage. TypeScript, ESLint, version sync, the
production frontend build, 27 Rust tests, Rust formatting, and clippy all pass. The
build still reports the known 541 kB main-chunk/code-splitting warning.

---

## Phase 0 — Stop data loss (do first, small diffs)

These are the bugs that can silently destroy a user's save file today.

### 0.1 Fail-safe SQLite hydration

**Verified:** `App.tsx:517-555` — a failed `loadSnapshot()` still sets
`repositoryHydrated = true` (both the `finally` and the `catch`), and autosave gates only
on that flag. A failed load therefore unblocks autosave, which overwrites the previous
database with the starter/current in-memory state. A slow successful load can also land
after the user has already acted.

**Fix:**
- Replace the boolean with an explicit startup state machine:
  `hydration: "loading" | "ready" | "failed"`.
- Block all persistence writes and disable chat input while `loading`.
- On failure enter a recovery screen: retry, export a copy of the `.db` file, or
  explicitly start fresh (which archives the old db to `backups/` first — never
  overwrites in place).
- On session start, before the first write, copy the db to a rotating backup
  (keep last N, e.g. 5).

**Files:** `src/app/App.tsx` (hydration effect + autosave gates at lines 412, 598-632,
2103), `src/app/runtimeRepositoryStore.ts`, new `src/app/persistenceController.ts`,
Rust side backup command in `src-tauri/src/runtime_repository.rs`.

**Done when:** a test simulating `loadSnapshot` rejection shows no subsequent
`persistSnapshot` call and the recovery UI rendered; a test simulating slow load shows
user input blocked until ready; backup file exists after first write of a session.

### 0.2 Avatar imports that break persistence forever

**Verified:** `cardImport.ts:18` allows embedded avatars up to 1,500,000 bytes; base64
of that is ~2M chars; `runtime_repository.rs:24` rejects any string over 200,000 chars.
An accepted avatar makes every subsequent save fail permanently. Persona avatars
(`PersonasPanel.tsx`) are weaker still.

**Fix (two steps):**
1. **Hotfix (ship immediately):** clamp `AVATAR_MAX_EMBED_BYTES` to ~140,000 bytes
   (base64 ≈ 187k chars, under the 200k cap) and apply the same clamp to persona
   avatars. Downscale/re-encode oversized imports client-side instead of rejecting.
2. **Real fix:** store images as files under app data (`avatars/<id>.png`) via a Tauri
   command; persist only the asset reference in SQLite. Migrate existing embedded
   data-URLs to files on first load. Add a **persistence preflight**: before any save,
   validate the snapshot serializes within Rust limits and surface a visible error
   instead of failing silently.

**Files:** `src/app/cardImport.ts`, `src/app/PersonasPanel.tsx`, new
`src/app/assetService.ts`, `src-tauri/src/` (asset read/write commands),
`src-tauri/src/runtime_repository.rs`.

**Done when:** importing a card with a 1.5MB avatar → save succeeds, avatar renders
after restart; unit test proves any accepted import serializes under the Rust cap.

### 0.3 Release/packaging correctness bugs (quick wins, one PR)

**Verified:** both release lanes upload `SHA256SUMS.txt` with `--clobber`
(`release.yml:84,154`); all three manifests hardcode `0.1.0`; `SCHEMA_VERSION = 1`
(`runtime_repository.rs:11`) despite later DDL edits to the v1 schema; CSP
`connect-src` is self+loopback only (`tauri.conf.json:24`) while the renderer fetches
`api.chub.ai` — Chub import is dead in packaged builds.

**Fix:**
- Rename checksum assets per platform: `SHA256SUMS-windows.txt`, `SHA256SUMS-macos.txt`.
- Add `scripts/verify-version.mjs` that asserts `package.json`, `tauri.conf.json`,
  `Cargo.toml`, and (in release) the git tag all agree; run it in CI and the release
  workflow's first step.
- Bump `SCHEMA_VERSION` to 2 with an additive migration that applies the
  constraints/indexes that were retro-edited into the v1 DDL; add an upgrade test that
  opens a fixture v1 database and migrates it.
- Route Chub imports through a Rust HTTP command (endpoint-allowlisted, size-capped,
  like the existing provider proxy) instead of widening the CSP.
- Pin the packageManager pnpm version used locally to match CI (or vice versa),
  then push the intended release commit so hosted CI validates that exact SHA.

**Files:** `.github/workflows/release.yml`, `.github/workflows/ci.yml`, `scripts/`,
`src-tauri/src/runtime_repository.rs`, `src-tauri/src/lib.rs` (new command),
`src/app/cardImport.ts` (call the command when running under Tauri).

**Done when:** release dry-run produces both checksum files; version-mismatch fails CI;
v1-fixture migration test passes; Chub import works in a packaged build.

---

## Phase 1 — Turn-state integrity (the core architectural fix)

### 1.1 Per-turn, per-variant state commits

**Implemented locally (2026-07-11):**
- `runtimeTurnLineage.ts` persists an immutable base state plus deterministic composite
  effects covering hidden memory/entities/knowledge and visible memory/RPG changes.
- `chatTurnState.ts` owns normal-turn recording, pre-turn regeneration, branch remap,
  edited-message forks, manual-state rebasing, and fail-closed variant selection.
- `ChatSession.turnLineage` persists through local and SQLite snapshot paths. Legacy
  histories receive a synthetic base because their historical deltas cannot be
  reconstructed honestly.
- Earlier variant switching is refused while dependent assistant turns remain; edits
  create a branch and prune descendants instead of silently keeping stale state.
- Browser quota compaction preserves lineage-backed message chains rather than slicing
  away messages without rebasing their effects.

Evidence: `docs/testing/turn-state-lineage.tdd.md`.

**Verified:** `runtimeTypes.ts:139-157` — variants are `string[]` (text only); branches
copy messages but share the card-global `RpgCardState`, memories, entities, knowledge.
`regenerateLastReply` (`App.tsx:1154`) replaces text but not the state effects of the
replaced reply. Histories and state can contradict each other.

**Fix — a turn-commit model:**
- New type `TurnCommit`: `{ messageId, variantIndex, stateBefore: RpgCardState,
  effects: TurnEffects }` where `TurnEffects` is the delta (memories added, entities
  added/updated, knowledge, inventory ops) already computed in `turnEffects.ts`.
- Persist commits with the chat session. The authoritative current state = state at
  branch root + fold of active-variant effects along the visible message chain.
- **Swipe variant** → recompute state by swapping that message's effect delta.
- **Regenerate** → discard the replaced variant's delta, then apply the new one.
- **Branch** → branch carries its own state lineage from the branch-point commit
  (no more global state).
- **Edit earlier turn** → explicit choice: fork from that point (default) or replay
  downstream effects; never silently keep stale downstream state.
- Migration: existing chats get a synthetic root commit from current card state.

This is the largest item. Build it as a standalone module (`src/runtime/turnLedger.ts`)
with exhaustive unit tests *before* wiring into App, and extract the turn-execution
code out of `App.tsx` into `src/runtime/turnExecutor.ts` while wiring (starts item 2.1
early instead of doing per-turn state surgery inside a 2,400-line component).

**Files:** `src/app/runtimeTypes.ts`, new `src/runtime/turnLedger.ts` +
`src/runtime/turnExecutor.ts`, `src/app/turnEffects.ts`, `src/app/App.tsx`,
persistence schema (goes with the SCHEMA_VERSION 2→3 migration).

**Done when:** property-style tests prove: regenerate N times → state equals exactly
one applied variant; swiping variants toggles state deterministically; a branch and its
parent evolve independently; visible history never references an item absent from
inventory in the fixture scenarios.

### 1.2 Provenance-gated state changes + visible deltas + undo

**Implemented locally (2026-07-12):**
- Every hidden and visible mutation is retained as an applied/blocked proposal with
  `player-action | pre-turn-state | tool-result | model-narration` provenance.
- Model narration alone cannot establish RPG transitions or hidden entity/knowledge
  canon. Applied changes are shown below the assistant message and can be undone for
  the active response variant.
- Consolidation shows current/proposed memory and requires Apply; cancel and stale
  reviews leave memory untouched.
- Character portrait automation is user-selectable (`auto`, `confirm-first`, `off`),
  defaults to confirm-first, and requires the entity name in visible user/assistant
  text before even preparing a portrait prompt.

Evidence: `docs/testing/turn-state-provenance.tdd.md`.

**Verified files:** `hiddenContinuity.ts`, `turnEffects.ts`, `memoryConsolidation.ts`.
The hidden pass can mint memories/entities/knowledge that are then "validated" against
the same generated narration (circular); hidden output can trigger ComfyUI portrait
generation; consolidation replaces memory if the result is merely shorter.

**Fix:**
- Reclassify every mutation as a **proposal** with a provenance tag:
  `player-action | pre-turn-state | tool-result | model-narration`.
- Auto-apply only `player-action`, `pre-turn-state`, `tool-result` classes.
  `model-narration` proposals apply but are flagged and one-click undoable (leverages
  1.1's delta ledger — undo = drop the delta and refold).
- Add a per-turn "State changes" disclosure in the chat UI: what changed, why
  (provenance), undo button. The data already exists in `TurnEffects`.
- Portrait generation only for entities that appear in *player-visible* text, with a
  user setting: auto / confirm-first / off.
- Memory consolidation: never destructive-replace automatically. Show before/after
  preview; keep the original in an archive table until confirmed.

**Files:** `src/runtime/hiddenContinuity.ts`, `src/app/turnEffects.ts`,
`src/runtime/memoryConsolidation.ts`, new UI component
`src/app/components/TurnDeltaPanel.tsx`.

**Done when:** tests feed a hidden-pass response inventing an entity and assert it is
flagged + undoable, not silently canon; consolidation test asserts original preserved
until accepted; no ComfyUI call fires from hidden-only content.

---

## Phase 2 — Decomposition and runtime hardening

### 2.1 Break up App.tsx (~2,400 lines) and runtime_repository.rs (~2,600 lines)

Do this **incrementally, riding along with Phases 0-1** — each extraction lands with
the feature that needs it, not as a big-bang refactor:

| Extract | From | New home |
|---|---|---|
| Persistence/hydration state machine | App.tsx | `src/app/persistenceController.ts` (0.1) |
| Turn execution + streaming | App.tsx | `src/runtime/turnExecutor.ts` (1.1) |
| Asset/image handling | App.tsx | `src/app/assetService.ts` (0.2) |
| Provider orchestration | App.tsx | `src/app/providerController.ts` |
| Rust: schema/migrations vs CRUD vs validation | runtime_repository.rs | `schema.rs`, `validation.rs` |

**Done when:** App.tsx under ~800 lines, orchestration modules independently unit-tested.

### 2.2 UX resilience batch

- **Implemented:** React error boundary at the root with retry/reload and a redacted
  local diagnostics export (`6d74ea2`, `75fd4b5`). A render crash no longer becomes a
  blank desktop window.
- **Cancel/stop** for in-flight model requests: thread `AbortController` through
  provider calls (both hidden and visible passes); stop button in chat UI.
- **Prompt budget**: derive from the selected model's context size instead of the
  hardcoded ~6,000-token constant; keep `chars/4` estimation but make the budget
  conservative and configurable.
- **Restore points**: persist them (they are session-only today) and create one before:
  runtime import, memory consolidation, persona deletion, first message of a session.
- **Import safety**: runtime import shows a diff/summary and takes a restore point
  before overwriting.
- **Onboarding copy**: change "everything runs on your machine" to accurately describe
  hosted-provider data flow (persona, memory, lore, state, chat go to the provider you
  configure).

### 2.3 Security/robustness batch

- **Imported regex**: execute lorebook regex matching in a Web Worker with a per-scan
  timeout; kill and disable the offending entry on timeout (ReDoS from a malicious
  lorebook currently freezes the UI thread).
- **Image GC**: deleting an artifact/entity deletes its generated files; add a startup
  sweep for orphans.
- **Dialog a11y**: focus trap + Escape + `aria-modal` on modals; keyboard path through
  chat controls.
- **Card export round-trip**: export active card as Tavern-compatible PNG/JSON —
  imports exist, exports don't, so user data is currently one-way.

---

## Phase 3 — Test depth to match reality

**Verified:** the only E2E (`tests/e2e/runtime-smoke.spec.ts`) runs Chromium against the
web/localStorage path with mocked providers. 371 green unit tests don't cover the paths
that actually broke above.

1. **Unit/integration coverage for the risky App paths** (most become testable once the
   Phase 1/2 extractions land): editing, regeneration, variants, hydration failure,
   restoration, card import round-trip, memory consolidation, persona deletion,
   streaming.
2. **Desktop E2E** via WebDriver/`tauri-driver` (Windows first since that's the shipped
   platform): launch packaged app → create card → chat turn (mock provider via env) →
   quit → relaunch → assert persistence; import test; keychain smoke.
3. **DB migration tests**: fixture databases at each historical schema shape, opened by
   the current binary, asserting successful upgrade + data intact (started in 0.3).
4. **Model-behavior evals** (separate, non-CI-blocking harness): record/replay fixture
   suite scoring state-mutation precision, lore retrieval hit rate, long-session
   continuity, prompt-injection resistance, and tracking token cost per turn.
   Run on demand and before releases, tracked over time.

**Done when:** every Phase 0/1 fix has a regression test; desktop E2E green in CI on
Windows; eval harness produces a baseline scorecard.

---

## Phase 4 — Real Mac lane (last, deliberately)

**Current boundary (reconciled 2026-07-14):** routine `macos-latest`
source/native verification and a tagged-release mounted-DMG
copy/launch/relaunch/SQLite-integrity smoke are defined. Native Keychain
round-trip automation and signing/notarization gates are also implemented, but
there is no retained current hosted run with Apple credentials. Intel or
universal-binary proof remains open; the install docs state those limits.

Ordered steps, each gated on the previous:

1. **Implemented locally:** macOS CI job runs unit tests + `pnpm build` + Rust tests /
   clippy on pushes and pull requests. It becomes evidence only after GitHub runs it.
2. **Mac E2E smoke in the release lane**: build DMG → `hdiutil attach` → copy app →
   launch → drive the same persistence smoke as Windows (create data, quit, relaunch,
   assert SQLite restore, Keychain store/retrieve round-trip) → detach.
3. **Architecture decision**: build `universal-apple-darwin` (Intel + Apple Silicon) or
   explicitly document Apple-Silicon-only. Universal is the default recommendation.
4. **Signing & notarization** — ⚠ requires an Apple Developer Program membership
   ($99/yr) and Developer ID certificate; this is a purchase/enrollment only the owner
   can do. Once available: sign, notarize (`xcrun notarytool`), staple, and delete the
   Gatekeeper-bypass instructions from `docs/macos-install.md`.
5. **First tagged release** `v0.2.0`: version-sync script from 0.3 enforces manifest
   agreement; both platforms publish artifacts + per-platform checksums.

**Done when:** a fresh Mac (or hosted runner) downloads the DMG from a GitHub Release,
opens it without Gatekeeper overrides, and passes the persistence smoke.

---

## Sequencing summary

```
Phase 0  (0.1 hydration ─ 0.2 avatars ─ 0.3 release fixes)   ~ days, independent PRs
Phase 1  (1.1 turn ledger → 1.2 provenance/undo)              ~ 1-2 weeks, sequential
Phase 2  (2.1 rides along Phase 1; 2.2/2.3 parallelizable)    ~ 1 week
Phase 3  (tests grow with each phase; desktop E2E after 2.1)  continuous
Phase 4  (Mac lane; step 4 blocked on Apple Developer ID)     last
```

Dependencies worth naming:
- 1.2 (undo) depends on 1.1 (delta ledger).
- 0.2's asset service is reused by 2.3's image GC.
- Desktop E2E (3.2) is far easier after the persistence controller (0.1) exists.
- Phase 4 step 4 is blocked on an owner decision: Apple Developer Program enrollment.

## Explicitly deferred / disagreements with the review

- **Token estimation (`chars/4`)**: real tokenizers per provider are heavy; instead
  budgets become conservative + configurable (2.2). Revisit only if truncation bugs
  appear.
- **Big-bang App.tsx rewrite**: rejected in favor of extraction-with-feature (2.1);
  a standalone refactor of this file without the Phase 1 behavior changes would churn
  2,400 lines twice.
