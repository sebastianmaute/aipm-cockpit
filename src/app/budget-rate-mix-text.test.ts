import { describe, it, expect, beforeAll } from "vitest";
import { loadI18n, localeFor, t } from "./i18n";
import { formatCurrency } from "./resource-cost";
import { formatDayMonth, formatSignedPercent } from "./forecast-format";
import type { BudgetForecast } from "./budget-forecast";
import {
  rateMixExplanation, rateMixBannerText, rateMixChipText, rateMixChipName, rateMixTileChipText,
  rateMixWhyName, rateMixPoints, rateFactValue, rateFactTip, rateFactParts,
} from "./budget-rate-mix-text";
import {
  EUR_FORECAST, HOURS_FORECAST_HOURS_WORSE, HOURS_FORECAST_EUR_WORSE, MIX_HOURS_WORSE, MIX_EUR_WORSE, MIX_ON_PLAN,
} from "../test/forecast-fixtures";

const en = "en-US" as const;
const loc = localeFor(en);
const money = (n: number) => formatCurrency(n, "EUR", loc);
const pct1 = (r: number) => formatSignedPercent(r, loc, 1);

beforeAll(async () => { await loadI18n("de"); });

describe("rateMixExplanation / rateMixBannerText — hours worse", () => {
  const hoursVac = -209 / 2_000;
  const eurVac = -21_150 / 240_000;
  const explanation =
    `Consultant Junior: 37% of the booked hours (planned 30%), so hours cost ${money(168_000 / 1_450)}/h on average instead of ${money(120)}/h. ` +
    `At current pace the hours show ${pct1(hoursVac)}; the budget shows ${pct1(eurVac)}.`;

  it("names the driver, the two rates and both pace VACs", () => {
    expect(rateMixExplanation(en, MIX_HOURS_WORSE, EUR_FORECAST, HOURS_FORECAST_HOURS_WORSE)).toBe(explanation);
  });
  it("leads the banner with Warning: and the hours-worse head", () => {
    expect(rateMixBannerText(en, MIX_HOURS_WORSE, EUR_FORECAST, HOURS_FORECAST_HOURS_WORSE))
      .toBe(`Warning: the hours tell a worse story than the budget. ${explanation}`);
  });
});

describe("€ worse, no driver, on plan", () => {
  it("leads with Note: and the rate-not-hours sentence", () => {
    const text = rateMixBannerText(en, MIX_EUR_WORSE, EUR_FORECAST, HOURS_FORECAST_EUR_WORSE);
    expect(text.startsWith("Note: the budget tells a worse story than the hours. Consultant Senior: 37% of the booked hours (planned 30%),")).toBe(true);
    expect(text.endsWith("The difference is in rate, not in hours.")).toBe(true);
  });
  it("drops the driver clause when there is no driver", () => {
    expect(rateMixExplanation(en, MIX_ON_PLAN, EUR_FORECAST, HOURS_FORECAST_HOURS_WORSE).startsWith("Hours cost ")).toBe(true);
  });
});

