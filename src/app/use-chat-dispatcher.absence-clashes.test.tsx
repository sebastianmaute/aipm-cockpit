// §773 Task 4 — the live chat dispatcher judges a date write against the project's absences and holidays,
// so `runTool` can tell the model when Claude put someone's work on a day they are away.
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { dispatcherWrapperWith, makeDispatcherArgs } from "../test/chat-dispatcher-fixture";
import { useChatDispatcher } from "./use-chat-dispatcher";
import { runTool } from "./chat-tools";
import { entityToken } from "./ai-entity-token";
import type { Absence, Milestone, Resource, Task } from "./types";

const MAYA = { id: 1, firstName: "Maya", lastName: "Patel", email: "maya@example.com" } as Resource;
// 2026-11-02 is a Monday.
const MAYA_WEEK = { id: 1, assignee: "Maya Patel", resourceId: 1, type: "vacation", startDate: "2026-11-03", endDate: "2026-11-07" } as Absence;
const TASK = {
  id: 42, taskName: "Ship the release", assignee: "Maya Patel", assigneeEmail: "maya@example.com", resourceId: 1,
  startDate: "2026-11-02", dueDate: "2026-11-12", lastUpdateDate: "2026-10-01", status: "To Do", priority: "Medium",
} as Task;
const MILESTONE = { id: 7, name: "Go-live", date: "2026-11-12", description: "", linkedTaskIds: [42] } as Milestone;
const ON_ABSENCE = { person: "Maya Patel", reason: "date-on-absence", date: "2026-11-05", ranges: [{ start: "2026-11-03", end: "2026-11-07" }] };

function render(holidaySet: ReadonlySet<string> = new Set()) {
  return renderHook(() => useChatDispatcher(makeDispatcherArgs({ holidaySet })), {
    wrapper: dispatcherWrapperWith({ tasks: [TASK], resources: [MAYA], absences: [MAYA_WEEK], milestones: [MILESTONE] }),
  });
}

async function run(d: ReturnType<typeof useChatDispatcher>, name: string, input: Record<string, unknown>) {
  let out: unknown;
  await act(async () => { out = await runTool(d, name, input); });
  return out as Record<string, unknown>;
}

describe("useChatDispatcher — absence clashes in the tool results (§773)", () => {
  it("update_task moving the due date onto the owner's absence writes it and reports the clash", async () => {
    const { result } = render();
    const out = await run(result.current, "update_task", { id: 42, expectedToken: entityToken("task", result.current.getTask(42)!), dueDate: "2026-11-05" });
    expect(result.current.getTask(42)?.dueDate).toBe("2026-11-05");
    expect(out.absenceClashes).toEqual([ON_ABSENCE]);
  });

  it("update_task moving the due date off the absence reports nothing", async () => {
    const { result } = render();
    const out = await run(result.current, "update_task", { id: 42, expectedToken: entityToken("task", result.current.getTask(42)!), dueDate: "2026-11-13" });
    expect("absenceClashes" in out).toBe(false);
  });

  it("create_task due on the owner's absence reports the clash", async () => {
    const { result } = render();
    const out = await run(result.current, "create_task", { taskName: "Draft", assignee: "Maya Patel", dueDate: "2026-11-05" });
    expect(out.absenceClashes).toEqual([ON_ABSENCE]);
  });

  it("update_milestone moving the date onto a linked owner's absence reports the clash", async () => {
    const { result } = render();
    const row = result.current.getMilestoneRow(7)!;
    const out = await run(result.current, "update_milestone", { id: 7, expectedToken: entityToken("milestone", row), date: "2026-11-05" });
    expect(out.absenceClashes).toEqual([ON_ABSENCE]);
  });

  it("create_milestone linked to a task whose owner is away on its date reports the clash", async () => {
    const { result } = render();
    const out = await run(result.current, "create_milestone", { name: "Beta", date: "2026-11-05", linkedTaskIds: [42] });
    expect(out.absenceClashes).toEqual([ON_ABSENCE]);
  });

  it("reads the holiday set: the span rule counts working days only", async () => {
    // Stored start Mon 2 Nov, due moved to Fri 13 Nov: 10 working days, Maya away on 4 (3–6 Nov) — not more
    // than half. With 10–12 Nov as holidays the span has 7 working days, so 4 of them is more than half.
    const plain = render();
    const off = await run(plain.result.current, "update_task", { id: 42, expectedToken: entityToken("task", plain.result.current.getTask(42)!), dueDate: "2026-11-13" });
    expect("absenceClashes" in off).toBe(false);
    const holidays = render(new Set(["2026-11-10", "2026-11-11", "2026-11-12"]));
    const on = await run(holidays.result.current, "update_task", { id: 42, expectedToken: entityToken("task", holidays.result.current.getTask(42)!), dueDate: "2026-11-13" });
    expect(on.absenceClashes).toEqual([{ person: "Maya Patel", reason: "absent-most-of-span", ranges: [{ start: "2026-11-03", end: "2026-11-07" }] }]);
  });
});
