// open-followups §545 — the exports half: the budget forecast as a derived
// export section, built from the dashboard model's forecast bundle.
import { beforeAll, describe, expect, it } from "vitest";
import { budgetForecastRows, exportForecastFor } from "./export-forecast-section";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildExportSections } from "./export-sections";
import { loadI18n } from "./i18n";
import {
  DATA_SECTION_KEYS,
  SLICE_EXPORT_SECTION_KEYS,
  EXPORT_SECTION_KEYS,
  defaultExportConfig,
  sanitizeExportConfig,
  type ExportConfig,
} from "./settings-types";
import { emptyWorkspace } from "./workspace";
import type { BudgetForecast } from "./budget-forecast";
import { FIXTURE_EUR_FORECAST, forecastBundleFixture } from "../test/forecast-bundle-fixture";

const EUR = FIXTURE_EUR_FORECAST;
const bundle = forecastBundleFixture;

const value = (rows: string[][], label: string) => rows.find((r) => r[0] === label)?.[1];

describe("budgetForecastRows (§545)", () => {
  it("is empty without a forecast, so the section is omitted", () => {
    expect(budgetForecastRows(null, "en-US")).toEqual([]);
    expect(budgetForecastRows(undefined, "en-US")).toEqual([]);
  });

  it("states the facts and both forecasts in euros, with the hours beside them", () => {
    const rows = budgetForecastRows(bundle(), "en-US");
    expect(value(rows, "Budget (BAC)")).toBe("€20,000 (200 h)");
    expect(value(rows, "Actuals (AC)")).toBe("€9,000 (90 h)");
    expect(value(rows, "Remaining")).toBe("€11,000 (110 h)");
    expect(value(rows, "EAC at current pace")).toBe("€21,000 (210 h)");
    expect(value(rows, "VAC at current pace")).toBe("-€1,000 (-5.0%)");
    expect(value(rows, "EAC at current efficiency")).toBe("€25,000 (250 h)");
    expect(value(rows, "VAC at current efficiency")).toBe("-€5,000 (-25.0%)");
  });

  it("signs a positive variance", () => {
    const eur = { ...EUR, pace: { ...(EUR.pace as Extract<BudgetForecast["pace"], { eac: number }>), eac: 18000, vac: 2000 } };
    expect(value(budgetForecastRows(bundle({ eur }), "en-US"), "VAC at current pace")).toBe("+€2,000 (+10.0%)");
  });

  it("states the gap between the two forecasts, the rate, and no fixed-price note by default", () => {
    const rows = budgetForecastRows(bundle(), "en-US");
    expect(value(rows, "Pace vs efficiency")).toContain("€4,000");
    expect(value(rows, "Pace vs efficiency")).toMatch(/^Warning:/);
    // extraWorkingDays is null in the fixture: no clause, and never "null working days".
    expect(value(rows, "Pace vs efficiency")).not.toContain("working days");
    expect(value(rows, "Avg rate booked")).toContain("€105/h");
    expect(value(rows, "Note")).toBeUndefined();
  });

  it("adds the fixed-price note when a bucket is fixed price", () => {
    const rows = budgetForecastRows(bundle({ eur: { ...EUR, hasFixedPrice: true } }), "en-US");
    expect(value(rows, "Note")).toMatch(/^Fixed price:/);
  });

  it("names why a forecast is unavailable instead of printing a number", () => {
    const eur: BudgetForecast = {
      ...EUR, gap: null,
      pace: { unavailable: "no-burn", windowStart: "2026-06-01", windowEnd: "2026-06-30", lastBookingDate: null },
      efficiency: { unavailable: "no-earned-value" },
    };
    const rows = budgetForecastRows(bundle({ eur, mix: null }), "en-US");
    expect(value(rows, "EAC at current pace")).toBe("No recent bookings");
    expect(value(rows, "EAC at current efficiency")).toBe("Nothing earned yet");
    expect(value(rows, "VAC at current pace")).toBeUndefined();
    expect(value(rows, "Pace vs efficiency")).toBeUndefined();
    expect(value(rows, "Avg rate booked")).toBeUndefined();
  });

  it("tells the two pace reasons apart", () => {
    const eur: BudgetForecast = { ...EUR, pace: { unavailable: "not-enough-bookings", firstBookingDate: null, bookedWorkingDays: 0, availableFrom: null } };
    expect(value(budgetForecastRows(bundle({ eur }), "en-US"), "EAC at current pace")).toBe("Not enough recent bookings");
  });

  describe("in German", () => {
    beforeAll(async () => { await loadI18n("de"); });
    it("labels the rows and the gap in German", () => {
      const rows = budgetForecastRows(bundle(), "de");
      expect(rows.map((r) => r[0])).toContain("Tempo gegenüber Effizienz");
      expect(rows.map((r) => r[0])).not.toContain("Pace vs efficiency");
    });
  });
});

