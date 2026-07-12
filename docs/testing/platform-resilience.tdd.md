# Platform and root-resilience TDD evidence

## macOS compatibility lane

- RED: workflow tests failed because routine CI had no `verify-macos` job and Mac docs
  still named the obsolete shared checksum.
- GREEN `99ca782`: `macos-latest` now runs pinned dependency setup, version sync, unit
  tests, frontend build, Rust tests, and clippy on pushes and pull requests. Release and
  install docs use platform-specific checksum names and state the provisional boundary.
- Focused workflow tests passed 4/4; the full frontend checkpoint passed 426 tests.

This is source/native compatibility coverage only. It is not evidence that an installed
DMG launches, restores SQLite, round-trips Keychain secrets, supports Intel, or passes
signing/notarization. The hosted job also cannot run until these local commits are
pushed.

## Root error boundary

- RED `6d74ea2`: the root had no boundary, so the recovery component test could not
  resolve.
- GREEN `75fd4b5`: `main.tsx` wraps the app in a React error boundary with retry,
  reload, and local crash-diagnostics download.
- Diagnostics redact secret-looking provider tokens, bearer credentials, and URL query
  credentials. The fallback never renders the raw exception.
- Focused tests passed 3/3 with TypeScript and ESLint green.

## Combined local gate

- 52 Vitest files and 436 tests passed.
- Coverage: 92.96% statements/lines, 89.37% branches, 94.18% functions.
- TypeScript, ESLint, version sync, and production frontend build passed.
- 27 Rust tests, `cargo fmt --check`, and clippy with warnings denied passed.
- The frontend build retains the known 541 kB main-chunk/code-splitting warning.
