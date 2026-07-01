import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { App } from "../../src/app/App";
import { RUNTIME_STORAGE_KEY } from "../../src/app/localRuntimeStore";

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

  it("can shut down and restart the current runtime", async () => {
    await renderApp();

    openBlankRpgCard();
    fireEvent.click(screen.getByRole("button", { name: /Shut down runtime/i }));
    expect(screen.getByRole("region", { name: /Runtime stopped/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Send$/i })).toBeDisabled();

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

  it("branches, starts, deletes chats, and deletes user-created cards", async () => {
    await renderApp();

    sendRuntimeMessage("I inspect the first room.");
    await waitFor(() => expect(screen.getByRole("log", { name: /Chat transcript/i })).toHaveTextContent(/first room/i));

    fireEvent.click(screen.getByRole("button", { name: /Branch chat/i }));
    expect(within(screen.getByLabelText(/Active chat/i)).getAllByRole("option")).toHaveLength(2);
    expect(screen.getByRole("log", { name: /Chat transcript/i })).toHaveTextContent(/first room/i);

    fireEvent.click(screen.getByRole("button", { name: /New chat/i }));
    expect(within(screen.getByLabelText(/Active chat/i)).getAllByRole("option")).toHaveLength(3);
    expect(screen.getByRole("region", { name: /Empty chat/i })).toBeInTheDocument();

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
    await renderApp();

    openCardEditorTab(/lorebooks/i);
    fireEvent.change(screen.getByLabelText(/Entry title/i), { target: { value: "Ancient Gate" } });
    fireEvent.change(screen.getByLabelText(/Primary keys/i), { target: { value: "gate" } });
    fireEvent.change(screen.getByLabelText(/Entry content/i), {
      target: { value: "The gate only opens when the player speaks a remembered oath." },
    });
    fireEvent.click(screen.getByRole("button", { name: /Add lorebook entry/i }));

    expect(screen.getByText(/Ancient Gate/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Export Chub JSON/i })).toBeInTheDocument();
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
  });

  it("imports Chub-compatible lorebooks into the active card from the global lorebook tab", async () => {
    await renderApp();

    openBlankRpgCard();
    fireEvent.click(screen.getByRole("button", { name: /^Lorebooks$/i }));
    expect(screen.getByRole("region", { name: /Stored lorebooks/i })).toBeInTheDocument();

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

    fireEvent.click(screen.getByRole("button", { name: /^Runtime$/i }));
    fireEvent.change(screen.getByLabelText(/Message input/i), { target: { value: "I inspect the silver gate." } });
    openCardEditorTab(/rules/i);
    expect(screen.getByLabelText(/Prompt debugger/i)).toHaveTextContent(/Silver Gate/i);
    expect(screen.getByLabelText(/Prompt debugger/i)).toHaveTextContent(/remembered names/i);
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

  it("persists runtime settings into prompt construction", async () => {
    await renderApp();

    fireEvent.click(screen.getByRole("button", { name: /^Settings$/i }));
    fireEvent.click(screen.getByLabelText(/Ban emojis/i));
    fireEvent.change(screen.getByLabelText(/Impersonation prompt/i), {
      target: { value: "The user is a cautious cartographer who avoids rash promises." },
    });

    expect(screen.getByRole("region", { name: /Settings prompt preview/i })).toHaveTextContent(/Do not use emojis/i);
    openCardEditorTab(/rules/i);
    const promptDebugger = screen.getByLabelText(/Prompt debugger/i);
    expect(promptDebugger).toHaveTextContent(/Do not include emojis/i);
    expect(promptDebugger).toHaveTextContent(/cautious cartographer/i);
  });

  it("creates and edits richer character card definition fields", async () => {
    await renderApp();

    const createCardPanel = startCreatingCard();
    fireEvent.change(within(createCardPanel).getByLabelText(/^Name$/i), { target: { value: "Archivist" } });
    fireEvent.change(within(createCardPanel).getByLabelText(/Character name/i), { target: { value: "Mara Vell" } });
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
      target: { value: "User: What is missing?\nMara: The map that should not exist." },
    });
    fireEvent.click(within(createCardPanel).getByRole("button", { name: /^Create card$/i }));

    openCards();
    fireEvent.click(screen.getByRole("tab", { name: /instructions/i }));
    expect(screen.getByDisplayValue(/Mara Vell/i)).toBeInTheDocument();
    expect(screen.getByDisplayValue(/forbidden map/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: /rules/i }));
    const promptDebugger = screen.getByLabelText(/Prompt debugger/i);
    expect(promptDebugger).toHaveTextContent(/Mara Vell/i);
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

  it("generates an editable birdseye image prompt for the blank RPG card", async () => {
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
              mapStyle: "clean tabletop map",
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
                  "You stand in a moonlit plain near standing stones. This extra sentence is intentionally long and should not be copied wholesale into the map prompt because the map generator only needs the visual requirements and spatial landmarks.",
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
    fireEvent.click(screen.getByRole("button", { name: /Draft map prompt/i }));

    const prompt = screen.getByRole("textbox", { name: /Image prompt/i }) as HTMLTextAreaElement;
    await waitFor(() => expect(prompt.value).toMatch(/Moonlit plain/i));
    expect(prompt.value).toMatch(/top-down birdseye view/i);
    expect(prompt.value).toMatch(/1000 feet/i);
    expect(prompt.value).toMatch(/standing stones/i);
    expect(prompt.value).not.toMatch(/intentionally long and should not be copied wholesale/i);
    const negativePrompt = screen.getByRole("textbox", { name: /Negative prompt/i }) as HTMLTextAreaElement;
    expect(negativePrompt.value).toMatch(/people/i);
    expect(negativePrompt.value).toMatch(/single figure/i);
    expect(negativePrompt.value).toMatch(/first-person view/i);
    expect(screen.getByRole("button", { name: /Generate map image/i })).not.toBeDisabled();
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
      fireEvent.click(screen.getByRole("button", { name: /Draft map prompt/i }));

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

    await waitFor(() => expect(screen.getByRole("region", { name: /Generated map/i })).toHaveTextContent("Model B"));
    expect(screen.getByRole("region", { name: /Generated map/i })).not.toHaveTextContent("Model A");
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

    const generatedMap = await screen.findByRole("region", { name: /Generated map/i });
    expect(generatedMap).toHaveTextContent("Fresh Model");
    expect(generatedMap).not.toHaveTextContent("Stale Model");
    expect(screen.getByAltText(/Generated map/i)).toHaveAttribute("src", expect.stringContaining("lc_run=fresh-map"));
  });

  it("surfaces a new map prompt draft separately from the existing generated map", async () => {
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

    const mapGenerator = screen.getByRole("region", { name: /Map generator/i });
    expect(within(mapGenerator).getByRole("region", { name: /Generated map/i })).toHaveTextContent("Old Model");
    fireEvent.click(within(mapGenerator).getByRole("button", { name: /Draft map prompt/i }));

    const promptDraft = await within(mapGenerator).findByRole("region", { name: /Map prompt draft/i });
    expect(promptDraft).toHaveTextContent(/Generate map image/i);
    expect((within(mapGenerator).getByLabelText(/Image prompt/i) as HTMLTextAreaElement).value).toMatch(/new ridge/i);
    expect(within(mapGenerator).getByRole("button", { name: /Regenerate map image/i })).not.toBeDisabled();
  });

  it("lets users reset, generate, and delete the current map", async () => {
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

    const mapGenerator = screen.getByRole("region", { name: /Map generator/i });
    expect(within(mapGenerator).getByRole("region", { name: /Generated map/i })).toHaveTextContent("test-image-model");

    fireEvent.click(within(mapGenerator).getByRole("button", { name: /Delete map/i }));
    await waitFor(() =>
      expect(within(mapGenerator).queryByRole("region", { name: /Generated map/i })).not.toBeInTheDocument(),
    );

    const mapPrompt = within(mapGenerator).getByLabelText(/Image prompt/i) as HTMLTextAreaElement;
    const mapNegativePrompt = within(mapGenerator).getByLabelText(/Negative prompt/i) as HTMLTextAreaElement;
    fireEvent.change(mapPrompt, { target: { value: "top-down map prompt" } });
    fireEvent.change(mapNegativePrompt, { target: { value: "people" } });
    fireEvent.click(within(mapGenerator).getByRole("button", { name: /Reset map prompt/i }));
    expect(mapPrompt).toHaveValue("");
    expect(mapNegativePrompt).toHaveValue("");

    fireEvent.change(mapPrompt, { target: { value: "top-down map prompt" } });
    fireEvent.click(within(mapGenerator).getByRole("button", { name: /Generate map image/i }));
    await waitFor(() =>
      expect(within(mapGenerator).getByRole("region", { name: /Generated map/i })).toHaveTextContent("prompt-only"),
    );
  });

  it("restores a saved map prompt and refreshes the map image when regenerating", async () => {
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
            prompt: "saved top-down map prompt",
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

      const mapGenerator = screen.getByRole("region", { name: /Map generator/i });
      expect(within(mapGenerator).getByRole("button", { name: /Draft map prompt/i })).toBeInTheDocument();
      const prompt = within(mapGenerator).getByLabelText(/Image prompt/i) as HTMLTextAreaElement;
      expect(prompt).toHaveValue("saved top-down map prompt");
      const oldMapImage = within(mapGenerator).getByAltText(/Generated map/i);
      const oldMapSrc = oldMapImage.getAttribute("src");

      fireEvent.click(within(mapGenerator).getByRole("button", { name: /Regenerate map image/i }));
      await waitFor(() => expect(promptQueueCount).toBe(1));
      const refreshedMapImage = within(mapGenerator).getByAltText(/Generated map/i);
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

    const imageGenerator = screen.getByRole("region", { name: /Image generator/i });
    expect(imageGenerator).toHaveTextContent(/realistic, 4k/i);
    fireEvent.change(within(imageGenerator).getByLabelText(/Image request/i), {
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

      const imageGenerator = screen.getByRole("region", { name: /Image generator/i });
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

      const imageGenerator = screen.getByRole("region", { name: /Image generator/i });
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
        ],
        savedAt: "2026-06-30T00:00:00.000Z",
      }),
    );

    await renderApp();
    openBlankRpgCard();

    const mapGenerator = screen.getByRole("region", { name: /Map generator/i });
    fireEvent.click(within(mapGenerator).getByRole("button", { name: /Maximize map/i }));
    const mapPreview = screen.getByRole("dialog", { name: /Generated map preview/i });
    expect(within(mapPreview).getByAltText(/Generated map preview/i)).toHaveAttribute(
      "src",
      expect.stringContaining("lc_run=max-map"),
    );
    fireEvent.click(within(mapPreview).getByRole("button", { name: /Close media preview/i }));
    expect(screen.queryByRole("dialog", { name: /Generated map preview/i })).not.toBeInTheDocument();

    const imageGenerator = screen.getByRole("region", { name: /Image generator/i });
    fireEvent.click(within(imageGenerator).getByRole("button", { name: /Maximize image/i }));
    const imagePreview = screen.getByRole("dialog", { name: /Generated custom image preview/i });
    expect(within(imagePreview).getByAltText(/Generated custom image preview/i)).toHaveAttribute(
      "src",
      expect.stringContaining("lc_run=max-photo"),
    );
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
