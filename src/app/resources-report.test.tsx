import { test, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ResourcesReportPanel } from "./resources-report";
import type { Resource, Role, Discipline, Grade, ResourcePlan } from "./types";
import { expectRowUniqueNames } from "../test/row-unique-names";

const disciplines: Discipline[] = [{ id: 1, name: "Developer" }];
const grades: Grade[] = [{ id: 1, name: "Senior" }];
const roles: Role[] = [{ id: 5, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 200 }];
const plan: ResourcePlan = { startDate: "2026-02-01", endDate: "2026-02-28", granularity: "month", currency: "USD" };
const resources: Resource[] = [{ id: 1, firstName: "Sample", lastName: "", roleId: 5, utilizationMode: "percent", utilization: { "2026-02": 100 } }];

test("renders total internal cost and the resource row", () => {
  render(
    <ResourcesReportPanel lang="en-US" resources={resources} roles={roles}
      disciplines={disciplines} grades={grades} plan={plan} absences={[]}
      holidaySet={new Set()} workdayHours={8} />,
  );
  expect(screen.getAllByText("$16,000").length).toBeGreaterThan(0);
  expect(screen.getByText("Sample")).toBeInTheDocument();
  expect(screen.getAllByText("Developer Senior").length).toBeGreaterThan(0);
});

test("marks the report root as a print-root for scoped printing", () => {
  const { container } = render(
    <ResourcesReportPanel lang="en-US" resources={resources} roles={roles}
      disciplines={disciplines} grades={grades} plan={plan} absences={[]}
      holidaySet={new Set()} workdayHours={8} />,
  );
  // ReportCard wraps in a div with both print-root and the resizable class
  expect(container.querySelector(".print-root")).toBeTruthy();
});

test("renders a Print button", () => {
  render(
    <ResourcesReportPanel lang="en-US" resources={resources} roles={roles}
      disciplines={disciplines} grades={grades} plan={plan} absences={[]}
      holidaySet={new Set()} workdayHours={8} />,
  );
  expect(screen.getByRole("button", { name: /print/i })).toBeInTheDocument();
});

test("embedded mode renders content without a print button", () => {
  render(
    <ResourcesReportPanel
      lang="en-US" resources={resources} roles={roles} disciplines={disciplines}
      grades={grades} plan={plan} absences={[]} holidaySet={new Set()} workdayHours={8} embedded
    />,
  );
  expect(screen.getByText("Sample")).toBeInTheDocument(); // resource row renders
  expect(screen.queryByRole("button", { name: /print/i })).toBeNull();
});

test("shows a margin RAG badge in the by-period table", () => {
  // role has externalRate > internalRate so margin > 0, external > 0 → green RAG
  render(
    <ResourcesReportPanel lang="en-US" resources={resources} roles={roles}
      disciplines={disciplines} grades={grades} plan={plan} absences={[]}
      holidaySet={new Set()} workdayHours={8} />,
  );
  expect(screen.getAllByText(/^[RAG]$/).length).toBeGreaterThan(0);
});

test("keeps every sortable header distinct across the co-rendered By Period / By Discipline / By Grade / By Combo / By Resource tables", () => {
  // Fixture (one resource with a role, one discipline, one grade) populates
  // every ByGroupTable instance plus ByPeriodTable and ByResourceTable, so the
  // collision is real, not a vacuous empty-table pass.
  render(
    <ResourcesReportPanel lang="en-US" resources={resources} roles={roles}
      disciplines={disciplines} grades={grades} plan={plan} absences={[]}
      holidaySet={new Set()} workdayHours={8} />,
  );
  // Measured: the five tables + toolbar render 46 `button`-role controls in
  // this fixture (obtained by passing 9999 once and reading the actual count
  // off the throw message, per the shared helper's own doc comment).
  expectRowUniqueNames({ minControls: 46, requireCollisionSeed: false });
});

test("resource report uses a resizable ReportCard with sort buttons, a filter input, and resize handles", () => {
  const { container } = render(
    <ResourcesReportPanel lang="en-US" resources={resources} roles={roles}
      disciplines={disciplines} grades={grades} plan={plan} absences={[]}
      holidaySet={new Set()} workdayHours={8} />,
  );
  // ReportCard emits a div with both print-root AND the resize class
  expect(container.querySelector(".print-root.resize")).toBeTruthy();
  // ColumnResizeHandle emits cursor-col-resize handles
  expect(container.querySelector(".cursor-col-resize")).toBeTruthy();
  // TableFilter emits an input[type=search]
  expect(container.querySelector("input[type='search']")).toBeTruthy();
});

// ---------------------------------------------------------------------------
// §296 — the three co-rendered ByGroupTable filters
//
// By Discipline / By Grade / By Combo are the SAME component rendered three
// times, unconditionally, with no view gating between them. Each passes the
// same `placeholderKey` to `TableFilter`, which derives BOTH the input's
// aria-label AND the clear button's name from that key — so all three
// searchboxes announced one name, and (once any two held a value) so did their
// clear buttons. WCAG 2.4.6. The axe gate cannot see this in ANY view at ANY
// seed size (a name exists), so these two tests are the only detector.
//
// ★ SPLIT INTO TWO BLOCKS DELIBERATELY. Vitest aborts a block at its first
// failing hard assertion, so folding the clear-button case in after the
// searchbox case would leave the second behaviour unproved by any mutant that
// kills the first.
// ---------------------------------------------------------------------------

test("keeps the three co-rendered group filter inputs distinct", () => {
  // The searchboxes collide regardless of their values, so this case needs no
  // typing. `requireCollisionSeed` is deliberately OFF: it strips only a
  // trailing " (N)" occurrence suffix, and this surface disambiguates by
  // appending " – <section title>", so it would throw against correct code.
  render(
    <ResourcesReportPanel lang="en-US" resources={resources} roles={roles}
      disciplines={disciplines} grades={grades} plan={plan} absences={[]}
      holidaySet={new Set()} workdayHours={8} />,
  );
  // Measured, not guessed: passing 9999 once and reading the count off the
  // throw message gave 50 button+searchbox controls for this fixture.
  expectRowUniqueNames({ minControls: 50, roles: ["button", "searchbox"] });
});

test("keeps the group filters' clear buttons distinct once two of them hold a value", async () => {
  render(
    <ResourcesReportPanel lang="en-US" resources={resources} roles={roles}
      disciplines={disciplines} grades={grades} plan={plan} absences={[]}
      holidaySet={new Set()} workdayHours={8} />,
  );
  // DOM order is By Discipline, By Grade, By Combo, By Resource — the first
  // two are ByGroupTable instances sharing a placeholderKey. Indexing rather
  // than naming is deliberate: the names are what is under test.
  await userEvent.type(screen.getAllByRole("searchbox")[0], "a");
  await userEvent.type(screen.getAllByRole("searchbox")[1], "b");
  // The overlaid ✕ renders only while its field holds a value, so exactly two
  // clear buttons now exist — and before the fix they shared one name.
  expect(screen.getAllByRole("button", { name: /clear/i })).toHaveLength(2);
  // Measured the same way: 52 here — the 50 above plus the two ✕ buttons.
  expectRowUniqueNames({ minControls: 52, roles: ["button", "searchbox"] });
});
