import { describe, it, expect } from "vitest";
import { nextNoteId, addNote, editNote, deleteNote, canEditNote, sanitizeNoteLog, encodeNoteLog, decodeNoteLog } from "./note-log";
import type { NoteLogEntry } from "./types";

describe("note-log codec", () => {
  const good = {
    authorResourceId: 7,
    authorName: "Ann",
    timestamp: "2026-07-16T10:00:00.000Z",
    text: "Called the vendor",
  };

  it("round-trips a valid entry through encode/decode (id minted, html derived from text)", () => {
    const back = decodeNoteLog(encodeNoteLog([good]));
    expect(back).toEqual([{ ...good, id: 1, html: "<p>Called the vendor</p>" }]);
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

  it("strips residual control chars but degrades the newline to a space", () => {
    const out = sanitizeNoteLog([{ timestamp: good.timestamp, text: "a\u0000b\u0007c\ndone" }]);
    expect(out).toHaveLength(1);
    expect(out[0].text).toBe("abc done");
  });

  it("degrades newlines/tabs to a single space (readable single line)", () => {
    const nl = String.fromCharCode(10);
    const crlf = String.fromCharCode(13, 10);
    const tab = String.fromCharCode(9);
    expect(sanitizeNoteLog([{ timestamp: good.timestamp, text: "line1" + nl + "line2" }])[0].text).toBe("line1 line2");
    expect(sanitizeNoteLog([{ timestamp: good.timestamp, text: "a" + crlf + "b" + tab + "c" }])[0].text).toBe("a b c");
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

const base: NoteLogEntry = { id: 1, timestamp: "2026-01-01T00:00:00.000Z", html: "<p>a</p>", text: "a", authorResourceId: 7, authorName: "Sam" };

describe("nextNoteId", () => {
  it("is max+1", () => expect(nextNoteId([base, { ...base, id: 4 }])).toBe(5));
  it("is 1 for empty", () => expect(nextNoteId([])).toBe(1));
});

describe("addNote", () => {
  it("appends a stamped entry with self as author", () => {
    const out = addNote([base], { html: "<p>b</p>", text: "b", timestamp: "2026-02-02T00:00:00.000Z", self: 9, authorName: "Alex" });
    expect(out).toHaveLength(2);
    expect(out[1]).toMatchObject({ id: 2, html: "<p>b</p>", text: "b", authorResourceId: 9, authorName: "Alex" });
  });
  it("is authorless when self is null", () => {
    const out = addNote([], { html: "<p>x</p>", text: "x", timestamp: "2026-02-02T00:00:00.000Z", self: null });
    expect(out[0].authorResourceId).toBeUndefined();
  });
});

describe("canEditNote", () => {
  it("true for matching author", () => expect(canEditNote(base, 7)).toBe(true));
  it("false for other author", () => expect(canEditNote(base, 8)).toBe(false));
  it("true for authorless", () => expect(canEditNote({ ...base, authorResourceId: undefined }, 8)).toBe(true));
});

describe("editNote", () => {
  it("updates body + editedAt for the author", () => {
    const out = editNote([base], 1, { html: "<p>z</p>", text: "z", editedAt: "2026-03-03T00:00:00.000Z", self: 7, authorName: "Sam" });
    expect(out[0]).toMatchObject({ html: "<p>z</p>", text: "z", editedAt: "2026-03-03T00:00:00.000Z", authorResourceId: 7 });
  });
  it("claims an authorless note on edit", () => {
    const authorless: NoteLogEntry = { id: 1, timestamp: "2026-01-01T00:00:00.000Z", html: "<p>a</p>", text: "a" };
    const out = editNote([authorless], 1, { html: "<p>z</p>", text: "z", editedAt: "2026-03-03T00:00:00.000Z", self: 5, authorName: "Kim" });
    expect(out[0]).toMatchObject({ authorResourceId: 5, authorName: "Kim" });
  });
});

describe("deleteNote", () => {
  it("removes by id", () => expect(deleteNote([base, { ...base, id: 2 }], 1)).toEqual([{ ...base, id: 2 }]));
});

describe("sanitizeNoteLog legacy upgrade", () => {
  it("mints ids and derives html from text for legacy entries", () => {
    const legacy = [{ timestamp: "2026-01-01T00:00:00.000Z", text: "hello" }] as unknown as NoteLogEntry[];
    const out = sanitizeNoteLog(legacy);
    expect(out[0].id).toBe(1);
    expect(out[0].text).toBe("hello");
    expect(out[0].html).toContain("hello");
  });
});
