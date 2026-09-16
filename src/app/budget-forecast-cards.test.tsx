import { describe, expect, it } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { ForecastCards } from "./budget-forecast-cards";
import { ForecastFactsRow } from "./budget-forecast-facts";
import { formatCurrency } from "./resource-cost";
import { formatSignedPercent } from "./forecast-format";
import { localeFor, t } from "./i18n";
import { formatDayMonthYear } from "./forecast-format";
import { EUR_FORECAST, HOURS_FORECAST_HOURS_WORSE, MIX_HOURS_WORSE, MIX_ON_PLAN } from "../test/forecast-fixtures";
import { rateMixExplanation } from "./budget-rate-mix-text";
import type { BudgetForecast, PaceForecast, PaceUnavailable, EfficiencyUnavailable } from "./budget-forecast";

const locale = localeFor("en-US");
const money = (n: number) => formatCurrency(n, "EUR", locale);

// §5.6 worked example, mirrored exactly (Contract €240,000; today 2026-09-14; plan end 2026-12-18).
const AVAILABLE: BudgetForecast = {
  facts: { bac: 240000, ac: 168000, remaining: 72000, ev: 148800, percentComplete: 62 },
  pace: {
    burnRatePerDay: 1350, windowDays: 20, windowStart: "2026-08-17", windowEnd: "2026-09-11",
    spreadPeriodHoursUsed: false, workingDaysLeft: 69,
    etc: 93150, eac: 261150, vac: -21150, runOutDate: "2026-11-27", daysBeforePlannedEnd: 21,
  },
  efficiency: {
    pv: 176000, cpi: 148800 / 168000, spi: 148800 / 176000,
    etc: 102968, eac: 270968, vac: -30968,
  },
  gap: { eacDifference: 9818, percentOfBac: 9818 / 240000, severity: "info", extraWorkingDays: 8 },
  hasFixedPrice: false,
};

function withPaceUnavailable(pace: PaceUnavailable): BudgetForecast {
  return { ...AVAILABLE, pace, gap: null };
}
function withEfficiencyUnavailable(efficiency: EfficiencyUnavailable): BudgetForecast {
  return { ...AVAILABLE, efficiency, gap: null };
}

describe("ForecastCards — pace card (§5.6 worked example)", () => {
  it("shows the EAC, VAC, ETC, burn rate and run-out", () => {
    render(<ForecastCards lang="en-US" forecast={AVAILABLE} />);
    expect(screen.getByText(money(261150))).toBeInTheDocument();
    expect(screen.getByText(`${money(-21150)} (${formatSignedPercent(-21150 / 240000, locale, 1)})`)).toBeInTheDocument();
    expect(screen.getByText(`${money(1350)}/day`)).toBeInTheDocument();
    expect(screen.getByText("Nov 27, 2026, 21 days before plan end")).toBeInTheDocument();
  });

  it("shows the burn-rate window line", () => {
    render(<ForecastCards lang="en-US" forecast={AVAILABLE} />);
    expect(screen.getByText("Burn rate from Aug 17 – Sep 11 (20 working days)")).toBeInTheDocument();
  });

  it("renders the reason when not enough bookings exist", () => {
    render(<ForecastCards lang="en-US" forecast={withPaceUnavailable({
      unavailable: "not-enough-bookings", firstBookingDate: null, bookedWorkingDays: 0, availableFrom: null,
    })} />);
    expect(screen.getByText("Not enough recent bookings")).toBeInTheDocument();
  });

  it("renders the reason when there is no recent burn", () => {
    render(<ForecastCards lang="en-US" forecast={withPaceUnavailable({
      unavailable: "no-burn", windowStart: "2026-08-17", windowEnd: "2026-09-11", lastBookingDate: null,
    })} />);
    expect(screen.getByText("No recent bookings")).toBeInTheDocument();
  });

  // Finding 8: the other three run-out variants — the worked example only
  // exercises "before plan end".
  it("run-out: renders the after-plan-end variant when the run-out date falls past plan end", () => {
    const pace: PaceForecast = { ...(AVAILABLE.pace as PaceForecast), runOutDate: "2027-01-05", daysBeforePlannedEnd: -5 };
    render(<ForecastCards lang="en-US" forecast={{ ...AVAILABLE, pace, gap: null }} />);
    expect(screen.getByText(t("en-US", "forecastRunOutAfter", formatDayMonthYear("2027-01-05", locale), "5"))).toBeInTheDocument();
  });

  it("run-out: renders the on-plan-end variant when daysBeforePlannedEnd is exactly 0", () => {
    const pace: PaceForecast = { ...(AVAILABLE.pace as PaceForecast), runOutDate: "2026-12-18", daysBeforePlannedEnd: 0 };
    render(<ForecastCards lang="en-US" forecast={{ ...AVAILABLE, pace, gap: null }} />);
    expect(screen.getByText(t("en-US", "forecastRunOutOnEnd", formatDayMonthYear("2026-12-18", locale)))).toBeInTheDocument();
  });

  it("run-out: renders \"Already used up\" when runOutDate is null", () => {
    const pace: PaceForecast = { ...(AVAILABLE.pace as PaceForecast), runOutDate: null, daysBeforePlannedEnd: null };
    render(<ForecastCards lang="en-US" forecast={{ ...AVAILABLE, pace, gap: null }} />);
    expect(screen.getByText(t("en-US", "forecastRunOutAlready"))).toBeInTheDocument();
  });
});

