# OMP Obsidian Sync — Onboarding & Path Detection

**Date:** 2026-07-07
**Status:** Approved (brainstorming gate)
**Owns:** `extensions/synth.ts`, `extensions/sync.ts`, `extensions/lib/config.ts`, `extensions/lib/route.ts`, `extensions/lib/setup.ts`, `extensions/lib/audit.ts`, `extensions/commands/synthesize.ts`, `bin/migrate.ts`, `README.md`

## Problem

Before publishing `omp-obsidian-sync` as a public GitHub repo, three onboarding defects must go:

1. **Hardcoded paths leak the author's environment.** `os.homedir()` defaults to `~/Notes` (vault) and `~/Sites/fikrimastor` (repos) in four files. Anyone with a different machine name or folder layout silently gets the wrong target.
2. **`detectDefaults()` is theater.** It always returns `~/Notes` for the vault regardless of whether the folder exists, and the prompt text in `setupPrompt()` is never actually shown to a user — there is no entry point.
3. **Setup is unwired.** `lib/setup.ts` exposes `needsSetup()`, `writeConfig()`, `detectDefaults()`, and `setupPrompt()`, but neither `extensions/sync.ts` nor `extensions/synth.ts` calls any of them. First retain just uses the hardcoded defaults with zero user input.

The goal: a new clone, a fresh `~/.omp/omp-obsidian-sync.json`, and a first `retain` call walk the user through a one-line setup; afterwards the plugin never prompts again.

## Design Decisions

### 1. Trigger: first `retain` or `learn` with no config file

`ensureConfig(pi)` runs at the top of the retain handler in **both** extensions (`extensions/sync.ts::handleToolResult` and `extensions/synth.ts::handleRetain`). If `loadConfig()` finds no file at `OMP_SYNC_CONFIG` or `~/.omp/omp-obsidian-sync.json`, the wizard runs inline before any facts are written. No new OMP UI surface, no extra command.

Why: the README already promises this behavior ("First retain event triggers a setup wizard"). Implementing what we already claim is the smallest change with the biggest correctness win.

### 2. Detection order (env var first, then cwd walk, then common spots)

`detectVault()` and `detectReposRoot()` evaluate in this strict order and return the first hit:

1. **Env override.** `OMP_VAULT_ROOT` / `OMP_REPOS_ROOT` (set by the user, CI, or shell rc).
2. **Cwd walk.** Starting at `process.cwd()`, walk upward looking for an `.obsidian/` directory (vault) or a `.git/` directory (repos). Stop at the first hit or at `$HOME`.
3. **Common spots.** Vault: `~/Notes`, `~/Obsidian`, `~/Documents/Notes`. Repos: `~/Sites`, `~/Code`, `~/src`, `~/repos`. For repos, the first existing candidate that contains at least one immediate subdirectory is chosen (a bare `~/Sites` is rejected).
4. **Last-resort fallback.** If everything above misses, return `path.join(os.homedir(), "Notes")` and `path.join(os.homedir(), "Sites")` — **only as a printed default** the user is asked to confirm, not silently used.

The `detectDefaults()` helper in `lib/setup.ts` is rewritten to use this order. The `os.homedir()`-baked defaults in `lib/config.ts` (`DEFAULTS.vaultRoot`, `DEFAULTS.reposRoot`) and in `extensions/sync.ts` (`DEFAULT_VAULT_ROOT`, `DEFAULT_REPOS_ROOT`) and `extensions/lib/route.ts` (`DEFAULT_VAULT_ROOT`, `DEFAULT_REPOS_ROOT`) stay, but only as the literal last-resort fallback for `loadConfig()` and `resolveTargetDir()` — never as the "detected" value shown to the user.

### 3. Prompt style: one-line auto-detected confirm

`runSetupWizard(pi, detected)` prints a single PI message:

```
🔧 OMP Obsidian Sync — first run setup
Detected vault:   ~/Notes  (exists: yes)
Detected repos:   ~/Sites  (contains subdirs: yes)

Reply with one of:
  ok              — use detected paths and write config
  vault=… repos=… — use custom paths (e.g. vault=~/Vault repos=~/Code)
  skip            — abort this event, log to audit, don't write config
```

