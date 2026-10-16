import { beforeAll, describe, expect, test } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ForecastPanel } from "./forecast-panel";
import { loadI18n, t } from "./i18n";
import type { Milestone, ResourcePlan, Task } from "./types";
import type { DatedValue, ForecastFacts, ForecastFactsByUnit } from "./budget-forecast";
import { nthWorkingDayAfter, workingDaysBefore } from "./working-days";
import { MAX_HORIZON_WORKING_DAYS } from "./forecast/constants";
import { buttonNames, expectButtonOrder } from "../test/toolbar-order";

// 2026-10-14 is a Wednesday.
const TODAY = "2026-10-14";
const NO_HOLIDAYS: ReadonlySet<string> = new Set();
// Hoisted so a rerender changes only the prop under test; a fresh [] would recompute on its own.
const NO_MILESTONES: Milestone[] = [];
const PLAN = { startDate: "2026-01-01", endDate: "2026-12-31", granularity: "week", currency: "EUR" } as ResourcePlan;

function task(id: number, over: Partial<Task> = {}): Task {
  return { id, title: `t${id}`, dueDate: "", priority: "Medium", status: "Open", ...over } as Task;
}
/** One task done on each of the last `n` working days including today, so every sample is 1. */
function steadyDone(n: number, minutes?: number): Task[] {
  const days = [...workingDaysBefore(TODAY, n - 1, NO_HOLIDAYS), TODAY];
  return days.map((d, i) => task(1000 + i, { status: "Done", completedDate: d, originalEstimateMinutes: minutes }));
}
const open = (n: number, over: Partial<Task> = {}): Task[] => Array.from({ length: n }, (_, i) => task(i + 1, over));

function renderPanel(tasks: Task[], holidaySet: ReadonlySet<string> = NO_HOLIDAYS) {
  return render(
    <ForecastPanel lang="en-US" tasks={tasks} milestones={NO_MILESTONES} plan={PLAN} today={TODAY} holidaySet={holidaySet} />,
  );
}
const p50 = () => within(screen.getByRole("row", { name: /^P50/ })).getAllByRole("cell")[0].textContent;
/** The How-many date commits on blur or Enter only (M5): type a value, then leave the field. */
function commitTarget(input: HTMLElement, value: string) {
  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
}

