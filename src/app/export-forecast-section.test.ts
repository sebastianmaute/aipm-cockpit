// open-followups §545 — the exports half: the budget forecast as a derived
// export section, built from the dashboard model's forecast bundle.
import { beforeAll, describe, expect, it } from "vitest";
import { budgetForecastRows } from "./export-forecast-section";
import { buildExportSections } from "./export-sections";
import { loadI18n } from "./i18n";
import {
  DATA_SECTION_KEYS,
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

  it("cannot be named by a document dataSection block, whose renderers have no forecast", () => {
    expect(DATA_SECTION_KEYS as readonly string[]).not.toContain("budgetForecast");
    expect(DATA_SECTION_KEYS as readonly string[]).toContain("budgets");
  });
});
