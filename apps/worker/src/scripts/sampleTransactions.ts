// Dev utility: look at what actually landed, in the fields CAT-1 cares about.
//
//   pnpm --filter @financial-os/worker exec tsx src/scripts/sampleTransactions.ts <connectionId>
//
// Two questions this answers before writing the Tier 1 resolver:
//   1. Did the sync's data path work at all — are transactions stored,
//      with sane integer-cent amounts and UTC dates?
//   2. How often does the provider give us a clean `merchantName` versus
//      leaving us to fall back to the raw description? That ratio decides
//      whether normalizeMerchantName() needs to strip processor prefixes
//      and trailing reference ids, or whether it is already good enough.
import {
  ConnectionRepository,
  TransactionRepository,
  connectDb,
  disconnectDb,
} from "@financial-os/db";
import { env } from "../env.js";

const ALL_TIME = {
  start: new Date("2000-01-01T00:00:00.000Z"),
  end: new Date("2100-01-01T00:00:00.000Z"),
};

function money(cents: number): string {
  return `${cents < 0 ? "-" : " "}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

async function main(): Promise<void> {
  const connectionId = process.argv[2];
  if (!connectionId) {
    console.error("usage: tsx src/scripts/sampleTransactions.ts <connectionId>");
    process.exit(1);
  }

  await connectDb({ uri: env.MONGO_URI });

  const connection = await new ConnectionRepository().findById(connectionId);
  if (!connection) {
    console.error(`No connection ${connectionId}`);
    process.exit(1);
  }

  const transactions = await new TransactionRepository().findByUserAndDateRange(
    connection.userId,
    ALL_TIME,
    { includeRemoved: true },
  );

  console.info(`connection ${connectionId} (${connection.institutionName})`);
  console.info(`cursor: ${connection.cursor ? "set" : "(none)"}   status: ${connection.status}`);
  console.info(`transactions stored: ${transactions.length}\n`);

  if (transactions.length === 0) {
    console.info("Nothing stored yet. A freshly linked sandbox Item often has no");
    console.info("transactions on its first sync — re-run the sync in a minute:");
    console.info(`  tsx src/scripts/enqueueSync.ts ${connectionId}`);
    await disconnectDb();
    return;
  }

  // The headline number for CAT-1.
  const withMerchant = transactions.filter((t) => t.merchantName && t.merchantName.length > 0);
  const pct = Math.round((withMerchant.length / transactions.length) * 100);
  console.info(`merchantName populated: ${withMerchant.length}/${transactions.length} (${pct}%)`);
  console.info(`  -> the rest fall back to the raw description as the Tier 1 key\n`);

  // How many normalized keys collide? A key that is unique per transaction
  // is useless for exact-match: the rules table would never get a hit.
  const keys = new Map<string, number>();
  for (const t of transactions)
    keys.set(t.merchantNameNormalized, (keys.get(t.merchantNameNormalized) ?? 0) + 1);
  const repeated = [...keys.values()].filter((n) => n > 1).length;
  console.info(`distinct normalized keys: ${keys.size} across ${transactions.length} transactions`);
  console.info(`  keys seen more than once: ${repeated}`);
  console.info(`  (a key per transaction means Tier 1 can never hit)\n`);

  console.info("sample:");
  for (const t of transactions.slice(0, 25)) {
    console.info(
      `  ${t.date.toISOString().slice(0, 10)}  ${money(t.amount).padStart(12)}  ${t.pending ? "pending" : "posted "}`,
    );
    console.info(`    merchantName : ${t.merchantName ?? "(null)"}`);
    console.info(`    description  : ${t.description}`);
    console.info(`    normalized   : ${t.merchantNameNormalized}`);
    console.info(
      `    category     : ${t.category.value} (tier ${t.category.tier}, ${t.category.status})`,
    );
  }

  console.info("\nmost common normalized keys:");
  for (const [key, count] of [...keys.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)) {
    console.info(`  ${String(count).padStart(3)}x  ${key}`);
  }

  await disconnectDb();
}

main().catch((err: unknown) => {
  console.error("sample failed:", err);
  process.exit(1);
});
