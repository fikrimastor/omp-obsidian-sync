import { describe, it, expect } from "bun:test";
import { dedupBullets, findPromotables } from "./dedup";

describe("dedupBullets", () => {
  it("handles empty or null input", () => {
    expect(dedupBullets([])).toEqual([]);
    // @ts-expect-error - testing runtime null
    expect(dedupBullets(null)).toEqual([]);
  });

  it("deduplicates exact matches", () => {
    const input = ["Hello world", "Hello world", "Something else"];
    expect(dedupBullets(input)).toEqual(["Hello world", "Something else"]);
  });

  it("deduplicates based on first 4 words", () => {
    const input = [
      "The quick brown fox jumps over the lazy dog",
      "The quick brown fox sleeps all day",
      "Different start entirely",
    ];
    expect(dedupBullets(input)).toEqual([
      "The quick brown fox jumps over the lazy dog",
      "Different start entirely",
    ]);
  });

  it("deduplicates based on Levenshtein distance (default 20%)", () => {
    const input = [
      "This is a very long sentence for testing", // 40 chars
      "This is a very long sentence for testing!", // 41 chars (1 diff / 41 < 20%)
      "Completely different sentence",
    ];
    expect(dedupBullets(input)).toEqual([
      "This is a very long sentence for testing",
      "Completely different sentence",
    ]);
  });

  it("respects custom word share threshold", () => {
    const input = [
      "The quick brown fox",
      "The quick brown cat", // 1 diff / 19 chars ≈ 5%
    ];
    // Tight threshold: 1% (should NOT dedup)
    expect(dedupBullets(input, 0.01)).toEqual(input);
    // Loose threshold: 30% (should dedup)
    expect(dedupBullets(input, 0.3)).toEqual(["The quick brown fox"]);
  });

  it("keeps distinct bullets", () => {
    const input = ["Apple", "Banana", "Cherry"];
    expect(dedupBullets(input)).toEqual(input);
  });
});

describe("findPromotables", () => {
  it("identifies bullets appearing in multiple files", () => {
    const contents = {
      "file1.md": ["Common point", "Unique 1"],
      "file2.md": ["Common point", "Unique 2"],
      "file3.md": ["Common point", "Unique 3"],
    };
    expect(findPromotables(contents)).toEqual(["Common point"]);
  });

  it("ignores bullets appearing in only one file", () => {
    const contents = {
      "file1.md": ["Unique 1"],
      "file2.md": ["Unique 2"],
    };
    expect(findPromotables(contents)).toEqual([]);
  });

  it("handles whitespace and empty strings", () => {
    const contents = {
      "file1.md": ["  Trim me  ", ""],
      "file2.md": ["Trim me", "   "],
    };
    expect(findPromotables(contents)).toEqual(["Trim me"]);
  });

  it("handles empty input", () => {
    expect(findPromotables({})).toEqual([]);
  });
});
