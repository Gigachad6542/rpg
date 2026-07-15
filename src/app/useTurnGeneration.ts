import {
  type Dispatch,
  type SetStateAction,
  useEffect,
  useRef,
  useState,
} from "react";

import {
  applyHiddenContinuityToCard,
  buildVisibleUserMessageWithHiddenContinuity,
  createEmptyHiddenContinuityResult,
  runHiddenContinuityPassSafely,
} from "../runtime/hiddenContinuity";
import {
  appendAuthoritativeEvent,
  createPlayerActionEvent,
  createRuleDecisionEvent,
  createStateCommittedEvent,
  type AuthoritativeEventStream,
} from "../runtime/authoritativeEventStream";
import { resolveHiddenContinuityPlan } from "../runtime/hiddenContinuityPolicy";
import { detectKnowledgeLeaks, describeKnowledgeLeaks } from "../runtime/knowledgeLeakDetector";
import { selectActiveLorebookEntriesSafely } from "../runtime/loreTriggerEngine";
import { resolveModelCallBudget } from "../runtime/modelCallBudget";
import { resolveModelPricing } from "../runtime/modelCallTelemetry";
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
} from "./providerConfig";
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
  formatDetailedCharacterDefinition,
  toVisibleTurnBudget,
} from "./turnPromptBuilders";
import {
  filterHiddenContinuityForPolicy,
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
  } = options;
  const [isGenerating, setIsGenerating] = useState(false);
  const [streamingReply, setStreamingReply] = useState("");
  const pendingReviewRef = useRef<Record<string, string[]>>({});
  const turnAbortControllerRef = useRef<AbortController | null>(null);
  const generationInFlightRef = useRef(false);

  useEffect(() => {
    return () => turnAbortControllerRef.current?.abort();
  }, []);

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
        mode: runtimeSettings.hiddenContinuityMode ?? "full",
        selectedModel,
        economicalModel: runtimeSettings.economicalModel,
      });
      const provider = createTextProvider(
        providerSettings,
        sessionApiKey,
        turnCard,
        generationAction,
        turnLorebookEntries.length,
        callPlan.hiddenModel !== undefined,
      );
      const configuredModelInfo = getConfiguredTextModelInfo(providerSettings);
      const hiddenBudget = callPlan.hiddenModel
        ? resolveModelCallBudget({
            providerId: providerSettings.providerId,
            model: callPlan.hiddenModel,
            phase: "hidden-continuity",
            modelInfo: getConfiguredTextModelInfoForModel(providerSettings, callPlan.hiddenModel),
          })
        : undefined;
      const visibleBudget = resolveModelCallBudget({
        providerId: providerSettings.providerId,
        model: callPlan.visibleModel,
        phase: "visible-response",
        modelInfo: configuredModelInfo,
      });
      let hiddenCallOutcome: TextModelCallOutcome | undefined;
      const hiddenCallStartedAt = readMonotonicMilliseconds();
      let hiddenContinuityResult = createEmptyHiddenContinuityResult();
      if (callPlan.hiddenModel && hiddenBudget) {
        try {
          hiddenContinuityResult = await runHiddenContinuityPassSafely({
            modelAdapter: createModelCallCaptureAdapter(provider, (outcome) => {
              hiddenCallOutcome = outcome;
            }),
            model: callPlan.hiddenModel,
            card: toHiddenContinuityCard(turnCard),
            messages: chatMessages,
            latestUserMessage: generationAction,
            activeLoreCount: turnLorebookEntries.length,
            pendingReviewProposals: pendingReviewRef.current[turnCard.id] ?? [],
            rollingSummary: chat.rollingSummary?.text,
            inputBudgetTokens: hiddenBudget.inputBudgetTokens,
            maxOutputTokens: hiddenBudget.maxOutputTokens,
            signal: abortController.signal,
          });
        } catch (error) {
          attemptedModelCalls.push(toModelCallRecord({
            phase: "hidden-continuity",
            fallbackProvider: provider.id,
            fallbackModel: callPlan.hiddenModel,
            budget: hiddenBudget,
            durationMs: elapsedMilliseconds(hiddenCallStartedAt),
            outcome: hiddenCallOutcome ?? { error },
            pricing: resolveModelPricing({
              providerId: providerSettings.providerId,
              model: callPlan.hiddenModel,
              pricingSnapshots: getProviderPricingSnapshots(providerSettings),
            }),
            stateProposalCount: 0,
          }));
          throw error;
        }
      }
      const hiddenPolicyResult = filterHiddenContinuityForPolicy(turnCard, hiddenContinuityResult, {
        latestUserAction: generationAction,
      });
      if (callPlan.hiddenModel && hiddenBudget) {
        attemptedModelCalls.push(toModelCallRecord({
          phase: "hidden-continuity",
          fallbackProvider: provider.id,
          fallbackModel: callPlan.hiddenModel,
          budget: hiddenBudget,
          durationMs: elapsedMilliseconds(hiddenCallStartedAt),
          outcome: hiddenCallOutcome,
          pricing: resolveModelPricing({
            providerId: providerSettings.providerId,
            model: callPlan.hiddenModel,
            pricingSnapshots: getProviderPricingSnapshots(providerSettings),
          }),
          stateProposalCount: hiddenPolicyResult.proposals.length,
        }));
      }
      const hiddenContinuity = hiddenPolicyResult.result;
      const continuityCard = applyHiddenContinuityToCard(turnCard, hiddenContinuity);
      const hiddenLatestUserMessage: Message = {
        ...userMessage,
        content: buildVisibleUserMessageWithHiddenContinuity(
          generationAction,
          hiddenContinuity,
          toHiddenContinuityCard(continuityCard),
        ),
      };
      const visibleCallStartedAt = readMonotonicMilliseconds();
      let visibleCallOutcome: TextModelCallOutcome | undefined;
      let pipelineResult: Awaited<ReturnType<typeof runTurnPipeline>>;
      try {
        pipelineResult = await runTurnPipeline({
          ...buildTurnPromptRequest(
            continuityCard,
            turnLorebookEntries,
            chatMessages,
            generationAction,
            runtimeSettings,
            activePersona,
            {
              ...toVisibleTurnBudget(visibleBudget),
              retrievalContext: {
                chatId: chat.id,
                branchId: chat.id,
                rollingSummary: chat.rollingSummary,
              },
              latestUserMessage: hiddenLatestUserMessage,
              promptRunId: runId,
              metadata: {
                cardKind: turnCard.kind,
                includedLoreEntryIds: turnLorebookEntries.map((entry) => entry.id),
                providerMode: providerSettings.mode,
                textStreaming: runtimeSettings.textStreaming,
                chatId: chat.id,
                hiddenContinuityPass: callPlan.hiddenModel !== undefined,
                expectedCallCount: callPlan.expectedCallCount,
              },
            },
          ),
          modelAdapter: createModelCallCaptureAdapter(provider, (outcome) => {
            visibleCallOutcome = outcome;
          }),
          model: callPlan.visibleModel,
          temperature: 0.6,
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
          stateProposalCount: 0,
        }));
        throw error;
      }
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
        stateProposalCount: policyResult.proposals.length,
      }));
      pendingReviewRef.current[turnCard.id] = policyResult.warnings
        .filter((warning) => /^Blocked/i.test(warning))
        .slice(-8);
      const warnings = [
        ...hiddenContinuity.warnings.map((warning) => `Hidden continuity: ${warning}`),
        ...hiddenPolicyResult.warnings,
        ...pipelineResult.warnings.map((warning) => warning.message),
        ...policyResult.warnings,
      ];
      const stateProposals = [...hiddenPolicyResult.proposals, ...policyResult.proposals];
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

      setChatSessions((current) => upsertChatSession(current, nextChat));
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
      setChatSessions((current) => upsertChatSession(current, {
        ...chat,
        messages: uncommittedAttemptMessages,
        updatedAt: new Date().toISOString(),
      }));
      if (attemptedModelCalls.length > 0) {
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
      setRuleWarning(
        isAbortError(error)
          ? "Generation stopped. No turn messages or state changes were saved."
          : getErrorMessage(error),
      );
    } finally {
      if (turnAbortControllerRef.current === abortController) {
        turnAbortControllerRef.current = null;
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
        ?? (previousVariants.length === 1 ? lastAssistant.promptRunId ?? "" : ""),
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
    generateTurn,
    regenerateLastReply,
    stopGeneration,
  };
}
