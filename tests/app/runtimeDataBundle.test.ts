import { describe, expect, it } from "vitest";

import {
  RUNTIME_DIAGNOSTICS_SCHEMA_VERSION,
  RUNTIME_EXPORT_SCHEMA_VERSION,
  buildRuntimeDiagnostics,
  buildVersionedRuntimeExport,
  parseVersionedRuntimeExport,
} from "../../src/app/runtimeDataBundle";

describe("runtime data bundle", () => {
  it("exports a versioned runtime bundle without raw secrets or prompt text by default", () => {
    const bundle = buildVersionedRuntimeExport(createSnapshot(), {
      exportedAt: "2026-07-01T18:00:00.000Z",
    });

    expect(bundle.schema).toBe("rpg.runtime.export");
    expect(bundle.version).toBe(RUNTIME_EXPORT_SCHEMA_VERSION);
    expect(bundle.exportedAt).toBe("2026-07-01T18:00:00.000Z");
    expect(bundle.snapshot.promptRuns[0]?.compiledPrompt).toBe("");
    expect(bundle.snapshot.providerSettings).toMatchObject({
      providerId: "openrouter",
      secretReference: {
        storageKind: "os-keychain",
      },
    });

    const serialized = JSON.stringify(bundle);
    expect(serialized).not.toContain("sk-raw-secret");
    expect(serialized).not.toContain("raw-token-value");
    expect(serialized).not.toContain("full private compiled prompt");
  });

  it("round-trips only supported runtime export versions", () => {
    const bundle = buildVersionedRuntimeExport(createSnapshot(), {
      exportedAt: "2026-07-01T18:00:00.000Z",
    });

    expect(parseVersionedRuntimeExport(JSON.stringify(bundle))).toMatchObject({
      activeCardId: "card_test",
      cards: [expect.objectContaining({ name: "Test Card" })],
    });

    expect(() =>
      parseVersionedRuntimeExport(
        JSON.stringify({
          ...bundle,
          version: RUNTIME_EXPORT_SCHEMA_VERSION + 1,
        }),
      ),
    ).toThrow(/Unsupported runtime export version/i);
    expect(() =>
      parseVersionedRuntimeExport(JSON.stringify({ schema: "not-rpg", version: RUNTIME_EXPORT_SCHEMA_VERSION })),
    ).toThrow(/Runtime export JSON is invalid/i);
  });

  it("builds redacted diagnostics without messages, prompts, or secret references", () => {
    const diagnostics = buildRuntimeDiagnostics({
      snapshot: createSnapshot(),
      exportedAt: "2026-07-01T18:00:00.000Z",
      repositoryStatus: "SQLite repository ready.",
      saveStatus: "Saved to local SQLite repository.",
      providerKeyStatus: "Stored reference: os-keychain / openrouter:apiKey",
      imageProviderStatus: "ComfyUI startup check failed: Authorization Bearer sk-comfy-secret",
      runtimeBackend: "tauri-sqlite",
    });

    expect(diagnostics.schema).toBe("rpg.runtime.diagnostics");
    expect(diagnostics.version).toBe(RUNTIME_DIAGNOSTICS_SCHEMA_VERSION);
    expect(diagnostics.counts).toMatchObject({
      cards: 1,
      chats: 1,
      messages: 2,
      promptRuns: 1,
      generatedMaps: 1,
    });
    expect(diagnostics.provider).toMatchObject({
      mode: "openai-compatible",
      providerId: "openrouter",
      hasStoredSecretReference: true,
    });

    const serialized = JSON.stringify(diagnostics);
    expect(serialized).not.toContain("private room");
    expect(serialized).not.toContain("full private compiled prompt");
    expect(serialized).not.toContain("openrouter:apiKey");
    expect(serialized).not.toContain("sk-comfy-secret");
    expect(serialized).toContain("[redacted]");
  });
});

function createSnapshot() {
  return {
    version: 2 as const,
    theme: "dark" as const,
    activeCardId: "card_test",
    cards: [
      {
        id: "card_test",
        name: "Test Card",
        kind: "rpg",
        summary: "A test card.",
        lorebooks: [
          {
            id: "lore_test",
            name: "Test Lore",
            entries: [{ id: "entry_test", content: "private lore" }],
          },
        ],
      },
    ],
    messages: [
      { id: "user_1", role: "user", content: "I inspect the private room." },
      { id: "assistant_1", role: "assistant", content: "You find a hidden key." },
    ],
    chatSessions: [
      {
        id: "chat_test",
        cardId: "card_test",
        title: "Test chat",
        messages: [
          { id: "user_1", role: "user", content: "I inspect the private room." },
          { id: "assistant_1", role: "assistant", content: "You find a hidden key." },
        ],
      },
    ],
    activeChatIds: {
      card_test: "chat_test",
    },
    promptRuns: [
      {
        id: "run_test",
        cardId: "card_test",
        chatId: "chat_test",
        compiledPrompt: "full private compiled prompt",
        response: "You find a hidden key.",
        provider: "mock",
        model: "mock-narrator",
        tokenEstimate: 42,
        includedLayerIds: ["latest-user-message"],
        includedLoreEntryIds: ["entry_test"],
        warnings: [],
        stateChanges: [],
      },
    ],
    providerKeyStatus: "No plaintext keys stored.",
    providerSettings: {
      mode: "openai-compatible",
      providerId: "openrouter",
      displayName: "OpenRouter",
      baseUrl: "https://openrouter.ai/api/v1",
      model: "qwen3.7-max",
      apiKey: "sk-raw-secret",
      token: "raw-token-value",
      secretReference: {
        providerId: "openrouter",
        secretName: "apiKey",
        storageKind: "os-keychain",
        storageKey: "openrouter:apiKey",
        providerBaseUrl: "https://openrouter.ai/api/v1",
      },
    },
    runtimeSettings: {
      promptDebugLogs: false,
      impersonationPrompt: "private persona",
    },
    generatedMaps: [
      {
        id: "map_test",
        cardId: "card_test",
        status: "generated",
        prompt: "private map prompt",
      },
    ],
    savedAt: "2026-07-01T17:59:00.000Z",
  };
}
