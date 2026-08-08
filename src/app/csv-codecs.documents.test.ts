// src/app/csv-codecs.documents.test.ts
//
// Documents ride the CSV backend as ONE `config,<json>` row under its own
// `# DOCUMENTS` section — the knowledgeItems ROW SHAPE, but the steering /
// timelog / settings-overrides EMISSION RULE. Three properties matter here:
//
//  (1) STORAGE-ONLY. `workspaceToCsv` serves both the CSV storage backend
//      (called with no config) and the user-facing CSV export (`export.ts`,
//      called with one), so the emit is gated on `config === undefined`.
//      Unlike knowledgeItems there is no `documents` export key to gate on.
//  (2) BYTE-STABILITY. `golden-workspace.test` pins the exact CSV bytes of the
//      sample workspace, so an absent or empty `documents` array must emit
//      NOTHING — not an empty section, not a trailing separator.
//  (3) CELL ESCAPING. The whole JSON blob rides in ONE cell, so a title
//      carrying a comma, a double quote or a newline has to survive the round
//      trip. CSV is CRLF-delimited in this repo (markdown is LF), and the
//      section splitter re-joins its lines with "\r\n".

import { describe, it, expect } from "vitest";
import {
  workspaceToCsv,
  csvToWorkspace,
  documentsToCsv,
  csvToDocuments,
  documentVersionsToCsv,
  csvToDocumentVersions,
  type ImportDiag,
} from "./csv-codecs";
// Namespace import on purpose — the prefix-collision test below enumerates the
// markers reflectively so a newly added one is covered without editing it.
import * as SECTIONS from "./csv-codecs-sections";
import { defaultExportConfig } from "./settings-types";
import { defaultResourcePlan } from "./resource-foundation";
import {
  MAX_BLOCKS_PER_DOC,
  MAX_DOCUMENTS,
  type ProjectDocument,
} from "./document-model";
import type { DocVersion } from "./document-versions";
import type { Workspace } from "./workspace";

const DOC: ProjectDocument = {
  id: 1,
  title: "Deck",
  blocks: [{ type: "heading", level: 1, text: "March" }],
  createdAt: "2026-08-06T00:00:00.000Z",
  updatedAt: "2026-08-06T00:00:00.000Z",
};

function emptyWs(): Workspace {
  return {
    tasks: [],
    raid: [],
    absences: [],
    shifts: [],
    resources: [],
    roles: [],
    disciplines: [],
    grades: [],
    plan: defaultResourcePlan("2026-01-01"),
  };
}

function withDocs(docs: readonly ProjectDocument[]): Workspace {
  return { ...emptyWs(), documents: docs };
}

function withVersions(versions: readonly DocVersion[]): Workspace {
  return { ...emptyWs(), documentVersions: versions };
}

const VERSION: DocVersion = {
  id: 1,
  documentId: 3,
  title: "Prior, with comma",
  blocks: [{ type: "paragraph", html: "<p>a</p>" }],
  savedAt: "2026-08-04T07:00:00.000Z",
  source: "ai",
  op: "update",
};

/** Round-trips a single document through the STORAGE path and returns it. */
function roundTrip(doc: ProjectDocument): ProjectDocument | undefined {
  return csvToWorkspace(workspaceToCsv(withDocs([doc]))).documents?.[0];
}

