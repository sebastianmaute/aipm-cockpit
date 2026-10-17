import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ForecastScenarioEditor } from "./forecast-scenario-editor";
import type { ScheduleContext, ScenarioDirectory } from "./forecast-added-people";
import type { ForecastScenario, ScenarioChange } from "./forecast-scenarios";
import { simulatedDates } from "./forecast/day-index";
import { MAX_HORIZON_WORKING_DAYS } from "./forecast/constants";
import type { Milestone, Resource, Shift } from "./types";

// 2026-10-14 is a Wednesday.
const TODAY = "2026-10-14";
const NO_HOLIDAYS: ReadonlySet<string> = new Set();

const person = (id: number, firstName: string, over: Partial<Resource> = {}): Resource =>
  ({ id, firstName, lastName: "Test", roleId: null, utilizationMode: "percent", utilization: {}, ...over }) as Resource;
const RESOURCES: Resource[] = [
  person(1, "Ada"),
  person(2, "Bob"), // on the team
  person(3, "Cy", { isExternal: true }),
  person(4, "Dee"), // no Shift
  person(5, "Eve", { active: false }), // archived: not offered
];
const SHIFTS: Shift[] = [{ id: 1, assignee: "Ada Test", resourceId: 1, hoursPerWeekday: [0, 8, 8, 8, 8, 0, 4] } as Shift];
const MILESTONES: Milestone[] = [{ id: 10, name: "Beta", date: "2026-12-01", linkedTaskIds: [] }];
const DIRECTORY: ScenarioDirectory = {
  resources: RESOURCES, roles: [], shifts: SHIFTS, absences: [], budgets: [], fxRates: null, workdayHours: 8, baseCurrency: "EUR",
};
const CONTEXT: ScheduleContext = {
  today: TODAY, holidaySet: NO_HOLIDAYS, dates: simulatedDates(TODAY, MAX_HORIZON_WORKING_DAYS, NO_HOLIDAYS),
  tasks: [], milestones: MILESTONES, directory: DIRECTORY, windowDates: [], hoursFacts: null,
  onTeam: new Set([2]), teamHours: 8,
};

function renderEditor(over: { scenario?: ForecastScenario | null; list?: ForecastScenario[] } = {}) {
  const onSave = vi.fn();
  const onCancel = vi.fn();
  const scenario = over.scenario ?? null;
  render(
    <ForecastScenarioEditor
      lang="en-US" open scenario={scenario} openId={7} context={CONTEXT} list={over.list ?? (scenario ? [scenario] : [])}
      onSave={onSave} onCancel={onCancel}
    />,
  );
  return { onSave, onCancel, user: userEvent.setup() };
}
const withRows = (changes: ScenarioChange[]): ForecastScenario => ({ id: 1, name: "Plan", changes });
const control = (name: string) => screen.getByRole("textbox", { name }) as HTMLInputElement;
const field = (name: string) => screen.getByLabelText(name, { selector: "input,select" }) as HTMLInputElement;
const described = (el: HTMLElement) => {
  const id = el.getAttribute("aria-describedby");
  return id ? document.getElementById(id)?.textContent : null;
};

