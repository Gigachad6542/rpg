import { describe, expect, it } from "vitest";

import { defaultImageProviderSettings, defaultProviderSettings } from "../../src/app/appDefaults";
import {
  imageProviderCredentialFingerprint,
  textProviderCredentialFingerprint,
} from "../../src/app/providerCredentialBinding";

describe("provider credential fingerprints", () => {
  it("normalizes endpoint syntax without collapsing case-sensitive paths", () => {
    const first = textProviderCredentialFingerprint({
      ...defaultProviderSettings,
      mode: "openai-compatible",
      providerId: "LOCAL",
      baseUrl: "HTTP://LOCALHOST:1234/API/v1/?ignored=true#ignored",
    });
    const equivalent = textProviderCredentialFingerprint({
      ...defaultProviderSettings,
      mode: "openai-compatible",
      providerId: "local",
      baseUrl: "http://localhost:1234/API/v1",
    });
    const differentPath = textProviderCredentialFingerprint({
      ...defaultProviderSettings,
      mode: "openai-compatible",
      providerId: "local",
      baseUrl: "http://localhost:1234/api/v1",
    });

    expect(first).toBe(equivalent);
    expect(differentPath).not.toBe(equivalent);
  });

  it("changes when the image provider mode or endpoint changes", () => {
    const first = imageProviderCredentialFingerprint(defaultImageProviderSettings);
    expect(imageProviderCredentialFingerprint({
      ...defaultImageProviderSettings,
      mode: "prompt-only",
    })).not.toBe(first);
    expect(imageProviderCredentialFingerprint({
      ...defaultImageProviderSettings,
      endpoint: "http://127.0.0.1:8000",
    })).not.toBe(first);
  });
});