describe("CSV codec — documents", () => {
  it("round-trips a document through the storage path", () => {
    const csv = workspaceToCsv(withDocs([DOC]));
    expect(csv).toContain("# DOCUMENTS");
    expect(csvToWorkspace(csv).documents).toEqual([DOC]);
  });

  // ★★ THE TEST THAT PINS THE STORAGE-ONLY GATE. `workspaceToCsv` serves BOTH
  // the CSV storage backend (no config) and the user-facing CSV export (config
  // supplied), and documents belong only to the former — a raw JSON blob in a
  // spreadsheet is noise, and it leaks document content into a file the user
  // believes holds their task table. Without this test the `config === undefined`
  // gate can be deleted and every other test here stays green.
  it("never emits documents on the export path, even when present", () => {
    const csv = workspaceToCsv(withDocs([DOC]), defaultExportConfig);
    expect(csv).not.toContain("# DOCUMENTS");
    expect(csv).not.toContain("Deck");
    // Byte-identical to the same export with no documents at all.
    expect(csv).toBe(workspaceToCsv(emptyWs(), defaultExportConfig));
    expect(csvToWorkspace(csv).documents).toBeUndefined();
  });

  it("emits no DOCUMENTS section when there are none", () => {
    expect(workspaceToCsv(emptyWs())).not.toContain("# DOCUMENTS");
    expect(workspaceToCsv(emptyWs(), defaultExportConfig)).not.toContain("# DOCUMENTS");
  });

  // ★ The real gate is byte equality, not the absence of the marker: an empty
  // section or a stray separator would still fail golden-workspace.test.
  it("is a byte-level no-op when documents are absent or empty", () => {
    const baseline = workspaceToCsv(emptyWs());
    expect(workspaceToCsv(withDocs([]))).toBe(baseline);
    const exported = workspaceToCsv(emptyWs(), defaultExportConfig);
    expect(workspaceToCsv(withDocs([]), defaultExportConfig)).toBe(exported);
  });

  it("round-trips a title containing a comma and a quote", () => {
    // ★ The JSON blob rides in one CSV cell, so cell escaping is the risk.
    const tricky = { ...DOC, title: 'Q1 "review", final' };
    expect(roundTrip(tricky)?.title).toBe('Q1 "review", final');
  });

  it("round-trips a title containing a newline and a CRLF", () => {
    // ★ The case that breaks naive escaping. It survives because
    // JSON.stringify escapes the break to a literal \n BEFORE the cell is
    // quoted — the blob never actually spans two CSV lines — but assert the
    // OUTCOME, since a future encoder that skips JSON would need the quoting.
    const tricky = { ...DOC, title: "Q1\nreview\r\nfinal" };
    expect(roundTrip(tricky)?.title).toBe("Q1\nreview\r\nfinal");
  });

  it("round-trips block text carrying a comma, a quote and a newline", () => {
    const tricky: ProjectDocument = {
      ...DOC,
      blocks: [
        { type: "heading", level: 2, text: 'Scope, "phase 1"' },
        { type: "paragraph", html: "<p>line one<br>line, two</p>" },
        { type: "bullets", items: ["a,b", 'c"d', "e\nf"] },
        { type: "table", columns: ["A,1"], rows: [['B"2']] },
      ],
    };
    expect(roundTrip(tricky)?.blocks).toEqual(tricky.blocks);
  });

  // ★★★ THE RICH-FIELD PASS. sanitizeProjectDocuments is DOM-FREE BY CONTRACT
  // and therefore CANNOT strip markup — it enforces STRUCTURE only. CSV and
  // Markdown were the only two of the six load paths that never chained
  // sanitizeDocumentRichFields, so paragraph HTML came back unfiltered here
  // while the same document loaded from JSON/IDB/Turso came back clean. Not a
  // live XSS (the render sinks re-sanitize), but a real content divergence: a
  // CSV→JSON migration would WRITE the unfiltered markup into a backend that
  // would have cleaned it, and any future consumer reading `paragraph.html`
  // directly turns it live.
  it("runs the rich-field allow-list on load, not just the structural pass", () => {
    const hostile: ProjectDocument = {
      ...DOC,
      blocks: [{ type: "paragraph", html: "<p>keep me</p><script>x()</script>" }],
    };
    const block = roundTrip(hostile)?.blocks[0];
    expect(block?.type).toBe("paragraph");
    const html = block?.type === "paragraph" ? block.html : "";
    // ★ BOTH halves are required. `not.toMatch(/script/i)` alone is satisfied
    // by html === "", which is exactly what a wrongly-wired sanitizeNoteHtml
    // (KEEP_CONTENT:false) produces — a passing test over deleted prose.
    expect(html).not.toMatch(/script/i);
    expect(html).toContain("keep me");
  });

  it("round-trips through the codec pair with the default neutralize flag", () => {
    // The assembler always passes `neutralize` explicitly, so the default
    // parameter is only reachable from a direct call.
    const line = documentsToCsv([DOC]);
    expect(line.startsWith("config,")).toBe(true);
    expect(csvToDocuments(line)).toEqual([DOC]);
  });

  it("drops a section whose blob is not valid JSON", () => {
    expect(csvToWorkspace("# DOCUMENTS\r\nconfig,not-json").documents).toBeUndefined();
  });

  it("drops a section whose blob sanitizes to nothing", () => {
    // An id-less entry is rejected by sanitizeProjectDocuments, leaving [].
    expect(csvToWorkspace('# DOCUMENTS\r\nconfig,"[{""title"":""x""}]"').documents).toBeUndefined();
    expect(csvToWorkspace("# DOCUMENTS\r\nconfig,[]").documents).toBeUndefined();
  });

  it("drops a section with no config row", () => {
    expect(csvToWorkspace("# DOCUMENTS\r\nfield,value").documents).toBeUndefined();
  });

  // ★★ THE CAP MUST BE AUDIBLE. sanitizeProjectDocuments stops at
  // MAX_DOCUMENTS and returns the head silently; the next autosave then writes
  // that truncated array back over all six paths and the tail is gone for good
  // (open-followups §103). The counter only helps if it survives BOTH hops —
  // codec → sanitizer and codec → the workspace-level accumulator — so assert
  // it on the ImportDiag every CSV caller already builds, not on a diag handed
  // straight to csvToDocuments (which would pass with the decode call unwired).
  it("reports cap truncation through the workspace-level ImportDiag", () => {
    const docs: ProjectDocument[] = Array.from({ length: MAX_DOCUMENTS + 3 }, (_, i) => ({
      id: i + 1,
      title: `Doc ${i + 1}`,
      blocks: [],
      createdAt: DOC.createdAt,
      updatedAt: DOC.updatedAt,
    }));
    const csv = workspaceToCsv(withDocs(docs));
    const diag: ImportDiag = { droppedRows: 0 };
    const ws = csvToWorkspace(csv, diag);
    // ★ The control half: without it a codec that dropped the section whole
    // would leave truncatedEntries undefined and only the negative assertion
    // below would fire.
    expect(ws.documents).toHaveLength(MAX_DOCUMENTS);
    expect(diag.truncatedEntries).toBe(3);
    // A capped document is not a REJECTED row — the two counters are separate.
    expect(diag.droppedRows).toBe(0);
  });

  it("keeps the DOCUMENTS section out of the other sections", () => {
    // The splitter is a mode machine: a mis-ordered marker check would fold
    // the blob into whichever section precedes it.
    const ws = csvToWorkspace(workspaceToCsv(withDocs([DOC])));
    expect(ws.documents).toEqual([DOC]);
    expect(ws.tasks).toEqual([]);
    expect(ws.knowledgeItems).toBeUndefined();
    expect(ws.insights).toBeUndefined();
  });
});

