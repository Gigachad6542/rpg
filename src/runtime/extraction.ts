import { z } from "zod";

const JsonPrimitiveSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const LooseObjectSchema = z.record(z.unknown());

export const RpgStateUpdatesSchema = z
  .object({
    location: z.string().nullable().default(null),
    health_delta: z.number().int().default(0),
    inventory_add: z.array(z.string()).default([]),
    inventory_remove: z.array(z.string()).default([]),
    quest_updates: z.array(LooseObjectSchema).default([]),
    world_flags: z.record(JsonPrimitiveSchema).default({}),
  })
  .default({});

export const ImagePromptOpportunitySchema = z
  .object({
    should_generate: z.boolean().default(false),
    reason: z.string().nullable().default(null),
    visual_scene_summary: z.string().nullable().default(null),
  })
  .default({});

export const ExtractionResultSchema = z.object({
  new_characters: z.array(LooseObjectSchema).default([]),
  updated_characters: z.array(LooseObjectSchema).default([]),
  new_events: z.array(LooseObjectSchema).default([]),
  character_knowledge_updates: z.array(LooseObjectSchema).default([]),
  relationship_updates: z.array(LooseObjectSchema).default([]),
  memory_updates: z.array(LooseObjectSchema).default([]),
  rpg_state_updates: RpgStateUpdatesSchema,
  image_prompt_opportunity: ImagePromptOpportunitySchema,
  continuity_warnings: z.array(z.string()).default([]),
});

export type ExtractionResult = z.infer<typeof ExtractionResultSchema>;

export interface ExtractionValidationIssue {
  path: string;
  message: string;
}

export type ExtractionValidationResult =
  | {
      success: true;
      data: ExtractionResult;
    }
  | {
      success: false;
      issues: ExtractionValidationIssue[];
    };

export function createEmptyExtractionResult(): ExtractionResult {
  return ExtractionResultSchema.parse({});
}

export function validateExtractionResult(input: unknown): ExtractionValidationResult {
  const result = ExtractionResultSchema.safeParse(normalizeExtractionPayload(input));

  if (result.success) {
    return {
      success: true,
      data: result.data,
    };
  }

  return {
    success: false,
    issues: result.error.issues.map((issue) => ({
      path: issue.path.join("."),
      message: issue.message,
    })),
  };
}

function normalizeExtractionPayload(input: unknown): unknown {
  if (!isRecord(input)) {
    return input;
  }

  return {
    ...input,
    new_characters: input.new_characters ?? input.newCharacters,
    updated_characters: input.updated_characters ?? input.updatedCharacters,
    new_events: input.new_events ?? input.newEvents,
    character_knowledge_updates: input.character_knowledge_updates ?? input.characterKnowledgeUpdates,
    relationship_updates: input.relationship_updates ?? input.relationshipUpdates,
    memory_updates: input.memory_updates ?? input.memoryUpdates,
    rpg_state_updates: normalizeRpgStateUpdates(input.rpg_state_updates ?? input.rpgStateUpdates),
    image_prompt_opportunity: normalizeImagePromptOpportunity(
      input.image_prompt_opportunity ?? input.imagePromptOpportunity,
    ),
    continuity_warnings: normalizeContinuityWarnings(input.continuity_warnings ?? input.continuityWarnings),
  };
}

function normalizeRpgStateUpdates(input: unknown): unknown {
  if (!isRecord(input)) {
    return input;
  }

  return {
    ...input,
    health_delta: input.health_delta ?? input.healthDelta,
    inventory_add: input.inventory_add ?? input.inventoryAdd,
    inventory_remove: input.inventory_remove ?? input.inventoryRemove,
    quest_updates: input.quest_updates ?? input.questUpdates,
    world_flags: input.world_flags ?? input.worldFlags,
  };
}

function normalizeImagePromptOpportunity(input: unknown): unknown {
  if (!isRecord(input)) {
    return input;
  }

  return {
    ...input,
    should_generate: input.should_generate ?? input.shouldGenerate,
    visual_scene_summary: input.visual_scene_summary ?? input.visualSceneSummary,
  };
}

function normalizeContinuityWarnings(input: unknown): unknown {
  if (!Array.isArray(input)) {
    return input;
  }

  return input.map((warning) => {
    if (typeof warning === "string") {
      return warning;
    }
    if (isRecord(warning) && typeof warning.message === "string") {
      return warning.message;
    }
    return warning;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
