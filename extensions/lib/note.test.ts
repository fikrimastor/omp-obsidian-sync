import { test, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { nextNoteId, writeNote } from "./note";

let vaultRoot: string;

beforeEach(() => {
  vaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vault-test-"));
});

afterEach(() => {
  fs.rmSync(vaultRoot, { recursive: true, force: true });
});

test("nextNoteId returns 1 for an empty vault", () => {
  expect(nextNoteId(vaultRoot)).toBe(1);
});

test("nextNoteId scans recursively across all subfolders for the global max", () => {
  const generalDir = path.join(vaultRoot, "omp-learn");
  const repoDir = path.join(vaultRoot, "groceries");
  fs.mkdirSync(generalDir, { recursive: true });
  fs.mkdirSync(repoDir, { recursive: true });
  fs.writeFileSync(path.join(generalDir, "omp-learn-0003.md"), "x");
  fs.writeFileSync(path.join(repoDir, "omp-learn-0007.md"), "x");
  expect(nextNoteId(vaultRoot)).toBe(8);
});

test("nextNoteId ignores non-matching filenames", () => {
  const generalDir = path.join(vaultRoot, "omp-learn");
  fs.mkdirSync(generalDir, { recursive: true });
  fs.writeFileSync(path.join(generalDir, "omp-learn-0003.md"), "x");
  fs.writeFileSync(path.join(generalDir, "notes.md"), "x");
  fs.writeFileSync(path.join(generalDir, "omp-learn-abc.md"), "x");
  expect(nextNoteId(vaultRoot)).toBe(4);
});

test("writeNote creates the target dir, writes frontmatter, and returns the path", () => {
  const targetDir = path.join(vaultRoot, "omp-learn");
  const now = new Date("2026-07-03T12:00:00Z");
  const written = writeNote(vaultRoot, targetDir, "user prefers terse replies", "retain", now);

  expect(written).toBe(path.join(targetDir, "omp-learn-0001.md"));
  const body = fs.readFileSync(written, "utf8");
  expect(body).toContain("date: 2026-07-03");
  expect(body).toContain("tool: retain");
  expect(body).toContain("tags: [omp-learn]");
  expect(body).toContain("user prefers terse replies");
  expect(body).toContain("#omp-learn");
});

test("writeNote continues the global sequence across folders", () => {
  const generalDir = path.join(vaultRoot, "omp-learn");
  fs.mkdirSync(generalDir, { recursive: true });
  fs.writeFileSync(path.join(generalDir, "omp-learn-0007.md"), "x");

  const repoDir = path.join(vaultRoot, "groceries");
  const written = writeNote(vaultRoot, repoDir, "uses pgvector", "learn", new Date());

  expect(written).toBe(path.join(repoDir, "omp-learn-0008.md"));
});
