import { test, expect, describe, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  detectVault,
  detectReposRoot,
  parseSetupReply,
  configPathFor,
  needsSetup,
  writeConfig,
} from "./setup";

function mkTmp(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

describe("detectVault", () => {
  let home: string;
  let cwd: string;

  beforeEach(() => {
    home = mkTmp("setup-home-");
    cwd = mkTmp("setup-cwd-");
    // Point os.homedir() at the fake home for these tests by setting HOME.
    process.env.HOME = home;
    process.env.OMP_VAULT_ROOT = "";
    process.env.OMP_REPOS_ROOT = "";
  });

  afterEach(() => {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  test("returns env var when OMP_VAULT_ROOT is set", () => {
    process.env.OMP_VAULT_ROOT = "/custom/vault";
    const r = detectVault(cwd);
    expect(r.source).toBe("env");
    expect(r.path).toBe("/custom/vault");
  });

  test("walks up to find .obsidian directory", () => {
    const vault = path.join(cwd, "with-obsidian");
    fs.mkdirSync(path.join(vault, ".obsidian"), { recursive: true });
    const subdir = path.join(vault, "sub", "nested");
    fs.mkdirSync(subdir, { recursive: true });
    const r = detectVault(subdir);
    expect(r.source).toBe("cwd");
    expect(r.path).toBe(vault);
  });

  test("finds ~/Notes in common spots", () => {
    const notes = path.join(home, "Notes");
    fs.mkdirSync(notes, { recursive: true });
    const r = detectVault(cwd);
    expect(r.source).toBe("common");
    expect(r.path).toBe(notes);
  });

  test("finds ~/Obsidian in common spots", () => {
    const obs = path.join(home, "Obsidian");
    fs.mkdirSync(obs, { recursive: true });
    const r = detectVault(cwd);
    expect(r.source).toBe("common");
    expect(r.path).toBe(obs);
  });

  test("falls back to ~/Notes when nothing matches", () => {
    const r = detectVault(cwd);
    expect(r.source).toBe("fallback");
    expect(r.path).toBe(path.join(home, "Notes"));
  });
});

describe("detectReposRoot", () => {
  let home: string;
  let cwd: string;

  beforeEach(() => {
    home = mkTmp("setup-home-");
    cwd = mkTmp("setup-cwd-");
    process.env.HOME = home;
    process.env.OMP_VAULT_ROOT = "";
    process.env.OMP_REPOS_ROOT = "";
  });

  afterEach(() => {
    fs.rmSync(home, { recursive: true, force: true });
    fs.rmSync(cwd, { recursive: true, force: true });
  });

  test("returns env var when OMP_REPOS_ROOT is set", () => {
    process.env.OMP_REPOS_ROOT = "/custom/repos";
    const r = detectReposRoot(cwd);
    expect(r.source).toBe("env");
    expect(r.path).toBe("/custom/repos");
  });

  test("walks up to find a folder with .git", () => {
    const repo = path.join(cwd, "myproject");
    fs.mkdirSync(path.join(repo, ".git"), { recursive: true });
    const subdir = path.join(repo, "src", "lib");
    fs.mkdirSync(subdir, { recursive: true });
    const r = detectReposRoot(subdir);
    expect(r.source).toBe("cwd");
    expect(r.path).toBe(repo);
  });

  test("finds ~/Sites with at least one subdirectory", () => {
    const sites = path.join(home, "Sites");
    fs.mkdirSync(path.join(sites, "myapp"), { recursive: true });
    const r = detectReposRoot(cwd);
    expect(r.source).toBe("common");
    expect(r.path).toBe(sites);
  });

  test("rejects bare ~/Sites (no subdirs)", () => {
    const sites = path.join(home, "Sites");
    fs.mkdirSync(sites, { recursive: true });
    // no subdir created
    const r = detectReposRoot(cwd);
    expect(r.source).toBe("fallback");
    expect(r.path).toBe(path.join(home, "Sites"));
  });

  test("falls back to ~/Sites when nothing matches", () => {
    const r = detectReposRoot(cwd);
    expect(r.source).toBe("fallback");
    expect(r.path).toBe(path.join(home, "Sites"));
  });
});

describe("parseSetupReply", () => {
  test("ok / OK / Ok all parse to ok", () => {
    expect(parseSetupReply("ok")).toEqual({ kind: "ok" });
    expect(parseSetupReply("OK")).toEqual({ kind: "ok" });
    expect(parseSetupReply("Ok")).toEqual({ kind: "ok" });
    expect(parseSetupReply("  ok  ")).toEqual({ kind: "ok" });
  });

  test("vault= and repos= pair parses to custom", () => {
    expect(parseSetupReply("vault=~/Vault repos=~/Code")).toEqual({
      kind: "custom",
      vault: "~/Vault",
      repos: "~/Code",
    });
  });

  test("skips malformed custom", () => {
    expect(parseSetupReply("vault=~/Vault")).toEqual({ kind: "skip" });
    expect(parseSetupReply("garbage")).toEqual({ kind: "skip" });
  });

  test("skip / s / q parse to skip", () => {
    expect(parseSetupReply("skip")).toEqual({ kind: "skip" });
    expect(parseSetupReply("SKIP")).toEqual({ kind: "skip" });
    expect(parseSetupReply("s")).toEqual({ kind: "skip" });
    expect(parseSetupReply("q")).toEqual({ kind: "skip" });
  });
});

describe("configPathFor / needsSetup / writeConfig", () => {
  let tmp: string;
  beforeEach(() => {
    tmp = mkTmp("setup-cfg-");
    process.env.OMP_SYNC_CONFIG = "";
    process.env.HOME = tmp;
  });
  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test("configPathFor returns OMP_SYNC_CONFIG when set", () => {
    const p = path.join(tmp, "custom.json");
    process.env.OMP_SYNC_CONFIG = p;
    expect(configPathFor()).toBe(p);
  });

  test("configPathFor returns ~/.omp/omp-obsidian-sync.json by default", () => {
    expect(configPathFor()).toBe(path.join(tmp, ".omp", "omp-obsidian-sync.json"));
  });

  test("needsSetup returns false after writeConfig", () => {
    expect(needsSetup()).toBe(true);
    writeConfig({ vaultRoot: "/x", reposRoot: "/y" });
    expect(needsSetup()).toBe(false);
  });
});
