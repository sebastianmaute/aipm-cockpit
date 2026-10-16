import { useState, type ComponentProps } from "react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { ForecastCards, type ForecastView } from "./budget-forecast-cards";
import { ForecastFactsRow } from "./budget-forecast-facts";
import { formatCurrency } from "./resource-cost";
import { formatHours, formatSignedPercent } from "./forecast-format";
import { loadI18n, localeFor, t } from "./i18n";
import { formatDayMonthYear } from "./forecast-format";
import { EUR_FORECAST, HOURS_FORECAST_HOURS_WORSE, MIX_HOURS_WORSE, MIX_ON_PLAN } from "../test/forecast-fixtures";
import { rateMixExplanation } from "./budget-rate-mix-text";
import type { BudgetForecast, PaceForecast, PaceUnavailable, EfficiencyUnavailable } from "./budget-forecast";
import type { BudgetHistorySummary } from "./budget-history";
import type { BudgetSim } from "./budget-sim";
import type { CostAtFinish } from "./forecast/cost";

const locale = localeFor("en-US");
const money = (n: number) => formatCurrency(n, "EUR", locale);
const PACE = t("en-US", "forecastPaceTitle");
const EFF = t("en-US", "forecastEfficiencyTitle");
const VIEWS: readonly ForecastView[] = ["pace", "efficiency"];

beforeAll(async () => {
  await loadI18n("de");
});

// §5.6 worked example, mirrored exactly (Contract €240,000; today 2026-09-14; plan end 2026-12-18).
// Pace VAC −21,150 is 8.8% of BAC (Amber); efficiency VAC −30,968 is 12.9% (Red) —
// DIFFERENT bands on purpose, so a badge reading the other card's VAC is caught.
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

type CardsProps = Omit<ComponentProps<typeof ForecastCards>, "view" | "onViewChange" | "currency"> & {
  view?: ForecastView; currency?: ComponentProps<typeof ForecastCards>["currency"];
};
const noop = () => undefined;
/** ForecastCards at a FIXED view — for tests about a card's content. The
 *  switch's own behaviour is pinned through `SwitchHarness` below. */
function Cards({ view = "pace", ...rest }: CardsProps) {
  return <ForecastCards currency="EUR" view={view} onViewChange={noop} {...rest} />;
}
/** ForecastCards with real state behind the switch, as `ForecastSection` wires it. */
function SwitchHarness(props: Omit<CardsProps, "view">) {
  const [view, setView] = useState<ForecastView>("pace");
  return <ForecastCards currency="EUR" {...props} view={view} onViewChange={setView} />;
}
const paceRegion = () => screen.queryByRole("region", { name: PACE });
const effRegion = () => screen.queryByRole("region", { name: EFF });

describe("ForecastCards — the reading switch (spec B)", () => {
  it("renders both options in a group named Forecast reading, the chosen one checked", () => {
    render(<Cards lang="en-US" forecast={AVAILABLE} />);
    const group = screen.getByRole("radiogroup", { name: "Forecast reading" });
    expect(within(group).getByRole("radio", { name: PACE })).toHaveAttribute("aria-checked", "true");
    expect(within(group).getByRole("radio", { name: EFF })).toHaveAttribute("aria-checked", "false");
  });

  it("label-in-name: each option's accessible name contains its visible text", () => {
    render(<Cards lang="en-US" forecast={AVAILABLE} />);
    for (const radio of screen.getAllByRole("radio")) {
      const visible = (radio.textContent ?? "").trim();
      expect(visible.length).toBeGreaterThan(0);
      expect(radio).toHaveAccessibleName(expect.stringContaining(visible));
    }
  });

  it("renders only the chosen card's body", () => {
    const { unmount } = render(<Cards lang="en-US" forecast={AVAILABLE} />);
    expect(paceRegion()).not.toBeNull();
    expect(effRegion()).toBeNull();
    expect(screen.getByText(money(261150))).toBeInTheDocument();
    expect(screen.queryByText(money(270968))).toBeNull();
    unmount();

    render(<Cards lang="en-US" view="efficiency" forecast={AVAILABLE} />);
    expect(effRegion()).not.toBeNull();
    expect(paceRegion()).toBeNull();
    expect(screen.getByText(money(270968))).toBeInTheDocument();
    expect(screen.queryByText(money(261150))).toBeNull();
  });

  it("reports a click on the other option through onViewChange", () => {
    const onViewChange = vi.fn();
    render(<ForecastCards currency="EUR" lang="en-US" forecast={AVAILABLE} view="pace" onViewChange={onViewChange} />);
    fireEvent.click(screen.getByRole("radio", { name: EFF }));
    expect(onViewChange).toHaveBeenCalledWith("efficiency");
  });

  it("keeps keyboard focus on the switch when an arrow key changes the card", () => {
    // Pins the ruling that the switch sits ABOVE the card: inside the swapped
    // card it would unmount and focus would fall to <body>.
    render(<SwitchHarness lang="en-US" forecast={AVAILABLE} />);
    const pace = screen.getByRole("radio", { name: PACE });
    act(() => pace.focus());
    fireEvent.keyDown(pace, { key: "ArrowRight" });
    const eff = screen.getByRole("radio", { name: EFF });
    expect(eff).toHaveAttribute("aria-checked", "true");
    expect(document.activeElement).toBe(eff);
    expect(effRegion()).not.toBeNull();
  });

  it("an unavailable forecast still opens: choosing efficiency with nothing earned shows the card's reason", () => {
    render(<SwitchHarness lang="en-US" forecast={withEfficiencyUnavailable({ unavailable: "no-earned-value" })} />);
    fireEvent.click(screen.getByRole("radio", { name: EFF }));
    expect(screen.getByRole("radio", { name: EFF })).toHaveAttribute("aria-checked", "true");
    expect(within(effRegion()!).getByText("Nothing earned yet")).toBeInTheDocument();
  });

  it("does not print the switch", () => {
    render(<Cards lang="en-US" forecast={AVAILABLE} />);
    const group = screen.getByRole("radiogroup", { name: "Forecast reading" });
    expect(group.parentElement).toHaveClass("print:hidden");
  });
});

