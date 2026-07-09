// Map/photo image-prompt planning helpers extracted from App.tsx.
import { compileImagePrompt, type CompiledImagePrompt } from "../runtime/imagePromptCompiler";
import {
  parseAssistantMessageDisplay,
  parseStatusItems,
  splitTrailingStatusBlock,
} from "./assistantMessageParsing";
import type { Message, ProviderSettings, RuntimeCard, RuntimeSettings } from "./runtimeTypes";
import { createTextProvider } from "./providerConfig";

export async function planImagePromptWithTextModel(input: {
  card: RuntimeCard;
  messages: Message[];
  providerSettings: ProviderSettings;
  sessionApiKey: string;
  activeLoreCount: number;
  runtimeSettings: RuntimeSettings;
}): Promise<CompiledImagePrompt> {
  const fallback = compileImagePrompt(buildImagePromptRequest(input.card, input.messages));
  const provider = createTextProvider(
    input.providerSettings,
    input.sessionApiKey,
    input.card,
    "Aerial image prompt planning",
    input.activeLoreCount,
  );
  const response = await provider.generateText({
    model: input.providerSettings.model,
    temperature: 0.2,
    maxOutputTokens: 700,
    prompt: buildMapPromptPlannerPrompt(input.card, input.messages, fallback, input.runtimeSettings),
    metadata: {
      purpose: "image_prompt_planning",
      cardId: input.card.id,
      cardKind: input.card.kind,
    },
  });
  const planned = parsePlannedImagePrompt(response.text);
  const plannedPrompt = planned.prompt || fallback.prompt;

  return {
    prompt: input.card.kind === "rpg" ? normalizeRpgAerialImagePrompt(plannedPrompt) : plannedPrompt,
    negativePrompt: planned.negativePrompt || fallback.negativePrompt,
    includedLayers: [...fallback.includedLayers, "textModelPlanner"],
    providerFormatting: fallback.providerFormatting,
  };
}

export function buildMapPromptPlannerPrompt(
  card: RuntimeCard,
  messages: Message[],
  fallback: CompiledImagePrompt,
  runtimeSettings: RuntimeSettings,
): string {
  const recentChat = formatRecentChatForMapPlanner(card, messages);
  const state = card.rpg
    ? [
        `Location: ${card.rpg.location || "unmapped area"}`,
        `Known places: ${card.rpg.knownPlaces.join(", ") || "none established"}`,
        `Inventory: ${card.rpg.inventory.join(", ") || "none"}`,
        `Health/status: ${card.rpg.health || "not configured"}`,
        `Map style: ${card.rpg.mapStyle}`,
        `Atmosphere (weather, era, light): ${deriveAerialAtmosphere(card, messages) || "unspecified; match the established setting"}`,
      ].join("\n")
    : [`Scenario: ${card.scenario || card.summary}`, `Character: ${card.characterName || card.name}`].join("\n");

  return [
    "You are a map/image prompt planner, not the story narrator and not an in-character speaker.",
    "Read the recent chat and create a concise prompt for the image generator. Do not continue the roleplay. Do not quote the transcript wholesale.",
    "Focus only on visual requirements: large environment features, spatial relationships, mood, lighting, camera, and continuity details visible from the requested aerial height.",
    card.kind === "rpg"
      ? "For RPG aerial images, do not make a map, cartographic layout, diagram, tabletop reference, or labeled game board. Describe an overhead environment image from about 200 feet above ground. Include only large features that would be visible from 200 feet up, such as clearings, tree clusters, rivers, ponds, shorelines, roads, trails, bridges, ruins, buildings, fires, smoke, fields, hills, or coastlines. Do not include recent actions, inventory, fish, sticks, small tools, facial details, text labels, people, characters, player figures, silhouettes, tokens, portraits, or a single figure unless they are visibly large from that height. Put those exclusions in negativePrompt."
      : "",
    card.kind === "rpg"
      ? "Reflect the setting's era through the architecture, materials, and land use, and show the current weather and broad time of day through lighting and atmosphere. Never draw a clock, watch, sundial, timestamp, or any written time."
      : "",
    "Return only compact JSON with keys `prompt` and `negativePrompt`. No markdown, no commentary.",
    runtimeSettings.banEmojis ? "Do not use emojis." : "",
    "",
    "Active visual state:",
    state,
    "",
    "Recent chat context:",
    recentChat || "(no chat yet)",
    "",
    "Local fallback prompt to improve, not copy:",
    fallback.prompt,
    "",
    "JSON response shape:",
    card.kind === "rpg"
      ? `{"prompt":"overhead aerial environment image from about 200 feet above ground, visible terrain and large landmarks only","negativePrompt":"map, cartographic layout, labels, text, people, characters, player figure, small handheld objects, fish, sticks, first-person view"}`
      : `{"prompt":"image prompt here","negativePrompt":"things to avoid here"}`,
  ]
    .filter((line) => line !== "")
    .join("\n");
}

