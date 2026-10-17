// §715 E — the reworked demo master: its integrity, what it leaves to the video, and the week's material.
// Spec: docs/superpowers/specs/2026-10-16-demo-week-story-design.md.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { partitionUpcoming } from "./dashboard";
import { buildDemoWorkspace, DEMO_AS_OF } from "./demo-workspace";
import { computeAppForecast, toHistoryEntry } from "./forecast/app-forecast";
import { detectInsights } from "./insights/detect";
import { jsonToWorkspace } from "./workspace";
import { demoActionGroups } from "../test/demo-next-actions";
import {
  applyDemoWeek, DEMO_CRM_TASK, DEMO_DPO, DEMO_DUPLICATE_PAIRS, DEMO_LICENCE_RISK, DEMO_NEW_MEMBER, DEMO_WEEK_DATES,
} from "../test/demo-week";

const master = JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "sample-workspace-small.json"), "utf8"));
const ws = jsonToWorkspace(JSON.stringify(master), { strict: true });

describe("the demo master (§715)", () => {
  it("every reference in the master resolves", () => {
    const taskIds = new Set(ws.tasks.map((t) => t.id));
    const stakeholderIds = new Set((ws.stakeholders ?? []).map((s) => s.id));
    const resourceIds = new Set(ws.resources.map((r) => r.id));
    const missing: string[] = [];
    const need = (ok: boolean, what: string) => { if (!ok) missing.push(what); };
    for (const m of ws.milestones ?? []) for (const id of m.linkedTaskIds ?? []) need(taskIds.has(id), `milestone ${m.id} → task ${id}`);
    for (const t of ws.tasks) for (const d of t.dependencies ?? []) need(taskIds.has(d.taskId), `task ${t.id} → task ${d.taskId}`);
    for (const r of ws.raid) for (const id of r.stakeholderIds ?? []) need(stakeholderIds.has(id), `raid ${r.id} → stakeholder ${id}`);
    for (const c of ws.changes ?? []) for (const id of c.stakeholderIds ?? []) need(stakeholderIds.has(id), `change ${c.id} → stakeholder ${id}`);
    for (const s of ws.stakeholders ?? []) if (s.resourceId != null) need(resourceIds.has(s.resourceId), `stakeholder ${s.id} → resource ${s.resourceId}`);
    for (const b of ws.budgets ?? []) for (const id of b.taskIds ?? []) need(taskIds.has(id), `bucket ${b.id} → task ${id}`);
    for (const a of ws.absences) if (a.resourceId != null) need(resourceIds.has(a.resourceId), `absence ${a.id} → resource ${a.resourceId}`);
    const raidIds = new Set(ws.raid.map((r) => r.id));
    const milestoneIds = new Set((ws.milestones ?? []).map((m) => String(m.id)));
    const roleIds = new Set(ws.roles.map((r) => r.id));
    const disciplineIds = new Set((ws.disciplines ?? []).map((d) => d.id));
    const gradeIds = new Set((ws.grades ?? []).map((g) => g.id));
    for (const t of ws.tasks) if (t.resourceId != null) need(resourceIds.has(t.resourceId), `task ${t.id} → resource ${t.resourceId}`);
    for (const r of ws.raid) {
      for (const id of r.linkedTaskIds ?? []) need(taskIds.has(id), `raid ${r.id} → task ${id}`);
      for (const id of r.causedByRaidIds ?? []) need(raidIds.has(id), `raid ${r.id} → raid ${id}`);
    }
    for (const c of ws.changes ?? []) {
      for (const id of c.linkedTaskIds ?? []) need(taskIds.has(id), `change ${c.id} → task ${id}`);
      for (const id of c.linkedRaidIds ?? []) need(raidIds.has(id), `change ${c.id} → raid ${id}`);
    }
    for (const k of ws.knowledgeItems ?? []) for (const id of k.taskIds ?? []) need(taskIds.has(id), `knowledge ${k.id} → task ${id}`);
    for (const s of ws.stakeholders ?? []) for (const key of Object.keys(s.raci ?? {})) need(milestoneIds.has(key), `stakeholder ${s.id} → milestone ${key}`);
    for (const id of ws.steeringCommittee?.memberResourceIds ?? []) need(resourceIds.has(id), `steering → resource ${id}`);
    for (const r of ws.resources) if (r.roleId != null) need(roleIds.has(r.roleId), `resource ${r.id} → role ${r.roleId}`);
    for (const r of ws.roles) {
      need(disciplineIds.has(r.disciplineId), `role ${r.id} → discipline ${r.disciplineId}`);
      need(gradeIds.has(r.gradeId), `role ${r.id} → grade ${r.gradeId}`);
    }
    for (const b of ws.budgets ?? []) for (const a of b.allocations ?? []) for (const id of a.resourceIds ?? []) need(resourceIds.has(id), `bucket ${b.id} → resource ${id}`);
    expect(missing).toEqual([]);
  });

  // The recorder writes one entry a day from the live engine, so the master's last entry must be what the engine
  // says on the day the master is authored as of; otherwise the Forecast tile's weekly change reports a jump no
  // recorded day explains.
  it("ends its forecast history on what the engine forecasts on DEMO_AS_OF", () => {
    const demo = buildDemoWorkspace(master, DEMO_AS_OF);
    const live = toHistoryEntry(computeAppForecast({
      tasks: demo.tasks, milestones: demo.milestones ?? [], planEnd: demo.plan.endDate, today: DEMO_AS_OF, holidaySet: new Set<string>(),
    }), DEMO_AS_OF);
    expect(live).not.toBeNull();
    expect(ws.forecastHistory?.at(-1)).toEqual(live);
  });

  // An overdueTrend insight stays visible while a device has no landing snapshot, so a curated one must not
  // claim more overdue tasks than the master has.
  it("curates no overdue trend the data contradicts", () => {
    const overdue = partitionUpcoming(ws.tasks, DEMO_AS_OF, new Set<string>()).overdue.length;
    const claims = (ws.insights ?? []).filter((i) => i.type === "overdueTrend" && i.status === "active")
      .map((i) => (i.data as { current?: number }).current);
    expect(claims.filter((c) => c !== overdue)).toEqual([]);
  });

  it("leaves the week's additions to the video", () => {
    const names = (rows: readonly object[], key: string) => rows.map((r) => String((r as Record<string, unknown>)[key]));
    expect(names(ws.disciplines ?? [], "name")).not.toContain("Integration Engineer");
    expect(ws.resources.some((r) => r.firstName === DEMO_NEW_MEMBER.firstName && r.lastName === DEMO_NEW_MEMBER.lastName)).toBe(false);
    expect(names(ws.stakeholders ?? [], "name").filter((n) => /DPO|data protection/i.test(n))).toEqual([]);
    expect(names(ws.stakeholders ?? [], "name")).not.toContain(DEMO_DPO);
    expect(names(ws.milestones ?? [], "name")).not.toContain("MVP re-demo");
    expect(names(ws.changes ?? [], "title")).not.toContain("Add a CRM provisioning connector");
    expect(names(ws.budgets ?? [], "name")).not.toContain("CRM connector (CR)");
    expect(names(ws.tasks, "taskName")).not.toContain("Order the connector licence");
    expect(names(ws.tasks, "taskName")).not.toContain("Confirm licence delivery");
    expect(names(ws.raid, "title")).not.toContain(DEMO_LICENCE_RISK);
    expect(ws.tasks.find((t) => t.taskName === DEMO_CRM_TASK)?.blockers).toBe("");
    expect(ws.absences.filter((a) => a.assignee === "Noah Bennett" && a.startDate === "2026-09-28")).toEqual([]);
    expect(names(ws.grades ?? [], "name")).toContain("Senior");
  });

  it("still builds a coherent demo on other days", () => {
    for (const today of ["2026-09-21", "2026-10-05", "2026-11-02", "2027-01-15"]) {
      const demo = buildDemoWorkspace(master, today);
      for (const t of demo.tasks) expect(t.status === "Done", `task ${t.id} at ${today}`).toBe(!!t.completedDate);
      expect(demoActionGroups(master, today).some((g) => g.tier !== "monitor"), `a hero at ${today}`).toBe(true);
    }
  });

  it("keeps the activity log on the story: the MVP was never delivered", () => {
    const log = ws.activityLog ?? [];
    const demoTask = ws.tasks.find((t) => t.taskName === "MVP demo to the customer")!;
    expect(log.filter((e) => e.kind === "task.completed" && e.args[0] === demoTask.id)).toEqual([]);
    expect(log.filter((e) => e.kind === "milestone.updated" && e.args[0] === 5
      && (e.changes ?? []).some((c) => c.field === "achievedDate" && c.to !== ""))).toEqual([]);
  });

  it("moves Maya's offsite out of the week rather than dropping it", () => {
    const offsite = ws.absences.find((a) => a.note === "Offsite leadership summit");
    expect(offsite).toBeDefined();
    expect(offsite!.endDate < DEMO_WEEK_DATES.mon || offsite!.startDate > DEMO_WEEK_DATES.fri).toBe(true);
  });

  it("holds the week's material", () => {
    for (const pair of DEMO_DUPLICATE_PAIRS) {
      const rows = pair.map((n) => ws.tasks.find((t) => t.taskName === n));
      expect(rows.every((t) => t !== undefined), pair.join(" / ")).toBe(true);
      expect(new Set(rows.map((t) => t!.assignee)).size, `${pair[0]}: two different people`).toBe(2);
    }
    expect((ws.knowledgeItems ?? []).some((k) => /CRM/.test(k.name))).toBe(true);
  });

  // A milestone-slip insight fires only while a milestone is overdue, so it is Monday's (the MVP target);
  // by Friday the target sits on 1 October. Friday's "Generate recommendation" acts on the budget variance.
  const insightTypes = (raw: unknown, today: string) => {
    const w = jsonToWorkspace(JSON.stringify(raw), { strict: true });
    return detectInsights({
      tasks: w.tasks, milestones: w.milestones ?? [], raid: w.raid, budgets: w.budgets ?? [], roles: w.roles,
      resources: w.resources, plan: w.plan, priorOverdueCount: null, timelogViolations: null, holidaySet: new Set<string>(),
    }, today).map((d) => d.type);
  };

  it("raises the MVP slip as an insight on Monday", () => {
    expect(insightTypes(master, DEMO_WEEK_DATES.mon)).toContain("milestoneSlip");
  });

  it("leaves an insight to act on for Friday", () => {
    expect(insightTypes(applyDemoWeek(master, "fri"), DEMO_WEEK_DATES.fri)).toContain("budgetVariance");
  });
});