describe("ForecastCards — efficiency card (§5.6 worked example)", () => {
  it("shows CPI, SPI and EAC", () => {
    render(<ForecastCards lang="en-US" forecast={AVAILABLE} />);
    expect(screen.getByText("0.89")).toBeInTheDocument();
    expect(screen.getByText("0.85")).toBeInTheDocument();
    expect(screen.getByText(money(270968))).toBeInTheDocument();
  });

  it("shows a dash for SPI when it is null", () => {
    const noSpi: BudgetForecast = {
      ...AVAILABLE,
      efficiency: { pv: 0, cpi: 148800 / 168000, spi: null, etc: 102968, eac: 270968, vac: -30968 },
    };
    render(<ForecastCards lang="en-US" forecast={noSpi} />);
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(1);
  });

  it("renders the reason when the efficiency forecast needs a percent complete, with a Needs tooltip", () => {
    render(<ForecastCards lang="en-US" forecast={withEfficiencyUnavailable({
      unavailable: "needs-percent-complete", bucketsMissingPercent: [{ id: 1, name: "Design" }],
    })} />);
    expect(screen.getByText(/Needs linked tasks or a % complete/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "What does Needs mean?" })).toBeInTheDocument();
  });

  it("renders the reason when nothing has been spent yet", () => {
    render(<ForecastCards lang="en-US" forecast={withEfficiencyUnavailable({ unavailable: "no-actual-cost" })} />);
    expect(screen.getByText("Nothing spent yet")).toBeInTheDocument();
  });

  it("renders the reason when nothing has been earned yet", () => {
    render(<ForecastCards lang="en-US" forecast={withEfficiencyUnavailable({ unavailable: "no-earned-value" })} />);
    expect(screen.getByText("Nothing earned yet")).toBeInTheDocument();
  });
});

describe("ForecastCards — fixed-price note", () => {
  it("appears on both cards when hasFixedPrice", () => {
    render(<ForecastCards lang="en-US" forecast={{ ...AVAILABLE, hasFixedPrice: true }} />);
    expect(screen.getAllByText(
      "Fixed price: the overrun is internal effort; the client price does not change.",
    )).toHaveLength(2);
  });

  it("is absent when no bucket is fixed-price", () => {
    render(<ForecastCards lang="en-US" forecast={AVAILABLE} />);
    expect(screen.queryByText(/Fixed price:/)).toBeNull();
  });
});

describe("ForecastCards — gap line", () => {
  it("renders the info sentence as a plain paragraph without a role", () => {
    render(<ForecastCards lang="en-US" forecast={AVAILABLE} />);
    const text = screen.getByText(/The forecasts differ by/);
    expect(text.tagName).toBe("P");
    expect(text.getAttribute("role")).toBeNull();
    expect(text.textContent).toContain("8 working days beyond the planned end");
  });

  it("hides the extra-days clause when extraWorkingDays is null", () => {
    const noExtra: BudgetForecast = {
      ...AVAILABLE,
      gap: { eacDifference: 9818, percentOfBac: 9818 / 240000, severity: "info", extraWorkingDays: null },
    };
    render(<ForecastCards lang="en-US" forecast={noExtra} />);
    const text = screen.getByText(/The forecasts differ by/);
    expect(text.textContent).not.toContain("working days beyond the planned end");
  });

  it("renders the warning sentence with role=status and a leading Warning:", () => {
    const warn: BudgetForecast = {
      ...AVAILABLE,
      gap: { eacDifference: 50000, percentOfBac: 50000 / 240000, severity: "warning", extraWorkingDays: null },
    };
    render(<ForecastCards lang="en-US" forecast={warn} />);
    const status = screen.getByRole("status");
    expect(status.textContent).toMatch(/^Warning:/);
  });

  it("renders nothing when gap is null", () => {
    render(<ForecastCards lang="en-US" forecast={{ ...AVAILABLE, gap: null }} />);
    expect(screen.queryByText(/The forecasts differ by/)).toBeNull();
  });
});

