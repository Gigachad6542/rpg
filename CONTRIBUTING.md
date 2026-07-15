# Contributing

## Setup

Use Node 22, the pinned Rust toolchain, and the real repository root. Enable
[Corepack](https://nodejs.org/api/corepack.html) once so the pinned pnpm 11.7.0
from `package.json` is used automatically — do not install pnpm globally:

```text
corepack enable
pnpm install --frozen-lockfile
pnpm e2e:install
```

`engine-strict` in `.npmrc` rejects an unsupported Node or pnpm before install.

Do not commit generated output, local evidence, runtime databases, or secrets.

## Change discipline

- Add or update a failing regression test before fixing behavior.
- Keep SQLite migrations forward-only and preserve historical fixtures.
- Keep desktop persistence scoped to the single `main` window unless a tested
  revision/concurrency protocol is introduced.
- Treat provider keys, prompts, chats, cards, memory, and diagnostics as private.
- Update canonical docs and the [testing evidence ledger](docs/testing/README.md)
  when a public claim changes.

## Verification

During development, run the smallest relevant suite plus:

```text
pnpm typecheck
pnpm lint
pnpm test
```

Before a Windows release candidate or release-affecting pull request, run:

```text
pnpm verify:release
```

The full gate builds installers and performs a real current-user
install/reinstall/uninstall cycle. It refuses to alter a pre-existing local
installation.

Review `git diff`, document any skipped gate, and never claim hosted, signed,
notarized, clean-machine, or live-provider proof from a local substitute.
