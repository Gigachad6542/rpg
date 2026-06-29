import {
  estimateTextTokens,
  getUsableInputTokenLimit,
  normalizeTokenEstimate,
  type TokenBudget,
  type TokenEstimator,
} from "./tokenBudget";

export const DEFAULT_PROMPT_LAYER_ORDER = [
  "globalRuntimeRules",
  "modeRules",
  "characterDefinition",
  "userPersona",
  "preHistoryInstructions",
  "longTermMemory",
  "lorebookEntries",
  "rpgState",
  "knowledgeBoundaries",
  "socialExpectation",
  "recentChatHistory",
  "latestUserMessage",
  "postHistoryInstructions",
  "finalResponseContract",
  "assistantPrefill",
] as const;

export type PromptLayerKind = (typeof DEFAULT_PROMPT_LAYER_ORDER)[number] | "custom";

export interface PromptLayer {
  id: string;
  kind: PromptLayerKind;
  content: string;
  label?: string;
  order?: number;
  required?: boolean;
  allowTrimming?: boolean;
  metadata?: Record<string, unknown>;
}

export interface CompilePromptRequest {
  layers: PromptLayer[];
  tokenBudget?: TokenBudget;
  estimator?: TokenEstimator;
  separator?: string;
  includeLayerLabels?: boolean;
}

export interface IncludedPromptLayer extends PromptLayer {
  tokenEstimate: number;
  wasTrimmed: boolean;
}

export interface OmittedPromptLayer {
  id: string;
  kind: PromptLayerKind;
  reason: "empty" | "token_budget";
}

export interface CompiledPrompt {
  prompt: string;
  includedLayers: IncludedPromptLayer[];
  omittedLayers: OmittedPromptLayer[];
  truncatedLayerIds: string[];
  tokenEstimate: number;
  tokenLimit?: number;
}

const layerOrder = new Map<PromptLayerKind, number>(
  DEFAULT_PROMPT_LAYER_ORDER.map((kind, index) => [kind, index]),
);

const defaultLabels: Record<(typeof DEFAULT_PROMPT_LAYER_ORDER)[number], string> = {
  globalRuntimeRules: "Global runtime rules",
  modeRules: "Mode rules",
  characterDefinition: "Character definition",
  userPersona: "User persona",
  preHistoryInstructions: "Pre-history instructions",
  longTermMemory: "Relevant long-term memory",
  lorebookEntries: "Active lorebook entries",
  rpgState: "RPG state",
  knowledgeBoundaries: "Character knowledge boundaries",
  socialExpectation: "Social expectation",
  recentChatHistory: "Recent chat history",
  latestUserMessage: "User latest message",
  postHistoryInstructions: "Post-history instructions",
  finalResponseContract: "Final response contract",
  assistantPrefill: "Assistant prefill",
};

type MutableIncludedLayer = IncludedPromptLayer;

export function compilePrompt(request: CompilePromptRequest): CompiledPrompt {
  const estimator = request.estimator ?? estimateTextTokens;
  const separator = request.separator ?? "\n\n";
  const includeLayerLabels = request.includeLayerLabels ?? true;
  const tokenLimit = getUsableInputTokenLimit(request.tokenBudget);
  const omittedLayers: OmittedPromptLayer[] = [];
  const truncatedLayerIds = new Set<string>();
  const includedLayers: MutableIncludedLayer[] = [];

  const sortedLayers = request.layers
    .map((layer, inputIndex) => ({ layer, inputIndex }))
    .sort((left, right) => {
      const leftOrder = left.layer.order ?? layerOrder.get(left.layer.kind) ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = right.layer.order ?? layerOrder.get(right.layer.kind) ?? Number.MAX_SAFE_INTEGER;

      return leftOrder - rightOrder || left.inputIndex - right.inputIndex;
    })
    .map(({ layer }) => layer);

  for (const layer of sortedLayers) {
    if (layer.content.length === 0) {
      omittedLayers.push({ id: layer.id, kind: layer.kind, reason: "empty" });
      continue;
    }

    includedLayers.push({
      ...layer,
      tokenEstimate: estimateLayerTokens(layer, estimator, includeLayerLabels),
      wasTrimmed: false,
    });

    if (tokenLimit !== undefined) {
      enforceTokenLimit({
        includedLayers,
        omittedLayers,
        truncatedLayerIds,
        tokenLimit,
        estimator,
        separator,
        includeLayerLabels,
      });
    }
  }

  const prompt = buildPrompt(includedLayers, separator, includeLayerLabels);

  return {
    prompt,
    includedLayers: includedLayers.map((layer) => ({
      ...layer,
      tokenEstimate: estimateLayerTokens(layer, estimator, includeLayerLabels),
    })),
    omittedLayers,
    truncatedLayerIds: Array.from(truncatedLayerIds),
    tokenEstimate: normalizeTokenEstimate(estimator(prompt)),
    tokenLimit,
  };
}

