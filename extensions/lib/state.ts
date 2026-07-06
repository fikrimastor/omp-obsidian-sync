import fs from "node:fs";
import path from "node:path";

const STATE_FILENAME = ".omp-state.json";

export type ProjectState = Record<string, number>;

export function statePath(vaultRoot: string): string {
  return path.join(vaultRoot, STATE_FILENAME);
}

export function readState(vaultRoot: string): ProjectState {
  const fp = statePath(vaultRoot);
  try {
    return JSON.parse(fs.readFileSync(fp, "utf8"));
  } catch {
    return {};
  }
}

export function writeState(vaultRoot: string, data: ProjectState): void {
  const dir = path.dirname(statePath(vaultRoot));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(statePath(vaultRoot), JSON.stringify(data, null, 2), "utf8");
}

export function incrementPending(state: ProjectState, project: string): ProjectState {
  return { ...state, [project]: (state[project] ?? 0) + 1 };
}

export function resetPending(state: ProjectState, project: string): ProjectState {
  return { ...state, [project]: 0 };
}
