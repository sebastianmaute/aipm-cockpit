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

import { describe, it, expect, vi, afterEach } from "vitest";
import { buildPdfHtml, exportFilename, exportWorkspace } from "./export";
import { defaultExportConfig } from "./settings-types";
import type { ExportConfig } from "./settings-types";
import type { Workspace } from "./storage";
import type { Task, RaidItem, Milestone, ProjectMeta } from "./types";
import { DEFAULT_EXPORT_FOOTER } from "./export-footer";
import { PDF_EXPORT_FRAME_NAME, PDF_READY_TITLE_PREFIX } from "./pdf-export-protocol";

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

  // ★★★ A STORED ENTITY MUST SURVIVE THE RICH PATH AS AN ENTITY. Since §141(b)
  // this property runs through `sanitizeRichHtml(descriptionHtml(...))` rather
  // than through `htmlCellWithBreaks`, so none of the escaping guards on the
  // NON-rich path cover it, and "DOMPurify preserves entities" is an assumption
  // about a dependency that nothing else in this repo asserts. A user's literal
  // "<br>" turning into a real line break in an exported PDF is a
  // content-integrity bug that every other string assertion would stay green
  // through.
  //
  // ★★ PARTIAL OVERLAP, stated so nobody deletes the wrong one: the "<br>" half
  // is also pinned by `export-ooxml.test.ts`'s "escapes BEFORE substituting",
  // which is the historical site of that assertion (see its describe comment).
  // The "&amp;" half is pinned ONLY here — and the two halves have measurably
  // different strength, which is the reason this test spells both out. A decode
  // BEFORE the sanitizer breaks the "<br>" half but NOT the "&amp;" half,
  // because DOMPurify re-escapes a bare "&" on serialize; only a decode AFTER
  // the sanitizer breaks "&amp;". Do not fold the two into one assertion.
  it("keeps a stored entity escaped through the rich path", () => {
    const html = buildPdfHtml(
      wsWithDescription("<p>R&amp;D &lt;br&gt; done</p>"),
      defaultExportConfig,
      "en-US",
    );
    // The ampersand stays an entity — a decode here would corrupt "R&D" in
    // every export, silently and permanently.
    expect(html).toContain("R&amp;D");
    expect(html).not.toContain("R&D");
    // The user's literal "<br>" stays an entity and never becomes a real break.
    expect(html).toContain("&lt;br&gt;");
    expect(html).not.toContain("<br> done");
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

describe("buildPdfHtml — export footer", () => {
  it("keeps the built-in footer when none is passed", () => {
    expect(buildPdfHtml(makeBaseWorkspace(), defaultExportConfig, "en-US")).toContain(`<footer>${DEFAULT_EXPORT_FOOTER}</footer>`);
  });

  it("prints the configured footer, HTML-escaped", () => {
    const html = buildPdfHtml(makeBaseWorkspace(), defaultExportConfig, "en-US", "Acme <GmbH> & Co");
    expect(html).toContain("<footer>Acme &lt;GmbH&gt; &amp; Co</footer>");
    // ★ Substring-only would false-fail: the page <title> also carries the app's
    //   own name, which is now the same text as the built-in footer. Check the
    //   footer element specifically.
    expect(html).not.toContain(`<footer>${DEFAULT_EXPORT_FOOTER}</footer>`);
  });
});

// ★★★ §468 review I2 — the DEFAULT `closingScript` (what every pre-existing
// caller gets, unchanged) must reproduce the browser auto-print block
// EXACTLY, not merely "somewhere a substring `window.print()` shows up". This
// literal is copied by hand from the script `buildPdfHtml` inlined directly
// before the §468 branch existed — a change to either copy, or to which one
// `buildPdfHtml` emits by default, must fail this test.
const EXPECTED_BROWSER_AUTO_PRINT_SCRIPT = `  <script>
    // Wait one paint so the browser has rendered the table before
    // opening the print dialog; otherwise some browsers print blank.
    window.addEventListener("load", () => {
      setTimeout(() => {
        // Best-effort: focus + print can throw if the popup was blocked or
        // closed before this fires. Nothing to recover — the user can print
        // manually — so the failure is intentionally swallowed.
        try { window.focus(); window.print(); } catch (e) {}
      }, 80);
    });
  </script>`;

describe("buildPdfHtml — browser closing script is byte-identical (§468 review I2)", () => {
  it("emits the exact pre-§468 auto-print block, placed before </body>, when no closingScript is passed", () => {
    const html = buildPdfHtml(makeBaseWorkspace(), defaultExportConfig, "en-US");
    expect(html).toContain(EXPECTED_BROWSER_AUTO_PRINT_SCRIPT);
    expect(html.indexOf(EXPECTED_BROWSER_AUTO_PRINT_SCRIPT)).toBeLessThan(html.lastIndexOf("</body>"));
  });
});

// ★★★ §468 — in the desktop shell, `window.print()` is refused, so the PDF
// export tab must open under the named frame and carry the READY signal
// (never the auto-print script) there; in a browser it must stay exactly as
// before — `_blank` and the auto-print script. `fakeTab` mirrors document-
// download.test.ts's helper: a stand-in `Window` whose `document.write` is
// observable without a real browser.
function fakeTab() {
  const state = { html: "" };
  const win = {
    document: {
      open: () => {
        state.html = "";
      },
      write: (chunk: string) => {
        state.html += chunk;
      },
      close: () => {},
    },
  } as unknown as Window;
  return {
    win,
    get html() {
      return state.html;
    },
  };
}

describe("exportWorkspace — pdf window target (§468)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("opens _blank with the auto-print script in a browser", async () => {
    const tab = fakeTab();
    const open = vi.fn(() => tab.win);
    vi.stubGlobal("open", open);
    vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 Chrome/140");

    await exportWorkspace(makeBaseWorkspace(), "pdf", defaultExportConfig, "en-US");

    expect(open).toHaveBeenCalledWith("", "_blank");
    expect(tab.html).toContain("window.print");
    expect(tab.html).not.toContain(PDF_READY_TITLE_PREFIX);
  });

  it("opens the named frame with the ready signal, and never window.print, in the desktop shell", async () => {
    const tab = fakeTab();
    const open = vi.fn(() => tab.win);
    vi.stubGlobal("open", open);
    vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 Electron/44.0.0");

    await exportWorkspace(makeBaseWorkspace(), "pdf", defaultExportConfig, "en-US");

    expect(open).toHaveBeenCalledWith("", PDF_EXPORT_FRAME_NAME);
    // §468 review round 2 — the signal is a static <title>, not a script: an
    // inline <script> here would be blocked by the packaged app's nonce-only
    // production CSP.
    expect(tab.html).toContain(`<title>${PDF_READY_TITLE_PREFIX}`);
    expect(tab.html).not.toContain("<script");
    expect(tab.html).not.toContain("window.print");
    // Exactly one <title> — replaced, not appended after the normal one.
    expect(tab.html.match(/<title>/g)).toHaveLength(1);
  });
});