// documentVersions rides the CSV backend exactly like documents (same
// `# DOCUMENT VERSIONS` config-blob shape, same storage-only gate) — see the
// header comment above for why the three properties (storage-only,
// byte-stability, cell escaping) matter here too.
describe("CSV codec — documentVersions", () => {
  it("round-trips a version through the storage path", () => {
    const csv = workspaceToCsv(withVersions([VERSION]));
    expect(csv).toContain("# DOCUMENT VERSIONS");
    expect(csvToWorkspace(csv).documentVersions).toEqual([VERSION]);
  });

  // ★★ THE TEST THAT PINS THE STORAGE-ONLY GATE — mirrors the documents test
  // of the same name. Without this, the `config === undefined` gate can be
  // deleted and every other test in this block stays green: version history
  // is a before-image trail for AI tool writes, not user-facing export content.
  it("never emits documentVersions on the export path, even when present", () => {
    const csv = workspaceToCsv(withVersions([VERSION]), defaultExportConfig);
    expect(csv).not.toContain("# DOCUMENT VERSIONS");
    expect(csv).not.toContain("Prior, with comma");
    // Byte-identical to the same export with no version history at all.
    expect(csv).toBe(workspaceToCsv(emptyWs(), defaultExportConfig));
    expect(csvToWorkspace(csv).documentVersions).toBeUndefined();
  });

  it("emits no DOCUMENT VERSIONS section when there is none", () => {
    expect(workspaceToCsv(emptyWs())).not.toContain("# DOCUMENT VERSIONS");
    expect(workspaceToCsv(emptyWs(), defaultExportConfig)).not.toContain("# DOCUMENT VERSIONS");
  });

  // ★ The real gate is byte equality, not just marker absence — an empty
  // section or stray separator would still fail golden-workspace.test.
  it("is a byte-level no-op when versions are absent or empty", () => {
    const baseline = workspaceToCsv(emptyWs());
    expect(workspaceToCsv(withVersions([]))).toBe(baseline);
  });

  it("round-trips a title containing a comma and a quote", () => {
    const tricky: DocVersion = { ...VERSION, title: 'Q1 "review", final' };
    const csv = workspaceToCsv(withVersions([tricky]));
    expect(csvToWorkspace(csv).documentVersions?.[0].title).toBe('Q1 "review", final');
  });

  // ★★★ THE RICH-FIELD PASS, mirroring the documents test of the same name.
  // sanitizeDocumentVersions is DOM-FREE BY CONTRACT and enforces STRUCTURE
  // only — the paragraph HTML allow-list is a separate pass this codec must
  // chain, or a version's markup comes back unfiltered from CSV while the
  // same version loaded from JSON/IDB/Turso comes back clean.
  it("runs the rich-field allow-list on load, not just the structural pass", () => {
    const hostile: DocVersion = {
      ...VERSION,
      blocks: [{ type: "paragraph", html: "<p>keep me</p><script>x()</script>" }],
    };
    const csv = workspaceToCsv(withVersions([hostile]));
    const block = csvToWorkspace(csv).documentVersions?.[0].blocks[0];
    expect(block?.type).toBe("paragraph");
    const html = block?.type === "paragraph" ? block.html : "";
    expect(html).not.toMatch(/script/i);
    expect(html).toContain("keep me");
  });

  it("round-trips through the codec pair with the default neutralize flag", () => {
    const line = documentVersionsToCsv([VERSION]);
    expect(line.startsWith("config,")).toBe(true);
    expect(csvToDocumentVersions(line)).toEqual([VERSION]);
  });

  it("drops a section whose blob is not valid JSON", () => {
    expect(csvToWorkspace("# DOCUMENT VERSIONS\r\nconfig,not-json").documentVersions).toBeUndefined();
  });

  it("drops a section whose blob sanitizes to nothing", () => {
    expect(csvToWorkspace("# DOCUMENT VERSIONS\r\nconfig,[]").documentVersions).toBeUndefined();
  });

  it("drops a section with no config row", () => {
    expect(csvToWorkspace("# DOCUMENT VERSIONS\r\nfield,value").documentVersions).toBeUndefined();
  });

  // ★★ Mirrors the documents cap test, but the counter is a DIFFERENT one: a
  // version is sanitized one at a time, so it can never trip the DOCUMENT cap
  // — its loss is per-version BLOCK truncation, and it has to reach the same
  // workspace-level accumulator.
  it("reports block truncation through the workspace-level ImportDiag", () => {
    const fat: DocVersion = {
      ...VERSION,
      blocks: Array.from({ length: MAX_BLOCKS_PER_DOC + 3 }, (_, i) => ({
        type: "paragraph" as const,
        html: `<p>b${i}</p>`,
      })),
    };
    const csv = workspaceToCsv(withVersions([fat]));
    const diag: ImportDiag = { droppedRows: 0 };
    const ws = csvToWorkspace(csv, diag);
    expect(ws.documentVersions?.[0].blocks).toHaveLength(MAX_BLOCKS_PER_DOC);
    expect(diag.truncatedBlocks).toBe(3);
    expect(diag.droppedRows).toBe(0);
  });

  it("keeps the DOCUMENT VERSIONS section out of the other sections, including DOCUMENTS", () => {
    // The splitter is a mode machine: a mis-ordered marker check would fold
    // this section's blob into whichever one precedes it — DOCUMENTS is the
    // adjacent, name-overlapping risk ("# DOCUMENT VERSIONS" is not a prefix
    // match for "# DOCUMENTS" or vice versa, but assert the outcome, not the
    // string comparison).
    const ws = csvToWorkspace(workspaceToCsv({ ...withDocs([DOC]), documentVersions: [VERSION] }));
    expect(ws.documentVersions).toEqual([VERSION]);
    expect(ws.documents).toEqual([DOC]);
    expect(ws.tasks).toEqual([]);
  });

  // ★★ The GENERAL form of the test above. That one pins the one pair we
  // happen to have thought of; this pins the property that makes the whole
  // splitter safe, for every marker, including ones added after this was
  // written. `splitCsvSections` dispatches with `startsWith`, so a marker that
  // is a strict PREFIX of another is swallowed by whichever is checked first —
  // and the symptom is a silently ABSENT slice, not an error.
  // ★ Read reflectively from the module rather than from a hand-listed array:
  // a literal list only ever asserts against itself, so a 27th marker added to
  // csv-codecs-sections.ts would skip this check — which is the single case it
  // exists to catch.
  it("no CSV section marker is a prefix of another", () => {
    const markers = Object.entries(SECTIONS)
      .filter(([name, value]) => name.startsWith("CSV_SECTION_") && typeof value === "string")
      .map(([name, value]) => ({ name, value: value as string }));
    // Control: prove the reflective read actually found the markers. Without
    // this an empty/renamed export makes the sweep below vacuously green.
    expect(markers.length).toBeGreaterThan(20);
    expect(markers.map((m) => m.name)).toContain("CSV_SECTION_DOCUMENT_VERSIONS");

    const collisions = markers.flatMap((a) =>
      markers
        .filter((b) => b.name !== a.name && b.value.startsWith(a.value))
        .map((b) => `${b.name} ("${b.value}") is swallowed by ${a.name} ("${a.value}")`),
    );
    expect(collisions).toEqual([]);
  });
});
