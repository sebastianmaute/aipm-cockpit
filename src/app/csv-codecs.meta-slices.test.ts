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
//  in the encoder's own `<marker>\r\nconfig,<cell>` shape.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { recordBudgetChange } from "./budget-history";
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
  type ImportDiag,
  csvCellEscape,
  csvToWorkspace,
  workspaceToCsv,
} from "./csv-codecs";
import type { FeatureModuleId } from "./feature-modules";
import { type Workspace, emptyWorkspace, jsonToWorkspace } from "./workspace";

type MetaKey =
  | "status" | "project" | "fieldVisibility" | "features" | "steeringCommittee"
  | "timelogLinks" | "knowledgeItems" | "insights" | "settingsOverrides"
  | "documents" | "documentVersions" | "activityLog" | "budgetHistory";

/** The eleven single-JSON-blob slices: marker, one junk value that has content
 *  but sanitizes to nothing (the values workspace.test.ts's §620 table uses),
 *  and a genuinely empty stored value, with what it decodes
 *  to — unchanged from before §630 (features keeps `[]`, Simple mode; the
 *  committee and timelog sanitizers build fixed-key objects; everything else
 *  is absent). */
const BLOB_CASES: readonly { key: MetaKey; marker: string; junk: unknown; empty: unknown; emptyDecoded: unknown }[] = [
  { key: "fieldVisibility", marker: CSV_SECTION_FIELD_VIS, junk: { nope: "x" }, empty: {}, emptyDecoded: undefined },
  { key: "features", marker: CSV_SECTION_FUNCTIONS, junk: ["no-such-module"], empty: [], emptyDecoded: [] },
  { key: "steeringCommittee", marker: CSV_SECTION_STEERING, junk: "not-an-object", empty: {}, emptyDecoded: { name: "", memberResourceIds: [], meetings: [], infoSchedules: [] } },
  { key: "timelogLinks", marker: CSV_SECTION_TIMELOG_LINKS, junk: ["junk"], empty: {}, emptyDecoded: { userLinks: [], projectLinks: [] } },
  { key: "knowledgeItems", marker: CSV_SECTION_KNOWLEDGE_ITEMS, junk: [{ nope: 1 }], empty: [], emptyDecoded: undefined },
  { key: "insights", marker: CSV_SECTION_INSIGHTS, junk: [{ nope: 1 }], empty: [], emptyDecoded: undefined },
  { key: "settingsOverrides", marker: CSV_SECTION_SETTINGS_OVERRIDES, junk: { unknownKey: 5 }, empty: {}, emptyDecoded: undefined },
  { key: "documents", marker: CSV_SECTION_DOCUMENTS, junk: [{ nope: 1 }], empty: [], emptyDecoded: undefined },
  { key: "documentVersions", marker: CSV_SECTION_DOCUMENT_VERSIONS, junk: [{ nope: 1 }], empty: [], emptyDecoded: undefined },
  { key: "activityLog", marker: CSV_SECTION_ACTIVITY, junk: [{ nope: 1 }], empty: [], emptyDecoded: undefined },
  { key: "budgetHistory", marker: CSV_SECTION_BUDGET_HISTORY, junk: [{ nope: 1 }], empty: [], emptyDecoded: undefined },
];

const ALL_KEYS: readonly MetaKey[] = ["status", "project", ...BLOB_CASES.map((c) => c.key)];

/** An empty workspace's CSV with one extra `marker` section holding `body`. */
function withSection(marker: string, body: string): string {
  return `${workspaceToCsv(emptyWorkspace())}\r\n\r\n${marker}\r\n${body}`;
}

const configRow = (json: string): string => `config,${csvCellEscape(json, false)}`;

function load(text: string): { ws: Workspace; failed: string[]; bare: Workspace } {
  const diag: ImportDiag = { droppedRows: 0 };
  const ws = csvToWorkspace(text, diag);
  return { ws, failed: diag.decodeFailedSlices ?? [], bare: csvToWorkspace(text) };
}

const slice = (ws: Workspace, key: MetaKey): unknown => (ws as unknown as Record<string, unknown>)[key];

function budgetHistoryFixture(): Workspace["budgetHistory"] {
  let n = 0;
  return recordBudgetChange([], {
    kind: "updated", bucketId: 1, bucketName: "Build",
    before: { hours: 100, value: 10000 }, after: { hours: 120, value: 12000 },
    at: "2026-09-01T10:00:00.000Z", date: "2026-09-01", newId: () => `bh-${++n}`,
  });
}

/** The curated sample carries nine of the thirteen slices; the other four are
 *  added here so every key has a GENUINE, non-empty value. */
function fullWorkspace(): Workspace {
  const sample = jsonToWorkspace(
    readFileSync(join(import.meta.dirname, "..", "..", "sample-workspace-small.json"), "utf8"),
  );
  return {
    ...sample,
    fieldVisibility: { task: { fields: ["taskName"] } },
    features: ["raid"] as FeatureModuleId[],
    settingsOverrides: { timezone: { timezone: "Europe/Berlin" } },
    budgetHistory: budgetHistoryFixture(),
  };
}

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
    const full = fullWorkspace();
    const { ws, failed, bare } = load(workspaceToCsv(full));
    expect(failed).toEqual([]);
    for (const key of ALL_KEYS) {
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

  it("does not throw without a diag", () => {
    expect(() => csvToWorkspace(withSection(CSV_SECTION_INSIGHTS, configRow("{not json")))).not.toThrow();
    expect(() => csvToWorkspace(withSection(CSV_SECTION_STATUS, "field,value\r\nragOverride,X"))).not.toThrow();
  });
});
