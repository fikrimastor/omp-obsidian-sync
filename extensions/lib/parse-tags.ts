import { SynthConfig } from "./config";

export interface TaggedContent {
  project: string;
  topic: string | null;
  content: string;
}

/**
 * Parses content for [project:x] [topic] tags.
 * 
 * Regex: /^\s*\[project:([a-z0-9_-]+)\](?:\s+\[([a-z0-9_-]+)\])?\s+(.*)$/i
 * 
 * @param content The raw retain content
 * @param config The current synthesis configuration
 * @returns TaggedContent or null if no project tag is found
 */
export function parseTags(content: string, config: SynthConfig): TaggedContent | null {
  const regex = /^\s*\[project:([a-z0-9_-]+)\](?:\s+\[([a-z0-9_-]+)\])?\s+(.*)$/i;
  const match = content.match(regex);

  if (!match) {
    return null;
  }

  const [, rawProject, rawTopic, actualContent] = match;
  const project = rawProject.toLowerCase();
  let topic: string | null = null;

  if (rawTopic) {
    const t = rawTopic.toLowerCase();
    // Valid if it's an alias key or a canonical value
    if (config.topicAliases[t] || Object.values(config.topicAliases).includes(t)) {
      topic = t;
    }
  }

  return {
    project,
    topic,
    content: actualContent.trim(),
  };
}
