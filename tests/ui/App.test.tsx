import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

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
    expect(within(comfyModelSelect).getByRole("option", { name: /Juggernaut XL/i })).toBeInTheDocument();
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
    await renderApp();

    openBlankRpgCard();
    fireEvent.click(screen.getByRole("button", { name: /Generate birdseye view/i }));

    const prompt = screen.getByRole("textbox", { name: /Image prompt/i }) as HTMLTextAreaElement;
    expect(prompt.value).toMatch(/Unmapped starting area/i);
    expect(prompt.value).toMatch(/top-down birdseye view/i);
    expect(screen.getByRole("button", { name: /Send to image provider/i })).not.toBeDisabled();
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

    await waitFor(() => expect(screen.getByRole("region", { name: /Generated image/i })).toHaveTextContent("Model B"));
    expect(screen.getByRole("region", { name: /Generated image/i })).not.toHaveTextContent("Model A");
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
