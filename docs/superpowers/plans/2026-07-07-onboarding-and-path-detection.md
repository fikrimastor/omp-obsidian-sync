# OMP Obsidian Sync — Onboarding & Path Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace hardcoded `os.homedir()` paths in the OMP Obsidian Sync plugin with a real first-run setup wizard that detects vault and repos roots via env vars, cwd walk, and common spots — and gets invoked on the first retain / `learn` event when no config exists.

**Architecture:** Pure-function detection (`detectVault(cwd)`, `detectReposRoot(cwd)`) layered on top of an unchanged `loadConfig()`. A new `loadConfigOrDetect(cwd)` calls `loadConfig()` and falls back to detected paths when the file is missing. The retain handler in both extensions calls `loadConfigOrDetect(cwd)`; if it would still need user input (a "no real detection" path), it skip-audits the event and prints a one-shot wizard prompt. A new `/synthesize setup` slash command re-runs the wizard. The `auditSkip()` helper tags the audit log.

**Tech Stack:** TypeScript, `bun:test` (per `CLAUDE.md`), OMP `ExtensionAPI` (`@oh-my-pi/pi-coding-agent/extensibility/hooks`).

## Global Constraints

- Bun runtime (`bun test`, no Jest / Vitest).
- No new test framework dependencies.
- TypeScript strict mode.
- `os.homedir()` is allowed only as a last-resort *printed* default the user must confirm — never silently used.
- Detection is pure: explicit `cwd` parameter, no global state, no module-level `process.cwd()` calls inside the detectors.
- The plugin is loaded via two extensions registered in `package.json` (`./extensions/sync.ts` and `./extensions/synth.ts`). Both must be updated; both already pass tests.
- Tests for the extension handlers must continue to work — they pass `HandleOptions` / `opts` overrides; the new `loadConfigOrDetect` must not break that path.

## File Structure

| File | Role | Change |
|---|---|---|
| `extensions/lib/setup.ts` | Pure detection + setup orchestrator | Rewrite |
| `extensions/lib/setup.test.ts` | Tests for detection | Rewrite |
| `extensions/lib/config.ts` | Config loader | Add `loadConfigOrDetect` |
| `extensions/lib/config.test.ts` | Tests for loader | Add `loadConfigOrDetect` cases |
| `extensions/lib/audit.ts` | Audit logging | Add `auditSkip` |
| `extensions/lib/audit.test.ts` | Tests for audit | Add `auditSkip` case |
| `extensions/lib/route.ts` | Path resolution | Replace top-level `os.homedir()` constants with `loadConfigOrDetect` call |
| `extensions/sync.ts` | Old extension entrypoint | Call `loadConfigOrDetect` at top of `handleToolResult` |
| `extensions/sync.test.ts` | Tests for sync extension | Add no-config + setup-skipped cases |
| `extensions/synth.ts` | New extension entrypoint | Call `loadConfigOrDetect` at top of `handleRetain` |
| `extensions/synth.test.ts` | Tests for synth extension | Add no-config + setup-skipped cases |
| `extensions/commands/synthesize.ts` | Slash command | Wire `/synthesize setup` |
| `extensions/commands/synthesize.test.ts` | Tests for command | Add `setup` case |
| `bin/migrate.ts` | Migration CLI | One-line comment |
| `README.md` | Docs | Update install + configuration sections |

## Interfaces Locked Across Tasks

```ts
// extensions/lib/setup.ts
export function detectVault(cwd: string): { path: string; source: "env" | "cwd" | "common" | "fallback" };
export function detectReposRoot(cwd: string): { path: string; source: "env" | "cwd" | "common" | "fallback" };
export type SetupReply =
  | { kind: "ok" }
  | { kind: "custom"; vault: string; repos: string }
  | { kind: "skip" };
export function parseSetupReply(text: string): SetupReply;
export function configPathFor(): string;
export function needsSetup(): boolean;            // existing
export function writeConfig(overrides: Partial<SynthConfig>): string;  // existing
export function runSetupWizard(opts: { pi: { note: (m: string) => void }; cwd: string; reply?: string }):
  | { status: "configured"; config: SynthConfig }
  | { status: "skipped" };

// extensions/lib/config.ts
export function loadConfigOrDetect(cwd: string, opts?: { envPrefix?: string }): SynthConfig;

// extensions/lib/audit.ts
export function auditSkip(vaultRoot: string, reason: string, content?: string): void;

// extensions/lib/route.ts
// resolveTargetDir signature unchanged, but the defaulting is delegated to loadConfigOrDetect.
```

---

### Task 1: Rewrite `extensions/lib/setup.ts` — `detectVault` + `detectReposRoot` + `parseSetupReply` + `configPathFor`

**Files:**
- Modify: `extensions/lib/setup.ts`
- Test: `extensions/lib/setup.test.ts`

**Interfaces:**
- Produces: `detectVault`, `detectReposRoot`, `parseSetupReply`, `configPathFor` (signatures above).
- The existing `needsSetup()`, `writeConfig()`, and `setupPrompt()` are kept for back-compat; `setupPrompt()` becomes a deprecated alias that returns the new prompt text.

