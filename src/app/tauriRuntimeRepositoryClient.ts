import type {
  RepositoryRuntimeSnapshot,
  RuntimeRepository,
  RuntimeRepositoryStoreStatus,
} from "./runtimeRepositoryStore";
import {
  sanitizePersistedRuntimeSettings,
  sanitizePromptRunsForPersistence,
} from "./localRuntimeStore";

export type TauriInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

export interface TauriRuntimeRepositoryOptions {
  databasePath?: string;
  invokeImpl?: TauriInvoke;
}

export interface RuntimeRepositoryInitialization {
  backend: "tauri-sqlite";
  schemaVersion: number;
  migrations: Array<{
    version: number;
    name: string;
    status: "applied" | "skipped";
  }>;
}

interface LoadRuntimeSnapshotResponse {
  snapshot: RepositoryRuntimeSnapshot | null;
}

interface SaveRuntimeSnapshotResponse {
  saved: true;
}

export class TauriRuntimeRepositoryStore implements RuntimeRepository {
  private constructor(
    private readonly invokeImpl: TauriInvoke,
    private readonly databasePath: string | undefined,
    private readonly initialization: RuntimeRepositoryInitialization,
  ) {}

  static async create(options: TauriRuntimeRepositoryOptions = {}): Promise<TauriRuntimeRepositoryStore> {
    const invokeImpl = options.invokeImpl ?? invokeTauriCommand;
    const initialization = await invokeImpl<RuntimeRepositoryInitialization>("initialize_runtime_repository", {
      databasePath: options.databasePath,
    });

    return new TauriRuntimeRepositoryStore(invokeImpl, options.databasePath, initialization);
  }

  getStatus(): RuntimeRepositoryStoreStatus {
    return {
      backend: this.initialization.backend,
    };
  }

  async loadSnapshot(): Promise<RepositoryRuntimeSnapshot | null> {
    const response = await this.invokeImpl<LoadRuntimeSnapshotResponse>("load_runtime_snapshot", {
      databasePath: this.databasePath,
    });
    return response.snapshot;
  }

  async saveSnapshot(snapshot: RepositoryRuntimeSnapshot): Promise<void> {
    const runtimeSettings = sanitizePersistedRuntimeSettings(snapshot.runtimeSettings);
    await this.invokeImpl<SaveRuntimeSnapshotResponse>("save_runtime_snapshot", {
      databasePath: this.databasePath,
      snapshot: {
        ...snapshot,
        promptRuns: sanitizePromptRunsForPersistence(snapshot.promptRuns, runtimeSettings),
        runtimeSettings,
      },
    });
  }
}

async function invokeTauriCommand<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, args);
}
