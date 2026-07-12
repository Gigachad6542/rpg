// Fingerprint of the committed conversation, used to decide when to capture an
// in-app restore point.
//
// The signature changes when a message is added, edited, regenerated, swiped to
// another state-bearing variant, or has its effects undone. Variant selection
// used to be ignored when it changed text only; it now changes authoritative
// RPG/memory/entity state and therefore needs its own restore point.

export interface RestoreSignatureMessage {
  id: string;
  content: string;
  variants?: readonly string[];
  activeVariantIndex?: number;
  undoneVariantIndices?: readonly number[];
}

export interface RestoreSignatureSession {
  id: string;
  messages: readonly RestoreSignatureMessage[];
}

/**
 * Derives a compact, order-sensitive fingerprint of every session's messages
 * and their alternate generations/state selections.
 */
export function conversationRestoreSignature(
  sessions: readonly RestoreSignatureSession[],
  cardCount: number,
): string {
  let hash = 0x811c9dc5; // FNV-1a 32-bit offset basis.

  const mix = (text: string): void => {
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    // Field separator so that adjacent fields cannot silently merge, e.g.
    // ["ab", "c"] must not collide with ["a", "bc"].
    hash ^= 0x1f;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  };

  for (const session of sessions) {
    mix(session.id);
    for (const message of session.messages) {
      mix(message.id);
      if (message.variants && message.variants.length > 0) {
        for (const variant of message.variants) {
          mix(variant);
        }
      } else {
        mix(message.content);
      }
      mix(`active:${message.activeVariantIndex ?? "default"}`);
      for (const index of [...(message.undoneVariantIndices ?? [])].sort((a, b) => a - b)) {
        mix(`undone:${index}`);
      }
    }
  }

  return `${cardCount}:${sessions.length}:${(hash >>> 0).toString(16)}`;
}
