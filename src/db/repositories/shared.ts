import type { RepositoryOptions } from "../types";

export type JsonObject = Record<string, unknown>;

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | {
      [key: string]: JsonValue;
    };

export type RepositoryContext = {
  now: () => string;
  idFactory: (prefix: string) => string;
};

export function createRepositoryContext(options: RepositoryOptions = {}): RepositoryContext {
  return {
    now: options.now ?? (() => new Date().toISOString()),
    idFactory: options.idFactory ?? defaultIdFactory,
  };
}

export function stringifyJson(value: unknown, fallback: unknown): string {
  return JSON.stringify(value ?? fallback);
}

export function parseJson<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined || value === "") {
    return fallback;
  }

  if (typeof value !== "string") {
    return value as T;
  }

  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function toSqlBoolean(value: boolean): number {
  return value ? 1 : 0;
}

export function fromSqlBoolean(value: unknown): boolean {
  return value === true || value === 1 || value === "1";
}

function defaultIdFactory(prefix: string): string {
  const randomId =
    globalThis.crypto && "randomUUID" in globalThis.crypto
      ? globalThis.crypto.randomUUID()
      : `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;

  return `${prefix}_${randomId.replace(/-/g, "")}`;
}
