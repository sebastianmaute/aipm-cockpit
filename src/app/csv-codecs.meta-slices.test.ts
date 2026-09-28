// src/app/csv-codecs.meta-slices.test.ts
//
// §630 — the CSV half of §620. A meta slice whose JSON does not parse, or that
// parses but SANITIZES TO NOTHING, was dropped in silence by the CSV decoders,
// and the next save rewrote the file without it. `csvToWorkspace(text, diag)`
// now pushes the slice's key into `diag.decodeFailedSlices` — the same
// accumulator and the same 13 key names `jsonToWorkspace` uses — so
// `lastDecodeFailures` pauses saving exactly as it does for a JSON file.
//
// ★★ The §617 rule still holds: a stored `[]`, `{}` or blank value sanitizes to
//  nothing too, and must stay SILENT (each report pauses saving).
// ★ Fixtures are the real encoder's output with ONE section appended by hand,
//  in the encoder's own `<marker>\r\nconfig,<cell>` shape. The per-slice
//  values are shared with the Markdown twin (src/test/meta-slices-fixtures.ts).

import { afterEach, describe, expect, it, vi, onTestFinished } from "vitest";
import {
  CSV_SECTION_ACTIVITY,
  CSV_SECTION_BUDGET_HISTORY,
  CSV_SECTION_DOCUMENTS,
  CSV_SECTION_DOCUMENT_VERSIONS,
  CSV_SECTION_FIELD_VIS,
  CSV_SECTION_FUNCTIONS,
  CSV_SECTION_INSIGHTS,
  CSV_SECTION_KNOWLEDGE_ITEMS,
  CSV_SECTION_PROJECT,
  CSV_SECTION_SETTINGS_OVERRIDES,
  CSV_SECTION_STATUS,
  CSV_SECTION_STEERING,
  CSV_SECTION_TIMELOG_LINKS,
  csvCellEscape,
  csvToWorkspace,
  workspaceToCsv,
} from "./csv-codecs";
import { emptyWorkspace } from "./workspace";
import {
  ALL_META_KEYS,
  META_BLOB_CASES,
  type BlobKey,
  decodeWithDiag,
  fullMetaWorkspace,
  metaSlice as slice,
} from "../test/meta-slices-fixtures";

// Forces the documents/documentVersions rich-field pass to throw, as
// browser-backend.test.ts does for §620 (same cause in the wild: DOMPurify
// without a bound window). Delegates to the REAL implementation unless the
// flag is set, so every other test here runs the genuine pass.
const richFieldCtl = vi.hoisted(() => ({ throwing: false }));
vi.mock("./document-rich-fields", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./document-rich-fields")>();
  return {
    ...actual,
    sanitizeDocumentRichFields: (doc: Parameters<typeof actual.sanitizeDocumentRichFields>[0]) => {
      if (richFieldCtl.throwing) throw new TypeError("DOMPurify.sanitize is not a function");
      return actual.sanitizeDocumentRichFields(doc);
    },
  };
});

afterEach(() => {
  richFieldCtl.throwing = false;
});

const MARKERS: Record<BlobKey, string> = {
  fieldVisibility: CSV_SECTION_FIELD_VIS,
  features: CSV_SECTION_FUNCTIONS,
  steeringCommittee: CSV_SECTION_STEERING,
  timelogLinks: CSV_SECTION_TIMELOG_LINKS,
  knowledgeItems: CSV_SECTION_KNOWLEDGE_ITEMS,
  insights: CSV_SECTION_INSIGHTS,
  settingsOverrides: CSV_SECTION_SETTINGS_OVERRIDES,
  documents: CSV_SECTION_DOCUMENTS,
  documentVersions: CSV_SECTION_DOCUMENT_VERSIONS,
  activityLog: CSV_SECTION_ACTIVITY,
  budgetHistory: CSV_SECTION_BUDGET_HISTORY,
};

/** The shared eleven blob cases, each with its CSV section marker. */
const BLOB_CASES = META_BLOB_CASES.map((c) => ({ ...c, marker: MARKERS[c.key] }));

/** An empty workspace's CSV with one extra `marker` section holding `body`. */
function withSection(marker: string, body: string): string {
  return `${workspaceToCsv(emptyWorkspace())}\r\n\r\n${marker}\r\n${body}`;
}

const configRow = (json: string): string => `config,${csvCellEscape(json, false)}`;

const load = (text: string) => decodeWithDiag(csvToWorkspace, text);

