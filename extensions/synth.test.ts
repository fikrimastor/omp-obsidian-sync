import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { handleRetain } from "./synth";
import { loadConfig, SynthConfig } from "./lib/config";
import { needsSetup, configPathFor } from "./lib/setup";

// Mock the vault for testing
const MOCK_VAULT = path.join(process.cwd(), "test-vault");

describe("handleRetain", () => {
  beforeEach(() => {
    if (fs.existsSync(MOCK_VAULT)) {
      fs.rmSync(MOCK_VAULT, { recursive: true, force: true });
    }
    fs.mkdirSync(MOCK_VAULT, { recursive: true });
  });

  afterEach(() => {
    if (fs.existsSync(MOCK_VAULT)) {
      fs.rmSync(MOCK_VAULT, { recursive: true, force: true });
    }
  });

  test("ignores facts without [project] tags and logs to audit", () => {
    const event = {
      toolName: "retain",
      input: { items: [{ content: "Just a general fact" }] },
      cwd: process.cwd(),
    };
    
    handleRetain(event, { vaultRoot: MOCK_VAULT });

    const auditLog = fs.readFileSync(path.join(MOCK_VAULT, ".omp-audit.log"), "utf8");
    expect(auditLog).toContain("fact (general): Just a general fact");
    
    // No project folders should be created
    const dirs = fs.readdirSync(MOCK_VAULT).filter(d => d !== ".omp-audit.log" && d !== ".omp-state.json");
    expect(dirs.length).toBe(0);
  });

  test("processes project facts with explicit topic", () => {
    const event = {
      toolName: "retain",
      input: { items: [{ content: "[project:test-repo] [arch] Architecture is cool" }] },
      cwd: process.cwd(),
    };

    handleRetain(event, { vaultRoot: MOCK_VAULT });

    const filePath = path.join(MOCK_VAULT, "test-repo", "architecture.md");
    expect(fs.existsSync(filePath)).toBe(true);
    const content = fs.readFileSync(filePath, "utf8");
    expect(content).toContain("- Architecture is cool");
  });

  test("classifies topic when [topic] tag is missing", () => {
    const event = {
      toolName: "retain",
      input: { items: [{ content: "[project:test-repo] This is a bug fix" }] },
      cwd: process.cwd(),
    };

    handleRetain(event, { vaultRoot: MOCK_VAULT });

    const filePath = path.join(MOCK_VAULT, "test-repo", "bugs.md");
    expect(fs.existsSync(filePath)).toBe(true);
    const content = fs.readFileSync(filePath, "utf8");
    expect(content).toContain("- This is a bug fix");
  });

  test("triggers synthesis when threshold is reached", () => {
    const threshold = 2;
    const event = {
      toolName: "retain",
      input: { 
        items: [
          { content: "[project:synth-repo] [arch] Fact 1" },
          { content: "[project:synth-repo] [arch] Fact 2" }
        ] 
      },
      cwd: process.cwd(),
    };

    // Set threshold to 2 and process 2 facts
    handleRetain(event, { vaultRoot: MOCK_VAULT, threshold });

    const state = JSON.parse(fs.readFileSync(path.join(MOCK_VAULT, ".omp-state.json"), "utf8"));
    // synthesize.ts resets pending to 0 after successful run
    expect(state["synth-repo"]).toBe(0);
    
    const auditLog = fs.readFileSync(path.join(MOCK_VAULT, ".omp-audit.log"), "utf8");
    expect(auditLog).toContain("synthesis synth-repo");
  });

  test("logs duplicates to audit log", () => {
    const event = {
      toolName: "retain",
      input: { 
        items: [
          { content: "[project:dup-repo] [arch] Duplicate" },
          { content: "[project:dup-repo] [arch] Duplicate" }
        ] 
      },
      cwd: process.cwd(),
    };

    handleRetain(event, { vaultRoot: MOCK_VAULT });

    const auditLog = fs.readFileSync(path.join(MOCK_VAULT, ".omp-audit.log"), "utf8");
    expect(auditLog).toContain("fact (dup): [dup-repo] Duplicate");
  });

  test("handles 'learn' tool input", () => {
    const event = {
      toolName: "learn",
      input: { memory: "[project:learn-repo] [tech] Learned something new" },
      cwd: process.cwd(),
    };

    handleRetain(event, { vaultRoot: MOCK_VAULT });

    const filePath = path.join(MOCK_VAULT, "learn-repo", "tech-stack.md");
    expect(fs.existsSync(filePath)).toBe(true);
  });

  test("first-run gate: audits a setup-skipped line under the config dir and writes no project file", () => {
    // MOCK_VAULT is a fresh tmp dir per test.
    process.env.OMP_SYNC_CONFIG = path.join(MOCK_VAULT, "omp-obsidian-sync.json");
    process.env.OMP_VAULT_ROOT = "";
    process.env.OMP_REPOS_ROOT = "";
    expect(needsSetup()).toBe(true);

    const event = {
      toolName: "retain",
      input: { items: [{ content: "[project:rph] [arch] uses Encore" }], i: "x" },
      cwd: MOCK_VAULT,
    };
    // No opts override → expect the gate to skip + audit.
    handleRetain(event);

    // Audit log under the config dir.
    const auditPath = path.join(path.dirname(configPathFor()), ".omp-audit.log");
    expect(fs.existsSync(auditPath)).toBe(true);
    const audit = fs.readFileSync(auditPath, "utf8");
    expect(audit).toContain("setup skipped");

    // No project file written.
    const written = fs.readdirSync(MOCK_VAULT).filter((f) => !f.startsWith(".omp-"));
    expect(written.length).toBe(0);

    delete process.env.OMP_SYNC_CONFIG;
    delete process.env.OMP_VAULT_ROOT;
    delete process.env.OMP_REPOS_ROOT;
  });
});
