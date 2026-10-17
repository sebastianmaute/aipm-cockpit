// §502 — the forecast tools as the chat dispatcher implements them: the token round trip, replace
// semantics with `removedRows`, undo capture, refusals that write nothing, and the staging classification.
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { dispatcherWrapperWith, makeDispatcherArgs } from "../test/chat-dispatcher-fixture";
import { showForecastView } from "../test/forecast-view";
import { entityToken } from "./ai-entity-token";
import { buildPlanRows, shouldStage, type ProposedCall } from "./chat-proposal";
import { liveRowTitle } from "./chat-proposal-stage";
import { runTool } from "./chat-tools";
import type { Workspace } from "./workspace";
import type { ChatDispatcherArgs } from "./chat-dispatcher-types";
import { DEFAULT_HISTORY_WINDOW } from "./forecast/constants";
import type { ForecastReportInput } from "./forecast-ai-report";
import type { ForecastScenario, ScenarioChange } from "./forecast-scenarios";
import { t } from "./i18n";
import { __resetMintStateForTests } from "./id-mint-session";
import { defaultSettings } from "./settings-types";
import type { TestSeed } from "./test-providers";
import { useChatDispatcher } from "./use-chat-dispatcher";
import { useUndoStack } from "./undo/use-undo-stack";
import { useWorkspace } from "./workspace-context";

const AVAIL: ScenarioChange = { kind: "availability", percent: 120, from: "2026-06-01", until: "" };
const SCOPE: ScenarioChange = { kind: "scope", tasks: 5, on: "2026-06-15" };
const SAVED: ForecastScenario = { id: 1, name: "Contractor in January", changes: [AVAIL, SCOPE] };
const ON = { forecast: { showSimulation: true } };
const LOADING = "The holiday calendar is still loading; try again in a moment.";
const CAP = "This project already has 4 saved scenarios, the most it can keep. Ask the user to delete one first.";
const READ_ONLY = t(defaultSettings.language, "popoutReadOnly");

function makeInput(): ForecastReportInput {
  return {
    run: {
      tasks: [], milestones: [], today: "2026-05-19", holidaySet: new Set<string>(),
      window: DEFAULT_HISTORY_WINDOW, unit: "tasks", planEnd: "2026-12-31",
      directory: {
        resources: [], roles: [], shifts: [], absences: [], budgets: [], fxRates: null, workdayHours: 8,
        baseCurrency: "EUR",
      },
      budgetFacts: null, costOn: false,
    },
    history: [],
    scenarios: [],
    currency: "EUR",
  };
}

function scenario(id: number, name: string): ForecastScenario {
  return { id, name, changes: [] };
}

/** The REAL undo stack and the REAL dispatcher in one hook body, with a logging spy. */
function mount(seed: TestSeed, over: Partial<ChatDispatcherArgs> = {}) {
  const logActivityAs = vi.fn();
  const view = renderHook(
    () => {
      const undo = useUndoStack({ lang: "en-US", logActivity: vi.fn(), showToast: vi.fn(), showToastAction: vi.fn() });
      const dispatcher = useChatDispatcher(
        makeDispatcherArgs({ undo, logActivityAs, getForecastInput: () => makeInput(), ...over }),
      );
      const { forecastScenarios, setSettingsOverrides } = useWorkspace();
      return { undo, dispatcher, forecastScenarios, setSettingsOverrides };
    },
    { wrapper: dispatcherWrapperWith({ settingsOverrides: ON, ...seed }) },
  );
  return { ...view, logActivityAs };
}

beforeEach(() => {
  __resetMintStateForTests();
  showForecastView();
});
afterEach(() => vi.restoreAllMocks());

