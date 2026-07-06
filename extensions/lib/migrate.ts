import fs from "node:fs";
import path from "node:path";
import { classifyTopic } from "./topic";
import { appendBullet } from "./append-note";

export interface MigrateSummary {
  filesProcessed: number;
  bulletsMigrated: number;
  bulletsSkipped: number;
}

/**
 * Migrates legacy omp-learn notes to topic-based files in the vault.
 * 
 * Reads ~/Notes/omp-learn/omp-learn-*.md
 * Classifies bullets via classifyTopic
 * Emits to ~/Notes/misc/<topic>.md
 */
export function migrateLegacyNotes(vaultRoot: string): MigrateSummary {
  const legacyDir = path.join(vaultRoot, "omp-learn");
  const miscDir = path.join(vaultRoot, "misc");

  if (!fs.existsSync(legacyDir)) {
    return { filesProcessed: 0, bulletsMigrated: 0, bulletsSkipped: 0 };
  }

  const summary: MigrateSummary = {
    filesProcessed: 0,
    bulletsMigrated: 0,
    bulletsSkipped: 0,
  };

  const files = fs.readdirSync(legacyDir).filter(f => f.startsWith("omp-learn-") && f.endsWith(".md"));

  for (const file of files) {
    summary.filesProcessed++;
    const content = fs.readFileSync(path.join(legacyDir, file), "utf8");
    const lines = content.split("\n");

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      
      // Only migrate lines starting with bullet markers
      if (!trimmed.startsWith("- ") && !trimmed.startsWith("* ")) continue;

      const bulletContent = trimmed.slice(2).trim();
      if (!bulletContent) continue;

      const topic = classifyTopic(bulletContent);
      const targetPath = path.join(miscDir, `${topic}.md`);

      const success = appendBullet({
        filePath: targetPath,
        content: bulletContent,
        project: "legacy",
        topic: topic,
      });

      if (success) {
        summary.bulletsMigrated++;
      } else {
        summary.bulletsSkipped++;
      }
    }
  }

  return summary;
}
