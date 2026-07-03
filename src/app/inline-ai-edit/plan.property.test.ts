// src/app/inline-ai-edit/plan.property.test.ts
import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { describeToolCalls, isEmptyPlan } from "./plan";
import { type Workspace } from "../workspace";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const task = { id: 1, taskName: "T", status: "To Do", priority: "Medium", dueDate: "2026-01-01" } as any;
const ws = { tasks: [task], raid: [], milestones: [], changes: [], stakeholders: [] } as unknown as Workspace;

describe("describeToolCalls (property)", () => {
  it("never throws and produces a coherent plan for arbitrary blocks", () => {
    fc.assert(fc.property(
      fc.array(fc.record({
        type: fc.constant("tool_use"),
        name: fc.oneof(fc.constantFrom("update_task", "create_raid_item", "delete_task", "list_tasks", "bogus"), fc.string()),
        input: fc.object(),
      })),
      (blocks) => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const plan = describeToolCalls(blocks as any, { task, ws });
        expect(plan.creates.every((c) => typeof c.toolName === "string")).toBe(true);
        expect(typeof isEmptyPlan(plan)).toBe("boolean");
      },
    ), { numRuns: 200 });
  });
});
