// src/app/export.test.ts
//
// Tests for buildPdfHtml — the pure HTML-building helper extracted from
// exportPdf. window.print() is never called here.
//
// ★ These run under jsdom, not bare node — vitest.config.ts sets
// `environment: "jsdom"` globally. That is load-bearing since §141(b): a rich
// cell goes through sanitizeRichHtml, which is DOMPurify-backed and binds
// `window` at module eval. This header claimed "no DOM" until the rich-cell
// tests below were added, which would have been a confusing thing to read
// while debugging a DOMPurify failure.

import { describe, it, expect } from "vitest";
import { buildPdfHtml } from "./export";
import { defaultExportConfig } from "./settings-types";
import type { ExportConfig } from "./settings-types";
import type { Workspace } from "./storage";
import type { Task, RaidItem, Milestone } from "./types";

// ---------------------------------------------------------------------------
// Minimal fixture helpers (shared with export-sections.test.ts style)
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
// Tests
// ---------------------------------------------------------------------------

describe("buildPdfHtml", () => {
  it("with defaultExportConfig — tasks table present, RAID table present (when non-empty)", () => {
    const ws: Workspace = {
      ...makeBaseWorkspace(),
      tasks: [makeTask(1)],
      raid: [makeRaidItem(10)],
      milestones: [makeMilestone(1)], // milestones NOT enabled by default
    };

    const html = buildPdfHtml(ws, defaultExportConfig, "en-US");

    // Tasks section must be present
    expect(html).toContain("Task 1");
    // RAID section present (non-empty + enabled)
    expect(html).toContain("Risk 10");
    // Milestones must NOT appear (not enabled in defaultExportConfig)
    expect(html).not.toContain("Milestone 1");
    expect(html).not.toContain("milestones");
  });

  it("with defaultExportConfig — RAID table absent when workspace has no raid items", () => {
    const ws: Workspace = {
      ...makeBaseWorkspace(),
      tasks: [makeTask(1)],
      raid: [], // empty
    };

    const html = buildPdfHtml(ws, defaultExportConfig, "en-US");

    // Tasks present
    expect(html).toContain("Task 1");
    // RAID section heading absent
    expect(html).not.toContain("RAID");
  });

  it("enabling milestones — HTML contains milestones heading + a row per milestone", () => {
    const cfg: ExportConfig = { ...defaultExportConfig, milestones: true };
    const ws: Workspace = {
      ...makeBaseWorkspace(),
      tasks: [makeTask(1)],
      raid: [makeRaidItem(10)],
      milestones: [makeMilestone(1), makeMilestone(2)],
    };

    const html = buildPdfHtml(ws, cfg, "en-US");

    // Milestones heading appears
    expect(html).toContain("Milestone 1");
    expect(html).toContain("Milestone 2");
  });

  it("cell values are HTML-escaped — < and & in task title are escaped", () => {
    const ws: Workspace = {
      ...makeBaseWorkspace(),
      tasks: [makeTask(1, { taskName: "Fix <b>bold</b> & deploy" })],
      raid: [],
    };

    const html = buildPdfHtml(ws, defaultExportConfig, "en-US");

    expect(html).toContain("Fix &lt;b&gt;bold&lt;/b&gt; &amp; deploy");
    // The raw injected tag must not appear as unescaped markup in the table body
    expect(html).not.toContain("<td>Fix <b>");
  });

  it("produces valid HTML with correct doctype and head structure", () => {
    const ws: Workspace = {
      ...makeBaseWorkspace(),
      tasks: [makeTask(1)],
      raid: [],
    };

    const html = buildPdfHtml(ws, defaultExportConfig, "en-US");

    expect(html).toContain("<!DOCTYPE html>");
    // Full opening tag, not a bare "<html": the loose form passed while the
    // attribute was hardcoded to "en" regardless of the lang argument.
    expect(html).toContain('<html lang="en-US">');
    expect(html).toContain("<head>");
    expect(html).toContain("</body>");
    expect(html).toContain("window.print()");
  });

  it("declares the REQUESTED language on <html>, never a hardcoded en (WCAG 3.1.1)", () => {
    // Mirrors doc-render-html.ts, which emits its lang argument for the same
    // reason. Every member of Lang is already a valid BCP-47 tag. A German
    // export declaring lang="en" makes a screen reader read the whole document
    // in an English voice and mislabels the printed PDF's language metadata.
    //
    // ★ Assert the CONCRETE attribute per language. "contains lang=" — or the
    // bare "<html" this file used to assert — passes against the hardcoded
    // value and pins nothing.
    const ws: Workspace = {
      ...makeBaseWorkspace(),
      tasks: [makeTask(1)],
      raid: [],
    };

    expect(buildPdfHtml(ws, defaultExportConfig, "de")).toContain('<html lang="de">');
    expect(buildPdfHtml(ws, defaultExportConfig, "en-GB")).toContain('<html lang="en-GB">');
    expect(buildPdfHtml(ws, defaultExportConfig, "en-US")).toContain('<html lang="en-US">');
    // The specific regression: the German export must not carry the old value.
    expect(buildPdfHtml(ws, defaultExportConfig, "de")).not.toContain('<html lang="en">');
  });

  it("empty workspace — outputs 'No tasks to export' style message, no crash", () => {
    const ws: Workspace = makeBaseWorkspace(); // all arrays empty

    const html = buildPdfHtml(ws, defaultExportConfig, "en-US");

    // Should not throw and should produce a valid HTML document
    expect(html).toContain("<!DOCTYPE html>");
    // No section tables rendered when everything is empty
    expect(html).not.toContain("<tbody>");
  });

  it("section heading appears before its table, using section.title", () => {
    const ws: Workspace = {
      ...makeBaseWorkspace(),
      tasks: [makeTask(1)],
      raid: [makeRaidItem(10)],
    };

    const html = buildPdfHtml(ws, defaultExportConfig, "en-US");

    // Each section emits an <h2> with the section title
    // tasks section title is "Tasks" (en-US)
    expect(html).toMatch(/<h2[^>]*>Tasks<\/h2>/);
  });

  it("status section (2-column key/value) renders as a normal 2-column table", () => {
    const cfg: ExportConfig = { ...defaultExportConfig, status: true };
    const ws: Workspace = {
      ...makeBaseWorkspace(),
      tasks: [makeTask(1)],
      status: {
        ragOverride: "G",
        narrative: "On track",
      },
    };

    const html = buildPdfHtml(ws, cfg, "en-US");

    // Status section heading (title from export-sections: "Project Status")
    expect(html).toContain("Project Status");
    // Status field/value rows appear in the table
    expect(html).toContain("On track");
  });
});

