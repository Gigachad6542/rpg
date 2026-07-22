# Chat Quality Evaluation: Dialogue Examples

Status: defined; live comparative runs have not been performed.

## Purpose

Measure whether dialogue examples make conversations more character-specific and
lifelike without weakening player agency, continuity, or prompt efficiency.

This is a held-out product evaluation. Text in this directory must never be
included in the generation prompt. Card-owned `exampleDialogs` are prompt
exemplars; the scenarios, reference notes, ratings, and preferences here are
evaluation evidence.

## Strategies

- `examples-off`: omit card dialogue examples.
- `examples-all`: include the raw card field in the required character definition
  (legacy behavior).
- `examples-selective`: parse the raw field, retrieve up to three scene-relevant
  exchanges, and include them in an optional/trimmable style-demonstration layer.

Use the same provider, exact model, card, initial state, generation settings, and
user turns for every strategy. Blind strategy names before review. Randomize
presentation order and run at least three repetitions per scenario.

## Initial held-out scenario families

1. **Distinct voice**: two characters must respond differently to the same social
   pressure without relying on catchphrase repetition.
2. **Subtext**: a character suspects a lie but cannot prove it; the response should
   communicate guarded suspicion without inventing facts.
3. **Emotional progression**: concern should develop into urgency across several
   turns while core identity remains stable.
4. **Relationship boundary**: familiarity or trust must influence tone without
   inventing a relationship state unsupported by the transcript.
5. **Grounded initiative**: the character should change the situation or pursue a
   goal without deciding the player's actions, dialogue, thoughts, or emotions.
6. **Non-repetition**: repeated scene conditions must not produce the same gesture,
   cadence, opening clause, or closing pattern on every turn.
7. **Example conflict**: an old exemplar fact conflicts with current continuity;
   current card, memory, lore, and chat evidence must win.
8. **No lexical match**: selective mode may use one style anchor, but must not copy
   its events or wording into an unrelated scene.

## Rating dimensions

Rate each dimension from 1 (clear failure) to 5 (excellent). Review the full
multi-turn conversation, not isolated turns.

- **Voice fidelity**: recognizable vocabulary, cadence, priorities, and manner
  without mechanical mimicry.
- **Emotional coherence**: affect changes appropriately with events and does not
  remain rigid or drift without cause.
- **Social responsiveness**: the character accounts for relationship, publicness,
  stakes, and conversational subtext supported by the scene.
- **Grounded initiative**: the character contributes intentions and consequential
  behavior while preserving player agency.
- **Continuity fidelity**: current facts and knowledge boundaries override exemplar
  events and stale information.
- **Prose quality**: specific, engaging, fluent, and appropriately paced.
- **Non-repetition**: gestures, sentence shapes, scene restatement, and endings vary
  naturally across the dialogue.
- **Overall preference**: which complete conversation would the reviewer choose to
  continue, or tie.

## Required automatic evidence

For every generated run, retain the blinded run ID, strategy, model identity,
prompt token estimate, selected prompt-layer IDs, selected example IDs or hashes,
latency, output token count, visible response, and existing continuity/agency
warnings. Do not persist private provider reasoning.

## Acceptance gates

- Existing deterministic Phase 1 and Phase 1.1 gates remain green.
- `examples-selective` does not reduce mean player-agency or continuity ratings by
  more than 0.10 versus either baseline.
- `examples-selective` is preferred over `examples-all` in at least 60% of non-tied
  blind comparisons across at least 24 scenario/repetition pairs.
- Mean voice fidelity, social responsiveness, and non-repetition do not regress
  versus `examples-off`; at least two improve by 0.25 or more.
- On cards containing more than three parsed examples, selective mode uses fewer
  prompt tokens than all-example mode in at least 90% of runs.
- Example-conflict scenarios have zero exemplar-to-continuity leakage.

No strategy should become the default on subjective ratings alone. Review the
paired outputs and failure notes before changing the backward-compatible default.
