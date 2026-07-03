import { test, expect } from "bun:test";
import { extractFacts } from "./extract";

test("extracts multiple items from a retain call", () => {
  const input = {
    items: [{ content: "fact one" }, { content: "fact two", context: "ctx" }],
    i: "test",
  };
  expect(extractFacts("retain", input)).toEqual(["fact one", "fact two"]);
});

test("extracts a single memory from a learn call", () => {
  const input = { memory: "learned fact", i: "test" };
  expect(extractFacts("learn", input)).toEqual(["learned fact"]);
});

test("returns null for unrelated tool names", () => {
  expect(extractFacts("read", { path: "x" })).toBeNull();
});

test("returns null when retain items is missing", () => {
  expect(extractFacts("retain", { i: "test" })).toBeNull();
});

test("returns null when retain items is not an array", () => {
  expect(extractFacts("retain", { items: "oops", i: "test" })).toBeNull();
});

test("skips retain items with non-string content", () => {
  const input = { items: [{ content: "ok" }, { content: 42 }], i: "test" };
  expect(extractFacts("retain", input)).toEqual(["ok"]);
});

test("returns null when retain items yields zero valid facts", () => {
  const input = { items: [{ content: 42 }], i: "test" };
  expect(extractFacts("retain", input)).toBeNull();
});

test("returns null when learn memory is missing or not a string", () => {
  expect(extractFacts("learn", { i: "test" })).toBeNull();
  expect(extractFacts("learn", { memory: 42, i: "test" })).toBeNull();
});

test("returns null for non-object input", () => {
  expect(extractFacts("retain", null)).toBeNull();
  expect(extractFacts("retain", "oops")).toBeNull();
});
