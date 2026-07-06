# OMP Obsidian Doc-Synth Plugin — Design

**Date:** 2026-07-06
**Status:** Draft (pending user review)
**Repo:** `~/Sites/fikrimastor/omp-obsidian-sync`
**Replaces:** (partially) the existing raw `omp-learn/` mirror in the same repo

---

## Purpose

An OMP plugin that tracks coding activities, learns workflow patterns, and automatically generates per-project documentation in the user's Obsidian vault. The plugin is **not** a passive journal — it is a **synthesis engine** that consolidates related facts, dedupes noise, promotes cross-cutting facts, and (optionally) summarizes via LLM.

## Goals

1. **Capture every retained coding fact** with a clear project + topic assignment
2. **Eliminate the `omp-learn/` dump folder** — facts land directly in structured project folders
3. **Cluster and dedupe** related facts so the user reads signal, not noise
4. **Promote cross-cutting facts** so they appear in the right place without manual filing
5. **Surface meta-patterns** via an on-demand LLM pass
6. **Install cleanly on any machine** that runs OMP, with self-check + setup wizard
7. **Stay fast on the hot path** — no LLM cost on every retain

## Non-Goals

- Real-time activity tracking (no keystroke / git / editor watching — the only input is the `retain` tool)
- Visualization (no Dataview queries, no dashboards — Obsidian's native graph + folder view is enough)
- Cross-machine sync (the vault syncs via iCloud / git / Syncthing, not this plugin)
- Auto-categorization via LLM on every write (would make the hot path slow and expensive)

---

## Architecture

The plugin lives in the existing `omp-obsidian-sync` repo. The original `sync.ts` (raw mirror) stays in the tree but is disabled by default behind a config flag. New work goes in `extensions/synth.ts` plus a `lib/` directory.

### Modules

| Module | Purpose |
|---|---|
| `extensions/synth.ts` | OMP `tool_result` hook for `retain` + `learn` |
| `extensions/commands/synthesize.ts` | Registers `/synthesize <project>` slash command |
| `extensions/lib/parse-tags.ts` | Parses `[project:x] [topic] content` |
| `extensions/lib/classify.ts` | Keyword-based topic classifier (fallback when no tag) |
| `extensions/lib/route.ts` | Extends existing router → returns `~/Notes/<project>/<topic>.md` path |
| `extensions/lib/append-note.ts` | Appends a dated frontmatter bullet to a topic file |
| `extensions/lib/dedup.ts` | Exact-match + Levenshtein dedup, cross-file promotion |
| `extensions/lib/synthesize.ts` | LLM rollup pass; emits `_summary.md` and reassignments |
| `extensions/lib/audit.ts` | Append-only log to `~/Notes/.omp-audit.log` |
| `extensions/lib/state.ts` | Read/write `~/Notes/.omp-state.json` (pending counts per project) |
| `extensions/lib/setup.ts` | First-run self-check + in-chat setup wizard |
| `extensions/lib/config.ts` | Load + validate `~/.omp/omp-obsidian-sync.json` |
| `extensions/lib/migrate.ts` | One-shot migration of legacy `omp-learn/*.md` notes |

### Public entry point

```ts
// extensions/synth.ts
export default function (pi: ExtensionAPI): void {
  pi.on("tool_result", async (event) => {
    if (event.toolName !== "retain" && event.toolName !== "learn") return;
    handleRetain({ toolName: event.toolName, input: event.input });
  });
}

export function handleRetain(event, opts?): void { /* ... */ }
```

`handleRetain` is exported standalone (mirroring existing `handleToolResult`) so it's directly unit-testable without an `ExtensionAPI`.

### Constraints

- Never throws into the OMP session — all errors go to `sync-errors.log` and the audit log
- Hot-path latency target: **p99 < 50ms** for a single retain (no LLM on this path)
- LLM is opt-in, off by default

---

## Data Flow

### A single retain

```
retain({ content: "[project:rph] [arch] uses Encore auth handlers" })
        │
        ▼
parseTags(content)
        │ → { project: "rph", topic: "arch", content: "uses Encore auth handlers" }
        ▼
resolveRoute({ project, topic })
        │ → ~/Notes/rph/architecture.md  (creates folder/file if absent)
        ▼
appendNote(path, bullet)
        │ → prepends dated frontmatter block + bullet (newest at top)
        │ → idempotent: drops exact-match (case-insensitive trimmed) duplicates
        ▼
state.incrementPending("rph")
        │
        ▼
if state.pendingCount("rph") >= config.threshold:
        runSynthesis("rph")
        │
        ▼
audit.log("[2026-07-06T13:50:00Z] retain rph/architecture.md ...")
```

### Tag parsing

Regex (case-insensitive):

```
/^\s*\[project:([a-z0-9_-]+)\](?:\s+\[([a-z0-9_-]+)\])?\s+(.*)$/i
```

| Input | Result |
|---|---|
| `[project:rph] [arch] uses Encore auth handlers` | `{project:"rph", topic:"arch", content:"uses Encore auth handlers"}` |
| `[project:RPH] uses Encore auth handlers` | `{project:"rph", topic:null, content:"uses Encore auth handlers"}` |
| `[project:rph] [random] content` | `{project:"rph", topic:null, content:"content"}` (invalid topic → classifier) |
| `no tags at all` | `null` (route to audit log only) |

Project names are lowercased on disk. Topic names go through `config.topicAliases` (e.g. `arch → architecture`, `bug → bugs`).

### Topic file format

```markdown
---
date: 2026-07-06
project: rph
topic: architecture
source: retain
---

- uses Encore auth handlers
- [2026-07-05] project is on Coolify single-replica deploy
- [2026-07-04] database migrations embedded in Go binary
```

Newest at top, deduped on insert. Each bullet may carry a date prefix; the frontmatter `date` is the most recent write.

### Classifier (keyword fallback, no LLM)

| Topic | Trigger keywords |
|---|---|
| `architecture` | "uses", "tech stack", "service", "module", "composable" |
| `bugs` | "error", "fix", "broken", "crash", "bug", "fail" |
| `conventions` | "always", "never", "convention", "must", "pattern" |
| `workflow` | "before", "after", "step", "first", "then" |
| `tech-stack` | "postgres", "redis", "nuxt", "encore", "laravel" |
| `decisions` | "decided", "chose", "tradeoff", "instead of" |
| `uncategorized` | (fallback) |

If no keyword matches → `uncategorized`. Bullets never dropped, always written somewhere.

### Audit log

Append-only at `~/Notes/.omp-audit.log`. One line per action:

```
[2026-07-06T13:50:00Z] retain rph/architecture.md "uses Encore auth handlers"
[2026-07-06T13:51:00Z] synthesis rph: dedup=2, promoted=1, llm=skipped
[2026-07-06T13:52:00Z] /synthesize rph: 9 → 7 bullets, 1 promoted, summary=ok
```

The audit log is gitignorable by default. User can include it in their vault's git if they want history.

---

## Synthesis Pass

Triggered when `pendingCount[project] >= config.threshold` (default 3) or on `/synthesize <project>`.

### Pass 1 — Dedup (no LLM)

For each topic file in the project:
- Drop exact-match duplicates (case-insensitive trim)
- Drop near-duplicates: Levenshtein distance ≤ 20% of the longer string length, keep the longer one
- Drop bullets that share their first 4 words (likely rephrasings)

### Pass 2 — Promote (no LLM)

For any bullet string appearing in 2+ topic files:
- Move it to `~/Notes/<project>/_promoted.md`
- Remove from the original topic files
- `_promoted.md` holds cross-cutting facts (e.g. a "PostgreSQL 16" fact that ended up in both `tech-stack.md` and `deployment.md`)

### Pass 3 — LLM rollup (LLM-backed, opt-in)

If `config.llmProvider` is set:
- Concatenate all topic files for the project (cap: 50k tokens input)
- Call provider with system prompt: "You organize coding notes. Given topic files for project X, output JSON: `{ summary, patterns[], reassignments[] }`"
- Write `summary` to `~/Notes/<project>/_summary.md`
- Apply `reassignments` as plain file moves (e.g. `uncategorized.md` bullet about "use Encore auth handlers" → `architecture.md`); never delete content
- Audit-log the LLM call result

If `llmProvider` is `null` (default), Pass 3 is **skipped silently**. Pass 1 + 2 still run.

### Failure handling

| Failure | Behavior |
|---|---|
| Input > 50k tokens | Audit log: `synthesis rph: skipped (input 73k tokens)`, no partial commit |
| LLM call fails (network / bad key) | Audit log: error detail, Pass 1+2 still committed, no `_summary.md`, `pendingCount` reset to 0 |
| File move fails (permission) | Audit log: error, partial state preserved (next synthesis retries) |
| `uncategorized.md` reassignment target doesn't exist | Create the target file |

### State reset

After synthesis (success or failure of Pass 3): `pendingCount[project] = 0`. We do not loop on a broken LLM.

---

## `/synthesize` Slash Command

Registered via OMP's command API. Subcommands:

- `/synthesize <project>` — force synthesis on a single project
- `/synthesize all` — run synthesis on every project with `pendingCount > 0`
- `/synthesize status` — print pending counts per project

Output is a short chat message, e.g.:

```
synthesis rph: 12 → 9 bullets (3 deduped), 1 promoted, llm summary written
```

The plugin does not wait for the LLM in the hot path — the slash command can, since it's an explicit user action.

---

## Configuration

File: `~/.omp/omp-obsidian-sync.json` (override path via `OMP_SYNC_CONFIG` env var)

```json
{
  "vaultRoot": "~/Notes",
  "reposRoot": "~/Sites/fikrimastor",
  "threshold": 3,
  "llmProvider": null,
  "llmModel": null,
  "llmBaseUrl": null,
  "llmApiKeyEnv": "OPENAI_API_KEY",
  "legacyOmpLearnMirror": false,
  "topicAliases": {
    "arch": "architecture",
    "bug": "bugs",
    "conv": "conventions",
    "wf": "workflow",
    "tech": "tech-stack",
    "dec": "decisions"
  }
}
```

| Key | Default | Notes |
|---|---|---|
| `vaultRoot` | `~/Notes` | Auto-detected on first run |
| `reposRoot` | `~/Sites/fikrimastor` | Auto-detected (first `~/Sites/*` child) |
| `threshold` | `3` | Pending facts before auto-synthesis runs |
| `llmProvider` | `null` | One of: `openai`, `deepseek`, `ollama`, `anthropic` |
| `llmModel` | `null` | Provider-specific, e.g. `gpt-4o-mini` |
| `llmBaseUrl` | `null` | Override for self-hosted / OpenRouter |
| `llmApiKeyEnv` | `OPENAI_API_KEY` | Env var name holding the API key |
| `legacyOmpLearnMirror` | `false` | Enables old `omp-learn/*.md` raw mirror (off by default) |
| `topicAliases` | (see above) | Short-tag → canonical topic file name |

### Validation

- Missing `vaultRoot` → first-run wizard asks
- `threshold` < 1 → clamped to 1
- `llmProvider` set but no API key in env → synthesis logs error, Pass 3 skipped

---

## First-Run Setup (Reusability)

When `handleRetain` is invoked and the config file is missing **or** the vault/repos paths don't resolve, the plugin runs the in-chat setup wizard:

1. **Detect Bun** — `which bun`; if missing: "Bun is required. Install: `curl -fsSL https://bun.sh/install | bash`" and bail
2. **Auto-detect paths** — check `~/Notes` and `~/Sites`; if present, prefill config and ask: "Use these? [Y/n/c]"
3. **If paths missing** — ask via OMP prompt: "Where is your Obsidian vault?" / "Where are your repos?"
4. **LLM opt-in** — explicit prompt: "Enable LLM synthesis? Requires API key. [y/N]"
5. **Write config** to `~/.omp/omp-obsidian-sync.json` and continue processing the current retain

The wizard runs once per machine. After config exists, no re-prompting unless the user runs `/synthesize setup` to re-run it.

---

## Migration (One-Shot)

The current vault has 13 `omp-learn-*.md` files written by the existing raw mirror. Migration is a separate `bun run migrate` command in the plugin repo.

### Steps

1. Read all `~/Notes/omp-learn/omp-learn-*.md` files
2. For each bullet, run `classify()` (keyword rules, no LLM)
3. **Project inference:** legacy notes have no project tag and no `cwd` frontmatter → bucket them under a `misc/` project folder (i.e. `~/Notes/misc/<topic>.md`); user can re-tag and move them later
4. Emit bullets to `~/Notes/misc/<topic>.md` with new frontmatter
5. Run dedup pass
6. Print a summary table:

```
migrated: 13
deduped: 2
misc/: 4
```

7. **Prompt for delete confirmation:** "Delete ~/Notes/omp-learn/? [y/N]". Default is N.
8. **Never auto-delete.** User types y explicitly.

A non-interactive mode (`bun run migrate --yes`) is supported for CI / scripted use, but it still does NOT delete the source — it emits and exits, leaving the user to `rm -rf` manually.

---

## Backward Compatibility

The original `extensions/sync.ts` (raw `omp-learn/*.md` mirror) remains in the repo. New users get the synthesis engine by default. Existing users with the old behavior get a one-time deprecation notice in OMP chat and can opt in via `legacyOmpLearnMirror: true`. All existing `extensions/sync.test.ts` tests continue to pass.

---

## Testing

All tests use Bun test, matching the existing `extensions/sync.test.ts` style.

### Unit tests

- `extensions/lib/parse-tags.test.ts` — every valid/invalid tag combination, project case-insensitivity, missing topic, no project
- `extensions/lib/classify.test.ts` — keyword → topic for each category; fallback to `uncategorized`
- `extensions/lib/dedup.test.ts` — exact-match, Levenshtein, cross-file promotion
- `extensions/lib/state.test.ts` — pending count increment/reset
- `extensions/lib/config.test.ts` — defaults, validation, env override

### Integration tests

- `extensions/synth.test.ts` — full `handleRetain` flow with tempdir `vaultRoot`:
  - Threshold not met → no synthesis
  - Threshold met → synthesis runs
  - Idempotent retains (same content twice → second dropped)
  - Project folder auto-created on first write
  - Audit log line written for every action
  - LLM-disabled mode (Pass 3 skipped silently)
  - LLM-call failure (Pass 1+2 still commit, no `_summary.md`)
  - Bad input → no throw, error logged
- `extensions/lib/migrate.test.ts` — feed 3 mock legacy notes, verify correct emission + summary output

### Smoke test

- A 10-minute OMP session with mixed retains (some `[project:*]` tagged, some not) must produce:
  - Zero uncaught errors in `sync-errors.log`
  - Correct folder/file creation
  - At least one synthesis pass if threshold crossed
  - Audit log entries for every action

---

## Acceptance Criteria

The plugin is "done" when **all** of the following are true:

- [ ] Plugin loads in OMP without errors on a fresh `git clone`
- [ ] First-run setup wizard triggers when `vaultRoot` is missing
- [ ] `retain({ content: "[project:rph] [arch] uses Encore auth handlers" })` creates/updates `~/Notes/rph/architecture.md` with a dated bullet
- [ ] 3rd project-tagged retain for `rph` triggers a synthesis pass (Pass 1+2 minimum); `rph/architecture.md` shows dedup applied; audit log has `synthesis rph:` line
- [ ] `/synthesize rph` slash command works in OMP chat and returns a chat summary
- [ ] With `llmProvider: null`, plugin never attempts LLM call, no errors
- [ ] With `llmProvider: "openai"` and a bad key, Pass 3 fails gracefully, Pass 1+2 still commit
- [ ] Migration script processes 13 historical notes, asks for delete confirmation, never auto-deletes
- [ ] All existing `extensions/sync.test.ts` tests still pass (backward compat)
- [ ] Total wall-clock time for a single retain: < 50ms p99 (no LLM on hot path)
- [ ] Zero uncaught errors in `sync-errors.log` after 10-minute smoke session
- [ ] README documents: install (`git clone` + `omp plugin link <path>`), requirements (Bun, Obsidian vault dir, optional LLM API key), config keys, migration command

---

## Out of Scope (Explicit)

- **No real-time tracking** — only `retain` / `learn` tool events are observed
- **No Dataview / dashboards** — Obsidian's native folder + graph view is the visualization
- **No multi-user / team support** — single-user plugin
- **No automatic `learn` content** — the plugin doesn't decide what to learn; the agent does, by calling `retain`
- **No git hooks** — vault syncing is the user's responsibility
- **No cloud storage of facts** — everything stays in the local vault

---

## Open Questions

None at draft time. Will revisit after user review.
