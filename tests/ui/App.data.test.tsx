import { describe, expect, it } from "vitest";

import * as H from "./App.testHarness";

describe("local-first card runtime UI: data", () => {
  it("imports versioned runtime exports from Settings", async () => {
    await H.renderApp();
    const bundle = H.buildVersionedRuntimeExport({
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

    H.fireEvent.click(H.screen.getByRole("button", { name: /^Settings$/i }));
    H.fireEvent.change(H.screen.getByLabelText(/Runtime export JSON/i), {
      target: { value: JSON.stringify(bundle) },
    });
    H.fireEvent.click(H.screen.getByRole("button", { name: /Review runtime import/i }));

    expect(H.screen.getByRole("status", { name: /Data management status/i })).toHaveTextContent(
      /Review before applying/i,
    );
    expect(H.screen.queryByRole("heading", { name: /Imported Runtime Card/i })).not.toBeInTheDocument();
    H.fireEvent.click(H.screen.getByRole("button", { name: /Apply reviewed import/i }));

    expect(H.screen.getByRole("status", { name: /Data management status/i })).toHaveTextContent(
      /Imported runtime export/i,
    );
    H.fireEvent.click(H.screen.getByRole("button", { name: /^Runtime$/i }));
    expect(H.screen.getByRole("heading", { name: /Imported Runtime Card/i })).toBeInTheDocument();
  });

  it("surfaces invalid runtime export imports from Settings", async () => {
    await H.renderApp();

    H.fireEvent.click(H.screen.getByRole("button", { name: /^Settings$/i }));
    H.fireEvent.change(H.screen.getByLabelText(/Runtime export JSON/i), {
      target: { value: "{bad json" },
    });
    H.fireEvent.click(H.screen.getByRole("button", { name: /Review runtime import/i }));

    expect(H.screen.getByRole("status", { name: /Data management status/i })).toHaveTextContent(
      /Runtime export JSON is invalid/i,
    );
  });

  it("exposes runtime export and redacted diagnostics downloads from Settings", async () => {
    Object.defineProperty(URL, "createObjectURL", {
      value: H.vi.fn(),
      configurable: true,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      value: H.vi.fn(),
      configurable: true,
    });
    const createObjectUrl = H.vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:rpg-test");
    const revokeObjectUrl = H.vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const clickedDownloads: string[] = [];
    const originalCreateElement = document.createElement.bind(document);
    H.vi.spyOn(document, "createElement").mockImplementation((tagName: string, options?: ElementCreationOptions) => {
      const element = originalCreateElement(tagName, options);
      if (tagName.toLowerCase() === "a") {
        H.vi.spyOn(element as HTMLAnchorElement, "click").mockImplementation(function click(this: HTMLAnchorElement) {
          clickedDownloads.push(this.download);
        });
      }
      return element;
    });

    await H.renderApp();
    H.fireEvent.click(H.screen.getByRole("button", { name: /^Settings$/i }));

    H.fireEvent.click(H.screen.getByRole("button", { name: /Export runtime data/i }));
    H.fireEvent.click(H.screen.getByRole("button", { name: /Download diagnostics/i }));

    expect(clickedDownloads).toEqual([
      expect.stringMatching(/^local-first-rpg-runtime-.+\.json$/),
      expect.stringMatching(/^local-first-rpg-diagnostics-.+\.json$/),
    ]);
    expect(createObjectUrl).toHaveBeenCalledTimes(2);
    expect(revokeObjectUrl).toHaveBeenCalledTimes(2);
  });

  it("starts the bundled RPG through a one-click offline mock demo", async () => {
    await H.renderApp();

    const onboarding = H.screen.getByRole("dialog", { name: /Welcome to Local-First RPG/i });
    H.fireEvent.click(H.within(onboarding).getByRole("button", { name: /Start mock demo/i }));

    expect(H.screen.getByRole("heading", { name: /Ashfall Crossing/i })).toBeInTheDocument();
    expect(H.screen.getByRole("log", { name: /Chat transcript/i })).toHaveTextContent(/Red ash hisses against the shutters/i);
    await H.waitFor(() => {
      const snapshot = JSON.parse(window.localStorage.getItem(H.RUNTIME_STORAGE_KEY) ?? "{}");
      expect(snapshot.activeCardId).toBe("card_ashfall_crossing");
      expect(snapshot.providerSettings?.mode).toBe("mock");
    });
  });

  it("filters the card library and populates the hidden creation form from a template", async () => {
    await H.renderApp();
    H.openCards();
    const cardLibrary = H.screen.getByRole("region", { name: /Card library/i });
    const createCardPanel = H.screen.getByRole("region", { name: /Create card/i });

    H.fireEvent.change(H.within(cardLibrary).getByLabelText(/Search cards/i), { target: { value: "Ashfall" } });
    expect(H.within(cardLibrary).getByText(/Ashfall Crossing/i)).toBeInTheDocument();
    expect(H.within(cardLibrary).queryByText(/Blank Slate RPG/i)).not.toBeInTheDocument();

    H.fireEvent.change(H.within(cardLibrary).getByLabelText(/Search cards/i), { target: { value: "" } });
    H.fireEvent.click(H.within(createCardPanel).getByRole("button", { name: /Choice-driven mystery/i }));
    expect(H.within(createCardPanel).getByLabelText(/^Name$/i)).toHaveValue("New Mystery");
    expect(H.within(createCardPanel).getByLabelText(/Card type/i)).toHaveValue("rpg");
  });

  it("renames, exports, archives, and restores a chat", async () => {
    const downloads = H.captureJsonDownloads();
    try {
      await H.renderApp();
      H.fireEvent.click(H.screen.getByRole("button", { name: /Start mock demo/i }));

      H.fireEvent.click(H.screen.getByRole("button", { name: /^Rename$/i }));
      H.fireEvent.change(H.screen.getByLabelText(/Chat name/i), { target: { value: "Bell Tower Lead" } });
      H.fireEvent.click(H.screen.getByRole("button", { name: /Save name/i }));
      expect(H.screen.getByLabelText(/Active chat/i)).toHaveDisplayValue("Bell Tower Lead");

      H.fireEvent.click(H.screen.getByRole("button", { name: /^Export$/i }));
      expect(downloads.clickedDownloads).toEqual([
        expect.stringMatching(/^local-first-rpg-chat-.+\.json$/),
      ]);

      H.fireEvent.click(H.screen.getByRole("button", { name: /^Archive$/i }));
      expect(H.screen.getByText(/Archived chats \(1\)/i)).toBeInTheDocument();
      H.fireEvent.click(H.screen.getByRole("button", { name: /Restore Bell Tower Lead/i }));
      expect(H.screen.getByLabelText(/Active chat/i)).toHaveDisplayValue("Bell Tower Lead");
      expect(H.screen.queryByText(/Archived chats \(1\)/i)).not.toBeInTheDocument();
    } finally {
      downloads.restore();
    }
  });

  it("windows long transcripts and stops forced follow when the player scrolls up", async () => {
    const messages = Array.from({ length: 130 }, (_, index) => ({
      id: `message_${index}`,
      role: index % 2 === 0 ? "user" : "assistant",
      content: `Transcript message ${index}`,
    }));
    H.seedRuntimeSnapshot(
      {
        chatSessions: [
          {
            id: "chat_seeded",
            cardId: "card_long_campaign",
            title: "Long campaign",
            createdAt: "2026-07-01T00:00:00.000Z",
            updatedAt: "2026-07-01T00:00:00.000Z",
            messages,
          },
        ],
      },
      { id: "card_long_campaign", name: "Long Campaign" },
    );

    await H.renderApp();
    const transcript = H.screen.getByRole("log", { name: /Chat transcript/i });
    expect(H.within(transcript).queryByText("Transcript message 0")).not.toBeInTheDocument();
    expect(H.within(transcript).getByText("Transcript message 129")).toBeInTheDocument();
    H.fireEvent.click(H.within(transcript).getByRole("button", { name: /Show earlier messages \(10 hidden\)/i }));
    expect(H.within(transcript).getByText("Transcript message 0")).toBeInTheDocument();

    Object.defineProperty(transcript, "scrollHeight", { configurable: true, value: 1_000 });
    Object.defineProperty(transcript, "clientHeight", { configurable: true, value: 300 });
    Object.defineProperty(transcript, "scrollTop", { configurable: true, writable: true, value: 100 });
    H.fireEvent.scroll(transcript);
    expect(H.within(transcript).getByRole("button", { name: /Jump to latest/i })).toBeInTheDocument();
  });
});
