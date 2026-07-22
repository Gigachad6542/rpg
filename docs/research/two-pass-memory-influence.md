# Two-pass model calls for RPG memory: research and test redesign

Date: 2026-07-19

## Executive conclusion

A first model call can improve a second call when it performs a concrete
information-processing job that the visible call would otherwise do poorly:
finding facts in distracting history, resolving updates, tracking who knows
what, joining clues, identifying missing evidence, or compressing a larger
history into a smaller context budget. It is not automatically better merely
because the model “thought twice.”

For this project, the most promising tactic is a source-cited evidence brief:
call one reads the authoritative active-branch context and emits a compact,
structured, explicitly fallible brief; call two receives the original recent or
full context plus that brief and writes the player-facing response. The first
call is a within-turn analytical workspace, not durable memory. It becomes
long-term memory only after local validation and persistence.

The old test could not show this value. It made no live calls, leaked the answer
key to the one-call baseline, used trivial two-message histories, did not retain
the hidden output, had no repeated paired samples or placebo arm, and mixed
unrelated lore/fixture shape checks into the purported quality result.

## When a second call is useful or necessary

### Strong use cases

1. **Context pressure and selective compression.** Call one can inspect a wider
   history while call two sees a recent window plus a concise brief. This is
   valuable when the full transcript would exceed the practical input budget or
   bury the answer in noise. Long-context models can perform worse when relevant
   information sits in the middle, even when it technically fits in the context
   window ([Lost in the Middle](https://arxiv.org/abs/2307.03172)).

2. **Knowledge updates and temporal state.** RPG facts are frequently revised:
   an item is consumed, a deadline moves, a route changes, or an NPC learns a
   secret. LongMemEval treats information extraction, multi-session reasoning,
   temporal reasoning, knowledge updates, and abstention as distinct memory
   abilities and reports a substantial long-history accuracy drop
   ([LongMemEval](https://arxiv.org/abs/2410.10813)). A brief can explicitly mark
   active, superseded, and uncertain evidence.

3. **Speaker-specific beliefs.** A narrator may know a fact that an NPC does
   not. A dedicated analysis pass can build a per-entity knowledge boundary
   before prose generation, preventing subtle leaks that a generic summary
   would miss.

4. **Multi-hop scene reasoning.** When the next action depends on several facts
   scattered across turns, call one can join them into an actionable plan. This
   is decomposition: analysis first, realization second. Plan-and-Solve reports
   benefits from explicitly planning subtasks before solving
   ([Plan-and-Solve](https://arxiv.org/abs/2305.04091)).

5. **Abstention and contradiction checks.** The first call can state that the
   evidence is insufficient or conflicting. This gives call two a positive
   instruction to preserve uncertainty instead of filling a narrative gap.

6. **Periodic reflection for durable memory.** Reflection can synthesize many
   observations into higher-level memory used in later planning. Generative
   Agents combined observation, retrieval, reflection, and planning, and its
   ablations found each component contributed to believable behavior
   ([Generative Agents](https://arxiv.org/abs/2304.03442)). This is best done at
   meaningful boundaries or thresholds, not blindly on every trivial turn.

### Cases where it is usually unnecessary

- the needed fact is recent, explicit, and already in the visible prompt;
- deterministic retrieval or the local state ledger already supplies a compact
  authoritative answer;
- the user asks for short low-stakes prose with no continuity dependency;
- latency is more important than a small possible quality gain;
- call one has no broader evidence, tool feedback, verifier signal, or useful
  specialization relative to call two;
- the visible model already passes the relevant task reliably with full context.

The default should therefore be conditional routing, not “two calls always.”

## Advantages when used correctly

- **Attention steering:** the visible model receives a small list of relevant
  evidence instead of having to rediscover it while writing prose.
- **Compression:** old but important facts can survive a tight recent-history
  window without sending the entire transcript twice to call two.
- **Role specialization:** call one optimizes fidelity and constraint discovery;
  call two optimizes voice, pacing, agency, and readable narration.
- **Inspectable failure analysis:** a retained brief reveals whether a bad final
  answer came from retrieval/analysis failure or from failure to use a good brief.
- **Safer uncertainty:** an explicit `uncertain` state can reduce narrative
  guessing and wrongful promotion of suspicion to fact.
- **Model routing opportunity:** after the tactic is proven, analysis could be
  routed to a cheaper model, but only after measuring fidelity; this experiment
  deliberately holds the model constant to isolate the tactic itself.

## Risks and why “thinking twice” is not enough

The same model can repeat or amplify its own error. Self-Refine shows that
feedback-and-refinement loops can improve diverse outputs, but its mechanism
starts from an initial output and then critiques/refines it; the current RPG
pipeline instead analyzes context before generating prose, so its result cannot
be borrowed as direct proof ([Self-Refine](https://arxiv.org/abs/2303.17651)).

Conversely, work on intrinsic self-correction found that asking a model to
correct itself without external feedback can fail or degrade reasoning
([Huang et al., ICLR 2024](https://openreview.net/forum?id=IkmD3fKBPQ)). The
practical lesson is to ground call one in source-tagged external evidence and
measure its correctness separately. Vague “reflect and improve” prompting is an
uncontrolled extra sample, not a memory system.

Other risks are:

- hallucinated or overgeneralized briefs that call two trusts;
- loss of nuance during compression;
- stale facts surviving without supersession markers;
- private information leaking from the brief into visible prose;
- prompt injection inside story data;
- flatter prose when an overlong plan overconstrains generation;
- doubled latency and additional input/output cost;
- correlated evaluation bias when the generator and judge are the same model.

## Why the previous testing was faulty

### It measured plumbing, not value

`pnpm eval:phase1.1` only validated schemas, a lore corpus, and declared campaign
fixture counts. No OpenRouter request or other model call occurred, and no live
artifact exists in the workspace. Passing that command proved that the harness
shape was internally consistent; it did not prove narrative or memory uplift.

### The baseline received the answer key

Every old scenario copied `referenceFacts` into both the card summary and the
visible model's trusted knowledge-boundary block. The `off` arm therefore saw
the same decisive facts that call one was supposed to discover. There was no
missing salience, compression, update, or inference problem left to solve.

### The scenarios were too easy and too short

Each scenario had one user/assistant history pair. That does not exercise
long-term memory, facts in the middle, distractors, supersession, multi-hop
reasoning, or abstention. The separate “50–100 turn” fixtures expanded declared
defaults in memory but never ran those turns through a model.

### The causal mechanism was invisible

The live artifact stored only a proposal count for the hidden phase. It did not
retain the hidden brief, grade its factual coverage, or measure whether a
correct brief reached the final answer. A bad analyzer, a good analyzer ignored
by call two, and a good end-to-end pipeline were observationally conflated.

There was also no analysis-discarded placebo. Without it, any difference could
come from ordering, provider drift, or sampling rather than the content passed
from call one to call two.

### It lacked experimental controls

- one sample per scenario/mode/profile;
- fixed execution order;
- no common seed across paired visible calls;
- unpaired global quality means rather than scenario/repetition comparisons;
- no rescue-versus-harm accounting;
- no completeness requirement for ratings;
- sequential blind ids and a combined artifact that made unblinding easy;
- no strategy-blind review packet;
- no confidence or stability bar.

LLM judges also exhibit presentation-order bias. RLAIF mitigated this by judging
both candidate orders and combining results
([RLAIF](https://arxiv.org/pdf/2309.00267)). The rebuilt packet deterministically
counterbalances left/right order; a future automated judge should still score
both orientations and treat inconsistent preferences as ties.

### The runner diverged from production behavior

The old live runner did not apply hidden continuity to its temporary card in the
same way as the application, yet labeled memory updates as already saved in the
visible prompt. Malformed-but-parseable hidden results could also appear as a
successful call without any quality signal. The new lane preserves the legacy
arm for comparison but adds an explicit source-cited tactic and grades the
brief itself.

## Rebuilt experiment

The six arms and decision logic are specified in
[`evals/phase1.1/definition.md`](../../evals/phase1.1/definition.md). The key
causal comparisons are:

1. `evidence-brief-full` − `single-full`: does structured analysis improve a
   fair full-context baseline?
2. `evidence-brief-window` − `single-window`: does call one recover information
   unavailable to a compact visible context?
3. `legacy-continuity-full` − `single-full`: does the current tactic help?
4. `analysis-discarded-full` − `single-full`: is any apparent gain actually due
   to the brief?
5. `evidence-brief-window` versus `single-full`: how much full-context quality is
   retained by compression?

Each run scores source-grounded brief coverage, final-output correctness,
rescues, harms, transmission, latency, tokens, and cost. Blind review separately
measures memory fidelity, continuity, character consistency, agency, and prose.

## Live Qwen3.7-Max result

The accepted v2 run on 2026-07-19 contained 108 strategy runs and 180 provider
calls (six scenarios, six arms, three repetitions). The deterministic checks
were regraded offline after expanding two demonstrably correct privacy wording
variants; model outputs and call telemetry were not changed. Three upstream 429
responses remain visible in reliability counts and are excluded only from the
paired causal comparison. No credential material was present in the artifacts.

| Strategy | End-to-end strict pass | Brief pass | Paired result versus baseline | Added latency / cost per evaluated turn |
|---|---:|---:|---|---:|
| `single-full` | 16/18 (88.9%) | n/a | baseline | n/a |
| `single-window` | 12/18 (66.7%) | n/a | baseline | n/a |
| `analysis-discarded-full` | 17/18 (94.4%) | 18/18 | 2 rescues, 0 harms across 17 infrastructure-clean pairs | +12.6 s / +$0.00335 |
| `legacy-continuity-full` | 17/18 (94.4%) | 11/18 (61.1%) | 1 rescue, 0 harms | +33.5 s / +$0.00981 |
| `evidence-brief-full` | 16/18 (88.9%) | 17/18 (one 429) | 2 rescues, 1 harm across 17 infrastructure-clean pairs | +16.7 s / +$0.00439 |
| `evidence-brief-window` | 18/18 (100%) | 18/18 (100%) | **6 rescues, 0 harms; +33.3 points** | +12.1 s / +$0.00404 |

The windowed uplift came entirely from the two capabilities for which the
recent-message window omitted decisive earlier state: knowledge supersession
and a revised temporal deadline. Both moved from 0/3 to 3/3. Knowledge boundary,
multi-hop, abstention, and constraint-application cases were already 3/3 in the
window baseline after the corrected rule grading, so the extra call added no
measured correctness there. All six discordant window pairs favored the brief
(exact two-sided McNemar p = 0.03125), but the corpus is deliberately small and
scenario-focused; this is evidence for a routing policy, not a universal model
claim.

The full-history result does not justify a general second call. Its net movement
was smaller than the discarded-analysis placebo, showing that sampling/provider
variance is large enough to explain it. The legacy pass was slower, more
expensive, and much less reliable at extracting the explicitly graded evidence.
Blind prose and agency ratings remain pending, so the quality conclusion is
limited to deterministic memory correctness.

The optimal policy supported by this run is therefore conditional:

- use one call when call two already receives the authoritative full context or
  deterministic local state supplies the needed facts;
- use the compact source-cited brief when call two is intentionally windowed
  and older updates/deadlines may be relevant;
- do not persist the brief as durable memory until local validation accepts it;
- retain fallbacks and telemetry for transient provider failures.

The accepted full run recorded $1.1480 of known provider cost; three 429 calls
had unavailable usage. Including diagnostic smoke, the excluded pilot, the
six-scenario acceptance sweep, and the final run, known experimental spend was
approximately $2.44.

## Qwen3.7-Max selection

OpenRouter currently lists the exact slug `qwen/qwen3.7-max`, a one-million-token
context window, JSON/structured-output and seed support, and per-token pricing in
its public model catalog ([OpenRouter model catalog](https://openrouter.ai/api/v1/models),
[model page](https://openrouter.ai/qwen/qwen3.7-max)). The committed snapshot is
dated 2026-07-19 and must be rechecked before each paid run because provider
pricing is mutable.

The harness uses strict JSON Schema output for the evidence brief, disables
unnecessary reasoning in that extraction call, shares a visible seed within
each scenario/repetition pair, rotates execution order, and enforces maximums
for calls, estimated input/output tokens, and estimated spend.

### Observable reasoning is evidence, not certainty

OpenRouter's current catalog marks `qwen/qwen3.7-max` as reasoning-capable and
enabled by default, but production sends `reasoning: { enabled: true,
exclude: false }` explicitly so the request is auditable rather than dependent
on a mutable default. OpenRouter may return plaintext reasoning, a summary,
encrypted reasoning details, or no readable trace; it can also report
`completion_tokens_details.reasoning_tokens`. Reasoning tokens are part of the
total output-token budget and are billed as output
([OpenRouter reasoning tokens](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens),
[model catalog](https://openrouter.ai/api/v1/models)).

The runtime consequently separates four questions:

1. Was reasoning explicitly requested?
2. Did the provider return any reasoning evidence?
3. Did provider usage confirm a non-zero reasoning-token count?
4. Is there a readable trace for this session?

This is stronger than inferring thought from a polished answer, but it is not a
mathematical proof that the visible trace is complete, faithful, or correct.
Actual quality still requires paired task outcomes. The trace is therefore a
private diagnostic surface, not a prompt ingredient or durable memory record.

## What would justify a production change

The experiment should not auto-enable the second call after one favorable run.
The evidence-brief tactic becomes a product candidate only if it repeatedly:

- rescues more failed baselines than it harms successful ones;
- produces faithful briefs and transfers them into correct responses;
- prevents leakage, stale-fact reuse, and unsupported certainty;
- beats the legacy tactic on the challenge types that matter;
- preserves blind-rated prose and agency;
- stays within an accepted latency/cost envelope.

If benefit concentrates in `single-window` failures, the optimal policy is a
conditional context-pressure/reflection trigger. If full-context uplift is
consistent too, the trigger can expand to high-risk knowledge-update,
multi-hop, boundary, and abstention turns. If neither comparison clears the
bars, the correct result is to keep one call and invest in deterministic
retrieval/state compilation instead.
