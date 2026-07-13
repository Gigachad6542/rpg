import { createDefaultRpgPlayerRules, createInitialStoryEntities } from "./cardNormalization";
import type { CardKind, Message, RuntimeCard } from "./runtimeTypes";

export type CardCreationDraft = {
  name: string;
  kind: CardKind;
  summary: string;
  characterName: string;
  characterDescription: string;
  scenario: string;
  greeting: string;
  exampleDialogs: string;
  systemPrompt: string;
  preHistoryInstructions: string;
  postHistoryInstructions: string;
  playerRules: string;
  lorebookName: string;
  mapEnabled: boolean;
};

export type CreationTemplate = {
  id: "mystery" | "survival" | "character-drama";
  name: string;
  description: string;
  draft: CardCreationDraft;
};

const sampleCardId = "card_ashfall_crossing";

export const PLAYABLE_SAMPLE_RPG: RuntimeCard = {
  id: sampleCardId,
  name: "Ashfall Crossing",
  kind: "rpg",
  summary: "A compact survival mystery about a mountain town cut off by an impossible red storm.",
  characterName: "Warden Sera Vale",
  characterDescription:
    "Sera Vale is the exhausted night warden of Ashfall Crossing. She is observant, direct, protective of the town, and unwilling to claim certainty without evidence.",
  scenario:
    "The player reaches Ashfall Crossing moments after a red ash storm seals the mountain road. The bell tower rings thirteen times, a courier is missing, and the town's emergency lanterns are failing. The story should offer investigation, negotiation, and risky travel rather than force a single solution.",
  greeting:
    "Red ash hisses against the shutters of the Lantern House. Warden Sera Vale bars the door behind you, then places a soot-streaked map on the table. “The north road vanished an hour ago, our courier never returned, and that bell just rang thirteen times. I can spare one lantern. Where do you want to begin?”",
  exampleDialogs:
    "Player: I inspect the map before choosing.\nSera: The river trail is longer but sheltered. The bell path is exposed, and someone marked the old observatory in fresh charcoal.\n\nPlayer: What are you not telling me?\nSera: I heard the missing courier's whistle after the road disappeared. It came from inside the sealed bell tower.",
  systemPrompt:
    "Run Ashfall Crossing as a fair, choice-driven survival mystery. Present concrete sensory evidence, preserve established state, and let plans succeed or fail according to risk and player preparation. Never decide the player's thoughts, dialogue, or actions. Do not reveal secrets until the player could plausibly learn them.",
  preHistoryInstructions:
    "Track the storm, lantern charge, known routes, clues, injuries, inventory, and what each character has actually learned.",
  postHistoryInstructions:
    "End with a changed situation or a clear decision point. Keep prose focused and avoid repeating prior descriptions unless the state changed.",
  playerRules: createDefaultRpgPlayerRules(),
  mapEnabled: true,
  tags: ["sample", "survival", "mystery", "rpg"],
  favorite: true,
  lorebooks: [
    {
      id: "lore_ashfall_crossing",
      name: "Ashfall Field Guide",
      enabled: true,
      scanDepth: 6,
      tokenBudget: 900,
      recursiveScanning: false,
      entries: [
        {
          id: "lore_ashfall_storm",
          title: "The Red Ash Storm",
          keys: ["red ash", "storm", "ashfall"],
          aliases: ["red storm"],
          secondaryKeys: [],
          content: "The storm muffles sound and erases exposed tracks within minutes. It is dangerous but not instantly lethal; covered routes and sealed lanterns reduce exposure.",
          insertionOrder: 100,
          priority: 20,
          enabled: true,
          constant: false,
          probability: 100,
          caseSensitive: false,
          wholeWord: false,
          matchMode: "literal",
          literalMatchBehavior: "boundary",
        },
        {
          id: "lore_ashfall_lantern",
          title: "Emergency Lantern",
          keys: ["lantern", "light", "charge"],
          aliases: ["storm lantern"],
          secondaryKeys: [],
          content: "A full storm lantern holds three charge marks. Crossing an exposed district consumes one mark unless the player finds protection or another light source.",
          insertionOrder: 110,
          priority: 15,
          enabled: true,
          constant: false,
          probability: 100,
          caseSensitive: false,
          wholeWord: false,
          matchMode: "literal",
          literalMatchBehavior: "boundary",
        },
        {
          id: "lore_ashfall_bell",
          title: "Bell Tower",
          keys: ["bell", "tower", "thirteen"],
          aliases: ["bell path"],
          secondaryKeys: [],
          content: "The bell tower was sealed after a rockslide ten years ago. Its public entrance is chained, but maintenance plans show a drain culvert beneath the east wall.",
          insertionOrder: 120,
          priority: 10,
          enabled: true,
          constant: false,
          probability: 100,
          caseSensitive: false,
          wholeWord: false,
          matchMode: "literal",
          literalMatchBehavior: "boundary",
        },
        {
          id: "lore_ashfall_sera",
          title: "Warden Sera Vale",
          keys: ["Sera", "warden"],
          aliases: ["Vale"],
          secondaryKeys: [],
          content: "Sera knows the maintained routes and emergency stores. She heard the courier's coded whistle from the tower but has not entered it and does not know why it rang.",
          insertionOrder: 130,
          priority: 10,
          enabled: true,
          constant: false,
          probability: 100,
          caseSensitive: false,
          wholeWord: false,
          matchMode: "literal",
          literalMatchBehavior: "boundary",
        },
      ],
    },
  ],
  memory: [],
  storyEntities: createInitialStoryEntities(sampleCardId),
  rpg: {
    location: "Lantern House, Ashfall Crossing",
    health: "unhurt",
    inventory: ["storm lantern (3 charges)", "soot-streaked town map"],
    quests: ["Find the missing courier before the storm reaches the lower ward"],
    flags: {
      bell_rang_thirteen: true,
      north_road_open: false,
      courier_found: false,
    },
    knownPlaces: ["Lantern House", "bell tower path", "river trail", "old observatory"],
    mapStyle: "weathered mountain-town map, readable labels, red storm boundary, lantern-safe routes",
  },
};

