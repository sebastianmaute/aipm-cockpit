import { describe, expect, it, vi } from "vitest";
import { useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ForecastScenariosView } from "./forecast-scenarios-view";
import { TestProviders } from "./test-providers";
import { ConfirmProvider } from "./confirm-dialog";
import { ToastProvider } from "./toast-context";
import type { ForecastScenariosApi } from "./use-forecast-scenarios";
import type { ScenarioRunInput } from "./forecast-scenario-compare";
import type { ScenarioDirectory } from "./forecast-added-people";
import type { ForecastScenario } from "./forecast-scenarios";
import type { Milestone, Task } from "./types";
import { workingDaysBefore } from "./working-days";

// 2026-10-14 is a Wednesday.
const TODAY = "2026-10-14";
const NO_HOLIDAYS: ReadonlySet<string> = new Set();
const NO_MILESTONES: Milestone[] = [];
const DIRECTORY: ScenarioDirectory = {
  resources: [], roles: [], shifts: [], absences: [], budgets: [], fxRates: null, workdayHours: 8, baseCurrency: "EUR",
};

const task = (id: number, over: Partial<Task> = {}): Task =>
  ({ id, title: `t${id}`, dueDate: "", priority: "Medium", status: "Open", ...over }) as Task;
function steadyDone(n: number): Task[] {
  return [...workingDaysBefore(TODAY, n - 1, NO_HOLIDAYS), TODAY].map((d, i) => task(1000 + i, { status: "Done", completedDate: d }));
}
const open = (n: number) => Array.from({ length: n }, (_, i) => task(i + 1));
const HISTORY = [...open(5), ...steadyDone(60)];
const SHORT = [...open(4), ...steadyDone(3)];

const scenario = (id: number, name: string): ForecastScenario => ({
  id, name, changes: [{ kind: "availability", percent: 50, from: TODAY, until: "" }],
});

type Writes = Pick<ForecastScenariosApi, "createScenario" | "updateScenario" | "renameScenario">;
/** A list-backed api, so a delete really removes the row. */
function Harness({ initial, tasks = HISTORY, readOnly = false, planEnd = "2026-12-31", writes, onSetList, proposal }: {
  initial: ForecastScenario[]; tasks?: Task[]; readOnly?: boolean; planEnd?: string; writes?: Partial<Writes>;
  /** Lets a test play a concurrent writer (another tab, the AI) that changes the list while a dialog is open. */
  onSetList?: (set: Dispatch<SetStateAction<ForecastScenario[]>>) => void;
  proposal?: { id: number | null; onChange: (id: number | null) => void };
}) {
  const [list, setList] = useState(initial);
  onSetList?.(setList);
  const input = useMemo<ScenarioRunInput>(() => ({
    tasks, milestones: NO_MILESTONES, today: TODAY, holidaySet: NO_HOLIDAYS, window: 60, unit: "tasks",
    planEnd, directory: DIRECTORY, budgetFacts: null, costOn: false,
  }), [tasks, planEnd]);
  const api: ForecastScenariosApi = {
    scenarios: list,
    canCreate: list.length < 4,
    mintId: () => 99,
    createScenario: () => null,
    updateScenario: () => false,
    renameScenario: () => false,
    deleteScenario: (id) => setList((prev) => prev.filter((s) => s.id !== id)),
    ...writes,
  };
  return <ForecastScenariosView lang="en-US" input={input} scenarios={{ api, directory: DIRECTORY, readOnly }} proposal={proposal} />;
}

function renderView(props: Parameters<typeof Harness>[0]) {
  return render(
    <TestProviders>
      <ConfirmProvider lang="en-US">
        <Harness {...props} />
      </ConfirmProvider>
    </TestProviders>,
  );
}

const ACTION = /^(Edit|Rename|Delete) – /;

