// categories/palette.ts — CAT-14's create-time default color.
// `POST /api/categories` (routes/categories.ts) requires a color at
// creation (BACKLOG.md's own text: "a color is required at creation --
// CAT-10's existing default-palette logic can seed a sensible one rather
// than forcing a color picker up front"). "CAT-10's existing
// default-palette logic" is DEFAULT_CATEGORY_SEEDS
// (apps/worker/src/categorize/categories.ts) cycling the dataviz skill's
// validated 8-hue categorical palette by array index at seed time --
// apps/api can't import that (apps/api has no dependency on apps/worker,
// AGENTS.md's dependency-direction rule, the same reason CAT-7's route
// forked its own write-back call instead of importing
// apps/worker/writeBack.ts), so the same 8 hex values are duplicated here
// rather than re-derived -- the same "each app defines the same small
// constant list independently" precedent CATEGORICAL_PALETTE already
// establishes between apps/web/src/design/tokens.ts and
// apps/worker/src/categorize/categories.ts.
//
// Pure and tiny on purpose (AGENTS.md's test-first convention for pure
// logic) -- cycles by this user's current active-category count, the
// same "next hue in fixed rotation" idea DEFAULT_CATEGORY_SEEDS applies
// at seed time, just computed per-request instead of once up front.
export const CATEGORY_COLOR_PALETTE: readonly string[] = [
  "#2a78d6", // 1 blue
  "#eb6834", // 2 orange
  "#1baf7a", // 3 aqua
  "#eda100", // 4 yellow
  "#e87ba4", // 5 magenta
  "#008300", // 6 green
  "#4a3aa7", // 7 violet
  "#e34948", // 8 red
] as const;

/** `existingCount` is the user's current active-category count
 * (`CategoryRepository.findActiveByUser(userId).length`) at creation
 * time -- a negative count is defensively treated as 0 rather than
 * throwing, since a caller has no real way to produce one but this keeps
 * the modulo math from returning a negative array index if one ever
 * does. */
export function pickDefaultCategoryColor(existingCount: number): string {
  const count = Math.max(0, existingCount);
  return CATEGORY_COLOR_PALETTE[count % CATEGORY_COLOR_PALETTE.length]!;
}
