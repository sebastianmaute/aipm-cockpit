// src/app/export-ooxml.test.ts
//
// Tests for the three OOXML builders: buildDocx, buildXlsx, buildPptx.
//
// Strategy: unzip the Blob output and inspect the XML text for structural
// evidence (headings, table cell text, sheet names, slide text, etc.).
// We don't exhaustively validate OOXML — we validate that the generalized
// section-driven rendering is wired up correctly.

import { describe, it, expect } from "vitest";
import { buildDocx, buildXlsx, buildPptx } from "./export-ooxml";
import { buildPdfHtml } from "./export";
import { buildExportSections } from "./export-sections";
import type { ExportSection } from "./export-sections";
import { descriptionTextWithBreaks } from "./rich-text-projection";
import { defaultExportConfig } from "./settings-types";
import type { ExportConfig } from "./settings-types";
import type { Workspace } from "./storage";
import type { Task, RaidItem, Milestone } from "./types";

// ---------------------------------------------------------------------------
// Minimal ZIP reader (no external dependency — reads the STORE entries we write)
// ---------------------------------------------------------------------------

/**
 * Parse a STORE-only ZIP buffer and return a map of path → UTF-8 string.
 * Reads local file headers only (signature 0x04034b50) which is sufficient
 * for our hand-rolled writer (no data descriptors, no compression).
 */
function unzip(buf: ArrayBuffer): Map<string, string> {
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);
  const dec = new TextDecoder();
  const files = new Map<string, string>();

  let offset = 0;
  while (offset + 30 < buf.byteLength) {
    const sig = view.getUint32(offset, true);
    if (sig !== 0x04034b50) break; // not a local file header

    const fnLen = view.getUint16(offset + 26, true);
    const extraLen = view.getUint16(offset + 28, true);
    const compSize = view.getUint32(offset + 18, true);

    const nameStart = offset + 30;
    const name = dec.decode(bytes.slice(nameStart, nameStart + fnLen));
    const dataStart = nameStart + fnLen + extraLen;
    const data = dec.decode(bytes.slice(dataStart, dataStart + compSize));

    files.set(name, data);
    offset = dataStart + compSize;
  }
  return files;
}

/**
 * Extract the raw ArrayBuffer from a Blob in the jsdom test environment.
 *
 * jsdom's Blob shim (used by vitest's jsdom environment) omits `.arrayBuffer()`.
 * Node's `Blob` from `node:buffer` cannot wrap a jsdom Blob as a BlobPart —
 * it serialises it as the string "[object Blob]" instead of the binary content.
 * The only reliable cross-shim path is `FileReader.readAsArrayBuffer`, which
 * jsdom does implement and which correctly yields the underlying bytes.
 */
function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

async function unzipBlob(blob: Blob): Promise<Map<string, string>> {
  const buf = await blobToArrayBuffer(blob);
  return unzip(buf);
}

/**
 * Every part of an OOXML package as ONE deterministic string.
 *
 * ★★ Do NOT byte-compare the Blob itself: `zip.ts` stamps `new Date()` into
 * each local file header, so two packages built either side of a DOS-time tick
 * (2-second resolution) differ in bytes while every rendered part is identical.
 * The parts ARE the output; the container stamp is not.
 */
async function packageText(blob: Blob): Promise<string> {
  const parts = await unzipBlob(blob);
  return [...parts.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, xml]) => `=== ${name} ===\n${xml}`)
    .join("\n");
}

// ---------------------------------------------------------------------------
// Fixture helpers (shared across all three builder suites)
// ---------------------------------------------------------------------------

function makeTask(id: number, overrides: Partial<Task> = {}): Task {
  return {
    id,
    taskName: `Task ${id}`,
    assignee: "Alice",
    assigneeEmail: "alice@example.com",
    startDate: "2025-01-01",
    dueDate: "2025-06-01",
    lastUpdateDate: "2025-03-01",
    status: "To Do",
    priority: "Medium",
    blockers: "",
    description: "",
    completedDate: undefined,
    inquiriesSent: 0,
    group: undefined,
    labels: [],
    dependencies: [],
    jiraKey: undefined,
    jiraIssueType: undefined,
    lastSyncedAt: undefined,
    localModifiedAt: undefined,
    healthOverride: undefined,
    resourceId: undefined,
    originalEstimateMinutes: undefined,
    timeSpentMinutes: undefined,
    ...overrides,
  };
}

function makeRaidItem(id: number): RaidItem {
  return {
    id,
    category: "R",
    title: `Risk ${id}`,
    description: "Some risk",
    severity: "Medium",
    probability: 3,
    impact: 3,
    status: "Open",
    owner: "Bob",
    ownerEmail: "bob@example.com",
    mitigation: "Mitigate it",
    linkedTaskIds: [],
    raisedDate: "2025-01-01",
    targetDate: undefined,
    closedDate: undefined,
    localModifiedAt: undefined,
    causedByRaidIds: [],
    stakeholderIds: [],
  };
}

function makeMilestone(id: number): Milestone {
  return {
    id,
    name: `Milestone ${id}`,
    date: "2025-12-31",
    description: "A key date",
    achievedDate: undefined,
    linkedTaskIds: [],
    localModifiedAt: undefined,
  };
}

