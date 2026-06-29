export type SqlValue = string | number | boolean | null | Uint8Array;

export type SqlRow = Record<string, unknown>;

export interface SqlExecutionResult {
  rowsAffected: number;
  lastInsertId?: number;
}

export interface SqlDriver {
  execute(statement: string, bindValues?: readonly unknown[]): Promise<SqlExecutionResult>;
  select<T extends SqlRow = SqlRow>(query: string, bindValues?: readonly unknown[]): Promise<T[]>;
  transaction?<T>(operation: (driver: SqlDriver) => Promise<T>): Promise<T>;
  close?(): Promise<boolean | void>;
}

export interface Migration {
  version: number;
  name: string;
  statements: readonly string[];
}

export type MigrationStatus = "applied" | "skipped";

export interface MigrationResult {
  version: number;
  name: string;
  status: MigrationStatus;
}

export interface RepositoryOptions {
  now?: () => string;
  idFactory?: (prefix: string) => string;
}
