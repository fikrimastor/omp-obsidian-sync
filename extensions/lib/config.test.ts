import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { detectVault, detectReposRoot } from "./setup";
import { test, expect, describe } from "bun:test";
import { loadConfig, loadConfigOrDetect, SynthConfig } from "./config";

test("defaults when config file is missing", () => {
  const cfg = loadConfig("/nonexistent.json");
  expect(cfg.threshold).toBe(3);
  expect(cfg.llmProvider).toBeNull();
  expect(cfg.legacyOmpLearnMirror).toBe(false);
  expect(cfg.topicAliases.arch).toBe("architecture");
});

test("overrides defaults from config file", () => {
  const cfg = loadConfig("testdata/synth-config.json");
  expect(cfg.threshold).toBe(5);
  expect(cfg.llmProvider).toBe("openai");
});

test("clamps threshold < 1 to 1", () => {
  const cfg = loadConfig("testdata/synth-config-bad-threshold.json");
  expect(cfg.threshold).toBe(1);
});

test("uses env var OMP_SYNC_CONFIG to override config path", () => {
  process.env.OMP_SYNC_CONFIG = "testdata/synth-config.json";
  const cfg = loadConfig();
  expect(cfg.threshold).toBe(5);
  delete process.env.OMP_SYNC_CONFIG;
});

test("merges topicAliases defaults with config overrides", () => {
  const testPath = "testdata/partial-aliases.json";
  require("node:fs").writeFileSync(testPath, JSON.stringify({ topicAliases: { new: "something-new" } }));
  const cfg = loadConfig(testPath);
  expect(cfg.topicAliases.arch).toBe("architecture");
  expect(cfg.topicAliases.new).toBe("something-new");
});

describe("loadConfigOrDetect", () => {
  test("returns detected vault + repos when no config file exists", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cfg-detect-"));
    const oldHome = process.env.HOME;
    const oldSyncConfig = process.env.OMP_SYNC_CONFIG;
    try {
      process.env.HOME = tmp;
      const notes = path.join(tmp, "Notes");
      fs.mkdirSync(notes, { recursive: true });
      process.env.OMP_SYNC_CONFIG = path.join(tmp, "missing.json");

      const cfg = loadConfigOrDetect(tmp);
      expect(cfg.vaultRoot).toBe(notes);
      expect(fs.existsSync(path.join(notes, "omp-learn"))).toBe(false);
    } finally {
      process.env.HOME = oldHome;
      process.env.OMP_SYNC_CONFIG = oldSyncConfig;
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test("env var OMP_VAULT_ROOT takes priority over cwd/common", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cfg-detect-env-"));
    const oldHome = process.env.HOME;
    const oldVaultRoot = process.env.OMP_VAULT_ROOT;
    const oldSyncConfig = process.env.OMP_SYNC_CONFIG;
    try {
      process.env.HOME = tmp;
      process.env.OMP_VAULT_ROOT = "/env/vault";
      process.env.OMP_SYNC_CONFIG = path.join(tmp, "missing.json");

      const cfg = loadConfigOrDetect(tmp);
      expect(cfg.vaultRoot).toBe("/env/vault");
    } finally {
      process.env.HOME = oldHome;
      process.env.OMP_VAULT_ROOT = oldVaultRoot;
      process.env.OMP_SYNC_CONFIG = oldSyncConfig;
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
