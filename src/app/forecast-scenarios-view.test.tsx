import { describe, expect, it, vi } from "vitest";
import { useMemo, useState } from "react";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ForecastScenariosView } from "./forecast-scenarios-view";
import { TestProviders } from "./test-providers";
import { ConfirmProvider } from "./confirm-dialog";
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
function Harness({ initial, tasks = HISTORY, readOnly = false, planEnd = "2026-12-31", writes }: {
  initial: ForecastScenario[]; tasks?: Task[]; readOnly?: boolean; planEnd?: string; writes?: Partial<Writes>;
}) {
  const [list, setList] = useState(initial);
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
  return <ForecastScenariosView lang="en-US" input={input} scenarios={{ api, directory: DIRECTORY, readOnly }} />;
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