describe("the budgetForecast export section (§545)", () => {
  const only = Object.fromEntries(EXPORT_SECTION_KEYS.map((k) => [k, k === "budgetForecast"])) as ExportConfig;

  it("is built from the extras, with the field/value header", () => {
    const [section] = buildExportSections(emptyWorkspace(), only, "en-US", { budgetForecast: bundle() });
    expect(section.key).toBe("budgetForecast");
    expect(section.title).toBe("Budget forecast");
    expect(section.columns).toHaveLength(2);
    expect(section.rows).toEqual(budgetForecastRows(bundle(), "en-US"));
  });

  it("is omitted without extras, with a null forecast, or when switched off", () => {
    expect(buildExportSections(emptyWorkspace(), only, "en-US")).toEqual([]);
    expect(buildExportSections(emptyWorkspace(), only, "en-US", { budgetForecast: null })).toEqual([]);
    const off = { ...only, budgetForecast: false };
    expect(buildExportSections(emptyWorkspace(), off, "en-US", { budgetForecast: bundle() })).toEqual([]);
  });

  it("is on by default, and a stored config from before it existed gets it switched on", () => {
    expect(defaultExportConfig.budgetForecast).toBe(true);
    expect(sanitizeExportConfig({ tasks: true, budgets: false }).budgetForecast).toBe(true);
    expect(sanitizeExportConfig({ budgetForecast: false }).budgetForecast).toBe(false);
  });

  // §545 documents half — the renderers take the same extras, so a document
  // block may name the derived section; it stays out of the slice list.
  it("can be named by a document dataSection block, but is no workspace slice", () => {
    expect(DATA_SECTION_KEYS as readonly string[]).toContain("budgetForecast");
    expect(DATA_SECTION_KEYS as readonly string[]).toContain("budgets");
    expect(SLICE_EXPORT_SECTION_KEYS as readonly string[]).not.toContain("budgetForecast");
  });
});

describe("exportForecastFor — the budget-module gate (§545)", () => {
  it("passes the bundle through with the budget module on", () => {
    const b = bundle();
    expect(exportForecastFor(["budget"], b)).toBe(b);
    expect(exportForecastFor(["budget"], undefined)).toBeNull();
  });

  it("withholds it with the budget module off, though the model still computed one", () => {
    expect(exportForecastFor([], bundle())).toBeNull();
  });

  // The gate only protects an export entry point that calls it. task-manager is
  // the one that holds the dashboard model; pin its call, and that the value it
  // gates is the one both its own handler and the header mounts receive.
  it("is what task-manager hands every export entry point", () => {
    const src = readFileSync(join(process.cwd(), "src", "app", "task-manager.tsx"), "utf8");
    expect(src).toContain("const exportForecast = exportForecastFor(settings.features, dashboardModel.forecastBundle);");
    expect(src).toContain("{ budgetForecast: exportForecast }");
    // The deps object passed to buildShellChrome carries `exportForecast` as a
    // SHORTHAND property, so it is the gated local itself (not `undefined`, and
    // not merely a value under some other key). Sliced to the call's own `});`
    // so braces inside earlier entries cannot cut it short; whitespace-tolerant.
    const start = src.indexOf("buildShellChrome({");
    expect(start).toBeGreaterThan(-1);
    const deps = src.slice(start, src.indexOf("});", start));
    expect(deps).toMatch(/[{,]\s*exportForecast\s*(?:,|$)/);
  });

  // §545 documents half — the same gated local rides `workspaceProps`, which
  // WorkspaceSection turns into ExportExtrasProvider for the document leaves.
  it("is what task-manager hands WorkspaceSection for the documents", () => {
    const src = readFileSync(join(process.cwd(), "src", "app", "task-manager.tsx"), "utf8");
    const start = src.indexOf("const workspaceProps = {");
    expect(start).toBeGreaterThan(-1);
    const props = src.slice(start, src.indexOf("};", start));
    expect(props).toMatch(/[{,]\s*exportForecast\s*(?:,|$)/m);
  });
});

describe("the gap row", () => {
  it("adds the extra-working-days clause the dashboard card shows", () => {
    const eur = { ...EUR, gap: { eacDifference: 4000, percentOfBac: 0.2, severity: "info" as const, extraWorkingDays: 7 } };
    const gap = value(budgetForecastRows(bundle({ eur }), "en-US"), "Pace vs efficiency");
    expect(gap).toMatch(/^The pace and efficiency forecasts differ by €4,000/);
    expect(gap).toContain("needs 7 working days beyond the planned end");
  });
});
