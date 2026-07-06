import { test, expect, beforeEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { handleSynthesizeCommand } from "./synthesize";

let vaultRoot: string;
beforeEach(() => {
  vaultRoot = fs.mkdtempSync("/tmp/cmd-synth-");
  fs.mkdirSync(path.join(vaultRoot, "rph"), { recursive: true });
  fs.writeFileSync(path.join(vaultRoot, "rph", "architecture.md"),
    "---\ndate: 2026-07-06\nproject: rph\ntopic: architecture\n---\n\n- fact a\n- fact b\n- fact a\n- fact c\n");
});

test("synthesize project runs Pass 1+2 and returns summary", () => {
  const result = handleSynthesizeCommand({ project: "rph", vaultRoot });
  expect(result).toContain("Synthesized rph");
  // Check dedup happened
  const text = fs.readFileSync(path.join(vaultRoot, "rph", "architecture.md"), "utf8");
  const count = (text.match(/- fact a/g) || []).length;
  expect(count).toBe(1);
});

test("synthesize status returns pending counts", () => {
  const statePath = path.join(vaultRoot, ".omp-state.json");
  fs.writeFileSync(statePath, JSON.stringify({ rph: 2, aii: 1 }));
  
  const result = handleSynthesizeCommand({ project: "status", vaultRoot });
  expect(result).toContain("rph: 2 pending");
  expect(result).toContain("aii: 1 pending");
});

test("synthesize status returns empty when no pending", () => {
  const statePath = path.join(vaultRoot, ".omp-state.json");
  fs.writeFileSync(statePath, JSON.stringify({}));
  
  const result = handleSynthesizeCommand({ project: "status", vaultRoot });
  expect(result).toBe("No pending projects. All caught up.");
});

test("synthesize all synthesizes pending projects", () => {
  fs.mkdirSync(path.join(vaultRoot, "aii"), { recursive: true });
  fs.writeFileSync(path.join(vaultRoot, "aii", "index.md"),
    "---\ndate: 2026-07-06\nproject: aii\ntopic: index\n---\n\n- fact x\n- fact x\n");
  
  const statePath = path.join(vaultRoot, ".omp-state.json");
  fs.writeFileSync(statePath, JSON.stringify({ rph: 1, aii: 1 }));
  
  const result = handleSynthesizeCommand({ project: "all", vaultRoot });
  expect(result).toContain("rph: synthesized");
  expect(result).toContain("aii: synthesized");
  
  const text = fs.readFileSync(path.join(vaultRoot, "aii", "index.md"), "utf8");
  const count = (text.match(/- fact x/g) || []).length;
  expect(count).toBe(1);
});