describe("ForecastCards + ForecastFactsRow — accessibility", () => {
  it("every tooltip trigger has a unique accessible name", () => {
    render(
      <div>
        <ForecastFactsRow lang="en-US" forecast={AVAILABLE} />
        <ForecastCards lang="en-US" forecast={AVAILABLE} />
      </div>,
    );
    const triggers = document.querySelectorAll("[data-info-tooltip-trigger]");
    const labels = Array.from(triggers).map((el) => el.getAttribute("aria-label"));
    expect(labels.length).toBeGreaterThan(0);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it("label-in-name: the EAC tooltip labels contain their visible term", () => {
    render(<ForecastCards lang="en-US" forecast={AVAILABLE} />);
    expect(screen.getByRole("button", { name: "What is EAC at current pace?" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "What is EAC at current efficiency?" })).toBeInTheDocument();
  });

  // Finding 2: each card's `aria-labelledby` now points at an inner <span>
  // holding ONLY the title text, not the whole heading (which also contains
  // the tooltip trigger's visible "i" glyph) — so the region's accessible
  // name is the exact EN title, matchable without a regex.
  it("each card is a region with the exact EN title as its accessible name", () => {
    render(<ForecastCards lang="en-US" forecast={AVAILABLE} />);
    expect(screen.getByRole("region", { name: t("en-US", "forecastPaceTitle") })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: t("en-US", "forecastEfficiencyTitle") })).toBeInTheDocument();
  });
});

describe("ForecastCards — In hours (MR 3)", () => {
  it("renders no hours line without hours", () => {
    render(<ForecastCards lang="en-US" forecast={EUR_FORECAST} />);
    expect(screen.queryByText("In hours")).toBeNull();
  });

  it("shows EAC, VAC and run-out in hours, and CPI (hours) on the efficiency card", () => {
    render(<ForecastCards lang="en-US" forecast={EUR_FORECAST} hours={HOURS_FORECAST_HOURS_WORSE} mix={MIX_ON_PLAN} />);
    expect(screen.getAllByText("In hours")).toHaveLength(2);
    expect(screen.getByText("2,209 h")).toBeInTheDocument();
    expect(screen.getByText("2,339 h")).toBeInTheDocument();
    expect(screen.getByText("Nov 23, 2026")).toBeInTheDocument();
    expect(screen.getByText("CPI (hours)")).toBeInTheDocument();
    expect(screen.getByText("0.86")).toBeInTheDocument();
  });

  it("shows card-unique chips when the mix triggers, explained by the shared sentence", () => {
    render(<ForecastCards lang="en-US" forecast={EUR_FORECAST} hours={HOURS_FORECAST_HOURS_WORSE} mix={MIX_HOURS_WORSE} />);
    const pace = screen.getByRole("button", { name: "Effort worse than € at current pace — why?" });
    expect(screen.getByRole("button", { name: "Effort worse than € at current efficiency — why?" })).toBeInTheDocument();
    expect(pace).toHaveTextContent("Effort worse than €");
    act(() => pace.focus());
    expect(screen.getByRole("tooltip")).toHaveTextContent(
      rateMixExplanation("en-US", MIX_HOURS_WORSE, EUR_FORECAST, HOURS_FORECAST_HOURS_WORSE),
    );
  });

  it("shows no chip when the mix does not trigger", () => {
    render(<ForecastCards lang="en-US" forecast={EUR_FORECAST} hours={HOURS_FORECAST_HOURS_WORSE} mix={MIX_ON_PLAN} />);
    expect(screen.queryByRole("button", { name: /why\?$/ })).toBeNull();
  });

  it("hides the pace hours line when the hours pace forecast is unavailable", () => {
    const hours: BudgetForecast = { ...HOURS_FORECAST_HOURS_WORSE, pace: { unavailable: "no-burn", windowStart: "2026-08-17", windowEnd: "2026-09-11", lastBookingDate: null } };
    render(<ForecastCards lang="en-US" forecast={EUR_FORECAST} hours={hours} mix={MIX_ON_PLAN} />);
    expect(screen.getAllByText("In hours")).toHaveLength(1);
  });
});
