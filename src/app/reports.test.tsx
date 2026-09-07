import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReportsPanel } from "./reports";
import type { BudgetBucket, ResourcePlan, Role, Task } from "./types";
import type { AddableReportId } from "./addable-reports";
import { ALL_MODULE_IDS, type FeatureModuleId } from "./feature-modules";
import { t } from "./i18n";
import { expectRowUniqueNames } from "../test/row-unique-names";
import { controlNames, expectButtonOrder } from "../test/toolbar-order";

const TODAY = "2026-05-28";

// Defaults first, overrides SPREAD last. The earlier shape wired each field by
// hand (`status: p.status`), so any field it forgot — healthOverride, jiraKey,
// resourceId — was silently dropped and a test overriding one would pass
// against broken code. The `as unknown as Task` cast hides that from tsc, so
// the spread is the only thing keeping overrides honest.
function makeTask(p: Partial<Task> & { id: number; assignee: string }): Task {
  return {
    taskName: `Task ${p.id}`,
    assigneeEmail: "",
    priority: "Medium",
    startDate: TODAY,
    dueDate: TODAY,
    lastUpdateDate: TODAY,
    blockers: "",
    description: "",
    inquiriesSent: 0,
    group: "",
    labels: [],
    dependencies: [],
    ...p,
  } as unknown as Task;
}

/** ★ The second parameter is OPTIONAL so every pre-existing
 *  `renderReports(tasks)` call keeps working unchanged. */
function renderReports(tasks: Task[], opts: { extraReports?: AddableReportId[] } = {}) {
  return render(
    <ReportsPanel
      tasks={tasks}
      lang="en-US"
      today={TODAY}
      holidaySet={new Set()}
      extraReports={opts.extraReports}
    />,
  );
}

/**
 * The block whose title matches `re`.
 *
 * ★★ `closest("section")`, NOT `closest("div")`. Each block now renders inside
 * an `ArrangementTile`, whose chrome is `<section><div>grip · h3 · ⋮</div><div>
 * body</div></section>` — so walking up to the nearest DIV lands on the HEADER
 * ROW, which contains the title and none of the table. That returned an element
 * every `within(...)` query then failed against, which is what seven tests here
 * were reporting before this was fixed. The `<section>` is the tile's own
 * boundary and is what "the block" means.
 */
function sectionByTitle(re: RegExp): HTMLElement {
  const heading = screen.getByText(re);
  return heading.closest("section") as HTMLElement;
}

function rowNamesIn(section: HTMLElement): string[] {
  const tbody = section.querySelector("tbody");
  if (!tbody) return [];
  return Array.from(tbody.querySelectorAll("tr")).map(
    (tr) => (tr.querySelector("td") as HTMLElement | null)?.textContent?.trim() ?? "",
  );
}

