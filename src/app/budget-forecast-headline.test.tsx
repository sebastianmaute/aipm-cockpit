import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { forecastHeadlineText, ForecastHeadline } from "./budget-forecast-headline";
import { formatMoneyCompact, formatSignedPercent, formatDayMonth } from "./forecast-format";
import { localeFor, t } from "./i18n";
import type { BudgetForecast } from "./budget-forecast";

const locale = localeFor("en-US");

// §5.6 worked example: BAC €240,000; pace EAC €261,150 (VAC −€21,150,
// −8.8%->−9%); efficiency EAC €270,968 (VAC −€30,968, −12.9%->−13%);
// run-out 2026-11-27.
const BASE_FACTS = { bac: 240000, ac: 168000, remaining: 72000, ev: 148800, percentComplete: 62 };
const PACE: BudgetForecast["pace"] = {
  burnRatePerDay: 1350, windowDays: 20, windowStart: "2026-08-17", windowEnd: "2026-09-11",
  spreadPeriodHoursUsed: false, workingDaysLeft: 69,
  etc: 93150, eac: 261150, vac: -21150, runOutDate: "2026-11-27", daysBeforePlannedEnd: 21,
};
const EFFICIENCY: BudgetForecast["efficiency"] = {
  pv: 176000, cpi: 0.885714, spi: 0.845455, etc: 102968, eac: 270968, vac: -30968,
};

function forecastWith(
  pace: BudgetForecast["pace"],
  efficiency: BudgetForecast["efficiency"] = { unavailable: "no-actual-cost" },
): BudgetForecast {
  return { facts: BASE_FACTS, pace, efficiency, gap: null, hasFixedPrice: false };
}