The reply is read from PI's next user message using a `pi.ask()`-equivalent: the simplest mechanism is to **return early from the retain handler** and surface the prompt as an `note` to the PI runtime. The very next user input is parsed: `ok` writes config with detected paths; `vault=X repos=Y` parses and writes; `skip` audits and returns; anything else is treated as `skip` with a one-line hint that the user can re-run with `/omp-obsidian-sync setup`.

Because PI does not always expose a blocking `ask` to extensions, the implementation uses a **lightweight convention**: the wizard prints a one-shot prompt as the extension's note and returns. The user's next message is parsed by the next retain / `/synthesize setup` invocation. The first retain triggers a printed prompt and skips silently (matching the "skip + warn (recoverable)" fallback). A future enhancement can wire true blocking via OMP's `ask` API when it is exposed.

### 4. Fallback: skip + warn (recoverable)

If the user replies `skip` (or replies with something unparseable, or never replies — the extension has no blocking call so this is the default), the current event is:

- Logged to `~/.omp/omp-obsidian-sync.audit.log` as `setup skipped: <first 50 chars of fact>`.
- Returned without writing any note file. The next retain will prompt again because no config exists.

The `audit()` helper gains a sibling `auditSkip(reason, content)` so the audit log records these distinctly from general facts.

### 5. `setup` slash command

`commands/synthesize.ts::registerCommand` currently has the registration body commented out. We wire it for real: `/synthesize setup` (or a new `/omp-sync setup` if OMP supports prefixed commands) re-runs the wizard regardless of whether config exists. This is the user's manual escape hatch and the test seam.

## Module-by-Module Change Set

### `extensions/lib/setup.ts` — rewrite

- Replace `detectDefaults()` with `detectVault(cwd)` and `detectReposRoot(cwd)`. Both take an explicit `cwd` so they are testable.
- New `parseSetupReply(text, detected)`: returns `'ok' | { vault, repos } | 'skip'`.
- New `runSetupWizard(pi, cwd)`: orchestrates detect → print prompt → read reply → write or audit. Returns the resulting `SynthConfig` or `null` if skipped.
- Keep `needsSetup()` and `writeConfig()`. Add `configPathFor()` for testability.

### `extensions/lib/config.ts` — narrow defaults

- `DEFAULTS.vaultRoot` becomes `path.join(os.homedir(), "Notes")` only as a *fallback* if everything else fails; rename internal comment to make this explicit.
- Add `loadConfigOrDetect(cwd)`: same as `loadConfig()` but if the file is missing, returns the **detected** config (env + cwd walk + common) merged over `DEFAULTS`. The retain handler uses this so that even on a misconfigured machine, the auto-detected paths are tried before falling back to `~/Notes`.

### `extensions/sync.ts` — call ensureConfig

- Remove the top-of-file `DEFAULT_VAULT_ROOT` / `DEFAULT_REPOS_ROOT` constants. Replace with a single call to `loadConfigOrDetect(event.cwd ?? process.cwd())` at the top of `handleToolResult`.
- `HandleOptions` keeps `vaultRoot?` / `reposRoot?` for tests.

### `extensions/synth.ts` — call ensureConfig

- Same: top of `handleRetain` calls `loadConfigOrDetect(event.cwd)`. The `opts` parameter keeps the override path for tests.

### `extensions/lib/route.ts` — narrow the constant

- Replace `DEFAULT_VAULT_ROOT` / `DEFAULT_REPOS_ROOT` with `loadConfigOrDetect(cwd)`'s output when the caller passes no opts. Keep the existing opts path for tests.

### `extensions/commands/synthesize.ts` — wire `setup` and real registration

- `registerCommand` becomes a real `pi.onCommand("synthesize", ...)` handler.
- Add `case "setup"` → calls `runSetupWizard(pi, process.cwd())` and returns a status string.
- Keep the `status` / `all` / single-project paths unchanged.

### `extensions/lib/audit.ts` — new `auditSkip` helper

- `auditSkip(vaultRoot, reason, content)` writes a clearly tagged line so the log differentiates skipped events from general facts and from real writes.

### `bin/migrate.ts` — no change to behavior

- It already calls `loadConfig()`. After this change, `loadConfig()` still returns valid `vaultRoot` (from detect or DEFAULTS), and migration works. Add a one-line comment pointing at `loadConfigOrDetect` for new CLIs.

