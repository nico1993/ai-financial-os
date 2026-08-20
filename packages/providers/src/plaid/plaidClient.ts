// Plaid SDK client factory. The only file in the package allowed to
// construct a PlaidApi instance — PlaidProvider is the only consumer.
import { Configuration, PlaidApi, PlaidEnvironments } from "plaid";

export interface PlaidClientConfig {
  clientId: string;
  secret: string;
  /** Matches Plaid's environment names — see .env.example's PLAID_ENV. */
  env: "sandbox" | "development" | "production";
}

export function createPlaidClient(config: PlaidClientConfig): PlaidApi {
  const configuration = new Configuration({
    basePath: PlaidEnvironments[config.env],
    baseOptions: {
      headers: {
        "PLAID-CLIENT-ID": config.clientId,
        "PLAID-SECRET": config.secret,
      },
    },
  });

  return new PlaidApi(configuration);
}
