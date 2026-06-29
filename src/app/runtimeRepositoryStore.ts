import { createMigratedDatabaseDriver } from "../db/client";
import { CharacterRepository } from "../db/repositories/characters";
import { ChatRepository } from "../db/repositories/chats";
import { ImagePromptRunRepository } from "../db/repositories/imagePromptRuns";
import { LorebookEntryRepository, LorebookRepository } from "../db/repositories/lorebooks";
import { MemoryEntryRepository } from "../db/repositories/memoryEntries";
import { ModelProviderConfigRepository } from "../db/repositories/modelProviderConfigs";
import { MessageRepository } from "../db/repositories/messages";
import { PromptRunRepository } from "../db/repositories/promptRuns";
import { RpgStateSnapshotRepository } from "../db/repositories/rpgStateSnapshots";
import { runInTransaction } from "../db/transaction";
import type { SqlDriver } from "../db/types";
import type { JsonObject } from "../db/repositories/shared";
import {
  sanitizePersistedProviderSettings,
  type LocalRuntimeSnapshot,
  type PersistedTheme,
} from "./localRuntimeStore";
import { TauriRuntimeRepositoryStore, type TauriInvoke } from "./tauriRuntimeRepositoryClient";

export const RUNTIME_CHAT_ID = "chat_local_cards_runtime";
export const RUNTIME_BRANCH_ID = "branch_local_cards_runtime";
export const RUNTIME_SNAPSHOT_CHARACTER_ID = "char_local_cards_runtime_snapshot";

type RuntimeCardRecord = Record<string, unknown> & {
  id: string;
  name: string;
  kind: string;
};

type RuntimeMessageRecord = Record<string, unknown> & {
  id: string;
  role: "system" | "user" | "assistant";
  content: string;
};

type RuntimePromptRunRecord = Record<string, unknown> & {
  id: string;
  cardId: string;
  chatId: string;
  compiledPrompt: string;
  response: string;
  provider: string;
  model: string;
  tokenEstimate: number;
  includedLayerIds: string[];
  includedLoreEntryIds: string[];
  warnings: string[];
  stateChanges: string[];
  usage?: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
};

type RuntimeChatSessionRecord = Record<string, unknown> & {
  id: string;
  cardId: string;
  title: string;
  messages: RuntimeMessageRecord[];
};

export type RepositoryRuntimeSnapshot = LocalRuntimeSnapshot<
  RuntimeCardRecord,
  RuntimeMessageRecord,
  RuntimePromptRunRecord,
  RuntimeChatSessionRecord
>;

export interface RuntimeRepositoryStoreOptions {
  driver?: SqlDriver;
  databasePath?: string;
  invokeImpl?: TauriInvoke;
}

export interface RuntimeRepositoryStoreStatus {
  backend: "tauri-sqlite" | "in-memory-sqlite";
}

export interface RuntimeRepository {
  getStatus(): RuntimeRepositoryStoreStatus;
  loadSnapshot(): Promise<RepositoryRuntimeSnapshot | null>;
  saveSnapshot(snapshot: RepositoryRuntimeSnapshot): Promise<void>;
}

export class RuntimeRepositoryStore implements RuntimeRepository {
  private readonly characters: CharacterRepository;
  private readonly chats: ChatRepository;
  private readonly imagePromptRuns: ImagePromptRunRepository;
  private readonly lorebookEntries: LorebookEntryRepository;
  private readonly lorebooks: LorebookRepository;
  private readonly memories: MemoryEntryRepository;
  private readonly messages: MessageRepository;
  private readonly modelProviderConfigs: ModelProviderConfigRepository;
  private readonly promptRuns: PromptRunRepository;
  private readonly rpgStateSnapshots: RpgStateSnapshotRepository;
  private readyChat = false;

  private constructor(
    private readonly driver: SqlDriver,
    private readonly status: RuntimeRepositoryStoreStatus,
  ) {
    this.characters = new CharacterRepository(driver);
    this.chats = new ChatRepository(driver);
    this.imagePromptRuns = new ImagePromptRunRepository(driver);
    this.lorebookEntries = new LorebookEntryRepository(driver);
    this.lorebooks = new LorebookRepository(driver);
    this.memories = new MemoryEntryRepository(driver);
    this.messages = new MessageRepository(driver);
    this.modelProviderConfigs = new ModelProviderConfigRepository(driver);
    this.promptRuns = new PromptRunRepository(driver);
    this.rpgStateSnapshots = new RpgStateSnapshotRepository(driver);
  }

