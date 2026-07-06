
export interface TagParse {
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
 * @returns TagParse or null if no project tag is found
 */
export function parseTags(content: string): TagParse | null {
  const KNOWN_TOPICS = ["arch", "architecture", "bug", "bugs", "conv", "conventions", "wf", "workflow", "tech", "tech-stack", "tech_stack", "dec", "decisions", "uncategorized"];
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
    if (KNOWN_TOPICS.includes(t)) {
      topic = t;
    }
  }

  return {
    project,
    topic,
    content: actualContent.trim(),
  };
}
