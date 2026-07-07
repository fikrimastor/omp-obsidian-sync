import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { auditLog, auditSkip } from './audit';

describe('auditLog', () => {
    const testVaultRoot = path.join(process.cwd(), 'test-vault');
    const logFile = path.join(testVaultRoot, '.omp-audit.log');

    beforeEach(() => {
        if (!fs.existsSync(testVaultRoot)) {
            fs.mkdirSync(testVaultRoot, { recursive: true });
        }
    });

    afterEach(() => {
        if (fs.existsSync(testVaultRoot)) {
            fs.rmSync(testVaultRoot, { recursive: true, force: true });
        }
    });

    it('creates the log file and appends a line if it does not exist', () => {
        const message = 'retain rph/architecture.md "content"';
        auditLog(testVaultRoot, message);

        expect(fs.existsSync(logFile)).toBe(true);
        const content = fs.readFileSync(logFile, 'utf8');
        expect(content).toContain(message);
        // Check timestamp format [YYYY-MM-DDTHH:mm:ss.sssZ]
        expect(content).toMatch(/^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.*Z\] /);
    });

    it('appends multiple lines to the log file', () => {
        auditLog(testVaultRoot, 'line 1');
        auditLog(testVaultRoot, 'line 2');

        const lines = fs.readFileSync(logFile, 'utf8').trim().split('\n');
        expect(lines).toHaveLength(2);
        expect(lines[0]).toContain('line 1');
        expect(lines[1]).toContain('line 2');
    });

    it('does not throw when the path is invalid or read-only', () => {
        const invalidRoot = '/non-existent-path-12345/root';
        expect(() => auditLog(invalidRoot, 'this should not throw')).not.toThrow();
    });
});

describe('auditSkip', () => {
    it("auditSkip writes a 'setup skipped' tagged line", () => {
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "audit-skip-"));
        auditSkip(tmp, "setup skipped", "first fact content");
        const log = fs.readFileSync(path.join(tmp, ".omp-audit.log"), "utf8");
        expect(log).toContain("setup skipped");
        expect(log).toContain("first fact content");
        fs.rmSync(tmp, { recursive: true, force: true });
    });

    it("auditSkip never throws on missing dir", () => {
        expect(() => auditSkip("/nonexistent/path/xyz", "setup skipped")).not.toThrow();
    });
});
