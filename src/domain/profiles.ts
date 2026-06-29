import type { EntityTimestamps, JsonObject, PersonaId, ProfileId } from "./ids";

export const PROFILE_KINDS = ["local_user", "guest_user", "imported"] as const;

export type ProfileKind = (typeof PROFILE_KINDS)[number];

export const PERSONA_VISIBILITIES = ["private", "character_known", "prompt_only"] as const;

export type PersonaVisibility = (typeof PERSONA_VISIBILITIES)[number];

export interface Profile extends EntityTimestamps {
  readonly id: ProfileId;
  readonly kind: ProfileKind;
  readonly displayName: string;
  readonly preferredName?: string;
  readonly pronouns?: string;
  readonly defaultPersonaId?: PersonaId;
  readonly notes?: string;
  readonly settings?: JsonObject;
}

export interface Persona extends EntityTimestamps {
  readonly id: PersonaId;
  readonly profileId: ProfileId;
  readonly name: string;
  readonly visibility: PersonaVisibility;
  readonly summary: string;
  readonly appearance?: string;
  readonly speechStyle?: string;
  readonly publicBio?: string;
  readonly privateNotes?: string;
  readonly knownAliases: readonly string[];
  readonly defaultForChatModes: readonly string[];
  readonly tags: readonly string[];
  readonly metadata?: JsonObject;
}
