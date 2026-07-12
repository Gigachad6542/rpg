# Turn-state provenance and review controls TDD evidence

## Scope

This is the Phase 1.2 continuation of the deterministic turn lineage documented in
`turn-state-lineage.tdd.md`. It covers provenance validation, visible state proposals,
variant-specific undo, consolidation approval, and portrait-generation consent.

## RED / GREEN checkpoints

| Behavior | RED | GREEN |
|---|---|---|
| Circular narration grounding and hidden-continuity gate | `52e2462` | `e45aeb0` |
| Active-variant undo | `d8e459f` | `e45aeb0` |
| Visible State changes panel | `22892fc` | `e45aeb0` |
| Variant/undo restore signatures | `74ac56c` | `e45aeb0` |
| Memory unchanged until approval | `267d312` | `cd90e4d` |
| Visible-text and user-mode portrait gate | `0644c66` | `7710691` |

## Guarantees

- Proposals carry `player-action`, `pre-turn-state`, `tool-result`, or
  `model-narration` provenance and an applied/blocked decision.
- Assistant narration alone cannot authorize inventory, health, entity, knowledge, or
  memory canon. Pre-turn state supports durable/idempotent facts, not transitions.
- Every assistant response can disclose what changed and why. Undo removes only the
  active variant's effects and refolds from the immutable lineage root.
- Consolidation displays current and proposed entries. Cancel changes nothing; Apply
  is rejected if the card or original memory changed while the review was open.
- Portrait mode is persisted and validated as `auto`, `confirm-first`, or `off`.
  Legacy settings default to confirm-first. An entity must occur as a complete name in
  visible user/assistant text before a prompt is prepared; only auto mode calls the
  image provider. Manual regeneration remains an explicit user action.

## Focused verification

- Provenance/undo checkpoint: 423 frontend tests, TypeScript, ESLint, Rust tests,
  Rust formatting/clippy, and the production frontend build passed.
- Memory review UI regression passed and verified browser persistence remains at four
  entries before acceptance, then changes to one only after Apply.
- Portrait policy unit tests, existing hidden-continuity UI coverage, automatic
  ComfyUI portrait coverage, renderer sanitizers, Rust snapshot sanitization, typecheck,
  ESLint, formatting, and clippy passed.

