import type { defaultNewCard } from "./appDefaults";
import {
  createCustomPlayerRule,
  createDefaultCharacterPlayerRules,
  createDefaultRpgPlayerRules,
  createInitialLorebooks,
  createInitialStoryEntities,
} from "./cardNormalization";
import type { RuntimeCard } from "./runtimeTypes";

export function buildRuntimeCardFromDraft(
  draft: typeof defaultNewCard,
  cardId: string,
): RuntimeCard {
  const name = draft.name.trim();
  const characterName = draft.characterName.trim() || name;
  const customRules = draft.playerRules
    .split("\n")
    .map((rule) => rule.trim())
    .filter(Boolean)
    .map((rule) => createCustomPlayerRule(rule, rule));
  const baseRules = draft.kind === "rpg"
    ? createDefaultRpgPlayerRules()
    : createDefaultCharacterPlayerRules();

  return {
    id: cardId,
    name,
    kind: draft.kind,
    summary: draft.summary.trim() || "User-created runtime card.",
    characterName,
    characterDescription: draft.characterDescription.trim(),
    scenario: draft.scenario.trim(),
    greeting: draft.greeting.trim(),
    exampleDialogs: draft.exampleDialogs.trim(),
    systemPrompt: draft.systemPrompt.trim() || "Follow this card's local rules and continuity.",
    preHistoryInstructions: draft.preHistoryInstructions.trim(),
    postHistoryInstructions: draft.postHistoryInstructions.trim(),
    playerRules: [...baseRules, ...customRules],
    mapEnabled: draft.mapEnabled,
    lorebooks: createInitialLorebooks(cardId, draft.lorebookName),
    memory: [],
    storyEntities: createInitialStoryEntities(cardId, {
      cardKind: draft.kind,
      cardCharacterName: characterName,
    }),
    rpg:
      draft.kind === "rpg"
        ? {
            location: "Unmapped starting area",
            health: "not configured",
            inventory: [],
            quests: [],
            flags: {},
            knownPlaces: [],
            mapStyle: "birdseye map, readable labels, clean cartographic layout",
          }
        : undefined,
  };
}
