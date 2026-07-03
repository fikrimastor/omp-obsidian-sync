import { test, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { handleToolResult } from "./sync";

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
