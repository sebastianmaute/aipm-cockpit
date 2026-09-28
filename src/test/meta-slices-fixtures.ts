// Shared fixtures for the §630 meta-slice report tests —
// csv-codecs.meta-slices.test.ts and markdown-codecs.meta-slices.test.ts run
// the same table against the two text codecs, so the per-slice values, the
// full workspace and the decode-with-diag helper live here once. Each test
// file adds only its own section marker (CSV) or heading (Markdown).

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { recordBudgetChange } from "../app/budget-history";
import type { ImportDiag } from "../app/csv-codecs";
import type { FeatureModuleId } from "../app/feature-modules";
import { type Workspace, jsonToWorkspace } from "../app/workspace";

export type MetaKey =
  | "status" | "project" | "fieldVisibility" | "features" | "steeringCommittee"
  | "timelogLinks" | "knowledgeItems" | "insights" | "settingsOverrides"
  | "documents" | "documentVersions" | "activityLog" | "budgetHistory";

/** The eleven single-JSON-blob slices (everything but status and project). */
export type BlobKey = Exclude<MetaKey, "status" | "project">;

export interface BlobCase { key: BlobKey; junk: unknown; empty: unknown; emptyDecoded: unknown }

/** The eleven single-JSON-blob slices: one junk value that has content but
 *  sanitizes to nothing (the values workspace.test.ts's §620 table uses), and
 *  a genuinely empty stored value, with what it decodes to — unchanged from
 *  before §630 (features keeps `[]`, Simple mode; the committee and timelog
 *  sanitizers build fixed-key objects; everything else is absent). */
export const META_BLOB_CASES: readonly BlobCase[] = [
  { key: "fieldVisibility", junk: { nope: "x" }, empty: {}, emptyDecoded: undefined },
  { key: "features", junk: ["no-such-module"], empty: [], emptyDecoded: [] },
  { key: "steeringCommittee", junk: "not-an-object", empty: {}, emptyDecoded: { name: "", memberResourceIds: [], meetings: [], infoSchedules: [] } },
  { key: "timelogLinks", junk: ["junk"], empty: {}, emptyDecoded: { userLinks: [], projectLinks: [] } },
  { key: "knowledgeItems", junk: [{ nope: 1 }], empty: [], emptyDecoded: undefined },
  { key: "insights", junk: [{ nope: 1 }], empty: [], emptyDecoded: undefined },
  { key: "settingsOverrides", junk: { unknownKey: 5 }, empty: {}, emptyDecoded: undefined },
  { key: "documents", junk: [{ nope: 1 }], empty: [], emptyDecoded: undefined },
  { key: "documentVersions", junk: [{ nope: 1 }], empty: [], emptyDecoded: undefined },
  { key: "activityLog", junk: [{ nope: 1 }], empty: [], emptyDecoded: undefined },
  { key: "budgetHistory", junk: [{ nope: 1 }], empty: [], emptyDecoded: undefined },
];

export const ALL_META_KEYS: readonly MetaKey[] = ["status", "project", ...META_BLOB_CASES.map((c) => c.key)];

/** Decode `text` twice — with a fresh diag and without one — and return both
 *  workspaces plus what the diag recorded. */
export function decodeWithDiag(
  decode: (text: string, diag?: ImportDiag) => Workspace,
  text: string,
): { ws: Workspace; failed: string[]; bare: Workspace } {
  const diag: ImportDiag = { droppedRows: 0 };
  const ws = decode(text, diag);
  return { ws, failed: diag.decodeFailedSlices ?? [], bare: decode(text) };
}

export const metaSlice = (ws: Workspace, key: MetaKey): unknown => (ws as unknown as Record<string, unknown>)[key];

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
export function fullMetaWorkspace(): Workspace {
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
