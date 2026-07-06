import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { DEFAULTS, SynthConfig } from "./config";

const getConfigPath = () => process.env.OMP_SYNC_CONFIG ?? path.join(os.homedir(), ".omp", "omp-obsidian-sync.json");

/**
 * Checks if the configuration file exists.
 * If it doesn't, the setup wizard needs to be run.
 */
export function needsSetup(): boolean {
  return !fs.existsSync(getConfigPath());
}

/**
 * Writes the provided configuration overrides to the config file.
 * Returns the path to the written config file.
 */
export function writeConfig(overrides: Partial<SynthConfig>): string {
  const configPath = getConfigPath();
  const configDir = path.dirname(configPath);
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }

  const finalConfig = { ...DEFAULTS, ...overrides };
  if (overrides.topicAliases) {
    finalConfig.topicAliases = { ...DEFAULTS.topicAliases, ...overrides.topicAliases };
  }

  fs.writeFileSync(configPath, JSON.stringify(finalConfig, null, 2), "utf8");
  return configPath;
}

/**
 * Detects default paths for the vault and repositories.
 * Checks ~/Notes for the vault and ~/Sites for repository roots.
 */
export function detectDefaults(): { vaultRoot: string; reposRoot: string } {
  const home = os.homedir();
  const potentialVault = path.join(home, "Notes");
  const sitesDir = path.join(home, "Sites");

  let vaultRoot = potentialVault;
  if (!fs.existsSync(potentialVault)) {
    vaultRoot = potentialVault;
  }

  let reposRoot = path.join(home, "Sites", "fikrimastor");
  if (fs.existsSync(sitesDir)) {
    const dirs = fs.readdirSync(sitesDir).filter((d) => {
      const fullPath = path.join(sitesDir, d);
      return fs.statSync(fullPath).isDirectory();
    });
    if (dirs.length > 0) {
      // Prioritize 'fikrimastor' if it exists, otherwise pick the first one
      const priority = dirs.find(d => d === 'fikrimastor');
      reposRoot = path.join(sitesDir, priority ?? dirs[0]);
    }
  } else {
    reposRoot = path.join(home, "Sites", "fikrimastor");
  }

  return { vaultRoot, reposRoot };
}

/**
 * Returns the prompt text to be displayed to the user during setup.
 */
export function setupPrompt(): string {
  return `Welcome to the OMP Obsidian Sync setup! 🚀

I need to configure a few paths to get started:
1. Vault Root: The location of your Obsidian vault (Default: ~/Notes)
2. Repos Root: The base directory containing your projects (Default: ~/Sites/fikrimastor)

I can attempt to detect these for you. Would you like me to use the detected defaults or provide specific paths?`;
}
