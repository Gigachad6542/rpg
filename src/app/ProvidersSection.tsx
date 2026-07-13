import { useState } from "react";
import { Brush, KeyRound, LockKeyhole, Play, RotateCcw, X } from "lucide-react";
import { qwen37MaxReferencePreset, recommendedLocalImageProvider } from "../providers/modelPresets";
import { type SecureStorageStatus } from "../security/keyStorage";
import type { ImageProviderMode, ImageProviderSettings, ProviderSettings } from "./runtimeTypes";
import { toBoundedFloat, toBoundedNumber } from "./appUtils";
import {
  getDefaultTextModel,
  getImageModelChoices,
  getTextModelChoices,
  normalizeProviderBaseUrlOrNull,
  toLocalImageQualityDimension,
} from "./providerConfig";
import {
  defaultImageProviderSettings,
  localImageMinimumImageSize,
  localImageMinimumPollTimeoutMs,
  localImageRecommendedCfg,
  localImageRecommendedSteps,
} from "./appDefaults";

export function ProvidersSection(props: {
  providerKeyStatus: string;
  providerTestStatus: string;
  providerSettings: ProviderSettings;
  setProviderSettings: (settings: ProviderSettings) => void;
  imageProviderSettings: ImageProviderSettings;
  setImageProviderSettings: (settings: ImageProviderSettings) => void;
  comfyUiCheckpointModels: string[];
  imageProviderStatus: string;
  imageSessionApiKey: string;
  setImageSessionApiKey: (value: string) => void;
  secureStorageStatus: SecureStorageStatus;
  sessionApiKey: string;
  setSessionApiKey: (value: string) => void;
  saveProviderKey: () => Promise<void>;
  forgetProviderKey: () => Promise<void>;
  testTextProvider: () => Promise<void>;
  refreshComfyUICheckpoints: () => Promise<void>;
}) {
  const textModelChoices = getTextModelChoices(props.providerSettings);
  const imageModelChoices = getImageModelChoices(props.comfyUiCheckpointModels, props.imageProviderSettings.model);

  function updateSettings(patch: Partial<ProviderSettings>) {
    const next = { ...props.providerSettings, ...patch };
    if ("contextWindowTokens" in patch && patch.contextWindowTokens === undefined) {
      delete next.contextWindowTokens;
    }
    if ("maxOutputTokens" in patch && patch.maxOutputTokens === undefined) {
      delete next.maxOutputTokens;
    }
    if ("pricing" in patch && patch.pricing === undefined) {
      delete next.pricing;
    }
    const baseUrlChanged =
      typeof patch.baseUrl === "string" &&
      normalizeProviderBaseUrlOrNull(patch.baseUrl) !== normalizeProviderBaseUrlOrNull(props.providerSettings.baseUrl);
    if (
      (patch.providerId && patch.providerId !== props.providerSettings.providerId) ||
      baseUrlChanged ||
      patch.mode === "mock"
    ) {
      delete next.secretReference;
    }
    if (typeof patch.model === "string" && patch.model !== props.providerSettings.model) {
      if (patch.contextWindowTokens === undefined) {
        delete next.contextWindowTokens;
      }
      if (patch.maxOutputTokens === undefined) {
        delete next.maxOutputTokens;
      }
      if (patch.pricing === undefined) {
        delete next.pricing;
      }
    }
    props.setProviderSettings(next);
  }

  return (
    <div className="workspace-grid providers-grid">
      <section className="panel" aria-label="LLM API keys">
        <div className="section-title">
          <KeyRound size={17} />
          <h3>LLM Provider</h3>
        </div>
        <p>
          Recommended: <strong>Qwen3.7-Max</strong> using model id <code className="inline-code">qwen3.7-max</code>.
          Stored desktop keys are used through the local backend; React keeps only a secret reference.
        </p>
        <p className="field-help">
          Full and economical continuity make two sequential text-model calls; turning hidden continuity off makes one
          visible-response call. Expand the model-call summary under a turn to inspect phase, tokens, latency, cost,
          failures, and state proposals. Unknown provider pricing is shown as unknown rather than zero.
        </p>
        <label className="field">
          <span>Runtime mode</span>
          <select
            value={props.providerSettings.mode}
            onChange={(event) =>
              updateSettings(
                event.target.value === "mock"
                  ? {
                      mode: "mock",
                      providerId: "mock",
                      displayName: "Mock local runtime",
                      model: "mock-narrator",
                      secretReference: undefined,
                    }
                  : {
                      mode: "openai-compatible",
                      providerId: "alibaba-model-studio",
                      displayName: "Alibaba Cloud Model Studio / DashScope",
                      model: qwen37MaxReferencePreset.id,
                      secretReference: undefined,
                    },
              )
            }
          >
            <option value="mock">Mock local runtime</option>
            <option value="openai-compatible">OpenAI-compatible BYOK endpoint</option>
          </select>
        </label>
        <label className="field">
          <span>Provider</span>
          <select
            value={props.providerSettings.providerId}
            onChange={(event) => {
              const providerId = event.target.value;
              const presets: Record<string, Partial<ProviderSettings>> = {
                "alibaba-model-studio": {
                  displayName: "Alibaba Cloud Model Studio / DashScope",
                  baseUrl: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
                  model: qwen37MaxReferencePreset.id,
                },
                openrouter: {
                  displayName: "OpenRouter BYOK",
                  baseUrl: "https://openrouter.ai/api/v1",
                  model: getDefaultTextModel("openrouter"),
                },
                local: {
                  displayName: "Local OpenAI-compatible endpoint",
                  baseUrl: "http://127.0.0.1:1234/v1",
                  model: "local-model",
                },
              };
              updateSettings({
                providerId,
                mode: providerId === "mock" ? "mock" : "openai-compatible",
                ...(presets[providerId] ?? {}),
              });
            }}
          >
            <option value="mock">Mock local runtime</option>
            <option value="alibaba-model-studio">Alibaba Cloud Model Studio / DashScope</option>
            <option value="openrouter">OpenRouter BYOK</option>
            <option value="local">Local OpenAI-compatible endpoint</option>
          </select>
        </label>
        <label className="field">
          <span>Character portrait generation</span>
          <select
            value={props.imageProviderSettings.portraitGenerationMode}
            onChange={(event) =>
              props.setImageProviderSettings({
                ...props.imageProviderSettings,
                portraitGenerationMode: event.target.value as ImageProviderSettings["portraitGenerationMode"],
              })
            }
          >
            <option value="confirm-first">Confirm first</option>
            <option value="auto">Automatic</option>
            <option value="off">Off</option>
          </select>
          <p className="field-help">
            Portraits are considered only after the character appears in player-visible text. Confirm first saves an editable prompt without calling the image provider.
          </p>
        </label>
        <label className="field">
          <span>Base URL</span>
          <input
            value={props.providerSettings.baseUrl}
            onChange={(event) => updateSettings({ baseUrl: event.target.value })}
          />
        </label>
        <label className="field">
          <span>Model</span>
          {props.providerSettings.providerId === "local" ? (
            <input
              value={props.providerSettings.model}
              onChange={(event) => updateSettings({ model: event.target.value })}
            />
          ) : (
            <select
              value={props.providerSettings.model}
              onChange={(event) => updateSettings({ model: event.target.value })}
            >
              {textModelChoices.map((choice) => (
                <option key={choice.id} value={choice.id}>
                  {choice.label}
                </option>
              ))}
            </select>
          )}
        </label>
        <div className="settings-grid-two">
          <label className="field">
            <span>Context window tokens</span>
            <input
              aria-label="Context window tokens"
              type="number"
              min={1}
              value={props.providerSettings.contextWindowTokens ?? ""}
              placeholder="Use model preset or 16000 fallback"
              onChange={(event) => {
                const value = Number(event.target.value);
                updateSettings({ contextWindowTokens: Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined });
              }}
            />
          </label>
          <label className="field">
            <span>Maximum output tokens</span>
            <input
              aria-label="Maximum output tokens"
              type="number"
              min={1}
              value={props.providerSettings.maxOutputTokens ?? ""}
              placeholder="Use model preset"
              onChange={(event) => {
                const value = Number(event.target.value);
                updateSettings({ maxOutputTokens: Number.isFinite(value) && value > 0 ? Math.floor(value) : undefined });
              }}
            />
          </label>
        </div>
        <ModelPricingFields
          key={`${props.providerSettings.providerId}:${props.providerSettings.model}`}
          model={props.providerSettings.model}
          pricing={props.providerSettings.pricing}
          onChange={(pricing) => updateSettings({ pricing })}
        />
        <label className="field">
          <span>Session API key</span>
          <input
            type="password"
            value={props.sessionApiKey}
            onChange={(event) => props.setSessionApiKey(event.target.value)}
            placeholder={
              props.secureStorageStatus.available
                ? "Stored in OS keychain when activated"
                : "Held in memory for this session only"
            }
          />
        </label>
        <button className="primary-button full-width" type="button" onClick={() => void props.saveProviderKey()}>
          <LockKeyhole size={16} />
          {props.secureStorageStatus.available ? "Store key securely" : "Activate provider for session"}
        </button>
        {props.providerSettings.secretReference ? (
          <button className="secondary-button full-width" type="button" onClick={() => void props.forgetProviderKey()}>
            <X size={16} />
            Forget stored key
          </button>
        ) : null}
        <button className="secondary-button full-width" type="button" onClick={() => void props.testTextProvider()}>
          <Play size={16} />
          Test text provider
        </button>
        <p className="status-line" role="status" aria-live="polite">
          {props.providerKeyStatus}
        </p>
        <p className="status-line" role="status" aria-live="polite">
          {props.providerTestStatus}
        </p>
        <p className="status-line" role="status" aria-live="polite">
          Secret storage:{" "}
          {props.secureStorageStatus.available
            ? `OS keychain available (${props.secureStorageStatus.storageKind}).`
            : `session-only (${props.secureStorageStatus.reason ?? "desktop secure storage unavailable"}).`}
        </p>
        {props.providerSettings.secretReference ? (
          <p className="status-line">
            Stored reference: {props.providerSettings.secretReference.storageKind} /{" "}
            {props.providerSettings.secretReference.storageKey}
          </p>
        ) : null}
      </section>

      <section className="panel" aria-label="Image provider">
        <div className="section-title">
          <Brush size={17} />
          <h3>Image Provider</h3>
        </div>
        <p>
          Recommended free local path: <strong>{recommendedLocalImageProvider.displayName}</strong>. Paste a ComfyUI
          API workflow that uses <code className="inline-code">{"{{prompt}}"}</code> and{" "}
          <code className="inline-code">{"{{negative_prompt}}"}</code> placeholders.
        </p>
        <label className="field">
          <span>Provider</span>
          <select
            value={props.imageProviderSettings.mode}
            onChange={(event) =>
              props.setImageProviderSettings({
                ...props.imageProviderSettings,
                mode: event.target.value as ImageProviderMode,
              })
            }
          >
            <option value="comfyui">ComfyUI local API</option>
            <option value="prompt-only">Prompt only</option>
          </select>
        </label>
        <label className="field">
          <span>Local endpoint</span>
          <input
            value={props.imageProviderSettings.endpoint}
            onChange={(event) =>
              props.setImageProviderSettings({
                ...props.imageProviderSettings,
                endpoint: event.target.value,
              })
            }
          />
        </label>
        <label className="field">
          <span>ComfyUI API key</span>
          <input
            type="password"
            value={props.imageSessionApiKey}
            onChange={(event) => props.setImageSessionApiKey(event.target.value)}
            placeholder="Optional; held in memory for this session only"
          />
          <p className="field-help">Leave this blank for a normal local ComfyUI server. Use it only if your ComfyUI endpoint is behind an auth proxy.</p>
        </label>
        <label className="field">
          <span>Default model</span>
          <select
            value={props.imageProviderSettings.model}
            onChange={(event) =>
              props.setImageProviderSettings({
                ...props.imageProviderSettings,
                model: event.target.value,
              })
            }
          >
            {imageModelChoices.map((choice) => (
              <option key={choice.id} value={choice.id}>
                {choice.label}
              </option>
            ))}
          </select>
        </label>
        <button className="secondary-button full-width" type="button" onClick={() => void props.refreshComfyUICheckpoints()}>
          <RotateCcw size={16} />
          Refresh installed image models
        </button>
        <p className="status-line" role="status" aria-live="polite">
          {props.imageProviderStatus}
        </p>
        <div className="instruction-grid compact-fields">
          <label className="field">
            <span>Width</span>
            <input
              type="number"
              min={localImageMinimumImageSize}
              max={2048}
              step={64}
              value={props.imageProviderSettings.width}
              onChange={(event) =>
                props.setImageProviderSettings({
                  ...props.imageProviderSettings,
                  width: toLocalImageQualityDimension(event.target.value),
                })
              }
            />
          </label>
          <label className="field">
            <span>Height</span>
            <input
              type="number"
              min={localImageMinimumImageSize}
              max={2048}
              step={64}
              value={props.imageProviderSettings.height}
              onChange={(event) =>
                props.setImageProviderSettings({
                  ...props.imageProviderSettings,
                  height: toLocalImageQualityDimension(event.target.value),
                })
              }
            />
          </label>
          <label className="field">
            <span>Timeout ms</span>
            <input
              type="number"
              min={localImageMinimumPollTimeoutMs}
              max={600_000}
              step={5_000}
              value={props.imageProviderSettings.pollTimeoutMs}
              onChange={(event) =>
                props.setImageProviderSettings({
                  ...props.imageProviderSettings,
                  pollTimeoutMs: toBoundedNumber(
                    event.target.value,
                    defaultImageProviderSettings.pollTimeoutMs,
                    localImageMinimumPollTimeoutMs,
                    600_000,
                  ),
                })
              }
            />
          </label>
        </div>
        <div className="instruction-grid compact-fields">
          <label className="field">
            <span>Seed</span>
            <input
              type="number"
              min={-1}
              max={2_147_483_647}
              value={props.imageProviderSettings.seed}
              onChange={(event) =>
                props.setImageProviderSettings({
                  ...props.imageProviderSettings,
                  seed: toBoundedNumber(event.target.value, -1, -1, 2_147_483_647),
                })
              }
            />
            <p className="field-help">Use 0 or -1 for a fresh random seed each generation; use a positive number to repeat.</p>
          </label>
          <label className="field">
            <span>Steps</span>
            <input
              type="number"
              min={1}
              max={150}
              value={props.imageProviderSettings.steps}
              onChange={(event) =>
                props.setImageProviderSettings({
                  ...props.imageProviderSettings,
                  steps: toBoundedNumber(event.target.value, localImageRecommendedSteps, 1, 150),
                })
              }
            />
          </label>
          <label className="field">
            <span>CFG</span>
            <input
              type="number"
              min={1}
              max={30}
              step={0.5}
              value={props.imageProviderSettings.cfg}
              onChange={(event) =>
                props.setImageProviderSettings({
                  ...props.imageProviderSettings,
                  cfg: toBoundedFloat(event.target.value, localImageRecommendedCfg, 1, 30),
                })
              }
            />
          </label>
        </div>
        <div className="instruction-grid">
          <label className="field">
            <span>Sampler</span>
            <input
              value={props.imageProviderSettings.samplerName}
              onChange={(event) =>
                props.setImageProviderSettings({
                  ...props.imageProviderSettings,
                  samplerName: event.target.value,
                })
              }
            />
          </label>
          <label className="field">
            <span>Scheduler</span>
            <input
              value={props.imageProviderSettings.scheduler}
              onChange={(event) =>
                props.setImageProviderSettings({
                  ...props.imageProviderSettings,
                  scheduler: event.target.value,
                })
              }
            />
          </label>
        </div>
        <label className="field">
          <span>ComfyUI API workflow JSON</span>
          <p className="field-help">
            Export a workflow from ComfyUI with Save (API Format), then paste the JSON here. The app fills
            placeholders such as <code className="inline-code">{"{{prompt}}"}</code>,
            <code className="inline-code">{"{{negative_prompt}}"}</code>, width, height, seed, and model
            before sending it to your local ComfyUI server.
          </p>
          <textarea
            value={props.imageProviderSettings.workflowJson}
            onChange={(event) =>
              props.setImageProviderSettings({
                ...props.imageProviderSettings,
                workflowJson: event.target.value,
              })
            }
            placeholder='{"1":{"class_type":"SaveImage","inputs":{"filename_prefix":"local_cards"}}}'
            rows={8}
          />
        </label>
        <p className="status-line">
          Endpoint is restricted to loopback URLs. The app stores workflow/settings only, never image API keys.
        </p>
      </section>
    </div>
  );
}