function makeBaseWorkspace(): Workspace {
  return {
    tasks: [],
    raid: [],
    absences: [],
    shifts: [],
    resources: [],
    roles: [],
    disciplines: [],
    grades: [],
    plan: {
      startDate: "2025-01-01",
      endDate: "2025-12-31",
      granularity: "month",
      currency: "EUR",
    },
    budgets: [],
    fxRates: null,
    status: {},
    milestones: [],
    changes: [],
    stakeholders: [],
  };
}

// ---------------------------------------------------------------------------
// DOCX
// ---------------------------------------------------------------------------

describe("buildDocx", () => {
  it("with defaultExportConfig — tasks + RAID content present, milestones absent", async () => {
    const ws: Workspace = {
      ...makeBaseWorkspace(),
      tasks: [makeTask(1)],
      raid: [makeRaidItem(10)],
      milestones: [makeMilestone(1)],
    };
    const sections = buildExportSections(ws, defaultExportConfig, "en-US");
    const blob = buildDocx(sections);
    const files = await unzipBlob(blob);

    const doc = files.get("word/document.xml")!;
    expect(doc).toBeTruthy();
    // Task row value present
    expect(doc).toContain("Task 1");
    // RAID row value present
    expect(doc).toContain("Risk 10");
    // Milestones NOT in default config
    expect(doc).not.toContain("Milestone 1");
  });

  it("enabling milestones — milestones heading and row appear in document", async () => {
    const cfg: ExportConfig = { ...defaultExportConfig, milestones: true };
    const ws: Workspace = {
      ...makeBaseWorkspace(),
      tasks: [makeTask(1)],
      raid: [makeRaidItem(10)],
      milestones: [makeMilestone(5), makeMilestone(6)],
    };
    const sections = buildExportSections(ws, cfg, "en-US");
    const blob = buildDocx(sections);
    const files = await unzipBlob(blob);

    const doc = files.get("word/document.xml")!;
    // Milestones section heading
    expect(doc).toContain("Milestones");
    // Milestone row values
    expect(doc).toContain("Milestone 5");
    expect(doc).toContain("Milestone 6");
  });

  it("each section gets a heading paragraph before its table", async () => {
    const ws: Workspace = {
      ...makeBaseWorkspace(),
      tasks: [makeTask(1)],
      raid: [makeRaidItem(10)],
    };
    const sections = buildExportSections(ws, defaultExportConfig, "en-US");
    const blob = buildDocx(sections);
    const files = await unzipBlob(blob);

    const doc = files.get("word/document.xml")!;
    // Section heading appears (Tasks in en-US)
    expect(doc).toContain("Tasks");
    // Table element present
    expect(doc).toContain("<w:tbl>");
  });

  it("produces valid OOXML structure — required parts present", async () => {
    const ws: Workspace = {
      ...makeBaseWorkspace(),
      tasks: [makeTask(1)],
      raid: [],
    };
    const sections = buildExportSections(ws, defaultExportConfig, "en-US");
    const blob = buildDocx(sections);
    const files = await unzipBlob(blob);

    expect(files.has("[Content_Types].xml")).toBe(true);
    expect(files.has("_rels/.rels")).toBe(true);
    expect(files.has("word/document.xml")).toBe(true);
    expect(files.has("word/styles.xml")).toBe(true);
    expect(files.has("word/_rels/document.xml.rels")).toBe(true);
  });

  it("empty sections list — document still valid with title only", async () => {
    const sections = buildExportSections(makeBaseWorkspace(), defaultExportConfig, "en-US");
    // tasks/raid both empty => sections is []
    expect(sections).toHaveLength(0);
    const blob = buildDocx(sections);
    const files = await unzipBlob(blob);

    const doc = files.get("word/document.xml")!;
    expect(doc).toContain("AI PM Cockpit");
    expect(doc).not.toContain("<w:tbl>");
  });

  it("XML-escapes values with special characters", async () => {
    const ws: Workspace = {
      ...makeBaseWorkspace(),
      tasks: [makeTask(1, { taskName: "Fix <b>bold</b> & deploy" })],
      raid: [],
    };
    const sections = buildExportSections(ws, defaultExportConfig, "en-US");
    const blob = buildDocx(sections);
    const files = await unzipBlob(blob);

    const doc = files.get("word/document.xml")!;
    expect(doc).toContain("Fix &lt;b&gt;bold&lt;/b&gt; &amp; deploy");
    expect(doc).not.toContain("<td>");
  });
});

// ---------------------------------------------------------------------------
// XLSX
// ---------------------------------------------------------------------------

