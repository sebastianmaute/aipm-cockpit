// The Forecast view's part-4 decision surfaces (§502): the target control, the "what it would take" column, the
// Explore draft and the pending draft a Reports Explore leaves in the tab context. The lever search itself is
// `use-lever-search.test.tsx`'s; here it is stubbed, so each test names exactly the levers the column shows.
import { beforeEach, describe, expect, test, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { ForecastPanel, type ForecastScenariosProps } from "./forecast-panel";
import type { LeverOutcome, WhatItTakes } from "./forecast-levers";
import type { LeverSearchArgs, LeverValue } from "./use-lever-search";
import type { ForecastSettingsApi } from "./use-forecast-settings";
import type { TargetConfidence } from "./forecast-target";
import type { ForecastDraftRequest } from "./workspace-tab-context";
import type { ForecastFacts, ForecastFactsByUnit } from "./budget-forecast";
import { validateScenarioDraft, type ForecastScenario } from "./forecast-scenarios";
import type { ScenarioDirectory } from "./forecast-added-people";
import type { ScenarioDraft } from "./use-forecast-scenarios";
import type { Milestone, ResourcePlan, Resource, Role, Task } from "./types";
import { rowLabel } from "./row-tokens";
import { loadI18n } from "./i18n";
import { workingDaysBefore } from "./working-days";

const stub = vi.hoisted(() => ({ values: new Map<string, unknown>(), calls: [] as unknown[] }));
vi.mock("./use-lever-search", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./use-lever-search")>()),
  useLeverSearch: (args: unknown) => {
    stub.calls.push(args);
    return stub.values;
  },
}));
vi.mock("./workspace-tab-context", () => ({ useWorkspaceTab: () => ({ requestChat: vi.fn() }) }));

const TODAY = "2026-10-14"; // a Wednesday
const NONE: ReadonlySet<string> = new Set();
const HISTORY = [...workingDaysBefore(TODAY, 59, NONE), TODAY];
const PLAN = { startDate: "2026-01-01", endDate: "2026-12-31", granularity: "week", currency: "EUR" } as ResourcePlan;
const done = (id: number, completedDate: string, assignee = ""): Task =>
  ({ id, taskName: `d${id}`, assignee, assigneeEmail: "", status: "Done", completedDate }) as Task;
const open = (id: number): Task => ({ id, taskName: `o${id}`, assignee: "", assigneeEmail: "", status: "To Do" }) as Task;
const OPEN = Array.from({ length: 12 }, (_, i) => open(1 + i));
const TASKS: Task[] = [
  ...HISTORY.map((d, i) => done(1000 + i, d, i === 0 ? "Ola Nord" : i === 1 ? "Per Sand" : "")),
  ...OPEN,
];
// Go-live: due, with linked open work. Old: overdue (Ruling A: no chance, so no lever and no Explore).
const MILESTONES: Milestone[] = [
  { id: 1, name: "Go-live", date: "2026-11-20", linkedTaskIds: OPEN.slice(0, 10).map((t) => t.id) },
  { id: 3, name: "Old", date: "2026-10-01", linkedTaskIds: [OPEN[10].id] },
];
const ROLE: Role = { id: 1, disciplineId: 1, gradeId: 1, internalRate: 80, externalRate: 120 };
const RESOURCES: Resource[] = [
  { id: 7, firstName: "Ola", lastName: "Nord", roleId: 1, utilizationMode: "percent", utilization: {} } as Resource,
  { id: 8, firstName: "Per", lastName: "Sand", roleId: 1, utilizationMode: "percent", utilization: {} } as Resource,
];
const FACTS: ForecastFacts = {
  bac: 2000, ac: 800, ev: null, pv: 0, bucketsMissingPercent: [],
  dated: HISTORY.map((date) => ({ date, bookedFrom: date, value: 16, spread: false })),
  planEnd: PLAN.endDate, today: TODAY, holidaySet: NONE, hasFixedPrice: false,
};
const BUDGET_FACTS: ForecastFactsByUnit = { eur: FACTS, hours: FACTS };

