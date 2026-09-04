import { describe, it, expect } from "vitest";
import { decompressRtf, rtfToPlainText, LZFU_INIT_DICT } from "./lzfu";

/** Build an UNCOMPRESSED ("MELA") container, which the format allows and which
 *  needs no compressor to construct. */
function melaContainer(rtf: string): Uint8Array {
  const body = new TextEncoder().encode(rtf);
  const out = new Uint8Array(16 + body.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, 12 + body.length, true); // compSize
  dv.setUint32(4, body.length, true); // rawSize
  out.set(new TextEncoder().encode("MELA"), 8);
  dv.setUint32(12, 0, true); // crc
  out.set(body, 16);
  return out;
}

describe("decompressRtf", () => {
  it("passes an uncompressed MELA container straight through", () => {
    const rtf = "{\\rtf1 hello}";
    expect(new TextDecoder().decode(decompressRtf(melaContainer(rtf)))).toContain("hello");
  });

  // The dictionary is byte-exact and load-bearing: one wrong byte silently
  // corrupts every decompressed body rather than failing loudly. Its real
  // validation is decompressing an ACTUAL LZFu stream, which Task 16 does with
  // the real .msg fixture. Here we only pin that it was transcribed at all.
  it("carries a transcribed initial dictionary", () => {
    expect(LZFU_INIT_DICT.startsWith("{")).toBe(true);
    expect(LZFU_INIT_DICT.length).toBeGreaterThan(180);
    expect(LZFU_INIT_DICT.length).toBeLessThanOrEqual(4096);
  });

  it("returns empty for an unknown magic rather than guessing", () => {
    const bad = melaContainer("x");
    bad.set(new TextEncoder().encode("XXXX"), 8);
    expect(decompressRtf(bad).length).toBe(0);
  });

  // ★★ SECURITY, MEASURED. The declared uncompressed size is attacker
  //  controlled — real values are 12204 and 102139 — so it must be clamped
  //  before allocation.
  it("clamps an absurd declared uncompressed size", () => {
    const c = melaContainer("hi");
    new DataView(c.buffer).setUint32(4, 0xfffffff0, true);
    expect(decompressRtf(c).length).toBeLessThan(64 * 1024 * 1024);
  });

  it("does not throw on a truncated container", () => {
    expect(() => decompressRtf(melaContainer("hello").subarray(0, 10))).not.toThrow();
  });
});

