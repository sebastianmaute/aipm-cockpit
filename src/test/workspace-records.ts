// Test-only fixture builders for the Workspace kind:"list" slices exercised by
// version-restore.test.ts's array-as-object guard. Kept in src/test/ (already
// excluded from the coverage floor -- see vitest.config.ts coverage.exclude)
// so a fixture module never counts against the ratchet.
//
// ★★★ NO CASTS. The first cut of the five slices below (before they lived
// here) used `as never` on all five and thereby encoded five wrong facts tsc
// could not see: string ids where ProjectDocument/DocVersion take `number`,
// `capturedAt` for `savedAt`, missing `title`/`source`/`op`, a `date` field
// CalendarEvent lacks, and an InsightType/InsightStatus pair that are members
// of neither union. If a record does not typecheck, the record is wrong --
// fix the record by reading src/app/types.ts, never silence it with a cast.
import type { Absence, BudgetBucket, ChangeItem, Discipline, Grade, Milestone,
  RaidItem, Resource, Role, Shift, Stakeholder, Task } from "../app/types";
import type { KnowledgeItem } from "../app/document-link";
import type { Insight, InsightSeverity } from "../app/insights/insight";
import type { ProjectDocument } from "../app/document-model";
import type { DocVersion } from "../app/document-versions";
import type { CalendarEvent } from "../app/calendar-event";
import type { Workspace } from "../app/workspace";

/** Which of the two workspaces a record is being built for. Most builders take
 *  this as a free-form label they render into a name field; `roleRec` uses it as
 *  a branch selector and so requires exactly these two — see its docstring. */
export type FixtureSide = "Old" | "New";

export const kItem = (id: string, name: string): KnowledgeItem =>
  ({ id, name, url: `https://example.com/${id}`, kind: "file" });

export const insight = (id: number, severity: InsightSeverity): Insight =>
  ({
    id, key: `k${id}`, type: "overdueTrend", severity, data: {}, status: "active",
    firstSeenAt: "2026-01-01", lastSeenAt: "2026-01-02", occurrences: 1,
  });

export const doc = (id: number, title: string): ProjectDocument =>
  ({ id, title, blocks: [], createdAt: "2026-01-01", updatedAt: "2026-01-02" });

export const docVersion = (id: number, title: string): DocVersion =>
  ({ id, documentId: 1, title, blocks: [], savedAt: "2026-01-01", source: "user", op: "update" });

export const calEvent = (id: number, title: string): CalendarEvent =>
  ({ id, title, startDate: "2026-01-01", startTime: "09:00", durationMinutes: 60 });

export const taskRec = (id: number, n: string): Task =>
  ({ id, taskName: `Task ${n}`, assignee: "Ann", assigneeEmail: "ann@example.com",
     dueDate: "2026-02-01", lastUpdateDate: "2026-01-15", priority: "Low",
     status: "To Do", blockers: "", description: "" });

export const raidRec = (id: number, n: string): RaidItem =>
  ({ id, category: "R", title: `Risk ${n}`, status: "Open", linkedTaskIds: [],
     raisedDate: "2026-01-01", causedByRaidIds: [], stakeholderIds: [] });

export const changeRec = (id: number, n: string): ChangeItem =>
  ({ id, title: `Change ${n}`, description: "", type: "Scope", status: "Proposed",
     raisedDate: "2026-01-01", linkedTaskIds: [], linkedRaidIds: [], stakeholderIds: [] });

export const milestoneRec = (id: number, n: string): Milestone =>
  ({ id, name: `Milestone ${n}`, date: "2026-03-01", linkedTaskIds: [] });

export const stakeholderRec = (id: number, n: string): Stakeholder =>
  ({ id, name: `Stakeholder ${n}`, category: "Internal", influence: "Low",
     interest: "Low", raci: {} });

export const resourceRec = (id: number, n: string): Resource =>
  ({ id, firstName: `Res${n}`, lastName: "Example", roleId: 1,
     utilizationMode: "percent", utilization: {} });

/** ★★ `n` IS NARROWED HERE AND NOWHERE ELSE, deliberately. `Role` carries no
 *  name field — it is discipline x grade — so this is the one builder whose `n`
 *  cannot show up in its output as a label. It selects a BRANCH instead
 *  (`internalRate`), which means a caller following every sibling's convention
 *  and passing a descriptive string (`roleRec(1, "Dev")`) would silently get the
 *  NEW-side fixture with nothing in the record to reveal it. The union makes that
 *  a type error. `insight` takes a real `InsightSeverity` for the same reason and
 *  lets `arraysFixture` do the mapping; this one keeps the uniform `(id, n)`
 *  shape that fixture needs, so it pays for it with the narrower type. */
export const roleRec = (id: number, n: FixtureSide): Role =>
  ({ id, disciplineId: 1, gradeId: 1, internalRate: n === "Old" ? 100 : 110, externalRate: 200 });

export const disciplineRec = (id: number, n: string): Discipline => ({ id, name: `Discipline ${n}` });

export const gradeRec = (id: number, n: string): Grade => ({ id, name: `Grade ${n}` });

export const budgetRec = (id: number, n: string): BudgetBucket =>
  ({ id, name: `Bucket ${n}`, type: "tm", currency: "EUR", startDate: "2026-01-01",
     endDate: "2026-06-30", status: "open", allocations: [] });

export const absenceRec = (id: number, n: string): Absence =>
  ({ id, assignee: "Ann", startDate: "2026-04-01", endDate: "2026-04-05",
     type: "vacation", note: `Absence ${n}` });

export const shiftRec = (id: number, n: string): Shift =>
  ({ id, assignee: "Ann", hoursPerWeekday: [0, 8, 8, 8, 8, 8, 0], note: `Shift ${n}` });

/** The base `Workspace` the version-diff and version-restore suites build every
 *  fixture on: every list slice empty, the two required singletons stubbed, and
 *  `over` spread last. ★ It lived as a LOCAL copy in each of those two files —
 *  identical modulo whitespace and one trailing comma — on the stated grounds
 *  that the two suites needed different bases. They did not. */
export const ws = (over: Partial<Workspace>): Workspace =>
  ({ tasks: [], raid: [], absences: [], shifts: [], resources: [], roles: [],
    disciplines: [], grades: [], plan: {} as never, budgets: [], milestones: [],
    changes: [], stakeholders: [], status: {} as never, ...over } as Workspace);

// ★ Old and New must DIFFER in every slice. An identical record produces no
// diff change; applyRestore's singleton branch bails when the diff carries
// no change for a spec, so the slice is never walked, never corrupted, and
// invisible to the assertion -- reproducing the exact hole this closes.
export const arraysFixture = (n: FixtureSide): Partial<Workspace> => ({
  tasks: [taskRec(1, n)],
  raid: [raidRec(1, n)],
  changes: [changeRec(1, n)],
  milestones: [milestoneRec(1, n)],
  stakeholders: [stakeholderRec(1, n)],
  resources: [resourceRec(1, n)],
  roles: [roleRec(1, n)],
  disciplines: [disciplineRec(1, n)],
  grades: [gradeRec(1, n)],
  budgets: [budgetRec(1, n)],
  absences: [absenceRec(1, n)],
  shifts: [shiftRec(1, n)],
  knowledgeItems: [kItem("a", n)],
  insights: [insight(1, n === "Old" ? "low" : "high")],
  documents: [doc(1, n)],
  documentVersions: [docVersion(1, n)],
  calendarEvents: [calEvent(1, n)],
});
