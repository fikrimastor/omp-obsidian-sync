import { test, expect } from "bun:test";
import { loadConfig, SynthConfig } from "./config";

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
