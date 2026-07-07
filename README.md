# OMP Obsidian Sync + Doc-Synth

OMP plugin that routes retained coding facts into structured Obsidian project folders and automatically synthesizes patterns.

## Features

- **Tagged retains:** `[project:rph] [arch] uses Encore auth handlers` → `~/Notes/rph/architecture.md`
- **Keyword fallback:** No tag? Plugin classifies content by keywords (bug → `bugs.md`, Nuxt → `tech-stack.md`, etc.)
- **Dedup + promotion:** Exact/Levenshtein dedup within files; cross-cutting facts promoted to `_promoted.md`
- **Threshold auto-synthesis:** After 3 pending facts per project, runs dedup + promote
- **LLM rollup (opt-in):** `/synthesize rph` triggers LLM summarization (requires API key)
- **Audit log:** All actions logged to `~/Notes/.omp-audit.log`

## Install

```bash
git clone <repo-url>
cd omp-obsidian-sync
bun install
omp plugin link $(pwd)
```

First retain event triggers a setup wizard that auto-detects your vault and repos paths.

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

## Requirements

- **Bun** runtime
- **Obsidian vault** at a path of your choice (auto-detected, see Setup)
- **LLM API key** (optional, for LLM synthesis)

## Configuration

Config file: `~/.omp/omp-obsidian-sync.json`

| Key | Default | Description |
|---|---|---|
| `vaultRoot` | (auto-detected) | Obsidian vault path |
| `reposRoot` | (auto-detected) | Repos root (for project routing) |
| `threshold` | `3` | Pending facts before auto-synthesis |
| `llmProvider` | `null` | LLM provider (`null` = LLM disabled) |

LLM is **off by default**. Enable it by setting `llmProvider` and providing an API key (read from `OPENAI_API_KEY` env var by default).

## Usage

### Tagged retains

```
[project:rph] [arch] uses Encore auth handlers
[project:groceries] [bug] image upload returns 500
[project:cikgu] Nuxt 3 + Laravel monorepo
```

Untagged facts go to the audit log only (no project file created).

### Topic tags

| Tag | File |
|---|---|
| `[arch]`, `[architecture]` | `<project>/architecture.md` |
| `[bug]`, `[bugs]` | `<project>/bugs.md` |
| `[conv]`, `[conventions]` | `<project>/conventions.md` |
| `[wf]`, `[workflow]` | `<project>/workflow.md` |
| `[tech]`, `[tech-stack]` | `<project>/tech-stack.md` |
| `[dec]`, `[decisions]` | `<project>/decisions.md` |
| (none) | Auto-classified by keyword; falls to `<project>/uncategorized.md` |

### Commands

- `/synthesize <project>` — run synthesis now (dedup + promote + optional LLM)
- `/synthesize all` — synthesize all pending projects
- `/synthesize status` — show pending counts
- `/synthesize setup` — re-run setup wizard

## Migration from omp-learn

If you have existing `~/Notes/omp-learn/omp-learn-*.md` files from the original `omp-obsidian-sync` plugin:

```bash
bun run migrate
```

This reads all legacy notes, classifies them by keyword, and emits them to `~/Notes/misc/<topic>.md`. Prompts before deleting the source folder.

## Development

```bash
bun test                 # run all tests
bun test --watch         # watch mode
```

## Architecture

See `docs/superpowers/specs/2026-07-06-omp-obsidian-doc-synth-design.md` (spec) and
`docs/superpowers/plans/2026-07-06-omp-obsidian-doc-synth.md` (implementation plan).

| Module | Path | Purpose |
|---|---|---|
| Config | `lib/config.ts` | Load `~/.omp/omp-obsidian-sync.json` |
| Tag parser | `lib/parse-tags.ts` | Parse `[project:x] [topic]` syntax |
| Topic classifier | `lib/topic.ts` | Keyword fallback when no tag |
| State | `lib/state.ts` | Pending count per project |
| Route | `lib/route.ts` | Topic-aware path resolver |
| Append-note | `lib/append-note.ts` | Topic file writer with dedup |
| Audit log | `lib/audit.ts` | Append-only `.omp-audit.log` |
| Dedup | `lib/dedup.ts` | Levenshtein + first-4-words dedup |
| Synthesis | `lib/synthesize.ts` | Pass 1+2 orchestration |
| Hook | `synth.ts` | OMP `tool_result` entry point |
| Command | `commands/synthesize.ts` | `/synthesize` slash command |
| Setup | `lib/setup.ts` | First-run setup wizard |
| Migration | `lib/migrate.ts` | Legacy omp-learn migration |
