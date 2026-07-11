import { describe, expect, it } from "vitest";

import {
  buildEmbeddableAvatarDataUrl,
  fitsEmbeddedAvatarBudget,
  MAX_EMBEDDED_AVATAR_DATA_URL_CHARS,
} from "../../src/app/avatarImage";
import { normalizeRuntimeCards } from "../../src/app/cardNormalization";
import type { RuntimeCard } from "../../src/app/runtimeTypes";

describe("avatar embed budget", () => {
  it("accepts data urls within the persistence budget and rejects oversized ones", () => {
    expect(fitsEmbeddedAvatarBudget("data:image/png;base64,AAAA")).toBe(true);
    expect(fitsEmbeddedAvatarBudget("x".repeat(MAX_EMBEDDED_AVATAR_DATA_URL_CHARS + 1))).toBe(false);
    expect(fitsEmbeddedAvatarBudget(undefined)).toBe(false);
  });

  it("keeps small images unchanged", async () => {
    const blob = new Blob([new Uint8Array(1_000)], { type: "image/png" });
    const result = await buildEmbeddableAvatarDataUrl(blob);
    expect(result?.downscaled).toBe(false);
    expect(result?.dataUrl.startsWith("data:")).toBe(true);
  });

  it("downscales oversized images via the encoder", async () => {
    const blob = new Blob([new Uint8Array(400_000)], { type: "image/png" });
    const result = await buildEmbeddableAvatarDataUrl(blob, async () => "data:image/webp;base64,small");
    expect(result).toEqual({ dataUrl: "data:image/webp;base64,small", downscaled: true });
  });

  it("returns null when no encoding fits the budget", async () => {
    const blob = new Blob([new Uint8Array(400_000)], { type: "image/png" });
    const result = await buildEmbeddableAvatarDataUrl(blob, async () => null);
    expect(result).toBeNull();
  });

  it("strips oversized card avatars during normalization so saves cannot fail", () => {
    const baseCard = {
      id: "card_avatar_test",
      name: "Avatar Test",
      characterName: "Avatar Test",
      kind: "character",
      summary: "",
      systemPrompt: "",
      playerRules: [],
      lorebooks: [],
      memory: [],
      storyEntities: [],
    } as unknown as RuntimeCard;

    const oversized = normalizeRuntimeCards([
      { ...baseCard, avatarDataUrl: `data:image/png;base64,${"A".repeat(MAX_EMBEDDED_AVATAR_DATA_URL_CHARS)}` },
    ]);
    expect(oversized[0].avatarDataUrl).toBeUndefined();

    const small = normalizeRuntimeCards([{ ...baseCard, avatarDataUrl: "data:image/png;base64,AAAA" }]);
    expect(small[0].avatarDataUrl).toBe("data:image/png;base64,AAAA");
  });
});
