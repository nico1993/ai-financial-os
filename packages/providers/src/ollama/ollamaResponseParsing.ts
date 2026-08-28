// ollamaResponseParsing.ts — pure functions turning one Ollama chat
// response into well-formed CategorizationResults (ARCHITECTURE.md §2.3,
// ADR-0026). No I/O, no fetch, no Ollama client -- OllamaCategorizationProvider.ts
// is the only caller, and everything here is directly unit-testable
// against hand-built response strings.
//
// Why this needs to be more than JSON.parse: gpt-oss's structured-output
// support in Ollama has a documented history of wrapping valid JSON in a
// markdown fence, leaking "Harmony" format reasoning text around the
// payload, or returning something that isn't valid JSON at all
// (ollama/ollama#11691, #14440). None of that should become an exception
// the queue job has to interpret -- it becomes an uncertain, low-confidence
// result instead, same as if the model had honestly said "I don't know".
import type { CategorizationResult } from "../CategorizationProvider.js";

/** Strips the common ways a model wraps its "clean" JSON in something
 * that isn't. Order matters: a fenced block is the most specific and
 * least ambiguous signal, so it's tried first; the bracket-span fallback
 * below it is a broader heuristic for leaked commentary with no fence. */
export function extractJsonPayload(content: string): string {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(content);
  if (fenced?.[1]) return fenced[1].trim();

  const start = content.indexOf("[");
  const end = content.lastIndexOf("]");
  if (start !== -1 && end !== -1 && end > start) {
    return content.slice(start, end + 1);
  }

  return content.trim();
}

/** Parses `content` into a JSON array, or null if it can't be -- either
 * because it isn't valid JSON at all, or because it parsed to something
 * that isn't an array (an object, a bare string, etc). Null is the signal
 * OllamaCategorizationProvider uses to decide whether a whole-response
 * retry is worth attempting, as opposed to the per-entry fallback
 * reconcileCategorizationResults() below handles on its own. */
export function parseCategorizationArray(content: string): unknown[] | null {
  try {
    const parsed: unknown = JSON.parse(extractJsonPayload(content));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isValidEntry(
  value: unknown,
): value is { transactionId: string; category: string; confidence: number; uncertain: boolean } {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.transactionId === "string" &&
    typeof entry.category === "string" &&
    entry.category.trim().length > 0 &&
    typeof entry.confidence === "number" &&
    entry.confidence >= 0 &&
    entry.confidence <= 1 &&
    typeof entry.uncertain === "boolean"
  );
}

/** Reconciles a parsed (but not yet trusted) array against exactly the
 * candidates that were actually sent. A candidate with no matching valid
 * entry -- missing, malformed, or out of range -- gets a safe fallback
 * result rather than being dropped, so the caller never has to notice a
 * missing entry. An entry for a transactionId that was never a candidate
 * is ignored; a duplicate transactionId keeps the last occurrence, the
 * same "last one wins" convention buildTier1Index() uses for duplicate
 * rule patterns. */
export function reconcileCategorizationResults(
  parsed: unknown[],
  candidates: readonly { transactionId: string }[],
): CategorizationResult[] {
  const byId = new Map<string, CategorizationResult>();
  for (const entry of parsed) {
    if (isValidEntry(entry)) {
      byId.set(entry.transactionId, {
        transactionId: entry.transactionId,
        category: entry.category,
        confidence: entry.confidence,
        uncertain: entry.uncertain,
      });
    }
  }

  return candidates.map(
    (candidate) =>
      byId.get(candidate.transactionId) ?? {
        transactionId: candidate.transactionId,
        category: "Uncategorized",
        confidence: 0,
        uncertain: true,
      },
  );
}