describe("ForecastScenariosView", () => {
  it("As is first, then scenarios in saved order", () => {
    renderView({ initial: [scenario(2, "Zeta"), scenario(1, "Alpha")] });
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["As is", "Zeta", "Alpha"]);
    expect(screen.getAllByRole("group", { name: /^Finish range – / }).map((g) => g.getAttribute("aria-label"))).toEqual([
      "Finish range – As is, simulated", "Finish range – Zeta, simulated", "Finish range – Alpha, simulated",
    ]);
  });

  it("New scenario is disabled with its reason at four", () => {
    renderView({ initial: [scenario(1, "A"), scenario(2, "B"), scenario(3, "C"), scenario(4, "D")] });
    const button = screen.getByRole("button", { name: "New scenario" });
    expect(button).toBeDisabled();
    const reason = screen.getByText("A project keeps at most 4 scenarios.");
    expect(button.getAttribute("aria-describedby")).toBe(reason.id);
    expect(reason.id).not.toBe("");
  });

  it("New scenario is enabled below the cap and opens the editor", async () => {
    const user = userEvent.setup();
    const createScenario = vi.fn((): number | null => 99);
    renderView({ initial: [scenario(1, "A")], writes: { createScenario } });
    const button = screen.getByRole("button", { name: "New scenario" });
    expect(button).toBeEnabled();
    expect(button).not.toHaveAttribute("aria-describedby");
    expect(screen.queryByText("A project keeps at most 4 scenarios.")).toBeNull();
    await user.click(button);
    const dialog = screen.getByRole("dialog", { name: "New scenario" });
    await user.type(within(dialog).getByRole("textbox", { name: "Name" }), "B");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(createScenario).toHaveBeenCalledWith(99, { name: "B", changes: [] });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Edit opens the editor on the scenario's rows and saves through updateScenario", async () => {
    const user = userEvent.setup();
    const updateScenario = vi.fn(() => true);
    renderView({ initial: [scenario(1, "Alpha")], writes: { updateScenario } });
    await user.click(screen.getByRole("button", { name: "Edit – Alpha" }));
    const dialog = screen.getByRole("dialog", { name: "Edit scenario" });
    expect(within(dialog).getByRole("textbox", { name: "Name" })).toHaveValue("Alpha");
    expect(within(dialog).getByLabelText("Change 1: Availability (%)")).toHaveValue(50);
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(updateScenario).toHaveBeenCalledWith(1, { name: "Alpha", changes: scenario(1, "Alpha").changes });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Cancel closes the editor and writes nothing", async () => {
    const user = userEvent.setup();
    const updateScenario = vi.fn(() => true);
    renderView({ initial: [scenario(1, "Alpha")], writes: { updateScenario } });
    await user.click(screen.getByRole("button", { name: "Edit – Alpha" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(updateScenario).not.toHaveBeenCalled();
  });

  it("renders five scenarios (one past the cap, after an undo)", () => {
    const five = [1, 2, 3, 4, 5].map((id) => scenario(id, `S${id}`));
    renderView({ initial: five });
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["As is", "S1", "S2", "S3", "S4", "S5"]);
    expect(screen.getAllByRole("group", { name: /^Finish range – / })).toHaveLength(6);
    expect(screen.getAllByRole("button", { name: /^Edit – / })).toHaveLength(5);
    expect(screen.getByRole("button", { name: "New scenario" })).toBeDisabled();
  });

  it("a finish beyond the horizon reads \"> 5 y\" with the sim marking", () => {
    const slow: ForecastScenario = {
      id: 1, name: "Slow",
      changes: [{ kind: "availability", percent: 10, from: TODAY, until: "" }, { kind: "scope", tasks: 1000, on: TODAY }],
    };
    renderView({ initial: [slow] });
    const group = screen.getByRole("group", { name: "Finish range – Slow, simulated" });
    expect(group).toHaveAttribute("data-sim", "true");
    expect(group).toHaveTextContent("> 5 y");
    expect(within(group).queryByRole("img")).toBeNull();
  });

  it("a plan end in the past opens the shared axis, so it is not drawn at today", () => {
    const measure = (planEnd: string) => {
      // A faster scenario finishes before As is's last date, so its band start is not pinned to the axis end.
      const fast: ForecastScenario = { id: 1, name: "Fast", changes: [{ kind: "availability", percent: 300, from: TODAY, until: "" }] };
      const { container, unmount } = renderView({ initial: [fast], planEnd });
      const band = container.querySelectorAll("[data-band]")[1];
      const plan = container.querySelector("[data-plan-end]");
      const out = { band: Number(band?.getAttribute("x")), plan: Number(plan?.getAttribute("x1")) };
      unmount();
      return out;
    };
    const june = measure("2026-06-30");
    const march = measure("2026-03-31");
    // The plan end is the axis start in both; the band sits further right the further back the axis starts.
    expect(june.plan).toBe(march.plan);
    expect(march.band).toBeGreaterThan(june.band);
    // Control: a plan end after today leaves the axis starting at today, the band left of the plan end.
    const future = measure("2026-12-31");
    expect(future.plan).toBeGreaterThan(future.band);
  });

  it("delete asks, then deletes", async () => {
    const user = userEvent.setup();
    renderView({ initial: [scenario(1, "Alpha"), scenario(2, "Beta")] });
    await user.click(screen.getByRole("button", { name: "Delete – Alpha" }));
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Delete scenario “Alpha”? You can undo this.")).toBeInTheDocument();
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["As is", "Alpha", "Beta"]);
    await user.click(within(dialog).getByRole("button", { name: "Delete" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["As is", "Beta"]);
  });

  // Final review Minor 8: the confirm returns focus to the deleted row's Delete, which then unmounts.
  it("after a delete focus moves to the next row's Edit, the previous one's for the last row, then New scenario", async () => {
    const user = userEvent.setup();
    renderView({ initial: [scenario(1, "Alpha"), scenario(2, "Beta"), scenario(3, "Gamma")] });
    const del = async (name: string) => {
      await user.click(screen.getByRole("button", { name: `Delete – ${name}` }));
      await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Delete" }));
    };
    await del("Alpha");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Edit – Beta" }));
    await del("Gamma");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Edit – Beta" }));
    await del("Beta");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "New scenario" }));
  });

  it("a declined delete keeps the scenario", async () => {
    const user = userEvent.setup();
    renderView({ initial: [scenario(1, "Alpha")] });
    await user.click(screen.getByRole("button", { name: "Delete – Alpha" }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Delete – Alpha" })).toBeInTheDocument();
  });

  it("duplicate scenario names get row-unique action names", () => {
    renderView({ initial: [scenario(1, "Plan"), scenario(2, "Plan"), scenario(3, "As is")] });
    const names = screen.getAllByRole("button", { name: ACTION }).map((b) => b.getAttribute("aria-label"));
    expect(names).toEqual([
      "Edit – Plan (1)", "Rename – Plan (1)", "Delete – Plan (1)",
      "Edit – Plan (2)", "Rename – Plan (2)", "Delete – Plan (2)",
      "Edit – As is (2)", "Rename – As is (2)", "Delete – As is (2)",
    ]);
    expect(new Set(names).size).toBe(names.length);
    // The columns carry the same distinct names, so no two figures share an accessible name.
    expect(screen.getAllByRole("columnheader").map((h) => h.textContent)).toEqual(["As is (1)", "Plan (1)", "Plan (2)", "As is (2)"]);
  });

  it("read-only in a popout", () => {
    renderView({ initial: [scenario(1, "Alpha")], readOnly: true });
    // Positive control: the scenario is shown.
    expect(screen.getAllByText("Alpha").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: ACTION })).toBeNull();
    expect(screen.queryByRole("button", { name: "New scenario" })).toBeNull();
    // "Save as scenario" lives in the toolbar, so its read-only test is in forecast-panel.test.tsx.
  });

  it("below the floor the message shows once and the list stays editable", async () => {
    const user = userEvent.setup();
    const renameScenario = vi.fn(() => true);
    renderView({ initial: [scenario(1, "Alpha"), scenario(2, "Beta")], tasks: SHORT, writes: { renameScenario } });
    expect(screen.getAllByText("3 of 10 finished tasks — 7 more needed")).toHaveLength(1);
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByRole("button", { name: "New scenario" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Rename – Beta" }));
    const dialog = screen.getByRole("dialog", { name: "Rename scenario" });
    const name = within(dialog).getByRole("textbox", { name: "Name" });
    expect(name).toHaveValue("Beta");
    await user.clear(name);
    await user.type(name, "Gamma");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(renameScenario).toHaveBeenCalledWith(2, "Gamma");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("ForecastScenariosView — no silent refusals (fix round 1)", () => {
  const REFUSED = "Not saved: the scenarios were changed elsewhere.";

  it("a create refused after open keeps the editor open with the reason", async () => {
    const user = userEvent.setup();
    let refuse = false;
    const createScenario = vi.fn((): number | null => (refuse ? null : 99));
    renderView({ initial: [scenario(1, "A")], writes: { createScenario } });
    await user.click(screen.getByRole("button", { name: "New scenario" }));
    refuse = true; // a concurrent writer gets there first
    const dialog = screen.getByRole("dialog", { name: "New scenario" });
    await user.type(within(dialog).getByRole("textbox", { name: "Name" }), "B");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(createScenario).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("dialog", { name: "New scenario" })).toBeInTheDocument();
    expect(within(dialog).getByRole("alert")).toHaveTextContent(REFUSED);
  });

  it("an update refused after open keeps the editor open with the reason", async () => {
    const user = userEvent.setup();
    const updateScenario = vi.fn(() => false);
    renderView({ initial: [scenario(1, "Alpha")], writes: { updateScenario } });
    await user.click(screen.getByRole("button", { name: "Edit – Alpha" }));
    const dialog = screen.getByRole("dialog", { name: "Edit scenario" });
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(updateScenario).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("dialog", { name: "Edit scenario" })).toBeInTheDocument();
    expect(within(dialog).getByRole("alert")).toHaveTextContent(REFUSED);
  });

  it("the cap reached by another writer after open is said, and nothing is written", async () => {
    const user = userEvent.setup();
    const createScenario = vi.fn((): number | null => 99);
    let setList: Dispatch<SetStateAction<ForecastScenario[]>> | null = null;
    renderView({ initial: [scenario(1, "A"), scenario(2, "B"), scenario(3, "C")], writes: { createScenario }, onSetList: (set) => { setList = set; } });
    await user.click(screen.getByRole("button", { name: "New scenario" }));
    act(() => setList?.((prev) => [...prev, scenario(4, "D")]));
    const dialog = screen.getByRole("dialog", { name: "New scenario" });
    await user.type(within(dialog).getByRole("textbox", { name: "Name" }), "E");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(createScenario).not.toHaveBeenCalled();
    expect(within(dialog).getByRole("alert")).toHaveTextContent("A project keeps at most 4 scenarios.");
  });

  it("a rename refused after open keeps the dialog open with the reason", async () => {
    const user = userEvent.setup();
    let refuse = false;
    const renameScenario = vi.fn(() => !refuse);
    renderView({ initial: [scenario(1, "Alpha")], writes: { renameScenario } });
    await user.click(screen.getByRole("button", { name: "Rename – Alpha" }));
    refuse = true;
    const dialog = screen.getByRole("dialog", { name: "Rename scenario" });
    const name = within(dialog).getByRole("textbox", { name: "Name" });
    await user.clear(name);
    await user.type(name, "Gamma");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    expect(renameScenario).toHaveBeenCalledWith(1, "Gamma");
    expect(screen.getByRole("dialog", { name: "Rename scenario" })).toBeInTheDocument();
    const id = name.getAttribute("aria-describedby");
    expect(id ? document.getElementById(id)?.textContent : null).toBe(REFUSED);
  });
});

describe("ForecastScenariosView — Use as proposal (§502 part 4)", () => {
  /** A harness that keeps the proposal like the settings hook does, and records every write. */
  function ProposalHarness({ initial, start = null, onChange }: { initial: ForecastScenario[]; start?: number | null; onChange: (id: number | null) => void }) {
    const [id, setId] = useState<number | null>(start);
    return <Harness initial={initial} proposal={{ id, onChange: (next) => { onChange(next); setId(next); } }} />;
  }
  const toggle = (name: string) => screen.getByRole("button", { name: `Use as proposal – ${name}` });

  it("pressing it on scenario 2 proposes 2; pressing again clears it", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<TestProviders><ConfirmProvider lang="en-US"><ProposalHarness initial={[scenario(1, "Alpha"), scenario(2, "Beta")]} onChange={onChange} /></ConfirmProvider></TestProviders>);
    expect(toggle("Beta")).toHaveAttribute("aria-pressed", "false");
    await user.click(toggle("Beta"));
    expect(onChange).toHaveBeenLastCalledWith(2);
    expect(toggle("Beta")).toHaveAttribute("aria-pressed", "true");
    expect(toggle("Alpha")).toHaveAttribute("aria-pressed", "false");
    await user.click(toggle("Beta"));
    expect(onChange).toHaveBeenLastCalledWith(null);
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("pressing another moves it", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<TestProviders><ConfirmProvider lang="en-US"><ProposalHarness initial={[scenario(1, "Alpha"), scenario(2, "Beta")]} start={1} onChange={onChange} /></ConfirmProvider></TestProviders>);
    await user.click(toggle("Beta"));
    expect(onChange).toHaveBeenLastCalledWith(2);
  });

  it("two toggles have distinct names, even for twin scenario names, and sit before Edit", () => {
    render(<TestProviders><ConfirmProvider lang="en-US"><ProposalHarness initial={[scenario(1, "Same"), scenario(2, "Same")]} onChange={() => {}} /></ConfirmProvider></TestProviders>);
    const names = screen.getAllByRole("button", { name: /^Use as proposal – / }).map((b) => b.getAttribute("aria-label"));
    expect(names).toHaveLength(2);
    expect(new Set(names).size).toBe(2);
    const row = screen.getAllByRole("listitem")[0];
    expect(within(row).getAllByRole("button").map((b) => b.textContent)).toEqual(["Use as proposal", "Edit", "Rename", "Delete"]);
  });

  it("the Compared header of the proposal column carries a proposal badge, and only that one", () => {
    render(<TestProviders><ConfirmProvider lang="en-US"><ProposalHarness initial={[scenario(1, "Alpha"), scenario(2, "Beta")]} start={2} onChange={() => {}} /></ConfirmProvider></TestProviders>);
    const headers = screen.getAllByRole("columnheader");
    expect(headers.map((h) => h.textContent)).toEqual(["As is", "Alpha", "Betaproposal"]);
    expect(within(headers[2]).getByText("proposal")).toBeInTheDocument();
  });

  it("read-only shows no toggle", () => {
    render(<TestProviders><ConfirmProvider lang="en-US"><Harness initial={[scenario(1, "Alpha")]} readOnly proposal={{ id: 1, onChange: () => {} }} /></ConfirmProvider></TestProviders>);
    expect(screen.queryByRole("button", { name: /^Use as proposal/ })).toBeNull();
  });
});

describe("ForecastScenariosView — an Explore draft whose milestone disappears (§502 part 4)", () => {
  const GO_LIVE: Milestone[] = [{ id: 7, name: "Go-live", date: "2026-11-30", linkedTaskIds: [1, 2, 3, 4, 5] }];
  const inputOf = (milestones: Milestone[]): ScenarioRunInput => ({
    tasks: HISTORY, milestones, today: TODAY, holidaySet: NO_HOLIDAYS, window: 60, unit: "tasks",
    planEnd: "2026-12-31", directory: DIRECTORY, budgetFacts: null, costOn: false,
  });
  const api: ForecastScenariosApi = {
    scenarios: [], canCreate: true, mintId: () => 99, createScenario: () => null,
    updateScenario: () => false, renameScenario: () => false, deleteScenario: () => {},
  };
  const DRAFT = { req: { target: { kind: "milestone" as const, id: 7 }, kind: "tasks" as const, n: 1, alt: null }, seq: 1 };
  const view = (milestones: Milestone[], onDraftClose: () => void) => (
    <TestProviders><ConfirmProvider lang="en-US">
      <ForecastScenariosView lang="en-US" input={inputOf(milestones)} scenarios={{ api, directory: DIRECTORY, readOnly: false }} draft={DRAFT} onDraftClose={onDraftClose} />
    </ConfirmProvider></TestProviders>
  );

  it("tells the PM why the editor closed", () => {
    const showToast = vi.fn();
    const wrap = (milestones: Milestone[]) => (
      <ToastProvider value={{ showToast, showToastAction: vi.fn() }}>{view(milestones, vi.fn())}</ToastProvider>
    );
    const { rerender } = render(wrap(GO_LIVE));
    expect(showToast).not.toHaveBeenCalled();
    rerender(wrap([]));
    expect(showToast).toHaveBeenCalledWith("info", "The draft closed because its milestone can no longer be explored.");
  });

  it("clears the pending draft, so an undo that restores the milestone cannot reopen the editor", () => {
    const onDraftClose = vi.fn();
    const { rerender } = render(view(GO_LIVE, onDraftClose));
    expect(screen.getByRole("textbox", { name: "Name" })).toBeInTheDocument(); // positive control: the draft opens
    expect(onDraftClose).not.toHaveBeenCalled();
    rerender(view([], onDraftClose));
    expect(screen.queryByRole("textbox", { name: "Name" })).toBeNull();
    expect(onDraftClose).toHaveBeenCalledWith("cancelled");
  });
});
