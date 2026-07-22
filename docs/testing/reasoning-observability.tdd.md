# Reasoning observability: TDD evidence

Date: 2026-07-20

## Scope

This change makes reasoning an explicit, inspectable property of the visible
Qwen3.7-Max call. It does not add another provider call and does not broaden the
two-model-call policy: the optional first call remains solely the windowed
`evidence-brief` analysis.

The behavior is intentionally asymmetric:

- memory-evidence extraction sends `reasoning.enabled=false`, preserving the
  accepted strict-JSON evaluation configuration;
- the player-visible Qwen3.7-Max call sends
  `reasoning.enabled=true` and `reasoning.exclude=false`;
- other models keep their existing provider defaults until model metadata says
  they support the same contract.

OpenRouter documents reasoning as part of the output-token budget and may
return plaintext, summary, encrypted, or no trace. Therefore the UI distinguishes
"requested", "observed", and token-count-confirmed reasoning instead of claiming
that every provider exposes a complete chain of thought. See the
[OpenRouter reasoning-token contract](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens).

## User journeys

1. As a player, I can inspect a completed visible call and tell whether reasoning
   was explicitly requested, observed, or confirmed by provider token accounting.
2. As a player, I can choose to reveal a returned trace only after seeing a
   private-memory/spoiler warning.
3. As a privacy-conscious user, I can reload the app knowing raw reasoning was
   not written into a prompt run, snapshot, export, memory, or the evidence brief
   passed between calls.
4. As a runtime maintainer, I get the same reasoning request and response shape
   through browser, streaming, and desktop OS-keychain provider paths.
5. As an eval owner, I can verify that call one remains reasoning-off while the
   visible Qwen call is reasoning-on and has enough total output headroom for
   reasoning plus prose.

## RED evidence

The first focused run deliberately failed 9 tests and passed 35. The failures
showed that non-streaming and streaming providers discarded reasoning fields,
the desktop command omitted the request, telemetry and UI had no proof state,
the visible call did not explicitly enable reasoning, and its 900-token total
output limit left inadequate headroom.

```powershell
pnpm exec vitest run tests/providers/openAICompatibleProvider.test.ts tests/providers/tauriStoredSecretTextProvider.test.ts tests/app/modelCallTelemetryAdapter.test.ts tests/app/useTurnGeneration.test.tsx tests/app/TurnDeltaPanel.test.tsx tests/app/modelCallRecordValidation.test.ts tests/runtime/modelCallBudget.test.ts
```

No checkpoint commit was created because the worktree already contained the
user's active uncommitted Phase 1.1 integration.

## GREEN implementation

- Added typed reasoning request/observation contracts and bounded extraction for
  `reasoning`, `reasoning_content`, `reasoning_details`, encrypted blocks, and
  provider-reported reasoning-token counts.
- Kept reasoning chunks separate from visible streamed text and aggregated them
  only in the model-call capture layer.
- Forwarded the request through the Tauri stored-secret boundary with strict
  effort/budget validation and provider-compatible `max_tokens` serialization.
- Increased the visible total output reservation to 4,000 tokens only when
  explicit Qwen reasoning is enabled; the evidence brief retains its existing
  1,000-token cap and reasoning-off contract.
- Persisted only safe proof (`request`, `observed`, `traceAvailable`, `encrypted`,
  `tokenCount`). Raw traces live in a 24-entry React session cache outside
  `PromptRun` and disappear on reload.
- Added a collapsed disclosure with an explicit spoiler/private-memory warning.

## Verification results

| Check | Result |
|---|---|
| Focused reasoning tests | PASS: 9 files / 49 tests |
| Full Vitest suite | PASS: 101 files / 737 tests |
| Coverage | PASS: 92.54% statements, 88.02% branches, 93.98% functions, 92.54% lines |
| TypeScript / ESLint | PASS |
| Rust tests | PASS: 35 passed, 1 signed-host keychain smoke intentionally ignored |
| Rust clippy | PASS with warnings denied |
| Production build | PASS |
| Phase 1 deterministic eval | PASS; non-fatal pre-existing Vite WebSocket port warning |
| Phase 1.1 deterministic gate | PASS; `liveCallsMade: 0` |
| Production dependency audit | PASS: no known vulnerabilities |
| Secret scan | PASS: no OpenRouter credential values in workspace sources |

An additional cache-boundary RED test failed 2/2 before the 24-trace session
limit was implemented. Its GREEN result is included in the final suite count.
A final UI RED test also proved that a provider report of zero reasoning tokens
was previously labeled ambiguously; GREEN now reserves "confirmed" for a
positive reasoning-token count.

## Interpretation and limits

Provider-reported reasoning tokens are the strongest available evidence that a
reasoning budget was consumed. A returned trace is useful for debugging, but it
is not a proof that the trace is complete, faithful to hidden computation, or
correct. Some routes return summaries or encrypted reasoning, and some expose
only token counts. This change proves request/transport/capture/privacy behavior;
it does not claim a new reasoning-quality uplift without a fresh paired live eval.
