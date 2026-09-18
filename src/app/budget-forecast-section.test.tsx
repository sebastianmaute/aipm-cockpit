import { beforeEach, describe, it, expect } from "vitest";
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ForecastSection } from "./budget-forecast-section";
import { SETTINGS_KEY } from "./use-settings";
import { defaultSettings } from "./settings-types";
import { t } from "./i18n";
import { BUNDLE_HOURS_WORSE } from "../test/forecast-fixtures";

const PACE = t("en-US", "forecastPaceTitle");
const EFF = t("en-US", "forecastEfficiencyTitle");

describe("ForecastSection", () => {
  beforeEach(() => localStorage.clear());

  it("opens the role mix from the banner and focuses its summary", () => {
    const { container } = render(<ForecastSection lang="en-US" bundle={BUNDLE_HOURS_WORSE} granularity="month" />);
    const details = container.querySelector("details")!;
    expect(details.open).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Where the hours went" }));
    expect(details.open).toBe(true);
    expect(document.activeElement).toBe(container.querySelector("summary"));
  });

  it("does not move focus when the role mix disappears and comes back after a live edit", () => {
    // The section keeps its focus nonce while `mix` goes null; when the mix
    // returns, the details remount and must not grab focus without a click.
    const { container, rerender } = render(<ForecastSection lang="en-US" bundle={BUNDLE_HOURS_WORSE} granularity="month" />);
    fireEvent.click(screen.getByRole("button", { name: "Where the hours went" }));
    expect(document.activeElement).toBe(container.querySelector("summary"));
    rerender(<ForecastSection lang="en-US" bundle={{ ...BUNDLE_HOURS_WORSE, mix: null }} granularity="month" />);
    expect(container.querySelector("summary")).toBeNull();
    rerender(<ForecastSection lang="en-US" bundle={BUNDLE_HOURS_WORSE} granularity="month" />);
    const summary = container.querySelector("summary");
    expect(summary).not.toBeNull();
    expect(document.activeElement).not.toBe(summary);
  });

  // Migrated from "renders the cards with their hours lines" (2): one card now.
  it("renders the chosen card with its hours line", () => {
    render(<ForecastSection lang="en-US" bundle={BUNDLE_HOURS_WORSE} granularity="month" />);
    expect(screen.getAllByText("In hours")).toHaveLength(1);
  });

  it("defaults to the pace card and persists a switch to efficiency as the device setting", async () => {
    render(<ForecastSection lang="en-US" bundle={BUNDLE_HOURS_WORSE} granularity="month" />);
    await act(async () => {});
    expect(screen.getByRole("region", { name: PACE })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: EFF }));
    expect(screen.getByRole("region", { name: EFF })).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: PACE })).toBeNull();
    await waitFor(() => {
      const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") as { budgetForecastView?: string };
      expect(stored.budgetForecastView).toBe("efficiency");
    });
  });

  it("opens on a persisted efficiency choice", async () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ ...defaultSettings, budgetForecastView: "efficiency" }));
    render(<ForecastSection lang="en-US" bundle={BUNDLE_HOURS_WORSE} granularity="month" />);
    await act(async () => {});
    expect(screen.getByRole("region", { name: EFF })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: EFF })).toHaveAttribute("aria-checked", "true");
  });
});
