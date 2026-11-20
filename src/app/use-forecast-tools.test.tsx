// §502 — the forecast tools as the chat dispatcher implements them: the token round trip, replace
// semantics with `removedRows`, undo capture, refusals that write nothing, and the staging classification.
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
// AI people protection: this file tests the feature, not the protection (`ai-people-gates.test.tsx`).
vi.mock("./ai-privacy-context", () => import("../test/ai-privacy-unprotected"));
import { dispatcherWrapperWith, makeDispatcherArgs } from "../test/chat-dispatcher-fixture";
import { showForecastView } from "../test/forecast-view";
import { entityToken } from "./ai-entity-token";
import { buildPlanRows, shouldStage, type ProposedCall } from "./chat-proposal";
import { forecastRowLine, type DescribedRow } from "./chat-proposal-describe";
import { liveRowTitle, proposalTitles } from "./chat-proposal-stage";
import { cardRowTitle } from "./chat-proposal-block";
import { runTool } from "./chat-tools";
import { FORECAST_OFF_MESSAGE } from "./chat-tools-forecast";
import type { Workspace } from "./workspace";
import type { ChatDispatcherArgs } from "./chat-dispatcher-types";
import { DEFAULT_HISTORY_WINDOW } from "./forecast/constants";
import { DIRECTORY_NAME_WITHHELD, type ForecastReportInput } from "./forecast-ai-report";
import { ALL_MODULE_IDS, type FeatureModuleId } from "./feature-modules";
import * as forecastFixture from "../test/forecast-report-fixture";
import type { ForecastScenario, ScenarioChange } from "./forecast-scenarios";
import { loadI18n, t } from "./i18n";
import { __resetMintStateForTests } from "./id-mint-session";
import { defaultSettings } from "./settings-types";
import type { TestSeed } from "./test-providers";
import { useChatDispatcher } from "./use-chat-dispatcher";
import { useUndoStack } from "./undo/use-undo-stack";
import { useWorkspace } from "./workspace-context";
import { aiOrigin } from "./activity-origin";

// Counts As-is runs: every one goes through `computeScenarioComparison`. A plain wrapper, not a `vi.fn`, so
// `vi.restoreAllMocks` in `afterEach` cannot strip its implementation.
const compare = vi.hoisted(() => ({ calls: 0 }));
vi.mock("./forecast-scenario-compare", async (orig) => {
  const m = await orig<typeof import("./forecast-scenario-compare")>();
  return {
    ...m,
    computeScenarioComparison: (...a: Parameters<typeof m.computeScenarioComparison>) => {
      compare.calls += 1;
      return m.computeScenarioComparison(...a);
    },
  };
});

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
    // ★ Never the live overrides: the tools must read those from the workspace (see "target and proposal").
    settingsOverrides: undefined,
  };
}

function scenario(id: number, name: string): ForecastScenario {
  return { id, name, changes: [] };
}

/** The REAL undo stack and the REAL dispatcher in one hook body, with a logging spy. */
function mount(seed: TestSeed, over: Partial<ChatDispatcherArgs> = {}) {
  const logActivityAi = vi.fn();
  const view = renderHook(
    () => {
      const undo = useUndoStack({ lang: "en-US", logActivity: vi.fn(), showToast: vi.fn(), showToastAction: vi.fn() });
      const dispatcher = useChatDispatcher(
        makeDispatcherArgs({ undo, logActivityAi, getForecastInput: () => makeInput(), ...over }),
      );
      const { forecastScenarios, setForecastScenarios, settingsOverrides, setSettingsOverrides } = useWorkspace();
      return { undo, dispatcher, forecastScenarios, setForecastScenarios, settingsOverrides, setSettingsOverrides };
    },
    { wrapper: dispatcherWrapperWith({ settingsOverrides: ON, ...seed }) },
  );
  return { ...view, logActivityAi };
}

beforeEach(() => {
  __resetMintStateForTests();
  showForecastView();
});
afterEach(() => vi.restoreAllMocks());

describe("get_forecast settings (§502 tooling)", () => {
  test("a call's window and unit reach the run; the defaults apply without them", () => {
    const { result } = mount({ forecastScenarios: [SAVED] });
    const custom = result.current.dispatcher.getForecast(null, { historyWindow: 30, unit: "tasks" });
    expect(custom.settings.historyWindowWorkingDays).toBe(30);
    expect(custom.whatItTakes).toEqual({ omitted: "settings" });
    const plain = result.current.dispatcher.getForecast(null);
    expect(plain.settings.historyWindowWorkingDays).toBe(60);
    expect(plain.whatItTakes).not.toHaveProperty("omitted");
    expect(plain.byGroup).toBeUndefined();
    expect(result.current.dispatcher.getForecast(null, { byGroup: true }).byGroup).toBeDefined();
  });
});

