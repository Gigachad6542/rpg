# Phase 1.1: Live Quality and Retrieval eval definition

## Decision

Determine whether a second hidden continuity call materially improves live RPG
quality enough to justify its additional latency, tokens, and cost.

## Capability evals

1. Run identical synthetic scenarios in `off`, `economical`, and `full` modes
   against one strong hosted, one economical hosted, and one local
   OpenAI-compatible model.
2. Enforce exactly one visible call for `off`, and exactly one hidden plus one
   visible call for `economical` and `full`.
3. Preserve hidden and visible TTFT (when available), duration, usage, exact or
   estimated cost, failures, proposals, and blind quality score separately.
4. Require an exact-model pricing snapshot for both visible and routed
   economical models before a live run starts.
5. Serialize only schema-validated, credential-redacted artifacts.
6. Score subjective quality by blind pairwise preference while keeping state,
   safety, knowledge, and leak checks deterministic.

## Regression evals

1. Lore activation precision is at least 0.90 and recall is at least 0.95 on
   80-120 labeled decisions.
2. Ordinary literal keys do not match inside unrelated words.
3. Explicit legacy substring matching remains available.
4. Alias matches, broad-key secondary requirements, editor warnings, and
   trigger provenance are inspectable.
5. Three 50-100-turn campaign fixtures each cover edit, regeneration, branch,
   restart, and model switching.
6. Paid calls remain opt-in and are absent from `pnpm verify`; deterministic
   artifact, lore, and fixture validation is included in `pnpm verify`.

## Exit bars

- Lore precision >= 0.90 and recall >= 0.95.
- Safety and state-correctness checks require `pass^3` before release use.
- Narrative improvements are reported as pairwise preference and score deltas
  versus `off`; no minimum is claimed until real live evidence exists.
- No provider key, authorization header, credential-bearing URL, or raw private
  prompt is written to an artifact.
