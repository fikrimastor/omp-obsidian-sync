import { test, expect } from "bun:test";
import { classify } from "./classify";

test("detects the [project] prefix and strips it", () => {
  expect(classify("[project] uses pgvector for RAG")).toEqual({
    isProject: true,
    content: "uses pgvector for RAG",
  });
});

test("treats content without the prefix as general", () => {
  expect(classify("user prefers terse replies")).toEqual({
    isProject: false,
    content: "user prefers terse replies",
  });
});

test("only strips a leading prefix, not one mid-string", () => {
  expect(classify("note: [project] is a marker")).toEqual({
    isProject: false,
    content: "note: [project] is a marker",
  });
});

test("trims whitespace left after stripping the prefix", () => {
  expect(classify("[project]   spaced out fact")).toEqual({
    isProject: true,
    content: "spaced out fact",
  });
});