export function parsePlannedImagePrompt(text: string): Pick<CompiledImagePrompt, "prompt" | "negativePrompt"> {
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
      return {
        prompt: typeof parsed.prompt === "string" ? parsed.prompt.trim() : "",
        negativePrompt:
          typeof parsed.negativePrompt === "string"
            ? parsed.negativePrompt.trim()
            : typeof parsed.negative_prompt === "string"
              ? parsed.negative_prompt.trim()
              : "",
      };
    } catch {
      // Fall through to plain text handling.
    }
  }

  return {
    prompt: text.trim(),
    negativePrompt: "",
  };
}

export function normalizeRpgAerialImagePrompt(prompt: string): string {
  return prompt
    .replace(/\bvery high-altitude\b/gi, "overhead")
    .replace(/\b(?:500|1000|2000)\s+feet\b/gi, "200 feet")
    .replace(/\b(?:map|cartographic layout|cartographic|tabletop reference|tabletop map|game board|diagram)\b/gi, "aerial environment image")
    .replace(/\breadable labels?\b/gi, "visible large landmarks")
    .replace(/\s+/g, " ")
    .trim();
}

export function sanitizeMapNegativePrompt(value: string): string {
  const allowedMapFeaturePattern =
    /\b(?:trees?|forests?|woods?|rivers?|streams?|creeks?|roads?|paths?|trails?|hills?|mountains?|rocks?|boulders?|grass|plains?|fields?|buildings?|ruins?|landmarks?|water|lakes?|ponds?|labels?|terrain|vegetation|foliage)\b/i;

  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => !allowedMapFeaturePattern.test(item))
    .join(", ");
}

export function formatRecentChatForMapPlanner(card: RuntimeCard, messages: Message[]): string {
  return messages
    .filter((message) => message.role !== "system")
    .slice(-8)
    .map((message) => {
      const content = message.role === "assistant"
        ? parseAssistantMessageDisplay(message.content).paragraphs.join(" ")
        : message.content;
      return `${message.role === "user" ? "Player" : card.name}: ${compactForPromptPlanning(content)}`;
    })
    .join("\n");
}

export const AERIAL_WEATHER_CUES: Array<[RegExp, string]> = [
  [/\b(thunder|lightning|storm|tempest)\b/i, "stormy skies"],
  [/\b(downpour|heavy rain|rain|drizzle|rainfall|raining)\b/i, "rain"],
  [/\b(snow|blizzard|sleet|snowfall|snowing)\b/i, "snow"],
  [/\b(fog|mist|haze|misty|foggy)\b/i, "fog and haze"],
  [/\b(overcast|cloudy|grey sky|gray sky|clouded)\b/i, "overcast clouds"],
  [/\b(clear sky|sunny|cloudless|blue sky|bright sun)\b/i, "clear skies"],
];

export const AERIAL_ERA_CUES: Array<[RegExp, string]> = [
  [/\b(steampunk|clockwork|airship)\b/i, "steampunk industrial"],
  [/\b(victorian|industrial|factory|gaslight|steam engine)\b/i, "industrial-era"],
  [/\b(medieval|feudal|castle|knight|keep|fiefdom|serf)\b/i, "medieval"],
  [/\b(ancient|antiquity|roman|greek|pharaoh|bronze age|marble column)\b/i, "ancient"],
  [/\b(renaissance|baroque)\b/i, "renaissance"],
  [/\b(futuristic|cyber|neon city|spaceport|starship|hologram)\b/i, "futuristic"],
  [/\b(post-?apocalyp|wasteland|ruined city|scavenger)\b/i, "post-apocalyptic ruins"],
  [/\b(modern|city street|skyscraper|automobile|highway)\b/i, "modern-day"],
  [/\b(arcane|wizard|enchanted|rune|dragon|sorcery)\b/i, "high-fantasy"],
];

