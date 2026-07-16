import { describe, expect, it } from "vitest";

import {
  countImportedMessages,
  disableLoreEntriesInCard,
  disableLoreEntriesInPersona,
  isAbortError,
  readLegacyImpersonationPrompt,
} from "../../src/app/appControllerHelpers";
import { PLAYABLE_SAMPLE_RPG } from "../../src/app/starterContent";
import type { Persona } from "../../src/app/runtimeTypes";
import type { RuntimeExportSnapshot } from "../../src/app/runtimeDataBundle";

describe("application controller helpers", () => {
  it("reads only the legacy string impersonation prompt", () => {
    expect(readLegacyImpersonationPrompt({ impersonationPrompt: "I am careful." })).toBe("I am careful.");
    expect(readLegacyImpersonationPrompt({ impersonationPrompt: 42 })).toBe("");
    expect(readLegacyImpersonationPrompt(undefined)).toBe("");
  });

  it("recognizes browser and structural abort errors", () => {
    expect(isAbortError(new DOMException("stopped", "AbortError"))).toBe(true);
    expect(isAbortError({ name: "AbortError" })).toBe(true);
    expect(isAbortError(new Error("ordinary"))).toBe(false);
  });

  it("disables only selected card and persona lore entries", () => {
    const card = disableLoreEntriesInCard(
      PLAYABLE_SAMPLE_RPG,
      new Set(["lore_ashfall_bell"]),
    );
    expect(card.lorebooks[0].entries.find((entry) => entry.id === "lore_ashfall_bell")?.enabled).toBe(false);
    expect(card.lorebooks[0].entries.find((entry) => entry.id === "lore_ashfall_storm")?.enabled).toBe(true);

    const persona: Persona = {
      id: "persona_test",
      name: "Test",
      description: "",
      lorebooks: PLAYABLE_SAMPLE_RPG.lorebooks,
    };
    const updatedPersona = disableLoreEntriesInPersona(persona, new Set(["lore_ashfall_storm"]));
    expect(updatedPersona.lorebooks[0].entries.find((entry) => entry.id === "lore_ashfall_storm")?.enabled).toBe(false);
    expect(disableLoreEntriesInPersona(persona, new Set())).toBe(persona);
  });

  it("counts imported chat messages and falls back to legacy top-level messages", () => {
    expect(countImportedMessages({
      messages: [{ id: "legacy-1" }, { id: "legacy-2" }],
    } as unknown as RuntimeExportSnapshot)).toBe(2);
    expect(countImportedMessages({
      messages: [{ id: "ignored-legacy" }],
      chatSessions: [
        { messages: [{ id: "a" }, { id: "b" }] },
        { messages: [{ id: "c" }] },
        { messages: "invalid" },
      ],
    } as unknown as RuntimeExportSnapshot)).toBe(3);
  });
});
