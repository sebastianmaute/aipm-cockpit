// §715 E — the harness that runs the demo through the Next-actions pipeline.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { demoActionGroups, rowSignature } from "./demo-next-actions";

const master = JSON.parse(readFileSync(join(import.meta.dirname, "..", "..", "sample-workspace-small.json"), "utf8"));

describe("demoActionGroups", () => {
  it("puts an overdue milestone first as a now row", () => {
    const raw = {
      ...master,
      tasks: [], raid: [], changes: [], stakeholders: [],
      milestones: [{ id: 5, name: "MVP target", date: "2026-09-18", linkedTaskIds: [] }],
    };
    const groups = demoActionGroups(raw, "2026-09-21");
    expect(rowSignature(groups[0])).toMatch(/^now milestone milestones:5\b/);
  });

  it("merges two signals on one task into one row", () => {
    const tasks = master.tasks.map((t: { id: number }) =>
      t.id === 25
        ? { ...t, status: "To Do", completedDate: undefined, dueDate: "2026-09-18", dependencies: [{ taskId: 4, type: "FS" }] }
        : t,
    );
    const groups = demoActionGroups({ ...master, tasks }, "2026-09-21");
    const row = groups.filter((g) => g.key === "open-points:25");
    expect(row).toHaveLength(1);
    expect(row[0].primary.id).toBe("task-due:25:overdue");
    expect(rowSignature(row[0])).toContain("task-attention:25:dep-blocked");
  });
});

describe("rowSignature", () => {
  it("lists no extras for a single-signal row", () => {
    const groups = demoActionGroups(master, "2026-09-21");
    const single = groups.find((g) => g.extra.length === 0)!;
    expect(rowSignature(single)).toBe(`${single.tier} ${single.primary.source} ${single.key}`);
  });
});