const sharedTemplate = {
  characterName: "",
  characterDescription: "",
  exampleDialogs: "",
  preHistoryInstructions: "Track established facts, character knowledge, and consequences separately.",
  postHistoryInstructions: "End with a concrete change or a meaningful choice for the player.",
  lorebookName: "",
};

export const CREATION_TEMPLATES: readonly CreationTemplate[] = [
  {
    id: "mystery",
    name: "Choice-driven mystery",
    description: "Evidence, suspects, secrets, and several viable theories.",
    draft: {
      ...sharedTemplate,
      name: "New Mystery",
      kind: "rpg",
      summary: "A clue-driven mystery where conclusions follow from evidence.",
      scenario: "Define the incident, location, suspects, opening evidence, and the pressure that keeps the case moving.",
      greeting: "Open on a specific discovery and ask what the player examines or does first.",
      systemPrompt: "Run a fair mystery. Track evidence and knowledge. Never move clues or change the culprit to invalidate sound player reasoning.",
      playerRules: "Do not reveal hidden facts without an in-world discovery.\nOffer multiple viable investigative approaches.",
      lorebookName: "Case file",
      mapEnabled: true,
    },
  },
  {
    id: "survival",
    name: "Survival expedition",
    description: "A dangerous route with explicit resources, locations, and tradeoffs.",
    draft: {
      ...sharedTemplate,
      name: "New Expedition",
      kind: "rpg",
      summary: "A survival journey driven by preparation and resource tradeoffs.",
      scenario: "Define the destination, environmental hazard, starting supplies, known routes, and why turning back is costly.",
      greeting: "Open at the final safe shelter with a route decision and visible resource constraints.",
      systemPrompt: "Run a grounded survival expedition. Apply hazards consistently, surface risks before irreversible choices, and reward preparation.",
      playerRules: "Inventory and injuries must matter.\nDo not create free supplies or effortless safe passage.",
      lorebookName: "Expedition field guide",
      mapEnabled: true,
    },
  },
  {
    id: "character-drama",
    name: "Character drama",
    description: "A focused relationship scene with boundaries and evolving trust.",
    draft: {
      ...sharedTemplate,
      name: "New Character",
      kind: "character",
      summary: "A consistent character with goals, boundaries, and room for the player to act.",
      characterName: "Character name",
      characterDescription: "Define voice, motivations, boundaries, fears, current knowledge, and what can change over time.",
      scenario: "Define why the player and character are together now, what each wants, and the immediate source of tension.",
      greeting: "Open with the character doing something specific, then leave a clear opening for the player.",
      systemPrompt: "Portray the character consistently without narrating the player's thoughts, words, or actions. Let trust change through observed choices.",
      playerRules: "Never decide the player's actions or feelings.\nKeep character knowledge limited to what they witnessed or learned.",
      lorebookName: "Character context",
      mapEnabled: false,
    },
  },
];

export const MOCK_DEMO_MESSAGES: Message[] = [];

export function applyCreationTemplate(templateId: CreationTemplate["id"] | string): CardCreationDraft {
  const template = CREATION_TEMPLATES.find((candidate) => candidate.id === templateId);
  if (!template) {
    throw new Error("Unknown creation template.");
  }
  return { ...template.draft };
}
