import { describe, expect, it } from "vitest";

import { getConfiguredTextModelInfoForModel } from "../../src/app/providerConfig";
import type { ProviderSettings } from "../../src/app/runtimeTypes";

describe("provider model metadata routing", () => {
  it("does not reuse selected-model context metadata for a different economical model", () => {
    const settings: ProviderSettings = {
      mode: "openai-compatible",
      providerId: "local",
      displayName: "Local",
      baseUrl: "http://127.0.0.1:1234/v1",
      model: "large-visible-model",
      contextWindowTokens: 131_072,
      maxOutputTokens: 8_192,
    };

    expect(getConfiguredTextModelInfoForModel(settings, "large-visible-model")).toMatchObject({
      id: "large-visible-model",
      contextWindow: 131_072,
      maxOutputTokens: 8_192,
    });
    expect(getConfiguredTextModelInfoForModel(settings, "small-economical-model")).toEqual({
      id: "small-economical-model",
      displayName: "small-economical-model",
      providerId: "local",
    });
  });
});
