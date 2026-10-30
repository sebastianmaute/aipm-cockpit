// AI people protection, Task 6 (spec R4): the executor strips person fields from every write it serves
// under protection, applies the rest, and tells the model which fields were dropped. Protection off, the
// same calls apply unchanged (positive control).
import { describe, it, expect, vi } from "vitest";
import { runTool, type ToolDispatcher } from "./chat-tools";
import { entityToken } from "./ai-entity-token";
import { PERSON_FIELDS_NOTE_KEY, PERSON_FIELDS_REMOVED_NOTE } from "./ai-person-fields";
import type { RaidItem, Task } from "./types";

const TASK: Task = {
  id: 3, taskName: "Draft", assignee: "Marco", assigneeEmail: "", dueDate: "2026-11-01", lastUpdateDate: "2026-10-30",
  priority: "Medium", status: "To Do", blockers: "", description: "", inquiriesSent: 0, group: "", labels: [],
};
const RISK = { id: 5, category: "I", title: "Late vendor", description: "", owner: "Ann", severity: "Medium", status: "Open", linkedTaskIds: [], stakeholderIds: [] } as unknown as RaidItem;

function dispatcher(peopleProtected: boolean) {
  const createTask = vi.fn((input: Record<string, unknown>) => ({ ...TASK, id: 9, ...input }));
  const updateTask = vi.fn((id: number, patch: Record<string, unknown>) => ({ ...TASK, id, ...patch }));
  const escalateRaid = vi.fn(() => ({ escalated: true }));
  const d = {
    isPeopleProtected: () => peopleProtected,
    createTask, updateTask, escalateRaid,
    getTask: (id: number) => (id === TASK.id ? TASK : null),
    getRaidRow: (id: number) => (id === RISK.id ? RISK : null),
    takePlannedHoursNote: () => null,
  } as unknown as ToolDispatcher;
  return { d, createTask, updateTask, escalateRaid };
}

describe("create_task under people protection", () => {
  it("creates the task with its title and no assignee, and tells the model what it dropped", async () => {
    const { d, createTask } = dispatcher(true);
    const result = await runTool(d, "create_task", { taskName: "Write spec", assignee: "Marco", assigneeEmail: "m@x.io", dueDate: "2026-11-02" });
    expect(createTask).toHaveBeenCalledTimes(1);
    const sent = createTask.mock.calls[0]![0];
    expect(sent.taskName).toBe("Write spec");
    expect(sent.assignee).toBe("");
    expect(sent.assigneeEmail ?? "").toBe("");
    expect((result as Record<string, unknown>)[PERSON_FIELDS_NOTE_KEY]).toBe(PERSON_FIELDS_REMOVED_NOTE(["assignee", "assigneeEmail"]));
  });

  it("protection off: the assignee is applied and no note is added (positive control)", async () => {
    const { d, createTask } = dispatcher(false);
    const result = await runTool(d, "create_task", { taskName: "Write spec", assignee: "Marco", dueDate: "2026-11-02" });
    expect(createTask.mock.calls[0]![0].assignee).toBe("Marco");
    expect(result).not.toHaveProperty(PERSON_FIELDS_NOTE_KEY);
  });

  it("protection off: a missing assignee is still refused, as before", async () => {
    const { d } = dispatcher(false);
    await expect(runTool(d, "create_task", { taskName: "Write spec", dueDate: "2026-11-02" })).rejects.toThrow(/assignee/);
  });
});

describe("update_task under people protection", () => {
  it("clearing the assignee is acting too: the assignee stays, the other fields apply (R4)", async () => {
    const { d, updateTask } = dispatcher(true);
    const result = await runTool(d, "update_task", { id: 3, expectedToken: entityToken("task", TASK), assignee: "", priority: "High" });
    const patch = updateTask.mock.calls[0]![1];
    expect(patch).not.toHaveProperty("assignee");
    expect(patch.priority).toBe("High");
    expect((result as Record<string, unknown>)[PERSON_FIELDS_NOTE_KEY]).toContain("assignee");
  });

  it("protection off: the assignee is cleared as asked (positive control)", async () => {
    const { d, updateTask } = dispatcher(false);
    await runTool(d, "update_task", { id: 3, expectedToken: entityToken("task", TASK), assignee: "", priority: "High" });
    expect(updateTask.mock.calls[0]![1]).toHaveProperty("assignee", "");
  });
});

describe("escalate_raid_item under people protection", () => {
  it("escalates to nobody: the recipient is stripped, nothing is recorded, and the error says why", async () => {
    const { d, escalateRaid } = dispatcher(true);
    await expect(
      runTool(d, "escalate_raid_item", { id: 5, expectedToken: entityToken("raid", RISK), toEmail: "boss@x.io", toName: "Boss" }),
    ).rejects.toThrow(PERSON_FIELDS_REMOVED_NOTE(["toEmail", "toName"]));
    expect(escalateRaid).not.toHaveBeenCalled();
  });

  it("protection off: the escalation is recorded (positive control)", async () => {
    const { d, escalateRaid } = dispatcher(false);
    await runTool(d, "escalate_raid_item", { id: 5, expectedToken: entityToken("raid", RISK), toEmail: "boss@x.io", toName: "Boss" });
    expect(escalateRaid).toHaveBeenCalledTimes(1);
  });
});
