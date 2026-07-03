# OMP → Obsidian Auto-Learn Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an OMP plugin that mirrors every `retain`/`learn` tool call into a
markdown note in the user's Obsidian vault (`~/Notes`), in real time, via a
`PostToolUse` hook.

**Architecture:** A thin `extensions/sync.ts` hook registers on `tool_result` events
and delegates to four small, independently testable pure-logic modules under
`extensions/lib/`: fact extraction, `[project]`-prefix classification, target
directory resolution, and note writing (including global sequential numbering).
The hook itself never throws; all failure paths log and return.

**Tech Stack:** Bun (TypeScript), `bun test` for unit tests, Node `fs`/`path`/`os`
built-ins only — no new dependencies.

## Global Constraints

- Vault root: `~/Notes` (from spec).
- Repo root prefix recognized for project routing: `~/Sites/fikrimastor/` (from spec).
- `[project]` literal prefix on fact content is the only business-logic signal — no
  content/path heuristics (from spec).
- Sequential note IDs are a single global counter across the entire vault, derived by
  recursively scanning `~/Notes/**/omp-learn-*.md` for the max N — no separate counter
  state file (from spec).
- `date`/`tool` frontmatter fields are generated at write time from the real event,
  never hardcoded (from spec).
- The hook must never throw; malformed/missing input fields are logged to
  `sync-errors.log` next to the plugin and the call is skipped, writing no note (from
  spec).
- No automated test framework requirement from the spec beyond "manual testing plan"
  — this plan adds `bun test` unit coverage for the pure logic modules (extraction,
  classification, routing, numbering) since they're fully deterministic and cheap to
  test; the full hook wiring is verified manually per the spec's 5-step test plan.

---

### Task 1: Fact extraction module

**Files:**
- Create: `extensions/lib/extract.ts`
- Test: `extensions/lib/extract.test.ts`

**Interfaces:**
- Consumes: nothing (pure function, first task).
- Produces: `extractFacts(toolName: string, input: unknown): string[] | null` —
  returns an array of raw fact-content strings (one per note to write), or `null` if
  `toolName` isn't `"retain"`/`"learn"` or the input shape doesn't match the expected
  schema (caller treats `null` as "skip, log error").

- [ ] **Step 1: Write the failing tests**

```typescript
// extensions/lib/extract.test.ts
import { test, expect } from "bun:test";
import { extractFacts } from "./extract";

test("extracts multiple items from a retain call", () => {
  const input = {
    items: [{ content: "fact one" }, { content: "fact two", context: "ctx" }],
    i: "test",
  };
  expect(extractFacts("retain", input)).toEqual(["fact one", "fact two"]);
});

test("extracts a single memory from a learn call", () => {
  const input = { memory: "learned fact", i: "test" };
  expect(extractFacts("learn", input)).toEqual(["learned fact"]);
});

test("returns null for unrelated tool names", () => {
  expect(extractFacts("read", { path: "x" })).toBeNull();
});

test("returns null when retain items is missing", () => {
  expect(extractFacts("retain", { i: "test" })).toBeNull();
});

test("returns null when retain items is not an array", () => {
  expect(extractFacts("retain", { items: "oops", i: "test" })).toBeNull();
});

test("skips retain items with non-string content", () => {
  const input = { items: [{ content: "ok" }, { content: 42 }], i: "test" };
  expect(extractFacts("retain", input)).toEqual(["ok"]);
});

test("returns null when retain items yields zero valid facts", () => {
  const input = { items: [{ content: 42 }], i: "test" };
  expect(extractFacts("retain", input)).toBeNull();
});

test("returns null when learn memory is missing or not a string", () => {
  expect(extractFacts("learn", { i: "test" })).toBeNull();
  expect(extractFacts("learn", { memory: 42, i: "test" })).toBeNull();
});

test("returns null for non-object input", () => {
  expect(extractFacts("retain", null)).toBeNull();
  expect(extractFacts("retain", "oops")).toBeNull();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test extensions/lib/extract.test.ts`
Expected: FAIL with `Cannot find module './extract'` (or similar) — the module
doesn't exist yet.

- [ ] **Step 3: Write minimal implementation**