describe("ForecastCards — RAG badge on the chosen card (spec B)", () => {
  const BADGE = /^(Red|Amber|Green|—)$/;

  it("shows Amber on the pace card for the worked example (VAC 8.8% of BAC)", () => {
    render(<Cards lang="en-US" forecast={AVAILABLE} />);
    const badge = within(paceRegion()!).getByRole("img", { name: "Amber" });
    // Never colour-only: the letter is in the glyph and the word is the name.
    expect(badge).toHaveTextContent("A");
  });

  it("shows Red on the efficiency card, from ITS OWN VAC (12.9% of BAC)", () => {
    render(<Cards lang="en-US" view="efficiency" forecast={AVAILABLE} />);
    expect(within(effRegion()!).getByRole("img", { name: "Red" })).toHaveTextContent("R");
  });

  it("shows Green when the chosen card's VAC is not negative", () => {
    const pace: PaceForecast = { ...(AVAILABLE.pace as PaceForecast), vac: 1000 };
    const { unmount } = render(<Cards lang="en-US" forecast={{ ...AVAILABLE, pace }} />);
    expect(within(paceRegion()!).getByRole("img", { name: "Green" })).toHaveTextContent("G");
    unmount();
    const efficiency = { ...AVAILABLE.efficiency, vac: 0 } as BudgetForecast["efficiency"];
    render(<Cards lang="en-US" view="efficiency" forecast={{ ...AVAILABLE, efficiency }} />);
    expect(within(effRegion()!).getByRole("img", { name: "Green" })).toBeInTheDocument();
  });

  it("shows no badge when the rule yields null (BAC ≤ 0)", () => {
    const zeroBac: BudgetForecast = { ...AVAILABLE, facts: { ...AVAILABLE.facts, bac: 0 } };
    for (const view of VIEWS) {
      const { unmount } = render(<Cards lang="en-US" view={view} forecast={zeroBac} />);
      const region = (view === "pace" ? paceRegion() : effRegion())!;
      expect(region).not.toBeNull();
      expect(within(region).queryByRole("img", { name: BADGE })).toBeNull();
      unmount();
    }
  });

  it("shows no badge when the chosen forecast is unavailable", () => {
    const { unmount } = render(<Cards lang="en-US" forecast={withPaceUnavailable({
      unavailable: "no-burn", windowStart: "2026-08-17", windowEnd: "2026-09-11", lastBookingDate: null,
    })} />);
    expect(within(paceRegion()!).queryByRole("img", { name: BADGE })).toBeNull();
    unmount();
    render(<Cards lang="en-US" view="efficiency" forecast={withEfficiencyUnavailable({ unavailable: "no-actual-cost" })} />);
    expect(within(effRegion()!).queryByRole("img", { name: BADGE })).toBeNull();
  });
});

describe("ForecastCards — pace card (§5.6 worked example)", () => {
  it("shows the EAC, VAC, ETC, burn rate and run-out", () => {
    render(<Cards lang="en-US" forecast={AVAILABLE} />);
    expect(screen.getByText(money(261150))).toBeInTheDocument();
    expect(screen.getByText(`${money(-21150)} (${formatSignedPercent(-21150 / 240000, locale, 1)})`)).toBeInTheDocument();
    expect(screen.getByText(`${money(1350)}/day`)).toBeInTheDocument();
    expect(screen.getByText("Nov 27, 2026, 21 days before plan end")).toBeInTheDocument();
  });

  it("shows the burn-rate window line", () => {
    render(<Cards lang="en-US" forecast={AVAILABLE} />);
    expect(screen.getByText("Burn rate from Aug 17 – Sep 11 (20 working days)")).toBeInTheDocument();
  });

  it("renders the reason when not enough bookings exist", () => {
    render(<Cards lang="en-US" forecast={withPaceUnavailable({
      unavailable: "not-enough-bookings", firstBookingDate: null, bookedWorkingDays: 0, availableFrom: null,
    })} />);
    expect(screen.getByText("Not enough recent bookings")).toBeInTheDocument();
  });

  it("renders the reason when there is no recent burn", () => {
    render(<Cards lang="en-US" forecast={withPaceUnavailable({
      unavailable: "no-burn", windowStart: "2026-08-17", windowEnd: "2026-09-11", lastBookingDate: null,
    })} />);
    expect(screen.getByText("No recent bookings")).toBeInTheDocument();
  });

  // Finding 8: the other three run-out variants — the worked example only
  // exercises "before plan end".
  it("run-out: renders the after-plan-end variant when the run-out date falls past plan end", () => {
    const pace: PaceForecast = { ...(AVAILABLE.pace as PaceForecast), runOutDate: "2027-01-05", daysBeforePlannedEnd: -5 };
    render(<Cards lang="en-US" forecast={{ ...AVAILABLE, pace, gap: null }} />);
    expect(screen.getByText(t("en-US", "forecastRunOutAfter", formatDayMonthYear("2027-01-05", locale), "5"))).toBeInTheDocument();
  });

  it("run-out: renders the on-plan-end variant when daysBeforePlannedEnd is exactly 0", () => {
    const pace: PaceForecast = { ...(AVAILABLE.pace as PaceForecast), runOutDate: "2026-12-18", daysBeforePlannedEnd: 0 };
    render(<Cards lang="en-US" forecast={{ ...AVAILABLE, pace, gap: null }} />);
    expect(screen.getByText(t("en-US", "forecastRunOutOnEnd", formatDayMonthYear("2026-12-18", locale)))).toBeInTheDocument();
  });

  it("run-out: renders \"Already used up\" when runOutDate is null", () => {
    const pace: PaceForecast = { ...(AVAILABLE.pace as PaceForecast), runOutDate: null, daysBeforePlannedEnd: null };
    render(<Cards lang="en-US" forecast={{ ...AVAILABLE, pace, gap: null }} />);
    expect(screen.getByText(t("en-US", "forecastRunOutAlready"))).toBeInTheDocument();
  });
});

