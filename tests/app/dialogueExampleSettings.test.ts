import { describe, expect, it } from "vitest";

import { sanitizePersistedRuntimeSettings } from "../../src/app/localRuntimeStore";
import { parseRuntimeSettings } from "../../src/app/providerConfig";

describe("dialogue example settings", () => {
  it("defaults legacy snapshots to all examples for backward compatibility", () => {
    expect(parseRuntimeSettings({}).dialogueExampleMode).toBe("all");
  });

  it("round-trips each supported mode through persistence sanitization", () => {
    for (const dialogueExampleMode of ["all", "selective", "off"] as const) {
      const persisted = sanitizePersistedRuntimeSettings({ dialogueExampleMode });
      expect(persisted).toEqual({ dialogueExampleMode });
      expect(parseRuntimeSettings(persisted).dialogueExampleMode).toBe(dialogueExampleMode);
    }
  });

  it("rejects unknown modes instead of persisting arbitrary prompt behavior", () => {
    expect(sanitizePersistedRuntimeSettings({ dialogueExampleMode: "inject-everything" })).toBeUndefined();
    expect(parseRuntimeSettings({ dialogueExampleMode: "inject-everything" }).dialogueExampleMode).toBe("all");
  });
});
