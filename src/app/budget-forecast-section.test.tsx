import { describe, it, expect } from "vitest";
import { act, render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ForecastSection } from "./budget-forecast-section";
import { SETTINGS_KEY } from "./use-settings";
import { defaultSettings } from "./settings-types";
import { t } from "./i18n";
import { BUNDLE_HOURS_WORSE } from "../test/forecast-fixtures";

// localStorage is cleared after every test by vitest.setup.ts's global afterEach.

const PACE = t("en-US", "forecastPaceTitle");
const EFF = t("en-US", "forecastEfficiencyTitle");
const CHART = <div data-testid="chart-slot">chart</div>;

/** Walk up from `el` until an ancestor carries `cls` (mirrors the idiom in
 *  `budget-report-panel.test.tsx`), throwing rather than returning null so a
 *  broken lookup fails at the call site with a clear message. */
const ancestorWithClass = (el: Element, cls: string): HTMLElement => {
  for (let n = el.parentElement; n; n = n.parentElement) if (n.classList.contains(cls)) return n;
  throw new Error(`no ancestor of ${el.tagName} carries class "${cls}"`);
};

/** The row is the chart slot's ancestor carrying the row's own `xl:flex-row` class. */
const rowOf = () => ancestorWithClass(screen.getByTestId("chart-slot"), "xl:flex-row");

describe("ForecastSection", () => {
  it("opens the role mix from the banner and focuses its summary", () => {
    const { container } = render(<ForecastSection lang="en-US" bundle={BUNDLE_HOURS_WORSE} granularity="month" chart={CHART} />);
    const details = container.querySelector("details")!;
    expect(details.open).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Where the hours went" }));
    expect(details.open).toBe(true);
    expect(document.activeElement).toBe(container.querySelector("summary"));
  });

  it("does not move focus when the role mix disappears and comes back after a live edit", () => {
    // The section keeps its focus nonce while `mix` goes null; when the mix
    // returns, the details remount and must not grab focus without a click.
    const { container, rerender } = render(<ForecastSection lang="en-US" bundle={BUNDLE_HOURS_WORSE} granularity="month" chart={CHART} />);
    fireEvent.click(screen.getByRole("button", { name: "Where the hours went" }));
    expect(document.activeElement).toBe(container.querySelector("summary"));
    rerender(<ForecastSection lang="en-US" bundle={{ ...BUNDLE_HOURS_WORSE, mix: null }} granularity="month" chart={CHART} />);
    expect(container.querySelector("summary")).toBeNull();
    rerender(<ForecastSection lang="en-US" bundle={BUNDLE_HOURS_WORSE} granularity="month" chart={CHART} />);
    const summary = container.querySelector("summary");
    expect(summary).not.toBeNull();
    expect(document.activeElement).not.toBe(summary);
  });

  it("renders the chosen card with its hours line", () => {
    render(<ForecastSection lang="en-US" bundle={BUNDLE_HOURS_WORSE} granularity="month" chart={CHART} />);
    expect(screen.getAllByText("In hours")).toHaveLength(1);
  });

  it("defaults to the pace card and persists a switch to efficiency as the device setting", async () => {
    render(<ForecastSection lang="en-US" bundle={BUNDLE_HOURS_WORSE} granularity="month" chart={CHART} />);
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
    render(<ForecastSection lang="en-US" bundle={BUNDLE_HOURS_WORSE} granularity="month" chart={CHART} />);
    await act(async () => {});
    expect(screen.getByRole("region", { name: EFF })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: EFF })).toHaveAttribute("aria-checked", "true");
  });

  // jsdom has no layout: the 30/70 split and the xl breakpoint are pinned by
  // the classes that produce them (spec B, Layout and Decision 8).
  it("puts the card column (30% from xl) and the chart side by side from xl, card first, stacking below xl", () => {
    render(<ForecastSection lang="en-US" bundle={BUNDLE_HOURS_WORSE} granularity="month" chart={CHART} />);
    const row = rowOf();
    expect(row).toHaveClass("flex", "flex-col", "gap-3", "xl:flex-row");
    expect(row.children).toHaveLength(2);
    const [cardCol, chartCol] = Array.from(row.children) as HTMLElement[];
    expect(cardCol).toHaveClass("xl:w-[30%]");
    expect(cardCol).toContainElement(screen.getByRole("region", { name: PACE }));
    expect(cardCol).toContainElement(screen.getByRole("radiogroup", { name: t("en-US", "forecastViewLabel") }));
    expect(chartCol).toHaveClass("min-w-0", "flex-1");
    expect(chartCol).toContainElement(screen.getByTestId("chart-slot"));
  });

  it("keeps the banners and the role-mix note above the row", () => {
    const { container } = render(<ForecastSection lang="en-US" bundle={BUNDLE_HOURS_WORSE} granularity="month" chart={CHART} />);
    const row = rowOf();
    const banner = screen.getByRole("button", { name: "Where the hours went" });
    const details = container.querySelector("details")!;
    expect(banner.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(details.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(row.contains(details)).toBe(false);
  });

  it("renders belowRow after the row, outside it, at the section's full width", () => {
    render(
      <ForecastSection
        lang="en-US" bundle={BUNDLE_HOURS_WORSE} granularity="month" chart={CHART}
        belowRow={<div data-testid="below-row" />}
      />,
    );
    const row = rowOf();
    const below = screen.getByTestId("below-row");
    expect(row.contains(below)).toBe(false);
    expect(row.compareDocumentPosition(below) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(below.parentElement).toBe(row.parentElement);
  });
});