// Migrated: each render now asks for the efficiency card explicitly.
describe("ForecastCards — efficiency card (§5.6 worked example)", () => {
  it("shows CPI, SPI and EAC", () => {
    render(<Cards lang="en-US" view="efficiency" forecast={AVAILABLE} />);
    expect(screen.getByText("0.89")).toBeInTheDocument();
    expect(screen.getByText("0.85")).toBeInTheDocument();
    expect(screen.getByText(money(270968))).toBeInTheDocument();
  });

  it("shows a dash for SPI when it is null", () => {
    const noSpi: BudgetForecast = {
      ...AVAILABLE,
      efficiency: { pv: 0, cpi: 148800 / 168000, spi: null, etc: 102968, eac: 270968, vac: -30968 },
    };
    render(<Cards lang="en-US" view="efficiency" forecast={noSpi} />);
    expect(within(effRegion()!).getAllByText("—").length).toBeGreaterThanOrEqual(1);
  });

  it("renders the reason when the efficiency forecast needs a percent complete, with a Needs tooltip", () => {
    render(<Cards lang="en-US" view="efficiency" forecast={withEfficiencyUnavailable({
      unavailable: "needs-percent-complete", bucketsMissingPercent: [{ id: 1, name: "Design" }],
    })} />);
    expect(screen.getByText(/Needs linked tasks or a % complete/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "What does Needs mean?" })).toBeInTheDocument();
  });

  it("renders the reason when nothing has been spent yet", () => {
    render(<Cards lang="en-US" view="efficiency" forecast={withEfficiencyUnavailable({ unavailable: "no-actual-cost" })} />);
    expect(screen.getByText("Nothing spent yet")).toBeInTheDocument();
  });

  it("renders the reason when nothing has been earned yet", () => {
    render(<Cards lang="en-US" view="efficiency" forecast={withEfficiencyUnavailable({ unavailable: "no-earned-value" })} />);
    expect(screen.getByText("Nothing earned yet")).toBeInTheDocument();
  });
});

describe("ForecastCards — fixed-price note", () => {
  const FIXED = "Fixed price: the overrun is internal effort; the client price does not change.";

  // Migrated from "appears on both cards": one card renders, so the note
  // appears once, on whichever card is chosen.
  it("appears on the chosen card, whichever it is, when hasFixedPrice", () => {
    const fp: BudgetForecast = { ...AVAILABLE, hasFixedPrice: true };
    const { unmount } = render(<Cards lang="en-US" forecast={fp} />);
    expect(screen.getAllByText(FIXED)).toHaveLength(1);
    expect(within(paceRegion()!).getByText(FIXED)).toBeInTheDocument();
    unmount();
    render(<Cards lang="en-US" view="efficiency" forecast={fp} />);
    expect(screen.getAllByText(FIXED)).toHaveLength(1);
    expect(within(effRegion()!).getByText(FIXED)).toBeInTheDocument();
  });

  it("is absent when no bucket is fixed-price", () => {
    render(<Cards lang="en-US" forecast={AVAILABLE} />);
    expect(screen.queryByText(/Fixed price:/)).toBeNull();
  });
});