describe("update_forecast_scenario", () => {
  test("applies with the token taken OUT of get_forecast's report", async () => {
    const { result } = mount({ forecastScenarios: [SAVED] });
    const report = result.current.dispatcher.getForecast(null);
    const expectedToken = report.scenarios[0].expectedToken;
    expect(expectedToken).toBe(entityToken("forecastScenario", SAVED));

    let out: unknown;
    await act(async () => {
      out = await runTool(result.current.dispatcher, "update_forecast_scenario", { id: 1, name: "Two contractors", expectedToken });
    });

    expect(out).toMatchObject({ id: 1, name: "Two contractors" });
    expect(result.current.forecastScenarios[0].name).toBe("Two contractors");
  });

  test("a create, then an update of the minted id in the same turn, sees the create", async () => {
    const { result } = mount({});
    let created: { id: number; expectedToken: string } | undefined;
    await act(async () => {
      created = (await runTool(result.current.dispatcher, "create_forecast_scenario", { name: "A", changes: [] })) as typeof created;
      await runTool(result.current.dispatcher, "update_forecast_scenario", {
        id: created!.id, name: "B", expectedToken: created!.expectedToken,
      });
    });
    expect(result.current.forecastScenarios.map((s) => s.name)).toEqual(["B"]);
  });

  test("changes: [] replaces a 2-row list, reports removedRows 2, and one undo restores both rows", () => {
    const { result } = mount({ forecastScenarios: [SAVED] });
    let out: { removedRows?: number } | undefined;
    act(() => {
      out = result.current.dispatcher.updateForecastScenario(1, { changes: [] });
    });
    expect(out?.removedRows).toBe(2);
    expect(result.current.forecastScenarios[0].changes).toEqual([]);
    expect(result.current.undo.stack).toHaveLength(1);

    act(() => { result.current.undo.undo(); });

    expect(result.current.forecastScenarios[0].changes).toEqual([AVAIL, SCOPE]);
    expect(result.current.undo.stack).toHaveLength(0);
  });

  test("removedRows counts only the stored rows the new list drops, and is absent for a rename", () => {
    const { result } = mount({ forecastScenarios: [SAVED] });
    let replaced: { removedRows?: number } | undefined;
    let renamed: { removedRows?: number } | undefined;
    act(() => {
      replaced = result.current.dispatcher.updateForecastScenario(1, { changes: [SCOPE, { ...AVAIL, percent: 150 }] });
    });
    act(() => {
      renamed = result.current.dispatcher.updateForecastScenario(1, { name: "Renamed" });
    });
    expect(replaced?.removedRows).toBe(1);
    expect(renamed).not.toHaveProperty("removedRows");
  });

  test("a refused update writes nothing: no row change, no log, no undo entry", () => {
    const { result, logActivityAs } = mount({ forecastScenarios: [SAVED] });
    const before = result.current.forecastScenarios;
    expect(() =>
      act(() => {
        result.current.dispatcher.updateForecastScenario(1, { changes: [{ ...AVAIL, percent: 5 }] });
      }),
    ).toThrow("changes[0]: percent must be between 10 and 300");
    // ★★ Flush first: an `act` whose callback throws does not flush, so a setter call made before the throw
    //  would only render on the NEXT act — reading the slice right away would pass for the wrong reason.
    act(() => {});
    expect(result.current.forecastScenarios).toBe(before);
    expect(result.current.dispatcher.getForecastScenarioRow(1)).toBe(before[0]);
    expect(logActivityAs).not.toHaveBeenCalled();
    expect(result.current.undo.stack).toHaveLength(0);
  });

  test("an update that changes nothing writes, logs and captures nothing", () => {
    const { result, logActivityAs } = mount({ forecastScenarios: [SAVED] });
    const before = result.current.forecastScenarios;
    act(() => {
      result.current.dispatcher.updateForecastScenario(1, { name: SAVED.name, changes: [AVAIL, SCOPE] });
    });
    expect(result.current.forecastScenarios).toBe(before);
    expect(logActivityAs).not.toHaveBeenCalled();
    expect(result.current.undo.stack).toHaveLength(0);
  });

  test("logs one forecastScenario.updated row as the AI", () => {
    const { result, logActivityAs } = mount({ forecastScenarios: [SAVED] });
    act(() => {
      result.current.dispatcher.updateForecastScenario(1, { name: "Renamed" });
    });
    expect(logActivityAs).toHaveBeenCalledTimes(1);
    expect(logActivityAs).toHaveBeenCalledWith("ai", "forecastScenario.updated", 1, "Renamed");
  });
});

describe("create_forecast_scenario", () => {
  test("is not undo-captured and logs one forecastScenario.created row as the AI", () => {
    const { result, logActivityAs } = mount({});
    let id: number | undefined;
    act(() => {
      id = result.current.dispatcher.createForecastScenario("  Hire  ", [AVAIL]).id;
    });
    expect(result.current.forecastScenarios).toEqual([{ id, name: "Hire", changes: [AVAIL] }]);
    expect(result.current.undo.stack).toHaveLength(0);
    expect(logActivityAs).toHaveBeenCalledTimes(1);
    expect(logActivityAs).toHaveBeenCalledWith("ai", "forecastScenario.created", id, "Hire");
  });

  test.each([4, 5])("is refused with the cap text on a %i-scenario list (5 = restored by undo)", (n) => {
    const list = Array.from({ length: n }, (_, i) => scenario(i + 1, `S${i + 1}`));
    const { result, logActivityAs } = mount({ forecastScenarios: list });
    expect(() => result.current.dispatcher.createForecastScenario("New", [])).toThrow(CAP);
    act(() => {}); // flush anything a write before the throw would have queued
    expect(result.current.forecastScenarios).toHaveLength(n);
    expect(logActivityAs).not.toHaveBeenCalled();
  });
});

