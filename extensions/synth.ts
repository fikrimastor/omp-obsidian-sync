import { ExtensionAPI } from "@oh-my-pi/pi-coding-agent/extensibility/hooks";
import fs from "node:fs";
import path from "node:path";
import { extractFacts } from "./lib/extract";
import { parseTags } from "./lib/parse-tags";
import { classifyTopic } from "./lib/topic";
import { loadConfig, SynthConfig } from "./lib/config";
import { resolveProjectTopicPath } from "./lib/route";
import { appendBullet } from "./lib/append-note";
import { readState, writeState, incrementPending } from "./lib/state";
import { runSynthesis } from "./lib/synthesize";
import { auditLog } from "./lib/audit";

/**
 * Sync error logger for the synthesis hook.
 * Ensures hook failures don't crash the OMP session.
 */
function logSyncError(err: unknown): void {
  try {
    const logPath = path.join(process.cwd(), "sync-errors.log");
    const timestamp = new Date().toISOString();
    const message = err instanceof Error ? err.stack : String(err);
    fs.appendFileSync(logPath, `[${timestamp}] ${message}\n`, "utf8");
  } catch {
    // Total failure: write to stderr as last resort
    process.stderr.write("Critical failure in logSyncError\n");
  }
}

/**
 * Core logic for processing a 'retain' or 'learn' event.
 * Separated from the OMP hook for unit testing.
 */
export function handleRetain(event: { toolName: string; input: unknown; cwd: string }, opts?: Partial<SynthConfig>) {
  try {
    const config = loadConfig();
    const finalConfig = { ...config, ...opts };
    const vaultRoot = finalConfig.vaultRoot;

    const facts = extractFacts(event.toolName, event.input);
    if (!facts) return;

    for (const rawFact of facts) {
      const tags = parseTags(rawFact);
      
      // Requirement: General (untagged) facts -> audit log only, no file
      if (!tags) {
        auditLog(vaultRoot, `fact (general): ${rawFact.slice(0, 50)}...`);
        continue;
      }

      const { project, content } = tags;
      // Requirement: Project facts WITHOUT topic tag -> classifyTopic for topic
      const topic = tags.topic ?? classifyTopic(content);
      
      const filePath = resolveProjectTopicPath(project, topic, vaultRoot);
      
      const written = appendBullet({
        filePath,
        content,
        project,
        topic,
      });

      if (written) {
        // Track pending synthesis for this project
        const state = readState(vaultRoot);
        const newState = incrementPending(state, project);
        writeState(vaultRoot, newState);

        // Check threshold for triggering synthesis
        if (newState[project] >= finalConfig.threshold) {
          runSynthesis(project, vaultRoot, finalConfig);
        }
      } else {
        auditLog(vaultRoot, `fact (dup): [${project}] ${content.slice(0, 50)}...`);
      }
    }
  } catch (err) {
    logSyncError(err);
  }
}

/**
 * OMP Extension Registration
 */
export default function (pi: ExtensionAPI) {
  pi.on("tool_result", (event) => {
    // Only process 'retain' and 'learn' tools
    if (event.toolName === "retain" || event.toolName === "learn") {
      handleRetain({
        toolName: event.toolName,
        input: event.input,
        cwd: event.cwd,
      });
    }
  });
}
