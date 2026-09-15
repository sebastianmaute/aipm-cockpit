import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ForecastSection } from "./budget-forecast-section";
import { BUNDLE_HOURS_WORSE } from "../test/forecast-fixtures";

describe("ForecastSection", () => {
  it("opens the role mix from the banner and focuses its summary", () => {
    const { container } = render(<ForecastSection lang="en-US" bundle={BUNDLE_HOURS_WORSE} granularity="month" />);
    const details = container.querySelector("details")!;
    expect(details.open).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Where the hours went" }));
    expect(details.open).toBe(true);
    expect(document.activeElement).toBe(container.querySelector("summary"));
  });

  it("renders the cards with their hours lines", () => {
    render(<ForecastSection lang="en-US" bundle={BUNDLE_HOURS_WORSE} granularity="month" />);
    expect(screen.getAllByText("In hours")).toHaveLength(2);
  });
});