describe("forecastHeadlineText", () => {
  it("both pace and efficiency available: EAC range, VAC pair, run-out", () => {
    const forecast = forecastWith(PACE, EFFICIENCY);
    const expected = [
      t(
        "en-US", "forecastTileRange",
        formatMoneyCompact(PACE.eac, locale), formatMoneyCompact(EFFICIENCY.eac, locale),
        formatSignedPercent(PACE.vac / BASE_FACTS.bac, locale, 0),
        formatSignedPercent(EFFICIENCY.vac / BASE_FACTS.bac, locale, 0),
      ),
      t("en-US", "forecastTileRunsOut", formatDayMonth(PACE.runOutDate!, locale)),
    ].join(" · ");
    expect(forecastHeadlineText(forecast, "en-US")).toBe(expected);
  });

  // Finding: the §6.3 example headline written before the formatter/text
  // landed — pin one fully literal string so a placeholder-order mistake
  // (e.g. swapping the VAC pair, or the EAC/VAC join order) is caught even if
  // a future edit to `t()` or the key text stays self-consistent.
  it("renders the exact EN headline for the §5.6 fixture", () => {
    const forecast = forecastWith(PACE, EFFICIENCY);
    expect(forecastHeadlineText(forecast, "en-US")).toBe(
      "EAC €261K–€271K · VAC -9% to -13% · runs out Nov 27",
    );
  });

  it("orders the EAC/VAC pair ascending even when efficiency's EAC is lower", () => {
    const lowerEfficiency: BudgetForecast["efficiency"] = { ...EFFICIENCY, eac: 200000, vac: 40000 };
    const forecast = forecastWith(PACE, lowerEfficiency);
    const expected = [
      t(
        "en-US", "forecastTileRange",
        formatMoneyCompact(lowerEfficiency.eac, locale), formatMoneyCompact(PACE.eac, locale),
        formatSignedPercent(lowerEfficiency.vac / BASE_FACTS.bac, locale, 0),
        formatSignedPercent(PACE.vac / BASE_FACTS.bac, locale, 0),
      ),
      t("en-US", "forecastTileRunsOut", formatDayMonth(PACE.runOutDate!, locale)),
    ].join(" · ");
    expect(forecastHeadlineText(forecast, "en-US")).toBe(expected);
  });

  it("efficiency unavailable: pace EAC/VAC alone, still with run-out", () => {
    const forecast = forecastWith(PACE, { unavailable: "needs-percent-complete", bucketsMissingPercent: [{ id: 1, name: "Design" }] });
    const expected = [
      t("en-US", "forecastTileSingle", formatMoneyCompact(PACE.eac, locale), formatSignedPercent(PACE.vac / BASE_FACTS.bac, locale, 0)),
      t("en-US", "forecastTileRunsOut", formatDayMonth(PACE.runOutDate!, locale)),
    ].join(" · ");
    expect(forecastHeadlineText(forecast, "en-US")).toBe(expected);
    expect(forecastHeadlineText(forecast, "en-US")).toBe("EAC €261K · VAC -9% · runs out Nov 27");
  });

  it("pace unavailable: Actuals of BAC, no run-out", () => {
    const forecast = forecastWith({ unavailable: "not-enough-bookings", firstBookingDate: null, bookedWorkingDays: 0, availableFrom: null }, EFFICIENCY);
    expect(forecastHeadlineText(forecast, "en-US")).toBe(
      t("en-US", "forecastTileActuals", formatMoneyCompact(BASE_FACTS.ac, locale), formatMoneyCompact(BASE_FACTS.bac, locale)),
    );
    expect(forecastHeadlineText(forecast, "en-US")).toBe("Actuals €168K of €240K");
  });

  it("zero BAC reads 0% VAC (bac > 0 guard, M3)", () => {
    const forecast: BudgetForecast = { facts: { ...BASE_FACTS, bac: 0 }, pace: PACE, efficiency: { unavailable: "no-actual-cost" }, gap: null, hasFixedPrice: false };
    const expected = [
      t("en-US", "forecastTileSingle", formatMoneyCompact(PACE.eac, locale), formatSignedPercent(0, locale, 0)),
      t("en-US", "forecastTileRunsOut", formatDayMonth(PACE.runOutDate!, locale)),
    ].join(" · ");
    expect(forecastHeadlineText(forecast, "en-US")).toBe(expected);
  });

  it("negative BAC also reads 0% VAC, matching the cards' bac > 0 guard rather than dividing by a negative (M3)", () => {
    const forecast: BudgetForecast = { facts: { ...BASE_FACTS, bac: -1000 }, pace: PACE, efficiency: { unavailable: "no-actual-cost" }, gap: null, hasFixedPrice: false };
    const expected = [
      t("en-US", "forecastTileSingle", formatMoneyCompact(PACE.eac, locale), formatSignedPercent(0, locale, 0)),
      t("en-US", "forecastTileRunsOut", formatDayMonth(PACE.runOutDate!, locale)),
    ].join(" · ");
    expect(forecastHeadlineText(forecast, "en-US")).toBe(expected);
  });

  it("omits the run-out part when runOutDate is null", () => {
    const pace: BudgetForecast["pace"] = { ...PACE, runOutDate: null, daysBeforePlannedEnd: null };
    const forecast = forecastWith(pace, EFFICIENCY);
    expect(forecastHeadlineText(forecast, "en-US")).toBe(
      t(
        "en-US", "forecastTileRange",
        formatMoneyCompact(pace.eac, locale), formatMoneyCompact(EFFICIENCY.eac, locale),
        formatSignedPercent(pace.vac / BASE_FACTS.bac, locale, 0),
        formatSignedPercent(EFFICIENCY.vac / BASE_FACTS.bac, locale, 0),
      ),
    );
  });
});

describe("ForecastHeadline", () => {
  it("renders a second muted line = the first notice's short text", () => {
    const pace: BudgetForecast["pace"] = { ...PACE, spreadPeriodHoursUsed: true };
    const forecast = forecastWith(pace, EFFICIENCY);
    render(<ForecastHeadline lang="en-US" forecast={forecast} />);
    expect(screen.getByText(forecastHeadlineText(forecast, "en-US"))).toBeInTheDocument();
    expect(screen.getByText(t("en-US", "forecastShortSpread"))).toBeInTheDocument();
  });

  it("renders no second line when there is no notice", () => {
    const forecast = forecastWith(PACE, EFFICIENCY);
    const { container } = render(<ForecastHeadline lang="en-US" forecast={forecast} />);
    expect(container.querySelectorAll("p")).toHaveLength(1);
  });
});
