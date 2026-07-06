import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Audit log for the doc-synth plugin.
 * Appends a line of activity to the audit log file in the Obsidian vault.
 * 
 * @param vaultRoot - The root directory of the Obsidian vault.
 * @param line - The activity line to log.
 * @param options - Internal options for testing (optional).
 * @throws {void} - Never throws.
 */
export function auditLog(vaultRoot: string, line: string): void {
    try {
        const logPath = path.join(vaultRoot, '.omp-audit.log');
        const timestamp = new Date().toISOString();
        const formattedLine = `[${timestamp}] ${line}\n`;
        fs.appendFileSync(logPath, formattedLine, 'utf8');
    } catch (error) {
        // Silent fail as per requirements: "Never throws"
    }
}
