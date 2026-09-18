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

  it("is case-sensitive, matching the plain \"g\" regex it replaced", () => {
    // §558 fix round 3, item 5: forEachTagPair used to hardcode "gi"
    // unconditionally, silently widening every OOXML caller (this one
    // included) beyond the plain "g" lazy regex it replaced. OOXML element
    // names are case-sensitive XML, so an uppercase look-alike is a
    // DIFFERENT tag, not the same one spelled differently.
    const xml = "<T>up</T><t>low</t>";
    expect(extractRuns(xml, "t")).toEqual(["low"]);
  });

  it("does not confuse a tag with a hyphenated look-alike", () => {
    // §558 fix round 3, item 6: `\b` fires between "t" and "-" (both are
    // non-word-vs-non-word... "-" is non-word, "t" is word, so `\b` DOES
    // match there), so a `\b`-based open pattern treated "<t-alt" as if it
    // were "<t " and merged forward into the next real <t>...</t> exactly
    // like the self-closing bug above. Old regex: ["real"]. `\b`-based open
    // pattern (the regression this test catches): ["decoy</t-alt><t>real"].
    const xml = "<t-alt>decoy</t-alt><t>real</t>";
    expect(extractRuns(xml, "t")).toEqual(["real"]);
  });

  it("skips a bare self-closing tag instead of merging the next run into it (xlsx shape)", () => {
    // §558 fix round 3: porting extractRuns onto forEachTagPair regressed
    // this - without skipSelfClosing, <t/> paired with the NEXT <t>...</t>,
    // swallowing "</si><si><t>" as if it were part of the first run's text.
    // Old regex: ["hello"]. New code before this fix: ["</si><si><t>hello"].
    const xml = "<si><t/></si><si><t>hello</t></si>";
    expect(extractRuns(xml, "t")).toEqual(["hello"]);
  });

  it("skips a bare self-closing tag instead of merging the next run into it (docx shape)", () => {
    // Same regression, the docx w:t namespace form. Old regex: ["Real"].
    // New code before this fix: ["</w:p><w:p><w:t>Real"].
    const xml = "<w:p><w:t/></w:p><w:p><w:t>Real</w:t></w:p>";
    expect(extractRuns(xml, "w:t")).toEqual(["Real"]);
  });

  it("skips a self-closing tag with attributes, not just the bare form", () => {
    // A DIFFERENT, pre-existing bug: the ORIGINAL regex (before this whole
    // slice, and before Task 3's port) already merged THIS form forward -
    // `(?:\s[^>]*)?>` fires on the leading whitespace before `xml:space`,
    // so it matched `<t xml:space="preserve"/>` as an ordinary open tag and
    // then searched for the next `</t>`. The `gt - 1 === "/"` check fixes
    // both forms with one guard, so this one is fixed as a side effect, not
    // separately targeted.
    const xml = '<w:p><w:t xml:space="preserve"/></w:p><w:p><w:t>Real</w:t></w:p>';
    expect(extractRuns(xml, "w:t")).toEqual(["Real"]);
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
