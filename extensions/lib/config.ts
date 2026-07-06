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
