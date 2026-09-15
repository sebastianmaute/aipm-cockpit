import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { forecastLinkText, BudgetForecastLink } from "./budget-forecast-link";
import type { BudgetForecast } from "./budget-forecast";

// Same §5.6 worked example as budget-forecast-headline.test.tsx: BAC €240,000;
// pace EAC €261,150 (VAC -8.8%); efficiency EAC €270,968 (VAC -12.9%).
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

describe("forecastLinkText", () => {
  it("both pace and efficiency available: EAC range, low first", () => {
    const forecast = forecastWith(PACE, EFFICIENCY);
    expect(forecastLinkText(forecast, "en-US")).toBe("Forecast: EAC €261K–€271K");
  });

  it("orders the range low-first even when efficiency's EAC is lower", () => {
    const lowerEfficiency: BudgetForecast["efficiency"] = { ...EFFICIENCY, eac: 200000, vac: 40000 };
    const forecast = forecastWith(PACE, lowerEfficiency);
    expect(forecastLinkText(forecast, "en-US")).toBe("Forecast: EAC €200K–€261K");
  });

  it("efficiency unavailable: pace EAC alone", () => {
    const forecast = forecastWith(PACE, { unavailable: "needs-percent-complete", bucketsMissingPercent: [{ id: 1, name: "Design" }] });
    expect(forecastLinkText(forecast, "en-US")).toBe("Forecast: EAC €261K");
  });

  it("pace not-enough-bookings with an availableFrom date", () => {
    const forecast = forecastWith(
      { unavailable: "not-enough-bookings", firstBookingDate: "2026-09-15", bookedWorkingDays: 5, availableFrom: "2026-10-13" },
      EFFICIENCY,
    );
    expect(forecastLinkText(forecast, "en-US")).toBe("Forecast from Oct 13, 2026");
  });

  it("pace not-enough-bookings with nothing booked at all", () => {
    const forecast = forecastWith(
      { unavailable: "not-enough-bookings", firstBookingDate: null, bookedWorkingDays: 0, availableFrom: null },
      EFFICIENCY,
    );
    expect(forecastLinkText(forecast, "en-US")).toBe("Forecast starts once hours are booked");
  });

  it("pace no-burn: no recent bookings", () => {
    const forecast = forecastWith(
      { unavailable: "no-burn", windowStart: "2026-08-17", windowEnd: "2026-09-11", lastBookingDate: "2026-08-03" },
      EFFICIENCY,
    );
    expect(forecastLinkText(forecast, "en-US")).toBe("No recent bookings");
  });
});

describe("BudgetForecastLink", () => {
  it("renders the link text, a decorative arrow, and a Budget Report button that opens on click", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    const forecast = forecastWith(PACE, EFFICIENCY);
    render(<BudgetForecastLink lang="en-US" forecast={forecast} onOpen={onOpen} />);

    expect(screen.getByText("Forecast: EAC €261K–€271K")).toBeInTheDocument();
    const arrow = screen.getByText("→");
    expect(arrow).toHaveAttribute("aria-hidden", "true");

    const button = screen.getByRole("button", { name: "Budget Report" });
    await user.click(button);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