describe("ForecastPanel", () => {
  beforeAll(async () => {
    await loadI18n("de");
  });

  test("shows the empty state below the history floor", () => {
    renderPanel([...open(4), ...steadyDone(3)]);
    expect(screen.getByText("3 of 10 finished tasks — 7 more needed")).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
  });

  test("the empty state reads in German", () => {
    render(
      <ForecastPanel lang="de" tasks={[...open(4), ...steadyDone(3)]} milestones={NO_MILESTONES} plan={PLAN} today={TODAY} holidaySet={NO_HOLIDAYS} />,
    );
    expect(screen.getByText("3 von 10 erledigten Aufgaben – 7 weitere nötig")).toBeTruthy();
  });

  test("Quick ignores what-if values; What-if shows scope and capacity inputs", async () => {
    const user = userEvent.setup();
    renderPanel([...open(5), ...steadyDone(60)]);
    expect(screen.queryByLabelText("Capacity (%)")).toBeNull();
    expect(p50()).toBe("Oct 21, 2026");

    await user.click(screen.getByRole("radio", { name: "What-if" }));
    expect(screen.getByLabelText("Scope change (tasks)")).toBeTruthy();
    expect(screen.getByLabelText("Scope change (%)")).toBeTruthy();
    const capacity = screen.getByLabelText("Capacity (%)");
    await user.clear(capacity);
    await user.type(capacity, "200{Enter}");
    expect(p50()).toBe("Oct 19, 2026");

    await user.click(screen.getByRole("radio", { name: "Quick" }));
    expect(screen.queryByLabelText("Capacity (%)")).toBeNull();
    expect(p50()).toBe("Oct 21, 2026");
  });

  test("effort toggle is disabled with a reason under 70% coverage", () => {
    renderPanel([...open(5), ...steadyDone(60)]);
    expect((screen.getByRole("radio", { name: "Effort" }) as HTMLButtonElement).disabled).toBe(true);
    const reason = "Effort needs an estimate on 70% of open tasks; 0% have one.";
    const group = screen.getByRole("radiogroup", { name: "Forecast unit" });
    expect(group.getAttribute("title")).toBe(reason);
    // Visible text too (a disabled radio cannot be focused to reveal a title), and the group's description.
    const hint = screen.getByText(reason);
    expect(hint.closest("[title]"), "the hint is its own visible node, not the title").toBeNull();
    expect(group.getAttribute("aria-describedby")).toBe(hint.id);
    expect(hint.id).not.toBe("");
  });

  test("effort toggle is enabled at full coverage", () => {
    renderPanel([...open(5, { originalEstimateMinutes: 60 }), ...steadyDone(60, 60)]);
    expect((screen.getByRole("radio", { name: "Effort" }) as HTMLButtonElement).disabled).toBe(false);
    expect(screen.getByRole("radiogroup", { name: "Forecast unit" }).hasAttribute("aria-describedby")).toBe(false);
    expect(screen.queryByText(/Effort needs an estimate/)).toBeNull();
  });

  test("an invalid capacity reverts and shows the message", async () => {
    const user = userEvent.setup();
    renderPanel([...open(5), ...steadyDone(60)]);
    await user.click(screen.getByRole("radio", { name: "What-if" }));
    const capacity = screen.getByLabelText("Capacity (%)") as HTMLInputElement;
    await user.clear(capacity);
    await user.type(capacity, "5");
    await user.tab();
    expect(capacity.value).toBe("100");
    expect(capacity.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText("Not a valid value; the previous one is kept.")).toBeTruthy();
    expect(p50()).toBe("Oct 21, 2026");
  });

  test("recomputes when holidaySet changes", () => {
    const tasks = [...open(5), ...steadyDone(60)];
    const { rerender } = renderPanel(tasks);
    expect(p50()).toBe("Oct 21, 2026");
    rerender(
      <ForecastPanel lang="en-US" tasks={tasks} milestones={NO_MILESTONES} plan={PLAN} today={TODAY} holidaySet={new Set(["2026-10-15"])} />,
    );
    expect(p50()).toBe("Oct 22, 2026");
  });

  test("captions the basis of the forecast", () => {
    renderPanel([...open(5), ...steadyDone(60), task(90, { status: "Done" })]);
    expect(screen.getByText("10,000 runs of your last 60 working days (60 finished tasks)")).toBeTruthy();
    expect(screen.getByText("1 done task has no completion date and is not counted.")).toBeTruthy();
  });

  test("an empty backlog captions its 0 or 1 counts grammatically, EN and DE (M4)", async () => {
    const user = userEvent.setup();
    // The floor is skipped for an empty backlog, so one finish today still forecasts.
    const one = steadyDone(1);
    const { unmount } = renderPanel(one);
    expect(screen.getByText("10,000 runs of your last 1 working day (1 finished task)")).toBeTruthy();
    await user.selectOptions(screen.getByLabelText("History"), "all");
    expect(screen.getByText("10,000 runs of 1 working day of history (1 finished task)")).toBeTruthy();
    unmount();
    const { unmount: unmountEmpty } = renderPanel([]);
    expect(screen.getByText("10,000 runs of your last 0 working days (0 finished tasks)")).toBeTruthy();
    unmountEmpty();
    render(<ForecastPanel lang="de" tasks={one} milestones={NO_MILESTONES} plan={PLAN} today={TODAY} holidaySet={NO_HOLIDAYS} />);
    expect(screen.getByText("10.000 Durchläufe über Ihren letzten 1 Arbeitstag (1 erledigte Aufgabe)")).toBeTruthy();
  });

  test("the caption reads in German with many days and tasks", () => {
    render(<ForecastPanel lang="de" tasks={[...open(5), ...steadyDone(60)]} milestones={NO_MILESTONES} plan={PLAN} today={TODAY} holidaySet={NO_HOLIDAYS} />);
    expect(screen.getByText("10.000 Durchläufe über Ihre letzten 60 Arbeitstage (60 erledigte Aufgaben)")).toBeTruthy();
  });

  test("the How many target commits on blur or Enter, not on each change (M5)", () => {
    renderPanel([...open(5), ...steadyDone(60)]);
    const input = screen.getByLabelText("How many by") as HTMLInputElement;
    const header = (name: string) => screen.queryByRole("columnheader", { name });
    fireEvent.change(input, { target: { value: "2026-11-02" } });
    expect(input.value, "the draft shows while typing").toBe("2026-11-02");
    expect(header("At least, by Dec 31, 2026"), "no recompute before the commit").toBeTruthy();
    fireEvent.blur(input);
    expect(header("At least, by Nov 2, 2026"), "blur commits").toBeTruthy();
    fireEvent.change(input, { target: { value: "2026-11-09" } });
    expect(header("At least, by Nov 2, 2026"), "still no recompute per change").toBeTruthy();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(header("At least, by Nov 9, 2026"), "Enter commits").toBeTruthy();
  });

  test("a pending target draft shows a hint that describes the input, gone once committed (M5)", () => {
    renderPanel([...open(5), ...steadyDone(60)]);
    const input = screen.getByLabelText("How many by") as HTMLInputElement;
    const HINT = "Applies when you leave the field or press Enter";
    expect(screen.queryByText(HINT), "no draft, no hint").toBeNull();
    expect(input.hasAttribute("aria-describedby")).toBe(false);
    fireEvent.change(input, { target: { value: "2026-11-02" } });
    const hint = screen.getByText(HINT);
    expect(hint.id).not.toBe("");
    expect(input.getAttribute("aria-describedby")?.split(" ")).toContain(hint.id);
    fireEvent.blur(input);
    expect(screen.queryByText(HINT), "committed, hint gone").toBeNull();
    expect(input.hasAttribute("aria-describedby")).toBe(false);
  });

  test("a refused draft keeps both descriptions while a new draft is pending (M5)", () => {
    renderPanel([...open(5), ...steadyDone(60)]);
    const input = screen.getByLabelText("How many by") as HTMLInputElement;
    commitTarget(input, "2026-10-01");
    fireEvent.change(input, { target: { value: "2026-11-02" } });
    const ids = input.getAttribute("aria-describedby")?.split(" ") ?? [];
    expect(ids).toContain(screen.getByText("Not a valid value; the previous one is kept.").id);
    expect(ids).toContain(screen.getByText("Applies when you leave the field or press Enter").id);
  });

  test("the target hint reads in German", () => {
    render(<ForecastPanel lang="de" tasks={[...open(5), ...steadyDone(60)]} milestones={NO_MILESTONES} plan={PLAN} today={TODAY} holidaySet={NO_HOLIDAYS} />);
    fireEvent.change(screen.getByLabelText("Wie viel bis"), { target: { value: "2026-11-02" } });
    expect(screen.getByText("Wird übernommen, wenn Sie das Feld verlassen oder Enter drücken")).toBeTruthy();
  });

  test("a draft target is dropped when the committed target changes from outside (M5)", () => {
    const tasks = [...open(5), ...steadyDone(60)];
    const { rerender } = renderPanel(tasks);
    const input = screen.getByLabelText("How many by") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "2026-11-02" } });
    // The default target follows the plan end; a new plan end replaces it under the uncommitted draft.
    const later = { ...PLAN, endDate: "2026-12-18" } as ResourcePlan;
    rerender(<ForecastPanel lang="en-US" tasks={tasks} milestones={NO_MILESTONES} plan={later} today={TODAY} holidaySet={NO_HOLIDAYS} />);
    expect(input.value).toBe("2026-12-18");
    fireEvent.blur(input);
    expect(screen.getByRole("columnheader", { name: "At least, by Dec 18, 2026" })).toBeTruthy();
  });

  test("percentile lines sit on the tick of their own date", () => {
    // Every run finishes on day 5 (Oct 21), the end of week 0: tick 0 and the first curve point.
    const { container } = renderPanel([...open(5), ...steadyDone(60)]);
    const tick = container.querySelector("[data-tick='0']");
    expect(tick?.textContent).toBe("Oct 21");
    for (const p of [50, 80, 95]) {
      const line = container.querySelector(`[data-percentile='${p}'] line`);
      expect(Number(line?.getAttribute("x1"))).toBeCloseTo(Number(tick?.getAttribute("x")), 6);
    }
  });

  test("a How many target before today is refused with the message", () => {
    renderPanel([...open(5), ...steadyDone(60)]);
    const input = screen.getByLabelText("How many by") as HTMLInputElement;
    expect(input.value).toBe("2026-12-31");
    commitTarget(input, "2026-10-01");
    expect(screen.getByText("Not a valid value; the previous one is kept.")).toBeTruthy();
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.value).toBe("2026-12-31");
    expect(screen.getByRole("columnheader", { name: "At least, by Dec 31, 2026" })).toBeTruthy();
    commitTarget(input, TODAY);
    expect(screen.queryByText("Not a valid value; the previous one is kept.")).toBeNull();
    expect(screen.getByRole("columnheader", { name: "At least, by Oct 14, 2026" })).toBeTruthy();
  });

  test("a How many target past the 1300-working-day horizon is refused (R15)", () => {
    renderPanel([...open(5), ...steadyDone(60)]);
    const input = screen.getByLabelText("How many by") as HTMLInputElement;
    const max = nthWorkingDayAfter(TODAY, MAX_HORIZON_WORKING_DAYS, NO_HOLIDAYS);
    expect(input.getAttribute("max")).toBe(max);
    commitTarget(input, "2206-10-14");
    expect(screen.getByText("Not a valid value; the previous one is kept.")).toBeTruthy();
    expect(input.value).toBe("2026-12-31");
    commitTarget(input, max);
    expect(screen.queryByText("Not a valid value; the previous one is kept.")).toBeNull();
    expect(input.value).toBe(max);
  });

  test("a stored target is re-clamped when today moves past it (T5e)", () => {
    const tasks = [...open(5), ...steadyDone(60)];
    const { rerender } = renderPanel(tasks);
    commitTarget(screen.getByLabelText("How many by"), TODAY);
    expect(screen.getByRole("columnheader", { name: "At least, by Oct 14, 2026" })).toBeTruthy();
    rerender(
      <ForecastPanel lang="en-US" tasks={tasks} milestones={NO_MILESTONES} plan={PLAN} today="2026-10-16" holidaySet={NO_HOLIDAYS} />,
    );
    expect(screen.getByRole("columnheader", { name: "At least, by Oct 16, 2026" })).toBeTruthy();
    expect((screen.getByLabelText("How many by") as HTMLInputElement).value).toBe("2026-10-16");
  });

  test("a default target past the horizon is clamped to it (T5e)", () => {
    const far = { ...PLAN, endDate: "2206-10-14" } as ResourcePlan;
    render(<ForecastPanel lang="en-US" tasks={[...open(5), ...steadyDone(60)]} milestones={NO_MILESTONES} plan={far} today={TODAY} holidaySet={NO_HOLIDAYS} />);
    const max = nthWorkingDayAfter(TODAY, MAX_HORIZON_WORKING_DAYS, NO_HOLIDAYS);
    expect((screen.getByLabelText("How many by") as HTMLInputElement).value).toBe(max);
  });

  test("a milestone with a blank date does not crash the view (R16)", () => {
    // Load repairs a date that is not YYYY-MM-DD to ""; the engine omits it, so no row is formatted.
    const blank: Milestone[] = [{ id: 1, name: "Broken", date: "", linkedTaskIds: [1] }];
    render(<ForecastPanel lang="en-US" tasks={[...open(5), ...steadyDone(60)]} milestones={blank} plan={PLAN} today={TODAY} holidaySet={NO_HOLIDAYS} />);
    expect(screen.queryByRole("rowheader", { name: /Broken/ })).toBeNull();
    expect(screen.getByText(t("en-US", "forecastNoMilestones"))).toBeTruthy();
  });

  test("a non-calendar milestone or plan end never becomes the default target (R16)", () => {
    // Load keeps a shape-valid non-calendar date raw (`isKeptNonCalendarDate`).
    const bad: Milestone[] = [{ id: 1, name: "Bad", date: "2026-11-31", linkedTaskIds: [1] }];
    const tasks = [...open(5), ...steadyDone(60)];
    const { unmount } = render(<ForecastPanel lang="en-US" tasks={tasks} milestones={bad} plan={PLAN} today={TODAY} holidaySet={NO_HOLIDAYS} />);
    expect((screen.getByLabelText("How many by") as HTMLInputElement).value, "milestone date skipped").toBe("2026-12-31");
    unmount();
    const badPlan = { ...PLAN, endDate: "2026-11-31" } as ResourcePlan;
    render(<ForecastPanel lang="en-US" tasks={tasks} milestones={NO_MILESTONES} plan={badPlan} today={TODAY} holidaySet={NO_HOLIDAYS} />);
    expect((screen.getByLabelText("How many by") as HTMLInputElement).value, "plan end skipped").toBe(
      nthWorkingDayAfter(TODAY, 30, NO_HOLIDAYS),
    );
  });

  test("tasks-mode amounts carry the unit word, with a real singular", () => {
    const { unmount } = renderPanel([...open(5), ...steadyDone(60)]);
    expect(screen.getByText("Open work: 5 tasks")).toBeTruthy();
    // The default target (plan end) lies past the backlog's finish, so every percentile delivers all 5.
    const howMany = () => screen.getAllByRole("row").slice(1).map((r) => within(r).getAllByRole("cell")[1].textContent);
    expect(howMany()).toEqual(["5 tasks", "5 tasks", "5 tasks"]);
    unmount();
    renderPanel([...open(1), ...steadyDone(60)]);
    expect(screen.getByText("Open work: 1 task")).toBeTruthy();
    expect(howMany()).toEqual(["1 task", "1 task", "1 task"]);
  });

  test("tasks-mode amounts read in German", () => {
    render(<ForecastPanel lang="de" tasks={[...open(5), ...steadyDone(60)]} milestones={NO_MILESTONES} plan={PLAN} today={TODAY} holidaySet={NO_HOLIDAYS} />);
    expect(screen.getByText("Offene Arbeit: 5 Aufgaben")).toBeTruthy();
  });

  test("a fixed window cut at the first completion says so in the empty state (R14)", async () => {
    const user = userEvent.setup();
    // Two finishes on each of the last 8 working days (Oct 5–14): enough tasks, too few days.
    const eight = steadyDone(8);
    renderPanel([...open(5), ...eight, ...eight.map((d) => ({ ...d, id: d.id + 500 }))]);
    expect(
      screen.getByText(
        "8 of 10 working days of history — 2 more needed. The window was shortened to start at the first completion, Oct 5, 2026.",
      ),
    ).toBeTruthy();
    // "All history" always starts at the first completion, so there is nothing to explain.
    await user.selectOptions(screen.getByLabelText("History"), "all");
    expect(screen.getByText("8 of 10 working days of history — 2 more needed")).toBeTruthy();
    expect(screen.queryByText(/window was shortened/)).toBeNull();
  });

  test("the cut-window note reads in German", () => {
    const eight = steadyDone(8);
    render(
      <ForecastPanel lang="de" tasks={[...open(5), ...eight, ...eight.map((d) => ({ ...d, id: d.id + 500 }))]} milestones={NO_MILESTONES} plan={PLAN} today={TODAY} holidaySet={NO_HOLIDAYS} />,
    );
    expect(screen.getByText(/^8 von 10 Arbeitstagen Verlauf – 2 weitere nötig\. Das Fenster wurde gekürzt und beginnt beim ersten Abschluss, /)).toBeTruthy();
  });

  test("a committed scope removal shows the clamped value the forecast uses once tasks close (M8)", async () => {
    const user = userEvent.setup();
    const tasks = [...open(5), ...steadyDone(60)];
    const { rerender } = renderPanel(tasks);
    await user.click(screen.getByRole("radio", { name: "What-if" }));
    const scope = screen.getByLabelText("Scope change (tasks)") as HTMLInputElement;
    await user.clear(scope);
    await user.type(scope, "-5{Enter}");
    expect(scope.value).toBe("-5");
    // Two of the five are cancelled elsewhere: only 3 can be removed now.
    const closed = tasks.map((task) => (task.id <= 2 ? { ...task, status: "Cancelled" as const } : task));
    rerender(<ForecastPanel lang="en-US" tasks={closed} milestones={NO_MILESTONES} plan={PLAN} today={TODAY} holidaySet={NO_HOLIDAYS} />);
    expect(scope.value, "the field shows the value the engine clamps to").toBe("-3");
    expect(screen.getByText("Open work: 0 tasks")).toBeTruthy();
  });

  test("toolbar keeps the trailing group contiguous", () => {
    const { container } = renderPanel([...open(5), ...steadyDone(60)]);
    expectButtonOrder(["printHint", "tableResetSizeHint"], { contiguous: true });
    const toolbar = container.querySelector<HTMLElement>("[data-forecast-toolbar]");
    if (!toolbar) throw new Error("toolbar not rendered");
    expect(buttonNames(toolbar).slice(-2)).toEqual([t("en-US", "printHint"), t("en-US", "tableResetSizeHint")]);
  });
});

