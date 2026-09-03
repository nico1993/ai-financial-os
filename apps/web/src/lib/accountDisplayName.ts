// lib/accountDisplayName.ts — ACCT-3: extracted out of AccountsPage.tsx
// (originally ACCT-1's own local helper) so /transactions' account
// column can resolve the same name a renamed account shows everywhere
// else, without duplicating the precedence rule in a second place. Kept
// deliberately structural (not tied to AccountListItem specifically) so
// TransactionListItem["account"] -- a different shape from the same API
// -- can use it too.
//
// Precedence: a user-set nickname wins, falling back to Plaid's own
// naming (`officialName`, then, since even that's optional on some
// account types, the institution name). Same rule accounts/list.ts's
// buildAccountList() doc comment describes.
export interface AccountDisplayNameInput {
  nickname?: string;
  officialName?: string;
  institutionName: string;
}

export function accountDisplayName(account: AccountDisplayNameInput): string {
  return account.nickname ?? account.officialName ?? account.institutionName;
}
