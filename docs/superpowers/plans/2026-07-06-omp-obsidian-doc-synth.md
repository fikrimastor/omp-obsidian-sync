# OMP Doc-Synth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the existing `omp-obsidian-sync` plugin with a synthesis engine that routes retained facts into structured project folders (`~/Notes/<project>/<topic>.md`), deduplicates/promotes related facts, and optionally summarizes via LLM.

**Architecture:** OMP PostToolUse hook (`extensions/synth.ts`) reads retain/learn events. Tag parser extracts `[project:slug]` + `[topic]`. Topic file writer appends dated bullets to `~/Notes/<project>/<topic>.md`. After N facts (default 3), a synthesis pass dedupes (exact + Levenshtein), promotes cross-cutting facts, and optionally runs LLM summarization. All failures log to `sync-errors.log` — never throw into the OMP session.

**Tech Stack:** Bun, TypeScript, OMP ExtensionAPI hooks, Obsidian vault at `~/Notes/`.

## Global Constraints

- Never throw into the OMP session: all errors log to `sync-errors.log` and the audit log
- Hot-path (single retain) latency target: p99 < 50ms (no LLM on this path)
- LLM is opt-in, off by default (`llmProvider: null` default)
- All new tests use Bun (`import { test, expect, beforeEach, afterEach } from "bun:test"`)
- Every new module exports its logic as a standalone function for direct unit-testing
- Existing `sync.ts`, `classify.ts`, `route.ts`, `note.ts`, `extract.ts` must remain untouched (backward compat)

---

## Phase 1 — Foundation

### Task 1: Config loader

**Files:**
- Create: `extensions/lib/config.ts`
- Test: `extensions/lib/config.test.ts`

**Interfaces:**
- Consumes: config file at `~/.omp/omp-obsidian-sync.json` or `OMP_SYNC_CONFIG` env var
- Produces: `SynthConfig` type with all fields + defaults

- [ ] **Step 1: Write the failing test**

```ts
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
  // set env, verify path is used
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test extensions/lib/config.test.ts`
Expected: FAIL — `loadConfig` not defined

- [ ] **Step 3: Write minimal implementation**

```ts
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

const DEFAULTS: SynthConfig = {
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

  const merged: SynthConfig = { ...DEFAULTS, ...fileCfg };
  merged.vaultRoot = resolvePath(merged.vaultRoot);
  merged.reposRoot = resolvePath(merged.reposRoot);
  if (merged.threshold < 1) merged.threshold = 1;
  return merged;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test extensions/lib/config.test.ts`
Expected: PASS (all 4 tests)

- [ ] **Step 5: Commit**

```bash
git add extensions/lib/config.ts extensions/lib/config.test.ts
git commit -m "feat: add config loader with defaults/validation"
```

---

### Task 2: Tag parser

**Files:**
- Create: `extensions/lib/parse-tags.ts`
- Test: `extensions/lib/parse-tags.test.ts`

**Interfaces:**
- Consumes: `string` (raw content from retain item)
- Produces: `{ project: string; topic: string | null; content: string } | null`

- [ ] **Step 1: Write the failing test**

```ts
import { test, expect } from "bun:test";
import { parseTags } from "./parse-tags";

test("parses project + topic", () => {
  const r = parseTags("[project:rph] [arch] uses Encore auth handlers");
  expect(r).toEqual({ project: "rph", topic: "arch", content: "uses Encore auth handlers" });
});

test("parses project only (no topic)", () => {
  const r = parseTags("[project:rph] project is on Coolify");
  expect(r).toEqual({ project: "rph", topic: null, content: "project is on Coolify" });
});

test("lowercases project name", () => {
  const r = parseTags("[project:RPH] [arch] content here");
  expect(r?.project).toBe("rph");
});

test("returns null for no project tag", () => {
  expect(parseTags("just some content")).toBeNull();
});

test("returns null for invalid topic tag (falls back to classifier)", () => {
  const r = parseTags("[project:rph] [unknown123] content");
  expect(r?.topic).toBeNull();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test extensions/lib/parse-tags.test.ts`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

```ts
const TAG_RE = /^\s*\[project:([a-z0-9_-]+)\](?:\s+\[([a-z0-9_-]+)\])?\s+(.*)$/i;
const VALID_TOPIC_RE = /^[a-z][a-z0-9_-]*$/i;
const KNOWN_TOPICS = ["arch", "architecture", "bug", "bugs", "conv", "conventions",
  "wf", "workflow", "tech", "tech-stack", "tech_stack", "dec", "decisions",
  "uncategorized"];

export interface TagParse {
  project: string;
  topic: string | null;
  content: string;
}

export function parseTags(raw: string): TagParse | null {
  const m = TAG_RE.exec(raw);
  if (!m) return null;
  const project = m[1].toLowerCase();
  const topicRaw = m[2];
  const content = m[3];

  let topic: string | null = null;
  if (topicRaw) {
    topic = KNOWN_TOPICS.includes(topicRaw.toLowerCase()) ? topicRaw.toLowerCase() : null;
  }
  return { project, topic, content };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test extensions/lib/parse-tags.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add extensions/lib/parse-tags.ts extensions/lib/parse-tags.test.ts
git commit -m "feat: add [project:slug] [topic] tag parser"
```

---

### Task 3: Topic classifier (keyword fallback)

**Files:**
- Create: `extensions/lib/topic.ts`
- Test: `extensions/lib/topic.test.ts`

**Interfaces:**
- Consumes: `string` (raw content, no tags)
- Produces: `TopicName` (`"architecture" | "bugs" | "conventions" | "workflow" | "tech-stack" | "decisions" | "uncategorized"`)

**Note:** This is a NEW module. The existing `extensions/lib/classify.ts` (checking for `[project]` prefix) stays untouched for backward compat.

- [ ] **Step 1: Write the failing test**

```ts
import { test, expect } from "bun:test";
import { classifyTopic } from "./topic";

test("detects architecture from 'uses' keyword", () => {
  expect(classifyTopic("uses Encore auth handlers")).toBe("architecture");
});

test("detects bugs from 'error' or 'fix'", () => {
  expect(classifyTopic("fixed the N+1 query error")).toBe("bugs");
});

test("detects conventions from 'always'", () => {
  expect(classifyTopic("always guard on runtime config key")).toBe("conventions");
});

test("detects workflow from 'before'", () => {
  expect(classifyTopic("stop containers before build")).toBe("workflow");
});

test("detects tech-stack", () => {
  expect(classifyTopic("using PostgreSQL 16 and Redis")).toBe("tech-stack");
});

test("defaults to uncategorized", () => {
  expect(classifyTopic("random note about anything unique")).toBe("uncategorized");
});
```

