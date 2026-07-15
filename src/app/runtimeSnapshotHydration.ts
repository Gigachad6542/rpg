import { deriveCardForChat } from "./chatTurnState";
import {
  getActiveChatForCard,
  parseActiveChatIds,
  parseChatSessions,
} from "./chatSessions";
import { normalizeRuntimeCards } from "./cardNormalization";
import { findGeneratedMapForChat, parseGeneratedMaps } from "./generatedImages";
import { readLegacyImpersonationPrompt } from "./appControllerHelpers";
import { parseActivePersonaId, parsePersonas } from "./personas";
import {
  applyPromptDebugRetention,
  parseImageProviderSettings,
  parseProviderSettings,
  parseRuntimeSettings,
} from "./providerConfig";
import type {
  ChatSession,
  GeneratedMapArtifact,
  ImageProviderSettings,
  Message,
  Persona,
  PromptRun,
  ProviderSettings,
  RuntimeCard,
  RuntimeSettings,
  Theme,
} from "./runtimeTypes";

export type RuntimeSnapshotSource = {
  theme?: unknown;
  activeCardId?: unknown;
  cards?: unknown;
  messages?: unknown;
  chatSessions?: unknown;
  activeChatIds?: unknown;
  promptRuns?: unknown;
  providerKeyStatus?: unknown;
  providerSettings?: unknown;
  imageProviderSettings?: unknown;
  runtimeSettings?: unknown;
  personas?: unknown;
  activePersonaId?: unknown;
  generatedMaps?: unknown;
};

export type ResolvedRuntimeSnapshotState = {
  theme: Theme;
  cards: RuntimeCard[];
  activeCardId: string;
  chatSessions: ChatSession[];
  activeChatIds: Record<string, string>;
  promptRuns: PromptRun[];
  providerKeyStatus: string;
  providerSettings: ProviderSettings;
  imageProviderSettings: ImageProviderSettings;
  runtimeSettings: RuntimeSettings;
  personas: Persona[];
  activePersonaId: string;
  generatedMaps: GeneratedMapArtifact[];
  mapArtifact: GeneratedMapArtifact | null;
  photoArtifact: GeneratedMapArtifact | null;
};

export function resolveRuntimeSnapshotState(
  snapshot: RuntimeSnapshotSource | null,
  fallbacks: { fallbackCards: RuntimeCard[]; fallbackMessages: Message[] },
): ResolvedRuntimeSnapshotState {
  const runtimeSettings = parseRuntimeSettings(asRecord(snapshot?.runtimeSettings));
  const personas = parsePersonas(
    Array.isArray(snapshot?.personas) ? snapshot.personas : undefined,
    readLegacyImpersonationPrompt(asRecord(snapshot?.runtimeSettings)),
  );
  const cards = normalizeRuntimeCards(
    Array.isArray(snapshot?.cards) && snapshot.cards.length > 0
      ? snapshot.cards as RuntimeCard[]
      : fallbacks.fallbackCards,
  );
  const requestedActiveCardId = typeof snapshot?.activeCardId === "string" ? snapshot.activeCardId : "";
  const activeCardId = requestedActiveCardId !== "card_blank_slate_rpg" &&
    cards.some((card) => card.id === requestedActiveCardId)
    ? requestedActiveCardId
    : "";
  const messages = Array.isArray(snapshot?.messages)
    ? snapshot.messages as Message[]
    : fallbacks.fallbackMessages;
  const chatSessions = parseChatSessions(snapshot?.chatSessions, cards, messages, activeCardId);
  const activeChatIds = parseActiveChatIds(snapshot?.activeChatIds, cards, chatSessions, activeCardId);
  const cardsWithChatState = cards.map((card) => {
    const chat = getActiveChatForCard(card.id, chatSessions, activeChatIds);
    return chat ? deriveCardForChat(card, chat) : card;
  });
  const promptRuns = applyPromptDebugRetention(
    Array.isArray(snapshot?.promptRuns) ? snapshot.promptRuns as PromptRun[] : [],
    runtimeSettings,
  );
  const generatedMaps = parseGeneratedMaps(snapshot?.generatedMaps);

  return {
    theme: snapshot?.theme === "light" ? "light" : "dark",
    cards: cardsWithChatState,
    activeCardId,
    chatSessions,
    activeChatIds,
    promptRuns,
    providerKeyStatus:
      typeof snapshot?.providerKeyStatus === "string"
        ? snapshot.providerKeyStatus
        : "No plaintext keys stored.",
    providerSettings: parseProviderSettings(asRecord(snapshot?.providerSettings)),
    imageProviderSettings: parseImageProviderSettings(asRecord(snapshot?.imageProviderSettings)),
    runtimeSettings,
    personas,
    activePersonaId: parseActivePersonaId(
      typeof snapshot?.activePersonaId === "string" ? snapshot.activePersonaId : undefined,
      personas,
    ),
    generatedMaps,
    mapArtifact: activeCardId
      ? findGeneratedMapForChat(generatedMaps, activeCardId, undefined, "map")
      : null,
    photoArtifact: activeCardId
      ? findGeneratedMapForChat(generatedMaps, activeCardId, undefined, "photo")
      : null,
  };
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}
