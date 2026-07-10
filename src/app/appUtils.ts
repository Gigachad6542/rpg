// Generic runtime utilities and snapshot adapters extracted from App.tsx.
// Pure helpers with no React or App-state dependencies.
import type { AppRuntimeSnapshot } from "./runtimeTypes";
import type { RepositoryRuntimeSnapshot } from "./runtimeRepositoryStore";
import type { RuntimeExportSnapshot } from "./runtimeDataBundle";

export function toRepositorySnapshot(snapshot: AppRuntimeSnapshot): RepositoryRuntimeSnapshot {
  return snapshot as unknown as RepositoryRuntimeSnapshot;
}

export function toRuntimeExportSnapshot(snapshot: AppRuntimeSnapshot): RuntimeExportSnapshot {
  return snapshot as unknown as RuntimeExportSnapshot;
}

export function formatDownloadTimestamp(value: string): string {
  return value.replace(/[:.]/g, "-");
}

export function formatRestorePointTime(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "unknown time";
  }
  return parsed.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function findScrollableAncestor(target: EventTarget | null): HTMLElement | null {
  let element = target instanceof HTMLElement ? target : null;
  while (element) {
    const style = window.getComputedStyle(element);
    const canScrollY = /(auto|scroll)/.test(style.overflowY) && element.scrollHeight > element.clientHeight;
    const canScrollX = /(auto|scroll)/.test(style.overflowX) && element.scrollWidth > element.clientWidth;
    if (canScrollY || canScrollX) {
      return element;
    }
    element = element.parentElement;
  }

  const root = document.scrollingElement;
  return root instanceof HTMLElement ? root : null;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function readFileAsText(file: File): Promise<string> {
  if (typeof file.text === "function") {
    return file.text();
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result ?? "")));
    reader.addEventListener("error", () => reject(new Error("Could not read Chub lorebook file.")));
    reader.readAsText(file);
  });
}

export function parseJsonRecordOrThrow(value: string, message: string): Record<string, unknown> {
  try {
    const parsed: unknown = JSON.parse(value);
    if (isRecord(parsed)) {
      return parsed;
    }
  } catch {
    // fall through to shared error
  }
  throw new Error(message);
}

export function getPayloadString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export function getPayloadNumber(value: unknown, fallback: number, min: number, max: number): number {
  // An absent or blank payload field must fall back, not clamp: toBoundedNumber
  // parses "" as 0, which imported lore entries with probability 0 (never
  // triggered), scan depth 1, and token budget 100.
  if (typeof value === "number") {
    return toBoundedNumber(value, fallback, min, max);
  }
  if (typeof value === "string" && value.trim()) {
    return toBoundedNumber(value.trim(), fallback, min, max);
  }
  return fallback;
}

export function getPayloadBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function getPayloadStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return parseList(value);
  }
  return [];
}

export function downloadJson(filename: string, payload: unknown) {
  const json = JSON.stringify(payload, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "lorebook";
}

export function parseList(value: string): string[] {
  return value
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function formatFlagsForInput(flags: Record<string, boolean>): string {
  return Object.entries(flags)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join("\n");
}

export function parseFlags(value: string): Record<string, boolean> {
  const flags: Record<string, boolean> = {};
  for (const line of value.split(/\n|,/)) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }

    const [rawKey, rawValue = "true"] = trimmed.split("=");
    const key = rawKey.trim();
    if (!key) {
      continue;
    }

    flags[key] = rawValue.trim().toLowerCase() !== "false";
  }
  return flags;
}

export function titleCase(value: string): string {
  return value
    .split(/\s+/)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function toBoundedNumber(value: string | number, fallback: number, min: number, max: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.trunc(parsed)));
}

export function toBoundedFloat(value: string | number, fallback: number, min: number, max: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
}
