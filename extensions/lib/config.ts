import { detectVault, detectReposRoot } from "./setup";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export interface SynthConfig {
  vaultRoot: string;
  reposRoot: string;
  threshold: number;
  llmProvider: string | null;
  llmModel: string | null;
  llmBaseUrl: string | null;
  llmApiKeyEnv: string;
  legacyOmpLearnMirror: boolean;
  topicAliases: Record<string, string>;
}

export const DEFAULTS: SynthConfig = {
  vaultRoot: path.join(os.homedir(), "Notes"),
  reposRoot: path.join(os.homedir(), "Sites", "fikrimastor"),
  threshold: 3,
  llmProvider: null,
  llmModel: null,
  llmBaseUrl: null,
  llmApiKeyEnv: "OPENAI_API_KEY",
  legacyOmpLearnMirror: false,
  topicAliases: {
    arch: "architecture", bug: "bugs", conv: "conventions",
    wf: "workflow", tech: "tech-stack", dec: "decisions",
  },
};

function resolvePath(p: string): string {
  return p.startsWith("~/") ? path.join(os.homedir(), p.slice(2)) : p;
}

export function loadConfig(configPath?: string): SynthConfig {
  const effectivePath = configPath ?? process.env.OMP_SYNC_CONFIG
    ?? path.join(os.homedir(), ".omp", "omp-obsidian-sync.json");

  let fileCfg: Partial<SynthConfig> = {};
  try {
    if (fs.existsSync(effectivePath)) {
      fileCfg = JSON.parse(fs.readFileSync(effectivePath, "utf8"));
    }
  } catch {
    // File missing or invalid JSON → use defaults
  }

  const merged: SynthConfig = { ...DEFAULTS, ...fileCfg, topicAliases: { ...DEFAULTS.topicAliases, ...fileCfg.topicAliases } };
  merged.vaultRoot = resolvePath(merged.vaultRoot);
  merged.reposRoot = resolvePath(merged.reposRoot);
  if (merged.threshold < 1) merged.threshold = 1;
  return merged;
}

/**
 * Same as loadConfig() but, when the config file is missing, returns the
 * auto-detected vault + repos roots layered on top of DEFAULTS. The detection
 * is run on every call, so env-var changes are honored without a restart.
 *
 * The caller (retain handler) is expected to gate any user prompt behind
 * needsSetup(); this function is silent.
 */
export function loadConfigOrDetect(cwd: string, configPath?: string): SynthConfig {
  const loaded = loadConfig(configPath);
  if (!needsSetupUnchecked(configPath)) {
    return loaded;
  }
  const vault = detectVault(cwd);
  const repos = detectReposRoot(cwd);
  return {
    ...DEFAULTS,
    ...loaded,
    vaultRoot: loaded.vaultRoot && loaded.vaultRoot !== DEFAULTS.vaultRoot
      ? loaded.vaultRoot
      : vault.path,
    reposRoot: loaded.reposRoot && loaded.reposRoot !== DEFAULTS.reposRoot
      ? loaded.reposRoot
      : repos.path,
  };
}

function needsSetupUnchecked(configPath?: string): boolean {
  const effectivePath = configPath ?? process.env.OMP_SYNC_CONFIG
    ?? path.join(os.homedir(), ".omp", "omp-obsidian-sync.json");
  try {
    return !fs.existsSync(effectivePath);
  } catch {
    return true;
  }
}
