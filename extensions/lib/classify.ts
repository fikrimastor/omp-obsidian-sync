const PROJECT_PREFIX = "[project]";

/**
 * Business-logic classification is explicit, not inferred: content must start
 * with the literal "[project]" marker. The prefix is stripped from the returned
 * content regardless of classification result checks elsewhere.
 */
export function classify(content: string): { isProject: boolean; content: string } {
  if (content.startsWith(PROJECT_PREFIX)) {
    return {
      isProject: true,
      content: content.slice(PROJECT_PREFIX.length).trimStart(),
    };
  }
  return { isProject: false, content };
}
