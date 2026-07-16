import { describe, expect, it } from "vitest";

import * as H from "./App.testHarness";

describe("local-first card runtime UI: chat-lore", () => {
  it("can shut down and restart the current runtime", async () => {
    await H.renderApp();

    H.openBlankRpgCard();
    H.fireEvent.click(H.screen.getByRole("button", { name: /Shut down runtime/i }));
    expect(H.screen.getByRole("region", { name: /Runtime stopped/i })).toBeInTheDocument();
    expect(H.screen.getByRole("button", { name: /^Send$/i })).toBeDisabled();
    H.fireEvent.submit(H.screen.getByRole("form", { name: /Message composer/i }));
    expect(H.screen.getByText(/Runtime is shut down\. Start the runtime before generating another turn/i)).toBeInTheDocument();

    H.fireEvent.click(H.screen.getAllByRole("button", { name: /Start runtime/i })[0]);
    expect(H.screen.queryByRole("region", { name: /Runtime stopped/i })).not.toBeInTheDocument();
    H.fireEvent.change(H.screen.getByLabelText(/Message input/i), { target: { value: "I continue." } });
    expect(H.screen.getByRole("button", { name: /^Send$/i })).not.toBeDisabled();
  });

  it("sends chat messages with Enter while keeping Shift+Enter for multiline drafts", async () => {
    await H.renderApp();

    H.openBlankRpgCard();
    const input = H.screen.getByLabelText(/Message input/i);
    const transcript = H.screen.getByRole("log", { name: /Chat transcript/i });
    H.fireEvent.change(input, { target: { value: "I look around" } });
    H.fireEvent.keyDown(input, { key: "Enter", code: "Enter", shiftKey: true });
    expect(H.within(transcript).queryByText("I look around")).not.toBeInTheDocument();

    H.fireEvent.keyDown(input, { key: "Enter", code: "Enter" });

    await H.waitFor(() => expect(H.within(transcript).getByText("I look around")).toBeInTheDocument());
    expect(H.screen.getByLabelText(/Message input/i)).toHaveValue("");
  });

  it("handles wheel zoom, chat selection, write-for-me, and memory drawer escape", async () => {
    const scrollBySpy = H.vi.spyOn(window, "scrollBy").mockImplementation(() => undefined);
    const scrollingDescriptor = Object.getOwnPropertyDescriptor(document, "scrollingElement");
    Object.defineProperty(document, "scrollingElement", {
      value: null,
      configurable: true,
    });

    try {
      await H.renderApp();

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
      H.fireEvent.wheel(child, { metaKey: true, deltaX: 2, deltaY: 9 });
      expect(scroller.scrollTop).toBe(9);
      expect(scroller.scrollLeft).toBe(2);
      scroller.remove();

      H.openBlankRpgCard();
      H.fireEvent.click(H.screen.getByRole("button", { name: /Write for me/i }));
      expect((H.screen.getByLabelText(/Message input/i) as HTMLTextAreaElement).value).toMatch(
        /I look around Unmapped starting area/i,
      );

      H.sendRuntimeMessage("I inspect the first room.");
      await H.waitFor(() => expect(H.screen.getByRole("log", { name: /Chat transcript/i })).toHaveTextContent(/first room/i));
      const originalChatId = (H.screen.getByLabelText(/Active chat/i) as HTMLSelectElement).value;
      H.fireEvent.click(H.screen.getByRole("button", { name: /Branch chat/i }));
      H.fireEvent.click(H.screen.getByRole("button", { name: /New chat/i }));
      const chatSelect = H.screen.getByLabelText(/Active chat/i);
      expect(H.within(chatSelect).getAllByRole("option")).toHaveLength(3);
      H.fireEvent.change(chatSelect, { target: { value: originalChatId } });
      expect(H.screen.getByRole("log", { name: /Chat transcript/i })).toHaveTextContent(/first room/i);
      expect(H.screen.getByLabelText(/Message input/i)).toHaveValue("");

      H.fireEvent.click(H.screen.getByRole("button", { name: /Inspect memory/i }));
      expect(H.screen.getByRole("dialog", { name: /Memory inspector/i })).toBeInTheDocument();
      H.fireEvent.keyDown(document, { key: "Escape", code: "Escape" });
      expect(H.screen.queryByRole("dialog", { name: /Memory inspector/i })).not.toBeInTheDocument();
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
    await H.renderApp();

    H.sendRuntimeMessage("I inspect the first room.");
    await H.waitFor(() => expect(H.screen.getByRole("log", { name: /Chat transcript/i })).toHaveTextContent(/first room/i));

    H.fireEvent.click(H.screen.getByRole("button", { name: /Branch chat/i }));
    expect(H.within(H.screen.getByLabelText(/Active chat/i)).getAllByRole("option")).toHaveLength(2);
    expect(H.screen.getByRole("log", { name: /Chat transcript/i })).toHaveTextContent(/first room/i);

    H.fireEvent.click(H.screen.getByRole("button", { name: /New chat/i }));
    expect(H.within(H.screen.getByLabelText(/Active chat/i)).getAllByRole("option")).toHaveLength(3);
    expect(H.screen.getByLabelText(/Card opening/i)).toHaveClass("message", "response");

    H.fireEvent.click(H.screen.getByRole("button", { name: /Delete chat/i }));
    expect(H.within(H.screen.getByLabelText(/Active chat/i)).getAllByRole("option")).toHaveLength(3);
    H.fireEvent.click(H.screen.getByRole("button", { name: /Confirm delete chat/i }));
    expect(H.within(H.screen.getByLabelText(/Active chat/i)).getAllByRole("option")).toHaveLength(2);

    H.openCards();
    const createCardPanel = H.startCreatingCard();
    H.fireEvent.change(H.within(createCardPanel).getByLabelText(/^Name$/i), { target: { value: "Temporary Card" } });
    H.fireEvent.click(H.within(createCardPanel).getByRole("button", { name: /^Create card$/i }));

    H.openCards();
    const cardLibrary = H.screen.getByRole("region", { name: /Card library/i });
    const cardRow = H.within(cardLibrary).getByText("Temporary Card").closest(".card-row") as HTMLElement;
    H.fireEvent.click(H.within(cardRow).getByRole("button", { name: /Delete/i }));
    expect(H.within(cardLibrary).getByText("Temporary Card")).toBeInTheDocument();
    H.fireEvent.click(H.within(cardRow).getByRole("button", { name: /Confirm delete Temporary Card/i }));
    expect(H.within(cardLibrary).queryByText("Temporary Card")).not.toBeInTheDocument();
  });

  it("keeps branch history message IDs unique across persisted chat sessions", async () => {
    await H.renderApp();

    H.sendRuntimeMessage("I inspect the first room.");
    await H.waitFor(() => expect(H.screen.getByRole("log", { name: /Chat transcript/i })).toHaveTextContent(/first room/i));

    H.fireEvent.click(H.screen.getByRole("button", { name: /Branch chat/i }));

    await H.waitFor(() => {
      const snapshot = JSON.parse(window.localStorage.getItem(H.RUNTIME_STORAGE_KEY) ?? "{}") as {
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
    await H.renderApp();

    H.openBlankRpgCard();
    H.sendRuntimeMessage("I inspect the blank card room.");
    await H.waitFor(() => expect(H.screen.getByRole("log", { name: /Chat transcript/i })).toHaveTextContent(/blank card room/i));

    const createCardPanel = H.startCreatingCard();
    H.fireEvent.change(H.within(createCardPanel).getByLabelText(/^Name$/i), { target: { value: "Second Card" } });
    H.fireEvent.click(H.within(createCardPanel).getByRole("button", { name: /^Create card$/i }));

    H.sendRuntimeMessage("I inspect the second card room.");
    await H.waitFor(() => expect(H.screen.getByRole("log", { name: /Chat transcript/i })).toHaveTextContent(/second card room/i));

    H.openCards();
    const cardLibrary = H.screen.getByRole("region", { name: /Card library/i });
    const blankRow = H.within(cardLibrary).getByText("Blank Slate RPG").closest(".card-row") as HTMLElement;
    H.fireEvent.click(H.within(blankRow).getByRole("button", { name: /Delete/i }));
    H.fireEvent.click(H.within(blankRow).getByRole("button", { name: /Confirm delete Blank Slate RPG/i }));

    H.sendRuntimeMessage("I inspect another second card room.");
    await H.waitFor(() =>
      expect(H.screen.getByRole("log", { name: /Chat transcript/i })).toHaveTextContent(/another second card room/i),
    );

    await H.waitFor(() => {
      const snapshot = JSON.parse(window.localStorage.getItem(H.RUNTIME_STORAGE_KEY) ?? "{}") as {
        promptRuns?: Array<{ id?: string }>;
      };
      const runIds = (snapshot.promptRuns ?? []).map((run) => run.id).filter(Boolean);
      expect(runIds.length).toBeGreaterThan(1);
      expect(new Set(runIds).size).toBe(runIds.length);
    });
  });

  it("does not persist full compiled prompts unless prompt debug logs are enabled", async () => {
    await H.renderApp();

    H.openBlankRpgCard();
    H.sendRuntimeMessage("I inspect the private room.");
    await H.waitFor(() => expect(H.screen.getByRole("log", { name: /Chat transcript/i })).toHaveTextContent(/private room/i));

    await H.waitFor(() => {
      const snapshot = JSON.parse(window.localStorage.getItem(H.RUNTIME_STORAGE_KEY) ?? "{}") as {
        promptRuns?: Array<{ compiledPrompt?: string; includedLayerIds?: string[] }>;
      };
      expect(snapshot.promptRuns?.[0]?.includedLayerIds?.length).toBeGreaterThan(0);
      expect(snapshot.promptRuns?.[0]?.compiledPrompt).toBe("");
    });

    H.fireEvent.click(H.screen.getByRole("button", { name: /Settings/i }));
    H.fireEvent.click(H.screen.getByLabelText(/Prompt debug logs/i));

    H.sendRuntimeMessage("I inspect the logged room.");
    await H.waitFor(() => expect(H.screen.getByRole("log", { name: /Chat transcript/i })).toHaveTextContent(/logged room/i));

    await H.waitFor(() => {
      const snapshot = JSON.parse(window.localStorage.getItem(H.RUNTIME_STORAGE_KEY) ?? "{}") as {
        promptRuns?: Array<{ compiledPrompt?: string }>;
      };
      expect(snapshot.promptRuns?.slice(-1)[0]?.compiledPrompt).toContain("I inspect the logged room.");
    });
  });

  it("surfaces validation for required creation fields", async () => {
    await H.renderApp();

    H.openCards();
    const createCardPanel = H.startCreatingCard();
    H.fireEvent.click(H.within(createCardPanel).getByRole("button", { name: /^Create card$/i }));
    expect(H.within(createCardPanel).getByRole("alert")).toHaveTextContent(/card name/i);

    H.openCardEditorTab(/lorebooks/i);
    H.fireEvent.click(H.screen.getByRole("button", { name: /Add lorebook entry/i }));
    expect(H.screen.getAllByRole("alert").some((alert) => /entry content/i.test(alert.textContent ?? ""))).toBe(true);
  });

  it("adds, searches, exports, and includes triggered lore in the prompt debugger", async () => {
    const downloads = H.captureJsonDownloads();

    try {
      await H.renderApp();

      H.openCardEditorTab(/lorebooks/i);
      H.fireEvent.change(H.screen.getByLabelText(/Entry title/i), { target: { value: "Ancient Gate" } });
      H.fireEvent.change(H.screen.getByLabelText(/Primary keys/i), { target: { value: "gate" } });
      H.fireEvent.change(H.screen.getByLabelText(/Entry content/i), {
        target: { value: "The gate only opens when the player speaks a remembered oath." },
      });
      H.fireEvent.click(H.screen.getByRole("button", { name: /Add lorebook entry/i }));

      expect(H.screen.getByText(/Ancient Gate/i)).toBeInTheDocument();
      H.fireEvent.click(H.screen.getByRole("button", { name: /Export Chub JSON/i }));
      expect(downloads.clickedDownloads).toEqual([expect.stringMatching(/^card-lorebook-chub-lorebook\.json$/)]);
      expect(downloads.createObjectUrl).toHaveBeenCalledTimes(1);
      expect(downloads.revokeObjectUrl).toHaveBeenCalledTimes(1);
      H.fireEvent.change(H.screen.getByLabelText(/Search lorebook entries/i), { target: { value: "missing" } });
      expect(H.screen.queryByText(/Ancient Gate/i)).not.toBeInTheDocument();
      expect(H.screen.getByText(/No lorebook entries match this search/i)).toBeInTheDocument();
      H.fireEvent.change(H.screen.getByLabelText(/Search lorebook entries/i), { target: { value: "gate" } });
      expect(H.screen.getByText(/Ancient Gate/i)).toBeInTheDocument();

      H.fireEvent.click(H.screen.getByRole("button", { name: /^Runtime$/i }));
      H.fireEvent.change(H.screen.getByLabelText(/Message input/i), { target: { value: "I inspect the gate." } });
      H.openCardEditorTab(/rules/i);

      const promptDebugger = H.screen.getByLabelText(/Prompt debugger/i);
      expect(promptDebugger).toHaveTextContent(/Active lorebook entries/i);
      expect(promptDebugger).toHaveTextContent(/Ancient Gate/i);
      expect(promptDebugger).toHaveTextContent(/remembered oath/i);
    } finally {
      downloads.restore();
    }
  });

  it("switches between multiple card lorebooks in the card editor", async () => {
    await H.renderApp();
    H.openCardEditorTab(/lorebooks/i);
    let lorePanel = H.screen.getByRole("region", { name: /^Lorebooks$/i });
    H.fireEvent.change(H.within(lorePanel).getByLabelText(/^Entry title$/i), { target: { value: "First Gate" } });
    H.fireEvent.change(H.within(lorePanel).getByLabelText(/^Primary keys$/i), { target: { value: "first gate" } });
    H.fireEvent.change(H.within(lorePanel).getByLabelText(/^Entry content$/i), {
      target: { value: "The first gate opens at dawn." },
    });
    H.fireEvent.click(H.within(lorePanel).getByRole("button", { name: /Add lorebook entry/i }));

    H.fireEvent.click(H.screen.getByRole("button", { name: /^Lorebooks$/i }));
    H.fireEvent.change(H.screen.getByLabelText(/Chub lorebook JSON/i), {
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
    H.fireEvent.click(H.screen.getByRole("button", { name: /Import to active card/i }));

    H.openCardEditorTab(/lorebooks/i);
    lorePanel = H.screen.getByRole("region", { name: /^Lorebooks$/i });
    const selector = H.within(lorePanel).getByLabelText(/^Lorebook$/i) as HTMLSelectElement;
    const targetOption = (H.within(selector).getAllByRole("option") as HTMLOptionElement[]).find((option) =>
      /Second Lore/i.test(option.textContent ?? ""),
    );
    expect(targetOption).toBeDefined();

    H.fireEvent.change(selector, { target: { value: targetOption?.value } });

    expect(selector).toHaveDisplayValue("Second Lore");
    expect(H.within(lorePanel).getByLabelText(/^Lorebook name$/i)).toHaveValue("Second Lore");
    expect(H.within(lorePanel).getByLabelText(/^Scan depth$/i)).toHaveValue(8);
    expect(H.within(lorePanel).getByText("Moon Gate")).toBeInTheDocument();
    expect(H.within(lorePanel).getByText("moon gate")).toBeInTheDocument();
  });

  it("imports Chub-compatible lorebooks into the active card from the global lorebook tab", async () => {
    const downloads = H.captureJsonDownloads();

    try {
      await H.renderApp();

      H.openBlankRpgCard();
      H.fireEvent.click(H.screen.getByRole("button", { name: /^Lorebooks$/i }));
      const library = H.screen.getByRole("region", { name: /Stored lorebooks/i });
      expect(library).toBeInTheDocument();

      H.fireEvent.change(H.screen.getByLabelText(/Chub lorebook JSON/i), {
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
      H.fireEvent.click(H.screen.getByRole("button", { name: /Import to active card/i }));

      expect(H.screen.getByText(/Imported Imported Gate Lore into Blank Slate RPG/i)).toBeInTheDocument();
      expect(H.screen.getAllByText(/Imported Gate Lore/i).length).toBeGreaterThanOrEqual(1);
      expect(H.screen.getByText(/Silver Gate/i)).toBeInTheDocument();
      H.fireEvent.change(H.within(library).getByLabelText(/Search stored lorebooks/i), { target: { value: "silver gate" } });
      expect(H.within(library).getByText(/Imported Gate Lore/i)).toBeInTheDocument();
      H.fireEvent.click(H.within(library).getByLabelText(/Enabled for Blank Slate RPG/i));
      expect(H.within(library).getByText(/^disabled$/i)).toBeInTheDocument();
      H.fireEvent.click(H.within(library).getByLabelText(/Enabled for Blank Slate RPG/i));
      expect(H.within(library).getByText(/^enabled$/i)).toBeInTheDocument();
      H.fireEvent.click(H.within(library).getByRole("button", { name: /Export Chub JSON/i }));
      expect(downloads.clickedDownloads).toEqual([expect.stringMatching(/^imported-gate-lore-chub-lorebook\.json$/)]);
      H.fireEvent.click(H.within(library).getByRole("button", { name: /Open card/i }));
      expect(H.screen.getByRole("heading", { name: /Blank Slate RPG/i })).toBeInTheDocument();

      H.fireEvent.click(H.screen.getByRole("button", { name: /^Runtime$/i }));
      H.fireEvent.change(H.screen.getByLabelText(/Message input/i), { target: { value: "I inspect the silver gate." } });
      H.openCardEditorTab(/rules/i);
      expect(H.screen.getByLabelText(/Prompt debugger/i)).toHaveTextContent(/Silver Gate/i);
      expect(H.screen.getByLabelText(/Prompt debugger/i)).toHaveTextContent(/remembered names/i);
    } finally {
      downloads.restore();
    }
  });

  it("uploads Chub lorebook JSON files and exposes imported lorebooks through a selector", async () => {
    await H.renderApp();

    H.openBlankRpgCard();
    H.fireEvent.click(H.screen.getByRole("button", { name: /^Lorebooks$/i }));

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
    H.fireEvent.change(H.screen.getByLabelText(/Upload Chub lorebook file/i), { target: { files: [file] } });
    await H.waitFor(() =>
      expect((H.screen.getByLabelText(/Chub lorebook JSON/i) as HTMLTextAreaElement).value).toMatch(/Uploaded Chub Lore/i),
    );
    H.fireEvent.click(H.screen.getByRole("button", { name: /Import to active card/i }));

    H.openCardEditorTab(/lorebooks/i);
    expect((H.screen.getByLabelText(/^Lorebook$/i) as HTMLSelectElement).value).toMatch(/^lore_import_/);
    expect(H.screen.getAllByText(/Sun Door/i).length).toBeGreaterThan(0);
  });

  it("surfaces lorebook import edge cases without changing active lore", async () => {
    await H.renderApp();

    H.fireEvent.click(H.screen.getByRole("button", { name: /^Lorebooks$/i }));
    expect(H.screen.getByText(/Open a card from the library before importing a lorebook/i)).toBeInTheDocument();
    H.fireEvent.change(H.screen.getByLabelText(/Upload Chub lorebook file/i), { target: { files: [] } });

    H.openBlankRpgCard();
    H.fireEvent.click(H.screen.getByRole("button", { name: /^Lorebooks$/i }));
    H.fireEvent.change(H.screen.getByLabelText(/Chub lorebook JSON/i), {
      target: { value: "{bad json" },
    });
    H.fireEvent.click(H.screen.getByRole("button", { name: /Import to active card/i }));
    await H.waitFor(() => expect(H.screen.getByText(/Lorebook JSON is invalid/i)).toBeInTheDocument());

    const brokenFile = new File(["{}"], "broken-chub-lore.json", { type: "application/json" });
    Object.defineProperty(brokenFile, "text", {
      value: () => Promise.reject(new Error("Could not read test lorebook.")),
      configurable: true,
    });
    H.fireEvent.change(H.screen.getByLabelText(/Upload Chub lorebook file/i), { target: { files: [brokenFile] } });
    await H.waitFor(() => expect(H.screen.getByText(/Could not read test lorebook/i)).toBeInTheDocument());
  });

  it("persists runtime settings and the active persona prompt into prompt construction", async () => {
    await H.renderApp();
    H.openBlankRpgCard();

    H.fireEvent.click(H.screen.getByRole("button", { name: /^Settings$/i }));
    H.fireEvent.click(H.screen.getByLabelText(/Ban emojis/i));

    H.fireEvent.click(H.screen.getByRole("button", { name: /^Personas$/i }));
    const personaPanel = H.screen.getByRole("region", { name: /Persona profiles/i });
    H.fireEvent.change(H.within(personaPanel).getByLabelText(/New persona name/i), { target: { value: "Mara" } });
    H.fireEvent.click(H.within(personaPanel).getByRole("button", { name: /Create persona/i }));

    const personaEditor = H.screen.getByRole("region", { name: /Persona editor/i });
    H.fireEvent.change(H.within(personaEditor).getByLabelText(/Persona prompt/i), {
      target: { value: "The user is a cautious cartographer who avoids rash promises." },
    });

    H.fireEvent.click(H.screen.getByRole("button", { name: /^Settings$/i }));
    const settingsPreview = H.screen.getByRole("region", { name: /Settings prompt preview/i });
    expect(settingsPreview).toHaveTextContent(/Trusted system instructions/i);
    expect(settingsPreview).toHaveTextContent(/User context/i);
    expect(settingsPreview).toHaveTextContent(/Do not include emojis/i);
    expect(settingsPreview).toHaveTextContent(/cautious cartographer/i);
    H.openCardEditorTab(/rules/i);
    const promptDebugger = H.screen.getByLabelText(/Prompt debugger/i);
    expect(promptDebugger).toHaveTextContent(/Do not include emojis/i);
    expect(promptDebugger).toHaveTextContent(/cautious cartographer/i);
  });

  it("creates a persona, switches to it from the chat header, and fires its lorebook into the prompt", async () => {
    await H.renderApp();
    H.openBlankRpgCard();

    H.fireEvent.click(H.screen.getByRole("button", { name: /^Personas$/i }));
    const personaPanel = H.screen.getByRole("region", { name: /Persona profiles/i });
    H.fireEvent.change(H.within(personaPanel).getByLabelText(/New persona name/i), { target: { value: "Mara" } });
    H.fireEvent.click(H.within(personaPanel).getByRole("button", { name: /Create persona/i }));

    const personaEditor = H.screen.getByRole("region", { name: /Persona editor/i });
    H.fireEvent.change(H.within(personaEditor).getByLabelText(/Chub lorebook JSON/i), {
      target: {
        value: JSON.stringify({
          name: "Mara history",
          entries: [{ keys: ["coast"], content: "Mara grew up on the storm coast." }],
        }),
      },
    });
    H.fireEvent.click(H.within(personaEditor).getByRole("button", { name: /Attach lorebook/i }));
    expect(H.within(personaEditor).getByRole("status", { name: /Persona status/i })).toHaveTextContent(
      /Attached Mara history to Mara/i,
    );

    // Creating a persona makes it active, so the chat header quick-switch shows it.
    H.fireEvent.click(H.screen.getByRole("button", { name: /^Runtime$/i }));
    expect(H.screen.getByLabelText(/Active persona/i)).toHaveDisplayValue("Mara");

    H.fireEvent.change(H.screen.getByLabelText(/Message input/i), { target: { value: "I remember the coast." } });

    H.fireEvent.click(H.screen.getByRole("button", { name: /^Cards$/i }));
    H.openCardEditorTab(/rules/i);
    await H.waitFor(() =>
      expect(H.screen.getByLabelText(/Prompt debugger/i)).toHaveTextContent(/Mara grew up on the storm coast/i),
    );
  });

  it("captures a restore point immediately before persona deletion", async () => {
    await H.renderApp();
    H.fireEvent.click(H.screen.getByRole("button", { name: /^Personas$/i }));
    const personaPanel = H.screen.getByRole("region", { name: /Persona profiles/i });
    H.fireEvent.change(H.within(personaPanel).getByLabelText(/New persona name/i), { target: { value: "Mara" } });
    H.fireEvent.click(H.within(personaPanel).getByRole("button", { name: /Create persona/i }));
    H.fireEvent.click(H.within(personaPanel).getByRole("button", { name: /Delete Mara/i }));
    H.fireEvent.click(H.screen.getByRole("button", { name: /^Delete persona$/i }));

    await H.waitFor(() => {
      const points = JSON.parse(window.localStorage.getItem(H.LOCAL_RESTORE_POINTS_KEY) ?? "[]") as Array<{
        snapshot?: { personas?: Array<{ name?: string }> };
      }>;
      expect(points[0]?.snapshot?.personas?.some((persona) => persona.name === "Mara")).toBe(true);
    });
  });

  it("creates and edits richer character card definition fields", async () => {
    await H.renderApp();

    const createCardPanel = H.startCreatingCard();
    H.fireEvent.change(H.within(createCardPanel).getByLabelText(/^Name$/i), { target: { value: "Archivist" } });
    H.fireEvent.change(H.within(createCardPanel).getByLabelText(/Character name/i), { target: { value: "Archivist Vell" } });
    H.fireEvent.change(H.within(createCardPanel).getByLabelText(/Description/i), {
      target: { value: "A careful archivist with a dry sense of humor." },
    });
    H.fireEvent.change(H.within(createCardPanel).getByLabelText(/Scenario/i), {
      target: { value: "The archive has lost a forbidden map." },
    });
    H.fireEvent.change(H.within(createCardPanel).getByLabelText(/Greeting/i), {
      target: { value: "Keep your voice low. The index hears things." },
    });
    H.fireEvent.change(H.within(createCardPanel).getByLabelText(/Example dialogs/i), {
      target: { value: "User: What is missing?\nArchivist: The map that should not exist." },
    });
    H.fireEvent.click(H.within(createCardPanel).getByRole("button", { name: /^Create card$/i }));

    H.openCards();
    H.fireEvent.click(H.screen.getByRole("tab", { name: /instructions/i }));
    expect(H.screen.getByDisplayValue(/Archivist Vell/i)).toBeInTheDocument();
    expect(H.screen.getByDisplayValue(/forbidden map/i)).toBeInTheDocument();

    H.fireEvent.click(H.screen.getByRole("tab", { name: /rules/i }));
    const promptDebugger = H.screen.getByLabelText(/Prompt debugger/i);
    expect(promptDebugger).toHaveTextContent(/Archivist Vell/i);
    expect(promptDebugger).toHaveTextContent(/The archive has lost a forbidden map/i);
    expect(promptDebugger).toHaveTextContent(/The map that should not exist/i);
  });

  it("applies validated RPG proposals and reloads them from local storage", async () => {
    const { unmount } = await H.renderApp();

    H.sendRuntimeMessage("I head to the cellar and take the brass key.");

    await H.waitFor(() => expect(H.screen.getByRole("log", { name: /Chat transcript/i })).toHaveTextContent(/The action is checked/i));

    H.openCardEditorTab(/rpg/i);
    expect(H.screen.getAllByDisplayValue("Cellar").length).toBeGreaterThanOrEqual(1);
    expect(H.screen.getByDisplayValue(/brass key/i)).toBeInTheDocument();

    unmount();
    await H.renderApp();

    H.openCardEditorTab(/rpg/i);
    expect(H.screen.getAllByDisplayValue("Cellar").length).toBeGreaterThanOrEqual(1);
    expect(H.screen.getByDisplayValue(/brass key/i)).toBeInTheDocument();
  });

  it("shows provenance for turn state changes and can undo the active variant", async () => {
    await H.renderApp();

    H.sendRuntimeMessage("I head to the cellar and take the brass key.");

    const summary = await H.screen.findByText(/State changes \(.*applied/i);
    H.fireEvent.click(summary);
    expect(H.screen.getAllByText(/player action/i).length).toBeGreaterThan(0);
    H.fireEvent.click(H.screen.getByRole("button", { name: /Undo state changes/i }));

    expect(H.screen.getByText("State changes undone.")).toBeInTheDocument();
    expect(H.screen.getByText(/State changes undone for this response variant/i)).toBeInTheDocument();
    H.openCardEditorTab(/rpg/i);
    expect(H.screen.getAllByDisplayValue("Unmapped starting area").length).toBeGreaterThanOrEqual(1);
    expect(H.screen.queryByDisplayValue(/brass key/i)).not.toBeInTheDocument();
  });
});