const OUT: LeverOutcome = { state: "out-of-reach" };
const GO_LIVE_LEVERS: WhatItTakes = {
  target: { kind: "milestone", id: 1 }, chance: 0.31, prioritised: 0.58,
  people: { state: "reaches", n: 2, chance: 0.81, hours: null }, tasks: { state: "reaches", n: 9, chance: 0.8, hours: null },
};

const four = (n: number): ForecastScenario[] =>
  Array.from({ length: n }, (_, i) => ({ id: i + 1, name: `S${i + 1}`, changes: [{ kind: "scope", tasks: 1, on: TODAY }] }));

const DIRECTORY: ScenarioDirectory = {
  resources: RESOURCES, roles: [ROLE], shifts: [], absences: [], budgets: [], fxRates: null, workdayHours: 8, baseCurrency: "EUR",
};

function scenariosProps(list: ForecastScenario[] = [], createScenario = vi.fn((): number | null => 9)): ForecastScenariosProps {
  return {
    api: {
      scenarios: list, canCreate: list.length < 4, mintId: () => 9,
      createScenario, updateScenario: () => false, renameScenario: () => false, deleteScenario: () => {},
    },
    directory: DIRECTORY,
    readOnly: false,
  };
}

type HarnessProps = {
  lang?: "en-US" | "de";
  scenarios?: ForecastScenariosProps;
  milestones?: Milestone[];
  setTarget?: (v: TargetConfidence) => void;
  pendingDraft?: ForecastDraftRequest | null;
  onDraftConsumed?: () => void;
};
function Harness({ lang = "en-US", scenarios = scenariosProps(), milestones = MILESTONES, setTarget = () => {}, pendingDraft, onDraftConsumed }: HarnessProps) {
  const [target, setLocal] = useState<TargetConfidence>(80);
  const settings: ForecastSettingsApi = {
    target, proposalId: null, setProposal: () => {},
    setTarget: (v) => {
      setTarget(v);
      setLocal(v);
    },
  };
  return (
    <ForecastPanel
      lang={lang} tasks={TASKS} milestones={milestones} plan={PLAN} today={TODAY} holidaySet={NONE} showSimulation
      budgetFacts={BUDGET_FACTS} scenarios={scenarios} forecastSettings={settings} pendingDraft={pendingDraft} onDraftConsumed={onDraftConsumed}
    />
  );
}
/** A list-backed api whose create validates like the hook does, so a second save of the same name is refused. */
function SavingHarness({ milestones = MILESTONES, onCreate }: { milestones?: Milestone[]; onCreate: (d: ScenarioDraft) => void }) {
  const [list, setList] = useState<ForecastScenario[]>([]);
  const base = scenariosProps(list);
  const createScenario = (_id: number, d: ScenarioDraft): number | null => {
    if (validateScenarioDraft(d, list, null) !== null) return null;
    onCreate(d);
    setList((prev) => [...prev, { id: prev.length + 1, name: d.name, changes: d.changes }]);
    return list.length + 1;
  };
  return <Harness milestones={milestones} scenarios={{ ...base, api: { ...base.api, createScenario } }} />;
}
const draftFigures = () => screen.queryAllByRole("group", { name: /, Draft, simulated$/ }).map((g) => g.textContent).join("|");
const lastSearch = () => stub.calls[stub.calls.length - 1] as LeverSearchArgs;
const draftName = () => (within(screen.getByRole("dialog", { name: "New scenario" })).getByRole("textbox", { name: "Name" }) as HTMLInputElement).value;

