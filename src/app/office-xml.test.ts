import { describe, expect, it } from "vitest";
import { decodeUtf8, unescapeXml, extractRuns } from "./office-xml";

describe("office-xml", () => {
  it("decodes UTF-8 bytes", () => {
    expect(decodeUtf8(new TextEncoder().encode("héllo"))).toBe("héllo");
  });

  it("unescapes named + numeric XML entities", () => {
    expect(unescapeXml("a &amp; b &lt;c&gt; &quot;d&quot; &apos;e&apos;")).toBe(
      `a & b <c> "d" 'e'`,
    );
    expect(unescapeXml("&#65;&#x42;")).toBe("AB");
  });

  it("leaves unknown entities untouched", () => {
    expect(unescapeXml("100&percnt;")).toBe("100&percnt;");
  });

  it("leaves an out-of-range numeric entity untouched instead of throwing", () => {
    expect(unescapeXml("x&#xFFFFFF;y")).toBe("x&#xFFFFFF;y");
    expect(unescapeXml("x&#99999999;y")).toBe("x&#99999999;y");
  });

  it("extracts ordered text runs for a tag, unescaping entities", () => {
    const xml = `<w:t>Hello</w:t><w:tab/><w:t xml:space="preserve"> world &amp; more</w:t>`;
    expect(extractRuns(xml, "w:t")).toEqual(["Hello", " world & more"]);
  });

  it("does not confuse a tag with a longer-named sibling", () => {
    const xml = `<w:tbl><w:t>cell</w:t></w:tbl>`;
    expect(extractRuns(xml, "w:t")).toEqual(["cell"]);
  });

  it("does not blow up on repetitive unclosed markup", () => {
    // 100k unclosed <t opens, no closing tag anywhere - same shape as
    // docx-extract.test.ts's fixture, sized up from its 40k: at 40k the
    // former `<tag(?:\s[^>]*)?>([\s\S]*?)</tag>` lazy pair regex measured
    // only ~1.3-2s here (a thin margin over the ceiling on a loaded
    // machine), so this pins the class at a size with real headroom -
    // measured ~11.5s old vs <5ms new, a >100x margin. extractRuns is now a
    // shared primitive (xlsx-extract.ts and pptx-extract.ts both call it),
    // so it gets its own pin rather than relying only on its callers'. The
    // ceiling is deliberately loose - it fails on the pattern class, not on
    // a machine's speed.
    const xml = "<t ".repeat(100_000);
    const start = performance.now();
    extractRuns(xml, "t");
    expect(performance.now() - start).toBeLessThan(1000);
  });
});