```typescript
// extensions/lib/extract.ts

/**
 * Pulls the raw fact-content string(s) out of a retain/learn tool_result event's
 * `input`. Returns null (never throws) when toolName isn't recognized or the input
 * shape doesn't match what retain/learn actually send — callers treat null as
 * "skip this call, log the mismatch".
 */
export function extractFacts(toolName: string, input: unknown): string[] | null {
  if (input === null || typeof input !== "object") return null;
  const obj = input as Record<string, unknown>;

  if (toolName === "retain") {
    const items = obj.items;
    if (!Array.isArray(items)) return null;
    const facts: string[] = [];
    for (const item of items) {
      if (item && typeof item === "object" && typeof (item as any).content === "string") {
        facts.push((item as any).content);
      }
    }
    return facts.length > 0 ? facts : null;
  }

  if (toolName === "learn") {
    const memory = obj.memory;
    return typeof memory === "string" ? [memory] : null;
  }

  return null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test extensions/lib/extract.test.ts`
Expected: PASS, 9 tests passing.

- [ ] **Step 5: Commit**

```bash
git add extensions/lib/extract.ts extensions/lib/extract.test.ts
git commit -m "feat: add fact extraction module for retain/learn events"
```

---

### Task 2: Classification module (`[project]` prefix)

**Files:**
- Create: `extensions/lib/classify.ts`
- Test: `extensions/lib/classify.test.ts`

**Interfaces:**
- Consumes: nothing (pure function).
- Produces: `classify(content: string): { isProject: boolean; content: string }` —
  `content` in the return value has the `[project]` prefix stripped (and any
  resulting leading whitespace trimmed) when present.

- [ ] **Step 1: Write the failing tests**

```typescript
// extensions/lib/classify.test.ts
import { test, expect } from "bun:test";
import { classify } from "./classify";

test("detects the [project] prefix and strips it", () => {
  expect(classify("[project] uses pgvector for RAG")).toEqual({
    isProject: true,
    content: "uses pgvector for RAG",
  });
});

test("treats content without the prefix as general", () => {
  expect(classify("user prefers terse replies")).toEqual({
    isProject: false,
    content: "user prefers terse replies",
  });
});

test("only strips a leading prefix, not one mid-string", () => {
  expect(classify("note: [project] is a marker")).toEqual({
    isProject: false,
    content: "note: [project] is a marker",
  });
});

test("trims whitespace left after stripping the prefix", () => {
  expect(classify("[project]   spaced out fact")).toEqual({
    isProject: true,
    content: "spaced out fact",
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test extensions/lib/classify.test.ts`
Expected: FAIL with `Cannot find module './classify'`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// extensions/lib/classify.ts

const PROJECT_PREFIX = "[project]";

/**
 * Business-logic classification is explicit, not inferred: content must start
 * with the literal "[project]" marker. The prefix is stripped from the returned
 * content regardless of classification result checks elsewhere.
 */
