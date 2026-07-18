import type { CSSProperties } from "react";

export type ThemeMode = "light" | "dark";

/**
 * Base colors the player can override. Accent is kept in `RuntimeSettings.accentColor`
 * for backward compatibility, so it is intentionally not part of this key set — it is
 * threaded through {@link buildThemeVars} and the contrast checks separately.
 */
export type ThemeColorKey =
  | "background"
  | "surface"
  | "text"
  | "muted"
  | "border"
  | "primary"
  | "danger"
  | "gold";

export type ThemeColorOverrides = Partial<Record<ThemeColorKey, string>>;

export type ThemeTokenMeta = {
  key: ThemeColorKey;
  label: string;
  description: string;
};

/** Tokens rendered in the Theme colors panel, in display order. */
export const THEME_TOKENS: ThemeTokenMeta[] = [
  { key: "background", label: "App background", description: "The window backdrop behind every panel." },
  { key: "surface", label: "Panels", description: "Cards, sidebars, and raised surfaces." },
  { key: "text", label: "Primary text", description: "Headings and body copy." },
  { key: "muted", label: "Secondary text", description: "Hints, captions, and metadata." },
  { key: "border", label: "Borders", description: "Dividers and panel outlines." },
  { key: "primary", label: "Primary buttons", description: "The main call-to-action buttons." },
  { key: "danger", label: "Danger", description: "Destructive actions and warnings." },
  { key: "gold", label: "Highlights", description: "Rewards, dice, and celebratory marks." },
];

const HEX_PATTERN = /^#[0-9a-fA-F]{6}$/;

export function isHexColor(value: unknown): value is string {
  return typeof value === "string" && HEX_PATTERN.test(value);
}

/**
 * Keeps only recognized token keys carrying a valid `#rrggbb` value. Used both when
 * persisting the local snapshot and when parsing an imported runtime bundle, so an
 * untrusted object can never smuggle arbitrary keys or CSS into the theme.
 */
export function sanitizeThemeColorOverrides(value: unknown): ThemeColorOverrides {
  if (typeof value !== "object" || value === null) {
    return {};
  }
  const source = value as Record<string, unknown>;
  const result: ThemeColorOverrides = {};
  for (const token of THEME_TOKENS) {
    const candidate = source[token.key];
    if (isHexColor(candidate)) {
      result[token.key] = candidate;
    }
  }
  return result;
}

/**
 * Builds the inline CSS custom properties applied to the app shell. Only tokens the
 * player actually set emit an override; untouched tokens fall through to the stylesheet
 * defaults, so the out-of-the-box palette stays byte-for-byte identical. Derived
 * variants reference sibling `var(--…)` tokens so they stay coherent whether or not the
 * related base token was also customized.
 */
export function buildThemeVars(accentColor: string, overrides?: ThemeColorOverrides): CSSProperties {
  const vars: Record<string, string> = {};

  const background = overrides?.background;
  if (isHexColor(background)) {
    vars["--bg"] = background;
  }

  const surface = overrides?.surface;
  if (isHexColor(surface)) {
    vars["--surface"] = surface;
    vars["--panel"] = surface;
    vars["--surface-raised"] = `color-mix(in srgb, ${surface} 93%, var(--text) 7%)`;
    vars["--panel-soft"] = `color-mix(in srgb, ${surface} 88%, var(--border) 12%)`;
    vars["--panel-warm"] = `color-mix(in srgb, ${surface} 76%, var(--border) 24%)`;
  }

  const text = overrides?.text;
  if (isHexColor(text)) {
    vars["--text"] = text;
  }

  const muted = overrides?.muted;
  if (isHexColor(muted)) {
    vars["--muted"] = muted;
    vars["--muted-strong"] = `color-mix(in srgb, ${muted} 80%, var(--text) 20%)`;
    vars["--faint"] = `color-mix(in srgb, ${muted} 60%, var(--surface) 40%)`;
  }

  const border = overrides?.border;
  if (isHexColor(border)) {
    vars["--border"] = border;
    vars["--border-strong"] = `color-mix(in srgb, ${border} 66%, var(--text) 34%)`;
  }

  const primary = overrides?.primary;
  if (isHexColor(primary)) {
    vars["--primary-bg"] = primary;
    vars["--primary-bg-hover"] = `color-mix(in srgb, ${primary} 82%, #000 18%)`;
  }

  const danger = overrides?.danger;
  if (isHexColor(danger)) {
    vars["--danger"] = danger;
    vars["--danger-soft"] = `color-mix(in srgb, ${danger} 14%, transparent)`;
  }

  const gold = overrides?.gold;
  if (isHexColor(gold)) {
    vars["--gold"] = gold;
    vars["--gold-text"] = `color-mix(in srgb, ${gold} 70%, var(--text) 30%)`;
    vars["--gold-soft"] = `color-mix(in srgb, ${gold} 16%, transparent)`;
  }

  // Accent keeps its original three-variable derivation so its long-standing behavior
  // and default rendering are unchanged.
  if (isHexColor(accentColor)) {
    vars["--accent"] = accentColor;
    vars["--accent-strong"] = `color-mix(in srgb, ${accentColor} 78%, #000)`;
    vars["--accent-soft"] = `color-mix(in srgb, ${accentColor} 16%, transparent)`;
  }

  return vars as CSSProperties;
}

type PaletteKey = ThemeColorKey | "accent";

type Rgb = { r: number; g: number; b: number };

/**
 * Default palette per theme, mirroring the `:root` and `[data-theme="dark"]` tokens in
 * styles.css. Contrast checks need concrete values for tokens the player has not
 * overridden (e.g. new accent color against the still-default panel).
 */
