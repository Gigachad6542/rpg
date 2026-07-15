# Production Plan

Audit date: 2026-07-14

Current working-tree readiness: **85/100 (launchable with caveats for a
controlled beta; not proven for broad public release)**. The local release gate
is green, the packaged local-provider discovery regression is repaired, and a
normal current-user NSIS install/reinstall/uninstall lifecycle now passes. The
score remains below public-launch level because no current exact-commit hosted
release has produced signed Windows and notarized macOS artifacts, the installer
has not been repeated on a clean VM, no previous signed semantic version exists
for upgrade proof, and live-provider narrative quality is not yet measured. The
release workflow now has an honest two-release bootstrap path and independently
revalidates previous-release signatures, timestamps, publisher identity,
checksums, provenance, tag commit, and version ordering. That repair does not
raise the score until hosted evidence exists. The current private personal
repository is also ineligible for GitHub's private artifact-attestation service,
and the workflow now fails before signing jobs until that account/repository
constraint is resolved.

## Evidence Checked

- Real repo root: `C:\Users\Dwthe\rpg project`.
- Local release gate: `pnpm verify:release` passed in 274.0 seconds on 2026-07-14
  with runtime-persistence extraction commit `68b40c1` checked out.
- Vitest coverage gate: 90 files and 675 tests passed.
- Coverage: 91.93% statements/lines, 88.84% branches, and 93.55% functions.
- Enforced coverage floors: 90% statements/lines/functions and 85% branches.
- Deterministic evals: Phase 1 passed; Phase 1.1 passed with 100 lore decisions,
  three long campaigns, and `liveCallsMade: 0`.
- Browser acceptance: 14 Playwright Chromium tests passed. Eleven functional
  journeys cover the seeded
  runtime smoke, one-click offline demo, template card creation and reload,
  reversible export/import review, and memory-dialog focus trap/restoration.
  Additional journeys verify current-page navigation plus linked, roving,
  arrow/Home/End-key card-editor tabs, reversible card/chat deletion, and
  visible local-provider failure followed by in-place mock-provider recovery,
  multiline keyboard composition, fail-closed invalid runtime imports, and a
  reviewed whole-runtime replacement rolled back from a named restore point.
  Two zero-violation Axe journeys cover WCAG A/AA-tagged rules across dark and
  light onboarding, all five primary sections, the memory inspector, and the
  runtime-import, restore, and persona-deletion dialogs. A third journey rejects
  horizontal overflow across onboarding and all primary sections at 320 CSS
  pixels, verifies forced-colors Settings and Runtime, and covers keyboard
  access to the constrained scrollable transcript.
- Frontend build: Vite production build passed; the main app chunk was 493.53
  kB (139.17 kB gzip), plus separate React, icon, and Tauri chunks.
- Dependency audit: `pnpm audit --prod` reported no known vulnerabilities.
- Rust audit: `cargo audit` exited successfully with 18 allowed transitive
  warnings; two `quick-xml` advisories remain scoped exceptions in
  `src-tauri/.cargo/audit.toml`.
- Rust tests: 34 passed; the signed-release-only macOS Keychain test was ignored
  locally as designed.
- Rust clippy: passed with `-D warnings`.
- Desktop packaging: MSI and NSIS bundles built under `src-tauri/target/release/bundle/`.
- Packaged executable smoke: `pnpm desktop:smoke` opened the release executable and confirmed it stayed alive.
- MSI-payload smoke: `pnpm desktop:installed-smoke` administratively extracts
  the MSI into a temporary root, launches twice with isolated app-data paths,
  and confirms SQLite creation. It does not prove Windows installer registration,
  shortcuts, repair, upgrade, or uninstall.
- Normal installer lifecycle: `pnpm desktop:installer-lifecycle` selected the
  sole canonical NSIS artifact, verified current-user registration and launch,
  preserved isolated SQLite data across a same-version reinstall and relaunch,
  then removed the registration and install directory on uninstall. The tested
  NSIS SHA256 was `b937e9bca12b7c7211a7a078cf6c11ab8ed01329c427f57c2bd5b779c9e79930`.
  This was a
  local development profile, not a clean VM or previous-version upgrade.
- Packaged WebView product flow: passed in 14.6 seconds against the current MSI,
  including a real Tauri invocation of `discover_local_text_providers` and
  create/play/reopen/backup/restore/export continuity. The tested MSI SHA256 was
  `a5cb3ab8989668e57560ff75147480809c6a89018e01c2561385c9a04781b1dc`.
  This different-commit, same-version run is runtime proof, not published
  semantic-version migration proof.
- Desktop write policy: exactly one `main` window is declared and capability
  scoped; contract tests reject additional renderer/Rust window creation.
- Streaming policy: stored OS-keychain providers are explicitly non-streaming,
  the pipeline falls back to request/response, and Settings tells users that
  those replies appear once complete.
