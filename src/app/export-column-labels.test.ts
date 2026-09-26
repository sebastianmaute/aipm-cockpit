import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildExportSections, EXPORT_SECTION_FIELDS } from "./export-sections";
import { EXPORT_COLUMN_LABEL_KEYS, EXPORT_SECTION_TITLE_KEYS, STATUS_ROW_LABEL_KEYS } from "./export-column-labels";
import { EXPORT_SECTION_KEYS, type ExportConfig } from "./settings-types";
import { STATUS_FIELDS } from "./storage";
import { jsonToWorkspace } from "./workspace";
import { buildXlsx } from "./export-ooxml";
import { loadI18n, t } from "./i18n";
import { partText, unzipBytes } from "../test/unzip-bytes";

const ALL_ON = Object.fromEntries(EXPORT_SECTION_KEYS.map((k) => [k, true])) as ExportConfig;
const SAMPLE = jsonToWorkspace(readFileSync(join(import.meta.dirname, "..", "..", "sample-workspace-small.json"), "utf8"));

beforeAll(async () => { await loadI18n("de"); });

describe.each(["en-US", "de"] as const)("export headers are display labels (§304, %s)", (lang) => {
  const sections = () => buildExportSections(SAMPLE, ALL_ON, lang);

  // Anti-vacuity: every section is built, so every assertion below runs on all fifteen.
  it("builds every section from the sample workspace", () => {
    expect(sections().map((s) => s.key)).toEqual([...EXPORT_SECTION_KEYS]);
  });

  it("labels every header through its section's label map, never the raw key", () => {
    for (const s of sections()) {
      const fields = EXPORT_SECTION_FIELDS[s.key];
      expect(s.columns, s.key).toHaveLength(fields.length);
      fields.forEach((field, i) => {
        const key = EXPORT_COLUMN_LABEL_KEYS[s.key][field];
        expect(key, `${s.key}.${field} has no label key`).toBeDefined();
        expect(s.columns[i], `${s.key}.${field}`).toBe(t(lang, key));
        expect(s.columns[i], `${s.key}.${field}`).not.toBe(field);
      });
    }
  });

  it("keeps every header distinct within its section", () => {
    for (const s of sections()) expect(new Set(s.columns).size, s.key).toBe(s.columns.length);
  });

  it("translates every section title", () => {
    for (const s of sections()) expect(s.title, s.key).toBe(t(lang, EXPORT_SECTION_TITLE_KEYS[s.key]));
  });

  it("labels the status section's rows, not just its header", () => {
    const status = sections().find((s) => s.key === "status")!;
    const rowLabels = status.rows.map((r) => r[0]);
    expect(rowLabels.length).toBeGreaterThan(0);
    for (const f of STATUS_FIELDS) expect(rowLabels, f).not.toContain(f);
    expect(rowLabels).toContain(t(lang, STATUS_ROW_LABEL_KEYS.ragOverride));
  });

  // Review Focus 3 — "Roles & rates" is the first sheet name with an ampersand.
  it("keeps the workbook well-formed with the translated sheet names", async () => {
    const wb = partText(await unzipBytes(buildXlsx(sections())), "xl/workbook.xml");
    const doc = new DOMParser().parseFromString(wb, "application/xml");
    expect(doc.getElementsByTagName("parsererror")).toHaveLength(0);
    const names = [...doc.getElementsByTagName("sheet")].map((n) => n.getAttribute("name"));
    expect(names).toContain(t(lang, "exportLabelRoles"));
  });
});
