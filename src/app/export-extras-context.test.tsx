// §502 part 4 — the forecast decision source in the export extras: in the context for the document leaves and the
// Projects panel's export, and handed explicitly to the two workspace exports (`workspaceExportExtras`).
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { useEffect } from "react";
import { ExportExtrasProvider, useExportExtras, useForecastDecisionLive, workspaceExportExtras } from "./export-extras-context";
import type { ExportExtras } from "./export-forecast-section";
import type { ForecastDecisionHandle, ForecastDecisionLive, ForecastDecisionSource } from "./forecast-decision";
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
    expect(screen.getByTestId("keys").textContent).toBe("budgetForecast,forecastDecision");
    rerender(<ExportExtrasProvider forecast={null} forecastDecision={handle}><Keys /></ExportExtrasProvider>);
    expect(screen.getByTestId("keys").textContent).toBe("forecastDecision");
  });

  // Third review M2 — the handle changes on every task edit; the extras must not, or every consumer under a memoised
  // panel re-renders. The stable thunk still answers with the LATEST source.
  it("keeps one value across new handles, while its source answers from the latest handle", () => {
    const seen: ExportExtras[] = [];
    function Probe() {
      const extras = useExportExtras();
      useEffect(() => { if (seen.at(-1) !== extras) seen.push(extras); });
      return null;
    }
    const forecast = forecastBundleFixture();
    const next: ForecastDecisionHandle = { ...handle, source: () => ({ insufficient: true, goal: 95 }) };
    const { rerender } = render(<ExportExtrasProvider forecast={forecast} forecastDecision={handle}><Probe /></ExportExtrasProvider>);
    expect(seen.at(-1)?.forecastDecision?.()).toEqual({ insufficient: true, goal: 80 });
    rerender(<ExportExtrasProvider forecast={forecast} forecastDecision={next}><Probe /></ExportExtrasProvider>);
    expect(seen).toHaveLength(1);
    expect(seen[0].forecastDecision?.()).toEqual({ insufficient: true, goal: 95 });
    // Positive control: the value does change when the section's presence or the bundle changes.
    rerender(<ExportExtrasProvider forecast={forecast} forecastDecision={null}><Probe /></ExportExtrasProvider>);
    expect(seen).toHaveLength(2);
    expect(seen[1].forecastDecision).toBeUndefined();
  });

  it("hands the live half to previews through its own context, which follows the handle", () => {
    const lives: (ForecastDecisionLive | undefined)[] = [];
    function LiveProbe() {
      lives.push(useForecastDecisionLive());
      return null;
    }
    const next: ForecastDecisionHandle = { ...handle, live: { ...handle.live, goal: 95 } };
    const { rerender } = render(<ExportExtrasProvider forecast={null} forecastDecision={handle}><LiveProbe /></ExportExtrasProvider>);
    rerender(<ExportExtrasProvider forecast={null} forecastDecision={next}><LiveProbe /></ExportExtrasProvider>);
    rerender(<ExportExtrasProvider forecast={null} forecastDecision={null}><LiveProbe /></ExportExtrasProvider>);
    expect(lives.at(0)).toBe(handle.live);
    expect(lives).toContain(next.live);
    expect(lives.at(-1)).toBeUndefined();
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
