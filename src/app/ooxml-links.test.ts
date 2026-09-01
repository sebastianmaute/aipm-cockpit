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
