import { test, expect } from "bun:test";
import { classifyTopic } from "./topic";

test("detects architecture from 'uses' keyword", () => {
  expect(classifyTopic("uses Encore auth handlers")).toBe("architecture");
});

test("detects architecture from 'tech stack' keyword", () => {
  expect(classifyTopic("Go + Encore tech stack")).toBe("architecture");
});

test("detects bugs from 'error' or 'fix' keywords", () => {
  expect(classifyTopic("fixed the N+1 query error")).toBe("bugs");
  expect(classifyTopic("bug in login flow")).toBe("bugs");
});

test("detects conventions from 'always' or 'never' keywords", () => {
  expect(classifyTopic("always guard on runtime config key")).toBe("conventions");
  expect(classifyTopic("never commit .env files")).toBe("conventions");
});

test("detects workflow from 'before' or 'step' keywords", () => {
  expect(classifyTopic("stop containers before build")).toBe("workflow");
  expect(classifyTopic("first step is install")).toBe("workflow");
});

test("detects tech-stack from project names", () => {
  expect(classifyTopic("using PostgreSQL 16 and Redis")).toBe("tech-stack");
  expect(classifyTopic("Nuxt 3 + Laravel monorepo")).toBe("tech-stack");
});

test("detects decisions from 'decided' or 'tradeoff' keywords", () => {
  expect(classifyTopic("decided to use Fiber over stdlib")).toBe("decisions");
  expect(classifyTopic("tradeoff: consistency vs availability")).toBe("decisions");
});


test("defaults to uncategorized for unrelated content", () => {
  expect(classifyTopic("random note about anything unique")).toBe("uncategorized");
  expect(classifyTopic("")).toBe("uncategorized");
});

test("is case-insensitive", () => {
  expect(classifyTopic("USES PostgreSQL")).toBe("architecture");
  expect(classifyTopic("BUG FIX in production")).toBe("bugs");
});

test("prioritizes first matching rule", () => {
  // "uses" (architecture) comes before "bug" (bugs) in RULES
  expect(classifyTopic("uses fix for the bug")).toBe("architecture");
});
