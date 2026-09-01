import { describe, expect, it } from "vitest";
import { createLinkSink, safeLinkTarget } from "./ooxml-links";

describe("safeLinkTarget", () => {
  it("admits http, https and mailto", () => {
    expect(safeLinkTarget("https://intra/spec")).toBe("https://intra/spec");
    expect(safeLinkTarget("http://intra/spec")).toBe("http://intra/spec");
    expect(safeLinkTarget("mailto:pm@example.com")).toBe("mailto:pm@example.com");
  });

  it("drops a javascript: URL — it must never reach a relationship", () => {
    expect(safeLinkTarget("javascript:alert(1)")).toBeUndefined();
    expect(safeLinkTarget("JavaScript:alert(1)")).toBeUndefined();
  });

  it("drops data:, file: and a relative href", () => {
    expect(safeLinkTarget("data:text/html,<b>x")).toBeUndefined();
    expect(safeLinkTarget("file:///etc/passwd")).toBeUndefined();
    expect(safeLinkTarget("/relative/path")).toBeUndefined();
  });

  it("drops null, empty and whitespace-only", () => {
    expect(safeLinkTarget(null)).toBeUndefined();
    expect(safeLinkTarget("")).toBeUndefined();
    expect(safeLinkTarget("   ")).toBeUndefined();
  });

  /** ★★ THE GAP BETWEEN WHAT IS VALIDATED AND WHAT IS EMITTED. `safeLinkTarget`
   *  validates `new URL(trimmed)` and returns `trimmed`, so any character the
   *  URL parser drops on its way in is checked in a string that is NOT the one
   *  written into `Target="…"`. For the SCHEME that is safe in both directions;
   *  for C0 controls it was not, and these two are the reachable shapes.
   *
   *  ★ Built with `String.fromCharCode`, never a `\u` escape in the source: an
   *  escape that loses its backslash becomes the raw byte, which renders as
   *  NOTHING in a diff and turns the fixture into the very corruption it is
   *  meant to reject. */
  const ch = (code: number): string => String.fromCharCode(code);

  it("drops a C0 control at EITHER end, which trim keeps and the URL parser strips", () => {
    // U+0001 is not Unicode whitespace, so `.trim()` leaves it in place; the
    // WHATWG parser strips it, so the parse succeeds and `https:` is admitted.
    // Emitted verbatim it is a character XML 1.0 has no representation for at
    // all — not even a numeric reference — so Word rejects the package.
    expect(safeLinkTarget(`${ch(1)}https://x`)).toBeUndefined();
    expect(safeLinkTarget(`https://x${ch(1)}`)).toBeUndefined();
  });

  it("drops an INTERIOR tab, LF or CR rather than letting a parser rewrite it", () => {
    // Legal XML, so this one ships a package that opens — with an address the
    // attribute-value normalisation turned into "https://a/ b". A silent
    // corruption is the worse of the two failures, not the milder one.
    expect(safeLinkTarget(`https://a/${ch(10)}b`)).toBeUndefined();
    expect(safeLinkTarget(`https://a/${ch(9)}b`)).toBeUndefined();
    expect(safeLinkTarget(`https://a/${ch(13)}b`)).toBeUndefined();
  });

  it("still returns an ordinary address VERBATIM, unnormalised", () => {
    // ★ The reason the C0 range is rejected rather than `parsed.href` returned:
    // `new URL("https://a").href` is "https://a/", and this contract is
    // asserted verbatim here, in the primitives tests and in both renderers'.
    expect(safeLinkTarget("https://a")).toBe("https://a");
    expect(safeLinkTarget("https://intra/spec?a=1&b=2")).toBe("https://intra/spec?a=1&b=2");
  });
});

describe("createLinkSink", () => {
  it("mints ids from the first free index", () => {
    const sink = createLinkSink(2);
    expect(sink.relIdFor("https://a")).toBe("rId2");
    expect(sink.relIdFor("https://b")).toBe("rId3");
  });

  it("returns the SAME id for a repeated target, so one url yields one relationship", () => {
    const sink = createLinkSink(2);
    expect(sink.relIdFor("https://a")).toBe("rId2");
    expect(sink.relIdFor("https://a")).toBe("rId2");
    expect(sink.rels()).toEqual([{ relId: "rId2", target: "https://a" }]);
  });

  it("starts past the media ids it was told about", () => {
    // rId1 is the styles part (DOCX) or the slide layout (PPTX); two media
    // parts then hold rId2 and rId3, so the first link is rId4.
    const sink = createLinkSink(4);
    expect(sink.relIdFor("https://a")).toBe("rId4");
  });

  it("reports no rels when nothing was minted — the additive-contract case", () => {
    expect(createLinkSink(2).rels()).toEqual([]);
  });
});
