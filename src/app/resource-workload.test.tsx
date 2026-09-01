import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { ResourceWorkload, WORKLOAD_COL_WIDTHS } from "./resource-workload";
import { ConfirmProvider } from "./confirm-dialog";
import { t } from "./i18n";
import { expectRowUniqueNames } from "../test/row-unique-names";
import type { Resource, Task } from "./types";

const r: Resource = { id: 1, firstName: "Sample", lastName: "Dummy", roleId: null, utilizationMode: "percent", utilization: {} };
const colResize = {
  colWidths: { ...WORKLOAD_COL_WIDTHS },
  startColResize: () => {},
  resetColWidths: () => {},
};
const baseProps = {
  lang: "en-US" as const, resources: [r], absences: [], shifts: [], raid: [], raidEnabled: true, today: "2026-06-01",
  onEditResource: vi.fn(), onAddResource: vi.fn(), onEditAbsence: vi.fn(), onEditShift: vi.fn(),
  nearTermPeriodKey: null, nearTermPctByResource: new Map<number, number>(), overAllocatedPct: 100,
  onSetUtilization: vi.fn(), onReassignTask: vi.fn(), onRescheduleTask: vi.fn(),
  colResize,
};

describe("ResourceWorkload", () => {
  it("clicking a managed resource's name opens the editor", () => {
    const onEditResource = vi.fn();
    render(<ResourceWorkload {...baseProps} tasks={[]} onEditResource={onEditResource} />);
    fireEvent.click(screen.getByRole("button", { name: "Alex Example" }));
    expect(onEditResource).toHaveBeenCalledWith(r);
  });

  it("clicking a managed row fires onEditResource (RAID-style row click)", () => {
    const onEditResource = vi.fn();
    render(<ResourceWorkload {...baseProps} tasks={[]} onEditResource={onEditResource} />);
    const row = screen.getByRole("button", { name: "Alex Example" }).closest("tr")!;
    expect(row.className).toContain("cursor-pointer");
    expect(row.className).toContain("hover:bg-surface-muted");
    fireEvent.click(row);
    expect(onEditResource).toHaveBeenCalledTimes(1);
    expect(onEditResource).toHaveBeenCalledWith(r);
  });

  it("clicking the name button fires onEditResource exactly once (stopPropagation prevents double-fire)", () => {
    const onEditResource = vi.fn();
    render(<ResourceWorkload {...baseProps} tasks={[]} onEditResource={onEditResource} />);
    fireEvent.click(screen.getByRole("button", { name: "Alex Example" }));
    expect(onEditResource).toHaveBeenCalledTimes(1);
  });

  it("clicking the shift button fires onEditShift once and NOT onEditResource (stopPropagation guard)", () => {
    const onEditResource = vi.fn();
    const onEditShift = vi.fn();
    render(
      <ResourceWorkload
        {...baseProps}
        tasks={[]}
        onEditResource={onEditResource}
        onEditShift={onEditShift}
      />,
    );
    // The shift cell button lives in a managed row that also has a row-level
    // onClick; its title is the default-shift label when no shift is set.
    fireEvent.click(screen.getByTitle(t("en-US", "resourcesDefaultShift")));
    expect(onEditShift).toHaveBeenCalledTimes(1);
    expect(onEditResource).not.toHaveBeenCalled();
  });

  it("offers Add as resource for an unlinked assignee and seeds the name", () => {
    const onAddResource = vi.fn();
    const tasks: Task[] = [{ id: 9, taskName: "T", assignee: "Bob Lee", assigneeEmail: "bob@x.com", dueDate: "2026-12-31", lastUpdateDate: "2026-01-01", status: "To Do", priority: "Medium", blockers: "", description: "", inquiriesSent: 0 }];
    render(<ResourceWorkload {...baseProps} tasks={tasks} onAddResource={onAddResource} />);
    expect(screen.getByText("Bob Lee")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /add as resource/i }));
    expect(onAddResource).toHaveBeenCalledWith(expect.objectContaining({ firstName: "Bob", lastName: "Lee", email: "bob@x.com" }));
  });

  it("no clear-unlinked (×) button without onClearUnlinked", () => {
    const tasks: Task[] = [{ id: 9, taskName: "T", assignee: "Bob Lee", assigneeEmail: "bob@x.com", dueDate: "2026-12-31", lastUpdateDate: "2026-01-01", status: "To Do", priority: "Medium", blockers: "", description: "", inquiriesSent: 0 }];
    render(<ResourceWorkload {...baseProps} tasks={tasks} />);
    expect(screen.queryByRole("button", { name: /clear bob lee/i })).toBeNull();
  });

  it("clears an unlinked row via confirm → onClearUnlinked with the row identity", async () => {
    const onClearUnlinked = vi.fn();
    const tasks: Task[] = [{ id: 9, taskName: "T", assignee: "Bob Lee", assigneeEmail: "bob@x.com", dueDate: "2026-12-31", lastUpdateDate: "2026-01-01", status: "To Do", priority: "Medium", blockers: "", description: "", inquiriesSent: 0 }];
    render(
      <ConfirmProvider lang="en-US">
        <ResourceWorkload {...baseProps} tasks={tasks} onClearUnlinked={onClearUnlinked} />
      </ConfirmProvider>,
    );
    // ★ This clear DELETES absences and shifts outright, so it must keep the
    // destructive affordance. `hover:text-ui-pink-strong` is unique to IconButton's
    // `danger` recipe; the neutral `ghost` default would carry `hover:text-foreground`.
    expect(screen.getByRole("button", { name: /clear bob lee/i }).className).toMatch(
      /\bhover:text-ui-pink-strong\b/,
    );
    fireEvent.click(screen.getByRole("button", { name: /clear bob lee/i }));
    fireEvent.click(await screen.findByRole("button", { name: /^confirm$/i }));
    await waitFor(() =>
      expect(onClearUnlinked).toHaveBeenCalledWith(expect.objectContaining({ display: "Bob Lee", email: "bob@x.com", firstName: "Bob", lastName: "Lee" })),
    );
  });

  it("no longer renders its own reset-column-widths button (moved to the panel header)", () => {
    render(<ResourceWorkload {...baseProps} tasks={[]} />);
    expect(screen.queryByRole("button", { name: /reset all column widths/i })).toBeNull();
  });

  it("shows the Open RAID column when raidEnabled, hides it when not", () => {
    const { rerender } = render(<ResourceWorkload {...baseProps} tasks={[]} raidEnabled />);
    expect(screen.getByText("Open RAID")).toBeInTheDocument();
    rerender(<ResourceWorkload {...baseProps} tasks={[]} raidEnabled={false} />);
    expect(screen.queryByText("Open RAID")).toBeNull();
  });

  it("edits near-term utilization inline, calling onSetUtilization (#24)", () => {
    const onSetUtilization = vi.fn();
    render(
      <ResourceWorkload
        {...baseProps}
        tasks={[]}
        nearTermPeriodKey="2026-06"
        nearTermPctByResource={new Map([[1, 120]])}
        onSetUtilization={onSetUtilization}
      />,
    );
    const input = screen.getByLabelText(/Near-term utilization for Alex Example/i) as HTMLInputElement;
    // Over-allocated (>100%) → pink highlight.
    expect(input.className).toContain("text-ui-pink-strong");
    fireEvent.change(input, { target: { value: "50" } });
    expect(onSetUtilization).toHaveBeenCalledWith(1, "2026-06", 50);
  });

  it("triages an overdue task inline: reassign + reschedule (#24)", () => {
    const onReassignTask = vi.fn();
    const onRescheduleTask = vi.fn();
    const r2: Resource = { id: 2, firstName: "Ben", lastName: "Ng", roleId: null, utilizationMode: "percent", utilization: {} };
    const overdue = { id: 10, taskName: "Fix bug", assignee: "Alex Example", dueDate: "2026-01-01", resourceId: 1 } as unknown as Task;
    render(
      <ResourceWorkload
        {...baseProps}
        resources={[r, r2]}
        tasks={[overdue]}
        onReassignTask={onReassignTask}
        onRescheduleTask={onRescheduleTask}
      />,
    );
    // Overdue count is a triage trigger.
    fireEvent.click(screen.getByRole("button", { name: /Triage overdue tasks – Alex Example/i }));
    // Reassign via the resource select.
    fireEvent.change(screen.getByLabelText(/Owner – Fix bug/i), { target: { value: "2" } });
    expect(onReassignTask).toHaveBeenCalledWith(10, r2);
    // Reschedule via the date input.
    fireEvent.change(screen.getByLabelText(/Due – Fix bug/i), { target: { value: "2026-12-31" } });
    expect(onRescheduleTask).toHaveBeenCalledWith(10, "2026-12-31");
  });

  it("disables triage controls for a Jira-synced overdue task (#24)", () => {
    const overdue = { id: 10, taskName: "Fix bug", assignee: "Alex Example", dueDate: "2026-01-01", resourceId: 1, jiraKey: "PROJ-1" } as unknown as Task;
    render(<ResourceWorkload {...baseProps} tasks={[overdue]} />);
    fireEvent.click(screen.getByRole("button", { name: /Triage overdue tasks – Alex Example/i }));
    // Jira owns synced tasks — local reassign/reschedule would be reverted, so both are disabled.
    expect(screen.getByLabelText(/Owner – Fix bug/i)).toBeDisabled();
    expect(screen.getByLabelText(/Due – Fix bug/i)).toBeDisabled();
  });

  // WCAG 2.4.6 — every unlinked row renders an "Add as resource" button whose
  // accessible name came from its CONTENT alone, so N unlinked assignees
  // announced one name (open-followups §276). The row's identity sits in a
  // SIBLING <span>, outside the button, so nothing disambiguated it.
  //
  // ★★ `requireCollisionSeed` is deliberately OFF: this is a DISTINCT-name
  // regression pin, not a collision test, which is the case the flag's own
  // docstring says to leave it off for.
  // ★★★ The paragraph that stood here gave a different and now FALSE reason —
  // that `display.toLowerCase()` keying makes a shared display name structurally
  // impossible, that " (N)" "can never be emitted on this surface", and that
  // `buildRowTokens` "would be dead code". All three were refuted: that key
  // trims and case-folds without collapsing whitespace, and `buildRowTokens` is
  // live on every unlinked control this test renders.
  //
  // ★ The fixture is still collision-BEARING for the defect under test: before
  // the fix BOTH buttons are named exactly "Add as resource".
  it("gives every unlinked row's add-as-resource button a row-unique name (§276)", () => {
    const unlinkedTasks = [
      { id: 41, taskName: "Draft SOW", assignee: "Alice Smith", dueDate: "2026-07-01" },
      { id: 42, taskName: "Review SOW", assignee: "Bob Jones", dueDate: "2026-07-02" },
    ] as unknown as Task[];
    // EQUAL hours on purpose. These were once deliberately distinct (32h / 24h)
    // to keep the then-unqualified weekly-hours buttons from colliding on "40"
    // and masking the add-as-resource defect under test. §315 qualified those
    // buttons with the row, so equal hours are safe again and the fixture no
    // longer carries a difference that has nothing to do with this assertion.
    const partTime = [
      { id: 1, assignee: "Alice Smith", hoursPerWeekday: [8, 8, 8, 8, 0, 0, 0] },
      { id: 2, assignee: "Bob Jones", hoursPerWeekday: [8, 8, 8, 8, 0, 0, 0] },
    ] as unknown as React.ComponentProps<typeof ResourceWorkload>["shifts"];
    render(<ResourceWorkload {...baseProps} tasks={unlinkedTasks} shifts={partTime} />);
    // Both unlinked rows reached the table — otherwise the assertion below is
    // about a list that never rendered.
    expect(screen.getByText("Alice Smith")).toBeInTheDocument();
    expect(screen.getByText("Bob Jones")).toBeInTheDocument();
    expectRowUniqueNames({ minControls: 6 });
  });

  // ★★ The distinct part-time shifts throughout the fixtures below are NO
  // LONGER LOAD-BEARING, and reading them as such is the trap this note exists
  // to close. They date from when every row's weekly-hours button was
  // content-named, so two rows on the same contracted hours collided on "40"
  // regardless of anything under test — the distinct hours isolated these
  // assertions from that. §315 qualified both tables' hours buttons with the
  // row, so the collision is closed and equal hours would be safe here too;
  // these are simply left as they are. Do not restore a difference elsewhere
  // "to match", and do not cite this helper as evidence the defect is open.
  const shiftFor = (id: number, resourceId: number | null, assignee: string, days: number) =>
    ({ id, resourceId, assignee, hoursPerWeekday: [8, 8, 8, 8, 8, 0, 0].map((h, i) => (i < days ? h : 0)) }) as unknown as
      React.ComponentProps<typeof ResourceWorkload>["shifts"][number];

  // WCAG 2.4.6 — `buildResourceWorkload` keys `managed` on the RESOURCE ID
  // (only its `nameToId` join map de-duplicates by name), so two resources may
  // carry one display name. The row's name button has no aria-label, so its
  // accessible name is its CONTENT — both rows announced "Alex Example".
  const twin: Resource = { id: 2, firstName: "Sample", lastName: "Dummy", roleId: null, utilizationMode: "percent", utilization: {} };

  it("gives every managed row control a row-unique name when two resources share a display name", () => {
    render(
      <ResourceWorkload
        {...baseProps}
        resources={[r, twin]}
        tasks={[]}
        shifts={[shiftFor(1, 1, "Alex Example", 5), shiftFor(2, 2, "Alex Example", 4)]}
      />,
    );
    // 4 = measured: a name button and an hours button per managed row.
    expectRowUniqueNames({ minControls: 4, requireCollisionSeed: true });
  });

  // WCAG 2.4.6 — an absence chip is content-named too (a date range plus the
  // raw type), so two people off on the same dates for the same reason share a
  // name. The fixture deliberately gives the two people DIFFERENT names: the
  // chips are what must be told apart, and the disambiguator under test is the
  // row qualifier rather than an occurrence index.
  const ben: Resource = { id: 2, firstName: "Ben", lastName: "Ng", roleId: null, utilizationMode: "percent", utilization: {} };
  const sameWindow = (id: number, resourceId: number, assignee: string) =>
    ({ id, resourceId, assignee, startDate: "2026-07-01", endDate: "2026-07-05", type: "vacation" }) as unknown as
      React.ComponentProps<typeof ResourceWorkload>["absences"][number];

  // ★★ `requireCollisionSeed` is OFF here ON PURPOSE, and NOT because it is
  // merely unnecessary — it would THROW against the fixed code. It certifies a
  // collision seed by stripping a trailing " (N)", and the fix for this site is
  // a row QUALIFIER, not an occurrence index, so no name on this surface ever
  // carries that suffix. Forcing one (by also colliding the two people's names)
  // would satisfy the guard via the name buttons — a different control — and
  // mask whatever the chips did.
  it("qualifies each managed row's absence chip so two people off the same days do not share a name", () => {
    render(
      <ResourceWorkload
        {...baseProps}
        resources={[r, ben]}
        tasks={[]}
        absences={[sameWindow(11, 1, "Alex Example"), sameWindow(12, 2, "Ben Ng")]}
        shifts={[shiftFor(1, 1, "Alex Example", 5), shiftFor(2, 2, "Ben Ng", 4)]}
      />,
    );
    // 6 = measured: a name button, an hours button and one absence chip per row.
    expectRowUniqueNames({ minControls: 6 });
  });

  // ★ The chip is located by its VISIBLE text, never by its aria-label — a
  // finder keyed on the qualifier would throw rather than assert when the
  // qualifier is mutated away, which reads as a broken test rather than as the
  // guard firing, and would make this test and the one below redundant.
  const absenceChip = () =>
    screen.getAllByRole("button").find((b) => b.textContent?.includes("vacation"))!;

  it("names a managed absence chip after the row it belongs to", () => {
    render(
      <ResourceWorkload {...baseProps} resources={[r]} tasks={[]} absences={[sameWindow(11, 1, "Alex Example")]} />,
    );
    expect(absenceChip().getAttribute("aria-label")).toContain("Alex Example");
  });

  it("keeps an absence chip's visible text inside its accessible name (WCAG 2.5.3)", () => {
    render(
      <ResourceWorkload
        {...baseProps}
        resources={[r]}
        tasks={[]}
        absences={[sameWindow(11, 1, "Alex Example")]}
      />,
    );
    const chip = absenceChip();
    // 2.5.3 is CONTAINMENT, case-insensitive — not a prefix rule. The chip's
    // two spans compute to "<range> vacation", which must survive verbatim
    // inside whatever the qualifier wraps it in.
    // Joined with NO separator on purpose: name-from-content concatenates
    // inline content without one, measured on this very surface — before the
    // qualifier landed, the two colliding chips computed to
    // "Jul 01–Jul 05vacation". Joining with a space would assert a string the
    // accessible name never contains.
    const visible = Array.from(chip.querySelectorAll("span")).map((s) => s.textContent).join("");
    expect(chip.getAttribute("aria-label")?.toLowerCase()).toContain(visible.toLowerCase());
  });

  it("qualifies each unlinked row's absence chip so two unlinked people off the same days do not share a name", () => {
    const unlinkedTasks = [
      { id: 41, taskName: "Draft SOW", assignee: "Alice Smith", dueDate: "2026-07-01" },
      { id: 42, taskName: "Review SOW", assignee: "Bob Jones", dueDate: "2026-07-02" },
    ] as unknown as Task[];
    render(
      <ResourceWorkload
        {...baseProps}
        resources={[]}
        tasks={unlinkedTasks}
        absences={[
          { id: 21, assignee: "Alice Smith", startDate: "2026-07-01", endDate: "2026-07-05", type: "vacation" },
          { id: 22, assignee: "Bob Jones", startDate: "2026-07-01", endDate: "2026-07-05", type: "vacation" },
        ] as unknown as React.ComponentProps<typeof ResourceWorkload>["absences"]}
        shifts={[shiftFor(1, null, "Alice Smith", 5), shiftFor(2, null, "Bob Jones", 4)]}
      />,
    );
    // 6 = measured: an add-as-resource button, an hours button and one absence
    // chip per unlinked row; `resources={[]}` leaves no managed row at all.
    expectRowUniqueNames({ minControls: 6 });
  });

  // WCAG 2.4.6 (§315) — the weekly-hours button's accessible name is its own
  // CONTENT, the contracted hours number, so a team on one standard week gives
  // N buttons all named "40". BOTH tables render it, and the two halves take
  // DIFFERENT fixes. `buildResourceWorkload` keys `managed` on the numeric
  // resource id, so a display name CAN repeat there — that half needs the row
  // TOKEN, and this fixture is the two-Sarahs shape the token exists for.
  it("gives the MANAGED weekly-hours buttons row-unique names when two people share a name and hours (§315)", () => {
    render(<ResourceWorkload {...baseProps} resources={[r, twin]} tasks={[]} />);
    // 4 = measured: a name button and an hours button per managed row. No
    // `shifts` is passed, so both rows carry the same DEFAULT weekly hours —
    // that is the collision under test, not an oversight.
    expectRowUniqueNames({ minControls: 4, requireCollisionSeed: true });
  });

  // ★★★ A SHARED UNLINKED NAME IS SEEDABLE AFTER ALL, and the comment that used
  // to sit here denied it: it said `requireCollisionSeed` "would THROW against
  // CORRECT code" because `buildResourceWorkload` keys unlinked rows on
  // `display.toLowerCase()`, so no display name can repeat. That key trims and
  // case-folds but does NOT collapse internal whitespace runs, while an
  // accessible name IS compared collapsed — so "Bob  Smith" (two spaces) and
  // "Bob Smith" (one) are TWO rows announcing ONE name. The seed below is
  // exactly that pair, and the button now takes the row TOKEN.
  //
  // ★★★ `expectRowUniqueNames` ALONE CANNOT SEE THIS COLLISION, so the collapsed
  // comparison below is not decoration — it is the assertion that goes red when
  // the token is reverted to a plain `row.display`. The harness's duplicate
  // check compares names RAW (`src/test/row-unique-names.ts`), and the two names
  // differ by one space, so it reports no duplicate either way. Only
  // `requireCollisionSeed` collapses, and that is a seed guard, not a detector.
  // Measured, not reasoned: with the token reverted the `expectRowUniqueNames`
  // call stays GREEN and only the collapsed assertion turns red.
  //
  // ★ The harness still earns its place: it kills the ORIGINAL §315 mutant
  // (deleting the `aria-label` outright leaves both buttons named by content,
  // "40" twice, a raw duplicate).
  it("gives the UNLINKED weekly-hours buttons distinct names when two people share a whitespace-collapsed name (§315)", () => {
    const unlinkedTasks = [
      { id: 41, taskName: "Draft SOW", assignee: "Bob  Smith", dueDate: "2026-07-01" },
      { id: 42, taskName: "Review SOW", assignee: "Bob Smith", dueDate: "2026-07-02" },
    ] as unknown as Task[];
    // `onClearUnlinked` is passed so the ✕ RENDERS — it takes the same token and
    // is otherwise covered by nothing, which would leave that half of the fix a
    // claim with no detector behind it.
    render(<ResourceWorkload {...baseProps} resources={[]} tasks={unlinkedTasks} onClearUnlinked={vi.fn()} />);
    // Both unlinked rows reached the table — otherwise the assertions below are
    // about a list that never rendered. Two matches, because RTL's text matcher
    // normalises whitespace exactly as the accessible-name computation does:
    // that is the defect, seen from the query side.
    expect(screen.getAllByText("Bob Smith")).toHaveLength(2);
    // 6 = MEASURED, not counted off the JSX: an add-as-resource button, an hours
    // button and a clear-unlinked ✕ per unlinked row; `resources={[]}` leaves no
    // managed row at all. No `shifts` is passed, so both rows carry the same
    // DEFAULT weekly hours — the collision under test.
    expectRowUniqueNames({ minControls: 6, requireCollisionSeed: true });
    // The hours buttons are the ones under test — `/^\d+ – /` matches only
    // those (add-as-resource starts with its verb), and it also fails loudly if
    // the qualifier is dropped entirely, since a bare "40" does not match.
    const hoursNames = screen
      .getAllByRole("button", { name: /^\d+ – / })
      .map((b) => (b.getAttribute("aria-label") ?? "").replace(/\s+/g, " "));
    expect(hoursNames).toHaveLength(2);
    expect(new Set(hoursNames).size).toBe(2);
    // ★★★ THE ADD-AS-RESOURCE BUTTONS ARE A SECOND, INDEPENDENT DETECTOR — they
    // carried the same refuted "`row.display` cannot repeat here" premise and now
    // take the same token. Collapsed, because the harness compares RAW and one
    // space cannot separate two names a screen reader reads identically.
    // ★★ An earlier comment here claimed these two were what SATISFIED
    // `requireCollisionSeed` above, i.e. that the guard was being certified by a
    // broken control. That was FALSE and self-contradictory: once tokenised, the
    // hours pair strips to "40 – Bob  Smith" / "40 – Bob Smith" and COLLAPSES to
    // one string, so it satisfies the guard on its own.
    const addNames = screen
      .getAllByRole("button", { name: /^Add as resource – / })
      .map((b) => (b.getAttribute("aria-label") ?? "").replace(/\s+/g, " "));
    expect(addNames).toHaveLength(2);
    expect(new Set(addNames).size).toBe(2);
    // The ✕ is icon-only, so its whole accessible name is the interpolated
    // string — "Clear {0}" in EN, which puts the token last. ★ In DE the key is
    // "{0} entfernen" and the index lands mid-string; uniqueness still holds,
    // but this regex and the harness's end-anchored strip are EN-shaped.
    const clearNames = screen
      .getAllByRole("button", { name: /^Clear / })
      .map((b) => (b.getAttribute("aria-label") ?? "").replace(/\s+/g, " "));
    expect(clearNames).toHaveLength(2);
    expect(new Set(clearNames).size).toBe(2);
  });

  // ★★★ THE COLLISION ALSO CROSSES THE TWO TABLES, which is one level up from
  // everything above and was live behind a comment asserting it could not
  // happen: "an unlinked row exists precisely BECAUSE its name matched no
  // resource case-folded, so no unlinked `display` can equal a managed one."
  // Case-folded inequality is not COLLAPSED inequality. `resourceDisplayName`
  // joins with a single space and trims; `nameToId` keys on
  // `display.trim().toLowerCase()`; `resolve` looks up `name.toLowerCase()`. So
  // the resource below (display "Mary  Jane Smith") and the task assignee
  // ("Mary Jane Smith") MISS each other — one managed row, one unlinked row, one
  // `<table>`, one announced name.
  // ★★ With a token map PER TABLE each name was unique inside its own map, so
  // both came out BARE. That is why the maps were merged with prefixed keys
  // rather than the claim merely deleted: two bare tokens is the defect.
  // ★ `expectRowUniqueNames` cannot see this either (it compares RAW), so the
  // collapsed comparison is again the detector.
  it("keeps a managed row and an unlinked row distinct when their names differ only by whitespace (§315)", () => {
    const wide: Resource = { id: 7, firstName: "Mary  Jane", lastName: "Smith", roleId: null, utilizationMode: "percent", utilization: {} };
    const crossTasks = [
      { id: 51, taskName: "Spec", assignee: "Mary Jane Smith", dueDate: "2026-07-01" },
    ] as unknown as Task[];
    render(<ResourceWorkload {...baseProps} resources={[wide]} tasks={crossTasks} />);
    // Both rows reached the table: RTL's text matcher normalises whitespace the
    // way the accessible-name computation does, so one query finds both — that
    // is the defect seen from the query side.
    expect(screen.getAllByText("Mary Jane Smith")).toHaveLength(2);
    const hoursNames = screen
      .getAllByRole("button", { name: /^\d+ – / })
      .map((b) => (b.getAttribute("aria-label") ?? "").replace(/\s+/g, " "));
    expect(hoursNames).toHaveLength(2);
    expect(new Set(hoursNames).size).toBe(2);
  });
});
