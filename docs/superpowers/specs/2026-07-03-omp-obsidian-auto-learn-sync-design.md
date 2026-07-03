# OMP → Obsidian Auto-Learn Sync — Design

**Date:** 2026-07-03
**Status:** Approved (pending spec review)

## Problem

OMP auto-learns durable facts via the `retain` and `learn` tools (explicit calls, and
possibly harness-triggered background retention at end of completed turns). None of
this currently reaches the user's Obsidian vault at `~/Notes`. The user wants every
learned fact mirrored there in real time, as an individually addressable note.

## Goals

- Real-time capture of every `retain`/`learn` tool call, one markdown note per fact.
- Route business-logic (project-specific) facts into a per-repo vault folder; general
  facts into a shared `omp-learn/` folder.
- No manual sync step, no separate daemon/cron process.
- Self-healing sequential numbering — no external counter state to get out of sync.

## Non-Goals

- Syncing pre-existing Mnemopi memories retroactively (only new calls going forward).
- Two-way sync (editing a vault note does not write back to Mnemopi).
- Capturing background auto-retention that does **not** surface as a visible
  `retain`/`learn` tool_result event — unverified whether such a path exists; if it
  turns out facts are retained without a visible tool call, this design does not
  cover them (would need a periodic reconciliation job as a future addition).

## Architecture

A single OMP native plugin, `omp-obsidian-sync`, registering one `PostToolUse` hook
(`pi.on("tool_result")`). The hook is synchronous, in-process, and never blocks or
modifies the underlying tool's own output — pure side-effect (write a file).

```
omp-obsidian-sync/
  package.json              # omp.extensions -> ["./extensions/sync.ts"]
  .claude-plugin/plugin.json
  extensions/
    sync.ts                 # hook logic (see below)
```

Registered locally via `omp plugin link ~/Sites/fikrimastor/omp-obsidian-sync`.

## Hook Logic

On `tool_result` where `event.toolName === "retain"` or `event.toolName === "learn"`:

1. **Extract facts** from `event.input`, tolerant of schema drift:
   - `retain`: iterate `input.items[]`, each `{ content, context? }` → one note per
     item.
   - `learn`: single fact from `input.memory`.
   - If the expected field is missing or the wrong type, **skip** — do not write a
     blank/garbage note. Append one line to
     `~/.omp/plugins/cache/.../omp-obsidian-sync/sync-errors.log` describing the
     mismatch (toolName + raw input keys), then return. Never throw.

2. **Classify routing** — explicit convention, not inferred:
   - If the fact content starts with the literal prefix `[project]`, it is
     business-logic and the prefix is stripped before writing.
   - Otherwise it is general knowledge.

3. **Resolve target directory:**
   - If classified as business-logic **and** `process.cwd()` matches
     `~/Sites/fikrimastor/<repo-name>/...` → target is `~/Notes/<repo-name>/`.
   - Otherwise (general knowledge, or business-logic prefix present but cwd doesn't
     match a recognized repo root) → target is `~/Notes/omp-learn/`.
   - Repo-root matching only recognizes paths under `~/Sites/fikrimastor/`; other
     locations always fall back to `omp-learn/`.

4. **Determine next sequential ID:**
   - Recursively scan the **entire vault** (`~/Notes/**/omp-learn-*.md`), not just
     the target directory, take the max `N`, write `omp-learn-{N+1:04d}.md`. This
     keeps IDs globally unique across every folder in the vault (no per-folder
     counters, no separate counter state file — self-healing by construction).

5. **Write the note:**
   ```markdown
   ---
   date: 2026-07-03
   tool: retain
   tags: [omp-learn]
   ---
   <fact content, prefix stripped>

   #omp-learn
   ```

6. **Error handling:** the entire hook body is wrapped in try/catch. Any failure
   (fs error, malformed input, unrecognized cwd) is logged to `sync-errors.log` and
   swallowed — the hook must never throw or surface an error into the agent session.

## Data Flow

```
retain/learn tool call
        |
        v
 PostToolUse hook (sync.ts)
        |
        v
 extract fact(s) from input  --(malformed)--> log error, skip
        |
        v
 classify: [project] prefix present?
        |
        v
 resolve target dir (repo folder vs omp-learn/)
        |
        v
 scan ~/Notes/**/omp-learn-*.md for max N
        |
        v
 write ~/Notes/<target>/omp-learn-{N+1:04d}.md
```

## Testing Plan (manual)

1. Call `retain` with plain content → verify `~/Notes/omp-learn/omp-learn-0001.md`
   is created with correct frontmatter/tag.
2. Call `retain` with `[project]`-prefixed content while cwd is inside
   `~/Sites/fikrimastor/groceries` → verify it routes to `~/Notes/groceries/`, and
   the prefix is stripped from the body.
3. Call `retain` with `[project]` prefix while cwd is outside any recognized repo
   root → verify it falls back to `omp-learn/`.
4. Pre-seed `~/Notes/omp-learn/omp-learn-0007.md`, call again → verify the next file
   written anywhere in the vault is `0008`, not `0001`.
5. Simulate malformed input (mock event with missing `items`) → verify no vault file
   is written, an error line is appended to `sync-errors.log`, and no exception
   propagates.

## Open Risk

Whether OMP's background "retained automatically from completed turns" mechanism
(mentioned in the agent's system prompt) fires as an observable `retain` tool_result
event is unverified. If it does not, those facts will never reach the vault under
this design. Should be checked empirically after the hook is live: run a session
with no explicit `retain` calls, confirm whether any vault note still appears.
