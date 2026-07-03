import path from "node:path";
import fs from "node:fs";
import os from "node:os";

const DEFAULT_VAULT_ROOT = path.join(os.homedir(), "Notes");
const DEFAULT_REPOS_ROOT = path.join(os.homedir(), "Sites", "fikrimastor");
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
  const vaultRoot = opts.vaultRoot ?? DEFAULT_VAULT_ROOT;
  const reposRoot = opts.reposRoot ?? DEFAULT_REPOS_ROOT;

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