describe("ForecastCards — gap line (conditions unchanged)", () => {
  it("renders the info sentence as a plain paragraph without a role", () => {
    render(<Cards lang="en-US" forecast={AVAILABLE} />);
    const text = screen.getByText(/The pace and efficiency forecasts differ by/);
    expect(text.tagName).toBe("P");
    expect(text.getAttribute("role")).toBeNull();
    expect(text.textContent).toContain("8 working days beyond the planned end");
  });

  it("renders under the efficiency card too — it compares both forecasts whichever card shows", () => {
    render(<Cards lang="en-US" view="efficiency" forecast={AVAILABLE} />);
    expect(screen.getByText(/The pace and efficiency forecasts differ by/)).toBeInTheDocument();
  });

  it("hides the extra-days clause when extraWorkingDays is null", () => {
    const noExtra: BudgetForecast = {
      ...AVAILABLE,
      gap: { eacDifference: 9818, percentOfBac: 9818 / 240000, severity: "info", extraWorkingDays: null },
    };
    render(<Cards lang="en-US" forecast={noExtra} />);
    const text = screen.getByText(/The pace and efficiency forecasts differ by/);
    expect(text.textContent).not.toContain("working days beyond the planned end");
  });

  it("renders the warning sentence with role=status and a leading Warning:", () => {
    const warn: BudgetForecast = {
      ...AVAILABLE,
      gap: { eacDifference: 50000, percentOfBac: 50000 / 240000, severity: "warning", extraWorkingDays: null },
    };
    render(<Cards lang="en-US" forecast={warn} />);
    const status = screen.getByRole("status");
    expect(status.textContent).toMatch(/^Warning:/);
  });

  it("renders nothing when gap is null", () => {
    render(<Cards lang="en-US" forecast={{ ...AVAILABLE, gap: null }} />);
    expect(screen.queryByText(/The pace and efficiency forecasts differ by/)).toBeNull();
  });

  it("renders nothing when either forecast is unavailable, in either view", () => {
    const unavailableScenarios: BudgetForecast[] = [
      { ...withEfficiencyUnavailable({ unavailable: "no-actual-cost" }), gap: AVAILABLE.gap },
      { ...withPaceUnavailable({ unavailable: "no-burn", windowStart: "2026-08-17", windowEnd: "2026-09-11", lastBookingDate: null }), gap: AVAILABLE.gap },
    ];
    for (const view of VIEWS) {
      for (const forecast of unavailableScenarios) {
        const { unmount } = render(<Cards lang="en-US" view={view} forecast={forecast} />);
        expect(screen.queryByText(/The pace and efficiency forecasts differ by/)).toBeNull();
        unmount();
      }
    }
  });
});

describe("ForecastCards + ForecastFactsRow — accessibility", () => {
  // Migrated: run once per view, since only one card is in the DOM at a time.
  it("every tooltip trigger has a unique accessible name, in either view", () => {
    for (const view of VIEWS) {
      const { unmount } = render(
        <div>
          <ForecastFactsRow currency="EUR" lang="en-US" forecast={AVAILABLE} />
          <Cards lang="en-US" view={view} forecast={AVAILABLE} />
        </div>,
      );
      const labels = Array.from(document.querySelectorAll("[data-info-tooltip-trigger]")).map((el) => el.getAttribute("aria-label"));
      expect(labels.length).toBeGreaterThan(0);
      expect(new Set(labels).size).toBe(labels.length);
      unmount();
    }
  });

  it("label-in-name: the EAC tooltip label contains its visible term", () => {
    const { unmount } = render(<Cards lang="en-US" forecast={AVAILABLE} />);
    expect(screen.getByRole("button", { name: "What is EAC at current pace?" })).toBeInTheDocument();
    unmount();
    render(<Cards lang="en-US" view="efficiency" forecast={AVAILABLE} />);
    expect(screen.getByRole("button", { name: "What is EAC at current efficiency?" })).toBeInTheDocument();
  });

  // Finding 2: each card's `aria-labelledby` points at an inner <span> holding
  // ONLY the title text — so neither the tooltip glyph nor the new badge joins
  // the region's name, which stays the exact EN title.
  it("the chosen card is a region with the exact EN title as its accessible name", () => {
    const { unmount } = render(<Cards lang="en-US" forecast={AVAILABLE} />);
    expect(screen.getByRole("region", { name: PACE })).toBeInTheDocument();
    unmount();
    render(<Cards lang="en-US" view="efficiency" forecast={AVAILABLE} />);
    expect(screen.getByRole("region", { name: EFF })).toBeInTheDocument();
  });
});

describe("ForecastCards — In hours (MR 3)", () => {
  it("renders no hours line without hours", () => {
    render(<Cards lang="en-US" forecast={EUR_FORECAST} />);
    expect(screen.queryByText("In hours")).toBeNull();
  });

  // Migrated from one two-card test: the pace figures on the pace card…
  it("shows EAC, VAC and run-out in hours on the pace card", () => {
    render(<Cards lang="en-US" forecast={EUR_FORECAST} hours={HOURS_FORECAST_HOURS_WORSE} mix={MIX_ON_PLAN} />);
    expect(screen.getAllByText("In hours")).toHaveLength(1);
    expect(screen.getByText("2,209 h")).toBeInTheDocument();
    expect(screen.getByText("Nov 23, 2026")).toBeInTheDocument();
    expect(screen.queryByText("CPI (hours)")).toBeNull();
  });

  // …and the efficiency figures on the efficiency card.
  it("shows EAC in hours and CPI (hours) on the efficiency card", () => {
    render(<Cards lang="en-US" view="efficiency" forecast={EUR_FORECAST} hours={HOURS_FORECAST_HOURS_WORSE} mix={MIX_ON_PLAN} />);
    expect(screen.getAllByText("In hours")).toHaveLength(1);
    expect(screen.getByText("2,339 h")).toBeInTheDocument();
    expect(screen.getByText("CPI (hours)")).toBeInTheDocument();
    expect(screen.getByText("0.86")).toBeInTheDocument();
  });

  it("shows the chosen card's chip when the mix triggers, explained by the shared sentence", () => {
    const { unmount } = render(<Cards lang="en-US" forecast={EUR_FORECAST} hours={HOURS_FORECAST_HOURS_WORSE} mix={MIX_HOURS_WORSE} />);
    const pace = screen.getByRole("button", { name: "Effort worse than € at current pace — why?" });
    expect(screen.queryByRole("button", { name: "Effort worse than € at current efficiency — why?" })).toBeNull();
    expect(pace).toHaveTextContent("Effort worse than €");
    act(() => pace.focus());
    expect(screen.getByRole("tooltip")).toHaveTextContent(
      rateMixExplanation("en-US", MIX_HOURS_WORSE, EUR_FORECAST, HOURS_FORECAST_HOURS_WORSE, "EUR"),
    );
    unmount();
    render(<Cards lang="en-US" view="efficiency" forecast={EUR_FORECAST} hours={HOURS_FORECAST_HOURS_WORSE} mix={MIX_HOURS_WORSE} />);
    expect(screen.getByRole("button", { name: "Effort worse than € at current efficiency — why?" })).toBeInTheDocument();
  });

  it("shows no chip when the mix does not trigger, in either view", () => {
    for (const view of VIEWS) {
      const { unmount } = render(<Cards lang="en-US" view={view} forecast={EUR_FORECAST} hours={HOURS_FORECAST_HOURS_WORSE} mix={MIX_ON_PLAN} />);
      expect(screen.queryByRole("button", { name: /why\?$/ })).toBeNull();
      unmount();
    }
  });

  it("hides the pace hours line when the hours pace forecast is unavailable, leaving the efficiency one", () => {
    const hours: BudgetForecast = { ...HOURS_FORECAST_HOURS_WORSE, pace: { unavailable: "no-burn", windowStart: "2026-08-17", windowEnd: "2026-09-11", lastBookingDate: null } };
    const { unmount } = render(<Cards lang="en-US" forecast={EUR_FORECAST} hours={hours} mix={MIX_ON_PLAN} />);
    expect(screen.queryByText("In hours")).toBeNull();
    unmount();
    render(<Cards lang="en-US" view="efficiency" forecast={EUR_FORECAST} hours={hours} mix={MIX_ON_PLAN} />);
    expect(screen.getAllByText("In hours")).toHaveLength(1);
  });
});

