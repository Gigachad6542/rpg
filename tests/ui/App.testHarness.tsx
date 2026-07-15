import {
  fireEvent as testingFireEvent,
  render,
  screen as testingScreen,
  waitFor as testingWaitFor,
  within as testingWithin,
} from "@testing-library/react";
import { vi } from "vitest";

import { App } from "../../src/app/App";
import { RUNTIME_STORAGE_KEY as runtimeStorageKey } from "../../src/app/localRuntimeStore";
import { LOCAL_RESTORE_POINTS_KEY as localRestorePointsKey } from "../../src/app/localRestorePointStore";
import { buildVersionedRuntimeExport as buildRuntimeExport } from "../../src/app/runtimeDataBundle";
import type { ModelCallRecord } from "../../src/app/runtimeTypes";
import * as memoryConsolidationModule from "../../src/runtime/memoryConsolidation";
import * as providerConfigModule from "../../src/app/providerConfig";
import type {
  ModelInfo,
  TextGenerationRequest,
  TextGenerationResponse,
  TextModelAdapter,
} from "../../src/providers/TextModelAdapter";

type TauriInvokeMock = (command: string, args?: Record<string, unknown>) => Promise<unknown>;

export const fireEvent = testingFireEvent;
export const screen = testingScreen;
export const waitFor = testingWaitFor;
export const within = testingWithin;
const viTools = vi;
export const RUNTIME_STORAGE_KEY = runtimeStorageKey;
export const LOCAL_RESTORE_POINTS_KEY = localRestorePointsKey;
export const buildVersionedRuntimeExport = buildRuntimeExport;
export const memoryConsolidation = memoryConsolidationModule;
export const providerConfig = providerConfigModule;

const tauriInvokeMock = vi.hoisted(() =>
  vi.fn<TauriInvokeMock>(async () => {
    throw new Error("Tauri unavailable");
  }),
);

vi.mock("@tauri-apps/api/core", () => ({
  invoke: tauriInvokeMock,
}));

export function openCards() {
  fireEvent.click(screen.getByRole("button", { name: /^Cards$/i }));
}

export function startCreatingCard() {
  openCards();
  const createCardPanel = screen.getByRole("region", { name: /Create card/i });
  fireEvent.click(within(createCardPanel).getByRole("button", { name: /Start creating card/i }));
  return createCardPanel;
}

export function openBlankRpgCard() {
  openCards();
  const cardLibrary = screen.getByRole("region", { name: /Card library/i });
  fireEvent.click(within(cardLibrary).getByRole("button", { name: /^Open$/i }));
}

export function openCardEditorTab(name: RegExp) {
  openCards();
  if (!screen.queryByRole("tab", { name })) {
    openBlankRpgCard();
    openCards();
  }
  fireEvent.click(screen.getByRole("tab", { name }));
}

export function openMediaTab(name: RegExp): void {
  // Media sections (aerial image, characters, image) are always visible now;
  // the tab-shortcut bar was removed, so this is a no-op kept for readability.
  void name;
}

export function sendRuntimeMessage(message: string) {
  if (!screen.queryByLabelText(/Message input/i)) {
    openBlankRpgCard();
  }
  fireEvent.change(screen.getByLabelText(/Message input/i), { target: { value: message } });
  fireEvent.click(screen.getByRole("button", { name: /^Send$/i }));
}

export async function renderApp() {
  const result = render(<App />);
  await screen.findByText(/Repository API ready|SQLite repository ready|Repository unavailable/i);
  return result;
}

export function seedRuntimeSnapshot(snapshotOverrides: Record<string, unknown> = {}, cardOverrides: Record<string, unknown> = {}) {
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

export function captureJsonDownloads() {
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

export function setTauriRuntimeForTest(): () => void {
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

export function resetTauriInvokeMock() {
  tauriInvokeMock.mockImplementation(async () => {
    throw new Error("Tauri unavailable");
  });
}

export function getTauriInvokeMock() {
  return tauriInvokeMock;
}

export { viTools as vi };
export type { ModelCallRecord, ModelInfo, TextGenerationRequest, TextGenerationResponse, TextModelAdapter };
