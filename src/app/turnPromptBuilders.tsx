// Turn-prompt assembly, response contract, and mock-provider response builders extracted from App.tsx.
import { type ReactNode } from "react";
import { formatStoryEntitiesForKnowledgeBoundary } from "../runtime/hiddenContinuity";
import { buildSceneText, orderByRelevance, selectPresentNames } from "../runtime/relevanceScoring";
import type { LorebookEntry, Message, Persona, RuntimeCard, RuntimeSettings, TurnPromptRequest } from "./runtimeTypes";
import { titleCase } from "./appUtils";
import { randomOpeningAction } from "./appDefaults";
import { formatPersonaPrompt } from "./personas";

export function formatDetailedCharacterDefinition(card: RuntimeCard): string {
  return [
    card.characterName ? `Character name: ${card.characterName}` : "",
    card.characterDescription ? `Description:\n${card.characterDescription}` : "",
    card.scenario ? `Scenario:\n${card.scenario}` : "",
    card.greeting ? `Greeting:\n${card.greeting}` : "",
    card.exampleDialogs ? `Example dialogs:\n${card.exampleDialogs}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function renderNarrativeMarkup(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(\*\*[^*]+?\*\*|\*[^*]+?\*)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    const token = match[0];
    const key = `${match.index}-${token}`;
    if (token.startsWith("**")) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
    } else {
      nodes.push(
        <em className="message-aside" key={key}>
          {token.slice(1, -1)}
        </em>,
      );
    }
    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}

export function buildResponseContract(settings: RuntimeSettings): string {
  return [
    "Write the in-card response.",
    "Player agency is absolute: narrate only actions, words, and decisions the player explicitly stated. You may expand and vividly describe what the player declared, but never invent new actions, dialogue, emotions, or inner thoughts for the player character.",
    "Never end the response by prompting the player, offering choices, or asking what they do next. End on the scene itself.",
    "Presentation rules: use *single asterisks* only for quiet narration/asides, **double asterisks** only for strong emphasis, and normal quotation marks for spoken dialogue.",
    "Do not show raw Markdown fences in the main prose. If useful, put Date, Time, Location, Weather, Health, Inventory, Quest, or Status as a short `status` fenced block at the very end.",
    "When this turn changed durable state, append a fenced ```json block at the very end (after the status block) containing one object with any of these keys: memory_updates (array of {label, detail}), character_knowledge_updates (array of {subject, knows, does_not_know}), rpg_state_updates ({location, health_delta, inventory_add, inventory_remove, quest_updates, world_flags}), image_prompt_opportunity, continuity_warnings. The app strips this block from the visible reply and validates every proposal before saving; omit the block when nothing durable changed.",
    settings.banEmojis ? "Do not include emojis or emoticons in the response." : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildTurnPromptRequest(
  card: RuntimeCard,
  activeLorebookEntries: LorebookEntry[],
  messages: Message[],
  draft: string,
  runtimeSettings: RuntimeSettings,
  activePersona: Persona | null = null,
  overrides: Partial<TurnPromptRequest> = {},
): TurnPromptRequest {
  const sceneText = buildSceneText([
    ...messages.slice(-6).map((message) => message.content),
    draft,
    card.rpg?.location,
    ...(card.rpg?.quests ?? []),
  ]);
  const orderedMemory = orderByRelevance(
    card.memory,
    (entry) => `${entry.label} ${entry.detail}`,
    sceneText,
  );
  const presentEntityNames = selectPresentNames(
    (card.storyEntities ?? []).map((entity) => entity.name),
    sceneText,
  );
  return {
    session: {
      id: `session_${card.id}`,
      title: card.name,
      mode: card.kind,
      summary: card.summary,
    },
    card: {
      id: card.id,
      name: card.name,
      kind: card.kind,
      summary: card.summary,
      systemPrompt: card.systemPrompt,
      characterDefinition: formatDetailedCharacterDefinition(card),
      userPersona: formatPersonaPrompt(activePersona),
      preHistoryInstructions: card.preHistoryInstructions,
      postHistoryInstructions: card.postHistoryInstructions,
    },
    messages,
    latestUserMessage: draft.trim() || "(empty)",
    rules: card.playerRules,
    memoryEntries: orderedMemory.map((entry) => ({
      id: entry.id,
      label: entry.label,
      detail: entry.detail,
    })),
    loreEntries: activeLorebookEntries.map((entry) => ({
      id: entry.id,
      title: entry.title,
      content: entry.content,
      priority: entry.priority,
      enabled: entry.enabled,
    })),
    rpgState: card.rpg
      ? {
          id: `state_${card.id}`,
          location: card.rpg.location,
          health: card.rpg.health,
          inventory: card.rpg.inventory,
          quests: card.rpg.quests,
          knownPlaces: card.rpg.knownPlaces,
          flags: card.rpg.flags,
        }
      : null,
    knowledgeBoundaries: [
      "Characters should only know what the card, active lore, memory, current scene, or explicit story entity ledger gives them reason to know. The narrator may know the broader scene state.",
      formatStoryEntitiesForKnowledgeBoundary(card.storyEntities, presentEntityNames),
    ].filter(Boolean).join("\n\n"),
    tokenBudget: { maxInputTokens: 6_000, reservedOutputTokens: 900 },
    responseContract: buildResponseContract(runtimeSettings),
    preferStreaming: runtimeSettings.textStreaming,
    ...overrides,
  };
}

export function buildLocalProviderResponse(card: RuntimeCard, draft: string, activeLoreCount: number): string {
  const cleanedDraft = draft.trim() || "The player hesitates.";
  if (cleanedDraft === randomOpeningAction) {
    if (card.kind === "rpg") {
      return [
        "You come to yourself at the edge of an unnamed place, with just enough detail to start choosing what matters.",
        "Decide who you are, what is immediately around you, and what you do first.",
        activeLoreCount > 0
          ? `${activeLoreCount} lore entry applies, so the opening keeps that continuity in view.`
          : "No lore entry fires yet, so this opening stays flexible until you define the world.",
      ].join(" ");
    }

    return `${card.name} is ready. Describe who is here, where they are, and what happens first.`;
  }
  if (card.kind === "rpg") {
    return [
      `The action is checked against ${card.name}'s active RPG rules before the scene moves.`,
      `Player action: ${cleanedDraft}`,
      activeLoreCount > 0
        ? `${activeLoreCount} lore entry applies, so the response keeps that continuity in view.`
        : "No lore entry fires, so the scene stays close to established state.",
      "Any location, item, health, or flag change is saved only after local validation.",
    ].join(" ");
  }

  return `${card.name} answers within this character card's scope: ${cleanedDraft}`;
}

export function buildMockHiddenContinuityResponse(card: RuntimeCard, draft: string): unknown {
  const cleanedDraft = draft.trim();
  const playerNameMatch = cleanedDraft.match(/\bI\s+am\s+([A-Z][A-Za-z'-]{1,40})\b/);
  const playerName = playerNameMatch ? playerNameMatch[1] : "";
  const playerDescriptionMatch = playerName
    ? cleanedDraft.match(new RegExp(`\\bI\\s+am\\s+${escapeRegExp(playerName)}\\s*,\\s*([^.!?]+)`, "i"))
    : null;
  const playerDescription = playerDescriptionMatch ? cleanExtractedPhrase(playerDescriptionMatch[1]) : "";
  const nearbyCharacterMatch = cleanedDraft.match(/\b(?:beside|with|near|meet|meets|see|saw|talk(?:ing)? to|speak(?:ing)? to)\s+([A-Z][A-Za-z'-]{1,40})\b/);
  const nearbyCharacter = nearbyCharacterMatch ? nearbyCharacterMatch[1] : "";
  const doesNotKnowMatch = cleanedDraft.match(/\b([A-Z][A-Za-z'-]{1,40})\s+does\s+not\s+know\s+(?:about\s+)?(?:the\s+)?([^.!?]+)/i);
  const unknownSubject = doesNotKnowMatch ? doesNotKnowMatch[1] : "";
  const unknownFact = doesNotKnowMatch ? cleanExtractedPhrase(doesNotKnowMatch[2]) : "";
  const locationMatch = cleanedDraft.match(/\b(?:in|at|inside|within)\s+(?:a|an|the)?\s*([a-z][a-z0-9 '-]{2,50})\b/i);
  const location = locationMatch ? cleanExtractedPhrase(locationMatch[1]) : "";
  const entityUpdates: Array<Record<string, unknown>> = [];
  const memoryUpdates: Array<Record<string, unknown>> = [];
  const knowledgeUpdates: Array<Record<string, unknown>> = [];

  if (playerName) {
    const summary = playerDescription
      ? `${playerName} is ${playerDescription}.`
      : `${playerName} is the player character.`;
    entityUpdates.push({
      name: playerName,
      kind: "player",
      summary,
      known_facts: [`${playerName} knows their own identity.`],
      does_not_know: [],
      notes: [],
    });
    memoryUpdates.push({
      label: "Player character",
      detail: summary,
    });
  }

  if (nearbyCharacter && nearbyCharacter !== playerName) {
    const knownFacts = [
      playerName ? `${nearbyCharacter} knows ${playerName} is present.` : `${nearbyCharacter} knows the player character is present.`,
      location ? `${nearbyCharacter} knows the current scene is ${location}.` : "",
    ].filter(Boolean);
    const doesNotKnow = unknownSubject === nearbyCharacter && unknownFact ? [unknownFact] : [];
    entityUpdates.push({
      name: nearbyCharacter,
      kind: "character",
      summary: location ? `A story character present in ${location}.` : "A story character present in the current scene.",
      known_facts: knownFacts,
      does_not_know: doesNotKnow,
      notes: [],
    });
  }

  if (unknownSubject && unknownFact) {
    knowledgeUpdates.push({
      subject: unknownSubject,
      knows: [],
      does_not_know: [unknownFact],
    });
  }

  const briefParts = [
    playerName ? `${playerName} is the player character.` : "",
    nearbyCharacter ? `${nearbyCharacter} is a tracked story character.` : "",
    unknownSubject && unknownFact ? `${unknownSubject} explicitly does not know ${unknownFact}.` : "",
  ].filter(Boolean);

  return {
    continuity_brief: briefParts.join(" ") || "No durable continuity update was identified.",
    memory_updates: memoryUpdates,
    entity_updates: entityUpdates,
    knowledge_updates: knowledgeUpdates,
    warnings: [],
  };
}

export function buildMockExtractionProposal(card: RuntimeCard, draft: string): unknown {
  const lower = draft.toLowerCase();
  const locationMatch = lower.match(/\b(?:go|move|travel|walk|head|enter)\s+(?:to|into|toward|through)\s+(?:the\s+)?([a-z0-9][a-z0-9 '-]{1,42})/i);
  const itemMatch = lower.match(/\b(?:take|pick up|collect|grab|loot)\s+(?:the\s+)?([a-z0-9][a-z0-9 '-]{1,36})/i);
  const learnsMatch = draft.match(
    /\b([A-Z][A-Za-z'-]{1,40})\s+(?:now\s+)?(?:learns|learned|discovers|discovered|realizes|realized)\s+(?:that\s+)?([^.!?]+)/,
  );
  const location = locationMatch ? cleanExtractedPhrase(locationMatch[1]) : null;
  const item = itemMatch ? cleanExtractedPhrase(itemMatch[1]) : null;
  const worldFlags: Record<string, boolean | number | string> = {};

  if (/\b(open|unlock)\b.*\bgate\b/.test(lower)) {
    worldFlags.gate_open = true;
  }

  return {
    new_characters: [],
    updated_characters: [],
    new_events: [],
    character_knowledge_updates: learnsMatch
      ? [
          {
            subject: learnsMatch[1],
            knows: [cleanExtractedPhrase(learnsMatch[2])],
          },
        ]
      : [],
    relationship_updates: [],
    memory_updates: [],
    rpg_state_updates: {
      location: card.kind === "rpg" && location ? titleCase(location) : null,
      health_delta: 0,
      inventory_add: card.kind === "rpg" && item ? [item] : [],
      inventory_remove: [],
      quest_updates: [],
      world_flags: card.kind === "rpg" ? worldFlags : {},
    },
    image_prompt_opportunity: {
      should_generate: false,
      reason: null,
      visual_scene_summary: null,
    },
    continuity_warnings: [],
  };
}

export function cleanExtractedPhrase(value: string): string {
  return value
    .split(/\s+(?:and|then|before|after)\s+|[.,;]/)[0]
    .trim();
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