describe("ForecastPanel — the Dashboard-defaults note (§502)", () => {
  const NOTE = "The Dashboard uses the default settings.";
  const history = [...open(5), ...steadyDone(60)];
  const renderOn = (showSimulation: boolean) =>
    render(
      <ForecastPanel lang="en-US" tasks={history} milestones={NO_MILESTONES} plan={PLAN} today={TODAY} holidaySet={NO_HOLIDAYS} showSimulation={showSimulation} />,
    );

  test("is absent on the default toolbar", () => {
    renderOn(true);
    expect(screen.queryByText(NOTE)).toBeNull();
  });

  test("appears once the history window differs from the default", async () => {
    const user = userEvent.setup();
    renderOn(true);
    await user.selectOptions(screen.getByLabelText("History"), "90");
    expect(screen.getByText(NOTE)).toBeTruthy();
    await user.selectOptions(screen.getByLabelText("History"), "60");
    expect(screen.queryByText(NOTE)).toBeNull();
  });

  test("appears when a What-if value differs, and not for Quick over edited fields", async () => {
    const user = userEvent.setup();
    renderOn(true);
    await user.click(screen.getByRole("radio", { name: "What-if" }));
    expect(screen.queryByText(NOTE)).toBeNull();
    const capacity = screen.getByLabelText("Capacity (%)");
    fireEvent.change(capacity, { target: { value: "80" } });
    fireEvent.blur(capacity);
    expect(screen.getByText(NOTE)).toBeTruthy();
    await user.click(screen.getByRole("radio", { name: "Quick" }));
    expect(screen.queryByText(NOTE)).toBeNull();
  });

  test("is absent while the simulation switch is off, whatever the settings", async () => {
    const user = userEvent.setup();
    renderOn(false);
    await user.selectOptions(screen.getByLabelText("History"), "90");
    expect(screen.queryByText(NOTE)).toBeNull();
  });

  test("reads in German", async () => {
    const user = userEvent.setup();
    render(
      <ForecastPanel lang="de" tasks={history} milestones={NO_MILESTONES} plan={PLAN} today={TODAY} holidaySet={NO_HOLIDAYS} showSimulation />,
    );
    await user.selectOptions(screen.getByLabelText("Verlauf"), "90");
    expect(screen.getByText(t("de", "forecastDashboardDefaultsNote"))).toBeTruthy();
  });
});

