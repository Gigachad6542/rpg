export interface SnapshotSaveQueue<Snapshot> {
  enqueue(snapshot: Snapshot): Promise<void>;
}

interface PendingSave<Snapshot> {
  snapshot: Snapshot;
  resolvers: Array<{ resolve: () => void; reject: (error: unknown) => void }>;
}

/**
 * Serializes snapshot saves so writes always land in submission order.
 * Only one save runs at a time; snapshots enqueued while a save is in
 * flight are coalesced so only the newest pending snapshot is written.
 */
export function createSnapshotSaveQueue<Snapshot>(
  save: (snapshot: Snapshot) => Promise<void>,
): SnapshotSaveQueue<Snapshot> {
  let isSaving = false;
  let pending: PendingSave<Snapshot> | null = null;

  function start(snapshot: Snapshot, resolvers: PendingSave<Snapshot>["resolvers"]): void {
    isSaving = true;
    save(snapshot)
      .then(() => {
        for (const resolver of resolvers) {
          resolver.resolve();
        }
      })
      .catch((error: unknown) => {
        for (const resolver of resolvers) {
          resolver.reject(error);
        }
      })
      .finally(() => {
        isSaving = false;
        if (pending) {
          const next = pending;
          pending = null;
          start(next.snapshot, next.resolvers);
        }
      });
  }

  return {
    enqueue(snapshot: Snapshot): Promise<void> {
      return new Promise<void>((resolve, reject) => {
        const resolver = { resolve, reject };
        if (!isSaving) {
          start(snapshot, [resolver]);
          return;
        }
        if (pending) {
          pending.snapshot = snapshot;
          pending.resolvers.push(resolver);
          return;
        }
        pending = { snapshot, resolvers: [resolver] };
      });
    },
  };
}
