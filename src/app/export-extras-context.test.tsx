// §502 part 4 — the forecast decision source in the export extras: in the context for the document leaves, and
// PUBLISHED by the main window for the header Export menu and the voice export, which sit outside the provider.
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ExportExtrasProvider, useExportExtras, withPublishedForecastDecision } from "./export-extras-context";
import type { ForecastDecisionHandle, ForecastDecisionSource } from "./forecast-decision";
import { forecastBundleFixture } from "../test/forecast-bundle-fixture";

const source: ForecastDecisionSource = () => ({ insufficient: true, goal: 80 });
const handle: ForecastDecisionHandle = { source, live: { goal: 80, input: () => null, base: () => null } };

function Keys() {
  return <p data-testid="keys">{Object.keys(useExportExtras()).sort().join(",")}</p>;
}

afterEach(cleanup);

describe("ExportExtrasProvider — forecastDecision", () => {
  it("adds the key only with a source: off, the extras are exactly what they were", () => {
    const forecast = forecastBundleFixture();
    const { rerender } = render(<ExportExtrasProvider forecast={forecast}><Keys /></ExportExtrasProvider>);
    expect(screen.getByTestId("keys").textContent).toBe("budgetForecast");
    rerender(<ExportExtrasProvider forecast={forecast} forecastDecision={handle}><Keys /></ExportExtrasProvider>);
    expect(screen.getByTestId("keys").textContent).toBe("budgetForecast,forecastDecision,forecastDecisionLive");
    rerender(<ExportExtrasProvider forecast={null} forecastDecision={handle}><Keys /></ExportExtrasProvider>);
    expect(screen.getByTestId("keys").textContent).toBe("forecastDecision,forecastDecisionLive");
  });

  it("publishes the source while mounted with `publish`, and withdraws it on unmount", () => {
    expect(withPublishedForecastDecision({ budgetForecast: null })).toEqual({ budgetForecast: null });
    const { unmount } = render(<ExportExtrasProvider forecast={null} forecastDecision={handle} publish><Keys /></ExportExtrasProvider>);
    expect(withPublishedForecastDecision({ budgetForecast: null })).toEqual({ budgetForecast: null, forecastDecision: source });
    unmount();
    expect(withPublishedForecastDecision({ budgetForecast: null })).toEqual({ budgetForecast: null });
  });

  it("withdraws it when the simulation goes off (the source becomes null)", () => {
    const { rerender } = render(<ExportExtrasProvider forecast={null} forecastDecision={handle} publish><Keys /></ExportExtrasProvider>);
    rerender(<ExportExtrasProvider forecast={null} forecastDecision={null} publish><Keys /></ExportExtrasProvider>);
    expect(withPublishedForecastDecision({})).toEqual({});
  });

  it("never publishes from a popout (`publish` off)", () => {
    render(<ExportExtrasProvider forecast={null} forecastDecision={handle}><Keys /></ExportExtrasProvider>);
    expect(withPublishedForecastDecision({})).toEqual({});
  });
});
