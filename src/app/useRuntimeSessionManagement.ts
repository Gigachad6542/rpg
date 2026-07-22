import {
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
  useRef,
  useState,
} from "react";

import { runMemoryConsolidationSafely } from "../runtime/memoryConsolidation";
import { createRuntimeEntityId } from "./chatSessions";
import { getErrorMessage } from "./appUtils";
import {
  createPersona,
  deletePersona,
  parseActivePersonaId,
  updatePersona,
} from "./personas";
import { createTextProvider } from "./providerConfig";
import type {
  MemoryEntry,
  Persona,
  ProviderSettings,
  RuntimeCard,
  RuntimeSettings,
} from "./runtimeTypes";

export interface MemoryConsolidationReview {
  cardId: string;
  originalMemory: MemoryEntry[];
  proposedMemory: MemoryEntry[];
}

interface UseRuntimeSessionManagementOptions {
  activeCard: RuntimeCard | null;
  providerSettings: ProviderSettings;
  sessionApiKey: string;
  personas: Persona[];
  activePersonaId: string;
  setPersonas: Dispatch<SetStateAction<Persona[]>>;
  setActivePersonaId: Dispatch<SetStateAction<string>>;
  setRuntimeSettings: Dispatch<SetStateAction<RuntimeSettings>>;
  setOnboardingDismissed: Dispatch<SetStateAction<boolean>>;
  setRuntimeRunning: Dispatch<SetStateAction<boolean>>;
  setRuleWarning: Dispatch<SetStateAction<string | null>>;
  setDraft: Dispatch<SetStateAction<string>>;
  setMapPrompt: Dispatch<SetStateAction<string | null>>;
  setImagePromptDraft: Dispatch<SetStateAction<string>>;
  setImageNegativePromptDraft: Dispatch<SetStateAction<string>>;
  stopGeneration: () => void;
  captureRestorePoint: () => void;
  commitManualActiveCardState: (nextCard: RuntimeCard) => void;
  generationInFlightRef?: MutableRefObject<boolean>;
}

