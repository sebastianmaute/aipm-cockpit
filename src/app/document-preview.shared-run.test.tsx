// §502 part 4 (third review M3) — a document preview of a forecastDecision block on the Documents tab runs the
// 10,000-trial schedule ONCE per input change, even with nothing else warming the app memo (the Milestones module
// off: `useNextActions` then runs no forecast). The preview's base and its lever search's prepare step both take the
// shared app run (`sharedAsIsRun` → `computeAppScheduleRun`), so the base's run IS the memo entry; the probes carry
// scenario changes and are not As-is runs.
import { afterEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";

// Call-through spy: the engine runs for real, the spy only counts.
const fc = vi.hoisted(() => ({ engine: vi.fn() }));
vi.mock("./forecast/index", async (orig) => {
  const real = await orig<typeof import("./forecast/index")>();
  fc.engine.mockImplementation(real.computeScheduleForecast as never);
  return { ...real, computeScheduleForecast: fc.engine };
});
vi.mock("./document-assets-store", () => ({
  loadAssetData: vi.fn(), saveAssetData: vi.fn(), deleteAssetData: vi.fn(), loadAssetDataIds: vi.fn(async () => []),
}));

import { DocumentPreview } from "./document-preview";
import { ExportExtrasProvider } from "./export-extras-context";
import {
  buildForecastDecisionBase, forecastDecisionSource, once, type ForecastDecisionArgs, type ForecastDecisionHandle,
} from "./forecast-decision";
import type { ProjectDocument } from "./document-model";
import type { ScenarioRunInput } from "./forecast-scenario-compare";
import { emptyWorkspace } from "./workspace";
import { decisionInput } from "../test/forecast-decision-fixture";

const NOW = "2026-10-14T00:00:00.000Z";
const DOC: ProjectDocument = {
  id: 1, title: "Steering", createdAt: NOW, updatedAt: NOW, blocks: [{ type: "dataSection", key: "forecastDecision" }],
};

/** A handle as `useForecastDecisionSource` builds it: the app-wide defaults, so the app memo can answer. */
function handleFor(input: ScenarioRunInput): ForecastDecisionHandle {
  const args = (): ForecastDecisionArgs => ({ simulationActive: true, input, scenarios: [], settingsOverrides: undefined });
  return { source: forecastDecisionSource(args), live: { goal: 80, input: () => input, base: once(() => buildForecastDecisionBase(args())) } };
}
/** A fresh task list each call: the app memo is module-wide, so a reused list would hit an earlier entry. */
const freshInput = () => decisionInput({ tasks: [...decisionInput().tasks] });
const asIsCalls = () => fc.engine.mock.calls.filter(([args]) => !("changes" in (args as object))).length;

async function drain() {
  for (let i = 0; i < 500 && vi.getTimerCount() > 0; i++) await act(async () => { vi.runOnlyPendingTimers(); });
  expect(vi.getTimerCount()).toBe(0);
}

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("DocumentPreview — one As-is run per input change with nothing else warming the memo (§502)", () => {
  test("the base and the lever search share one engine call; a new input is one more", async () => {
    vi.useFakeTimers();
    fc.engine.mockClear();
    const first = handleFor(freshInput());
    const ui = (h: ForecastDecisionHandle) => (
      <ExportExtrasProvider forecast={null} forecastDecision={h}>
        <DocumentPreview lang="en-GB" doc={DOC} ws={emptyWorkspace()} />
      </ExportExtrasProvider>
    );
    const { rerender, getByText } = render(ui(first));
    // Positive control: the block really rendered from a forecast, and the search really started.
    expect(getByText(/Below target: Beta/)).toBeTruthy();
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    await drain();
    expect(asIsCalls()).toBe(1);

    rerender(ui(first));
    await drain();
    expect(asIsCalls()).toBe(1);

    rerender(ui(handleFor(freshInput())));
    await drain();
    expect(asIsCalls()).toBe(2);
  }, 30000);
});
