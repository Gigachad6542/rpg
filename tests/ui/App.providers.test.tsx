import { describe, expect, it } from "vitest";

import * as H from "./App.testHarness";

describe("local-first card runtime UI: providers", () => {
  it("surfaces a missing session key before using a real BYOK provider", async () => {
    await H.renderApp();

    H.fireEvent.click(H.screen.getByRole("button", { name: /API Keys/i }));
    H.fireEvent.change(H.screen.getByLabelText(/Runtime mode/i), {
      target: { value: "openai-compatible" },
    });
    H.fireEvent.click(H.screen.getByRole("button", { name: /Activate provider for session/i }));
    expect(H.screen.getByText(/Enter a session API key/i)).toBeInTheDocument();

    H.fireEvent.click(H.screen.getByRole("button", { name: /^Runtime$/i }));
    H.sendRuntimeMessage("I test the provider.");

    await H.waitFor(() =>
      expect(H.screen.getByText(/OpenAI-compatible provider needs a session API key/i)).toBeInTheDocument(),
    );
  });

  it("surfaces provider activation and health-check statuses from API Keys", async () => {
    await H.renderApp();

    H.fireEvent.click(H.screen.getByRole("button", { name: /API Keys/i }));
    const llmProviderSection = H.screen.getByRole("region", { name: /LLM API keys/i });

    H.fireEvent.click(H.within(llmProviderSection).getByRole("button", { name: /Activate provider for session/i }));
    expect(H.within(llmProviderSection).getByText(/Mock provider active; no API key needed/i)).toBeInTheDocument();

    H.fireEvent.change(H.screen.getByLabelText(/Runtime mode/i), {
      target: { value: "openai-compatible" },
    });
    H.fireEvent.change(H.within(llmProviderSection).getByLabelText(/^Provider$/i), {
      target: { value: "local" },
    });
    H.fireEvent.click(H.within(llmProviderSection).getByRole("button", { name: /Activate provider for session/i }));
    expect(H.within(llmProviderSection).getByText(/Local OpenAI-compatible endpoint active without a stored API key/i)).toBeInTheDocument();

    H.fireEvent.change(H.within(llmProviderSection).getByLabelText(/^Provider$/i), {
      target: { value: "openrouter" },
    });
    H.fireEvent.change(H.within(llmProviderSection).getByLabelText(/^Base URL$/i), {
      target: { value: "https://example.test/v1" },
    });
    H.fireEvent.click(H.within(llmProviderSection).getByRole("button", { name: /Test text provider/i }));
    await H.waitFor(() =>
      expect(H.within(llmProviderSection).getByText(/known hosted URL or a loopback local endpoint/i)).toBeInTheDocument(),
    );

    H.fireEvent.change(H.within(llmProviderSection).getByLabelText(/^Base URL$/i), {
      target: { value: "https://openrouter.ai/api/v1" },
    });
    H.fireEvent.change(H.within(llmProviderSection).getByLabelText(/Session API key/i), {
      target: { value: "browser-session-key" },
    });
    H.fireEvent.click(H.within(llmProviderSection).getByRole("button", { name: /Activate provider for session/i }));
    await H.waitFor(() =>
      expect(H.within(llmProviderSection).getByText(/Session key active in memory only/i)).toBeInTheDocument(),
    );

    H.fireEvent.change(H.screen.getByLabelText(/Runtime mode/i), {
      target: { value: "mock" },
    });
    expect(H.within(llmProviderSection).getByLabelText(/^Provider$/i)).toHaveValue("mock");
  });

  it("keeps partial pricing as a draft and treats either blank rate as unknown", async () => {
    await H.renderApp();

    H.fireEvent.click(H.screen.getByRole("button", { name: /API Keys/i }));
    const llmProviderSection = H.screen.getByRole("region", { name: /LLM API keys/i });
    const inputRate = H.within(llmProviderSection).getByLabelText(/Input USD per million tokens/i);
    const outputRate = H.within(llmProviderSection).getByLabelText(/Output USD per million tokens/i);

    H.fireEvent.change(inputRate, { target: { value: "0.2" } });
    expect(inputRate).toHaveValue(0.2);
    expect(outputRate).toHaveValue(null);
    expect(H.within(llmProviderSection).queryByRole("button", { name: /Clear pricing snapshot/i })).not.toBeInTheDocument();

    H.fireEvent.change(outputRate, { target: { value: "0.8" } });
    expect(inputRate).toHaveValue(0.2);
    expect(outputRate).toHaveValue(0.8);
    expect(H.within(llmProviderSection).getByRole("button", { name: /Clear pricing snapshot/i })).toBeInTheDocument();

    H.fireEvent.change(inputRate, { target: { value: "" } });
    expect(inputRate).toHaveValue(null);
    expect(outputRate).toHaveValue(0.8);
    expect(H.within(llmProviderSection).queryByRole("button", { name: /Clear pricing snapshot/i })).not.toBeInTheDocument();

    H.fireEvent.change(inputRate, { target: { value: "0.2" } });
    expect(H.within(llmProviderSection).getByRole("button", { name: /Clear pricing snapshot/i })).toBeInTheDocument();
    H.fireEvent.change(outputRate, { target: { value: "" } });
    expect(outputRate).toHaveValue(null);
    expect(H.within(llmProviderSection).queryByRole("button", { name: /Clear pricing snapshot/i })).not.toBeInTheDocument();
  });

  it("warns when a hosted desktop provider has a session key but no secure storage", async () => {
    const restoreTauri = H.setTauriRuntimeForTest();
    try {
      await H.renderApp();

      H.fireEvent.click(H.screen.getByRole("button", { name: /API Keys/i }));
      const llmProviderSection = H.screen.getByRole("region", { name: /LLM API keys/i });
      H.fireEvent.change(H.screen.getByLabelText(/Runtime mode/i), {
        target: { value: "openai-compatible" },
      });
      H.fireEvent.change(H.within(llmProviderSection).getByLabelText(/^Provider$/i), {
        target: { value: "openrouter" },
      });
      H.fireEvent.change(H.within(llmProviderSection).getByLabelText(/Session API key/i), {
        target: { value: "desktop-session-key" },
      });
      H.fireEvent.click(H.within(llmProviderSection).getByRole("button", { name: /Activate provider for session/i }));

      await H.waitFor(() =>
        expect(H.within(llmProviderSection).getByText(/Secure storage unavailable/i)).toBeInTheDocument(),
      );
    } finally {
      restoreTauri();
    }
  });

  it("stores hosted provider keys through the desktop keychain reference path", async () => {
    const restoreTauri = H.setTauriRuntimeForTest();
    H.getTauriInvokeMock().mockImplementation(async (command: string, args?: Record<string, unknown>) => {
      if (command === "secure_storage_status") {
        return { available: true, storageKind: "os-keychain" };
      }
      if (command === "store_provider_secret") {
        return {
          providerId: String(args?.providerId ?? ""),
          secretName: String(args?.secretName ?? ""),
          storageKind: "os-keychain",
          storageKey: `${String(args?.providerId ?? "")}:${String(args?.secretName ?? "")}`,
        };
      }
      if (command === "delete_provider_secret") {
        throw new Error("delete denied");
      }
      throw new Error(`Unexpected Tauri command: ${command}`);
    });

    try {
      await H.renderApp();

      H.fireEvent.click(H.screen.getByRole("button", { name: /API Keys/i }));
      const llmProviderSection = H.screen.getByRole("region", { name: /LLM API keys/i });
      await H.waitFor(() =>
        expect(H.within(llmProviderSection).getByText(/OS keychain available/i)).toBeInTheDocument(),
      );
      expect(H.within(llmProviderSection).getByLabelText(/Session API key/i)).toHaveAttribute(
        "placeholder",
        "Stored in OS keychain when activated",
      );

      H.fireEvent.change(H.screen.getByLabelText(/Runtime mode/i), {
        target: { value: "openai-compatible" },
      });
      H.fireEvent.change(H.within(llmProviderSection).getByLabelText(/^Provider$/i), {
        target: { value: "openrouter" },
      });
      H.fireEvent.change(H.within(llmProviderSection).getByLabelText(/Session API key/i), {
        target: { value: "desktop-keychain-secret" },
      });
      H.fireEvent.click(H.within(llmProviderSection).getByRole("button", { name: /Store key securely/i }));

      await H.waitFor(() =>
        expect(H.within(llmProviderSection).getByText(/API key stored in OS keychain/i)).toBeInTheDocument(),
      );
      expect(H.within(llmProviderSection).getByText(/Stored reference/i)).toHaveTextContent("openrouter:apiKey");
      expect(H.within(llmProviderSection).getByLabelText(/Session API key/i)).toHaveValue("");

      H.fireEvent.click(H.within(llmProviderSection).getByRole("button", { name: /Forget stored key/i }));
      await H.waitFor(() => expect(H.within(llmProviderSection).getByText(/delete denied/i)).toBeInTheDocument());
    } finally {
      H.resetTauriInvokeMock();
      restoreTauri();
    }
  });

  it("surfaces secure key storage failures and rejects invalid hosted endpoints", async () => {
    const restoreTauri = H.setTauriRuntimeForTest();
    H.getTauriInvokeMock().mockImplementation(async (command: string) => {
      if (command === "secure_storage_status") {
        return { available: true, storageKind: "os-keychain" };
      }
      if (command === "store_provider_secret") {
        throw new Error("store denied");
      }
      throw new Error(`Unexpected Tauri command: ${command}`);
    });

    try {
      await H.renderApp();

      H.fireEvent.click(H.screen.getByRole("button", { name: /API Keys/i }));
      const llmProviderSection = H.screen.getByRole("region", { name: /LLM API keys/i });
      await H.waitFor(() =>
        expect(H.within(llmProviderSection).getByText(/OS keychain available/i)).toBeInTheDocument(),
      );

      H.fireEvent.change(H.screen.getByLabelText(/Runtime mode/i), {
        target: { value: "openai-compatible" },
      });
      H.fireEvent.change(H.within(llmProviderSection).getByLabelText(/^Provider$/i), {
        target: { value: "openrouter" },
      });
      H.fireEvent.change(H.within(llmProviderSection).getByLabelText(/Session API key/i), {
        target: { value: "desktop-keychain-secret" },
      });
      H.fireEvent.click(H.within(llmProviderSection).getByRole("button", { name: /Store key securely/i }));
      await H.waitFor(() => expect(H.within(llmProviderSection).getByText(/store denied/i)).toBeInTheDocument());

      H.fireEvent.change(H.within(llmProviderSection).getByLabelText(/^Base URL$/i), {
        target: { value: "https://example.test/v1" },
      });
      H.fireEvent.click(H.within(llmProviderSection).getByRole("button", { name: /Store key securely/i }));
      await H.waitFor(() =>
        expect(H.within(llmProviderSection).getByText(/known hosted URL or a loopback local endpoint/i)).toBeInTheDocument(),
      );
    } finally {
      H.resetTauriInvokeMock();
      restoreTauri();
    }
  });

  it("requires OS keychain storage for hosted providers in the desktop runtime", async () => {
    const restoreTauri = H.setTauriRuntimeForTest();
    try {
      await H.renderApp();

      H.fireEvent.click(H.screen.getByRole("button", { name: /API Keys/i }));
      H.fireEvent.change(H.screen.getByLabelText(/Runtime mode/i), {
        target: { value: "openai-compatible" },
      });
      const llmProviderSection = H.screen.getByRole("region", { name: /LLM API keys/i });
      H.fireEvent.change(H.within(llmProviderSection).getByLabelText(/^Provider$/i), {
        target: { value: "openrouter" },
      });
      H.fireEvent.click(H.screen.getByRole("button", { name: /Activate provider for session/i }));
      expect(H.screen.getByText(/Store this hosted provider key in the OS keychain/i)).toBeInTheDocument();

      H.fireEvent.click(H.screen.getByRole("button", { name: /^Runtime$/i }));
      H.sendRuntimeMessage("I test the provider.");

      await H.waitFor(() =>
        expect(H.screen.getByText(/Store this hosted provider key in the OS keychain/i)).toBeInTheDocument(),
      );
    } finally {
      restoreTauri();
    }
  });

  it("uses dropdown model selectors for OpenRouter text models and ComfyUI image models", async () => {
    await H.renderApp();

    H.fireEvent.click(H.screen.getByRole("button", { name: /API Keys/i }));
    H.fireEvent.change(H.screen.getByLabelText(/Runtime mode/i), {
      target: { value: "openai-compatible" },
    });
    const llmProviderSection = H.screen.getByRole("region", { name: /LLM API keys/i });
    H.fireEvent.change(H.within(llmProviderSection).getByLabelText(/^Provider$/i), {
      target: { value: "openrouter" },
    });
    const openRouterModelSelect = H.within(llmProviderSection).getByLabelText(/^Model$/i) as HTMLSelectElement;
    expect(openRouterModelSelect.tagName).toBe("SELECT");
    expect(H.within(openRouterModelSelect).getByRole("option", { name: /Qwen3/i })).toBeInTheDocument();
    H.fireEvent.change(openRouterModelSelect, { target: { value: "anthropic/claude-3.5-sonnet" } });
    expect(openRouterModelSelect).toHaveValue("anthropic/claude-3.5-sonnet");

    const imageProviderSection = H.screen.getByRole("region", { name: /Image provider/i });
    const comfyModelSelect = H.within(imageProviderSection).getByLabelText(/Default model/i) as HTMLSelectElement;
    expect(comfyModelSelect.tagName).toBe("SELECT");
    expect(H.within(comfyModelSelect).getByRole("option", { name: /FLUX\.2 dev FP8 mixed/i })).toBeInTheDocument();
  });

  it("checks ComfyUI image models on startup and selects an installed model when saved settings are stale", async () => {
    const installedModel = "flux2_dev_fp8mixed.safetensors";
    const fetchImpl = H.vi.fn(async () =>
      new Response(
        JSON.stringify({
          UNETLoader: {
            input: {
              required: {
                unet_name: [[installedModel], {}],
              },
            },
          },
        }),
        { status: 200 },
      ),
    );
    H.vi.stubGlobal("fetch", fetchImpl);
    window.localStorage.setItem(
      H.RUNTIME_STORAGE_KEY,
      JSON.stringify({
        version: 2,
        theme: "dark",
        activeCardId: "card_blank_slate_rpg",
        cards: [
          {
            id: "card_blank_slate_rpg",
            name: "Blank Slate RPG",
            kind: "rpg",
            summary: "test",
            systemPrompt: "test",
            preHistoryInstructions: "",
            postHistoryInstructions: "",
            playerRules: [],
            lorebooks: [],
            memory: [],
            mapEnabled: true,
            storyEntities: [
              {
                id: "story_entity_player",
                name: "Ari",
                kind: "player",
                summary: "A careful cartographer.",
                knownFacts: [],
                doesNotKnow: [],
              },
              {
                id: "story_entity_rook",
                name: "Rook",
                kind: "character",
                summary: "A harbor scout.",
                knownFacts: ["Rook knows the old pier."],
                doesNotKnow: [],
              },
            ],
            rpg: {
              location: "start",
              health: "not configured",
              inventory: [],
              quests: [],
              flags: {},
              knownPlaces: [],
              mapStyle: "map",
            },
          },
        ],
        messages: [],
        chatSessions: [
          {
            id: "chat-low-quality-settings",
            cardId: "card_blank_slate_rpg",
            title: "Low quality settings",
            createdAt: "2026-06-30T00:00:00.000Z",
            updatedAt: "2026-06-30T00:00:00.000Z",
            messages: [],
          },
        ],
        activeChatIds: {
          card_blank_slate_rpg: "chat-low-quality-settings",
        },
        promptRuns: [],
        providerKeyStatus: "No plaintext keys stored.",
        imageProviderSettings: {
          mode: "comfyui",
          endpoint: "http://127.0.0.1:8188",
          model: "missing-image-model.safetensors",
        },
        savedAt: "2026-06-29T00:00:00.000Z",
      }),
    );

    try {
      await H.renderApp();

      H.fireEvent.click(H.screen.getByRole("button", { name: /API Keys/i }));
      const imageProviderSection = H.screen.getByRole("region", { name: /Image provider/i });
      await H.waitFor(() =>
        expect(H.within(imageProviderSection).getByText(/image model visible.*Selected/i)).toBeInTheDocument(),
      );
      expect(H.within(imageProviderSection).getByLabelText(/Default model/i)).toHaveValue(installedModel);
    } finally {
      H.vi.unstubAllGlobals();
    }
  });

  it("ignores late ComfyUI startup results after the app unmounts", async () => {
    let resolveStartup!: (response: Response) => void;
    let rejectStartup!: (error: Error) => void;
    const fetchImpl = H.vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            resolveStartup = resolve;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise<Response>((_, reject) => {
            rejectStartup = reject;
          }),
      );
    H.vi.stubGlobal("fetch", fetchImpl);
    H.seedRuntimeSnapshot({
      imageProviderSettings: {
        mode: "comfyui",
        endpoint: "http://127.0.0.1:8188",
        model: "missing-image-model.safetensors",
      },
    });

    try {
      const firstRender = await H.renderApp();
      firstRender.unmount();
      resolveStartup(
        new Response(
          JSON.stringify({
            UNETLoader: {
              input: {
                required: {
                  unet_name: [["visible-image-model.safetensors"], {}],
                },
              },
            },
          }),
          { status: 200 },
        ),
      );
      await new Promise((resolve) => setTimeout(resolve, 0));

      const secondRender = await H.renderApp();
      secondRender.unmount();
      rejectStartup(new Error("late startup failure"));
      await new Promise((resolve) => setTimeout(resolve, 0));
    } finally {
      H.vi.unstubAllGlobals();
    }
  });

  it("refreshes ComfyUI image models manually and adopts the installed model", async () => {
    const installedModel = "manual-visible-model.safetensors";
    const fetchImpl = H.vi.fn(async () =>
      new Response(
        JSON.stringify({
          UNETLoader: {
            input: {
              required: {
                unet_name: [[installedModel], {}],
              },
            },
          },
        }),
        { status: 200 },
      ),
    );
    H.vi.stubGlobal("fetch", fetchImpl);

    try {
      await H.renderApp();

      H.fireEvent.click(H.screen.getByRole("button", { name: /API Keys/i }));
      const imageProviderSection = H.screen.getByRole("region", { name: /Image provider/i });
      H.fireEvent.change(H.within(imageProviderSection).getByLabelText(/^Provider$/i), {
        target: { value: "comfyui" },
      });
      const modelSelect = H.within(imageProviderSection).getByLabelText(/Default model/i);
      await H.waitFor(() => expect(modelSelect).toHaveValue(installedModel));
      H.fireEvent.change(modelSelect, {
        target: { value: "sd_xl_base_1.0.safetensors" },
      });
      H.fireEvent.click(H.within(imageProviderSection).getByRole("button", { name: /Refresh installed image models/i }));

      await H.waitFor(() =>
        expect(H.within(imageProviderSection).getByText(/Image model refresh ready: selected installed image model/i)).toBeInTheDocument(),
      );
      expect(modelSelect).toHaveValue(installedModel);
    } finally {
      H.vi.unstubAllGlobals();
    }
  });

  it("reports empty, failed, and current ComfyUI image model refresh states", async () => {
    const currentModel = "flux2_dev_fp8mixed.safetensors";
    let responseMode: "empty" | "error" | "ready" = "empty";
    const fetchImpl = H.vi.fn(async () => {
      if (responseMode === "error") {
        throw new Error("ComfyUI offline");
      }

      return new Response(
        JSON.stringify({
          UNETLoader: {
            input: {
              required: {
                unet_name: [[...(responseMode === "ready" ? [currentModel] : [])], {}],
              },
            },
          },
        }),
        { status: 200 },
      );
    });
    H.vi.stubGlobal("fetch", fetchImpl);

    try {
      await H.renderApp();

      H.fireEvent.click(H.screen.getByRole("button", { name: /API Keys/i }));
      const imageProviderSection = H.screen.getByRole("region", { name: /Image provider/i });
      H.fireEvent.change(H.within(imageProviderSection).getByLabelText(/^Provider$/i), {
        target: { value: "comfyui" },
      });
      await H.waitFor(() =>
        expect(H.within(imageProviderSection).getByText(/no image diffusion models are visible/i)).toBeInTheDocument(),
      );
      H.fireEvent.click(H.within(imageProviderSection).getByRole("button", { name: /Refresh installed image models/i }));
      await H.waitFor(() =>
        expect(H.within(imageProviderSection).getByText(/no image diffusion models are visible/i)).toBeInTheDocument(),
      );

      responseMode = "error";
      H.fireEvent.click(H.within(imageProviderSection).getByRole("button", { name: /Refresh installed image models/i }));
      await H.waitFor(() =>
        expect(H.within(imageProviderSection).getByText(/Original error: ComfyUI offline/i)).toBeInTheDocument(),
      );

      responseMode = "ready";
      H.fireEvent.click(H.within(imageProviderSection).getByRole("button", { name: /Refresh installed image models/i }));
      await H.waitFor(() =>
        expect(H.within(imageProviderSection).getByText(/Image model refresh ready: 1 image model visible/i)).toBeInTheDocument(),
      );
      expect(H.within(imageProviderSection).getByLabelText(/Default model/i)).toHaveValue(currentModel);
    } finally {
      H.vi.unstubAllGlobals();
    }
  });

  it("lifts stale low-resolution ComfyUI settings back to local-image-safe defaults", async () => {
    const installedModel = "flux2_dev_fp8mixed.safetensors";
    const fetchImpl = H.vi.fn(async () =>
      new Response(
        JSON.stringify({
          UNETLoader: {
            input: {
              required: {
                unet_name: [[installedModel], {}],
              },
            },
          },
        }),
        { status: 200 },
      ),
    );
    H.vi.stubGlobal("fetch", fetchImpl);
    window.localStorage.setItem(
      H.RUNTIME_STORAGE_KEY,
      JSON.stringify({
        version: 2,
        theme: "dark",
        activeCardId: "card_blank_slate_rpg",
        cards: [
          {
            id: "card_blank_slate_rpg",
            name: "Blank Slate RPG",
            kind: "rpg",
            summary: "test",
            systemPrompt: "test",
            preHistoryInstructions: "",
            postHistoryInstructions: "",
            playerRules: [],
            lorebooks: [],
            memory: [],
            mapEnabled: true,
            storyEntities: [
              {
                id: "story_entity_player",
                name: "Ari",
                kind: "player",
                summary: "A careful cartographer.",
                knownFacts: [],
                doesNotKnow: [],
              },
              {
                id: "story_entity_rook",
                name: "Rook",
                kind: "character",
                summary: "A harbor scout.",
                knownFacts: ["Rook knows the old pier."],
                doesNotKnow: [],
              },
            ],
            rpg: {
              location: "start",
              health: "not configured",
              inventory: [],
              quests: [],
              flags: {},
              knownPlaces: [],
              mapStyle: "map",
            },
          },
        ],
        messages: [],
        chatSessions: [
          {
            id: "chat-low-quality-settings",
            cardId: "card_blank_slate_rpg",
            title: "Low quality settings",
            createdAt: "2026-06-30T00:00:00.000Z",
            updatedAt: "2026-06-30T00:00:00.000Z",
            messages: [],
          },
        ],
        activeChatIds: {
          card_blank_slate_rpg: "chat-low-quality-settings",
        },
        promptRuns: [],
        providerKeyStatus: "No plaintext keys stored.",
        imageProviderSettings: {
          mode: "comfyui",
          endpoint: "http://127.0.0.1:8188",
          model: installedModel,
          width: 256,
          height: 256,
          steps: 20,
          cfg: 7,
          samplerName: "euler",
          scheduler: "normal",
        },
        savedAt: "2026-06-30T00:00:00.000Z",
      }),
    );

    try {
      await H.renderApp();

      H.fireEvent.click(H.screen.getByRole("button", { name: /API Keys/i }));
      const imageProviderSection = H.screen.getByRole("region", { name: /Image provider/i });
      const widthInput = H.within(imageProviderSection).getByLabelText(/^Width$/i);
      const heightInput = H.within(imageProviderSection).getByLabelText(/^Height$/i);
      expect(widthInput).toHaveValue(1024);
      expect(heightInput).toHaveValue(1024);
      expect(H.within(imageProviderSection).getByLabelText(/^Steps$/i)).toHaveValue(28);
      expect(H.within(imageProviderSection).getByLabelText(/^CFG$/i)).toHaveValue(3.5);
      expect(H.within(imageProviderSection).getByLabelText(/^Sampler$/i)).toHaveValue("euler");
      expect(H.within(imageProviderSection).getByLabelText(/^Scheduler$/i)).toHaveValue("simple");

      H.fireEvent.change(widthInput, { target: { value: "256" } });
      H.fireEvent.change(heightInput, { target: { value: "256" } });
      expect(widthInput).toHaveValue(1024);
      expect(heightInput).toHaveValue(1024);
    } finally {
      H.vi.unstubAllGlobals();
    }
  });

  it("lifts stale one-step ComfyUI settings back to local-image-safe defaults", async () => {
    const installedModel = "flux2_dev_fp8mixed.safetensors";
    const fetchImpl = H.vi.fn(async () =>
      new Response(
        JSON.stringify({
          UNETLoader: {
            input: {
              required: {
                unet_name: [[installedModel], {}],
              },
            },
          },
        }),
        { status: 200 },
      ),
    );
    H.vi.stubGlobal("fetch", fetchImpl);
    window.localStorage.setItem(
      H.RUNTIME_STORAGE_KEY,
      JSON.stringify({
        version: 2,
        theme: "dark",
        activeCardId: "card_blank_slate_rpg",
        cards: [
          {
            id: "card_blank_slate_rpg",
            name: "Blank Slate RPG",
            kind: "rpg",
            summary: "test",
            systemPrompt: "test",
            preHistoryInstructions: "",
            postHistoryInstructions: "",
            playerRules: [],
            lorebooks: [],
            memory: [],
            mapEnabled: true,
            storyEntities: [
              {
                id: "story_entity_player",
                name: "Ari",
                kind: "player",
                summary: "A careful cartographer.",
                knownFacts: [],
                doesNotKnow: [],
              },
              {
                id: "story_entity_rook",
                name: "Rook",
                kind: "character",
                summary: "A harbor scout.",
                knownFacts: ["Rook knows the old pier."],
                doesNotKnow: [],
              },
            ],
            rpg: {
              location: "start",
              health: "not configured",
              inventory: [],
              quests: [],
              flags: {},
              knownPlaces: [],
              mapStyle: "map",
            },
          },
        ],
        messages: [],
        chatSessions: [
          {
            id: "chat-one-step-settings",
            cardId: "card_blank_slate_rpg",
            title: "One-step settings",
            createdAt: "2026-06-30T00:00:00.000Z",
            updatedAt: "2026-06-30T00:00:00.000Z",
            messages: [],
          },
        ],
        activeChatIds: {
          card_blank_slate_rpg: "chat-one-step-settings",
        },
        promptRuns: [],
        providerKeyStatus: "No plaintext keys stored.",
        imageProviderSettings: {
          mode: "comfyui",
          endpoint: "http://127.0.0.1:8188",
          model: installedModel,
          width: 1024,
          height: 1024,
          steps: 1,
          cfg: 1,
          samplerName: "euler",
          scheduler: "normal",
        },
        savedAt: "2026-06-30T00:00:00.000Z",
      }),
    );

    try {
      await H.renderApp();

      H.fireEvent.click(H.screen.getByRole("button", { name: /API Keys/i }));
      const imageProviderSection = H.screen.getByRole("region", { name: /Image provider/i });
      expect(H.within(imageProviderSection).getByLabelText(/^Width$/i)).toHaveValue(1024);
      expect(H.within(imageProviderSection).getByLabelText(/^Height$/i)).toHaveValue(1024);
      expect(H.within(imageProviderSection).getByLabelText(/^Steps$/i)).toHaveValue(28);
      expect(H.within(imageProviderSection).getByLabelText(/^CFG$/i)).toHaveValue(3.5);
      expect(H.within(imageProviderSection).getByLabelText(/^Sampler$/i)).toHaveValue("euler");
      expect(H.within(imageProviderSection).getByLabelText(/^Scheduler$/i)).toHaveValue("simple");
    } finally {
      H.vi.unstubAllGlobals();
    }
  });

  it("does not persist typed provider API keys in browser storage", async () => {
    await H.renderApp();

    H.fireEvent.click(H.screen.getByRole("button", { name: /API Keys/i }));
    H.fireEvent.change(H.screen.getByLabelText(/Runtime mode/i), {
      target: { value: "openai-compatible" },
    });
    H.fireEvent.change(H.screen.getByLabelText(/Session API key/i), {
      target: { value: "sk-browser-session-secret" },
    });
    H.fireEvent.click(H.screen.getByRole("button", { name: /Activate provider for session/i }));

    await H.waitFor(() => expect(H.screen.getByText(/Session key active in memory only/i)).toBeInTheDocument());
    expect(window.localStorage.getItem(H.RUNTIME_STORAGE_KEY)).not.toContain("sk-browser-session-secret");
  });

  it("keeps the ComfyUI API key session-only", async () => {
    await H.renderApp();

    H.fireEvent.click(H.screen.getByRole("button", { name: /API Keys/i }));
    const imageProviderSection = H.screen.getByRole("region", { name: /Image provider/i });
    H.fireEvent.change(H.within(imageProviderSection).getByLabelText(/ComfyUI API key/i), {
      target: { value: "comfy-secret-session-key" },
    });

    expect(H.within(imageProviderSection).getByLabelText(/ComfyUI API key/i)).toHaveValue("comfy-secret-session-key");
    await H.waitFor(() => expect(window.localStorage.getItem(H.RUNTIME_STORAGE_KEY)).not.toContain("comfy-secret-session-key"));
  });

  it("edits provider keys and image provider generation settings from the API keys panel", async () => {
    window.localStorage.clear();
    window.localStorage.setItem(
      H.RUNTIME_STORAGE_KEY,
      JSON.stringify({
        version: 2,
        theme: "dark",
        activeCardId: "card_blank_slate_rpg",
        cards: [
          {
            id: "card_blank_slate_rpg",
            name: "Blank Slate RPG",
            kind: "rpg",
            summary: "test",
            systemPrompt: "test",
            preHistoryInstructions: "",
            postHistoryInstructions: "",
            playerRules: [],
            lorebooks: [],
            memory: [],
            mapEnabled: true,
            rpg: {
              location: "start",
              health: "not configured",
              inventory: [],
              quests: [],
              flags: {},
              knownPlaces: [],
              mapStyle: "map",
            },
          },
        ],
        messages: [],
        chatSessions: [
          {
            id: "chat-provider-settings",
            cardId: "card_blank_slate_rpg",
            title: "Provider settings",
            createdAt: "2026-07-01T00:00:00.000Z",
            updatedAt: "2026-07-01T00:00:00.000Z",
            messages: [],
          },
        ],
        activeChatIds: {
          card_blank_slate_rpg: "chat-provider-settings",
        },
        promptRuns: [],
        providerKeyStatus: "stored",
        providerSettings: {
          mode: "openai-compatible",
          providerId: "openrouter",
          displayName: "OpenRouter BYOK",
          baseUrl: "https://openrouter.ai/api/v1",
          model: "qwen3.7-max",
          secretReference: {
            providerId: "openrouter",
            secretName: "apiKey",
            storageKind: "os-keychain",
            storageKey: "openrouter:apiKey",
            providerBaseUrl: "https://openrouter.ai/api/v1",
          },
        },
        imageProviderSettings: {
          mode: "comfyui",
          providerId: "comfyui",
          displayName: "ComfyUI local API",
          endpoint: "http://127.0.0.1:8188",
          model: "flux2_dev_fp8mixed.safetensors",
          width: 1024,
          height: 1024,
          seed: -1,
          steps: 28,
          cfg: 3.5,
          samplerName: "euler",
          scheduler: "simple",
          pollTimeoutMs: 120000,
          workflowJson: "{}",
        },
        savedAt: "2026-07-01T00:00:00.000Z",
      }),
    );

    await H.renderApp();
    H.fireEvent.click(H.screen.getByRole("button", { name: /API Keys/i }));

    const llmProviderSection = H.screen.getByRole("region", { name: /LLM API keys/i });
    expect(H.within(llmProviderSection).getByText(/Stored reference/i)).toHaveTextContent("openrouter:apiKey");
    H.fireEvent.click(H.within(llmProviderSection).getByRole("button", { name: /Activate provider for session/i }));
    expect(H.within(llmProviderSection).getByText(/Stored OS keychain reference active/i)).toBeInTheDocument();
    H.fireEvent.click(H.within(llmProviderSection).getByRole("button", { name: /Forget stored key/i }));
    await H.waitFor(() => expect(H.within(llmProviderSection).getByText(/Stored provider key reference removed/i)).toBeInTheDocument());

    H.fireEvent.change(H.screen.getByLabelText(/Runtime mode/i), {
      target: { value: "openai-compatible" },
    });
    H.fireEvent.change(H.within(llmProviderSection).getByLabelText(/^Provider$/i), {
      target: { value: "local" },
    });
    H.fireEvent.change(H.within(llmProviderSection).getByLabelText(/^Base URL$/i), {
      target: { value: "http://127.0.0.1:4321/v1" },
    });
    H.fireEvent.change(H.within(llmProviderSection).getByLabelText(/^Model$/i), {
      target: { value: "local-qwen-test" },
    });
    H.fireEvent.change(H.within(llmProviderSection).getByLabelText(/Session API key/i), {
      target: { value: "local-session-key" },
    });
    H.fireEvent.click(H.within(llmProviderSection).getByRole("button", { name: /Activate provider for session/i }));
    expect(H.within(llmProviderSection).getByText(/Local OpenAI-compatible endpoint active with a memory-only session key/i)).toBeInTheDocument();

    const imageProviderSection = H.screen.getByRole("region", { name: /Image provider/i });
    H.fireEvent.change(H.within(imageProviderSection).getByLabelText(/^Provider$/i), {
      target: { value: "prompt-only" },
    });
    H.fireEvent.click(H.within(imageProviderSection).getByRole("button", { name: /Refresh installed image models/i }));
    expect(H.within(imageProviderSection).getByText(/Prompt-only image mode active/i)).toBeInTheDocument();

    H.fireEvent.change(H.within(imageProviderSection).getByLabelText(/Local endpoint/i), {
      target: { value: "http://127.0.0.1:8288" },
    });
    H.fireEvent.change(H.within(imageProviderSection).getByLabelText(/Default model/i), {
      target: { value: "sd_xl_base_1.0.safetensors" },
    });
    H.fireEvent.change(H.within(imageProviderSection).getByLabelText(/^Width$/i), { target: { value: "1536" } });
    H.fireEvent.change(H.within(imageProviderSection).getByLabelText(/^Height$/i), { target: { value: "1408" } });
    H.fireEvent.change(H.within(imageProviderSection).getByLabelText(/^Timeout ms$/i), { target: { value: "180000" } });
    const seedInput = H.within(imageProviderSection).getAllByLabelText(/Seed/i)[0];
    H.fireEvent.change(seedInput, { target: { value: "12345" } });
    H.fireEvent.change(H.within(imageProviderSection).getByLabelText(/^Steps$/i), { target: { value: "36" } });
    H.fireEvent.change(H.within(imageProviderSection).getByLabelText(/^CFG$/i), { target: { value: "4.5" } });
    H.fireEvent.change(H.within(imageProviderSection).getByLabelText(/^Sampler$/i), { target: { value: "dpmpp_2m" } });
    H.fireEvent.change(H.within(imageProviderSection).getByLabelText(/^Scheduler$/i), { target: { value: "karras" } });
    H.fireEvent.change(H.within(imageProviderSection).getByLabelText(/ComfyUI API workflow JSON/i), {
      target: { value: '{"1":{"class_type":"SaveImage"}}' },
    });

    expect(H.within(imageProviderSection).getByLabelText(/Local endpoint/i)).toHaveValue("http://127.0.0.1:8288");
    expect(H.within(imageProviderSection).getByLabelText(/Default model/i)).toHaveValue("sd_xl_base_1.0.safetensors");
    expect(H.within(imageProviderSection).getByLabelText(/^Width$/i)).toHaveValue(1536);
    expect(H.within(imageProviderSection).getByLabelText(/^Height$/i)).toHaveValue(1408);
    expect(H.within(imageProviderSection).getByLabelText(/^Timeout ms$/i)).toHaveValue(180000);
    expect(seedInput).toHaveValue(12345);
    expect(H.within(imageProviderSection).getByLabelText(/^Steps$/i)).toHaveValue(36);
    expect(H.within(imageProviderSection).getByLabelText(/^CFG$/i)).toHaveValue(4.5);
    expect(H.within(imageProviderSection).getByLabelText(/^Sampler$/i)).toHaveValue("dpmpp_2m");
    expect(H.within(imageProviderSection).getByLabelText(/^Scheduler$/i)).toHaveValue("karras");
    expect(H.within(imageProviderSection).getByLabelText(/ComfyUI API workflow JSON/i)).toHaveValue('{"1":{"class_type":"SaveImage"}}');
  });

  it("runs a local provider health check without needing a real key in mock mode", async () => {
    await H.renderApp();

    H.fireEvent.click(H.screen.getByRole("button", { name: /API Keys/i }));
    H.fireEvent.click(H.screen.getByRole("button", { name: /Test text provider/i }));

    await H.waitFor(() => expect(H.screen.getByText(/Provider responded through mock/i)).toBeInTheDocument());
  });

  it("strips injected raw provider secrets from persisted settings", async () => {
    window.localStorage.setItem(
      H.RUNTIME_STORAGE_KEY,
      JSON.stringify({
        version: 2,
        theme: "dark",
        activeCardId: "card_blank_slate_rpg",
        cards: [
          {
            id: "card_blank_slate_rpg",
            name: "Blank Slate RPG",
            kind: "rpg",
            summary: "test",
            systemPrompt: "test",
            preHistoryInstructions: "",
            postHistoryInstructions: "",
            playerRules: [],
            lorebooks: [],
            memory: [],
            rpg: {
              location: "start",
              health: "not configured",
              inventory: [],
              quests: [],
              flags: {},
              knownPlaces: [],
              mapStyle: "map",
            },
          },
        ],
        messages: [],
        promptRuns: [],
        providerKeyStatus: "old",
        providerSettings: {
          mode: "openai-compatible",
          providerId: "openrouter",
          displayName: "OpenRouter BYOK",
          baseUrl: "https://openrouter.ai/api/v1",
          model: "qwen3.7-max",
          apiKey: "sk-injected-secret",
          token: "raw-token-value",
          secretValue: "raw-secret-value",
          secretReference: {
            providerId: "openrouter",
            secretName: "apiKey",
            storageKind: "os-keychain",
            storageKey: "openrouter:apiKey",
            providerBaseUrl: "https://openrouter.ai/api/v1",
          },
        },
        savedAt: "2026-06-27T00:00:00.000Z",
      }),
    );

    await H.renderApp();

    await H.waitFor(() => expect(window.localStorage.getItem(H.RUNTIME_STORAGE_KEY)).not.toContain("sk-injected-secret"));
    expect(window.localStorage.getItem(H.RUNTIME_STORAGE_KEY)).not.toContain("raw-token-value");
    expect(window.localStorage.getItem(H.RUNTIME_STORAGE_KEY)).not.toContain("raw-secret-value");
    expect(window.localStorage.getItem(H.RUNTIME_STORAGE_KEY)).toContain("openrouter:apiKey");
  });

  it("drops stored provider key references when the base URL changes", async () => {
    window.localStorage.setItem(
      H.RUNTIME_STORAGE_KEY,
      JSON.stringify({
        version: 2,
        theme: "dark",
        activeCardId: "card_blank_slate_rpg",
        cards: [
          {
            id: "card_blank_slate_rpg",
            name: "Blank Slate RPG",
            kind: "rpg",
            summary: "test",
            systemPrompt: "test",
            preHistoryInstructions: "",
            postHistoryInstructions: "",
            playerRules: [],
            lorebooks: [],
            memory: [],
            rpg: {
              location: "start",
              health: "not configured",
              inventory: [],
              quests: [],
              flags: {},
              knownPlaces: [],
              mapStyle: "map",
            },
          },
        ],
        messages: [],
        promptRuns: [],
        providerKeyStatus: "stored",
        providerSettings: {
          mode: "openai-compatible",
          providerId: "openrouter",
          displayName: "OpenRouter BYOK",
          baseUrl: "https://openrouter.ai/api/v1",
          model: "qwen3.7-max",
          secretReference: {
            providerId: "openrouter",
            secretName: "apiKey",
            storageKind: "os-keychain",
            storageKey: "openrouter:apiKey",
            providerBaseUrl: "https://openrouter.ai/api/v1",
          },
        },
        savedAt: "2026-06-27T00:00:00.000Z",
      }),
    );

    await H.renderApp();

    H.fireEvent.click(H.screen.getByRole("button", { name: /API Keys/i }));
    expect(await H.screen.findByText(/Stored reference/i)).toHaveTextContent(/openrouter:apiKey/i);

    H.fireEvent.change(H.screen.getByLabelText(/Base URL/i), {
      target: { value: "https://example.test/v1" },
    });

    await H.waitFor(() => expect(H.screen.queryByText(/Stored reference/i)).not.toBeInTheDocument());
    expect(window.localStorage.getItem(H.RUNTIME_STORAGE_KEY)).not.toContain("openrouter:apiKey");
  });

  it("strips raw-looking secret references from persisted settings", async () => {
    window.localStorage.setItem(
      H.RUNTIME_STORAGE_KEY,
      JSON.stringify({
        version: 2,
        theme: "dark",
        activeCardId: "card_blank_slate_rpg",
        cards: [
          {
            id: "card_blank_slate_rpg",
            name: "Blank Slate RPG",
            kind: "rpg",
            summary: "test",
            systemPrompt: "test",
            preHistoryInstructions: "",
            postHistoryInstructions: "",
            playerRules: [],
            lorebooks: [],
            memory: [],
            rpg: {
              location: "start",
              health: "not configured",
              inventory: [],
              quests: [],
              flags: {},
              knownPlaces: [],
              mapStyle: "map",
            },
          },
        ],
        messages: [],
        promptRuns: [],
        providerKeyStatus: "old",
        providerSettings: {
          mode: "openai-compatible",
          providerId: "openrouter",
          displayName: "OpenRouter BYOK",
          baseUrl: "https://openrouter.ai/api/v1",
          model: "qwen3.7-max",
          secretReference: {
            providerId: "openrouter",
            secretName: "apiKey",
            storageKind: "os-keychain",
            storageKey: "sk-raw-looking-secret",
            providerBaseUrl: "https://openrouter.ai/api/v1",
          },
        },
        savedAt: "2026-06-27T00:00:00.000Z",
      }),
    );

    await H.renderApp();

    await H.waitFor(() => expect(window.localStorage.getItem(H.RUNTIME_STORAGE_KEY)).not.toContain("sk-raw-looking-secret"));
  });
});