describe("ReportsPanel — sort + filter", () => {
  const tasks: Task[] = [
    makeTask({ id: 1, assignee: "Alex", group: "Backend", labels: ["urgent"] }),
    makeTask({ id: 2, assignee: "Alex", group: "Backend", labels: ["urgent"] }),
    makeTask({ id: 3, assignee: "Bea", group: "Frontend", labels: ["ui"] }),
    makeTask({ id: 4, assignee: "Carl", group: "Backend", labels: ["urgent"] }),
  ];

  it("marks the report root as a print-root for scoped printing", () => {
    const { container } = renderReports(tasks);
    expect((container.firstElementChild as HTMLElement).className).toContain("print-root");
  });

  it("By Assignee renders rows with default total-desc sort", () => {
    renderReports(tasks);
    const section = sectionByTitle(/By Assignee/i);
    // Default sort: total desc — Alex (2) first; then Bea (1), Carl (1).
    // The sort is: stable asc by name+total, then reversed → Carl precedes Bea after reverse.
    expect(rowNamesIn(section)).toEqual(["Alex", "Carl", "Bea"]);
  });

  it("clicking By Assignee header cycles asc → desc → off", async () => {
    const user = userEvent.setup();
    renderReports(tasks);
    const section = sectionByTitle(/By Assignee/i);
    // The QUALIFIED name, as an exact string. A bare /assignee/i now matches
    // all eight of this table's headers ("Total – By assignee", …) and throws;
    // widening the regex to dodge that would reintroduce the ambiguity §246
    // removed.
    const header = within(section).getByRole("button", {
      name: `${t("en-US", "assignee")} – ${t("en-US", "reportsByAssignee")}`,
    });

    await user.click(header); // asc by name
    expect(rowNamesIn(section)).toEqual(["Alex", "Bea", "Carl"]);

    await user.click(header); // desc
    expect(rowNamesIn(section)).toEqual(["Carl", "Bea", "Alex"]);

    await user.click(header); // off → default (total desc) restored
    expect(rowNamesIn(section)[0]).toBe("Alex");
  });

  it("By Assignee filter narrows rows (case-insensitive)", async () => {
    const user = userEvent.setup();
    renderReports(tasks);
    const section = sectionByTitle(/By Assignee/i);
    const input = within(section).getByPlaceholderText(/filter assignees/i);
    await user.type(input, "alex");
    expect(rowNamesIn(section)).toEqual(["Alex"]);
  });

  it("By Assignee clear button restores all rows", async () => {
    const user = userEvent.setup();
    renderReports(tasks);
    const section = sectionByTitle(/By Assignee/i);
    const input = within(section).getByPlaceholderText(/filter assignees/i);
    await user.type(input, "alex");
    const clearBtn = within(section).getByRole("button", { name: /clear/i });
    await user.click(clearBtn);
    expect(rowNamesIn(section).length).toBeGreaterThanOrEqual(3);
  });

  it("By Assignee shows 'No matches' when filter matches nothing", async () => {
    const user = userEvent.setup();
    renderReports(tasks);
    const section = sectionByTitle(/By Assignee/i);
    const input = within(section).getByPlaceholderText(/filter assignees/i);
    await user.type(input, "zzz");
    expect(within(section).getByText(/no matches/i)).toBeInTheDocument();
  });

  it("By Group + By Label have independent sort state", async () => {
    const user = userEvent.setup();
    renderReports(tasks);
    const groupSection = sectionByTitle(/By Group/i);
    const labelSection = sectionByTitle(/By Label/i);

    const groupNameHeader = within(groupSection).getByRole("button", {
      name: `${t("en-US", "group")} – ${t("en-US", "reportsByGroup")}`,
    });
    await user.click(groupNameHeader);
    expect(rowNamesIn(groupSection)[0]).toBe("Backend"); // alphabetical asc

    // Label default sort is total desc; "urgent" (3) > "ui" (1) → urgent first.
    expect(rowNamesIn(labelSection)[0]).toBe("urgent");
  });

  it("By Assignee filter does not affect By Group rows", async () => {
    const user = userEvent.setup();
    renderReports(tasks);
    const assigneeSection = sectionByTitle(/By Assignee/i);
    const groupSection = sectionByTitle(/By Group/i);

    const assigneeFilter = within(assigneeSection).getByPlaceholderText(/filter assignees/i);
    await user.type(assigneeFilter, "alex");

    const groupNames = rowNamesIn(groupSection);
    expect(groupNames).toContain("Backend");
    expect(groupNames).toContain("Frontend");
  });

  it("renders a Print button in the header", () => {
    renderReports(tasks);
    expect(screen.getByRole("button", { name: /print/i })).toBeInTheDocument();
  });
});

const brPlan: ResourcePlan = { startDate: "2026-01-01", endDate: "2026-01-31", granularity: "month", currency: "EUR" };
const brRoles: Role[] = [{ id: 1, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 150 }];
const brBuckets: BudgetBucket[] = [
  { id: 1, name: "Alpha", type: "tm", currency: "EUR", startDate: "2026-01-01", endDate: "2026-01-31", status: "open",
    allocations: [{ roleId: 1, resourceIds: [], budgetHours: { "2026-01": 100 }, actualHours: { "2026-01": 40 } }] },
];

