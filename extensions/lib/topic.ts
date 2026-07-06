/**
 * Keyword-based topic classifier for doc-synth.
 * Maps content text to canonical topic name based on keyword presence.
 * Fallback when no [topic] tag provided.
 */

export type TopicName = "architecture" | "bugs" | "conventions" | "workflow"
  | "tech-stack" | "decisions" | "uncategorized";

const RULES: [RegExp, TopicName][] = [
  [/\b(uses|tech stack|service|module|composable)\b/i, "architecture"],
  [/\b(error|fix|broken|crash|bug|fail)\b/i, "bugs"],
  [/\b(always|never|convention|must|pattern)\b/i, "conventions"],
  [/\b(before|after|step|first|then)\b/i, "workflow"],
  [/\b(postgres|redis|nuxt|encore|laravel)\b/i, "tech-stack"],
  [/\b(decided|chose|tradeoff|instead of)\b/i, "decisions"],
];

export function classifyTopic(content: string): TopicName {
  const lower = content.toLowerCase();
  for (const [re, topic] of RULES) {
    if (re.test(lower)) return topic;
  }
  return "uncategorized";
}
