# Browser Critical-Journey Evidence

Date: 2026-07-14  
Scope: release-gate browser acceptance beyond the original single seeded-card
smoke.

## Result

The Chromium acceptance lane now has four independent journeys. All four passed
in 6.2 seconds with four local workers.

## Characterization contracts

This slice adds release coverage for already-implemented behavior; it does not
claim new product functionality. The added tests proved:

1. A fresh user can select **Start mock demo**, land directly in Ashfall
   Crossing with the mock provider and onboarding completed, make a turn with no
   network key, reload, and retain the transcript.
2. A fresh user can apply the **Choice-driven mystery** template, create a custom
   RPG card, reload the browser, and retain its type, summary, and active state.
3. The memory inspector initially focuses its close button, traps Tab when it is
   the only enabled control, closes on Escape, and restores focus to the opener.
4. A downloaded runtime export can be parsed into the review surface and then
   cancelled without changing the active runtime.

The original seeded blank-card smoke remains and continues to verify mock-turn
persistence plus compiled-prompt privacy.

## Verification

```text
pnpm e2e
```

Result: 4 passed in 6.2 seconds.

```text
pnpm typecheck
pnpm lint
```

Result: both passed.

## Remaining browser and desktop depth

- Add full keyboard-only navigation across top-level sections and card-editor
  tabs.
- Add destructive-action confirmation/recovery acceptance paths.
- Retain packaged desktop WebView product-flow coverage separately; browser E2E
  does not substitute for Tauri ACL, keychain, SQLite, or installer proof.