describe("ForecastScenarioEditor", () => {
  it("adds one row of each kind and saves the draft", async () => {
    const { onSave, user } = renderEditor();
    expect(screen.getByRole("dialog", { name: "New scenario" })).toBeInTheDocument();
    await user.type(control("Name"), "  Faster  ");
    await user.click(screen.getByRole("button", { name: "+ Availability change" }));
    await user.click(screen.getByRole("button", { name: "+ Add people" }));
    await user.click(screen.getByRole("button", { name: "+ Scope change" }));
    await user.selectOptions(field("Change 2: Person"), "1");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave).toHaveBeenCalledWith({
      name: "Faster",
      changes: [
        { kind: "availability", percent: 100, from: TODAY, until: "" },
        { kind: "addPeople", who: { resourceId: 1, hoursPerWeek: 32 }, from: TODAY, until: "", rampWeeks: 4 },
        { kind: "scope", tasks: 1, on: TODAY },
      ],
    });
  });

  it("refuses a duplicate name and an out-of-range percent, says why beside the field and focuses the first", async () => {
    const alpha: ForecastScenario = { id: 1, name: "Alpha", changes: [] };
    const { onSave, user } = renderEditor({ list: [alpha] });
    await user.type(control("Name"), "alpha");
    await user.click(screen.getByRole("button", { name: "+ Availability change" }));
    fireEvent.change(field("Change 1: Availability (%)"), { target: { value: "5" } });
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).not.toHaveBeenCalled();
    expect(described(control("Name"))).toBe("Another scenario already has this name.");
    expect(described(field("Change 1: Availability (%)"))).toBe("Between 10 and 300.");
    expect(field("Change 1: Availability (%)")).toHaveAttribute("aria-invalid", "true");
    expect(document.activeElement).toBe(control("Name"));
    // A valid name moves focus to the next invalid control on the next Save.
    await user.clear(control("Name"));
    await user.type(control("Name"), "Beta");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(field("Change 1: Availability (%)"));
  });

  it("the on-team person is a disabled option and an external one says no cost", async () => {
    const { user } = renderEditor();
    await user.click(screen.getByRole("button", { name: "+ Add people" }));
    const options = within(field("Change 1: Person")).getAllByRole("option") as HTMLOptionElement[];
    expect(options.map((o) => [o.textContent, o.disabled])).toEqual([
      ["Choose a person", false],
      ["Ada Test", false],
      ["Bob Test (already on the team — use an availability change)", true],
      ["Cy Test (no cost — external in the directory)", false],
      ["Dee Test", false],
    ]);
  });

  it("picking a person prefills hours from their Shift", async () => {
    const { user } = renderEditor();
    await user.click(screen.getByRole("button", { name: "+ Add people" }));
    await user.selectOptions(field("Change 1: Person"), "1");
    // Mon–Fri only: Ada's Saturday 4 h is not a working day of the engine.
    expect(field("Change 1: Hours per week").value).toBe("32");
    await user.selectOptions(field("Change 1: Person"), "4");
    expect(field("Change 1: Hours per week").value).toBe("40");
  });

  it("a row's status reads ended / milestone gone / person gone", () => {
    renderEditor({
      scenario: withRows([
        { kind: "availability", percent: 50, from: "2026-01-05", until: "2026-02-27" },
        { kind: "scope", tasks: 3, on: TODAY, milestoneId: 99 },
        { kind: "addPeople", who: { resourceId: 42, hoursPerWeek: 20 }, from: TODAY, until: "", rampWeeks: 0 },
        { kind: "scope", tasks: 3, on: TODAY, milestoneId: 10 },
      ]),
    });
    const rows = document.querySelectorAll("[data-change-row]");
    expect(rows[0]).toHaveTextContent("Ended — this change ended before today.");
    expect(rows[1]).toHaveTextContent("Milestone gone — counts as scope without a milestone.");
    expect(rows[2]).toHaveTextContent("Person gone — no longer in the directory.");
    // Positive control: a scope row on a live milestone carries no status line.
    expect(rows[3].querySelectorAll("p")).toHaveLength(0);
  });

  it("a sized row shows its basis, an external one no cost, and one past the horizon no effect", () => {
    renderEditor({
      scenario: withRows([
        { kind: "addPeople", who: { label: "Dev", count: 1, rate: 50, currency: "EUR", hoursPerWeek: 20 }, from: TODAY, until: "", rampWeeks: 4 },
        { kind: "addPeople", who: { resourceId: 3, hoursPerWeek: 20 }, from: TODAY, until: "", rampWeeks: 4 },
        { kind: "addPeople", who: { label: "Late", count: 1, rate: 50, currency: "EUR", hoursPerWeek: 20 }, from: "2040-01-02", until: "", rampWeeks: 4 },
      ]),
    });
    const rows = document.querySelectorAll("[data-change-row]");
    expect(rows[0]).toHaveTextContent("Team books ≈ 8 h per day → +20 h/week ≈ +50% at full speed");
    expect(rows[1]).toHaveTextContent("No cost — external in the directory.");
    expect(rows[2]).toHaveTextContent("No effect in the forecast window.");
    expect(rows[2]).not.toHaveTextContent("Team books");
  });

  it("the doubles-the-team warning shows in the editor", () => {
    const warning = "Added people more than double the team; the team-average assumption is weak here.";
    const big: ScenarioChange = { kind: "addPeople", who: { label: "Crew", count: 2, rate: 50, currency: "EUR", hoursPerWeek: 40 }, from: TODAY, until: "", rampWeeks: 4 };
    renderEditor({ scenario: withRows([big]) });
    expect(screen.getByText(warning)).toBeInTheDocument();
  });

  it("no doubles-the-team warning for a small addition", () => {
    const small: ScenarioChange = { kind: "addPeople", who: { label: "Dev", count: 1, rate: 50, currency: "EUR", hoursPerWeek: 20 }, from: TODAY, until: "", rampWeeks: 4 };
    renderEditor({ scenario: withRows([small]) });
    expect(screen.queryByText(/more than double the team/)).toBeNull();
  });

  it("control names are row-unique", async () => {
    const { user } = renderEditor();
    await user.click(screen.getByRole("button", { name: "+ Availability change" }));
    await user.click(screen.getByRole("button", { name: "+ Availability change" }));
    expect(field("Change 1: Availability (%)")).not.toBe(field("Change 2: Availability (%)"));
    expect(screen.getByRole("button", { name: "Change 1: Remove" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change 2: Remove" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Change 1: Remove" }));
    expect(screen.queryByLabelText("Change 2: Availability (%)")).toBeNull();
    expect(field("Change 1: Availability (%)")).toBeInTheDocument();
  });

  it("Escape cancels and writes nothing", async () => {
    const { onSave, onCancel, user } = renderEditor();
    await user.type(control("Name"), "Draft");
    await user.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
  });

  it("the add buttons are disabled at 20 rows with the reason", () => {
    const rows: ScenarioChange[] = Array.from({ length: 20 }, () => ({ kind: "scope", tasks: 1, on: TODAY }));
    renderEditor({ scenario: withRows(rows) });
    const reason = screen.getByText("At most 20 changes.");
    for (const name of ["+ Availability change", "+ Add people", "+ Scope change"]) {
      const button = screen.getByRole("button", { name });
      expect(button).toBeDisabled();
      expect(button.getAttribute("aria-describedby")).toBe(reason.id);
    }
  });

  it("the add buttons are enabled below 20 rows", () => {
    const rows: ScenarioChange[] = Array.from({ length: 19 }, () => ({ kind: "scope", tasks: 1, on: TODAY }));
    renderEditor({ scenario: withRows(rows) });
    expect(screen.getByRole("button", { name: "+ Scope change" })).toBeEnabled();
    expect(screen.queryByText("At most 20 changes.")).toBeNull();
  });
});