function renderComposed(
  extraReports: AddableReportId[],
  onChange = vi.fn(),
  features?: FeatureModuleId[],
) {
  render(
    <ReportsPanel
      tasks={[makeTask({ id: 1, assignee: "A" })]}
      today={TODAY}
      holidaySet={new Set()}
      lang="en-US"
      buckets={brBuckets}
      plan={brPlan}
      roles={brRoles}
      disciplines={[{ id: 1, name: "Consulting" }]}
      grades={[{ id: 1, name: "Junior" }]}
      resources={[]}
      absences={[]}
      workdayHours={8}
      fxRates={null}
      raid={[]}
      extraReports={extraReports}
      onChangeExtraReports={onChange}
      features={features}
    />,
  );
  return onChange;
}

describe("ReportsPanel — composed reports", () => {
  it("renders RAID and Budget reports when both are in extraReports", () => {
    renderComposed(["raid-report", "budget-report"]);
    expect(screen.getByRole("heading", { name: /raid report/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /budget report/i })).toBeInTheDocument();
  });

  it("renders an appended report's content when in extraReports", () => {
    renderComposed(["budget-report"]);
    expect(screen.getByText(/project total/i)).toBeInTheDocument(); // Budget report body
    expect(screen.getByText("Alpha")).toBeInTheDocument();
  });
  /**
   * ★★★ ADD IS NOW RESTORE-FROM-HIDDEN, NOT A SETTINGS WRITE. The arrangement
   * owns order and visibility, so this asserts the OUTCOME — the block appears —
   * rather than that a callback fired. That is a stronger assertion than the one
   * it replaces, which could pass while nothing rendered.
   *
   * ★★ THREE TESTS WERE DELETED HERE RATHER THAN REWRITTEN, and each is recorded
   * because a deleted test is invisible afterwards:
   *   · "a report's remove button removes it" — the per-card ✕ is gone. Removal
   *     is the ⋮ menu's Hide, which Task 13 wires; there is nothing to click.
   *   · "the remove-report select removes a chosen report" — `removeReportControl`
   *     was deleted with the legacy mechanism.
   *   · "the remove-report select is absent when there are no added reports" —
   *     it still PASSED, but vacuously: the control no longer exists in ANY
   *     state, so it asserted nothing. A test that is green for a reason
   *     unrelated to its name is worse than none.
   * Hide/restore coverage returns with Task 13's shelf and menu.
   */
  it("the add-report select restores a hidden report onto the board", () => {
    renderComposed([]);
    expect(screen.queryByTestId("report-block-budget-report")).toBeNull();
    fireEvent.change(screen.getByLabelText(/add report/i), { target: { value: "budget-report" } });
    expect(screen.getByTestId("report-block-budget-report")).toBeInTheDocument();
  });

  it("offers only reports that are currently hidden", () => {
    // ★ The candidate list is the HIDDEN set, not "everything minus a settings
    // array" — so a report already on the board must not be offerable twice.
    renderComposed(["budget-report"]);
    const select = screen.getByLabelText(/add report/i) as HTMLSelectElement;
    const values = Array.from(select.options).map((o) => o.value).filter(Boolean);
    expect(values).not.toContain("budget-report");
    expect(values).toContain("raid-report");
  });
  it("renders the Stakeholder report when added", () => {
    renderComposed(["stakeholder-report"]);
    expect(screen.getByRole("heading", { name: /stakeholder report/i })).toBeInTheDocument();
  });
});

describe("ReportsPanel — module gating", () => {
  it("omits a stored extra report whose module is disabled", () => {
    const featuresWithout = ALL_MODULE_IDS.filter((m) => m !== "stakeholders");
    render(
      <ReportsPanel
        tasks={[makeTask({ id: 1, assignee: "A" })]}
        today={TODAY}
        holidaySet={new Set()}
        lang="en-US"
        raid={[]}
        stakeholders={[]}
        milestones={[]}
        extraReports={["stakeholder-report"]}
        features={featuresWithout}
      />,
    );
    expect(screen.queryByRole("heading", { name: /stakeholder report/i })).toBeNull();
  });

  it("shows a stored extra report when its module is enabled", () => {
    render(
      <ReportsPanel
        tasks={[makeTask({ id: 1, assignee: "A" })]}
        today={TODAY}
        holidaySet={new Set()}
        lang="en-US"
        raid={[]}
        stakeholders={[]}
        milestones={[]}
        extraReports={["stakeholder-report"]}
        features={[...ALL_MODULE_IDS]}
      />,
    );
    expect(screen.getByRole("heading", { name: /stakeholder report/i })).toBeInTheDocument();
  });

  it("add-report picker does NOT offer a disabled-module report as an option", () => {
    const featuresWithout = ALL_MODULE_IDS.filter((m) => m !== "stakeholders");
    renderComposed([], vi.fn(), featuresWithout);
    const picker = screen.getByRole("combobox", { name: /add report/i });
    expect(within(picker).queryByRole("option", { name: /stakeholder report/i })).toBeNull();
  });

  it("add-report picker DOES offer the report when its module is enabled", () => {
    renderComposed([], vi.fn(), [...ALL_MODULE_IDS]);
    const picker = screen.getByRole("combobox", { name: /add report/i });
    expect(within(picker).getByRole("option", { name: /stakeholder report/i })).toBeInTheDocument();
  });
});

