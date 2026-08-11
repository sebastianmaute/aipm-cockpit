// src/app/markdown-codecs.documents.test.ts
//
// Documents on the Markdown backend. They persist as a fenced ```json blob
// (the knowledgeItems/insights precedent), NOT a table: a document holds a
// nested block array, and noteLog — the only JSON-in-cell precedent in this
// repo — is deliberately absent from the Markdown columns entirely, so there
// is no table pattern to copy.

import { describe, it, expect } from "vitest";
import {
  workspaceToMarkdown,
  markdownToWorkspace,
  documentsToMarkdown,
  markdownToDocuments,
  documentVersionsToMarkdown,
  markdownToDocumentVersions,
} from "./markdown-codecs";
import { defaultExportConfig } from "./settings-types";
import { defaultResourcePlan } from "./resource-foundation";
import type { Workspace } from "./workspace";
// `ImportDiag` is declared in the CSV decode module and re-exported by its
// barrel; the Markdown decoders take the same accumulator, so this is the
// canonical spelling rather than a cross-backend borrow.
import type { ImportDiag } from "./csv-codecs";
import {
  MAX_BLOCKS_PER_DOC,
  MAX_DOCUMENTS,
  type ProjectDocument,
} from "./document-model";
import type { DocVersion } from "./document-versions";

