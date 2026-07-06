import { test, expect, beforeAll, afterAll } from "bun:test";
import fs from "node:fs";

import path from "node:path";
import { resolveTargetDir, resolveProjectTopicPath, canonicalTopic } from "./route";

const VAULT = "/tmp/test-vault";
const REPOS = "/tmp/test-sites";

beforeAll(() => {
  fs.mkdirSync(path.join(REPOS, "groceries"), { recursive: true });
});

afterAll(() => {
  fs.rmSync(REPOS, { recursive: true, force: true });
});

test("routes project facts to a per-repo folder when cwd is nested in a repo", () => {
  const cwd = path.join(REPOS, "groceries", "app", "src");
  const result = resolveTargetDir(cwd, true, { vaultRoot: VAULT, reposRoot: REPOS });
  expect(result).toBe(path.join(VAULT, "groceries"));
});

test("routes project facts to a per-repo folder when cwd is exactly the repo root", () => {
  const cwd = path.join(REPOS, "groceries");
  const result = resolveTargetDir(cwd, true, { vaultRoot: VAULT, reposRoot: REPOS });
  expect(result).toBe(path.join(VAULT, "groceries"));
});

test("falls back to omp-learn/ for project facts outside a recognized repo root", () => {
  const cwd = "/tmp/somewhere-else";
  const result = resolveTargetDir(cwd, true, { vaultRoot: VAULT, reposRoot: REPOS });
  expect(result).toBe(path.join(VAULT, "omp-learn"));
});

test("routes general facts to omp-learn/ regardless of cwd", () => {
  const cwd = path.join(REPOS, "groceries");
  const result = resolveTargetDir(cwd, false, { vaultRoot: VAULT, reposRoot: REPOS });
  expect(result).toBe(path.join(VAULT, "omp-learn"));
});

test("does not treat a sibling dir with a shared prefix as inside the repo", () => {
  const cwd = path.join(REPOS, "groceries-clone");
  const result = resolveTargetDir(cwd, true, { vaultRoot: VAULT, reposRoot: REPOS });
  expect(result).toBe(path.join(VAULT, "omp-learn"));
});


test("resolveProjectTopicPath returns nested path under vault root", () => {
  expect(resolveProjectTopicPath("rph", "architecture", VAULT))
    .toBe(path.join(VAULT, "rph", "architecture.md"));
});

test("canonicalTopic resolves aliases and ignores case", () => {
  expect(canonicalTopic("arch")).toBe("architecture");
  expect(canonicalTopic("ARCH")).toBe("architecture");
  expect(canonicalTopic("unknown")).toBe("unknown");
});


test("resolveProjectTopicPath handles topic aliases", () => {
  expect(resolveProjectTopicPath("rph", "arch", VAULT))
    .toBe(path.join(VAULT, "rph", "architecture.md"));
});

