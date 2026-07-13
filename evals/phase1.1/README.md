# Phase 1.1 live quality and retrieval evals

This lane answers one product question: does the hidden continuity call improve
the visible RPG experience enough to justify its added latency, tokens, and
cost?

## Deterministic gate

`pnpm eval:phase1.1` makes no network requests and no model calls. It validates:

- the three-profile and `off` / `economical` / `full` experiment contract;
- 100 labeled lore decisions with precision >= 0.90 and recall >= 0.95;
- three expanded 50-100-turn campaign fixtures with edit, regeneration,
  branch, restart, and model-switch coverage.

This command is included in `pnpm verify`.

## Live opt-in runner

Copy `live-config.example.json` outside the committed example or into the
ignored `evals/phase1.1/artifacts/` directory. Replace every placeholder model,
endpoint, price, source, and effective date, then set `readyForPaidRuns` to
`true`. Hosted credentials are read only from the named environment variables;
raw keys are rejected in config and artifacts.

The example contains zero-valued placeholder rates only so its schema and exact
model mapping can be tested. They are not commercial pricing and the live
runner refuses them.

Run explicitly:

```powershell
pnpm eval:phase1.1:live -- --config .\evals\phase1.1\artifacts\live-config.json --output .\evals\phase1.1\artifacts\run.json --i-understand-this-makes-paid-calls
```

The runner executes identical scenarios for all three modes and profiles. It
enforces one visible call for `off`, and one hidden plus one visible call for
`economical` and `full`. Retrieval, rules, summaries, scoring, and artifact
writing remain local. Each phase records model, status, TTFT when streaming
exposes it, total duration, provider or estimated usage, exact or estimated
cost, failure category, and proposal count.

The scorecard also computes each two-call mode's mean added tokens, end-to-end
duration, and cost per run versus `off`. Cost deltas preserve `known`,
`estimated`, or `unknown` provenance instead of treating partial prices as an
exact comparison.

Outputs are assigned neutral `blindId` values. A reviewer should score only the
blind id and visible output, without the mode mapping. Copy
`quality-judgments.example.json`, replace its ids with ids from the run, and add
it with `--judgments` to calculate five-dimension quality means and pairwise
preference against `off`.

The five 1-5 dimensions are coherence, agency, repetition (5 means no harmful
repetition), pacing, and character consistency. Deterministic state, event,
knowledge, and leak checks remain authoritative and should be repeated to
`pass^3`; subjective narrative quality is reported as blind score and pairwise
preference, not as a safety gate.

No live baseline is committed yet. A baseline is legitimate only after a
reviewed configuration and real runs complete; this infrastructure does not
invent a quality gain in their absence.
