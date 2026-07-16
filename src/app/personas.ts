// Persona profile helpers: parsing, migration, sanitization, and prompt/lore selection.
//
// A persona is the *user's* side of a scene: the name and description the card
// should account for without speaking as the player. Personas replace the single
// `runtimeSettings.impersonationPrompt` string that used to hold this text.
//
// "No persona" is not a stored record — it is the sentinel `NO_PERSONA_ID`. While
// it is active, `getActivePersona` returns null and no persona prompt or persona
// lorebooks are injected. Every other persona in the roster is user-created.
import type { Lorebook, Persona, RuntimeCard } from "./runtimeTypes";
import { createRuntimeEntityId } from "./chatSessions";
import { isRecord } from "./appUtils";
import { normalizeCardLorebooks } from "./cardNormalization";
import { fitsEmbeddedAvatarBudget } from "./avatarImage";

/** Sentinel active id meaning "inject no persona at all". Never stored in the roster. */
export const NO_PERSONA_ID = "persona_none";
export const NO_PERSONA_NAME = "No persona";

// Legacy identifiers from the pre-"No persona" model, kept only so stored
// snapshots that still carry a "Default persona" record migrate cleanly.
const LEGACY_DEFAULT_PERSONA_ID = "persona_default";
const LEGACY_DEFAULT_PERSONA_NAME = "Default persona";

const MAX_PERSONA_NAME_LENGTH = 80;
const MAX_PERSONA_DESCRIPTION_LENGTH = 8_000;

export function createPersona(name: string, description = ""): Persona {
  return {
    id: createRuntimeEntityId("persona"),
    name: name.trim() || "Untitled persona",
    description,
    lorebooks: [],
  };
}

/**
 * Parses persisted personas. Each entry becomes a custom persona; the legacy
 * "Default persona" is dropped when empty (it represented "no persona") or kept
 * as an ordinary custom persona when it carried a description. When nothing is
 * stored, the single legacy `impersonationPrompt` is migrated into one persona.
 * Returns an empty roster when the user has only ever used "No persona".
 */
export function parsePersonas(value: unknown, legacyImpersonationPrompt = ""): Persona[] {
  const parsed = Array.isArray(value)
    ? value.filter(isRecord).map(parsePersona).filter((persona): persona is Persona => Boolean(persona))
    : [];

  const migrated = dedupePersonaIds(
    parsed.filter((persona) => !isEmptyLegacyDefault(persona)).map(renameLegacyDefault),
  );

  if (migrated.length === 0 && legacyImpersonationPrompt.trim()) {
    return [createPersona("My persona", legacyImpersonationPrompt)];
  }

  return migrated;
}

export function parseActivePersonaId(value: unknown, personas: Persona[]): string {
  if (typeof value === "string" && personas.some((persona) => persona.id === value)) {
    return value;
  }
  return NO_PERSONA_ID;
}

/** The active persona, or null when "No persona" is selected (or the id is stale). */
export function getActivePersona(personas: Persona[], activePersonaId: string): Persona | null {
  if (activePersonaId === NO_PERSONA_ID) {
    return null;
  }
  return personas.find((persona) => persona.id === activePersonaId) ?? null;
}

/** Removes a persona. The roster may become empty, leaving only "No persona". */
export function deletePersona(personas: Persona[], personaId: string): Persona[] {
  return personas.filter((persona) => persona.id !== personaId);
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
  if (!description && !name) {
    return "";
  }

  return [name ? `The player is playing as ${name}.` : "", description].filter(Boolean).join("\n");
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
  return (
    typeof value === "string" &&
    /^data:image\/(png|jpeg|webp|gif);base64,/.test(value) &&
    fitsEmbeddedAvatarBudget(value)
  );
}

/** The legacy default persona with no text was really "no persona" — drop it. */
function isEmptyLegacyDefault(persona: Persona): boolean {
  return persona.id === LEGACY_DEFAULT_PERSONA_ID && !persona.description.trim();
}

/** A legacy default that carried text becomes an ordinary custom persona. */
function renameLegacyDefault(persona: Persona): Persona {
  if (persona.name === LEGACY_DEFAULT_PERSONA_NAME) {
    return { ...persona, name: "My persona" };
  }
  return persona;
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
