import { beforeAll, describe, expect, it } from "vitest";
import { loadI18n, t } from "./i18n";
import { formatShare } from "./forecast-format";
import { costRangeRows, costUnavailableText, formatChanceOverBudget } from "./budget-sim-text";
import { simulateCostAtFinish, type CostAtFinish } from "./forecast/cost";

type Sim = Extract<CostAtFinish, { kind: "sim" }>;

const sim = (chanceOverBudget: number | null): Sim => ({
  kind: "sim", p50: 100, p80: 120, p95: "beyond", chanceOverBudget, spendDays: 20,
});

describe("formatChanceOverBudget (§502)", () => {
  beforeAll(async () => {
    await loadI18n("de");
  });

  it("reads <1 % for a chance above 0 that rounds to 0 %, and keeps an exact 0 as 0 %", () => {
    expect(formatChanceOverBudget(0.001, "en-US")).toBe(`<${formatShare(0.01, "en-US")}`);
    expect(formatChanceOverBudget(0.0049, "en-US")).toBe("<1%");
    expect(formatChanceOverBudget(0, "en-US")).toBe("0%");
    // 0.005 rounds to 1 % on its own, so it is not marked.
    expect(formatChanceOverBudget(0.005, "en-US")).toBe("1%");
  });

  it("reads >99 % for a chance below 1 that rounds to 100 %, and keeps an exact 1 as 100 %", () => {
    expect(formatChanceOverBudget(0.995, "en-US")).toBe(">99%");
    expect(formatChanceOverBudget(0.9999, "en-US")).toBe(">99%");
    expect(formatChanceOverBudget(1, "en-US")).toBe("100%");
    expect(formatChanceOverBudget(0.994, "en-US")).toBe("99%");
  });

  it("formats the number part with the locale's own percent format", () => {
    expect(formatChanceOverBudget(0.001, "de-DE")).toBe(`<${formatShare(0.01, "de-DE")}`);
    expect(formatChanceOverBudget(0.999, "de-DE")).toBe(`>${formatShare(0.99, "de-DE")}`);
    expect(formatChanceOverBudget(0.999, "de-DE")).not.toBe(formatChanceOverBudget(0.999, "en-US"));
  });
});

describe("costRangeRows (§502)", () => {
  beforeAll(async () => {
    await loadI18n("de");
  });

  it("labels the rows with the shared percentile words plus (Pxx), in both languages", () => {
    const figure = (v: number) => `${v}`;
    expect(costRangeRows("en-US", sim(null), figure).map(([term]) => term)).toEqual([
      "Even odds (P50)", "Safe to commit (P80)", "Cautious (P95)",
    ]);
    expect(costRangeRows("de", sim(null), figure).map(([term]) => term)).toEqual([
      "Gleiche Chancen (P50)", "Sicher zusagbar (P80)", "Vorsichtig (P95)",
    ]);
  });

  it("shows the chance row through the rounding-aware formatter", () => {
    const rows = costRangeRows("en-US", sim(0.002), (v) => `${v}`);
    expect(rows.at(-1)).toEqual([t("en-US", "budgetSimChanceOver"), "<1%"]);
  });

  // §502 M4 — the zero-budget rule every surface shares: the engine gives no chance at bac <= 0, so the
  // shared rows keep the range and drop only the chance row.
  it("keeps the range and drops the chance row at a budget of 0", () => {
    const run = (bac: number) => simulateCostAtFinish({
      trialDays: Int32Array.from({ length: 50 }, (_, i) => 5 + (i % 10)), samples: Array.from({ length: 20 }, (_, i) => 100 + i * 10),
      ac: 1_000, bac, seedTag: "eur", horizon: 1_300,
    });
    const zero = run(0);
    if (zero.kind !== "sim") throw new Error("expected a simulated range");
    expect(costRangeRows("en-US", zero, (v) => `${v}`).map(([term]) => term)).toEqual([
      "Even odds (P50)", "Safe to commit (P80)", "Cautious (P95)",
    ]);
    // Positive control: with a budget the same run carries the chance row.
    const budgeted = run(2_000);
    if (budgeted.kind !== "sim") throw new Error("expected a simulated range");
    expect(costRangeRows("en-US", budgeted, (v) => `${v}`).at(-1)?.[0]).toBe(t("en-US", "budgetSimChanceOver"));
  });
});

describe("costUnavailableText (§502)", () => {
  it("words the no-spend state without a 'yet': it only occurs after earlier bookings", () => {
    const text = costUnavailableText("en-US", { kind: "unavailable", reason: "no-spend", spendDays: 20, neededSpendDays: 10 });
    expect(text).toBe("No bookings in the history window.");
  });
});
