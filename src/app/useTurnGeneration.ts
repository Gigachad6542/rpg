import {
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  createEmptyHiddenContinuityResult,
} from "../runtime/hiddenContinuity";
import {
  appendAuthoritativeEvent,
  createPlayerActionEvent,
  createRuleDecisionEvent,
  createStateCommittedEvent,
  type AuthoritativeEventStream,
} from "../runtime/authoritativeEventStream";
import { resolveHiddenContinuityPlan } from "../runtime/hiddenContinuityPolicy";
import {
  buildVisibleUserMessageWithMemoryEvidence,
  MEMORY_EVIDENCE_VISIBLE_SYSTEM_RULES,
  runMemoryEvidenceAnalysis,
  type MemoryEvidenceBrief,
} from "../runtime/memoryEvidenceBrief";
import { detectKnowledgeLeaks, describeKnowledgeLeaks } from "../runtime/knowledgeLeakDetector";
import { selectActiveLorebookEntriesSafely } from "../runtime/loreTriggerEngine";
import { resolveModelCallBudget } from "../runtime/modelCallBudget";
import { classifyModelCallFailure, resolveModelPricing } from "../runtime/modelCallTelemetry";
import { validatePlayerAction as validatePlayerActionWithRules } from "../runtime/playerRuleEngine";
import { createRuntimeTurnEffects } from "../runtime/runtimeTurnLineage";
import {
  runTurnPipeline,
  TURN_PIPELINE_LAYER_IDS,
} from "../runtime/turnPipeline";
import { deriveStatusBlockLocationProposal, stripTrailingCallToAction } from "./assistantMessageParsing";
import { buildAuthoritativeStateMutations } from "./authoritativeStateMutations";
import {
  disableLoreEntriesInCard,
  disableLoreEntriesInPersona,
  isAbortError,
} from "./appControllerHelpers";
import { randomOpeningAction } from "./appDefaults";
import { getErrorMessage } from "./appUtils";
import { toHiddenContinuityCard } from "./cardNormalization";
import {
  advanceChatSessionRollingSummary,
  createChatSession,
  createRuntimeEntityId,
  deriveChatTitle,
  filterPersistedOpeningMessages,
  upsertChatSession,
} from "./chatSessions";
import {
  deriveCardForChat,
  deriveCardForRegeneration,
  initializeChatTurnState,
  recordChatTurnVariant,
  recordRegeneratedChatVariant,
} from "./chatTurnState";
import {
  createModelCallCaptureAdapter,
  elapsedMilliseconds,
  readMonotonicMilliseconds,
  toModelCallRecord,
  type TextModelCallOutcome,
} from "./modelCallTelemetryAdapter";
import { collectActiveLorebooks } from "./personas";
import {
  createTextProvider,
  getConfiguredTextModelInfo,
  getConfiguredTextModelInfoForModel,
  getProviderPricingSnapshots,
  shouldEnableVisibleReasoning,
} from "./providerConfig";
import {
  addReasoningTrace,
  modelReasoningTraceKey,
  type ModelReasoningTraceMap,
} from "./reasoningTraces";
import type {
  ChatSession,
  Message,
  ModelCallRecord,
  Persona,
  PromptRun,
  ProviderSettings,
  RuntimeCard,
  RuntimeSettings,
} from "./runtimeTypes";
import { parseSlashCommand } from "../runtime/slashCommands";
import {
  buildTurnPromptRequest,
  buildResponseContract,
  formatDetailedCharacterDefinition,
  toVisibleTurnBudget,
} from "./turnPromptBuilders";
import {
  filterValidatedTurnEffectsForPolicy,
} from "./turnEffects";

export interface GenerateTurnOptions {
  actionOverride?: string;
  baseMessages?: Message[];
  previousVariants?: string[];
  previousVariantRunIds?: string[];
  previousUndoneVariantIndices?: number[];
  cardOverride?: RuntimeCard;
  replacedAssistantMessageId?: string;
}

