import { describe, expect, it } from "vitest";

import { createEmptyExtractionResult, validateExtractionResult } from "../../src/runtime/extraction";

describe("extraction validation", () => {
  it("accepts a mock extraction payload and fills omitted defaults", () => {
    const result = validateExtractionResult({
      new_events: [{ id: "event_1", summary: "The player reached a user-defined threshold." }],
      rpg_state_updates: {
        location: "Unmapped threshold",
        health_delta: -2,
        inventory_add: ["linen"],
      },
    });

    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error("expected extraction validation to pass");
    }

    expect(result.data.new_characters).toEqual([]);
    expect(result.data.new_events).toHaveLength(1);
    expect(result.data.rpg_state_updates.location).toBe("Unmapped threshold");
    expect(result.data.rpg_state_updates.inventory_remove).toEqual([]);
    expect(result.data.image_prompt_opportunity.should_generate).toBe(false);
  });

  it("rejects malformed state updates without throwing", () => {
    const result = validateExtractionResult({
      ...createEmptyExtractionResult(),
      rpg_state_updates: {
        ...createEmptyExtractionResult().rpg_state_updates,
        health_delta: "badly wounded",
      },
    });

    expect(result.success).toBe(false);
    if (result.success) {
      throw new Error("expected extraction validation to fail");
    }

    expect(result.issues[0]?.path).toContain("rpg_state_updates.health_delta");
  });

  it("normalizes camelCase model extraction payloads into the runtime schema", () => {
    const result = validateExtractionResult({
      newEvents: [{ id: "event_2", summary: "The player crossed the bridge." }],
      rpgStateUpdates: {
        healthDelta: -1,
        inventoryAdd: ["bridge token"],
        worldFlags: {
          bridgeCrossed: true,
        },
      },
      imagePromptOpportunity: {
        shouldGenerate: true,
        visualSceneSummary: "A bridge over a dark canal.",
      },
      continuityWarnings: [{ message: "Bridge crossing may conflict with prior location." }],
    });

    expect(result.success).toBe(true);
    if (!result.success) {
      throw new Error("expected extraction validation to pass");
    }

    expect(result.data.new_events).toEqual([{ id: "event_2", summary: "The player crossed the bridge." }]);
    expect(result.data.rpg_state_updates.health_delta).toBe(-1);
    expect(result.data.rpg_state_updates.inventory_add).toEqual(["bridge token"]);
    expect(result.data.rpg_state_updates.world_flags).toEqual({ bridgeCrossed: true });
    expect(result.data.image_prompt_opportunity.should_generate).toBe(true);
    expect(result.data.image_prompt_opportunity.visual_scene_summary).toBe("A bridge over a dark canal.");
    expect(result.data.continuity_warnings).toEqual(["Bridge crossing may conflict with prior location."]);
  });
});