- Release-chain verifier: 20 focused tests passed across three release suites.
  Synthetic previous artifacts prove checksum/provenance/repository/tag-commit/
  version failures are rejected, and an unsigned MSI with an absolute evidence
  path reaches Authenticode validation and fails for the signature itself.
- Release workflow syntax: local YAML parsing found six jobs, including the
  fail-closed intent preflight and explicitly non-promotable bootstrap publisher.

### Readiness scoring rubric

| Area | Score | Evidence-based reason |
|---|---:|---|
| Correctness and data safety | 19/20 | SQLite authority, migrations, recovery, deterministic lineage, backup/restore, a tested single-window writer policy, and strong unit coverage are implemented. |
| Security and privacy boundaries | 14/15 | Keychain references, scoped Tauri commands, fixed loopback discovery, import limits, redaction, and clean production audits are present; accepted Rust debt remains. |
| Automated verification | 19/20 | The local release gate is broad, eleven functional browser journeys pass, and zero-violation automated WCAG A/AA, 320 CSS-pixel reflow, and forced-colors lanes cover primary surfaces; native desktop assistive-technology testing and live-provider evaluation have not run. |
| Packaging and release operations | 14/20 | Signed fail-closed workflows and a real local NSIS lifecycle exist; current hosted signed/notarized evidence, clean-VM proof, and a published previous-version migration are absent. |
| Product and UX maturity | 12/15 | Onboarding, sample content, imports, library tools, continuity, named recovery controls, reversible replacement/restore flows, critical keyboard paths, 320 CSS-pixel reflow, and forced-colors behavior are credible; the main controller remains oversized and native assistive-technology acceptance is absent. |
| Operational and project governance | 7/10 | Release, rollback, runtime, security, support, contribution, changelog, conduct, issue, and PR contracts exist; licensing and verified public support/security intake remain incomplete. |

## Competitive Snapshot (verified 2026-07-14)