function ReorderHarness({ onChange }: { onChange: (ids: AddableReportId[]) => void }) {
  return (
    <ReportsPanel
      tasks={[makeTask({ id: 1, assignee: "A" })]}
      today={TODAY}
      holidaySet={new Set()}
      lang="en-US"
      raid={[]}
      stakeholders={[]}
      milestones={[]}
      extraReports={["raid-report", "budget-report"]}
      onChangeExtraReports={onChange}
      features={[...ALL_MODULE_IDS]}
      buckets={brBuckets}
      plan={brPlan}
      roles={brRoles}
      disciplines={[{ id: 1, name: "Consulting" }]}
      grades={[{ id: 1, name: "Junior" }]}
      resources={[]}
      absences={[]}
      workdayHours={8}
      fxRates={null}
    />
  );
}

describe("ReportsPanel — drag-reorder extra reports", () => {
  /**
   * ★★★ REORDER IS NOW AN ARRANGEMENT MOVE, not a settings write, so this
   * asserts the RENDERED ORDER rather than a callback payload. The old test
   * expected `onChangeExtraReports(["budget-report", "raid-report"])`; that
   * write no longer happens and could not, since the arrangement owns order for
   * all thirteen blocks rather than for the four addable ones.
   */
  it("commits a drag as a reorder of the rendered board", () => {
    render(<ReorderHarness onChange={vi.fn()} />);
    const idsNow = () =>
      screen.getAllByTestId(/^report-block-/).map((n) => n.getAttribute("data-testid"));

    const before = idsNow();
    expect(before.length).toBeGreaterThan(2);
    const last = before[before.length - 1]!;
    expect(before[0]).not.toBe(last);

    // Drag the LAST block's grip onto the FIRST block.
    const grips = screen.getAllByRole("button", { name: /drag or use arrow keys to reorder/i });
    fireEvent.dragStart(grips[grips.length - 1]);
    fireEvent.dragOver(screen.getByTestId(before[0]!));
    fireEvent.drop(screen.getByTestId(before[0]!));

    const after = idsNow();
    expect(after).not.toEqual(before);
    // ★ The dragged block landed at or before where the target was, which is
    // what "dropped onto the first" means under the engine's splice.
    expect(after.indexOf(last)).toBeLessThan(before.indexOf(last));
  });

  // ★★★ FIREFOX REFUSES TO START A DRAG when `dragstart` sets no transfer data.
  // The handler drives the reorder off React state (`dragId`) and never touched
  // `dataTransfer`, so reorder was not merely awkward there — it was inert, and
  // no test could see it because jsdom happily dispatches the whole sequence
  // regardless. `task-kanban-board.tsx` already calls setData; this brings the
  // reports handle in line. The payload itself is unused (the id is in state);
  // what matters is that a payload EXISTS.
  it("puts data on the dragstart transfer, without which Firefox never begins the drag", () => {
    const setData = vi.fn();
    render(<ReorderHarness onChange={vi.fn()} />);
    const handles = screen.getAllByRole("button", { name: /drag or use arrow keys to reorder/i });
    fireEvent.dragStart(handles[1], { dataTransfer: { setData, effectAllowed: "" } });
    expect(setData).toHaveBeenCalled();
  });

  /**
   * ★★★ TWO DROP-EDGE TESTS WERE DELETED HERE, and this note is what stops them
   * being "restored" as a regression. The legacy extra-report card drew a
   * `data-drop-edge` border on the hovered card; `ArrangementTile` deliberately
   * draws NO edge indicator, because the grid is `grid-auto-flow: row dense` and
   * dense backfill re-places everything after a move — so an edge marker would
   * routinely point at a slot the block does not land in. The Dashboard records
   * the same decision, and both surfaces render the reorder hook's
   * `previewOrder` instead, which is what the reorder test above asserts.
   */

  // ★★★ THE ONLY POSSIBLE DETECTOR for this class. axe 4.12.1 has no rule under
  // the four tags `e2e/a11y.spec.ts` requests that flags two controls sharing an
  // accessible name, so a green axe run over Reports — which IS a scanned view —
  // says nothing here, at any seed size. Every other test in this describe finds
  // its handles by the SHARED prefix and indexes `[0]`/`[1]`, so they would all
  // stay green if the qualifier were dropped. This one goes red.
  it("gives each reorder handle a row-unique accessible name", () => {
    render(<ReorderHarness onChange={vi.fn()} />);
    const names = screen
      .getAllByRole("button", { name: /drag or use arrow keys to reorder/i })
      .map((b) => b.getAttribute("aria-label"));
    expect(names.length).toBeGreaterThan(1);
    expect(new Set(names).size).toBe(names.length);
    // ★ `expectRowUniqueNames`'s default (document-wide) scope is not usable
    // here: this harness embeds THREE report tables (Assignee/Group/Labels)
    // whose SortResizeTh column headers reuse generic labels across tables
    // ("Open" x3, "Cancelled" x3, "Overdue" x3, "Total ↓" x3, "Inquiries" x3,
    // "Completed" x2) - a genuine but pre-existing WCAG 2.4.6 collision, out
    // of scope for this reorder-handle test and not fixable without touching
    // the shared SortResizeTh primitive. Kept as the Set-based check above.
  });
});