describe("csvToWorkspace — a meta slice it could not keep is reported (§630)", () => {
  it.each(BLOB_CASES)("records $key when its JSON does not parse", ({ key, marker }) => {
    const { ws, failed, bare } = load(withSection(marker, configRow("{not json")));
    expect(failed).toEqual([key]);
    expect(slice(ws, key)).toBeUndefined();
    expect(slice(bare, key)).toBeUndefined();
  });

  it.each(BLOB_CASES)("records $key when it parses but sanitizes to nothing", ({ key, marker, junk }) => {
    const { ws, failed, bare } = load(withSection(marker, configRow(JSON.stringify(junk))));
    expect(failed).toEqual([key]);
    // features is assigned whenever it decodes (an explicit [] means Simple
    // mode), so a drop leaves [] — the same return as before §630.
    expect(slice(ws, key)).toEqual(key === "features" ? [] : undefined);
    expect(slice(bare, key)).toEqual(slice(ws, key));
  });

  it.each(BLOB_CASES)("stays silent for a stored empty $key", ({ key, marker, empty, emptyDecoded }) => {
    const { ws, failed, bare } = load(withSection(marker, configRow(JSON.stringify(empty))));
    expect(failed).toEqual([]);
    expect(slice(ws, key)).toEqual(emptyDecoded);
    expect(slice(bare, key)).toEqual(emptyDecoded);
  });

  // ★ A blank cell carries nothing (§617), so it is silent — not a parse
  // failure — and decodes to absent, as the old `JSON.parse("")` throw did.
  it.each(["config,", "config,   "])("stays silent for a blank insights cell %j", (row) => {
    const { ws, failed } = load(withSection(CSV_SECTION_INSIGHTS, row));
    expect(failed).toEqual([]);
    expect(ws.insights).toBeUndefined();
  });

  it("records status when every field is dropped by the sanitizer", () => {
    const { ws, failed, bare } = load(withSection(CSV_SECTION_STATUS, "field,value\r\nragOverride,X"));
    expect(failed).toEqual(["status"]);
    expect(ws.status).toEqual({});
    expect(bare.status).toEqual({});
  });

  it("records project when the sanitizer rejects the whole record", () => {
    const { ws, failed, bare } = load(
      withSection(CSV_SECTION_PROJECT, "field,value\r\nname,Proj\r\nnaceSection,ZZ"),
    );
    expect(failed).toEqual(["project"]);
    expect(ws.project).toBeUndefined();
    expect(bare.project).toBeUndefined();
  });

  it.each([
    ["status", CSV_SECTION_STATUS, "field,value\r\nnarrative,"],
    ["status", CSV_SECTION_STATUS, "field,value"],
    ["project", CSV_SECTION_PROJECT, "field,value\r\nname,"],
    ["project", CSV_SECTION_PROJECT, "field,value"],
  ])("stays silent for a blank %s section (%#)", (_key, marker, body) => {
    expect(load(withSection(marker, body)).failed).toEqual([]);
  });

  it("stays silent when no meta section is present", () => {
    expect(load(workspaceToCsv(emptyWorkspace())).failed).toEqual([]);
  });

  it("records nothing for genuine values of all thirteen slices, and decodes each as before", () => {
    const full = fullMetaWorkspace();
    const { ws, failed, bare } = load(workspaceToCsv(full));
    expect(failed).toEqual([]);
    for (const key of ALL_META_KEYS) {
      expect(slice(ws, key), key).toBeDefined();
      // ★ Against the SOURCE value, not only the no-diag decode: both of those
      // go through decodeMetaJson, so a helper that returned the raw parse
      // instead of the sanitized value would pass a with/without comparison.
      expect(slice(ws, key), key).toEqual(slice(full, key));
      expect(slice(bare, key), key).toEqual(slice(full, key));
    }
    expect(Object.keys(ws.status ?? {}).length).toBeGreaterThan(0);
  });

  it("records each broken slice once when several fail in one file", () => {
    const text = [
      withSection(CSV_SECTION_INSIGHTS, configRow("{not json")),
      `${CSV_SECTION_ACTIVITY}\r\n${configRow(JSON.stringify([{ nope: 1 }]))}`,
    ].join("\r\n\r\n");
    expect(load(text).failed.sort()).toEqual(["activityLog", "insights"]);
  });

  // ★ End to end through csvToWorkspace, not only decodeMetaJson's own unit
  // test: a throw in the DOM-dependent rich-field pass loses both document
  // slices, and each must be reported while every other slice still decodes.
  it("records documents and documentVersions when the rich-field pass throws", () => {
    // ★ The clock is pinned: both decodes below stamp `new Date()` at day
    // precision, so a run across midnight would otherwise compare two dates.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-06-15T12:00:00Z"));
    onTestFinished(() => {
      vi.useRealTimers();
    });
    const text = workspaceToCsv(fullMetaWorkspace());
    const reference = csvToWorkspace(text);
    expect(reference.documents?.length, "non-vacuity").toBeGreaterThan(0);
    expect(reference.documentVersions?.length, "non-vacuity").toBeGreaterThan(0);
    richFieldCtl.throwing = true;
    const { ws, failed, bare } = load(text);
    expect([...failed].sort()).toEqual(["documentVersions", "documents"]);
    expect(ws.documents).toBeUndefined();
    expect(ws.documentVersions).toBeUndefined();
    expect(bare.documents).toBeUndefined();
    // Everything else decodes exactly as it does without the throw.
    const withoutDocs = (w: typeof ws) => ({ ...w, documents: undefined, documentVersions: undefined });
    expect(withoutDocs(ws)).toEqual(withoutDocs(reference));
    expect(ws.tasks.length).toBeGreaterThan(0);
  });

  it("does not throw without a diag", () => {
    expect(() => csvToWorkspace(withSection(CSV_SECTION_INSIGHTS, configRow("{not json")))).not.toThrow();
    expect(() => csvToWorkspace(withSection(CSV_SECTION_STATUS, "field,value\r\nragOverride,X"))).not.toThrow();
  });
});
