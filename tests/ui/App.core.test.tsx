import { describe, expect, it } from "vitest";

import * as H from "./App.testHarness";

describe("local-first card runtime UI: core", () => {
  it("starts with a playable sample and a blank RPG while keeping memory out of the open", async () => {
    await H.renderApp();

    expect(H.screen.getByRole("heading", { name: /Open a saved card/i })).toBeInTheDocument();
    expect(H.screen.getByRole("region", { name: /Story workspace/i })).toBeInTheDocument();
    expect(H.screen.getByRole("region", { name: /No active card/i })).toBeInTheDocument();
    expect(H.screen.queryByRole("button", { name: /^Characters$/i })).not.toBeInTheDocument();
    expect(H.screen.queryByRole("dialog", { name: /Memory inspector/i })).not.toBeInTheDocument();
    expect(H.screen.queryByRole("region", { name: /RPG state/i })).not.toBeInTheDocument();

    H.openCards();
    const cardLibrary = H.screen.getByRole("region", { name: /Card library/i });
    expect(H.within(cardLibrary).getByText(/Ashfall Crossing/i)).toBeInTheDocument();
    expect(H.within(cardLibrary).getByText(/Blank Slate RPG/i)).toBeInTheDocument();
    expect(cardLibrary.querySelector(".compact-card-list")).toBeInTheDocument();
    expect(H.within(cardLibrary).getAllByRole("button", { name: /Delete/i })).toHaveLength(2);
    expect(H.screen.queryByText(/0 runs/i)).not.toBeInTheDocument();
    const createCardPanel = H.screen.getByRole("region", { name: /Create card/i });
    expect(H.within(createCardPanel).queryByLabelText(/^Name$/i)).not.toBeInTheDocument();
    expect(H.within(createCardPanel).getByRole("button", { name: /Start creating card/i })).toBeInTheDocument();

    H.fireEvent.click(H.within(cardLibrary).getByRole("button", { name: /^Open$/i }));
    expect(H.screen.getByRole("heading", { name: /Blank Slate RPG/i })).toBeInTheDocument();
    H.openCardEditorTab(/lorebooks/i);
    expect(H.screen.getByLabelText(/^Lorebook$/i)).toHaveValue("");
    expect(H.screen.queryByText(/Blank RPG Lorebook/i)).not.toBeInTheDocument();
    H.fireEvent.click(H.screen.getByRole("button", { name: /Inspect memory/i }));
    expect(H.screen.getByRole("dialog", { name: /Memory inspector/i })).toBeInTheDocument();
  });

  it("renders assistant emphasis and scene status without raw markdown clutter", async () => {
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
            summary: "Empty RPG card for user-defined world rules, lore, state, and map generation.",
            systemPrompt: "Run only the RPG defined by this card.",
            preHistoryInstructions: "",
            postHistoryInstructions: "",
            playerRules: [],
            lorebooks: [],
            memory: [],
            rpg: {
              location: "Unmapped starting area",
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
            id: "chat-display",
            cardId: "card_blank_slate_rpg",
            title: "Display chat",
            createdAt: "2026-06-29T00:00:00.000Z",
            updatedAt: "2026-06-29T00:00:00.000Z",
            messages: [
              {
                id: "assistant-display",
                role: "assistant",
                content:
                  '**SUCCESS** You hear "wind over grass" as *the plain opens around you.*\n\n**What do you do?**\n```status\nCurrent Date: March 15, 2023\nCurrent Time: 22:47\nLocation: Unmapped starting area\nWeather: Clear night sky\n```',
              },
            ],
          },
        ],
        activeChatIds: {
          card_blank_slate_rpg: "chat-display",
        },
        promptRuns: [],
        providerKeyStatus: "No plaintext keys stored.",
        savedAt: "2026-06-29T00:00:00.000Z",
      }),
    );
    const { container } = await H.renderApp();

    H.openBlankRpgCard();
    const transcript = H.screen.getByRole("log", { name: /Chat transcript/i });
    expect(H.within(transcript).getByText(/You hear "wind over grass"/i)).toBeInTheDocument();
    expect(H.within(transcript).queryByText(/```status/i)).not.toBeInTheDocument();
    expect(H.within(transcript).queryByText(/Current Date:/i)).not.toBeInTheDocument();
    expect(container.querySelector(".message-paragraph strong")).toHaveTextContent("SUCCESS");
    expect(container.querySelector(".message-aside")).toHaveTextContent("the plain opens around you.");

    const status = H.within(transcript).getByLabelText(/Scene status/i);
    expect(status).toHaveTextContent("Current Date");
    expect(status).toHaveTextContent("March 15, 2023");
    expect(status).toHaveTextContent("Current Time");
    expect(status).toHaveTextContent("22:47");
    expect(status).toHaveTextContent("Location");
    expect(status).toHaveTextContent("Unmapped starting area");
  });

  it("creates a user card with card-local pre-history, post-history, and rules", async () => {
    await H.renderApp();

    const createCardPanel = H.startCreatingCard();
    H.fireEvent.change(H.within(createCardPanel).getByLabelText(/^Name$/i), { target: { value: "Detective Card" } });
    H.fireEvent.change(H.within(createCardPanel).getByLabelText(/System prompt/i), {
      target: { value: "Run a quiet detective character." },
    });
    H.fireEvent.change(H.within(createCardPanel).getByLabelText(/Pre-history instructions/i), {
      target: { value: "Apply noir continuity before chat history." },
    });
    H.fireEvent.change(H.within(createCardPanel).getByLabelText(/Post-history instructions/i), {
      target: { value: "After chat history, ask one grounded follow-up." },
    });
    H.fireEvent.change(H.within(createCardPanel).getByLabelText(/Player rules/i), {
      target: { value: "No supernatural clues unless established." },
    });
    H.fireEvent.click(H.within(createCardPanel).getByRole("button", { name: /^Create card$/i }));

    expect(H.screen.getByRole("heading", { name: /Detective Card/i })).toBeInTheDocument();
    H.openCards();
    H.fireEvent.click(H.screen.getByRole("tab", { name: /instructions/i }));
    expect(H.screen.getByDisplayValue(/Apply noir continuity before chat history/i)).toBeInTheDocument();
    expect(H.screen.getByDisplayValue(/After chat history, ask one grounded follow-up/i)).toBeInTheDocument();

    H.fireEvent.click(H.screen.getByRole("tab", { name: /rules/i }));
    const rulesPanel = H.screen.getByRole("region", { name: /Card rules/i });
    expect(H.within(rulesPanel).getAllByDisplayValue(/No supernatural clues unless established/i)).not.toHaveLength(0);
    expect(H.within(rulesPanel).getByLabelText(/Prompt debugger/i)).toHaveTextContent(/Pre-history instructions/i);
    expect(H.within(rulesPanel).getByLabelText(/Prompt debugger/i)).toHaveTextContent(/Post-history instructions/i);
  });

  it("creates an RPG card from the full creation draft fields", async () => {
    window.localStorage.clear();
    const { unmount } = await H.renderApp();

    const createCardPanel = H.startCreatingCard();
    H.fireEvent.change(H.within(createCardPanel).getByLabelText(/^Name$/i), { target: { value: "Harbor RPG" } });
    H.fireEvent.change(H.within(createCardPanel).getByLabelText(/Card type/i), { target: { value: "rpg" } });
    H.fireEvent.click(H.within(createCardPanel).getByLabelText(/Enable map\/image panel/i));
    H.fireEvent.change(H.within(createCardPanel).getByLabelText(/^Summary$/i), {
      target: { value: "A dockside mystery campaign." },
    });
    H.fireEvent.change(H.within(createCardPanel).getByLabelText(/Character name/i), {
      target: { value: "Mira Vale" },
    });
    H.fireEvent.change(H.within(createCardPanel).getByLabelText(/^Description$/i), {
      target: { value: "A practical harbor guide." },
    });
    H.fireEvent.change(H.within(createCardPanel).getByLabelText(/^Scenario$/i), {
      target: { value: "Fog covers the old pier." },
    });
    H.fireEvent.change(H.within(createCardPanel).getByLabelText(/^Greeting$/i), {
      target: { value: "The tide is low. What do you do?" },
    });
    H.fireEvent.change(H.within(createCardPanel).getByLabelText(/Example dialogs/i), {
      target: { value: "User: I inspect the pier.\nMira: The boards creak." },
    });
    H.fireEvent.change(H.within(createCardPanel).getByLabelText(/System prompt/i), {
      target: { value: "Run the harbor as an RPG." },
    });
    H.fireEvent.change(H.within(createCardPanel).getByLabelText(/Lorebook name/i), {
      target: { value: "Harbor Lore" },
    });
    H.fireEvent.click(H.within(createCardPanel).getByRole("button", { name: /^Create card$/i }));

    expect(H.screen.getByRole("heading", { name: /Harbor RPG/i })).toBeInTheDocument();
    expect(H.screen.queryByRole("region", { name: /Image and story tools/i })).not.toBeInTheDocument();

    H.openCards();
    expect(H.screen.getByDisplayValue("A dockside mystery campaign.")).toBeInTheDocument();
    expect(H.screen.getByDisplayValue("Mira Vale")).toBeInTheDocument();
    expect(H.screen.getByDisplayValue("Fog covers the old pier.")).toBeInTheDocument();

    H.openCardEditorTab(/lorebooks/i);
    expect(H.screen.getByLabelText(/^Lorebook$/i)).toHaveDisplayValue("Harbor Lore");

    unmount();
    window.localStorage.clear();
  });

  it("shows the card greeting as a non-persisted opening before the user sends a message", async () => {
    await H.renderApp();

    const createCardPanel = H.startCreatingCard();
    H.fireEvent.change(H.within(createCardPanel).getByLabelText(/^Name$/i), { target: { value: "Gatekeeper Card" } });
    H.fireEvent.change(H.within(createCardPanel).getByLabelText(/^Greeting$/i), {
      target: { value: "The gatekeeper raises a lantern before you can speak." },
    });
    H.fireEvent.click(H.within(createCardPanel).getByRole("button", { name: /^Create card$/i }));

    const transcript = H.screen.getByRole("log", { name: /Chat transcript/i });
    expect(H.within(transcript).getByText(/gatekeeper raises a lantern/i)).toBeInTheDocument();
    expect(H.within(transcript).queryByText(/Empty chat/i)).not.toBeInTheDocument();
    expect(H.within(transcript).queryByText(/^I answer the gatekeeper/i)).not.toBeInTheDocument();
    expect(H.within(transcript).getByLabelText(/Card opening/i)).toHaveClass("message", "response");

    await H.waitFor(() => {
      const snapshot = JSON.parse(window.localStorage.getItem(H.RUNTIME_STORAGE_KEY) ?? "{}") as {
        chatSessions?: Array<{ cardId?: string; messages?: Array<{ content?: string }> }>;
      };
      const gatekeeperChat = snapshot.chatSessions?.find((chat) => chat.cardId && chat.cardId !== "card_blank_slate_rpg");
      expect(gatekeeperChat?.messages ?? []).toEqual([]);
    });

    H.sendRuntimeMessage("I answer the gatekeeper.");

    await H.waitFor(() => expect(H.within(transcript).getByText("I answer the gatekeeper.")).toBeInTheDocument());
    expect(H.within(transcript).getAllByText(/gatekeeper raises a lantern/i)).toHaveLength(1);
  });

  it("shows a non-persisted opening for the blank RPG even without a configured greeting", async () => {
    await H.renderApp();

    H.openBlankRpgCard();

    const transcript = H.screen.getByRole("log", { name: /Chat transcript/i });
    expect(H.within(transcript).getByLabelText(/Card opening/i)).toHaveClass("message", "response");
    expect(H.within(transcript).getByText(/Describe your character, their surroundings, and what they are doing/i)).toBeInTheDocument();
    expect(H.within(transcript).queryByRole("region", { name: /Empty chat/i })).not.toBeInTheDocument();

    await H.waitFor(() => {
      const snapshot = JSON.parse(window.localStorage.getItem(H.RUNTIME_STORAGE_KEY) ?? "{}") as {
        chatSessions?: Array<{ cardId?: string; messages?: Array<{ content?: string }> }>;
      };
      const blankChat = snapshot.chatSessions?.find((chat) => chat.cardId === "card_blank_slate_rpg");
      expect(blankChat?.messages ?? []).toEqual([]);
    });
  });

  it("uses a blank send as a random opening without saving an empty user message", async () => {
    await H.renderApp();

    H.openBlankRpgCard();
    const transcript = H.screen.getByRole("log", { name: /Chat transcript/i });
    H.fireEvent.click(H.screen.getByRole("button", { name: /^Send$/i }));

    await H.waitFor(() => expect(H.within(transcript).getByText(/come to yourself at the edge/i)).toBeInTheDocument());
    expect(H.within(transcript).queryByText(/^Surprise me with a random opening scene\.$/i)).not.toBeInTheDocument();
    expect(H.within(transcript).queryByText(/^You$/i)).not.toBeInTheDocument();

    await H.waitFor(() => {
      const snapshot = JSON.parse(window.localStorage.getItem(H.RUNTIME_STORAGE_KEY) ?? "{}") as {
        chatSessions?: Array<{ cardId?: string; messages?: Array<{ role?: string; content?: string }> }>;
      };
      const blankChat = snapshot.chatSessions?.find((chat) => chat.cardId === "card_blank_slate_rpg");
      expect(blankChat?.messages ?? []).toEqual([
        expect.objectContaining({
          role: "assistant",
          content: expect.stringMatching(/come to yourself at the edge/i),
        }),
      ]);
    });
  });

  it("blocks player actions that violate active RPG rules", async () => {
    await H.renderApp();

    H.openBlankRpgCard();
    H.sendRuntimeMessage("I teleport through walls and skip to the end.");

    await H.screen.findByText(/Blocked by this RPG card: movement must stay plausible/i);
    expect(H.screen.getByRole("log", { name: /Chat transcript/i })).not.toHaveTextContent(/teleport through walls/i);
  });

  it("lets the player stop an in-flight turn before it commits messages or state", async () => {
    const requests: H.TextGenerationRequest[] = [];
    const adapter: H.TextModelAdapter = {
      id: "abortable",
      displayName: "Abortable provider",
      async listModels(): Promise<H.ModelInfo[]> {
        return [];
      },
      async generateText(request: H.TextGenerationRequest): Promise<H.TextGenerationResponse> {
        requests.push(request);
        return new Promise((_resolve, reject) => {
          const abort = () => reject(new DOMException("Generation stopped", "AbortError"));
          if (request.signal?.aborted) {
            abort();
          } else {
            request.signal?.addEventListener("abort", abort, { once: true });
          }
        });
      },
    };
    const providerSpy = H.vi
      .spyOn(H.providerConfig, "createTextProvider")
      .mockReturnValue(adapter as ReturnType<typeof H.providerConfig.createTextProvider>);

    try {
      await H.renderApp();
      H.openBlankRpgCard();
      H.sendRuntimeMessage("I inspect the unfinished corridor.");

      const stop = await H.screen.findByRole("button", { name: /Stop generation/i });
      expect(requests[0]?.signal).toBeInstanceOf(AbortSignal);
      expect(H.screen.getByLabelText(/Message input/i)).toBeDisabled();
      expect(H.screen.getByLabelText(/Active chat/i)).toBeDisabled();
      expect(H.screen.getByRole("button", { name: /New chat/i })).toBeDisabled();
      expect(H.screen.getByRole("button", { name: /^Delete chat$/i })).toBeDisabled();
      H.fireEvent.click(stop);

      await H.screen.findByText(/Generation stopped/i);
      expect(H.screen.queryByRole("button", { name: /Stop generation/i })).not.toBeInTheDocument();
      expect(H.screen.getByRole("log", { name: /Chat transcript/i })).not.toHaveTextContent(
        /unfinished corridor/i,
      );
      await H.waitFor(() => {
        const snapshot = JSON.parse(window.localStorage.getItem(H.RUNTIME_STORAGE_KEY) ?? "{}") as {
          promptRuns?: Array<{ modelCalls?: H.ModelCallRecord[] }>;
        };
        expect(snapshot.promptRuns?.[0]?.modelCalls).toEqual([
          expect.objectContaining({
            phase: "visible-response",
            status: "error",
            usageSource: "unavailable",
            cost: { status: "unknown", currency: "USD" },
            failure: expect.objectContaining({ category: "aborted" }),
          }),
        ]);
      });
    } finally {
      providerSpy.mockRestore();
    }
  });

  it("disables a regex lore entry when isolated matching cannot complete", async () => {
    H.seedRuntimeSnapshot(
      {},
      {
        lorebooks: [
          {
            id: "lore-regex",
            name: "Imported regex lore",
            description: "test",
            enabled: true,
            scanDepth: 4,
            tokenBudget: 800,
            recursiveScanning: false,
            entries: [
              {
                id: "regex-entry",
                title: "Regex gate",
                content: "Unsafe imported regex content",
                keys: ["\\bgate\\b"],
                secondaryKeys: [],
                insertionOrder: 100,
                priority: 1,
                enabled: true,
                constant: false,
                probability: 100,
                caseSensitive: false,
                wholeWord: false,
                matchMode: "regex",
              },
            ],
          },
        ],
      },
    );
    await H.renderApp();
    H.openBlankRpgCard();
    H.sendRuntimeMessage("I inspect the gate.");

    await H.screen.findByText(/Disabled 1 lore regex entry/i);
    await H.waitFor(() => {
      const snapshot = JSON.parse(window.localStorage.getItem(H.RUNTIME_STORAGE_KEY) ?? "{}") as {
        cards?: Array<{ lorebooks?: Array<{ entries?: Array<{ id?: string; enabled?: boolean }> }> }>;
      };
      const entry = snapshot.cards?.[0]?.lorebooks?.[0]?.entries?.find((item) => item.id === "regex-entry");
      expect(entry?.enabled).toBe(false);
    });
  });

  it("applies grounded visible-pass knowledge updates to the story roster in the same turn", async () => {
    await H.renderApp();

    H.openBlankRpgCard();
    H.sendRuntimeMessage("I am Nia beside Rook. Rook learns that the north gate is open.");

    const transcript = H.screen.getByRole("log", { name: /Chat transcript/i });
    await H.waitFor(() => expect(transcript).toHaveTextContent(/north gate is open/i));

    H.openMediaTab(/^Characters$/i);
    const charactersPanel = H.screen.getByRole("region", { name: /Story characters/i });
    const rookCard = H.within(charactersPanel).getByLabelText(/Character portrait for Rook/i).closest(".story-entity-item");
    expect(rookCard).not.toBeNull();
    H.fireEvent.click(H.within(rookCard as HTMLElement).getByRole("button", { name: /Show details for Rook/i }));
    expect(H.within(rookCard as HTMLElement).getByText(/^Knows$/)).toBeInTheDocument();
    expect(H.within(rookCard as HTMLElement).getByText(/the north gate is open/i)).toBeInTheDocument();

    await H.waitFor(() => {
      const snapshot = JSON.parse(window.localStorage.getItem(H.RUNTIME_STORAGE_KEY) ?? "{}") as {
        cards?: Array<{ id?: string; storyEntities?: Array<{ name?: string; knownFacts?: string[] }> }>;
      };
      const blankCard = snapshot.cards?.find((card) => card.id === "card_blank_slate_rpg");
      const rook = blankCard?.storyEntities?.find((entity) => entity.name === "Rook");
      expect(rook?.knownFacts ?? []).toEqual(expect.arrayContaining([expect.stringMatching(/north gate is open/i)]));
    });
  });

  it("lets the user edit a character portrait prompt and regenerate the portrait", async () => {
    await H.renderApp();

    H.openBlankRpgCard();
    H.sendRuntimeMessage("I meet Rook in a rainy alley. Rook learns that the harbor light is red.");

    const transcript = H.screen.getByRole("log", { name: /Chat transcript/i });
    await H.waitFor(() => expect(transcript).toHaveTextContent(/harbor light is red/i));

    H.openMediaTab(/^Characters$/i);
    const charactersPanel = H.screen.getByRole("region", { name: /Story characters/i });
    const rookCard = H.within(charactersPanel).getByLabelText(/Character portrait for Rook/i).closest(".story-entity-item");
    expect(rookCard).not.toBeNull();
    H.fireEvent.click(H.within(rookCard as HTMLElement).getByRole("button", { name: /Show details for Rook/i }));

    const promptField = H.within(rookCard as HTMLElement).getByLabelText(/Portrait prompt for Rook/i);
    H.fireEvent.change(promptField, { target: { value: "Custom Rook portrait, scarlet cloak, harbor light" } });
    H.fireEvent.click(H.within(rookCard as HTMLElement).getByRole("button", { name: /Regenerate portrait/i }));

    await H.waitFor(() => {
      const snapshot = JSON.parse(window.localStorage.getItem(H.RUNTIME_STORAGE_KEY) ?? "{}") as {
        generatedMaps?: Array<{ imageKind?: string; subjectName?: string; prompt?: string }>;
      };
      const rookPortraits =
        snapshot.generatedMaps?.filter(
          (artifact) => artifact.imageKind === "character" && artifact.subjectName === "Rook",
        ) ?? [];
      expect(rookPortraits.some((artifact) => /scarlet cloak/i.test(artifact.prompt ?? ""))).toBe(true);
    });
  });

  it("auto-generates new character portraits through ready ComfyUI settings", async () => {
    let promptQueueCount = 0;
    const queuedPrompts: Array<Record<string, { inputs?: Record<string, unknown> }>> = [];
    const fetchImpl = H.vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/object_info/UNETLoader")) {
        return new Response(
          JSON.stringify({
            UNETLoader: {
              input: {
                required: {
                  unet_name: [["portrait-model.safetensors"], {}],
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
        queuedPrompts.push(body.prompt);
        return new Response(JSON.stringify({ prompt_id: `portrait-${promptQueueCount}` }), { status: 200 });
      }
      if (url.includes("/history/")) {
        const promptId = url.split("/").pop() ?? "portrait-1";
        return new Response(
          JSON.stringify({
            [promptId]: {
              outputs: {
                "1": {
                  images: [{ filename: `${promptId}.png`, subfolder: "", type: "output" }],
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
    H.seedRuntimeSnapshot({
      imageProviderSettings: {
        mode: "comfyui",
        portraitGenerationMode: "auto",
        endpoint: "http://127.0.0.1:8188",
        model: "portrait-model.safetensors",
        workflowJson: JSON.stringify({
          "1": {
            class_type: "SaveImage",
            inputs: {
              filename_prefix: "local_cards",
            },
          },
          "2": {
            class_type: "CLIPTextEncode",
            inputs: {
              text: "{{prompt}}",
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
      H.fireEvent.click(H.screen.getByRole("button", { name: /API Keys/i }));
      const imageProviderSection = H.screen.getByRole("region", { name: /Image provider/i });
      await H.waitFor(() =>
        expect(H.within(imageProviderSection).getByText(/Startup check ready.*portrait-model\.safetensors/i)).toBeInTheDocument(),
      );
      H.fireEvent.change(H.within(imageProviderSection).getByLabelText(/^Steps$/i), { target: { value: "1" } });
      H.fireEvent.change(H.within(imageProviderSection).getByLabelText(/^CFG$/i), { target: { value: "1" } });

      H.openBlankRpgCard();
      H.sendRuntimeMessage("I meet Rook in a rainy alley. Rook learns that the harbor light is red.");

      await H.waitFor(() => expect(promptQueueCount).toBeGreaterThanOrEqual(1));
      expect(JSON.stringify(queuedPrompts)).toMatch(/RPG character portrait/i);

      H.openMediaTab(/^Characters$/i);
      const charactersPanel = H.screen.getByRole("region", { name: /Story characters/i });
      await H.waitFor(() =>
        expect(H.within(charactersPanel).getByLabelText(/Character portrait for Rook/i)).toHaveTextContent(
          /Portrait generated/i,
        ),
      );
    } finally {
      H.vi.unstubAllGlobals();
    }
  });

  it("keeps saved character knowledge collapsed and omits notes from character details", async () => {
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
            characterName: "",
            characterDescription: "",
            scenario: "",
            greeting: "",
            exampleDialogs: "",
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
                name: "Nia",
                kind: "player",
                summary: "A careful cartographer.",
                knownFacts: ["Nia knows she carries a silver coin."],
                doesNotKnow: [],
                notes: ["This player note should not render."],
              },
              {
                id: "story_entity_rook",
                name: "Rook",
                kind: "character",
                summary: "A contact in the alley.",
                knownFacts: ["Rook knows Nia is nearby."],
                doesNotKnow: ["Nia carries a silver coin."],
                notes: ["This NPC note should not render."],
              },
            ],
            rpg: {
              location: "Rainy alley",
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
            id: "chat-character-roster",
            cardId: "card_blank_slate_rpg",
            title: "Character roster",
            createdAt: "2026-07-01T00:00:00.000Z",
            updatedAt: "2026-07-01T00:00:00.000Z",
            messages: [],
          },
        ],
        activeChatIds: {
          card_blank_slate_rpg: "chat-character-roster",
        },
        promptRuns: [],
        providerKeyStatus: "No plaintext keys stored.",
        savedAt: "2026-07-01T00:00:00.000Z",
      }),
    );
    await H.renderApp();

    H.openBlankRpgCard();
    H.openMediaTab(/^Characters$/i);
    const charactersPanel = H.screen.getByRole("region", { name: /Story characters/i });
    expect(H.within(charactersPanel).getByLabelText(/Character portrait for Nia/i)).toBeInTheDocument();
    expect(H.within(charactersPanel).getByLabelText(/Character portrait for Rook/i)).toBeInTheDocument();
    expect(H.within(charactersPanel).queryByText(/Nia carries a silver coin/i)).not.toBeInTheDocument();
    expect(H.within(charactersPanel).queryByText(/This NPC note should not render/i)).not.toBeInTheDocument();

    const rookCard = H.within(charactersPanel).getByLabelText(/Character portrait for Rook/i).closest(".story-entity-item");
    expect(rookCard).not.toBeNull();
    H.fireEvent.click(H.within(rookCard as HTMLElement).getByRole("button", { name: /Show details for Rook/i }));
    expect(H.within(rookCard as HTMLElement).getByText(/Rook knows Nia is nearby/i)).toBeInTheDocument();
    expect(H.within(rookCard as HTMLElement).getByText(/Nia carries a silver coin/i)).toBeInTheDocument();
    expect(H.within(rookCard as HTMLElement).queryByText(/This NPC note should not render/i)).not.toBeInTheDocument();
    expect(H.within(rookCard as HTMLElement).queryByText(/Notes/i)).not.toBeInTheDocument();
  });

  it("renders saved memory entries and media error placeholders", async () => {
    H.seedRuntimeSnapshot(
      {
        generatedMaps: [
          {
            id: "error-map",
            imageKind: "map",
            cardId: "card_blank_slate_rpg",
            chatId: "chat_seeded",
            prompt: "map prompt",
            negativePrompt: "",
            provider: "comfyui",
            model: "test-image-model",
            status: "error",
            error: "Map generation failed.",
            createdAt: "2026-07-01T00:00:00.000Z",
          },
          {
            id: "error-photo",
            imageKind: "photo",
            cardId: "card_blank_slate_rpg",
            chatId: "chat_seeded",
            prompt: "custom image prompt",
            negativePrompt: "",
            provider: "comfyui",
            model: "test-image-model",
            status: "error",
            error: "Image generation failed.",
            createdAt: "2026-07-01T00:01:00.000Z",
          },
          {
            id: "error-rook-portrait",
            imageKind: "character",
            cardId: "card_blank_slate_rpg",
            chatId: "chat_seeded",
            subjectId: "story_entity_rook",
            subjectName: "Rook",
            prompt: "Rook portrait prompt",
            negativePrompt: "",
            provider: "comfyui",
            model: "test-image-model",
            status: "error",
            error: "Portrait generation failed.",
            createdAt: "2026-07-01T00:02:00.000Z",
          },
        ],
      },
      {
        memory: [
          {
            id: "memory-1",
            label: "Player identity",
            detail: "Ari is a careful cartographer.",
          },
        ],
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
            doesNotKnow: ["Ari carries a silver coin."],
          },
        ],
      },
    );
    await H.renderApp();

    H.openBlankRpgCard();
    H.fireEvent.click(H.screen.getByRole("button", { name: /Inspect memory/i }));
    const memoryDrawer = H.screen.getByRole("dialog", { name: /Memory inspector/i });
    expect(H.within(memoryDrawer).getByText(/Player identity/i)).toBeInTheDocument();
    expect(H.within(memoryDrawer).getByText(/Ari is a careful cartographer/i)).toBeInTheDocument();
    H.fireEvent.click(H.within(memoryDrawer).getByRole("button", { name: /Close memory inspector/i }));

    const mapGenerator = H.screen.getByRole("region", { name: /Aerial image generator/i });
    expect(H.within(mapGenerator).getByText(/Aerial image generation needs attention/i)).toBeInTheDocument();
    expect(H.within(mapGenerator).getByText(/Map generation failed/i)).toBeInTheDocument();

    H.openMediaTab(/^Image$/i);
    const imageGenerator = H.screen.getByRole("region", { name: /^Image generator$/i });
    expect(H.within(imageGenerator).getByText(/Image generation needs attention/i)).toBeInTheDocument();
    expect(H.within(imageGenerator).getByText(/Image generation failed/i)).toBeInTheDocument();

    H.openMediaTab(/^Characters$/i);
    const charactersPanel = H.screen.getByRole("region", { name: /Story characters/i });
    expect(H.within(charactersPanel).getByLabelText(/Character portrait for Rook/i)).toHaveTextContent(/Portrait needs attention/i);
    expect(H.within(charactersPanel).getByText(/Portrait generation failed/i)).toBeInTheDocument();
    const rookCard = H.within(charactersPanel).getByLabelText(/Character portrait for Rook/i).closest(".story-entity-item");
    expect(rookCard).not.toBeNull();
    H.fireEvent.click(H.within(rookCard as HTMLElement).getByRole("button", { name: /Show details for Rook/i }));
    expect(H.within(rookCard as HTMLElement).getByText(/Rook knows the old pier/i)).toBeInTheDocument();
    expect(H.within(rookCard as HTMLElement).getByText(/Ari carries a silver coin/i)).toBeInTheDocument();
  });

  it("previews memory consolidation and changes nothing until the user accepts", async () => {
    H.seedRuntimeSnapshot(
      {},
      {
        memory: Array.from({ length: 4 }, (_, index) => ({
          id: `memory-${index + 1}`,
          label: `Original fact ${index + 1}`,
          detail: `Original detail ${index + 1}`,
        })),
      },
    );
    const consolidationSpy = H.vi.spyOn(H.memoryConsolidation, "runMemoryConsolidationSafely").mockResolvedValue({
      changed: true,
      entries: [{ id: "memory-condensed", label: "Condensed fact", detail: "Condensed detail" }],
      warnings: [],
    });

    try {
      await H.renderApp();
      H.openBlankRpgCard();
      H.fireEvent.click(H.screen.getByRole("button", { name: /Inspect memory/i }));
      const drawer = H.screen.getByRole("dialog", { name: /Memory inspector/i });

      H.fireEvent.click(H.within(drawer).getByRole("button", { name: /Consolidate memory/i }));
      const review = await H.within(drawer).findByRole("region", { name: /Memory consolidation review/i });
      expect(H.within(review).getByText(/4 current entries/i)).toBeInTheDocument();
      expect(H.within(review).getByText(/1 proposed entry/i)).toBeInTheDocument();
      expect(H.within(review).getByText(/Condensed detail/i)).toBeInTheDocument();

      let persisted = JSON.parse(window.localStorage.getItem(H.RUNTIME_STORAGE_KEY) ?? "{}") as {
        cards?: Array<{ memory?: unknown[] }>;
      };
      expect(persisted.cards?.[0]?.memory).toHaveLength(4);
      expect(H.within(drawer).getByText(/Original detail 1/i)).toBeInTheDocument();

      H.fireEvent.click(H.within(review).getByRole("button", { name: /Cancel consolidation/i }));
      expect(H.within(drawer).queryByRole("region", { name: /Memory consolidation review/i })).not.toBeInTheDocument();
      expect(H.within(drawer).getByText(/Original detail 1/i)).toBeInTheDocument();

      H.fireEvent.click(H.within(drawer).getByRole("button", { name: /Consolidate memory/i }));
      const secondReview = await H.within(drawer).findByRole("region", { name: /Memory consolidation review/i });
      H.fireEvent.click(H.within(secondReview).getByRole("button", { name: /Apply consolidation/i }));
      await H.waitFor(() => expect(H.within(drawer).queryByText(/Original detail 1/i)).not.toBeInTheDocument());
      expect(H.within(drawer).getByText(/Condensed detail/i)).toBeInTheDocument();

      persisted = JSON.parse(window.localStorage.getItem(H.RUNTIME_STORAGE_KEY) ?? "{}") as {
        cards?: Array<{ memory?: unknown[] }>;
      };
      expect(persisted.cards?.[0]?.memory).toHaveLength(1);
      expect(consolidationSpy).toHaveBeenCalledTimes(2);
    } finally {
      consolidationSpy.mockRestore();
    }
  });

  it("clears the current story roster back to the player placeholder and persists the cleanup", async () => {
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
            characterName: "",
            characterDescription: "",
            scenario: "",
            greeting: "",
            exampleDialogs: "",
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
                name: "Nia",
                kind: "player",
                summary: "A careful cartographer.",
                knownFacts: [],
                doesNotKnow: [],
                notes: [],
              },
              {
                id: "story_entity_rook",
                name: "Rook",
                kind: "character",
                summary: "A contact in the alley.",
                knownFacts: [],
                doesNotKnow: [],
                notes: [],
              },
            ],
            rpg: {
              location: "Rainy alley",
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
            id: "chat-clear-roster",
            cardId: "card_blank_slate_rpg",
            title: "Clear roster",
            createdAt: "2026-07-01T00:00:00.000Z",
            updatedAt: "2026-07-01T00:00:00.000Z",
            messages: [],
          },
        ],
        activeChatIds: {
          card_blank_slate_rpg: "chat-clear-roster",
        },
        promptRuns: [],
        providerKeyStatus: "No plaintext keys stored.",
        savedAt: "2026-07-01T00:00:00.000Z",
      }),
    );
    await H.renderApp();

    H.openBlankRpgCard();
    H.openMediaTab(/^Characters$/i);
    const charactersPanel = H.screen.getByRole("region", { name: /Story characters/i });
    expect(H.within(charactersPanel).getByLabelText(/Character portrait for Nia/i)).toBeInTheDocument();
    expect(H.within(charactersPanel).getByLabelText(/Character portrait for Rook/i)).toBeInTheDocument();

    H.fireEvent.click(H.within(charactersPanel).getByRole("button", { name: /Clear tracked characters/i }));

    expect(H.within(charactersPanel).getByLabelText(/Character portrait for Player Character/i)).toBeInTheDocument();
    expect(H.within(charactersPanel).queryByLabelText(/Character portrait for Nia/i)).not.toBeInTheDocument();
    expect(H.within(charactersPanel).queryByLabelText(/Character portrait for Rook/i)).not.toBeInTheDocument();
    await H.waitFor(() => {
      const snapshot = JSON.parse(window.localStorage.getItem(H.RUNTIME_STORAGE_KEY) ?? "{}") as {
        cards?: Array<{ id?: string; storyEntities?: Array<{ name?: string; kind?: string }> }>;
      };
      const blankCard = snapshot.cards?.find((card) => card.id === "card_blank_slate_rpg");
      expect(blankCard?.storyEntities).toEqual([
        expect.objectContaining({
          name: "Player Character",
          kind: "player",
        }),
      ]);
    });
  });

  it("opens an existing saved card directly in the editor", async () => {
    await H.renderApp();

    H.openCards();
    const cardLibrary = H.screen.getByRole("region", { name: /Card library/i });
    const blankRow = H.within(cardLibrary).getByText("Blank Slate RPG").closest(".card-row") as HTMLElement;
    H.fireEvent.click(H.within(blankRow).getByRole("button", { name: /^Edit$/i }));

    const editor = H.screen.getByRole("region", { name: /Selected card editor/i });
    expect(H.within(editor).getByRole("heading", { name: /Edit Selected Card/i })).toBeInTheDocument();
    const summary = H.within(editor).getByLabelText(/^Summary$/i);
    H.fireEvent.change(summary, { target: { value: "Edited existing RPG card." } });

    H.openCards();
    expect(H.within(cardLibrary).getByText("Edited existing RPG card.")).toBeInTheDocument();
  });

  it("toggles dark mode and enforces editable RPG player rules on the blank RPG card", async () => {
    const { container } = await H.renderApp();

    expect(container.querySelector(".app-shell.dark")).toBeInTheDocument();
    H.fireEvent.click(H.screen.getByRole("button", { name: /Light mode/i }));
    expect(container.querySelector(".app-shell.light")).toBeInTheDocument();

    H.openCardEditorTab(/rules/i);
    expect(H.screen.getByDisplayValue(/Health must matter/i)).toBeInTheDocument();
    expect(H.screen.getByDisplayValue(/Inventory must matter/i)).toBeInTheDocument();
    expect(H.screen.getByDisplayValue(/Character capability limits/i)).toBeInTheDocument();
    H.fireEvent.click(H.screen.getByLabelText(/No free items, allies, or exits enabled/i));

    H.fireEvent.click(H.screen.getByRole("tab", { name: /rpg/i }));
    const rpgPanel = H.screen.getByRole("region", { name: /RPG state/i });
    expect(H.within(rpgPanel).getByText(/not configured/i)).toBeInTheDocument();
    expect(H.within(rpgPanel).getByText(/No quests configured/i)).toBeInTheDocument();

    H.fireEvent.click(H.screen.getByRole("button", { name: /^Runtime$/i }));
    H.sendRuntimeMessage("I create infinite gold and a legendary sword.");
    expect(H.screen.queryByText(/Blocked by this RPG card/i)).not.toBeInTheDocument();
    await H.waitFor(() => expect(H.screen.getByRole("log", { name: /Chat transcript/i })).toHaveTextContent(/The action is checked/i));
  });

  it("edits RPG card instructions, state, rules, and lorebook settings through the card editor", async () => {
    window.localStorage.setItem(
      H.RUNTIME_STORAGE_KEY,
      JSON.stringify({
        version: 2,
        theme: "dark",
        activeCardId: "",
        cards: [
          {
            id: "card_blank_slate_rpg",
            name: "Blank Slate RPG",
            kind: "rpg",
            summary: "test",
            characterName: "",
            characterDescription: "",
            scenario: "",
            greeting: "",
            exampleDialogs: "",
            systemPrompt: "test",
            preHistoryInstructions: "",
            postHistoryInstructions: "",
            playerRules: [
              {
                id: "rule_existing",
                title: "Existing rule",
                description: "Existing description",
                enforcement: "block_action",
                enabled: true,
              },
            ],
            lorebooks: [
              {
                id: "lore_existing",
                name: "Existing Lore",
                enabled: true,
                scanDepth: 4,
                tokenBudget: 800,
                recursiveScanning: false,
                entries: [
                  {
                    id: "entry_existing",
                    title: "Existing Entry",
                    keys: ["existing"],
                    secondaryKeys: [],
                    content: "Existing content.",
                    insertionOrder: 100,
                    priority: 0,
                    enabled: true,
                    constant: false,
                    probability: 100,
                    caseSensitive: false,
                    wholeWord: false,
                  },
                ],
              },
            ],
            memory: [],
            mapEnabled: true,
            storyEntities: [],
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
            id: "chat-editor",
            cardId: "card_blank_slate_rpg",
            title: "Editor chat",
            createdAt: "2026-07-01T00:00:00.000Z",
            updatedAt: "2026-07-01T00:00:00.000Z",
            messages: [],
          },
        ],
        activeChatIds: {
          card_blank_slate_rpg: "chat-editor",
        },
        promptRuns: [],
        providerKeyStatus: "No plaintext keys stored.",
        savedAt: "2026-07-01T00:00:00.000Z",
      }),
    );

    await H.renderApp();
    H.fireEvent.click(H.screen.getByRole("button", { name: /Open card library/i }));
    expect(H.screen.getByRole("region", { name: /Card library/i })).toBeInTheDocument();
    H.openBlankRpgCard();

    H.openCardEditorTab(/instructions/i);
    const instructions = H.screen.getByRole("region", { name: /Card instructions/i });
    H.fireEvent.change(H.within(instructions).getByLabelText(/^Name$/i), { target: { value: "Edited RPG" } });
    H.fireEvent.change(H.within(instructions).getByLabelText(/^Summary$/i), { target: { value: "Edited summary" } });
    H.fireEvent.click(H.within(instructions).getByLabelText(/Show map\/image panel/i));
    H.fireEvent.change(H.within(instructions).getByLabelText(/^Character name$/i), { target: { value: "Rook" } });
    H.fireEvent.change(H.within(instructions).getByLabelText(/^Greeting$/i), { target: { value: "Hello there." } });
    H.fireEvent.change(H.within(instructions).getByLabelText(/^Description$/i), { target: { value: "A careful narrator." } });
    H.fireEvent.change(H.within(instructions).getByLabelText(/^Scenario$/i), { target: { value: "A cold bridge." } });
    H.fireEvent.change(H.within(instructions).getByLabelText(/^Example dialogs$/i), { target: { value: "Example line." } });
    H.fireEvent.change(H.within(instructions).getByLabelText(/In-depth character definition/i), {
      target: { value: "Updated system prompt." },
    });
    H.fireEvent.change(H.within(instructions).getByLabelText(/^Pre-history instructions$/i), {
      target: { value: "Updated pre." },
    });
    H.fireEvent.change(H.within(instructions).getByLabelText(/^Post-history instructions$/i), {
      target: { value: "Updated post." },
    });

    H.fireEvent.click(H.screen.getByRole("tab", { name: /rules/i }));
    const rulesPanel = H.screen.getByRole("region", { name: /Card rules/i });
    H.fireEvent.click(H.within(rulesPanel).getByRole("button", { name: /Add player rule/i }));
    expect(H.within(rulesPanel).queryByDisplayValue("Custom player rule")).not.toBeInTheDocument();
    H.fireEvent.click(H.within(rulesPanel).getByLabelText(/Existing rule enabled/i));
    H.fireEvent.change(H.within(rulesPanel).getByDisplayValue("Existing rule"), {
      target: { value: "Edited rule" },
    });
    H.fireEvent.change(H.within(rulesPanel).getByDisplayValue("Existing description"), {
      target: { value: "Edited enforcement" },
    });
    H.fireEvent.change(H.within(rulesPanel).getByLabelText(/^Rule title$/i), {
      target: { value: "New rule" },
    });
    const enforcementFields = H.within(rulesPanel).getAllByLabelText(/^Card enforcement text$/i);
    H.fireEvent.change(enforcementFields[enforcementFields.length - 1]!, {
      target: { value: "New enforcement" },
    });
    H.fireEvent.click(H.within(rulesPanel).getByRole("button", { name: /Add player rule/i }));
    expect(H.within(rulesPanel).getByDisplayValue("New rule")).toBeInTheDocument();

    H.fireEvent.click(H.screen.getByRole("tab", { name: /rpg/i }));
    const rpgPanel = H.screen.getByRole("region", { name: /RPG state/i });
    H.fireEvent.change(H.within(rpgPanel).getByLabelText(/^Location$/i), { target: { value: "North road" } });
    H.fireEvent.change(H.within(rpgPanel).getByLabelText(/Health or status/i), { target: { value: "winded" } });
    H.fireEvent.change(H.within(rpgPanel).getByLabelText(/^Inventory$/i), { target: { value: "rope\nlantern" } });
    H.fireEvent.change(H.within(rpgPanel).getByLabelText(/^Quests$/i), { target: { value: "Find shelter" } });
    H.fireEvent.change(H.within(rpgPanel).getByLabelText(/^Known places$/i), { target: { value: "North road" } });
    H.fireEvent.change(H.within(rpgPanel).getByLabelText(/^World flags$/i), {
      target: { value: "gate_open=true\nhidden=false" },
    });
    expect(H.within(rpgPanel).getByText("gate_open")).toBeInTheDocument();

    H.fireEvent.click(H.screen.getByRole("tab", { name: /lorebooks/i }));
    const lorePanel = H.screen.getByRole("region", { name: /^Lorebooks$/i });
    H.fireEvent.change(H.within(lorePanel).getByLabelText(/^Lorebook name$/i), {
      target: { value: "Edited Lore" },
    });
    H.fireEvent.change(H.within(lorePanel).getByLabelText(/^Scan depth$/i), { target: { value: "6" } });
    H.fireEvent.change(H.within(lorePanel).getByLabelText(/^Token budget$/i), { target: { value: "1200" } });
    H.fireEvent.click(H.within(lorePanel).getByLabelText(/^Enabled$/i));
    H.fireEvent.click(H.within(lorePanel).getByLabelText(/^Recursive scanning$/i));
    H.fireEvent.change(H.within(lorePanel).getByLabelText(/^Entry title$/i), { target: { value: "Gate" } });
    H.fireEvent.change(H.within(lorePanel).getByLabelText(/^Primary keys$/i), { target: { value: "gate" } });
    H.fireEvent.change(H.within(lorePanel).getByLabelText(/^Secondary keys$/i), { target: { value: "moon" } });
    H.fireEvent.change(H.within(lorePanel).getByLabelText(/^Insertion order$/i), { target: { value: "9" } });
    H.fireEvent.change(H.within(lorePanel).getByLabelText(/^Priority$/i), { target: { value: "3" } });
    H.fireEvent.change(H.within(lorePanel).getByLabelText(/^Probability$/i), { target: { value: "75" } });
    H.fireEvent.click(H.within(lorePanel).getByLabelText(/^Constant entry$/i));
    H.fireEvent.change(H.within(lorePanel).getByLabelText(/^Entry content$/i), {
      target: { value: "The gate opens at moonrise." },
    });
    H.fireEvent.click(H.within(lorePanel).getByRole("button", { name: /Add lorebook entry/i }));
    H.fireEvent.change(H.within(lorePanel).getByLabelText(/^Search lorebook entries$/i), {
      target: { value: "gate" },
    });
    H.fireEvent.change(H.within(lorePanel).getByLabelText(/^Lorebook source$/i), {
      target: { value: "chub-compatible" },
    });

    await H.waitFor(() => {
      const snapshot = JSON.parse(window.localStorage.getItem(H.RUNTIME_STORAGE_KEY) ?? "{}") as {
        cards?: Array<{
          name?: string;
          rpg?: { location?: string; flags?: Record<string, boolean> };
          lorebooks?: Array<{ name?: string; scanDepth?: number; tokenBudget?: number; recursiveScanning?: boolean }>;
        }>;
      };
      const card = snapshot.cards?.[0];
      expect(card?.name).toBe("Edited RPG");
      expect(card?.rpg?.location).toBe("North road");
      expect(card?.rpg?.flags).toMatchObject({ gate_open: true, hidden: false });
      expect(card?.lorebooks?.[0]).toMatchObject({
        name: "Edited Lore",
        scanDepth: 6,
        tokenBudget: 1200,
        recursiveScanning: true,
      });
    });
  });
});