interface UseTurnGenerationOptions {
  activeCard: RuntimeCard | null;
  activeChat?: ChatSession;
  activePersona: Persona | null;
  runtimeRunning: boolean;
  draft: string;
  providerSettings: ProviderSettings;
  sessionApiKey: string;
  runtimeSettings: RuntimeSettings;
  setActiveChatIds: Dispatch<SetStateAction<Record<string, string>>>;
  setChatSessions: Dispatch<SetStateAction<ChatSession[]>>;
  setCards: Dispatch<SetStateAction<RuntimeCard[]>>;
  setPersonas: Dispatch<SetStateAction<Persona[]>>;
  setPromptRuns: Dispatch<SetStateAction<PromptRun[]>>;
  setDraft: Dispatch<SetStateAction<string>>;
  setRuleWarning: Dispatch<SetStateAction<string | null>> | ((warning: string | null) => void);
  runSlashCommand: (name: string, args: string) => Promise<void>;
  generateMissingCharacterPortraits: (
    card: RuntimeCard,
    chatId: string,
    messages: Message[],
  ) => Promise<void>;
  generationInFlightRef?: MutableRefObject<boolean>;
}

interface ActiveGenerationContext {
  controller: AbortController;
  cardId: string;
  activeChatReference: ChatSession;
  activePersonaReference: Persona | null;
  discardTelemetryOnAbort: boolean;
}

