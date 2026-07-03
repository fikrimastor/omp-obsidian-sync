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