// Task 11: three-part variance split (performance / added scope / unattributed)
// beneath the VAC row, in € always and in hours whenever the hours line shows.
// `pace.eac` and `efficiency.eac` are deliberately DIFFERENT on both fixtures
// below (1440 vs 1300 hours; 144000 vs 130000 €) so a mutant that has the
// efficiency card read the pace card's EAC is caught by a distinct expected
// figure per card, not by a coincidentally-equal one.
describe("ForecastCards — three-part variance split (task 11)", () => {
  const signedText = (base: string, n: number) => (n > 0 ? `+${base}` : base);

  const HISTORY: BudgetHistorySummary = {
    baselineDate: "2026-01-05",
    baseline: { hours: 1200, value: 120000 },
    attributed: { hours: 500, value: 50000 },
    changes: [],
  };

  function hoursSplitForecast(bac: number): BudgetForecast {
    return {
      facts: { bac, ac: 1200, remaining: bac - 1200, ev: 1100, percentComplete: 64.7 },
      pace: {
        burnRatePerDay: 20, windowDays: 20, windowStart: "2026-08-17", windowEnd: "2026-09-11",
        spreadPeriodHoursUsed: false, workingDaysLeft: 12,
        etc: 240, eac: 1440, vac: bac - 1440, runOutDate: null, daysBeforePlannedEnd: null,
      },
      efficiency: { pv: 1150, cpi: 1100 / 1200, spi: 1100 / 1150, etc: 100, eac: 1300, vac: bac - 1300 },
      gap: null,
      hasFixedPrice: false,
    };
  }

  function eurSplitForecast(bac: number): BudgetForecast {
    return {
      facts: { bac, ac: 120000, remaining: bac - 120000, ev: 110000, percentComplete: 64.7 },
      pace: {
        burnRatePerDay: 2000, windowDays: 20, windowStart: "2026-08-17", windowEnd: "2026-09-11",
        spreadPeriodHoursUsed: false, workingDaysLeft: 12,
        etc: 24000, eac: 144000, vac: bac - 144000, runOutDate: null, daysBeforePlannedEnd: null,
      },
      efficiency: { pv: 115000, cpi: 110000 / 120000, spi: 110000 / 115000, etc: 10000, eac: 130000, vac: bac - 130000 },
      gap: null,
      hasFixedPrice: false,
    };
  }

  // Migrated: the two cards' halves are now two renders.
  it("shows performance and added-scope in hours, with no unattributed row, when the recorded change covers the whole BAC move", () => {
    const { unmount } = render(<Cards lang="en-US" forecast={eurSplitForecast(170000)} hours={hoursSplitForecast(1700)} history={HISTORY} />);
    const pace = paceRegion()!;
    expect(within(pace).getByText(signedText(formatHours(-240, locale), -240))).toBeInTheDocument();
    expect(within(pace).getByText(signedText(formatHours(500, locale), 500))).toBeInTheDocument();
    expect(within(pace).queryByText(t("en-US", "forecastSplitUnattributed"))).toBeNull();
    unmount();

    render(<Cards lang="en-US" view="efficiency" forecast={eurSplitForecast(170000)} hours={hoursSplitForecast(1700)} history={HISTORY} />);
    const eff = effRegion()!;
    expect(within(eff).getByText(signedText(formatHours(-100, locale), -100))).toBeInTheDocument();
    expect(within(eff).getByText(signedText(formatHours(500, locale), 500))).toBeInTheDocument();
    expect(within(eff).queryByText(t("en-US", "forecastSplitUnattributed"))).toBeNull();
  });

  it("shows the unattributed row and its tooltip once the recorded change no longer covers the whole BAC move", () => {
    render(<Cards lang="en-US" forecast={eurSplitForecast(170000)} hours={hoursSplitForecast(1760)} history={HISTORY} />);
    const pace = paceRegion()!;
    expect(within(pace).getByText(signedText(formatHours(60, locale), 60))).toBeInTheDocument();
    const trigger = within(pace).getByRole("button", {
      name: `${t("en-US", "forecastTipSplitNameUnattributed")} – ${PACE} – ${t("en-US", "forecastInHours")}`,
    });
    act(() => trigger.focus());
    expect(screen.getByRole("tooltip")).toHaveTextContent(t("en-US", "forecastTipSplitUnattributed"));
  });

  it("shows the unattributed row exactly at the 0.5 threshold (boundary for the >= check)", () => {
    render(<Cards lang="en-US" forecast={eurSplitForecast(170000)} hours={hoursSplitForecast(1700.5)} history={HISTORY} />);
    expect(within(paceRegion()!).getByText(t("en-US", "forecastSplitUnattributed"))).toBeInTheDocument();
  });

  it("renders the split rows in € the same way, with the baseline-date caption", () => {
    const { unmount } = render(<Cards lang="en-US" forecast={eurSplitForecast(170000)} history={HISTORY} />);
    const pace = paceRegion()!;
    expect(within(pace).getByText(t("en-US", "forecastSplitSince", formatDayMonthYear("2026-01-05", locale)))).toBeInTheDocument();
    expect(within(pace).getByText(signedText(money(-24000), -24000))).toBeInTheDocument();
    expect(within(pace).getByText(signedText(money(50000), 50000))).toBeInTheDocument();
    expect(within(pace).queryByText(t("en-US", "forecastSplitUnattributed"))).toBeNull();
    unmount();

    render(<Cards lang="en-US" view="efficiency" forecast={eurSplitForecast(170000)} history={HISTORY} />);
    const eff = effRegion()!;
    expect(within(eff).getByText(signedText(money(-10000), -10000))).toBeInTheDocument();
    expect(within(eff).getByText(signedText(money(50000), 50000))).toBeInTheDocument();
    expect(within(eff).queryByText(t("en-US", "forecastSplitUnattributed"))).toBeNull();
  });

  it("shows the no-history note once, on the chosen card, when history is null", () => {
    for (const view of VIEWS) {
      const { unmount } = render(<Cards lang="en-US" view={view} forecast={EUR_FORECAST} />);
      expect(screen.getAllByText(t("en-US", "forecastSplitNoHistory"))).toHaveLength(1);
      unmount();
    }
  });

  // Migrated: the four unattributed names (2 cards × 2 units) are collected
  // across the two views; they must stay distinct from each other, since the
  // card title is what tells a screen-reader user which reading they are in.
  it("keeps every unattributed-variance tooltip's accessible name unique across both cards and both units", () => {
    const collect = (view: ForecastView) => {
      const { unmount } = render(<Cards lang="en-US" view={view} forecast={eurSplitForecast(176000)} hours={hoursSplitForecast(1760)} history={HISTORY} />);
      const labels = Array.from(document.querySelectorAll("[data-info-tooltip-trigger]")).map((el) => el.getAttribute("aria-label"));
      unmount();
      return labels;
    };
    const pace = collect("pace");
    const eff = collect("efficiency");
    for (const labels of [pace, eff]) expect(new Set(labels).size).toBe(labels.length);
    const unattributed = [...pace, ...eff].filter((l) => l?.includes(t("en-US", "forecastTipSplitNameUnattributed")));
    expect(unattributed).toHaveLength(4);
    expect(new Set(unattributed).size).toBe(4);
  });

  it("renders the DE added-scope label", () => {
    render(<Cards lang="de" forecast={eurSplitForecast(170000)} history={HISTORY} />);
    expect(screen.getAllByText("Zusätzlicher Umfang").length).toBeGreaterThan(0);
  });
});