export function classify(content: string): { isProject: boolean; content: string } {
  if (content.startsWith(PROJECT_PREFIX)) {
    return {
      isProject: true,
      content: content.slice(PROJECT_PREFIX.length).trimStart(),
    };
  }
  return { isProject: false, content };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test extensions/lib/classify.test.ts`
Expected: PASS, 4 tests passing.

- [ ] **Step 5: Commit**

```bash
git add extensions/lib/classify.ts extensions/lib/classify.test.ts
git commit -m "feat: add [project]-prefix classification module"
```

---

### Task 3: Target directory resolution module

**Files:**
- Create: `extensions/lib/route.ts`
- Test: `extensions/lib/route.test.ts`

**Interfaces:**
- Consumes: nothing directly, but is designed to receive `isProject` from
  `classify()` (Task 2) and a cwd string from `process.cwd()` at call time.
- Produces: `resolveTargetDir(cwd: string, isProject: boolean, opts?: { vaultRoot?: string; reposRoot?: string }): string` —
  returns an **absolute directory path** (vault root defaults to `~/Notes`, repos
  root defaults to `~/Sites/fikrimastor`, both overridable for testing).

- [ ] **Step 1: Write the failing tests**

```typescript
// extensions/lib/route.test.ts
import { test, expect } from "bun:test";
import path from "node:path";
import { resolveTargetDir } from "./route";

const VAULT = "/tmp/test-vault";
const REPOS = "/tmp/test-sites";

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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test extensions/lib/route.test.ts`
Expected: FAIL with `Cannot find module './route'`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// extensions/lib/route.ts
import path from "node:path";
import os from "node:os";

const DEFAULT_VAULT_ROOT = path.join(os.homedir(), "Notes");
const DEFAULT_REPOS_ROOT = path.join(os.homedir(), "Sites", "fikrimastor");
const GENERAL_DIR_NAME = "omp-learn";

export interface RouteOptions {
  vaultRoot?: string;
  reposRoot?: string;
}

/**
 * Business-logic facts (isProject === true) route to a per-repo vault folder only
 * when cwd is the repo root itself or nested under it. Everything else — general
 * facts, or project facts outside a recognized repo — routes to the shared
 * omp-learn/ folder. Repo-root matching is a path-segment boundary check, so a
 * sibling directory sharing a name prefix (e.g. "groceries-clone") never matches.
 */
export function resolveTargetDir(
  cwd: string,
  isProject: boolean,
  opts: RouteOptions = {},
): string {
  const vaultRoot = opts.vaultRoot ?? DEFAULT_VAULT_ROOT;
  const reposRoot = opts.reposRoot ?? DEFAULT_REPOS_ROOT;

  if (isProject) {
    const relative = path.relative(reposRoot, cwd);
    const isInsideRepos =
      relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
    if (isInsideRepos) {
      const repoName = relative.split(path.sep)[0];
      if (repoName) return path.join(vaultRoot, repoName);
    }
  }

  return path.join(vaultRoot, GENERAL_DIR_NAME);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test extensions/lib/route.test.ts`
Expected: PASS, 5 tests passing.

- [ ] **Step 5: Commit**

```bash
git add extensions/lib/route.ts extensions/lib/route.test.ts
git commit -m "feat: add target directory resolution module"
```

---

### Task 4: Note writing module (global numbering + frontmatter)

**Files:**
- Create: `extensions/lib/note.ts`
- Test: `extensions/lib/note.test.ts`

**Interfaces:**
- Consumes: nothing directly; designed to receive the target dir from
  `resolveTargetDir()` (Task 3) and stripped content from `classify()` (Task 2).
- Produces:
  - `nextNoteId(vaultRoot: string): number` — scans `vaultRoot/**/omp-learn-*.md`
    recursively, returns `max(N) + 1` (or `1` if none exist).
  - `writeNote(vaultRoot: string, targetDir: string, content: string, toolName: "retain" | "learn", now?: Date): string` —
    computes the next global ID via `nextNoteId`, creates `targetDir` if missing,
    writes `omp-learn-{id:04d}.md` with frontmatter, returns the absolute path
    written.

- [ ] **Step 1: Write the failing tests**

```typescript
// extensions/lib/note.test.ts
import { test, expect, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { nextNoteId, writeNote } from "./note";

let vaultRoot: string;

beforeEach(() => {
  vaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vault-test-"));
});

afterEach(() => {
  fs.rmSync(vaultRoot, { recursive: true, force: true });
});

test("nextNoteId returns 1 for an empty vault", () => {
  expect(nextNoteId(vaultRoot)).toBe(1);
});

test("nextNoteId scans recursively across all subfolders for the global max", () => {
  const generalDir = path.join(vaultRoot, "omp-learn");
  const repoDir = path.join(vaultRoot, "groceries");
  fs.mkdirSync(generalDir, { recursive: true });
  fs.mkdirSync(repoDir, { recursive: true });
  fs.writeFileSync(path.join(generalDir, "omp-learn-0003.md"), "x");
  fs.writeFileSync(path.join(repoDir, "omp-learn-0007.md"), "x");
  expect(nextNoteId(vaultRoot)).toBe(8);
});

test("nextNoteId ignores non-matching filenames", () => {
  const generalDir = path.join(vaultRoot, "omp-learn");
  fs.mkdirSync(generalDir, { recursive: true });
  fs.writeFileSync(path.join(generalDir, "omp-learn-0003.md"), "x");
  fs.writeFileSync(path.join(generalDir, "notes.md"), "x");
  fs.writeFileSync(path.join(generalDir, "omp-learn-abc.md"), "x");
  expect(nextNoteId(vaultRoot)).toBe(4);
});

test("writeNote creates the target dir, writes frontmatter, and returns the path", () => {
  const targetDir = path.join(vaultRoot, "omp-learn");
  const now = new Date("2026-07-03T12:00:00Z");
  const written = writeNote(vaultRoot, targetDir, "user prefers terse replies", "retain", now);

  expect(written).toBe(path.join(targetDir, "omp-learn-0001.md"));
  const body = fs.readFileSync(written, "utf8");
  expect(body).toContain("date: 2026-07-03");
  expect(body).toContain("tool: retain");
  expect(body).toContain("tags: [omp-learn]");
  expect(body).toContain("user prefers terse replies");
  expect(body).toContain("#omp-learn");
});

test("writeNote continues the global sequence across folders", () => {
  const generalDir = path.join(vaultRoot, "omp-learn");
  fs.mkdirSync(generalDir, { recursive: true });
  fs.writeFileSync(path.join(generalDir, "omp-learn-0007.md"), "x");

  const repoDir = path.join(vaultRoot, "groceries");
  const written = writeNote(vaultRoot, repoDir, "uses pgvector", "learn", new Date());

  expect(written).toBe(path.join(repoDir, "omp-learn-0008.md"));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test extensions/lib/note.test.ts`
Expected: FAIL with `Cannot find module './note'`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// extensions/lib/note.ts
import fs from "node:fs";
import path from "node:path";

const NOTE_PATTERN = /^omp-learn-(\d{4,})\.md$/;

/**
 * Recursively scans vaultRoot for every omp-learn-NNNN.md file and returns the
 * next id in the single global sequence (max + 1, or 1 if the vault has none yet).
 * This is the only source of truth for numbering — no separate counter file.
 */
export function nextNoteId(vaultRoot: string): number {
  let max = 0;

  function walk(dir: string): void {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        const match = entry.name.match(NOTE_PATTERN);
        if (match) {
          const n = parseInt(match[1], 10);
          if (n > max) max = n;
        }
      }
    }
  }

  walk(vaultRoot);
  return max + 1;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Writes one markdown note into targetDir using the next global sequential id
 * (computed by scanning vaultRoot, not targetDir, so numbering stays unique across
 * every folder in the vault). Creates targetDir if it doesn't exist. Returns the
 * absolute path written.
 */
