import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { RateMixDetails } from "./budget-rate-mix-details";
import { rateMixExplanation } from "./budget-rate-mix-text";
import { EUR_FORECAST, HOURS_FORECAST_HOURS_WORSE, MIX_HOURS_WORSE, MIX_ON_PLAN } from "../test/forecast-fixtures";

const props = { lang: "en-US" as const, eur: EUR_FORECAST, hours: HOURS_FORECAST_HOURS_WORSE, onToggle: vi.fn() };

describe("RateMixDetails", () => {
  it("is collapsed by default and lists every row with planned and booked shares", () => {
    const { container } = render(<RateMixDetails {...props} mix={MIX_HOURS_WORSE} open={false} focusNonce={0} />);
    expect(container.querySelector("details")!.open).toBe(false);
    const rows = screen.getAllByRole("row").slice(1);
    expect(rows).toHaveLength(3);
    const junior = rows[2];
    expect(within(junior).getByText("Consultant Junior")).toBeInTheDocument();
    expect(within(junior).getByText("30%")).toBeInTheDocument();
    expect(within(junior).getByText("37%")).toBeInTheDocument();
    expect(within(junior).getByText("+7 pts")).toBeInTheDocument();
    // Controller ruling P14: "used of budget" reads "{n} of {budget h} ({pct})"
    // — a plain number for the actual hours, not "{n} h of {budget h}".
    expect(within(junior).getByText("539 of 600 h (90%)")).toBeInTheDocument();
  });

  it("marks only the driver row with the Driver badge", () => {
    render(<RateMixDetails {...props} mix={MIX_HOURS_WORSE} open focusNonce={0} />);
    expect(screen.getAllByText("Driver")).toHaveLength(1);
    expect(screen.getByText("Driver").closest("tr")).toHaveTextContent("Consultant Junior");
  });

  it("explains the mix in the footnote, or says it is on plan", () => {
    const { rerender } = render(<RateMixDetails {...props} mix={MIX_HOURS_WORSE} open focusNonce={0} />);
    expect(screen.getByText(rateMixExplanation("en-US", MIX_HOURS_WORSE, EUR_FORECAST, HOURS_FORECAST_HOURS_WORSE))).toBeInTheDocument();
    rerender(<RateMixDetails {...props} mix={MIX_ON_PLAN} open focusNonce={0} />);
    expect(screen.getByText("No role is 3 points or more off its planned share.")).toBeInTheDocument();
  });

  it("moves focus to its summary when the focus nonce changes", () => {
    const { rerender, container } = render(<RateMixDetails {...props} mix={MIX_HOURS_WORSE} open={false} focusNonce={0} />);
    rerender(<RateMixDetails {...props} mix={MIX_HOURS_WORSE} open focusNonce={1} />);
    expect(document.activeElement).toBe(container.querySelector("summary"));
  });
});
