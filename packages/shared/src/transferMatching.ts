// transferMatching.ts — XFER-1's transfer-matching candidate logic (pure
// function, ARCHITECTURE.md §2.4, ADR-0006, ADR-0029). No I/O: given a
// user's pool of unmatched transactions, decides which pairs are almost
// certainly the two sides of one cross-account transfer.
//
// XFER-7: relocated here from apps/worker/src/transfer/matching.ts --
// this stayed pure and dependency-free the whole time it lived there,
// but apps/api cannot import from apps/worker (AGENTS.md's dependency
// direction, the same reason CAT-7's route never imported apps/worker's
// write-back helper), and XFER-7 needs a route that runs this same
// heuristic on demand for one transaction. packages/shared is what both
// apps/worker's batch job (queues/transferMatching.ts) and the new API
// route import from now, instead of forking the logic across two
// packages. The worker's own queue glue is what loads the pool and
// writes the result (unchanged, still apps/worker/src/queues/
// transferMatching.ts) -- same split as categorize/tier1.ts vs.
// sync/syncConnection.ts.
/** Plaid's personal_finance_category.detailed prefix shared by every
 * transfer subtype (TRANSFER_IN_*, TRANSFER_OUT_*) -- confirmed against
 * Plaid's published taxonomy
 * (plaid.com/documents/transactions-personal-finance-category-taxonomy.csv),
 * not guessed. */
const TRANSFER_CATEGORY_PREFIX = "TRANSFER_";

/** Payment-type detailed categories treated as a transfer signal even
 * though they don't carry the TRANSFER_ prefix -- ARCHITECTURE.md §2.4
 * names exactly this one ("a credit-card payment leaving checking landing
 * on the card"). Deliberately not the rest of Plaid's LOAN_PAYMENTS_*
 * family (car/personal/mortgage/student loan payments): those typically
 * leave for a servicer this app has no linked account for, so matching
 * them against an unrelated equal-amount transaction would be a real
 * guess, not a documented case (ADR-0029). Extend this set if a real
 * Plaid sandbox run surfaces another payment-type category actually worth
 * matching (same discovery pattern as ADR-0028's taxonomy gaps) -- don't
 * guess ahead of that evidence. */
const PAYMENT_TYPE_CATEGORIES: ReadonlySet<string> = new Set(["LOAN_PAYMENTS_CREDIT_CARD_PAYMENT"]);

/** True if `providerCategory` (Transaction.providerCategory, Plaid's raw
 * personal_finance_category.detailed, ADR-0029) is the kind of signal
 * §2.4 requires on *at least one* side of a matched pair. Undefined (no
 * signal at all, or a provider that doesn't supply one) is never a
 * signal. */
export function isTransferSignalCategory(providerCategory: string | undefined): boolean {
  if (!providerCategory) return false;
  return (
    providerCategory.startsWith(TRANSFER_CATEGORY_PREFIX) ||
    PAYMENT_TYPE_CATEGORIES.has(providerCategory)
  );
}

/** The slice of a Transaction this module actually needs -- narrow on
 * purpose (same reasoning as syncConnection.ts's SyncConnectionDeps), so
 * a test fixture is a plain object, not a Mongoose document. */
export interface TransferCandidateTransaction {
  id: string;
  accountId: string;
  /** Integer cents, Plaid convention: positive = money leaving the
   * account (ARCHITECTURE.md §3.2). */
  amount: number;
  date: Date;
  providerCategory?: string;
}

export interface TransferMatchOptions {
  /** How many calendar days apart the two sides may fall and still count
   * as the same transfer -- ACH transfers commonly settle 1-3 days apart
   * across accounts (§2.4). Inclusive. */
  dateToleranceDays: number;
  /** How many cents the two magnitudes may differ by and still count as
   * "equal" -- covers a wire/ACH fee shaved off one side (§2.4). 0 means
   * exact-magnitude only. Inclusive. */
  amountToleranceCents: number;
}

export interface TransferMatchPair {
  /** The transfer/payment-signal-tagged transaction findTransferMatches()
   * was searching a counterpart for. No ordering meaning beyond that --
   * XFER-3 treats both ids identically when applying the match. */
  anchorId: string;
  counterpartId: string;
}

function daysBetween(a: Date, b: Date): number {
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  return Math.abs(a.getTime() - b.getTime()) / MS_PER_DAY;
}

/**
 * Finds cross-account transfer pairs among `candidates` (§2.4, ADR-0006):
 * opposite-signed, (near-)equal magnitude, different accounts, within the
 * date tolerance, with at least one side carrying a transfer/payment-type
 * signal (`isTransferSignalCategory`). The caller
 * (../queues/transferMatching.ts) is expected to have already excluded
 * anything removed, pending, or already linked to a transferGroupId --
 * this function trusts its input the same way tier1.ts trusts an
 * already-normalized merchant string.
 *
 * Deterministic greedy pairing: transfer-signal-tagged transactions
 * ("anchors") are visited in a fixed order (date, then id), and each picks
 * the best still-available counterpart from the *whole* candidate pool
 * (closest date, then closest amount, then smallest id, as tiebreakers) --
 * a candidate matched to one anchor can't also match another. This is a
 * real simplification, not a claim of optimality: with several
 * same-day/same-amount candidates on both sides (XFER-6's "same-day
 * duplicates" case), a different pairing could be equally valid, and
 * nothing here can tell them apart without more information than a
 * transaction record carries. What this guarantees is determinism (the
 * same input always produces the same pairing, so it's testable) and
 * correctness of the pairs it does return (every constraint above holds
 * for each one) -- not that it's the *only* correct pairing.
 */
