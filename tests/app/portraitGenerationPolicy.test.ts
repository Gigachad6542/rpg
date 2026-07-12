import { describe, expect, it } from "vitest";

import {
  entityAppearsInVisibleMessages,
  shouldPrepareCharacterPortrait,
  shouldRunCharacterPortraitGeneration,
} from "../../src/app/generatedImages";
import { sanitizePersistedImageProviderSettings } from "../../src/app/localRuntimeStore";
import { parseImageProviderSettings } from "../../src/app/providerConfig";
import type { Message } from "../../src/app/runtimeTypes";
import type { StoryEntity } from "../../src/runtime/hiddenContinuity";

const rook: StoryEntity = {
  id: "story-rook",
  name: "Rook",
  kind: "character",
  summary: "A harbor scout.",
  knownFacts: [],
  doesNotKnow: [],
};

function message(id: string, role: Message["role"], content: string): Message {
  return { id, role, content };
}

describe("character portrait generation policy", () => {
  it("defaults legacy settings to confirm-first and preserves explicit safe modes", () => {
    expect(parseImageProviderSettings({}).portraitGenerationMode).toBe("confirm-first");
    expect(parseImageProviderSettings({ portraitGenerationMode: "auto" }).portraitGenerationMode).toBe("auto");
    expect(parseImageProviderSettings({ portraitGenerationMode: "off" }).portraitGenerationMode).toBe("off");
    expect(parseImageProviderSettings({ portraitGenerationMode: "invalid" }).portraitGenerationMode).toBe(
      "confirm-first",
    );
    expect(
      sanitizePersistedImageProviderSettings({ portraitGenerationMode: "auto" }),
    ).toMatchObject({ portraitGenerationMode: "auto" });
  });

  it("requires the entity name in player-visible user or assistant text", () => {
    expect(entityAppearsInVisibleMessages(rook, [message("u1", "user", "I speak with Rook.")])).toBe(true);
    expect(entityAppearsInVisibleMessages(rook, [message("a1", "assistant", "ROOK steps onto the pier.")])).toBe(true);
    expect(entityAppearsInVisibleMessages(rook, [message("s1", "system", "Secret entity: Rook")])).toBe(false);
    expect(entityAppearsInVisibleMessages(rook, [message("a2", "assistant", "A brook crosses the road.")])).toBe(false);
    expect(entityAppearsInVisibleMessages(rook, [])).toBe(false);
  });

  it("prepares only visible portraits and reserves provider calls for auto mode", () => {
    const visible = [message("a1", "assistant", "Rook waits by the gate.")];
    const hiddenOnly = [message("a2", "assistant", "The gate appears deserted.")];

    expect(shouldPrepareCharacterPortrait(rook, visible, "auto")).toBe(true);
    expect(shouldPrepareCharacterPortrait(rook, visible, "confirm-first")).toBe(true);
    expect(shouldPrepareCharacterPortrait(rook, visible, "off")).toBe(false);
    expect(shouldPrepareCharacterPortrait(rook, hiddenOnly, "auto")).toBe(false);
    expect(shouldRunCharacterPortraitGeneration("auto")).toBe(true);
    expect(shouldRunCharacterPortraitGeneration("confirm-first")).toBe(false);
    expect(shouldRunCharacterPortraitGeneration("off")).toBe(false);
  });
});
