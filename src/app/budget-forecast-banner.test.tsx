import { beforeAll, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ForecastBanners, forecastNoticeText, forecastNoticeShortText } from "./budget-forecast-banner";
import { formatDayMonth, formatDayMonthYear } from "./forecast-format";
import { loadI18n, localeFor, t } from "./i18n";
import type { BudgetForecast } from "./budget-forecast";
import type { ForecastNotice } from "./budget-forecast-notices";

const locale = localeFor("en-US");

beforeAll(async () => {
  await loadI18n("de");
});

const BASE_FACTS = { bac: 240000, ac: 168000, remaining: 72000, ev: 148800, percentComplete: 62 };

function forecastWith(
  pace: BudgetForecast["pace"],
  efficiency: BudgetForecast["efficiency"] = { unavailable: "no-actual-cost" },
): BudgetForecast {
  return { facts: BASE_FACTS, pace, efficiency, gap: null, hasFixedPrice: false };
}

describe("forecastNoticeText", () => {
  it("starts-on", () => {
    const n: ForecastNotice = {
      kind: "starts-on", severity: "info",
      availableFrom: "2026-10-13", bookedWorkingDays: 13, firstBookingDate: "2026-09-15",
    };
    expect(forecastNoticeText(n, "en-US", "month")).toBe(
      t("en-US", "forecastBannerStartsOn", formatDayMonthYear("2026-10-13", locale), "20", "13", formatDayMonth("2026-09-15", locale)),
    );
  });

  it("starts-once-booked", () => {
    const n: ForecastNotice = { kind: "starts-once-booked", severity: "info" };
    expect(forecastNoticeText(n, "en-US", "month")).toBe(t("en-US", "forecastBannerStartsOnceBooked", "20"));
  });

  it("no-burn with a last booking", () => {
    const n: ForecastNotice = { kind: "no-burn", severity: "warn", windowStart: "2026-08-17", windowEnd: "2026-09-11", lastBookingDate: "2026-08-03" };
    const expected = `${t("en-US", "forecastBannerNoBurn", "20", formatDayMonth("2026-08-17", locale), formatDayMonth("2026-09-11", locale))} ${t("en-US", "forecastBannerLastBooking", formatDayMonth("2026-08-03", locale))}`;
    expect(forecastNoticeText(n, "en-US", "month")).toBe(expected);
  });

  it("no-burn without a last booking omits the trailing sentence", () => {
    const n: ForecastNotice = { kind: "no-burn", severity: "warn", windowStart: "2026-08-17", windowEnd: "2026-09-11", lastBookingDate: null };
    expect(forecastNoticeText(n, "en-US", "month")).toBe(
      t("en-US", "forecastBannerNoBurn", "20", formatDayMonth("2026-08-17", locale), formatDayMonth("2026-09-11", locale)),
    );
  });

  // Finding 10: one LITERAL EN sentence, so a placeholder-order mistake (e.g.
  // swapping windowStart/windowEnd, or the "20" constant) is caught even if a
  // future edit to `t()` or the key text itself stays self-consistent.
  it("no-burn renders the exact EN sentence for concrete dates", () => {
    const n: ForecastNotice = { kind: "no-burn", severity: "warn", windowStart: "2026-08-17", windowEnd: "2026-09-11", lastBookingDate: null };
    expect(forecastNoticeText(n, "en-US", "month")).toBe(
      "No hours were booked in the last 20 working days (Aug 17 – Sep 11), so there is no current-pace forecast.",
    );
  });

  it("spread uses the month wording on a monthly plan", () => {
    const n: ForecastNotice = { kind: "spread", severity: "info" };
    expect(forecastNoticeText(n, "en-US", "month")).toBe(t("en-US", "forecastBannerSpreadMonth"));
  });

  it("spread uses the week wording on a weekly plan", () => {
    const n: ForecastNotice = { kind: "spread", severity: "info" };
    expect(forecastNoticeText(n, "en-US", "week")).toBe(t("en-US", "forecastBannerSpreadWeek"));
  });

  it("needs-percent names the buckets", () => {
    const n: ForecastNotice = { kind: "needs-percent", severity: "info", bucketNames: ["Design", "Rollout"] };
    expect(forecastNoticeText(n, "en-US", "month")).toBe(t("en-US", "forecastBannerNeedsPercent", "Design, Rollout"));
  });

  it("renders the starts-on sentence in German", () => {
    const n: ForecastNotice = {
      kind: "starts-on", severity: "info",
      availableFrom: "2026-10-13", bookedWorkingDays: 13, firstBookingDate: "2026-09-15",
    };
    const deLocale = localeFor("de");
    expect(forecastNoticeText(n, "de", "month")).toBe(
      t("de", "forecastBannerStartsOn", formatDayMonthYear("2026-10-13", deLocale), "20", "13", formatDayMonth("2026-09-15", deLocale)),
    );
  });
});