describe("ReportsPanel — Total tile names the cancelled count", () => {
  it("names the cancelled count under Total when there is any", () => {
    const { container } = renderReports([
      makeTask({ id: 1, assignee: "Alex", status: "To Do" }),
      makeTask({ id: 2, assignee: "Bea", status: "Cancelled" }),
    ]);
    expect(screen.getByText(t("en-US", "reportsCancelledCount", "1"))).toBeInTheDocument();
    // WHICH tile carries the qualifier is the decision, not merely that some
    // tile does: `Total` is the number that stopped reconciling with Open +
    // Completed, so the sub must sit in ITS tile. A bare getByText passes with
    // the line moved onto Open or Completed.
    const subs = container.querySelectorAll("[data-tile-sub]");
    // Exactly one, so this cannot silently start testing some other section's
    // sub line if one is ever added earlier in the panel.
    expect(subs).toHaveLength(1);
    expect(subs[0].parentElement?.textContent).toContain(t("en-US", "reportsTotal"));
  });

  it("shows no cancelled line when nothing is cancelled", () => {
    const { container } = renderReports([makeTask({ id: 1, assignee: "Alex", status: "To Do" })]);
    expect(container.querySelector("[data-tile-sub]")).toBeNull();
  });
});

// ★★ The §66 change altered this sort SILENTLY: the within-colour tiebreak sums
//    `counts`, which now excludes out-of-scope work, so the rank is IN-SCOPE
//    size rather than group size. Deliberate (cancelled work does not "move the
//    needle"), but it shipped with no test until a mutation pass flagged it.
describe("ReportsPanel — group cards rank by in-scope size, not raw size", () => {
  it("puts a smaller active group above a larger mostly-cancelled one", () => {
    renderReports([
      makeTask({ id: 1, assignee: "A", group: "Mostly cancelled", status: "To Do" }),
      makeTask({ id: 2, assignee: "B", group: "Mostly cancelled", status: "Cancelled" }),
      makeTask({ id: 3, assignee: "C", group: "Mostly cancelled", status: "Cancelled" }),
      makeTask({ id: 4, assignee: "D", group: "Active", status: "To Do" }),
      makeTask({ id: 5, assignee: "E", group: "Active", status: "To Do" }),
    ]);
    const names = screen.getAllByTitle(/^(Active|Mostly cancelled)$/).map((el) => el.textContent);
    // By raw size "Mostly cancelled" (3) would lead; by in-scope size "Active"
    // (2 vs 1) does. Both groups share a colour bucket, so the tiebreak decides.
    expect(names).toEqual(["Active", "Mostly cancelled"]);
  });
});

