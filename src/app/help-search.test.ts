import { describe, expect, test } from "vitest";
import { matchesQuery, highlightSegments } from "./help-search";

describe("matchesQuery", () => {
  test("true when query empty", () => { expect(matchesQuery("Title", "Body", "")).toBe(true); });
  test("matches title case-insensitively", () => { expect(matchesQuery("Gantt chart", "body", "GANTT")).toBe(true); });
  test("matches body", () => { expect(matchesQuery("Title", "keyboard shortcuts", "keyboard")).toBe(true); });
  test("false on no match", () => { expect(matchesQuery("Title", "Body", "zzz")).toBe(false); });
});

describe("highlightSegments", () => {
  test("splits a string into matched / unmatched parts", () => {
    expect(highlightSegments("abcABCabc", "abc")).toEqual([
      { text: "abc", match: true }, { text: "ABC", match: true }, { text: "abc", match: true },
    ]);
  });
  test("returns one unmatched segment when query empty", () => {
    expect(highlightSegments("hello", "")).toEqual([{ text: "hello", match: false }]);
  });
  test("preserves surrounding text", () => {
    expect(highlightSegments("a key b", "key")).toEqual([
      { text: "a ", match: false }, { text: "key", match: true }, { text: " b", match: false },
    ]);
  });
});
