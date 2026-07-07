import fs from "node:fs";
import path from "node:path";
import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent/extensibility/hooks";
import { extractFacts } from "./lib/extract";
import { classify } from "./lib/classify";
import { resolveTargetDir } from "./lib/route";
import { writeNote } from "./lib/note";
import { loadConfigOrDetect } from "./lib/config";
import { auditSkip } from "./lib/audit";
import { needsSetup, configPathFor } from "./lib/setup";
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
 * Resolves the runtime vault + repos paths:
 * - if HandleOptions overrides are given, those win (test path).
 * - otherwise loadConfigOrDetect() runs the env > cwd > common > fallback
 *   detection layered over the file config.
 */
function resolvePaths(opts: HandleOptions): { vaultRoot: string; reposRoot: string } {
  if (opts.vaultRoot && opts.reposRoot) {
    return { vaultRoot: opts.vaultRoot, reposRoot: opts.reposRoot };
  }
  const cfg = loadConfigOrDetect(opts.cwd ?? process.cwd());
  return { vaultRoot: opts.vaultRoot ?? cfg.vaultRoot, reposRoot: opts.reposRoot ?? cfg.reposRoot };
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

    // First-run onboarding gate: if no config file exists and the caller did
    // not pass a vaultRoot override, skip-side-effect this event and audit it
    // under the config dir. The next retain will re-prompt because the user
    // still hasn't run `/synthesize setup`.
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