### `README.md` — update install + config sections

- "First retain event triggers a setup wizard" is **true** after this change, keep the claim.
- "Obsidian vault at `~/Notes`" becomes "Obsidian vault (auto-detected, see Configuration)".
- The config table's `vaultRoot` / `reposRoot` defaults change to "(auto-detected)".
- Add a `Setup` section explaining env-var override (`OMP_VAULT_ROOT`, `OMP_REPOS_ROOT`), detection order, and the `skip` fallback.

## Data Flow

```mermaid
flowchart TD
    A[retain/learn tool_result] --> B[ensureConfig(cwd)]
    B --> C{config file exists?}
    C -- yes --> D[loadConfig]
    C -- no --> E[detectVault + detectReposRoot]
    E --> F[print prompt to pi]
    F --> G{next user reply}
    G -- ok / custom paths --> H[writeConfig]
    G -- skip / unparseable --> I[auditSkip]
    I --> J[return, no file write]
    H --> K[return SynthConfig]
    D --> K
    K --> L[existing handleRetain/handleToolResult logic]
```

## Error Handling

| Case | Behavior |
|---|---|
| `OMP_VAULT_ROOT` set but path doesn't exist | Used anyway (user override is authoritative). |
| Cwd walk finds `.obsidian` but path is unreadable | Skip to common spots, log audit. |
| `writeConfig` fails (permission, disk) | Audit the failure with reason. Don't crash the OMP session. |
| User replies with malformed custom paths | Treat as `skip`. Print a one-line hint to re-run with `/synthesize setup`. |
| Multiple retain events arrive before user replies | Each one is skipped+audited. No state mutation. No double-prompt. |
| Setup command run with config already present | Re-prints the prompt with current values pre-filled; user can re-confirm to overwrite or `skip` to keep. |

## Testing

- `lib/setup.test.ts` — rewrite to cover `detectVault` / `detectReposRoot` with explicit `cwd` and stubbed `fs` / env. Cover the env-var-first, cwd-walk, common-spots, and last-resort branches.
- `lib/config.test.ts` — add coverage for `loadConfigOrDetect` merging detected paths over DEFAULTS.
- `extensions/sync.test.ts` and `extensions/synth.test.ts` — add one test each asserting that when no config exists and detection misses, the handler audits a `setup skipped` line and writes no note file. Add one test each asserting the `ok` reply path writes the expected note.
- `commands/synthesize.test.ts` — add a `setup` subcommand test that asserts the wizard runs and a re-run with config present re-prompts.

No new test framework dependencies. All tests use `bun test` (per project `CLAUDE.md`).

## Out of Scope

- Blocking `pi.ask()` for true interactive prompts (deferred until OMP exposes it; current "print prompt, expect reply" works because the next retain re-prompts).
- Migrating existing users off hardcoded configs (config file is forward-compatible — old files load as before).
- Removing `extensions/sync.ts` in favor of `extensions/synth.ts`. The two are registered in `package.json` together; that consolidation is a separate refactor.
- Changing detection on platforms other than macOS / Linux (Windows env-var override works; cwd-walk works; common-spots may need Windows equivalents in a follow-up).

## Acceptance Criteria

1. On a machine with `OMP_VAULT_ROOT=/custom/vault` and no config file, the first retain event writes to `/custom/vault/...` and creates `~/.omp/omp-obsidian-sync.json` with `vaultRoot: "/custom/vault"`.
2. On a machine without env vars but with a cwd under a folder containing `.obsidian/`, the wizard prints that folder as the detected vault.
3. On a machine where nothing is detected, the wizard still prints a prompt and accepts an `ok` reply (using last-resort `~/Notes` / `~/Sites`); it does **not** silently use those paths.
4. A user replying `skip` three times in a row gets three audit log lines and no note files written.
5. After setup completes once, a fresh retain on the same machine does not re-prompt.
6. `/synthesize setup` re-runs the wizard and overwrites the config when confirmed.
7. `bun test` passes; the README's install + configuration sections match the new behavior; no occurrence of `os.homedir()`-baked `Notes` / `fikrimastor` paths in `extensions/` runtime code without an env-var or detection override above it.
