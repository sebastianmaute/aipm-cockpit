// §502 — a staged plan that creates a milestone or a person and saves a forecast scenario naming it inside
// `changes[]`. Apply must rewrite the provisional id to the one the real create minted, and a refused create
// must take the scenario row with it. The REAL dispatcher and undo batch, as in chat-proposal-apply.test.tsx.
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { dispatcherWrapperWith, makeDispatcherArgs } from "../test/chat-dispatcher-fixture";
import { showForecastView } from "../test/forecast-view";
import { applyProposal } from "./chat-proposal-apply";
import { buildPlanRows, cascadeDeselect, type ProposedCall } from "./chat-proposal";
import { describeProposal } from "./chat-proposal-describe";
import { DEFAULT_HISTORY_WINDOW } from "./forecast/constants";
import type { ForecastReportInput } from "./forecast-ai-report";
import { resetMintState } from "./id-mint-session";
import type { TestSeed } from "./test-providers";
import type { Milestone, Resource } from "./types";
import { useChatDispatcher } from "./use-chat-dispatcher";
import { useUndoBatch } from "./use-undo-batch";
import { useUndoStack } from "./undo/use-undo-stack";
import { emptyWorkspace } from "./workspace";
import { useWorkspace } from "./workspace-context";

const ON = { forecast: { showSimulation: true } };

/** Empty slices on purpose, as the wiring's render scope is before the plan's creates land. */
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

const M1: Milestone = { id: 1, name: "M1", date: "2026-09-30", linkedTaskIds: [] };
const R1: Resource = { id: 1, firstName: "Grace", lastName: "Hopper", roleId: null, utilizationMode: "percent", utilization: {} };
const SEED: TestSeed = { milestones: [M1], resources: [R1], settingsOverrides: ON };

function renderApply() {
  return renderHook(
    () => {
      const undo = useUndoStack({ lang: "en-US", logActivity: vi.fn(), showToast: vi.fn(), showToastAction: vi.fn() });
      const batch = useUndoBatch(undo);
      const dispatcher = useChatDispatcher(makeDispatcherArgs({ undo: batch.undo, getForecastInput: () => makeInput() }));
      const { forecastScenarios, milestones, resources } = useWorkspace();
      return { batch, dispatcher, forecastScenarios, milestones, resources };
    },
    { wrapper: dispatcherWrapperWith(SEED) },
  );
}

type Rendered = ReturnType<typeof renderApply>["result"];

/** Graph the plan with `mintedIds`, deselect `refuse` (cascading), then apply what is left. */
async function applyPlan(result: Rendered, calls: readonly ProposedCall[], mintedIds: readonly number[], refuse?: number) {
  const plan = buildPlanRows(calls, mintedIds);
  const ws = { ...emptyWorkspace(), milestones: [M1], resources: [R1] };
  const rows = describeProposal(calls, ws, plan);
  const all = new Set(rows.map((_, i) => i));
  const selected = refuse === undefined ? all : cascadeDeselect(plan, all, refuse);
  let outcome: Awaited<ReturnType<typeof applyProposal>> | undefined;
  await act(async () => {
    outcome = await applyProposal({ dispatcher: result.current.dispatcher, rows, selected, batch: result.current.batch });
  });
  return { outcome: outcome!, selected };
}

const scope = (milestoneId: number) => ({ kind: "scope", tasks: 3, on: "2026-06-15", milestoneId });
const added = (resourceId: number) => ({ kind: "addPeople", who: { resourceId, hoursPerWeek: 20 }, from: "2026-06-01" });

beforeEach(() => {
  resetMintState();
  showForecastView();
});
afterEach(() => vi.restoreAllMocks());

describe("a staged scenario naming a milestone or person created earlier in the plan (§502)", () => {
  // ★★ The provisional ids are 101 and 102, which no seeded row holds, so an unremapped row is refused as an
  //    unknown milestone/person and the plan does not apply cleanly; the minter hands out 2 for both.
  test("applies, and the stored rows carry the REAL minted ids; an existing id passes untouched", async () => {
    const { result } = renderApply();
    const { outcome } = await applyPlan(
      result,
      [
        { name: "create_milestone", input: { name: "Go-live", date: "2026-10-31" } },
        { name: "create_resource", input: { firstName: "Ada", lastName: "Lovelace" } },
        { name: "create_forecast_scenario", input: { name: "Both", changes: [scope(101), added(102), scope(1)] } },
      ],
      [101, 102, 900],
    );

    expect(outcome.rows.map((r) => r.ok)).toEqual([true, true, true]);
    const milestoneId = result.current.milestones.find((m) => m.name === "Go-live")?.id;
    const resourceId = result.current.resources.find((r) => r.firstName === "Ada")?.id;
    expect([milestoneId, resourceId]).toEqual([2, 2]);
    expect(result.current.forecastScenarios[0].changes).toEqual([
      scope(2), { ...added(2), until: "", rampWeeks: 4 }, scope(1),
    ]);
  });

  test.each([
    ["the milestone create", 0, scope(101)],
    ["the person create", 1, added(102)],
  ] as const)("refusing %s deselects the scenario row, so nothing dangling is saved", async (_label, refuse, row) => {
    const { result } = renderApply();
    const { outcome, selected } = await applyPlan(
      result,
      [
        { name: "create_milestone", input: { name: "Go-live", date: "2026-10-31" } },
        { name: "create_resource", input: { firstName: "Ada", lastName: "Lovelace" } },
        { name: "create_forecast_scenario", input: { name: "Dangling", changes: [row] } },
      ],
      [101, 102, 900],
      refuse,
    );

    expect(selected.has(2)).toBe(false);
    expect(outcome.rows.map((r) => r.index)).not.toContain(2);
    expect(result.current.forecastScenarios).toEqual([]);
  });
});
