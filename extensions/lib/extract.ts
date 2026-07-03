/**
 * Pulls the raw fact-content string(s) out of a retain/learn tool_result event's
 * `input`. Returns null (never throws) when toolName isn't recognized or the input
 * shape doesn't match what retain/learn actually send — callers treat null as
 * "skip this call, log the mismatch".
 */
export function extractFacts(toolName: string, input: unknown): string[] | null {
  if (input === null || typeof input !== "object") return null;

  if (toolName === "retain") {
    const items = (input as Record<string, unknown>).items;
    if (!Array.isArray(items)) return null;
    const facts: string[] = [];
    for (const item of items) {
      if (item && typeof item === "object" && "content" in item) {
        const content = (item as Record<string, unknown>).content;
        if (typeof content === "string") {
          facts.push(content);
        }
      }
    }
    return facts.length > 0 ? facts : null;
  }

  if (toolName === "learn") {
    const memory = (input as Record<string, unknown>).memory;
    return typeof memory === "string" ? [memory] : null;
  }

  return null;
}
