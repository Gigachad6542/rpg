import type { JsonValue } from "../domain";

export type SqlValue = string | number | boolean | null | JsonValue;

export interface SqlDriver {
  execute(sql: string, params?: SqlValue[]): Promise<{ rowsAffected: number }>;
  select<TRecord extends Record<string, unknown>>(sql: string, params?: SqlValue[]): Promise<TRecord[]>;
}

export interface TableBackedSqlDriver extends SqlDriver {
  hasTable(name: string): boolean;
  createTable(name: string): void;
  insert(table: string, row: Record<string, unknown>): Promise<void>;
  upsert(table: string, row: Record<string, unknown>, key?: string): Promise<void>;
  updateWhere(
    table: string,
    predicate: (row: Record<string, unknown>) => boolean,
    patch: Record<string, unknown>,
  ): Promise<number>;
  listTable<TRecord extends Record<string, unknown>>(
    table: string,
    predicate?: (row: TRecord) => boolean,
  ): Promise<TRecord[]>;
  getById<TRecord extends Record<string, unknown>>(table: string, id: string): Promise<TRecord | null>;
}

export function serializeJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

export function parseJson<T>(value: unknown, fallback: T): T {
  if (typeof value !== "string") {
    return fallback;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