describe("ReportsPanel — a group card does not count cancelled work Green", () => {
  it("names the cancelled count and leaves Green at zero (open-followups §66)", () => {
    renderReports([
      makeTask({ id: 1, assignee: "Alex", group: "Alpha", status: "To Do" }),
      makeTask({ id: 2, assignee: "Bea", group: "Alpha", status: "Cancelled" }),
    ]);
    // TWO, and the count is the point: the Total tile's sub line already said
    // "1 cancelled" before this change, so a bare getByText finds that one and
    // passes with the group card left unfixed. (It does not merely pass — it
    // THROWS on the second match, which is how this was caught.)
    expect(screen.getAllByText(/1 cancelled/)).toHaveLength(2);
    // The point of §66: before this, the cancelled row was tallied Green, so
    // the same fixture read "… · 1 green". Asserting the absence is what fails
    // on the unfixed code — the presence assertion above would pass either way
    // once the clause exists.
    expect(screen.queryByText(/1 green/)).toBeNull();
  });
});

describe("ReportsPanel — sortable headers are unique across the sibling tables", () => {
  // §246: three embedded tables reusing generic column labels. The names are
  // NOT same-purpose — "Open" in the assignee table sorts a different table
  // from "Open" in the group table — so this is a genuine 2.4.6 failure.
  const tasks: Task[] = [
    makeTask({ id: 1, assignee: "Alex", group: "Backend", labels: ["urgent"] }),
    makeTask({ id: 2, assignee: "Bea", group: "Frontend", labels: ["ui"] }),
  ];

  // ★★★ `requireCollisionSeed` CANNOT be used here, and this is measured rather
  // than assumed: turning it on FAILS against the fixed code. That guard strips
  // only `buildRowTokens`' " (N)" occurrence suffix, and this surface
  // disambiguates a different way — it appends " – <section heading>", the same
  // class as `documents-deleted-section.tsx`'s " · #id", which the helper's own
  // docstring records as outside what it can certify. The anti-vacuity guard is
  // therefore the assertion BELOW, which is that guard's semantics re-expressed
  // for this disambiguator: strip the context and the collision must reappear.
  // Do NOT "restore" requireCollisionSeed — it would go red on correct code.
  const CONTEXT_SUFFIX = / – (By assignee|By group|By label)$/;

  it("gives every sortable header a table-unique accessible name", () => {
    const { container } = renderReports(tasks);
    expectRowUniqueNames({
      // MEASURED off this helper's own error, not guessed. Re-measure and BUMP
      // this if the panel grows a control; never lower it. A floor below the
      // true count would let a silently-empty render — or a narrowed query —
      // read as a pass.
      // ★★★ THIS INSTRUCTION WAS MISSED ONCE, BY ME, AND THE COST IS CONCRETE.
      // The arrangement binding added ~26 controls while this floor stayed at
      // its pre-restructure 27 — eighteen below the truth. A regression dropping
      // all thirteen ⋮ and five grips would still leave 27 uniquely-named
      // controls and this test would go GREEN. Re-measured by probe (set it to
      // 999 and read the helper's own error): the scope renders 45.
      minControls: 45,
      scope: container,
      roles: ["button"],
    });
  });

  // Without this the test above is VACUOUS: three tables rendering no rows, or
  // a fixture whose columns happened not to repeat, would satisfy uniqueness
  // trivially. This proves the fixture genuinely puts the same generic column
  // labels on sibling tables, so the qualification is the only thing separating
  // them — and it names them, so a table silently dropping out goes red.
  it("seeds the collision the qualification resolves", () => {
    const { container } = renderReports(tasks);
    const bare = controlNames(["button"], container).map((n) => n.replace(CONTEXT_SUFFIX, ""));
    const counts = new Map<string, number>();
    for (const n of bare) counts.set(n, (counts.get(n) ?? 0) + 1);
    const collides = [...counts.entries()].filter(([, c]) => c > 1).map(([n]) => n).sort();
    // ★★ THE ARRANGEMENT BINDING ADDED TWO ENTRIES, and they are real seeded
    // collisions rather than noise. Every block now renders a grip and a ⋮, both
    // named `<verb> – <block title>`; strip the context and all thirteen grips
    // are the same string, as are all thirteen ⋮. That WIDENS what this file
    // guards: the uniqueness assertion above now goes red if the tile chrome's
    // qualifier is dropped, not just if a table header's is.
    expect(collides).toEqual([
      "Cancelled",
      "Completed",
      "Drag or use arrow keys to reorder",
      "Inquiries",
      "More actions",
      "Open",
      "Overdue",
      "Total",
    ]);
  });

  // ★★★ POSITIVE per-table pin, and NEITHER test above can replace it. A SINGLE
  // table losing its context is invisible to both: its bare "Open" collides
  // with nothing (the other two are still qualified, so "Open – By group" is a
  // different string), and stripping the suffix maps the other two onto the
  // same "Open" the bare one already is — so the colliding set is UNCHANGED and
  // both stay green. Measured with a mutant, not reasoned. Each table therefore
  // needs its own qualified name asserted DIRECTLY, or that call site's
  // forwarding is pinned by nothing at all.
  //
  // ★ One column label all three share, so the three assertions are genuinely
  // parallel. The qualified name rides `aria-label`, so it carries no sort
  // glyph and this does not depend on which column each table sorts by.
  it("qualifies the shared column label in each of the three tables", () => {
    renderReports(tasks);
    for (const heading of ["reportsByAssignee", "reportsByGroup", "reportsByLabel"] as const) {
      expect(
        screen.getByRole("button", { name: `${t("en-US", "reportsOpen")} – ${t("en-US", heading)}` }),
      ).toBeInTheDocument();
    }
  });
});