const DEFAULT_PALETTE: Record<ThemeMode, Record<PaletteKey, string>> = {
  light: {
    background: "#eef1f7",
    surface: "#f8fafd",
    text: "#1a2233",
    muted: "#586176",
    border: "#d4dbe9",
    primary: "#3a63d8",
    danger: "#c62f2f",
    gold: "#d0920f",
    accent: "#3a63d8",
  },
  dark: {
    background: "#10141f",
    surface: "#171d2b",
    text: "#e9edf8",
    muted: "#a6b0c9",
    border: "#2c3550",
    primary: "#6f9bff",
    danger: "#ff6b6b",
    gold: "#f2b750",
    accent: "#6f9bff",
  },
};

/** Fixed label color painted on primary buttons (`--primary-text`) per theme. */
const PRIMARY_TEXT: Record<ThemeMode, string> = {
  light: "#f8fafd",
  dark: "#10141f",
};

/** The stylesheet default for a base token in the given theme (for picker starting values). */
export function themeTokenDefault(key: ThemeColorKey, mode: ThemeMode): string {
  return DEFAULT_PALETTE[mode][key];
}

/** The stylesheet default accent for the given theme. */
export function accentDefault(mode: ThemeMode): string {
  return DEFAULT_PALETTE[mode].accent;
}

function parseHex(hex: string): Rgb {
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

function channelLuminance(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance({ r, g, b }: Rgb): number {
  return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b);
}

/** WCAG 2.x contrast ratio between two `#rrggbb` colors (1:1 to 21:1). */
export function contrastRatio(foreground: string, background: string): number {
  const lighter = relativeLuminance(parseHex(foreground));
  const darker = relativeLuminance(parseHex(background));
  const hi = Math.max(lighter, darker);
  const lo = Math.min(lighter, darker);
  return (hi + 0.05) / (lo + 0.05);
}

function resolvePalette(
  accentColor: string,
  overrides: ThemeColorOverrides | undefined,
  mode: ThemeMode,
): Record<PaletteKey, string> {
  const defaults = DEFAULT_PALETTE[mode];
  const pick = (key: ThemeColorKey): string => {
    const override = overrides?.[key];
    return isHexColor(override) ? override : defaults[key];
  };
  return {
    background: pick("background"),
    surface: pick("surface"),
    text: pick("text"),
    muted: pick("muted"),
    border: pick("border"),
    primary: pick("primary"),
    danger: pick("danger"),
    gold: pick("gold"),
    accent: isHexColor(accentColor) ? accentColor : defaults.accent,
  };
}

export type ThemeContrastResult = {
  id: string;
  label: string;
  ratio: number;
  minRatio: number;
  passes: boolean;
};

type ContrastPair = {
  id: string;
  label: string;
  /** A palette token, or the fixed primary-button label color. */
  foreground: PaletteKey | "primaryText";
  background: PaletteKey;
  minRatio: number;
};

/**
 * Foreground/background pairs worth policing. Body-text pairs use the AA normal-text
 * ratio (4.5); decorative marks use the AA large-text / UI ratio (3.0).
 */
const CONTRAST_PAIRS: ContrastPair[] = [
  { id: "text-background", label: "Body text on the app background", foreground: "text", background: "background", minRatio: 4.5 },
  { id: "text-surface", label: "Body text on panels", foreground: "text", background: "surface", minRatio: 4.5 },
  { id: "muted-surface", label: "Secondary text on panels", foreground: "muted", background: "surface", minRatio: 4.5 },
  { id: "accent-surface", label: "Accent marks on panels", foreground: "accent", background: "surface", minRatio: 3 },
  { id: "danger-surface", label: "Danger marks on panels", foreground: "danger", background: "surface", minRatio: 3 },
  { id: "gold-surface", label: "Highlight marks on panels", foreground: "gold", background: "surface", minRatio: 3 },
  { id: "label-primary", label: "Button label on primary buttons", foreground: "primaryText", background: "primary", minRatio: 4.5 },
];

function isCustomized(key: PaletteKey, accentColor: string, overrides: ThemeColorOverrides | undefined): boolean {
  if (key === "accent") {
    return isHexColor(accentColor);
  }
  return isHexColor(overrides?.[key]);
}

/**
 * Reports the contrast of every pair the player has touched. Pairs left at their
 * defaults are omitted, so an unmodified palette reports zero issues and the shipped
 * defaults are treated as the accessible baseline.
 */
export function evaluateThemeContrast(
  accentColor: string,
  overrides: ThemeColorOverrides | undefined,
  mode: ThemeMode,
): ThemeContrastResult[] {
  const palette = resolvePalette(accentColor, overrides, mode);
  const results: ThemeContrastResult[] = [];
  for (const pair of CONTRAST_PAIRS) {
    const foreground = pair.foreground;
    const foregroundColor = foreground === "primaryText" ? PRIMARY_TEXT[mode] : palette[foreground];
    const foregroundCustomized =
      foreground === "primaryText" ? false : isCustomized(foreground, accentColor, overrides);
    const backgroundCustomized = isCustomized(pair.background, accentColor, overrides);
    const active =
      foreground === "primaryText" ? backgroundCustomized : foregroundCustomized || backgroundCustomized;
    if (!active) {
      continue;
    }
    const ratio = contrastRatio(foregroundColor, palette[pair.background]);
    results.push({
      id: pair.id,
      label: pair.label,
      ratio: Math.round(ratio * 100) / 100,
      minRatio: pair.minRatio,
      passes: ratio >= pair.minRatio,
    });
  }
  return results;
}

export function countContrastFailures(results: ThemeContrastResult[]): number {
  return results.filter((result) => !result.passes).length;
}