describe("ForecastPanel — what it would take (§502 part 4)", () => {
  beforeEach(() => {
    stub.calls.length = 0;
    stub.values = new Map<string, LeverValue>([["m:1", GO_LIVE_LEVERS]]);
  });

  test("the Quick milestone table gains the target column; switching to 95 renames it and stores 95", async () => {
    const setTarget = vi.fn();
    render(<Harness setTarget={setTarget} />);
    expect(screen.getByRole("columnheader", { name: "What it would take to reach 80%" })).toBeInTheDocument();
    expect(lastSearch().goal).toBe(80);
    await userEvent.setup().click(screen.getByRole("radio", { name: "Cautious 95%" }));
    expect(setTarget).toHaveBeenCalledWith(95);
    expect(screen.getByRole("columnheader", { name: "What it would take to reach 95%" })).toBeInTheDocument();
    expect(lastSearch().goal).toBe(95);
  });

  test("without the simulation switch there is no target control and no column", () => {
    const settings: ForecastSettingsApi = { target: 80, proposalId: null, setProposal: () => {}, setTarget: () => {} };
    const panel = (showSimulation: boolean) => (
      <ForecastPanel
        lang="en-US" tasks={TASKS} milestones={MILESTONES} plan={PLAN} today={TODAY} holidaySet={NONE} showSimulation={showSimulation}
        budgetFacts={BUDGET_FACTS} scenarios={scenariosProps()} forecastSettings={settings}
      />
    );
    const { unmount } = render(panel(false));
    expect(screen.queryByRole("radiogroup", { name: "Target confidence" })).toBeNull();
    expect(screen.queryByRole("columnheader", { name: /What it would take/ })).toBeNull();
    unmount();
    // Positive control: the same props with the switch on carry both.
    render(panel(true));
    expect(screen.getByRole("radiogroup", { name: "Target confidence" })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: /What it would take/ })).toBeInTheDocument();
  });

  test("the row header's accessible name carries the severity text, not only the dot", () => {
    render(<Harness />);
    expect(screen.getByRole("rowheader", { name: /^Go-live, (below 50%|below target|at or above target)$/ })).toBeInTheDocument();
  });

  test("each chance dot in the Quick milestone table has a text equivalent", () => {
    render(<Harness />);
    const dots = screen.getAllByRole("img", { name: /^(below 50%|below target|at or above target)$/ });
    expect(dots.length).toBeGreaterThan(0);
  });

  test("Ruling A: an overdue milestone is not searched and its row has no lever and no Explore", () => {
    stub.values = new Map<string, LeverValue>([["m:1", GO_LIVE_LEVERS], ["m:3", { ...GO_LIVE_LEVERS, target: { kind: "milestone", id: 3 } }]]);
    render(<Harness />);
    expect(lastSearch().targets).toEqual([{ kind: "milestone", id: 1 }]);
    expect(lastSearch().enabled).toBe(true);
    const old = screen.getByRole("row", { name: /^Old/ });
    expect(within(old).getByText("Overdue")).toBeInTheDocument();
    expect(within(old).queryByRole("button")).toBeNull();
    expect(old.querySelector("[data-lever-badge]")).toBeNull();
    // Positive control: the Go-live row does carry both.
    const goLive = screen.getByRole("row", { name: /^Go-live/ });
    expect(within(goLive).getByRole("button", { name: rowLabel("Explore", "Go-live") })).toBeInTheDocument();
    expect(goLive.querySelector("[data-lever-badge]")).not.toBeNull();
  });

  test("Ask Claude to draft a proposal: AI on + simulation + no popout, and only on a row with a chance", () => {
    stub.values = new Map<string, LeverValue>([["m:1", GO_LIVE_LEVERS], ["m:3", { ...GO_LIVE_LEVERS, target: { kind: "milestone", id: 3 } }]]);
    const settings: ForecastSettingsApi = { target: 80, proposalId: null, setProposal: () => {}, setTarget: () => {} };
    const panel = (over: { aiEnabled?: boolean; isPopout?: boolean }) => (
      <ForecastPanel
        lang="en-US" tasks={TASKS} milestones={MILESTONES} plan={PLAN} today={TODAY} holidaySet={NONE} showSimulation
        budgetFacts={BUDGET_FACTS} scenarios={scenariosProps()} forecastSettings={settings} {...over}
      />
    );
    const ask = () => screen.queryAllByRole("button", { name: /Ask Claude to draft a proposal/ });
    const { unmount } = render(panel({}));
    expect(ask()).toHaveLength(0);
    unmount();
    const popout = render(panel({ aiEnabled: true, isPopout: true }));
    expect(ask()).toHaveLength(0);
    popout.unmount();
    render(panel({ aiEnabled: true }));
    expect(within(screen.getByRole("row", { name: /^Go-live/ })).getByRole("button", { name: rowLabel("Ask Claude to draft a proposal", "Go-live") })).toBeInTheDocument();
    expect(within(screen.getByRole("row", { name: /^Old/ })).queryByRole("button")).toBeNull();
  });

  test("Explore opens Scenarios on a draft of the people lever; Cancel saves nothing", async () => {
    const createScenario = vi.fn((): number | null => 9);
    render(<Harness scenarios={scenariosProps([], createScenario)} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: rowLabel("Explore", "Go-live") }));
    expect(screen.getByRole("radio", { name: "Scenarios" }).getAttribute("aria-checked")).toBe("true");
    expect(draftName()).toBe("Go-live — what it would take (+2 people)");
    const dialog = screen.getByRole("dialog", { name: "New scenario" });
    expect(within(dialog).getAllByRole("listitem")).toHaveLength(1);
    expect((within(dialog).getByLabelText("Change 1: Count") as HTMLInputElement).value).toBe("2");
    expect(within(dialog).getByRole("button", { name: "Or use 9 fewer tasks on Go-live instead" })).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(createScenario).not.toHaveBeenCalled();
  });

  test("the saved people row carries the translated placeholder name (German: Platzhalter)", async () => {
    await loadI18n("de");
    const createScenario = vi.fn((): number | null => 9);
    render(<Harness lang="de" scenarios={scenariosProps([], createScenario)} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: rowLabel("Erkunden", "Go-live") }));
    await user.click(screen.getByRole("button", { name: "Speichern" }));
    const [, draft] = createScenario.mock.calls[0] as unknown as [number, { changes: { who: { label: string } }[] }];
    expect(draft.changes[0].who.label).toBe("Platzhalter");
  });

  test("Explore's draft saves once, through a freshly minted id", async () => {
    const createScenario = vi.fn((): number | null => 9);
    render(<Harness scenarios={scenariosProps([], createScenario)} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: rowLabel("Explore", "Go-live") }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(createScenario).toHaveBeenCalledTimes(1);
    const [id, draft] = createScenario.mock.calls[0] as unknown as [number, { name: string; changes: { kind: string }[] }];
    expect(id).toBe(9);
    expect(draft.name).toBe("Go-live — what it would take (+2 people)");
    expect(draft.changes.map((c) => c.kind)).toEqual(["addPeople"]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("the other lever replaces the draft's name and row, and the first one comes back the same way", async () => {
    render(<Harness />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: rowLabel("Explore", "Go-live") }));
    await user.click(screen.getByRole("button", { name: "Or use 9 fewer tasks on Go-live instead" }));
    expect(draftName()).toBe("Go-live — what it would take (9 fewer tasks)");
    await user.click(screen.getByRole("button", { name: "Or use +2 people on Go-live instead" }));
    expect(draftName()).toBe("Go-live — what it would take (+2 people)");
    expect((screen.getByLabelText("Change 1: Count") as HTMLInputElement).value).toBe("2");
    expect(screen.getByRole("button", { name: "Or use 9 fewer tasks on Go-live instead" })).toBeInTheDocument();
  });

  test("the draft is compared live: As is vs. Draft, recomputed when the count changes, absent while incomplete", async () => {
    render(<Harness />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: rowLabel("Explore", "Go-live") }));
    const dialog = screen.getByRole("dialog", { name: "New scenario" });
    await within(dialog).findByRole("group", { name: "Go-live, Draft, simulated" }, { timeout: 4000 });
    expect(within(dialog).getByRole("group", { name: "Go-live, As is, simulated" })).toBeInTheDocument();
    const withTwo = draftFigures();
    const count = within(dialog).getByLabelText("Change 1: Count");
    await user.clear(count);
    expect(within(dialog).queryAllByRole("group", { name: /, Draft, simulated$/ }), "an incomplete draft shows no Draft figures").toHaveLength(0);
    expect(within(dialog).getByText("The draft is compared once every change is complete.")).toBeInTheDocument();
    await user.type(count, "8");
    await waitFor(() => expect(draftFigures()).not.toBe(""), { timeout: 4000 });
    expect(draftFigures()).not.toBe(withTwo);
  });

  test("a 40-character milestone's draft name fits and saves", async () => {
    const created: ScenarioDraft[] = [];
    const long = "Customer onboarding portal go-live phase";
    render(<SavingHarness milestones={[{ ...MILESTONES[0], name: long }, MILESTONES[1]]} onCreate={(d) => created.push(d)} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: rowLabel("Explore", long) }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(created).toHaveLength(1);
    expect(created[0].name.length).toBeLessThanOrEqual(60);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("exploring the same lever twice saves both", async () => {
    const created: ScenarioDraft[] = [];
    render(<SavingHarness onCreate={(d) => created.push(d)} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: rowLabel("Explore", "Go-live") }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await user.click(screen.getByRole("radio", { name: "Quick" }));
    await user.click(screen.getByRole("button", { name: rowLabel("Explore", "Go-live") }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(created.map((d) => d.name)).toEqual([
      "Go-live — what it would take (+2 people)", "Go-live — what it would take (+2 people) (2)",
    ]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("at the four-scenario cap Explore still opens the draft, with Save disabled and the cap message", async () => {
    const createScenario = vi.fn((): number | null => 9);
    render(<Harness scenarios={scenariosProps(four(4), createScenario)} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: rowLabel("Explore", "Go-live") }));
    const dialog = screen.getByRole("dialog", { name: "New scenario" });
    const save = within(dialog).getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();
    const reason = within(dialog).getByText("A project keeps at most 4 scenarios.");
    expect(save.getAttribute("aria-describedby")).toBe(reason.id);
    await user.click(save);
    expect(createScenario).not.toHaveBeenCalled();
  });

  test("a pending draft opens on a FRESH mount, once, and is consumed", async () => {
    const onDraftConsumed = vi.fn();
    const req: ForecastDraftRequest = { target: { kind: "milestone", id: 1 }, kind: "tasks", n: 9, alt: { kind: "people", n: 2 } };
    const { rerender } = render(<Harness pendingDraft={req} onDraftConsumed={onDraftConsumed} />);
    expect(draftName()).toBe("Go-live — what it would take (9 fewer tasks)");
    expect(screen.getByRole("button", { name: "Or use +2 people on Go-live instead" })).toBeInTheDocument();
    expect(onDraftConsumed).toHaveBeenCalledTimes(1);
    await userEvent.setup().click(screen.getByRole("button", { name: "Cancel" }));
    // The parent has not cleared it yet: the same request must not reopen the draft.
    rerender(<Harness pendingDraft={req} onDraftConsumed={onDraftConsumed} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(onDraftConsumed).toHaveBeenCalledTimes(1);
  });

  test("no lever cell outside Quick: What-if disables the search and drops the column", async () => {
    render(<Harness />);
    await userEvent.setup().click(screen.getByRole("radio", { name: "What-if" }));
    expect(screen.queryByRole("columnheader", { name: /What it would take/ })).toBeNull();
    expect(lastSearch().enabled).toBe(false);
  });

  test("pending levers read Working it out…", () => {
    stub.values = new Map<string, LeverValue>([["m:1", "pending"]]);
    render(<Harness />);
    expect(within(screen.getByRole("row", { name: /^Go-live/ })).getByText("Working it out…")).toBeInTheDocument();
  });

  test("with no lever reaching the target the row offers no Explore", () => {
    stub.values = new Map<string, LeverValue>([["m:1", { ...GO_LIVE_LEVERS, people: OUT, tasks: OUT, prioritised: 0.4 }]]);
    render(<Harness />);
    expect(within(screen.getByRole("row", { name: /^Go-live/ })).queryByRole("button")).toBeNull();
  });
});