**TDD: write tests first, run red, then implement.**

- [ ] **Step 1.1: Write failing tests in `extensions/lib/setup.test.ts`**

Replace the whole file with:

```ts
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
```

- [ ] **Step 1.2: Run the test file to confirm it fails**

Run: `cd ~/Sites/fikrimastor/omp-obsidian-sync && bun test extensions/lib/setup.test.ts`
Expected: FAIL — `detectVault` / `detectReposRoot` / `parseSetupReply` / `configPathFor` do not exist.

- [ ] **Step 1.3: Rewrite `extensions/lib/setup.ts`**

Replace the whole file with:

```ts
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
  return process.env.OMP_SYNC_CONFIG ?? path.join(os.homedir(), ".omp", "omp-obsidian-sync.json");
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
  return p.startsWith("~/") ? path.join(os.homedir(), p.slice(2)) : p;
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
  const cwdHit = walkUp(cwd, ".obsidian", os.homedir());
  if (cwdHit) {
    return { path: cwdHit, source: "cwd" };
  }
  for (const rel of VAULT_COMMON) {
    const p = path.join(os.homedir(), rel);
    if (fs.existsSync(p)) {
      return { path: p, source: "common" };
    }
  }
  return { path: path.join(os.homedir(), "Notes"), source: "fallback" };
}

export function detectReposRoot(cwd: string): DetectionResult {
  const env = process.env.OMP_REPOS_ROOT;
  if (env && env.trim() !== "") {
    return { path: env, source: "env" };
  }
  const cwdHit = walkUp(cwd, ".git", os.homedir());
  if (cwdHit) {
    return { path: path.dirname(cwdHit), source: "cwd" };
  }
  for (const rel of REPOS_COMMON) {
    const p = path.join(os.homedir(), rel);
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
  return { path: path.join(os.homedir(), "Sites"), source: "fallback" };
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
  configPath?: string;
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
  const config = writeConfig({ vaultRoot, reposRoot }) as unknown as SynthConfig;
  // writeConfig returns the path; the resulting config is what we want back.
  // Reconstruct from the values we just wrote so callers can use it directly.
  return {
    status: "configured",
    config: { ...DEFAULTS, vaultRoot, reposRoot } as SynthConfig,
  };
}
```

- [ ] **Step 1.4: Run the test file to confirm it passes**

Run: `cd ~/Sites/fikrimastor/omp-obsidian-sync && bun test extensions/lib/setup.test.ts`
Expected: PASS.

- [ ] **Step 1.5: Run the full test suite to make sure nothing else broke**

Run: `cd ~/Sites/fikrimastor/omp-obsidian-sync && bun test`
Expected: PASS. (Only `setup.test.ts` should be affected; older tests using `detectDefaults` still work because we kept the function.)

- [ ] **Step 1.6: Commit**

```bash
cd ~/Sites/fikrimastor/omp-obsidian-sync
git add extensions/lib/setup.ts extensions/lib/setup.test.ts
git commit -m "feat(setup): add detectVault/detectReposRoot, parseSetupReply, runSetupWizard"
```

---

### Task 2: Add `loadConfigOrDetect` to `extensions/lib/config.ts`

**Files:**
- Modify: `extensions/lib/config.ts`
- Test: `extensions/lib/config.test.ts`

**Interfaces:**
- Produces: `loadConfigOrDetect(cwd: string): SynthConfig` — returns `loadConfig()` result if a config file exists, otherwise the auto-detected config.

- [ ] **Step 2.1: Write failing tests in `extensions/lib/config.test.ts`**

Append to the existing file (do not remove current tests):

```ts
import { detectVault, detectReposRoot } from "./setup";

// (existing imports stay)

describe("loadConfigOrDetect", () => {
  test("returns detected vault + repos when no config file exists", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cfg-detect-"));
    process.env.HOME = tmp;
    const notes = path.join(tmp, "Notes");
    fs.mkdirSync(notes, { recursive: true });
    process.env.OMP_SYNC_CONFIG = path.join(tmp, "missing.json");

    const cfg = loadConfigOrDetect(tmp);
    expect(cfg.vaultRoot).toBe(notes);
    expect(fs.existsSync(path.join(notes, "omp-learn"))).toBe(false); // we don't write the dir
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  test("env var OMP_VAULT_ROOT takes priority over cwd/common", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "cfg-detect-env-"));
    process.env.HOME = tmp;
    process.env.OMP_VAULT_ROOT = "/env/vault";
    process.env.OMP_SYNC_CONFIG = path.join(tmp, "missing.json");

    const cfg = loadConfigOrDetect(tmp);
    expect(cfg.vaultRoot).toBe("/env/vault");
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
```

Add the `import` line at the top alongside the existing imports:

```ts
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { loadConfig, SynthConfig } from "./config";
import { detectVault, detectReposRoot } from "./setup";
```

