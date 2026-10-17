// §715 E — the demo week (Monday 21 to Friday 25 September 2026) as plain data.
//
// `applyDemoWeek(master, day)` returns the master as it stands after the video's on-camera steps of
// every day up to and including `day` (spec: docs/superpowers/specs/2026-10-16-demo-week-story-design.md,
// "The week"). Only steps that move a Next-actions signal are here; an AI step applies the FIXED outcome
// the recorder's off-camera replay uses. Rows are looked up by name, and a missing one throws, so a
// master edit that renames a row fails here instead of silently skipping its step.

import * as story from "../../scripts/demo-video/week-story.mjs";

export type DemoDay = "mon" | "tue" | "wed" | "thu" | "fri";

// The names live in the recorder's `week-story.mjs`, so the video and this fixture share one copy. They
// are re-exported here as the SAME objects (`week-story.test.ts` checks identity), typed for TS callers.
export const DEMO_WEEK_DATES: Readonly<Record<DemoDay, string>> = story.DEMO_WEEK_DATES;
/** The near-duplicate follow-ups the master plants on Friday 18th; Tuesday leaves one of each pair. */
export const DEMO_DUPLICATE_PAIRS = story.DEMO_DUPLICATE_PAIRS as ReadonlyArray<readonly [string, string]>;
export const DEMO_CRM_TASK: string = story.DEMO_CRM_TASK;
export const DEMO_GDPR_ISSUE: string = story.DEMO_GDPR_ISSUE;
export const DEMO_NEW_MEMBER: Readonly<{ firstName: string; lastName: string }> = story.DEMO_NEW_MEMBER;
export const DEMO_DPO: string = story.DEMO_DPO;
export const DEMO_LICENCE_RISK: string = story.DEMO_LICENCE_RISK;
export const DEMO_MAYA_RELIEVED_HOURS: number = story.DEMO_MAYA_RELIEVED_HOURS;

const ORDER: readonly DemoDay[] = ["mon", "tue", "wed", "thu", "fri"];

type Row = { id: number } & Record<string, unknown>;
type Ws = Record<string, unknown>;

export function applyDemoWeek(raw: unknown, through: DemoDay): unknown {
  // A deep copy is edited in place below; the caller's object is never touched.
  const ws = structuredClone(raw) as Ws;
  for (const day of ORDER.slice(0, ORDER.indexOf(through) + 1)) DAYS[day](ws);
  return ws;
}

