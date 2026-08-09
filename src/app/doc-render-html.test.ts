import { describe, it, expect } from "vitest";
import { renderDocumentHtml } from "./doc-render-html";
import type { ProjectDocument } from "./document-model";
import type { Workspace } from "./workspace";
import { PRINT_STYLES } from "./download";

// A Workspace has ~30 required slices and this renderer reads only the ones the
// section builders touch, so one narrow cast beats constructing the whole shape.
const ws = {
  tasks: [], raid: [], absences: [], shifts: [], resources: [],
  roles: [], disciplines: [], grades: [], plan: {},
} as unknown as Workspace;

const doc = (blocks: ProjectDocument["blocks"], title = "Report"): ProjectDocument => ({
  id: 1,
  title,
  blocks,
  createdAt: "2026-08-06T00:00:00.000Z",
  updatedAt: "2026-08-06T00:00:00.000Z",
});

const preview = (blocks: ProjectDocument["blocks"]): string =>
  renderDocumentHtml(doc(blocks), ws, "en-US", "preview");

describe("renderDocumentHtml — blocks", () => {
  it("renders headings at the right level", () => {
    expect(preview([{ type: "heading", level: 2, text: "Scope" }])).toContain("<h2>");
    expect(preview([{ type: "heading", level: 1, text: "Scope" }])).toContain("<h1>");
    expect(preview([{ type: "heading", level: 3, text: "Scope" }])).toContain("<h3>");
    expect(preview([{ type: "heading", level: 2, text: "Scope" }])).toContain("Scope");
  });

  it("escapes heading text", () => {
    const html = preview([{ type: "heading", level: 1, text: "<img src=x onerror=alert(1)>" }]);
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("renders bullets as ul and ordered bullets as ol, escaping each item", () => {
    expect(preview([{ type: "bullets", items: ["a"] }])).toContain("<ul>");
    expect(preview([{ type: "bullets", ordered: true, items: ["a"] }])).toContain("<ol>");
    const escaped = preview([{ type: "bullets", items: ["<b>x</b>"] }]);
    expect(escaped).toContain("&lt;b&gt;");
    expect(escaped).not.toContain("<b>");
  });

  it("renders a table with a header row and escapes its cells", () => {
    const html = preview([
      { type: "table", columns: ["Risk", "<Owner>"], rows: [["Vendor", "<AL>"]] },
    ]);
    expect(html).toContain("<th>");
    expect(html).toContain("Vendor");
    expect(html).toContain("&lt;Owner&gt;");
    expect(html).toContain("&lt;AL&gt;");
    expect(html).not.toContain("<Owner>");
  });

  it("renders a table caption only when there is one, and escapes it", () => {
    const withCaption = preview([
      { type: "table", caption: "Q1 <x>", columns: ["A"], rows: [["1"]] },
    ]);
    expect(withCaption).toContain("<caption>");
    expect(withCaption).toContain("Q1 &lt;x&gt;");

    const without = preview([{ type: "table", columns: ["A"], rows: [["1"]] }]);
    expect(without).not.toContain("<caption>");
  });

  // ★★ The escape-then-substitute ORDER in htmlCellWithBreaks. Both other
  // orderings are wrong in a different direction, and only asserting BOTH of
  // these pins it: substituting first would make our own <br> come back as a
  // visible "&lt;br&gt;", and skipping the escape to avoid that would let the
  // literal "<br>" below through as real markup.
  it("maps a newline in a table cell to <br> but escapes a literal <br>", () => {
    expect(preview([{ type: "table", columns: ["A"], rows: [["a\nb"]] }])).toContain("a<br>b");
    const literal = preview([{ type: "table", columns: ["A"], rows: [["<br>"]] }]);
    expect(literal).toContain("&lt;br&gt;");
  });

  it("renders a pageBreak marker in BOTH modes", () => {
    // The marker is emitted either way; only the standalone document carries the
    // stylesheet rule that gives it meaning (asserted in the mode block below).
    expect(preview([{ type: "pageBreak" }])).toMatch(/page-break/);
    expect(renderDocumentHtml(doc([{ type: "pageBreak" }]), ws, "en-US", "standalone")).toMatch(
      /page-break/,
    );
  });
});

describe("renderDocumentHtml — the escaped/unescaped boundary", () => {
  // paragraph.html is the ONE thing that is already-sanitized markup and must
  // pass through as markup. Everything else is plain text and must be escaped.
  // Getting this backwards is either stored XSS or visible tag soup, so both
  // directions are asserted.
  it("passes paragraph html through as MARKUP, not as escaped text", () => {
    const html = preview([{ type: "paragraph", html: "<p>Delivery is <strong>green</strong></p>" }]);
    expect(html).toContain("<strong>green</strong>");
    expect(html).not.toContain("&lt;strong&gt;");
  });

  it("sanitizes paragraph html at the sink", () => {
    // ★★ This is the layer that actually holds: the CSV/MD/Turso decoders
    // hand-build entities and never sanitize, and document-model.ts is DOM-free
    // by contract and cannot.
    const html = preview([{ type: "paragraph", html: "<p>ok</p><script>alert(1)</script>" }]);
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toContain("alert(1)");
    expect(html).toContain("ok");
  });

  it("drops a javascript: href from paragraph html", () => {
    const html = preview([{ type: "paragraph", html: `<p><a href="javascript:alert(1)">x</a></p>` }]);
    expect(html).not.toContain("javascript:");
  });

  // ★★ The sink is the DOCUMENTS allow-list, not the shared template one. The
  // assertions carry the CLOSING bracket on purpose: "<s" is a prefix of
  // <strong>/<sub>/<sup>/<span> and "<mark" of nothing today but of any future
  // tag starting the same way, so a bracket-less toContain would stay green with
  // `s` dropped from DOCUMENT_ALLOWED_TAGS as long as some <strong> survived.
  it("renders a document paragraph's new marks instead of stripping them", () => {
    const html = preview([
      { type: "paragraph", html: "<p><mark>hi</mark> <s>gone</s> <code>x</code></p>" },
    ]);
    expect(html).toContain("<mark>hi</mark>");
    expect(html).toContain("<s>gone</s>");
    expect(html).toContain("<code>x</code>");
  });

  // ★★ NOT "keeps the heading tag". sanitizeDocumentHtml's allow-list has no
  // h3/div/table, and it keeps DOMPurify's KEEP_CONTENT default, so the tag is
  // UNWRAPPED and only the words survive. That is the intended behaviour for a
  // model-authored document (structure belongs in heading/table BLOCKS), and
  // asserting only toContain("Sub") could not tell the two apart.
  it("unwraps a non-allow-listed tag inside paragraph html but keeps its text", () => {
    const html = preview([{ type: "paragraph", html: "<h3>Sub</h3>" }]);
    expect(html).toContain("Sub");
    expect(html).not.toContain("<h3");
  });
});

describe("renderDocumentHtml — data sections", () => {
  it("resolves a dataSection against the live workspace", () => {
    const wsWithRaid = {
      ...ws,
      raid: [{ id: 1, title: "Vendor delay", category: "Risk", status: "Open" }],
    } as unknown as Workspace;
    const html = renderDocumentHtml(
      doc([{ type: "dataSection", key: "raid" }]),
      wsWithRaid,
      "en-US",
      "preview",
    );
    expect(html).toContain("Vendor delay");
    expect(html).toContain("<table>");
  });

  it("renders an empty dataSection as nothing rather than a bare header", () => {
    const html = preview([{ type: "dataSection", key: "raid" }]);
    expect(html).not.toContain("<table");
    expect(html).toBe("");
  });
});

describe("renderDocumentHtml — modes", () => {
  it("standalone emits a full document, preview does not", () => {
    expect(renderDocumentHtml(doc([]), ws, "en-US", "standalone")).toMatch(/^<!DOCTYPE html>/);
    expect(renderDocumentHtml(doc([]), ws, "en-US", "preview")).not.toMatch(/DOCTYPE/);
  });

  it("preview of an empty document is the empty string", () => {
    expect(renderDocumentHtml(doc([]), ws, "en-US", "preview")).toBe("");
  });

  it("standalone carries PRINT_STYLES and defines the page-break rule", () => {
    const html = renderDocumentHtml(doc([]), ws, "en-US", "standalone");
    expect(html).toContain("@page");
    expect(html).toMatch(/\.page-break\s*\{/);
  });

  it("preview is a bare fragment with no <style> block at all", () => {
    // The absence that matters is the whole stylesheet, not just one rule: a
    // fragment is injected into a page that already has its own styles.
    const html = preview([{ type: "heading", level: 1, text: "x" }]);
    expect(html).not.toContain("<style");
    expect(html).not.toContain("@page");
    expect(html).not.toContain("portrait");
  });

  it("standalone overrides the shared landscape @page with portrait", () => {
    const html = renderDocumentHtml(doc([]), ws, "en-US", "standalone");
    expect(html).toContain("size: A4 portrait");
  });

  // ★★★ The override works ONLY because it comes later in the cascade, so
  // asserting that both strings are present would pass with the rules in the
  // wrong order and the document silently printing landscape. Both checks below
  // are guarded against the vacuous case where the anchor is missing entirely
  // (indexOf returning -1 would make a naive `>` comparison trivially true).
  it("emits the portrait override AFTER PRINT_STYLES, or the cascade loses", () => {
    const html = renderDocumentHtml(doc([]), ws, "en-US", "standalone");

    // Anchor 1: the shared constant, verbatim. Robust to its content changing.
    const stylesAt = html.indexOf(PRINT_STYLES);
    expect(stylesAt).toBeGreaterThan(-1);
    expect(html.indexOf("size: A4 portrait")).toBeGreaterThan(stylesAt + PRINT_STYLES.length - 1);

    // Anchor 2: the declaration actually being overridden. This is the one that
    // states the cascade outcome — the last `size` for the page context wins.
    const landscapeAt = html.indexOf("landscape");
    expect(landscapeAt).toBeGreaterThan(-1);
    expect(html.indexOf("portrait")).toBeGreaterThan(landscapeAt);
  });

  it("standalone shows the title in <title> and <h1>, escaped in both", () => {
    const html = renderDocumentHtml(doc([], `Q1 <img> "report"`), ws, "en-US", "standalone");
    expect(html).toContain("<title>Q1 &lt;img&gt; &quot;report&quot;</title>");
    expect(html).toContain("<h1>Q1 &lt;img&gt; &quot;report&quot;</h1>");
    expect(html).not.toContain("<img>");
  });

  // ★★ The document's lang attribute must follow the `lang` argument. A German
  // document declaring lang="en" is a WCAG 3.1.1 failure and makes a screen
  // reader pronounce it with an English voice.
  it("declares the document language from the lang argument", () => {
    expect(renderDocumentHtml(doc([]), ws, "de", "standalone")).toContain(`<html lang="de">`);
    expect(renderDocumentHtml(doc([]), ws, "en-GB", "standalone")).toContain(
      `<html lang="en-GB">`,
    );
  });

  it("joins several blocks in document order", () => {
    const html = preview([
      { type: "heading", level: 1, text: "First" },
      { type: "bullets", items: ["Second"] },
    ]);
    expect(html.indexOf("First")).toBeLessThan(html.indexOf("Second"));
  });
});
