import { beforeEach, describe, expect, it } from "vitest";
import { applyTemplate } from "./template-apply";
import { __resetMintStateForTests } from "./id-mint-session";
import { emptyWorkspace } from "./workspace";
import { BUILT_IN_TEMPLATES } from "./templates-builtin";
import type { ProjectTemplate, TemplateSeed } from "./templates";
import type { Milestone, Task } from "./types";

function mkTask(id: number, extra: Partial<Task> = {}): Task {
  return {
    id,
    taskName: `T${id}`,
    assignee: "",
    assigneeEmail: "",
    dueDate: "",
    lastUpdateDate: "",
    status: "To Do",
    priority: "Medium",
    blockers: "",
    description: "",
    ...extra,
  };
}
const ms = (id: number, date: string): Milestone => ({ id, name: `M${id}`, date, linkedTaskIds: [] });
function tpl(seed: TemplateSeed): ProjectTemplate {
  return { id: "t", name: "T", features: [], fieldVisibility: {}, seed };
}

beforeEach(() => __resetMintStateForTests());

describe("applyTemplate — a seed's dates follow the day it is applied", () => {
  it("moves the first of the earliest date's month to today and keeps every gap", () => {
    // Earliest date 2026-01-31 → its month starts 2026-01-01, which becomes 2026-10-25 (+297 days).
    const seed = { milestones: [ms(1, "2026-01-31"), ms(2, "2026-03-31")], tasks: [mkTask(1, { startDate: "2026-02-02", dueDate: "2026-02-20" })] };
    const ws = applyTemplate(emptyWorkspace(), tpl(seed), { includeSeed: true, today: "2026-10-25" });
    expect(ws.milestones?.map((m) => m.date)).toEqual(["2026-11-24", "2027-01-22"]);
    expect(ws.tasks[0].startDate).toBe("2026-11-26");
    expect(ws.tasks[0].dueDate).toBe("2026-12-14");
  });

  it("finds the earliest date among task dates too, not only milestones", () => {
    const seed = { milestones: [ms(1, "2026-05-10")], tasks: [mkTask(1, { dueDate: "2026-04-15" })] };
    const ws = applyTemplate(emptyWorkspace(), tpl(seed), { includeSeed: true, today: "2026-10-01" });
    // 2026-04-01 → 2026-10-01 is +183 days.
    expect(ws.tasks[0].dueDate).toBe("2026-10-15");
    expect(ws.milestones?.[0].date).toBe("2026-11-09");
  });

  it("moves dates back as well when the template was saved in the future", () => {
    const seed = { milestones: [ms(1, "2027-03-10")] };
    const ws = applyTemplate(emptyWorkspace(), tpl(seed), { includeSeed: true, today: "2026-10-25" });
    expect(ws.milestones?.[0].date).toBe("2026-11-03");
  });

  it("leaves a blank date blank", () => {
    const seed = { milestones: [ms(1, "2026-01-31")], tasks: [mkTask(1)] };
    const ws = applyTemplate(emptyWorkspace(), tpl(seed), { includeSeed: true, today: "2026-10-25" });
    expect(ws.tasks[0].dueDate).toBe("");
    expect(ws.tasks[0].startDate ?? "").toBe("");
  });

  it("keeps the dates as stored when no day is given", () => {
    const seed = { milestones: [ms(1, "2026-01-31")] };
    const ws = applyTemplate(emptyWorkspace(), tpl(seed), { includeSeed: true });
    expect(ws.milestones?.[0].date).toBe("2026-01-31");
  });

  it("puts no built-in template's dates in the past", () => {
    const today = "2026-10-25";
    for (const t of BUILT_IN_TEMPLATES) {
      __resetMintStateForTests();
      const ws = applyTemplate(emptyWorkspace(), t, { includeSeed: true, today });
      const dates = [
        ...(ws.milestones ?? []).map((m) => m.date),
        ...ws.tasks.flatMap((x) => [x.startDate ?? "", x.dueDate]),
      ].filter(Boolean);
      for (const d of dates) expect(d >= today, `${t.id}: ${d}`).toBe(true);
    }
  });

  it("dates every built-in milestone that carries one (the check above sees real dates)", () => {
    const dated = BUILT_IN_TEMPLATES.flatMap((t) => t.seed?.milestones ?? []).filter((m) => m.date);
    expect(dated.length).toBeGreaterThan(0);
  });
});
