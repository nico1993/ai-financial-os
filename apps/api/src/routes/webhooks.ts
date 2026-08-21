// routes/webhooks.ts — the Plaid webhook receiver (ING-7).
//
// This is the one route reachable from the public internet without a
// session (AUTH-4's documented exemption): Plaid can't hold a cookie. Its
// authentication is the signed JWT in `Plaid-Verification`, checked
// against the raw request bytes before anything in the body is trusted
// (ARCHITECTURE.md §5).
import type { FastifyInstance } from "fastify";
import { ConnectionRepository } from "@financial-os/db";
import { getFinancialProvider } from "../provider.js";
import { requestProviderSync } from "../queues.js";

const connections = new ConnectionRepository();

/** What the scoped body parser below produces: the parsed JSON plus the
 * exact bytes it came from. */
interface RawJsonBody {
  raw: string;
  parsed: unknown;
}

export async function registerWebhookRoutes(app: FastifyInstance): Promise<void> {
  // Encapsulated in its own plugin scope so this content-type parser
  // applies ONLY to the webhook route — every other route keeps Fastify's
  // normal JSON handling and a plain object body.
  await app.register(async (scope) => {
    // Signature verification hashes the body Plaid actually sent. Fastify
    // normally hands back a parsed object, and re-serializing it would
    // produce different bytes (key order, whitespace, number formatting),
    // so the hash would never match. Keeping the raw string is what makes
    // verification possible at all.
    scope.addContentTypeParser("application/json", { parseAs: "string" }, (_req, raw, done) => {
      try {
        done(null, { raw, parsed: JSON.parse(raw) } satisfies RawJsonBody);
      } catch {
        // Hand the raw bytes through with parsed: undefined rather than
        // erroring. An unverified caller shouldn't learn anything from
        // the difference between "bad JSON" and "bad signature" — both
        // exit as 401 below.
        done(null, { raw, parsed: undefined } satisfies RawJsonBody);
      }
    });

    scope.post("/api/webhooks/plaid", async (req, reply) => {
      const body = req.body as RawJsonBody | undefined;
      if (!body) return reply.code(401).send({ error: "unverified" });

      const provider = getFinancialProvider();

      const verified = await provider.verifyWebhook({
        rawBody: body.raw,
        headers: req.headers as Record<string, string | undefined>,
      });
      if (!verified) {
        req.log.warn("[webhook] rejected an unverified Plaid webhook");
        return reply.code(401).send({ error: "unverified" });
      }

      const event = provider.parseWebhook(body.parsed);

      if (event.type === "ignored") {
        // 200, not an error: the webhook was genuinely from Plaid and
        // there is nothing wrong with it — we just have nothing to do.
        // Answering non-2xx would make Plaid retry something that will
        // never succeed.
        req.log.info({ reason: event.reason }, "[webhook] ignoring Plaid webhook");
        return reply.send({ status: "ignored" });
      }

      const connection = await connections.findByProviderItemId("plaid", event.providerItemId);
      if (!connection) {
        // Verified as Plaid's, but for an Item we have no Connection for —
        // e.g. one removed on our side. Retrying won't help, so ack it.
        req.log.warn(
          { providerItemId: event.providerItemId },
          "[webhook] no connection for this provider item",
        );
        return reply.send({ status: "unknown_connection" });
      }

      // Enqueue and return immediately. The drain itself can take many
      // pages; holding the webhook open for it would risk Plaid's timeout
      // and a duplicate delivery.
      await requestProviderSync(connection._id.toString());

      req.log.info({ connectionId: connection._id.toString() }, "[webhook] queued provider sync");
      return reply.send({ status: "queued" });
    });
  });
}
