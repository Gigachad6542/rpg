# Runtime Policy Contract Evidence

Date: 2026-07-14  
Scope: desktop write concurrency and stored-secret streaming behavior.

## Result

Two risks listed as undecided in the production plan were already resolved in
the implementation and are now protected against drift.

### Desktop writes

- Tauri declares exactly one window, labeled `main`.
- The persistence/secret capability applies only to `main`.
- Renderer TypeScript/TSX contains no WebView window construction.
- Rust source contains no WebView window builder.
- The existing snapshot save queue serializes/coalesces writes from the sole
  renderer.

The contract is therefore single-window/single-writer. A future second writable
window must introduce an explicit revision/concurrency protocol first.

### Stored-secret streaming

- `TauriStoredSecretTextProvider` exposes `generateText` but no `streamText`.
- `runTurnPipeline` streams only when the selected adapter exposes `streamText`;
  otherwise it uses request/response generation.
- Settings states that session-key/local providers may stream while desktop
  OS-keychain calls appear once complete.

## Verification

```text
pnpm exec vitest run tests/runtime/tauriCapabilities.test.ts tests/providers/tauriStoredSecretTextProvider.test.ts tests/app/SettingsSection.test.tsx
```

Result: 3 files / 12 tests passed.