export const AERIAL_TIME_LIGHT_CUES: Array<[RegExp, string]> = [
  [/\b(dawn|sunrise|first light|daybreak)\b/i, "soft dawn light"],
  [/\b(morning|forenoon)\b/i, "clear morning light"],
  [/\b(noon|midday|high sun)\b/i, "bright overhead daylight"],
  [/\b(afternoon)\b/i, "warm afternoon light"],
  [/\b(dusk|sunset|twilight|evening|gloaming)\b/i, "golden dusk light"],
  [/\b(night|midnight|nightfall|moonlit|starlit)\b/i, "moonlit night"],
];

/**
 * Derives an aerial atmosphere descriptor (weather, setting era, and broad
 * time-of-day expressed as lighting) from the scene. Time is deliberately
 * rendered as a lighting mood, never a clock reading, and the era captures the
 * period's architecture/materials rather than a timestamp.
 */
export function deriveAerialAtmosphere(card: RuntimeCard, messages: Message[]): string {
  const lastAssistant = [...messages].reverse().find((message) => message.role === "assistant");
  const status = lastAssistant ? parseStatusItems(splitTrailingStatusBlock(lastAssistant.content).statusBlock) : [];
  const statusValue = (label: RegExp): string => status.find((item) => label.test(item.label))?.value ?? "";
  const recentText = messages.slice(-4).map((message) => message.content).join(" ");
  const eraSource = `${card.summary} ${card.scenario} ${card.systemPrompt} ${recentText}`;

  const weather = matchCue([statusValue(/weather/i), recentText].join(" "), AERIAL_WEATHER_CUES);
  const era = matchCue(eraSource, AERIAL_ERA_CUES);
  const light = matchCue([statusValue(/time/i), recentText].join(" "), AERIAL_TIME_LIGHT_CUES);

  return [
    weather ? `weather ${weather}` : "",
    era ? `${era} setting architecture and materials` : "",
    light ? `${light}` : "",
  ]
    .filter(Boolean)
    .join(", ");
}

export function matchCue(text: string, cues: ReadonlyArray<[RegExp, string]>): string {
  for (const [pattern, label] of cues) {
    if (pattern.test(text)) {
      return label;
    }
  }
  return "";
}

export function buildImagePromptRequest(card: RuntimeCard, messages: Message[]): Parameters<typeof compileImagePrompt>[0] {
  const recentStory = summarizeRecentMessagesForMap(card, messages);
  const recentMapVisuals = summarizeRecentVisualsForMap(messages);
  const atmosphere = deriveAerialAtmosphere(card, messages);

  if (card.kind === "rpg" && card.rpg) {
    return {
      scene: `Overhead aerial RPG environment image for ${card.name}`,
      locationVisuals: [
        "view from about 200 feet above ground",
        `current location context: ${card.rpg.location || "unmapped area"}`,
        card.rpg.knownPlaces.length > 0
          ? `established large landmarks only if visible from 200 feet: ${card.rpg.knownPlaces.join(", ")}`
          : "do not invent towns, roads, buildings, or cities unless established and visible",
        recentMapVisuals ? `recent aerial-visible features only: ${recentMapVisuals}` : "",
      ]
        .filter(Boolean)
        .join("; "),
      mood: `natural overhead scene image, readable terrain and large landmarks, no story transcript text${atmosphere ? `, ${atmosphere}` : ""}`,
      camera: "strict top-down overhead view from about 200 feet above ground",
      stylePreset: "cinematic aerial terrain image, natural terrain detail, large visible landmarks",
      continuityLocks: Object.entries(card.rpg.flags)
        .filter(([flag]) => isAerialVisibleFeatureText(flag))
        .map(([flag, value]) => `${flag}=${value}`),
      negativePrompt: [
        "map",
        "cartographic layout",
        "diagram",
        "tabletop game board",
        "labels",
        "text",
        "people",
        "characters",
        "player figure",
        "single figure",
        "silhouettes",
        "portraits",
        "tokens",
        "fish",
        "sticks",
        "small handheld objects",
        "inventory items",
        "recent action scene",
        "first-person view",
        "low-angle view",
        "random extra buildings",
        "blurry",
      ],
      providerFormatting: "generic",
    };
  }

  return {
    scene: `Story image for ${card.name}`,
    locationVisuals: card.scenario || card.summary,
    characters: [
      {
        name: card.characterName || card.name,
        appearance: card.characterDescription || card.summary,
      },
    ],
    currentAction: recentStory ? `latest exchange perspective: ${recentStory}` : undefined,
    mood: "coherent in-world illustration, grounded in the established card",
    camera: "cinematic medium shot",
    stylePreset: "detailed story illustration, consistent character design",
    continuityLocks: [card.systemPrompt, card.preHistoryInstructions, card.postHistoryInstructions].filter(Boolean),
    negativePrompt: ["off-model character", "random extra characters", "unrelated setting", "blurry", "watermark"],
    providerFormatting: "generic",
  };
}

