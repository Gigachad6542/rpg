import { describe, expect, test } from "vitest";

import {
  conversationRestoreSignature,
  type RestoreSignatureSession,
} from "../../src/app/restoreSignature";

function session(id: string, messages: RestoreSignatureSession["messages"]): RestoreSignatureSession {
  return { id, messages };
}

describe("conversationRestoreSignature", () => {
  test("is stable for an unchanged conversation", () => {
    const sessions = [session("s1", [{ id: "m1", content: "hello" }])];

    expect(conversationRestoreSignature(sessions, 1)).toBe(conversationRestoreSignature(sessions, 1));
  });

  test("changes when a message is added", () => {
    const before = [session("s1", [{ id: "m1", content: "hello" }])];
    const after = [
      session("s1", [
        { id: "m1", content: "hello" },
        { id: "m2", content: "there" },
      ]),
    ];

    expect(conversationRestoreSignature(after, 1)).not.toBe(conversationRestoreSignature(before, 1));
  });

  test("changes when a message is edited in place", () => {
    const before = [session("s1", [{ id: "m1", content: "hello" }])];
    const after = [session("s1", [{ id: "m1", content: "hello there" }])];

    expect(conversationRestoreSignature(after, 1)).not.toBe(conversationRestoreSignature(before, 1));
  });

  test("changes when a variant is edited in place", () => {
    // Editing rewrites the active variant's text inside variants[].
    const before = [session("s1", [{ id: "m1", content: "b", variants: ["a", "b"] }])];
    const after = [session("s1", [{ id: "m1", content: "b-edited", variants: ["a", "b-edited"] }])];

    expect(conversationRestoreSignature(after, 1)).not.toBe(conversationRestoreSignature(before, 1));
  });

  test("changes when a reply is regenerated (variant appended)", () => {
    const before = [session("s1", [{ id: "m1", content: "a", variants: ["a"] }])];
    const after = [session("s1", [{ id: "m1", content: "b", variants: ["a", "b"] }])];

    expect(conversationRestoreSignature(after, 1)).not.toBe(conversationRestoreSignature(before, 1));
  });

  test("does NOT change when merely swiping between existing variants", () => {
    // Swiping only moves the active index and mirrors an existing variant into
    // content; the variants array is untouched, so no restore point is captured.
    const showingB = [session("s1", [{ id: "m1", content: "b", variants: ["a", "b"] }])];
    const showingA = [session("s1", [{ id: "m1", content: "a", variants: ["a", "b"] }])];

    expect(conversationRestoreSignature(showingA, 1)).toBe(conversationRestoreSignature(showingB, 1));
  });

  test("changes when the card count changes", () => {
    const sessions = [session("s1", [{ id: "m1", content: "hello" }])];

    expect(conversationRestoreSignature(sessions, 2)).not.toBe(conversationRestoreSignature(sessions, 1));
  });

  test("distinguishes field boundaries (no silent merges)", () => {
    const split = [
      session("s1", [
        { id: "m1", content: "ab" },
        { id: "m2", content: "c" },
      ]),
    ];
    const merged = [
      session("s1", [
        { id: "m1", content: "a" },
        { id: "m2", content: "bc" },
      ]),
    ];

    expect(conversationRestoreSignature(split, 1)).not.toBe(conversationRestoreSignature(merged, 1));
  });
});