// The suite above never exercises the LZFu branch at all — every case there
// uses an uncompressed "MELA" container, whose bounds come from
// `input.subarray(...)`, not from the LZFu allocation this file's ★★
// hostile-input comment is actually about. These tests build real
// LZFu-magic containers by hand so the decode loop, its back-reference
// ring-buffer arithmetic, its end marker, and its allocation clamp are each
// actually run at least once.
describe("decompressRtf (LZFu path)", () => {
  /** Build a real ("LZFu") compressed container from raw compressed-data
   *  bytes (control bytes and their tokens). */
  function lzfuContainer(rawSize: number, compressedBytes: number[]): Uint8Array {
    const out = new Uint8Array(16 + compressedBytes.length);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, 12 + compressedBytes.length, true); // compSize
    dv.setUint32(4, rawSize, true); // rawSize
    out.set(new TextEncoder().encode("LZFu"), 8);
    dv.setUint32(12, 0, true); // crc
    out.set(Uint8Array.from(compressedBytes), 16);
    return out;
  }

  // The ring buffer's write offset starts right after the preloaded
  // dictionary. Only its LENGTH is relied on here (asserted to be 207 at
  // module load) — never its CONTENT, which is unproven until Task 16.
  const dictEnd = LZFU_INIT_DICT.length;

  it("decompresses an all-literal run", () => {
    const bytes = [0x00, 0x61, 0x62, 0x63]; // control=all-literal, 'a' 'b' 'c'
    const out = decompressRtf(lzfuContainer(3, bytes));
    expect(new TextDecoder().decode(out)).toBe("abc");
  });

  it("resolves a back-reference into its own freshly written output", () => {
    // One run: bits 0-2 are literal 'a' 'b' 'c' (written at ring-buffer
    // offsets dictEnd..dictEnd+2), bit 3 is a reference token copying 2
    // bytes back from dictEnd. Per the format's ABNF (RUN=CONTROL 8*8TOKEN)
    // a run's tokens are read in order off ONE control byte — it cannot be
    // split into two control bytes the way an earlier draft of this test
    // tried, which made the decoder read the second control byte itself as
    // a fourth literal token of the first run.
    const ref = (dictEnd << 4) | (2 - 2); // offset=dictEnd, length=2
    const control = 0x00 | 0x08; // bits 0-2 literal, bit 3 reference
    const bytes = [control, 0x61, 0x62, 0x63, (ref >> 8) & 0xff, ref & 0xff];
    const out = decompressRtf(lzfuContainer(5, bytes));
    expect(new TextDecoder().decode(out)).toBe("abcab");
  });

  it("wraps a back-reference around the end of the ring buffer", () => {
    // A length long enough that offset + i walks past DICT_SIZE (4096) must
    // still resolve via modulo. Positions 4094/4095 are past the preloaded
    // dictionary and never written in this test, so they read as 0; once
    // the index wraps past 4096 it lands back on the dictionary's own first
    // two bytes. A missing `% DICT_SIZE` reads past the array (JS yields
    // `undefined`, which a Uint8Array assignment coerces to 0) instead —
    // this asserts the actual wrapped VALUES, not just the output length,
    // so that regression is caught rather than silently zero-filled. It
    // reads LZFU_INIT_DICT's own bytes rather than assuming particular
    // values, since the dictionary's exact content is unproven until Task 16
    // — only its length (207, asserted at module load) is relied on here.
    const dictSize = 4096; // mirrors lzfu.ts's internal DICT_SIZE, not exported
    const offset = dictSize - 2; // 4094; offset+2 and offset+3 wrap to 0 and 1
    const ref = (offset << 4) | (4 - 2); // length=4
    const bytes = [0x01, (ref >> 8) & 0xff, ref & 0xff];
    const out = decompressRtf(lzfuContainer(4, bytes));
    expect(Array.from(out)).toEqual([0, 0, LZFU_INIT_DICT.charCodeAt(0), LZFU_INIT_DICT.charCodeAt(1)]);
  });

  it("stops at the end-of-stream marker instead of reading a phantom token", () => {
    // A reference token whose offset equals the CURRENT write position is
    // the format's end marker, per MS-OXRTFCP, and must halt decoding
    // immediately rather than being treated as a real back-reference.
    const ref = dictEnd << 4;
    const bytes = [0x01, (ref >> 8) & 0xff, ref & 0xff];
    const out = decompressRtf(lzfuContainer(10, bytes));
    expect(out.length).toBe(0);
  });

  it("does not throw when a reference token is truncated mid-stream", () => {
    // control byte declares "reference" but only one of the two token bytes
    // is actually present before the compressed data ends.
    const bytes = [0x01, 0x00];
    expect(() => decompressRtf(lzfuContainer(10, bytes))).not.toThrow();
    expect(decompressRtf(lzfuContainer(10, bytes)).length).toBe(0);
  });

  // ★★ SECURITY, MEASURED. This is the allocation the clamp in
  //  decompressRtf actually guards — `melaContainer`-based tests above never
  //  reach it, since the MELA path returns a `subarray` view rather than
  //  allocating `rawSize` bytes. `.buffer.byteLength` is asserted rather
  //  than `.length` because `.length` reflects how much was DECODED, not how
  //  much was ALLOCATED, and a tiny compressed payload decodes to a tiny
  //  `.length` regardless of whether the clamp ran.
  it("bounds the LZFu allocation itself, not just the decoded view", () => {
    const c = lzfuContainer(0, [0x00]); // control byte only; loop exits at pos===end
    new DataView(c.buffer).setUint32(4, 0xfffffff0, true); // declare ~4.29 GB
    const out = decompressRtf(c);
    expect(out.buffer.byteLength).toBeLessThanOrEqual(64 * 1024 * 1024);
  });
});

