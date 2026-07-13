import type { ProviderSettings, RuntimeCard } from "./runtimeTypes";

export type ReadinessItem = {
  id: "playable-content" | "active-card" | "text-provider";
  label: string;
  detail: string;
  ready: boolean;
};

export function isPlayableCard(card: RuntimeCard): boolean {
  return Boolean(
    card.greeting.trim() &&
    card.systemPrompt.trim() &&
    card.playerRules.some((rule) => rule.enabled) &&
    (card.kind === "character" || (card.rpg && card.rpg.location.trim() && card.rpg.quests.length > 0)),
  );
}
export function getReadinessChecklist(input: {
  cards: RuntimeCard[];
  activeCardId: string;
  providerSettings: ProviderSettings;
}): ReadinessItem[] {
  const activeCard = input.cards.find((card) => card.id === input.activeCardId && !card.archived);
  const hasPlayableContent = input.cards.some((card) => !card.archived && isPlayableCard(card));
  const providerReady = input.providerSettings.mode === "mock" || Boolean(
    input.providerSettings.baseUrl.trim() && input.providerSettings.model.trim(),
  );
  return [
    {
      id: "playable-content",
      label: "Playable content",
      detail: hasPlayableContent ? "At least one playable card is available." : "Create or import a complete card.",
      ready: hasPlayableContent,
    },
    {
      id: "active-card",
      label: "Card selected",
      detail: activeCard ? `${activeCard.name} is ready to open.` : "Open a card from the library.",
      ready: Boolean(activeCard && isPlayableCard(activeCard)),
    },
    {
      id: "text-provider",
      label: "Text provider",
      detail: providerReady ? `${input.providerSettings.displayName} is configured.` : "Configure a provider or use the mock demo.",
      ready: providerReady,
    },
  ];
}
