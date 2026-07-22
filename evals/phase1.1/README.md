# Phase 1.1 two-pass memory influence eval

This lane tests when one private analytical call can educate a second visible
call. It replaces the old unscoped `off` / `economical` / `full` lane, which
never made a live call and gave its baseline the reference facts directly.

## Deterministic gate

```powershell
pnpm eval:phase1.1
```

This makes no network request and no model call. It validates the exact
Qwen3.7-Max configuration, six strategy arms, six memory challenges, three
repetitions, planned call count, and hard paid-run limits. It remains part of
`pnpm verify`.

## Prepare a live run

1. Copy `live-config.example.json` to the ignored
   `evals/phase1.1/artifacts/live-config.json`.
2. Re-check the current OpenRouter model id and pricing. Update the pricing
   snapshot if it changed, then set `readyForPaidRuns` to `true`.
3. Set `PHASE11_OPENROUTER_API_KEY` only in the local process environment. Do
   not put a key in JSON, source, a fixture, shell history, or an artifact.
4. Rotate any key that has been pasted into a task, chat, or log before treating
   results as release evidence.

Start with a bounded smoke run:

```powershell
pnpm eval:phase1.1:live -- --config .\evals\phase1.1\artifacts\live-config.json --output .\evals\phase1.1\artifacts\smoke.json --review-output .\evals\phase1.1\artifacts\smoke-review.json --strategies single-full,evidence-brief-full --scenarios superseded-lantern-rune --repetitions 1 --i-understand-this-makes-paid-calls
```

Then run the full exploratory matrix:

```powershell
pnpm eval:phase1.1:live -- --config .\evals\phase1.1\artifacts\live-config.json --output .\evals\phase1.1\artifacts\run.json --review-output .\evals\phase1.1\artifacts\review.json --i-understand-this-makes-paid-calls
```

The committed matrix is 180 calls: six scenarios × three repetitions × ten
calls across the six strategy arms. The runner rotates arm order and stops
before a request that would exceed the configured call, input-token,
output-token, or estimated-cost cap.

## Blind review

The review packet excludes tactic names and mode mappings. Rate every distinct
blind output on:

- memory fidelity;
- continuity;
- character consistency;
- player agency;
- prose quality.

For each packet pair, record the preferred blind id or `null` for a tie. Use
`quality-judgments.example.json` as the shape, ensuring every recorded output
has exactly one rating. Re-score without rerunning paid calls:

```powershell
pnpm eval:phase1.1:score -- --artifact .\evals\phase1.1\artifacts\run.json --judgments .\evals\phase1.1\artifacts\judgments.json --output .\evals\phase1.1\artifacts\run-rated.json
```

Pass `--config .\evals\phase1.1\live-config.example.json` to recompute the
deterministic checks from the current scoped rule grader before scoring. This
does not change model outputs or call telemetry. The scoring command makes no
provider call.

## Interpretation

- Compare `evidence-brief-full` and `legacy-continuity-full` to `single-full`.
- Compare `evidence-brief-window` to `single-window`, then check how closely it
  approaches `single-full`.
- If `analysis-discarded-full` improves too, suspect order, provider drift, or
  sampling noise rather than useful influence.
- Inspect brief correctness before interpreting final-output uplift. A bad brief
  that call two follows is amplification, not memory improvement.
- Prefer the simplest arm that clears correctness and blind-quality bars. A
  second call is unnecessary on short, obvious turns where `single-full`
  already passes consistently.

See [the research and failure analysis](../../docs/research/two-pass-memory-influence.md)
for the rationale behind this design.
