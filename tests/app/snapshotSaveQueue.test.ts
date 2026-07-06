import { describe, expect, it } from "vitest";

import { createSnapshotSaveQueue } from "../../src/app/snapshotSaveQueue";

describe("snapshot save queue", () => {
  it("serializes saves and coalesces snapshots enqueued during an active save", async () => {
    const saved: number[] = [];
    let releaseFirstSave: () => void = () => {};
    let callCount = 0;
    const queue = createSnapshotSaveQueue<number>(async (snapshot) => {
      callCount += 1;
      if (callCount === 1) {
        await new Promise<void>((resolve) => {
          releaseFirstSave = resolve;
        });
      }
      saved.push(snapshot);
    });

    const first = queue.enqueue(1);
    const second = queue.enqueue(2);
    const third = queue.enqueue(3);
    releaseFirstSave();
    await Promise.all([first, second, third]);

    expect(saved).toEqual([1, 3]);
  });

  it("keeps saving newer snapshots after a save fails and rejects the failed batch", async () => {
    const saved: string[] = [];
    const queue = createSnapshotSaveQueue<string>(async (snapshot) => {
      if (snapshot === "boom") {
        throw new Error("write failed");
      }
      saved.push(snapshot);
    });

    await expect(queue.enqueue("boom")).rejects.toThrow("write failed");
    await expect(queue.enqueue("after")).resolves.toBeUndefined();
    expect(saved).toEqual(["after"]);
  });

  it("resolves every caller whose snapshot was superseded by a newer write", async () => {
    let release: () => void = () => {};
    let callCount = 0;
    const queue = createSnapshotSaveQueue<string>(async () => {
      callCount += 1;
      if (callCount === 1) {
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      }
    });

    void queue.enqueue("first");
    const supersededPromise = queue.enqueue("superseded");
    const latestPromise = queue.enqueue("latest");
    release();

    await expect(supersededPromise).resolves.toBeUndefined();
    await expect(latestPromise).resolves.toBeUndefined();
    expect(callCount).toBe(2);
  });
});
