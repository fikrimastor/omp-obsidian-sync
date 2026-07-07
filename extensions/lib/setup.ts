import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { DEFAULTS, SynthConfig } from "./config";

/**
 * Path resolution where the candidate value came from. Surfaced for the
 * setup wizard so the user knows whether the suggested path is authoritative
 * (env override) or just our best guess.
 */
export type DetectionSource = "env" | "cwd" | "common" | "fallback";

export interface DetectionResult {
  path: string;
  source: DetectionSource;
}

export function configPathFor(): string {
  const home = process.env.HOME ?? os.homedir();
  const envConfig = process.env.OMP_SYNC_CONFIG;
  if (envConfig && envConfig.trim() !== "") return envConfig;
  return path.join(home, ".omp", "omp-obsidian-sync.json");
}

export function needsSetup(): boolean {
  return !fs.existsSync(configPathFor());
}

export function writeConfig(overrides: Partial<SynthConfig>): string {
  const configPath = configPathFor();
  const configDir = path.dirname(configPath);
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  const finalConfig = { ...DEFAULTS, ...overrides };
  if (overrides.topicAliases) {
    finalConfig.topicAliases = { ...DEFAULTS.topicAliases, ...overrides.topicAliases };
  }

  fs.writeFileSync(configPath, JSON.stringify(finalConfig, null, 2), "utf8");
  return configPath;
}

function expandHome(p: string): string {
  const home = process.env.HOME ?? os.homedir();
  return p.startsWith("~/") ? path.join(home, p.slice(2)) : p;
}

function walkUp(start: string, marker: string, stop: string): string | null {
  let cur = path.resolve(start);
  const stopAbs = path.resolve(stop);
  while (true) {
    if (fs.existsSync(path.join(cur, marker))) return cur;
    if (cur === stopAbs) return null;
    const parent = path.dirname(cur);
    if (parent === cur) return null;
    cur = parent;
  }
}

const VAULT_COMMON = ["Notes", "Obsidian", path.join("Documents", "Notes")];
const REPOS_COMMON = ["Sites", "Code", "src", "repos"];

export function detectVault(cwd: string): DetectionResult {
  const env = process.env.OMP_VAULT_ROOT;
  if (env && env.trim() !== "") {
    return { path: env, source: "env" };
  }
  const home = process.env.HOME ?? os.homedir();
  const cwdHit = walkUp(cwd, ".obsidian", home);
  if (cwdHit) {
    return { path: cwdHit, source: "cwd" };
  }
  for (const rel of VAULT_COMMON) {
    const p = path.join(home, rel);
    if (fs.existsSync(p)) {
      return { path: p, source: "common" };
    }
  }
  return { path: path.join(home, "Notes"), source: "fallback" };
}

export function detectReposRoot(cwd: string): DetectionResult {
  const env = process.env.OMP_REPOS_ROOT;
  if (env && env.trim() !== "") {
    return { path: env, source: "env" };
  }
  const home = process.env.HOME ?? os.homedir();
  const cwdHit = walkUp(cwd, ".git", home);
  if (cwdHit) {
    return { path: cwdHit, source: "cwd" };
  }
  for (const rel of REPOS_COMMON) {
    const p = path.join(home, rel);
    if (fs.existsSync(p) && fs.readdirSync(p).some((d) => {
      try {
        return fs.statSync(path.join(p, d)).isDirectory();
      } catch {
        return false;
      }
    })) {
      return { path: p, source: "common" };
    }
  }
  return { path: path.join(home, "Sites"), source: "fallback" };
}

export type SetupReply =
  | { kind: "ok" }
  | { kind: "custom"; vault: string; repos: string }
  | { kind: "skip" };

export function parseSetupReply(text: string): SetupReply {
  const trimmed = text.trim();
  if (trimmed === "" || trimmed === "ok" || trimmed === "OK" || trimmed === "Ok") {
    return { kind: "ok" };
  }
  if (trimmed === "skip" || trimmed === "SKIP" || trimmed === "s" || trimmed === "q") {
    return { kind: "skip" };
  }
  const m = trimmed.match(/^vault=(.+?)\s+repos=(.+)$/);
  if (m) {
    return { kind: "custom", vault: m[1].trim(), repos: m[2].trim() };
  }
  return { kind: "skip" };
}

export function setupPrompt(vault: DetectionResult, repos: DetectionResult): string {
  return `🔧 OMP Obsidian Sync — first run setup
Detected vault:   ${vault.path}  (source: ${vault.source})
Detected repos:   ${repos.path}  (source: ${repos.source})

Reply with one of:
  ok              — use detected paths and write config
  vault=… repos=… — use custom paths (e.g. vault=~/Vault repos=~/Code)
  skip            — abort this event, log to audit, don't write config

Or run \`/synthesize setup\` later to revisit.`;
}

/**
 * Back-compat alias. The old `detectDefaults()` always returned ~/Notes
 * regardless of whether the path existed. We now return detected values.
 */
export function detectDefaults(): { vaultRoot: string; reposRoot: string } {
  const vault = detectVault(process.cwd());
  const repos = detectReposRoot(process.cwd());
  return { vaultRoot: expandHome(vault.path), reposRoot: expandHome(repos.path) };
}

/**
 * Orchestrates the wizard: detect → print prompt → parse reply → write or skip.
 * Returns "configured" with the resulting config, or "skipped".
 *
 * `reply` is supplied when the parser has the next user message. When omitted,
 * the wizard only prints the prompt and returns "skipped" (the typical
 * first-retain path; the user supplies a reply on the next invocation).
 */
export function runSetupWizard(opts: {
  pi: { note: (m: string) => void };
  cwd: string;
  reply?: string;
}):
  | { status: "configured"; config: SynthConfig }
  | { status: "skipped" } {
  const vault = detectVault(opts.cwd);
  const repos = detectReposRoot(opts.cwd);
  opts.pi.note(setupPrompt(vault, repos));

  if (opts.reply === undefined) {
    return { status: "skipped" };
  }

  const parsed = parseSetupReply(opts.reply);
  if (parsed.kind === "skip") {
    return { status: "skipped" };
  }

  const vaultRoot = parsed.kind === "custom" ? expandHome(parsed.vault) : vault.path;
  const reposRoot = parsed.kind === "custom" ? expandHome(parsed.repos) : repos.path;
  writeConfig({ vaultRoot, reposRoot });
  
  return {
    status: "configured",
    config: { ...DEFAULTS, vaultRoot, reposRoot } as SynthConfig,
  };
}
