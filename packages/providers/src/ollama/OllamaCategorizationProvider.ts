// OllamaCategorizationProvider — the Phase 1 CategorizationProvider
// implementation (ARCHITECTURE.md §2.3, ADR-0026). Every Ollama-specific
// detail (its /api/chat shape, the Harmony-format quirks, the retry
// policy) lives in this file and ollamaResponseParsing.ts; nothing outside
// packages/providers/src/ollama should know Ollama is the backend.
import {
  parseCategorizationArray,
  reconcileCategorizationResults,
} from "./ollamaResponseParsing.js";
import { CategorizationProviderUnavailableError } from "../categorizationErrors.js";
import type {
  CategorizationCandidate,
  CategorizationProvider,
  CategorizationResult,
} from "../CategorizationProvider.js";

export interface OllamaCategorizationProviderConfig {
  /** Base URL of the Ollama server -- e.g. http://localhost:11434 when
   * apps/worker runs on the host, or http://host.docker.internal:11434
   * when it runs inside the compose network. Ollama itself is NOT one of
   * the containers in docker-compose.yml: local model inference wants
   * direct GPU/unified-memory access a Linux container on macOS can't
   * give it, so it runs natively and the worker reaches out to it
   * (ADR-0026). */
  host: string;
  /** e.g. "gpt-oss:20b". */
  model: string;
}

const SYSTEM_PROMPT =
  "You are a precise transaction categorizer for a personal finance app. " +
  "You only ever respond with a JSON array matching the requested schema -- " +
  "no explanation, no markdown formatting, no text before or after the array.";

const RESPONSE_SCHEMA = {
  type: "array",
  items: {
    type: "object",
    properties: {
      transactionId: { type: "string" },
      category: { type: "string" },
      confidence: { type: "number" },
      uncertain: { type: "boolean" },
    },
    required: ["transactionId", "category", "confidence", "uncertain"],
    additionalProperties: false,
  },
} as const;

function buildUserPrompt(
  candidates: CategorizationCandidate[],
  categories: readonly string[],
): string {
  const rows = candidates
    .map((c) => {
      const amount = (c.amount / 100).toFixed(2);
      return `- id: ${c.transactionId} | merchant: ${c.normalizedMerchant} | description: ${c.description} | amount: ${amount} ${c.isoCurrencyCode}`;
    })
    .join("\n");

  return [
    `Categorize each of the following ${candidates.length} bank transactions into exactly one of these categories: ${categories.join(", ")}.`,
    `If none of the categories fit well, use "Uncategorized" and set uncertain to true.`,
    `A positive amount is money leaving the account (a purchase); a negative amount is money coming in (a refund or deposit).`,
    "",
    rows,
    "",
    "Respond with a JSON array with exactly one object per transaction, in this shape:",
    '[{"transactionId": "<the id given above, unchanged>", "category": "<one of the allowed categories>", "confidence": <0 to 1>, "uncertain": <true if you are not confident>}]',
    "Respond with ONLY the JSON array.",
  ].join("\n");
}

export class OllamaCategorizationProvider implements CategorizationProvider {
  constructor(private readonly config: OllamaCategorizationProviderConfig) {}

  async categorizeBatch(
    candidates: CategorizationCandidate[],
    categories: readonly string[],
  ): Promise<CategorizationResult[]> {
    if (candidates.length === 0) return [];

    let content = await this.callOllama(candidates, categories);
    let parsed = parseCategorizationArray(content);

    // The whole response was unusable -- one retry before giving up on
    // it (ADR-0026: gpt-oss/Ollama structured output is known to
    // occasionally return something that isn't valid JSON at all). A
    // response that parses but is missing/malformed for a handful of
    // candidates does NOT retry here -- those fall back individually in
    // reconcileCategorizationResults(), since retrying a whole batch over
    // one bad entry is wasteful and not guaranteed to do better.
    if (parsed === null) {
      content = await this.callOllama(candidates, categories);
      parsed = parseCategorizationArray(content);
    }

    if (parsed === null) {
      return candidates.map((candidate) => ({
        transactionId: candidate.transactionId,
        category: "Uncategorized",
        confidence: 0,
        uncertain: true,
      }));
    }

    return reconcileCategorizationResults(parsed, candidates);
  }

  private async callOllama(
    candidates: CategorizationCandidate[],
    categories: readonly string[],
  ): Promise<string> {
    let response: Response;
    try {
      const prompt = buildUserPrompt(candidates, categories);
      response = await fetch(`${this.config.host}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: this.config.model,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: prompt },
          ],
          format: RESPONSE_SCHEMA,
          stream: false,
          // gpt-oss always produces a reasoning trace before its final
          // answer (Ollama's Harmony format -- see
          // docs.ollama.com/capabilities/thinking); "low" keeps that
          // trace short instead of the default, which can otherwise
          // consume the whole context window before the model ever
          // reaches its final-answer channel (ADR-0026 addendum: a
          // known, still-open Ollama bug -- ollama/ollama#11691,
          // #11867 -- surfaces this as message.content coming back
          // completely empty despite real compute time). If
          // OLLAMA_MODEL is ever swapped for a non-thinking model,
          // revisit this field -- it's a gpt-oss-specific mitigation.
          think: "low",
          options: {
            // Deterministic, not creative -- this is classification, and
            // a stable answer for the same merchant matters more here
            // than it would for open-ended generation.
            temperature: 0,
            // Ollama's default is 4096 tokens. A full batch's prompt
            // (up to CATEGORIZE_LLM_BATCH_SIZE candidates, plus the JSON
            // schema and gpt-oss's reasoning trace) can exceed that
            // before any final content is written -- see the think note
            // above. 8192 leaves headroom for a 30-candidate batch.
            num_ctx: 8192,
          },
        }),
      });
    } catch (err) {
      throw new CategorizationProviderUnavailableError(
        `Could not reach Ollama at ${this.config.host} -- is "ollama serve" running?`,
        { cause: err },
      );
    }

    if (!response.ok) {
      throw new CategorizationProviderUnavailableError(
        `Ollama responded ${response.status} ${response.statusText}`,
      );
    }

    const body = (await response.json()) as {
      message?: { content?: string; thinking?: string };
    };
    const content = body.message?.content ?? "";

    if (content.trim() === "") {
      // Should be rare now that think/num_ctx above are set, but this is
      // exactly the failure mode ADR-0026 documents (ollama/ollama#11691,
      // #11867): real generation happens (nonzero duration) yet nothing
      // lands in message.content. Logging the thinking-trace length (not
      // its content, which may include the raw prompt/transaction data)
      // gives a quick signal at the caller's console for whether this is
      // that bug recurring vs. something else.
      console.warn(
        `[OllamaCategorizationProvider] empty message.content for a batch of ${candidates.length} candidate(s) ` +
          `(thinking trace: ${body.message?.thinking?.length ?? 0} chars). See ADR-0026.`,
      );
    }

    return content;
  }
}