/**
 * The arrangement binding (Task 12): every block — the nine built-ins and the
 * four addable reports — renders as one `ArrangementTile` inside one
 * `ArrangementGrid`, replacing the `<Section>` stack and the bespoke
 * extra-report card. One reorder mechanism, not two.
 */
describe("ReportsPanel — the arrangement grid", () => {
  const tasks = [
    makeTask({ id: 1, assignee: "Ann", group: "Alpha" }),
    makeTask({ id: 2, assignee: "Bo", group: "Beta" }),
  ];

  it("renders every visible block as an arrangement tile", () => {
    renderReports(tasks);
    expect(screen.getByTestId("reports-grid")).toBeInTheDocument();
    expect(screen.getByTestId("report-block-byAssignee")).toBeInTheDocument();
    expect(screen.getByTestId("report-block-stats")).toBeInTheDocument();
  });

  it("binds a 120px row unit and a gap, as WHOLE LITERAL class strings", () => {
    // ★★★ THE ONLY GUARD THAT EXISTS FOR THE ROW UNIT, and it closes the
    // obligation `report-blocks.ts` records. 120px, not the Dashboard's 80px:
    // `BlockSpan` caps at 4, so an 80px unit would put an embedded report in a
    // 320px box. ★★ jsdom has no layout, so this can only assert that the CLASS
    // was rendered — never that Tailwind emitted a rule for it. An interpolated
    // class would produce this identical string and emit no CSS at all, so a
    // green run here is not evidence the grid renders correctly; that is
    // `e2e/dashboard-grid.spec.ts`'s job for the Dashboard and is owed a browser
    // eye-verify here.
    renderReports(tasks);
    const grid = screen.getByTestId("reports-grid");
    expect(grid.className).toContain("auto-rows-[120px]");
    expect(grid.className).toContain("gap-4");
    // ★ And NOT the Dashboard's unit, which is the mistake this pins against.
    expect(grid.className).not.toContain("auto-rows-[80px]");
  });

  it("renders NO scroller of its own — the card's contentRef is the scroller", () => {
    // ★★★ A nested `overflow-y-auto` sizes to its content, so `scrollHeight ===
    // clientHeight` and the drag autoscroll silently stops working. The real
    // scroller is `ReportCard`'s own `contentRef`, which is the same ref the
    // reorder hook gets.
    renderReports(tasks);
    const grid = screen.getByTestId("reports-grid");
    expect(grid.className).not.toContain("overflow-y-auto");
    expect(grid.className).not.toContain("overflow-auto");
  });

  it("no longer renders the legacy extra-report card wrapper", () => {
    // ★ One mechanism, not two: the old `useListReorderDnd<AddableReportId>`
    // card — its `data-drop-edge`, its own `DragHandle` and its ✕ — is gone.
    renderReports(tasks, { extraReports: ["raid-report"] });
    expect(screen.queryAllByTestId("extra-report-card")).toHaveLength(0);
  });

  it("gives every per-block control a block-unique accessible name", () => {
    // ★★★ axe is provably blind to duplicate accessible names in EVERY view at
    // EVERY seed size, and Reports IS an axe-scanned view — so this is the only
    // detector that can exist for the grips and the ⋮ buttons here.
    //
    // ★★★ `requireCollisionSeed` IS OFF, AND THAT IS NOT THE `ArrangementTile`
    // excuse repeated. Being the LIST owner is necessary for a collision-seeded
    // test but not sufficient: a fixture must be able to make two rows SHARE a
    // display name, and here it cannot. Every block title is
    // `t(lang, spec.labelKey)` off the module-level `REPORT_BLOCKS` catalogue —
    // nine distinct built-in keys plus the four `ADDABLE_REPORTS` titles — so no
    // prop this panel accepts can make two of them equal. The guard would throw
    // against correct code.
    // ★ The property IS pinned where a fixture can express it:
    // `arrangement-shelf.test.tsx` seeds two chips with the same title and runs
    // `requireCollisionSeed: true` against `buildRowTokens`.
    const { container } = renderReports(tasks, { extraReports: ["raid-report"] });
    expectRowUniqueNames({
      // ★★ EXACT, NOT "well below". An earlier revision of this line set 12 and
      // said so openly — honest, but it forgoes the guard by choice: a floor
      // under the true count cannot tell a silently-empty render from a full
      // one. Measured by the same probe: this fixture renders 47, two more than
      // the 45 above because it adds the RAID report block (one grip, one ⋮).
      minControls: 47,
      scope: container,
    });
  });

  it("names each block's grip with that block's own title", () => {
    // ★ The uniqueness assertion above passes if the names differ for ANY
    // reason; this names which qualifier must be present.
    renderReports(tasks);
    for (const key of ["reportsByAssignee", "reportsByGroup"] as const) {
      expect(
        screen.getByRole("button", {
          name: `${t("en-US", "reorderHandle")} – ${t("en-US", key)}`,
        }),
      ).toBeInTheDocument();
    }
  });
});

