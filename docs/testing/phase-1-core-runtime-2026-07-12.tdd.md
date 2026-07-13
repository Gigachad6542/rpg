# Phase 1 Core Runtime TDD Evidence

Date: 2026-07-12

## Outcome

The runtime now implements the complete Phase 1 contract in
`docs/product/phase-1-core-runtime.md`: explicit one/two-call continuity modes,
per-phase telemetry and cost provenance, model-derived context budgets,
required knowledge boundaries, typed branch-scoped events, rolling summaries,
scoped hybrid retrieval, and a release-gated 36-turn runtime recording.

## Fixed call contract

- `off`: one visible-response model call.
- `economical`: one hidden-continuity call on the configured economical model,
  then one visible-response call on the selected model.
- `full`: one hidden-continuity call and one visible-response call on the
  selected model.
- Summary maintenance, retrieval, deterministic rules, dice, event replay, and
  eval scoring are local operations and add no provider calls.

## RED / GREEN trail

| Contract | RED evidence | GREEN guarantee |
| --- | --- | --- |
| Full Phase 1 surface | `3562f48` | Required modules, settings, persistence, eval artifacts, and integration paths exist |
| Mode-aware call count | `08d0910` | Off is one call; economical/full are two calls with phase-specific models |
| Exact model metadata and pricing | `0c0a36a` | Budgets resolve for the routed model; unknown models/prices remain explicit fallbacks |
| Durable secure telemetry | `b8da091`, `cd71f83`, `4742ddd`, `02dbdf1` | Tokens, phase duration, usage source, known/estimated/unknown cost, failure, and proposals validate and round-trip without secrets |
| Typed event integration | `faee267`, `1ba2eb8`, `8160fe0` | Player actions, rules, dice, tools, and state commits replay by branch/variant; edits and rebases drop stale derived events |
| Scoped continuity context | `03d53c2` | Reconciled summaries and provenance-filtered lexical/feature-hash retrieval use real score/count/character budgets |
| Runtime-derived scorecard | `be9baef` | The gate re-records production adapter/runtime paths and derives observations from runtime evidence |
| Streaming and required boundaries | `d58fb59`, `8350a22` | Telemetry preserves streaming, incomplete streams fail closed, and a required knowledge boundary is always present |

The final adversarial review also reproduced and closed four late blockers:
hidden-abort telemetry loss, exact-zero failed-call cost, commit-after-provider-error,
and incomplete-stream success. Their regression tests are included in the final
suite rather than being waived.

## Recorded eval evidence

The committed corpus contains 36 credential-free runtime recordings: 12
scenarios each through the built-in mock, OpenAI-compatible fetch, and Tauri
stored-secret invoke adapter paths. Transports and latency are deterministic;
no provider credential is created or read.

| Metric | Result |
| --- | ---: |
| Mutation precision / recall | 1.00 / 1.00 |
| Leak detector precision / recall | 1.00 / 1.00 |
| Deliberate output leak rate | 0.0833 |
| Lore precision / recall / F1 | 0.50 / 1.00 / 0.6667 |
| Branch / regeneration continuity | 1.00 / 1.00 |
| Hidden calls | 33 attempts, 2 failures, 21,647 tokens, 6 proposals (3 applied / 3 blocked) |
| Visible calls | 36 attempts, 1 failure, 12,431 tokens, 12 proposals (6 applied / 6 blocked) |

Corpus SHA-256:
`8671e1ce785651d38c3ba4b986e19ff8197833fdd4d2f3395a7efae5c32a7483`.

## Verification

| Command | Result |
| --- | --- |
| `pnpm typecheck` | PASS |
| `pnpm lint` | PASS |
| `pnpm test` | PASS: 66 files / 582 tests |
| `pnpm test:coverage` | PASS: 92.73% statements/lines, 88.65% branches, 94.99% functions |
| `pnpm eval:phase1` | PASS: fresh recording equals corpus, baseline, pricing, and manifest hashes |
| `pnpm build` | PASS |
| `pnpm audit:prod` | PASS: no known production dependency vulnerabilities |
| `pnpm rust:test` | PASS: 32 tests |
| `pnpm rust:clippy` | PASS with warnings denied |
| `pnpm rust:audit` | Exit 0 with 18 allowed upstream warnings, including unmaintained/yanked transitive crates and a `glib` unsoundness advisory |
| `pnpm verify` | PASS: complete local CI gate |

## Honest limitations and next quality targets

- The corpus proves deterministic runtime and adapter integration. It does not
  claim live-model quality, current provider latency, or current commercial
  pricing.
- Lore precision is 0.50 because the corpus deliberately exposes an overbroad
  key false positive. Tightening lore activation without losing recall is the
  clearest measured Phase 1 quality target.
- The local semantic component is a deterministic concept lexicon plus feature
  hashing, not a neural embedding model.
- Phase duration includes provider execution plus local parsing/policy work; it
  is labeled accordingly rather than presented as network-only latency.
- When the economical hidden model differs from the visible model, its cost is
  honestly unknown unless exact pricing is available for that routed model.