  static async create(options: RuntimeRepositoryStoreOptions = {}): Promise<RuntimeRepository> {
    if (!options.driver && isTauriRuntime()) {
      return TauriRuntimeRepositoryStore.create({
        databasePath: options.databasePath,
        invokeImpl: options.invokeImpl,
      });
    }

    const driver = options.driver ?? (await createMigratedDatabaseDriver());
    const status: RuntimeRepositoryStoreStatus = {
      backend: "in-memory-sqlite",
    };
    return new RuntimeRepositoryStore(driver, status);
  }

  getStatus(): RuntimeRepositoryStoreStatus {
    return this.status;
  }

  async loadSnapshot(): Promise<RepositoryRuntimeSnapshot | null> {
    const storedCards = await this.characters.getById(RUNTIME_SNAPSHOT_CHARACTER_ID);
    if (!storedCards) {
      return null;
    }

    const snapshotMeta = storedCards.profile.snapshot as Partial<RepositoryRuntimeSnapshot> | undefined;
    if (!snapshotMeta || !Array.isArray(snapshotMeta.cards)) {
      return null;
    }

    const chat = await this.chats.getById(RUNTIME_CHAT_ID);
    const branchId = chat?.activeBranchId ?? RUNTIME_BRANCH_ID;
    const messageRows = chat ? await this.messages.listByBranch(RUNTIME_CHAT_ID, branchId) : [];
    const promptRunRows = chat ? await this.promptRuns.listByChat(RUNTIME_CHAT_ID) : [];
    const snapshotMessages = Array.isArray(snapshotMeta.messages)
      ? (snapshotMeta.messages as RuntimeMessageRecord[])
      : undefined;
    const snapshotPromptRuns = Array.isArray(snapshotMeta.promptRuns)
      ? (snapshotMeta.promptRuns as RuntimePromptRunRecord[])
      : undefined;

    const normalizedCards = await this.overlayNormalizedCardData(snapshotMeta.cards as RuntimeCardRecord[]);

    return {
      version: 2,
      theme: snapshotMeta.theme === "light" ? "light" : "dark",
      activeCardId:
        typeof snapshotMeta.activeCardId === "string"
          ? snapshotMeta.activeCardId
          : normalizedCards[0]?.id ?? "",
      cards: normalizedCards,
      messages:
        snapshotMessages ??
        messageRows.map((message) => ({
          id: message.id,
          role: normalizeMessageRole(message.role),
          content: message.content,
          ...message.metadata,
        })),
      chatSessions: Array.isArray(snapshotMeta.chatSessions)
        ? (snapshotMeta.chatSessions as RuntimeChatSessionRecord[])
        : undefined,
      activeChatIds: getStringRecord(snapshotMeta.activeChatIds),
      promptRuns:
        snapshotPromptRuns ??
        promptRunRows.map((run) => ({
          id: run.id,
          cardId: getString(run.request.cardId, ""),
          chatId: getString(run.request.chatId, RUNTIME_CHAT_ID),
          compiledPrompt: run.compiledPrompt,
          response: run.responseText ?? "",
          provider: run.provider,
          model: run.model,
          tokenEstimate: getNumber(run.modelSettings.tokenEstimate, 0),
          includedLayerIds: getStringArray(run.request.includedLayerIds),
          includedLoreEntryIds: run.includedLoreEntryIds,
          warnings: getStringArray(run.stateChanges.warnings),
          stateChanges: getStringArray(run.stateChanges.changes),
          usage: readUsage(run.modelSettings.usage),
        })),
      providerKeyStatus:
        typeof snapshotMeta.providerKeyStatus === "string"
          ? snapshotMeta.providerKeyStatus
          : "No plaintext keys stored.",
      providerSettings: sanitizePersistedProviderSettings(snapshotMeta.providerSettings),
      imageProviderSettings: getRecord(snapshotMeta.imageProviderSettings),
      runtimeSettings: getRecord(snapshotMeta.runtimeSettings),
      generatedMaps: getArray(snapshotMeta.generatedMaps),
      savedAt: typeof snapshotMeta.savedAt === "string" ? snapshotMeta.savedAt : storedCards.updatedAt,
    };
  }