describe("chips, names, points, rate fact", () => {
  it("chip text and card-unique names", () => {
    expect(rateMixChipText(en, MIX_HOURS_WORSE)).toBe("Effort worse than €");
    expect(rateMixChipText(en, MIX_EUR_WORSE)).toBe("€ worse than effort");
    expect(rateMixChipName(en, MIX_HOURS_WORSE, "pace")).toBe("Effort worse than € at current pace — why?");
    expect(rateMixChipName(en, MIX_HOURS_WORSE, "efficiency")).toBe("Effort worse than € at current efficiency — why?");
  });
  it("tile chip text in both directions", () => {
    const hoursPace = HOURS_FORECAST_HOURS_WORSE.pace;
    if (!("runOutDate" in hoursPace) || hoursPace.runOutDate === null) throw new Error("fixture");
    expect(rateMixTileChipText(en, MIX_HOURS_WORSE, HOURS_FORECAST_HOURS_WORSE))
      .toBe(`Hours ${formatSignedPercent(-209 / 2_000, loc, 0)} · runs out ${formatDayMonth(hoursPace.runOutDate, loc)}`);
    expect(rateMixTileChipText(en, MIX_EUR_WORSE, HOURS_FORECAST_EUR_WORSE).startsWith("Hours only ")).toBe(true);
    expect(rateMixWhyName(en, "Hours −10%")).toBe("Hours −10% — why?");
  });
  it("points carry a sign and round to whole points", () => {
    expect(rateMixPoints(en, 0.0717)).toBe("+7 pts");
    expect(rateMixPoints(en, -0.0662)).toBe("−7 pts");
    expect(rateMixPoints(en, 0.004)).toBe("0 pts");
  });
  it("rate fact: drift above the threshold, on plan below it", () => {
    expect(rateFactValue(en, MIX_HOURS_WORSE)).toBe(`${money(168_000 / 1_450)}/h ${pct1(MIX_HOURS_WORSE.drift)} vs plan`);
    expect(rateFactValue(en, MIX_ON_PLAN)).toBe(`${money(120)}/h · on plan`);
    expect(rateFactTip(en, MIX_HOURS_WORSE)).toContain(`${money(240_000)} ÷ 2,000 h = ${money(120)}/h`);
  });
  it("rate fact parts: down-arrow for a hours-worse drift", () => {
    const parts = rateFactParts(en, MIX_HOURS_WORSE);
    expect(parts.rate).toBe(`${money(168_000 / 1_450)}/h`);
    expect(parts.note).toBe(`${pct1(MIX_HOURS_WORSE.drift)} vs plan`);
    expect(parts.arrow).toBe("▼");
  });
  it("rate fact parts: up-arrow for an eur-worse drift", () => {
    const parts = rateFactParts(en, MIX_EUR_WORSE);
    expect(parts.rate).toBe(`${money(168_000 / 1_350)}/h`);
    expect(parts.note).toBe(`${pct1(MIX_EUR_WORSE.drift)} vs plan`);
    expect(parts.arrow).toBe("▲");
  });
  it("rate fact parts: no arrow when the drift is below the signal threshold", () => {
    const parts = rateFactParts(en, MIX_ON_PLAN);
    expect(parts.rate).toBe(`${money(120)}/h`);
    expect(parts.note).toBe("on plan");
    expect(parts.arrow).toBe(null);
  });
});

describe("pace unavailable — paceVacRatio's null branch", () => {
  // HOURS_FORECAST_HOURS_WORSE with its pace forecast swapped for an
  // "unavailable" one: covers paceVacRatio's isPaceAvailable-false path
  // (used by both rateMixExplanation and rateMixTileChipText) and the
  // no-run-out fallback in rateMixTileChipText — a real, reachable state
  // (a project with too few recent bookings), not a provably-unreachable
  // guard, so it is tested rather than removed (ruling P16).
  const HOURS_FORECAST_PACE_UNAVAILABLE: BudgetForecast = {
    ...HOURS_FORECAST_HOURS_WORSE,
    pace: { unavailable: "no-burn", windowStart: "2026-08-17", windowEnd: "2026-09-14", lastBookingDate: null },
  };

  it("drops the pace sentence when one forecast's pace is unavailable", () => {
    const text = rateMixExplanation(en, MIX_HOURS_WORSE, EUR_FORECAST, HOURS_FORECAST_PACE_UNAVAILABLE);
    expect(text).not.toContain("At current pace");
    expect(text.startsWith("Consultant Junior:")).toBe(true);
  });
  it("falls back to the no-run-out tile text when pace is unavailable", () => {
    expect(rateMixTileChipText(en, MIX_HOURS_WORSE, HOURS_FORECAST_PACE_UNAVAILABLE))
      .toBe(t(en, "forecastMixTileHoursWorseNoRunOut", formatSignedPercent(0, loc, 0)));
  });
});

describe("German", () => {
  it("renders the banner head and chip name from the DE dictionary", () => {
    expect(rateMixBannerText("de", MIX_HOURS_WORSE, EUR_FORECAST, HOURS_FORECAST_HOURS_WORSE).startsWith(`${t("de", "forecastMixLeadWarning")} ${t("de", "forecastMixHeadHoursWorse")}`)).toBe(true);
    expect(rateMixChipName("de", MIX_HOURS_WORSE, "pace")).toBe("Aufwand schlechter als € beim aktuellen Tempo – warum?");
  });
  it("rate fact parts render the DE note and drift arrow", () => {
    const parts = rateFactParts("de", MIX_HOURS_WORSE);
    const expectedNote = t("de", "forecastRateDrift", formatSignedPercent(MIX_HOURS_WORSE.drift, localeFor("de"), 1));
    expect(parts.note).toBe(expectedNote);
    expect(parts.arrow).toBe("▼");
  });
});
