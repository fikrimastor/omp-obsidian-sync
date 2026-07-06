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

export function registerCommand(pi: unknown): void {
  // Registration logic depends on the OMP runtime.
  // Expected to be wired as:
  // pi.onCommand("synthesize", async (args: unknown) => {
  //   const parsed = args as { project?: string };
  //   return handleSynthesizeCommand({
  //     project: parsed.project ?? "all",
  //     vaultRoot: loadConfig().vaultRoot,
  //   });
  // });
}
