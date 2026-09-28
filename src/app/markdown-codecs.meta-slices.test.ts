// src/app/markdown-codecs.meta-slices.test.ts
//
// §630 — the Markdown half of §620, twin of csv-codecs.meta-slices.test.ts. A
// meta slice whose fenced JSON does not parse, or that parses but SANITIZES TO
// NOTHING, was dropped in silence by the Markdown decoders, and the next save
// rewrote the file without it. `markdownToWorkspace(text, diag)` now pushes the
// slice's key into `diag.decodeFailedSlices` — the same accumulator and the same
// 13 key names `jsonToWorkspace` uses.
//
// ★★ The §617 rule still holds: a stored `[]`, `{}` or blank value sanitizes to
//  nothing too, and must stay SILENT (each report pauses saving).
// ★ A heading whose ```json fence the decoder's regex cannot find still reads
//  as ABSENT, not as a failure — a known limitation noted at
//  `markdownToFieldVisibility`, and deliberately not pinned here.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { recordBudgetChange } from "./budget-history";
import type { ImportDiag } from "./csv-codecs";
import type { FeatureModuleId } from "./feature-modules";
import { markdownToWorkspace, workspaceToMarkdown } from "./markdown-codecs";
import { type Workspace, emptyWorkspace, jsonToWorkspace } from "./workspace";

type MetaKey =
  | "status" | "project" | "fieldVisibility" | "features" | "steeringCommittee"
  | "timelogLinks" | "knowledgeItems" | "insights" | "settingsOverrides"
  | "documents" | "documentVersions" | "activityLog" | "budgetHistory";

/** The eleven fenced-JSON slices: heading, one junk value that has content but
 *  sanitizes to nothing (the values workspace.test.ts's §620 table uses), and a
 *  genuinely empty stored value. */
const BLOB_CASES: readonly { key: MetaKey; heading: string; junk: unknown; empty: unknown }[] = [
  { key: "fieldVisibility", heading: "## Field Visibility", junk: { nope: "x" }, empty: {} },
  { key: "features", heading: "## Functions", junk: ["no-such-module"], empty: [] },
  { key: "steeringCommittee", heading: "## Steering Committee", junk: "not-an-object", empty: {} },
  { key: "timelogLinks", heading: "## Timelog Links", junk: ["junk"], empty: {} },
  { key: "knowledgeItems", heading: "## Knowledge Items", junk: [{ nope: 1 }], empty: [] },
  { key: "insights", heading: "## Insights", junk: [{ nope: 1 }], empty: [] },
  { key: "settingsOverrides", heading: "## Settings Overrides", junk: { unknownKey: 5 }, empty: {} },
  { key: "documents", heading: "## Documents", junk: [{ nope: 1 }], empty: [] },
  { key: "documentVersions", heading: "## Document versions", junk: [{ nope: 1 }], empty: [] },
  { key: "activityLog", heading: "## Activity Log", junk: [{ nope: 1 }], empty: [] },
  { key: "budgetHistory", heading: "## Budget History", junk: [{ nope: 1 }], empty: [] },
];

const ALL_KEYS: readonly MetaKey[] = ["status", "project", ...BLOB_CASES.map((c) => c.key)];

/** An empty workspace's Markdown with one extra section appended. */
function withSection(section: string): string {
  return `${workspaceToMarkdown(emptyWorkspace())}\n${section}`;
}

const fenced = (heading: string, json: string): string => [heading, "", "```json", json, "```", ""].join("\n");

function load(text: string): { ws: Workspace; failed: string[]; bare: Workspace } {
  const diag: ImportDiag = { droppedRows: 0 };
  const ws = markdownToWorkspace(text, diag);
  return { ws, failed: diag.decodeFailedSlices ?? [], bare: markdownToWorkspace(text) };
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

describe("markdownToWorkspace — a meta slice it could not keep is reported (§630)", () => {
  it.each(BLOB_CASES)("records $key when its JSON does not parse", ({ key, heading }) => {
    const { ws, failed, bare } = load(withSection(fenced(heading, "{not json")));
    expect(failed).toEqual([key]);
    expect(slice(ws, key)).toBeUndefined();
    expect(slice(bare, key)).toBeUndefined();
  });

  it.each(BLOB_CASES)("records $key when it parses but sanitizes to nothing", ({ key, heading, junk }) => {
    const { ws, failed, bare } = load(withSection(fenced(heading, JSON.stringify(junk))));
    expect(failed).toEqual([key]);
    // features is assigned whenever it decodes (an explicit [] means Simple
    // mode), so a drop leaves [] — the same return as before §630.
    expect(slice(ws, key)).toEqual(key === "features" ? [] : undefined);
    expect(slice(bare, key)).toEqual(slice(ws, key));
  });

  it.each(BLOB_CASES)("stays silent for a stored empty $key", ({ key, heading, empty }) => {
    const { ws, failed, bare } = load(withSection(fenced(heading, JSON.stringify(empty))));
    expect(failed).toEqual([]);
    expect(slice(bare, key)).toEqual(slice(ws, key));
  });

  it("records status when every field is dropped by the sanitizer", () => {
    const { ws, failed, bare } = load(withSection("## Project Status\n\n- ragOverride: X\n"));
    expect(failed).toEqual(["status"]);
    expect(ws.status).toEqual({});
    expect(bare.status).toEqual({});
  });

  it("records project when the sanitizer rejects the whole record", () => {
    const { ws, failed, bare } = load(withSection("## Project Meta\n\n- name: Proj\n- naceSection: ZZ\n"));
    expect(failed).toEqual(["project"]);
    expect(ws.project).toBeUndefined();
    expect(bare.project).toBeUndefined();
  });

  it.each([
    ["status", "## Project Status\n\n- narrative: \n"],
    ["project", "## Project Meta\n\n- name: \n"],
  ])("stays silent for a blank %s section", (_key, section) => {
    expect(load(withSection(section)).failed).toEqual([]);
  });

  it("stays silent when no meta section is present", () => {
    expect(load(workspaceToMarkdown(emptyWorkspace())).failed).toEqual([]);
  });

  it("records nothing for genuine values of all thirteen slices, and decodes each as before", () => {
    const { ws, failed, bare } = load(workspaceToMarkdown(fullWorkspace()));
    expect(failed).toEqual([]);
    for (const key of ALL_KEYS) {
      expect(slice(ws, key), key).toBeDefined();
      expect(slice(ws, key), key).toEqual(slice(bare, key));
    }
    expect(Object.keys(ws.status ?? {}).length).toBeGreaterThan(0);
  });

  it("records each broken slice once when several fail in one file", () => {
    const text = withSection(
      fenced("## Insights", "{not json") + "\n" + fenced("## Activity Log", JSON.stringify([{ nope: 1 }])),
    );
    expect(load(text).failed.sort()).toEqual(["activityLog", "insights"]);
  });

  it("does not throw without a diag", () => {
    expect(() => markdownToWorkspace(withSection(fenced("## Insights", "{not json")))).not.toThrow();
    expect(() => markdownToWorkspace(withSection("## Project Status\n\n- ragOverride: X\n"))).not.toThrow();
  });
});
