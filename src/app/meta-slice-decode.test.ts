import { describe, expect, it } from "vitest";
import { hasDecodedContent, isEmptyDecoded, sanitizedToNothing } from "./meta-slice-decode";

describe("hasDecodedContent (§617)", () => {
  it.each([
    [null, false], [undefined, false], ["", false], [[], false], [{}, false],
    [[{}], false], [{ narrative: "" }, false], [{ a: [null, ""] }, false],
    ["x", true], [0, true], [false, true], [[1], true], [{ name: "", code: "APO" }, true],
    [{ deep: { deeper: ["y"] } }, true],
  ] as const)("%j → %s", (raw, expected) => {
    expect(hasDecodedContent(raw)).toBe(expected);
  });
});

describe("isEmptyDecoded (§617)", () => {
  it.each([
    [null, true], [undefined, true], [[], true], [{}, true],
    [[1], false], [{ a: 1 }, false], ["", false], [0, false],
  ] as const)("%j → %s", (value, expected) => {
    expect(isEmptyDecoded(value)).toBe(expected);
  });
});

describe("sanitizedToNothing (§617)", () => {
  it("is true only when content went in and nothing came out", () => {
    expect(sanitizedToNothing([{ bogus: true }], [])).toBe(true);
    expect(sanitizedToNothing({ name: "", code: "APO" }, null)).toBe(true);
    expect(sanitizedToNothing([], [])).toBe(false);          // a stored empty list
    expect(sanitizedToNothing({ narrative: "" }, {})).toBe(false); // blanks only
    expect(sanitizedToNothing([{ id: 1 }], [{ id: 1 }])).toBe(false);
  });
});