describe("forecastNoticeShortText", () => {
  it("returns the short form for every kind", () => {
    expect(forecastNoticeShortText({ kind: "starts-on", severity: "info", availableFrom: "2026-10-13", bookedWorkingDays: 13, firstBookingDate: "2026-09-15" }, "en-US"))
      .toBe(t("en-US", "forecastShortStartsOn", formatDayMonthYear("2026-10-13", locale)));
    expect(forecastNoticeShortText({ kind: "starts-once-booked", severity: "info" }, "en-US")).toBe(t("en-US", "forecastShortOnceBooked"));
    expect(forecastNoticeShortText({ kind: "no-burn", severity: "warn", windowStart: "2026-08-17", windowEnd: "2026-09-11", lastBookingDate: null }, "en-US")).toBe(t("en-US", "forecastShortNoBurn"));
    expect(forecastNoticeShortText({ kind: "spread", severity: "info" }, "en-US")).toBe(t("en-US", "forecastShortSpread"));
    expect(forecastNoticeShortText({ kind: "needs-percent", severity: "info", bucketNames: ["Design"] }, "en-US")).toBe(t("en-US", "forecastShortNeedsPercent"));
  });
});

describe("ForecastBanners", () => {
  it("renders nothing when no state applies", () => {
    const forecast = forecastWith({
      burnRatePerDay: 1350, windowDays: 20, windowStart: "2026-08-17", windowEnd: "2026-09-11",
      spreadPeriodHoursUsed: false, workingDaysLeft: 69,
      etc: 93150, eac: 261150, vac: -21150, runOutDate: "2026-11-27", daysBeforePlannedEnd: 21,
    });
    const { container } = render(<ForecastBanners lang="en-US" forecast={forecast} granularity="month" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("no-actual-cost and no-earned-value render no status banner", () => {
    const pace: BudgetForecast["pace"] = {
      burnRatePerDay: 1350, windowDays: 20, windowStart: "2026-08-17", windowEnd: "2026-09-11",
      spreadPeriodHoursUsed: false, workingDaysLeft: 69,
      etc: 93150, eac: 261150, vac: -21150, runOutDate: "2026-11-27", daysBeforePlannedEnd: 21,
    };
    const noCost = render(<ForecastBanners lang="en-US" forecast={forecastWith(pace, { unavailable: "no-actual-cost" })} granularity="month" />);
    expect(noCost.queryByRole("status")).toBeNull();
    noCost.unmount();
    const noEarned = render(<ForecastBanners lang="en-US" forecast={forecastWith(pace, { unavailable: "no-earned-value" })} granularity="month" />);
    expect(noEarned.queryByRole("status")).toBeNull();
  });

  it("stacks the pace and efficiency notices in table order", () => {
    const pace: BudgetForecast["pace"] = {
      burnRatePerDay: 1350, windowDays: 20, windowStart: "2026-08-17", windowEnd: "2026-09-11",
      spreadPeriodHoursUsed: true, workingDaysLeft: 69,
      etc: 93150, eac: 261150, vac: -21150, runOutDate: "2026-11-27", daysBeforePlannedEnd: 21,
    };
    const efficiency: BudgetForecast["efficiency"] = { unavailable: "needs-percent-complete", bucketsMissingPercent: [{ id: 1, name: "Design" }] };
    render(<ForecastBanners lang="en-US" forecast={forecastWith(pace, efficiency)} granularity="month" />);
    const banners = screen.getAllByRole("status");
    expect(banners).toHaveLength(2);
    expect(banners[0].textContent).toBe(t("en-US", "forecastBannerSpreadMonth"));
    expect(banners[1].textContent).toBe(t("en-US", "forecastBannerNeedsPercent", "Design"));
  });

  // Finding 1: the old version only asserted `className !== ""` — every Banner
  // has SOME class, so that passed even if severity were hard-coded. This
  // renders one warn (no-burn) and one info (needs-percent) notice together
  // and pins each against banner.tsx's own severity→tint class map, so a
  // hard-coded `severity="info"` in ForecastBanners turns it red.
  it("passes the warn severity through for no-burn, distinct from an info notice", () => {
    const pace: BudgetForecast["pace"] = { unavailable: "no-burn", windowStart: "2026-08-17", windowEnd: "2026-09-11", lastBookingDate: null };
    const efficiency: BudgetForecast["efficiency"] = { unavailable: "needs-percent-complete", bucketsMissingPercent: [{ id: 1, name: "Design" }] };
    render(<ForecastBanners lang="en-US" forecast={forecastWith(pace, efficiency)} granularity="month" />);
    const banners = screen.getAllByRole("status");
    expect(banners).toHaveLength(2);
    const [warnBanner, infoBanner] = banners; // no-burn (pace, warn) then needs-percent (efficiency, info) — table order
    expect(warnBanner.className).toContain("--rag-amber");
    expect(infoBanner.className).toContain("ui-dark-blue");
    expect(warnBanner.className).not.toBe(infoBanner.className);
  });
});
