# Browser Critical-Journey Evidence

Date: 2026-07-14  
Scope: release-gate browser acceptance beyond the original single seeded-card
smoke.

## Result

The Chromium acceptance lane now has six independent journeys. All six passed
in 6.6 seconds with six local workers.

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
5. Main-section navigation exposes the current page, and the card editor uses a
   linked tab/tab-panel contract with roving focus plus Arrow, Home, and End key
   navigation.
6. Card deletion requires a second confirmation, initially focuses an explicit
   cancel action, preserves the card when cancelled, and removes it only after
   the user confirms again.

The original seeded blank-card smoke remains and continues to verify mock-turn
persistence plus compiled-prompt privacy.

## Verification

```text
pnpm e2e
```

Result: 6 passed in 6.6 seconds.

```text
pnpm typecheck
pnpm lint
```

Result: both passed.

## Remaining browser and desktop depth

- Extend destructive-action confirmation/recovery coverage to chat deletion
  and runtime replacement.
- Extend the keyboard-only path through the composer, settings controls, and
  provider-failure recovery.
- Retain packaged desktop WebView product-flow coverage separately; browser E2E
  does not substitute for Tauri ACL, keychain, SQLite, or installer proof.

## Keyboard-contract TDD checkpoint

The added journey first failed because active navigation buttons had no
`aria-current`, and card-editor tabs had no linked panels, roving `tabIndex`, or
arrow-key behavior. The implementation then added those semantics and the
focused test, full five-test browser lane, typecheck, and lint all passed.

The destructive-recovery journey then failed because card deletion offered a
second-click label but no explicit way to cancel. The card row now presents and
focuses a dedicated cancel action before confirmation; the focused test and
full six-test browser lane passed.