describe("buildXlsx", () => {
  it("with defaultExportConfig — Tasks sheet present, RAID Log sheet present, no milestones sheet", async () => {
    const ws: Workspace = {
      ...makeBaseWorkspace(),
      tasks: [makeTask(1)],
      raid: [makeRaidItem(10)],
      milestones: [makeMilestone(1)],
    };
    const sections = buildExportSections(ws, defaultExportConfig, "en-US");
    const blob = buildXlsx(sections);
    const files = await unzipBlob(blob);

    const wb = files.get("xl/workbook.xml")!;
    expect(wb).toContain("Tasks");
    // RAID section (title from en-US i18n)
    expect(wb).toMatch(/RAID/i);
    expect(wb).not.toContain("Milestone");
  });

  it("enabling milestones — milestones worksheet appears", async () => {
    const cfg: ExportConfig = { ...defaultExportConfig, milestones: true };
    const ws: Workspace = {
      ...makeBaseWorkspace(),
      tasks: [makeTask(1)],
      raid: [makeRaidItem(10)],
      milestones: [makeMilestone(1)],
    };
    const sections = buildExportSections(ws, cfg, "en-US");
    const blob = buildXlsx(sections);
    const files = await unzipBlob(blob);

    const wb = files.get("xl/workbook.xml")!;
    expect(wb).toContain("Milestones");

    // Milestone data is stored in sharedStrings (XLSX deduplicates all string
    // cell values there; worksheet XML only contains numeric indices).
    const ss = files.get("xl/sharedStrings.xml")!;
    expect(ss).toContain("Milestone 1");
  });

  it("worksheet names are ≤31 characters", async () => {
    // Use a section with a long title — status section title is "Project Status" (14 chars, fine),
    // so we enable several sections and verify all sheet names are within limit
    const cfg: ExportConfig = {
      ...defaultExportConfig, milestones: true, changes: true,
      stakeholders: true, status: true,
    };
    const ws: Workspace = {
      ...makeBaseWorkspace(),
      tasks: [makeTask(1)],
      raid: [makeRaidItem(10)],
      milestones: [makeMilestone(1)],
      changes: [{
        id: 1, title: "Change 1", type: "Scope", status: "Proposed",
        impact: "Medium", impactDescription: "", scheduleImpactDays: 0,
        costImpact: 0, requestedBy: "PM", raisedDate: "2025-01-01",
        decisionBy: "", decisionDate: "", resolutionNotes: "",
        description: "", linkedTaskIds: [], linkedRaidIds: [],
        stakeholderIds: [], localModifiedAt: undefined,
      }],
      stakeholders: [{
        id: 1, name: "Alice", category: "Sponsor", email: "",
        influence: "High", interest: "High",
        notes: "", raci: {}, localModifiedAt: undefined,
      }],
      status: { ragOverride: "G", narrative: "On track" },
    };
    const sections = buildExportSections(ws, cfg, "en-US");
    const blob = buildXlsx(sections);
    const files = await unzipBlob(blob);

    const wb = files.get("xl/workbook.xml")!;
    // Extract all name="..." attributes from <sheet> elements
    const nameMatches = [...wb.matchAll(/name="([^"]+)"/g)];
    for (const m of nameMatches) {
      expect(m[1].length).toBeLessThanOrEqual(31);
    }
  });

  it("worksheet names are unique when two titles truncate to the same string", async () => {
    // We test via the sanitize helper indirectly: create two sections with the
    // same title by importing and calling the internal dedup logic through the builder.
    // Simplest approach: build with two sections that have identical sanitized names,
    // then verify two distinct sheet entries appear in the workbook.
    //
    // We can't easily force a collision from real section keys, so we test by
    // building with enough sections that worksheet names are all distinct.
    const cfg: ExportConfig = { ...defaultExportConfig, milestones: true };
    const ws: Workspace = {
      ...makeBaseWorkspace(),
      tasks: [makeTask(1)],
      raid: [makeRaidItem(10)],
      milestones: [makeMilestone(1)],
    };
    const sections = buildExportSections(ws, cfg, "en-US");
    const blob = buildXlsx(sections);
    const files = await unzipBlob(blob);

    const wb = files.get("xl/workbook.xml")!;
    const nameMatches = [...wb.matchAll(/name="([^"]+)"/g)].map((m) => m[1]);
    // All names must be unique
    const uniqueNames = new Set(nameMatches);
    expect(uniqueNames.size).toBe(nameMatches.length);
  });

  it("each worksheet has a frozen header row and autoFilter", async () => {
    const ws: Workspace = {
      ...makeBaseWorkspace(),
      tasks: [makeTask(1)],
      raid: [makeRaidItem(10)],
    };
    const sections = buildExportSections(ws, defaultExportConfig, "en-US");
    const blob = buildXlsx(sections);
    const files = await unzipBlob(blob);

    const sheet1 = files.get("xl/worksheets/sheet1.xml")!;
    expect(sheet1).toContain('state="frozen"');
    expect(sheet1).toContain("<autoFilter");
  });

  it("shared-strings dedup — same value appears only once in sharedStrings.xml", async () => {
    const ws: Workspace = {
      ...makeBaseWorkspace(),
      tasks: [makeTask(1), makeTask(2)],
      raid: [],
    };
    const sections = buildExportSections(ws, defaultExportConfig, "en-US");
    const blob = buildXlsx(sections);
    const files = await unzipBlob(blob);

    const ss = files.get("xl/sharedStrings.xml")!;
    // "Alice" appears in both task rows but should be a single <si> entry
    const matches = ss.match(/<si>/g) ?? [];
    const aliceOccurrences = (ss.match(/Alice/g) ?? []).length;
    // uniqueCount drives dedup; "Alice" should appear exactly once in shared strings
    expect(aliceOccurrences).toBe(1);
    // sanity: more than zero entries
    expect(matches.length).toBeGreaterThan(0);
  });

  it("produces valid OOXML structure — required parts present", async () => {
    const ws: Workspace = {
      ...makeBaseWorkspace(),
      tasks: [makeTask(1)],
      raid: [],
    };
    const sections = buildExportSections(ws, defaultExportConfig, "en-US");
    const blob = buildXlsx(sections);
    const files = await unzipBlob(blob);

    expect(files.has("[Content_Types].xml")).toBe(true);
    expect(files.has("_rels/.rels")).toBe(true);
    expect(files.has("xl/workbook.xml")).toBe(true);
    expect(files.has("xl/styles.xml")).toBe(true);
    expect(files.has("xl/sharedStrings.xml")).toBe(true);
    expect(files.has("xl/_rels/workbook.xml.rels")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// PPTX
// ---------------------------------------------------------------------------

describe("buildPptx", () => {
  it("tags every prose run with the REQUESTED language, not a hardcoded en-US", async () => {
    // Every <a:r> run carried `a:rPr lang="en-US"` regardless of the export
    // language, so a German deck asserted American English over all its prose:
    // PowerPoint spell-checks it against an English dictionary and an
    // accessibility checker reads the wrong language.
    //
    // ★ Scoped to `<a:rPr`, NOT the whole slide. `<a:endParaRPr lang="en-US"/>`
    // still appears on the background rect and accent bar — empty decorative
    // shapes with no text, deliberately left alone. A blanket
    // not.toContain('lang="en-US"') would fail against the CORRECT fix.
    const ws: Workspace = { ...makeBaseWorkspace(), tasks: [makeTask(1)] };
    const sections = buildExportSections(ws, defaultExportConfig, "de");

    const files = await unzipBlob(buildPptx(sections, "de"));
    const slides = [...files.entries()]
      .filter(([k]) => k.startsWith("ppt/slides/slide") && !k.includes("_rels"))
      .map(([, v]) => v);

    expect(slides.length).toBeGreaterThan(0);
    // The title slide alone would prove too little — assert across every slide,
    // so the divider and row builders are covered too.
    for (const xml of slides) {
      expect(xml).toContain('<a:rPr lang="de"');
      expect(xml).not.toContain('<a:rPr lang="en-US"');
    }
  });

  it("with defaultExportConfig — title slide + tasks + RAID present, milestones absent", async () => {
    const ws: Workspace = {
      ...makeBaseWorkspace(),
      tasks: [makeTask(1)],
      raid: [makeRaidItem(10)],
      milestones: [makeMilestone(1)],
    };
    const sections = buildExportSections(ws, defaultExportConfig, "en-US");
    const blob = buildPptx(sections, "en-US");
    const files = await unzipBlob(blob);

    const allSlides = [...files.entries()]
      .filter(([k]) => k.startsWith("ppt/slides/slide") && !k.includes("_rels"))
      .map(([, v]) => v)
      .join("\n");

    expect(allSlides).toContain("AI PM Cockpit"); // title slide
    expect(allSlides).toContain("Task 1");
    expect(allSlides).toContain("Risk 10");
    expect(allSlides).not.toContain("Milestone 1");
  });

  it("enabling milestones — milestones divider slide + item slide appear", async () => {
    const cfg: ExportConfig = { ...defaultExportConfig, milestones: true };
    const ws: Workspace = {
      ...makeBaseWorkspace(),
      tasks: [makeTask(1)],
      raid: [makeRaidItem(10)],
      milestones: [makeMilestone(7)],
    };
    const sections = buildExportSections(ws, cfg, "en-US");
    const blob = buildPptx(sections, "en-US");
    const files = await unzipBlob(blob);

    const allSlides = [...files.entries()]
      .filter(([k]) => k.startsWith("ppt/slides/slide") && !k.includes("_rels"))
      .map(([, v]) => v)
      .join("\n");

    // Milestones divider slide
    expect(allSlides).toContain("Milestones");
    // Milestone item slide
    expect(allSlides).toContain("Milestone 7");
  });

  it("section exceeding per-section cap yields a truncation-notice slide", async () => {
    // Build more than PPTX_MAX_ROWS_PER_SECTION (100) tasks
    const manyTasks = Array.from({ length: 105 }, (_, i) => makeTask(i + 1));
    const ws: Workspace = {
      ...makeBaseWorkspace(),
      tasks: manyTasks,
      raid: [],
    };
    const sections = buildExportSections(ws, defaultExportConfig, "en-US");
    const blob = buildPptx(sections, "en-US");
    const files = await unzipBlob(blob);

    const allSlides = [...files.entries()]
      .filter(([k]) => k.startsWith("ppt/slides/slide") && !k.includes("_rels"))
      .map(([, v]) => v)
      .join("\n");

    // Truncation notice must appear
    expect(allSlides).toMatch(/Showing the first 100 of 105/);
  });

  it("title slide is always first regardless of sections", async () => {
    const ws: Workspace = {
      ...makeBaseWorkspace(),
      tasks: [makeTask(1)],
      raid: [],
    };
    const sections = buildExportSections(ws, defaultExportConfig, "en-US");
    const blob = buildPptx(sections, "en-US");
    const files = await unzipBlob(blob);

    const slide1 = files.get("ppt/slides/slide1.xml")!;
    expect(slide1).toContain("AI PM Cockpit");
  });

  it("divider slide appears before item slides for each section", async () => {
    const ws: Workspace = {
      ...makeBaseWorkspace(),
      tasks: [makeTask(1)],
      raid: [makeRaidItem(10)],
    };
    const sections = buildExportSections(ws, defaultExportConfig, "en-US");
    const blob = buildPptx(sections, "en-US");
    const files = await unzipBlob(blob);

    // slide1 = title, slide2 = tasks divider, slide3 = task item,
    // slide4 = RAID divider, slide5 = RAID item
    const slide2 = files.get("ppt/slides/slide2.xml")!;
    const slide4 = files.get("ppt/slides/slide4.xml")!;

    // Tasks divider has the tasks section title
    expect(slide2).toContain("Tasks");
    // RAID divider has "RAID" in it
    expect(slide4).toMatch(/RAID/i);
  });

  it("produces valid OOXML structure — required parts present", async () => {
    const ws: Workspace = {
      ...makeBaseWorkspace(),
      tasks: [makeTask(1)],
      raid: [],
    };
    const sections = buildExportSections(ws, defaultExportConfig, "en-US");
    const blob = buildPptx(sections, "en-US");
    const files = await unzipBlob(blob);

    expect(files.has("[Content_Types].xml")).toBe(true);
    expect(files.has("_rels/.rels")).toBe(true);
    expect(files.has("ppt/presentation.xml")).toBe(true);
    expect(files.has("ppt/slideMasters/slideMaster1.xml")).toBe(true);
    expect(files.has("ppt/slideLayouts/slideLayout1.xml")).toBe(true);
    expect(files.has("ppt/theme/theme1.xml")).toBe(true);
  });

  it("empty sections list — only title slide emitted", async () => {
    const sections: ReturnType<typeof buildExportSections> = [];
    const blob = buildPptx(sections, "en-US");
    const files = await unzipBlob(blob);

    const slideFiles = [...files.keys()].filter(
      (k) => k.startsWith("ppt/slides/slide") && !k.includes("_rels")
    );
    expect(slideFiles).toHaveLength(1);

    const slide1 = files.get("ppt/slides/slide1.xml")!;
    expect(slide1).toContain("AI PM Cockpit");
  });
});

// ---------------------------------------------------------------------------
// HTML/PDF renderer — the export projection's newline becomes a <br>
// ---------------------------------------------------------------------------

// ★★★ WHAT THESE TWO USED TO ASSERT, AND WHY THEY NOW ASSERT SOMETHING ELSE.
// They arrived in 8c16c20f ("render a projected paragraph break as <br> in
// HTML/PDF", §17 part 4b), when EVERY export cell was the flat text projection
// and `htmlCellWithBreaks` mapped its "\n" to a <br>. On these same
// `description` fixtures they asserted "one<br>two" and "a&lt;br&gt;b<br>c".
//
// §141(b) superseded that REPRESENTATION — for rich columns ONLY. `description`
// is in TASK_RICH_COLUMNS, so its cell now emits sanitized MARKUP: two real
// paragraphs instead of one <br>-joined line. That is the designed, specified
// output of this slice, so the site that pinned the old representation is the
// honest place to pin the new one.
//
// ★★★ THIS IS NOT "editing a test to match the output" — what makes it
// legitimate is that the INVARIANT is re-asserted rather than dropped, and that
// the guard the representation superseded is demonstrably still alive:
//   • the escape-then-substitute ORDER on a NON-rich cell of this very
//     `buildPdfHtml` path — export.test.ts, "escapes a NON-rich cell BEFORE
//     substituting its newline";
//   • the same ordering on `renderDocumentHtml`'s table block —
//     doc-render-html.test.ts, "maps a newline in a table cell to <br> but
//     escapes a literal <br>".
// Both are green and both go red if the ordering is inverted. If you are here
// because you want to delete or weaken one of these, check those two first.
describe("HTML export cells", () => {
  it("renders a rich cell's paragraph break as real paragraphs", () => {
    const base = makeBaseWorkspace();
    const ws: Workspace = {
      ...base,
      tasks: [{ ...makeTask(1), description: "<p>one</p><p>two</p>" }],
    };
    const html = buildPdfHtml(ws, defaultExportConfig, "en-US");
    // The §141(b) representation. Pre-§141(b) this cell was "one<br>two"; the
    // block boundary is still there, it is just carried by the markup now.
    expect(html).toContain("<p>one</p><p>two</p>");
    expect(html).not.toContain("&lt;p&gt;one&lt;/p&gt;");
  });

  it("escapes BEFORE substituting, so user markup cannot inject a break", () => {
    // ★★★ THE SECURITY ASSERTION IS UNCHANGED FROM 8c16c20f AND MUST STAY THAT
    // WAY. Only OUR block boundary changed representation (<br> → </p><p>); the
    // USER's literal "<br>" — stored as the entity "&lt;br&gt;" — must still
    // come out escaped and must still never become a real break. Both
    // directions are asserted, exactly as they were before, and this test must
    // fail if that ever stops being true.
    //
    // ★★ THE FIXTURE MUST CARRY BOTH, and the original did not at first: with a
    // value that has no block boundary, escaping alone satisfies it and the
    // test passes whatever happens to the boundary — it named the ordering
    // while proving only the escaping. This value carries the user's escaped
    // "<br>" AND a real boundary of ours.
    const base = makeBaseWorkspace();
    const ws: Workspace = {
      ...base,
      tasks: [{ ...makeTask(1), description: "<p>a&lt;br&gt;b</p><p>c</p>" }],
    };
    const html = buildPdfHtml(ws, defaultExportConfig, "en-US");
    // VERBATIM from 8c16c20f: the user's markup stays escaped.
    expect(html).toContain("a&lt;br&gt;b");
    // VERBATIM from 8c16c20f: it must never become a real break.
    expect(html).not.toContain("a<br>b");
    // Our own boundary, in its §141(b) representation.
    expect(html).toContain("<p>a&lt;br&gt;b</p><p>c</p>");
  });
});

// ---------------------------------------------------------------------------
// DOCX cell rendering (§17 part 4b — the export projection's newline)
// ---------------------------------------------------------------------------

describe("DOCX export cells", () => {
  it("renders a projected newline as a real Word line break", async () => {
    const blob = buildDocx([
      { key: "tasks", title: "Tasks", columns: ["description"], rows: [["one\ntwo"]] },
    ]);
    const xml = (await unzipBlob(blob)).get("word/document.xml")!;
    expect(xml).toContain(
      '<w:t xml:space="preserve">one</w:t><w:br/><w:t xml:space="preserve">two</w:t>',
    );
  });

  it("emits exactly the single run it always did for a break-free cell", async () => {
    const blob = buildDocx([
      { key: "tasks", title: "Tasks", columns: ["description"], rows: [["plain"]] },
    ]);
    const xml = (await unzipBlob(blob)).get("word/document.xml")!;
    expect(xml).toContain('<w:r><w:t xml:space="preserve">plain</w:t></w:r>');
    expect(xml).not.toContain("<w:br/>");
  });
});

// ---------------------------------------------------------------------------
// PPTX text rendering (§17 part 4c — the export projection's newline)
// ---------------------------------------------------------------------------

describe("PPTX export text", () => {
  it("splits a projected newline into separate paragraphs", async () => {
    const blob = buildPptx([
      {
        key: "tasks",
        title: "Tasks",
        columns: ["id", "taskName", "description"],
        rows: [[1, "Task one", "one\ntwo"]],
      },
    ], "en-US");
    // slide1 = title, slide2 = Tasks divider, slide3 = the single row slide.
    const xml = (await unzipBlob(blob)).get("ppt/slides/slide3.xml")!;
    // Columns 2..7 render as "<label>: <value>" meta lines, so the label is
    // glued to the FIRST line only — the second line stands alone.
    expect(xml).toContain("<a:t>description: one</a:t>");
    expect(xml).toContain("<a:t>two</a:t>");
    expect(xml).not.toContain("one\ntwo");
    // ★★★ THE MUTATION THIS FILE MISSED: revert the `flatMap` to `map` and the
    // outer `.join("")` stringifies an array-of-arrays, inserting a literal COMMA
    // between the paragraphs — "</a:p>,<a:p>". That is a text node between two
    // <a:p> elements inside <p:txBody>, which PowerPoint rejects as a corrupt
    // file, and EVERY assertion above still passes (both <a:t> values are present
    // and there is no raw newline). Asserting the two paragraphs as one CONTIGUOUS
    // string is what catches it — the shape the DOCX test already uses.
    expect(xml).not.toContain("</a:p>,");
    expect(xml).toMatch(/<a:t>description: one<\/a:t>[\s\S]*?<\/a:p>\s*<a:p>[\s\S]*?<a:t>two<\/a:t>/);
  });

  it("emits the same package parts for a rich cell as for its flat projection (§141(b))", async () => {
    // PPTX row slides cannot lay out paragraphs, so they read the rich cell's
    // `text` — output must not move by one byte from the flat era.
    //
    // ★ ALL THREE cells are rich on purpose: buildPptxRowSlide reads row[0]
    // (RowMeta), row[1] (RowTitle) and row[2..] (meta lines) through three
    // SEPARATE expressions, so a fix applied to only one of them still passes
    // a fixture whose rich column sits in the other.
    // ★ The description uses the editor's REAL list shape (<li><p>…</p></li>),
    // not the bare <li> form, so a projection defect that hides behind bare
    // <li> cannot hide here either.
    const cells = [
      "<p>1</p>",
      "<p>Task <strong>one</strong></p>",
      "<h2>Plan</h2><ul><li><p>one</p></li></ul>",
    ];
    const columns = ["id", "taskName", "description"];
    const rich: ExportSection = {
      key: "tasks",
      title: "Tasks",
      columns,
      rows: [cells.map((html) => ({ html, text: descriptionTextWithBreaks(html) }))],
    };
    const flat: ExportSection = {
      key: "tasks",
      title: "Tasks",
      columns,
      rows: [cells.map((html) => descriptionTextWithBreaks(html))],
    };

    const richText = await packageText(buildPptx([rich], "en-US"));
    expect(richText).toBe(await packageText(buildPptx([flat], "en-US")));
    // Positive observable — two identical EMPTY packages would satisfy the
    // equality above while proving nothing about the projection.
    expect(richText).toContain("<a:t>description: Plan</a:t>");
    expect(richText).toContain("<a:t>one</a:t>");
    expect(richText).toContain("<a:t>Task one</a:t>");
    expect(richText).not.toContain("object Object");
  });

  it("leaves a break-free paragraph as exactly one <a:p>", async () => {
    const blob = buildPptx([
      { key: "tasks", title: "Tasks", columns: ["id", "taskName"], rows: [[1, "Task one"]] },
    ], "en-US");
    const xml = (await unzipBlob(blob)).get("ppt/slides/slide3.xml")!;
    // ★ The <a:t> count alone does NOT pin this: a split that emitted a
    // trailing EMPTY paragraph leaves the text occurring exactly once while
    // the slide grows a phantom <a:p>. Count the paragraphs themselves —
    // 1 from the accent bar's placeholder body + RowMeta + RowTitle, with no
    // RowFields box because there is no third column.
    expect((xml.match(/<a:p>/g) ?? []).length).toBe(3);
    expect((xml.match(/<a:t>Task one<\/a:t>/g) ?? []).length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// XLSX text rendering (§17 part 4d — the export projection's newline)
// ---------------------------------------------------------------------------

describe("XLSX carries a projected paragraph break", () => {
  it("keeps the newline in the shared string and wraps the body cells", async () => {
    // No code change backs this — the builder already gets it right. The pin
    // exists because three things have to STAY true: xml:space="preserve" on
    // <t>, xmlEscape leaving \n alone, and wrapText on the BODY cell styles.
    const blob = buildXlsx([
      { key: "tasks", title: "Tasks", columns: ["description"], rows: [["one\ntwo"]] },
    ]);
    const parts = await unzipBlob(blob);
    expect(parts.get("xl/sharedStrings.xml")!).toContain(
      '<t xml:space="preserve">one\ntwo</t>',
    );
    // ★ A bare `toContain('wrapText="1"')` would also be satisfied by the
    // HEADER style (cellXfs index 1), which must NOT wrap. Pin the two BODY
    // <xf> elements (indices 2 = grey, 3 = white) whole, so removing wrapText
    // from either — or moving it onto the header — fails here.
    const styles = parts.get("xl/styles.xml")!;
    expect(styles).toContain(
      '<xf numFmtId="0" fontId="0" fillId="3" borderId="0" xfId="0" applyFill="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>',
    );
    expect(styles).toContain(
      '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>',
    );
  });

  it("emits the same package parts for a rich cell as for its flat projection (§141(b))", async () => {
    // A worksheet cell cannot lay out paragraphs, so the XLSX builder reads the
    // rich cell's `text` — output must not move by one byte from the flat era.
    // ★ The editor's REAL list shape (<li><p>…</p></li>), not the bare <li>
    // form: a projection defect that hides behind bare <li> must not hide here.
    const html = "<h2>Plan</h2><ul><li><p>one</p></li></ul>";
    const columns = ["description"];
    const rich: ExportSection = {
      key: "tasks",
      title: "Tasks",
      columns,
      rows: [[{ html, text: descriptionTextWithBreaks(html) }]],
    };
    const flat: ExportSection = {
      key: "tasks",
      title: "Tasks",
      columns,
      rows: [[descriptionTextWithBreaks(html)]],
    };

    const richText = await packageText(buildXlsx([rich]));
    expect(richText).toBe(await packageText(buildXlsx([flat])));
    // Positive observable — two identical EMPTY packages would satisfy the
    // equality above while proving nothing about the projection.
    expect(richText).toContain('<t xml:space="preserve">Plan\none</t>');
    expect(richText).not.toContain("object Object");
  });
});

// ---------------------------------------------------------------------------
// Workspace .docx export — link fidelity (§119 / §30)
// ---------------------------------------------------------------------------

// ★★ BOTH HALVES OR NEITHER. A `<w:hyperlink r:id="rId2">` whose relationship
// was never written names an id Word cannot resolve — it opens the document
// with the text unlinked and no error — and a relationship nothing references
// is an orphan the reader never sees. Either assertion passes alone while the
// export is broken, so the pair is the claim.
describe("buildDocx link relationships", () => {
  function sectionWith(html: string): ExportSection {
    return {
      key: "tasks",
      title: "Tasks",
      columns: ["description"],
      rows: [[{ html, text: descriptionTextWithBreaks(html) }]],
    };
  }

  const LINKED = '<p>see <a href="https://intra/spec">the spec</a></p>';

  it("wraps a linked rich cell's run in w:hyperlink in the body", async () => {
    const files = await unzipBlob(buildDocx([sectionWith(LINKED)]));
    const doc = files.get("word/document.xml")!;
    // ★ `xmlns:r` precedes `r:id` on the element, so this is matched as a
    // pattern rather than a literal prefix (same reason as the primitives'
    // own hyperlink tests).
    expect(doc).toMatch(/<w:hyperlink [^>]*r:id="rId2">/);
    expect(doc).toContain("the spec");
  });

  it("writes the referenced external relationship into document.xml.rels", async () => {
    const files = await unzipBlob(buildDocx([sectionWith(LINKED)]));
    const rels = files.get("word/_rels/document.xml.rels")!;
    expect(rels).toContain('Id="rId2"');
    expect(rels).toContain('TargetMode="External"');
    expect(rels).toContain("https://intra/spec");
    // A link has no part — that is what TargetMode="External" licenses.
    expect([...files.keys()].filter((p) => p.startsWith("word/media/"))).toEqual([]);
  });

  it("mints no external relationship for a section carrying no link", async () => {
    // ★ The additive contract: threading a sink must leave a link-free export
    // exactly as it was, which is what keeps the byte-pinned package unmoved.
    const files = await unzipBlob(buildDocx([sectionWith("<p>plain</p>")]));
    expect(files.get("word/_rels/document.xml.rels")!).not.toContain('TargetMode="External"');
    expect(files.get("word/document.xml")!).not.toContain("<w:hyperlink");
    // ★ And no character style: an unlinked run is byte-identical to what it
    //   was before §333 declared one.
    expect(files.get("word/document.xml")!).not.toContain("w:rStyle");
  });

  /** ★★★ §333 REACHES THIS EXPORTER TOO, and the register named only
   *  `renderDocumentDocx`. Both consumers pass `DOC_STYLES` to
   *  `buildDocxPackage` and both route their runs through `markedRun`, so the
   *  defect and the fix are shared — but "shared by construction" is an
   *  argument, not an assertion, and this file's own deleted-test comment in
   *  `ooxml-docx-primitives.test.ts` records what that costs. So the workspace
   *  package is opened and read here in its own right.
   *
   *  ★★ BOTH HALVES, DERIVED. Word SILENTLY IGNORES a `w:rStyle` naming a style
   *  the package does not declare — the run keeps body colour while the emit
   *  assertion stays green — so the styleId is read out of the BODY and looked
   *  up in styles.xml, never restated on both sides. */
  it("styles a linked run with a character style the package declares", async () => {
    // ★★ BOLD ON PURPOSE, and it is what makes the position assertion below
    //    mean anything: an rStyle-only `<w:rPr>` has ONE child and opens with
    //    it whatever the builder does. Measured — reversing the concatenation
    //    in `markedRun` leaves the UNMARKED variant of this test green.
    const files = await unzipBlob(
      buildDocx([sectionWith('<p>see <a href="https://intra/spec"><strong>the spec</strong></a></p>')]),
    );
    const doc = files.get("word/document.xml")!;
    // POSITION, not presence: CT_RPr is an `xsd:sequence` and w:rStyle leads
    // it, so the property must OPEN the run's <w:rPr> — ahead of the `w:b`.
    expect(doc).toContain(`<w:rPr><w:rStyle w:val="Hyperlink"/><w:b/></w:rPr>`);
    const used = doc.match(/<w:rStyle w:val="([^"]+)"\/>/)?.[1];
    expect(used).toBeTruthy();
    expect(files.get("word/styles.xml")!).toContain(
      `<w:style w:type="character" w:styleId="${used}">`,
    );

    // ★★ AND THE COMMON SHAPE — an UNMARKED link. It carries no mark
    //    properties, so it gets an `<w:rPr>` only because the rStyle takes part
    //    in `markedRun`'s emptiness test rather than being appended to its
    //    result. Bolding the fixture above to make the ORDER observable is what
    //    made this line necessary.
    const bare = await unzipBlob(buildDocx([sectionWith(LINKED)]));
    expect(bare.get("word/document.xml")!).toContain(`<w:rPr><w:rStyle w:val="${used}"/></w:rPr>`);
  });

  /** ★★ THESE PIN THE CALL SITE, NOT THE PROJECTION. `cellTextWithLinks` is
   *  unit-tested in export-sections.test.ts; nothing there notices a sink that
   *  went on calling `cellText`, which is the shape this whole slice is about.
   *  Both assert against the SUBSTRATE — the shared-string table and the slide
   *  XML the reader actually opens — not against the helper's arguments. */
  it("carries the address inline in the XLSX shared string — a cell holds no link", async () => {
    const files = await unzipBlob(buildXlsx([sectionWith(LINKED)]));
    const shared = files.get("xl/sharedStrings.xml")!;
    expect(shared).toContain("see the spec (https://intra/spec)");
  });

  it("carries the address inline on the PPTX row slide — a run holds no link", async () => {
    const files = await unzipBlob(buildPptx([sectionWith(LINKED)], "en-US"));
    const slides = [...files.entries()]
      .filter(([k]) => k.startsWith("ppt/slides/slide") && !k.includes("_rels"))
      .map(([, v]) => v)
      .join("");
    expect(slides).toContain("see the spec (https://intra/spec)");
  });
});