  async saveSnapshot(snapshot: RepositoryRuntimeSnapshot): Promise<void> {
    await runInTransaction(this.driver, async () => {
      await this.saveSnapshotUnsafe(snapshot);
    });
  }

  private async saveSnapshotUnsafe(snapshot: RepositoryRuntimeSnapshot): Promise<void> {
    await this.ensureRuntimeChat();
    const previousRuntime = await this.characters.getById(RUNTIME_SNAPSHOT_CHARACTER_ID);
    const previousSnapshot = isRecord(previousRuntime?.profile.snapshot)
      ? (previousRuntime.profile.snapshot as Partial<RepositoryRuntimeSnapshot>)
      : null;
    await this.characters.upsert({
      id: RUNTIME_SNAPSHOT_CHARACTER_ID,
      name: "Local Cards runtime snapshot",
      description: "Serialized card library and runtime UI state.",
      source: "runtime-snapshot",
      profile: {
        snapshot: {
          version: 2,
          theme: snapshot.theme,
          activeCardId: snapshot.activeCardId,
          cards: snapshot.cards,
          messages: snapshot.messages,
          chatSessions: snapshot.chatSessions,
          activeChatIds: snapshot.activeChatIds,
          promptRuns: snapshot.promptRuns,
          providerKeyStatus: snapshot.providerKeyStatus,
          providerSettings: sanitizePersistedProviderSettings(snapshot.providerSettings),
          imageProviderSettings: getRecord(snapshot.imageProviderSettings),
          runtimeSettings: getRecord(snapshot.runtimeSettings),
          generatedMaps: getArray(snapshot.generatedMaps),
          savedAt: snapshot.savedAt,
        },
      },
    });
    await this.saveProviderConfig(snapshot);
    await this.pruneDeletedRuntimeRows(snapshot, previousSnapshot);
    await this.saveCardData(snapshot);

    const messagesToPersist = flattenSnapshotMessages(snapshot);
    const existingMessages = new Set((await this.messages.listByBranch(RUNTIME_CHAT_ID, RUNTIME_BRANCH_ID)).map((message) => message.id));
    let previousMessageId: string | null = null;
    for (const message of messagesToPersist) {
      if (!existingMessages.has(message.id)) {
        await this.messages.create({
          id: message.id,
          chatId: RUNTIME_CHAT_ID,
          branchId: RUNTIME_BRANCH_ID,
          parentMessageId: previousMessageId,
          role: message.role,
          content: message.content,
          metadata: stripMessageMetadata(message),
        });
        existingMessages.add(message.id);
      }
      previousMessageId = message.id;
    }

    const existingPromptRuns = new Set((await this.promptRuns.listByChat(RUNTIME_CHAT_ID)).map((run) => run.id));
    for (const run of snapshot.promptRuns) {
      if (existingPromptRuns.has(run.id)) {
        continue;
      }

      await this.promptRuns.create({
        id: run.id,
        chatId: RUNTIME_CHAT_ID,
        messageId: findAssistantMessageIdForRun(messagesToPersist, run.id),
        provider: run.provider,
        model: run.model,
        compiledPrompt: run.compiledPrompt,
        includedLoreEntryIds: run.includedLoreEntryIds,
        responseText: run.response,
        extractionJson: {},
        stateChanges: {
          changes: run.stateChanges,
          warnings: run.warnings,
        },
        request: {
          cardId: run.cardId,
          chatId: run.chatId,
          includedLayerIds: run.includedLayerIds,
        },
        modelSettings: {
          tokenEstimate: run.tokenEstimate,
          usage: run.usage,
        },
      });
      existingPromptRuns.add(run.id);
    }
  }