// ---------------------------------------------------------------------------
// Rich cells in an HTML/PDF export table (§141(b))
// ---------------------------------------------------------------------------

/** One task with `description` set — `description` is the task section's only
 *  member of TASK_RICH_COLUMNS, so this is the shortest route to a RichCell. */
function wsWithDescription(description: string): Workspace {
  return { ...makeBaseWorkspace(), tasks: [makeTask(1, { description })], raid: [] };
}

describe("buildPdfHtml — rich cells (§141(b))", () => {
  // ★ The section header row emits the raw CSV column KEYS, so asserting the
  //   <th> is what proves the column under test is real. A fixture aimed at a
  //   column that does not exist asserts nothing at all, and that has already
  //   happened once in this slice (a test written against "title", which is
  //   spelled `taskName`).
  it("the two columns under test are real columns of the tasks section", () => {
    const html = buildPdfHtml(wsWithDescription("x"), defaultExportConfig, "en-US");
    expect(html).toContain("<th>description</th>"); // rich
    expect(html).toContain("<th>taskName</th>"); // NOT rich
  });

  it("emits markup for a rich column instead of escaping it", () => {
    const html = buildPdfHtml(
      wsWithDescription("<h2>Plan</h2>"),
      defaultExportConfig,
      "en-US",
    );
    expect(html).toContain("<h2>Plan</h2>");
    expect(html).not.toContain("&lt;h2&gt;");
  });

  // ★★ THE EDITOR'S REAL LIST SHAPE, not a bare <li>. Tiptap wraps each item's
  // content in a <p>, and a bare-<li> fixture has already hidden a CRITICAL in
  // this slice — it exercises a structure the app never actually stores.
  it("keeps the editor's real list shape, <p> inside <li> included", () => {
    const html = buildPdfHtml(
      wsWithDescription("<ul><li><p>one</p></li><li><p>two</p></li></ul>"),
      defaultExportConfig,
      "en-US",
    );
    expect(html).toContain("<ul>");
    expect(html).toContain("<li><p>one</p></li>");
    expect(html).not.toContain("&lt;ul&gt;");
  });

  it("keeps an ordered list ordered, so numbering survives the export", () => {
    const html = buildPdfHtml(
      wsWithDescription("<ol><li><p>first</p></li></ol>"),
      defaultExportConfig,
      "en-US",
    );
    expect(html).toContain("<ol>");
    expect(html).not.toContain("<ul>");
  });

  it("carries data-align through to the printed cell", () => {
    const html = buildPdfHtml(
      wsWithDescription('<p data-align="center">middle</p>'),
      defaultExportConfig,
      "en-US",
    );
    expect(html).toContain('data-align="center"');
    // The rule that gives the attribute meaning ships in the same document.
    expect(html).toContain('td [data-align="center"]');
  });

  // ★★★ The security-relevant one. The rich branch is the ONE unescaped path in
  // the whole HTML export, and the six write paths behind these fields are not
  // all allow-listed (the codec load paths are DOM-free and cannot be, §28), so
  // a hostile value CAN reach storage. Re-sanitizing at the sink is what stops
  // it becoming markup in a document the user hands to a client.
  it("re-sanitizes at the sink", () => {
    const html = buildPdfHtml(
      wsWithDescription('<p onclick="x()">hi</p><script>bad()</script>'),
      defaultExportConfig,
      "en-US",
    );
    expect(html).toContain("hi");
    expect(html).not.toContain("onclick");
    expect(html).not.toContain("bad()");
  });

  it("still escapes a NON-rich cell", () => {
    const ws: Workspace = {
      ...makeBaseWorkspace(),
      tasks: [makeTask(1, { taskName: "<b>not markup</b>" })],
      raid: [],
    };
    const html = buildPdfHtml(ws, defaultExportConfig, "en-US");
    expect(html).toContain("&lt;b&gt;");
    expect(html).not.toContain("<td><b>not markup</b></td>");
  });

  // ★★★ THE ESCAPE-THEN-SUBSTITUTE ORDER, on the boundary where it is still
  // live. §141(b) moved rich columns onto the markup path, which retired the
  // two `export-ooxml.test.ts` fixtures that used to pin this ordering on
  // `description` (see the comment on `HTML export cells` there). Every NON-rich
  // cell still goes escape-then-substitute through `htmlCellWithBreaks`, and
  // that is most of them — so the guard needs a home on THIS path, not only on
  // `renderDocumentHtml`'s table block in doc-render-html.test.ts.
  //
  // ★★ `blockers` was chosen by measurement: it is free text, sits in no
  // *_RICH_COLUMNS set, and was probed to carry a "\n" through `fieldToString`
  // all the way into the emitted cell. A column that DROPPED the newline would
  // leave this passing for free with the substitution never running — the
  // failure mode that makes an ordering test look alive while it is dead.
  // (`status.value` is exactly such a column: `statusSection` splits on
  // /\r?\n/, so a newline there becomes two rows and never reaches a cell.)
  //
  // ★ Each assertion kills a different wrong order: substitute-only leaves the
  // user's "<br>" live; substitute-then-escape turns OUR boundary into a
  // visible "&lt;br&gt;".
  it("escapes a NON-rich cell BEFORE substituting its newline", () => {
    const ws: Workspace = {
      ...makeBaseWorkspace(),
      tasks: [makeTask(1, { blockers: "a<br>b\nc" })],
      raid: [],
    };
    const html = buildPdfHtml(ws, defaultExportConfig, "en-US");
    expect(html).toContain("a&lt;br&gt;b<br>c");
    expect(html).not.toContain("a<br>b");
    expect(html).not.toContain("b&lt;br&gt;c");
  });

  // ★★★ ORDER. `descriptionHtml` runs BEFORE `sanitizeRichHtml`, and this test
  // is the only thing pinning it. Both wrong orders fail here, for two DIFFERENT
  // reasons, which is why the fixture carries a newline AND a bare "<":
  //   • dropping descriptionHtml — the sanitizer has no reason to invent a <br>
  //     for a bare "\n", so the break is lost and the line runs on (§118);
  //   • sanitize-then-upgrade — the sanitizer escapes the "<" to "&lt;", and
  //     plainToHtml then escapes THAT "&", so the cell prints a visible "&lt;".
  it("upgrades a legacy plain-text value BEFORE sanitizing it", () => {
    const html = buildPdfHtml(
      wsWithDescription("cost < 5k\nremainder"),
      defaultExportConfig,
      "en-US",
    );
    expect(html).toContain("cost &lt; 5k<br>remainder");
    expect(html).not.toContain("&amp;lt;");
  });

  // ★ These are scoped to a DESCENDANT of a td, so they match nothing in a
  // column that is not rich. `td p` is load-bearing rather than cosmetic: a
  // plain legacy value is upgraded to <p>text</p>, and the UA default margin on
  // a p is 1em top and bottom.
  it("ships the td-scoped rules that keep the markup inside a table row", () => {
    const html = buildPdfHtml(wsWithDescription("x"), defaultExportConfig, "en-US");
    expect(html).toContain("td h1, td h2, td h3, td h4");
    expect(html).toContain("td p { margin: 0 0 2pt; }");
    expect(html).toContain("td ul, td ol");
    expect(html).toContain('td li[data-type="taskItem"]::before');
  });
});
