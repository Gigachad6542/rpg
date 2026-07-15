# Local-First RPG

This is the real project root. Do not work from the parent wrapper folder.

## Stack

- React 18 + TypeScript + Vite for the renderer.
- Tauri 2 + Rust for the desktop shell and trusted local commands.
- SQLite is the desktop continuity authority.
- `pnpm` is the package manager.

## Core Commands

```bash
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm test
pnpm verify
pnpm desktop:open
pnpm desktop:build
```

Use `pnpm typecheck`, `pnpm lint`, and `pnpm test` for non-bloating checks. Use
`pnpm verify` or `pnpm desktop:build` only when build artifacts are acceptable.

## Generated Output

Do not commit generated or local-only output:

- `node_modules/`
- `dist/`
- `coverage/`
- `src-tauri/target/`
- `.reasoning/`

Run `pnpm clean` to remove generated build/test output.

## Safety Notes

- Do not paste or commit real provider API keys.
- Test fixtures may contain fake `sk-*` strings for secret-redaction coverage.
- Desktop stored-key calls should go through Tauri OS-keychain references, not renderer persistence.
- Keep changes scoped; the app currently has active runtime/provider/UI work in progress.
