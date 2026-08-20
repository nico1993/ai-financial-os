// @financial-os/providers
// FinancialProvider interface + PlaidProvider adapter (ARCHITECTURE.md
// §2.1, ADR-0004). Everything outside this package should import from
// here, not from packages/providers/src/plaid directly — that keeps the
// Plaid SDK import contained to this package's plaid/ subfolder.
export type {
  ConnectionResult,
  CreateLinkTokenInput,
  FinancialProvider,
  NormalizedAccount,
  NormalizedAccountType,
  NormalizedTransaction,
  ProviderConnectionRef,
  RemovedTransaction,
  SyncTransactionsResult,
  WebhookVerificationRequest,
} from "./FinancialProvider.js";

export { createPlaidClient, type PlaidClientConfig } from "./plaid/plaidClient.js";
export { PlaidProvider, type PlaidProviderConfig } from "./plaid/PlaidProvider.js";
