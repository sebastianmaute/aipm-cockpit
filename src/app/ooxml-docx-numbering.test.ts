// open-followups §154 — the numbering sink: one `w:num` per list instance.
import { describe, expect, it } from "vitest";
import { createNumberingSink, listHeadIndent } from "./ooxml-docx-numbering";

const numId = (numPr: string) => Number(/w:numId w:val="(\d+)"/.exec(numPr)?.[1]);
const ilvl = (numPr: string) => Number(/w:ilvl w:val="(\d+)"/.exec(numPr)?.[1]);

describe("createNumberingSink (§154)", () => {
  it("emits no part when nothing was numbered", () => {
    expect(createNumberingSink().partXml()).toBeUndefined();
  });

  it("puts w:ilvl before w:numId, as CT_NumPr requires", () => {
    const numPr = createNumberingSink().numPrFor({ ordered: true, depth: 0, index: 0 });
    expect(numPr).toBe(`<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>`);
  });

  it("continues one instance across a list's items, and starts a new one at index 0", () => {
    const sink = createNumberingSink();
    const a = [0, 1, 2].map((index) => numId(sink.numPrFor({ ordered: true, depth: 0, index })));
    const b = numId(sink.numPrFor({ ordered: true, depth: 0, index: 0 }));
    expect(a).toEqual([1, 1, 1]);
    // A second ordered list restarts at 1 only because it has its own w:num.
    expect(b).toBe(2);
    expect(sink.partXml()).toContain(`<w:num w:numId="2"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/>`);
  });

  it("keeps the outer list's instance across a nested list", () => {
    const sink = createNumberingSink();
    const outer0 = sink.numPrFor({ ordered: true, depth: 0, index: 0 });
    const inner = sink.numPrFor({ ordered: false, depth: 1, index: 0 });
    const outer1 = sink.numPrFor({ ordered: true, depth: 0, index: 1 });
    expect(numId(outer1)).toBe(numId(outer0));
    expect(numId(inner)).not.toBe(numId(outer0));
    expect(ilvl(inner)).toBe(1);
  });

  it("starts a new instance when the kind changes at a depth", () => {
    const sink = createNumberingSink();
    const bullet = numId(sink.numPrFor({ ordered: false, depth: 0, index: 1 }));
    const ordered = numId(sink.numPrFor({ ordered: true, depth: 0, index: 2 }));
    expect(ordered).not.toBe(bullet);
    // A list first seen mid-count starts where the parser says it is.
    expect(sink.partXml()).toContain(`<w:num w:numId="${ordered}"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="3"/>`);
    expect(sink.partXml()).toContain(`<w:num w:numId="${bullet}"><w:abstractNumId w:val="0"/>`);
  });

  it("starts a new instance when the count skips, so it does not continue an older list", () => {
    // Task items keep their literal box and never reach the sink, but they
    // spend ordinals: a numbered item after them arrives at index 1.
    const sink = createNumberingSink();
    const first = [0, 1].map((index) => numId(sink.numPrFor({ ordered: true, depth: 0, index })));
    const after = numId(sink.numPrFor({ ordered: true, depth: 0, index: 1 }));
    expect(first).toEqual([1, 1]);
    expect(after).toBe(2);
    expect(sink.partXml()).toContain(`<w:num w:numId="2"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="2"/>`);
  });

  it("restates the level's indent directly on a list head", () => {
    expect(listHeadIndent(0)).toBe(`<w:ind w:left="720" w:hanging="360"/>`);
    expect(listHeadIndent(2)).toBe(`<w:ind w:left="2160" w:hanging="360"/>`);
    // Past Word's last level the direct indent keeps stepping right.
    expect(listHeadIndent(9)).toBe(`<w:ind w:left="7200" w:hanging="360"/>`);
  });

  it("closes a deeper list when a shallower item arrives", () => {
    const sink = createNumberingSink();
    sink.numPrFor({ ordered: true, depth: 0, index: 0 });
    const sub = numId(sink.numPrFor({ ordered: true, depth: 1, index: 0 }));
    sink.numPrFor({ ordered: true, depth: 0, index: 1 });
    // A later sublist whose count happens to continue the old one's is still new.
    expect(numId(sink.numPrFor({ ordered: true, depth: 1, index: 1 }))).not.toBe(sub);
  });

  it("closeListsDeeperThan ends only the deeper lists", () => {
    const sink = createNumberingSink();
    const outer = numId(sink.numPrFor({ ordered: true, depth: 0, index: 0 }));
    const sub = numId(sink.numPrFor({ ordered: true, depth: 1, index: 0 }));
    sink.closeListsDeeperThan(0);
    expect(numId(sink.numPrFor({ ordered: true, depth: 1, index: 1 }))).not.toBe(sub);
    expect(numId(sink.numPrFor({ ordered: true, depth: 0, index: 1 }))).toBe(outer);
  });

  it("closeOpenLists ends every list, so a matching count does not join an older one", () => {
    const sink = createNumberingSink();
    const a = numId(sink.numPrFor({ ordered: true, depth: 0, index: 0 }));
    sink.closeOpenLists();
    expect(numId(sink.numPrFor({ ordered: true, depth: 0, index: 1 }))).not.toBe(a);
  });

  it("keeps a list past level 8 apart from its parent, though both use level 8", () => {
    const sink = createNumberingSink();
    const d8 = sink.numPrFor({ ordered: true, depth: 8, index: 0 });
    const d9 = sink.numPrFor({ ordered: true, depth: 9, index: 0 });
    // Keyed by level, this second depth-9 item would match the depth-8 list's
    // next count and join it.
    const d9b = sink.numPrFor({ ordered: true, depth: 9, index: 1 });
    const d8b = sink.numPrFor({ ordered: true, depth: 8, index: 1 });
    expect([ilvl(d8), ilvl(d9), ilvl(d8b)]).toEqual([8, 8, 8]);
    expect(numId(d9)).not.toBe(numId(d8));
    expect(numId(d9b)).toBe(numId(d9));
    expect(numId(d8b)).toBe(numId(d8));
  });

  it("clamps a depth past Word's nine levels to the last one", () => {
    expect(ilvl(createNumberingSink().numPrFor({ ordered: false, depth: 12, index: 0 }))).toBe(8);
  });

  it("defines a bullet and a decimal abstract numbering with nine levels each", () => {
    const sink = createNumberingSink();
    sink.numPrFor({ ordered: false, depth: 0, index: 0 });
    const part = sink.partXml() ?? "";
    expect(part.match(/<w:lvl /g)).toHaveLength(18);
    expect(part).toContain(`<w:numFmt w:val="bullet"/><w:lvlText w:val="•"/>`);
    expect(part).toContain(`<w:numFmt w:val="decimal"/><w:lvlText w:val="%3."/>`);
    // Text at the step the literal-marker path used, marker hanging left of it.
    expect(part).toContain(`<w:lvl w:ilvl="1"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="1440" w:hanging="360"/></w:pPr></w:lvl>`);
  });
});
