// MerchantRuleRepository — every persistence operation on MerchantRule goes
// through here (ADR-0005). Read-only for now: CAT-3 needs to load a user's
// Tier 1/2 rules to categorize inline during sync. The write side (CAT-6's
// write-back loop, seeding Tier 1 rows from confirmed LLM/manual decisions)
// is added when that story is built.
import { MerchantRuleModel, type MerchantRuleDocument } from "../models/MerchantRule.js";

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
}
