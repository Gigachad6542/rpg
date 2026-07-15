import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { defaultProviderSettings, defaultRuntimeSettings, initialCards } from "../../src/app/appDefaults";
import { createTextProvider } from "../../src/app/providerConfig";
import type { MemoryEntry, Persona, RuntimeCard } from "../../src/app/runtimeTypes";
import { useRuntimeSessionManagement } from "../../src/app/useRuntimeSessionManagement";
import { runMemoryConsolidationSafely } from "../../src/runtime/memoryConsolidation";

vi.mock("../../src/app/providerConfig", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../src/app/providerConfig")>(),
  createTextProvider: vi.fn(),
}));

vi.mock("../../src/runtime/memoryConsolidation", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../src/runtime/memoryConsolidation")>(),
  runMemoryConsolidationSafely: vi.fn(),
}));

const createTextProviderMock = vi.mocked(createTextProvider);
const runMemoryConsolidationMock = vi.mocked(runMemoryConsolidationSafely);

const originalMemory: MemoryEntry[] = [
  { id: "memory-1", label: "Road", detail: "The north road is guarded." },
  { id: "memory-2", label: "Gate", detail: "The gate opens at dawn." },
  { id: "memory-3", label: "Inn", detail: "Mara owns the inn." },
  { id: "memory-4", label: "Oath", detail: "The player owes Mara a favor." },
];

const defaultPersona: Persona = {
  id: "persona-default",
  name: "Default persona",
  description: "",
  lorebooks: [],
  isDefault: true,
};

function renderSession() {
  const captureRestorePoint = vi.fn();
  const stopGeneration = vi.fn();
  const commitManualActiveCardState = vi.fn();

  const hook = renderHook(() => {
    const [cards, setCards] = useState<RuntimeCard[]>(() => [{
      ...structuredClone(initialCards[0]),
      memory: structuredClone(originalMemory),
    }]);
    const [personas, setPersonas] = useState<Persona[]>([defaultPersona]);
    const [activePersonaId, setActivePersonaId] = useState(defaultPersona.id);
    const [runtimeSettings, setRuntimeSettings] = useState(defaultRuntimeSettings);
    const [onboardingDismissed, setOnboardingDismissed] = useState(false);
    const [runtimeRunning, setRuntimeRunning] = useState(true);
    const [ruleWarning, setRuleWarning] = useState<string | null>("warning");
    const [draft, setDraft] = useState("unfinished turn");
    const [mapPrompt, setMapPrompt] = useState<string | null>("map prompt");
    const [imagePromptDraft, setImagePromptDraft] = useState("image prompt");
    const [imageNegativePromptDraft, setImageNegativePromptDraft] = useState("negative prompt");
    const activeCard = cards[0] ?? null;

    commitManualActiveCardState.mockImplementation((nextCard: RuntimeCard) => {
      setCards((current) => current.map((card) => card.id === nextCard.id ? nextCard : card));
    });

    const session = useRuntimeSessionManagement({
      activeCard,
      providerSettings: defaultProviderSettings,
      sessionApiKey: "",
      personas,
      activePersonaId,
      setPersonas,
      setActivePersonaId,
      setRuntimeSettings,
      setOnboardingDismissed,
      setRuntimeRunning,
      setRuleWarning,
      setDraft,
      setMapPrompt,
      setImagePromptDraft,
      setImageNegativePromptDraft,
      stopGeneration,
      captureRestorePoint,
      commitManualActiveCardState,
    });

    return {
      ...session,
      cards,
      personas,
      activePersonaId,
      runtimeSettings,
      onboardingDismissed,
      runtimeRunning,
      ruleWarning,
      draft,
      mapPrompt,
      imagePromptDraft,
      imageNegativePromptDraft,
      replaceMemory(memory: MemoryEntry[]) {
        setCards((current) => current.map((card) => ({ ...card, memory })));
      },
    };
  });

  return { ...hook, captureRestorePoint, stopGeneration, commitManualActiveCardState };
}

describe("useRuntimeSessionManagement", () => {
  beforeEach(() => {
    createTextProviderMock.mockReset();
    runMemoryConsolidationMock.mockReset();
    createTextProviderMock.mockReturnValue({} as ReturnType<typeof createTextProvider>);
    runMemoryConsolidationMock.mockResolvedValue({
      changed: true,
      entries: [
        { id: "memory-consolidated-1", label: "North road", detail: "The guarded north road opens at dawn." },
        { id: "memory-consolidated-2", label: "Mara", detail: "Mara owns the inn and is owed a favor." },
      ],
      warnings: [],
    });
  });

  it("keeps a consolidation proposal non-mutating until restore-point-backed approval", async () => {
    const { result, captureRestorePoint, commitManualActiveCardState } = renderSession();

    await act(async () => result.current.consolidateActiveCardMemory());

    expect(result.current.cards[0]?.memory).toEqual(originalMemory);
    expect(result.current.memoryConsolidationReview?.proposedMemory).toHaveLength(2);
    expect(captureRestorePoint).not.toHaveBeenCalled();
    expect(commitManualActiveCardState).not.toHaveBeenCalled();

    act(() => result.current.applyMemoryConsolidationReview());

    expect(captureRestorePoint).toHaveBeenCalledOnce();
    expect(commitManualActiveCardState).toHaveBeenCalledOnce();
    expect(captureRestorePoint.mock.invocationCallOrder[0]).toBeLessThan(
      commitManualActiveCardState.mock.invocationCallOrder[0] ?? Number.POSITIVE_INFINITY,
    );
    expect(result.current.cards[0]?.memory).toHaveLength(2);
    expect(result.current.memoryConsolidationReview).toBeNull();
  });

  it("rejects a stale consolidation proposal without overwriting newer memory", async () => {
    const { result, captureRestorePoint, commitManualActiveCardState } = renderSession();

    await act(async () => result.current.consolidateActiveCardMemory());
    const newerMemory = [{ id: "memory-new", label: "New fact", detail: "This arrived during review." }];
    act(() => result.current.replaceMemory(newerMemory));
    act(() => result.current.applyMemoryConsolidationReview());

    expect(result.current.cards[0]?.memory).toEqual(newerMemory);
    expect(captureRestorePoint).not.toHaveBeenCalled();
    expect(commitManualActiveCardState).not.toHaveBeenCalled();
    expect(result.current.memoryConsolidationStatus).toMatch(/stale proposal was discarded/i);
  });

  it("stops active work and clears transient prompts when the runtime shuts down", () => {
    const { result, stopGeneration } = renderSession();

    act(() => result.current.shutdownRuntime());

    expect(stopGeneration).toHaveBeenCalledOnce();
    expect(result.current.runtimeRunning).toBe(false);
    expect(result.current.ruleWarning).toBeNull();
    expect(result.current.draft).toBe("");
    expect(result.current.mapPrompt).toBeNull();
    expect(result.current.imagePromptDraft).toBe("");
    expect(result.current.imageNegativePromptDraft).toBe("");
  });

  it("does not create a restore point when the last persona cannot be deleted", () => {
    const { result, captureRestorePoint } = renderSession();

    act(() => result.current.removePersona(defaultPersona.id));

    expect(result.current.personas).toEqual([defaultPersona]);
    expect(result.current.activePersonaId).toBe(defaultPersona.id);
    expect(captureRestorePoint).not.toHaveBeenCalled();
  });
});
