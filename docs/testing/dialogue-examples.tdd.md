# Selective Dialogue Examples: TDD Evidence

Date: 2026-07-21

## Source and user journeys

Journeys were derived from the codebase-wide chat-quality audit rather than a
separate plan file.

- As an existing card user, I want legacy prompts and `mes_example` round-tripping
  to remain unchanged unless I opt into new behavior.
- As a player, I want the runtime to choose examples relevant to the current scene
  so unrelated example events do not crowd or contaminate the prompt.
- As a player, I want dialogue examples to be optional.
- As a maintainer, I want selected examples to be bounded, trimmable, deterministic,
  and explicitly separated from held-out quality evaluations.

## RED evidence

Before production changes:

```text
pnpm exec vitest run tests/runtime/dialogueExamples.test.ts \
  tests/app/dialogueExamplePrompting.test.ts \
  tests/app/SettingsSection.test.tsx

Result: 3 test files failed. The parser module was absent, examples remained in the
required character definition for every mode, and no Dialogue examples UI existed.
```

```text
pnpm exec vitest run tests/app/dialogueExampleSettings.test.ts

Result: 3/3 failed. The mode had no backward-compatible default, persistence
sanitization, or hydration behavior.
```

These were intended capability failures, not setup or syntax failures.

## GREEN evidence

| Guarantee | Test target | Type | Result |
|---|---|---|---|
| Player/character and Tavern `<START>` formats parse into stable examples | `tests/runtime/dialogueExamples.test.ts` | Unit | PASS |
| Relevant local selection excludes unrelated exchanges | `tests/runtime/dialogueExamples.test.ts` | Unit | PASS |
| No-match scenes receive at most one bounded style anchor | `tests/runtime/dialogueExamples.test.ts` | Unit | PASS |
| Selected examples are labeled as style, not continuity | `tests/runtime/dialogueExamples.test.ts` | Unit | PASS |
| Missing setting preserves legacy all-example behavior | `tests/app/dialogueExamplePrompting.test.ts` | Integration | PASS |
| Selective mode uses an optional, trimmable prompt layer | `tests/app/dialogueExamplePrompting.test.ts` | Integration | PASS |
| Off mode omits examples from compiled prompts | `tests/app/dialogueExamplePrompting.test.ts` | Integration | PASS |
| Supported modes sanitize, persist, and hydrate; unknown modes do not | `tests/app/dialogueExampleSettings.test.ts` | Unit | PASS |
| Settings UI exposes all, selective, and off behavior | `tests/app/SettingsSection.test.tsx` | Component | PASS |

Focused GREEN command: 15/15 tests passed across 4 files.

Full regression command: `pnpm test` passed 757/757 tests across 104 files after the repository test-contract cleanup.
`pnpm typecheck` and `pnpm lint` passed. Both deterministic eval harnesses passed
without live model calls. Rust tests passed 36 tests with the signed OS-keychain
smoke test intentionally ignored; Clippy passed with warnings denied.

## Coverage

`pnpm test:coverage` passed:

- Statements: 92.59%
- Branches: 88.18%
- Functions: 93.98%
- Lines: 92.59%
- New `dialogueExamples.ts`: 85.06% statements, 81.63% branches, 90% functions

## Implementation boundaries and known gaps

- The default remains `all` for backward compatibility. Selective mode is marked
  experimental and requires explicit opt-in.
- Existing raw `exampleDialogs` remains the storage and import/export authority;
  examples are structured at prompt time, so no card or SQLite migration is needed.
- Selection is deterministic and local, capped at three examples and 3,200 source
  characters, then protected by the prompt compiler's optional/trimmable budget.
- This change proves prompt plumbing and selection behavior. It does not yet prove
  that selective examples improve subjective conversation quality. The held-out
  evaluation contract is in `evals/chat-quality/definition.md` and still requires
  blinded live outputs and human judgments.
- No Git checkpoint commits were created because the shared working tree already
  contained unrelated user changes; RED/GREEN evidence is preserved here instead.
