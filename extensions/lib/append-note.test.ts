import { test, expect, beforeEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { appendBullet } from "./append-note";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync("/tmp/append-test-");
});

test("creates file and appends bullet", () => {
  const fp = path.join(dir, "rph", "architecture.md");
  const appended = appendBullet({ filePath: fp, content: "uses Encore auth handlers", project: "rph", topic: "architecture" });
  expect(appended).toBe(true);
  expect(fs.existsSync(fp)).toBe(true);
  const text = fs.readFileSync(fp, "utf8");
  expect(text).toContain("uses Encore auth handlers");
  expect(text).toContain("project: rph");
  expect(text).toContain("topic: architecture");
});

test("drops exact-match duplicate", () => {
  const fp = path.join(dir, "rph", "architecture.md");
  appendBullet({ filePath: fp, content: "duplicate fact", project: "rph", topic: "architecture" });
  const r2 = appendBullet({ filePath: fp, content: "duplicate fact", project: "rph", topic: "architecture" });
  expect(r2).toBe(false);
});

test("appends to existing file with newer date", () => {
  const fp = path.join(dir, "rph", "architecture.md");
  appendBullet({ filePath: fp, content: "first fact", project: "rph", topic: "architecture" });
  appendBullet({ filePath: fp, content: "second fact", project: "rph", topic: "architecture" });
  const text = fs.readFileSync(fp, "utf8");
  // newest bullet first, so "second fact" should appear before "first fact"
  const idx2 = text.indexOf("second fact");
  const idx1 = text.indexOf("first fact");
  expect(idx2).toBeLessThan(idx1);
});
