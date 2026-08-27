// tier2.ts — Tier 2 regex + fuzzy categorization resolver (ARCHITECTURE.md
// §2.3, BACKLOG.md CAT-2). Pure functions, no I/O: CAT-3 wires this inline
// into the sync job, right after Tier 1 misses, by loading a user's regex
// MerchantRule rows and a pool of previously-corrected merchants.
import type { TransactionCategory } from "@financial-os/db";

export interface Tier2RegexRule {
  /** MerchantRule.pattern for a 'regex' row -- a regex SOURCE string, no
   * delimiters and no flags (e.g. "UBER \\*TRIP", not "/UBER \\*TRIP/i").
   * resolveTier2Regex always compiles it case-insensitively, so an author
   * never has to remember to add that themselves. Matched against
   * Transaction.description, not the normalized merchant key -- regex
   * rules are exactly where the punctuation and reference numbers
   * normalizeMerchantName() strips out are often the useful signal
   * (e.g. "UBER *TRIP" vs "UBER *EATS"). */
  pattern: string;
  category: string;
  /** Lower evaluates first; ties broken by insertion order (§2.3). */
  priority: number;
}

/** Priority-ordered regex evaluation over a user's Tier 2 rules. Stops at
 * the first match, so overlapping rules need `priority` to resolve
 * deterministically -- unlike Tier 1, more than one rule can plausibly
 * match the same description.
 *
 * An unparsable `pattern` (a user can author any string) is skipped rather
 * than thrown: one bad rule must not take down categorization for every
 * transaction that reaches Tier 2. Validating patterns at authoring time
 * (the future Tier 2 rule-management UI) is where that feedback belongs,
 * not here. */
export function resolveTier2Regex(
  description: string,
  rules: readonly Tier2RegexRule[],
): TransactionCategory | undefined {
  const ordered = [...rules].sort((a, b) => a.priority - b.priority);
  for (const rule of ordered) {
    let regex: RegExp;
    try {
      regex = new RegExp(rule.pattern, "i");
    } catch {
      continue;
    }
    if (regex.test(description)) {
      return { tier: 2, value: rule.category, status: "confirmed" };
    }
  }
  return undefined;
}

export interface CorrectedMerchant {
  /** A past transaction's merchantNameNormalized -- the same key space
   * Tier 1 uses, but read live from Transaction rather than from
   * MerchantRules (see MerchantRule.ts's header comment: fuzzy matching
   * queries Transaction directly, it isn't stored here). */
  normalizedMerchant: string;
  category: string;
}

/** Minimum single-character insertions/deletions/substitutions to turn `a`
 * into `b`. Hand-rolled rather than a dependency: this project has no npm
 * registry access from either sandbox it's built in (AGENTS.md), and it's
 * a few lines of textbook dynamic programming with no reason to carry a
 * package for it. */
function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previousRow: number[] = Array.from({ length: b.length + 1 }, (_, j) => j);

  for (let i = 1; i <= a.length; i++) {
    const currentRow: number[] = [i];
    for (let j = 1; j <= b.length; j++) {
      const substitutionCost = a[i - 1] === b[j - 1] ? 0 : 1;
      const deletion = (previousRow[j] ?? 0) + 1;
      const insertion = (currentRow[j - 1] ?? 0) + 1;
      const substitution = (previousRow[j - 1] ?? 0) + substitutionCost;
      currentRow.push(Math.min(deletion, insertion, substitution));
    }
    previousRow = currentRow;
  }

  return previousRow[b.length] ?? 0;
}

/** 1 for identical strings, 0 for two strings with nothing in common at
 * their scale. Distance alone isn't comparable across candidates of
 * different lengths -- an edit distance of 3 is a near-miss for a
 * 20-character merchant name and a different word entirely for a
 * 4-character one. */
function similarity(a: string, b: string): number {
  const longer = Math.max(a.length, b.length);
  if (longer === 0) return 1;
  return 1 - levenshteinDistance(a, b) / longer;
}

/** Below this, two merchant strings are "different merchants that happen
 * to share some letters," not "the same merchant written slightly
 * differently." 0.8 is a starting point, not a measured constant -- the
 * same "deliberately blunt for now" honesty as normalizeMerchantName()'s
 * own normalization -- and, like that function, is easy to tune later
 * since nothing depends on today's exact value. Inclusive: a score of
 * exactly the threshold counts as a match. */
const FUZZY_MATCH_THRESHOLD = 0.8;

/** Fuzzy match against merchants a human has previously corrected --
 * "learning" from Tier 4 without needing an exact-match Tier 1 rule for
 * every minor spelling/formatting variant of the same merchant (§2.3).
 * Picks the closest match above the threshold; ties go to whichever
 * candidate appears first, matching the tie-break convention
 * resolveTier2Regex uses for equal-priority rules. */
export function resolveTier2Fuzzy(
  normalizedMerchant: string,
  correctedMerchants: readonly CorrectedMerchant[],
): TransactionCategory | undefined {
  if (!normalizedMerchant) return undefined;

  let best: { category: string; score: number } | undefined;
  for (const candidate of correctedMerchants) {
    if (!candidate.normalizedMerchant) continue;
    const score = similarity(normalizedMerchant, candidate.normalizedMerchant);
    if (score < FUZZY_MATCH_THRESHOLD) continue;
    if (!best || score > best.score) best = { category: candidate.category, score };
  }

  return best ? { tier: 2, value: best.category, status: "confirmed" } : undefined;
}

/** The Tier 2 resolver CAT-3 actually calls: regex first (explicit,
 * user-authored, deterministic), falling through to fuzzy matching
 * against corrected merchants only when no regex rule fires. Both are
 * "Tier 2" in ARCHITECTURE.md §2.3, but an intentional rule a person wrote
 * is a stronger signal than an inferred similarity, so it gets first say. */
export function resolveTier2(
  input: { description: string; normalizedMerchant: string },
  rules: {
    regex: readonly Tier2RegexRule[];
    correctedMerchants: readonly CorrectedMerchant[];
  },
): TransactionCategory | undefined {
  return (
    resolveTier2Regex(input.description, rules.regex) ??
    resolveTier2Fuzzy(input.normalizedMerchant, rules.correctedMerchants)
  );
}
