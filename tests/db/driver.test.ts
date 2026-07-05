import { describe, expect, it } from "vitest";

import { parseJson, serializeJson } from "../../src/db/driver";

describe("database driver JSON helpers", () => {
  it("serializes nullish values as JSON null", () => {
    expect(serializeJson(undefined)).toBe("null");
    expect(serializeJson(null)).toBe("null");
  });

  it("round-trips JSON values and falls back for invalid input", () => {
    expect(parseJson<{ ok: boolean }>('{"ok":true}', { ok: false })).toEqual({ ok: true });
    expect(parseJson("not-json", ["fallback"])).toEqual(["fallback"]);
    expect(parseJson({ ok: true }, ["fallback"])).toEqual(["fallback"]);
  });
});
