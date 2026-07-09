// Fingerprint of the committed conversation, used to decide when to capture an
// in-app restore point.
//
// The signature changes when a message is added, edited, or regenerated (the
// variant list's *contents* change), but NOT when the player merely swipes
// between existing variants. Swiping only moves the active index and mirrors an
// existing variant into `content`, so keying on it would thrash the small
// restore-point ring buffer with states the player can already reach by swiping
// back. Editing rewrites the active variant's text in `variants[]`, so that is
// captured; regeneration appends a variant, so that is captured too.

export interface RestoreSignatureMessage {
  id: string;
  content: string;
  variants?: readonly string[];
}

export interface RestoreSignatureSession {
  id: string;
  messages: readonly RestoreSignatureMessage[];
}

/**
 * Derives a compact, order-sensitive fingerprint of every session's messages
 * and their alternate generations. Two conversations that differ only by which
 * variant is currently active produce the same signature; any change to message
 * identity, ordering, or variant/content text changes it.
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
    }
  }

  return `${cardCount}:${sessions.length}:${(hash >>> 0).toString(16)}`;
}
