// @vitest-environment node
// §97 — with no DOM, every workspace load path that decodes a document FAILS LOUDLY
// with the named DomUnavailableError, whether or not the caller passed a `diag`.
// Before §97 each one swallowed the throw in its own catch: a caller without a
// `diag` lost every document with no report at all (and `logDiag` is a no-op
// without a `window`, so not even the diagnostics ring saw it).
//
// ★★ This file runs in the NODE environment ON PURPOSE: it is the only way to
// reach the real DOMPurify stub. Do not add a DOM here. The jsdom-side half of
// the contract (a document with a paragraph decodes and is sanitized) is pinned by
// the backend/codec documents tests, which run under jsdom.
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BrowserBackend } from "./browser-backend";
import { type ImportDiag, csvToWorkspace, workspaceToCsv } from "./csv-codecs";
import { buildTaskFromObj } from "./csv-codecs-decode";
import { DomUnavailableError } from "./dom-unavailable-error";
import type { DocTruncationDiag, ProjectDocument } from "./document-model";
import type { DocVersion } from "./document-versions";
import { idbSet } from "./idb";
import { IDB_OPTIONAL_KV_KEYS } from "./idb-layout";
import { markdownToWorkspace, workspaceToMarkdown } from "./markdown-codecs";
import { decodeNoteLog } from "./note-log";
import { htmlToText, sanitizeDocumentHtml, sanitizeRichHtml } from "./sanitize-html";
import { TABLE_NAMES, type PipelineResultLike, rowsToWorkspace } from "./turso-schema";
import { emptyWorkspace, jsonToWorkspace, workspaceToJson, type Workspace } from "./workspace";

const STAMP = "2026-10-05T00:00:00.000Z";
const doc = (blocks: ProjectDocument["blocks"]): ProjectDocument => ({ id: 1, title: "Report", blocks, createdAt: STAMP, updatedAt: STAMP });
/** The paragraph block is the trigger: only it runs the DOM-dependent allow-list. */
const PARAGRAPH_DOC = doc([{ type: "paragraph", html: "<p>keep me</p>" }]);
const VERSION: DocVersion = { id: 1, documentId: 1, title: "Report", blocks: PARAGRAPH_DOC.blocks, savedAt: STAMP, source: "user", op: "update" };
/** The control: a document with no paragraph never reaches DOMPurify. */
const HEADING_DOC = doc([{ type: "heading", level: 1, text: "March" }]);

const workspaceWith = (d: ProjectDocument): Workspace => ({ ...emptyWorkspace(), documents: [d] });

function metaOnlyResults(pairs: readonly (readonly [string, string])[]): PipelineResultLike[] {
  return TABLE_NAMES.map((t) => ({
    type: "ok",
    response: {
      type: "execute",
      result: t === "meta"
        ? { cols: [{ name: "key" }, { name: "value" }], rows: pairs.map(([k, v]) => [{ value: k }, { value: v }]) }
        : { cols: [], rows: [] },
    },
  }));
}

describe("§97 — the sanitizers name the missing DOM", () => {
  it.each([
    ["sanitizeRichHtml", () => sanitizeRichHtml("<p>x</p>")],
    ["sanitizeDocumentHtml", () => sanitizeDocumentHtml("<p>x</p>")],
    ["htmlToText", () => htmlToText("<p>x</p>")],
  ])("%s throws DomUnavailableError", (_name, call) => {
    expect(call).toThrow(DomUnavailableError);
  });
});

// Each decoder runs with and without a `diag`: the `diag` is what used to decide
// whether the drop was reported at all, so both must now fail the same way.
const DIAGS: readonly [string, () => ImportDiag | undefined][] = [
  ["no diag", () => undefined],
  ["a diag", () => ({ droppedRows: 0 })],
];

describe.each(DIAGS)("§97 — a document with a paragraph fails the load with %s", (_label, makeDiag) => {
  it("CSV", () => {
    const csv = workspaceToCsv(workspaceWith(PARAGRAPH_DOC));
    expect(() => csvToWorkspace(csv, makeDiag())).toThrow(DomUnavailableError);
  });

  it("Markdown", () => {
    const md = workspaceToMarkdown(workspaceWith(PARAGRAPH_DOC));
    expect(() => markdownToWorkspace(md, makeDiag())).toThrow(DomUnavailableError);
  });

  it.each([false, true])("JSON (strict: %s)", (strict) => {
    // ★ Non-strict is the one that answered with emptyWorkspace() before §97's
    // containment; it must now throw rather than return anything.
    const json = workspaceToJson(workspaceWith(PARAGRAPH_DOC));
    expect(() => jsonToWorkspace(json, { strict, diag: makeDiag() })).toThrow(DomUnavailableError);
  });

  it("JSON document versions", () => {
    const json = JSON.stringify({
      ...JSON.parse(workspaceToJson(emptyWorkspace())),
      documentVersions: [VERSION],
    });
    expect(() => jsonToWorkspace(json, { diag: makeDiag() })).toThrow(DomUnavailableError);
  });

  it("Turso", () => {
    const results = metaOnlyResults([["documents", JSON.stringify([PARAGRAPH_DOC])]]);
    expect(() => rowsToWorkspace(results, makeDiag())).toThrow(DomUnavailableError);
  });
});

