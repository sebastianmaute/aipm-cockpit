import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildExportWorkspace, EXPORT_WORKSPACE_KEYS, type ExportWorkspaceSlices } from "./export-workspace";
import { buildExportSections } from "./export-sections";
import { DERIVED_EXPORT_SECTION_KEYS, EXPORT_SECTION_KEYS, SLICE_EXPORT_SECTION_KEYS, type ExportConfig } from "./settings-types";
import { jsonToWorkspace } from "./workspace";

const SAMPLE = jsonToWorkspace(readFileSync(join(import.meta.dirname, "..", "..", "sample-workspace-small.json"), "utf8"));
// The whole workspace (documents, activity log and all) with its ten optional
// export slices named explicitly — a bare `Workspace` is not an
// `ExportWorkspaceSlices`, because those ten are optional on it.
const SLICES: ExportWorkspaceSlices = {
  ...SAMPLE,
  budgets: SAMPLE.budgets, fxRates: SAMPLE.fxRates, status: SAMPLE.status, project: SAMPLE.project,
  milestones: SAMPLE.milestones, changes: SAMPLE.changes, stakeholders: SAMPLE.stakeholders,
  calendarEvents: SAMPLE.calendarEvents, knowledgeItems: SAMPLE.knowledgeItems, insights: SAMPLE.insights,
};

describe("buildExportWorkspace (§463)", () => {
  // ★ DERIVED from the settings' own key list, so a future Settings → Export
  //  switch whose slice this builder forgets fails here instead of exporting
  //  nothing, silently, from both buttons.
  // §545 — a DERIVED section (computed from the dashboard model, not a slice)
  //  is the one exemption, and it must be declared: an undeclared key still
  //  fails the loop below, so the exemption cannot swallow a forgotten slice.
  it("carries a slice for every Settings → Export switch that is not derived", () => {
    for (const key of SLICE_EXPORT_SECTION_KEYS) expect(EXPORT_WORKSPACE_KEYS, key).toContain(key);
    expect([...SLICE_EXPORT_SECTION_KEYS, ...DERIVED_EXPORT_SECTION_KEYS].sort()).toEqual([...EXPORT_SECTION_KEYS].sort());
    for (const key of DERIVED_EXPORT_SECTION_KEYS) expect(EXPORT_WORKSPACE_KEYS as readonly string[], key).not.toContain(key);
  });

  it("feeds every section builder, one switch at a time", () => {
    const out = buildExportWorkspace(SLICES);
    for (const key of SLICE_EXPORT_SECTION_KEYS) {
      const only = Object.fromEntries(EXPORT_SECTION_KEYS.map((k) => [k, k === key])) as ExportConfig;
      expect(buildExportSections(out, only, "en-US").map((s) => s.key), key).toEqual([key]);
    }
  });

  it("returns only the export slices (no documents, activity log or settings overrides)", () => {
    expect(Object.keys(buildExportWorkspace(SLICES)).sort()).toEqual([...EXPORT_WORKSPACE_KEYS].sort());
  });

  // ★ The guard is the TYPE: a caller's literal that leaves a slice out must not
  //  compile, or that section silently vanishes from its export. If the
  //  parameter type ever loosens back to `Pick<Workspace, …>` (optional keys),
  //  the directive below is unused and `tsc --noEmit` fails.
  it("refuses, at compile time, a caller that leaves a slice out", () => {
    const { insights, ...withoutInsights } = SLICES;
    // @ts-expect-error — `insights` is missing; pass it as `undefined` instead.
    expect(buildExportWorkspace(withoutInsights).insights).toBeUndefined();
    expect(buildExportWorkspace({ ...withoutInsights, insights: undefined }).insights).toBeUndefined();
    expect(insights).toBeDefined();
  });
});
