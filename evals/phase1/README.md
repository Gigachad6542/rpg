# Phase 1 runtime eval corpus

`corpus.jsonl` is a 36-turn credential-free offline recording produced by the
production adapter and runtime modules. It runs the built-in mock adapter, the
OpenAI-compatible adapter against a loopback `fetch` response, and the Tauri
stored-secret adapter against an in-memory invoke response. No API key value is
created, loaded, logged, or committed.

This proves adapter shape, prompt/extraction flow, mutation policy, leak
detection, lore selection, and authoritative-event replay. It does **not** claim
live model quality or network performance. Offline latency is explicitly marked
`simulated`; mock usage is estimated; provider-shaped response usage is marked
`provider`. Live-provider evidence must use `source: live-provider`, measured
latency, reviewed pricing, and the same redaction contract.

The recorder covers twelve scenario classes for every provider path: grounded
and blocked mutation, safe and leaking knowledge, lore hit and false positive,
branch and regeneration continuity, hidden-off and economical modes, provider
failure, and prompt-injection resistance. The scorer recomputes observations
from runtime evidence rather than trusting stored observed labels.

Artifacts:

- `pricing.json` is the auditable offline pricing manifest. Synthetic rates are
  labeled as such; the stored-secret path remains unknown because key storage
  alone does not identify an underlying provider price.
- `manifest.json` records corpus/pricing hashes, recorder/scorer versions,
  adapter paths, scenario counts, and source files participating in the run.
- `baseline.json` retains aggregate and per-provider scorecards, including
  hidden/visible failures, usage, cost, proposals, mean/p50/p95 latency,
  mutation precision/recall, true leak rate plus detector quality, lore
  precision/recall/F1, and branch/regeneration continuity.

Run the gate:

```bash
pnpm eval:phase1
```

The command records a fresh corpus through the runtime, rejects corpus drift,
validates provenance and redaction, checks release thresholds, and compares the
scorecard and manifest with committed artifacts. It is included in normal and
release verification.

After intentionally reviewing a runtime, scenario, or pricing change, refresh
all three generated artifacts atomically:

```bash
pnpm eval:phase1:update
```