describe("§97 — the other rich passes on the load paths", () => {
  const NOTE_LOG = JSON.stringify([{ id: 1, timestamp: STAMP, html: "<p>hi</p>", text: "hi" }]);

  it("decodeNoteLog rethrows a missing DOM, and still decodes a malformed cell to []", () => {
    // The CSV, Markdown and Turso row decoders all reach it; before §97 its catch
    // decoded every note log to [] with no DOM, silently.
    expect(() => decodeNoteLog(NOTE_LOG)).toThrow(DomUnavailableError);
    expect(decodeNoteLog("{not json")).toEqual([]);
  });

  it("a CSV/Turso task row with a note log fails, and the same row without one decodes", () => {
    const row = { id: "1", taskName: "Survivor" };
    expect(buildTaskFromObj(row)?.taskName).toBe("Survivor"); // control: no DOM needed
    expect(() => buildTaskFromObj({ ...row, noteLog: NOTE_LOG })).toThrow(DomUnavailableError);
  });

  it("a non-strict JSON load with one task and NO documents fails instead of returning an empty workspace", () => {
    // ★ Pins the OUTER-catch rethrow in jsonToWorkspace on its own: the task
    // rich-field pass runs outside any local catch and sanitizes any STRING
    // description (plain text and "" alike), so with no DOM it reaches
    // the outer catch-all, which used to answer emptyWorkspace() — every task lost.
    const json = JSON.stringify({ ...JSON.parse(workspaceToJson(emptyWorkspace())), tasks: [{ id: 1, taskName: "Survivor", description: "plain words" }] });
    expect(() => jsonToWorkspace(json)).toThrow(DomUnavailableError);
  });

  it("an EMPTY-string description triggers it too; only an absent field does not", () => {
    const base = JSON.parse(workspaceToJson(emptyWorkspace()));
    const load = (task: Record<string, unknown>) => jsonToWorkspace(JSON.stringify({ ...base, tasks: [task] }));
    expect(() => load({ id: 1, taskName: "Survivor", description: "" })).toThrow(DomUnavailableError);
    expect(load({ id: 1, taskName: "Survivor" }).tasks).toHaveLength(1); // control
  });
});

describe("§97 — IndexedDB", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ★ `load()` returns blank state at once when `window` is undefined, so the
  // test stubs one. DOMPurify was bound at IMPORT, with no window, so it stays a
  // stub: this is a browser load path with the DOM half missing.
  it("a stored document with a paragraph fails the load instead of falling through to blank state", async () => {
    globalThis.indexedDB = new IDBFactory();
    vi.stubGlobal("window", globalThis);
    await idbSet(IDB_OPTIONAL_KV_KEYS.documents, [PARAGRAPH_DOC]);
    await expect(new BrowserBackend().load()).rejects.toThrow(DomUnavailableError);
  });

  it("a stored document VERSION with a paragraph fails the load too", async () => {
    globalThis.indexedDB = new IDBFactory();
    vi.stubGlobal("window", globalThis);
    await idbSet(IDB_OPTIONAL_KV_KEYS.documentVersions, [VERSION]);
    await expect(new BrowserBackend().load()).rejects.toThrow(DomUnavailableError);
  });
});

describe("§97 — the control: no paragraph, no DOM needed", () => {
  // ★ Without these, every case above could be green because the decoders throw
  // for some reason unrelated to the DOM.
  it("CSV, Markdown, JSON and Turso keep a heading-only document", () => {
    const ws = workspaceWith(HEADING_DOC);
    expect(csvToWorkspace(workspaceToCsv(ws)).documents).toEqual([HEADING_DOC]);
    expect(markdownToWorkspace(workspaceToMarkdown(ws)).documents).toEqual([HEADING_DOC]);
    expect(jsonToWorkspace(workspaceToJson(ws)).documents).toEqual([HEADING_DOC]);
    expect(rowsToWorkspace(metaOnlyResults([["documents", JSON.stringify([HEADING_DOC])]])).documents).toEqual([HEADING_DOC]);
  });

  it("a slice that is genuinely unreadable still degrades and is reported, not thrown", () => {
    const diag: DocTruncationDiag = {};
    const ws = rowsToWorkspace(metaOnlyResults([["documents", "{not json"]]), diag);
    expect(ws.documents).toBeUndefined();
    expect(diag.decodeFailedSlices).toEqual(["documents"]);
  });
});
