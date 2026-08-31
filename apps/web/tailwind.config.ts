import type { Config } from "tailwindcss";
import { FONT, RADIUS, STATUS_COLOR, TAG_PALETTE, UI_COLOR } from "./src/design/tokens";

// Feeds src/design/tokens.ts into Tailwind's theme -- that file is the
// single source of truth locked in from WEB-0's Mockup A (ADR-0030); this
// is a thin adapter, not a second place to edit a color/font/radius value.
// Loaded via the `@config` directive in src/index.css.
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        background: UI_COLOR.background,
        surface: UI_COLOR.surface,
        "surface-secondary": UI_COLOR.surfaceSecondary,
        ink: UI_COLOR.ink,
        "ink-secondary": UI_COLOR.inkSecondary,
        "ink-muted": UI_COLOR.inkMuted,
        border: UI_COLOR.border,
        accent: UI_COLOR.accent,
        "accent-wash": UI_COLOR.accentWash,
        "button-primary": UI_COLOR.buttonPrimary,
        "button-primary-hover": UI_COLOR.buttonPrimaryHover,

        good: STATUS_COLOR.good.base,
        "good-text": STATUS_COLOR.good.text,
        "good-wash": STATUS_COLOR.good.wash,
        warning: STATUS_COLOR.warning.base,
        "warning-text": STATUS_COLOR.warning.text,
        "warning-wash": STATUS_COLOR.warning.wash,
        serious: STATUS_COLOR.serious.base,
        "serious-text": STATUS_COLOR.serious.text,
        "serious-wash": STATUS_COLOR.serious.wash,
        critical: STATUS_COLOR.critical.base,
        "critical-text": STATUS_COLOR.critical.text,
        "critical-wash": STATUS_COLOR.critical.wash,

        "tag-red": TAG_PALETTE.red.bg,
        "tag-red-text": TAG_PALETTE.red.text,
        "tag-blue": TAG_PALETTE.blue.bg,
        "tag-blue-text": TAG_PALETTE.blue.text,
        "tag-green": TAG_PALETTE.green.bg,
        "tag-green-text": TAG_PALETTE.green.text,
        "tag-yellow": TAG_PALETTE.yellow.bg,
        "tag-yellow-text": TAG_PALETTE.yellow.text,
      },
      fontFamily: {
        sans: FONT.sans.split(",").map((f) => f.trim()),
        mono: FONT.mono.split(",").map((f) => f.trim()),
      },
      borderRadius: {
        sm: RADIUS.sm,
        md: RADIUS.md,
        lg: RADIUS.lg,
        pill: RADIUS.pill,
      },
    },
  },
} satisfies Config;