  private async overlayNormalizedCardData(cards: RuntimeCardRecord[]): Promise<RuntimeCardRecord[]> {
    const memories = await this.memories.listByChat(RUNTIME_CHAT_ID).catch(() => []);
    const rpgSnapshots = await this.rpgStateSnapshots.listByChat(RUNTIME_CHAT_ID).catch(() => []);

    return Promise.all(
      cards.map(async (card) => {
        const lorebooks = Array.isArray(card.lorebooks) ? card.lorebooks : [];
        const normalizedLorebooks = await Promise.all(
          lorebooks.map(async (lorebook) => {
            if (!isRecord(lorebook) || typeof lorebook.id !== "string") {
              return lorebook;
            }
            const entries = await this.lorebookEntries.listByLorebook(lorebook.id).catch(() => []);
            if (entries.length === 0) {
              return lorebook;
            }
            return {
              ...lorebook,
              entries: entries.map((entry) => ({
                id: entry.id,
                title: entry.title,
                content: entry.content,
                enabled: getBoolean(entry.triggers.enabled, true),
                constant: entry.constant,
                keys: getStringArray(entry.triggers.keys),
                secondaryKeys: getStringArray(entry.triggers.secondaryKeys),
                insertionOrder: getNumber(entry.triggers.insertionOrder, 100),
                priority: getNumber(entry.triggers.priority, 0),
                probability: getNumber(entry.triggers.probability, 100),
                caseSensitive: getBoolean(entry.triggers.caseSensitive, false),
                wholeWord: getBoolean(entry.triggers.wholeWord, false),
              })),
            };
          }),
        );
        const cardMemories = memories
          .filter((memory) => memory.relatedCharacterIds.includes(card.id))
          .map((memory) => ({
            id: memory.id,
            label: memory.category.replace(/^card_memory:/, "") || "Memory",
            detail: memory.text,
          }));
        const rpgSnapshot = rpgSnapshots.find((snapshot) => snapshot.worldId === card.id);

        return {
          ...card,
          ...(normalizedLorebooks.length > 0 ? { lorebooks: normalizedLorebooks } : {}),
          ...(cardMemories.length > 0 ? { memory: cardMemories } : {}),
          ...(rpgSnapshot ? { rpg: rpgSnapshot.payload } : {}),
        };
      }),
    );
  }

  private async saveProviderConfig(snapshot: RepositoryRuntimeSnapshot): Promise<void> {
    const providerSettings = sanitizePersistedProviderSettings(snapshot.providerSettings);
    if (!providerSettings) {
      return;
    }

    await this.modelProviderConfigs.upsert({
      id: `provider_${getString(providerSettings.providerId, "runtime")}`,
      providerId: getString(providerSettings.providerId, "runtime"),
      displayName: getString(providerSettings.displayName, "Runtime provider"),
      baseUrl: typeof providerSettings.baseUrl === "string" ? providerSettings.baseUrl : null,
      defaultModelId: typeof providerSettings.model === "string" ? providerSettings.model : null,
      secretRef: providerSettings.secretReference ? JSON.stringify(providerSettings.secretReference) : null,
      nonSecretSettings: {
        mode: providerSettings.mode,
        providerId: providerSettings.providerId,
        displayName: providerSettings.displayName,
        baseUrl: providerSettings.baseUrl,
        model: providerSettings.model,
      },
    });
  }

  private async saveCardData(snapshot: RepositoryRuntimeSnapshot): Promise<void> {
    await this.memories.deleteByChat(RUNTIME_CHAT_ID);

    for (const card of snapshot.cards) {
      await this.saveMemoriesForCard(card);
      await this.saveLorebooksForCard(card);
      await this.saveRpgStateForCard(card);
    }

    for (const generatedMap of getArray(snapshot.generatedMaps)) {
      if (!isRecord(generatedMap) || typeof generatedMap.id !== "string" || typeof generatedMap.prompt !== "string") {
        continue;
      }
      await this.imagePromptRuns.upsert({
        id: generatedMap.id,
        chatId: typeof generatedMap.chatId === "string" ? generatedMap.chatId : RUNTIME_CHAT_ID,
        messageId: null,
        provider: typeof generatedMap.provider === "string" ? generatedMap.provider : null,
        compiledPrompt: generatedMap.prompt,
        negativePrompt: typeof generatedMap.negativePrompt === "string" ? generatedMap.negativePrompt : null,
        stylePreset: typeof generatedMap.model === "string" ? generatedMap.model : null,
        resultUri: typeof generatedMap.imageUrl === "string" ? generatedMap.imageUrl : null,
        createdAt: typeof generatedMap.createdAt === "string" ? generatedMap.createdAt : undefined,
      });
    }
  }