export function useRuntimeSessionManagement(options: UseRuntimeSessionManagementOptions) {
  const {
    activeCard,
    providerSettings,
    sessionApiKey,
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
    generationInFlightRef: providedGenerationInFlightRef,
  } = options;
  const fallbackGenerationInFlightRef = useRef(false);
  const generationInFlightRef = providedGenerationInFlightRef ?? fallbackGenerationInFlightRef;
  const consolidationInFlightRef = useRef(false);
  const [isConsolidatingMemory, setIsConsolidatingMemory] = useState(false);
  const [memoryConsolidationStatus, setMemoryConsolidationStatus] = useState<string | null>(null);
  const [memoryConsolidationReview, setMemoryConsolidationReview] = useState<MemoryConsolidationReview | null>(null);

  function blockPersonaMutationDuringGeneration(): boolean {
    if (!generationInFlightRef.current) {
      return false;
    }
    setRuleWarning("Stop the in-flight generation before changing personas.");
    return true;
  }

  async function consolidateActiveCardMemory(): Promise<void> {
    if (!activeCard || consolidationInFlightRef.current) {
      return;
    }
    if (generationInFlightRef.current) {
      setMemoryConsolidationStatus("Stop the in-flight generation before consolidating memory.");
      return;
    }
    consolidationInFlightRef.current = true;
    const entries = activeCard.memory.map((entry) => ({
      id: entry.id,
      label: entry.label,
      detail: entry.detail,
    }));
    setMemoryConsolidationReview(null);
    setIsConsolidatingMemory(true);
    setMemoryConsolidationStatus("Consolidating memory...");
    try {
      const provider = createTextProvider(providerSettings, sessionApiKey, activeCard, "", 0);
      const model = providerSettings.mode === "mock" ? "mock-narrator" : providerSettings.model;
      const result = await runMemoryConsolidationSafely({ modelAdapter: provider, model, entries });
      if (result.changed) {
        const before = entries.length;
        const proposedMemory = result.entries.map((entry) => ({
          id: entry.id ?? createRuntimeEntityId("memory"),
          label: entry.label,
          detail: entry.detail,
        }));
        setMemoryConsolidationReview({
          cardId: activeCard.id,
          originalMemory: activeCard.memory.map((entry) => ({ ...entry })),
          proposedMemory,
        });
        setMemoryConsolidationStatus(
          `Review the proposed consolidation: ${before} to ${result.entries.length} entries. Nothing has changed yet.`,
        );
      } else {
        setMemoryConsolidationStatus(
          result.warnings[0] ?? "Memory is already concise; nothing to consolidate.",
        );
      }
    } catch (error) {
      setMemoryConsolidationStatus(`Memory consolidation failed: ${getErrorMessage(error)}`);
    } finally {
      consolidationInFlightRef.current = false;
      setIsConsolidatingMemory(false);
    }
  }

  function applyMemoryConsolidationReview(): void {
    if (!activeCard || !memoryConsolidationReview || memoryConsolidationReview.cardId !== activeCard.id) {
      setMemoryConsolidationReview(null);
      setMemoryConsolidationStatus("The consolidation review no longer matches the active card; memory was not changed.");
      return;
    }
    if (generationInFlightRef.current) {
      setMemoryConsolidationStatus("Stop the in-flight generation before applying memory changes.");
      return;
    }
    if (JSON.stringify(activeCard.memory) !== JSON.stringify(memoryConsolidationReview.originalMemory)) {
      setMemoryConsolidationReview(null);
      setMemoryConsolidationStatus("Memory changed while this review was open; the stale proposal was discarded.");
      return;
    }

    const before = activeCard.memory.length;
    const proposedMemory = memoryConsolidationReview.proposedMemory.map((entry) => ({ ...entry }));
    captureRestorePoint();
    commitManualActiveCardState({ ...activeCard, memory: proposedMemory });
    setMemoryConsolidationReview(null);
    setMemoryConsolidationStatus(`Memory consolidation applied: ${before} to ${proposedMemory.length} entries.`);
  }

  function cancelMemoryConsolidationReview(): void {
    setMemoryConsolidationReview(null);
    setMemoryConsolidationStatus("Memory consolidation cancelled; original memory was not changed.");
  }

  function shutdownRuntime(): void {
    stopGeneration();
    setRuntimeRunning(false);
    setRuleWarning(null);
    setMapPrompt(null);
    setImagePromptDraft("");
    setImageNegativePromptDraft("");
    setDraft("");
  }

  function startRuntime(): void {
    setRuntimeRunning(true);
    setRuleWarning(null);
    setDraft("");
  }

  function completeOnboarding(): void {
    setRuntimeSettings((current) => ({ ...current, onboardingCompleted: true }));
    setOnboardingDismissed(true);
  }

  function addPersona(name: string): void {
    if (blockPersonaMutationDuringGeneration()) return;
    const persona = createPersona(name);
    setPersonas((current) => [...current, persona]);
    setActivePersonaId(persona.id);
  }

  function editPersona(personaId: string, changes: Partial<Persona>): void {
    if (blockPersonaMutationDuringGeneration()) return;
    setPersonas((current) => updatePersona(current, personaId, changes));
  }

  function removePersona(personaId: string): void {
    if (blockPersonaMutationDuringGeneration()) return;
    const remaining = deletePersona(personas, personaId);
    if (remaining.length === personas.length) {
      return;
    }
    captureRestorePoint();
    setPersonas(remaining);
    setActivePersonaId(parseActivePersonaId(activePersonaId, remaining));
  }

  function selectPersona(personaId: string): void {
    if (blockPersonaMutationDuringGeneration()) return;
    setActivePersonaId(parseActivePersonaId(personaId, personas));
  }

  return {
    isConsolidatingMemory,
    memoryConsolidationStatus,
    memoryConsolidationReview,
    consolidateActiveCardMemory,
    applyMemoryConsolidationReview,
    cancelMemoryConsolidationReview,
    shutdownRuntime,
    startRuntime,
    completeOnboarding,
    selectPersona,
    addPersona,
    editPersona,
    removePersona,
  };
}
