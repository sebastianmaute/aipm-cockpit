import { describe, expect, it } from "vitest";
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

/** A list-backed api, so a delete really removes the row. */
function Harness({ initial, tasks = HISTORY, readOnly = false }: { initial: ForecastScenario[]; tasks?: Task[]; readOnly?: boolean }) {
  const [list, setList] = useState(initial);
  const input = useMemo<ScenarioRunInput>(() => ({
    tasks, milestones: NO_MILESTONES, today: TODAY, holidaySet: NO_HOLIDAYS, window: 60, unit: "tasks",
    planEnd: "2026-12-31", directory: DIRECTORY, budgetFacts: null, costOn: false,
  }), [tasks]);
  const api: ForecastScenariosApi = {
    scenarios: list,
    canCreate: list.length < 4,
    mintId: () => 99,
    createScenario: () => null,
    updateScenario: () => false,
    renameScenario: () => false,
    deleteScenario: (id) => setList((prev) => prev.filter((s) => s.id !== id)),
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
    const { container } = renderView({ initial: [scenario(1, "A")] });
    const button = screen.getByRole("button", { name: "New scenario" });
    expect(button).toBeEnabled();
    expect(button).not.toHaveAttribute("aria-describedby");
    expect(screen.queryByText("A project keeps at most 4 scenarios.")).toBeNull();
    await user.click(button);
    expect(container.querySelector("[data-open-dialog]")).toHaveAttribute("data-open-dialog", "edit");
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
    expect(screen.queryByRole("button", { name: /Save as scenario/ })).toBeNull();
  });

  it("below the floor the message shows once and the list stays editable", async () => {
    const user = userEvent.setup();
    const { container } = renderView({ initial: [scenario(1, "Alpha"), scenario(2, "Beta")], tasks: SHORT });
    expect(screen.getAllByText("3 of 10 finished tasks — 7 more needed")).toHaveLength(1);
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByRole("button", { name: "New scenario" })).toBeEnabled();
    await user.click(screen.getByRole("button", { name: "Rename – Beta" }));
    expect(container.querySelector("[data-open-dialog]")).toHaveAttribute("data-open-dialog", "rename");
  });
});
