// provider.ts — the one place apps/worker constructs a PlaidProvider
// (AGENTS.md: never call the Plaid SDK directly outside packages/providers).
//
// Resolved per Connection.provider so a second adapter (ADR-0004) becomes
// another case here rather than a change inside the sync job.
import { createPlaidClient, PlaidProvider, type FinancialProvider } from "@financial-os/providers";
import type { ConnectionDocument } from "@financial-os/db";
import { env } from "./env.js";

let plaidProvider: PlaidProvider | undefined;

function getPlaidProvider(): PlaidProvider {
  if (!plaidProvider) {
    const client = createPlaidClient({
      clientId: env.PLAID_CLIENT_ID,
      secret: env.PLAID_SECRET,
      env: env.PLAID_ENV,
    });
    plaidProvider = new PlaidProvider(client, {
      clientName: env.PLAID_CLIENT_NAME,
      webhookUrl: env.PLAID_WEBHOOK_URL,
    });
  }
  return plaidProvider;
}

export function getProviderFor(provider: ConnectionDocument["provider"]): FinancialProvider {
  switch (provider) {
    case "plaid":
      return getPlaidProvider();
    default: {
      // Exhaustiveness guard: adding a provider to the union without
      // wiring an adapter here becomes a compile error, not a 3am surprise.
      const unreachable: never = provider;
      throw new Error(`No adapter registered for provider: ${String(unreachable)}`);
    }
  }
}
