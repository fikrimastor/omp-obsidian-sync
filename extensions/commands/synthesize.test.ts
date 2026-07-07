import { test, expect, beforeEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { handleSynthesizeCommand } from "./synthesize";

import { SynthConfig } from "../lib/config";
import os from "node:os";
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

const baseConfig: SynthConfig = {
  vaultRoot: "/tmp",
  reposRoot: "/tmp",
  threshold: 3,
  llmProvider: null,
  llmModel: null,
  llmBaseUrl: null,
  llmApiKeyEnv: "OPENAI_API_KEY",
  legacyOmpLearnMirror: false,
  topicAliases: {},
};

test("setup subcommand runs the wizard and writes config to a tmp path (no real ~/.omp side effect)", () => {
  // Force the wizard to write to a tmp config path so the test does not
  // touch the user's real ~/.omp/omp-obsidian-sync.json.
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "synth-cmd-setup-"));
  const cfgPath = path.join(tmp, "omp-obsidian-sync.json");
  process.env.OMP_SYNC_CONFIG = cfgPath;
  // Clear the env-var path overrides so detection falls through to common/fallback.
  process.env.OMP_VAULT_ROOT = "";
  process.env.OMP_REPOS_ROOT = "";

  try {
    let printed: string[] = [];
    const pi = { note: (m: string) => printed.push(m) };
    const result = handleSynthesizeCommand({
      project: "setup",
      vaultRoot: "/tmp",
      config: baseConfig,
      pi,
      cwd: tmp,
      reply: "ok",
    });

    expect(result).toContain("Configured");
    expect(printed.length).toBe(1);
    // The wizard wrote the config to the tmp path, NOT the real ~/.omp/.
    expect(fs.existsSync(cfgPath)).toBe(true);
  } finally {
    delete process.env.OMP_SYNC_CONFIG;
    delete process.env.OMP_VAULT_ROOT;
    delete process.env.OMP_REPOS_ROOT;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("setup subcommand returns a skip message when no reply is given", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "synth-cmd-setup-skip-"));
  process.env.OMP_SYNC_CONFIG = path.join(tmp, "omp-obsidian-sync.json");
  process.env.OMP_VAULT_ROOT = "";
  process.env.OMP_REPOS_ROOT = "";

  try {
    const pi = { note: (_m: string) => {} };
    const result = handleSynthesizeCommand({
      project: "setup",
      vaultRoot: "/tmp",
      config: baseConfig,
      pi,
      cwd: tmp,
    });
    expect(result).toContain("skipped");
  } finally {
    delete process.env.OMP_SYNC_CONFIG;
    delete process.env.OMP_VAULT_ROOT;
    delete process.env.OMP_REPOS_ROOT;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
