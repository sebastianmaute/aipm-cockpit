import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ForecastScenarioEditor, keepsStoredReference } from "./forecast-scenario-editor";
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
const MILESTONES: Milestone[] = [
  { id: 10, name: "Beta", date: "2026-12-01", linkedTaskIds: [] },
  { id: 11, name: "Done one", date: "2026-09-01", achievedDate: "2026-09-01", linkedTaskIds: [] },
];
const DIRECTORY: ScenarioDirectory = {
  resources: RESOURCES, roles: [], shifts: SHIFTS, absences: [], budgets: [], fxRates: null, workdayHours: 8, baseCurrency: "EUR",
};
const CONTEXT: ScheduleContext = {
  today: TODAY, holidaySet: NO_HOLIDAYS, dates: simulatedDates(TODAY, MAX_HORIZON_WORKING_DAYS, NO_HOLIDAYS),
  tasks: [], milestones: MILESTONES, directory: DIRECTORY, windowDates: [], hoursFacts: null,
  onTeam: new Set([2]), teamHours: 8,
};

function renderEditor(over: { scenario?: ForecastScenario | null; list?: ForecastScenario[]; refuse?: string } = {}) {
  const onSave = vi.fn((): string | null => over.refuse ?? null);
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

  // Final review Minor 5: an availability row that applies on no simulated day said nothing at all.
  it("an availability row with an empty window says no effect, like an Add-people row", () => {
    renderEditor({
      scenario: withRows([
        { kind: "availability", percent: 50, from: TODAY, until: TODAY },
        { kind: "availability", percent: 50, from: "2040-01-02", until: "" },
        { kind: "availability", percent: 50, from: TODAY, until: "" },
      ]),
    });
    const rows = document.querySelectorAll("[data-change-row]");
    expect(rows[0]).toHaveTextContent("No effect in the forecast window.");
    expect(rows[1]).toHaveTextContent("No effect in the forecast window.");
    // Control: a row that applies from today on carries no status line.
    expect(rows[2].querySelectorAll("p")).toHaveLength(0);
  });

  // Final review Minor 4: the missing exchange rate belongs to the placeholder's currency, not to its label.
  it("an at-par placeholder row names its currency", () => {
    renderEditor({
      scenario: withRows([
        { kind: "addPeople", who: { label: "Contractors", count: 1, rate: 50, currency: "GBP", hoursPerWeek: 20 }, from: TODAY, until: "", rampWeeks: 4 },
      ]),
    });
    const row = document.querySelector("[data-change-row]");
    expect(row).toHaveTextContent("No exchange rate for GBP — rate converted at par.");
    expect(row).not.toHaveTextContent("No exchange rate for Contractors");
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

describe("ForecastScenarioEditor — an old scenario stays usable (fix round 1)", () => {
  const person = (resourceId: number): ScenarioChange =>
    ({ kind: "addPeople", who: { resourceId, hoursPerWeek: 20 }, from: TODAY, until: "", rampWeeks: 0 });
  const STALE: ScenarioChange[] = [
    { kind: "scope", tasks: 3, on: TODAY, milestoneId: 99 }, // deleted milestone
    { kind: "scope", tasks: 2, on: TODAY, milestoneId: 11 }, // achieved since
    person(42), // deleted person
    person(5), // archived since
    person(2), // on the team since
  ];

  it("saves its stale references unchanged after an unrelated name edit, each row still marked", async () => {
    const { onSave, user } = renderEditor({ scenario: withRows(STALE) });
    const rows = document.querySelectorAll("[data-change-row]");
    expect(rows[0]).toHaveTextContent("Milestone gone — counts as scope without a milestone.");
    expect(rows[1]).toHaveTextContent("Milestone gone — counts as scope without a milestone.");
    expect(rows[2]).toHaveTextContent("Person gone — no longer in the directory.");
    expect(rows[3]).toHaveTextContent("Archived — still counted in the forecast.");
    expect(rows[4]).toHaveTextContent("Already on the team — use an availability change.");
    await user.clear(control("Name"));
    await user.type(control("Name"), "Plan B");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledWith({ name: "Plan B", changes: STALE });
  });

  it("refuses a gone or on-team person chosen as a new value", async () => {
    const { onSave, user } = renderEditor({ scenario: withRows([person(42)]) });
    // The stored row's person changed to someone on the team: a NEW reference, so it is validated.
    fireEvent.change(field("Change 1: Person"), { target: { value: "2" } });
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).not.toHaveBeenCalled();
    expect(described(field("Change 1: Person"))).toBe("Already on the team — use an availability change.");
    // A new row picking the on-team person is refused the same way.
    fireEvent.change(field("Change 1: Person"), { target: { value: "1" } });
    await user.click(screen.getByRole("button", { name: "+ Add people" }));
    fireEvent.change(field("Change 2: Person"), { target: { value: "2" } });
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).not.toHaveBeenCalled();
    expect(described(field("Change 2: Person"))).toBe("Already on the team — use an availability change.");
    expect(field("Change 1: Person")).not.toHaveAttribute("aria-invalid");
  });

  it("only an unchanged stored reference is kept", () => {
    // The pickers never offer a gone milestone as a new value, so the rule is pinned on the predicate too.
    const stored: ScenarioChange = { kind: "scope", tasks: 1, on: TODAY, milestoneId: 99 };
    expect(keepsStoredReference(stored, { ...stored, tasks: 5 })).toBe(true);
    expect(keepsStoredReference(stored, { ...stored, milestoneId: 11 })).toBe(false);
    expect(keepsStoredReference(undefined, stored)).toBe(false);
    expect(keepsStoredReference({ kind: "scope", tasks: 1, on: TODAY }, stored)).toBe(false);
    expect(keepsStoredReference(person(42), { ...person(42), from: "2026-11-02" } as ScenarioChange)).toBe(true);
    expect(keepsStoredReference(person(42), person(2))).toBe(false);
  });

  it("an archived person is still counted: the row says archived, then the sizing basis", () => {
    renderEditor({ scenario: withRows([person(5), person(1), person(42)]) });
    const rows = document.querySelectorAll("[data-change-row]");
    const lines = (row: Element) => [...row.querySelectorAll("p")].map((p) => p.textContent);
    // The fixture's people have no role, so the usual lines are the no-rate note and the basis.
    expect(lines(rows[0])).toEqual([
      "Archived — still counted in the forecast.",
      "No rate for Eve Test — cost counted as 0.",
      "Team books ≈ 8 h per day → +20 h/week ≈ +50% at full speed",
    ]);
    // Controls: an active person's row has the usual lines alone; a deleted person is gone.
    expect(lines(rows[1])).toEqual([
      "No rate for Ada Test — cost counted as 0.",
      "Team books ≈ 8 h per day → +20 h/week ≈ +50% at full speed",
    ]);
    expect(lines(rows[2])).toEqual(["Person gone — no longer in the directory."]);
  });

  it("a stored archived person is a selectable '(archived)' option; a deleted one a disabled 'person gone'", () => {
    renderEditor({ scenario: withRows([person(5), person(42)]) });
    const archived = field("Change 1: Person");
    expect(archived.value).toBe("5");
    const option = within(archived).getByRole("option", { name: "Eve Test (archived)" }) as HTMLOptionElement;
    expect(option.disabled).toBe(false);
    const gone = within(field("Change 2: Person")).getByRole("option", { name: "Person gone — no longer in the directory." }) as HTMLOptionElement;
    expect(gone.disabled).toBe(true);
    // Another row is never offered the archived person.
    expect(within(field("Change 2: Person")).queryByRole("option", { name: /Eve Test/ })).toBeNull();
  });

  it("a new pick of an archived person is still refused", () => {
    // The pickers never offer an archived person as a new value, so the rule is pinned on the predicate.
    expect(keepsStoredReference(person(1), person(5))).toBe(false);
    expect(keepsStoredReference(undefined, person(5))).toBe(false);
    expect(keepsStoredReference(person(5), person(5))).toBe(true);
  });

  // Final review Important 1: focus used to move inside the Save handler, BEFORE React committed aria-invalid
  // and the message, so a screen reader announced the field with no error. The state is read AT the focus event.
  // Re-review N2: the field message is no longer an alert itself; the editor's ONE summary alert is, and it is
  // already rendered when focus arrives.
  it("a refused Save focuses each invalid field only once it is aria-invalid, described, and summarised by one alert", async () => {
    const alpha: ForecastScenario = { id: 1, name: "Alpha", changes: [] };
    const { user } = renderEditor({ list: [alpha] });
    const seen: { invalid: string | null; role: string | null | undefined; text: string | null | undefined; alerts: (string | null)[] }[] = [];
    const record = (e: Event) => {
      const el = e.target as HTMLElement;
      const err = document.getElementById(el.getAttribute("aria-describedby") ?? "");
      const alerts = screen.queryAllByRole("alert").map((a) => a.textContent);
      seen.push({ invalid: el.getAttribute("aria-invalid"), role: err?.getAttribute("role"), text: err?.textContent, alerts });
    };
    control("Name").addEventListener("focus", record);
    await user.type(control("Name"), "alpha");
    await user.click(screen.getByRole("button", { name: "+ Availability change" }));
    field("Change 1: Availability (%)").addEventListener("focus", record);
    fireEvent.change(field("Change 1: Availability (%)"), { target: { value: "5" } });
    seen.length = 0;
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(seen).toEqual([{
      invalid: "true", role: null, text: "Another scenario already has this name.",
      alerts: ["Another scenario already has this name. 1 change needs attention: Change 1, Availability (%): Between 10 and 300."],
    }]);
    await user.clear(control("Name"));
    await user.type(control("Name"), "Beta");
    seen.length = 0;
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(seen).toEqual([{
      invalid: "true", role: null, text: "Between 10 and 300.",
      alerts: ["1 change needs attention: Change 1, Availability (%): Between 10 and 300."],
    }]);
  });

  it("a refused write keeps the editor open with its reason", async () => {
    const { onSave, onCancel, user } = renderEditor({ refuse: "A project keeps at most 4 scenarios." });
    await user.type(control("Name"), "Late");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: "New scenario" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("A project keeps at most 4 scenarios.");
  });

  // Re-review N2: one refused Save is ONE announcement, not one alert per invalid row.
  it("several invalid rows give exactly one alert that counts them and names the first; focus goes to the first", async () => {
    const { onSave, user } = renderEditor();
    await user.type(control("Name"), "Two bad rows");
    await user.click(screen.getByRole("button", { name: "+ Availability change" }));
    await user.click(screen.getByRole("button", { name: "+ Availability change" }));
    fireEvent.change(field("Change 1: From"), { target: { value: "" } });
    fireEvent.change(field("Change 2: Availability (%)"), { target: { value: "5" } });
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(onSave).not.toHaveBeenCalled();
    const alerts = screen.getAllByRole("alert");
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toHaveTextContent("2 changes need attention; first: Change 1, From: Enter a valid date.");
    // Each field's message stays visible and linked, but is not an alert of its own.
    for (const [name, text] of [["Change 1: From", "Enter a valid date."], ["Change 2: Availability (%)", "Between 10 and 300."]]) {
      expect(field(name)).toHaveAttribute("aria-invalid", "true");
      expect(described(field(name))).toBe(text);
      expect(document.getElementById(field(name).getAttribute("aria-describedby") ?? "")).not.toHaveAttribute("role");
    }
    expect(document.activeElement).toBe(field("Change 1: From"));
  });

  // Re-review O2: an identical repeat refusal (the cap reached again by a concurrent writer) was not re-announced,
  // because the alert node and its text stayed the same. Each Save now remounts it.
  it("two identical refusals in a row each render a fresh alert node", async () => {
    const { onSave, user } = renderEditor({ refuse: "A project keeps at most 4 scenarios." });
    await user.type(control("Name"), "Late");
    await user.click(screen.getByRole("button", { name: "Save" }));
    const first = screen.getByRole("alert");
    await user.click(screen.getByRole("button", { name: "Save" }));
    const second = screen.getByRole("alert");
    expect(onSave).toHaveBeenCalledTimes(2);
    expect(second).toHaveTextContent("A project keeps at most 4 scenarios.");
    expect(first).toHaveTextContent("A project keeps at most 4 scenarios.");
    expect(second).not.toBe(first);
    expect(first.isConnected).toBe(false);
  });
});
