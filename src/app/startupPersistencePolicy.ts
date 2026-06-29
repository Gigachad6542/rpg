export interface SnapshotCandidate {
  savedAt?: string;
  cards?: readonly unknown[];
  messages?: readonly unknown[];
  promptRuns?: readonly unknown[];
  chatSessions?: readonly unknown[];
}

export interface LocalSnapshotPersistenceInput {
  isDesktopRuntime: boolean;
}

export function shouldUseRepositorySnapshot(
  repositorySnapshot: SnapshotCandidate | null | undefined,
  localSnapshot: SnapshotCandidate | null | undefined,
): boolean {
  if (!repositorySnapshot) {
    return false;
  }

  if (!localSnapshot) {
    return true;
  }

  const repositorySavedAt = parseSnapshotTime(repositorySnapshot.savedAt);
  const localSavedAt = parseSnapshotTime(localSnapshot.savedAt);
  if (repositorySavedAt > localSavedAt) {
    return true;
  }

  return isBlankFallbackSnapshot(localSnapshot) && hasUserContinuity(repositorySnapshot);
}

export function shouldPersistFullLocalSnapshot(input: LocalSnapshotPersistenceInput): boolean {
  return !input.isDesktopRuntime;
}

function parseSnapshotTime(value: unknown): number {
  return typeof value === "string" ? Date.parse(value) || 0 : 0;
}

function isBlankFallbackSnapshot(snapshot: SnapshotCandidate): boolean {
  const cards = snapshot.cards ?? [];
  return (
    cards.length <= 1 &&
    !hasUserContinuity(snapshot) &&
    cards.every((card) => {
      if (!isRecord(card)) {
        return true;
      }
      return card.id === "card_blank_slate_rpg" || card.name === "Blank Slate RPG";
    })
  );
}

function hasUserContinuity(snapshot: SnapshotCandidate): boolean {
  if ((snapshot.messages?.length ?? 0) > 0 || (snapshot.promptRuns?.length ?? 0) > 0) {
    return true;
  }

  for (const session of snapshot.chatSessions ?? []) {
    if (isRecord(session) && Array.isArray(session.messages) && session.messages.length > 0) {
      return true;
    }
  }

  const cards = snapshot.cards ?? [];
  if (cards.length > 1) {
    return true;
  }

  return cards.some((card) => {
    if (!isRecord(card)) {
      return false;
    }
    return card.id !== "card_blank_slate_rpg" && card.name !== "Blank Slate RPG";
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
