// Dev utility: enqueue a provider-sync job by hand.
//
//   pnpm --filter @financial-os/worker exec tsx src/scripts/enqueueSync.ts <connectionId>
//
// Until the dashboard has a re-sync button, this is the only way to
// trigger a drain on demand — a webhook needs a publicly reachable URL,
// and the scheduled poll (ING-8) runs on its own clock. It goes through
// the same shared enqueue helper as every other trigger, so it inherits
// ING-5's per-connection dedup rather than being a side door around it.
import { Queue } from "bullmq";
import { Redis } from "ioredis";
import {
  QUEUE_NAMES,
  enqueueProviderSync,
  type ProviderSyncJobData,
  type ProviderSyncJobOptions,
} from "@financial-os/shared";
import { env } from "../env.js";

async function main(): Promise<void> {
  const connectionId = process.argv[2];
  if (!connectionId) {
    console.error("usage: tsx src/scripts/enqueueSync.ts <connectionId>");
    process.exit(1);
  }

  const connection = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
  const queue = new Queue<ProviderSyncJobData>(QUEUE_NAMES.providerSync, { connection });

  await enqueueProviderSync(
    queue as unknown as {
      add(
        name: string,
        data: ProviderSyncJobData,
        opts: ProviderSyncJobOptions,
      ): Promise<{ id?: string | null } | null>;
    },
    connectionId,
  );

  console.info(`queued provider-sync for connection ${connectionId}`);
  await queue.close();
  await connection.quit();
}

main().catch((err: unknown) => {
  console.error("failed to enqueue:", err);
  process.exit(1);
});
