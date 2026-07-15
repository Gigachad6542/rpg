# Browser Critical-Journey Evidence

Date: 2026-07-14  
Scope: release-gate browser acceptance beyond the original single seeded-card
smoke.

## Result

The Chromium acceptance lane now has eight independent journeys. All eight
passed in 6.5 seconds with eight local workers.

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
7. Active-chat deletion has the same focused cancel path and retains the active
   branch until the user completes a second explicit confirmation.
8. A failed loopback text-provider health check surfaces an actionable error,
   and the user can switch back to mock mode and receive a successful health
   response without reloading or losing runtime state.

The original seeded blank-card smoke remains and continues to verify mock-turn
persistence plus compiled-prompt privacy.

## Verification

```text
pnpm e2e
```

Result: 8 passed in 6.5 seconds.

```text
pnpm typecheck
pnpm lint
```

Result: both passed.

## Remaining browser and desktop depth

- Extend destructive-action confirmation/recovery coverage to runtime
  replacement.
- Extend the keyboard-only path through the composer and remaining settings
  controls.
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

The equivalent chat-deletion journey then drove the same explicit, focused
cancel affordance for active branches. Its focused test, all 81 App integration
tests, typecheck, lint, and the full seven-test browser lane passed.

The provider recovery characterization then proved that an unreachable local
endpoint produces visible failure state and that switching back to the offline
mock provider recovers in place. The focused test and full eight-test browser
lane passed without secrets or paid calls.
