import { test, expect, beforeEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { readState, writeState, incrementPending, resetPending } from "./state";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync("/tmp/state-test-");
});

test("returns empty object for missing state file", () => {
  expect(readState(dir)).toEqual({});
});

test("writes and reads state", () => {
  writeState(dir, { rph: 3, groceries: 1 });
  expect(readState(dir)).toEqual({ rph: 3, groceries: 1 });
});

test("incrementPending increases count", () => {
  const s = incrementPending({ rph: 0 }, "rph");
  expect(s.rph).toBe(1);
});

test("incrementPending creates new key", () => {
  const s = incrementPending({}, "rph");
  expect(s.rph).toBe(1);
});

test("resetPending sets to 0", () => {
  const s = resetPending({ rph: 5 }, "rph");
  expect(s.rph).toBe(0);
});
