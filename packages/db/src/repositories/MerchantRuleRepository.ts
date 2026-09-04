// MerchantRuleRepository — every persistence operation on MerchantRule goes
// through here (ADR-0005, ADR-0027). CAT-3's read side loads a user's Tier
// 1/2 rules to categorize inline during sync; upsertExact() is CAT-6's
// write-back side, seeding Tier 1 rows from confirmed LLM decisions today
// (apps/worker/src/queues/categorizeLlm.ts) and from manual Tier 4
// corrections once CAT-7 exists.
import {
  MerchantRuleModel,
  type MerchantRuleDocument,
  type MerchantRuleSource,
} from "../models/MerchantRule.js";

export interface MerchantRuleWriteBack {
  userId: string;
  pattern: string;
  category: string;
  source: MerchantRuleSource;
}

export class MerchantRuleRepository {
  /** Tier 1's exact-match lookup table for one user (§2.3). Returns full
   * documents; mapping into the Tier 1 resolver's narrower input shape is
   * the caller's job (apps/worker/src/sync/syncConnection.ts) -- this
   * package has no business knowing what shape a pure function elsewhere
   * in the monorepo expects. */
  async findExactByUser(userId: string): Promise<MerchantRuleDocument[]> {
    return MerchantRuleModel.find({ userId, matchType: "exact" }).lean<MerchantRuleDocument[]>();
  }

  /** Tier 2's regex rules for one user. Priority ordering (and breaking
   * ties by insertion order) is resolveTier2Regex()'s job, not this
   * query's -- sorting here would just be redone there against whatever
   * order this returns. */
  async findRegexByUser(userId: string): Promise<MerchantRuleDocument[]> {
    return MerchantRuleModel.find({ userId, matchType: "regex" }).lean<MerchantRuleDocument[]>();
  }

  /** CAT-6's write-back: idempotent upsert on the (userId, pattern) exact-
   * match key -- the same unique partial index (matchType: 'exact') Tier
   * 1's lookup relies on. On conflict, last write wins on category/source
   * (tier1.ts's buildTier1Index() already documents this rules table as
   * advisory data, not something that should refuse a write); a future
   * manual correction (CAT-7) calling this with source: "manual" is
   * expected to overwrite an "llm" row here, since a human's decision
   * should win over the model's. In the normal flow this rarely conflicts
   * at all -- a merchant with an existing Tier 1 rule is resolved by Tier
   * 1 during sync and never reaches Tier 3 to begin with; the realistic
   * case is two transactions for the same not-yet-ruled merchant both
   * confirming in the same categorize-llm run. */
  async upsertExact(rule: MerchantRuleWriteBack): Promise<void> {
    await MerchantRuleModel.updateOne(
      { userId: rule.userId, pattern: rule.pattern, matchType: "exact" },
      {
        $set: { category: rule.category, source: rule.source },
        $setOnInsert: {
          userId: rule.userId,
          tier: 1,
          matchType: "exact",
          pattern: rule.pattern,
          priority: 0,
        },
      },
      { upsert: true, setDefaultsOnInsert: true },
    );
  }

  /** AUTH-8/ADR-0047: erases every MerchantRule (Tier 1 and Tier 2) this
   * user owns. */
  async deleteAllForUser(userId: string): Promise<number> {
    const result = await MerchantRuleModel.deleteMany({ userId });
    return result.deletedCount;
  }
}