export function summarizeRecentVisualsForMap(messages: Message[]): string {
  const features = messages
    .filter((message) => message.role !== "system")
    .slice(-8)
    .flatMap((message) => {
      const content =
        message.role === "assistant"
          ? parseAssistantMessageDisplay(message.content).paragraphs.join(" ")
          : message.content;
      return cleanMapVisualText(content)
        .split(/(?:[.!?]\s+|\s+\|\s+|;\s+)/)
        .map((clause) => clause.trim())
        .filter(Boolean);
    })
    .map(cleanMapVisualText)
    .filter((clause) => clause.length > 0 && !isNegatedAerialFeatureClause(clause))
    .flatMap(extractAerialVisibleFeatures);

  return dedupeTextClauses(features)
    .slice(-8)
    .join("; ")
    .slice(0, 260)
    .trim();
}

export function extractAerialVisibleFeatures(value: string): string[] {
  const features: string[] = [];
  const add = (label: string, pattern: RegExp) => {
    if (pattern.test(value)) {
      features.push(label);
    }
  };

  add("clearing", /\bclearings?\b/i);
  add("tree cover", /\b(?:trees?|forest|woods?|grove|canopy)\b/i);
  add("river or stream", /\b(?:river|stream|creek)\b/i);
  add("pond or lake", /\b(?:pond|lake|water)\b/i);
  add("shoreline", /\b(?:shore|bank|coast|beach)\b/i);
  add("road or trail", /\b(?:roads?|paths?|trails?|track)\b/i);
  add("field or plain", /\b(?:plains?|fields?|grassland|meadow)\b/i);
  add("hills or mountains", /\b(?:hills?|mountains?|ridge)\b/i);
  add("large stones or ruins", /\b(?:standing stones?|boulders?|rocks?|ruins?)\b/i);
  add("large structure", /\b(?:buildings?|village|city|bridge|tower|gate|wall)\b/i);
  add("campfire or smoke", /\b(?:campfire|bonfire|firelight|smoke|large fire)\b/i);
  add("snow or sand terrain", /\b(?:snow|sand|desert|mud)\b/i);

  return features;
}

export function isAerialVisibleFeatureText(value: string): boolean {
  return extractAerialVisibleFeatures(cleanMapVisualText(value)).length > 0;
}

export function isNegatedAerialFeatureClause(value: string): boolean {
  return /\b(?:no|not|none|without|isn['’]?t|aren['’]?t|cannot|can't|no nearby|no visible|out of sight)\b/i.test(value);
}

export function cleanMapVisualText(value: string): string {
  return value
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/\b(?:SUCCESS|FAILURE|PARTIAL SUCCESS|MIXED SUCCESS)\b[:\s-]*/gi, "")
    .replace(/\b(?:Player|Assistant|Narrator|Blank Slate RPG)\s*:\s*/gi, "")
    .replace(/\b(?:you|i)\s+decide\s+to\s+/gi, "")
    .replace(/\b(?:you|i)\s+try\s+to\s+/gi, "")
    .replace(/\b(?:you|i)\s+/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function dedupeTextClauses(clauses: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const clause of clauses) {
    const normalized = clause.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    output.push(clause);
  }
  return output;
}

export function summarizeRecentMessagesForMap(card: RuntimeCard, messages: Message[]): string {
  return messages
    .filter((message) => message.role !== "system")
    .slice(-5)
    .map((message) => {
      const content = message.role === "assistant"
        ? parseAssistantMessageDisplay(message.content).paragraphs.join(" ")
        : message.content;
      return `${message.role === "user" ? "Player" : card.name}: ${compactForPromptPlanning(content)}`;
    })
    .join(" | ");
}

export function compactForPromptPlanning(value: string): string {
  const cleaned = value
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
  const sentence = cleaned.match(/^(.{1,220}?[.!?])(?:\s|$)/)?.[1] ?? cleaned.slice(0, 220);
  return sentence.trim();
}
