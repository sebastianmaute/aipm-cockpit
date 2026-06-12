import { describe, expect, it } from "vitest";
import { BUILT_IN_TEMPLATES } from "./templates-builtin";
import { applyTemplate } from "./template-apply";
import { sanitizeTemplates } from "./templates";
import { emptyWorkspace } from "./workspace";

describe("templates integration", () => {
  it("every built-in applies cleanly with seed (no id collisions, no dangling internal refs)", () => {
    for (const tpl of BUILT_IN_TEMPLATES) {
      const ws = applyTemplate(emptyWorkspace(), tpl, { includeSeed: true });
      expect(ws.fieldVisibility, tpl.id).toBeDefined();
      // task id uniqueness
      const taskIds = ws.tasks.map((t) => t.id);
      expect(new Set(taskIds).size, `${tpl.id} task id collision`).toBe(taskIds.length);
      // task dependencies point at appended tasks
      for (const t of ws.tasks) for (const d of t.dependencies ?? []) {
        expect(taskIds, `${tpl.id} dangling dep`).toContain(d.taskId);
      }
      // milestone.linkedTaskIds point at appended tasks
      for (const m of ws.milestones ?? []) for (const id of m.linkedTaskIds ?? []) {
        expect(taskIds, `${tpl.id} dangling milestone link`).toContain(id);
      }
      // raid.linkedTaskIds point at appended tasks
      for (const r of ws.raid) for (const id of r.linkedTaskIds ?? []) {
        expect(taskIds, `${tpl.id} dangling raid link`).toContain(id);
      }
    }
  });
  it("includeSeed:false only sets field-visibility (no content added)", () => {
    const tpl = BUILT_IN_TEMPLATES.find((x) => x.id === "builtin-full")!;
    const ws = applyTemplate(emptyWorkspace(), tpl, { includeSeed: false });
    expect(ws.fieldVisibility).toBeDefined();
    expect(ws.tasks).toHaveLength(0);
    expect(ws.raid).toHaveLength(0);
  });
  it("built-ins survive a sanitize round-trip without loss", () => {
    expect(sanitizeTemplates(BUILT_IN_TEMPLATES)).toHaveLength(3);
  });
});
