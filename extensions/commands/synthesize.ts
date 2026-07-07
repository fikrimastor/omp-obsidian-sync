import fs from "node:fs";
import path from "node:path";
import { loadConfig, SynthConfig } from "../lib/config";
import { runSynthesis } from "../lib/synthesize";
import { readState } from "../lib/state";
import { auditLog } from "../lib/audit";
import { runSetupWizard } from "../lib/setup";

export interface SynthCommandArgs {
  project: string;
  vaultRoot: string;
  config?: SynthConfig;
  pi?: { note: (m: string) => void };
  reply?: string;
  cwd?: string;
}

export function handleSynthesizeCommand(args: SynthCommandArgs): string {
  const config = args.config ?? loadConfig();
  const vaultRoot = args.vaultRoot ?? config.vaultRoot;

  if (args.project === "setup") {
    if (!args.pi) return "Setup wizard requires a PI runtime; not available in CLI mode.";
    const cwd = args.cwd ?? process.cwd();
    const result = runSetupWizard({ pi: args.pi, cwd, reply: args.reply });
    if (result.status === "configured") {
      return `✅ Configured: vault=${result.config.vaultRoot} repos=${result.config.reposRoot}`;
    }
    return "⏭️  Setup skipped. Run `/synthesize setup` again with a reply (e.g. `ok` or `vault=… repos=…`).";
  }

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

export function registerCommand(pi: {
  onCommand: (name: string, handler: (args: { project?: string; reply?: string }) => Promise<string>) => void;
}): void {
  pi.onCommand("synthesize", async (args) => {
    const project = args.project ?? "all";
    return handleSynthesizeCommand({
      project,
      vaultRoot: loadConfig().vaultRoot,
      cwd: process.cwd(),
      pi: { note: (m) => process.stderr.write(m + "\n") },
      reply: args.reply,
    });
  });
}
