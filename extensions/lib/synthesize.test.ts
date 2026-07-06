import { test, expect, beforeEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { runSynthesis } from "./synthesize";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync("/tmp/synth-test-");
});

test("dedup (Pass 1) removes duplicate bullets", () => {
  const archPath = path.join(dir, "rph", "architecture.md");
  fs.mkdirSync(path.dirname(archPath), { recursive: true });
  const bullet = "- duplicate";
  fs.writeFileSync(archPath,
    "---\ndate: 2026-07-06\nproject: rph\ntopic: architecture\n---\n\n" + bullet + "\n" + bullet + "\n",
    "utf8");
  runSynthesis("rph", dir, { threshold: 3 } as any);
  const text = fs.readFileSync(archPath, "utf8");
  const count = (text.match(/- duplicate/g) || []).length;
  expect(count).toBe(1);
});

test("Pass 3 is skipped when llmProvider is null (no error)", () => {
  const archPath = path.join(dir, "rph", "architecture.md");
  fs.mkdirSync(path.dirname(archPath), { recursive: true });
  fs.writeFileSync(archPath,
    "---\ndate: 2026-07-06\nproject: rph\ntopic: architecture\n---\n\n- fact",
    "utf8");
  runSynthesis("rph", dir, { llmProvider: null, threshold: 3 } as any);
  // No exception = pass
});

test("audit log is written after synthesis", () => {
  const archPath = path.join(dir, "rph", "architecture.md");
  fs.mkdirSync(path.dirname(archPath), { recursive: true });
  fs.writeFileSync(archPath,
    "---\ndate: 2026-07-06\nproject: rph\ntopic: architecture\n---\n\n- fact a\n- fact b",
    "utf8");
  runSynthesis("rph", dir, { llmProvider: null, threshold: 3 } as any);
  const auditPath = path.join(dir, ".omp-audit.log");
  expect(fs.existsSync(auditPath)).toBe(true);
  expect(fs.readFileSync(auditPath, "utf8")).toContain("synthesis rph:");
});