function ModelPricingFields(props: {
  model: string;
  pricing: ProviderSettings["pricing"];
  onChange: (pricing: ProviderSettings["pricing"] | undefined) => void;
}) {
  const [inputRate, setInputRate] = useState(
    props.pricing ? String(props.pricing.inputUsdPerMillionTokens) : "",
  );
  const [outputRate, setOutputRate] = useState(
    props.pricing ? String(props.pricing.outputUsdPerMillionTokens) : "",
  );

  function updateRate(field: "input" | "output", raw: string) {
    const nextInput = field === "input" ? raw : inputRate;
    const nextOutput = field === "output" ? raw : outputRate;
    setInputRate(nextInput);
    setOutputRate(nextOutput);

    const inputUsdPerMillionTokens = parsePricingRate(nextInput);
    const outputUsdPerMillionTokens = parsePricingRate(nextOutput);
    if (inputUsdPerMillionTokens === undefined || outputUsdPerMillionTokens === undefined) {
      props.onChange(undefined);
      return;
    }
    props.onChange({
      model: props.model,
      currency: "USD",
      inputUsdPerMillionTokens,
      outputUsdPerMillionTokens,
      source: "user configured",
      effectiveDate: props.pricing?.effectiveDate ?? new Date().toISOString().slice(0, 10),
    });
  }

  function clearPricing() {
    setInputRate("");
    setOutputRate("");
    props.onChange(undefined);
  }

  return (
    <>
      <div className="settings-grid-two">
        <label className="field">
          <span>Input USD / 1M tokens</span>
          <input
            aria-label="Input USD per million tokens"
            type="number"
            min={0}
            step="0.000001"
            value={inputRate}
            placeholder="Unknown"
            onChange={(event) => updateRate("input", event.target.value)}
          />
        </label>
        <label className="field">
          <span>Output USD / 1M tokens</span>
          <input
            aria-label="Output USD per million tokens"
            type="number"
            min={0}
            step="0.000001"
            value={outputRate}
            placeholder="Unknown"
            onChange={(event) => updateRate("output", event.target.value)}
          />
        </label>
      </div>
      <p className="field-help">
        Model metadata determines context budgets. Both rates are required for an exact-model price snapshot; either blank rate reports cost as unknown.
      </p>
      {props.pricing ? (
        <button
          className="secondary-button compact-button"
          type="button"
          onClick={clearPricing}
        >
          Clear pricing snapshot
        </button>
      ) : null}
    </>
  );
}

function parsePricingRate(raw: string): number | undefined {
  if (raw.trim() === "") {
    return undefined;
  }
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}
