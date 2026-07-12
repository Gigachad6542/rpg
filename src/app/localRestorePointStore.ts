import {
  DEFAULT_MAX_RESTORE_POINTS,
  pruneRestorePoints,
  type RestorePoint,
  type RestorePointSnapshotFields,
} from "../runtime/restorePoints";

export const LOCAL_RESTORE_POINTS_KEY = "rpg.runtime.restore-points.v1";

export function shouldPersistRestorePointsInWebviewStorage(input: { isDesktopRuntime: boolean }): boolean {
  return !input.isDesktopRuntime;
}

export function loadLocalRestorePoints<TSnapshot extends RestorePointSnapshotFields>(): RestorePoint<TSnapshot>[] {
  try {
    const raw = window.localStorage.getItem(LOCAL_RESTORE_POINTS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || !parsed.every(isRestorePoint)) return [];
    return pruneRestorePoints(parsed as RestorePoint<TSnapshot>[], DEFAULT_MAX_RESTORE_POINTS);
  } catch {
    return [];
  }
}

export function saveLocalRestorePoints<TSnapshot extends RestorePointSnapshotFields>(
  points: readonly RestorePoint<TSnapshot>[],
): boolean {
  try {
    window.localStorage.setItem(
      LOCAL_RESTORE_POINTS_KEY,
      JSON.stringify(pruneRestorePoints(points, DEFAULT_MAX_RESTORE_POINTS)),
    );
    return true;
  } catch {
    return false;
  }
}

function isRestorePoint(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  const point = value as Record<string, unknown>;
  return (
    typeof point.id === "string" &&
    typeof point.createdAt === "string" &&
    typeof point.label === "string" &&
    typeof point.messageCount === "number" &&
    typeof point.cardName === "string" &&
    Boolean(point.snapshot) &&
    typeof point.snapshot === "object" &&
    Array.isArray((point.snapshot as Record<string, unknown>).cards) &&
    Array.isArray((point.snapshot as Record<string, unknown>).messages)
  );
}