export function findTransferMatches(
  candidates: readonly TransferCandidateTransaction[],
  options: TransferMatchOptions,
): TransferMatchPair[] {
  const anchors = candidates
    .filter((c) => c.amount !== 0 && isTransferSignalCategory(c.providerCategory))
    .slice()
    .sort((a, b) => a.date.getTime() - b.date.getTime() || a.id.localeCompare(b.id));

  const used = new Set<string>();
  const pairs: TransferMatchPair[] = [];

  for (const anchor of anchors) {
    if (used.has(anchor.id)) continue;

    let best: TransferCandidateTransaction | undefined;
    let bestDateDiff = Infinity;
    let bestAmountDiff = Infinity;

    for (const candidate of candidates) {
      if (candidate.id === anchor.id) continue;
      if (used.has(candidate.id)) continue;
      if (candidate.amount === 0) continue;
      if (candidate.accountId === anchor.accountId) continue;
      // Opposite signs: one side leaving an account, the other arriving.
      if (Math.sign(candidate.amount) === Math.sign(anchor.amount)) continue;

      const amountDiff = Math.abs(Math.abs(candidate.amount) - Math.abs(anchor.amount));
      if (amountDiff > options.amountToleranceCents) continue;

      const dateDiff = daysBetween(anchor.date, candidate.date);
      if (dateDiff > options.dateToleranceDays) continue;

      if (
        best === undefined ||
        dateDiff < bestDateDiff ||
        (dateDiff === bestDateDiff && amountDiff < bestAmountDiff) ||
        (dateDiff === bestDateDiff &&
          amountDiff === bestAmountDiff &&
          candidate.id.localeCompare(best.id) < 0)
      ) {
        best = candidate;
        bestDateDiff = dateDiff;
        bestAmountDiff = amountDiff;
      }
    }

    if (best) {
      used.add(anchor.id);
      used.add(best.id);
      pairs.push({ anchorId: anchor.id, counterpartId: best.id });
    }
  }

  return pairs;
}


/**
 * XFER-7: for ONE specific transaction ("anchor"), returns every
 * still-available candidate from `pool` that could be its transfer
 * counterpart, ranked best-first (closest date, then closest amount,
 * then smallest id -- the same tiebreak order findTransferMatches()
 * uses when picking its own single best match). Unlike
 * findTransferMatches(), this doesn't consume candidates into a
 * pool-wide pairing or return only the single best one -- the manual
 * review UI this feeds shows a person a short ranked list to pick from
 * for this one transaction, not an automated batch decision, so
 * returning several options (the caller/route decides how many to
 * show) is the right shape.
 *
 * Deliberately duplicates findTransferMatches()'s constraint checks
 * (opposite sign, different account, within both tolerances) rather
 * than sharing code with it: `vitest` cannot run in the environment
 * this was built in (BACKLOG.md's own recurring note), and
 * findTransferMatches() already has 12 passing test cases pinning its
 * exact behavior down -- refactoring it to share logic with this new
 * function, with no way to actually run either suite and confirm
 * nothing regressed, was a worse trade than a few duplicated lines of
 * straightforward boolean checks.
 *
 * `anchor` itself is not required to carry a transfer signal here,
 * unlike findTransferMatches()'s own anchor-selection filter -- the
 * caller already knows which transaction it's suggesting candidates
 * for (a `needs_review` row the route/UI decided is worth offering this
 * choice on), so re-deriving that from `isTransferSignalCategory()` a
 * second time here would be redundant, not protective.
 */
export function suggestTransferCandidates(
  anchor: TransferCandidateTransaction,
  pool: readonly TransferCandidateTransaction[],
  options: TransferMatchOptions,
): TransferCandidateTransaction[] {
  return pool
    .filter((candidate) => candidate.id !== anchor.id)
    .map((candidate) => ({
      candidate,
      dateDiff: daysBetween(anchor.date, candidate.date),
      amountDiff: Math.abs(Math.abs(candidate.amount) - Math.abs(anchor.amount)),
    }))
    .filter(
      ({ candidate, dateDiff, amountDiff }) =>
        anchor.amount !== 0 &&
        candidate.amount !== 0 &&
        candidate.accountId !== anchor.accountId &&
        Math.sign(candidate.amount) !== Math.sign(anchor.amount) &&
        amountDiff <= options.amountToleranceCents &&
        dateDiff <= options.dateToleranceDays,
    )
    .sort(
      (a, b) =>
        a.dateDiff - b.dateDiff ||
        a.amountDiff - b.amountDiff ||
        a.candidate.id.localeCompare(b.candidate.id),
    )
    .map(({ candidate }) => candidate);
}