  private async pruneDeletedRuntimeRows(
    snapshot: RepositoryRuntimeSnapshot,
    previousSnapshot: Partial<RepositoryRuntimeSnapshot> | null,
  ): Promise<void> {
    await this.driver.execute("DELETE FROM messages WHERE chat_id = $1", [RUNTIME_CHAT_ID]);
    await this.driver.execute("DELETE FROM prompt_runs WHERE chat_id = $1", [RUNTIME_CHAT_ID]);

    const previousIds = collectSnapshotSideTableIds(previousSnapshot);
    const currentIds = collectSnapshotSideTableIds(snapshot);
    for (const id of previousIds.imagePromptRunIds) {
      if (!currentIds.imagePromptRunIds.has(id)) {
        await this.driver.execute("DELETE FROM image_prompt_runs WHERE id = $1", [id]);
      }
    }
    for (const id of previousIds.rpgStateSnapshotIds) {
      if (!currentIds.rpgStateSnapshotIds.has(id)) {
        await this.driver.execute("DELETE FROM rpg_state_snapshots WHERE id = $1", [id]);
      }
    }
    for (const id of previousIds.lorebookEntryIds) {
      if (!currentIds.lorebookEntryIds.has(id)) {
        await this.driver.execute("DELETE FROM lorebook_entries WHERE id = $1", [id]);
      }
    }
    for (const id of previousIds.lorebookIds) {
      if (!currentIds.lorebookIds.has(id)) {
        await this.driver.execute("DELETE FROM lorebooks WHERE id = $1", [id]);
      }
    }
  }

  private async saveMemoriesForCard(card: RuntimeCardRecord): Promise<void> {
    const memories = Array.isArray(card.memory) ? card.memory : [];
    for (const memory of memories) {
      if (!isRecord(memory) || typeof memory.detail !== "string") {
        continue;
      }
      const id = typeof memory.id === "string" ? memory.id : `memory_${card.id}_${memory.detail.slice(0, 24)}`;
      const label = typeof memory.label === "string" ? memory.label : "Memory";
      await this.memories.upsert({
        id,
        chatId: RUNTIME_CHAT_ID,
        category: `card_memory:${label}`,
        text: memory.detail,
        relatedCharacterIds: [card.id],
        relatedEventIds: [],
      });
    }
  }

  private async saveLorebooksForCard(card: RuntimeCardRecord): Promise<void> {
    const lorebooks = Array.isArray(card.lorebooks) ? card.lorebooks : [];
    for (const lorebook of lorebooks) {
      if (!isRecord(lorebook) || typeof lorebook.id !== "string") {
        continue;
      }
      await this.lorebooks.upsert({
        id: lorebook.id,
        name: getString(lorebook.name, "Card Lorebook"),
        description: `card:${card.id}`,
      });
      await this.lorebookEntries.deleteByLorebook(lorebook.id);
      const entries = Array.isArray(lorebook.entries) ? lorebook.entries : [];
      for (const entry of entries) {
        if (!isRecord(entry) || typeof entry.id !== "string" || typeof entry.content !== "string") {
          continue;
        }
        await this.lorebookEntries.upsert({
          id: entry.id,
          lorebookId: lorebook.id,
          title: getString(entry.title, "Untitled lore entry"),
          content: entry.content,
          constant: getBoolean(entry.constant, false),
          tokenBudget: getNumber(lorebook.tokenBudget, 800),
          triggers: {
            enabled: getBoolean(entry.enabled, true),
            keys: getStringArray(entry.keys),
            secondaryKeys: getStringArray(entry.secondaryKeys),
            insertionOrder: getNumber(entry.insertionOrder, 100),
            priority: getNumber(entry.priority, 0),
            probability: getNumber(entry.probability, 100),
            caseSensitive: getBoolean(entry.caseSensitive, false),
            wholeWord: getBoolean(entry.wholeWord, false),
          },
        });
      }
    }
  }