describe("refusals before any work", () => {
  test("a popout refuses both writes", () => {
    const { result } = mount({ forecastScenarios: [SAVED] }, { isReadOnly: true });
    expect(() => result.current.dispatcher.createForecastScenario("New", [])).toThrow(READ_ONLY);
    expect(() => result.current.dispatcher.updateForecastScenario(1, { name: "X" })).toThrow(READ_ONLY);
    act(() => {});
    expect(result.current.forecastScenarios).toEqual([SAVED]);
  });

  test("all three tools refuse while the holiday calendar loads", async () => {
    const { result } = mount({ forecastScenarios: [SAVED] }, { getForecastInput: () => null });
    const d = result.current.dispatcher;
    const expectedToken = entityToken("forecastScenario", SAVED);
    await expect(runTool(d, "get_forecast", {})).rejects.toThrow(LOADING);
    await expect(runTool(d, "create_forecast_scenario", { name: "New", changes: [] })).rejects.toThrow(LOADING);
    await expect(runTool(d, "update_forecast_scenario", { id: 1, name: "X", expectedToken })).rejects.toThrow(LOADING);
    act(() => {});
    expect(result.current.forecastScenarios).toEqual([SAVED]);
  });
});

describe("the simulation predicate", () => {
  test("getSnapshot().forecastSimulation and isForecastEnabled follow isSimulationActive, live", () => {
    const { result } = mount({});
    expect(result.current.dispatcher.getSnapshot().forecastSimulation).toBe(true);
    expect(result.current.dispatcher.isForecastEnabled()).toBe(true);

    act(() => { result.current.setSettingsOverrides(undefined); });
    expect(result.current.dispatcher.getSnapshot().forecastSimulation).toBe(false);
    expect(result.current.dispatcher.isForecastEnabled()).toBe(false);
  });

  test("is false while the Forecast view is held back, with the switch stored on", () => {
    vi.restoreAllMocks();
    const { result } = mount({});
    expect(result.current.dispatcher.getSnapshot().forecastSimulation).toBe(false);
    expect(result.current.dispatcher.isForecastEnabled()).toBe(false);
  });
});

describe("staging", () => {
  const call = (name: string, input: Record<string, unknown> = {}): ProposedCall => ({ name, input });
  const create = call("create_forecast_scenario", { name: "A", changes: [] });

  test("one create applies; a create plus an update stages", () => {
    expect(shouldStage([create])).toBe(false);
    expect(shouldStage([create, call("update_forecast_scenario", { id: 900, name: "B" })])).toBe(true);
  });

  test("an update of the create's minted id depends on that create", () => {
    const rows = buildPlanRows([create, call("update_forecast_scenario", { id: 900, name: "B" })], [900]);
    expect(rows[0].mintedId).toBe(900);
    expect(rows[1].dependsOn).toBe(0);
  });

  test("the card names the scenario and counts the rows", () => {
    const ws = { forecastScenarios: [SAVED] } as unknown as Workspace;
    expect(liveRowTitle(call("create_forecast_scenario", { name: "Hire", changes: [AVAIL, SCOPE, AVAIL] }), ws))
      .toBe('Save scenario "Hire" (3 changes)');
    expect(liveRowTitle(call("update_forecast_scenario", { id: 1, changes: [AVAIL] }), ws))
      .toBe('Edit scenario "Contractor in January" (1 change)');
    expect(liveRowTitle(call("update_forecast_scenario", { id: 1, name: "Renamed" }), ws))
      .toBe('Edit scenario "Contractor in January" → "Renamed"');
    // A target minted earlier in the same plan is not stored yet: the call's own name labels it.
    expect(liveRowTitle(call("update_forecast_scenario", { id: 900, name: "B", changes: [] }), ws))
      .toBe('Edit scenario "B" (0 changes)');
  });
});
