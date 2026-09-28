import { describe, expect, it } from "vitest";
import { decodeMetaJson, hasDecodedContent, isEmptyDecoded, noteIfSanitizedToNothing, sanitizedToNothing } from "./meta-slice-decode";

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

describe("decodeMetaJson (§630)", () => {
  const keepNumbers = (raw: unknown): number[] => (Array.isArray(raw) ? raw.filter((x): x is number => typeof x === "number") : []);
  const run = (json: string, sanitize: (raw: unknown) => unknown = keepNumbers) => {
    const diag: { decodeFailedSlices?: string[] } = {};
    return { value: decodeMetaJson(json, sanitize, "k", diag), failed: diag.decodeFailedSlices };
  };

  it("records the key and returns undefined when the JSON does not parse", () => {
    expect(run("{not json")).toEqual({ value: undefined, failed: ["k"] });
  });

  it("records the key and returns undefined when the sanitizer throws", () => {
    expect(run("[1]", () => { throw new Error("no DOM"); })).toEqual({ value: undefined, failed: ["k"] });
  });

  it("records the key but still returns the sanitized value when content sanitized to nothing", () => {
    expect(run('["a"]')).toEqual({ value: [], failed: ["k"] });
  });

  it("stays silent for a stored empty value and for a value that survived", () => {
    expect(run("[]")).toEqual({ value: [], failed: undefined });
    expect(run('[1,"a"]')).toEqual({ value: [1], failed: undefined });
  });

  it("returns the same values without a diag, and does not throw", () => {
    expect(decodeMetaJson("{not json", keepNumbers, "k")).toBeUndefined();
    expect(decodeMetaJson('["a"]', keepNumbers, "k")).toEqual([]);
  });
});

describe("noteIfSanitizedToNothing (§630)", () => {
  it("records a row map that carried a value and kept none, and nothing else", () => {
    const diag: { decodeFailedSlices?: string[] } = {};
    noteIfSanitizedToNothing("status", { narrative: "" }, {}, diag);
    noteIfSanitizedToNothing("status", { ragOverride: "A" }, { ragOverride: "A" }, diag);
    expect(diag.decodeFailedSlices).toBeUndefined();
    noteIfSanitizedToNothing("status", { ragOverride: "X" }, {}, diag);
    expect(diag.decodeFailedSlices).toEqual(["status"]);
    expect(() => noteIfSanitizedToNothing("status", { ragOverride: "X" }, {}, undefined)).not.toThrow();
  });
});