  private async saveRpgStateForCard(card: RuntimeCardRecord): Promise<void> {
    if (!isRecord(card.rpg) || card.kind !== "rpg") {
      return;
    }

    await this.rpgStateSnapshots.upsert({
      id: `state_${card.id}`,
      worldId: card.id,
      chatId: RUNTIME_CHAT_ID,
      branchId: RUNTIME_BRANCH_ID,
      messageId: "runtime_snapshot",
      payload: card.rpg,
    });
  }

  private async ensureRuntimeChat(): Promise<void> {
    if (this.readyChat) {
      return;
    }

    const existing = await this.chats.getById(RUNTIME_CHAT_ID);
    if (!existing) {
      await this.chats.create({
        id: RUNTIME_CHAT_ID,
        title: "Local Cards runtime",
        mode: "rpg",
        branchId: RUNTIME_BRANCH_ID,
        metadata: {
          source: "local-cards-ui",
        },
      });
    }
    this.readyChat = true;
  }
}

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function normalizeMessageRole(role: string): RuntimeMessageRecord["role"] {
  return role === "system" || role === "assistant" || role === "user" ? role : "assistant";
}

function stripMessageMetadata(message: RuntimeMessageRecord): JsonObject {
  const { id: _id, role: _role, content: _content, ...metadata } = message;
  return metadata as JsonObject;
}

function collectSnapshotSideTableIds(snapshot: Partial<RepositoryRuntimeSnapshot> | null): {
  imagePromptRunIds: Set<string>;
  lorebookIds: Set<string>;
  lorebookEntryIds: Set<string>;
  rpgStateSnapshotIds: Set<string>;
} {
  const imagePromptRunIds = new Set<string>();
  const lorebookIds = new Set<string>();
  const lorebookEntryIds = new Set<string>();
  const rpgStateSnapshotIds = new Set<string>();

  for (const map of getArray(snapshot?.generatedMaps)) {
    if (isRecord(map) && typeof map.id === "string") {
      imagePromptRunIds.add(map.id);
    }
  }

  for (const card of Array.isArray(snapshot?.cards) ? snapshot.cards : []) {
    if (!isRecord(card) || typeof card.id !== "string") {
      continue;
    }
    if (card.kind === "rpg" && isRecord(card.rpg)) {
      rpgStateSnapshotIds.add(`state_${card.id}`);
    }
    const lorebooks = Array.isArray(card.lorebooks) ? card.lorebooks : [];
    for (const lorebook of lorebooks) {
      if (!isRecord(lorebook) || typeof lorebook.id !== "string") {
        continue;
      }
      lorebookIds.add(lorebook.id);
      const entries = Array.isArray(lorebook.entries) ? lorebook.entries : [];
      for (const entry of entries) {
        if (isRecord(entry) && typeof entry.id === "string") {
          lorebookEntryIds.add(entry.id);
        }
      }
    }
  }

  return {
    imagePromptRunIds,
    lorebookIds,
    lorebookEntryIds,
    rpgStateSnapshotIds,
  };
}

function flattenSnapshotMessages(snapshot: RepositoryRuntimeSnapshot): RuntimeMessageRecord[] {
  const messages = new Map<string, RuntimeMessageRecord>();
  for (const message of snapshot.messages) {
    messages.set(message.id, message);
  }
  for (const session of snapshot.chatSessions ?? []) {
    for (const message of session.messages ?? []) {
      messages.set(message.id, message);
    }
  }
  return [...messages.values()];
}

function findAssistantMessageIdForRun(messages: RuntimeMessageRecord[], runId: string): string | null {
  return messages.find((message) => message.id === `assistant-${runId}`)?.id ?? null;
}

function readUsage(value: unknown): RuntimePromptRunRecord["usage"] | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const inputTokens = getNumber(value.inputTokens, 0);
  const outputTokens = getNumber(value.outputTokens, 0);
  const totalTokens = getNumber(value.totalTokens, inputTokens + outputTokens);
  if (totalTokens <= 0) {
    return undefined;
  }

  return {
    inputTokens,
    outputTokens,
    totalTokens,
  };
}

function getString(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function getRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function getArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function getNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function getBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function getStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function getStringRecord(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const record: Record<string, string> = {};
  for (const [key, field] of Object.entries(value)) {
    if (typeof field === "string") {
      record[key] = field;
    }
  }
  return Object.keys(record).length > 0 ? record : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
