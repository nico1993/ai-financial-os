// Frontend design tokens -- the single source of truth for color,
// typography, and radius constants used across apps/web.
//
// Locked in from "Mockup A" of the WEB-0 mockup comparison canvas (two
// directions built side by side: a taste-skill-informed warm-minimal
// system and a shadcn/ui-defaults system) -- the user picked Mockup A,
// palette and typography undecided beyond that pick. See BACKLOG.md
// WEB-0/WEB-5 and ADR-0030. WEB-1/WEB-5 wire these into Tailwind's
// `theme.extend` once Tailwind is installed -- import from here rather
// than re-typing hex values in tailwind.config.ts, so a palette or font
// change is a one-file edit. This file has no framework dependency (no
// React import) on purpose, so it typechecks standalone before WEB-1
// lands.
//
// Provenance: UI_COLOR/FONT/RADIUS come from the taste-skill's
// `minimalist-ui` sub-skill (warm monochrome, editorial minimalism)
// blended with `design-taste-frontend-v1`'s dashboard-hardening rules
// (single desaturated accent, no AI purple/blue, monospace figures for
// dense data) -- deliberately NOT `design-taste-frontend` (v2), which
// explicitly scopes itself to landing pages/portfolios/redesigns and
// disclaims dashboards and product UI.
//
// CATEGORICAL_PALETTE and STATUS_COLOR are re-exported unchanged from the
// dataviz skill's validated default palette (bundled skill reference,
// dataviz/references/palette.md) -- not re-derived here. Do not hand-edit
// those hexes; a swap requires re-running the skill's
// `validate_palette.js` accessibility check.
//
// What this file deliberately does NOT do: assign a color to any specific
// spending category. Category colors are already a solved, per-user,
// editable field (`Category.color`, ADR-0028) seeded server-side by
// cycling this same CATEGORICAL_PALETTE in `apps/worker`'s
// `DEFAULT_CATEGORY_SEEDS`. The "Rent & Utilities = blue" pairing shown
// in the WEB-0 mockups was illustrative content for those screens, not a
// fixed mapping -- apps/web reads `Category.color` from the API and never
// assigns one client-side.

export const FONT = {
  sans: "'Geist', 'SF Pro Display', 'Helvetica Neue', system-ui, sans-serif",
  mono: "'Geist Mono', 'SF Mono', 'JetBrains Mono', monospace",
} as const;

// Usage rule (not encoded as a token, since it's a rule about *which*
// token to use, not a value of its own): every dollar figure in the UI --
// balances, totals, table amounts, chart axis ticks -- renders in
// FONT.mono with `font-variant-numeric: tabular-nums`
// (design-taste-frontend-v1's "Cockpit Mode" rule, applied narrowly to
// this app's numbers because they're the point, not because the whole UI
// is dense). Labels, nav, and prose stay in FONT.sans. No serif anywhere:
// v1's "serif is banned on dashboards" rule overrides minimalist-ui's
// editorial-serif suggestion, which is scoped to marketing/landing
// headings this app doesn't have.

export const RADIUS = {
  sm: "6px", // buttons
  md: "8px", // inputs, small controls
  lg: "12px", // cards, panels
  pill: "9999px", // tags, status badges
} as const;

export const UI_COLOR = {
  background: "#F7F6F3",
  surface: "#FFFFFF",
  surfaceSecondary: "#FBFBFA",
  ink: "#111111",
  inkSecondary: "#6B6A66",
  inkMuted: "#898781",
  border: "#EAEAEA",
  accent: "#B5502F",
  accentWash: "#F5E4DC",
  buttonPrimary: "#171412",
  buttonPrimaryHover: "#332E2A",
} as const;

export type UiColorKey = keyof typeof UI_COLOR;

/** Reserved functional-state signals -- the dataviz skill's validated
 * status palette, unchanged. Use these for an actual functional signal
 * (cash-flow positive/negative, sync health, a threshold alert), never
 * for a decorative label -- see TAG_PALETTE for those. `base` is for
 * icons/dots/borders; `text` is a darker step of the same hue, sized for
 * legibility when the text itself sits on `wash`. */
export const STATUS_COLOR = {
  good: { base: "#0ca30c", text: "#0a6b0a", wash: "#E9F5E9" },
  warning: { base: "#fab219", text: "#956400", wash: "#FBF3DB" },
  serious: { base: "#ec835a", text: "#9F2F2D", wash: "#FDEBEC" },
  critical: { base: "#d03b3b", text: "#a83030", wash: "#FBEAEA" },
} as const;

export type StatusColorKey = keyof typeof STATUS_COLOR;

/** Decorative pastel accents (minimalist-ui) for lightweight tags/badges
 * that are NOT a functional status signal -- e.g. a "matched pair" or
 * "categorized" chip on a transaction row. If a badge is actually
 * reporting state, use STATUS_COLOR instead (see its doc comment). */
export const TAG_PALETTE = {
  red: { bg: "#FDEBEC", text: "#9F2F2D" },
  blue: { bg: "#E1F3FE", text: "#1F6C9F" },
  green: { bg: "#EDF3EC", text: "#346538" },
  yellow: { bg: "#FBF3DB", text: "#956400" },
} as const;

export type TagPaletteKey = keyof typeof TAG_PALETTE;

/** The dataviz skill's validated 8-hue categorical palette, light mode,
 * unchanged, fixed order (dataviz non-negotiable: "assign categorical
 * hues in fixed order, never cycled"). Re-exported here only so apps/web
 * has one import path for chart code instead of re-typing hexes --
 * `apps/worker/src/categorize/categories.ts`'s `DEFAULT_CATEGORY_SEEDS`
 * (ADR-0028) cycles this exact same list server-side. Dark-mode steps
 * exist in the skill's `references/palette.md` for whenever apps/web
 * grows a dark theme; not reproduced here until then. */
export const CATEGORICAL_PALETTE = [
  "#2a78d6", // 1 blue
  "#eb6834", // 2 orange
  "#1baf7a", // 3 aqua
  "#eda100", // 4 yellow
  "#e87ba4", // 5 magenta
  "#008300", // 6 green
  "#4a3aa7", // 7 violet
  "#e34948", // 8 red
] as const;

/** Sequential magnitude encoding (net worth over time, or any other
 * single-series line/area chart) -- dataviz's default sequential hue is
 * the same as categorical slot 1. This alias just names the *role* at
 * the call site; it is not a separate value to keep in sync. */
export const SEQUENTIAL_HUE: (typeof CATEGORICAL_PALETTE)[number] = CATEGORICAL_PALETTE[0];
