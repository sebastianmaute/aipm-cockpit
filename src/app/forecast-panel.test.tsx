import { beforeAll, describe, expect, test } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ForecastPanel } from "./forecast-panel";
import { loadI18n, t } from "./i18n";
import type { Milestone, ResourcePlan, Task } from "./types";
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
    fireEvent.change(input, { target: { value: "2026-10-01" } });
    expect(screen.getByText("Not a valid value; the previous one is kept.")).toBeTruthy();
    expect(input.getAttribute("aria-invalid")).toBe("true");
    expect(input.value).toBe("2026-12-31");
    expect(screen.getByRole("columnheader", { name: "At least, by Dec 31, 2026" })).toBeTruthy();
    fireEvent.change(input, { target: { value: TODAY } });
    expect(screen.queryByText("Not a valid value; the previous one is kept.")).toBeNull();
    expect(screen.getByRole("columnheader", { name: "At least, by Oct 14, 2026" })).toBeTruthy();
  });

  test("a How many target past the 1300-working-day horizon is refused (R15)", () => {
    renderPanel([...open(5), ...steadyDone(60)]);
    const input = screen.getByLabelText("How many by") as HTMLInputElement;
    const max = nthWorkingDayAfter(TODAY, MAX_HORIZON_WORKING_DAYS, NO_HOLIDAYS);
    expect(input.getAttribute("max")).toBe(max);
    fireEvent.change(input, { target: { value: "2206-10-14" } });
    expect(screen.getByText("Not a valid value; the previous one is kept.")).toBeTruthy();
    expect(input.value).toBe("2026-12-31");
    fireEvent.change(input, { target: { value: max } });
    expect(screen.queryByText("Not a valid value; the previous one is kept.")).toBeNull();
    expect(input.value).toBe(max);
  });

  test("a stored target is re-clamped when today moves past it (T5e)", () => {
    const tasks = [...open(5), ...steadyDone(60)];
    const { rerender } = renderPanel(tasks);
    fireEvent.change(screen.getByLabelText("How many by"), { target: { value: TODAY } });
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

  test("the caption prints the trial count the forecast ran, 5,000 at a What-if extreme", async () => {
    const user = userEvent.setup();
    renderPanel([...open(5), ...steadyDone(60)]);
    expect(screen.getByText("10,000 runs of your last 60 working days (60 finished tasks)")).toBeTruthy();
    await user.click(screen.getByRole("radio", { name: "What-if" }));
    const capacity = screen.getByLabelText("Capacity (%)");
    await user.clear(capacity);
    await user.type(capacity, "10{Enter}");
    const scope = screen.getByLabelText("Scope change (tasks)");
    await user.clear(scope);
    await user.type(scope, "1000{Enter}");
    expect(screen.getByText("5,000 runs of your last 60 working days (60 finished tasks)")).toBeTruthy();
  });

  test("toolbar keeps the trailing group contiguous", () => {
    const { container } = renderPanel([...open(5), ...steadyDone(60)]);
    expectButtonOrder(["printHint", "tableResetSizeHint"], { contiguous: true });
    const toolbar = container.querySelector<HTMLElement>("[data-forecast-toolbar]");
    if (!toolbar) throw new Error("toolbar not rendered");
    expect(buttonNames(toolbar).slice(-2)).toEqual([t("en-US", "printHint"), t("en-US", "tableResetSizeHint")]);
  });
});