describe("rtfToPlainText", () => {
  it("strips control words and keeps the text", () => {
    expect(rtfToPlainText("{\\rtf1\\ansi\\deff0 Hello \\b world\\b0 .}")).toContain("Hello world");
  });

  it("drops a font table group entirely", () => {
    const out = rtfToPlainText("{\\rtf1{\\fonttbl{\\f0 Arial;}}Visible}");
    expect(out).toContain("Visible");
    expect(out).not.toContain("Arial");
  });

  it("turns \\par into a line break", () => {
    expect(rtfToPlainText("{\\rtf1 one\\par two}")).toMatch(/one\s*\n\s*two/);
  });

  it("decodes a hex escape", () => {
    expect(rtfToPlainText("{\\rtf1 caf\\'e9}")).toContain("café");
  });

  // ★★ THIS TEST PASSED AGAINST A MATCHER THAT COULD NOT STRIP A SINGLE REAL
  //  GROUP, which is why it is kept and immediately followed by the ones that
  //  cannot. `{\*\htmltag <p>}` uses a SPACE delimiter — the bare form Outlook
  //  never writes — and `not.toContain("htmltag")` is satisfied anyway by the
  //  catch-all control-word strip further down `rtfToPlainText`, whatever the
  //  destination matcher does. Keep it as a delimiter case; do not read it as
  //  cover for the numeric-parameter form.
  it("strips a space-delimited destination group", () => {
    const out = rtfToPlainText("{\\rtf1\\fromhtml1 {\\*\\htmltag <p>}Hi{\\*\\htmltag </p>}}");
    expect(out).toContain("Hi");
    expect(out).not.toContain("htmltag");
  });

  // ★★★ REGRESSION, MEASURED ON THE REAL `.msg` FIXTURE. The destination
  //  matcher delimited the name with `\b`, which requires a NON-WORD character
  //  next. Real Outlook writes a numeric parameter — `\htmltag19`,
  //  `\htmltag34`, `\htmltag161` — and both the `g` and the digit are word
  //  characters, so no boundary exists and the group was never stripped: all
  //  108 `\htmltag<digit>` groups in the committed fixture survived,
  //  `rtfToPlainText` returned 40,948 characters of Word `<style>` preamble
  //  carrying 531 residual HTML tags, and the message text began only at index
  //  38,329 — past the 20,000-character `MAIL_BODY_FLOOR`, so the model was
  //  handed the preamble and never the body. Per the RTF specification a
  //  control word ends at the first NON-ALPHABETIC character with an optional
  //  numeric parameter after it, hence `(?![A-Za-z])`.
  //  ★ The surrounding text is asserted on BOTH sides deliberately: a matcher
  //  that over-runs its group would take the following text with it, and an
  //  assertion only on what is ABSENT cannot tell that apart from a fix.
  it("strips a destination group carrying a numeric parameter", () => {
    const out = rtfToPlainText("{\\rtf1 BEFORE {\\*\\htmltag19 <b>x</b>} AFTER\\par}");
    expect(out).not.toContain("<b>x</b>");
    expect(out).toContain("BEFORE");
    expect(out).toContain("AFTER");
  });

  it("strips a destination group carrying a multi-digit parameter", () => {
    const out = rtfToPlainText("{\\rtf1 BEFORE {\\*\\htmltag161 <table>} AFTER\\par}");
    expect(out).not.toContain("<table>");
    expect(out).toContain("BEFORE");
    expect(out).toContain("AFTER");
  });

  // Both directions of the delimiter, because only together do they say what
  // it means: a following LETTER makes a DIFFERENT control word and must not
  // be swallowed (`\infobar` is not `\info`), while a following DIGIT is this
  // control word's numeric parameter and must be.
  // ★ Verified rather than assumed: the `\infobar` half is UNCHANGED
  //  behaviour — `\b` refused that one too, since `o` and `b` are both word
  //  characters — so it is a pin, not a regression test. Only the `\info1`
  //  half goes red against the old matcher. Recorded so nobody reads the pair
  //  as two regressions.
  it("treats a following letter as a different control word and a following digit as a parameter", () => {
    const kept = rtfToPlainText("{\\rtf1 {\\info{\\author X}}{\\infobar KEEPME} AFTER\\par}");
    expect(kept).toContain("KEEPME");
    expect(kept).not.toContain("author");

    const stripped = rtfToPlainText("{\\rtf1 {\\info1{\\author X} SECRET} AFTER\\par}");
    expect(stripped).not.toContain("SECRET");
    expect(stripped).toContain("AFTER");
  });

  // ★★★ `\uN` IS A SIGNED 16-BIT VALUE. The substitution used to test
  //  `code >= 0` and return "" for every negative one — which is how Word and
  //  Outlook write EVERY code point above U+7FFF — so CJK above U+8000, every
  //  fullwidth form and every emoji vanished from an `rtf-degraded` body with
  //  no diagnostic at all.
  //  ★ This positive case is the CONTROL and passed before the fix: it is here
  //  so a correction that mangled the ordinary path shows up as a failure
  //  instead of reading as a pure win.
  it("decodes a positive \\uN escape", () => {
    expect(rtfToPlainText("{\\rtf1 A\\u8364 B}")).toBe("A€B");
  });

  it("decodes a negative \\uN escape as its unsigned 16-bit code unit", () => {
    // -223 + 65536 = 65313 = U+FF21 FULLWIDTH LATIN CAPITAL LETTER A. Built
    // with fromCodePoint rather than pasted, so the assertion cannot be
    // silently rewritten by an editor that mangles non-ASCII source bytes.
    expect(rtfToPlainText("{\\rtf1 A\\u-223 B}")).toBe(`A${String.fromCodePoint(0xff21)}B`);
  });

  // A non-BMP character is written as a negative SURROGATE PAIR — two separate
  // `\uN` escapes — and nothing pairs them explicitly: each is emitted as its
  // own code unit and adjacency alone recombines them.
  // ★ Asserted by CODE POINT, never by `.length`: two lone surrogates and one
  //  astral character have the same UTF-16 length, so a length assertion here
  //  would pass against a decoder that never recombined anything.
  it("recombines a negative surrogate pair into one astral character", () => {
    const out = rtfToPlainText("{\\rtf1 A\\u-10179 \\u-8704 B}"); // U+1F600
    expect(Array.from(out)).toEqual(["A", String.fromCodePoint(0x1f600), "B"]);
    expect(out.codePointAt(1)).toBe(0x1f600);
  });

  // Hostile input can carry an UNPAIRED half, and the half that matters is not
  // "does it throw" but "does it eat what follows".
  // ★ MEASURED downstream rather than assumed: the result is a NOT well-formed
  //  UTF-16 string, which is deliberate — `TextEncoder` renders the unpaired
  //  unit as U+FFFD and `JSON.stringify` escapes it, and neither throws. So the
  //  unit is carried rather than guessed at; repairing it here would need the
  //  pairing logic that the adjacency recombination above exists to avoid.
  it("carries a lone unpaired surrogate without throwing or eating what follows", () => {
    let out = "";
    expect(() => {
      out = rtfToPlainText("{\\rtf1 A\\u-10179 BCDEF}");
    }).not.toThrow();
    expect(out).toBe("A\ud83dBCDEF");
    expect(out.slice(2)).toBe("BCDEF");
    expect(() => new TextEncoder().encode(out)).not.toThrow();
  });

  // ★★★ SAMPLE THE WHOLE OUT-OF-RANGE BAND, NOT ONE POINT OF IT. `\u-70000`
  //  alone cannot discriminate the stated bound (signed 16 bits) from the one
  //  the code enforced: the two agree at exactly that value,
  //  because -70000 + 0x10000 is still negative and fell out of the codepoint
  //  test anyway. Every value in -65535..-32769 is equally illegal RTF and was
  //  silently minted into a real character — -40000 into U+63C0, a CJK glyph
  //  the sender never wrote, in text handed to the model.
  it.each([
    ["-70000", "below -65536, so even the old code dropped it"],
    ["-65536", "the boundary the old code actually enforced"],
    ["-65535", "one inside it — the old code emitted U+0001"],
    ["-40000", "mid-band — the old code emitted U+63C0"],
    ["-32769", "one past the real signed-16 minimum"],
  ])("drops the out-of-signed-16-range negative escape \\u%s (%s)", (value) => {
    expect(rtfToPlainText(`{\\rtf1 A\\u${value} B}`)).toBe("AB");
  });

  // ★★ WHAT THIS PINS IS THE SIGNED-RANGE GUARD, NOT THE CODEPOINT ONE, and
  //  the difference is a domination proof rather than a test gap. A reviewer
  //  predicted that mutating `0x10ffff` to `0x1fffff` would survive the file,
  //  and it does — but MEASURED after the signed-range fix it survives because
  //  it cannot change behaviour: `signed > 0xffff` is rejected first, and a
  //  corrected negative lands in 0x8000..0xffff, so `code` can never exceed
  //  0xffff and the codepoint test is tautological. It is kept as a backstop
  //  in case the signed guard is ever loosened; do not read its surviving
  //  mutant as licence to delete it, and do not read this test as covering it.
  //  What IS covered: `String.fromCodePoint` throws a RangeError above
  //  0x10FFFF and rtfToPlainText is contracted never to throw, so an oversized
  //  escape must be dropped rather than take the whole mail down.
  it.each(["1200000", "999999999", "-999999999999"])(
    "drops an escape outside the unicode range rather than throwing: \\u%s",
    (value) => {
      expect(() => rtfToPlainText(`{\\rtf1 A\\u${value} B}`)).not.toThrow();
      expect(rtfToPlainText(`{\\rtf1 A\\u${value} B}`)).toBe("AB");
    },
  );

  // Non-vacuity: the legal negatives on the other side of the boundary must
  // still decode. Without this, dropping every negative would pass above.
  it("still decodes legal negative escapes just inside the signed-16 range", () => {
    // -32768 is the minimum legal value; -223 is the shape Word emits for a
    // fullwidth character.
    expect(rtfToPlainText("{\\rtf1 A\\u-32768 B}")).toBe(`A${String.fromCodePoint(0x8000)}B`);
    expect(rtfToPlainText("{\\rtf1 A\\u-223 B}")).toBe("AＡB");
  });

  // ★★★ REGRESSION. A removed destination group used to leave NOTHING behind,
  //  butting the control word before it against the literal text after it —
  //  `\ansi` against `VISIBLE` — and the catch-all control-word strip is greedy
  //  on `[a-zA-Z]+`, so it swallowed `\ansiVISIBLE` whole and this input
  //  returned "". Real Outlook delimits its control words, which is why the
  //  committed `.msg` fixture never showed it and no test reached it.
  //  ★★ BOTH halves are required and neither alone is enough: the first fails
  //  against the unfixed code and passes against a SPACE replacement, the
  //  second is the opposite. Together they pin the replacement as an empty
  //  GROUP — a delimiter that adds no whitespace to a word a stripped group
  //  had split.
  it("keeps text butted directly against a stripped destination group", () => {
    expect(rtfToPlainText("{\\rtf1\\ansi{\\*\\htmltag19 <b>tag</b>}VISIBLE\\par")).toBe("VISIBLE");
    expect(rtfToPlainText("{\\rtf1 Hel{\\*\\htmltag19 <b>}lo}")).toBe("Hello");
  });
});
