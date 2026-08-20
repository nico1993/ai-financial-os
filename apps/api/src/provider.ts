// provider.ts — the one place apps/api constructs a PlaidProvider
// (AGENTS.md: never call the Plaid SDK directly outside packages/providers).
import { createPlaidClient, PlaidProvider } from "@financial-os/providers";
import { env } from "./env.js";

let provider: PlaidProvider | undefined;

export function getFinancialProvider(): PlaidProvider {
  if (!provider) {
    const client = createPlaidClient({
      clientId: env.PLAID_CLIENT_ID,
      secret: env.PLAID_SECRET,
      env: env.PLAID_ENV,
    });
    provider = new PlaidProvider(client, {
      clientName: env.PLAID_CLIENT_NAME,
      webhookUrl: env.PLAID_WEBHOOK_URL,
    });
  }
  return provider;
}