function enforceTokenLimit(args: {
  includedLayers: MutableIncludedLayer[];
  omittedLayers: OmittedPromptLayer[];
  truncatedLayerIds: Set<string>;
  tokenLimit: number;
  estimator: TokenEstimator;
  separator: string;
  includeLayerLabels: boolean;
}) {
  while (estimatePromptTokens(args.includedLayers, args.separator, args.includeLayerLabels, args.estimator) > args.tokenLimit) {
    const trimmableIndex = findTrimmableLayerIndex(args.includedLayers);

    if (trimmableIndex >= 0) {
      const layer = args.includedLayers[trimmableIndex];
      const trimmedContent = findLongestContentThatFits({
        layerIndex: trimmableIndex,
        includedLayers: args.includedLayers,
        tokenLimit: args.tokenLimit,
        estimator: args.estimator,
        separator: args.separator,
        includeLayerLabels: args.includeLayerLabels,
      });

      if (trimmedContent.length > 0 && trimmedContent.length < layer.content.length) {
        layer.content = trimmedContent;
        layer.wasTrimmed = true;
        layer.tokenEstimate = estimateLayerTokens(layer, args.estimator, args.includeLayerLabels);
        args.truncatedLayerIds.add(layer.id);
        continue;
      }

      args.omittedLayers.push({ id: layer.id, kind: layer.kind, reason: "token_budget" });
      args.includedLayers.splice(trimmableIndex, 1);
      continue;
    }

    const optionalIndex = findOptionalLayerIndex(args.includedLayers);

    if (optionalIndex >= 0) {
      const [omittedLayer] = args.includedLayers.splice(optionalIndex, 1);
      args.omittedLayers.push({ id: omittedLayer.id, kind: omittedLayer.kind, reason: "token_budget" });
      continue;
    }

    const tokenEstimate = estimatePromptTokens(
      args.includedLayers,
      args.separator,
      args.includeLayerLabels,
      args.estimator,
    );
    throw new Error(`Compiled prompt exceeds token budget (${tokenEstimate} > ${args.tokenLimit}).`);
  }
}

function findLongestContentThatFits(args: {
  layerIndex: number;
  includedLayers: MutableIncludedLayer[];
  tokenLimit: number;
  estimator: TokenEstimator;
  separator: string;
  includeLayerLabels: boolean;
}): string {
  const originalContent = args.includedLayers[args.layerIndex].content;
  let low = 0;
  let high = originalContent.length - 1;
  let best = "";

  while (low <= high) {
    const midpoint = Math.floor((low + high) / 2);
    const candidate = originalContent.slice(0, midpoint).trimEnd();
    const candidateLayers = args.includedLayers.map((layer, index) =>
      index === args.layerIndex ? { ...layer, content: candidate } : layer,
    );
    const candidateEstimate = estimatePromptTokens(
      candidateLayers,
      args.separator,
      args.includeLayerLabels,
      args.estimator,
    );

    if (candidateEstimate <= args.tokenLimit) {
      best = candidate;
      low = midpoint + 1;
    } else {
      high = midpoint - 1;
    }
  }

  return best;
}

function findTrimmableLayerIndex(layers: MutableIncludedLayer[]): number {
  for (let index = layers.length - 1; index >= 0; index -= 1) {
    if (layers[index].allowTrimming === true && layers[index].content.length > 0) {
      return index;
    }
  }

  return -1;
}

function findOptionalLayerIndex(layers: MutableIncludedLayer[]): number {
  for (let index = layers.length - 1; index >= 0; index -= 1) {
    if (layers[index].required === false) {
      return index;
    }
  }

  return -1;
}

function estimateLayerTokens(layer: PromptLayer, estimator: TokenEstimator, includeLayerLabels: boolean): number {
  return normalizeTokenEstimate(estimator(formatLayer(layer, includeLayerLabels)));
}

function estimatePromptTokens(
  layers: PromptLayer[],
  separator: string,
  includeLayerLabels: boolean,
  estimator: TokenEstimator,
): number {
  return normalizeTokenEstimate(estimator(buildPrompt(layers, separator, includeLayerLabels)));
}

function buildPrompt(layers: PromptLayer[], separator: string, includeLayerLabels: boolean): string {
  return layers.map((layer) => formatLayer(layer, includeLayerLabels)).filter(Boolean).join(separator);
}

function formatLayer(layer: PromptLayer, includeLayerLabels: boolean): string {
  if (!includeLayerLabels) {
    return layer.content;
  }

  return `## ${getLayerLabel(layer)}\n${layer.content}`;
}

function getLayerLabel(layer: PromptLayer): string {
  if (layer.label) {
    return layer.label;
  }

  if (layer.kind !== "custom") {
    return defaultLabels[layer.kind];
  }

  return layer.id;
}