| Product | Current advantage over Local-First RPG | Local-First RPG advantage / opportunity |
|---|---|---|
| [SillyTavern](https://docs.sillytavern.app/) | Much broader provider controls, group chat, personas, RAG, scripting, and extension ecosystem. | Stronger opinionated RPG state lineage, visible/undoable mutations, and a narrower desktop trust boundary. |
| [RisuAI](https://risuai.net/) | Windows/macOS/Linux/Android/Web reach, community sharing, richer media/prompt features, and a simpler light-user funnel. | Local SQLite continuity and deterministic RPG-state semantics can differentiate if setup becomes equally easy. |
| [Backyard AI](https://backyard.ai/changelog) | Current web/iOS focus, Character Hub, parties, voice, and managed model experience. Its local desktop app is deprecated as of June 25, 2025. | A maintained private desktop-first product can occupy the local continuity niche Backyard left, but model setup is currently much less integrated. |
| [NovelAI](https://docs.novelai.net/en/text/lorebook/) | Mature story editor, model service, lore generation, advanced lore activation, and polished creative workflow. | BYOK/local-provider flexibility and explicit RPG state/branch provenance offer more user control and less service lock-in. |

The defensible wedge is not feature parity. It is **private, inspectable RPG
continuity**: authoritative local state, visible model proposals, deterministic
branch lineage, and reversible changes. Competing on ecosystem breadth before
that flow is effortless would dilute the product.

## Closed Public-Release Blockers

1. Post-generation state policy gate.
   - Model-proposed extraction now passes through `filterValidatedTurnEffectsForPolicy` before card mutation.
   - The gate blocks unsafe memory proposals, replaces unsafe memory labels, canonicalizes inventory removals, blocks ungrounded location changes, caps health deltas, rejects unsupported inventory changes, blocks ungrounded quest updates, and blocks ungrounded or non-boolean flags.
   - Accepted and blocked deltas are recorded on the prompt run as state changes and warnings.

2. Export sanitization split.
   - Runtime exports now use share/export sanitization instead of local persistence sanitization for image provider settings.
   - ComfyUI `workflowJson` is omitted from exports by default so local paths, model names, workflow node settings, and pasted secrets do not leave the machine through a runtime bundle.

3. ComfyUI error redaction.
   - Successful queue responses containing `node_errors` now go through the same sensitive-content redaction path as non-OK response bodies.
   - Regression tests cover secret-like `node_errors`.

4. Provider request timeouts and cancellation.
   - OpenAI-compatible text generation, text streaming, ComfyUI image generation, ComfyUI model discovery, and the Rust stored-secret provider path now support bounded request timeouts.
   - Browser-side provider timeouts cover initial fetches, response body reads, and stream reads.
   - Timeout errors preserve their underlying cause without leaking provider secrets.

5. Release lane.
    - `verify:release` now includes desktop package build and packaged executable smoke.
    - Windows builds clear stale bundle output and the release gate performs a
      fail-closed normal NSIS install/reinstall/uninstall lifecycle.
    - All 26 CI/release action references are pinned to immutable upstream
      commits with reviewed version comments; pnpm and Rust versions are also
      fixed.
    - A tag-triggered Windows release workflow builds, verifies, uploads MSI/NSIS artifacts, writes SHA256 checksums, and creates GitHub releases for `v*` tags.
    - Candidate migration inputs are now revalidated against Authenticode
      publisher/timestamp, checksum, provenance, GitHub tag commit, and strict
      semantic-version ordering before the previous MSI is executed.
    - A manually confirmed signed bootstrap prerelease can create the first
      migration baseline without pretending that it proves migration; the next
      higher-version candidate must consume that baseline and pass the full flow.
    - `pnpm clean` removes generated frontend, coverage, Playwright, and Tauri output.

6. Share-safe runtime exports.
   - Runtime exports now always strip compiled prompts, even when local prompt debug logs are enabled.
   - Import round-tripping reuses the same export sanitizer so prompt text is not reintroduced from imported bundles.

7. Image-provider persistence boundary.
   - Browser, Tauri invoke, in-memory repository, and Rust SQLite snapshot boundaries now sanitize image provider settings.
   - Safe ComfyUI workflow JSON can be retained for local recovery, but workflow JSON with secret-like keys or raw-token-looking values is dropped.

## Remaining Public-Launch Work

- Execute the existing hosted workflow on the exact release commit with real
  Windows signing and Apple signing/notarization credentials; retain every
  signature, Gatekeeper, Keychain, SBOM, provenance, and attestation artifact.
- Resolve attestation capability by making the repository public, transferring
  it to an eligible Enterprise Cloud organization, or approving and reviewing
  an equivalent backend. The private user-owned repository is rejected by the
  release preflight rather than silently omitting attestations.
- Push the current commit so routine Windows CI can execute and retain the newly
  required clean-runner NSIS lifecycle; the local workflow contract alone is not
  hosted evidence.
- Repeat the passing normal Windows lifecycle on a clean non-development
  machine or VM and add a true upgrade from a previous signed semantic version.
- Run the hosted packaged flow with an actual previous signed semantic-version
  MSI and verify migration, rotating backup creation, restore, and export.
- If no prior signed package exists, run the explicit bootstrap-baseline mode,
  retain its signed prerelease, bump the synchronized version, and then run the
  normal candidate against that exact older tag. The baseline run alone is not
  a launch gate.
- Run the opt-in live-provider evaluation with reviewed paid-call limits and
  blind pairwise scoring before recommending any second-call mode or model.
- Track and reduce the 18 allowed Rust warnings and the two scoped
  `quick-xml` exceptions as upstream dependency paths move.
- Continue decomposing the 2,454-line `App.tsx` controller and large feature
  modules without weakening behavior. Provider/session-key state, secure-storage
  status, health checks, and ComfyUI startup/manual discovery now live in a
  focused 225-line hook with three direct tests. Repository hydration, startup
  backup ordering, autosave queueing, restore-point recovery, and persistence
  diagnostics now live in a 302-line hook with three direct fail-closed/order
  contracts. The former 4,752-line UI test file is
  now five independently runnable domain suites over a 234-line shared harness
  (81 behaviorally identical tests; largest domain suite 1,415 lines). The former
  3,789-line Rust repository authority is now a 367-line command/path/backup
  boundary over independently gated validation, schema, normalized-storage
  CRUD, and a separate 1,114-line regression corpus.
- Continue accessibility acceptance beyond the zero-violation automated WCAG
  A/AA lane, verified 320 CSS-pixel reflow and forced-colors emulation, dialog
  focus traps, current-page navigation, linked keyboard-operable card tabs,
  multiline composer, fail-closed replacement, and reversible restore into
  native WebView screen-reader, Windows High Contrast, magnifier/zoom, and
  switch-input checks.
- Make the owner licensing decision and configure verified public help,
  support, and security-reporting destinations before broad distribution.

## Production Milestones

### Milestone 1: Controlled Beta

Acceptance:
- `pnpm verify:release` passes in the release checkout.
- MSI/NSIS bundles are retained with checksum artifacts.
- Known warnings and unsigned-build status are called out in release notes.
- Backup/restore instructions are tested once against the local app data directory.

### Milestone 2: Installer Confidence

Acceptance:
- Installer runs on a clean non-development Windows profile.
- Installed app opens, creates or imports an RPG card, sends a mock/local turn, persists SQLite continuity through close/reopen, and exports diagnostics/runtime data.
- Stored desktop API-key path is verified with OS keychain storage and no renderer key echo.

### Milestone 3: Public Launch Readiness

Acceptance:
- Remote CI is green on the release tag.
- Release artifacts include checksums, release notes, and signing/updater stance.
- Rust advisory warnings are either removed or explicitly accepted with rationale.
- First-run, empty, loading, error, provider-missing, ComfyUI-unavailable, import-failure, and backup/restore paths have visible acceptance coverage.

## Historical Test-Production Gate Run (2026-07-06)

The full release lane was executed stage by stage on the development machine and passed end to end:

| Stage | Result |
|---|---|
| `pnpm typecheck` / `pnpm lint` | PASS |
| `pnpm test:coverage` | PASS, 246 tests, 99%+ statements |
| `pnpm build` | PASS (460 kB JS, 130 kB gzipped) |
| `pnpm e2e` | PASS, browser smoke with persisted-state reload |
| `pnpm audit:prod` | PASS, no known vulnerabilities |
| `pnpm rust:audit` | PASS, 18 allowed transitive warnings (documented debt) |
| `pnpm rust:test` / `pnpm rust:clippy` | PASS, 17 tests, zero warnings |
| `pnpm desktop:build` | PASS, MSI + NSIS bundles under `src-tauri/target/release/bundle/` |
| `pnpm desktop:smoke` | PASS, release executable stayed alive |
| `pnpm desktop:installed-smoke` | PASS, administratively extracted MSI payload launched twice and created SQLite under an isolated profile |

Blocking fix landed during the run: `pnpm-workspace.yaml` used pnpm 10 syntax that the
pinned pnpm 9.15.9 rejects, breaking `pnpm install` locally and in CI. The overrides moved
to the `package.json` `pnpm` section and the workspace file was removed.

Historical note: that configuration was superseded after this run. The current
toolchain is pnpm 11.7.0 because pnpm 9's legacy npm audit endpoint was retired.
The current supply-chain policy lives in `pnpm-workspace.yaml`, and `package.json`
intentionally has no `pnpm` block.

The test-production bundles are unsigned; distribute to testers with that stated plainly.

## Phase 1.1 Quality Lane (2026-07-13)

The deterministic portion of Phase 1.1 is implemented and release-gated:

- The opt-in live runner preserves the call contract for `off`, `economical`,
  and `full`, records hidden and visible phases independently, and refuses paid
  execution without both a reviewed configuration and an explicit command-line
  acknowledgement.
- Visible and routed economical models have separate exact-model pricing
  snapshots. A missing or mismatched rate remains unknown instead of borrowing
  another model's price.
- Boundary-aware lore matching, aliases, broad-key secondary requirements,
  editor warnings, trigger provenance, and explicit substring compatibility are
  covered by regression tests.
- The corrected 36-turn Phase 1 corpus and the expanded 100-decision lore gate
  both report precision and recall of 1.00.
- Three deterministic long-session fixtures cover 60, 55, and 75 turns with
  edits, regeneration, branching, restart, and model switching.

No paid or live-provider run has been performed. The second model call is
therefore not yet proven to justify its latency or cost, and no default mode or
model recommendation should change until blind pairwise evidence is collected.
Neural embeddings remain deferred until a retrieval benchmark demonstrates a
material gain over the current local lexical/feature-hash path.

## Current Recommendation

Ship the next build as a controlled beta, not a broad public release. The code
blockers are fixed and locally verified. Remaining risk includes release
operations, attestation eligibility, installer trust, clean-machine validation,
and unmeasured live narrative benefit from the optional second model call.

## Phase 2 Shipped-Product Lane (2026-07-13)

Implemented release gates:

- Packaged Windows previous/current MSI flow covering first run, provider setup,
  creation, play, close/reopen, state verification, database backup restore, and
  final export.
- Fail-closed Windows Authenticode and macOS Developer ID/notarization inputs,
  followed by signature, stapling, and Gatekeeper verification.
- Mounted-DMG persistence evidence and an ignored opt-in native macOS Keychain
  set/get/delete smoke test.
- Exact-release-commit hosted CI prerequisite, per-platform CycloneDX SBOMs,
  SHA-256 manifests, commit-bound provenance, GitHub attestations, and retained
  release evidence.
- A manual updater and schema-safe rollback policy with credential revocation
  handling. Automatic updates and downgrades remain disabled.

Operational proof still required before public launch:

- Resolve GitHub artifact-attestation eligibility or approve an equivalent
  reviewed backend without weakening the fail-closed promotion contract.
- Run the hosted workflow with real Windows and Apple signing credentials.
- Supply an actual previous signed Windows MSI and retain the successful
  migration/restore report.
- Retain the signed macOS DMG, notarization/stapling/Gatekeeper logs, mounted-DMG
  smoke, and Keychain result.
- Confirm the publish job ran only after both platform jobs and `ci.yml` passed
  for the same commit SHA.
