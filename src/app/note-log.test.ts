import { describe, it, expect } from "vitest";
import { sanitizeNoteLog, encodeNoteLog, decodeNoteLog } from "./note-log";

describe("note-log codec", () => {
  const good = {
    authorResourceId: 7,
    authorName: "Ann",
    timestamp: "2026-07-16T10:00:00.000Z",
    text: "Called the vendor",
  };

  it("round-trips a valid entry through encode/decode", () => {
    const back = decodeNoteLog(encodeNoteLog([good]));
    expect(back).toEqual([good]);
  });

  it("encodes empty/undefined to '' (byte-stable, legacy rows untouched)", () => {
    expect(encodeNoteLog(undefined)).toBe("");
    expect(encodeNoteLog([])).toBe("");
  });

  it("decodes an empty cell to []", () => {
    expect(decodeNoteLog("")).toEqual([]);
    expect(decodeNoteLog(null)).toEqual([]);
    expect(decodeNoteLog("not json")).toEqual([]);
  });

  it("drops an entry with empty/whitespace text", () => {
    expect(sanitizeNoteLog([{ timestamp: good.timestamp, text: "   " }])).toEqual([]);
    expect(sanitizeNoteLog([{ timestamp: good.timestamp, text: "" }])).toEqual([]);
  });

  it("drops an entry with a non-ISO timestamp", () => {
    expect(sanitizeNoteLog([{ timestamp: "not-a-date", text: "hi" }])).toEqual([]);
    expect(sanitizeNoteLog([{ text: "hi" }])).toEqual([]);
  });

  it("strips control chars from text (keeps the entry)", () => {
    const out = sanitizeNoteLog([{ timestamp: good.timestamp, text: "a\u0000b\u0007c\ndone" }]);
    expect(out).toHaveLength(1);
    expect(out[0].text).toBe("abcdone");
  });

  it("drops a non-positive authorResourceId but keeps the entry", () => {
    const out = sanitizeNoteLog([{ timestamp: good.timestamp, text: "hi", authorResourceId: -3 }]);
    expect(out).toHaveLength(1);
    expect(out[0].authorResourceId).toBeUndefined();
  });

  it("returns [] for non-array input", () => {
    expect(sanitizeNoteLog(undefined)).toEqual([]);
    expect(sanitizeNoteLog("x")).toEqual([]);
    expect(sanitizeNoteLog({})).toEqual([]);
  });
});
