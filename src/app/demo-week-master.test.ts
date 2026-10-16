// §715 E — the reworked demo master: its integrity, what it leaves to the video, and the week's material.
// Spec: docs/superpowers/specs/2026-10-16-demo-week-story-design.md.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildDemoWorkspace } from "./demo-workspace";
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
    expect(missing).toEqual([]);
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
