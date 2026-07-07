import path from "node:path";
import fs from "node:fs";
import { loadConfigOrDetect } from "./config";

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
  // Prefer explicit overrides (tests + callers with full config). Otherwise
  // resolve via loadConfigOrDetect so env / cwd / common / fallback all apply.
  const detected = opts.vaultRoot && opts.reposRoot
    ? null
    : loadConfigOrDetect(cwd);
  const vaultRoot = opts.vaultRoot ?? detected!.vaultRoot;
  const reposRoot = opts.reposRoot ?? detected!.reposRoot;

  if (isProject) {
    const relative = path.relative(reposRoot, cwd);
    const isInsideRepos =
      relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
    if (isInsideRepos) {
      const repoName = relative.split(path.sep)[0];
      if (repoName) {
        // Verify the repo directory actually exists — prevents treating a sibling
        // directory with a shared prefix (e.g. "groceries-clone") as a real repo.
        try {
          const candidatePath = path.join(reposRoot, repoName);
          if (fs.statSync(candidatePath).isDirectory()) {
            return path.join(vaultRoot, repoName);
          }
        } catch {
          // Directory doesn't exist or isn't accessible — fall through.
        }
      }
    }
  }

  return path.join(vaultRoot, GENERAL_DIR_NAME);
}

const TOPIC_ALIASES: Record<string, string> = {
  arch: "architecture", bug: "bugs", conv: "conventions",
  wf: "workflow", tech: "tech-stack", dec: "decisions",
};

export function canonicalTopic(topic: string, aliases: Record<string, string> = TOPIC_ALIASES): string {
  return aliases[topic.toLowerCase()] ?? topic;
}

export function resolveProjectTopicPath(
  project: string,
  topic: string,
  vaultRoot: string,
): string {
  return path.join(vaultRoot, project, `${canonicalTopic(topic)}.md`);
}

