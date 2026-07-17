import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { RUNTIME_STORAGE_KEY } from "../../src/app/localRuntimeStore";

const repositoryCreateMock = vi.hoisted(() => vi.fn());
const tauriInvokeMock = vi.hoisted(() =>
  vi.fn(async () => {
    throw new Error("Tauri unavailable");
  }),
);

vi.mock("../../src/app/runtimeRepositoryStore", () => ({
  RuntimeRepositoryStore: {
    create: repositoryCreateMock,
  },
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: tauriInvokeMock,
}));

import { App } from "../../src/app/App";

function createRepositorySnapshot(overrides: Record<string, unknown> = {}) {
  return {
    version: 2,
    theme: "dark",
    activeCardId: "card_repository",
    cards: [
      {
        id: "card_repository",
        name: "Repository Runtime Card",
        kind: "rpg",
        summary: "Loaded from the mocked repository.",
        systemPrompt: "Run the repository card.",
        preHistoryInstructions: "",
        postHistoryInstructions: "",
        playerRules: [],
        lorebooks: [],
        memory: [],
        mapEnabled: true,
        storyEntities: [],
        rpg: {
          location: "Repository hall",
          health: "steady",
          inventory: [],
          quests: [],
          flags: {},
          knownPlaces: ["Repository hall"],
          mapStyle: "map",
        },
      },
    ],
    messages: [],
    chatSessions: [
      {
        id: "chat_repository",
        cardId: "card_repository",
        title: "Repository chat",
        createdAt: "2026-07-01T00:00:00.000Z",
        updatedAt: "2026-07-01T00:00:00.000Z",
        messages: [],
      },
    ],
    activeChatIds: {
      card_repository: "chat_repository",
    },
    promptRuns: [],
    providerKeyStatus: "No plaintext keys stored.",
    savedAt: "2026-07-02T00:00:00.000Z",
    ...overrides,
  };
}

describe("App repository integration branches", () => {
  beforeEach(() => {
    repositoryCreateMock.mockReset();
    tauriInvokeMock.mockReset();
    tauriInvokeMock.mockImplementation(async () => {
      throw new Error("Tauri unavailable");
    });
  });

  it("hydrates from a newer SQLite repository snapshot and reports SQLite saves", async () => {
    const saveSnapshot = vi.fn(async () => undefined);
    repositoryCreateMock.mockResolvedValue({
      getStatus: () => ({ backend: "tauri-sqlite" }),
      loadSnapshot: vi.fn(async () => createRepositorySnapshot()),
      saveSnapshot,
    });

    render(<App />);

    await screen.findByText("SQLite repository ready.");
    await screen.findByRole("heading", { name: /Repository Runtime Card/i });
    await waitFor(() => expect(screen.getByText("Saved to local SQLite repository.")).toBeInTheDocument());
    expect(saveSnapshot).toHaveBeenCalledWith(expect.objectContaining({ activeCardId: "card_repository" }));
  });

  it("keeps the browser fallback and reports repository save failures", async () => {
    repositoryCreateMock.mockResolvedValue({
      getStatus: () => ({ backend: "in-memory-sqlite" }),
      loadSnapshot: vi.fn(async () => null),
      saveSnapshot: vi.fn(async () => {
        throw new Error("disk full");
      }),
    });

    render(<App />);

    await screen.findByText("Repository API ready with local browser storage.");
    await waitFor(() =>
      expect(screen.getByText("Local fallback saved; repository save failed: disk full")).toBeInTheDocument(),
    );
  });

  it("reports desktop repository save failures without claiming a browser fallback", async () => {
    const previousTauriInternals = Object.getOwnPropertyDescriptor(window, "__TAURI_INTERNALS__");
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      value: {},
      configurable: true,
    });
    repositoryCreateMock.mockResolvedValue({
      getStatus: () => ({ backend: "tauri-sqlite" }),
      loadSnapshot: vi.fn(async () => null),
      saveSnapshot: vi.fn(async () => {
        throw new Error("desktop disk full");
      }),
    });

    try {
      render(<App />);

      await screen.findByText("SQLite repository ready.");
      await waitFor(() =>
        expect(screen.getByText("Repository save failed: desktop disk full")).toBeInTheDocument(),
      );
    } finally {
      if (previousTauriInternals) {
        Object.defineProperty(window, "__TAURI_INTERNALS__", previousTauriInternals);
      } else {
        delete (window as Window & { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
      }
    }
  });

  it("ignores repository creation that resolves after unmount", async () => {
    let resolveCreate!: (store: {
      getStatus: () => { backend: "in-memory-sqlite" };
      loadSnapshot: () => Promise<null>;
      saveSnapshot: () => Promise<void>;
    }) => void;
    repositoryCreateMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveCreate = resolve;
        }),
    );

    const { unmount } = render(<App />);
    unmount();
    resolveCreate({
      getStatus: () => ({ backend: "in-memory-sqlite" }),
      loadSnapshot: async () => null,
      saveSnapshot: async () => undefined,
    });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(repositoryCreateMock).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem(RUNTIME_STORAGE_KEY)).toContain("card_blank_slate_rpg");
  });
});