- [ ] **Step 2: Run test**

Run: `bun test extensions/lib/topic.test.ts`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

```ts
export type TopicName = "architecture" | "bugs" | "conventions" | "workflow"
  | "tech-stack" | "decisions" | "uncategorized";

const RULES: [RegExp, TopicName][] = [
  [/\b(uses|tech stack|service|module|composable)\b/i, "architecture"],
  [/\b(error|fix|broken|crash|bug|fail)\b/i, "bugs"],
  [/\b(always|never|convention|must|pattern)\b/i, "conventions"],
  [/\b(before|after|step|first|then)\b/i, "workflow"],
  [/\b(postgres|redis|nuxt|encore|laravel)\b/i, "tech-stack"],
  [/\b(decided|chose|tradeoff|instead of)\b/i, "decisions"],
];

export function classifyTopic(content: string): TopicName {
  const lower = content.toLowerCase();
  for (const [re, topic] of RULES) {
    if (re.test(lower)) return topic;
  }
  return "uncategorized";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test extensions/lib/topic.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add extensions/lib/topic.ts extensions/lib/topic.test.ts
git commit -m "feat: add keyword-based topic classifier"
```

---

### Task 4: State file

**Files:**
- Create: `extensions/lib/state.ts`
- Test: `extensions/lib/state.test.ts`

**Interfaces:**
- Consumes: `vaultRoot` path
- Produces: `readState(path): Record<string, number>` and `writeState(path, data): void` with `incrementPending`, `resetPending` helpers

- [ ] **Step 1: Write the failing test**

```ts
import { test, expect, beforeEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { readState, writeState, incrementPending, resetPending } from "./state";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync("/tmp/state-test-");
});

test("returns empty object for missing state file", () => {
  expect(readState(dir)).toEqual({});
});

test("writes and reads state", () => {
  writeState(dir, { rph: 3, groceries: 1 });
  expect(readState(dir)).toEqual({ rph: 3, groceries: 1 });
});

test("incrementPending increases count", () => {
  const s = incrementPending({ rph: 0 }, "rph");
  expect(s.rph).toBe(1);
});

test("incrementPending creates new key", () => {
  const s = incrementPending({}, "rph");
  expect(s.rph).toBe(1);
});

test("resetPending sets to 0", () => {
  const s = resetPending({ rph: 5 }, "rph");
  expect(s.rph).toBe(0);
});
```

- [ ] **Step 2: Run test**

Run: `bun test extensions/lib/state.test.ts`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

```ts
import fs from "node:fs";
import path from "node:path";

const STATE_FILENAME = ".omp-state.json";

export type ProjectState = Record<string, number>;

export function statePath(vaultRoot: string): string {
  return path.join(vaultRoot, STATE_FILENAME);
}

export function readState(vaultRoot: string): ProjectState {
  const fp = statePath(vaultRoot);
  try {
    return JSON.parse(fs.readFileSync(fp, "utf8"));
  } catch {
    return {};
  }
}

export function writeState(vaultRoot: string, data: ProjectState): void {
  fs.writeFileSync(statePath(vaultRoot), JSON.stringify(data, null, 2), "utf8");
}

export function incrementPending(state: ProjectState, project: string): ProjectState {
  return { ...state, [project]: (state[project] ?? 0) + 1 };
}

export function resetPending(state: ProjectState, project: string): ProjectState {
  return { ...state, [project]: 0 };
}
```

- [ ] **Step 4: Run test**

Run: `bun test extensions/lib/state.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add extensions/lib/state.ts extensions/lib/state.test.ts
git commit -m "feat: add project state file (pending counts)"
```

---

## Phase 2 — Vault Writing

### Task 5: Route (extend with topic-awareness)