const DAYS: Record<DemoDay, (ws: Ws) => void> = {
  mon(ws) {
    Object.assign(find(ws, "tasks", "taskName", DEMO_CRM_TASK), {
      blockers: "CRM API rejects erasure calls", dueDate: "2026-09-24", lastUpdateDate: "2026-09-21",
    });
  },

  tue(ws) {
    Object.assign(find(ws, "tasks", "taskName", DEMO_CRM_TASK), { status: "In Progress", lastUpdateDate: "2026-09-22" });
    // By hand: the first task of the first pair. Deduplicate & unify: the second task of the others.
    const [first, ...rest] = DEMO_DUPLICATE_PAIRS;
    remove(ws, "tasks", "taskName", first[0]);
    for (const [, second] of rest) remove(ws, "tasks", "taskName", second);
    rows(ws, "changes").push({
      id: nextId(ws, "changes"), title: "Add a CRM provisioning connector", type: "Scope", status: "Under Review",
      raisedDate: "2026-09-22", impact: "Medium", stakeholderIds: [], linkedTaskIds: [], linkedRaidIds: [],
      description: "<p>Replace the custom CRM push with the vendor's provisioning connector.</p>",
      impactDescription: "<p>Licence cost and about one week of integration work; removes the failing custom sync.</p>",
    });
    const demo = find(ws, "tasks", "taskName", "MVP demo to the customer");
    Object.assign(demo, { dueDate: "2026-10-02", lastUpdateDate: "2026-09-22" });
    const mvp = find(ws, "milestones", "name", "MVP target");
    mvp.linkedTaskIds = (mvp.linkedTaskIds as number[]).filter((id) => id !== demo.id);
    rows(ws, "milestones").push({
      id: nextId(ws, "milestones"), name: "MVP re-demo", date: "2026-10-02", linkedTaskIds: [demo.id],
      description: "<p>The MVP demo to the customer, re-run once provisioning to the CRM works end to end.</p>",
    });
    // The re-plan import needs budget hours that no longer follow the plan (the app refuses it otherwise),
    // so Tuesday turns the switch off on camera before Import forecast. The imported hours themselves are
    // left out here, as the recorder's replay leaves them out.
    const plan = ws.plan;
    if (!plan || typeof plan !== "object") throw new Error('demo week: the master has no "plan"');
    (plan as Record<string, unknown>).budgetFollowsPlan = false;
  },

  wed(ws) {
    const disciplineId = nextId(ws, "disciplines");
    rows(ws, "disciplines").push({ id: disciplineId, name: "Integration Engineer" });
    const senior = find(ws, "grades", "name", "Senior");
    const roleId = nextId(ws, "roles");
    rows(ws, "roles").push({
      id: roleId, disciplineId, gradeId: senior.id, internalRate: 100, externalRate: 160, order: roleId,
    });
    const memberId = nextId(ws, "resources");
    rows(ws, "resources").push({
      id: memberId, ...DEMO_NEW_MEMBER, roleId, utilizationMode: "percent",
      utilization: { "2026-09": 40, "2026-10": 80 }, email: "lukas.brandt@example.com",
      company: "Northwind integration partner",
    });
    const noah = findResource(ws, "Noah", "Bennett");
    rows(ws, "absences").push({
      id: nextId(ws, "absences"), assignee: "Noah Bennett", assigneeEmail: "noah.bennett@example.com",
      startDate: "2026-09-28", endDate: "2026-10-02", type: "vacation", note: "Planned vacation",
      localModifiedAt: "", resourceId: noah.id,
    });
    // Maya is planned in hours (percent mode caps at 100 %, so it cannot over-allocate): 160 h of
    // September's 176 working hours relieves her over-allocation.
    const maya = findResource(ws, "Maya", "Patel");
    maya.utilization = { ...(maya.utilization as Record<string, number>), "2026-09": DEMO_MAYA_RELIEVED_HOURS };
    Object.assign(find(ws, "tasks", "taskName", DEMO_DUPLICATE_PAIRS[0][1]), {
      assignee: `${DEMO_NEW_MEMBER.firstName} ${DEMO_NEW_MEMBER.lastName}`, resourceId: memberId, lastUpdateDate: "2026-09-23",
    });
  },

  thu(ws) {
    Object.assign(find(ws, "raid", "title", DEMO_GDPR_ISSUE), {
      owner: "Noah Bennett", status: "In Progress", localModifiedAt: "2026-09-24T09:00:00.000Z",
    });
    rows(ws, "raid").push({
      id: nextId(ws, "raid"), category: "R", title: DEMO_LICENCE_RISK, severity: "Medium", status: "Open",
      owner: "Noah Bennett", raisedDate: "2026-09-24", linkedTaskIds: [], causedByRaidIds: [], stakeholderIds: [],
      knowledgeLinks: [], localModifiedAt: "2026-09-24T09:00:00.000Z",
    });
    const redemo = find(ws, "milestones", "name", "MVP re-demo");
    rows(ws, "stakeholders").push({
      id: nextId(ws, "stakeholders"), name: DEMO_DPO, category: "Customer", organization: "Northwind Retail Group",
      influence: "High", interest: "High", raci: { [String(redemo.id)]: "C" },
    });
    for (const c of rows(ws, "changes")) c.status = "Approved";
    rows(ws, "budgets").push({
      id: nextId(ws, "budgets"), name: "CRM connector (CR)", type: "tm", currency: "EUR",
      startDate: "2026-09-24", endDate: "2026-10-31", status: "open", allocations: [], createdDate: "2026-09-24",
    });
    const noah = findResource(ws, "Noah", "Bennett");
    for (const taskName of ["Order the connector licence", "Confirm licence delivery"]) {
      rows(ws, "tasks").push({
        id: nextId(ws, "tasks"), taskName, assignee: "Noah Bennett", assigneeEmail: "noah.bennett@example.com",
        resourceId: noah.id, status: "To Do", createdDate: "2026-09-24", startDate: "2026-09-24",
        dueDate: "2026-10-09", lastUpdateDate: "2026-09-24", priority: "High", blockers: "", dependencies: [],
        labels: [], noteLog: [],
      });
    }
    find(ws, "milestones", "name", "MVP target").date = "2026-10-01";
  },

  fri(ws) {
    Object.assign(find(ws, "tasks", "taskName", DEMO_CRM_TASK), {
      status: "Done", completedDate: "2026-09-25", blockers: "", lastUpdateDate: "2026-09-25",
    });
    Object.assign(find(ws, "raid", "title", DEMO_GDPR_ISSUE), { status: "Resolved", localModifiedAt: "2026-09-25T09:00:00.000Z" });
  },
};

function rows(ws: Ws, collection: string): Row[] {
  const list = ws[collection];
  if (!Array.isArray(list)) throw new Error(`demo week: the master has no "${collection}" list`);
  return list as Row[];
}

function find(ws: Ws, collection: string, key: string, value: string): Row {
  const row = rows(ws, collection).find((r) => r[key] === value);
  if (!row) throw new Error(`demo week: no ${collection} row with ${key} "${value}"`);
  return row;
}

function findResource(ws: Ws, firstName: string, lastName: string): Row {
  const row = rows(ws, "resources").find((r) => r.firstName === firstName && r.lastName === lastName);
  if (!row) throw new Error(`demo week: no resource "${firstName} ${lastName}"`);
  return row;
}

function remove(ws: Ws, collection: string, key: string, value: string): void {
  const doomed = find(ws, collection, key, value);
  ws[collection] = rows(ws, collection).filter((r) => r !== doomed);
}

function nextId(ws: Ws, collection: string): number {
  return rows(ws, collection).reduce((max, r) => Math.max(max, r.id), 0) + 1;
}
