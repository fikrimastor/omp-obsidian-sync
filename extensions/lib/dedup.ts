export function dedupBullets(bullets: string[], minWordShare?: number): string[] {
  if (!bullets || bullets.length === 0) return [];

  const result: string[] = [];
  const threshold = minWordShare ?? 0.2;

  for (const bullet of bullets) {
    let isDuplicate = false;

    for (const kept of result) {
      // 1. Exact match
      if (bullet === kept) {
        isDuplicate = true;
        break;
      }

      // 2. First 4 words match
      const bWords = bullet.trim().split(/\s+/);
      const kWords = kept.trim().split(/\s+/);
      if (bWords.length >= 4 && kWords.length >= 4) {
        if (bWords.slice(0, 4).every((w, i) => w === kWords[i])) {
          isDuplicate = true;
          break;
        }
      }

      // 3. Levenshtein distance threshold
      const dist = levenshteinDistance(bullet, kept);
      const maxLen = Math.max(bullet.length, kept.length);
      if (maxLen > 0 && dist / maxLen <= threshold) {
        isDuplicate = true;
        break;
      }
    }

    if (!isDuplicate) {
      result.push(bullet);
    }
  }

  return result;
}

export function findPromotables(fileContents: Record<string, string[]>): string[] {
  const seenFiles = new Map<string, Set<string>>();

  for (const [fileName, bullets] of Object.entries(fileContents)) {
    for (const bullet of bullets) {
      const trimmed = bullet.trim();
      if (!trimmed) continue;

      if (!seenFiles.has(trimmed)) {
        seenFiles.set(trimmed, new Set());
      }
      seenFiles.get(trimmed)!.add(fileName);
    }
  }

  const promotables: string[] = [];
  for (const [bullet, files] of seenFiles.entries()) {
    if (files.size > 1) {
      promotables.push(bullet);
    }
  }

  return promotables;
}

function levenshteinDistance(a: string, b: string): number {
  const matrix = [];

  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }

  return matrix[b.length][a.length];
}
