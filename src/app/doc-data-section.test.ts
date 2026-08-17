// src/app/doc-data-section.test.ts
//
// Unit tests for the shared dataSection resolver. These moved out of
// doc-render-docx.test.ts when the resolver was extracted: they are about the
// registry lookup, not about WordprocessingML, and all three renderers depend
// on this contract. The DOCX tests that assert on document.xml stayed behind.

import { describe, it, expect, beforeAll } from "vitest";
import { resolveDataSection } from "./doc-data-section";
import { cellText, isRichCell } from "./export-sections";
import { exportCellHtml } from "./download";
import { loadI18n, t } from "./i18n";
import type { Workspace } from "./workspace";

const empty = { tasks: [], raid: [] } as unknown as Workspace;

const populated = {
  // ★ The Task text field is `taskName`, NOT `title` (that is RaidItem). A
  // fixture using `title` yields a task whose name is "", so any assertion
  // that "A task" is absent passes without the code being right.
  tasks: [{ id: 9, taskName: "A task", status: "To Do" }],
  raid: [
    { id: 1, title: "Vendor delay", category: "Risk", status: "Open" },
    // ★ Row 1 carries BOTH shapes of cell in one row: `title` is a plain column
    // whose value needs escaping, `description` is in RAID_RICH_COLUMNS and so
    // arrives as a RichCell. The two-paragraph value is deliberate — the flat
    // half must show the block boundary as a newline, which is the only thing
    // that distinguishes the export projection from the collapsing one.
    {
      id: 2,
      title: "Budget & scope <risk>",
      description: "<p>alpha</p><p>beta</p>",
      category: "Risk",
      status: "Open",
    },
  ],
} as unknown as Workspace;

