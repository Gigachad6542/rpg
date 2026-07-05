# Release Packaging

This project currently treats Windows desktop packaging as the maintained release lane.

## Release Gate

Run the full release gate from a clean working tree before sharing a build:

```bash
pnpm install --frozen-lockfile
pnpm e2e:install
cargo install cargo-audit --locked
pnpm verify:release
```

`verify:release` runs TypeScript, ESLint, Vitest coverage, frontend build, Playwright browser smoke, production dependency audit, Rust advisory audit, Rust tests, Rust clippy, the Tauri desktop package build, packaged executable smoke, and installed clean-profile smoke.

## Output

`pnpm desktop:build` writes Tauri release output under:

```text
src-tauri/target/release/
src-tauri/target/release/bundle/
```

On Windows, inspect the generated installer or app bundle under the bundle subdirectories produced by Tauri for the configured targets.

The release workflow writes a checksum manifest at:

```text
src-tauri/target/release/bundle/SHA256SUMS.txt
```

Tag pushes matching `v*` run `.github/workflows/release.yml`, upload the Windows MSI/NSIS artifacts plus the checksum manifest, and create a GitHub release.

## Preflight Checklist

- Confirm `git status --short` only contains intentional release changes.
- Confirm `pnpm verify:release` completed in the same checkout used for packaging.
- Confirm any `src-tauri/.cargo/audit.toml` advisory exceptions are still upstream-pinned and documented.
- Confirm the Playwright smoke test opened the seeded RPG card, sent a mock turn, reloaded, and restored the saved transcript after reopening the card.
- Confirm `pnpm desktop:smoke` opened the release executable and it stayed alive through startup.
- Confirm `pnpm desktop:installed-smoke` staged the MSI into a temporary install root, launched twice with isolated app-data paths, and created the runtime SQLite database under that clean profile.
- Confirm release artifacts have SHA256 checksums.
- Confirm no real API keys are present in source, tests, shell history snippets, generated diagnostics, screenshots, or release notes.
- Confirm release notes call out any runtime export schema, local snapshot schema, database migration, provider contract, image-provider sanitizer, or desktop secret-storage behavior changes.
- Confirm release notes state whether the build is unsigned/internal or signed/public.

## Data Safety

Before testing package upgrades against a real local install, close the app and copy the app database from the active app data directory. Restore by closing the app, replacing the database with the backup copy, and reopening the same or newer schema.

Do not change the desktop bundle identifier, keyring service, or database filename as part of routine release packaging. Those identifiers are data-continuity contracts and need an explicit migration plan.

## Signing And Distribution

Unsigned builds are acceptable for controlled beta distribution when the release notes say so plainly. Broad public Windows distribution should use a documented code-signing certificate, or the release notes must explicitly explain the unsigned installer trust prompt and intended audience.