describe("ReportsPanel — toolbar order", () => {
  /**
   * ★★★ THIS CONVENTION WAS COMPLIED WITH AND PINNED BY NOTHING. `ReportCard`
   * renders the trailing group correctly today — Print · reset-columns ·
   * reset-size — but neither `report-table.test.tsx` nor this file contained a
   * single `expectButtonOrder`/`buttonIndex` call before this test, so a
   * reordering, or a control drifting BETWEEN two members, was invisible.
   * Measured, not assumed: `grep -rn "expectButtonOrder\|buttonIndex"` over both
   * files returned nothing.
   *
   * ★★ `contiguous: true` is the half that matters. Plain ordering passes while
   * a new control sits between Print and a reset — which is exactly the drift
   * `AGENTS.md` records four instances of, and exactly the risk Task 13 carries
   * when it adds the reset-layout button to this group.
   *
   * ★ Uses the shared helper deliberately: `buttonIndex` THROWS when a key
   * matches zero or several buttons, where a hand-rolled `findIndex` silently
   * takes the first and can pin the wrong control.
   */
  it("ends with the contiguous Print · reset-columns · reset-size group", () => {
    renderReports([makeTask({ id: 1, assignee: "Ann" })]);
    expectButtonOrder(["printHint", "colResetWidthsHint", "tableResetSizeHint"], {
      contiguous: true,
    });
  });
});
