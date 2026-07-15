import { describe, expect, it } from "vitest";

import * as H from "./App.testHarness";

describe("local-first card runtime UI: media", () => {
  it("generates an editable 200-foot aerial image prompt for the blank RPG card", async () => {
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
              location: "Moonlit plain",
              health: "not configured",
              inventory: [],
              quests: [],
              flags: {},
              knownPlaces: ["standing stones"],
              mapStyle: "overhead aerial scene",
            },
          },
        ],
        messages: [],
        chatSessions: [
          {
            id: "chat-map",
            cardId: "card_blank_slate_rpg",
            title: "Map chat",
            createdAt: "2026-06-29T00:00:00.000Z",
            updatedAt: "2026-06-29T00:00:00.000Z",
            messages: [
              {
                id: "assistant-map",
                role: "assistant",
                content:
                  "You stand in a moonlit plain near standing stones. This extra sentence is intentionally long and should not be copied wholesale into the image prompt because the generator only needs aerial-visible visual requirements and large spatial landmarks.",
              },
            ],
          },
        ],
        activeChatIds: {
          card_blank_slate_rpg: "chat-map",
        },
        promptRuns: [],
        providerKeyStatus: "No plaintext keys stored.",
        savedAt: "2026-06-29T00:00:00.000Z",
      }),
    );
    await H.renderApp();

    H.openBlankRpgCard();
    H.fireEvent.click(H.screen.getByRole("button", { name: /Draft aerial image prompt/i }));

    const prompt = H.screen.getByRole("textbox", { name: /Image prompt/i }) as HTMLTextAreaElement;
    await H.waitFor(() => expect(prompt.value).toMatch(/Moonlit plain/i));
    expect(prompt.value).toMatch(/overhead|top-down/i);
    expect(prompt.value).toMatch(/200 feet/i);
    expect(prompt.value).toMatch(/standing stones/i);
    expect(prompt.value).not.toMatch(/\bmap\b|1000 feet|cartographic|tabletop/i);
    expect(prompt.value).not.toMatch(/intentionally long and should not be copied wholesale/i);
    const negativePrompt = H.screen.getByRole("textbox", { name: /Negative prompt/i }) as HTMLTextAreaElement;
    expect(negativePrompt.value).toMatch(/people/i);
    expect(negativePrompt.value).toMatch(/single figure/i);
    expect(negativePrompt.value).toMatch(/first-person view/i);
    expect(H.screen.getByRole("button", { name: /Generate aerial image/i })).not.toBeDisabled();
  });

  it("removes natural map features from AI-planned negative prompts", async () => {
    const fetchImpl = H.vi.fn(async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  prompt: "very high-altitude birdseye map from about 1000 feet above ground, forest plain and river",
                  negativePrompt: "people, trees, forests, single figure, rivers, first-person view",
                }),
              },
            },
          ],
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
            rpg: {
              location: "Forest plain",
              health: "not configured",
              inventory: [],
              quests: [],
              flags: {},
              knownPlaces: ["river", "tree line"],
              mapStyle: "clean tabletop map",
            },
          },
        ],
        messages: [],
        chatSessions: [
          {
            id: "chat-map-ai",
            cardId: "card_blank_slate_rpg",
            title: "Map chat",
            createdAt: "2026-06-29T00:00:00.000Z",
            updatedAt: "2026-06-29T00:00:00.000Z",
            messages: [{ id: "user-map", role: "user", content: "I climb a hill and look over the forest." }],
          },
        ],
        activeChatIds: {
          card_blank_slate_rpg: "chat-map-ai",
        },
        promptRuns: [],
        providerKeyStatus: "No plaintext keys stored.",
        providerSettings: {
          mode: "openai-compatible",
          providerId: "local",
          displayName: "Local OpenAI-compatible endpoint",
          baseUrl: "http://127.0.0.1:1234/v1",
          model: "local-model",
        },
        savedAt: "2026-06-29T00:00:00.000Z",
      }),
    );

    try {
      await H.renderApp();
      H.openBlankRpgCard();
      H.fireEvent.click(H.screen.getByRole("button", { name: /Draft aerial image prompt/i }));

      const prompt = H.screen.getByRole("textbox", { name: /Image prompt/i }) as HTMLTextAreaElement;
      await H.waitFor(() => expect(prompt.value).toMatch(/200 feet/i));
      expect(prompt.value).toMatch(/aerial environment image/i);
      expect(prompt.value).not.toMatch(/\bmap\b|1000 feet|cartographic|tabletop/i);
      const negativePrompt = H.screen.getByRole("textbox", { name: /Negative prompt/i }) as HTMLTextAreaElement;
      await H.waitFor(() => expect(negativePrompt.value).toMatch(/people/i));
      expect(negativePrompt.value).toMatch(/single figure/i);
      expect(negativePrompt.value).toMatch(/first-person view/i);
      expect(negativePrompt.value).not.toMatch(/\btrees?\b/i);
      expect(negativePrompt.value).not.toMatch(/\bforests?\b/i);
      expect(negativePrompt.value).not.toMatch(/\brivers?\b/i);
    } finally {
      H.vi.unstubAllGlobals();
    }
  });

  it("falls back to a local aerial image prompt when the AI prompt planner fails", async () => {
    const fetchImpl = H.vi.fn(async () => {
      throw new Error("planner offline");
    });
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
            rpg: {
              location: "Fallback hill",
              health: "not configured",
              inventory: [],
              quests: [],
              flags: {},
              knownPlaces: ["watch tower"],
              mapStyle: "clean tabletop map",
            },
          },
        ],
        messages: [],
        chatSessions: [
          {
            id: "chat-map-planner-fallback",
            cardId: "card_blank_slate_rpg",
            title: "Map fallback chat",
            createdAt: "2026-06-29T00:00:00.000Z",
            updatedAt: "2026-06-29T00:00:00.000Z",
            messages: [{ id: "user-map", role: "user", content: "I study the watch tower from the hill." }],
          },
        ],
        activeChatIds: {
          card_blank_slate_rpg: "chat-map-planner-fallback",
        },
        promptRuns: [],
        providerKeyStatus: "No plaintext keys stored.",
        providerSettings: {
          mode: "openai-compatible",
          providerId: "local",
          displayName: "Local OpenAI-compatible endpoint",
          baseUrl: "http://127.0.0.1:1234/v1",
          model: "local-model",
        },
        savedAt: "2026-06-29T00:00:00.000Z",
      }),
    );

    try {
      await H.renderApp();
      H.openBlankRpgCard();
      H.fireEvent.click(H.screen.getByRole("button", { name: /Draft aerial image prompt/i }));

      const prompt = H.screen.getByRole("textbox", { name: /Image prompt/i }) as HTMLTextAreaElement;
      await H.waitFor(() => expect(prompt.value).toMatch(/Fallback hill/i));
      expect(prompt.value).toMatch(/watch tower/i);
      expect(await H.screen.findByText(/Aerial image prompt planner fell back to local summary: planner offline/i)).toBeInTheDocument();
    } finally {
      H.vi.unstubAllGlobals();
    }
  });

  it("shows the generated image artifact for the active chat only", async () => {
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
            id: "chat-a",
            cardId: "card_blank_slate_rpg",
            title: "Chat A",
            createdAt: "2026-06-27T00:00:00.000Z",
            updatedAt: "2026-06-27T00:00:00.000Z",
            messages: [],
          },
          {
            id: "chat-b",
            cardId: "card_blank_slate_rpg",
            title: "Chat B",
            createdAt: "2026-06-27T00:01:00.000Z",
            updatedAt: "2026-06-27T00:01:00.000Z",
            messages: [],
          },
        ],
        activeChatIds: {
          card_blank_slate_rpg: "chat-b",
        },
        promptRuns: [],
        providerKeyStatus: "old",
        generatedMaps: [
          {
            id: "map-a",
            cardId: "card_blank_slate_rpg",
            chatId: "chat-a",
            prompt: "Map A",
            negativePrompt: "",
            provider: "prompt-only",
            model: "Model A",
            status: "prompt-only",
            createdAt: "2026-06-27T00:00:00.000Z",
          },
          {
            id: "map-b",
            cardId: "card_blank_slate_rpg",
            chatId: "chat-b",
            prompt: "Map B",
            negativePrompt: "",
            provider: "prompt-only",
            model: "Model B",
            status: "prompt-only",
            createdAt: "2026-06-27T00:01:00.000Z",
          },
        ],
        savedAt: "2026-06-27T00:02:00.000Z",
      }),
    );

    await H.renderApp();
    H.openBlankRpgCard();

    await H.waitFor(() => expect(H.screen.getByRole("region", { name: /Generated aerial image/i })).toHaveTextContent("Model B"));
    expect(H.screen.getByRole("region", { name: /Generated aerial image/i })).not.toHaveTextContent("Model A");
  });

  it("shows the newest persisted map when duplicate artifacts exist for the same chat", async () => {
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
            id: "chat-duplicate-map",
            cardId: "card_blank_slate_rpg",
            title: "Duplicate map chat",
            createdAt: "2026-06-30T00:00:00.000Z",
            updatedAt: "2026-06-30T00:00:00.000Z",
            messages: [],
          },
        ],
        activeChatIds: {
          card_blank_slate_rpg: "chat-duplicate-map",
        },
        promptRuns: [],
        providerKeyStatus: "No plaintext keys stored.",
        generatedMaps: [
          {
            id: "stale-map",
            imageKind: "map",
            cardId: "card_blank_slate_rpg",
            chatId: "chat-duplicate-map",
            prompt: "stale map prompt",
            negativePrompt: "",
            provider: "comfyui",
            model: "Stale Model",
            status: "generated",
            imageUrl: "http://127.0.0.1:8188/view?filename=stale.png&type=output&subfolder=",
            createdAt: "2026-06-30T00:00:00.000Z",
          },
          {
            id: "fresh-map",
            imageKind: "map",
            cardId: "card_blank_slate_rpg",
            chatId: "chat-duplicate-map",
            prompt: "fresh map prompt",
            negativePrompt: "",
            provider: "comfyui",
            model: "Fresh Model",
            status: "generated",
            imageUrl: "http://127.0.0.1:8188/view?filename=fresh.png&type=output&subfolder=",
            createdAt: "2026-06-30T00:10:00.000Z",
          },
        ],
        savedAt: "2026-06-30T00:10:00.000Z",
      }),
    );

    await H.renderApp();
    H.openBlankRpgCard();

    const generatedMap = await H.screen.findByRole("region", { name: /Generated aerial image/i });
    expect(generatedMap).toHaveTextContent("Fresh Model");
    expect(generatedMap).not.toHaveTextContent("Stale Model");
    expect(H.screen.getByAltText(/Generated aerial scene/i)).toHaveAttribute("src", expect.stringContaining("lc_run=fresh-map"));
  });

  it("surfaces a new aerial image prompt draft separately from the existing generated image", async () => {
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
              location: "new ridge",
              health: "not configured",
              inventory: [],
              quests: [],
              flags: {},
              knownPlaces: ["river gate"],
              mapStyle: "clean tabletop map",
            },
          },
        ],
        messages: [],
        chatSessions: [
          {
            id: "chat-map-draft",
            cardId: "card_blank_slate_rpg",
            title: "Map draft chat",
            createdAt: "2026-06-30T00:00:00.000Z",
            updatedAt: "2026-06-30T00:00:00.000Z",
            messages: [],
          },
        ],
        activeChatIds: {
          card_blank_slate_rpg: "chat-map-draft",
        },
        promptRuns: [],
        providerKeyStatus: "No plaintext keys stored.",
        generatedMaps: [
          {
            id: "old-visible-map",
            imageKind: "map",
            cardId: "card_blank_slate_rpg",
            chatId: "chat-map-draft",
            prompt: "old map prompt",
            negativePrompt: "",
            provider: "comfyui",
            model: "Old Model",
            status: "generated",
            imageUrl: "http://127.0.0.1:8188/view?filename=old-visible.png&type=output&subfolder=",
            createdAt: "2026-06-30T00:00:00.000Z",
          },
        ],
        savedAt: "2026-06-30T00:00:00.000Z",
      }),
    );

    await H.renderApp();
    H.openBlankRpgCard();

    const mapGenerator = H.screen.getByRole("region", { name: /Aerial image generator/i });
    expect(H.within(mapGenerator).getByRole("region", { name: /Generated aerial image/i })).toHaveTextContent("Old Model");
    H.fireEvent.click(H.within(mapGenerator).getByRole("button", { name: /Draft aerial image prompt/i }));

    const promptDraft = await H.within(mapGenerator).findByRole("region", { name: /Aerial image prompt draft/i });
    expect(promptDraft).toHaveTextContent(/Generate aerial image/i);
    expect((H.within(mapGenerator).getByLabelText(/^Image prompt$/i) as HTMLTextAreaElement).value).toMatch(/new ridge/i);
    expect(H.within(mapGenerator).getByRole("button", { name: /Regenerate aerial image/i })).not.toBeDisabled();
  });

  it("lets users reset, generate, and delete the current aerial image", async () => {
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
            id: "chat-map-controls",
            cardId: "card_blank_slate_rpg",
            title: "Map controls",
            createdAt: "2026-06-29T00:00:00.000Z",
            updatedAt: "2026-06-29T00:00:00.000Z",
            messages: [],
          },
        ],
        activeChatIds: {
          card_blank_slate_rpg: "chat-map-controls",
        },
        promptRuns: [],
        providerKeyStatus: "No plaintext keys stored.",
        imageProviderSettings: {
          mode: "prompt-only",
          model: "test-image-model",
        },
        generatedMaps: [
          {
            id: "map-current",
            imageKind: "map",
            cardId: "card_blank_slate_rpg",
            chatId: "chat-map-controls",
            prompt: "old map prompt",
            negativePrompt: "",
            provider: "prompt-only",
            model: "test-image-model",
            status: "generated",
            imageUrl: "http://127.0.0.1:8188/view?filename=old-map.png&type=output&subfolder=",
            createdAt: "2026-06-29T00:00:00.000Z",
          },
        ],
        savedAt: "2026-06-29T00:00:00.000Z",
      }),
    );

    await H.renderApp();
    H.openBlankRpgCard();

    const mapGenerator = H.screen.getByRole("region", { name: /Aerial image generator/i });
    expect(H.within(mapGenerator).getByRole("region", { name: /Generated aerial image/i })).toHaveTextContent("test-image-model");

    H.fireEvent.click(H.within(mapGenerator).getByRole("button", { name: /Delete aerial image/i }));
    await H.waitFor(() =>
      expect(H.within(mapGenerator).queryByRole("region", { name: /Generated aerial image/i })).not.toBeInTheDocument(),
    );

    const mapPrompt = H.within(mapGenerator).getByLabelText(/^Image prompt$/i) as HTMLTextAreaElement;
    const mapNegativePrompt = H.within(mapGenerator).getByLabelText(/^Negative prompt$/i) as HTMLTextAreaElement;
    H.fireEvent.change(mapPrompt, { target: { value: "200-foot aerial image prompt" } });
    H.fireEvent.change(mapNegativePrompt, { target: { value: "people" } });
    H.fireEvent.click(H.within(mapGenerator).getByRole("button", { name: /Reset aerial prompt/i }));
    expect(mapPrompt).toHaveValue("");
    expect(mapNegativePrompt).toHaveValue("");

    H.fireEvent.change(mapPrompt, { target: { value: "200-foot aerial image prompt" } });
    H.fireEvent.click(H.within(mapGenerator).getByRole("button", { name: /Generate aerial image/i }));
    await H.waitFor(() =>
      expect(H.within(mapGenerator).getByRole("region", { name: /Generated aerial image/i })).toHaveTextContent("prompt-only"),
    );
  });

  it("surfaces ComfyUI aerial and custom image generation failures", async () => {
    const fetchImpl = H.vi.fn(async () => {
      throw new Error("generation offline");
    });
    H.vi.stubGlobal("fetch", fetchImpl);
    H.seedRuntimeSnapshot({
      imageProviderSettings: {
        mode: "comfyui",
        endpoint: "http://127.0.0.1:8188",
        model: "test-image-model.safetensors",
        workflowJson: JSON.stringify({
          "1": {
            class_type: "SaveImage",
            inputs: {
              filename_prefix: "local_cards",
            },
          },
        }),
        width: 1024,
        height: 1024,
        seed: 0,
        steps: 28,
        cfg: 3.5,
        samplerName: "euler",
        scheduler: "simple",
        pollTimeoutMs: 15_000,
      },
    });

    try {
      await H.renderApp();
      H.openBlankRpgCard();

      const mapGenerator = H.screen.getByRole("region", { name: /Aerial image generator/i });
      H.fireEvent.change(H.within(mapGenerator).getByLabelText(/Image prompt/i), {
        target: { value: "failed aerial image prompt" },
      });
      H.fireEvent.click(H.within(mapGenerator).getByRole("button", { name: /Generate aerial image/i }));
      await H.waitFor(() => expect(H.within(mapGenerator).getByText(/generation offline/i)).toBeInTheDocument());

      H.openMediaTab(/^Image$/i);
      const imageGenerator = H.screen.getByRole("region", { name: /^Image generator$/i });
      H.fireEvent.change(H.within(imageGenerator).getByLabelText(/Image request/i), {
        target: { value: "failed custom image" },
      });
      H.fireEvent.click(H.within(imageGenerator).getByRole("button", { name: /Generate custom image/i }));
      await H.waitFor(() => expect(H.within(imageGenerator).getByText(/generation offline/i)).toBeInTheDocument());
    } finally {
      H.vi.unstubAllGlobals();
    }
  });

  it("restores a saved aerial image prompt and refreshes the image when regenerating", async () => {
    let promptQueueCount = 0;
    const queuedWorkflows: Array<Record<string, { inputs?: Record<string, unknown> }>> = [];
    const fetchImpl = H.vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/object_info/CheckpointLoaderSimple")) {
        return new Response(
          JSON.stringify({
            CheckpointLoaderSimple: {
              input: {
                required: {
                  ckpt_name: [["test-checkpoint.safetensors"], {}],
                },
              },
            },
          }),
          { status: 200 },
        );
      }
      if (url.endsWith("/prompt")) {
        promptQueueCount += 1;
        const body = JSON.parse(String(init?.body)) as {
          prompt: Record<string, { inputs?: Record<string, unknown> }>;
        };
        queuedWorkflows.push(body.prompt);
        return new Response(JSON.stringify({ prompt_id: `map-prompt-${promptQueueCount}` }), { status: 200 });
      }
      if (url.includes("/history/")) {
        const promptId = url.split("/").pop() ?? "map-prompt-1";
        return new Response(
          JSON.stringify({
            [promptId]: {
              outputs: {
                "9": {
                  images: [{ filename: "same-map-file.png", subfolder: "", type: "output" }],
                },
              },
            },
          }),
          { status: 200 },
        );
      }
      return new Response("not found", { status: 404 });
    });
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
            id: "chat-map-refresh",
            cardId: "card_blank_slate_rpg",
            title: "Map refresh",
            createdAt: "2026-06-30T00:00:00.000Z",
            updatedAt: "2026-06-30T00:00:00.000Z",
            messages: [],
          },
        ],
        activeChatIds: {
          card_blank_slate_rpg: "chat-map-refresh",
        },
        promptRuns: [],
        providerKeyStatus: "No plaintext keys stored.",
        imageProviderSettings: {
          mode: "comfyui",
          endpoint: "http://127.0.0.1:8188",
          model: "test-checkpoint.safetensors",
          workflowJson: JSON.stringify({
            "3": {
              class_type: "KSampler",
              inputs: {
                seed: 1,
                steps: 4,
                cfg: 1,
                sampler_name: "euler",
                scheduler: "normal",
              },
            },
            "4": {
              class_type: "CheckpointLoaderSimple",
              inputs: {
                ckpt_name: "{{model}}",
              },
            },
            "5": {
              class_type: "EmptyLatentImage",
              inputs: {
                width: 256,
                height: 256,
                batch_size: 1,
              },
            },
            "9": {
              class_type: "SaveImage",
              inputs: {
                images: ["8", 0],
              },
            },
          }),
          width: 1024,
          height: 1024,
          seed: 12345,
          steps: 28,
          cfg: 6.5,
          samplerName: "dpmpp_2m",
          scheduler: "karras",
          pollTimeoutMs: 15000,
        },
        generatedMaps: [
          {
            id: "saved-map",
            imageKind: "map",
            cardId: "card_blank_slate_rpg",
            chatId: "chat-map-refresh",
            prompt: "saved 200-foot aerial image prompt",
            negativePrompt: "people",
            provider: "comfyui",
            model: "test-checkpoint.safetensors",
            status: "generated",
            imageUrl: "http://127.0.0.1:8188/view?filename=same-map-file.png&type=output&subfolder=",
            createdAt: "2026-06-30T00:00:00.000Z",
          },
        ],
        savedAt: "2026-06-30T00:00:00.000Z",
      }),
    );

    try {
      await H.renderApp();
      H.openBlankRpgCard();

      const mapGenerator = H.screen.getByRole("region", { name: /Aerial image generator/i });
      expect(H.within(mapGenerator).getByRole("button", { name: /Draft aerial image prompt/i })).toBeInTheDocument();
      const prompt = H.within(mapGenerator).getByLabelText(/Image prompt/i) as HTMLTextAreaElement;
      expect(prompt).toHaveValue("saved 200-foot aerial image prompt");
      const oldMapImage = H.within(mapGenerator).getByAltText(/Generated aerial scene/i);
      const oldMapSrc = oldMapImage.getAttribute("src");

      H.fireEvent.click(H.within(mapGenerator).getByRole("button", { name: /Regenerate aerial image/i }));
      await H.waitFor(() => expect(promptQueueCount).toBe(1));
      const refreshedMapImage = H.within(mapGenerator).getByAltText(/Generated aerial scene/i);
      expect(refreshedMapImage.getAttribute("src")).not.toBe(oldMapSrc);
      expect(queuedWorkflows[0]?.["5"].inputs?.width).toBe(1024);
      expect(queuedWorkflows[0]?.["5"].inputs?.height).toBe(1024);
      expect(queuedWorkflows[0]?.["3"].inputs?.steps).toBe(28);
      expect(queuedWorkflows[0]?.["3"].inputs?.sampler_name).toBe("dpmpp_2m");
    } finally {
      H.vi.unstubAllGlobals();
    }
  });

  it("builds a preset-backed custom image prompt from vague user input", async () => {
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
            id: "chat-image-controls",
            cardId: "card_blank_slate_rpg",
            title: "Image controls",
            createdAt: "2026-06-29T00:00:00.000Z",
            updatedAt: "2026-06-29T00:00:00.000Z",
            messages: [],
          },
        ],
        activeChatIds: {
          card_blank_slate_rpg: "chat-image-controls",
        },
        promptRuns: [],
        providerKeyStatus: "No plaintext keys stored.",
        imageProviderSettings: {
          mode: "prompt-only",
          model: "test-image-model",
        },
        savedAt: "2026-06-29T00:00:00.000Z",
      }),
    );

    await H.renderApp();
    H.openBlankRpgCard();
    H.openMediaTab(/^Image$/i);

    const imageGenerator = H.screen.getByRole("region", { name: /^Image generator$/i });
    expect(imageGenerator).toHaveTextContent(/realistic, 4k/i);
    const imageRequest = H.within(imageGenerator).getByLabelText(/Image request/i);
    H.fireEvent.change(imageRequest, {
      target: { value: "temporary image request" },
    });
    H.fireEvent.click(H.within(imageGenerator).getByRole("button", { name: /Reset image request/i }));
    expect(imageRequest).toHaveValue("");

    H.fireEvent.change(imageRequest, {
      target: { value: "a silver tavern sign at sunset" },
    });
    H.fireEvent.click(H.within(imageGenerator).getByRole("button", { name: /Generate custom image/i }));

    await H.waitFor(() =>
      expect(H.within(imageGenerator).getByRole("region", { name: /Generated custom image/i })).toHaveTextContent(
        "prompt-only",
      ),
    );
    await H.waitFor(() => {
      const snapshot = JSON.parse(window.localStorage.getItem(H.RUNTIME_STORAGE_KEY) ?? "{}") as {
        generatedMaps?: Array<{ imageKind?: string; prompt?: string; negativePrompt?: string }>;
      };
      const customImage = snapshot.generatedMaps?.find((artifact) => artifact.imageKind === "photo");
      expect(customImage?.prompt).toContain("realistic, 4k");
      expect(customImage?.prompt).toContain("plus user inputs: a silver tavern sign at sunset");
      expect(customImage?.negativePrompt).toContain("watermark");
    });

    H.fireEvent.click(H.within(imageGenerator).getByRole("button", { name: /Delete image/i }));
    await H.waitFor(() =>
      expect(H.within(imageGenerator).queryByRole("region", { name: /Generated custom image/i })).not.toBeInTheDocument(),
    );
  });

  it("refreshes the displayed custom image when a later generation returns the same provider view URL", async () => {
    let promptQueueCount = 0;
    const fetchImpl = H.vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/object_info/CheckpointLoaderSimple")) {
        return new Response(
          JSON.stringify({
            CheckpointLoaderSimple: {
              input: {
                required: {
                  ckpt_name: [["test-checkpoint.safetensors"], {}],
                },
              },
            },
          }),
          { status: 200 },
        );
      }
      if (url.endsWith("/prompt")) {
        promptQueueCount += 1;
        return new Response(JSON.stringify({ prompt_id: `prompt-${promptQueueCount}` }), { status: 200 });
      }
      if (url.includes("/history/")) {
        const promptId = url.split("/").pop() ?? "prompt-1";
        return new Response(
          JSON.stringify({
            [promptId]: {
              outputs: {
                "9": {
                  images: [{ filename: "same-provider-file.png", subfolder: "", type: "output" }],
                },
              },
            },
          }),
          { status: 200 },
        );
      }
      return new Response("not found", { status: 404 });
    });
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
            id: "chat-image-refresh",
            cardId: "card_blank_slate_rpg",
            title: "Image refresh",
            createdAt: "2026-06-30T00:00:00.000Z",
            updatedAt: "2026-06-30T00:00:00.000Z",
            messages: [],
          },
        ],
        activeChatIds: {
          card_blank_slate_rpg: "chat-image-refresh",
        },
        promptRuns: [],
        providerKeyStatus: "No plaintext keys stored.",
        imageProviderSettings: {
          mode: "comfyui",
          endpoint: "http://127.0.0.1:8188",
          model: "test-checkpoint.safetensors",
          workflowJson: JSON.stringify({
            "4": {
              class_type: "CheckpointLoaderSimple",
              inputs: {
                ckpt_name: "{{model}}",
              },
            },
            "9": {
              class_type: "SaveImage",
              inputs: {
                images: ["8", 0],
              },
            },
          }),
          width: 1024,
          height: 1024,
          seed: -1,
          steps: 28,
          cfg: 6.5,
          samplerName: "dpmpp_2m",
          scheduler: "karras",
          pollTimeoutMs: 15000,
        },
        savedAt: "2026-06-30T00:00:00.000Z",
      }),
    );

    try {
      await H.renderApp();
      H.openBlankRpgCard();
      H.openMediaTab(/^Image$/i);

      const imageGenerator = H.screen.getByRole("region", { name: /^Image generator$/i });
      const imageRequest = H.within(imageGenerator).getByLabelText(/Image request/i);
      H.fireEvent.change(imageRequest, { target: { value: "first image" } });
      H.fireEvent.click(H.within(imageGenerator).getByRole("button", { name: /Generate custom image/i }));
      const firstImage = await H.within(imageGenerator).findByAltText(/Generated custom scene/i);
      const firstSrc = firstImage.getAttribute("src");

      H.fireEvent.change(imageRequest, { target: { value: "second image" } });
      H.fireEvent.click(H.within(imageGenerator).getByRole("button", { name: /Generate custom image/i }));
      await H.waitFor(() => expect(promptQueueCount).toBe(2));
      const secondImage = await H.within(imageGenerator).findByAltText(/Generated custom scene/i);
      const secondSrc = secondImage.getAttribute("src");

      expect(secondSrc).toContain("same-provider-file.png");
      expect(secondSrc).not.toBe(firstSrc);
    } finally {
      H.vi.unstubAllGlobals();
    }
  });

  it("queues local-image-safe settings when the custom image generator starts from stale one-step settings", async () => {
    let promptQueueCount = 0;
    const queuedWorkflows: Array<Record<string, { inputs?: Record<string, unknown> }>> = [];
    const fetchImpl = H.vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/object_info/UNETLoader")) {
        return new Response(
          JSON.stringify({
            UNETLoader: {
              input: {
                required: {
                  unet_name: [["test-checkpoint.safetensors"], {}],
                },
              },
            },
          }),
          { status: 200 },
        );
      }
      if (url.includes("/object_info/CheckpointLoaderSimple")) {
        return new Response(
          JSON.stringify({
            CheckpointLoaderSimple: {
              input: {
                required: {
                  ckpt_name: [["test-checkpoint.safetensors"], {}],
                },
              },
            },
          }),
          { status: 200 },
        );
      }
      if (url.endsWith("/prompt")) {
        promptQueueCount += 1;
        const body = JSON.parse(String(init?.body)) as {
          prompt: Record<string, { inputs?: Record<string, unknown> }>;
        };
        queuedWorkflows.push(body.prompt);
        return new Response(JSON.stringify({ prompt_id: `custom-image-${promptQueueCount}` }), { status: 200 });
      }
      if (url.includes("/history/")) {
        const promptId = url.split("/").pop() ?? "custom-image-1";
        return new Response(
          JSON.stringify({
            [promptId]: {
              outputs: {
                "9": {
                  images: [{ filename: "safe-custom-image.png", subfolder: "", type: "output" }],
                },
              },
            },
          }),
          { status: 200 },
        );
      }
      return new Response("not found", { status: 404 });
    });
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
            id: "chat-custom-safe-settings",
            cardId: "card_blank_slate_rpg",
            title: "Custom safe settings",
            createdAt: "2026-06-30T00:00:00.000Z",
            updatedAt: "2026-06-30T00:00:00.000Z",
            messages: [],
          },
        ],
        activeChatIds: {
          card_blank_slate_rpg: "chat-custom-safe-settings",
        },
        promptRuns: [],
        providerKeyStatus: "No plaintext keys stored.",
        imageProviderSettings: {
          mode: "comfyui",
          endpoint: "http://127.0.0.1:8188",
          model: "test-checkpoint.safetensors",
          workflowJson: JSON.stringify({
            "3": {
              class_type: "KSampler",
              inputs: {
                seed: "{{seed}}",
                steps: "{{steps}}",
                cfg: "{{cfg}}",
                sampler_name: "{{sampler}}",
                scheduler: "{{scheduler}}",
              },
            },
            "5": {
              class_type: "EmptyLatentImage",
              inputs: {
                width: "{{width}}",
                height: "{{height}}",
                batch_size: 1,
              },
            },
            "9": {
              class_type: "SaveImage",
              inputs: {
                images: ["8", 0],
              },
            },
          }),
          width: 1024,
          height: 1024,
          seed: 0,
          steps: 1,
          cfg: 1,
          samplerName: "euler",
          scheduler: "normal",
          pollTimeoutMs: 15000,
        },
        savedAt: "2026-06-30T00:00:00.000Z",
      }),
    );

    try {
      await H.renderApp();
      H.openBlankRpgCard();
      H.openMediaTab(/^Image$/i);

      const imageGenerator = H.screen.getByRole("region", { name: /^Image generator$/i });
      H.fireEvent.change(H.within(imageGenerator).getByLabelText(/Image request/i), {
        target: { value: "a clear portrait of an old stone doorway" },
      });
      H.fireEvent.click(H.within(imageGenerator).getByRole("button", { name: /Generate custom image/i }));
      await H.waitFor(() => expect(promptQueueCount).toBe(1));
      expect(queuedWorkflows[0]?.["5"].inputs?.width).toBe(1024);
      expect(queuedWorkflows[0]?.["5"].inputs?.height).toBe(1024);
      expect(queuedWorkflows[0]?.["3"].inputs?.steps).toBe(28);
      expect(queuedWorkflows[0]?.["3"].inputs?.cfg).toBe(3.5);
      expect(queuedWorkflows[0]?.["3"].inputs?.sampler_name).toBe("euler");
      expect(queuedWorkflows[0]?.["3"].inputs?.scheduler).toBe("simple");
    } finally {
      H.vi.unstubAllGlobals();
    }
  });

  it("lets users maximize generated maps and custom images", async () => {
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
            id: "chat-maximize-media",
            cardId: "card_blank_slate_rpg",
            title: "Maximize media",
            createdAt: "2026-06-30T00:00:00.000Z",
            updatedAt: "2026-06-30T00:00:00.000Z",
            messages: [],
          },
        ],
        activeChatIds: {
          card_blank_slate_rpg: "chat-maximize-media",
        },
        promptRuns: [],
        providerKeyStatus: "No plaintext keys stored.",
        imageProviderSettings: {
          mode: "prompt-only",
          model: "test-image-model",
        },
        generatedMaps: [
          {
            id: "max-map",
            imageKind: "map",
            cardId: "card_blank_slate_rpg",
            chatId: "chat-maximize-media",
            prompt: "map prompt",
            negativePrompt: "",
            provider: "prompt-only",
            model: "test-image-model",
            status: "generated",
            imageUrl: "http://127.0.0.1:8188/view?filename=max-map.png&type=output&subfolder=",
            createdAt: "2026-06-30T00:00:00.000Z",
          },
          {
            id: "max-photo",
            imageKind: "photo",
            cardId: "card_blank_slate_rpg",
            chatId: "chat-maximize-media",
            prompt: "custom image prompt",
            negativePrompt: "",
            provider: "prompt-only",
            model: "test-image-model",
            status: "generated",
            imageUrl: "http://127.0.0.1:8188/view?filename=max-photo.png&type=output&subfolder=",
            createdAt: "2026-06-30T00:01:00.000Z",
          },
          {
            id: "max-rook-portrait",
            imageKind: "character",
            cardId: "card_blank_slate_rpg",
            chatId: "chat-maximize-media",
            subjectId: "story_entity_rook",
            subjectName: "Rook",
            prompt: "Rook portrait prompt",
            negativePrompt: "",
            provider: "prompt-only",
            model: "test-image-model",
            status: "generated",
            imageUrl: "http://127.0.0.1:8188/view?filename=max-rook.png&type=output&subfolder=",
            createdAt: "2026-06-30T00:02:00.000Z",
          },
        ],
        savedAt: "2026-06-30T00:00:00.000Z",
      }),
    );

    const scrollIntoView = H.vi.fn();
    const previousScrollIntoView = HTMLElement.prototype.scrollIntoView;
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      value: scrollIntoView,
      configurable: true,
    });

    try {
      await H.renderApp();
      H.openBlankRpgCard();

      const mapGenerator = H.screen.getByRole("region", { name: /Aerial image generator/i });
      H.fireEvent.click(H.within(mapGenerator).getByRole("button", { name: /Maximize aerial image/i }));
      const mapPreview = H.screen.getByRole("dialog", { name: /Generated aerial image preview/i });
      expect(H.within(mapPreview).getByAltText(/Generated aerial image preview/i)).toHaveAttribute(
        "src",
        expect.stringContaining("lc_run=max-map"),
      );
      H.fireEvent.mouseDown(mapPreview);
      expect(H.screen.getByRole("dialog", { name: /Generated aerial image preview/i })).toBeInTheDocument();
      H.fireEvent.keyDown(document, { key: "Escape" });
      expect(H.screen.queryByRole("dialog", { name: /Generated aerial image preview/i })).not.toBeInTheDocument();

      H.openMediaTab(/^Characters$/i);
      const charactersPanel = H.screen.getByRole("region", { name: /Story characters/i });
      H.fireEvent.click(H.within(charactersPanel).getByRole("button", { name: /Maximize portrait for Rook/i }));
      const portraitPreview = H.screen.getByRole("dialog", { name: /Rook portrait preview/i });
      expect(H.within(portraitPreview).getByAltText(/Rook portrait preview/i)).toHaveAttribute(
        "src",
        expect.stringContaining("lc_run=max-rook-portrait"),
      );
      H.fireEvent.click(H.within(portraitPreview).getByRole("button", { name: /Close media preview/i }));

      H.openMediaTab(/^Image$/i);
      const imageGenerator = H.screen.getByRole("region", { name: /^Image generator$/i });
      H.fireEvent.click(H.within(imageGenerator).getByRole("button", { name: /Maximize image/i }));
      const imagePreview = H.screen.getByRole("dialog", { name: /Generated custom image preview/i });
      expect(H.within(imagePreview).getByAltText(/Generated custom image preview/i)).toHaveAttribute(
        "src",
        expect.stringContaining("lc_run=max-photo"),
      );
      H.fireEvent.mouseDown(imagePreview.closest(".media-preview-backdrop") as HTMLElement);
      expect(H.screen.queryByRole("dialog", { name: /Generated custom image preview/i })).not.toBeInTheDocument();
    } finally {
      if (previousScrollIntoView) {
        Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
          value: previousScrollIntoView,
          configurable: true,
        });
      } else {
        delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
      }
    }
  });
});
