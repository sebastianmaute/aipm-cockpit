import { describe, it, expect } from "vitest";
import { quoteStep, splitCsvLines } from "./csv-line-scan";

describe("quoteStep", () => {
  it("returns null on a character that is not a quote", () => {
    expect(quoteStep("abc", 0, false)).toBeNull();
    expect(quoteStep("abc", 0, true)).toBeNull();
  });

  it("opens a quote from outside", () => {
    expect(quoteStep('"a', 0, false)).toEqual({ inQuotes: true, next: 1 });
  });

  it("closes a quote from inside", () => {
    expect(quoteStep('a"b', 1, true)).toEqual({ inQuotes: false, next: 2 });
  });

  it("treats a doubled quote inside quotes as an escape and stays inside", () => {
    expect(quoteStep('a""b', 1, true)).toEqual({ inQuotes: true, next: 3 });
  });
});

describe("splitCsvLines", () => {
  it("splits on CRLF outside quotes", () => {
    expect(splitCsvLines("a\r\nb").lines).toEqual(["a", "b"]);
  });

  it("normalizes a bare LF break to the same split", () => {
    expect(splitCsvLines("a\nb").lines).toEqual(["a", "b"]);
  });

  it("does NOT split on a newline inside a quoted cell", () => {
    expect(splitCsvLines('x,"one\ntwo",y').lines).toEqual(['x,"one\r\ntwo",y']);
  });

  it("does NOT split on a marker-shaped line inside a quoted cell", () => {
    const text = '1,T,"step one\n# RAID\nstep two"\r\n2,U,';
    expect(splitCsvLines(text).lines).toEqual([
      '1,T,"step one\r\n# RAID\r\nstep two"',
      "2,U,",
    ]);
  });

  it("leaves a BARE CR untouched — split(/\\r?\\n/) does not break on it either", () => {
    expect(splitCsvLines("a\rb").lines).toEqual(["a\rb"]);
  });

  it("keeps the trailing empty element a trailing break produces", () => {
    expect(splitCsvLines("a\r\n").lines).toEqual(["a", ""]);
  });

  it("reports a balanced document as terminated", () => {
    expect(splitCsvLines('a,"b"\r\nc').unterminatedQuote).toBe(false);
  });

  it("reports an unterminated quote", () => {
    expect(splitCsvLines('a,"b\r\nc').unterminatedQuote).toBe(true);
  });

  // ★ THE LOSSLESS INVARIANT. Equivalence with the old regex is NOT at the
  // line-array level (the old split breaks inside quotes and we must not), it
  // is that rejoining reproduces the normalized input exactly. This is what
  // makes the one-line swap in a later task safe for all 27 sections.
  it("is lossless: rejoining reproduces the normalized input", () => {
    for (const text of ['a,"b\nc",d\r\ne', "plain\r\nrows\r\n", 'q,"""esc""",z', "a\rb\nc"]) {
      const expected = text.replace(/\r?\n/g, "\r\n");
      expect(splitCsvLines(text).lines.join("\r\n")).toBe(expected);
    }
  });
});

describe("malformedQuotes", () => {
  it("counts a quote opening mid-field", () => {
    expect(splitCsvLines('a"b,c\r\n').malformedQuotes).toBe(1);
  });

  it("counts a quoted field closing before a non-delimiter", () => {
    expect(splitCsvLines('"a"b,c\r\n').malformedQuotes).toBe(1);
  });

  it("does NOT fire on a legitimately quoted marker-shaped cell", () => {
    // ★★★ THE CONTROL THAT MATTERS, and the reason this detector is allowed to
    // exist at all. §150 REJECTS a detector that fires on this input — a
    // well-formed file legitimately carrying a marker-shaped line inside a
    // quoted cell is exactly the §105 shape the quote-aware split exists to
    // handle, and a "the two splits disagree" detector flags every one of them.
    // Without this assertion the suite cannot tell this detector from that one.
    expect(splitCsvLines('1,"# MILESTONES\r\nstill the same cell",x\r\n').malformedQuotes).toBe(0);
  });

  it("does NOT fire on a doubled quote inside a quoted cell", () => {
    expect(splitCsvLines('1,"say ""hi""",x\r\n').malformedQuotes).toBe(0);
  });

  it("does NOT fire on a well-formed unquoted row, or on an empty document", () => {
    expect(splitCsvLines("a,b,c\r\nd,e,f\r\n").malformedQuotes).toBe(0);
    expect(splitCsvLines("").malformedQuotes).toBe(0);
  });

  it("accepts a closing quote at end of input with no trailing delimiter", () => {
    // A final row need not be newline-terminated; treating EOF as a delimiter
    // is what keeps this from firing on every file that lacks a trailing CRLF.
    expect(splitCsvLines('a,"b"').malformedQuotes).toBe(0);
  });

  it("counts each violation, so two malformed fields report two", () => {
    expect(splitCsvLines('a"b,c"d\r\n').malformedQuotes).toBe(2);
  });
});
