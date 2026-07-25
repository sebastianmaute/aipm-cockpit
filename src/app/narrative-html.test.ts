import { describe, it, expect } from "vitest";
import { narrativeToHtml, normalizeNarrativeHtml, isNarrativeEmpty } from "./narrative-html";

describe("narrativeToHtml", () => {
  it("wraps and escapes a legacy plain-text narrative", () => {
    expect(narrativeToHtml("All on track & green")).toBe("<p>All on track &amp; green</p>");
  });

  it("passes rich-text HTML through untouched", () => {
    expect(narrativeToHtml("<p>Already <strong>rich</strong></p>")).toBe("<p>Already <strong>rich</strong></p>");
  });

  it("returns empty string for undefined / blank", () => {
    expect(narrativeToHtml(undefined)).toBe("");
    expect(narrativeToHtml("   ")).toBe("");
  });
});

describe("normalizeNarrativeHtml", () => {
  it("collapses newlines so the markdown round-trip cannot truncate", () => {
    expect(normalizeNarrativeHtml("<p>a</p>\n<p>b</p>")).toBe("<p>a</p> <p>b</p>");
    expect(normalizeNarrativeHtml("<p>a</p>\r\n<p>b</p>")).toBe("<p>a</p> <p>b</p>");
  });

  it("trims", () => {
    expect(normalizeNarrativeHtml("  <p>a</p>  ")).toBe("<p>a</p>");
  });
});

describe("isNarrativeEmpty", () => {
  it("treats the editor's empty paragraph as empty", () => {
    expect(isNarrativeEmpty("<p></p>")).toBe(true);
    expect(isNarrativeEmpty("<p><br></p>")).toBe(true);
    expect(isNarrativeEmpty("<p>&nbsp;</p>")).toBe(true);
  });

  it("is false when there is visible text", () => {
    expect(isNarrativeEmpty("<p>x</p>")).toBe(false);
  });
});
