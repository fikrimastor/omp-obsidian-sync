import fs from "node:fs";
import path from "node:path";

export interface AppendBulletArgs {
  filePath: string;
  content: string;
  project: string;
  topic: string;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Reads existing bullets from a topic file (lines starting with "- ").
 */
function readBullets(filePath: string): string[] {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    // Split on frontmatter separator and get past-YAML content
    const parts = raw.split("---\n");
    if (parts.length < 3) return [];
    const body = parts.slice(2).join("---\n");
    return body.split("\n")
      .filter(l => l.startsWith("- "))
      .map(l => l.slice(2).trim());
  } catch {
    return [];
  }
}

function bulletAlreadyExists(bullets: string[], newContent: string): boolean {
  const needle = newContent.toLowerCase().trim();
  return bullets.some(b => b.toLowerCase().trim() === needle);
}

/**
 * Appends a dated frontmatter bullet to a topic file. Creates folder/file if
 * absent. Returns true if the bullet was written, false if duplicate.
 */
export function appendBullet(args: AppendBulletArgs): boolean {
  const { filePath, content, project, topic } = args;
  const existing = readBullets(filePath);

  if (bulletAlreadyExists(existing, content)) return false;

  const now = new Date();
  const frontmatter = [
    "---",
    `date: ${isoDate(now)}`,
    `project: ${project}`,
    `topic: ${topic}`,
    "source: retain",
    "---",
  ].join("\n");

  const bulletLine = `- ${content.trim()}`;
  const fullBody = [frontmatter, "", bulletLine, ...existing.map(b => `- ${b}`), ""].join("\n");

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, fullBody, "utf8");
  return true;
}
