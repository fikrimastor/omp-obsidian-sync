import { expect, test, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { migrateLegacyNotes } from "./migrate";

const TEST_VAULT = path.join(os.tmpdir(), `vault-migrate-${Math.random().toString(36).slice(2)}`);
const LEGACY_DIR = path.join(TEST_VAULT, "omp-learn");
const MISC_DIR = path.join(TEST_VAULT, "misc");

beforeEach(() => {
  if (fs.existsSync(TEST_VAULT)) fs.rmSync(TEST_VAULT, { recursive: true, force: true });
  fs.mkdirSync(LEGACY_DIR, { recursive: true });
  // MISC_DIR should NOT be created here to test automatic creation
});

afterEach(() => {
  if (fs.existsSync(TEST_VAULT)) fs.rmSync(TEST_VAULT, { recursive: true, force: true });
});

test("migrates bullets from legacy notes and classifies topics", () => {
  const legacyFile = path.join(LEGACY_DIR, "omp-learn-1.md");
  const content = `---
date: 2023-01-01
---
# Legacy Notes
This is a heading.

- uses Encore auth handlers
- fixed the N+1 query error
- always guard on runtime config key
- random note that is uncategorized

Not a bullet.
`;
  fs.writeFileSync(legacyFile, content);

  const summary = migrateLegacyNotes(TEST_VAULT);

  expect(summary.filesProcessed).toBe(1);
  expect(summary.bulletsMigrated).toBe(4);

  // Verify targets
  expect(fs.existsSync(path.join(MISC_DIR, "architecture.md"))).toBe(true);
  expect(fs.existsSync(path.join(MISC_DIR, "bugs.md"))).toBe(true);
  expect(fs.existsSync(path.join(MISC_DIR, "conventions.md"))).toBe(true);
  expect(fs.existsSync(path.join(MISC_DIR, "uncategorized.md"))).toBe(true);

  const archContent = fs.readFileSync(path.join(MISC_DIR, "architecture.md"), "utf8");
  expect(archContent).toContain("---");
  expect(archContent).toContain("- uses Encore auth handlers");
});

test("skips non-bullet lines and duplicates", () => {
  const legacyFile = path.join(LEGACY_DIR, "omp-learn-1.md");
  const content = `
- always guard on runtime config key
- always guard on runtime config key
`;
  fs.writeFileSync(legacyFile, content);

  const summary = migrateLegacyNotes(TEST_VAULT);

  expect(summary.bulletsMigrated).toBe(1);
  expect(summary.bulletsSkipped).toBe(1);
});

test("handles empty legacy directory", () => {
  const summary = migrateLegacyNotes(TEST_VAULT);
  expect(summary.filesProcessed).toBe(0);
  expect(summary.bulletsMigrated).toBe(0);
});
