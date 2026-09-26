import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildExportWorkspace, EXPORT_WORKSPACE_KEYS } from "./export-workspace";
import { buildExportSections } from "./export-sections";
import { EXPORT_SECTION_KEYS, type ExportConfig } from "./settings-types";
import { jsonToWorkspace } from "./workspace";

const SAMPLE = jsonToWorkspace(readFileSync(join(import.meta.dirname, "..", "..", "sample-workspace-small.json"), "utf8"));

describe("buildExportWorkspace (§463)", () => {
  // ★ DERIVED from the settings' own key list, so a future Settings → Export
  //  switch whose slice this builder forgets fails here instead of exporting
  //  nothing, silently, from both buttons.
  it("carries a slice for every Settings → Export switch", () => {
    for (const key of EXPORT_SECTION_KEYS) expect(EXPORT_WORKSPACE_KEYS, key).toContain(key);
  });

  it("feeds every section builder, one switch at a time", () => {
    const out = buildExportWorkspace(SAMPLE);
    for (const key of EXPORT_SECTION_KEYS) {
      const only = Object.fromEntries(EXPORT_SECTION_KEYS.map((k) => [k, k === key])) as ExportConfig;
      expect(buildExportSections(out, only, "en-US").map((s) => s.key), key).toEqual([key]);
    }
  });

  it("returns only the export slices (no documents, activity log or settings overrides)", () => {
    expect(Object.keys(buildExportWorkspace(SAMPLE)).sort()).toEqual([...EXPORT_WORKSPACE_KEYS].sort());
  });
});
