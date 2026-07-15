import type { AuthoritativeStateMutation } from "../runtime/authoritativeEventStream";
import type { RuntimeCard } from "./runtimeTypes";

export function buildAuthoritativeStateMutations(
  before: RuntimeCard,
  after: RuntimeCard,
): AuthoritativeStateMutation[] {
  if (!before.rpg || !after.rpg) {
    return [];
  }
  const mutations: AuthoritativeStateMutation[] = [];
  if (before.rpg.location !== after.rpg.location) {
    mutations.push({ type: "location_set", location: after.rpg.location });
  }
  if (before.rpg.health !== after.rpg.health) {
    mutations.push({ type: "health_set", health: after.rpg.health });
  }
  const beforeInventory = new Set(before.rpg.inventory);
  const afterInventory = new Set(after.rpg.inventory);
  for (const item of afterInventory) {
    if (!beforeInventory.has(item)) {
      mutations.push({ type: "inventory_add", item });
    }
  }
  for (const item of beforeInventory) {
    if (!afterInventory.has(item)) {
      mutations.push({ type: "inventory_remove", item });
    }
  }
  const beforeQuests = new Set(before.rpg.quests);
  const afterQuests = new Set(after.rpg.quests);
  for (const quest of beforeQuests) {
    if (!afterQuests.has(quest)) {
      mutations.push({ type: "quest_remove", quest });
    }
  }
  for (const quest of after.rpg.quests) {
    if (!beforeQuests.has(quest)) {
      mutations.push({ type: "quest_set", quest });
    }
  }
  for (const [flag, value] of Object.entries(after.rpg.flags)) {
    if (before.rpg.flags[flag] !== value) {
      mutations.push({ type: "world_flag_set", flag, value });
    }
  }
  for (const flag of Object.keys(before.rpg.flags)) {
    if (!(flag in after.rpg.flags)) {
      mutations.push({ type: "world_flag_remove", flag });
    }
  }
  const beforePlaces = new Set(before.rpg.knownPlaces);
  const afterPlaces = new Set(after.rpg.knownPlaces);
  for (const place of beforePlaces) {
    if (!afterPlaces.has(place)) {
      mutations.push({ type: "known_place_remove", place });
    }
  }
  for (const place of after.rpg.knownPlaces) {
    if (!beforePlaces.has(place)) {
      mutations.push({ type: "known_place_add", place });
    }
  }
  return mutations;
}
