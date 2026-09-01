// Hand-rolled DOCX (OOXML) builder. Shared ZIP writer + palette live in
// export-ooxml-shared.ts; re-exported via export-ooxml.ts. The format-level
// pieces (cell runs, table, package assembly) live in ooxml-docx-primitives.ts
// so this file is only about turning ExportSections into a body.
import type { ExportSection } from "./export-sections";
import {
  COLOR_DARK_BLUE,
  COLOR_MEDIUM_GREY,
  todayHuman,
  xmlEscape,
} from "./export-ooxml-shared";
import { createLinkSink, type LinkSink } from "./ooxml-links";
import { DOC_STYLES, buildDocxPackage, buildDocxTable } from "./ooxml-docx-primitives";

// ============================================================================
// DOCX
// ============================================================================

/** Render one ExportSection as a DOCX heading paragraph + table.
 *
 *  ★★★ EVERY `<w:rPr>` BELOW IS IN EG_RPrBase SEQUENCE ORDER, and it is not
 *  alphabetical or authoring order: `w:i` is position 5, `w:color` 19, `w:sz`
 *  24 — so italic comes BEFORE colour, and colour before size. CT_RPr is an
 *  `xsd:sequence`; a strict OOXML validator (the Open XML SDK and everything
 *  built on it) REJECTS an out-of-sequence run-property list, while Word itself
 *  is lenient, which is how `<w:color/><w:i/>` sat in both paragraphs here
 *  unnoticed. This is the same rule `DOCX_MARK_RPR`'s `rank` table enforces for
 *  the rich path — read its comment before reordering anything here. */
function buildDocxSection(section: ExportSection, links: LinkSink): string {
  return `
    <w:p>
      <w:pPr><w:pStyle w:val="Title"/></w:pPr>
      <w:r>
        <w:rPr><w:color w:val="${COLOR_DARK_BLUE}"/><w:sz w:val="36"/></w:rPr>
        <w:t>${xmlEscape(section.title)}</w:t>
      </w:r>
    </w:p>
    <w:p>
      <w:r>
        <w:rPr><w:i/><w:color w:val="${COLOR_MEDIUM_GREY}"/></w:rPr>
        <w:t xml:space="preserve">${section.rows.length} row${section.rows.length === 1 ? "" : "s"}</w:t>
      </w:r>
    </w:p>
    <w:p/>
    ${buildDocxTable(section.columns, section.rows, undefined, links)}
    <w:p/>`;
}

/**
 * Build a `.docx` Blob containing a title paragraph + one heading+table block
 * per ExportSection. Accepts the pre-computed sections list so the caller
 * (exportWorkspace) can compute it once and share it across all three builders.
 */
export function buildDocx(sections: ExportSection[]): Blob {
  // ★★ ONE sink for the whole document, because `word/_rels/document.xml.rels`
  // is one relationship scope no matter how many sections feed it — a sink per
  // section would mint `rId2` repeatedly and two links would collide on one id.
  //
  // ★★★ `2` IS THE WHOLE ARITHMETIC HERE, and that is what makes this scope
  // different from the document renderer's. rId1 is the styles part; this
  // exporter emits NO media at all — there is no image path in this file and
  // it passes an empty `media` array below — so nothing else is reserved and
  // the first free id is rId2 unconditionally. `doc-render-docx.ts` cannot say
  // that: it mints media relIds DURING its body render, so it has to offset by
  // an upper bound on the media count (`2 + mediaIdCeiling(doc)`). Do not copy
  // that expression here, and do not copy this bare `2` there.
  const links = createLinkSink(2);
  const sectionsXml = sections.map((section) => buildDocxSection(section, links)).join("");

  const body = `<w:p>
      <w:pPr><w:pStyle w:val="Title"/></w:pPr>
      <w:r>
        <w:rPr><w:color w:val="${COLOR_DARK_BLUE}"/><w:sz w:val="48"/></w:rPr>
        <w:t>AI PM Cockpit</w:t>
      </w:r>
    </w:p>
    <w:p>
      <w:r>
        <w:rPr><w:i/><w:color w:val="${COLOR_MEDIUM_GREY}"/></w:rPr>
        <w:t xml:space="preserve">Exported ${xmlEscape(todayHuman())}</w:t>
      </w:r>
    </w:p>
    <w:p/>
    ${sectionsXml}`;

  // ★★★ `DOC_STYLES` IS NOT OPTIONAL HERE as of §141(b), and the failure it
  // prevents is silent. The seven rich entity fields reach this export as table
  // cells, and a rich cell emits `w:pStyle` naming `Heading1`-`Heading4`,
  // `ListParagraph`, `Quote` or `CodeBlock`. A `w:pStyle` naming a style
  // styles.xml does not declare is SILENTLY IGNORED by Word — the heading would
  // render as body text with every assertion about the emitted XML still green,
  // which is exactly the fidelity this slice exists to add.
  // ★★★ IT IS NOT ONLY `word/styles.xml`, and this line claimed it was —
  // "`word/document.xml` is byte-identical for a workspace whose rich fields
  // are empty or plain". Measured false in BOTH named cases, because a rich
  // COLUMN routes through `docxRichParagraphs` whatever its value is:
  //   • empty  — the old cell body was `<w:p>` around one empty run; the new
  //     one is `<w:p/>` (`descriptionHtml("")` is "", `htmlToRichLines("")` is
  //     [], and the builder's empty branch emits the self-closing paragraph).
  //   • plain  — the runs match, but the old cell body was a multi-line
  //     template carrying newlines and indentation inside `<w:p>`, and
  //     `docxRichParagraphs` emits neither.
  // Both outputs are valid and render identically, so nothing here is a
  // FUNCTIONAL change — the byte claim was the defect. `word/document.xml` is
  // byte-identical only for a workspace with no rows in any rich-column entity
  // at all, i.e. no rich cell ever built — AND only against a baseline that
  // already carries the `<w:i/>`-before-`<w:color/>` reorder above.
  // ★★★ THAT SECOND CLAUSE IS THE CORRECTION'S OWN CORRECTION, and it was
  // falsified by the SAME COMMIT that wrote the sentence: that commit also put
  // the two `<w:rPr>`s into schema order, and one of them is in THIS function's
  // unconditional header — the "Exported <date>" run, emitted for a workspace
  // with no sections at all. So against a pre-reorder baseline `document.xml`
  // differs for EVERY workspace, empty ones included, and the sentence was
  // wrong about precisely the decision it names below. Reproduce:
  //   git show dbe3723b:src/app/export-docx.ts | grep -n "w:rPr"   # old order
  //   grep -nE "^ +<w:rPr><w:i/>" src/app/export-docx.ts           # new, 2 hits
  // ★ The second pattern is ANCHORED for a reason a first cut got wrong: a grep
  // quoted inside the file it scans MATCHES ITSELF, so the unanchored form
  // returned 3 — two real hits plus this comment — and the count beside it was
  // already stale when it was written.
  // ★ Say what holds: a byte claim that is nearly true is worse than none,
  // because it is what a reader reaches for when deciding whether a golden
  // fixture needs regenerating. ★ A correction inherits none of the
  // verification of the thing it corrects — run a command against the
  // REPLACEMENT, which is why the two above are here rather than described.
  // ★ `"landscape"` and `[]` are this file's long-standing defaults spelled out
  // because `links` is positional and trails them; both are the values the
  // two-argument call resolved to, so a link-free workspace is unmoved.
  return buildDocxPackage(body, DOC_STYLES, "landscape", [], links.rels());
}
