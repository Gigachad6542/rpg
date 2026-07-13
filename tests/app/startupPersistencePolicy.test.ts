import { describe, expect, it } from "vitest";

import {
  resolveHydrationFailure,
  shouldPersistFullLocalSnapshot,
  shouldShowOnboarding,
  shouldUseRepositorySnapshot,
  type SnapshotCandidate,
} from "../../src/app/startupPersistencePolicy";

const blankLocalSnapshot: SnapshotCandidate = {
  savedAt: "2026-06-29T12:00:00.000Z",
  cards: [
    {
      id: "card_blank_slate_rpg",
      name: "Blank Slate RPG",
      kind: "rpg",
    },
  ],
  messages: [],
  promptRuns: [],
};

const repositorySnapshot: SnapshotCandidate = {
  savedAt: "2026-06-29T11:00:00.000Z",
  cards: [
    {
      id: "card_real_campaign",
      name: "Real Campaign",
      kind: "rpg",
    },
  ],
  messages: [{ id: "message-1" }],
  promptRuns: [{ id: "run-1" }],
};

describe("startup persistence policy", () => {
  it("fails closed on desktop when hydration fails", () => {
    expect(resolveHydrationFailure({ isDesktopRuntime: true, error: "database is corrupt" })).toEqual({
      phase: "failed",
      error: "database is corrupt",
    });
  });

  it("fails open in the browser when hydration fails", () => {
    expect(resolveHydrationFailure({ isDesktopRuntime: false, error: "wasm init failed" })).toEqual({
      phase: "ready",
    });
  });

  it("hydrates from SQLite when local fallback is only a newer blank default snapshot", () => {
    expect(shouldUseRepositorySnapshot(repositorySnapshot, blankLocalSnapshot)).toBe(true);
  });

  it("keeps a newer local snapshot when it contains user data", () => {
    const localWithUserData: SnapshotCandidate = {
      ...blankLocalSnapshot,
      cards: [
        {
          id: "card_custom",
          name: "Custom Campaign",
          kind: "rpg",
        },
      ],
      messages: [{ id: "local-message" }],
    };

    expect(shouldUseRepositorySnapshot(repositorySnapshot, localWithUserData)).toBe(false);
  });

  it("does not write a full localStorage fallback in the desktop runtime", () => {
    expect(
      shouldPersistFullLocalSnapshot({
        isDesktopRuntime: true,
      }),
    ).toBe(false);
    expect(
      shouldPersistFullLocalSnapshot({
        isDesktopRuntime: false,
      }),
    ).toBe(true);
  });

  it("shows onboarding for a fresh install with no persisted snapshot", () => {
    expect(shouldShowOnboarding({ onboardingCompleted: false, snapshot: null })).toBe(true);
  });

  it("shows onboarding when the only content is the blank fallback card", () => {
    expect(
      shouldShowOnboarding({ onboardingCompleted: false, snapshot: blankLocalSnapshot }),
    ).toBe(true);
  });

  it("shows onboarding when the only content is the bundled starter library", () => {
    expect(
      shouldShowOnboarding({
        onboardingCompleted: false,
        snapshot: {
          cards: [
            { id: "card_ashfall_crossing", name: "Ashfall Crossing" },
            { id: "card_blank_slate_rpg", name: "Blank Slate RPG" },
          ],
          chatSessions: [],
          messages: [],
          promptRuns: [],
        },
      }),
    ).toBe(true);
  });

  it("skips onboarding once it has been completed", () => {
    expect(shouldShowOnboarding({ onboardingCompleted: true, snapshot: null })).toBe(false);
  });

  it("skips onboarding for an existing user who already has real content", () => {
    expect(
      shouldShowOnboarding({ onboardingCompleted: false, snapshot: repositorySnapshot }),
    ).toBe(false);
  });
});
