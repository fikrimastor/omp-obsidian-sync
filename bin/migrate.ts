#!/usr/bin/env bun
// bin/migrate.ts — one-shot legacy note migrator. Reads ~/.omp/omp-obsidian-sync.json
// (or OMP_SYNC_CONFIG) via loadConfig(). For new CLIs, prefer loadConfigOrDetect(cwd)
// so the first-run detection is honored.

import path from "node:path";
import fs from "node:fs";
import readline from "node:readline";
import { loadConfig } from "../extensions/lib/config";
import { migrateLegacyNotes } from "../extensions/lib/migrate";

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

async function main() {
  const args = process.argv.slice(2);
  const autoConfirm = args.includes("--yes") || args.includes("-y");

  console.log("🚀 Starting legacy notes migration...");
  
  const config = loadConfig();
  const summary = migrateLegacyNotes(config.vaultRoot);

  console.log("\nMigration Summary:");
  console.log(`- Files processed: ${summary.filesProcessed}`);
  console.log(`- Bullets migrated: ${summary.bulletsMigrated}`);
  console.log(`- Bullets skipped (dupes): ${summary.bulletsSkipped}`);

  if (summary.bulletsMigrated === 0 && summary.bulletsSkipped === 0) {
    console.log("\nNo bullets to migrate. Exiting.");
    rl.close();
    process.exit(0);
  }

  let shouldDelete = autoConfirm;
  if (!shouldDelete) {
    const answer = await new Promise<string>((resolve) => {
      rl.question("\nDo you want to delete the legacy omp-learn files? (y/N): ", resolve);
    });
    shouldDelete = answer.toLowerCase() === "y";
  }

  if (shouldDelete) {
    const legacyDir = path.join(config.vaultRoot, "omp-learn");
    const files = fs.readdirSync(legacyDir).filter(f => f.startsWith("omp-learn-") && f.endsWith(".md"));
    
    for (const file of files) {
      fs.unlinkSync(path.join(legacyDir, file));
    }
    console.log(`Deleted ${files.length} legacy files.`);
  } else {
    console.log("Legacy files preserved.");
  }

  rl.close();
}

main().catch(err => {
  console.error("Fatal error during migration:", err);
  process.exit(1);
});