describe("update_forecast_scenario", () => {
  test("applies with the token taken OUT of get_forecast's report", async () => {
    const { result } = mount({ forecastScenarios: [SAVED] });
    const report = result.current.dispatcher.getForecast(null);
    const expectedToken = report.scenarios[0].expectedToken;
    expect(expectedToken).toBe(entityToken("forecastScenario", SAVED));

    let out: unknown;
    await act(async () => {
      out = await runTool(result.current.dispatcher, "update_forecast_scenario", { id: 1, name: "Two contractors", expectedToken }, aiOrigin("chat"));
    });

    expect(out).toMatchObject({ id: 1, name: "Two contractors" });
    expect(result.current.forecastScenarios[0].name).toBe("Two contractors");
  });

  test("a create, then an update of the minted id in the same turn, sees the create", async () => {
    const { result } = mount({});
    let created: { id: number; expectedToken: string } | undefined;
    await act(async () => {
      created = (await runTool(result.current.dispatcher, "create_forecast_scenario", { name: "A", changes: [] }, aiOrigin("chat"))) as typeof created;
      await runTool(result.current.dispatcher, "update_forecast_scenario", {
        id: created!.id, name: "B", expectedToken: created!.expectedToken,
      }, aiOrigin("chat"));
    });
    expect(result.current.forecastScenarios.map((s) => s.name)).toEqual(["B"]);
  });

  test("changes: [] replaces a 2-row list, reports removedRows 2, and one undo restores both rows", () => {
    const { result } = mount({ forecastScenarios: [SAVED] });
    let out: { removedRows?: number } | undefined;
    act(() => {
      out = result.current.dispatcher.updateForecastScenario(1, { changes: [] }, aiOrigin("chat"));
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
      replaced = result.current.dispatcher.updateForecastScenario(1, { changes: [SCOPE, { ...AVAIL, percent: 150 }] }, aiOrigin("chat"));
    });
    act(() => {
      renamed = result.current.dispatcher.updateForecastScenario(1, { name: "Renamed" }, aiOrigin("chat"));
    });
    expect(replaced?.removedRows).toBe(1);
    expect(renamed).not.toHaveProperty("removedRows");
  });

  // Multiset: each stored row consumes at most one equal new row.
  test.each<[string, readonly ScenarioChange[], readonly ScenarioChange[], number]>([
    ["a dropped duplicate", [AVAIL, AVAIL], [AVAIL], 1],
    ["an edited row", [AVAIL, SCOPE], [AVAIL, { ...SCOPE, tasks: 6 }], 1],
    ["an unchanged list", [AVAIL, SCOPE], [AVAIL, SCOPE], 0],
    ["a reordered list", [AVAIL, SCOPE], [SCOPE, AVAIL], 0],
    ["a duplicate added", [AVAIL], [AVAIL, AVAIL], 0],
  ])("removedRows for %s", (_case, stored, next, removed) => {
    const { result } = mount({ forecastScenarios: [{ id: 1, name: "S", changes: stored }] });
    let out: { removedRows?: number } | undefined;
    act(() => {
      out = result.current.dispatcher.updateForecastScenario(1, { changes: next }, aiOrigin("chat"));
    });
    expect(out?.removedRows).toBe(removed);
  });

  test("a refused update writes nothing: no row change, no log, no undo entry", () => {
    const { result, logActivityAi } = mount({ forecastScenarios: [SAVED] });
    const before = result.current.forecastScenarios;
    expect(() =>
      act(() => {
        result.current.dispatcher.updateForecastScenario(1, { changes: [{ ...AVAIL, percent: 5 }] }, aiOrigin("chat"));
      }),
    ).toThrow("changes[0]: percent must be between 10 and 300");
    // ★★ Flush first: an `act` whose callback throws does not flush, so a setter call made before the throw
    //  would only render on the NEXT act — reading the slice right away would pass for the wrong reason.
    act(() => {});
    expect(result.current.forecastScenarios).toBe(before);
    expect(result.current.dispatcher.getForecastScenarioRow(1)).toBe(before[0]);
    expect(logActivityAi).not.toHaveBeenCalled();
    expect(result.current.undo.stack).toHaveLength(0);
  });

  test("a placeholder label that differs only by a trailing space removes nothing and writes nothing", () => {
    const hire: ScenarioChange = {
      kind: "addPeople", from: "2026-06-01", until: "", rampWeeks: 4,
      who: { label: "Contractor", count: 1, rate: 80, currency: "EUR", hoursPerWeek: 40 },
    };
    const stored: ForecastScenario = { id: 1, name: "Hire", changes: [hire] };
    const { result, logActivityAi } = mount({ forecastScenarios: [stored] });
    const before = result.current.forecastScenarios;
    let out: { removedRows?: number } | undefined;
    act(() => {
      out = result.current.dispatcher.updateForecastScenario(1, {
        changes: [{ ...hire, who: { label: "Contractor ", count: 1, rate: 80, currency: "EUR", hoursPerWeek: 40 } }],
      }, aiOrigin("chat"));
    });
    expect(out?.removedRows).toBe(0);
    expect(result.current.forecastScenarios).toBe(before);
    expect(logActivityAi).not.toHaveBeenCalled();
    expect(result.current.undo.stack).toHaveLength(0);
  });

  test("an update that changes nothing writes, logs and captures nothing", () => {
    const { result, logActivityAi } = mount({ forecastScenarios: [SAVED] });
    const before = result.current.forecastScenarios;
    act(() => {
      result.current.dispatcher.updateForecastScenario(1, { name: SAVED.name, changes: [AVAIL, SCOPE] }, aiOrigin("chat"));
    });
    expect(result.current.forecastScenarios).toBe(before);
    expect(logActivityAi).not.toHaveBeenCalled();
    expect(result.current.undo.stack).toHaveLength(0);
  });

  test("logs one forecastScenario.updated row as the AI", () => {
    const { result, logActivityAi } = mount({ forecastScenarios: [SAVED] });
    act(() => {
      result.current.dispatcher.updateForecastScenario(1, { name: "Renamed" }, aiOrigin("chat"));
    });
    expect(logActivityAi).toHaveBeenCalledTimes(1);
    expect(logActivityAi).toHaveBeenCalledWith(aiOrigin("chat"), "forecastScenario.updated", 1, "Renamed");
  });
});

