# Phase 1.1: Two-pass memory influence eval definition

## Decision

Determine when a first analytical model call gives Qwen3.7-Max a useful,
faithful private brief that improves a second player-facing RPG response enough
to justify the added latency, tokens, and cost.

This is not a generic one-call/two-call test. It isolates three questions:

1. Does the first call correctly identify the memory evidence needed by call two?
2. Does passing that brief cause call two to improve, rather than the extra call
   merely correlating with a different sample or execution order?
3. Is the best tactic different when call two has the full transcript versus a
   deliberately limited recent window?

## Strategies

| Strategy | Calls | Context available to call two | Purpose |
|---|---:|---|---|
| `single-full` | 1 | Full active-branch transcript | Full-context baseline |
| `single-window` | 1 | Recent message window | Context-pressure baseline |
| `analysis-discarded-full` | 2 | Full transcript; call-one output withheld | Placebo/control for causal influence |
| `legacy-continuity-full` | 2 | Full transcript plus the current production continuity payload | Measures the existing tactic |
| `evidence-brief-full` | 2 | Full transcript plus a source-cited evidence brief | Tests attention/decomposition value |
| `evidence-brief-window` | 2 | Recent window plus a brief made from the full transcript | Tests memory compression value |

All calls use the exact OpenRouter model id `qwen/qwen3.7-max`. Visible calls
share a scenario/repetition seed across strategies, and strategy execution order
rotates across scenarios and repetitions.

## Challenge coverage

The committed corpus has one focused scenario for each memory capability:

- speaker-specific knowledge boundaries;
- newer facts superseding stale memory;
- multi-hop composition of distributed clues;
- revised deadlines and temporal planning;
- abstention when the story has not established an answer;
- application of multiple durable physical/social constraints.

The answer key is used only by local graders. It is never inserted into card
summary, durable memory, prompts, or the first-call brief.

## Measurements

Each run retains, separately:

- the redacted first-call influence text;
- atomic pass/fail checks for the influence and visible response;
- strict visible pass (all visible checks pass);
- model, phase, failure, duration, usage provenance, and exact-snapshot cost;
- blind id, repetition, and execution order.

The scorecard reports:

- strict and per-check pass rates;
- first-call influence pass rate;
- transmission rate: visible strict pass conditional on a correct brief;
- paired rescues and harms versus the correct baseline;
- paired pass-rate, token, duration, and cost deltas;
- blind human quality mean and pairwise preference when judgments exist;
- results split by memory challenge.

Pairs containing a provider-call failure remain in end-to-end reliability
counts but are excluded from causal quality deltas. The failure and unknown cost
remain visible in call summaries. Deterministic checks can be re-applied offline
from the current config without changing model outputs or telemetry.

## Decision bars

No tactic is recommended from a single sample. The committed three repetitions
are an exploratory `pass^3` stability floor, not a universal model claim.

A two-pass tactic is a candidate for production only when:

1. it has more paired rescues than harms and a positive strict-pass delta;
2. its first-call influence checks pass reliably, with no private-fact leakage
   or obsolete-fact regressions;
3. the placebo arm does not show the same uplift;
4. blind human preference and quality do not reveal a prose/agency tradeoff;
5. the measured latency and cost fit the product budget.

`evidence-brief-window` must be compared to both `single-window` (incremental
benefit) and `single-full` (quality retained under compression). A full-context
brief that does not beat `single-full` should remain off for ordinary short
turns, even if the compact variant helps under context pressure.

## Safety and operations

- Paid calls require `readyForPaidRuns: true`, an explicit CLI acknowledgement,
  an environment-only key, exact endpoint/model validation, and hard call/token/
  cost caps.
- Config and artifacts reject raw credential material.
- The committed deterministic lane makes zero network or model calls.
- Review packets contain context, rubrics, blind ids, and outputs, but no tactic
  mapping. Candidate order is deterministically counterbalanced.

## Accepted exploratory result (2026-07-19)

The valid v2 matrix completed 108 runs and 180 calls. After offline rule regrade,
`evidence-brief-window` passed 18/18 versus 12/18 for `single-window`, with six
rescues, zero harms, 18/18 correct briefs, +12.1 seconds mean latency, and
+$0.00404 mean cost per paired turn. The gains were exactly the knowledge-update
and temporal cases whose decisive facts fell outside the recent window.

`evidence-brief-full` matched the 16/18 end-to-end `single-full` result. Its
infrastructure-clean comparison (two rescues, one harm) was weaker than the
full-context discarded-analysis placebo, so it is not evidence for enabling a
second call when full authoritative context is already present. Blind prose and
agency review is still pending; production enablement should therefore be a
window-pressure candidate, not an unconditional default.
