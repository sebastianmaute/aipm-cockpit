// §715 E — the demo week's on-camera steps as a data fixture.
import { describe, expect, it } from "vitest";
import { applyDemoWeek, DEMO_DUPLICATE_PAIRS, DEMO_MAYA_RELIEVED_HOURS, DEMO_WEEK_DATES } from "./demo-week";

interface Row { id: number; [k: string]: unknown }
interface Raw {
  tasks: Row[]; milestones: Row[]; changes: Row[]; raid: Row[]; stakeholders: Row[];
  resources: Row[]; roles: Row[]; disciplines: Row[]; grades: Row[]; absences: Row[]; budgets: Row[];
}

const task = (id: number, taskName: string, over: Partial<Row> = {}): Row => ({
  id, taskName, assignee: "Noah Bennett", resourceId: 2, status: "To Do", dueDate: "2026-10-30",
  lastUpdateDate: "2026-09-18", blockers: "", dependencies: [], noteLog: [], ...over,
});

function tinyRaw(): Raw {
  const pairs = DEMO_DUPLICATE_PAIRS.flat().map((n, i) => task(40 + i, n));
  return {
    tasks: [
      task(24, "Customer registration flow", { status: "Done", completedDate: "2026-08-12" }),
      task(25, "MVP demo to the customer", { dueDate: "2026-09-18" }),
      task(36, "Integrate CRM provisioning", { dueDate: "2026-09-16" }),
      ...pairs,
    ],
    milestones: [{ id: 5, name: "MVP target", date: "2026-09-18", linkedTaskIds: [24, 25, 36] }],
    changes: [{ id: 1, title: "Add MFA to SSO scope", status: "Under Review", impact: "High", stakeholderIds: [1] }],
    raid: [{ id: 15, title: "GDPR erasure requests do not reach the CRM", category: "I", severity: "High", status: "Open" }],
    stakeholders: [{ id: 1, name: "Elena Fischer", influence: "High", interest: "High", raci: {} }],
    resources: [
      { id: 2, firstName: "Noah", lastName: "Bennett", roleId: 1, utilization: {} },
      { id: 4, firstName: "Maya", lastName: "Patel", roleId: 1, utilizationMode: "hours", utilization: { "2026-09": 240 } },
    ],
    roles: [{ id: 1, disciplineId: 1, gradeId: 4, internalRate: 95, externalRate: 145 }],
    disciplines: [{ id: 1, name: "Developer" }],
    grades: [{ id: 4, name: "Senior" }],
    absences: [],
    budgets: [{ id: 1, name: "Identity Platform – T&M", type: "tm", startDate: "2026-07-01", endDate: "2026-10-31" }],
  };
}

const byName = (rows: Row[], key: string, name: string) => rows.find((r) => r[key] === name);

describe("applyDemoWeek", () => {
  it("does not mutate its input", () => {
    const raw = tinyRaw();
    const before = structuredClone(raw);
    applyDemoWeek(raw, "fri");
    expect(raw).toEqual(before);
  });

  it("applies the days in order", () => {
    const mon = applyDemoWeek(tinyRaw(), "mon") as Raw;
    expect(byName(mon.tasks, "taskName", "Integrate CRM provisioning")).toMatchObject({
      blockers: "CRM API rejects erasure calls", dueDate: "2026-09-24", status: "To Do",
    });
    expect(byName(mon.milestones, "name", "MVP re-demo")).toBeUndefined();

    const fri = applyDemoWeek(tinyRaw(), "fri") as Raw;
    const redemo = byName(fri.milestones, "name", "MVP re-demo");
    expect(redemo).toMatchObject({ date: "2026-10-02", linkedTaskIds: [25] });
    expect(byName(fri.milestones, "name", "MVP target")).toMatchObject({ date: "2026-10-01", linkedTaskIds: [24, 36] });
    expect(byName(fri.tasks, "taskName", "Integrate CRM provisioning")).toMatchObject({ status: "Done", completedDate: "2026-09-25" });
    expect(byName(fri.tasks, "taskName", "MVP demo to the customer")).toMatchObject({ dueDate: "2026-10-02" });
    const dpo = fri.stakeholders.find((s) => String(s.name).includes("DPO"));
    expect(dpo).toMatchObject({ influence: "High", interest: "High", raci: { [String(redemo!.id)]: "C" } });
    expect(fri.changes.every((c) => c.status === "Approved")).toBe(true);
    expect(byName(fri.raid, "title", "GDPR erasure requests do not reach the CRM")).toMatchObject({ status: "Resolved", owner: "Noah Bennett" });
    expect(byName(fri.raid, "title", "connector licence lead time")).toMatchObject({ severity: "Medium", status: "Open" });
    expect(fri.resources.find((r) => r.id === 4)!.utilization).toMatchObject({ "2026-09": DEMO_MAYA_RELIEVED_HOURS });
  });

  it("leaves one task of each duplicate pair after Tuesday", () => {
    const tue = applyDemoWeek(tinyRaw(), "tue") as Raw;
    for (const pair of DEMO_DUPLICATE_PAIRS) {
      expect(pair.filter((n) => byName(tue.tasks, "taskName", n))).toHaveLength(1);
    }
  });

  it("adds the week's people on Wednesday", () => {
    const wed = applyDemoWeek(tinyRaw(), "wed") as Raw;
    const discipline = byName(wed.disciplines, "name", "Integration Engineer")!;
    const role = wed.roles.find((r) => r.disciplineId === discipline.id && r.gradeId === 4)!;
    expect(role).toMatchObject({ internalRate: expect.any(Number), externalRate: expect.any(Number) });
    const member = wed.resources.find((r) => r.roleId === role.id)!;
    expect(member).toBeDefined();
    expect(wed.tasks.some((t) => t.resourceId === member.id)).toBe(true);
    expect(wed.absences.find((a) => a.resourceId === 2)).toMatchObject({ startDate: "2026-09-28", endDate: "2026-10-02", type: "vacation" });
  });

  it("keeps status and completedDate paired on every task it touches", () => {
    for (const day of Object.keys(DEMO_WEEK_DATES) as (keyof typeof DEMO_WEEK_DATES)[]) {
      const out = applyDemoWeek(tinyRaw(), day) as Raw;
      for (const t of out.tasks) expect(t.status === "Done", `task ${t.id} on ${day}`).toBe(!!t.completedDate);
    }
  });

  it("names a missing row instead of skipping its step", () => {
    const raw = tinyRaw();
    raw.tasks = raw.tasks.filter((t) => t.taskName !== "Integrate CRM provisioning");
    expect(() => applyDemoWeek(raw, "mon")).toThrow(/Integrate CRM provisioning/);
  });
});