describe("create_forecast_scenario", () => {
  test("is not undo-captured and logs one forecastScenario.created row as the AI", () => {
    const { result, logActivityAi } = mount({});
    let id: number | undefined;
    act(() => {
      id = result.current.dispatcher.createForecastScenario("  Hire  ", [AVAIL], aiOrigin("chat")).id;
    });
    expect(result.current.forecastScenarios).toEqual([{ id, name: "Hire", changes: [AVAIL] }]);
    expect(result.current.undo.stack).toHaveLength(0);
    expect(logActivityAi).toHaveBeenCalledTimes(1);
    expect(logActivityAi).toHaveBeenCalledWith(aiOrigin("chat"), "forecastScenario.created", id, "Hire");
  });

  test.each([4, 5])("is refused with the cap text on a %i-scenario list (5 = restored by undo)", (n) => {
    const list = Array.from({ length: n }, (_, i) => scenario(i + 1, `S${i + 1}`));
    const { result, logActivityAi } = mount({ forecastScenarios: list });
    expect(() => result.current.dispatcher.createForecastScenario("New", [], aiOrigin("chat"))).toThrow(CAP);
    act(() => {}); // flush anything a write before the throw would have queued
    expect(result.current.forecastScenarios).toHaveLength(n);
    expect(logActivityAi).not.toHaveBeenCalled();
  });
});

describe("refusals before any work", () => {
  test("a popout refuses both writes", () => {
    const { result } = mount({ forecastScenarios: [SAVED] }, { isReadOnly: true });
    expect(() => result.current.dispatcher.createForecastScenario("New", [], aiOrigin("chat"))).toThrow(READ_ONLY);
    expect(() => result.current.dispatcher.updateForecastScenario(1, { name: "X" }, aiOrigin("chat"))).toThrow(READ_ONLY);
    act(() => {});
    expect(result.current.forecastScenarios).toEqual([SAVED]);
  });

  test("all three tools refuse while the holiday calendar loads (an update that sends changes)", async () => {
    const { result } = mount({ forecastScenarios: [SAVED] }, { getForecastInput: () => null });
    const d = result.current.dispatcher;
    const expectedToken = entityToken("forecastScenario", SAVED);
    await expect(runTool(d, "get_forecast", {}, aiOrigin("chat"))).rejects.toThrow(LOADING);
    await expect(runTool(d, "create_forecast_scenario", { name: "New", changes: [] }, aiOrigin("chat"))).rejects.toThrow(LOADING);
    await expect(runTool(d, "update_forecast_scenario", { id: 1, changes: [AVAIL], expectedToken }, aiOrigin("chat"))).rejects.toThrow(LOADING);
    act(() => {});
    expect(result.current.forecastScenarios).toEqual([SAVED]);
  });

  // ★ A rename validates nothing against the forecast, so it needs no input and runs no As-is.
  test("a rename-only update succeeds while the holiday calendar loads, with no As-is run", async () => {
    const { result } = mount({ forecastScenarios: [SAVED] }, { getForecastInput: () => null });
    const expectedToken = entityToken("forecastScenario", SAVED);
    compare.calls = 0;
    await act(async () => {
      await runTool(result.current.dispatcher, "update_forecast_scenario", { id: 1, name: "Renamed", expectedToken }, aiOrigin("chat"));
    });
    expect(result.current.forecastScenarios).toEqual([{ ...SAVED, name: "Renamed" }]);
    expect(compare.calls).toBe(0);
  });

  test("a rename-only update still refuses a taken name", () => {
    const { result } = mount({ forecastScenarios: [SAVED, scenario(2, "Other")] }, { getForecastInput: () => null });
    expect(() => result.current.dispatcher.updateForecastScenario(1, { name: "Other" }, aiOrigin("chat")))
      .toThrow('A scenario named "Other" already exists. Choose another name.');
  });
});

describe("As-is runs per call", () => {
  test("get_forecast with a whatIf runs the comparison exactly once", async () => {
    const { result } = mount({ forecastScenarios: [SAVED] });
    compare.calls = 0;
    await runTool(result.current.dispatcher, "get_forecast", { whatIf: [AVAIL] }, aiOrigin("chat"));
    expect(compare.calls).toBe(1);
  });

  test("a refused whatIf costs the one comparison and nothing more", async () => {
    const { result } = mount({});
    compare.calls = 0;
    await expect(runTool(result.current.dispatcher, "get_forecast", { whatIf: [{ ...AVAIL, percent: 0 }] }, aiOrigin("chat")))
      .rejects.toThrow("whatIf changes[0]: percent must be between 10 and 300");
    expect(compare.calls).toBe(1);
  });
});

