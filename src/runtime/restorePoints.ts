// Pure in-app restore-point (auto-backup) ring buffer.
//
// The app keeps the last N runtime snapshots so the user can roll back to an
// earlier state from Settings. This module holds the *pure* logic: deriving a
// human label from a snapshot, capping the buffer, de-duplicating unchanged
// snapshots, and looking a point back up by id. Id generation and timestamps
// are injected by the caller (App.tsx) so the behaviour stays deterministic
// under test.

export interface RestorePointSnapshotFields {
  savedAt?: unknown;
  activeCardId?: unknown;
  cards?: unknown;
  messages?: unknown;
}

export interface RestorePoint<TSnapshot extends RestorePointSnapshotFields> {
  /** Stable identifier assigned by the caller. */
  id: string;
  /** ISO timestamp the point was captured, assigned by the caller. */
  createdAt: string;
  /** Human-readable one-line summary, e.g. "8 messages · The Tavern". */
  label: string;
  messageCount: number;
  cardName: string;
  snapshot: TSnapshot;
}

export interface BuildRestorePointInput<TSnapshot extends RestorePointSnapshotFields> {
  id: string;
  createdAt: string;
  snapshot: TSnapshot;
}

export interface AppendRestorePointOptions {
  maxPoints?: number;
}

export const DEFAULT_MAX_RESTORE_POINTS = 10;
const MAX_RESTORE_POINTS_CAP = 50;

export interface RestoreSnapshotSummary {
  messageCount: number;
  cardName: string;
  label: string;
}

/** Derives the message count, active card name, and display label for a snapshot. */
export function summarizeRestoreSnapshot(snapshot: RestorePointSnapshotFields): RestoreSnapshotSummary {
  const messages = Array.isArray(snapshot.messages) ? snapshot.messages : [];
  const messageCount = messages.length;
  const cardName = readActiveCardName(snapshot);
  const messageLabel = `${messageCount} ${messageCount === 1 ? "message" : "messages"}`;
  const label = cardName ? `${messageLabel} · ${cardName}` : messageLabel;
  return { messageCount, cardName, label };
}

/** Assembles a restore point, deriving its label from the snapshot contents. */
export function buildRestorePoint<TSnapshot extends RestorePointSnapshotFields>(
  input: BuildRestorePointInput<TSnapshot>,
): RestorePoint<TSnapshot> {
  const summary = summarizeRestoreSnapshot(input.snapshot);
  return {
    id: input.id,
    createdAt: input.createdAt,
    label: summary.label,
    messageCount: summary.messageCount,
    cardName: summary.cardName,
    snapshot: input.snapshot,
  };
}

/**
 * Prepends a new restore point (newest first) and caps the list to `maxPoints`,
 * dropping the oldest points. When the incoming snapshot has the same `savedAt`
 * as the most recent point, nothing has changed since the last capture and the
 * existing list is returned unchanged.
 */
export function appendRestorePoint<TSnapshot extends RestorePointSnapshotFields>(
  existing: readonly RestorePoint<TSnapshot>[],
  point: RestorePoint<TSnapshot>,
  options: AppendRestorePointOptions = {},
): RestorePoint<TSnapshot>[] {
  const maxPoints = normalizeMaxPoints(options.maxPoints);
  const mostRecent = existing[0];
  const incomingSavedAt = readSavedAt(point.snapshot);
  if (mostRecent && incomingSavedAt && readSavedAt(mostRecent.snapshot) === incomingSavedAt) {
    return existing.slice();
  }
  return pruneRestorePoints([point, ...existing], maxPoints);
}

/** Caps a restore-point list to the newest `maxPoints`. */
export function pruneRestorePoints<TSnapshot extends RestorePointSnapshotFields>(
  points: readonly RestorePoint<TSnapshot>[],
  maxPoints: number = DEFAULT_MAX_RESTORE_POINTS,
): RestorePoint<TSnapshot>[] {
  return points.slice(0, normalizeMaxPoints(maxPoints));
}

/** Finds a restore point by id, or null when it is not present. */
export function findRestorePoint<TSnapshot extends RestorePointSnapshotFields>(
  points: readonly RestorePoint<TSnapshot>[],
  id: string,
): RestorePoint<TSnapshot> | null {
  return points.find((point) => point.id === id) ?? null;
}

function normalizeMaxPoints(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return DEFAULT_MAX_RESTORE_POINTS;
  }
  const rounded = Math.floor(value);
  if (rounded < 1) {
    return 1;
  }
  if (rounded > MAX_RESTORE_POINTS_CAP) {
    return MAX_RESTORE_POINTS_CAP;
  }
  return rounded;
}

function readSavedAt(snapshot: RestorePointSnapshotFields): string {
  return typeof snapshot.savedAt === "string" ? snapshot.savedAt : "";
}

function readActiveCardName(snapshot: RestorePointSnapshotFields): string {
  const activeCardId = typeof snapshot.activeCardId === "string" ? snapshot.activeCardId : "";
  const cards = Array.isArray(snapshot.cards) ? snapshot.cards : [];

  for (const card of cards) {
    if (isRecord(card) && card.id === activeCardId) {
      const name = readCardName(card);
      if (name) {
        return name;
      }
    }
  }

  for (const card of cards) {
    if (isRecord(card)) {
      const name = readCardName(card);
      if (name) {
        return name;
      }
    }
  }

  return "";
}

function readCardName(card: Record<string, unknown>): string {
  return typeof card.name === "string" ? card.name.trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
