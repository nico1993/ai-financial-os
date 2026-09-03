// design/categoryIcons.tsx — CAT-11's curated, fixed icon set (BACKLOG.md:
// "not free-form icon upload"). `lucide-react` is this project's first UI
// icon dependency (user-confirmed 2026-09-01, BACKLOG.md CAT-11) --
// registry-checked at 1.39.0 against this app's real react@^19.2.8 peer
// range (`"react": "^16.5.1 || ^17.0.0 || ^18.0.0 || ^19.0.0"`), the same
// ADR-0031/ADR-0039 discipline every dependency added to this project
// follows. Every icon name below was confirmed to exist in that exact
// published version (its `dynamicIconImports`/named-export manifests),
// not assumed from general familiarity with the library.
//
// 24 icons total: one per DEFAULT_CATEGORY_SEED
// (apps/worker/src/categorize/categories.ts -- duplicated key-for-key, the
// same cross-app small-constant-list duplication CATEGORICAL_PALETTE
// already established between that file and tokens.ts, since apps/web
// can't import apps/worker either way) plus 6 extras sized to give a
// custom category (CAT-14) a reasonable spread of choices from the same
// curated set, per this ticket's own "room for custom ones to pick from
// the same set" text.
import {
  ArrowLeftRight,
  Banknote,
  BookOpen,
  Briefcase,
  Car,
  CircleHelp,
  Clapperboard,
  Coffee,
  Gift,
  GraduationCap,
  HeartPulse,
  Home,
  Music,
  Plane,
  Receipt,
  Repeat,
  Shield,
  ShoppingBag,
  ShoppingCart,
  Sparkles,
  Tag,
  TrendingUp,
  Utensils,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import type { CSSProperties } from "react";

export interface CategoryIconOption {
  key: string;
  label: string;
  Icon: LucideIcon;
}

/** Order here is the IconPicker's grid order -- the 18 default-category
 * icons first (same order as DEFAULT_CATEGORY_SEEDS), then the 6 extras
 * for custom categories. Not meant to be a lookup table itself (see
 * CATEGORY_ICON_COMPONENTS below for that) -- kept as an ordered array
 * because a picker grid needs a stable order, not just a key -> component
 * map. */
export const CATEGORY_ICON_OPTIONS: readonly CategoryIconOption[] = [
  { key: "shopping-cart", label: "Groceries", Icon: ShoppingCart },
  { key: "utensils", label: "Dining", Icon: Utensils },
  { key: "car", label: "Transportation", Icon: Car },
  { key: "shopping-bag", label: "Shopping", Icon: ShoppingBag },
  { key: "clapperboard", label: "Entertainment", Icon: Clapperboard },
  { key: "receipt", label: "Bills", Icon: Receipt },
  { key: "home", label: "Housing", Icon: Home },
  { key: "heart-pulse", label: "Health", Icon: HeartPulse },
  { key: "plane", label: "Travel", Icon: Plane },
  { key: "repeat", label: "Subscriptions", Icon: Repeat },
  { key: "shield", label: "Insurance", Icon: Shield },
  { key: "graduation-cap", label: "Education", Icon: GraduationCap },
  { key: "sparkles", label: "Personal care", Icon: Sparkles },
  { key: "gift", label: "Gifts", Icon: Gift },
  { key: "banknote", label: "Fees", Icon: Banknote },
  { key: "trending-up", label: "Income", Icon: TrendingUp },
  { key: "arrow-left-right", label: "Transfer", Icon: ArrowLeftRight },
  { key: "circle-help", label: "Uncategorized", Icon: CircleHelp },
  { key: "tag", label: "Tag", Icon: Tag },
  { key: "briefcase", label: "Work", Icon: Briefcase },
  { key: "coffee", label: "Coffee", Icon: Coffee },
  { key: "music", label: "Music", Icon: Music },
  { key: "book-open", label: "Learning", Icon: BookOpen },
  { key: "wallet", label: "Wallet", Icon: Wallet },
];

const CATEGORY_ICON_COMPONENTS: Record<string, LucideIcon> = Object.fromEntries(
  CATEGORY_ICON_OPTIONS.map((option) => [option.key, option.Icon]),
);

/** Fallback for an icon key this set doesn't recognize (a category
 * created before CAT-11, or an icon value from outside the curated set
 * -- see routes/categories.ts's own note that the curated set is a
 * frontend picker constraint, not a database-enforced enum). */
const FALLBACK_ICON: LucideIcon = Tag;

export interface CategoryIconProps {
  icon?: string;
  className?: string;
  /** CAT-20: lets a caller tint the icon itself with the category's own
   * color instead of a separate swatch dot next to a fixed-color icon. */
  style?: CSSProperties;
}

/** Resolves a stored `Category.icon` string key to its actual
 * lucide-react component at render time (CAT-11's own ticket text). */
export function CategoryIcon({ icon, className, style }: CategoryIconProps) {
  const Icon = (icon && CATEGORY_ICON_COMPONENTS[icon]) || FALLBACK_ICON;
  return <Icon className={className} style={style} aria-hidden="true" />;
}