const DOC: ProjectDocument = {
  id: 1,
  title: "Deck",
  blocks: [{ type: "bullets", items: ["one", "two"] }],
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

function wsWith(docs: readonly ProjectDocument[]): Workspace {
  return { ...emptyWs(), documents: docs };
}

describe("Markdown codec — documents", () => {
  it("round-trips a document on the storage path", () => {
    const md = workspaceToMarkdown(wsWith([DOC]));
    expect(md).toContain("## Documents");
    expect(markdownToWorkspace(md).documents).toEqual([DOC]);
  });

  // ★★ STORAGE-ONLY, and this is the assertion that pins it. workspaceToMarkdown
  // serves the markdown storage backend AND the user-facing markdown export;
  // documents are not an ExportSectionKey, and a raw JSON blob fenced into the
  // middle of a document someone means to read is not an export. Same gate as
  // settingsOverrides/timelogLinks/steeringCommittee. Without this test the
  // `config === undefined` gate could be deleted and the suite stay green.
  it("emits nothing on the export path, even with documents present", () => {
    const md = workspaceToMarkdown(wsWith([DOC]), defaultExportConfig);
    expect(md).not.toContain("## Documents");
    // Not just the heading: a partial break could suppress the marker and still
    // emit the blob, which would leak document content into a file the user
    // believes holds their task table.
    expect(md).not.toContain("Deck");
    // ★ The REAL gate is byte equality — an empty section or a stray separator
    // passes both assertions above and still fails golden-workspace.test.
    expect(md).toBe(workspaceToMarkdown(emptyWs(), defaultExportConfig));
    expect(markdownToWorkspace(md).documents).toBeUndefined();
  });

  it("emits no Documents block when there are none", () => {
    expect(workspaceToMarkdown(emptyWs())).not.toContain("## Documents");
  });

  // ★ Byte-stability: the golden fixtures pin the exact markdown bytes for a
  // workspace with no documents. An absent field and an empty array must both
  // be a byte-level no-op, on the storage path AND the export path.
  it("an absent or empty documents array is a byte-level no-op", () => {
    const base = workspaceToMarkdown(emptyWs());
    expect(workspaceToMarkdown(wsWith([]))).toBe(base);
    const baseExport = workspaceToMarkdown(emptyWs(), defaultExportConfig);
    expect(workspaceToMarkdown(wsWith([]), defaultExportConfig)).toBe(baseExport);
  });

  it("round-trips a title containing a pipe and a backtick", () => {
    // ★ The blob sits inside a fenced block, not a table cell, so a pipe must
    // survive verbatim. A table-based codec would need escaping here.
    const tricky: ProjectDocument = { ...DOC, title: "A | B `code`" };
    const md = workspaceToMarkdown(wsWith([tricky]));
    expect(markdownToWorkspace(md).documents?.[0].title).toBe("A | B `code`");
  });

  // ★★ FENCE COLLISION. JSON.stringify does NOT escape a backtick, so a user
  // can put a literal ``` in a title or a paragraph's HTML. It is harmless BY
  // CONSTRUCTION, not by luck: the closing fence is only recognised at the
  // START OF A LINE (the regex requires `\n` immediately before it), and
  // JSON.stringify escapes U+000A inside a string as the two characters \ and
  // n — so no character a user types can ever put ``` at column 0. These two
  // tests are what makes that an assertion rather than an argument.
  /** Lines that OPEN at column 0 with a fence — the only ones the decoder's
   *  closing-fence regex can see. Exactly two (our own ```json and ```) means
   *  no user-typed backtick run escaped the blob. */
  const fenceLines = (md: string) => md.split("\n").filter((l) => l.startsWith("```")).length;

  it("round-trips a ``` inside a title and inside paragraph HTML", () => {
    const tricky: ProjectDocument = {
      ...DOC,
      title: "``` fence ```json",
      blocks: [{ type: "paragraph", html: "<p>see ```</p>" }],
    };
    const md = workspaceToMarkdown(wsWith([tricky]));
    expect(fenceLines(md)).toBe(2);
    expect(markdownToWorkspace(md).documents).toEqual([tricky]);
  });

  it("round-trips a title containing a literal newline followed by a fence", () => {
    // The newline is escaped by JSON.stringify as the two characters \ and n,
    // so the ``` after it cannot reach column 0 and end the block early.
    const tricky: ProjectDocument = { ...DOC, title: "line one\n``` line two" };
    const md = workspaceToMarkdown(wsWith([tricky]));
    expect(fenceLines(md)).toBe(2);
    expect(markdownToWorkspace(md).documents?.[0].title).toBe("line one\n``` line two");
  });

  // ★★★ THE RICH-FIELD PASS. sanitizeProjectDocuments is DOM-FREE BY CONTRACT
  // and therefore CANNOT strip markup — it enforces STRUCTURE only. Markdown
  // and CSV were the only two of the six load paths that never chained
  // sanitizeDocumentRichFields, so paragraph HTML came back unfiltered here
  // while the same document loaded from JSON/IDB/Turso came back clean. Not a
  // live XSS (the render sinks re-sanitize), but a real content divergence: a
  // Markdown→JSON migration would WRITE the unfiltered markup into a backend
  // that would have cleaned it, and any future consumer reading
  // `paragraph.html` directly turns it live.
  it("runs the rich-field allow-list on load, not just the structural pass", () => {
    const hostile: ProjectDocument = {
      ...DOC,
      blocks: [{ type: "paragraph", html: "<p>keep me</p><script>x()</script>" }],
    };
    const md = workspaceToMarkdown(wsWith([hostile]));
    const block = markdownToWorkspace(md).documents?.[0].blocks[0];
    expect(block?.type).toBe("paragraph");
    const html = block?.type === "paragraph" ? block.html : "";
    // ★ BOTH halves are required. `not.toMatch(/script/i)` alone is satisfied
    // by html === "", which is exactly what a DESTRUCTIVELY-wired sanitizer
    // produces — a passing test over deleted prose. ★ The concrete instance used
    // to be sanitizeNoteHtml (KEEP_CONTENT:false); it is retired and no sanitizer
    // in the repo deletes text today, so the second half now guards against a
    // future one rather than a present one. Keep it: it costs nothing and it is
    // the only thing separating "sanitized" from "emptied".
    expect(html).not.toMatch(/script/i);
    expect(html).toContain("keep me");
  });

  it("sanitizes on the way in — a corrupt entry is dropped", () => {
    const md = documentsToMarkdown([
      { id: 0, title: "no id", blocks: [], createdAt: "", updatedAt: "" },
      DOC,
    ]);
    expect(markdownToDocuments(md)).toEqual([DOC]);
  });

  it("returns undefined for a missing block, malformed JSON, or an all-invalid array", () => {
    expect(markdownToDocuments("# AIPM Tasks\n")).toBeUndefined();
    expect(markdownToDocuments("## Documents\n\n```json\n{ nope\n```\n")).toBeUndefined();
    expect(markdownToDocuments("## Documents\n\n```json\n[{}]\n```\n")).toBeUndefined();
  });

  // ★★ open-followups §103. The cap silently truncated and recorded NOTHING, so
  // the next autosave committed the loss permanently. The counter has to reach
  // the WORKSPACE-level accumulator — a diag threaded only as far as
  // markdownToDocuments would leave markdownToWorkspace (the load path the app
  // actually calls) reporting a clean import over 3 dropped entries.
  it("reports cap truncation through the workspace-level ImportDiag", () => {
    const docs: ProjectDocument[] = Array.from({ length: MAX_DOCUMENTS + 3 }, (_, i) => ({
      id: i + 1,
      title: `Doc ${i + 1}`,
      blocks: [],
      createdAt: DOC.createdAt,
      updatedAt: DOC.updatedAt,
    }));
    const md = workspaceToMarkdown(wsWith(docs));
    const diag: ImportDiag = { droppedRows: 0 };
    const ws = markdownToWorkspace(md, diag);
    expect(diag.truncatedEntries).toBe(3);
    // ★ The control half: without it the assertion above would still pass if
    // the decode had failed outright and something else had done the counting.
    expect(ws.documents).toHaveLength(MAX_DOCUMENTS);
    // A capped entry is a valid document that went unread, not a malformed row.
    expect(diag.droppedRows).toBe(0);
  });
});

describe("Markdown codec — document versions", () => {
  const VERSION: DocVersion = {
    id: 1,
    documentId: 3,
    title: "Snapshot",
    blocks: [],
    savedAt: "2026-08-05T07:00:00.000Z",
    source: "user",
    op: "delete",
  };

  it("round-trips", () => {
    const md = documentVersionsToMarkdown([VERSION]);
    expect(markdownToDocumentVersions(md)).toEqual([VERSION]);
  });

  // Same fence-collision argument and test shape as the documents suite above.
  it("puts no fence at column 0 inside the payload", () => {
    const nasty: DocVersion = { ...VERSION, title: "``` not a fence" };
    const md = documentVersionsToMarkdown([nasty]);
    const fenceLines = md.split("\n").filter((l) => l.startsWith("```"));
    expect(fenceLines).toHaveLength(2);
    expect(markdownToDocumentVersions(md)).toEqual([nasty]);
  });

  // ★★ STORAGE-ONLY, mirrors the documents export-gate test above. Without
  // this test the `config === undefined` gate on the emit site could be
  // deleted and the suite would stay green — version history would then leak
  // into every user-facing markdown export.
  it("emits nothing on the export path, even with document versions present", () => {
    const ws = { ...emptyWs(), documentVersions: [VERSION] };
    const md = workspaceToMarkdown(ws, defaultExportConfig);
    expect(md).not.toContain("## Document versions");
    expect(md).not.toContain("Snapshot");
    expect(md).toBe(workspaceToMarkdown(emptyWs(), defaultExportConfig));
    expect(markdownToWorkspace(md).documentVersions).toBeUndefined();
  });

  it("an absent or empty documentVersions array is a byte-level no-op", () => {
    const base = workspaceToMarkdown(emptyWs());
    expect(workspaceToMarkdown({ ...emptyWs(), documentVersions: [] })).toBe(base);
  });

  it("decodes documents and document versions from the same file", () => {
    const ws = { ...emptyWs(), documents: [DOC], documentVersions: [VERSION] };
    const back = markdownToWorkspace(workspaceToMarkdown(ws));
    expect(back.documents).toHaveLength(1);
    expect(back.documentVersions).toHaveLength(1);
  });

  // The versions decoder is the SECOND call the workspace-level accumulator has
  // to reach, and it counts a different loss: blocks capped off a single
  // version, not entries capped off the array. Threading only the documents
  // call would leave this one silent.
  it("reports per-version block truncation through the workspace-level ImportDiag", () => {
    const over: DocVersion = {
      ...VERSION,
      blocks: Array.from({ length: MAX_BLOCKS_PER_DOC + 2 }, (_, i) => ({
        type: "paragraph" as const,
        html: `<p>block ${i}</p>`,
      })),
    };
    const md = workspaceToMarkdown({ ...emptyWs(), documentVersions: [over] });
    const diag: ImportDiag = { droppedRows: 0 };
    const ws = markdownToWorkspace(md, diag);
    expect(diag.truncatedBlocks).toBe(2);
    // ★ Control: a decode that failed whole would leave documentVersions
    // undefined and prove nothing about the counter above.
    expect(ws.documentVersions?.[0].blocks).toHaveLength(MAX_BLOCKS_PER_DOC);
    // The DOCUMENT cap is untouched — a single version can never trip it.
    expect(diag.truncatedEntries).toBeUndefined();
  });

  it("returns undefined for a missing block, malformed JSON, or an all-invalid array", () => {
    expect(markdownToDocumentVersions("# AIPM Tasks\n")).toBeUndefined();
    expect(markdownToDocumentVersions("## Document versions\n\n```json\n{ nope\n```\n")).toBeUndefined();
    expect(markdownToDocumentVersions("## Document versions\n\n```json\n[{}]\n```\n")).toBeUndefined();
  });
});