describe("get_forecast reads the target and the proposal from the live overrides (§502 part 4)", () => {
  test("the workspace's target and proposal, not the getter's absent ones", async () => {
    const overrides = { forecast: { showSimulation: true, targetConfidence: 95 as const, proposalScenarioId: 1 } };
    const { result } = mount({ forecastScenarios: [SAVED], settingsOverrides: overrides });
    const report = (await runTool(result.current.dispatcher, "get_forecast", {}, aiOrigin("chat"))) as {
      targetConfidence: number; proposal: unknown;
    };
    expect(report.targetConfidence).toBe(95);
    expect(report.proposal).toEqual({ id: 1, name: "Contractor in January" });
  });

  test("a proposal id naming no saved scenario reads as none", async () => {
    const overrides = { forecast: { showSimulation: true, proposalScenarioId: 7 } };
    const { result } = mount({ forecastScenarios: [SAVED], settingsOverrides: overrides });
    const report = (await runTool(result.current.dispatcher, "get_forecast", {}, aiOrigin("chat"))) as { proposal: unknown };
    expect(report.proposal).toBeNull();
  });
});

describe("get_forecast whatIf follows the save path's rules", () => {
  const cases: Array<[string, ScenarioChange, string]> = [
    ["range", { kind: "availability", percent: 0, from: "2026-06-01", until: "" },
      "whatIf changes[0]: percent must be between 10 and 300"],
    ["date", { kind: "availability", percent: 120, from: "garbage", until: "" },
      "whatIf changes[0]: dates must be YYYY-MM-DD"],
    ["reference", { kind: "scope", tasks: 5, on: "2026-06-15", milestoneId: 99 },
      "whatIf changes[0]: milestone 99 does not exist"],
  ];
  test.each(cases)("refuses a %s violation and builds no report", async (_class, row, text) => {
    const { result } = mount({});
    await expect(runTool(result.current.dispatcher, "get_forecast", { whatIf: [row] }, aiOrigin("chat"))).rejects.toThrow(text);
  });

  test("a valid what-if row still simulates", async () => {
    const { result } = mount({});
    const report = await runTool(result.current.dispatcher, "get_forecast", { whatIf: [AVAIL] }, aiOrigin("chat"));
    expect(report).toBeTruthy();
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

  test("getSnapshot().forecastView is true when the view is shown even with the switch off, false when held back", () => {
    const { result } = mount({});
    act(() => { result.current.setSettingsOverrides(undefined); });
    expect(result.current.dispatcher.getSnapshot().forecastView).toBe(true);
    vi.restoreAllMocks();
    expect(result.current.dispatcher.getSnapshot().forecastView).toBe(false);
  });
});

// ★★ `makeInput()` returns EMPTY tasks, milestones and resources, standing in for the wiring's render-scope
//   slices, which a write earlier in the same turn has not reached yet. Each test below therefore fails if the
//   tools read those three slices from the getter instead of the dispatcher's synchronously written refs.
describe("a write earlier in the same turn is seen (§502)", () => {
  test("create_milestone, then create_forecast_scenario naming it, applies with the row on that milestone", async () => {
    const { result } = mount({});
    let saved: { changes: readonly ScenarioChange[] } | undefined;
    await act(async () => {
      const m = (await runTool(result.current.dispatcher, "create_milestone", { name: "Go-live", date: "2026-09-30" }, aiOrigin("chat"))) as { id: number };
      saved = (await runTool(result.current.dispatcher, "create_forecast_scenario", {
        name: "Scope on go-live", changes: [{ kind: "scope", tasks: 3, on: "2026-06-15", milestoneId: m.id }],
      }, aiOrigin("chat"))) as typeof saved;
    });
    const milestoneId = result.current.dispatcher.listMilestones()[0].id;
    expect(saved?.changes).toEqual([{ kind: "scope", tasks: 3, on: "2026-06-15", milestoneId }]);
    expect(result.current.forecastScenarios[0].changes).toEqual(saved?.changes);
  });

  test("create_resource, then an addPeople row naming the new person, applies", async () => {
    const { result } = mount({});
    let resourceId = 0;
    await act(async () => {
      const r = (await runTool(result.current.dispatcher, "create_resource", { firstName: "Ada", lastName: "Lovelace" }, aiOrigin("chat"))) as { id: number };
      resourceId = r.id;
      await runTool(result.current.dispatcher, "create_forecast_scenario", {
        name: "Ada joins", changes: [{ kind: "addPeople", who: { resourceId, hoursPerWeek: 20 }, from: "2026-06-01" }],
      }, aiOrigin("chat"));
    });
    expect(resourceId).toBeGreaterThan(0);
    expect(result.current.forecastScenarios[0].changes).toEqual([
      { kind: "addPeople", who: { resourceId, hoursPerWeek: 20 }, from: "2026-06-01", until: "", rampWeeks: 4 },
    ]);
  });

  // ★ With no open task the As-is run has nothing left to forecast and reports a finish; one open task and no
  //   finished history drops it below the floor. The status therefore says whether the run saw the new task.
  test("get_forecast after create_task in the same turn simulates the new task", async () => {
    const { result } = mount({});
    const status: unknown[] = [];
    await act(async () => {
      const before = (await runTool(result.current.dispatcher, "get_forecast", {}, aiOrigin("chat"))) as { asIs: { status: string } };
      await runTool(result.current.dispatcher, "create_task", { taskName: "Open", assignee: "M. Bennett", dueDate: "2026-06-30" }, aiOrigin("chat"));
      const after = (await runTool(result.current.dispatcher, "get_forecast", {}, aiOrigin("chat"))) as { asIs: { status: string } };
      status.push(before.asIs.status, after.asIs.status);
    });
    expect(status).toEqual(["forecast", "insufficient"]);
  });
});

describe("the decision writes (§502 part 4)", () => {
  const OTHER: ForecastScenario = { id: 2, name: "Cut scope", changes: [SCOPE] };
  type Report = { targetConfidence: number; proposal: { id: number; name: string } | null };

  test("delete applies with get_forecast's token, logs forecastScenario.deleted as the AI, and one undo restores it", async () => {
    const allowDestructiveSave = vi.fn();
    const { result, logActivityAi } = mount({ forecastScenarios: [SAVED, OTHER] }, { allowDestructiveSave });
    const expectedToken = result.current.dispatcher.getForecast(null).scenarios[0].expectedToken;
    let out: unknown;
    await act(async () => {
      out = await runTool(result.current.dispatcher, "delete_forecast_scenario", { id: 1, expectedToken }, aiOrigin("chat"));
    });
    expect(out).toEqual({ deleted: true, id: 1, name: SAVED.name });
    expect(result.current.forecastScenarios).toEqual([OTHER]);
    expect(logActivityAi).toHaveBeenCalledTimes(1);
    expect(logActivityAi).toHaveBeenCalledWith(aiOrigin("chat"), "forecastScenario.deleted", 1, SAVED.name);
    expect(result.current.undo.stack).toHaveLength(1);
    // ★ Never armed: the slice is not counted by the save guards, so an arm would leak to the next save
    //   (`UNARMED_AI_ROUTES`, destructive-save-arming.test.ts).
    expect(allowDestructiveSave).not.toHaveBeenCalled();

    act(() => { result.current.undo.undo(); });

    // Back at its own index, not appended.
    expect(result.current.forecastScenarios).toEqual([SAVED, OTHER]);
  });

  test("delete with a stale token refuses and deletes nothing", async () => {
    const { result, logActivityAi } = mount({ forecastScenarios: [SAVED] });
    const stale = entityToken("forecastScenario", { ...SAVED, name: "Before a rename" });
    await expect(
      runTool(result.current.dispatcher, "delete_forecast_scenario", { id: 1, expectedToken: stale }, aiOrigin("chat")),
    ).rejects.toThrow("forecast scenario 1 changed since you read it");
    act(() => {});
    expect(result.current.forecastScenarios).toEqual([SAVED]);
    expect(logActivityAi).not.toHaveBeenCalled();
  });

  test("deleting the proposed scenario reads as no proposal, and undo brings the proposal back", async () => {
    const overrides = { forecast: { showSimulation: true, proposalScenarioId: 1 } };
    const { result } = mount({ forecastScenarios: [SAVED], settingsOverrides: overrides });
    const expectedToken = entityToken("forecastScenario", SAVED);
    await act(async () => {
      await runTool(result.current.dispatcher, "delete_forecast_scenario", { id: 1, expectedToken }, aiOrigin("chat"));
    });
    expect((result.current.dispatcher.getForecast(null) as Report).proposal).toBeNull();

    act(() => { result.current.undo.undo(); });

    expect((result.current.dispatcher.getForecast(null) as Report).proposal).toEqual({ id: 1, name: SAVED.name });
  });

  test("set_forecast_proposal with an unknown id refuses, naming the id, and writes and logs nothing", async () => {
    const { result, logActivityAi } = mount({ forecastScenarios: [SAVED] });
    const before = result.current.settingsOverrides;
    await expect(runTool(result.current.dispatcher, "set_forecast_proposal", { id: 7 }, aiOrigin("chat"))).rejects.toThrow(
      "forecast scenario 7 not found",
    );
    act(() => {});
    expect(result.current.settingsOverrides).toBe(before);
    expect(logActivityAi).not.toHaveBeenCalled();
  });

  test("set_forecast_proposal sets and clears, logging each as the AI, with no undo entry", async () => {
    const { result, logActivityAi } = mount({ forecastScenarios: [SAVED, OTHER] });
    let set: unknown;
    let cleared: unknown;
    await act(async () => {
      set = await runTool(result.current.dispatcher, "set_forecast_proposal", { id: 2 }, aiOrigin("chat"));
    });
    expect(set).toEqual({ proposal: { id: 2, name: OTHER.name } });
    expect(result.current.settingsOverrides?.forecast?.proposalScenarioId).toBe(2);
    await act(async () => {
      cleared = await runTool(result.current.dispatcher, "set_forecast_proposal", { id: null }, aiOrigin("chat"));
    });
    expect(cleared).toEqual({ proposal: null });
    expect(result.current.settingsOverrides?.forecast?.proposalScenarioId).toBeUndefined();
    expect(logActivityAi.mock.calls).toEqual([
      [aiOrigin("chat"), "forecast.proposalSet", 2, OTHER.name],
      [aiOrigin("chat"), "forecast.proposalCleared", 2, OTHER.name],
    ]);
    expect(result.current.undo.stack).toHaveLength(0);
  });

  test("set_forecast_target_confidence(70) refuses and writes nothing", async () => {
    const { result, logActivityAi } = mount({});
    await expect(runTool(result.current.dispatcher, "set_forecast_target_confidence", { value: 70 }, aiOrigin("chat"))).rejects.toThrow(
      "value must be one of 50, 80, 95",
    );
    act(() => {});
    expect(result.current.settingsOverrides?.forecast?.targetConfidence).toBeUndefined();
    expect(logActivityAi).not.toHaveBeenCalled();
  });

  test("set_forecast_target_confidence logs 80 → 95 as the AI, is not undoable, and a repeat writes nothing", async () => {
    const { result, logActivityAi } = mount({});
    await act(async () => {
      await runTool(result.current.dispatcher, "set_forecast_target_confidence", { value: 95 }, aiOrigin("chat"));
    });
    const after = result.current.settingsOverrides;
    expect(after?.forecast?.targetConfidence).toBe(95);
    await act(async () => {
      await runTool(result.current.dispatcher, "set_forecast_target_confidence", { value: 95 }, aiOrigin("chat"));
    });
    expect(result.current.settingsOverrides).toBe(after);
    expect(logActivityAi.mock.calls).toEqual([[aiOrigin("chat"), "forecast.targetChanged", 80, 95]]);
    expect(result.current.undo.stack).toHaveLength(0);
  });

  // ★★ The ref is assigned at write time, not by the effect: inside ONE act no effect has run between the calls.
  test("a get_forecast later in the same turn reads the new target and proposal", async () => {
    const { result } = mount({ forecastScenarios: [SAVED] });
    let report: Report | undefined;
    await act(async () => {
      const d = result.current.dispatcher;
      await runTool(d, "set_forecast_target_confidence", { value: 95 }, aiOrigin("chat"));
      await runTool(d, "set_forecast_proposal", { id: 1 }, aiOrigin("chat"));
      report = (await runTool(d, "get_forecast", {}, aiOrigin("chat"))) as Report;
    });
    expect(report?.targetConfidence).toBe(95);
    expect(report?.proposal).toEqual({ id: 1, name: SAVED.name });
  });

  // ★★ The other writer queues BEFORE the AI write and no render runs between them, so the AI's ref still lacks
  //   its change: a plain `setSettingsOverrides(next)` computed from that ref would overwrite it.
  test("a change another writer queued before the ref synced survives the AI's target and proposal writes", async () => {
    const { result } = mount({ forecastScenarios: [SAVED] });
    const berlin = { timezone: "Europe/Berlin" };
    await act(async () => {
      result.current.setSettingsOverrides((prev) => ({ ...prev, timezone: berlin }));
      await runTool(result.current.dispatcher, "set_forecast_target_confidence", { value: 95 }, aiOrigin("chat"));
      await runTool(result.current.dispatcher, "set_forecast_proposal", { id: 1 }, aiOrigin("chat"));
    });
    expect(result.current.settingsOverrides).toEqual({
      timezone: berlin,
      forecast: { showSimulation: true, targetConfidence: 95, proposalScenarioId: 1 },
    });
  });

  // ★★ The opposite direction: the UI queued a CHANGE the AI then sets back to the value the stale ref still holds.
  //   Deciding from the ref would skip the write and still report the value; the queued updater makes it land.
  test("the AI's target and proposal land even when the ref still holds the value the UI just changed", async () => {
    const { result } = mount({ forecastScenarios: [SAVED] });
    await act(async () => {
      result.current.setSettingsOverrides((prev) => ({ ...prev, forecast: { showSimulation: true, targetConfidence: 95, proposalScenarioId: 1 } }));
      await runTool(result.current.dispatcher, "set_forecast_target_confidence", { value: 80 }, aiOrigin("chat"));
      await runTool(result.current.dispatcher, "set_forecast_proposal", { id: null }, aiOrigin("chat"));
    });
    expect(result.current.settingsOverrides?.forecast).toEqual({ showSimulation: true });
  });

  // ★★ Same shape for the scenario list: a row another writer queued before the ref synced survives the AI's
  //   create, update and delete, which go through a functional updater, not a value computed from the stale ref.
  test("a scenario another writer queued before the ref synced survives the AI's scenario writes", async () => {
    const { result } = mount({ forecastScenarios: [SAVED, scenario(2, "Other")] });
    const queued = scenario(9, "Queued by the UI");
    await act(async () => {
      result.current.setForecastScenarios((prev) => [...prev, queued]);
      result.current.dispatcher.deleteForecastScenario(2, aiOrigin("chat"));
      result.current.dispatcher.updateForecastScenario(1, { name: "Renamed" }, aiOrigin("chat"));
    });
    expect(result.current.forecastScenarios.map((s) => s.id)).toEqual([1, 9]);
    expect(result.current.forecastScenarios[0].name).toBe("Renamed");
  });

  test("a scenario created earlier in the same turn can be proposed", async () => {
    const { result } = mount({});
    await act(async () => {
      const d = result.current.dispatcher;
      const created = (await runTool(d, "create_forecast_scenario", { name: "New", changes: [] }, aiOrigin("chat"))) as { id: number };
      await runTool(d, "set_forecast_proposal", { id: created.id }, aiOrigin("chat"));
    });
    expect(result.current.settingsOverrides?.forecast?.proposalScenarioId).toBe(result.current.forecastScenarios[0].id);
  });

  test("a popout refuses all three, writing nothing", () => {
    const overrides = { forecast: { showSimulation: true } };
    const { result } = mount({ forecastScenarios: [SAVED], settingsOverrides: overrides }, { isReadOnly: true });
    const d = result.current.dispatcher;
    expect(() => d.deleteForecastScenario(1, aiOrigin("chat"))).toThrow(READ_ONLY);
    expect(() => d.setForecastProposal(1, aiOrigin("chat"))).toThrow(READ_ONLY);
    expect(() => d.setForecastTargetConfidence(95, aiOrigin("chat"))).toThrow(READ_ONLY);
    act(() => {});
    expect(result.current.forecastScenarios).toEqual([SAVED]);
    expect(result.current.settingsOverrides).toEqual(overrides);
  });

  test("with the switch off, all three refuse with the off message", async () => {
    const { result } = mount({ forecastScenarios: [SAVED], settingsOverrides: undefined });
    const d = result.current.dispatcher;
    const expectedToken = entityToken("forecastScenario", SAVED);
    await expect(runTool(d, "delete_forecast_scenario", { id: 1, expectedToken }, aiOrigin("chat"))).rejects.toThrow(FORECAST_OFF_MESSAGE);
    await expect(runTool(d, "set_forecast_proposal", { id: 1 }, aiOrigin("chat"))).rejects.toThrow(FORECAST_OFF_MESSAGE);
    await expect(runTool(d, "set_forecast_target_confidence", { value: 95 }, aiOrigin("chat"))).rejects.toThrow(FORECAST_OFF_MESSAGE);
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

  // The card line is data from `forecastRowLine` (i18n-free), translated by `cardRowTitle`; `liveRowTitle` leaves
  // forecast rows to it.
  const titleOf = (c: ProposedCall, ws: Workspace, lang: "en-US" | "de" = "en-US"): string =>
    cardRowTitle(lang, { call: c } as unknown as DescribedRow, ws);

  test("the card names the scenario and counts the rows", () => {
    const ws = { forecastScenarios: [SAVED] } as unknown as Workspace;
    expect(liveRowTitle(call("create_forecast_scenario", { name: "Hire", changes: [] }), ws)).toBeNull();
    expect(titleOf(call("create_forecast_scenario", { name: "Hire", changes: [AVAIL, SCOPE, AVAIL] }), ws))
      .toBe("Save scenario “Hire” (3 changes)");
    expect(titleOf(call("update_forecast_scenario", { id: 1, changes: [AVAIL] }), ws))
      .toBe("Edit scenario “Contractor in January” (2 → 1 changes)");
    expect(titleOf(call("update_forecast_scenario", { id: 1, name: "Renamed" }), ws))
      .toBe("Edit scenario “Contractor in January” → “Renamed”");
    // A target minted earlier in the same plan is not stored yet: the call's own name labels it.
    expect(titleOf(call("update_forecast_scenario", { id: 900, name: "B", changes: [] }), ws))
      .toBe("Edit scenario “B” (0 changes)");
  });

  test("the card lines are German in German (AI-02)", async () => {
    await loadI18n("de");
    const ws = { forecastScenarios: [SAVED], settingsOverrides: { forecast: { proposalScenarioId: 1 } } } as unknown as Workspace;
    expect(titleOf(call("create_forecast_scenario", { name: "Hire", changes: [AVAIL] }), ws, "de"))
      .toBe("Szenario „Hire“ speichern (1 Änderung)");
    expect(titleOf(call("update_forecast_scenario", { id: 1, name: "Neu", changes: [] }), ws, "de"))
      .toBe("Szenario „Contractor in January“ bearbeiten (neuer Name „Neu“) (2 → 0 Änderungen)");
    expect(titleOf(call("delete_forecast_scenario", { id: 1 }), ws, "de"))
      .toBe("Szenario „Contractor in January“ löschen (der aktuelle Vorschlag)");
    expect(titleOf(call("set_forecast_proposal", { id: 1 }), ws, "de")).toBe("Szenario „Contractor in January“ vorschlagen");
    expect(titleOf(call("set_forecast_proposal", { id: null }), ws, "de")).toBe("Vorschlag aufheben");
    expect(titleOf(call("set_forecast_target_confidence", { value: 95 }), ws, "de"))
      .toBe("Zielwahrscheinlichkeit des Projekts auf 95 % setzen");
  });

  test("a delete stages alone; one decision write applies, two stage (§502 part 4)", () => {
    expect(shouldStage([call("delete_forecast_scenario", { id: 1, expectedToken: "t" })])).toBe(true);
    expect(shouldStage([call("set_forecast_target_confidence", { value: 95 })])).toBe(false);
    expect(shouldStage([call("set_forecast_proposal", { id: 1 })])).toBe(false);
    expect(shouldStage([call("set_forecast_target_confidence", { value: 95 }), call("set_forecast_proposal", { id: 1 })]))
      .toBe(true);
  });

  test("the card names the decision writes (§502 part 4)", () => {
    const ws = { forecastScenarios: [SAVED] } as unknown as Workspace;
    expect(titleOf(call("delete_forecast_scenario", { id: 1 }), ws)).toBe("Delete scenario “Contractor in January”");
    // Deleting the current proposal clears it too, so the card says so.
    const proposed = { ...ws, settingsOverrides: { forecast: { proposalScenarioId: 1 } } } as unknown as Workspace;
    expect(titleOf(call("delete_forecast_scenario", { id: 1 }), proposed))
      .toBe("Delete scenario “Contractor in January” (the proposal)");
    expect(titleOf(call("set_forecast_proposal", { id: 1 }), ws)).toBe("Propose scenario “Contractor in January”");
    // A scenario this plan creates is not stored yet: the card names it by the create's name (`proposalTitles`
    // collects the plan's creates); only with no create in the plan does the provisional id remain.
    const create = call("create_forecast_scenario", { name: " Draft ", changes: [] });
    const propose = call("set_forecast_proposal", { id: 900 });
    const rows = [{ call: create, mintedId: 900 }, { call: propose }] as unknown as DescribedRow[];
    expect(proposalTitles(rows, ws, (r, pending) => cardRowTitle("en-US", r, ws, pending)))
      .toEqual(["Save scenario “Draft” (0 changes)", "Propose scenario “Draft”"]);
    expect(titleOf(propose, ws)).toBe("Propose scenario #900");
    expect(titleOf(call("set_forecast_proposal", { id: null }), ws)).toBe("Clear the proposal");
    // The target is a project setting, not a scenario: it names none.
    const target = call("set_forecast_target_confidence", { value: 95 });
    expect(titleOf(target, ws)).toBe("Set the project's target confidence to 95%");
    expect(forecastRowLine(target, ws)).toEqual({ kind: "target", value: "95" });
  });

  // ★ A replace that drops rows must show it: the stored count beside the new one.
  test("an update that sends changes shows the stored row count beside the new one", () => {
    const three: ForecastScenario = { id: 2, name: "Three", changes: [AVAIL, SCOPE, AVAIL] };
    const one: ForecastScenario = { id: 3, name: "One", changes: [AVAIL] };
    const ws = { forecastScenarios: [three, one] } as unknown as Workspace;
    expect(titleOf(call("update_forecast_scenario", { id: 2, changes: [SCOPE] }), ws))
      .toBe("Edit scenario “Three” (3 → 1 changes)");
    expect(titleOf(call("update_forecast_scenario", { id: 3, changes: [SCOPE] }), ws))
      .toBe("Edit scenario “One” (1 → 1 change)");
    expect(titleOf(call("update_forecast_scenario", { id: 2, name: "Renamed", changes: [] }), ws))
      .toBe("Edit scenario “Three” → “Renamed” (3 → 0 changes)");
  });
});

// §810 — while the project hides its Resources function, get_forecast does not name a directory person a what-if or
// scenario adds. Decided at call time from the project's own functions (the workspace slice `get_app_state`
// reports), through the real dispatcher.
describe("get_forecast names a directory person only while Resources is shown (§810)", () => {
  const fixtureInput = (): ForecastReportInput => ({
    run: forecastFixture.input(), history: [], scenarios: [], currency: "EUR", settingsOverrides: undefined,
  });
  const named = (features: FeatureModuleId[]) => {
    const { result } = mount(
      {
        tasks: [...forecastFixture.TASKS], milestones: [...forecastFixture.MILESTONES],
        resources: [...forecastFixture.DIRECTORY.resources], features,
        forecastScenarios: [{ id: 1, name: "Add Per", changes: [forecastFixture.addPerson(forecastFixture.PER)] }],
      },
      { getForecastInput: fixtureInput },
    );
    const report = result.current.dispatcher.getForecast([forecastFixture.addPerson(forecastFixture.PER)]);
    const sizing = (rows: readonly unknown[] | undefined) => (rows?.[0] as { sizing?: { name: string } } | undefined)?.sizing?.name;
    return { scenario: sizing(report.scenarios[0]?.rows), whatIf: sizing(report.whatIf?.rows) };
  };

  test("shown: the scenario and the what-if name the person", () => {
    expect(named([...ALL_MODULE_IDS])).toEqual({ scenario: "Per Sand", whatIf: "Per Sand" });
  });

  test("hidden: both report the withheld name", () => {
    const hidden = ALL_MODULE_IDS.filter((id) => id !== "resources");
    expect(named(hidden)).toEqual({ scenario: DIRECTORY_NAME_WITHHELD, whatIf: DIRECTORY_NAME_WITHHELD });
  });
});
