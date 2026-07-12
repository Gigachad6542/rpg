import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { App } from "../../src/app/App";
import { RUNTIME_STORAGE_KEY } from "../../src/app/localRuntimeStore";
import { LOCAL_RESTORE_POINTS_KEY } from "../../src/app/localRestorePointStore";
import { buildVersionedRuntimeExport } from "../../src/app/runtimeDataBundle";
import * as memoryConsolidation from "../../src/runtime/memoryConsolidation";
import * as providerConfig from "../../src/app/providerConfig";
import type {
  ModelInfo,
  TextGenerationRequest,
  TextGenerationResponse,
  TextModelAdapter,
} from "../../src/providers/TextModelAdapter";

type TauriInvokeMock = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

const tauriInvokeMock = vi.hoisted(() =>
  vi.fn<TauriInvokeMock>(async () => {
    throw new Error("Tauri unavailable");
  }),
);

vi.mock("@tauri-apps/api/core", () => ({
  invoke: tauriInvokeMock,
}));

function openCards() {
  fireEvent.click(screen.getByRole("button", { name: /^Cards$/i }));
}

function startCreatingCard() {
  openCards();
  const createCardPanel = screen.getByRole("region", { name: /Create card/i });
  fireEvent.click(within(createCardPanel).getByRole("button", { name: /Start creating card/i }));
  return createCardPanel;
}

function openBlankRpgCard() {
  openCards();
  const cardLibrary = screen.getByRole("region", { name: /Card library/i });
  fireEvent.click(within(cardLibrary).getByRole("button", { name: /^Open$/i }));
}

function openCardEditorTab(name: RegExp) {
  openCards();
  if (!screen.queryByRole("tab", { name })) {
    openBlankRpgCard();
    openCards();
  }
  fireEvent.click(screen.getByRole("tab", { name }));
}

function openMediaTab(name: RegExp): void {
  // Media sections (aerial image, characters, image) are always visible now;
  // the tab-shortcut bar was removed, so this is a no-op kept for readability.
  void name;
}

function sendRuntimeMessage(message: string) {
  if (!screen.queryByLabelText(/Message input/i)) {
    openBlankRpgCard();
  }
  fireEvent.change(screen.getByLabelText(/Message input/i), { target: { value: message } });
  fireEvent.click(screen.getByRole("button", { name: /^Send$/i }));
}

async function renderApp() {
  const result = render(<App />);
  await screen.findByText(/Repository API ready|SQLite repository ready|Repository unavailable/i);
  return result;
}

function seedRuntimeSnapshot(snapshotOverrides: Record<string, unknown> = {}, cardOverrides: Record<string, unknown> = {}) {
  const cardId = typeof cardOverrides.id === "string" ? cardOverrides.id : "card_blank_slate_rpg";
  const chatId = "chat_seeded";
  const card = {
    id: cardId,
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
    ...cardOverrides,
  };

  window.localStorage.setItem(
    RUNTIME_STORAGE_KEY,
    JSON.stringify({
      version: 2,
      theme: "dark",
      activeCardId: cardId,
      cards: [card],
      messages: [],
      chatSessions: [
        {
          id: chatId,
          cardId,
          title: "Seeded chat",
          createdAt: "2026-07-01T00:00:00.000Z",
          updatedAt: "2026-07-01T00:00:00.000Z",
          messages: [],
        },
      ],
      activeChatIds: {
        [cardId]: chatId,
      },
      promptRuns: [],
      providerKeyStatus: "No plaintext keys stored.",
      savedAt: "2026-07-01T00:00:00.000Z",
      ...snapshotOverrides,
    }),
  );
}

function captureJsonDownloads() {
  const previousCreateObjectURL = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
  const previousRevokeObjectURL = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");
  const createObjectUrl = vi.fn(() => "blob:rpg-test");
  const revokeObjectUrl = vi.fn();
  const clickedDownloads: string[] = [];
  const originalCreateElement = document.createElement.bind(document);
  const createElementSpy = vi.spyOn(document, "createElement").mockImplementation(
    (tagName: string, options?: ElementCreationOptions) => {
      const element = originalCreateElement(tagName, options);
      if (tagName.toLowerCase() === "a") {
        vi.spyOn(element as HTMLAnchorElement, "click").mockImplementation(function click(this: HTMLAnchorElement) {
          clickedDownloads.push(this.download);
        });
      }
      return element;
    },
  );

  Object.defineProperty(URL, "createObjectURL", {
    value: createObjectUrl,
    configurable: true,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    value: revokeObjectUrl,
    configurable: true,
  });

  return {
    clickedDownloads,
    createObjectUrl,
    revokeObjectUrl,
    restore() {
      createElementSpy.mockRestore();
      if (previousCreateObjectURL) {
        Object.defineProperty(URL, "createObjectURL", previousCreateObjectURL);
      } else {
        delete (URL as { createObjectURL?: unknown }).createObjectURL;
      }
      if (previousRevokeObjectURL) {
        Object.defineProperty(URL, "revokeObjectURL", previousRevokeObjectURL);
      } else {
        delete (URL as { revokeObjectURL?: unknown }).revokeObjectURL;
      }
    },
  };
}