// ---- §502 part 3: the simulated cost at finish on the pace card ----
const SIM_OFF_HTML: string = "<div><div class=\"mb-2 print:hidden\"><div role=\"radiogroup\" aria-label=\"Forecast reading\" class=\"inline-flex flex-wrap rounded-md border border-line bg-[var(--segment-track-bg)]  \"><button type=\"button\" role=\"radio\" aria-checked=\"true\" tabindex=\"0\" class=\"inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium focus:outline-none focus:relative focus:z-10 focus:ring-2 focus:ring-ui-green rounded-l-md bg-[var(--segment-active-bg)] text-[var(--segment-active-fg)] shadow-[var(--shadow-control)]\"><svg xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" class=\"lucide lucide-check h-3 w-3 shrink-0\" aria-hidden=\"true\" data-selected-marker=\"on\"><path d=\"M20 6 9 17l-5-5\"></path></svg>At current pace</button><button type=\"button\" role=\"radio\" aria-checked=\"false\" tabindex=\"-1\" class=\"inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium focus:outline-none focus:relative focus:z-10 focus:ring-2 focus:ring-ui-green rounded-r-md border-l border-line text-foreground enabled:hover:bg-surface-muted disabled:cursor-not-allowed\"><svg xmlns=\"http://www.w3.org/2000/svg\" width=\"24\" height=\"24\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\" class=\"lucide lucide-check h-3 w-3 shrink-0 invisible\" aria-hidden=\"true\" data-selected-marker=\"off\"><path d=\"M20 6 9 17l-5-5\"></path></svg>At current efficiency</button></div></div><section aria-labelledby=\"_r_0_\" class=\"rounded-lg border border-line bg-surface p-3\"><h4 class=\"flex items-center text-sm font-semibold text-ui-dark-blue dark:text-ui-light-grey\"><span id=\"_r_0_\">At current pace</span><span class=\"ml-1.5 inline-flex\"><span role=\"img\" aria-label=\"Amber\" title=\"Amber\" data-rag-chip=\"A\" class=\"inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[9px] font-bold [-webkit-print-color-adjust:exact] [print-color-adjust:exact] bg-[var(--rag-amber)] text-[var(--rag-badge-amber-ink)]\">A</span></span><span class=\"print:hidden ml-1\"><span class=\"relative inline-flex items-center align-middle\"><span role=\"button\" tabindex=\"0\" data-info-tooltip-trigger=\"\" aria-label=\"What does At current pace mean?\" class=\"flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-line text-[10px] font-semibold normal-case leading-none text-muted-foreground hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ui-green\">i</span></span></span></h4><p class=\"text-xs text-muted-foreground\">spending continues as in the last 20 working days</p><div class=\"mt-2\"><p class=\"flex items-center text-xs uppercase tracking-wide text-muted-foreground\">EAC at current pace<span class=\"print:hidden ml-1\"><span class=\"relative inline-flex items-center align-middle\"><span role=\"button\" tabindex=\"0\" data-info-tooltip-trigger=\"\" aria-label=\"What is EAC at current pace?\" class=\"flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-line text-[10px] font-semibold normal-case leading-none text-muted-foreground hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ui-green\">i</span></span></span></p><p class=\"text-2xl font-semibold tabular-nums text-ui-dark-blue dark:text-ui-light-grey\">€261,150</p></div><dl class=\"mt-2 space-y-1 text-sm\"><div class=\"flex items-baseline justify-between gap-2\"><dt class=\"flex items-center text-muted-foreground\">VAC at current pace<span class=\"print:hidden ml-1\"><span class=\"relative inline-flex items-center align-middle\"><span role=\"button\" tabindex=\"0\" data-info-tooltip-trigger=\"\" aria-label=\"What is VAC at current pace?\" class=\"flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-line text-[10px] font-semibold normal-case leading-none text-muted-foreground hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ui-green\">i</span></span></span></dt><dd class=\"tabular-nums font-medium text-foreground\">-€21,150 (-8.8%)</dd></div><div class=\"flex items-baseline justify-between gap-2\"><dt class=\"flex items-center text-muted-foreground\">ETC at current pace<span class=\"print:hidden ml-1\"><span class=\"relative inline-flex items-center align-middle\"><span role=\"button\" tabindex=\"0\" data-info-tooltip-trigger=\"\" aria-label=\"What is ETC at current pace?\" class=\"flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-line text-[10px] font-semibold normal-case leading-none text-muted-foreground hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ui-green\">i</span></span></span></dt><dd class=\"tabular-nums font-medium text-foreground\">€93,150</dd></div><div class=\"flex items-baseline justify-between gap-2\"><dt class=\"flex items-center text-muted-foreground\">Burn rate<span class=\"print:hidden ml-1\"><span class=\"relative inline-flex items-center align-middle\"><span role=\"button\" tabindex=\"0\" data-info-tooltip-trigger=\"\" aria-label=\"What is Burn rate?\" class=\"flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-line text-[10px] font-semibold normal-case leading-none text-muted-foreground hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ui-green\">i</span></span></span></dt><dd class=\"tabular-nums font-medium text-foreground\">€1,350/day</dd></div><div class=\"flex items-baseline justify-between gap-2\"><dt class=\"flex items-center text-muted-foreground\">Runs out<span class=\"print:hidden ml-1\"><span class=\"relative inline-flex items-center align-middle\"><span role=\"button\" tabindex=\"0\" data-info-tooltip-trigger=\"\" aria-label=\"What does Runs out mean?\" class=\"flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-line text-[10px] font-semibold normal-case leading-none text-muted-foreground hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ui-green\">i</span></span></span></dt><dd class=\"tabular-nums font-medium text-foreground\">Nov 27, 2026, 21 days before plan end</dd></div></dl><p class=\"mt-2 text-xs text-muted-foreground\">The split into performance and added scope starts with the first recorded budget change.</p><p class=\"mt-2 text-xs text-muted-foreground\">Burn rate from Aug 17 – Sep 11 (20 working days)</p></section><p class=\"mt-3 text-sm\">The pace and efficiency forecasts differ by €9,818 (4.1% of budget). At current efficiency the work needs 8 working days beyond the planned end; the pace forecast assumes it finishes on time.<span class=\"print:hidden ml-1\"><span class=\"relative inline-flex items-center align-middle\"><span role=\"button\" tabindex=\"0\" data-info-tooltip-trigger=\"\" aria-label=\"What does Extra working days mean?\" class=\"flex h-4 w-4 cursor-help items-center justify-center rounded-full border border-line text-[10px] font-semibold normal-case leading-none text-muted-foreground hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ui-green\">i</span></span></span></p></div>";
const normIds = (html: string) => html.replace(/(id|aria-labelledby|aria-describedby|aria-controls)="[^"]*"/g, "$1=\"\"");

