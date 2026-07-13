# Production Plan

Audit date: 2026-07-03

Current production audit: 84/100. Core runtime blockers are closed. Phase 2 now
implements the release automation for signing, full installed-app workflow
coverage, previous-build migration and backup restoration, macOS DMG/Keychain
proof, exact-commit CI gating, checksums, provenance, SBOMs, and attestations.
Broad public release must still wait for that workflow to execute successfully
with real hosted runners, signing credentials, and a previous signed build.

## Evidence Checked

- Real repo root: `C:\Users\Dwthe\rpg project`.
- Local release gate: `pnpm verify:release` is the release-candidate gate after blocker fixes.
- Vitest coverage gate: 31 files, 227 tests passed.
- Coverage: 99.2% statements, 93.01% branches, 100% functions, 99.2% lines.
- Browser smoke: 1 Playwright Chromium test passed.
- Frontend build: Vite production build passed.
- Dependency audit: `pnpm audit --prod` reported no known vulnerabilities.
- Rust audit: `cargo audit` completed with 17 allowed advisory warnings.
- Rust tests: 16 passed.
- Rust clippy: passed with `-D warnings`.
- Desktop packaging: MSI and NSIS bundles built under `src-tauri/target/release/bundle/`.
- Packaged executable smoke: `pnpm desktop:smoke` opened the release executable and confirmed it stayed alive.
- Installed clean-profile smoke: `pnpm desktop:installed-smoke` stages the MSI into a temp install root, launches twice with isolated app-data paths, and confirms runtime database creation.

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
    - CI and release workflow inputs are pinned for pnpm and Rust.
    - A tag-triggered Windows release workflow builds, verifies, uploads MSI/NSIS artifacts, writes SHA256 checksums, and creates GitHub releases for `v*` tags.
    - `pnpm clean` removes generated frontend, coverage, Playwright, and Tauri output.

6. Share-safe runtime exports.
   - Runtime exports now always strip compiled prompts, even when local prompt debug logs are enabled.
   - Import round-tripping reuses the same export sanitizer so prompt text is not reintroduced from imported bundles.

7. Image-provider persistence boundary.
   - Browser, Tauri invoke, in-memory repository, and Rust SQLite snapshot boundaries now sanitize image provider settings.
   - Safe ComfyUI workflow JSON can be retained for local recovery, but workflow JSON with secret-like keys or raw-token-looking values is dropped.

## Remaining Public-Launch Work

- Decide signing and updater policy before public distribution. Unsigned builds are acceptable for internal beta, but public Windows releases need a documented certificate strategy or explicit unsigned-distribution warning.
- Run the installer on a clean non-development Windows profile beyond the local temp-profile installed smoke.
- Validate upgrade/backup/restore against a real app data directory and a previous packaged build.
- Track and remove the 17 formally accepted Rust advisory warnings when Tauri/WebKitGTK dependencies publish compatible fixed paths.
- Extend installed-desktop smoke coverage to a full user path: send a turn, close/reopen, verify SQLite continuity, stored-key behavior, diagnostics, and export.
- Decide the multi-window write policy: single-window lock, revision checks, or explicit last-writer-wins behavior.
- Align streaming UX with provider capability by disabling unavailable streaming paths for desktop stored-secret providers or adding a Tauri streaming command.
- Improve accessibility acceptance coverage for tab linkage, dialog focus management, drawer behavior, and keyboard-only runtime flows.
- Create a guided first-run flow from blank state to playable RPG card in under five minutes.

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

## Test-Production Gate Run (2026-07-06)

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
| `pnpm desktop:installed-smoke` | PASS, staged MSI install launched twice and created SQLite under a clean profile |

Blocking fix landed during the run: `pnpm-workspace.yaml` used pnpm 10 syntax that the
pinned pnpm 9.15.9 rejects, breaking `pnpm install` locally and in CI. The overrides moved
to the `package.json` `pnpm` section and the workspace file was removed.

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
operations, installer trust, clean-machine validation, and unmeasured live
narrative benefit from the optional second model call.

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

- Run the hosted workflow with real Windows and Apple signing credentials.
- Supply an actual previous signed Windows MSI and retain the successful
  migration/restore report.
- Retain the signed macOS DMG, notarization/stapling/Gatekeeper logs, mounted-DMG
  smoke, and Keychain result.
- Confirm the publish job ran only after both platform jobs and `ci.yml` passed
  for the same commit SHA.