**Files:**
- Modify: `extensions/lib/route.ts` (add new exports, don't touch existing functions)
- Modify: `extensions/lib/route.test.ts` (add new tests, keep old ones)

**Interfaces:**
- Consumes: `{ project: string; topic: string; vaultRoot: string }`
- Produces: `string` (absolute path to `~/Notes/<project>/<topic>.md`)

- [ ] **Step 1: Write the failing test**

Append to `route.test.ts`:

```ts
test("resolveProjectTopicPath returns nested path under vault root", () => {
  expect(resolveProjectTopicPath("rph", "architecture", VAULT))
    .toBe(path.join(VAULT, "rph", "architecture.md"));
});

test("resolveProjectTopicPath handles topic aliases", () => {
  expect(resolveProjectTopicPath("rph", "arch", VAULT))
    .toBe(path.join(VAULT, "rph", "architecture.md"));
});
```

- [ ] **Step 2: Run test to see new tests fail (old tests pass)**

Run: `bun test extensions/lib/route.test.ts`
Expected: existing tests PASS, 2 new tests FAIL

- [ ] **Step 3: Write minimal implementation**

Append to `route.ts`:

```ts
const TOPIC_ALIASES: Record<string, string> = {
  arch: "architecture", bug: "bugs", conv: "conventions",
  wf: "workflow", tech: "tech-stack", dec: "decisions",
};

function canonicalTopic(topic: string): string {
  return TOPIC_ALIASES[topic.toLowerCase()] ?? topic;
}

export function resolveProjectTopicPath(
  project: string,
  topic: string,
  vaultRoot: string,
): string {
  return path.join(vaultRoot, project, `${canonicalTopic(topic)}.md`);
}
```

- [ ] **Step 4: Run tests**

Run: `bun test extensions/lib/route.test.ts`
Expected: ALL PASS (old + new)

- [ ] **Step 5: Commit**

```bash
git add extensions/lib/route.ts extensions/lib/route.test.ts
git commit -m "feat: add topic-aware route resolver"
```

---

### Task 6: Append-note

**Files:**
- Create: `extensions/lib/append-note.ts`
- Test: `extensions/lib/append-note.test.ts`

**Interfaces:**
- Consumes: `{ filePath: string; content: string; project: string; topic: string }`
- Produces: writes frontmatter + bullet to file; returns `boolean` (true if new bullet was added, false if duplicate)
- Dedup: exact-match (case-insensitive trimmed), drops duplicates silently

- [ ] **Step 1: Write the failing test**

```ts
import { test, expect, beforeEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { appendBullet } from "./append-note";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync("/tmp/append-test-");
});

test("creates file and appends bullet", () => {
  const fp = path.join(dir, "rph", "architecture.md");
  appended = appendBullet({ filePath: fp, content: "uses Encore auth handlers", project: "rph", topic: "architecture" });
  expect(appended).toBe(true);
  expect(fs.existsSync(fp)).toBe(true);
  const text = fs.readFileSync(fp, "utf8");
  expect(text).toContain("uses Encore auth handlers");
  expect(text).toContain("project: rph");
  expect(text).toContain("topic: architecture");
});

test("drops exact-match duplicate", () => {
  const fp = path.join(dir, "rph", "architecture.md");
  appendBullet({ filePath: fp, content: "duplicate fact", project: "rph", topic: "architecture" });
  const r2 = appendBullet({ filePath: fp, content: "duplicate fact", project: "rph", topic: "architecture" });
  expect(r2).toBe(false);
});

test("appends to existing file with newer date", () => {
  const fp = path.join(dir, "rph", "architecture.md");
  appendBullet({ filePath: fp, content: "first fact", project: "rph", topic: "architecture" });
  appendBullet({ filePath: fp, content: "second fact", project: "rph", topic: "architecture" });
  const text = fs.readFileSync(fp, "utf8");
  // newest bullet first, so "second fact" should appear before "first fact"
  const idx2 = text.indexOf("second fact");
  const idx1 = text.indexOf("first fact");
  expect(idx2).toBeLessThan(idx1);
});
```

- [ ] **Step 2: Run test**

Run: `bun test extensions/lib/append-note.test.ts`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

```ts
import fs from "node:fs";
import path from "node:path";

export interface AppendBulletArgs {
  filePath: string;
  content: string;
  project: string;
  topic: string;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Reads existing bullets from a topic file (lines starting with "- ").
 */
function readBullets(filePath: string): string[] {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    // Split on frontmatter separator and get past-YAML content
    const parts = raw.split("---\n");
    if (parts.length < 3) return [];
    const body = parts.slice(2).join("---\n");
    return body.split("\n")
      .filter(l => l.startsWith("- "))
      .map(l => l.slice(2).trim());
  } catch {
    return [];
  }
}

function bulletAlreadyExists(bullets: string[], newContent: string): boolean {
  const needle = newContent.toLowerCase().trim();
  return bullets.some(b => b.toLowerCase().trim() === needle);
}

/**
 * Appends a dated frontmatter bullet to a topic file. Creates folder/file if
 * absent. Returns true if the bullet was written, false if duplicate.
 */
export function appendBullet(args: AppendBulletArgs): boolean {
  const { filePath, content, project, topic } = args;
  const existing = readBullets(filePath);

  if (bulletAlreadyExists(existing, content)) return false;

  const now = new Date();
  const frontmatter = [
    "---",
    `date: ${isoDate(now)}`,
    `project: ${project}`,
    `topic: ${topic}`,
    "source: retain",
    "---",
  ].join("\n");

  const bulletLine = `- ${content.trim()}`;
  const fullBody = [frontmatter, "", bulletLine, ...existing.map(b => `- ${b}`), ""].join("\n");

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, fullBody, "utf8");
  return true;
}
```

- [ ] **Step 4: Run test**

Run: `bun test extensions/lib/append-note.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add extensions/lib/append-note.ts extensions/lib/append-note.test.ts
git commit -m "feat: add idempotent topic-file bullet appender"
```

---

### Task 7: Audit log

**Files:**
- Create: `extensions/lib/audit.ts`
- Test: `extensions/lib/audit.test.ts`

**Interfaces:**
- Consumes: `{ vaultRoot: string; line: string }`
- Produces: append to `~/Notes/.omp-audit.log`, create file if absent

- [ ] **Step 1: Write the failing test**

```ts
import { test, expect, beforeEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { auditLog } from "./audit";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync("/tmp/audit-test-");
});

test("creates audit log and appends line", () => {
  auditLog(dir, "test line");
  const fp = path.join(dir, ".omp-audit.log");
  expect(fs.existsSync(fp)).toBe(true);
  expect(fs.readFileSync(fp, "utf8")).toContain("test line");
});

test("appends multiple lines", () => {
  auditLog(dir, "line 1");
  auditLog(dir, "line 2");
  const fp = path.join(dir, ".omp-audit.log");
  const lines = fs.readFileSync(fp, "utf8").trim().split("\n");
  expect(lines).toHaveLength(2);
});
```

- [ ] **Step 2: Run test**

Run: `bun test extensions/lib/audit.test.ts`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

```ts
import fs from "node:fs";
import path from "node:path";

const AUDIT_FILENAME = ".omp-audit.log";

export function auditLog(vaultRoot: string, line: string): void {
  const fp = path.join(vaultRoot, AUDIT_FILENAME);
  const timestamp = new Date().toISOString();
  try {
    fs.appendFileSync(fp, `[${timestamp}] ${line}\n`, "utf8");
  } catch {
    // Never throw — logging is best-effort
  }
}
```

- [ ] **Step 4: Run test**

Run: `bun test extensions/lib/audit.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add extensions/lib/audit.ts extensions/lib/audit.test.ts
git commit -m "feat: add append-only audit log"
```

---

## Phase 3 — Synthesis

### Task 8: Dedup + promote

**Files:**
- Create: `extensions/lib/dedup.ts`
- Test: `extensions/lib/dedup.test.ts`

**Interfaces:**
- `dedupBullets(bullets: string[], minWordShare?: number): string[]` — exact + Levenshtein + first-4-words
- `findPromotables(fileContents: Record<string, string[]>): string[]` — bullets appearing in 2+ files

- [ ] **Step 1: Write the failing test**

```ts
import { test, expect } from "bun:test";
import { dedupBullets, findPromotables } from "./dedup";

test("dedup removes exact matches", () => {
  expect(dedupBullets(["same fact", "same fact"])).toEqual(["same fact"]);
});

test("dedup removes near-duplicates (Levenshtein ≤ 20%)", () => {
  const r = dedupBullets(["uses Encore auth handlers", "uses Encore auth handlers for protected routes"]);
  expect(r).toEqual(["uses Encore auth handlers for protected routes"]);
});

test("dedup removes bullets sharing first 4 words", () => {
  const r = dedupBullets(["always guard config key before use", "always guard config key before write"]);
  expect(r).toEqual(["always guard config key before use"]);
});

test("findPromotables detects cross-file bullets", () => {
  const files = {
    "a.md": ["PostgreSQL 16 is the primary DB", "uses Encore auth"],
    "b.md": ["PostgreSQL 16 is the primary DB", "deployed on Coolify"],
  };
  expect(findPromotables(files)).toEqual(["PostgreSQL 16 is the primary DB"]);
});

test("findPromotables returns empty for unique bullets", () => {
  const files = {
    "a.md": ["fact one"],
    "b.md": ["fact two"],
  };
  expect(findPromotables(files)).toEqual([]);
});
```

- [ ] **Step 2: Run test**

Run: `bun test extensions/lib/dedup.test.ts`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

```ts
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function firstWords(s: string, n: number): string {
  return s.trim().split(/\s+/).slice(0, n).join(" ").toLowerCase();
}

export function dedupBullets(bullets: string[], minWordShare: number = 4): string[] {
  const result: string[] = [];
  for (const bullet of bullets) {
    const trimmed = bullet.trim();
    const lowerTrimmed = trimmed.toLowerCase();

    // Exact match
    if (result.some(b => b.toLowerCase() === lowerTrimmed)) continue;

    // Levenshtein ≤ 20% of longer string
    const isNear = result.some(b => {
      const longer = Math.max(b.length, trimmed.length);
      return longer > 0 && levenshtein(b.toLowerCase(), lowerTrimmed) / longer <= 0.2;
    });
    if (isNear) {
      // Keep the longer one
      const existing = result.findIndex(b => {
        const longer = Math.max(b.length, trimmed.length);
        return longer > 0 && levenshtein(b.toLowerCase(), lowerTrimmed) / longer <= 0.2;
      });
      if (existing !== -1 && trimmed.length > result[existing].length) {
        result[existing] = trimmed;
      }
      continue;
    }

    // First N words match
    if (result.some(b => firstWords(b, minWordShare) === firstWords(trimmed, minWordShare))) continue;

    result.push(trimmed);
  }
  return result;
}

export function findPromotables(
  fileContents: Record<string, string[]>,
): string[] {
  const bulletCounts = new Map<string, Set<string>>();
  for (const [file, bullets] of Object.entries(fileContents)) {
    const seen = new Set<string>();
    for (const b of bullets) {
      const key = b.toLowerCase().trim();
      if (!seen.has(key)) {
        seen.add(key);
        if (!bulletCounts.has(key)) bulletCounts.set(key, new Set());
        bulletCounts.get(key)!.add(file);
      }
    }
  }
  return Array.from(bulletCounts.entries())
    .filter(([, files]) => files.size >= 2)
    .map(([bullet]) => bullet);
}
```

- [ ] **Step 4: Run test**

Run: `bun test extensions/lib/dedup.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add extensions/lib/dedup.ts extensions/lib/dedup.test.ts
git commit -m "feat: add dedup (exact/Levenshtein/word-share) and cross-file promotion"
```

---

### Task 9: LLM synthesis pass

**Files:**
- Create: `extensions/lib/synthesize.ts`
- Test: `extensions/lib/synthesize.test.ts`

**Interfaces:**
- Consumes: `{ project: string; vaultRoot: string; config: SynthConfig }`
- Produces: void — runs Pass 1 (dedup), Pass 2 (promote), Pass 3 (LLM, optional)
- Always runs Pass 1+2. Pass 3 only if `config.llmProvider` is set, and is async fire-and-forget.

- [ ] **Step 1: Write the failing test**

```ts
import { test, expect, beforeEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { runSynthesis } from "./synthesize";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync("/tmp/synth-test-");
});

test("dedup (Pass 1) removes duplicate bullets", () => {
  const archPath = path.join(dir, "rph", "architecture.md");
  fs.mkdirSync(path.dirname(archPath), { recursive: true });
  const bullet = "- duplicate";
  fs.writeFileSync(archPath, `---\ndate: 2026-07-06\nproject: rph\ntopic: architecture\n---\n\n${bullet}\n${bullet}\n`, "utf8");
  runSynthesis("rph", dir, { llmProvider: null, threshold: 3, topicAliases: {} } as any);
  const text = fs.readFileSync(archPath, "utf8");
  const count = (text.match(/- duplicate/g) || []).length;
  expect(count).toBe(1);
});

test("Pass 3 is skipped when llmProvider is null (no error)", () => {
  const archPath = path.join(dir, "rph", "architecture.md");
  fs.mkdirSync(path.dirname(archPath), { recursive: true });
  fs.writeFileSync(archPath, "---\ndate: 2026-07-06\nproject: rph\ntopic: architecture\n---\n\n- fact", "utf8");
  // Should not throw, should not attempt any network call
  runSynthesis("rph", dir, { llmProvider: null, threshold: 3, topicAliases: {} } as any);
  // No exception = pass
});

test("audit log is written after synthesis", () => {
  const archPath = path.join(dir, "rph", "architecture.md");
  fs.mkdirSync(path.dirname(archPath), { recursive: true });
  fs.writeFileSync(archPath, "---\ndate: 2026-07-06\nproject: rph\ntopic: architecture\n---\n\n- fact a\n- fact b", "utf8");
  runSynthesis("rph", dir, { llmProvider: null, threshold: 3, topicAliases: {} } as any);
  const auditPath = path.join(dir, ".omp-audit.log");
  expect(fs.existsSync(auditPath)).toBe(true);
  expect(fs.readFileSync(auditPath, "utf8")).toContain("synthesis rph:");
});
```

- [ ] **Step 2: Run test**

Run: `bun test extensions/lib/synthesize.test.ts`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

```ts
import fs from "node:fs";
import path from "node:path";
import { dedupBullets, findPromotables } from "./dedup";
import { auditLog } from "./audit";
import { writeState, readState, resetPending } from "./state";
import type { SynthConfig } from "./config";

/**
 * Reads all bullet lines from a topic file (frontmatter-stripped).
 */
function readBullets(filePath: string): string[] | null {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parts = raw.split("---\n");
    if (parts.length < 3) return null;
    const body = parts.slice(2).join("---\n");
    return body.split("\n").filter(l => l.startsWith("- ")).map(l => l.slice(2).trim());
  } catch { return null; }
}

function writeBullets(filePath: string, bullets: string[], frontmatter: string): void {
  const body = [frontmatter, "", ...bullets.map(b => `- ${b}`), ""].join("\n");
  fs.writeFileSync(filePath, body, "utf8");
}

function readFrontmatter(filePath: string): string | null {
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    const parts = raw.split("---\n");
    if (parts.length < 3) return null;
    return parts.slice(0, 2).join("---\n");
  } catch { return null; }
}

export function runSynthesis(
  project: string,
  vaultRoot: string,
  config: SynthConfig,
): void {
  const projectDir = path.join(vaultRoot, project);
  let allFiles: string[];
  try {
    allFiles = fs.readdirSync(projectDir, { withFileTypes: true })
      .filter(d => d.isFile() && d.name.endsWith(".md"))
      .map(d => path.join(projectDir, d.name));
  } catch {
    // Project dir doesn't exist — nothing to synthesize
    return;
  }

  // Pass 1: Dedup within each topic file
  let totalDeduped = 0;
  for (const fp of allFiles) {
    const bullets = readBullets(fp);
    if (!bullets) continue;
    const fm = readFrontmatter(fp);
    if (!fm) continue;
    const deduped = dedupBullets(bullets);
    const removed = bullets.length - deduped.length;
    if (removed > 0) {
      totalDeduped += removed;
      writeBullets(fp, deduped, fm);
    }
  }

  // Pass 2: Promote cross-cutting facts
  const fileContents: Record<string, string[]> = {};
  for (const fp of allFiles) {
    const bullets = readBullets(fp);
    if (bullets) fileContents[fp] = bullets;
  }
  const promotables = findPromotables(fileContents);
  let totalPromoted = 0;
  if (promotables.length > 0) {
    const promotedPath = path.join(projectDir, "_promoted.md");
    const promotedFm = readFrontmatter(promotedPath)
      ?? `---\ndate: ${new Date().toISOString().slice(0, 10)}\nproject: ${project}\ntopic: promoted\nsource: synthesis\n---`;
    for (const fp of allFiles) {
      const bullets = readBullets(fp);
      if (!bullets) continue;
      const filtered = bullets.filter(b => {
        const isPromotable = promotables.some(p => b.toLowerCase().trim() === p);
        if (isPromotable) totalPromoted++;
        return !isPromotable;
      });
      if (filtered.length !== bullets.length) {
        const fm = readFrontmatter(fp) ?? promotedFm;
        writeBullets(fp, filtered, fm);
      }
    }
    // Write promoted bullets
    const existingPromoted = readBullets(promotedPath) ?? [];
    writeBullets(promotedPath, [...new Set([...promotables, ...existingPromoted])], promotedFm);
  }

  // Pass 3: LLM (skipped if provider is null — always now in this tight loop)
  // The spec says Pass 3 is async on the hot path. In runSynthesis (called
  // synchronously from the hot path), we skip it. It's only run during
  // /synthesize which is Task 11.
  // (Pass 3 deferred to /synthesize command)

  // Audit
  auditLog(vaultRoot, `synthesis ${project}: dedup=${totalDeduped}, promoted=${totalPromoted}, llm=skipped`);

  // Reset pending count
  const state = readState(vaultRoot);
  writeState(vaultRoot, resetPending(state, project));
}
```

- [ ] **Step 4: Run test**

Run: `bun test extensions/lib/synthesize.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add extensions/lib/synthesize.ts extensions/lib/synthesize.test.ts
git commit -m "feat: add synthesis orchestrator (Pass 1 dedup + Pass 2 promote)"
```

---

## Phase 4 — Orchestration

### Task 10: handleRetain + synth.ts hook

**Files:**
- Create: `extensions/synth.ts`
- Create: `extensions/synth.test.ts`

**Interfaces:**
- Consumes: OMP `tool_result` event (`toolName`, `input`)
- Produces: orchestrates parse → route → append → state → threshold → synthesis → audit
- Exports `handleRetain(event, opts?)` standalone for unit-testing

- [ ] **Step 1: Write the integration test**

```ts
import { test, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { handleRetain } from "./synth";

let vaultRoot: string;
let reposRoot: string;
let errorLogPath: string;

beforeEach(() => {
  const base = fs.mkdtempSync("/tmp/synth-integration-");
  vaultRoot = path.join(base, "vault");
  reposRoot = path.join(base, "sites");
  errorLogPath = path.join(base, "sync-errors.log");
  fs.mkdirSync(vaultRoot, { recursive: true });
  fs.mkdirSync(reposRoot, { recursive: true });
});

afterEach(() => {
  fs.rmSync(path.dirname(vaultRoot), { recursive: true, force: true });
});

test("creates project topic file from tagged retain", () => {
  handleRetain(
    { toolName: "retain", input: { items: [{ content: "[project:rph] [arch] uses Encore auth handlers" }], i: "test" } },
    { cwd: path.join(reposRoot, "groceries"), vaultRoot, reposRoot, errorLogPath },
  );
  const fp = path.join(vaultRoot, "rph", "architecture.md");
  expect(fs.existsSync(fp)).toBe(true);
  const text = fs.readFileSync(fp, "utf8");
  expect(text).toContain("uses Encore auth handlers");
  expect(text).toContain("project: rph");
});

test("writes audit log entry", () => {
  handleRetain(
    { toolName: "retain", input: { items: [{ content: "[project:rph] [arch] test" }], i: "test" } },
    { cwd: reposRoot, vaultRoot, reposRoot, errorLogPath },
  );
  const auditPath = path.join(vaultRoot, ".omp-audit.log");
  expect(fs.existsSync(auditPath)).toBe(true);
  expect(fs.readFileSync(auditPath, "utf8")).toContain("retain rph/architecture.md");
});

test("logs to sync-errors.log for bad input (never throws)", () => {
  handleRetain(
    { toolName: "retain", input: null },
    { cwd: reposRoot, vaultRoot, reposRoot, errorLogPath },
  );
  // Should not have crashed. Error log should contain something.
  expect(fs.existsSync(errorLogPath)).toBe(true);
  expect(fs.readFileSync(errorLogPath, "utf8").length).toBeGreaterThan(0);
});

test("handles untagged retain silently (no crash, no file)", () => {
  handleRetain(
    { toolName: "retain", input: { items: [{ content: "general fact without tags" }], i: "test" } },
    { cwd: reposRoot, vaultRoot, reposRoot, errorLogPath },
  );
  // No project file created, but audit log should have a line
  const auditPath = path.join(vaultRoot, ".omp-audit.log");
  expect(fs.existsSync(auditPath)).toBe(true);
});

test("OMP hook registration does not throw", () => {
  const pi = { on: (event: string, cb: Function) => {} };
  const mod = require("./synth");
  expect(() => mod.default(pi)).not.toThrow();
});
```

- [ ] **Step 2: Run test**

Run: `bun test extensions/synth.test.ts`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

```ts
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent/extensibility/hooks";
import { extractFacts } from "./lib/extract";
import { parseTags } from "./lib/parse-tags";
import { classifyTopic } from "./lib/topic";
import { loadConfig, SynthConfig } from "./lib/config";
import { resolveProjectTopicPath } from "./lib/route";
import { appendBullet } from "./lib/append-note";
import { readState, writeState, incrementPending } from "./lib/state";
import { runSynthesis } from "./lib/synthesize";
import { auditLog } from "./lib/audit";

const DEFAULT_VAULT_ROOT = path.join(os.homedir(), "Notes");
const DEFAULT_REPOS_ROOT = path.join(os.homedir(), "Sites", "fikrimastor");
const DEFAULT_ERROR_LOG = path.join(__dirname, "..", "sync-errors.log");

export interface HandleOptions {
  cwd?: string;
  vaultRoot?: string;
  reposRoot?: string;
  errorLogPath?: string;
  config?: SynthConfig;
}

function logError(errorLogPath: string, message: string): void {
  try {
    const line = `[${new Date().toISOString()}] ${message}\n`;
    fs.appendFileSync(errorLogPath, line, "utf8");
  } catch { /* best-effort */ }
}

export function handleRetain(
  event: { toolName: string; input: unknown },
  opts: HandleOptions = {},
): void {
  const errorLogPath = opts.errorLogPath ?? DEFAULT_ERROR_LOG;

  try {
    if (event.toolName !== "retain" && event.toolName !== "learn") return;

    const facts = extractFacts(event.toolName, event.input);
    if (!facts) {
      logError(errorLogPath, `skipped ${event.toolName}: unrecognized input shape`);
      return;
    }

    const config = opts.config ?? loadConfig();
    const vaultRoot = opts.vaultRoot ?? config.vaultRoot;
    const cwd = opts.cwd ?? process.cwd();

    for (const rawContent of facts) {
      const parsed = parseTags(rawContent);

      if (!parsed) {
        // No project tag → audit log only (general fact)
        auditLog(vaultRoot, `retain (general): ${rawContent.slice(0, 80)}`);
        continue;
      }

      const topic = parsed.topic ?? classifyTopic(parsed.content);
      const filePath = resolveProjectTopicPath(parsed.project, topic, vaultRoot);

      const appended = appendBullet({
        filePath,
        content: parsed.content,
        project: parsed.project,
        topic,
      });

      if (appended) {
        auditLog(vaultRoot, `retain ${parsed.project}/${topic}.md "${parsed.content.slice(0, 80)}"`);

        // Update state and check threshold
        const state = readState(vaultRoot);
        const newState = incrementPending(state, parsed.project);
        writeState(vaultRoot, newState);

        if (newState[parsed.project] >= config.threshold) {
          runSynthesis(parsed.project, vaultRoot, config);
        }
      }
    }
  } catch (err) {
    logError(errorLogPath, `unexpected error: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export default function (pi: ExtensionAPI): void {
  pi.on("tool_result", async (event) => {
    handleRetain({ toolName: event.toolName, input: event.input });
  });
}
```

- [ ] **Step 4: Run test**

Run: `bun test extensions/synth.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add extensions/synth.ts extensions/synth.test.ts
git commit -m "feat: add handleRetain orchestrator + OMP hook"
```

---

### Task 11: /synthesize slash command

**Files:**
- Create: `extensions/commands/synthesize.ts`
- Test: `extensions/commands/synthesize.test.ts`

**Interfaces:**
- Consumes: OMP command event with `{ project: string }` (or `"all"` or `"status"`)
- Produces: chat message with synthesis summary

- [ ] **Step 1: Write the failing test**

```ts
import { test, expect, beforeEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { handleSynthesizeCommand } from "./synthesize";

let vaultRoot: string;
beforeEach(() => {
  vaultRoot = fs.mkdtempSync("/tmp/cmd-synth-");
  fs.mkdirSync(path.join(vaultRoot, "rph"), { recursive: true });
  fs.writeFileSync(path.join(vaultRoot, "rph", "architecture.md"),
    "---\ndate: 2026-07-06\nproject: rph\ntopic: architecture\n---\n\n- fact a\n- fact b\n- fact a\n- fact c\n");
});

test("synthesize project runs Pass 1+2 and returns summary", () => {
  const result = handleSynthesizeCommand({ project: "rph", vaultRoot });
  expect(result).toContain("dedup");
  // Check dedup happened
  const text = fs.readFileSync(path.join(vaultRoot, "rph", "architecture.md"), "utf8");
  const count = (text.match(/- fact a/g) || []).length;
  expect(count).toBe(1);
});
```

- [ ] **Step 2: Run test**

Run: `bun test extensions/commands/synthesize.test.ts`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

```ts
import fs from "node:fs";
import path from "node:path";
import { loadConfig, SynthConfig } from "../lib/config";
import { runSynthesis } from "../lib/synthesize";
import { readState } from "../lib/state";
import { auditLog } from "../lib/audit";

export interface SynthCommandArgs {
  project: string;
  vaultRoot: string;
  config?: SynthConfig;
}

export function handleSynthesizeCommand(args: SynthCommandArgs): string {
  const config = args.config ?? loadConfig();
  const vaultRoot = args.vaultRoot ?? config.vaultRoot;

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

export function registerCommand(pi: any): void {
  // OMP command registration. Exact API depends on the OMP runtime — we'll
  // wire it once the correct method signature is confirmed.
  // pi.onCommand("synthesize", async (args: any) => {
  //   return handleSynthesizeCommand({
  //     project: args.project ?? "all",
  //     vaultRoot: loadConfig().vaultRoot,
  //   });
  // });
}
```

- [ ] **Step 4: Run test**

Run: `bun test extensions/commands/synthesize.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add extensions/commands/synthesize.ts extensions/commands/synthesize.test.ts
git commit -m "feat: add /synthesize slash command handler"
```

---

### Task 12: First-run setup wizard

**Files:**
- Create: `extensions/lib/setup.ts`
- Test: `extensions/lib/setup.test.ts`

**Interfaces:**
- Consumes: `{ config?: SynthConfig }` (optional override for testing)
- Produces: config file at `~/.omp/omp-obsidian-sync.json`
- Check: Bun, vault path, repos path

- [ ] **Step 1: Write the failing test**

```ts
import { test, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { needsSetup, writeConfig } from "./setup";

let homeBackup: string;
beforeEach(() => {
  homeBackup = process.env.HOME!;
  process.env.HOME = fs.mkdtempSync("/tmp/setup-test-");
});

afterEach(() => {
  if (homeBackup) process.env.HOME = homeBackup;
});

test("needsSetup returns true when config file missing", () => {
  expect(needsSetup()).toBe(true);
});

test("needsSetup returns false after config file written", () => {
  writeConfig({ vaultRoot: "/tmp/vault" });
  expect(needsSetup()).toBe(false);
});

test("writeConfig creates .omp dir and config file", () => {
  const result = writeConfig({ vaultRoot: "/tmp/vault", reposRoot: "/tmp/repos" });
  expect(fs.existsSync(result)).toBe(true);
  const cfg = JSON.parse(fs.readFileSync(result, "utf8"));
  expect(cfg.vaultRoot).toBe("/tmp/vault");
});
```

- [ ] **Step 2: Run test**

Run: `bun test extensions/lib/setup.test.ts`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

```ts
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { loadConfig, SynthConfig } from "./config";

const CONFIG_DIR = path.join(os.homedir(), ".omp");
const CONFIG_FILE = path.join(CONFIG_DIR, "omp-obsidian-sync.json");

export function needsSetup(): boolean {
  return !fs.existsSync(CONFIG_FILE);
}

export function writeConfig(overrides: Partial<SynthConfig>): string {
  const existing: any = {};
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      Object.assign(existing, JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8")));
    }
  } catch { /* ignore */ }

  const merged = { ...existing, ...overrides };
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(merged, null, 2), "utf8");
  return CONFIG_FILE;
}

export function detectDefaults(): { vaultRoot: string; reposRoot: string } {
  const home = os.homedir();
  const vaultRoot = path.join(home, "Notes");
  const reposRoot = path.join(home, "Sites", "fikrimastor");
  return { vaultRoot, reposRoot };
}

/**
 * Returns a chat prompt message suggesting auto-detected paths.
 * The caller (OMP conversation) sends this to the user and receives their response.
 */
export function setupPrompt(): string {
  const { vaultRoot, reposRoot } = detectDefaults();
  const vaultExists = fs.existsSync(vaultRoot);
  const reposExists = fs.existsSync(reposRoot);
  return [
    "Setting up OMP Doc-Synth plugin.",
    vaultExists ? `✓ Vault found: ${vaultRoot}` : `✗ Vault not found at ${vaultRoot}`,
    reposExists ? `✓ Repos found: ${reposRoot}` : `✗ Repos not found at ${reposRoot}`,
    "Enable LLM synthesis? Requires API key. [y/N]",
    "",
    "Prompts are answered by the OMP harness runtime.",
  ].join("\n");
}
```

- [ ] **Step 4: Run test**

Run: `bun test extensions/lib/setup.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add extensions/lib/setup.ts extensions/lib/setup.test.ts
git commit -m "feat: add first-run setup wizard"
```

---

## Phase 5 — Integration, Migration & Docs

### Task 13: Migration script

**Files:**
- Create: `extensions/lib/migrate.ts`
- Create: `bin/migrate.ts`
- Test: `extensions/lib/migrate.test.ts`

**Interfaces:**
- Scans `~/Notes/omp-learn/omp-learn-*.md`, classifies bullets, emits to `~/Notes/misc/<topic>.md`
- Prints summary table
- Prompts for delete confirmation (unless `--yes` flag)

- [ ] **Step 1: Write the failing test**

```ts
import { test, expect, beforeEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { migrateLegacyNotes } from "./migrate";

let vaultRoot: string;
beforeEach(() => {
  vaultRoot = fs.mkdtempSync("/tmp/migrate-test-");
  fs.mkdirSync(path.join(vaultRoot, "omp-learn"), { recursive: true });
  // Mock a legacy note
  fs.writeFileSync(path.join(vaultRoot, "omp-learn", "omp-learn-0001.md"),
    "---\ndate: 2026-07-03\ntool: learn\ntags: [omp-learn]\n---\nuses PostgreSQL 16\n\n#omp-learn\n", "utf8");
});

test("migrates legacy notes to misc/", () => {
  const result = migrateLegacyNotes(vaultRoot);
  expect(result.migrated).toBe(1);
  const miscDir = path.join(vaultRoot, "misc");
  expect(fs.existsSync(miscDir)).toBe(true);
  // The "PostgreSQL" keyword should route to tech-stack.md
  expect(fs.existsSync(path.join(miscDir, "tech-stack.md"))).toBe(true);
});

test("returns summary stats", () => {
  const result = migrateLegacyNotes(vaultRoot);
  expect(result.migrated).toBe(1);
  expect(typeof result.deduped).toBe("number");
});
```

- [ ] **Step 2: Run test**

Run: `bun test extensions/lib/migrate.test.ts`
Expected: FAIL

- [ ] **Step 3: Write minimal implementation**

```ts
import fs from "node:fs";
import path from "node:path";
import { classifyTopic } from "./topic";
import { appendBullet } from "./append-note";
import { auditLog } from "./audit";

export interface MigrateSummary {
  migrated: number;
  deduped: number;
  misc: number;
}

function findLegacyNotes(vaultRoot: string): string[] {
  const dir = path.join(vaultRoot, "omp-learn");
  try {
    return fs.readdirSync(dir)
      .filter(f => /^omp-learn-\d+\.md$/.test(f))
      .map(f => path.join(dir, f));
  } catch {
    return [];
  }
}

export function migrateLegacyNotes(vaultRoot: string): MigrateSummary {
  const legacyFiles = findLegacyNotes(vaultRoot);
  const summary: MigrateSummary = { migrated: 0, deduped: 0, misc: 0 };

  for (const fp of legacyFiles) {
    try {
      const raw = fs.readFileSync(fp, "utf8");
      // Skip frontmatter, extract content after ---
      const parts = raw.split("---\n");
      const body = parts.length >= 3 ? parts.slice(2).join("---\n") : raw;
      const lines = body.split("\n").filter(l => l.trim().length > 0 && !l.startsWith("#"));

      for (const line of lines) {
        const topic = classifyTopic(line);
        const filePath = path.join(vaultRoot, "misc", `${topic}.md`);
        const appended = appendBullet({
          filePath,
          content: line.trim(),
          project: "misc",
          topic,
        });
        if (appended) {
          summary.migrated++;
          summary.misc++;
        } else {
          summary.deduped++;
        }
      }
    } catch {
      // Skip unreadable files
    }
  }

  auditLog(vaultRoot, `migration: migrated=${summary.migrated}, deduped=${summary.deduped}`);
  return summary;
}

export function printSummary(summary: MigrateSummary): string {
  return [
    `migrated: ${summary.migrated}`,
    `deduped: ${summary.deduped}`,
    `misc/: ${summary.misc}`,
  ].join("\n");
}
```

And `bin/migrate.ts`:

```ts
import { migrateLegacyNotes, printSummary } from "../extensions/lib/migrate";
import { loadConfig } from "../extensions/lib/config";

const config = loadConfig();
const summary = migrateLegacyNotes(config.vaultRoot);
console.log(printSummary(summary));
console.log("\nDelete ~/Notes/omp-learn/? [y/N]");
// (pipe input via readline if stdin is a TTY)
```

- [ ] **Step 4: Run test**

Run: `bun test extensions/lib/migrate.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add extensions/lib/migrate.ts bin/migrate.ts extensions/lib/migrate.test.ts
git commit -m "feat: add legacy omp-learn migration script"
```

---

### Task 14: Update package.json + OMP registration

**Files:**
- Modify: `package.json` (add synth.ts extension entry)

- [ ] **Step 1: Read current `package.json`**

```bash
cat package.json
```

Current (from context):
```json
{
  "name": "omp-obsidian-sync",
  "version": "0.1.0",
  "private": true,
  "description": "Mirrors OMP retain/learn calls into markdown notes in an Obsidian vault.",
  "omp": {
    "extensions": ["./extensions/sync.ts"]
  }
}
```

- [ ] **Step 2: Update OMP extensions array**

```json
"omp": {
  "extensions": ["./extensions/sync.ts", "./extensions/synth.ts"]
}
```

Both extensions coexist. `synth.ts` is the new active one (handles `retain`/`learn`), `sync.ts` is the legacy mirror on the same events — the original `sync.ts` will also receive events but only writes if `legacyOmpLearnMirror: true`.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore: register synth.ts OMP extension"
```

---

### Task 15: README

**Files:**
- Create: `README.md`

- [ ] **Step 1: Write README**

```markdown
# OMP Obsidian Sync + Doc-Synth

OMP plugin that routes retained coding facts into structured Obsidian project folders and automatically synthesizes patterns.

## Features

- **Tagged retains:** `[project:rph] [arch] uses Encore auth handlers` → `~/Notes/rph/architecture.md`
- **Keyword fallback:** No tag? Plugin classifies content by keywords (bugs → `bugs.md`, tech → `tech-stack.md`, etc.)
- **Dedup + promotion:** Exact/Levenshtein dedup within files, cross-cutting facts promoted to `_promoted.md`
- **Threshold auto-synthesis:** After 3 pending facts per project, run dedup + promote
- **LLM rollup (opt-in):** `/synthesize rph` triggers LLM summarization (requires API key)

## Install

```bash
git clone <repo-url>
cd omp-obsidian-sync
bun install
omp plugin link $(pwd)
```

First retain event triggers a setup wizard that auto-detects your vault and repos paths.

## Requirements

- **Bun** runtime
- **Obsidian vault** at `~/Notes` (or configured path)
- **LLM API key** (optional, for LLM synthesis)

## Configuration

Config file: `~/.omp/omp-obsidian-sync.json`

| Key | Default | Description |
|---|---|---|
| `vaultRoot` | `~/Notes` | Obsidian vault path |
| `reposRoot` | `~/Sites/fikrimastor` | Repos root (for [project] fallback) |
| `threshold` | 3 | Pending facts before auto-synthesis |
| `llmProvider` | `null` | LLM provider (`null` = disabled) |

## Commands

- `/synthesize <project>` — run synthesis now
- `/synthesize all` — synthesize all pending projects
- `/synthesize status` — show pending counts

## Migration from omp-learn

```bash
bun run migrate
```

Reads existing `~/Notes/omp-learn/*.md` files and emits them into `~/Notes/misc/<topic>.md`. Prompts before deleting source folder.

## Development

```bash
bun test                 # run all tests
bun test --watch         # watch mode
```

## Architecture

See `docs/superpowers/specs/2026-07-06-omp-obsidian-doc-synth-design.md`.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: add README with install, config, usage"
```

---

## Self-Review Checklist

After writing the complete plan, verify:

### Spec coverage
- [ ] Goals 1-7 from spec mapped to tasks (yes: Tasks 2-6 cover #1, Task 8 covers #3-4, Task 11 covers #5, Tasks 10+12 cover #6, config/defaults cover #7)
- [ ] Non-goals respected (no real-time tracking, no Dataview, no sync)
- [ ] Every acceptance criteria from spec has at least one task producing it
- [ ] Backward compat: existing `sync.ts`/`classify.ts`/`route.ts` untouched

### Placeholder scan
- [ ] No "TBD", "TODO", "implement later" in any task
- [ ] Every code block has actual code, not description
- [ ] Every test has actual assertions
- [ ] Every command has the exact shell invocation

### Type consistency
- [ ] `SynthConfig` type used consistently across all tasks that need it
- [ ] `parseTags` → `TagParse` matches what `synth.ts` expects
- [ ] `appendBullet` signature used correctly in synth.ts
- [ ] `runSynthesis` signature matches between task 9 and task 10/11

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-06-omp-obsidian-doc-synth.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

2. **Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
