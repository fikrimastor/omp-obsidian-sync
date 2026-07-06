import fs from "node:fs";
import path from "node:path";
import { dedupBullets, findPromotables } from "./dedup";
import { auditLog } from "./audit";
import { readState, writeState, resetPending } from "./state";
import type { SynthConfig } from "./config";

/**
 * Reads all bullet lines from a topic file (frontmatter-stripped).
 */
function readBullets(filePath: string): string[] | null {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parts = raw.split("---\n");
    if (parts.length < 3) return null;
    const body = parts.slice(2).join("---\n");
    return body.split("\n").filter(l => l.startsWith("- ")).map(l => l.slice(2).trim());
  } catch { return null; }
}

function writeBullets(filePath: string, bullets: string[], frontmatter: string): void {
  const body = [frontmatter, "", ...bullets.map(b => `- ${b}`), ""].join("\n");
  fs.writeFileSync(filePath, body, "utf8");
}

function readFrontmatter(filePath: string): string | null {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parts = raw.split("---\n");
    if (parts.length < 3) return null;
    return parts.slice(0, 2).join("---\n");
  } catch { return null; }
}

/**
 * Orchestrates Pass 1 (dedup) and Pass 2 (promote) for a project.
 * Called from the hot path (synchronous) and from /synthesize command.
 * Never throws — all errors are logged to audit log.
 */
export function runSynthesis(
  project: string,
  vaultRoot: string,
  config: SynthConfig,
): void {
  try {
    const projectDir = path.join(vaultRoot, project);
    let allFiles: string[];
    try {
      allFiles = fs.readdirSync(projectDir, { withFileTypes: true })
        .filter(d => d.isFile() && d.name.endsWith(".md"))
        .map(d => path.join(projectDir, d.name));
    } catch {
      // Project dir doesn't exist — nothing to synthesize
      return;
    }

    // Pass 1: Dedup within each topic file
    let totalDeduped = 0;
    for (const fp of allFiles) {
      const bullets = readBullets(fp);
      if (!bullets) continue;
      const fm = readFrontmatter(fp);
      if (!fm) continue;
      const deduped = dedupBullets(bullets);
      const removed = bullets.length - deduped.length;
      if (removed > 0) {
        totalDeduped += removed;
        writeBullets(fp, deduped, fm);
      }
    }

    // Pass 2: Promote cross-cutting facts
    const fileContents: Record<string, string[]> = {};
    for (const fp of allFiles) {
      const bullets = readBullets(fp);
      if (bullets) fileContents[fp] = bullets;
    }
    const promotables = findPromotables(fileContents);
    let totalPromoted = 0;
    if (promotables.length > 0) {
      const promotedPath = path.join(projectDir, "_promoted.md");
      const promotedFm = readFrontmatter(promotedPath)
        ?? `---\ndate: ${new Date().toISOString().slice(0, 10)}\nproject: ${project}\ntopic: promoted\nsource: synthesis\n---`;
      for (const fp of allFiles) {
        const bullets = readBullets(fp);
        if (!bullets) continue;
        const filtered = bullets.filter(b => {
          const isPromotable = promotables.some(p => b.toLowerCase().trim() === p);
          if (isPromotable) totalPromoted++;
          return !isPromotable;
        });
        if (filtered.length !== bullets.length) {
          const fm = readFrontmatter(fp) ?? promotedFm;
          writeBullets(fp, filtered, fm);
        }
      }
      const existingPromoted = readBullets(promotedPath) ?? [];
      const dedupedPromoted = dedupBullets([...promotables, ...existingPromoted]);
      writeBullets(promotedPath, dedupedPromoted, promotedFm);
    }

    // Audit
    auditLog(vaultRoot, `synthesis ${project}: dedup=${totalDeduped}, promoted=${totalPromoted}, llm=skipped`);

    // Reset pending count
    const state = readState(vaultRoot);
    writeState(vaultRoot, resetPending(state, project));
  } catch (err) {
    auditLog(vaultRoot, `synthesis ${project} failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