export function useTurnGeneration(options: UseTurnGenerationOptions) {
  const {
    activeCard,
    activeChat,
    activePersona,
    runtimeRunning,
    draft,
    providerSettings,
    sessionApiKey,
    runtimeSettings,
    setActiveChatIds,
    setChatSessions,
    setCards,
    setPersonas,
    setPromptRuns,
    setDraft,
    setRuleWarning,
    runSlashCommand,
    generateMissingCharacterPortraits,
    generationInFlightRef: providedGenerationInFlightRef,
  } = options;
  const [isGenerating, setIsGenerating] = useState(false);
  const [streamingReply, setStreamingReply] = useState("");
  const [reasoningTraces, setReasoningTraces] = useState<ModelReasoningTraceMap>({});
  const pendingReviewRef = useRef<Record<string, string[]>>({});
  const turnAbortControllerRef = useRef<AbortController | null>(null);
  const activeGenerationContextRef = useRef<ActiveGenerationContext | null>(null);
  const fallbackGenerationInFlightRef = useRef(false);
  const generationInFlightRef = providedGenerationInFlightRef ?? fallbackGenerationInFlightRef;

  useEffect(() => {
    return () => turnAbortControllerRef.current?.abort();
  }, []);

  useEffect(() => {
    const context = activeGenerationContextRef.current;
    if (!context) {
      return;
    }
    if (
      !runtimeRunning ||
      activeCard?.id !== context.cardId ||
      activeChat !== context.activeChatReference ||
      activePersona !== context.activePersonaReference
    ) {
      context.discardTelemetryOnAbort = true;
      context.controller.abort();
    }
  }, [activeCard?.id, activeChat, activePersona, runtimeRunning]);

  async function generateTurn(generationOptions?: GenerateTurnOptions): Promise<void> {
    if (!activeCard) {
      setRuleWarning("Open a card before starting the runtime.");
      return;
    }
    if (!runtimeRunning) {
      setRuleWarning("Runtime is shut down. Start the runtime before generating another turn.");
      return;
    }
    if (generationInFlightRef.current) {
      return;
    }

    let turnCard = generationOptions?.cardOverride ?? activeCard;
    const parsedCommand = generationOptions?.actionOverride === undefined
      ? parseSlashCommand(draft.trim())
      : null;
    if (parsedCommand) {
      await runSlashCommand(parsedCommand.command.name, parsedCommand.args);
      return;
    }

    const visibleUserAction = (generationOptions?.actionOverride ?? draft).trim();
    const generationAction = visibleUserAction || randomOpeningAction;
    const runId = createRuntimeEntityId("run");
    const baseChat = activeChat ?? initializeChatTurnState(
      createChatSession(turnCard.id, `${turnCard.name} chat`),
      turnCard,
    );
    const chatMessages = generationOptions?.baseMessages ?? filterPersistedOpeningMessages(baseChat.messages);
    const uncommittedAttemptMessages = generationOptions?.replacedAssistantMessageId
      ? baseChat.messages
      : chatMessages;
    const userMessage: Message = {
      id: `user-${runId}`,
      role: "user",
      content: generationAction,
    };
    const occurredAt = new Date().toISOString();
    let authoritativeEvents: AuthoritativeEventStream = appendAuthoritativeEvent(
      baseChat.authoritativeEvents ?? [],
      createPlayerActionEvent({
        id: `event-${runId}-action`,
        chatId: baseChat.id,
        branchId: baseChat.id,
        messageId: userMessage.id,
        occurredAt,
        runId,
        action: generationAction,
        origin: visibleUserAction ? "typed" : "opening",
      }),
    );
    const validation = validatePlayerActionWithRules({
      cardKind: turnCard.kind,
      rules: turnCard.playerRules,
      action: generationAction,
      rpgState: turnCard.rpg,
    });
    authoritativeEvents = appendAuthoritativeEvent(
      authoritativeEvents,
      createRuleDecisionEvent({
        id: `event-${runId}-rules`,
        chatId: baseChat.id,
        branchId: baseChat.id,
        messageId: userMessage.id,
        occurredAt,
        runId,
        action: generationAction,
        engine: "player-rule-engine-v1",
        decision: {
          allowed: validation.allowed,
          warning: validation.warning,
          triggeredRuleIds: validation.triggeredRuleIds,
        },
      }),
    );
    const chat: ChatSession = { ...baseChat, authoritativeEvents };
    setRuleWarning(validation.warning);
    if (!activeChat) {
      setActiveChatIds((current) => ({ ...current, [activeCard.id]: chat.id }));
    }
    if (!validation.allowed) {
      setChatSessions((current) => upsertChatSession(current, {
        ...chat,
        messages: uncommittedAttemptMessages,
        updatedAt: occurredAt,
      }));
      setDraft("");
      return;
    }

    const abortController = new AbortController();
    turnAbortControllerRef.current = abortController;
    activeGenerationContextRef.current = {
      controller: abortController,
      cardId: turnCard.id,
      activeChatReference: activeChat ?? chat,
      activePersonaReference: activePersona,
      discardTelemetryOnAbort: false,
    };
    generationInFlightRef.current = true;
    setIsGenerating(true);
    setStreamingReply("");
    if (!activeChat) {
      setChatSessions((current) => [...current, chat]);
    }
    const attemptedModelCalls: ModelCallRecord[] = [];
    try {
      const loreSelection = await selectActiveLorebookEntriesSafely({
        lorebooks: collectActiveLorebooks(turnCard, activePersona),
        messages: chatMessages,
        draft: generationAction,
        context: turnCard.rpg
          ? {
              currentLocation: turnCard.rpg.location,
              activeQuests: turnCard.rpg.quests,
              inventory: turnCard.rpg.inventory,
              worldFlags: turnCard.rpg.flags,
            }
          : undefined,
        sources: {
          cardDefinition: formatDetailedCharacterDefinition(turnCard),
          personaDescription: activePersona?.description,
          memoryEntries: turnCard.memory.map((entry) => `${entry.label}: ${entry.detail}`),
        },
      });
      const turnLorebookEntries = loreSelection.entries;
      const disabledLoreEntryIds = new Set(loreSelection.disabledEntryIds);
      if (disabledLoreEntryIds.size > 0) {
        turnCard = disableLoreEntriesInCard(turnCard, disabledLoreEntryIds);
        setCards((current) =>
          current.map((card) =>
            card.id === turnCard.id ? disableLoreEntriesInCard(card, disabledLoreEntryIds) : card,
          ),
        );
        setPersonas((current) =>
          current.map((persona) => disableLoreEntriesInPersona(persona, disabledLoreEntryIds)),
        );
        setRuleWarning(
          `Disabled ${disabledLoreEntryIds.size} lore regex ${disabledLoreEntryIds.size === 1 ? "entry" : "entries"} after isolated matching failed or timed out.`,
        );
      }
      const selectedModel = providerSettings.mode === "mock" ? "mock-narrator" : providerSettings.model;
      const callPlan = resolveHiddenContinuityPlan({
        mode: runtimeSettings.hiddenContinuityMode ?? "evidence-brief",
        selectedModel,
        messageCount: chatMessages.length,
      });
      const provider = createTextProvider(
        providerSettings,
        sessionApiKey,
        turnCard,
        generationAction,
        turnLorebookEntries.length,
        callPlan.analysisModel !== undefined,
      );
      const configuredModelInfo = getConfiguredTextModelInfo(providerSettings);
      const visibleReasoningEnabled = shouldEnableVisibleReasoning(providerSettings);
      const analysisBudget = callPlan.analysisModel
        ? resolveModelCallBudget({
            providerId: providerSettings.providerId,
            model: callPlan.analysisModel,
            phase: "memory-evidence",
            modelInfo: getConfiguredTextModelInfoForModel(providerSettings, callPlan.analysisModel),
          })
        : undefined;
      const visibleBudget = resolveModelCallBudget({
        providerId: providerSettings.providerId,
        model: callPlan.visibleModel,
        phase: "visible-response",
        modelInfo: configuredModelInfo,
        reasoningEnabled: visibleReasoningEnabled,
      });
      let analysisCallOutcome: TextModelCallOutcome | undefined;
      const analysisCallStartedAt = readMonotonicMilliseconds();
      let memoryEvidenceBrief: MemoryEvidenceBrief | undefined;
      let memoryEvidenceWarning: string | undefined;
      if (callPlan.analysisModel && analysisBudget) {
        try {
          memoryEvidenceBrief = await runMemoryEvidenceAnalysis({
            modelAdapter: createModelCallCaptureAdapter(provider, (outcome) => {
              analysisCallOutcome = outcome;
            }),
            model: callPlan.analysisModel,
            card: toHiddenContinuityCard(turnCard),
            messages: chatMessages,
            latestUserMessage: generationAction,
            inputBudgetTokens: analysisBudget.inputBudgetTokens,
            maxOutputTokens: analysisBudget.maxOutputTokens,
            signal: abortController.signal,
          });
        } catch (error) {
          if (isAbortError(error)) throw error;
          memoryEvidenceWarning = classifyModelCallFailure(error).message;
          analysisCallOutcome = analysisCallOutcome && "response" in analysisCallOutcome
            ? { error, response: analysisCallOutcome.response }
            : { error };
        }
      }
      if (callPlan.analysisModel && analysisBudget) {
        attemptedModelCalls.push(toModelCallRecord({
          phase: "memory-evidence",
          fallbackProvider: provider.id,
          fallbackModel: callPlan.analysisModel,
          budget: analysisBudget,
          durationMs: elapsedMilliseconds(analysisCallStartedAt),
          outcome: analysisCallOutcome,
          pricing: resolveModelPricing({
            providerId: providerSettings.providerId,
            model: callPlan.analysisModel,
            pricingSnapshots: getProviderPricingSnapshots(providerSettings),
          }),
          reasoningRequest: "disabled",
          stateProposalCount: 0,
        }));
      }
      const hiddenContinuity = createEmptyHiddenContinuityResult();
      const continuityCard = turnCard;
      const visibleMessages = memoryEvidenceBrief
        ? chatMessages.slice(-callPlan.recentMessageCount)
        : chatMessages;
      const visibleLatestUserMessage: Message = {
        ...userMessage,
        content: memoryEvidenceBrief
          ? buildVisibleUserMessageWithMemoryEvidence(generationAction, memoryEvidenceBrief)
          : generationAction,
      };
      const visibleCallStartedAt = readMonotonicMilliseconds();
      let visibleCallOutcome: TextModelCallOutcome | undefined;
      let pipelineResult: Awaited<ReturnType<typeof runTurnPipeline>>;
      try {
        pipelineResult = await runTurnPipeline({
          ...buildTurnPromptRequest(
            continuityCard,
            turnLorebookEntries,
            visibleMessages,
            generationAction,
            runtimeSettings,
            activePersona,
            {
              ...toVisibleTurnBudget(visibleBudget),
              retrievalContext: {
                chatId: chat.id,
                branchId: chat.id,
                rollingSummary: memoryEvidenceBrief ? undefined : chat.rollingSummary,
              },
              latestUserMessage: visibleLatestUserMessage,
              ...(memoryEvidenceBrief
                ? {
                    responseContract: [
                      buildResponseContract(runtimeSettings),
                      MEMORY_EVIDENCE_VISIBLE_SYSTEM_RULES,
                    ].join("\n\n"),
                    historyLimit: callPlan.recentMessageCount,
                  }
                : {}),
              promptRunId: runId,
              metadata: {
                cardKind: turnCard.kind,
                includedLoreEntryIds: turnLorebookEntries.map((entry) => entry.id),
                providerMode: providerSettings.mode,
                textStreaming: runtimeSettings.textStreaming,
                chatId: chat.id,
                memoryEvidenceBriefPass: memoryEvidenceBrief !== undefined,
                expectedCallCount: callPlan.expectedCallCount,
              },
            },
          ),
          modelAdapter: createModelCallCaptureAdapter(provider, (outcome) => {
            visibleCallOutcome = outcome;
            if ("response" in outcome && outcome.response?.reasoning?.trace) {
              setReasoningTraces((current) => addReasoningTrace(
                current,
                modelReasoningTraceKey(runId, "visible-response"),
                outcome.response!.reasoning!,
              ));
            }
          }),
          model: callPlan.visibleModel,
          temperature: 0.6,
          ...(visibleReasoningEnabled
            ? { reasoning: { enabled: true, exclude: false } }
            : {}),
          signal: abortController.signal,
          onStreamText: (text) => setStreamingReply(text),
        });
      } catch (error) {
        attemptedModelCalls.push(toModelCallRecord({
          phase: "visible-response",
          fallbackProvider: provider.id,
          fallbackModel: callPlan.visibleModel,
          budget: visibleBudget,
          durationMs: elapsedMilliseconds(visibleCallStartedAt),
          outcome: visibleCallOutcome ?? { error },
          pricing: resolveModelPricing({
            providerId: providerSettings.providerId,
            model: callPlan.visibleModel,
            pricingSnapshots: getProviderPricingSnapshots(providerSettings),
          }),
          reasoningRequest: visibleReasoningEnabled ? "enabled" : "unspecified",
          stateProposalCount: 0,
        }));
        throw error;
      }
      abortController.signal.throwIfAborted();
      if (!visibleCallOutcome) {
        visibleCallOutcome = {
          response: {
            providerId: pipelineResult.promptRun.providerId,
            model: pipelineResult.promptRun.model,
            text: pipelineResult.assistantMessageText,
            finishReason: pipelineResult.promptRun.finishReason,
            usage: { ...pipelineResult.promptRun.usage },
            usageSource: pipelineResult.promptRun.usageSource ?? "estimated",
          },
        };
      }
      const statusBlockLocation = deriveStatusBlockLocationProposal(
        pipelineResult.assistantMessageText,
        pipelineResult.stateProposals.extraction.rpg_state_updates.location,
        continuityCard,
      );
      const proposedExtraction = statusBlockLocation
        ? {
            ...pipelineResult.stateProposals.extraction,
            rpg_state_updates: {
              ...pipelineResult.stateProposals.extraction.rpg_state_updates,
              location: statusBlockLocation,
            },
          }
        : pipelineResult.stateProposals.extraction;
      const policyResult = filterValidatedTurnEffectsForPolicy(continuityCard, proposedExtraction, {
        latestUserAction: userMessage.content,
        assistantMessageText: pipelineResult.assistantMessageText,
      });
      attemptedModelCalls.push(toModelCallRecord({
        phase: "visible-response",
        fallbackProvider: provider.id,
        fallbackModel: callPlan.visibleModel,
        budget: visibleBudget,
        durationMs: elapsedMilliseconds(visibleCallStartedAt),
        outcome: visibleCallOutcome,
        pricing: resolveModelPricing({
          providerId: providerSettings.providerId,
          model: callPlan.visibleModel,
          pricingSnapshots: getProviderPricingSnapshots(providerSettings),
        }),
        reasoningRequest: visibleReasoningEnabled ? "enabled" : "unspecified",
        stateProposalCount: policyResult.proposals.length,
      }));
      pendingReviewRef.current[turnCard.id] = policyResult.warnings
        .filter((warning) => /^Blocked/i.test(warning))
        .slice(-8);
      const warnings = [
        ...(memoryEvidenceWarning ? [`Memory evidence: ${memoryEvidenceWarning}`] : []),
        ...pipelineResult.warnings.map((warning) => warning.message),
        ...policyResult.warnings,
      ];
      const stateProposals = [...policyResult.proposals];
      const stateChanges = stateProposals
        .filter((proposal) => proposal.applied)
        .map((proposal) => `[${proposal.provenance}] ${proposal.summary}`);
      const assistantContent = stripTrailingCallToAction(pipelineResult.assistantMessageText);
      const assistantVariants = generationOptions?.previousVariants
        ? [...generationOptions.previousVariants, assistantContent]
        : undefined;
      const assistantMessage: Message = {
        id: `assistant-${runId}`,
        role: "assistant",
        content: assistantContent,
        promptRunId: runId,
        ...(assistantVariants && assistantVariants.length > 1
          ? {
              variants: assistantVariants,
              activeVariantIndex: assistantVariants.length - 1,
              variantRunIds: [...(generationOptions?.previousVariantRunIds ?? []), runId],
              ...(generationOptions?.previousUndoneVariantIndices?.length
                ? { undoneVariantIndices: [...generationOptions.previousUndoneVariantIndices] }
                : {}),
            }
          : {}),
      };
      const variantIndex = assistantVariants ? assistantVariants.length - 1 : 0;
      const turnEffects = createRuntimeTurnEffects({
        hiddenContinuity,
        extraction: policyResult.extraction,
        committedAt: new Date().toISOString(),
        idSeed: `${assistantMessage.id}-v${variantIndex}`,
        memoryRetrievalScope: { level: "branch", chatId: chat.id, branchId: chat.id },
      });
      const nextMessages = visibleUserAction
        ? [...chatMessages, userMessage, assistantMessage]
        : [...chatMessages, assistantMessage];
      const nextChatDraft: ChatSession = {
        ...chat,
        messages: nextMessages,
        title: chat.title || deriveChatTitle(generationAction),
        updatedAt: new Date().toISOString(),
      };
      let nextChat = generationOptions?.replacedAssistantMessageId
        ? recordRegeneratedChatVariant({
            chat: nextChatDraft,
            card: activeCard,
            retainedMessages: chatMessages,
            replacedAssistantMessageId: generationOptions.replacedAssistantMessageId,
            replacementAssistantMessageId: assistantMessage.id,
            variantIndex,
            effects: turnEffects,
          })
        : recordChatTurnVariant(nextChatDraft, activeCard, assistantMessage.id, variantIndex, turnEffects);
      const nextActiveCard = disableLoreEntriesInCard(
        deriveCardForChat(activeCard, nextChat),
        disabledLoreEntryIds,
      );
      nextChat = {
        ...nextChat,
        authoritativeEvents: appendAuthoritativeEvent(
          nextChat.authoritativeEvents ?? [],
          createStateCommittedEvent({
            id: `event-${runId}-state-v${variantIndex}`,
            chatId: nextChat.id,
            branchId: nextChat.id,
            messageId: assistantMessage.id,
            occurredAt: new Date().toISOString(),
            runId,
            variant: { assistantMessageId: assistantMessage.id, variantIndex },
            proposalIds: stateProposals
              .map((proposal, index) => ({ proposal, id: `${runId}-proposal-${index}` }))
              .filter(({ proposal }) => proposal.applied)
              .map(({ id }) => id),
            mutations: buildAuthoritativeStateMutations(turnCard, nextActiveCard),
          }),
        ),
        rollingSummary: advanceChatSessionRollingSummary(nextChat, nextMessages, new Date().toISOString()),
      };
      const leakWarnings = describeKnowledgeLeaks(
        detectKnowledgeLeaks(assistantMessage.content, nextActiveCard.storyEntities),
      );
      const hasKnowledgeBoundaries = continuityCard.storyEntities?.some(
        (entity) => entity.doesNotKnow.length > 0,
      );
      const boundariesDropped = Boolean(hasKnowledgeBoundaries)
        && !pipelineResult.promptRun.includedLayerIds.includes(TURN_PIPELINE_LAYER_IDS.knowledgeBoundaries);
      const boundaryWarnings = boundariesDropped
        ? ["Knowledge boundaries were dropped from this prompt by the token budget; character isolation may be weaker this turn."]
        : [];
      const turnWarnings = [...warnings, ...leakWarnings, ...boundaryWarnings];

      abortController.signal.throwIfAborted();
      setChatSessions((current) => current.some((candidate) => candidate.id === nextChat.id)
        ? upsertChatSession(current, nextChat)
        : current);
      setCards((current) => current.map((card) => (card.id === activeCard.id ? nextActiveCard : card)));
      void generateMissingCharacterPortraits(nextActiveCard, chat.id, nextMessages);
      setPromptRuns((current) => [
        ...current,
        {
          id: runId,
          cardId: turnCard.id,
          chatId: chat.id,
          compiledPrompt: runtimeSettings.promptDebugLogs ? pipelineResult.promptRun.compiledPrompt : "",
          response: assistantMessage.content,
          provider: pipelineResult.promptRun.providerId,
          model: pipelineResult.promptRun.model,
          tokenEstimate: pipelineResult.promptRun.tokenEstimate,
          includedLayerIds: [...pipelineResult.promptRun.includedLayerIds],
          includedLoreEntryIds: [...pipelineResult.promptRun.includedLoreEntryIds],
          warnings: turnWarnings,
          stateChanges,
          stateProposals,
          usage: pipelineResult.promptRun.usage,
          modelCalls: attemptedModelCalls,
        },
      ]);
      setDraft("");
    } catch (error) {
      setChatSessions((current) => current.map((candidate) => candidate.id === chat.id
        ? {
            ...candidate,
            messages: uncommittedAttemptMessages,
            authoritativeEvents: chat.authoritativeEvents,
            updatedAt: new Date().toISOString(),
          }
        : candidate));
      const discardAbortedTelemetry = isAbortError(error)
        && activeGenerationContextRef.current?.controller === abortController
        && activeGenerationContextRef.current.discardTelemetryOnAbort;
      if (attemptedModelCalls.length > 0 && !discardAbortedTelemetry) {
        const lastCall = attemptedModelCalls[attemptedModelCalls.length - 1];
        const failureMessage = lastCall.failure?.message ?? "Model call failed.";
        setPromptRuns((current) => current.some((run) => run.id === runId)
          ? current
          : [
              ...current,
              {
                id: runId,
                cardId: turnCard.id,
                chatId: chat.id,
                compiledPrompt: "",
                response: "",
                provider: lastCall.provider,
                model: lastCall.model,
                tokenEstimate: 0,
                includedLayerIds: [],
                includedLoreEntryIds: [],
                warnings: [failureMessage],
                stateChanges: [],
                stateProposals: [],
                modelCalls: attemptedModelCalls,
                blockedReason: failureMessage,
              },
            ]);
      }
      if (discardAbortedTelemetry) {
        setReasoningTraces((current) => {
          const key = modelReasoningTraceKey(runId, "visible-response");
          if (!(key in current)) {
            return current;
          }
          const next = { ...current };
          delete next[key];
          return next;
        });
      } else {
        setRuleWarning(
          isAbortError(error)
            ? "Generation stopped. No turn messages or state changes were saved."
            : getErrorMessage(error),
        );
      }
    } finally {
      if (turnAbortControllerRef.current === abortController) {
        turnAbortControllerRef.current = null;
      }
      if (activeGenerationContextRef.current?.controller === abortController) {
        activeGenerationContextRef.current = null;
      }
      generationInFlightRef.current = false;
      setIsGenerating(false);
      setStreamingReply("");
    }
  }

  async function regenerateLastReply(): Promise<void> {
    if (!activeCard || !activeChat || generationInFlightRef.current || !runtimeRunning) {
      return;
    }
    const history = filterPersistedOpeningMessages(activeChat.messages);
    let assistantIndex = -1;
    for (let index = history.length - 1; index >= 0; index -= 1) {
      if (history[index].role === "assistant") {
        assistantIndex = index;
        break;
      }
    }
    if (assistantIndex === -1) {
      return;
    }
    let userIndex = assistantIndex - 1;
    while (userIndex >= 0 && history[userIndex].role !== "user") {
      userIndex -= 1;
    }
    const action = userIndex >= 0 ? history[userIndex].content : randomOpeningAction;
    const baseMessages = userIndex >= 0 ? history.slice(0, userIndex) : history.slice(0, assistantIndex);
    const lastAssistant = history[assistantIndex];
    const previousVariants = lastAssistant.variants && lastAssistant.variants.length > 0
      ? lastAssistant.variants
      : [lastAssistant.content];
    const previousVariantRunIds = previousVariants.map(
      (_, index) => lastAssistant.variantRunIds?.[index]
        ?? (index === previousVariants.length - 1 ? lastAssistant.promptRunId ?? "" : ""),
    );
    const regenerationCard = deriveCardForRegeneration(activeCard, activeChat, lastAssistant.id);
    await generateTurn({
      actionOverride: action,
      baseMessages,
      previousVariants,
      previousVariantRunIds,
      previousUndoneVariantIndices: lastAssistant.undoneVariantIndices,
      cardOverride: regenerationCard,
      replacedAssistantMessageId: lastAssistant.id,
    });
  }

  function stopGeneration(): void {
    turnAbortControllerRef.current?.abort();
  }

  return {
    isGenerating,
    streamingReply,
    reasoningTraces,
    generateTurn,
    regenerateLastReply,
    stopGeneration,
  };
}
