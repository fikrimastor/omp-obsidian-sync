import fs from "node:fs";
import path from "node:path";

const NOTE_PATTERN = /^omp-learn-(\d{4,})\.md$/;

/**
 * Recursively scans vaultRoot for every omp-learn-NNNN.md file and returns the
 * next id in the single global sequence (max + 1, or 1 if the vault has none yet).
 * This is the only source of truth for numbering — no separate counter file.
 */
export function nextNoteId(vaultRoot: string): number {
  let max = 0;

  function walk(dir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        const match = entry.name.match(NOTE_PATTERN);
        if (match) {
          const n = parseInt(match[1], 10);
          if (n > max) max = n;
        }
      }
    }
  }

  walk(vaultRoot);
  return max + 1;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Writes one markdown note into targetDir using the next global sequential id
 * (computed by scanning vaultRoot, not targetDir, so numbering stays unique across
 * every folder in the vault). Creates targetDir if it doesn't exist. Returns the
 * absolute path written.
 */
export function writeNote(
  vaultRoot: string,
  targetDir: string,
  content: string,
  toolName: "retain" | "learn",
  now: Date = new Date(),
): string {
  fs.mkdirSync(targetDir, { recursive: true });
  const id = nextNoteId(vaultRoot);
  const filename = `omp-learn-${String(id).padStart(4, "0")}.md`;
  const filePath = path.join(targetDir, filename);

  const body = [
    "---",
    `date: ${isoDate(now)}`,
    `tool: ${toolName}`,
    "tags: [omp-learn]",
    "---",
    content,
    "",
    "#omp-learn",
    "",
  ].join("\n");

  fs.writeFileSync(filePath, body, "utf8");
  return filePath;
}