const SIM_ON: BudgetSim = {
  finish: { p50: "2026-11-20", p80: "2026-12-04", p95: "2026-12-30" },
  eur: { kind: "sim", p50: 250000, p80: 262000, p95: 281000, chanceOverBudget: 0.8, spendDays: 60 },
  hours: { kind: "sim", p50: 1900, p80: 2050, p95: 2300, chanceOverBudget: 0.8, spendDays: 60 },
};
const costBlock = () => screen.getByRole("group", { name: "Cost at finish, simulated" });

describe("ForecastCards — simulated cost at finish (§502)", () => {
  it("switch off renders exactly as before", () => {
    const { container } = render(<Cards lang="en-US" forecast={EUR_FORECAST} />);
    expect(normIds(container.innerHTML)).toBe(normIds(SIM_OFF_HTML));
  });

  it("renders nothing extra for a null sim", () => {
    const { container } = render(<Cards lang="en-US" forecast={EUR_FORECAST} sim={null} />);
    expect(normIds(container.innerHTML)).toBe(normIds(SIM_OFF_HTML));
  });

  it("shows P50/P80/P95 and the chance with the sim marking", () => {
    render(<Cards lang="en-US" forecast={AVAILABLE} sim={SIM_ON} />);
    const block = within(costBlock());
    expect(block.getByText("Even odds (P50)")).toBeInTheDocument();
    expect(block.getByText("Safe to commit (P80)")).toBeInTheDocument();
    expect(block.getByText("Cautious (P95)")).toBeInTheDocument();
    expect(block.getByText("Chance over budget")).toBeInTheDocument();
    expect(block.getByText(money(262000))).toBeInTheDocument();
    expect(block.getByText("80%")).toBeInTheDocument();
    expect(block.getAllByText("sim").length).toBeGreaterThan(0);
  });

  it("marks the hours row as simulated", () => {
    render(<Cards lang="en-US" forecast={AVAILABLE} hours={HOURS_FORECAST_HOURS_WORSE} sim={SIM_ON} />);
    const row = screen.getByRole("group", { name: "Hours at finish (P80), simulated" });
    expect(row).toHaveTextContent(formatHours(2050, locale));
  });

  it("reads beyond as beyond", () => {
    const sim: BudgetSim = { ...SIM_ON, eur: { ...(SIM_ON.eur as CostAtFinish & { kind: "sim" }), p95: "beyond" } };
    render(<Cards lang="en-US" forecast={AVAILABLE} sim={sim} />);
    expect(within(costBlock()).getByText(t("en-US", "simHistogramBeyond"))).toBeInTheDocument();
  });

  it("names the missing spend history with both counts", () => {
    const sim: BudgetSim = { ...SIM_ON, eur: { kind: "unavailable", reason: "spend-history", spendDays: 7, neededSpendDays: 20 } };
    render(<Cards lang="en-US" forecast={AVAILABLE} sim={sim} />);
    expect(screen.getByText("Needs 20 working days of booking history in the window (has 7).")).toBeInTheDocument();
  });

  it("says no bookings fell in the window when every sample is zero (no-spend)", () => {
    const sim: BudgetSim = { ...SIM_ON, eur: { kind: "unavailable", reason: "no-spend", spendDays: 60, neededSpendDays: 20 } };
    render(<Cards lang="en-US" forecast={AVAILABLE} sim={sim} />);
    expect(within(costBlock()).getByText("No bookings in the history window yet.")).toBeInTheDocument();
    expect(screen.queryByText(/working days of booking history/)).toBeNull();
  });

  it("names the missing finished tasks when below the schedule floor", () => {
    const sim: BudgetSim = { ...SIM_ON, eur: { kind: "unavailable", reason: "schedule-floor", spendDays: 0, neededSpendDays: 20 } };
    render(<Cards lang="en-US" forecast={AVAILABLE} sim={sim} />);
    expect(screen.getByText("Not enough finished-task history to simulate the finish yet.")).toBeInTheDocument();
  });

  it("hides the chance row without a budget", () => {
    const sim: BudgetSim = { ...SIM_ON, eur: { ...(SIM_ON.eur as CostAtFinish & { kind: "sim" }), chanceOverBudget: null } };
    render(<Cards lang="en-US" forecast={AVAILABLE} sim={sim} />);
    expect(screen.queryByText("Chance over budget")).toBeNull();
    expect(screen.getByText("Safe to commit (P80)")).toBeInTheDocument();
  });

  it("leaves the calculated EAC figure unchanged with the simulation on", () => {
    render(<Cards lang="en-US" forecast={AVAILABLE} sim={SIM_ON} />);
    expect(screen.getByText(money(261150))).toBeInTheDocument();
    expect(screen.getByText(`${money(-21150)} (${formatSignedPercent(-21150 / 240000, locale, 1)})`)).toBeInTheDocument();
  });

  it("does not show the block on the efficiency card", () => {
    render(<Cards lang="en-US" view="efficiency" forecast={AVAILABLE} sim={SIM_ON} />);
    expect(screen.queryByRole("group", { name: "Cost at finish, simulated" })).toBeNull();
  });

  it("renders the German heading", () => {
    render(<Cards lang="de" forecast={AVAILABLE} sim={SIM_ON} />);
    expect(screen.getByRole("group", { name: t("de", "simValueSr", t("de", "budgetSimCostAtFinish")) })).toBeInTheDocument();
    expect(t("de", "budgetSimCostAtFinish")).not.toBe("Cost at finish");
  });
});