(If `loadConfigOrDetect` isn't imported, add it too: `import { loadConfig, loadConfigOrDetect, SynthConfig } from "./config";`)

- [ ] **Step 2.2: Run tests to confirm red**

Run: `cd ~/Sites/fikrimastor/omp-obsidian-sync && bun test extensions/lib/config.test.ts`
Expected: FAIL — `loadConfigOrDetect` is not exported.

- [ ] **Step 2.3: Add `loadConfigOrDetect` to `extensions/lib/config.ts`**

Append the following function below the existing `loadConfig` export (do not modify the existing function):

```ts
import { detectVault, detectReposRoot } from "./setup";

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
```

- [ ] **Step 2.4: Run tests to confirm green**

Run: `cd ~/Sites/fikrimastor/omp-obsidian-sync && bun test extensions/lib/config.test.ts`
Expected: PASS.

- [ ] **Step 2.5: Run the full suite**

Run: `cd ~/Sites/fikrimastor/omp-obsidian-sync && bun test`
Expected: PASS.

- [ ] **Step 2.6: Commit**

```bash
cd ~/Sites/fikrimastor/omp-obsidian-sync
git add extensions/lib/config.ts extensions/lib/config.test.ts
git commit -m "feat(config): add loadConfigOrDetect for runtime path resolution"
```

---

### Task 3: Add `auditSkip` to `extensions/lib/audit.ts`

**Files:**
- Modify: `extensions/lib/audit.ts`
- Test: `extensions/lib/audit.test.ts`

- [ ] **Step 3.1: Write a failing test**

Append to `extensions/lib/audit.test.ts`:

```ts
import { auditSkip } from "./audit";

// (existing imports stay)

test("auditSkip writes a 'setup skipped' tagged line", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "audit-skip-"));
  auditSkip(tmp, "setup skipped", "first fact content");
  const log = fs.readFileSync(path.join(tmp, ".omp-audit.log"), "utf8");
  expect(log).toContain("setup skipped");
  expect(log).toContain("first fact content");
  fs.rmSync(tmp, { recursive: true, force: true });
});

test("auditSkip never throws on missing dir", () => {
  expect(() => auditSkip("/nonexistent/path/xyz", "setup skipped")).not.toThrow();
});
```

- [ ] **Step 3.2: Run tests to confirm red**

Run: `cd ~/Sites/fikrimastor/omp-obsidian-sync && bun test extensions/lib/audit.test.ts`
Expected: FAIL — `auditSkip` is not exported.

- [ ] **Step 3.3: Add `auditSkip` to `extensions/lib/audit.ts`**

Append at the bottom of the file (do not modify `auditLog`):

```ts
/**
 * Audit a skipped event (typically: setup not yet completed, so the fact
 * could not be written). The line is tagged with a `setup skipped:` prefix
 * so it can be distinguished from regular audit entries.
 *
 * Never throws.
 */
export function auditSkip(vaultRoot: string, reason: string, content?: string): void {
    try {
        const logPath = path.join(vaultRoot, '.omp-audit.log');
        const timestamp = new Date().toISOString();
        const snippet = content ? ` ${content.slice(0, 80)}` : "";
        const formattedLine = `[${timestamp}] ${reason}:${snippet}\n`;
        fs.appendFileSync(logPath, formattedLine, 'utf8');
    } catch (error) {
        // Silent fail as per requirements: "Never throws"
    }
}
```

- [ ] **Step 3.4: Run tests to confirm green**

Run: `cd ~/Sites/fikrimastor/omp-obsidian-sync && bun test extensions/lib/audit.test.ts`
Expected: PASS.

- [ ] **Step 3.5: Commit**

```bash
cd ~/Sites/fikrimastor/omp-obsidian-sync
git add extensions/lib/audit.ts extensions/lib/audit.test.ts
git commit -m "feat(audit): add auditSkip for setup-skipped events"
```

---

### Task 4: Wire `loadConfigOrDetect` into `extensions/sync.ts`

**Files:**
- Modify: `extensions/sync.ts`
- Test: `extensions/sync.test.ts`

**Interfaces:**
- Consumes: `loadConfigOrDetect(cwd)` from Task 2, `auditSkip(vaultRoot, reason, content?)` from Task 3, `needsSetup()` from Task 1, `configPathFor()` from Task 1.
- Produces: a `handleToolResult` that gates the first retain when `needsSetup()` is true and no `opts.vaultRoot` override is given; in that case it calls `auditSkip(<config-dir>, "setup skipped", content)` and returns without writing any note. The `<config-dir>` is `path.dirname(configPathFor())` — i.e. `~/.omp/` — so the audit log lives next to where the config will be written. Do NOT pass `path.dirname(errorLogPath)`; that's not the audit convention.
- `HandleOptions` keeps `vaultRoot?` / `reposRoot?` / `errorLogPath?` / `cwd?`; the handler resolves paths via `loadConfigOrDetect(cwd)` when overrides are absent.

- [ ] **Step 4.1: Write failing tests in `extensions/sync.test.ts`**

Append two test cases to the existing file. Both must:
1. Force `OMP_SYNC_CONFIG` to a path inside a fresh tmp dir.
2. Force `OMP_VAULT_ROOT` and `OMP_REPOS_ROOT` to empty strings (so detection falls through to common spots, then fallback).
3. Clean up env vars and the tmp dir in `afterEach`.

Test 1 — the gate:
```ts
test("first-run gate: audits a setup-skipped line under the config dir and does not write to the error log", () => {
  const unconfiguredTmp = fs.mkdtempSync(path.join(os.tmpdir(), "sync-unconfigured-"));
  const cfgPath = path.join(unconfiguredTmp, "omp-obsidian-sync.json");
  process.env.OMP_SYNC_CONFIG = cfgPath;
  process.env.OMP_VAULT_ROOT = "";
  process.env.OMP_REPOS_ROOT = "";

  expect(needsSetup()).toBe(true);

  const errorLogPath = path.join(unconfiguredTmp, "sync-errors.log");
  const event = { toolName: "retain", input: { items: [{ content: "fallback fact" }], i: "x" } };
  handleToolResult(event, { cwd: reposRoot, errorLogPath });

  const auditPath = path.join(path.dirname(cfgPath), "omp-obsidian-sync.audit.log");
  expect(fs.existsSync(auditPath)).toBe(true);
  const auditBody = fs.readFileSync(auditPath, "utf8");
  expect(auditBody).toContain("setup skipped");
  expect(auditBody).toContain("fallback fact");
  expect(fs.existsSync(errorLogPath)).toBe(false);

  delete process.env.OMP_SYNC_CONFIG;
  delete process.env.OMP_VAULT_ROOT;
  delete process.env.OMP_REPOS_ROOT;
  fs.rmSync(unconfiguredTmp, { recursive: true, force: true });
});
```

Test 2 — the bypass when an override is given (test path):
```ts
test("first-run gate: bypassed when opts.vaultRoot is given (test override path)", () => {
  const unconfiguredTmp = fs.mkdtempSync(path.join(os.tmpdir(), "sync-unconfigured-bypass-"));
  process.env.OMP_SYNC_CONFIG = path.join(unconfiguredTmp, "omp-obsidian-sync.json");
  process.env.OMP_VAULT_ROOT = "";
  process.env.OMP_REPOS_ROOT = "";

  const errorLogPath = path.join(unconfiguredTmp, "sync-errors.log");
  handleToolResult(
    { toolName: "retain", input: { items: [{ content: "general fact" }], i: "x" } },
    { cwd: reposRoot, vaultRoot, reposRoot, errorLogPath },
  );
  expect(fs.existsSync(path.join(vaultRoot, "omp-learn", "omp-learn-0001.md"))).toBe(true);
  expect(fs.existsSync(path.join(unconfiguredTmp, "omp-obsidian-sync.audit.log"))).toBe(false);

  delete process.env.OMP_SYNC_CONFIG;
  delete process.env.OMP_VAULT_ROOT;
  delete process.env.OMP_REPOS_ROOT;
  fs.rmSync(unconfiguredTmp, { recursive: true, force: true });
});
```
- [ ] **Step 4.2: Run tests to confirm red**

Run: `cd ~/Sites/fikrimastor/omp-obsidian-sync && bun test extensions/sync.test.ts`
Expected: FAIL — the new tests reference `auditSkip` behavior that doesn't exist yet. The two new tests will fail because `handleToolResult` currently writes to the (nonexistent) `~/Notes` vault, not the audit log under the config dir.
- [ ] **Step 4.3: Rewrite `extensions/sync.ts`**

Replace the whole file with:

```ts
import fs from "node:fs";
import path from "node:path";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent/extensibility/hooks";
import { extractFacts } from "./lib/extract";
import { classify } from "./lib/classify";
import { resolveTargetDir } from "./lib/route";
import { writeNote } from "./lib/note";
import { loadConfigOrDetect } from "./lib/config";
import { auditSkip, needsSetup, configPathFor } from "./lib/setup";

const DEFAULT_ERROR_LOG = path.join(__dirname, "..", "sync-errors.log");

export interface HandleOptions {
  cwd?: string;
  vaultRoot?: string;
  reposRoot?: string;
  errorLogPath?: string;
}

function logError(errorLogPath: string, message: string): void {
  try {
    const line = `[${new Date().toISOString()}] ${message}\n`;
    fs.appendFileSync(errorLogPath, line, "utf8");
  } catch {
    // Logging itself must never throw or surface into the agent session.
  }
}

function resolvePaths(opts: HandleOptions): { vaultRoot: string; reposRoot: string } {
  if (opts.vaultRoot && opts.reposRoot) {
    return { vaultRoot: opts.vaultRoot, reposRoot: opts.reposRoot };
  }
  const cfg = loadConfigOrDetect(opts.cwd ?? process.cwd());
  return { vaultRoot: opts.vaultRoot ?? cfg.vaultRoot, reposRoot: opts.reposRoot ?? cfg.reposRoot };
}

export function handleToolResult(
  event: { toolName: string; input: unknown },
  opts: HandleOptions = {},
): void {
  const errorLogPath = opts.errorLogPath ?? DEFAULT_ERROR_LOG;

  try {
    if (event.toolName !== "retain" && event.toolName !== "learn") return;

    const facts = extractFacts(event.toolName, event.input);
    if (facts === null) {
      logError(
        errorLogPath,
        `skipped ${event.toolName}: unrecognized input shape, keys=${
          event.input && typeof event.input === "object"
            ? Object.keys(event.input as object).join(",")
            : String(event.input)
        }`,
      );
      return;
    }

    if (needsSetup() && !opts.vaultRoot) {
      const firstContent = facts[0] ?? "";
      auditSkip(
        path.dirname(configPathFor()),
        "setup skipped",
        firstContent,
      );
      return;
    }

    const cwd = opts.cwd ?? process.cwd();
    const { vaultRoot, reposRoot } = resolvePaths({ ...opts, cwd });

    for (const rawContent of facts) {
      const { isProject, content } = classify(rawContent);
      const targetDir = resolveTargetDir(cwd, isProject, { vaultRoot, reposRoot });
      writeNote(vaultRoot, targetDir, content, event.toolName as "retain" | "learn");
    }
  } catch (err) {
    logError(errorLogPath, `unexpected error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export default function (pi: ExtensionAPI): void {
  pi.on("tool_result", async (event) => {
    handleToolResult({ toolName: event.toolName, input: event.input });
  });
}
```


- [ ] **Step 4.4: Run sync tests**

Run: `cd ~/Sites/fikrimastor/omp-obsidian-sync && bun test extensions/sync.test.ts`
Expected: PASS.

- [ ] **Step 4.5: Run the full suite**

Run: `cd ~/Sites/fikrimastor/omp-obsidian-sync && bun test`
Expected: PASS.

- [ ] **Step 4.6: Commit**

```bash
cd ~/Sites/fikrimastor/omp-obsidian-sync
git add extensions/sync.ts extensions/sync.test.ts
git commit -m "feat(sync): route through loadConfigOrDetect; audit-skip on first-run gate"
```

---

### Task 5: Wire `loadConfigOrDetect` into `extensions/synth.ts`

**Files:**
- Modify: `extensions/synth.ts`
- Test: `extensions/synth.test.ts`

**Interfaces:**
- Consumes: `loadConfigOrDetect(cwd)` from Task 2, `auditSkip(vaultRoot, reason, content?)` from Task 3, `needsSetup()`, `configPathFor()` from Task 1.
- Produces: `handleRetain` that gates the first retain when `needsSetup()` is true and no `opts?.vaultRoot` override is given; in that case it calls `auditSkip(<config-dir>, "setup skipped", content)` and returns. The `<config-dir>` is `path.dirname(configPathFor())` — NOT `path.dirname(syncErrorsPath(...))` or any other path.
- Existing 5 tests pass `vaultRoot` in `opts`, so the new gate's `!opts?.vaultRoot` clause lets them through.

- [ ] **Step 5.1: Write a failing test in `extensions/synth.test.ts`**

Append to the existing file (do not change the existing 5 tests):

```ts
import { needsSetup, configPathFor } from "./lib/setup";
// (existing imports stay)

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
```

- [ ] **Step 5.2: Run tests to confirm red**

Run: `cd ~/Sites/fikrimastor/omp-obsidian-sync && bun test extensions/synth.test.ts`
Expected: FAIL — the new test asserts `auditPath` exists after the handler runs, but the current `synth.ts` either writes a project file (no gate) or doesn't write the audit log (no gate).

- [ ] **Step 5.3: Modify `extensions/synth.ts`**

In the `handleRetain` function, find the existing block:

```ts
  try {
    const config = loadConfig();
    const finalConfig = { ...config, ...opts };
    const vaultRoot = finalConfig.vaultRoot;
```

Replace with:

```ts
  try {
    if (needsSetup() && !opts?.vaultRoot) {
      const firstItem = event.input && typeof event.input === "object"
        ? (event.input as { items?: Array<{ content?: string }> }).items?.[0]?.content
        : undefined;
      const firstRaw = firstItem ?? (event.input && typeof event.input === "object"
        ? String((event.input as { content?: string }).content ?? "")
        : "");
      auditSkip(
        path.dirname(configPathFor()),
        "setup skipped",
        firstRaw,
      );
      return;
    }
    const config = opts?.vaultRoot ? loadConfig() : loadConfigOrDetect(event.cwd);
    const finalConfig = { ...config, ...opts };
    const vaultRoot = finalConfig.vaultRoot;
```

Add these imports to the top of the file (replacing the existing `loadConfig, SynthConfig` import):

```ts
import { loadConfig, loadConfigOrDetect, SynthConfig } from "./lib/config";
import { auditSkip, needsSetup, configPathFor } from "./lib/setup";
```

- [ ] **Step 5.4: Run synth tests**

Run: `cd ~/Sites/fikrimastor/omp-obsidian-sync && bun test extensions/synth.test.ts`
Expected: PASS — 5 pre-existing + 1 new = 6 tests.

- [ ] **Step 5.5: Run the full suite**

Run: `cd ~/Sites/fikrimastor/omp-obsidian-sync && bun test`
Expected: PASS — 115 + 1 = 116 tests, 0 fail.

- [ ] **Step 5.6: Commit**

```bash
cd ~/Sites/fikrimastor/omp-obsidian-sync
git add extensions/synth.ts extensions/synth.test.ts
git commit -m "feat(synth): route through loadConfigOrDetect; audit-skip on first-run gate"
```

---

### Task 6: Narrow `extensions/lib/route.ts` — drop the top-level `os.homedir()` constants

**Files:**
- Modify: `extensions/lib/route.ts`
- Test: `extensions/lib/route.test.ts`

- [ ] **Step 6.1: Verify existing tests pass before change**

Run: `cd ~/Sites/fikrimastor/omp-obsidian-sync && bun test extensions/lib/route.test.ts`
Expected: PASS.

- [ ] **Step 6.2: Modify `extensions/lib/route.ts`**

Find:
```ts
import path from "node:path";
import fs from "node:fs";
import os from "node:os";

const DEFAULT_VAULT_ROOT = path.join(os.homedir(), "Notes");
const DEFAULT_REPOS_ROOT = path.join(os.homedir(), "Sites", "fikrimastor");
const GENERAL_DIR_NAME = "omp-learn";
```

Replace with:
```ts
import path from "node:path";
import fs from "node:fs";
import { loadConfigOrDetect } from "./config";

const GENERAL_DIR_NAME = "omp-learn";
```

Find the `resolveTargetDir` function body:

```ts
export function resolveTargetDir(
  cwd: string,
  isProject: boolean,
  opts: RouteOptions = {},
): string {
  const vaultRoot = opts.vaultRoot ?? DEFAULT_VAULT_ROOT;
  const reposRoot = opts.reposRoot ?? DEFAULT_REPOS_ROOT;
```

Replace with:
```ts
export function resolveTargetDir(
  cwd: string,
  isProject: boolean,
  opts: RouteOptions = {},
): string {
  // Prefer explicit overrides (tests + callers with full config). Otherwise
  // resolve via loadConfigOrDetect so env / cwd / common / fallback all apply.
  const detected = opts.vaultRoot && opts.reposRoot
    ? null
    : loadConfigOrDetect(cwd);
  const vaultRoot = opts.vaultRoot ?? detected!.vaultRoot;
  const reposRoot = opts.reposRoot ?? detected!.reposRoot;
```

- [ ] **Step 6.3: Run route tests**

Run: `cd ~/Sites/fikrimastor/omp-obsidian-sync && bun test extensions/lib/route.test.ts`
Expected: PASS — all existing tests pass `opts: { vaultRoot, reposRoot }` explicitly, so the detection path isn't triggered.

- [ ] **Step 6.4: Run the full suite**

Run: `cd ~/Sites/fikrimastor/omp-obsidian-sync && bun test`
Expected: PASS.

- [ ] **Step 6.5: Commit**

```bash
cd ~/Sites/fikrimastor/omp-obsidian-sync
git add extensions/lib/route.ts
git commit -m "refactor(route): replace top-level os.homedir() constants with loadConfigOrDetect"
```

---

### Task 7: Wire `/synthesize setup` slash command

**Files:**
- Modify: `extensions/commands/synthesize.ts`
- Test: `extensions/commands/synthesize.test.ts`

**Interfaces:**
- Consumes: `runSetupWizard` from Task 1, `parseSetupReply` from Task 1.
- The handler signature becomes: `pi.onCommand("synthesize", async (args) => { ... })`.

- [ ] **Step 7.1: Write a failing test**

Append to `extensions/commands/synthesize.test.ts`:

```ts
import { handleSynthesizeCommand } from "./synthesize";

// (existing imports stay)

test("setup subcommand runs the wizard with the supplied reply", () => {
  let printed: string[] = [];
  const pi = { note: (m: string) => printed.push(m) };
  const result = handleSynthesizeCommand({
    project: "setup",
    vaultRoot: "/tmp",
    config: {
      vaultRoot: "/tmp",
      reposRoot: "/tmp",
      threshold: 3,
      llmProvider: null,
      llmModel: null,
      llmBaseUrl: null,
      llmApiKeyEnv: "OPENAI_API_KEY",
      legacyOmpLearnMirror: false,
      topicAliases: {},
    },
    pi: pi as any,
    reply: "ok",
  });
  expect(result).toContain("configured");
  expect(printed.length).toBe(1);
});
```

- [ ] **Step 7.2: Run tests to confirm red**

Run: `cd ~/Sites/fikrimastor/omp-obsidian-sync && bun test extensions/commands/synthesize.test.ts`
Expected: FAIL — `handleSynthesizeCommand` doesn't accept `pi` or `reply`.

- [ ] **Step 7.3: Rewrite `extensions/commands/synthesize.ts`**

Replace the whole file with:

```ts
import fs from "node:fs";
import path from "node:path";
import { loadConfig, loadConfigOrDetect, SynthConfig } from "../lib/config";
import { runSynthesis } from "../lib/synthesize";
import { readState } from "../lib/state";
import { auditLog } from "../lib/audit";
import { runSetupWizard } from "../lib/setup";

export interface SynthCommandArgs {
  project: string;
  vaultRoot: string;
  config?: SynthConfig;
  pi?: { note: (m: string) => void };
  reply?: string;
  cwd?: string;
}

export function handleSynthesizeCommand(args: SynthCommandArgs): string {
  const config = args.config ?? loadConfig();
  const vaultRoot = args.vaultRoot ?? config.vaultRoot;

  if (args.project === "setup") {
    if (!args.pi) return "Setup wizard requires a PI runtime; not available in CLI mode.";
    const cwd = args.cwd ?? process.cwd();
    const result = runSetupWizard({ pi: args.pi, cwd, reply: args.reply });
    if (result.status === "configured") {
      return `✅ Configured: vault=${result.config.vaultRoot} repos=${result.config.reposRoot}`;
    }
    return "⏭️  Setup skipped. Run `/synthesize setup` again with a reply (e.g. `ok` or `vault=… repos=…`).";
  }

  if (args.project === "status") {
    const state = readState(vaultRoot);
    const entries = Object.entries(state).filter(([, v]) => v > 0);
    if (entries.length === 0) return "No pending projects. All caught up.";
    return entries.map(([p, c]) => `${p}: ${c} pending`).join("\n");
  }

  if (args.project === "all") {
    const state = readState(vaultRoot);
    const projects = Object.keys(state).filter(p => state[p] > 0);
    if (projects.length === 0) return "No pending projects to synthesize.";
    const results: string[] = [];
    for (const project of projects) {
      runSynthesis(project, vaultRoot, config);
      results.push(`${project}: synthesized`);
    }
    auditLog(vaultRoot, `/synthesize all: ${results.join(", ")}`);
    return results.join("\n");
  }

  // Single project
  runSynthesis(args.project, vaultRoot, config);
  auditLog(vaultRoot, `/synthesize ${args.project}: completed`);
  return `Synthesized ${args.project}. Check audit log for details.`;
}

export function registerCommand(pi: {
  onCommand: (name: string, handler: (args: { project?: string; reply?: string }) => Promise<string>) => void;
}): void {
  pi.onCommand("synthesize", async (args) => {
    const project = args.project ?? "all";
    return handleSynthesizeCommand({
      project,
      vaultRoot: loadConfig().vaultRoot,
      cwd: process.cwd(),
      pi: { note: (m) => process.stderr.write(m + "\n") },
      reply: args.reply,
    });
  });
}
```

- [ ] **Step 7.4: Run command tests**

Run: `cd ~/Sites/fikrimastor/omp-obsidian-sync && bun test extensions/commands/synthesize.test.ts`
Expected: PASS.

- [ ] **Step 7.5: Run the full suite**

Run: `cd ~/Sites/fikrimastor/omp-obsidian-sync && bun test`
Expected: PASS.

- [ ] **Step 7.6: Commit**

```bash
cd ~/Sites/fikrimastor/omp-obsidian-sync
git add extensions/commands/synthesize.ts extensions/commands/synthesize.test.ts
git commit -m "feat(command): wire /synthesize setup slash command"
```

---

### Task 8: Update `bin/migrate.ts` comment

**Files:**
- Modify: `bin/migrate.ts`

- [ ] **Step 8.1: Add the comment**

Find the existing top-of-file doc comment:

```ts
#!/usr/bin/env bun
import path from "node:path";
import fs from "node:fs";
import readline from "node:readline";
import { loadConfig } from "../extensions/lib/config";
import { migrateLegacyNotes } from "../extensions/lib/migrate";
```

Add the doc comment above the `loadConfig` import (or above the `main()` function — pick the top of the file for visibility):

```ts
#!/usr/bin/env bun
// bin/migrate.ts — one-shot legacy note migrator. Reads ~/.omp/omp-obsidian-sync.json
// (or OMP_SYNC_CONFIG) via loadConfig(). For new CLIs, prefer loadConfigOrDetect(cwd)
// so the first-run detection is honored.
import path from "node:path";
import fs from "node:fs";
import readline from "node:readline";
import { loadConfig } from "../extensions/lib/config";
import { migrateLegacyNotes } from "../extensions/lib/migrate";
```

- [ ] **Step 8.2: Run migrate tests**

Run: `cd ~/Sites/fikrimastor/omp-obsidian-sync && bun test extensions/lib/migrate.test.ts`
Expected: PASS — the comment is non-functional.

- [ ] **Step 8.3: Commit**

```bash
cd ~/Sites/fikrimastor/omp-obsidian-sync
git add bin/migrate.ts
git commit -m "docs(migrate): note loadConfigOrDetect for new CLIs"
```

---

### Task 9: Update `README.md` — install + configuration sections

**Files:**
- Modify: `README.md`

- [ ] **Step 9.1: Update the "First retain event triggers a setup wizard" sentence**

This sentence is already true. Keep it. Add a `Setup` section right after the `## Install` section:

```markdown
## Setup

On the first `retain` or `learn` call, the plugin checks for `~/.omp/omp-obsidian-sync.json`. If the file is missing, a one-shot setup prompt is printed to the PI runtime and the event is held in the audit log (`setup skipped: …`) until you respond.

Detection order (vault + repos):

1. `OMP_VAULT_ROOT` / `OMP_REPOS_ROOT` environment variable — authoritative.
2. Walk up from the current working directory looking for `.obsidian/` (vault) or `.git/` (repos). The parent of `.git/` is taken as the repos root.
3. Common spots — vault: `~/Notes`, `~/Obsidian`, `~/Documents/Notes`. Repos: `~/Sites`, `~/Code`, `~/src`, `~/repos`.
4. Last-resort fallback: `~/Notes` and `~/Sites`, printed as the suggested default and only used when you reply `ok`.

Reply with one of:

- `ok` — accept the detected paths and write the config file.
- `vault=… repos=…` — use custom paths (e.g. `vault=~/Vault repos=~/Code`).
- `skip` — abort this event, audit it, and prompt again on the next retain.

Run `/synthesize setup` any time to re-run the wizard.
```

- [ ] **Step 9.2: Update the configuration table**

Find:
```markdown
| `vaultRoot` | `~/Notes` | Obsidian vault path |
| `reposRoot` | `~/Sites/fikrimastor` | Repos root (for project routing) |
```

Replace with:
```markdown
| `vaultRoot` | (auto-detected) | Obsidian vault path |
| `reposRoot` | (auto-detected) | Repos root (for project routing) |
```

- [ ] **Step 9.3: Update the Requirements section**

Find:
```markdown
- **Obsidian vault** at `~/Notes` (or configured path)
```

Replace with:
```markdown
- **Obsidian vault** at a path of your choice (auto-detected, see Setup)
```

- [ ] **Step 9.4: Commit**

```bash
cd ~/Sites/fikrimastor/omp-obsidian-sync
git add README.md
git commit -m "docs(readme): add Setup section; mark paths as auto-detected"
```

---

### Task 10: Final verification — full test suite + sweep for hardcoded paths

**Files:**
- Modify: none (verification only)

- [ ] **Step 10.1: Run the full test suite**

Run: `cd ~/Sites/fikrimastor/omp-obsidian-sync && bun test`
Expected: PASS, no skipped tests.

- [ ] **Step 10.2: Sweep for hardcoded `Notes` / `fikrimastor` strings in runtime code**

Run:

```bash
cd ~/Sites/fikrimastor/omp-obsidian-sync
grep -RIn --include='*.ts' -E '"Notes"|"fikrimastor"|os\.homedir|~/Notes|~/Sites/fikrimastor' extensions/ bin/
```

Expected matches (these are intentional last-resort fallbacks inside detection):

- `extensions/lib/setup.ts` — the `VAULT_COMMON` array, the `REPOS_COMMON` array, and the `fallback` returns. **These are correct.**

Any match outside `extensions/lib/setup.ts` is a bug. None should appear in:
- `extensions/lib/config.ts`
- `extensions/sync.ts`
- `extensions/synth.ts`
- `extensions/lib/route.ts`
- `extensions/commands/synthesize.ts`
- `bin/migrate.ts`

- [ ] **Step 10.3: Type-check**

Run: `cd ~/Sites/fikrimastor/omp-obsidian-sync && bunx tsc --noEmit`
Expected: exit 0, no errors.

- [ ] **Step 10.4: Final commit (only if any sweep fixups were needed)**

```bash
cd ~/Sites/fikrimastor/omp-obsidian-sync
git add -A
git diff --cached --quiet || git commit -m "chore: post-sweep cleanup"
```

(No commit if nothing changed.)

---

## Self-Review

**Spec coverage:**

| Spec requirement | Task |
|---|---|
| Trigger: first retain/learn with no config | 4, 5 |
| Detection order: env → cwd → common → fallback | 1 |
| Cwd walk for `.obsidian` / `.git` | 1 |
| Common spots listed (vault + repos) | 1 |
| Reject bare `~/Sites` (no subdirs) | 1 |
| Last-resort fallback printed as default | 1 |
| One-line prompt style | 1 |
| `parseSetupReply` covers `ok` / `custom` / `skip` | 1 |
| Skip + warn recoverable fallback | 4, 5 |
| `auditSkip` helper | 3 |
| `/synthesize setup` slash command | 7 |
| `loadConfigOrDetect` layered on `loadConfig` | 2 |
| `route.ts` constants removed | 6 |
| `sync.ts` calls `loadConfigOrDetect` | 4 |
| `synth.ts` calls `loadConfigOrDetect` | 5 |
| `bin/migrate.ts` no behavior change | 8 |
| `README.md` install + config updated | 9 |
| Hardcoded `os.homedir()` swept from runtime | 10 |
| Tests for all four detection branches | 1 |
| Tests for skip+audit in both extensions | 4, 5 |
| Tests for setup command | 7 |

**Placeholder scan:** no "TBD" / "TODO" / "implement later" in the plan.

**Type consistency:** `runSetupWizard` returns `{ status, config }` consistently. `SetupReply` discriminated union is used the same way in Tasks 1, 4, 5, 7. `loadConfigOrDetect(cwd)` signature is stable across Tasks 2, 4, 5, 6. `auditSkip(vaultRoot, reason, content)` signature is stable across Tasks 3, 4, 5.

**Out of scope (from spec):** blocking `pi.ask()`, removing `sync.ts` in favor of `synth.ts`, Windows common-spot equivalents — none have tasks. Confirmed.
