// Persona profile helpers: parsing, migration, sanitization, and prompt/lore selection.
//
// A persona is the *user's* side of a scene: the name and description the card
// should account for without speaking as the player. Personas replace the single
// `runtimeSettings.impersonationPrompt` string that used to hold this text.
import type { Lorebook, Persona, RuntimeCard } from "./runtimeTypes";
import { createRuntimeEntityId } from "./chatSessions";
import { isRecord } from "./appUtils";
import { normalizeCardLorebooks } from "./cardNormalization";

export const DEFAULT_PERSONA_ID = "persona_default";
export const DEFAULT_PERSONA_NAME = "Default persona";

const MAX_PERSONA_NAME_LENGTH = 80;
const MAX_PERSONA_DESCRIPTION_LENGTH = 8_000;

export function createPersona(name: string, description = ""): Persona {
  return {
    id: createRuntimeEntityId("persona"),
    name: name.trim() || "Untitled persona",
    description,
    lorebooks: [],
    isDefault: false,
  };
}

export function createDefaultPersona(description = ""): Persona {
  return {
    id: DEFAULT_PERSONA_ID,
    name: DEFAULT_PERSONA_NAME,
    description,
    lorebooks: [],
    isDefault: true,
  };
}

/**
 * Parses persisted personas, migrating the legacy single impersonation prompt
 * into a default persona when no personas have been saved yet. Always returns at
 * least one persona so the runtime never has to handle an empty roster.
 */
export function parsePersonas(value: unknown, legacyImpersonationPrompt = ""): Persona[] {
  const parsed = Array.isArray(value)
    ? value.filter(isRecord).map(parsePersona).filter((persona): persona is Persona => Boolean(persona))
    : [];

  if (parsed.length === 0) {
    return [createDefaultPersona(legacyImpersonationPrompt)];
  }

  return ensureSingleDefault(dedupePersonaIds(parsed));
}

export function parseActivePersonaId(value: unknown, personas: Persona[]): string {
  if (typeof value === "string" && personas.some((persona) => persona.id === value)) {
    return value;
  }
  return getDefaultPersona(personas).id;
}

export function getActivePersona(personas: Persona[], activePersonaId: string): Persona | null {
  return personas.find((persona) => persona.id === activePersonaId) ?? personas[0] ?? null;
}

export function getDefaultPersona(personas: Persona[]): Persona {
  return personas.find((persona) => persona.isDefault) ?? personas[0] ?? createDefaultPersona();
}

/** Marks `personaId` as the default, clearing the flag on every other persona. */
export function setDefaultPersona(personas: Persona[], personaId: string): Persona[] {
  if (!personas.some((persona) => persona.id === personaId)) {
    return personas;
  }
  return personas.map((persona) => ({ ...persona, isDefault: persona.id === personaId }));
}

/**
 * Removes a persona. The last remaining persona is never deleted, and the
 * default flag moves to the first survivor when the default itself is removed.
 */
export function deletePersona(personas: Persona[], personaId: string): Persona[] {
  if (personas.length <= 1) {
    return personas;
  }
  const remaining = personas.filter((persona) => persona.id !== personaId);
  if (remaining.length === personas.length) {
    return personas;
  }
  return ensureSingleDefault(remaining);
}

export function updatePersona(personas: Persona[], personaId: string, changes: Partial<Persona>): Persona[] {
  return personas.map((persona) => (persona.id === personaId ? { ...persona, ...changes, id: persona.id } : persona));
}

/** Card lorebooks plus the active persona's lorebooks, for the lore trigger engine. */
export function collectActiveLorebooks(card: RuntimeCard, activePersona: Persona | null): Lorebook[] {
  const cardLorebooks = Array.isArray(card.lorebooks) ? card.lorebooks : [];
  if (!activePersona || activePersona.lorebooks.length === 0) {
    return cardLorebooks;
  }
  return [...cardLorebooks, ...activePersona.lorebooks];
}

/** The persona text injected into the response contract; empty when nothing is set. */
export function formatPersonaPrompt(persona: Persona | null): string {
  if (!persona) {
    return "";
  }

  const description = persona.description.trim();
  const name = persona.name.trim();
  if (!description && (!name || name === DEFAULT_PERSONA_NAME)) {
    return "";
  }

  return [name && name !== DEFAULT_PERSONA_NAME ? `The player is playing as ${name}.` : "", description]
    .filter(Boolean)
    .join("\n");
}

/** Strips unknown keys before personas reach localStorage or the SQLite snapshot blob. */
export function sanitizePersistedPersonas(value: unknown): Record<string, unknown>[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const sanitized = value
    .filter(isRecord)
    .map(parsePersona)
    .filter((persona): persona is Persona => Boolean(persona))
    .map((persona) => ({
      id: persona.id,
      name: persona.name,
      description: persona.description,
      lorebooks: persona.lorebooks,
      isDefault: persona.isDefault,
      ...(persona.avatarDataUrl ? { avatarDataUrl: persona.avatarDataUrl } : {}),
    }));

  return sanitized.length > 0 ? sanitized : undefined;
}

function parsePersona(value: Record<string, unknown>): Persona | null {
  if (typeof value.id !== "string" || !value.id.trim()) {
    return null;
  }

  return {
    id: value.id,
    name:
      typeof value.name === "string" && value.name.trim()
        ? value.name.trim().slice(0, MAX_PERSONA_NAME_LENGTH)
        : "Untitled persona",
    description: typeof value.description === "string" ? value.description.slice(0, MAX_PERSONA_DESCRIPTION_LENGTH) : "",
    lorebooks: parsePersonaLorebooks(value.lorebooks),
    isDefault: value.isDefault === true,
    ...(isPersonaAvatarDataUrl(value.avatarDataUrl) ? { avatarDataUrl: value.avatarDataUrl } : {}),
  };
}

function parsePersonaLorebooks(value: unknown): Lorebook[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const lorebooks = value.filter(
    (lorebook): lorebook is Lorebook =>
      isRecord(lorebook) && typeof lorebook.id === "string" && typeof lorebook.name === "string",
  );

  // Reuse the card normalizer so persona lorebook entries pick up the same
  // defaults (caseSensitive, wholeWord, probability) the trigger engine expects.
  return normalizeCardLorebooks({ id: "persona", lorebooks } as RuntimeCard);
}

function isPersonaAvatarDataUrl(value: unknown): value is string {
  return typeof value === "string" && /^data:image\/(png|jpeg|webp|gif);base64,/.test(value);
}

function dedupePersonaIds(personas: Persona[]): Persona[] {
  const seen = new Set<string>();
  return personas.filter((persona) => {
    if (seen.has(persona.id)) {
      return false;
    }
    seen.add(persona.id);
    return true;
  });
}

function ensureSingleDefault(personas: Persona[]): Persona[] {
  const defaultIndex = personas.findIndex((persona) => persona.isDefault);
  const targetIndex = defaultIndex >= 0 ? defaultIndex : 0;
  return personas.map((persona, index) => ({ ...persona, isDefault: index === targetIndex }));
}
