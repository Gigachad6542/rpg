export type PlayerRuleEnforcement =
  | "ignore_rules"
  | "validated_state"
  | "health_matters"
  | "inventory_matters"
  | "capability_limits"
  | "movement_plausibility"
  | "no_free_creation"
  | "prompt_only";

export interface PlayerRuleDefinition {
  id: string;
  title: string;
  description: string;
  enabled: boolean;
  enforcement: PlayerRuleEnforcement;
}

export interface RpgRuleState {
  location?: string;
  health?: string | null;
  inventory?: string[];
  quests?: string[];
  knownPlaces?: string[];
}

export interface PlayerActionValidationInput {
  cardKind: string;
  rules: PlayerRuleDefinition[];
  action: string;
  rpgState?: RpgRuleState;
}

export interface PlayerActionValidationResult {
  allowed: boolean;
  warning: string | null;
  triggeredRuleIds: string[];
}

const itemActionPattern =
  /\b(use|equip|draw|drink|consume|spend|trade|unlock with|fire|reload|swing|brandish)\b.*\b(sword|key|potion|gun|bow|wand|shield|coin|gold|rope|map|scroll|lantern|torch)\b/;

export function validatePlayerAction(input: PlayerActionValidationInput): PlayerActionValidationResult {
  const action = input.action.trim();
  const lower = action.toLowerCase();
  const triggeredRuleIds: string[] = [];

  const boundaryRule = findEnabledRule(input.rules, "ignore_rules");
  if (boundaryRule && /\b(ignore|bypass|override|forget)\b.*\b(rule|rules|card|system|instruction|instructions)\b/.test(lower)) {
    triggeredRuleIds.push(boundaryRule.id);
    return blocked("Blocked by card rules: the player cannot ask the model to ignore the active card's rules.", triggeredRuleIds);
  }

  if (input.cardKind !== "rpg") {
    return allowed();
  }

  const freeStateRule = findEnabledRule(input.rules, "no_free_creation");
  const createsFreeState =
    /\b(create|spawn|give me|i now have|add|summon|conjure|materialize|manifest)\b.*\b(infinite|legendary|gold|money|potion|sword|key|ally|exit|portal|reward|army|weapon)\b/.test(
      lower,
    );
  if (freeStateRule && createsFreeState) {
    triggeredRuleIds.push(freeStateRule.id);
    return blocked("Blocked by this RPG card: items, money, allies, exits, and rewards must come from validated state changes.", triggeredRuleIds);
  }

  const movementRule = findEnabledRule(input.rules, "movement_plausibility");
  const bypassesLocation = /\bteleport\b|\bwalk through walls\b|\bphase through\b|\bopen a hidden exit\b|\bskip to the end\b/.test(lower);
  if (movementRule && bypassesLocation) {
    triggeredRuleIds.push(movementRule.id);
    return blocked("Blocked by this RPG card: movement must stay plausible for the current location and established exits.", triggeredRuleIds);
  }

  const healthRule = findEnabledRule(input.rules, "health_matters");
  const ignoresHealth =
    /\b(ignore|bypass|negate|remove)\b.*\b(health|damage|injury|wound|death)\b|\b(full health|heal instantly|can't die|cannot die|immortal|invincible|no damage)\b/.test(
      lower,
    );
  if (healthRule && ignoresHealth) {
    triggeredRuleIds.push(healthRule.id);
    return blocked("Blocked by this RPG card: health, damage, healing, and survival must matter while that rule is enabled.", triggeredRuleIds);
  }

  const capabilityRule = findEnabledRule(input.rules, "capability_limits");
  const impossibleCapability =
    /\b(time travel|mind control|one punch|summon meteor|god mode|omniscient|fly away|become invisible|laser eyes|reality warp|wish it away)\b/.test(
      lower,
    );
  if (capabilityRule && impossibleCapability) {
    triggeredRuleIds.push(capabilityRule.id);
    return blocked("Blocked by this RPG card: the player cannot use abilities outside the character's established capabilities.", triggeredRuleIds);
  }

  const inventoryRule = findEnabledRule(input.rules, "inventory_matters");
  if (inventoryRule && itemActionPattern.test(lower) && !mentionsOwnedInventoryItem(lower, input.rpgState?.inventory ?? [])) {
    triggeredRuleIds.push(inventoryRule.id);
    return blocked("Blocked by this RPG card: inventory matters, and that item is not established in the current inventory.", triggeredRuleIds);
  }

  return allowed();
}

function findEnabledRule(
  rules: PlayerRuleDefinition[],
  enforcement: PlayerRuleEnforcement,
): PlayerRuleDefinition | undefined {
  return rules.find((rule) => rule.enabled && rule.enforcement === enforcement);
}

function mentionsOwnedInventoryItem(action: string, inventory: string[]): boolean {
  return inventory.some((item) => {
    const normalized = item.trim().toLowerCase();
    return normalized.length > 0 && action.includes(normalized);
  });
}

function allowed(): PlayerActionValidationResult {
  return {
    allowed: true,
    warning: null,
    triggeredRuleIds: [],
  };
}

function blocked(warning: string, triggeredRuleIds: string[]): PlayerActionValidationResult {
  return {
    allowed: false,
    warning,
    triggeredRuleIds,
  };
}
