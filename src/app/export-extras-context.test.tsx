// §502 part 4 — the forecast decision source in the export extras: in the context for the document leaves and the
// Projects panel's export, and handed explicitly to the two workspace exports (`workspaceExportExtras`).
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { ExportExtrasProvider, useExportExtras, workspaceExportExtras } from "./export-extras-context";
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

});

describe("workspaceExportExtras — the two workspace exports' extras", () => {
  it("adds the decision only when there is a source: off, the extras are exactly the budget forecast", () => {
    const forecast = forecastBundleFixture();
    expect(workspaceExportExtras(forecast, null)).toEqual({ budgetForecast: forecast });
    expect(Object.keys(workspaceExportExtras(null, undefined))).toEqual(["budgetForecast"]);
    expect(workspaceExportExtras(null, source)).toEqual({ budgetForecast: null, forecastDecision: source });
  });
});
