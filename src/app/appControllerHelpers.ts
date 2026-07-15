import type { RuntimeExportSnapshot } from "./runtimeDataBundle";
import type { Lorebook, Persona, RuntimeCard } from "./runtimeTypes";

/** Pre-persona snapshots kept the impersonation prompt on runtimeSettings. */
export function readLegacyImpersonationPrompt(
  runtimeSettings: Record<string, unknown> | undefined,
): string {
  const legacy = runtimeSettings?.impersonationPrompt;
  return typeof legacy === "string" ? legacy : "";
}

export function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (typeof error === "object" && error !== null && "name" in error && error.name === "AbortError")
  );
}

function disableLoreEntries(
  lorebooks: Lorebook[],
  disabledEntryIds: ReadonlySet<string>,
): Lorebook[] {
  return lorebooks.map((lorebook) => ({
    ...lorebook,
    entries: lorebook.entries.map((entry) =>
      disabledEntryIds.has(entry.id) ? { ...entry, enabled: false } : entry,
    ),
  }));
}

export function disableLoreEntriesInCard(
  card: RuntimeCard,
  disabledEntryIds: ReadonlySet<string>,
): RuntimeCard {
  return disabledEntryIds.size === 0
    ? card
    : { ...card, lorebooks: disableLoreEntries(card.lorebooks, disabledEntryIds) };
}

export function disableLoreEntriesInPersona(
  persona: Persona,
  disabledEntryIds: ReadonlySet<string>,
): Persona {
  return disabledEntryIds.size === 0
    ? persona
    : { ...persona, lorebooks: disableLoreEntries(persona.lorebooks, disabledEntryIds) };
}

export function countImportedMessages(snapshot: RuntimeExportSnapshot): number {
  if (!Array.isArray(snapshot.chatSessions)) return snapshot.messages.length;
  return snapshot.chatSessions.reduce((total, chat) => {
    const chatMessages = (chat as Record<string, unknown>).messages;
    return total + (Array.isArray(chatMessages) ? chatMessages.length : 0);
  }, 0);
}
