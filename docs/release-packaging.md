# Release Packaging

This project currently treats Windows desktop packaging as the maintained release lane.

## Release Gate

Run the full release gate from a clean working tree before sharing a build:

```bash
pnpm install --frozen-lockfile
pnpm e2e:install
pnpm verify:release
```

`verify:release` runs TypeScript, ESLint, Vitest coverage, frontend build, Playwright browser smoke, production dependency audit, Rust advisory audit, Rust tests, Rust clippy, and the Tauri desktop package build.

## Output

`pnpm desktop:build` writes Tauri release output under:

```text
src-tauri/target/release/
src-tauri/target/release/bundle/
```

On Windows, inspect the generated installer or app bundle under the bundle subdirectories produced by Tauri for the configured targets.

## Preflight Checklist

- Confirm `git status --short` only contains intentional release changes.
- Confirm `pnpm verify:release` completed in the same checkout used for packaging.
- Confirm the Playwright smoke test opened the seeded RPG card, sent a mock turn, reloaded, and restored the saved transcript after reopening the card.
- Confirm no real API keys are present in source, tests, shell history snippets, generated diagnostics, screenshots, or release notes.
- Confirm release notes call out any runtime export schema, local snapshot schema, database migration, provider contract, or desktop secret-storage behavior changes.

## Data Safety

Before testing package upgrades against a real local install, close the app and copy the app database from the active app data directory. Restore by closing the app, replacing the database with the backup copy, and reopening the same or newer schema.

Do not change the desktop bundle identifier, keyring service, or database filename as part of routine release packaging. Those identifiers are data-continuity contracts and need an explicit migration plan.
