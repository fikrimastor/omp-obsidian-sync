import { expect, test, describe } from "bun:test";
import { parseTags } from "./parse-tags";


describe("parseTags", () => {
  test("parses project and valid topic tag", () => {
    const input = "[project:rph] [arch] uses Encore auth handlers";
    const result = parseTags(input);
    expect(result).toEqual({
      project: "rph",
      topic: "arch",
      content: "uses Encore auth handlers",
    });
  });

  test("parses project and canonical topic tag", () => {
    const input = "[project:rph] [architecture] uses Encore auth handlers";
    const result = parseTags(input);
    expect(result).toEqual({
      project: "rph",
      topic: "architecture",
      content: "uses Encore auth handlers",
    });
  });

  test("parses project and lowercase project name", () => {
    const input = "[project:RPH] uses Encore auth handlers";
    const result = parseTags(input);
    expect(result).toEqual({
      project: "rph",
      topic: null,
      content: "uses Encore auth handlers",
    });
  });

  test("handles invalid topic tag (should return null topic)", () => {
    const input = "[project:rph] [random] some content";
    const result = parseTags(input);
    expect(result).toEqual({
      project: "rph",
      topic: null,
      content: "some content",
    });
  });

  test("returns null when no project tag is present", () => {
    const input = "no tags at all";
    const result = parseTags(input);
    expect(result).toBeNull();
  });

  test("handles leading whitespace", () => {
    const input = "  [project:rph] [arch] content";
    const result = parseTags(input);
    expect(result).toEqual({
      project: "rph",
      topic: "arch",
      content: "content",
    });
  });

  test("handles project name with hyphens and underscores", () => {
    const input = "[project:my-project_1] [tech] content";
    const result = parseTags(input);
    expect(result).toEqual({
      project: "my-project_1",
      topic: "tech",
      content: "content",
    });
  });
});
