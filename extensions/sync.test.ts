import { test, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { handleToolResult } from "./sync";

import { needsSetup, configPathFor } from "./lib/setup";

let vaultRoot: string;
let reposRoot: string;
let errorLogPath: string;

beforeEach(() => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "sync-test-"));
  vaultRoot = path.join(base, "vault");
  reposRoot = path.join(base, "sites");
  errorLogPath = path.join(base, "sync-errors.log");
  fs.mkdirSync(vaultRoot, { recursive: true });
  fs.mkdirSync(reposRoot, { recursive: true });
});

afterEach(() => {
  fs.rmSync(path.dirname(vaultRoot), { recursive: true, force: true });
});

test("writes a general note for a plain retain call", () => {
  handleToolResult(
    { toolName: "retain", input: { items: [{ content: "general fact" }], i: "x" } },
    { cwd: reposRoot, vaultRoot, reposRoot, errorLogPath },
  );
  const file = path.join(vaultRoot, "omp-learn", "omp-learn-0001.md");
  expect(fs.existsSync(file)).toBe(true);
  expect(fs.readFileSync(file, "utf8")).toContain("general fact");
});

test("routes a [project]-prefixed fact into the repo folder and strips the prefix", () => {
  const cwd = path.join(reposRoot, "groceries");
  fs.mkdirSync(cwd, { recursive: true });
  handleToolResult(
    { toolName: "retain", input: { items: [{ content: "[project] uses pgvector" }], i: "x" } },
    { cwd, vaultRoot, reposRoot, errorLogPath },
  );
  const file = path.join(vaultRoot, "groceries", "omp-learn-0001.md");
  expect(fs.existsSync(file)).toBe(true);
  const body = fs.readFileSync(file, "utf8");
  expect(body).toContain("uses pgvector");
  expect(body).not.toContain("[project]");
});

test("falls back to omp-learn/ for a [project] fact outside a recognized repo", () => {
  const outsideCwd = path.join(path.dirname(reposRoot), "elsewhere");
  fs.mkdirSync(outsideCwd, { recursive: true });
  handleToolResult(
    { toolName: "retain", input: { items: [{ content: "[project] stray fact" }], i: "x" } },
    { cwd: outsideCwd, vaultRoot, reposRoot, errorLogPath },
  );
  const file = path.join(vaultRoot, "omp-learn", "omp-learn-0001.md");
  expect(fs.existsSync(file)).toBe(true);
});

test("writes one note per item in a multi-item retain call", () => {
  handleToolResult(
    {
      toolName: "retain",
      input: { items: [{ content: "fact a" }, { content: "fact b" }], i: "x" },
    },
    { cwd: reposRoot, vaultRoot, reposRoot, errorLogPath },
  );
  expect(fs.existsSync(path.join(vaultRoot, "omp-learn", "omp-learn-0001.md"))).toBe(true);
  expect(fs.existsSync(path.join(vaultRoot, "omp-learn", "omp-learn-0002.md"))).toBe(true);
});

test("ignores unrelated tool names without writing or logging", () => {
  handleToolResult(
    { toolName: "read", input: { path: "x" } },
    { cwd: reposRoot, vaultRoot, reposRoot, errorLogPath },
  );
  expect(fs.existsSync(vaultRoot) && fs.readdirSync(vaultRoot).length).toBe(0);
  expect(fs.existsSync(errorLogPath)).toBe(false);
});

test("logs and skips malformed retain input without writing a note", () => {
  handleToolResult(
    { toolName: "retain", input: { i: "x" } },
    { cwd: reposRoot, vaultRoot, reposRoot, errorLogPath },
  );
  expect(fs.readdirSync(vaultRoot).length).toBe(0);
  expect(fs.existsSync(errorLogPath)).toBe(true);
  expect(fs.readFileSync(errorLogPath, "utf8")).toContain("retain");
});

test("never throws even when input is completely malformed", () => {
  expect(() =>
    handleToolResult(
      { toolName: "retain", input: null },
      { cwd: reposRoot, vaultRoot, reposRoot, errorLogPath },
    ),
  ).not.toThrow();
});

test("first-run gate: audits a setup-skipped line under the config dir and does not write to the error log", () => {
  const unconfiguredTmp = fs.mkdtempSync(path.join(os.tmpdir(), "sync-unconfigured-"));
  const cfgPath = path.join(unconfiguredTmp, "omp-obsidian-sync.json");
  process.env.OMP_SYNC_CONFIG = cfgPath;
  process.env.OMP_VAULT_ROOT = "";
  process.env.OMP_REPOS_ROOT = "";

  expect(needsSetup()).toBe(true);

  const errorLogPath = path.join(unconfiguredTmp, "sync-errors.log");
  const event = {
    toolName: "retain",
    input: { items: [{ content: "fallback fact" }], i: "x" },
  };
  handleToolResult(event, { cwd: reposRoot, errorLogPath });

  // Audit log written next to the config.
  const auditPath = path.join(path.dirname(cfgPath), ".omp-audit.log");
  expect(fs.existsSync(auditPath)).toBe(true);
  const auditBody = fs.readFileSync(auditPath, "utf8");
  expect(auditBody).toContain("setup skipped");
  expect(auditBody).toContain("fallback fact");

  // Error log NOT written — the gate short-circuits.
  expect(fs.existsSync(errorLogPath)).toBe(false);

  delete process.env.OMP_SYNC_CONFIG;
  delete process.env.OMP_VAULT_ROOT;
  delete process.env.OMP_REPOS_ROOT;
  fs.rmSync(unconfiguredTmp, { recursive: true, force: true });
});

test("first-run gate: still bypasses when opts.vaultRoot is given (test override path)", () => {
  // The gate condition is `needsSetup() && !opts.vaultRoot` — when a test
  // passes an explicit vaultRoot, the handler must run normally.
  const unconfiguredTmp = fs.mkdtempSync(path.join(os.tmpdir(), "sync-unconfigured-bypass-"));
  process.env.OMP_SYNC_CONFIG = path.join(unconfiguredTmp, "omp-obsidian-sync.json");
  process.env.OMP_VAULT_ROOT = "";
  process.env.OMP_REPOS_ROOT = "";

  const errorLogPath = path.join(unconfiguredTmp, "sync-errors.log");
  handleToolResult(
    { toolName: "retain", input: { items: [{ content: "general fact" }], i: "x" } },
    { cwd: reposRoot, vaultRoot, reposRoot, errorLogPath },
  );
  expect(fs.existsSync(path.join(unconfiguredTmp, ".omp-audit.log"))).toBe(false);
  expect(fs.existsSync(path.join(vaultRoot, "omp-learn", "omp-learn-0001.md"))).toBe(true);
  // No audit-skip log written.

  delete process.env.OMP_SYNC_CONFIG;
  delete process.env.OMP_VAULT_ROOT;
  delete process.env.OMP_REPOS_ROOT;
  fs.rmSync(unconfiguredTmp, { recursive: true, force: true });
});
