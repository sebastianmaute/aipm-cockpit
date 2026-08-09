import { describe, it, expect } from "vitest";
import { parseHelpBody, stripHelpMarkers, helpBodyLabels } from "./help-body-markup";

describe("parseHelpBody", () => {
  it("splits a marker out of surrounding text", () => {
    expect(parseHelpBody("Click [[Take the tour]] below.")).toEqual([
      { text: "Click ", isLabel: false },
      { text: "Take the tour", isLabel: true },
      { text: " below.", isLabel: false },
    ]);
  });

  it("returns one plain segment when there is no marker", () => {
    expect(parseHelpBody("Nothing here.")).toEqual([{ text: "Nothing here.", isLabel: false }]);
  });

  it("returns one empty segment for an empty body", () => {
    expect(parseHelpBody("")).toEqual([{ text: "", isLabel: false }]);
  });

  // A malformed marker must degrade to literal text. Throwing or returning []
  // would blank a help body in the UI — worse than showing the brackets.
  it("treats an unclosed marker as literal text", () => {
    expect(parseHelpBody("Click [[Take the tour")).toEqual([
      { text: "Click [[Take the tour", isLabel: false },
    ]);
  });

  it("treats an empty marker as literal text", () => {
    expect(parseHelpBody("a [[]] b")).toEqual([{ text: "a [[]] b", isLabel: false }]);
  });

  it("handles two markers in one body", () => {
    expect(parseHelpBody("[[Print]] then [[Reset]]")).toEqual([
      { text: "Print", isLabel: true },
      { text: " then ", isLabel: false },
      { text: "Reset", isLabel: true },
    ]);
  });
});

describe("stripHelpMarkers", () => {
  it("removes the brackets and keeps the label text", () => {
    expect(stripHelpMarkers("Click [[Take the tour]] below.")).toBe("Click Take the tour below.");
  });

  it("is a no-op on unmarked text", () => {
    expect(stripHelpMarkers("Nothing here.")).toBe("Nothing here.");
  });
});

describe("helpBodyLabels", () => {
  it("returns every marked label in order", () => {
    expect(helpBodyLabels("[[Print]] then [[Reset]]")).toEqual(["Print", "Reset"]);
  });

  it("returns an empty list when there are no markers", () => {
    expect(helpBodyLabels("Nothing here.")).toEqual([]);
  });
});