export function writeNote(
  vaultRoot: string,
  targetDir: string,
  content: string,
  toolName: "retain" | "learn",
  now: Date = new Date(),
): string {
  fs.mkdirSync(targetDir, { recursive: true });
  const id = nextNoteId(vaultRoot);
  const filename = `omp-learn-${String(id).padStart(4, "0")}.md`;
  const filePath = path.join(targetDir, filename);

  const body = [
    "---",
    `date: ${isoDate(now)}`,
    `tool: ${toolName}`,
    "tags: [omp-learn]",
    "---",
    content,
    "",
    "#omp-learn",
    "",
  ].join("\n");

  fs.writeFileSync(filePath, body, "utf8");
  return filePath;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test extensions/lib/note.test.ts`
Expected: PASS, 5 tests passing.

- [ ] **Step 5: Commit**

```bash
git add extensions/lib/note.ts extensions/lib/note.test.ts
git commit -m "feat: add note writing module with global sequential numbering"
```

---

### Task 5: Hook wiring, error logging, plugin manifests

**Files:**
- Create: `extensions/sync.ts`
- Create: `package.json`
- Create: `.claude-plugin/plugin.json`
- Test: `extensions/sync.test.ts`

**Interfaces:**
- Consumes: `extractFacts` (Task 1), `classify` (Task 2), `resolveTargetDir`
  (Task 3), `nextNoteId`/`writeNote` (Task 4).
- Produces: `handleToolResult(event: { toolName: string; input: unknown }, opts?: { cwd?: string; vaultRoot?: string; reposRoot?: string; errorLogPath?: string }): void` —
  the orchestration function the OMP extension registers against `tool_result`;
  exported separately from the `export default function(pi)` registration so it's
  directly unit-testable without a real `ExtensionAPI`.

- [ ] **Step 1: Write the failing tests**

```typescript
// extensions/sync.test.ts
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bun test extensions/sync.test.ts`
Expected: FAIL with `Cannot find module './sync'`.

- [ ] **Step 3: Write minimal implementation**

```typescript
// extensions/sync.ts
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent/extensibility/hooks";
import { extractFacts } from "./lib/extract";
import { classify } from "./lib/classify";
import { resolveTargetDir } from "./lib/route";
import { writeNote } from "./lib/note";

const DEFAULT_VAULT_ROOT = path.join(os.homedir(), "Notes");
const DEFAULT_REPOS_ROOT = path.join(os.homedir(), "Sites", "fikrimastor");
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

/**
 * Orchestrates one retain/learn tool_result event into zero or more vault notes.
 * Exported standalone (not just via the default pi.on registration) so it's
 * directly unit-testable without a real ExtensionAPI. Never throws.
 */
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

    const cwd = opts.cwd ?? process.cwd();
    const vaultRoot = opts.vaultRoot ?? DEFAULT_VAULT_ROOT;
    const reposRoot = opts.reposRoot ?? DEFAULT_REPOS_ROOT;

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

- [ ] **Step 4: Run tests to verify they pass**

Run: `bun test extensions/sync.test.ts`
Expected: PASS, 7 tests passing.

- [ ] **Step 5: Create the plugin manifests**

```json
// package.json
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

```json
// .claude-plugin/plugin.json
{
  "name": "omp-obsidian-sync",
  "version": "0.1.0",
  "description": "Mirrors OMP retain/learn calls into markdown notes in an Obsidian vault at ~/Notes."
}
```

- [ ] **Step 6: Run the full test suite**

Run: `bun test`
Expected: PASS, all 25 tests across extract/classify/route/note/sync passing.

- [ ] **Step 7: Commit**

```bash
git add extensions/sync.ts extensions/sync.test.ts package.json .claude-plugin/plugin.json
git commit -m "feat: wire PostToolUse hook with error logging and plugin manifests"
```

---

### Task 6: Register the plugin and run the manual verification plan

**Files:**
- None created; this task registers and exercises the built plugin end-to-end.

**Interfaces:**
- Consumes: the registered plugin from Task 5 (via `omp plugin link`).
- Produces: nothing new — this is the manual verification gate from the spec's
  Testing Plan section.

- [ ] **Step 1: Register the plugin locally**

Run: `omp plugin link ~/Sites/fikrimastor/omp-obsidian-sync`
Expected: command succeeds; confirm with `omp plugin list --json` that
`omp-obsidian-sync` appears under the `npm`/local section.

- [ ] **Step 2: Ensure the vault target directories exist for a clean test**

Run: `mkdir -p ~/Notes` (Obsidian vault root; per spec this already exists at
`~/Notes`, so this is a no-op safety check, not a fresh vault).

- [ ] **Step 3: Manual test 1 — plain retain call, general note**

In a fresh OMP session, call the `retain` tool with a plain (no `[project]` prefix)
item, e.g. content `"manual verification: plain fact"`.

Expected: a new file `~/Notes/omp-learn/omp-learn-NNNN.md` appears (NNNN = next
number in the vault's existing sequence) containing that content, with `tool: retain`
in its frontmatter and a trailing `#omp-learn` tag.

- [ ] **Step 4: Manual test 2 — `[project]`-prefixed retain call inside a repo**

With cwd inside `~/Sites/fikrimastor/groceries`, call `retain` with content
`"[project] manual verification: project fact"`.

Expected: a new file appears under `~/Notes/groceries/omp-learn-NNNN.md`, and the
note body does **not** contain the literal `[project]` prefix.

- [ ] **Step 5: Manual test 3 — `[project]`-prefixed call outside any recognized repo**

With cwd outside `~/Sites/fikrimastor/` entirely (e.g. `/tmp`), call `retain` with
content `"[project] manual verification: stray project fact"`.

Expected: falls back to `~/Notes/omp-learn/omp-learn-NNNN.md` (no `groceries`-style
folder is created for an unrecognized root).

- [ ] **Step 6: Manual test 4 — global numbering continuity**

Note the highest `omp-learn-NNNN.md` number across the whole vault so far (from
tests 1–3), then call `retain` once more from any location.

Expected: the new file's number is exactly one higher than the current vault-wide
max, regardless of which folder it lands in.

- [ ] **Step 7: Manual test 5 — malformed input never surfaces an error to the session**

This is covered by the `sync.test.ts` unit test (Task 5, Step 4) with a directly
constructed malformed event; skip re-triggering it through the live agent since
`retain`'s own tool schema prevents malformed calls from a normal session. Instead,
confirm the unit test result stands: `bun test extensions/sync.test.ts` still passes
before closing this task.

- [ ] **Step 8: Record verification results**

No commit needed for this task (no files changed) — this is a manual gate. If any
manual test fails, return to the relevant Task (1–5) to fix before considering the
plugin done.
