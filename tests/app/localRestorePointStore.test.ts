import { beforeEach, describe, expect, it } from "vitest";

import {
  LOCAL_RESTORE_POINTS_KEY,
  loadLocalRestorePoints,
  saveLocalRestorePoints,
  shouldPersistRestorePointsInWebviewStorage,
} from "../../src/app/localRestorePointStore";
import type { RestorePoint } from "../../src/runtime/restorePoints";

type Snapshot = { savedAt: string; cards: unknown[]; messages: unknown[]; activeCardId: string };

function point(index: number): RestorePoint<Snapshot> {
  return {
    id: `restore-${index}`,
    createdAt: `2026-07-12T00:00:${String(index).padStart(2, "0")}.000Z`,
    label: `${index} messages`,
    messageCount: index,
    cardName: "Test card",
    snapshot: {
      savedAt: `2026-07-12T00:00:${String(index).padStart(2, "0")}.000Z`,
      cards: [],
      messages: [],
      activeCardId: "card-test",
    },
  };
}

describe("local restore point store", () => {
  beforeEach(() => window.localStorage.clear());

  it("persists a bounded restore history across reloads", () => {
    saveLocalRestorePoints(Array.from({ length: 14 }, (_, index) => point(index)));

    expect(loadLocalRestorePoints<Snapshot>()).toEqual(
      Array.from({ length: 10 }, (_, index) => point(index)),
    );
  });

  it("fails closed when persisted restore data is malformed", () => {
    window.localStorage.setItem(LOCAL_RESTORE_POINTS_KEY, JSON.stringify([{ id: "bad" }]));
    expect(loadLocalRestorePoints()).toEqual([]);

    window.localStorage.setItem(LOCAL_RESTORE_POINTS_KEY, "not-json");
    expect(loadLocalRestorePoints()).toEqual([]);
  });

  it("keeps desktop restore points out of webview localStorage", () => {
    expect(shouldPersistRestorePointsInWebviewStorage({ isDesktopRuntime: true })).toBe(false);
    expect(shouldPersistRestorePointsInWebviewStorage({ isDesktopRuntime: false })).toBe(true);
  });
});