// ---- §502 part 3: cost at finish from the view's own (What-if-adjusted) run ----
describe("ForecastPanel — cost at finish (§502)", () => {
  const history = [...open(5), ...steadyDone(60)];
  const WINDOW = [...workingDaysBefore(TODAY, 59, NO_HOLIDAYS), TODAY];
  /** Spend booked on the last `days` window days, varied so the percentiles spread. */
  function facts(days: number, bac = 100_000): ForecastFactsByUnit {
    const dated: DatedValue[] = WINDOW.slice(-days).map((date, i) => ({ date, bookedFrom: date, value: 500 + (i % 7) * 150, spread: false }));
    const f: ForecastFacts = {
      bac, ac: 40_000, ev: null, pv: 0, bucketsMissingPercent: [], dated,
      planEnd: PLAN.endDate, today: TODAY, holidaySet: NO_HOLIDAYS, hasFixedPrice: false,
    };
    return { eur: f, hours: { ...f, bac: 1000, ac: 400 } };
  }
  const FULL = facts(60);
  const renderCost = (budgetFacts: ForecastFactsByUnit | null, showSimulation = true, tasks: Task[] = history, budgetEnabled = true) =>
    render(
      <ForecastPanel lang="en-US" tasks={tasks} milestones={NO_MILESTONES} plan={PLAN} today={TODAY} holidaySet={NO_HOLIDAYS} showSimulation={showSimulation} budgetFacts={budgetFacts} budgetEnabled={budgetEnabled} />,
    );
  const card = () => screen.getByRole("group", { name: "Cost at finish, simulated" });
  const p80Cost = (): number => {
    const row = within(card()).getByRole("row", { name: /^Safe to commit \(P80\)/ });
    return Number((within(row).getByRole("cell").textContent ?? "").replace(/[^0-9.]/g, ""));
  };

  test("a What-if capacity of 200 % lowers the P80 cost", async () => {
    const user = userEvent.setup();
    renderCost(FULL);
    const before = p80Cost();
    expect(before).toBeGreaterThan(40_000);
    await user.click(screen.getByRole("radio", { name: "What-if" }));
    const capacity = screen.getByLabelText("Capacity (%)");
    await user.clear(capacity);
    await user.type(capacity, "200{Enter}");
    expect(p80Cost()).toBeLessThan(before);
    expect(p80Cost()).toBeGreaterThan(40_000);
  });

  test("no budget shows the add-a-budget line", () => {
    renderCost(null);
    expect(within(card()).getByText("Add a budget to see the cost at finish.")).toBeTruthy();
  });

  test("below the spend floor names the counts", () => {
    renderCost(facts(4));
    expect(within(card()).getByText("Needs 10 working days with bookings in the window (has 4).")).toBeTruthy();
  });

  test("below the schedule floor says which input is missing", () => {
    renderCost(FULL, true, [...open(4), ...steadyDone(3)]);
    expect(within(card()).getByText("Not enough finished tasks to simulate the finish yet.")).toBeTruthy();
  });

  test("the cost card is absent without the simulation switch", () => {
    renderCost(FULL, false);
    expect(screen.queryByRole("group", { name: "Cost at finish, simulated" })).toBeNull();
    expect(screen.queryByText("Cost at finish")).toBeNull();
  });

  // Mutation: dropping the `budgetEnabled` conjunct of `costCard` turns this red.
  test("Budget module off: no cost card, not even the add-a-budget line", () => {
    renderCost(null, true, history, false);
    expect(screen.queryByRole("group", { name: "Cost at finish, simulated" })).toBeNull();
    expect(screen.queryByText("Add a budget to see the cost at finish.")).toBeNull();
  });
});