describe("resolveDataSection", () => {
  beforeAll(async () => {
    // The DE dictionary is lazy; asserting German output without this reads
    // back the English string and the assertion passes for the wrong reason.
    await loadI18n("de");
  });

  it("resolves a populated register through the real registry", () => {
    const section = resolveDataSection("raid", populated, "en-US");
    expect(section).not.toBeNull();
    expect(section!.key).toBe("raid");
    expect(section!.columns.length).toBeGreaterThan(0);
    // One row per entity — the registry's projection, not a reshaped copy.
    expect(section!.rows).toHaveLength(2);
    expect(section!.rows.flat()).toContain("Vendor delay");
  });

  it("returns null for an empty register", () => {
    // The common case in a fresh project. Callers render nothing for null; if
    // this returned an empty section instead, every generated document would
    // grow a stray heading and an empty table.
    expect(resolveDataSection("raid", empty, "en-US")).toBeNull();
    expect(resolveDataSection("tasks", empty, "en-US")).toBeNull();
  });

  it("selects ONLY the requested section", () => {
    const section = resolveDataSection("raid", populated, "en-US");
    expect(section!.key).toBe("raid");
    // The workspace also has a task; enabling more than the requested key
    // would silently pull it in.
    expect(JSON.stringify(section!.rows)).not.toContain("A task");
  });

  it("returns null for a section whose builder yields ZERO ROWS", () => {
    // ★ Not hypothetical. 13 of the 15 builders gate on `items.length > 0` and
    // cannot produce this. `project` gates on ws.project being PRESENT and
    // `status` on its having KEYS — but projectSection skips every blank field
    // and statusSection drops every empty line, so both can hand back a real
    // section with no rows. A freshly created project whose metadata nobody has
    // filled in is exactly that case; without the guard every generated
    // document grows an empty "Project" table.
    const blankProject = { ...empty, project: {} } as unknown as Workspace;
    const blankStatus = { ...empty, status: { ragScope: "" } } as unknown as Workspace;
    expect(resolveDataSection("project", blankProject, "en-US")).toBeNull();
    expect(resolveDataSection("status", blankStatus, "en-US")).toBeNull();
  });

  it("still returns the section once it has a single real row", () => {
    // CONTROL for the test above: if the guard were over-broad — dropping the
    // section whenever the source object is sparse rather than when it has no
    // rows — this would fail and the one above would still pass.
    const realProject = { ...empty, project: { name: "Apollo" } } as unknown as Workspace;
    const section = resolveDataSection("project", realProject, "en-US");
    expect(section).not.toBeNull();
    expect(section!.key).toBe("project");
    expect(section!.rows).toHaveLength(1);
    expect(section!.rows.flat()).toContain("Apollo");
  });

  it("is not hardcoded to one key", () => {
    const tasks = resolveDataSection("tasks", populated, "en-US");
    expect(tasks!.key).toBe("tasks");
    expect(tasks!.rows.flat()).toContain("A task");
  });

  it("threads lang through to the section title", () => {
    // ★ MUST use the TASKS section. The RAID title is the acronym "RAID" in
    // both i18n.ts and i18n.de.ts, so the same assertion on raid passes even
    // if `lang` is dropped on the floor — a test that cannot fail.
    const en = resolveDataSection("tasks", populated, "en-US");
    const de = resolveDataSection("tasks", populated, "de");
    expect(en!.title).toBe(t("en-US", "tasks"));
    expect(de!.title).toBe(t("de", "tasks"));
    expect(de!.title).not.toBe(en!.title);
  });

  it("hands the renderer UNESCAPED values, in exactly two cell shapes", () => {
    // ★★ THE OLD NAME HERE WAS "returns cells as plain strings for the renderer
    // to escape", and BOTH halves of it stopped being true when ExportCell grew
    // to `string | number | RichCell`. Cells are no longer all strings, and the
    // renderer no longer escapes all of them — it escapes the flat ones and
    // SANITIZES the rich ones. What survives unchanged, and is the part worth
    // pinning here, is that this module pre-escapes NOTHING: it is the renderer
    // that decides, and a value pre-escaped here would be double-escaped there.
    const section = resolveDataSection("raid", populated, "en-US");
    const flat = section!.rows.flat();

    for (const cell of flat) {
      if (isRichCell(cell)) {
        // A rich cell is well formed or it is a renderer crash — DOCX writes
        // `undefined` and PPTX "[object Object]" for a missing half.
        expect(typeof cell.html).toBe("string");
        expect(typeof cell.text).toBe("string");
      } else {
        // No third shape: a bare object that is not a RichCell would reach
        // every renderer as "[object Object]".
        expect(["string", "number"]).toContain(typeof cell);
      }
    }

    // The plain column arrives verbatim, ampersand and angle brackets intact.
    expect(flat).toContain("Budget & scope <risk>");
    // Nothing anywhere in the section is pre-escaped — checked through the flat
    // projection so rich cells are covered by this too, not just plain ones.
    expect(flat.map(cellText).join(" ")).not.toContain("&amp;");
    expect(flat.map(cellText).join(" ")).not.toContain("&lt;");
  });

  it("routes a rich cell to the markup path and a plain cell to the escaping path", () => {
    // The CONSUMER-side half of the contract above, and the reason the rename
    // was not just cosmetic: `exportCellHtml` is the ONE place HTML/PDF decides
    // between markup and escaped text, and it decides on the CELL SHAPE this
    // module chose. Asserting the shape alone would leave that decision — the
    // thing a reader of this file actually cares about — untested.
    const section = resolveDataSection("raid", populated, "en-US");
    const titleIdx = section!.columns.indexOf("title");
    const descIdx = section!.columns.indexOf("description");
    expect(titleIdx).toBeGreaterThanOrEqual(0);
    expect(descIdx).toBeGreaterThanOrEqual(0);

    const row = section!.rows[1]; // the fixture row carrying both shapes
    const titleCell = row[titleIdx];
    const descCell = row[descIdx];

    expect(isRichCell(titleCell)).toBe(false);
    expect(isRichCell(descCell)).toBe(true);

    // The flat half a non-layout renderer (PPTX) reads: tags gone, and the
    // paragraph boundary kept as the "\n" each renderer maps to its own
    // primitive. Hardcoded, NOT recomputed with the projection the code uses —
    // an oracle derived from the same call would hold for any implementation.
    expect(cellText(descCell)).toBe("alpha\nbeta");

    // Plain cell -> escaped. This is the branch the old test name described.
    expect(exportCellHtml(titleCell)).toBe("Budget &amp; scope &lt;risk&gt;");

    // Rich cell -> markup, NOT escaped. A document embedding a register must
    // render the description as paragraphs; escaping it here is what would put
    // a literal "<p>" in front of the reader.
    const descHtml = exportCellHtml(descCell);
    expect(descHtml).toContain("<p>alpha</p>");
    expect(descHtml).toContain("<p>beta</p>");
    expect(descHtml).not.toContain("&lt;p&gt;");
  });
});
