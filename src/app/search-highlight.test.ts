import { describe, expect, it } from "vitest";

import { splitHighlight } from "./search-highlight";

describe("splitHighlight", () => {
  it("splits text around a single occurrence", () => {
    expect(splitHighlight("Fix login bug", "login")).toEqual([
      { text: "Fix ", match: false },
      { text: "login", match: true },
      { text: " bug", match: false },
    ]);
  });

  it("splits around multiple occurrences into alternating segments", () => {
    expect(splitHighlight("aXaXa", "X")).toEqual([
      { text: "a", match: false },
      { text: "X", match: true },
      { text: "a", match: false },
      { text: "X", match: true },
      { text: "a", match: false },
    ]);
  });

  it("matches case-insensitively but preserves original casing", () => {
    expect(splitHighlight("Login here", "log")).toEqual([
      { text: "Log", match: true },
      { text: "in here", match: false },
    ]);
  });

  it("returns a single non-match segment when there is no occurrence", () => {
    expect(splitHighlight("hello", "zzz")).toEqual([
      { text: "hello", match: false },
    ]);
  });

  it("returns the whole text as non-match for an empty or whitespace query", () => {
    expect(splitHighlight("hello", "")).toEqual([
      { text: "hello", match: false },
    ]);
    expect(splitHighlight("hello", "   ")).toEqual([
      { text: "hello", match: false },
    ]);
  });

  it("treats regex metacharacters as literals", () => {
    expect(splitHighlight("a.b.c", ".")).toEqual([
      { text: "a", match: false },
      { text: ".", match: true },
      { text: "b", match: false },
      { text: ".", match: true },
      { text: "c", match: false },
    ]);
    expect(splitHighlight("a(b)", "(")).toEqual([
      { text: "a", match: false },
      { text: "(", match: true },
      { text: "b)", match: false },
    ]);
  });

  it("returns a single match segment when the whole string matches", () => {
    expect(splitHighlight("abc", "abc")).toEqual([
      { text: "abc", match: true },
    ]);
  });

  it("returns a single empty non-match segment for empty text", () => {
    expect(splitHighlight("", "x")).toEqual([{ text: "", match: false }]);
  });
});