describe("local-first card runtime UI", () => {
  it("starts from one blank RPG card and keeps memory out of the open", async () => {
    await renderApp();

    expect(screen.getByRole("heading", { name: /Open a saved card/i })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /Story workspace/i })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /No active card/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Characters$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: /Memory inspector/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /RPG state/i })).not.toBeInTheDocument();

    openCards();
    const cardLibrary = screen.getByRole("region", { name: /Card library/i });
    expect(within(cardLibrary).getByText(/Blank Slate RPG/i)).toBeInTheDocument();
    expect(cardLibrary.querySelector(".compact-card-list")).toBeInTheDocument();
    expect(within(cardLibrary).getByRole("button", { name: /Delete/i })).toBeDisabled();
    expect(screen.queryByText(/0 runs/i)).not.toBeInTheDocument();
    const createCardPanel = screen.getByRole("region", { name: /Create card/i });
    expect(within(createCardPanel).queryByLabelText(/^Name$/i)).not.toBeInTheDocument();
    expect(within(createCardPanel).getByRole("button", { name: /Start creating card/i })).toBeInTheDocument();

    fireEvent.click(within(cardLibrary).getByRole("button", { name: /^Open$/i }));
    expect(screen.getByRole("heading", { name: /Blank Slate RPG/i })).toBeInTheDocument();
    openCardEditorTab(/lorebooks/i);
    expect(screen.getByLabelText(/^Lorebook$/i)).toHaveValue("");
    expect(screen.queryByText(/Blank RPG Lorebook/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Inspect memory/i }));
    expect(screen.getByRole("dialog", { name: /Memory inspector/i })).toBeInTheDocument();
  });

  it("renders assistant emphasis and scene status without raw markdown clutter", async () => {
    window.localStorage.setItem(
      RUNTIME_STORAGE_KEY,
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
    const { container } = await renderApp();

    openBlankRpgCard();
    const transcript = screen.getByRole("log", { name: /Chat transcript/i });
    expect(within(transcript).getByText(/You hear "wind over grass"/i)).toBeInTheDocument();
    expect(within(transcript).queryByText(/```status/i)).not.toBeInTheDocument();
    expect(within(transcript).queryByText(/Current Date:/i)).not.toBeInTheDocument();
    expect(container.querySelector(".message-paragraph strong")).toHaveTextContent("SUCCESS");
    expect(container.querySelector(".message-aside")).toHaveTextContent("the plain opens around you.");

    const status = within(transcript).getByLabelText(/Scene status/i);
    expect(status).toHaveTextContent("Current Date");
    expect(status).toHaveTextContent("March 15, 2023");
    expect(status).toHaveTextContent("Current Time");
    expect(status).toHaveTextContent("22:47");
    expect(status).toHaveTextContent("Location");
    expect(status).toHaveTextContent("Unmapped starting area");
  });

  it("creates a user card with card-local pre-history, post-history, and rules", async () => {
    await renderApp();

    const createCardPanel = startCreatingCard();
    fireEvent.change(within(createCardPanel).getByLabelText(/^Name$/i), { target: { value: "Detective Card" } });
    fireEvent.change(within(createCardPanel).getByLabelText(/System prompt/i), {
      target: { value: "Run a quiet detective character." },
    });
    fireEvent.change(within(createCardPanel).getByLabelText(/Pre-history instructions/i), {
      target: { value: "Apply noir continuity before chat history." },
    });
    fireEvent.change(within(createCardPanel).getByLabelText(/Post-history instructions/i), {
      target: { value: "After chat history, ask one grounded follow-up." },
    });
    fireEvent.change(within(createCardPanel).getByLabelText(/Player rules/i), {
      target: { value: "No supernatural clues unless established." },
    });
    fireEvent.click(within(createCardPanel).getByRole("button", { name: /^Create card$/i }));

    expect(screen.getByRole("heading", { name: /Detective Card/i })).toBeInTheDocument();
    openCards();
    fireEvent.click(screen.getByRole("tab", { name: /instructions/i }));
    expect(screen.getByDisplayValue(/Apply noir continuity before chat history/i)).toBeInTheDocument();
    expect(screen.getByDisplayValue(/After chat history, ask one grounded follow-up/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /rules/i }));
    const rulesPanel = screen.getByRole("region", { name: /Card rules/i });
    expect(within(rulesPanel).getAllByDisplayValue(/No supernatural clues unless established/i)).not.toHaveLength(0);
    expect(within(rulesPanel).getByLabelText(/Prompt debugger/i)).toHaveTextContent(/Pre-history instructions/i);
    expect(within(rulesPanel).getByLabelText(/Prompt debugger/i)).toHaveTextContent(/Post-history instructions/i);
  });

  it("creates an RPG card from the full creation draft fields", async () => {
    window.localStorage.clear();
    const { unmount } = await renderApp();

    const createCardPanel = startCreatingCard();
    fireEvent.change(within(createCardPanel).getByLabelText(/^Name$/i), { target: { value: "Harbor RPG" } });
    fireEvent.change(within(createCardPanel).getByLabelText(/Card type/i), { target: { value: "rpg" } });
    fireEvent.click(within(createCardPanel).getByLabelText(/Enable map\/image panel/i));
    fireEvent.change(within(createCardPanel).getByLabelText(/^Summary$/i), {
      target: { value: "A dockside mystery campaign." },
    });
    fireEvent.change(within(createCardPanel).getByLabelText(/Character name/i), {
      target: { value: "Mira Vale" },
    });
    fireEvent.change(within(createCardPanel).getByLabelText(/^Description$/i), {
      target: { value: "A practical harbor guide." },
    });
    fireEvent.change(within(createCardPanel).getByLabelText(/^Scenario$/i), {
      target: { value: "Fog covers the old pier." },
    });
    fireEvent.change(within(createCardPanel).getByLabelText(/^Greeting$/i), {
      target: { value: "The tide is low. What do you do?" },
    });
    fireEvent.change(within(createCardPanel).getByLabelText(/Example dialogs/i), {
      target: { value: "User: I inspect the pier.\nMira: The boards creak." },
    });
    fireEvent.change(within(createCardPanel).getByLabelText(/System prompt/i), {
      target: { value: "Run the harbor as an RPG." },
    });
    fireEvent.change(within(createCardPanel).getByLabelText(/Lorebook name/i), {
      target: { value: "Harbor Lore" },
    });
    fireEvent.click(within(createCardPanel).getByRole("button", { name: /^Create card$/i }));

    expect(screen.getByRole("heading", { name: /Harbor RPG/i })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: /Image and story tools/i })).not.toBeInTheDocument();

    openCards();
    expect(screen.getByDisplayValue("A dockside mystery campaign.")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Mira Vale")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Fog covers the old pier.")).toBeInTheDocument();

    openCardEditorTab(/lorebooks/i);
    expect(screen.getByLabelText(/^Lorebook$/i)).toHaveDisplayValue("Harbor Lore");

    unmount();
    window.localStorage.clear();
  });

  it("shows the card greeting as a non-persisted opening before the user sends a message", async () => {
    await renderApp();

    const createCardPanel = startCreatingCard();
    fireEvent.change(within(createCardPanel).getByLabelText(/^Name$/i), { target: { value: "Gatekeeper Card" } });
    fireEvent.change(within(createCardPanel).getByLabelText(/^Greeting$/i), {
      target: { value: "The gatekeeper raises a lantern before you can speak." },
    });
    fireEvent.click(within(createCardPanel).getByRole("button", { name: /^Create card$/i }));

    const transcript = screen.getByRole("log", { name: /Chat transcript/i });
    expect(within(transcript).getByText(/gatekeeper raises a lantern/i)).toBeInTheDocument();
    expect(within(transcript).queryByText(/Empty chat/i)).not.toBeInTheDocument();
    expect(within(transcript).queryByText(/^I answer the gatekeeper/i)).not.toBeInTheDocument();
    expect(within(transcript).getByLabelText(/Card opening/i)).toHaveClass("message", "response");

    await waitFor(() => {
      const snapshot = JSON.parse(window.localStorage.getItem(RUNTIME_STORAGE_KEY) ?? "{}") as {
        chatSessions?: Array<{ cardId?: string; messages?: Array<{ content?: string }> }>;
      };
      const gatekeeperChat = snapshot.chatSessions?.find((chat) => chat.cardId && chat.cardId !== "card_blank_slate_rpg");
      expect(gatekeeperChat?.messages ?? []).toEqual([]);
    });

    sendRuntimeMessage("I answer the gatekeeper.");

    await waitFor(() => expect(within(transcript).getByText("I answer the gatekeeper.")).toBeInTheDocument());
    expect(within(transcript).getAllByText(/gatekeeper raises a lantern/i)).toHaveLength(1);
  });

  it("shows a non-persisted opening for the blank RPG even without a configured greeting", async () => {
    await renderApp();

    openBlankRpgCard();

    const transcript = screen.getByRole("log", { name: /Chat transcript/i });
    expect(within(transcript).getByLabelText(/Card opening/i)).toHaveClass("message", "response");
    expect(within(transcript).getByText(/Describe your character, their surroundings, and what they are doing/i)).toBeInTheDocument();
    expect(within(transcript).queryByRole("region", { name: /Empty chat/i })).not.toBeInTheDocument();

    await waitFor(() => {
      const snapshot = JSON.parse(window.localStorage.getItem(RUNTIME_STORAGE_KEY) ?? "{}") as {
        chatSessions?: Array<{ cardId?: string; messages?: Array<{ content?: string }> }>;
      };
      const blankChat = snapshot.chatSessions?.find((chat) => chat.cardId === "card_blank_slate_rpg");
      expect(blankChat?.messages ?? []).toEqual([]);
    });
  });

  it("uses a blank send as a random opening without saving an empty user message", async () => {
    await renderApp();

    openBlankRpgCard();
    const transcript = screen.getByRole("log", { name: /Chat transcript/i });
    fireEvent.click(screen.getByRole("button", { name: /^Send$/i }));

    await waitFor(() => expect(within(transcript).getByText(/come to yourself at the edge/i)).toBeInTheDocument());
    expect(within(transcript).queryByText(/^Surprise me with a random opening scene\.$/i)).not.toBeInTheDocument();
    expect(within(transcript).queryByText(/^You$/i)).not.toBeInTheDocument();

    await waitFor(() => {
      const snapshot = JSON.parse(window.localStorage.getItem(RUNTIME_STORAGE_KEY) ?? "{}") as {
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
    await renderApp();

    openBlankRpgCard();
    sendRuntimeMessage("I teleport through walls and skip to the end.");

    await screen.findByText(/Blocked by this RPG card: movement must stay plausible/i);
    expect(screen.getByRole("log", { name: /Chat transcript/i })).not.toHaveTextContent(/teleport through walls/i);
  });

  it("lets the player stop an in-flight turn before it commits messages or state", async () => {
    const requests: TextGenerationRequest[] = [];
    const adapter: TextModelAdapter = {
      id: "abortable",
      displayName: "Abortable provider",
      async listModels(): Promise<ModelInfo[]> {
        return [];
      },
      async generateText(request: TextGenerationRequest): Promise<TextGenerationResponse> {
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
    const providerSpy = vi
      .spyOn(providerConfig, "createTextProvider")
      .mockReturnValue(adapter as ReturnType<typeof providerConfig.createTextProvider>);

    try {
      await renderApp();
      openBlankRpgCard();
      sendRuntimeMessage("I inspect the unfinished corridor.");

      const stop = await screen.findByRole("button", { name: /Stop generation/i });
      expect(requests[0]?.signal).toBeInstanceOf(AbortSignal);
      fireEvent.click(stop);

      await screen.findByText(/Generation stopped/i);
      expect(screen.queryByRole("button", { name: /Stop generation/i })).not.toBeInTheDocument();
      expect(screen.getByRole("log", { name: /Chat transcript/i })).not.toHaveTextContent(
        /unfinished corridor/i,
      );
    } finally {
      providerSpy.mockRestore();
    }
  });

  it("disables a regex lore entry when isolated matching cannot complete", async () => {
    seedRuntimeSnapshot(
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
    await renderApp();
    openBlankRpgCard();
    sendRuntimeMessage("I inspect the gate.");

    await screen.findByText(/Disabled 1 lore regex entry/i);
    await waitFor(() => {
      const snapshot = JSON.parse(window.localStorage.getItem(RUNTIME_STORAGE_KEY) ?? "{}") as {
        cards?: Array<{ lorebooks?: Array<{ entries?: Array<{ id?: string; enabled?: boolean }> }> }>;
      };
      const entry = snapshot.cards?.[0]?.lorebooks?.[0]?.entries?.find((item) => item.id === "regex-entry");
      expect(entry?.enabled).toBe(false);
    });
  });

  it("runs hidden continuity before the visible turn, persists characters, and keeps details collapsed", async () => {
    const { unmount } = await renderApp();

    openBlankRpgCard();
    expect(screen.getByRole("region", { name: /Aerial image generator/i })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /Story characters/i })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /^Image generator$/i })).toBeInTheDocument();

    sendRuntimeMessage(
      "I am Nia, a careful cartographer in a rainy alley beside Rook. Rook does not know about the silver coin hidden in my boot.",
    );

    const transcript = screen.getByRole("log", { name: /Chat transcript/i });
    await waitFor(() => expect(transcript).toHaveTextContent(/I am Nia, a careful cartographer/i));
    expect(transcript).not.toHaveTextContent(/Private continuity context/i);
    expect(transcript).not.toHaveTextContent(/hidden continuity/i);

    openMediaTab(/^Characters$/i);
    const charactersPanel = screen.getByRole("region", { name: /Story characters/i });
    expect(within(charactersPanel).getAllByLabelText(/Character portrait for/i).length).toBeGreaterThanOrEqual(2);
    expect(within(charactersPanel).getByLabelText(/Character portrait for Nia/i)).toBeInTheDocument();
    expect(within(charactersPanel).getByLabelText(/Character portrait for Rook/i)).toBeInTheDocument();
    await waitFor(() =>
      expect(within(charactersPanel).getByLabelText(/Character portrait for Nia/i)).toHaveTextContent(
        /Portrait prompt ready|Portrait generated/i,
      ),
    );
    expect(within(charactersPanel).getByLabelText(/Character portrait for Rook/i)).toHaveTextContent(
      /Portrait prompt ready|Portrait generated/i,
    );
    expect(within(charactersPanel).queryByText(/Does not know/i)).not.toBeInTheDocument();
    expect(within(charactersPanel).queryByText(/silver coin hidden in my boot/i)).not.toBeInTheDocument();
    const rookCard = within(charactersPanel).getByLabelText(/Character portrait for Rook/i).closest(".story-entity-item");
    expect(rookCard).not.toBeNull();
    fireEvent.click(within(rookCard as HTMLElement).getByRole("button", { name: /Show details for Rook/i }));
    expect(within(rookCard as HTMLElement).getByText(/Does not know/i)).toBeInTheDocument();
    expect(within(rookCard as HTMLElement).getByText(/silver coin hidden in my boot/i)).toBeInTheDocument();
    expect(within(rookCard as HTMLElement).queryByText(/Notes/i)).not.toBeInTheDocument();

    await waitFor(() => {
      const snapshot = JSON.parse(window.localStorage.getItem(RUNTIME_STORAGE_KEY) ?? "{}") as {
        cards?: Array<{
          id?: string;
          memory?: Array<{ detail?: string }>;
          storyEntities?: Array<{ name?: string; kind?: string; doesNotKnow?: string[] }>;
        }>;
        generatedMaps?: Array<{
          imageKind?: string;
          subjectName?: string;
          prompt?: string;
        }>;
        chatSessions?: Array<{ cardId?: string; messages?: Array<{ role?: string; content?: string }> }>;
      };
      const blankCard = snapshot.cards?.find((card) => card.id === "card_blank_slate_rpg");
      expect(blankCard?.memory?.some((memory) => /Nia/i.test(memory.detail ?? ""))).toBe(true);
      expect(blankCard?.storyEntities?.some((entity) => entity.name === "Rook" && entity.kind === "character")).toBe(true);
      const portraits = snapshot.generatedMaps?.filter((artifact) => artifact.imageKind === "character") ?? [];
      expect(portraits.map((artifact) => artifact.subjectName).sort()).toEqual(["Nia", "Rook"]);
      expect(portraits.every((artifact) => /RPG character portrait/i.test(artifact.prompt ?? ""))).toBe(true);
      expect(JSON.stringify(snapshot.chatSessions)).not.toContain("Private continuity context");
    });

    unmount();
    await renderApp();
    openBlankRpgCard();
    openMediaTab(/^Characters$/i);
    const reloadedCharactersPanel = screen.getByRole("region", { name: /Story characters/i });
    expect(within(reloadedCharactersPanel).getByLabelText(/Character portrait for Nia/i)).toBeInTheDocument();
    expect(within(reloadedCharactersPanel).getByLabelText(/Character portrait for Rook/i)).toBeInTheDocument();
    expect(within(reloadedCharactersPanel).getByLabelText(/Character portrait for Nia/i)).toHaveTextContent(/Portrait/i);
    expect(screen.getByRole("region", { name: /^Image generator$/i })).toBeInTheDocument();
  });

  it("applies grounded visible-pass knowledge updates to the story roster in the same turn", async () => {
    await renderApp();

    openBlankRpgCard();
    sendRuntimeMessage("I am Nia beside Rook. Rook learns that the north gate is open.");

    const transcript = screen.getByRole("log", { name: /Chat transcript/i });
    await waitFor(() => expect(transcript).toHaveTextContent(/north gate is open/i));

    openMediaTab(/^Characters$/i);
    const charactersPanel = screen.getByRole("region", { name: /Story characters/i });
    const rookCard = within(charactersPanel).getByLabelText(/Character portrait for Rook/i).closest(".story-entity-item");
    expect(rookCard).not.toBeNull();
    fireEvent.click(within(rookCard as HTMLElement).getByRole("button", { name: /Show details for Rook/i }));
    expect(within(rookCard as HTMLElement).getByText(/^Knows$/)).toBeInTheDocument();
    expect(within(rookCard as HTMLElement).getByText(/the north gate is open/i)).toBeInTheDocument();

    await waitFor(() => {
      const snapshot = JSON.parse(window.localStorage.getItem(RUNTIME_STORAGE_KEY) ?? "{}") as {
        cards?: Array<{ id?: string; storyEntities?: Array<{ name?: string; knownFacts?: string[] }> }>;
      };
      const blankCard = snapshot.cards?.find((card) => card.id === "card_blank_slate_rpg");
      const rook = blankCard?.storyEntities?.find((entity) => entity.name === "Rook");
      expect(rook?.knownFacts ?? []).toEqual(expect.arrayContaining([expect.stringMatching(/north gate is open/i)]));
    });
  });

  it("lets the user edit a character portrait prompt and regenerate the portrait", async () => {
    await renderApp();

    openBlankRpgCard();
    sendRuntimeMessage("I am Nia, a careful cartographer in a rainy alley beside Rook.");

    const transcript = screen.getByRole("log", { name: /Chat transcript/i });
    await waitFor(() => expect(transcript).toHaveTextContent(/I am Nia/i));

    openMediaTab(/^Characters$/i);
    const charactersPanel = screen.getByRole("region", { name: /Story characters/i });
    const rookCard = within(charactersPanel).getByLabelText(/Character portrait for Rook/i).closest(".story-entity-item");
    expect(rookCard).not.toBeNull();
    fireEvent.click(within(rookCard as HTMLElement).getByRole("button", { name: /Show details for Rook/i }));

    const promptField = within(rookCard as HTMLElement).getByLabelText(/Portrait prompt for Rook/i);
    fireEvent.change(promptField, { target: { value: "Custom Rook portrait, scarlet cloak, harbor light" } });
    fireEvent.click(within(rookCard as HTMLElement).getByRole("button", { name: /Regenerate portrait/i }));

    await waitFor(() => {
      const snapshot = JSON.parse(window.localStorage.getItem(RUNTIME_STORAGE_KEY) ?? "{}") as {
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
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
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
    vi.stubGlobal("fetch", fetchImpl);
    seedRuntimeSnapshot({
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
      await renderApp();
      fireEvent.click(screen.getByRole("button", { name: /API Keys/i }));
      const imageProviderSection = screen.getByRole("region", { name: /Image provider/i });
      await waitFor(() =>
        expect(within(imageProviderSection).getByText(/Startup check ready.*portrait-model\.safetensors/i)).toBeInTheDocument(),
      );
      fireEvent.change(within(imageProviderSection).getByLabelText(/^Steps$/i), { target: { value: "1" } });
      fireEvent.change(within(imageProviderSection).getByLabelText(/^CFG$/i), { target: { value: "1" } });

      openBlankRpgCard();
      sendRuntimeMessage("I am Nia, a careful cartographer in a rainy alley beside Rook.");

      await waitFor(() => expect(promptQueueCount).toBeGreaterThanOrEqual(2));
      expect(JSON.stringify(queuedPrompts)).toMatch(/RPG character portrait/i);

      openMediaTab(/^Characters$/i);
      const charactersPanel = screen.getByRole("region", { name: /Story characters/i });
      await waitFor(() =>
        expect(within(charactersPanel).getByLabelText(/Character portrait for Nia/i)).toHaveTextContent(
          /Portrait generated/i,
        ),
      );
      expect(within(charactersPanel).getByLabelText(/Character portrait for Rook/i)).toHaveTextContent(
        /Portrait generated/i,
      );
      expect(within(charactersPanel).getByAltText(/Nia portrait/i)).toHaveAttribute("src", expect.stringContaining("portrait-"));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("keeps saved character knowledge collapsed and omits notes from character details", async () => {
    window.localStorage.setItem(
      RUNTIME_STORAGE_KEY,
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
    await renderApp();

    openBlankRpgCard();
    openMediaTab(/^Characters$/i);
    const charactersPanel = screen.getByRole("region", { name: /Story characters/i });
    expect(within(charactersPanel).getByLabelText(/Character portrait for Nia/i)).toBeInTheDocument();
    expect(within(charactersPanel).getByLabelText(/Character portrait for Rook/i)).toBeInTheDocument();
    expect(within(charactersPanel).queryByText(/Nia carries a silver coin/i)).not.toBeInTheDocument();
    expect(within(charactersPanel).queryByText(/This NPC note should not render/i)).not.toBeInTheDocument();

    const rookCard = within(charactersPanel).getByLabelText(/Character portrait for Rook/i).closest(".story-entity-item");
    expect(rookCard).not.toBeNull();
    fireEvent.click(within(rookCard as HTMLElement).getByRole("button", { name: /Show details for Rook/i }));
    expect(within(rookCard as HTMLElement).getByText(/Rook knows Nia is nearby/i)).toBeInTheDocument();
    expect(within(rookCard as HTMLElement).getByText(/Nia carries a silver coin/i)).toBeInTheDocument();
    expect(within(rookCard as HTMLElement).queryByText(/This NPC note should not render/i)).not.toBeInTheDocument();
    expect(within(rookCard as HTMLElement).queryByText(/Notes/i)).not.toBeInTheDocument();
  });

  it("renders saved memory entries and media error placeholders", async () => {
    seedRuntimeSnapshot(
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
    await renderApp();

    openBlankRpgCard();
    fireEvent.click(screen.getByRole("button", { name: /Inspect memory/i }));
    const memoryDrawer = screen.getByRole("dialog", { name: /Memory inspector/i });
    expect(within(memoryDrawer).getByText(/Player identity/i)).toBeInTheDocument();
    expect(within(memoryDrawer).getByText(/Ari is a careful cartographer/i)).toBeInTheDocument();
    fireEvent.click(within(memoryDrawer).getByRole("button", { name: /Close memory inspector/i }));

    const mapGenerator = screen.getByRole("region", { name: /Aerial image generator/i });
    expect(within(mapGenerator).getByText(/Aerial image generation needs attention/i)).toBeInTheDocument();
    expect(within(mapGenerator).getByText(/Map generation failed/i)).toBeInTheDocument();

    openMediaTab(/^Image$/i);
    const imageGenerator = screen.getByRole("region", { name: /^Image generator$/i });
    expect(within(imageGenerator).getByText(/Image generation needs attention/i)).toBeInTheDocument();
    expect(within(imageGenerator).getByText(/Image generation failed/i)).toBeInTheDocument();

    openMediaTab(/^Characters$/i);
    const charactersPanel = screen.getByRole("region", { name: /Story characters/i });
    expect(within(charactersPanel).getByLabelText(/Character portrait for Rook/i)).toHaveTextContent(/Portrait needs attention/i);
    expect(within(charactersPanel).getByText(/Portrait generation failed/i)).toBeInTheDocument();
    const rookCard = within(charactersPanel).getByLabelText(/Character portrait for Rook/i).closest(".story-entity-item");
    expect(rookCard).not.toBeNull();
    fireEvent.click(within(rookCard as HTMLElement).getByRole("button", { name: /Show details for Rook/i }));
    expect(within(rookCard as HTMLElement).getByText(/Rook knows the old pier/i)).toBeInTheDocument();
    expect(within(rookCard as HTMLElement).getByText(/Ari carries a silver coin/i)).toBeInTheDocument();
  });

  it("previews memory consolidation and changes nothing until the user accepts", async () => {
    seedRuntimeSnapshot(
      {},
      {
        memory: Array.from({ length: 4 }, (_, index) => ({
          id: `memory-${index + 1}`,
          label: `Original fact ${index + 1}`,
          detail: `Original detail ${index + 1}`,
        })),
      },
    );
    const consolidationSpy = vi.spyOn(memoryConsolidation, "runMemoryConsolidationSafely").mockResolvedValue({
      changed: true,
      entries: [{ id: "memory-condensed", label: "Condensed fact", detail: "Condensed detail" }],
      warnings: [],
    });

    try {
      await renderApp();
      openBlankRpgCard();
      fireEvent.click(screen.getByRole("button", { name: /Inspect memory/i }));
      const drawer = screen.getByRole("dialog", { name: /Memory inspector/i });

      fireEvent.click(within(drawer).getByRole("button", { name: /Consolidate memory/i }));
      const review = await within(drawer).findByRole("region", { name: /Memory consolidation review/i });
      expect(within(review).getByText(/4 current entries/i)).toBeInTheDocument();
      expect(within(review).getByText(/1 proposed entry/i)).toBeInTheDocument();
      expect(within(review).getByText(/Condensed detail/i)).toBeInTheDocument();

      let persisted = JSON.parse(window.localStorage.getItem(RUNTIME_STORAGE_KEY) ?? "{}") as {
        cards?: Array<{ memory?: unknown[] }>;
      };
      expect(persisted.cards?.[0]?.memory).toHaveLength(4);
      expect(within(drawer).getByText(/Original detail 1/i)).toBeInTheDocument();

      fireEvent.click(within(review).getByRole("button", { name: /Cancel consolidation/i }));
      expect(within(drawer).queryByRole("region", { name: /Memory consolidation review/i })).not.toBeInTheDocument();
      expect(within(drawer).getByText(/Original detail 1/i)).toBeInTheDocument();

      fireEvent.click(within(drawer).getByRole("button", { name: /Consolidate memory/i }));
      const secondReview = await within(drawer).findByRole("region", { name: /Memory consolidation review/i });
      fireEvent.click(within(secondReview).getByRole("button", { name: /Apply consolidation/i }));
      await waitFor(() => expect(within(drawer).queryByText(/Original detail 1/i)).not.toBeInTheDocument());
      expect(within(drawer).getByText(/Condensed detail/i)).toBeInTheDocument();

      persisted = JSON.parse(window.localStorage.getItem(RUNTIME_STORAGE_KEY) ?? "{}") as {
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
      RUNTIME_STORAGE_KEY,
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
    await renderApp();

    openBlankRpgCard();
    openMediaTab(/^Characters$/i);
    const charactersPanel = screen.getByRole("region", { name: /Story characters/i });
    expect(within(charactersPanel).getByLabelText(/Character portrait for Nia/i)).toBeInTheDocument();
    expect(within(charactersPanel).getByLabelText(/Character portrait for Rook/i)).toBeInTheDocument();

    fireEvent.click(within(charactersPanel).getByRole("button", { name: /Clear tracked characters/i }));

    expect(within(charactersPanel).getByLabelText(/Character portrait for Player Character/i)).toBeInTheDocument();
    expect(within(charactersPanel).queryByLabelText(/Character portrait for Nia/i)).not.toBeInTheDocument();
    expect(within(charactersPanel).queryByLabelText(/Character portrait for Rook/i)).not.toBeInTheDocument();
    await waitFor(() => {
      const snapshot = JSON.parse(window.localStorage.getItem(RUNTIME_STORAGE_KEY) ?? "{}") as {
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
    await renderApp();

    openCards();
    const cardLibrary = screen.getByRole("region", { name: /Card library/i });
    const blankRow = within(cardLibrary).getByText("Blank Slate RPG").closest(".card-row") as HTMLElement;
    fireEvent.click(within(blankRow).getByRole("button", { name: /^Edit$/i }));

    const editor = screen.getByRole("region", { name: /Selected card editor/i });
    expect(within(editor).getByRole("heading", { name: /Edit Selected Card/i })).toBeInTheDocument();
    const summary = within(editor).getByLabelText(/^Summary$/i);
    fireEvent.change(summary, { target: { value: "Edited existing RPG card." } });

    openCards();
    expect(within(cardLibrary).getByText("Edited existing RPG card.")).toBeInTheDocument();
  });

  it("toggles dark mode and enforces editable RPG player rules on the blank RPG card", async () => {
    const { container } = await renderApp();

    expect(container.querySelector(".app-shell.dark")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Light mode/i }));
    expect(container.querySelector(".app-shell.light")).toBeInTheDocument();

    openCardEditorTab(/rules/i);
    expect(screen.getByDisplayValue(/Health must matter/i)).toBeInTheDocument();
    expect(screen.getByDisplayValue(/Inventory must matter/i)).toBeInTheDocument();
    expect(screen.getByDisplayValue(/Character capability limits/i)).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText(/No free items, allies, or exits enabled/i));

    fireEvent.click(screen.getByRole("tab", { name: /rpg/i }));
    const rpgPanel = screen.getByRole("region", { name: /RPG state/i });
    expect(within(rpgPanel).getByText(/not configured/i)).toBeInTheDocument();
    expect(within(rpgPanel).getByText(/No quests configured/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^Runtime$/i }));
    sendRuntimeMessage("I create infinite gold and a legendary sword.");
    expect(screen.queryByText(/Blocked by this RPG card/i)).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("log", { name: /Chat transcript/i })).toHaveTextContent(/The action is checked/i));
  });

  it("edits RPG card instructions, state, rules, and lorebook settings through the card editor", async () => {
    window.localStorage.setItem(
      RUNTIME_STORAGE_KEY,
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

    await renderApp();
    fireEvent.click(screen.getByRole("button", { name: /Open card library/i }));
    expect(screen.getByRole("region", { name: /Card library/i })).toBeInTheDocument();
    openBlankRpgCard();

    openCardEditorTab(/instructions/i);
    const instructions = screen.getByRole("region", { name: /Card instructions/i });
    fireEvent.change(within(instructions).getByLabelText(/^Name$/i), { target: { value: "Edited RPG" } });
    fireEvent.change(within(instructions).getByLabelText(/^Summary$/i), { target: { value: "Edited summary" } });
    fireEvent.click(within(instructions).getByLabelText(/Show map\/image panel/i));
    fireEvent.change(within(instructions).getByLabelText(/^Character name$/i), { target: { value: "Rook" } });
    fireEvent.change(within(instructions).getByLabelText(/^Greeting$/i), { target: { value: "Hello there." } });
    fireEvent.change(within(instructions).getByLabelText(/^Description$/i), { target: { value: "A careful narrator." } });
    fireEvent.change(within(instructions).getByLabelText(/^Scenario$/i), { target: { value: "A cold bridge." } });
    fireEvent.change(within(instructions).getByLabelText(/^Example dialogs$/i), { target: { value: "Example line." } });
    fireEvent.change(within(instructions).getByLabelText(/In-depth character definition/i), {
      target: { value: "Updated system prompt." },
    });
    fireEvent.change(within(instructions).getByLabelText(/^Pre-history instructions$/i), {
      target: { value: "Updated pre." },
    });
    fireEvent.change(within(instructions).getByLabelText(/^Post-history instructions$/i), {
      target: { value: "Updated post." },
    });

    fireEvent.click(screen.getByRole("tab", { name: /rules/i }));
    const rulesPanel = screen.getByRole("region", { name: /Card rules/i });
    fireEvent.click(within(rulesPanel).getByRole("button", { name: /Add player rule/i }));
    expect(within(rulesPanel).queryByDisplayValue("Custom player rule")).not.toBeInTheDocument();
    fireEvent.click(within(rulesPanel).getByLabelText(/Existing rule enabled/i));
    fireEvent.change(within(rulesPanel).getByDisplayValue("Existing rule"), {
      target: { value: "Edited rule" },
    });
    fireEvent.change(within(rulesPanel).getByDisplayValue("Existing description"), {
      target: { value: "Edited enforcement" },
    });
    fireEvent.change(within(rulesPanel).getByLabelText(/^Rule title$/i), {
      target: { value: "New rule" },
    });
    const enforcementFields = within(rulesPanel).getAllByLabelText(/^Card enforcement text$/i);
    fireEvent.change(enforcementFields[enforcementFields.length - 1]!, {
      target: { value: "New enforcement" },
    });
    fireEvent.click(within(rulesPanel).getByRole("button", { name: /Add player rule/i }));
    expect(within(rulesPanel).getByDisplayValue("New rule")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /rpg/i }));
    const rpgPanel = screen.getByRole("region", { name: /RPG state/i });
    fireEvent.change(within(rpgPanel).getByLabelText(/^Location$/i), { target: { value: "North road" } });
    fireEvent.change(within(rpgPanel).getByLabelText(/Health or status/i), { target: { value: "winded" } });
    fireEvent.change(within(rpgPanel).getByLabelText(/^Inventory$/i), { target: { value: "rope\nlantern" } });
    fireEvent.change(within(rpgPanel).getByLabelText(/^Quests$/i), { target: { value: "Find shelter" } });
    fireEvent.change(within(rpgPanel).getByLabelText(/^Known places$/i), { target: { value: "North road" } });
    fireEvent.change(within(rpgPanel).getByLabelText(/^World flags$/i), {
      target: { value: "gate_open=true\nhidden=false" },
    });
    expect(within(rpgPanel).getByText("gate_open")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /lorebooks/i }));
    const lorePanel = screen.getByRole("region", { name: /^Lorebooks$/i });
    fireEvent.change(within(lorePanel).getByLabelText(/^Lorebook name$/i), {
      target: { value: "Edited Lore" },
    });
    fireEvent.change(within(lorePanel).getByLabelText(/^Scan depth$/i), { target: { value: "6" } });
    fireEvent.change(within(lorePanel).getByLabelText(/^Token budget$/i), { target: { value: "1200" } });
    fireEvent.click(within(lorePanel).getByLabelText(/^Enabled$/i));
    fireEvent.click(within(lorePanel).getByLabelText(/^Recursive scanning$/i));
    fireEvent.change(within(lorePanel).getByLabelText(/^Entry title$/i), { target: { value: "Gate" } });
    fireEvent.change(within(lorePanel).getByLabelText(/^Primary keys$/i), { target: { value: "gate" } });
    fireEvent.change(within(lorePanel).getByLabelText(/^Secondary keys$/i), { target: { value: "moon" } });
    fireEvent.change(within(lorePanel).getByLabelText(/^Insertion order$/i), { target: { value: "9" } });
    fireEvent.change(within(lorePanel).getByLabelText(/^Priority$/i), { target: { value: "3" } });
    fireEvent.change(within(lorePanel).getByLabelText(/^Probability$/i), { target: { value: "75" } });
    fireEvent.click(within(lorePanel).getByLabelText(/^Constant entry$/i));
    fireEvent.change(within(lorePanel).getByLabelText(/^Entry content$/i), {
      target: { value: "The gate opens at moonrise." },
    });
    fireEvent.click(within(lorePanel).getByRole("button", { name: /Add lorebook entry/i }));
    fireEvent.change(within(lorePanel).getByLabelText(/^Search lorebook entries$/i), {
      target: { value: "gate" },
    });
    fireEvent.change(within(lorePanel).getByLabelText(/^Lorebook source$/i), {
      target: { value: "chub-compatible" },
    });

    await waitFor(() => {
      const snapshot = JSON.parse(window.localStorage.getItem(RUNTIME_STORAGE_KEY) ?? "{}") as {
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

  it("can shut down and restart the current runtime", async () => {
    await renderApp();

    openBlankRpgCard();
    fireEvent.click(screen.getByRole("button", { name: /Shut down runtime/i }));
    expect(screen.getByRole("region", { name: /Runtime stopped/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Send$/i })).toBeDisabled();
    fireEvent.submit(screen.getByRole("form", { name: /Message composer/i }));
    expect(screen.getByText(/Runtime is shut down\. Start the runtime before generating another turn/i)).toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: /Start runtime/i })[0]);
    expect(screen.queryByRole("region", { name: /Runtime stopped/i })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Message input/i), { target: { value: "I continue." } });
    expect(screen.getByRole("button", { name: /^Send$/i })).not.toBeDisabled();
  });

  it("sends chat messages with Enter while keeping Shift+Enter for multiline drafts", async () => {
    await renderApp();

    openBlankRpgCard();
    const input = screen.getByLabelText(/Message input/i);
    const transcript = screen.getByRole("log", { name: /Chat transcript/i });
    fireEvent.change(input, { target: { value: "I look around" } });
    fireEvent.keyDown(input, { key: "Enter", code: "Enter", shiftKey: true });
    expect(within(transcript).queryByText("I look around")).not.toBeInTheDocument();

    fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    await waitFor(() => expect(within(transcript).getByText("I look around")).toBeInTheDocument());
    expect(screen.getByLabelText(/Message input/i)).toHaveValue("");
  });

  it("handles wheel zoom, chat selection, write-for-me, and memory drawer escape", async () => {
    const scrollBySpy = vi.spyOn(window, "scrollBy").mockImplementation(() => undefined);
    const scrollingDescriptor = Object.getOwnPropertyDescriptor(document, "scrollingElement");
    Object.defineProperty(document, "scrollingElement", {
      value: null,
      configurable: true,
    });

    try {
      await renderApp();

      const ordinaryWheel = new WheelEvent("wheel", {
        deltaX: 1,
        deltaY: 2,
        bubbles: true,
        cancelable: true,
      });
      window.dispatchEvent(ordinaryWheel);
      expect(ordinaryWheel.defaultPrevented).toBe(false);
      expect(scrollBySpy).not.toHaveBeenCalled();

      const windowWheel = new WheelEvent("wheel", {
        ctrlKey: true,
        deltaX: 4,
        deltaY: 30,
        bubbles: true,
        cancelable: true,
      });
      window.dispatchEvent(windowWheel);
      expect(windowWheel.defaultPrevented).toBe(true);
      expect(scrollBySpy).toHaveBeenCalledWith({ left: 4, top: 30 });

      const scroller = document.createElement("div");
      scroller.style.overflowY = "auto";
      Object.defineProperty(scroller, "scrollHeight", { value: 100, configurable: true });
      Object.defineProperty(scroller, "clientHeight", { value: 10, configurable: true });
      const child = document.createElement("button");
      scroller.appendChild(child);
      document.body.appendChild(scroller);
      fireEvent.wheel(child, { metaKey: true, deltaX: 2, deltaY: 9 });
      expect(scroller.scrollTop).toBe(9);
      expect(scroller.scrollLeft).toBe(2);
      scroller.remove();

      openBlankRpgCard();
      fireEvent.click(screen.getByRole("button", { name: /Write for me/i }));
      expect((screen.getByLabelText(/Message input/i) as HTMLTextAreaElement).value).toMatch(
        /I look around Unmapped starting area/i,
      );

      sendRuntimeMessage("I inspect the first room.");
      await waitFor(() => expect(screen.getByRole("log", { name: /Chat transcript/i })).toHaveTextContent(/first room/i));
      const originalChatId = (screen.getByLabelText(/Active chat/i) as HTMLSelectElement).value;
      fireEvent.click(screen.getByRole("button", { name: /Branch chat/i }));
      fireEvent.click(screen.getByRole("button", { name: /New chat/i }));
      const chatSelect = screen.getByLabelText(/Active chat/i);
      expect(within(chatSelect).getAllByRole("option")).toHaveLength(3);
      fireEvent.change(chatSelect, { target: { value: originalChatId } });
      expect(screen.getByRole("log", { name: /Chat transcript/i })).toHaveTextContent(/first room/i);
      expect(screen.getByLabelText(/Message input/i)).toHaveValue("");

      fireEvent.click(screen.getByRole("button", { name: /Inspect memory/i }));
      expect(screen.getByRole("dialog", { name: /Memory inspector/i })).toBeInTheDocument();
      fireEvent.keyDown(document, { key: "Escape", code: "Escape" });
      expect(screen.queryByRole("dialog", { name: /Memory inspector/i })).not.toBeInTheDocument();
    } finally {
      if (scrollingDescriptor) {
        Object.defineProperty(document, "scrollingElement", scrollingDescriptor);
      } else {
        Reflect.deleteProperty(document, "scrollingElement");
      }
      scrollBySpy.mockRestore();
    }
  });

  it("branches, starts, deletes chats, and deletes user-created cards", async () => {
    await renderApp();

    sendRuntimeMessage("I inspect the first room.");
    await waitFor(() => expect(screen.getByRole("log", { name: /Chat transcript/i })).toHaveTextContent(/first room/i));

    fireEvent.click(screen.getByRole("button", { name: /Branch chat/i }));
    expect(within(screen.getByLabelText(/Active chat/i)).getAllByRole("option")).toHaveLength(2);
    expect(screen.getByRole("log", { name: /Chat transcript/i })).toHaveTextContent(/first room/i);

    fireEvent.click(screen.getByRole("button", { name: /New chat/i }));
    expect(within(screen.getByLabelText(/Active chat/i)).getAllByRole("option")).toHaveLength(3);
    expect(screen.getByLabelText(/Card opening/i)).toHaveClass("message", "response");

    fireEvent.click(screen.getByRole("button", { name: /Delete chat/i }));
    expect(within(screen.getByLabelText(/Active chat/i)).getAllByRole("option")).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: /Confirm delete chat/i }));
    expect(within(screen.getByLabelText(/Active chat/i)).getAllByRole("option")).toHaveLength(2);

    openCards();
    const createCardPanel = startCreatingCard();
    fireEvent.change(within(createCardPanel).getByLabelText(/^Name$/i), { target: { value: "Temporary Card" } });
    fireEvent.click(within(createCardPanel).getByRole("button", { name: /^Create card$/i }));

    openCards();
    const cardLibrary = screen.getByRole("region", { name: /Card library/i });
    const cardRow = within(cardLibrary).getByText("Temporary Card").closest(".card-row") as HTMLElement;
    fireEvent.click(within(cardRow).getByRole("button", { name: /Delete/i }));
    expect(within(cardLibrary).getByText("Temporary Card")).toBeInTheDocument();
    fireEvent.click(within(cardRow).getByRole("button", { name: /Confirm delete Temporary Card/i }));
    expect(within(cardLibrary).queryByText("Temporary Card")).not.toBeInTheDocument();
  });

  it("keeps branch history message IDs unique across persisted chat sessions", async () => {
    await renderApp();

    sendRuntimeMessage("I inspect the first room.");
    await waitFor(() => expect(screen.getByRole("log", { name: /Chat transcript/i })).toHaveTextContent(/first room/i));

    fireEvent.click(screen.getByRole("button", { name: /Branch chat/i }));

    await waitFor(() => {
      const snapshot = JSON.parse(window.localStorage.getItem(RUNTIME_STORAGE_KEY) ?? "{}") as {
        chatSessions?: Array<{ messages?: Array<{ id?: string }> }>;
      };
      const messageIds = (snapshot.chatSessions ?? []).flatMap((session) =>
        (session.messages ?? []).map((message) => message.id).filter(Boolean),
      );
      expect(messageIds.length).toBeGreaterThan(0);
      expect(new Set(messageIds).size).toBe(messageIds.length);
    });
  });

  it("does not reuse prompt run IDs after deleting another card", async () => {
    await renderApp();

    openBlankRpgCard();
    sendRuntimeMessage("I inspect the blank card room.");
    await waitFor(() => expect(screen.getByRole("log", { name: /Chat transcript/i })).toHaveTextContent(/blank card room/i));

    const createCardPanel = startCreatingCard();
    fireEvent.change(within(createCardPanel).getByLabelText(/^Name$/i), { target: { value: "Second Card" } });
    fireEvent.click(within(createCardPanel).getByRole("button", { name: /^Create card$/i }));

    sendRuntimeMessage("I inspect the second card room.");
    await waitFor(() => expect(screen.getByRole("log", { name: /Chat transcript/i })).toHaveTextContent(/second card room/i));

    openCards();
    const cardLibrary = screen.getByRole("region", { name: /Card library/i });
    const blankRow = within(cardLibrary).getByText("Blank Slate RPG").closest(".card-row") as HTMLElement;
    fireEvent.click(within(blankRow).getByRole("button", { name: /Delete/i }));
    fireEvent.click(within(blankRow).getByRole("button", { name: /Confirm delete Blank Slate RPG/i }));

    sendRuntimeMessage("I inspect another second card room.");
    await waitFor(() =>
      expect(screen.getByRole("log", { name: /Chat transcript/i })).toHaveTextContent(/another second card room/i),
    );

    await waitFor(() => {
      const snapshot = JSON.parse(window.localStorage.getItem(RUNTIME_STORAGE_KEY) ?? "{}") as {
        promptRuns?: Array<{ id?: string }>;
      };
      const runIds = (snapshot.promptRuns ?? []).map((run) => run.id).filter(Boolean);
      expect(runIds.length).toBeGreaterThan(1);
      expect(new Set(runIds).size).toBe(runIds.length);
    });
  });

  it("does not persist full compiled prompts unless prompt debug logs are enabled", async () => {
    await renderApp();

    openBlankRpgCard();
    sendRuntimeMessage("I inspect the private room.");
    await waitFor(() => expect(screen.getByRole("log", { name: /Chat transcript/i })).toHaveTextContent(/private room/i));

    await waitFor(() => {
      const snapshot = JSON.parse(window.localStorage.getItem(RUNTIME_STORAGE_KEY) ?? "{}") as {
        promptRuns?: Array<{ compiledPrompt?: string; includedLayerIds?: string[] }>;
      };
      expect(snapshot.promptRuns?.[0]?.includedLayerIds?.length).toBeGreaterThan(0);
      expect(snapshot.promptRuns?.[0]?.compiledPrompt).toBe("");
    });

    fireEvent.click(screen.getByRole("button", { name: /Settings/i }));
    fireEvent.click(screen.getByLabelText(/Prompt debug logs/i));

    sendRuntimeMessage("I inspect the logged room.");
    await waitFor(() => expect(screen.getByRole("log", { name: /Chat transcript/i })).toHaveTextContent(/logged room/i));

    await waitFor(() => {
      const snapshot = JSON.parse(window.localStorage.getItem(RUNTIME_STORAGE_KEY) ?? "{}") as {
        promptRuns?: Array<{ compiledPrompt?: string }>;
      };
      expect(snapshot.promptRuns?.slice(-1)[0]?.compiledPrompt).toContain("I inspect the logged room.");
    });
  });

  it("surfaces validation for required creation fields", async () => {
    await renderApp();

    openCards();
    const createCardPanel = startCreatingCard();
    fireEvent.click(within(createCardPanel).getByRole("button", { name: /^Create card$/i }));
    expect(within(createCardPanel).getByRole("alert")).toHaveTextContent(/card name/i);

    openCardEditorTab(/lorebooks/i);
    fireEvent.click(screen.getByRole("button", { name: /Add lorebook entry/i }));
    expect(screen.getAllByRole("alert").some((alert) => /entry content/i.test(alert.textContent ?? ""))).toBe(true);
  });

  it("adds, searches, exports, and includes triggered lore in the prompt debugger", async () => {
    const downloads = captureJsonDownloads();

    try {
      await renderApp();

      openCardEditorTab(/lorebooks/i);
      fireEvent.change(screen.getByLabelText(/Entry title/i), { target: { value: "Ancient Gate" } });
      fireEvent.change(screen.getByLabelText(/Primary keys/i), { target: { value: "gate" } });
      fireEvent.change(screen.getByLabelText(/Entry content/i), {
        target: { value: "The gate only opens when the player speaks a remembered oath." },
      });
      fireEvent.click(screen.getByRole("button", { name: /Add lorebook entry/i }));

      expect(screen.getByText(/Ancient Gate/i)).toBeInTheDocument();
      fireEvent.click(screen.getByRole("button", { name: /Export Chub JSON/i }));
      expect(downloads.clickedDownloads).toEqual([expect.stringMatching(/^card-lorebook-chub-lorebook\.json$/)]);
      expect(downloads.createObjectUrl).toHaveBeenCalledTimes(1);
      expect(downloads.revokeObjectUrl).toHaveBeenCalledTimes(1);
      fireEvent.change(screen.getByLabelText(/Search lorebook entries/i), { target: { value: "missing" } });
      expect(screen.queryByText(/Ancient Gate/i)).not.toBeInTheDocument();
      expect(screen.getByText(/No lorebook entries match this search/i)).toBeInTheDocument();
      fireEvent.change(screen.getByLabelText(/Search lorebook entries/i), { target: { value: "gate" } });
      expect(screen.getByText(/Ancient Gate/i)).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: /^Runtime$/i }));
      fireEvent.change(screen.getByLabelText(/Message input/i), { target: { value: "I inspect the gate." } });
      openCardEditorTab(/rules/i);

      const promptDebugger = screen.getByLabelText(/Prompt debugger/i);
      expect(promptDebugger).toHaveTextContent(/Active lorebook entries/i);
      expect(promptDebugger).toHaveTextContent(/Ancient Gate/i);
      expect(promptDebugger).toHaveTextContent(/remembered oath/i);
    } finally {
      downloads.restore();
    }
  });

  it("switches between multiple card lorebooks in the card editor", async () => {
    await renderApp();
    openCardEditorTab(/lorebooks/i);
    let lorePanel = screen.getByRole("region", { name: /^Lorebooks$/i });
    fireEvent.change(within(lorePanel).getByLabelText(/^Entry title$/i), { target: { value: "First Gate" } });
    fireEvent.change(within(lorePanel).getByLabelText(/^Primary keys$/i), { target: { value: "first gate" } });
    fireEvent.change(within(lorePanel).getByLabelText(/^Entry content$/i), {
      target: { value: "The first gate opens at dawn." },
    });
    fireEvent.click(within(lorePanel).getByRole("button", { name: /Add lorebook entry/i }));

    fireEvent.click(screen.getByRole("button", { name: /^Lorebooks$/i }));
    fireEvent.change(screen.getByLabelText(/Chub lorebook JSON/i), {
      target: {
        value: JSON.stringify({
          name: "Second Lore",
          scan_depth: 8,
          token_budget: 1600,
          recursive_scanning: true,
          entries: [
            {
              name: "Moon Gate",
              keys: ["moon gate"],
              secondary_keys: ["silver"],
              content: "The moon gate opens at midnight.",
              insertion_order: 50,
              priority: 2,
              probability: 100,
            },
          ],
        }),
      },
    });
    fireEvent.click(screen.getByRole("button", { name: /Import to active card/i }));

    openCardEditorTab(/lorebooks/i);
    lorePanel = screen.getByRole("region", { name: /^Lorebooks$/i });
    const selector = within(lorePanel).getByLabelText(/^Lorebook$/i) as HTMLSelectElement;
    const targetOption = (within(selector).getAllByRole("option") as HTMLOptionElement[]).find((option) =>
      /Second Lore/i.test(option.textContent ?? ""),
    );
    expect(targetOption).toBeDefined();

    fireEvent.change(selector, { target: { value: targetOption?.value } });

    expect(selector).toHaveDisplayValue("Second Lore");
    expect(within(lorePanel).getByLabelText(/^Lorebook name$/i)).toHaveValue("Second Lore");
    expect(within(lorePanel).getByLabelText(/^Scan depth$/i)).toHaveValue(8);
    expect(within(lorePanel).getByText("Moon Gate")).toBeInTheDocument();
    expect(within(lorePanel).getByText("moon gate")).toBeInTheDocument();
  });

  it("imports Chub-compatible lorebooks into the active card from the global lorebook tab", async () => {
    const downloads = captureJsonDownloads();

    try {
      await renderApp();

      openBlankRpgCard();
      fireEvent.click(screen.getByRole("button", { name: /^Lorebooks$/i }));
      const library = screen.getByRole("region", { name: /Stored lorebooks/i });
      expect(library).toBeInTheDocument();

      fireEvent.change(screen.getByLabelText(/Chub lorebook JSON/i), {
        target: {
          value: JSON.stringify({
            name: "Imported Gate Lore",
            scan_depth: 7,
            token_budget: 1200,
            entries: [
              {
                name: "Silver Gate",
                keys: ["silver gate"],
                content: "The silver gate opens only for remembered names.",
                insertion_order: 80,
                priority: 9,
                probability: 100,
              },
            ],
          }),
        },
      });
      fireEvent.click(screen.getByRole("button", { name: /Import to active card/i }));

      expect(screen.getByText(/Imported Imported Gate Lore into Blank Slate RPG/i)).toBeInTheDocument();
      expect(screen.getAllByText(/Imported Gate Lore/i).length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText(/Silver Gate/i)).toBeInTheDocument();
      fireEvent.change(within(library).getByLabelText(/Search stored lorebooks/i), { target: { value: "silver gate" } });
      expect(within(library).getByText(/Imported Gate Lore/i)).toBeInTheDocument();
      fireEvent.click(within(library).getByLabelText(/Enabled for Blank Slate RPG/i));
      expect(within(library).getByText(/^disabled$/i)).toBeInTheDocument();
      fireEvent.click(within(library).getByLabelText(/Enabled for Blank Slate RPG/i));
      expect(within(library).getByText(/^enabled$/i)).toBeInTheDocument();
      fireEvent.click(within(library).getByRole("button", { name: /Export Chub JSON/i }));
      expect(downloads.clickedDownloads).toEqual([expect.stringMatching(/^imported-gate-lore-chub-lorebook\.json$/)]);
      fireEvent.click(within(library).getByRole("button", { name: /Open card/i }));
      expect(screen.getByRole("heading", { name: /Blank Slate RPG/i })).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: /^Runtime$/i }));
      fireEvent.change(screen.getByLabelText(/Message input/i), { target: { value: "I inspect the silver gate." } });
      openCardEditorTab(/rules/i);
      expect(screen.getByLabelText(/Prompt debugger/i)).toHaveTextContent(/Silver Gate/i);
      expect(screen.getByLabelText(/Prompt debugger/i)).toHaveTextContent(/remembered names/i);
    } finally {
      downloads.restore();
    }
  });

  it("uploads Chub lorebook JSON files and exposes imported lorebooks through a selector", async () => {
    await renderApp();

    openBlankRpgCard();
    fireEvent.click(screen.getByRole("button", { name: /^Lorebooks$/i }));

    const file = new File(
      [
        JSON.stringify({
          name: "Uploaded Chub Lore",
          entries: [
            {
              name: "Sun Door",
              keys: ["sun door"],
              content: "The sun door opens only at dawn.",
            },
          ],
        }),
      ],
      "uploaded-chub-lore.json",
      { type: "application/json" },
    );
    fireEvent.change(screen.getByLabelText(/Upload Chub lorebook file/i), { target: { files: [file] } });
    await waitFor(() =>
      expect((screen.getByLabelText(/Chub lorebook JSON/i) as HTMLTextAreaElement).value).toMatch(/Uploaded Chub Lore/i),
    );
    fireEvent.click(screen.getByRole("button", { name: /Import to active card/i }));

    openCardEditorTab(/lorebooks/i);
    expect((screen.getByLabelText(/^Lorebook$/i) as HTMLSelectElement).value).toMatch(/^lore_import_/);
    expect(screen.getAllByText(/Sun Door/i).length).toBeGreaterThan(0);
  });

  it("surfaces lorebook import edge cases without changing active lore", async () => {
    await renderApp();

    fireEvent.click(screen.getByRole("button", { name: /^Lorebooks$/i }));
    expect(screen.getByText(/Open a card from the library before importing a lorebook/i)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(/Upload Chub lorebook file/i), { target: { files: [] } });

    openBlankRpgCard();
    fireEvent.click(screen.getByRole("button", { name: /^Lorebooks$/i }));
    fireEvent.change(screen.getByLabelText(/Chub lorebook JSON/i), {
      target: { value: "{bad json" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Import to active card/i }));
    await waitFor(() => expect(screen.getByText(/Chub lorebook JSON is invalid/i)).toBeInTheDocument());

    const brokenFile = new File(["{}"], "broken-chub-lore.json", { type: "application/json" });
    Object.defineProperty(brokenFile, "text", {
      value: () => Promise.reject(new Error("Could not read test lorebook.")),
      configurable: true,
    });
    fireEvent.change(screen.getByLabelText(/Upload Chub lorebook file/i), { target: { files: [brokenFile] } });
    await waitFor(() => expect(screen.getByText(/Could not read test lorebook/i)).toBeInTheDocument());
  });

  it("persists runtime settings and the active persona prompt into prompt construction", async () => {
    await renderApp();
    openBlankRpgCard();

    fireEvent.click(screen.getByRole("button", { name: /^Settings$/i }));
    fireEvent.click(screen.getByLabelText(/Ban emojis/i));

    const personaEditor = screen.getByRole("region", { name: /Persona editor/i });
    fireEvent.change(within(personaEditor).getByLabelText(/Persona prompt/i), {
      target: { value: "The user is a cautious cartographer who avoids rash promises." },
    });

    const settingsPreview = screen.getByRole("region", { name: /Settings prompt preview/i });
    expect(settingsPreview).toHaveTextContent(/Do not include emojis/i);
    expect(settingsPreview).toHaveTextContent(/cautious cartographer/i);
    openCardEditorTab(/rules/i);
    const promptDebugger = screen.getByLabelText(/Prompt debugger/i);
    expect(promptDebugger).toHaveTextContent(/Do not include emojis/i);
    expect(promptDebugger).toHaveTextContent(/cautious cartographer/i);
  });

  it("creates a persona, switches to it from the chat header, and fires its lorebook into the prompt", async () => {
    await renderApp();
    openBlankRpgCard();

    fireEvent.click(screen.getByRole("button", { name: /^Settings$/i }));
    const personaPanel = screen.getByRole("region", { name: /Persona profiles/i });
    fireEvent.change(within(personaPanel).getByLabelText(/New persona name/i), { target: { value: "Mara" } });
    fireEvent.click(within(personaPanel).getByRole("button", { name: /Create persona/i }));

    const personaEditor = screen.getByRole("region", { name: /Persona editor/i });
    fireEvent.change(within(personaEditor).getByLabelText(/Chub lorebook JSON/i), {
      target: {
        value: JSON.stringify({
          name: "Mara history",
          entries: [{ keys: ["coast"], content: "Mara grew up on the storm coast." }],
        }),
      },
    });
    fireEvent.click(within(personaEditor).getByRole("button", { name: /Attach lorebook/i }));
    expect(within(personaEditor).getByRole("status", { name: /Persona status/i })).toHaveTextContent(
      /Attached Mara history to Mara/i,
    );

    // Creating a persona makes it active, so the chat header quick-switch shows it.
    fireEvent.click(screen.getByRole("button", { name: /^Runtime$/i }));
    expect(screen.getByLabelText(/Active persona/i)).toHaveDisplayValue("Mara");

    fireEvent.change(screen.getByLabelText(/Message input/i), { target: { value: "I remember the coast." } });

    fireEvent.click(screen.getByRole("button", { name: /^Cards$/i }));
    openCardEditorTab(/rules/i);
    await waitFor(() =>
      expect(screen.getByLabelText(/Prompt debugger/i)).toHaveTextContent(/Mara grew up on the storm coast/i),
    );
  });

  it("captures a restore point immediately before persona deletion", async () => {
    await renderApp();
    fireEvent.click(screen.getByRole("button", { name: /^Settings$/i }));
    const personaPanel = screen.getByRole("region", { name: /Persona profiles/i });
    fireEvent.change(within(personaPanel).getByLabelText(/New persona name/i), { target: { value: "Mara" } });
    fireEvent.click(within(personaPanel).getByRole("button", { name: /Create persona/i }));
    fireEvent.click(within(personaPanel).getByRole("button", { name: /Delete Mara/i }));

    await waitFor(() => {
      const points = JSON.parse(window.localStorage.getItem(LOCAL_RESTORE_POINTS_KEY) ?? "[]") as Array<{
        snapshot?: { personas?: Array<{ name?: string }> };
      }>;
      expect(points[0]?.snapshot?.personas?.some((persona) => persona.name === "Mara")).toBe(true);
    });
  });

  it("creates and edits richer character card definition fields", async () => {
    await renderApp();

    const createCardPanel = startCreatingCard();
    fireEvent.change(within(createCardPanel).getByLabelText(/^Name$/i), { target: { value: "Archivist" } });
    fireEvent.change(within(createCardPanel).getByLabelText(/Character name/i), { target: { value: "Archivist Vell" } });
    fireEvent.change(within(createCardPanel).getByLabelText(/Description/i), {
      target: { value: "A careful archivist with a dry sense of humor." },
    });
    fireEvent.change(within(createCardPanel).getByLabelText(/Scenario/i), {
      target: { value: "The archive has lost a forbidden map." },
    });
    fireEvent.change(within(createCardPanel).getByLabelText(/Greeting/i), {
      target: { value: "Keep your voice low. The index hears things." },
    });
    fireEvent.change(within(createCardPanel).getByLabelText(/Example dialogs/i), {
      target: { value: "User: What is missing?\nArchivist: The map that should not exist." },
    });
    fireEvent.click(within(createCardPanel).getByRole("button", { name: /^Create card$/i }));

    openCards();
    fireEvent.click(screen.getByRole("tab", { name: /instructions/i }));
    expect(screen.getByDisplayValue(/Archivist Vell/i)).toBeInTheDocument();
    expect(screen.getByDisplayValue(/forbidden map/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /rules/i }));
    const promptDebugger = screen.getByLabelText(/Prompt debugger/i);
    expect(promptDebugger).toHaveTextContent(/Archivist Vell/i);
    expect(promptDebugger).toHaveTextContent(/The archive has lost a forbidden map/i);
    expect(promptDebugger).toHaveTextContent(/The map that should not exist/i);
  });

  it("applies validated RPG proposals and reloads them from local storage", async () => {
    const { unmount } = await renderApp();

    sendRuntimeMessage("I head to the cellar and take the brass key.");

    await waitFor(() => expect(screen.getByRole("log", { name: /Chat transcript/i })).toHaveTextContent(/The action is checked/i));

    openCardEditorTab(/rpg/i);
    expect(screen.getAllByDisplayValue("Cellar").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByDisplayValue(/brass key/i)).toBeInTheDocument();

    unmount();
    await renderApp();

    openCardEditorTab(/rpg/i);
    expect(screen.getAllByDisplayValue("Cellar").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByDisplayValue(/brass key/i)).toBeInTheDocument();
  });

  it("shows provenance for turn state changes and can undo the active variant", async () => {
    await renderApp();

    sendRuntimeMessage("I head to the cellar and take the brass key.");

    const summary = await screen.findByText(/State changes \(.*applied/i);
    fireEvent.click(summary);
    expect(screen.getAllByText(/player action/i).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: /Undo state changes/i }));

    expect(screen.getByText("State changes undone.")).toBeInTheDocument();
    expect(screen.getByText(/State changes undone for this response variant/i)).toBeInTheDocument();
    openCardEditorTab(/rpg/i);
    expect(screen.getAllByDisplayValue("Unmapped starting area").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByDisplayValue(/brass key/i)).not.toBeInTheDocument();
  });

  it("surfaces a missing session key before using a real BYOK provider", async () => {
    await renderApp();

    fireEvent.click(screen.getByRole("button", { name: /API Keys/i }));
    fireEvent.change(screen.getByLabelText(/Runtime mode/i), {
      target: { value: "openai-compatible" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Activate provider for session/i }));
    expect(screen.getByText(/Enter a session API key/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /^Runtime$/i }));
    sendRuntimeMessage("I test the provider.");

    await waitFor(() =>
      expect(screen.getByText(/OpenAI-compatible provider needs a session API key/i)).toBeInTheDocument(),
    );
  });

  it("surfaces provider activation and health-check statuses from API Keys", async () => {
    await renderApp();

    fireEvent.click(screen.getByRole("button", { name: /API Keys/i }));
    const llmProviderSection = screen.getByRole("region", { name: /LLM API keys/i });

    fireEvent.click(within(llmProviderSection).getByRole("button", { name: /Activate provider for session/i }));
    expect(within(llmProviderSection).getByText(/Mock provider active; no API key needed/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/Runtime mode/i), {
      target: { value: "openai-compatible" },
    });
    fireEvent.change(within(llmProviderSection).getByLabelText(/^Provider$/i), {
      target: { value: "local" },
    });
    fireEvent.click(within(llmProviderSection).getByRole("button", { name: /Activate provider for session/i }));
    expect(within(llmProviderSection).getByText(/Local OpenAI-compatible endpoint active without a stored API key/i)).toBeInTheDocument();

    fireEvent.change(within(llmProviderSection).getByLabelText(/^Provider$/i), {
      target: { value: "openrouter" },
    });
    fireEvent.change(within(llmProviderSection).getByLabelText(/^Base URL$/i), {
      target: { value: "https://example.test/v1" },
    });
    fireEvent.click(within(llmProviderSection).getByRole("button", { name: /Test text provider/i }));
    await waitFor(() =>
      expect(within(llmProviderSection).getByText(/known hosted URL or a loopback local endpoint/i)).toBeInTheDocument(),
    );

    fireEvent.change(within(llmProviderSection).getByLabelText(/^Base URL$/i), {
      target: { value: "https://openrouter.ai/api/v1" },
    });
    fireEvent.change(within(llmProviderSection).getByLabelText(/Session API key/i), {
      target: { value: "browser-session-key" },
    });
    fireEvent.click(within(llmProviderSection).getByRole("button", { name: /Activate provider for session/i }));
    await waitFor(() =>
      expect(within(llmProviderSection).getByText(/Session key active in memory only/i)).toBeInTheDocument(),
    );

    fireEvent.change(screen.getByLabelText(/Runtime mode/i), {
      target: { value: "mock" },
    });
    expect(within(llmProviderSection).getByLabelText(/^Provider$/i)).toHaveValue("mock");
  });

  it("warns when a hosted desktop provider has a session key but no secure storage", async () => {
    const restoreTauri = setTauriRuntimeForTest();
    try {
      await renderApp();

      fireEvent.click(screen.getByRole("button", { name: /API Keys/i }));
      const llmProviderSection = screen.getByRole("region", { name: /LLM API keys/i });
      fireEvent.change(screen.getByLabelText(/Runtime mode/i), {
        target: { value: "openai-compatible" },
      });
      fireEvent.change(within(llmProviderSection).getByLabelText(/^Provider$/i), {
        target: { value: "openrouter" },
      });
      fireEvent.change(within(llmProviderSection).getByLabelText(/Session API key/i), {
        target: { value: "desktop-session-key" },
      });
      fireEvent.click(within(llmProviderSection).getByRole("button", { name: /Activate provider for session/i }));

      await waitFor(() =>
        expect(within(llmProviderSection).getByText(/Secure storage unavailable/i)).toBeInTheDocument(),
      );
    } finally {
      restoreTauri();
    }
  });

  it("stores hosted provider keys through the desktop keychain reference path", async () => {
    const restoreTauri = setTauriRuntimeForTest();
    tauriInvokeMock.mockImplementation(async (command: string, args?: Record<string, unknown>) => {
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
      await renderApp();

      fireEvent.click(screen.getByRole("button", { name: /API Keys/i }));
      const llmProviderSection = screen.getByRole("region", { name: /LLM API keys/i });
      await waitFor(() =>
        expect(within(llmProviderSection).getByText(/OS keychain available/i)).toBeInTheDocument(),
      );
      expect(within(llmProviderSection).getByLabelText(/Session API key/i)).toHaveAttribute(
        "placeholder",
        "Stored in OS keychain when activated",
      );

      fireEvent.change(screen.getByLabelText(/Runtime mode/i), {
        target: { value: "openai-compatible" },
      });
      fireEvent.change(within(llmProviderSection).getByLabelText(/^Provider$/i), {
        target: { value: "openrouter" },
      });
      fireEvent.change(within(llmProviderSection).getByLabelText(/Session API key/i), {
        target: { value: "desktop-keychain-secret" },
      });
      fireEvent.click(within(llmProviderSection).getByRole("button", { name: /Store key securely/i }));

      await waitFor(() =>
        expect(within(llmProviderSection).getByText(/API key stored in OS keychain/i)).toBeInTheDocument(),
      );
      expect(within(llmProviderSection).getByText(/Stored reference/i)).toHaveTextContent("openrouter:apiKey");
      expect(within(llmProviderSection).getByLabelText(/Session API key/i)).toHaveValue("");

      fireEvent.click(within(llmProviderSection).getByRole("button", { name: /Forget stored key/i }));
      await waitFor(() => expect(within(llmProviderSection).getByText(/delete denied/i)).toBeInTheDocument());
    } finally {
      resetTauriInvokeMock();
      restoreTauri();
    }
  });

  it("surfaces secure key storage failures and rejects invalid hosted endpoints", async () => {
    const restoreTauri = setTauriRuntimeForTest();
    tauriInvokeMock.mockImplementation(async (command: string) => {
      if (command === "secure_storage_status") {
        return { available: true, storageKind: "os-keychain" };
      }
      if (command === "store_provider_secret") {
        throw new Error("store denied");
      }
      throw new Error(`Unexpected Tauri command: ${command}`);
    });

    try {
      await renderApp();

      fireEvent.click(screen.getByRole("button", { name: /API Keys/i }));
      const llmProviderSection = screen.getByRole("region", { name: /LLM API keys/i });
      await waitFor(() =>
        expect(within(llmProviderSection).getByText(/OS keychain available/i)).toBeInTheDocument(),
      );

      fireEvent.change(screen.getByLabelText(/Runtime mode/i), {
        target: { value: "openai-compatible" },
      });
      fireEvent.change(within(llmProviderSection).getByLabelText(/^Provider$/i), {
        target: { value: "openrouter" },
      });
      fireEvent.change(within(llmProviderSection).getByLabelText(/Session API key/i), {
        target: { value: "desktop-keychain-secret" },
      });
      fireEvent.click(within(llmProviderSection).getByRole("button", { name: /Store key securely/i }));
      await waitFor(() => expect(within(llmProviderSection).getByText(/store denied/i)).toBeInTheDocument());

      fireEvent.change(within(llmProviderSection).getByLabelText(/^Base URL$/i), {
        target: { value: "https://example.test/v1" },
      });
      fireEvent.click(within(llmProviderSection).getByRole("button", { name: /Store key securely/i }));
      await waitFor(() =>
        expect(within(llmProviderSection).getByText(/known hosted URL or a loopback local endpoint/i)).toBeInTheDocument(),
      );
    } finally {
      resetTauriInvokeMock();
      restoreTauri();
    }
  });

  it("requires OS keychain storage for hosted providers in the desktop runtime", async () => {
    const restoreTauri = setTauriRuntimeForTest();
    try {
      await renderApp();

      fireEvent.click(screen.getByRole("button", { name: /API Keys/i }));
      fireEvent.change(screen.getByLabelText(/Runtime mode/i), {
        target: { value: "openai-compatible" },
      });
      const llmProviderSection = screen.getByRole("region", { name: /LLM API keys/i });
      fireEvent.change(within(llmProviderSection).getByLabelText(/^Provider$/i), {
        target: { value: "openrouter" },
      });
      fireEvent.click(screen.getByRole("button", { name: /Activate provider for session/i }));
      expect(screen.getByText(/Store this hosted provider key in the OS keychain/i)).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: /^Runtime$/i }));
      sendRuntimeMessage("I test the provider.");

      await waitFor(() =>
        expect(screen.getByText(/Store this hosted provider key in the OS keychain/i)).toBeInTheDocument(),
      );
    } finally {
      restoreTauri();
    }
  });

  it("uses dropdown model selectors for OpenRouter text models and ComfyUI image models", async () => {
    await renderApp();

    fireEvent.click(screen.getByRole("button", { name: /API Keys/i }));
    fireEvent.change(screen.getByLabelText(/Runtime mode/i), {
      target: { value: "openai-compatible" },
    });
    const llmProviderSection = screen.getByRole("region", { name: /LLM API keys/i });
    fireEvent.change(within(llmProviderSection).getByLabelText(/^Provider$/i), {
      target: { value: "openrouter" },
    });
    const openRouterModelSelect = within(llmProviderSection).getByLabelText(/^Model$/i) as HTMLSelectElement;
    expect(openRouterModelSelect.tagName).toBe("SELECT");
    expect(within(openRouterModelSelect).getByRole("option", { name: /Qwen3/i })).toBeInTheDocument();
    fireEvent.change(openRouterModelSelect, { target: { value: "anthropic/claude-3.5-sonnet" } });
    expect(openRouterModelSelect).toHaveValue("anthropic/claude-3.5-sonnet");

    const imageProviderSection = screen.getByRole("region", { name: /Image provider/i });
    const comfyModelSelect = within(imageProviderSection).getByLabelText(/Default model/i) as HTMLSelectElement;
    expect(comfyModelSelect.tagName).toBe("SELECT");
    expect(within(comfyModelSelect).getByRole("option", { name: /FLUX\.2 dev FP8 mixed/i })).toBeInTheDocument();
  });

  it("checks ComfyUI image models on startup and selects an installed model when saved settings are stale", async () => {
    const installedModel = "flux2_dev_fp8mixed.safetensors";
    const fetchImpl = vi.fn(async () =>
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
    vi.stubGlobal("fetch", fetchImpl);
    window.localStorage.setItem(
      RUNTIME_STORAGE_KEY,
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
      await renderApp();

      fireEvent.click(screen.getByRole("button", { name: /API Keys/i }));
      const imageProviderSection = screen.getByRole("region", { name: /Image provider/i });
      await waitFor(() =>
        expect(within(imageProviderSection).getByText(/image model visible.*Selected/i)).toBeInTheDocument(),
      );
      expect(within(imageProviderSection).getByLabelText(/Default model/i)).toHaveValue(installedModel);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("ignores late ComfyUI startup results after the app unmounts", async () => {
    let resolveStartup!: (response: Response) => void;
    let rejectStartup!: (error: Error) => void;
    const fetchImpl = vi
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
    vi.stubGlobal("fetch", fetchImpl);
    seedRuntimeSnapshot({
      imageProviderSettings: {
        mode: "comfyui",
        endpoint: "http://127.0.0.1:8188",
        model: "missing-image-model.safetensors",
      },
    });

    try {
      const firstRender = await renderApp();
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

      const secondRender = await renderApp();
      secondRender.unmount();
      rejectStartup(new Error("late startup failure"));
      await new Promise((resolve) => setTimeout(resolve, 0));
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("refreshes ComfyUI image models manually and adopts the installed model", async () => {
    const installedModel = "manual-visible-model.safetensors";
    const fetchImpl = vi.fn(async () =>
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
    vi.stubGlobal("fetch", fetchImpl);

    try {
      await renderApp();

      fireEvent.click(screen.getByRole("button", { name: /API Keys/i }));
      const imageProviderSection = screen.getByRole("region", { name: /Image provider/i });
      fireEvent.change(within(imageProviderSection).getByLabelText(/^Provider$/i), {
        target: { value: "comfyui" },
      });
      const modelSelect = within(imageProviderSection).getByLabelText(/Default model/i);
      await waitFor(() => expect(modelSelect).toHaveValue(installedModel));
      fireEvent.change(modelSelect, {
        target: { value: "sd_xl_base_1.0.safetensors" },
      });
      fireEvent.click(within(imageProviderSection).getByRole("button", { name: /Refresh installed image models/i }));

      await waitFor(() =>
        expect(within(imageProviderSection).getByText(/Image model refresh ready: selected installed image model/i)).toBeInTheDocument(),
      );
      expect(modelSelect).toHaveValue(installedModel);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("reports empty, failed, and current ComfyUI image model refresh states", async () => {
    const currentModel = "flux2_dev_fp8mixed.safetensors";
    let responseMode: "empty" | "error" | "ready" = "empty";
    const fetchImpl = vi.fn(async () => {
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
    vi.stubGlobal("fetch", fetchImpl);

    try {
      await renderApp();

      fireEvent.click(screen.getByRole("button", { name: /API Keys/i }));
      const imageProviderSection = screen.getByRole("region", { name: /Image provider/i });
      fireEvent.change(within(imageProviderSection).getByLabelText(/^Provider$/i), {
        target: { value: "comfyui" },
      });
      await waitFor(() =>
        expect(within(imageProviderSection).getByText(/no image diffusion models are visible/i)).toBeInTheDocument(),
      );
      fireEvent.click(within(imageProviderSection).getByRole("button", { name: /Refresh installed image models/i }));
      await waitFor(() =>
        expect(within(imageProviderSection).getByText(/no image diffusion models are visible/i)).toBeInTheDocument(),
      );

      responseMode = "error";
      fireEvent.click(within(imageProviderSection).getByRole("button", { name: /Refresh installed image models/i }));
      await waitFor(() =>
        expect(within(imageProviderSection).getByText(/Original error: ComfyUI offline/i)).toBeInTheDocument(),
      );

      responseMode = "ready";
      fireEvent.click(within(imageProviderSection).getByRole("button", { name: /Refresh installed image models/i }));
      await waitFor(() =>
        expect(within(imageProviderSection).getByText(/Image model refresh ready: 1 image model visible/i)).toBeInTheDocument(),
      );
      expect(within(imageProviderSection).getByLabelText(/Default model/i)).toHaveValue(currentModel);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("lifts stale low-resolution ComfyUI settings back to local-image-safe defaults", async () => {
    const installedModel = "flux2_dev_fp8mixed.safetensors";
    const fetchImpl = vi.fn(async () =>
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
    vi.stubGlobal("fetch", fetchImpl);
    window.localStorage.setItem(
      RUNTIME_STORAGE_KEY,
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
      await renderApp();

      fireEvent.click(screen.getByRole("button", { name: /API Keys/i }));
      const imageProviderSection = screen.getByRole("region", { name: /Image provider/i });
      const widthInput = within(imageProviderSection).getByLabelText(/^Width$/i);
      const heightInput = within(imageProviderSection).getByLabelText(/^Height$/i);
      expect(widthInput).toHaveValue(1024);
      expect(heightInput).toHaveValue(1024);
      expect(within(imageProviderSection).getByLabelText(/^Steps$/i)).toHaveValue(28);
      expect(within(imageProviderSection).getByLabelText(/^CFG$/i)).toHaveValue(3.5);
      expect(within(imageProviderSection).getByLabelText(/^Sampler$/i)).toHaveValue("euler");
      expect(within(imageProviderSection).getByLabelText(/^Scheduler$/i)).toHaveValue("simple");

      fireEvent.change(widthInput, { target: { value: "256" } });
      fireEvent.change(heightInput, { target: { value: "256" } });
      expect(widthInput).toHaveValue(1024);
      expect(heightInput).toHaveValue(1024);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("lifts stale one-step ComfyUI settings back to local-image-safe defaults", async () => {
    const installedModel = "flux2_dev_fp8mixed.safetensors";
    const fetchImpl = vi.fn(async () =>
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
    vi.stubGlobal("fetch", fetchImpl);
    window.localStorage.setItem(
      RUNTIME_STORAGE_KEY,
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
      await renderApp();

      fireEvent.click(screen.getByRole("button", { name: /API Keys/i }));
      const imageProviderSection = screen.getByRole("region", { name: /Image provider/i });
      expect(within(imageProviderSection).getByLabelText(/^Width$/i)).toHaveValue(1024);
      expect(within(imageProviderSection).getByLabelText(/^Height$/i)).toHaveValue(1024);
      expect(within(imageProviderSection).getByLabelText(/^Steps$/i)).toHaveValue(28);
      expect(within(imageProviderSection).getByLabelText(/^CFG$/i)).toHaveValue(3.5);
      expect(within(imageProviderSection).getByLabelText(/^Sampler$/i)).toHaveValue("euler");
      expect(within(imageProviderSection).getByLabelText(/^Scheduler$/i)).toHaveValue("simple");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("does not persist typed provider API keys in browser storage", async () => {
    await renderApp();

    fireEvent.click(screen.getByRole("button", { name: /API Keys/i }));
    fireEvent.change(screen.getByLabelText(/Runtime mode/i), {
      target: { value: "openai-compatible" },
    });
    fireEvent.change(screen.getByLabelText(/Session API key/i), {
      target: { value: "sk-browser-session-secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Activate provider for session/i }));

    await waitFor(() => expect(screen.getByText(/Session key active in memory only/i)).toBeInTheDocument());
    expect(window.localStorage.getItem(RUNTIME_STORAGE_KEY)).not.toContain("sk-browser-session-secret");
  });

  it("keeps the ComfyUI API key session-only", async () => {
    await renderApp();

    fireEvent.click(screen.getByRole("button", { name: /API Keys/i }));
    const imageProviderSection = screen.getByRole("region", { name: /Image provider/i });
    fireEvent.change(within(imageProviderSection).getByLabelText(/ComfyUI API key/i), {
      target: { value: "comfy-secret-session-key" },
    });

    expect(within(imageProviderSection).getByLabelText(/ComfyUI API key/i)).toHaveValue("comfy-secret-session-key");
    await waitFor(() => expect(window.localStorage.getItem(RUNTIME_STORAGE_KEY)).not.toContain("comfy-secret-session-key"));
  });

  it("edits provider keys and image provider generation settings from the API keys panel", async () => {
    window.localStorage.clear();
    window.localStorage.setItem(
      RUNTIME_STORAGE_KEY,
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

    await renderApp();
    fireEvent.click(screen.getByRole("button", { name: /API Keys/i }));

    const llmProviderSection = screen.getByRole("region", { name: /LLM API keys/i });
    expect(within(llmProviderSection).getByText(/Stored reference/i)).toHaveTextContent("openrouter:apiKey");
    fireEvent.click(within(llmProviderSection).getByRole("button", { name: /Activate provider for session/i }));
    expect(within(llmProviderSection).getByText(/Stored OS keychain reference active/i)).toBeInTheDocument();
    fireEvent.click(within(llmProviderSection).getByRole("button", { name: /Forget stored key/i }));
    await waitFor(() => expect(within(llmProviderSection).getByText(/Stored provider key reference removed/i)).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText(/Runtime mode/i), {
      target: { value: "openai-compatible" },
    });
    fireEvent.change(within(llmProviderSection).getByLabelText(/^Provider$/i), {
      target: { value: "local" },
    });
    fireEvent.change(within(llmProviderSection).getByLabelText(/^Base URL$/i), {
      target: { value: "http://127.0.0.1:4321/v1" },
    });
    fireEvent.change(within(llmProviderSection).getByLabelText(/^Model$/i), {
      target: { value: "local-qwen-test" },
    });
    fireEvent.change(within(llmProviderSection).getByLabelText(/Session API key/i), {
      target: { value: "local-session-key" },
    });
    fireEvent.click(within(llmProviderSection).getByRole("button", { name: /Activate provider for session/i }));
    expect(within(llmProviderSection).getByText(/Local OpenAI-compatible endpoint active with a memory-only session key/i)).toBeInTheDocument();

    const imageProviderSection = screen.getByRole("region", { name: /Image provider/i });
    fireEvent.change(within(imageProviderSection).getByLabelText(/^Provider$/i), {
      target: { value: "prompt-only" },
    });
    fireEvent.click(within(imageProviderSection).getByRole("button", { name: /Refresh installed image models/i }));
    expect(within(imageProviderSection).getByText(/Prompt-only image mode active/i)).toBeInTheDocument();

    fireEvent.change(within(imageProviderSection).getByLabelText(/Local endpoint/i), {
      target: { value: "http://127.0.0.1:8288" },
    });
    fireEvent.change(within(imageProviderSection).getByLabelText(/Default model/i), {
      target: { value: "sd_xl_base_1.0.safetensors" },
    });
    fireEvent.change(within(imageProviderSection).getByLabelText(/^Width$/i), { target: { value: "1536" } });
    fireEvent.change(within(imageProviderSection).getByLabelText(/^Height$/i), { target: { value: "1408" } });
    fireEvent.change(within(imageProviderSection).getByLabelText(/^Timeout ms$/i), { target: { value: "180000" } });
    const seedInput = within(imageProviderSection).getAllByLabelText(/Seed/i)[0];
    fireEvent.change(seedInput, { target: { value: "12345" } });
    fireEvent.change(within(imageProviderSection).getByLabelText(/^Steps$/i), { target: { value: "36" } });
    fireEvent.change(within(imageProviderSection).getByLabelText(/^CFG$/i), { target: { value: "4.5" } });
    fireEvent.change(within(imageProviderSection).getByLabelText(/^Sampler$/i), { target: { value: "dpmpp_2m" } });
    fireEvent.change(within(imageProviderSection).getByLabelText(/^Scheduler$/i), { target: { value: "karras" } });
    fireEvent.change(within(imageProviderSection).getByLabelText(/ComfyUI API workflow JSON/i), {
      target: { value: '{"1":{"class_type":"SaveImage"}}' },
    });

    expect(within(imageProviderSection).getByLabelText(/Local endpoint/i)).toHaveValue("http://127.0.0.1:8288");
    expect(within(imageProviderSection).getByLabelText(/Default model/i)).toHaveValue("sd_xl_base_1.0.safetensors");
    expect(within(imageProviderSection).getByLabelText(/^Width$/i)).toHaveValue(1536);
    expect(within(imageProviderSection).getByLabelText(/^Height$/i)).toHaveValue(1408);
    expect(within(imageProviderSection).getByLabelText(/^Timeout ms$/i)).toHaveValue(180000);
    expect(seedInput).toHaveValue(12345);
    expect(within(imageProviderSection).getByLabelText(/^Steps$/i)).toHaveValue(36);
    expect(within(imageProviderSection).getByLabelText(/^CFG$/i)).toHaveValue(4.5);
    expect(within(imageProviderSection).getByLabelText(/^Sampler$/i)).toHaveValue("dpmpp_2m");
    expect(within(imageProviderSection).getByLabelText(/^Scheduler$/i)).toHaveValue("karras");
    expect(within(imageProviderSection).getByLabelText(/ComfyUI API workflow JSON/i)).toHaveValue('{"1":{"class_type":"SaveImage"}}');
  });

  it("runs a local provider health check without needing a real key in mock mode", async () => {
    await renderApp();

    fireEvent.click(screen.getByRole("button", { name: /API Keys/i }));
    fireEvent.click(screen.getByRole("button", { name: /Test text provider/i }));

    await waitFor(() => expect(screen.getByText(/Provider responded through mock/i)).toBeInTheDocument());
  });

  it("strips injected raw provider secrets from persisted settings", async () => {
    window.localStorage.setItem(
      RUNTIME_STORAGE_KEY,
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

    await renderApp();

    await waitFor(() => expect(window.localStorage.getItem(RUNTIME_STORAGE_KEY)).not.toContain("sk-injected-secret"));
    expect(window.localStorage.getItem(RUNTIME_STORAGE_KEY)).not.toContain("raw-token-value");
    expect(window.localStorage.getItem(RUNTIME_STORAGE_KEY)).not.toContain("raw-secret-value");
    expect(window.localStorage.getItem(RUNTIME_STORAGE_KEY)).toContain("openrouter:apiKey");
  });

  it("drops stored provider key references when the base URL changes", async () => {
    window.localStorage.setItem(
      RUNTIME_STORAGE_KEY,
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

    await renderApp();

    fireEvent.click(screen.getByRole("button", { name: /API Keys/i }));
    expect(await screen.findByText(/Stored reference/i)).toHaveTextContent(/openrouter:apiKey/i);

    fireEvent.change(screen.getByLabelText(/Base URL/i), {
      target: { value: "https://example.test/v1" },
    });

    await waitFor(() => expect(screen.queryByText(/Stored reference/i)).not.toBeInTheDocument());
    expect(window.localStorage.getItem(RUNTIME_STORAGE_KEY)).not.toContain("openrouter:apiKey");
  });

  it("strips raw-looking secret references from persisted settings", async () => {
    window.localStorage.setItem(
      RUNTIME_STORAGE_KEY,
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

    await renderApp();

    await waitFor(() => expect(window.localStorage.getItem(RUNTIME_STORAGE_KEY)).not.toContain("sk-raw-looking-secret"));
  });

  it("generates an editable 200-foot aerial image prompt for the blank RPG card", async () => {
    window.localStorage.setItem(
      RUNTIME_STORAGE_KEY,
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
    await renderApp();

    openBlankRpgCard();
    fireEvent.click(screen.getByRole("button", { name: /Draft aerial image prompt/i }));

    const prompt = screen.getByRole("textbox", { name: /Image prompt/i }) as HTMLTextAreaElement;
    await waitFor(() => expect(prompt.value).toMatch(/Moonlit plain/i));
    expect(prompt.value).toMatch(/overhead|top-down/i);
    expect(prompt.value).toMatch(/200 feet/i);
    expect(prompt.value).toMatch(/standing stones/i);
    expect(prompt.value).not.toMatch(/\bmap\b|1000 feet|cartographic|tabletop/i);
    expect(prompt.value).not.toMatch(/intentionally long and should not be copied wholesale/i);
    const negativePrompt = screen.getByRole("textbox", { name: /Negative prompt/i }) as HTMLTextAreaElement;
    expect(negativePrompt.value).toMatch(/people/i);
    expect(negativePrompt.value).toMatch(/single figure/i);
    expect(negativePrompt.value).toMatch(/first-person view/i);
    expect(screen.getByRole("button", { name: /Generate aerial image/i })).not.toBeDisabled();
  });

  it("removes natural map features from AI-planned negative prompts", async () => {
    const fetchImpl = vi.fn(async () =>
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
    vi.stubGlobal("fetch", fetchImpl);
    window.localStorage.setItem(
      RUNTIME_STORAGE_KEY,
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
      await renderApp();
      openBlankRpgCard();
      fireEvent.click(screen.getByRole("button", { name: /Draft aerial image prompt/i }));

      const prompt = screen.getByRole("textbox", { name: /Image prompt/i }) as HTMLTextAreaElement;
      await waitFor(() => expect(prompt.value).toMatch(/200 feet/i));
      expect(prompt.value).toMatch(/aerial environment image/i);
      expect(prompt.value).not.toMatch(/\bmap\b|1000 feet|cartographic|tabletop/i);
      const negativePrompt = screen.getByRole("textbox", { name: /Negative prompt/i }) as HTMLTextAreaElement;
      await waitFor(() => expect(negativePrompt.value).toMatch(/people/i));
      expect(negativePrompt.value).toMatch(/single figure/i);
      expect(negativePrompt.value).toMatch(/first-person view/i);
      expect(negativePrompt.value).not.toMatch(/\btrees?\b/i);
      expect(negativePrompt.value).not.toMatch(/\bforests?\b/i);
      expect(negativePrompt.value).not.toMatch(/\brivers?\b/i);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("falls back to a local aerial image prompt when the AI prompt planner fails", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("planner offline");
    });
    vi.stubGlobal("fetch", fetchImpl);
    window.localStorage.setItem(
      RUNTIME_STORAGE_KEY,
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
      await renderApp();
      openBlankRpgCard();
      fireEvent.click(screen.getByRole("button", { name: /Draft aerial image prompt/i }));

      const prompt = screen.getByRole("textbox", { name: /Image prompt/i }) as HTMLTextAreaElement;
      await waitFor(() => expect(prompt.value).toMatch(/Fallback hill/i));
      expect(prompt.value).toMatch(/watch tower/i);
      expect(await screen.findByText(/Aerial image prompt planner fell back to local summary: planner offline/i)).toBeInTheDocument();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("shows the generated image artifact for the active chat only", async () => {
    window.localStorage.setItem(
      RUNTIME_STORAGE_KEY,
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

    await renderApp();
    openBlankRpgCard();

    await waitFor(() => expect(screen.getByRole("region", { name: /Generated aerial image/i })).toHaveTextContent("Model B"));
    expect(screen.getByRole("region", { name: /Generated aerial image/i })).not.toHaveTextContent("Model A");
  });

  it("shows the newest persisted map when duplicate artifacts exist for the same chat", async () => {
    window.localStorage.setItem(
      RUNTIME_STORAGE_KEY,
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

    await renderApp();
    openBlankRpgCard();

    const generatedMap = await screen.findByRole("region", { name: /Generated aerial image/i });
    expect(generatedMap).toHaveTextContent("Fresh Model");
    expect(generatedMap).not.toHaveTextContent("Stale Model");
    expect(screen.getByAltText(/Generated aerial scene/i)).toHaveAttribute("src", expect.stringContaining("lc_run=fresh-map"));
  });

  it("surfaces a new aerial image prompt draft separately from the existing generated image", async () => {
    window.localStorage.setItem(
      RUNTIME_STORAGE_KEY,
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

    await renderApp();
    openBlankRpgCard();

    const mapGenerator = screen.getByRole("region", { name: /Aerial image generator/i });
    expect(within(mapGenerator).getByRole("region", { name: /Generated aerial image/i })).toHaveTextContent("Old Model");
    fireEvent.click(within(mapGenerator).getByRole("button", { name: /Draft aerial image prompt/i }));

    const promptDraft = await within(mapGenerator).findByRole("region", { name: /Aerial image prompt draft/i });
    expect(promptDraft).toHaveTextContent(/Generate aerial image/i);
    expect((within(mapGenerator).getByLabelText(/^Image prompt$/i) as HTMLTextAreaElement).value).toMatch(/new ridge/i);
    expect(within(mapGenerator).getByRole("button", { name: /Regenerate aerial image/i })).not.toBeDisabled();
  });

  it("lets users reset, generate, and delete the current aerial image", async () => {
    window.localStorage.setItem(
      RUNTIME_STORAGE_KEY,
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

    await renderApp();
    openBlankRpgCard();

    const mapGenerator = screen.getByRole("region", { name: /Aerial image generator/i });
    expect(within(mapGenerator).getByRole("region", { name: /Generated aerial image/i })).toHaveTextContent("test-image-model");

    fireEvent.click(within(mapGenerator).getByRole("button", { name: /Delete aerial image/i }));
    await waitFor(() =>
      expect(within(mapGenerator).queryByRole("region", { name: /Generated aerial image/i })).not.toBeInTheDocument(),
    );

    const mapPrompt = within(mapGenerator).getByLabelText(/^Image prompt$/i) as HTMLTextAreaElement;
    const mapNegativePrompt = within(mapGenerator).getByLabelText(/^Negative prompt$/i) as HTMLTextAreaElement;
    fireEvent.change(mapPrompt, { target: { value: "200-foot aerial image prompt" } });
    fireEvent.change(mapNegativePrompt, { target: { value: "people" } });
    fireEvent.click(within(mapGenerator).getByRole("button", { name: /Reset aerial prompt/i }));
    expect(mapPrompt).toHaveValue("");
    expect(mapNegativePrompt).toHaveValue("");

    fireEvent.change(mapPrompt, { target: { value: "200-foot aerial image prompt" } });
    fireEvent.click(within(mapGenerator).getByRole("button", { name: /Generate aerial image/i }));
    await waitFor(() =>
      expect(within(mapGenerator).getByRole("region", { name: /Generated aerial image/i })).toHaveTextContent("prompt-only"),
    );
  });

  it("surfaces ComfyUI aerial and custom image generation failures", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("generation offline");
    });
    vi.stubGlobal("fetch", fetchImpl);
    seedRuntimeSnapshot({
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
      await renderApp();
      openBlankRpgCard();

      const mapGenerator = screen.getByRole("region", { name: /Aerial image generator/i });
      fireEvent.change(within(mapGenerator).getByLabelText(/Image prompt/i), {
        target: { value: "failed aerial image prompt" },
      });
      fireEvent.click(within(mapGenerator).getByRole("button", { name: /Generate aerial image/i }));
      await waitFor(() => expect(within(mapGenerator).getByText(/generation offline/i)).toBeInTheDocument());

      openMediaTab(/^Image$/i);
      const imageGenerator = screen.getByRole("region", { name: /^Image generator$/i });
      fireEvent.change(within(imageGenerator).getByLabelText(/Image request/i), {
        target: { value: "failed custom image" },
      });
      fireEvent.click(within(imageGenerator).getByRole("button", { name: /Generate custom image/i }));
      await waitFor(() => expect(within(imageGenerator).getByText(/generation offline/i)).toBeInTheDocument());
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("restores a saved aerial image prompt and refreshes the image when regenerating", async () => {
    let promptQueueCount = 0;
    const queuedWorkflows: Array<Record<string, { inputs?: Record<string, unknown> }>> = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
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
    vi.stubGlobal("fetch", fetchImpl);
    window.localStorage.setItem(
      RUNTIME_STORAGE_KEY,
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
      await renderApp();
      openBlankRpgCard();

      const mapGenerator = screen.getByRole("region", { name: /Aerial image generator/i });
      expect(within(mapGenerator).getByRole("button", { name: /Draft aerial image prompt/i })).toBeInTheDocument();
      const prompt = within(mapGenerator).getByLabelText(/Image prompt/i) as HTMLTextAreaElement;
      expect(prompt).toHaveValue("saved 200-foot aerial image prompt");
      const oldMapImage = within(mapGenerator).getByAltText(/Generated aerial scene/i);
      const oldMapSrc = oldMapImage.getAttribute("src");

      fireEvent.click(within(mapGenerator).getByRole("button", { name: /Regenerate aerial image/i }));
      await waitFor(() => expect(promptQueueCount).toBe(1));
      const refreshedMapImage = within(mapGenerator).getByAltText(/Generated aerial scene/i);
      expect(refreshedMapImage.getAttribute("src")).not.toBe(oldMapSrc);
      expect(queuedWorkflows[0]?.["5"].inputs?.width).toBe(1024);
      expect(queuedWorkflows[0]?.["5"].inputs?.height).toBe(1024);
      expect(queuedWorkflows[0]?.["3"].inputs?.steps).toBe(28);
      expect(queuedWorkflows[0]?.["3"].inputs?.sampler_name).toBe("dpmpp_2m");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("builds a preset-backed custom image prompt from vague user input", async () => {
    window.localStorage.setItem(
      RUNTIME_STORAGE_KEY,
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

    await renderApp();
    openBlankRpgCard();
    openMediaTab(/^Image$/i);

    const imageGenerator = screen.getByRole("region", { name: /^Image generator$/i });
    expect(imageGenerator).toHaveTextContent(/realistic, 4k/i);
    const imageRequest = within(imageGenerator).getByLabelText(/Image request/i);
    fireEvent.change(imageRequest, {
      target: { value: "temporary image request" },
    });
    fireEvent.click(within(imageGenerator).getByRole("button", { name: /Reset image request/i }));
    expect(imageRequest).toHaveValue("");

    fireEvent.change(imageRequest, {
      target: { value: "a silver tavern sign at sunset" },
    });
    fireEvent.click(within(imageGenerator).getByRole("button", { name: /Generate custom image/i }));

    await waitFor(() =>
      expect(within(imageGenerator).getByRole("region", { name: /Generated custom image/i })).toHaveTextContent(
        "prompt-only",
      ),
    );
    await waitFor(() => {
      const snapshot = JSON.parse(window.localStorage.getItem(RUNTIME_STORAGE_KEY) ?? "{}") as {
        generatedMaps?: Array<{ imageKind?: string; prompt?: string; negativePrompt?: string }>;
      };
      const customImage = snapshot.generatedMaps?.find((artifact) => artifact.imageKind === "photo");
      expect(customImage?.prompt).toContain("realistic, 4k");
      expect(customImage?.prompt).toContain("plus user inputs: a silver tavern sign at sunset");
      expect(customImage?.negativePrompt).toContain("watermark");
    });

    fireEvent.click(within(imageGenerator).getByRole("button", { name: /Delete image/i }));
    await waitFor(() =>
      expect(within(imageGenerator).queryByRole("region", { name: /Generated custom image/i })).not.toBeInTheDocument(),
    );
  });

  it("refreshes the displayed custom image when a later generation returns the same provider view URL", async () => {
    let promptQueueCount = 0;
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
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
    vi.stubGlobal("fetch", fetchImpl);
    window.localStorage.setItem(
      RUNTIME_STORAGE_KEY,
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
      await renderApp();
      openBlankRpgCard();
      openMediaTab(/^Image$/i);

      const imageGenerator = screen.getByRole("region", { name: /^Image generator$/i });
      const imageRequest = within(imageGenerator).getByLabelText(/Image request/i);
      fireEvent.change(imageRequest, { target: { value: "first image" } });
      fireEvent.click(within(imageGenerator).getByRole("button", { name: /Generate custom image/i }));
      const firstImage = await within(imageGenerator).findByAltText(/Generated custom scene/i);
      const firstSrc = firstImage.getAttribute("src");

      fireEvent.change(imageRequest, { target: { value: "second image" } });
      fireEvent.click(within(imageGenerator).getByRole("button", { name: /Generate custom image/i }));
      await waitFor(() => expect(promptQueueCount).toBe(2));
      const secondImage = await within(imageGenerator).findByAltText(/Generated custom scene/i);
      const secondSrc = secondImage.getAttribute("src");

      expect(secondSrc).toContain("same-provider-file.png");
      expect(secondSrc).not.toBe(firstSrc);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("queues local-image-safe settings when the custom image generator starts from stale one-step settings", async () => {
    let promptQueueCount = 0;
    const queuedWorkflows: Array<Record<string, { inputs?: Record<string, unknown> }>> = [];
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
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
    vi.stubGlobal("fetch", fetchImpl);
    window.localStorage.setItem(
      RUNTIME_STORAGE_KEY,
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
      await renderApp();
      openBlankRpgCard();
      openMediaTab(/^Image$/i);

      const imageGenerator = screen.getByRole("region", { name: /^Image generator$/i });
      fireEvent.change(within(imageGenerator).getByLabelText(/Image request/i), {
        target: { value: "a clear portrait of an old stone doorway" },
      });
      fireEvent.click(within(imageGenerator).getByRole("button", { name: /Generate custom image/i }));
      await waitFor(() => expect(promptQueueCount).toBe(1));
      expect(queuedWorkflows[0]?.["5"].inputs?.width).toBe(1024);
      expect(queuedWorkflows[0]?.["5"].inputs?.height).toBe(1024);
      expect(queuedWorkflows[0]?.["3"].inputs?.steps).toBe(28);
      expect(queuedWorkflows[0]?.["3"].inputs?.cfg).toBe(3.5);
      expect(queuedWorkflows[0]?.["3"].inputs?.sampler_name).toBe("euler");
      expect(queuedWorkflows[0]?.["3"].inputs?.scheduler).toBe("simple");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("lets users maximize generated maps and custom images", async () => {
    window.localStorage.setItem(
      RUNTIME_STORAGE_KEY,
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

    const scrollIntoView = vi.fn();
    const previousScrollIntoView = HTMLElement.prototype.scrollIntoView;
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      value: scrollIntoView,
      configurable: true,
    });

    try {
      await renderApp();
      openBlankRpgCard();

      const mapGenerator = screen.getByRole("region", { name: /Aerial image generator/i });
      fireEvent.click(within(mapGenerator).getByRole("button", { name: /Maximize aerial image/i }));
      const mapPreview = screen.getByRole("dialog", { name: /Generated aerial image preview/i });
      expect(within(mapPreview).getByAltText(/Generated aerial image preview/i)).toHaveAttribute(
        "src",
        expect.stringContaining("lc_run=max-map"),
      );
      fireEvent.mouseDown(mapPreview);
      expect(screen.getByRole("dialog", { name: /Generated aerial image preview/i })).toBeInTheDocument();
      fireEvent.keyDown(document, { key: "Escape" });
      expect(screen.queryByRole("dialog", { name: /Generated aerial image preview/i })).not.toBeInTheDocument();

      openMediaTab(/^Characters$/i);
      const charactersPanel = screen.getByRole("region", { name: /Story characters/i });
      fireEvent.click(within(charactersPanel).getByRole("button", { name: /Maximize portrait for Rook/i }));
      const portraitPreview = screen.getByRole("dialog", { name: /Rook portrait preview/i });
      expect(within(portraitPreview).getByAltText(/Rook portrait preview/i)).toHaveAttribute(
        "src",
        expect.stringContaining("lc_run=max-rook-portrait"),
      );
      fireEvent.click(within(portraitPreview).getByRole("button", { name: /Close media preview/i }));

      openMediaTab(/^Image$/i);
      const imageGenerator = screen.getByRole("region", { name: /^Image generator$/i });
      fireEvent.click(within(imageGenerator).getByRole("button", { name: /Maximize image/i }));
      const imagePreview = screen.getByRole("dialog", { name: /Generated custom image preview/i });
      expect(within(imagePreview).getByAltText(/Generated custom image preview/i)).toHaveAttribute(
        "src",
        expect.stringContaining("lc_run=max-photo"),
      );
      fireEvent.mouseDown(imagePreview.closest(".media-preview-backdrop") as HTMLElement);
      expect(screen.queryByRole("dialog", { name: /Generated custom image preview/i })).not.toBeInTheDocument();
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

  it("imports versioned runtime exports from Settings", async () => {
    await renderApp();
    const bundle = buildVersionedRuntimeExport({
      version: 2,
      theme: "dark",
      activeCardId: "card_imported",
      cards: [
        {
          id: "card_imported",
          name: "Imported Runtime Card",
          kind: "rpg",
          summary: "Imported from a versioned bundle.",
          systemPrompt: "Run this imported RPG.",
          preHistoryInstructions: "",
          postHistoryInstructions: "",
          playerRules: [],
          lorebooks: [],
          memory: [],
          rpg: {
            location: "Imported hall",
            health: "10/10",
            inventory: [],
            quests: [],
            flags: {},
            knownPlaces: ["Imported hall"],
            mapStyle: "map",
          },
        },
      ],
      messages: [],
      chatSessions: [
        {
          id: "chat_imported",
          cardId: "card_imported",
          title: "Imported chat",
          createdAt: "2026-07-01T18:00:00.000Z",
          updatedAt: "2026-07-01T18:00:00.000Z",
          messages: [],
        },
      ],
      activeChatIds: {
        card_imported: "chat_imported",
      },
      promptRuns: [],
      providerKeyStatus: "No plaintext keys stored.",
      savedAt: "2026-07-01T18:00:00.000Z",
    });

    fireEvent.click(screen.getByRole("button", { name: /^Settings$/i }));
    fireEvent.change(screen.getByLabelText(/Runtime export JSON/i), {
      target: { value: JSON.stringify(bundle) },
    });
    fireEvent.click(screen.getByRole("button", { name: /Review runtime import/i }));

    expect(screen.getByRole("status", { name: /Data management status/i })).toHaveTextContent(
      /Review before applying/i,
    );
    expect(screen.queryByRole("heading", { name: /Imported Runtime Card/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Apply reviewed import/i }));

    expect(screen.getByRole("status", { name: /Data management status/i })).toHaveTextContent(
      /Imported runtime export/i,
    );
    fireEvent.click(screen.getByRole("button", { name: /^Runtime$/i }));
    expect(screen.getByRole("heading", { name: /Imported Runtime Card/i })).toBeInTheDocument();
  });

  it("surfaces invalid runtime export imports from Settings", async () => {
    await renderApp();

    fireEvent.click(screen.getByRole("button", { name: /^Settings$/i }));
    fireEvent.change(screen.getByLabelText(/Runtime export JSON/i), {
      target: { value: "{bad json" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Review runtime import/i }));

    expect(screen.getByRole("status", { name: /Data management status/i })).toHaveTextContent(
      /Runtime export JSON is invalid/i,
    );
  });

  it("exposes runtime export and redacted diagnostics downloads from Settings", async () => {
    Object.defineProperty(URL, "createObjectURL", {
      value: vi.fn(),
      configurable: true,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      value: vi.fn(),
      configurable: true,
    });
    const createObjectUrl = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:rpg-test");
    const revokeObjectUrl = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const clickedDownloads: string[] = [];
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementation((tagName: string, options?: ElementCreationOptions) => {
      const element = originalCreateElement(tagName, options);
      if (tagName.toLowerCase() === "a") {
        vi.spyOn(element as HTMLAnchorElement, "click").mockImplementation(function click(this: HTMLAnchorElement) {
          clickedDownloads.push(this.download);
        });
      }
      return element;
    });

    await renderApp();
    fireEvent.click(screen.getByRole("button", { name: /^Settings$/i }));

    fireEvent.click(screen.getByRole("button", { name: /Export runtime data/i }));
    fireEvent.click(screen.getByRole("button", { name: /Download diagnostics/i }));

    expect(clickedDownloads).toEqual([
      expect.stringMatching(/^rpg-runtime-.+\.json$/),
      expect.stringMatching(/^rpg-diagnostics-.+\.json$/),
    ]);
    expect(createObjectUrl).toHaveBeenCalledTimes(2);
    expect(revokeObjectUrl).toHaveBeenCalledTimes(2);
  });
});

function setTauriRuntimeForTest(): () => void {
  const previousDescriptor = Object.getOwnPropertyDescriptor(window, "__TAURI_INTERNALS__");
  Object.defineProperty(window, "__TAURI_INTERNALS__", {
    value: {},
    configurable: true,
  });

  return () => {
    if (previousDescriptor) {
      Object.defineProperty(window, "__TAURI_INTERNALS__", previousDescriptor);
    } else {
      delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
    }
  };
}

function resetTauriInvokeMock() {
  tauriInvokeMock.mockImplementation(async () => {
    throw new Error("Tauri unavailable");
  });
}