// §468 packaged-app check — a whole-project export was named
// `aipm-cockpit-tasks-<date>` whatever it held. With project details in the
// workspace it now names the project, slugged by the same rule a document's
// filename uses (`filenameStem`); without them it keeps the old name.
describe("exportFilename", () => {
  it("names a whole-project export after the project", () => {
    expect(exportFilename("pdf", "2026-09-26", "AZiD SOD Rollout")).toBe(
      "aipm-cockpit-project-azid-sod-rollout-2026-09-26.pdf",
    );
    expect(exportFilename("docx", "2026-09-26", "Änderung: Q1/Q2")).toBe(
      "aipm-cockpit-project-änderung-q1-q2-2026-09-26.docx",
    );
  });

  it("keeps the tasks name when there is no project name", () => {
    expect(exportFilename("pdf", "2026-09-26")).toBe("aipm-cockpit-tasks-2026-09-26.pdf");
    expect(exportFilename("csv", "2026-09-26", "   ")).toBe("aipm-cockpit-tasks-2026-09-26.csv");
    // A name that slugs to nothing never yields "project-project" or "--".
    expect(exportFilename("pdf", "2026-09-26", "???")).toBe("aipm-cockpit-tasks-2026-09-26.pdf");
  });

  // The Open Points export menu (export-menu.tsx) builds its workspace with NO
  // `project` key; its file must keep the tasks name.
  it("keeps the tasks name through exportWorkspace when the workspace has no project", async () => {
    const tab = fakeTab();
    vi.stubGlobal("open", vi.fn(() => tab.win));
    vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 Electron/44.0.0");

    await exportWorkspace(makeBaseWorkspace(), "pdf", defaultExportConfig, "en-US");

    expect(tab.html).toMatch(new RegExp(`<title>${PDF_READY_TITLE_PREFIX}aipm-cockpit-tasks-\\d{4}-\\d{2}-\\d{2}\\.pdf</title>`));
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("puts the project name in the desktop PDF's suggested save name", async () => {
    const tab = fakeTab();
    vi.stubGlobal("open", vi.fn(() => tab.win));
    vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 Electron/44.0.0");
    const ws = { ...makeBaseWorkspace(), project: { name: "Apollo Rollout" } as ProjectMeta };

    await exportWorkspace(ws, "pdf", defaultExportConfig, "en-US");

    expect(tab.html).toMatch(
      new RegExp(`<title>${PDF_READY_TITLE_PREFIX}aipm-cockpit-project-apollo-rollout-\\d{4}-\\d{2}-\\d{2}\\.pdf</title>`),
    );
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
});

// §468 packaged-app check — in a PRODUCTION build the browser print tab
// inherits the app's nonce-only CSP, so its `<style>` and auto-print `<script>`
// must carry the page's nonce (read by `readCspNonce`) or neither applies. The
// auto-print block's bytes are otherwise unchanged: the pinned pre-§468 block
// with ONLY the nonce attribute added to its opening tag.
describe("exportWorkspace — browser print tab carries the CSP nonce (§468)", () => {
  const NONCE = "nOnCe+/=42";
  let nonced: HTMLScriptElement | null = null;
  afterEach(() => {
    nonced?.remove();
    nonced = null;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  function addNoncedScript(nonce: string) {
    nonced = document.createElement("script");
    nonced.setAttribute("nonce", nonce);
    nonced.nonce = nonce;
    document.head.appendChild(nonced);
  }

  it("nonces the stylesheet and the exact auto-print block in a browser", async () => {
    addNoncedScript(NONCE);
    const tab = fakeTab();
    vi.stubGlobal("open", vi.fn(() => tab.win));
    vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 Chrome/140");

    await exportWorkspace(makeBaseWorkspace(), "pdf", defaultExportConfig, "en-US");

    expect(tab.html).toContain(`<style nonce="${NONCE}">`);
    const expected = EXPECTED_BROWSER_AUTO_PRINT_SCRIPT.replace("<script>", `<script nonce="${NONCE}">`);
    expect(tab.html).toContain(expected);
    expect(tab.html.indexOf(expected)).toBeLessThan(tab.html.lastIndexOf("</body>"));
  });

  it("nonces the stylesheet in the desktop shell too, and still carries no script", async () => {
    addNoncedScript(NONCE);
    const tab = fakeTab();
    vi.stubGlobal("open", vi.fn(() => tab.win));
    vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 Electron/44.0.0");

    await exportWorkspace(makeBaseWorkspace(), "pdf", defaultExportConfig, "en-US");

    expect(tab.html).toContain(`<style nonce="${NONCE}">`);
    expect(tab.html).not.toContain("<script");
  });

  it("never writes the live page's nonce into the popup-blocked fallback file", async () => {
    addNoncedScript(NONCE);
    vi.stubGlobal("open", vi.fn(() => null));
    vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 Chrome/140");
    const blobs: Blob[] = [];
    vi.stubGlobal("URL", { ...URL, createObjectURL: vi.fn((b: Blob) => { blobs.push(b); return "blob:x"; }), revokeObjectURL: vi.fn() });

    await exportWorkspace(makeBaseWorkspace(), "pdf", defaultExportConfig, "en-US");

    expect(blobs).toHaveLength(1);
    const text = await blobs[0].text();
    expect(text).toContain("<style>");
    expect(text).not.toContain("nonce=");
  });

  it("emits the unchanged bare tags when the page has no nonce (a dev server)", async () => {
    const tab = fakeTab();
    vi.stubGlobal("open", vi.fn(() => tab.win));
    vi.spyOn(window.navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 Chrome/140");

    await exportWorkspace(makeBaseWorkspace(), "pdf", defaultExportConfig, "en-US");

    expect(tab.html).toContain("<style>");
    expect(tab.html).toContain(EXPECTED_BROWSER_AUTO_PRINT_SCRIPT);
  });
});
