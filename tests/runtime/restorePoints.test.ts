import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAX_RESTORE_POINTS,
  appendRestorePoint,
  buildRestorePoint,
  findRestorePoint,
  pruneRestorePoints,
  summarizeRestoreSnapshot,
  type RestorePointSnapshotFields,
} from "../../src/runtime/restorePoints";

interface TestSnapshot extends RestorePointSnapshotFields {
  savedAt: string;
  activeCardId: string;
  cards: Array<{ id: string; name: string }>;
  messages: Array<{ id: string }>;
}

function makeSnapshot(savedAt: string, messageCount: number, cardName?: string): TestSnapshot {
  return {
    savedAt,
    activeCardId: "card_1",
    cards: cardName ? [{ id: "card_1", name: cardName }] : [],
    messages: Array.from({ length: messageCount }, (_, index) => ({ id: `m${index}` })),
  };
}

function makePoint(id: string, savedAt: string, messageCount: number, cardName?: string) {
  return buildRestorePoint({
    id,
    createdAt: savedAt,
    snapshot: makeSnapshot(savedAt, messageCount, cardName),
  });
}

describe("summarizeRestoreSnapshot", () => {
  it("labels the active card and pluralizes messages", () => {
    expect(summarizeRestoreSnapshot(makeSnapshot("t", 3, "The Tavern"))).toEqual({
      messageCount: 3,
      cardName: "The Tavern",
      label: "3 messages · The Tavern",
    });
  });

  it("uses the singular for a single message", () => {
    expect(summarizeRestoreSnapshot(makeSnapshot("t", 1, "The Tavern")).label).toBe(
      "1 message · The Tavern",
    );
  });

  it("omits the card segment when no card name is available", () => {
    expect(summarizeRestoreSnapshot(makeSnapshot("t", 0)).label).toBe("0 messages");
  });
});

describe("buildRestorePoint", () => {
  it("carries the id, timestamp, snapshot, and derived label", () => {
    const point = makePoint("r1", "2026-07-08T00:00:00.000Z", 2, "The Tavern");
    expect(point.id).toBe("r1");
    expect(point.createdAt).toBe("2026-07-08T00:00:00.000Z");
    expect(point.label).toBe("2 messages · The Tavern");
    expect(point.snapshot.messages).toHaveLength(2);
  });
});

describe("appendRestorePoint", () => {
  it("prepends the newest point", () => {
    const first = makePoint("r1", "2026-07-08T00:00:00.000Z", 1, "The Tavern");
    const second = makePoint("r2", "2026-07-08T00:01:00.000Z", 2, "The Tavern");
    const points = appendRestorePoint(appendRestorePoint([], first), second);
    expect(points.map((point) => point.id)).toEqual(["r2", "r1"]);
  });

  it("caps the buffer to maxPoints, dropping the oldest", () => {
    let points: ReturnType<typeof makePoint>[] = [];
    for (let index = 0; index < 5; index += 1) {
      points = appendRestorePoint(
        points,
        makePoint(`r${index}`, `2026-07-08T00:0${index}:00.000Z`, index, "The Tavern"),
        { maxPoints: 3 },
      );
    }
    expect(points.map((point) => point.id)).toEqual(["r4", "r3", "r2"]);
  });

  it("de-duplicates when the snapshot has not changed since the last capture", () => {
    const point = makePoint("r1", "2026-07-08T00:00:00.000Z", 2, "The Tavern");
    const duplicate = makePoint("r2", "2026-07-08T00:00:00.000Z", 2, "The Tavern");
    const points = appendRestorePoint(appendRestorePoint([], point), duplicate);
    expect(points.map((point) => point.id)).toEqual(["r1"]);
  });
});

describe("pruneRestorePoints", () => {
  it("keeps only the newest maxPoints", () => {
    const points = [
      makePoint("r3", "t3", 3, "c"),
      makePoint("r2", "t2", 2, "c"),
      makePoint("r1", "t1", 1, "c"),
    ];
    expect(pruneRestorePoints(points, 2).map((point) => point.id)).toEqual(["r3", "r2"]);
  });

  it("defaults to the standard maximum", () => {
    expect(DEFAULT_MAX_RESTORE_POINTS).toBe(10);
  });
});

describe("findRestorePoint", () => {
  it("finds a point by id and returns null when missing", () => {
    const points = [makePoint("r1", "t1", 1, "c"), makePoint("r2", "t2", 2, "c")];
    expect(findRestorePoint(points, "r2")?.id).toBe("r2");
    expect(findRestorePoint(points, "nope")).toBeNull();
  });
});
