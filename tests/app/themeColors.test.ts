import { describe, expect, it } from "vitest";

import {
  buildThemeVars,
  contrastRatio,
  countContrastFailures,
  evaluateThemeContrast,
  isHexColor,
  sanitizeThemeColorOverrides,
} from "../../src/app/themeColors";

function asRecord(value: ReturnType<typeof buildThemeVars>): Record<string, string> {
  return value as Record<string, string>;
}

describe("isHexColor", () => {
  it("accepts six-digit hex and rejects everything else", () => {
    expect(isHexColor("#a1b2c3")).toBe(true);
    expect(isHexColor("#ABCDEF")).toBe(true);
    expect(isHexColor("#abc")).toBe(false);
    expect(isHexColor("red")).toBe(false);
    expect(isHexColor("rgb(0,0,0)")).toBe(false);
    expect(isHexColor(123)).toBe(false);
    expect(isHexColor(undefined)).toBe(false);
  });
});

describe("sanitizeThemeColorOverrides", () => {
  it("keeps only recognized token keys with valid hex values", () => {
    const result = sanitizeThemeColorOverrides({
      background: "#101010",
      surface: "not-a-color",
      text: "#eeeeee",
      unknownKey: "#ffffff",
      accent: "#123456",
    });
    expect(result).toEqual({ background: "#101010", text: "#eeeeee" });
  });

  it("returns an empty object for non-object input", () => {
    expect(sanitizeThemeColorOverrides(null)).toEqual({});
    expect(sanitizeThemeColorOverrides("#ffffff")).toEqual({});
    expect(sanitizeThemeColorOverrides(undefined)).toEqual({});
  });
});

describe("buildThemeVars", () => {
  it("emits nothing when no accent and no overrides are set", () => {
    expect(Object.keys(asRecord(buildThemeVars("", {}))).length).toBe(0);
    expect(Object.keys(asRecord(buildThemeVars("", undefined))).length).toBe(0);
  });

  it("preserves the legacy three-variable accent derivation", () => {
    expect(asRecord(buildThemeVars("#e5431f", {}))).toEqual({
      "--accent": "#e5431f",
      "--accent-strong": "color-mix(in srgb, #e5431f 78%, #000)",
      "--accent-soft": "color-mix(in srgb, #e5431f 16%, transparent)",
    });
  });

  it("expands the surface token into the full panel family", () => {
    const vars = asRecord(buildThemeVars("", { surface: "#222222" }));
    expect(vars["--surface"]).toBe("#222222");
    expect(vars["--panel"]).toBe("#222222");
    expect(vars["--surface-raised"]).toBe("color-mix(in srgb, #222222 93%, var(--text) 7%)");
    expect(vars["--panel-soft"]).toBe("color-mix(in srgb, #222222 88%, var(--border) 12%)");
    expect(vars["--panel-warm"]).toBe("color-mix(in srgb, #222222 76%, var(--border) 24%)");
  });

  it("drives primary buttons, danger, and highlight tokens from their base color", () => {
    const vars = asRecord(buildThemeVars("", { primary: "#334455", danger: "#aa0000", gold: "#ffcc00" }));
    expect(vars["--primary-bg"]).toBe("#334455");
    expect(vars["--primary-bg-hover"]).toBe("color-mix(in srgb, #334455 82%, #000 18%)");
    expect(vars["--danger"]).toBe("#aa0000");
    expect(vars["--danger-soft"]).toBe("color-mix(in srgb, #aa0000 14%, transparent)");
    expect(vars["--gold"]).toBe("#ffcc00");
  });

  it("ignores invalid overrides without throwing", () => {
    expect(Object.keys(asRecord(buildThemeVars("", { text: "red", surface: "#fff" }))).length).toBe(0);
  });
});

describe("contrastRatio", () => {
  it("computes the WCAG bounds and known midpoints", () => {
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 5);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
    // The classic AA boundary gray on white.
    expect(contrastRatio("#767676", "#ffffff")).toBeCloseTo(4.54, 1);
  });

  it("is symmetric regardless of argument order", () => {
    expect(contrastRatio("#123456", "#abcdef")).toBeCloseTo(contrastRatio("#abcdef", "#123456"), 10);
  });
});

describe("evaluateThemeContrast", () => {
  it("stays silent when the player has not customized anything", () => {
    expect(evaluateThemeContrast("", {}, "light")).toEqual([]);
    expect(evaluateThemeContrast("", undefined, "dark")).toEqual([]);
  });

  it("flags illegible body text against the default panels", () => {
    const results = evaluateThemeContrast("", { text: "#f2f2f2" }, "light");
    const surfacePair = results.find((result) => result.id === "text-surface");
    expect(surfacePair).toBeDefined();
    expect(surfacePair?.passes).toBe(false);
    // Customizing text also lights up the background pair.
    expect(results.some((result) => result.id === "text-background")).toBe(true);
    expect(countContrastFailures(results)).toBeGreaterThan(0);
  });

  it("passes a high-contrast text choice", () => {
    const results = evaluateThemeContrast("", { text: "#1a1a1a" }, "light");
    const surfacePair = results.find((result) => result.id === "text-surface");
    expect(surfacePair?.passes).toBe(true);
  });

  it("warns when a pale accent leaves accent marks unreadable on panels", () => {
    const results = evaluateThemeContrast("#fde8e2", undefined, "light");
    const accentPair = results.find((result) => result.id === "accent-surface");
    expect(accentPair?.passes).toBe(false);
  });

  it("warns when a pale primary button hides its fixed light label", () => {
    const results = evaluateThemeContrast("", { primary: "#ffe4b0" }, "light");
    const labelPair = results.find((result) => result.id === "label-primary");
    expect(labelPair).toBeDefined();
    expect(labelPair?.passes).toBe(false);
  });

  it("does not evaluate the primary label pair until the button color changes", () => {
    const results = evaluateThemeContrast("", { text: "#1a1a1a" }, "light");
    expect(results.some((result) => result.id === "label-primary")).toBe(false);
  });
});
