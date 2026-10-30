// AI people protection, Task 6 (spec R4): the executor strips person fields from every write it serves
// under protection, applies the rest, and tells the model which fields were dropped. Protection off, the
// same calls apply unchanged (positive control).
import { describe, it, expect, vi } from "vitest";
import { runTool, type ToolDispatcher } from "./chat-tools";
import { entityToken } from "./ai-entity-token";
import { PERSON_FIELDS_NOTE_KEY, PERSON_FIELDS_REMOVED_NOTE } from "./ai-person-fields";
import type { RaidItem, Task } from "./types";
import type { ForecastScenario } from "./forecast-scenarios";

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

// Fix round 1 (I1): `changes` REPLACES the whole list, so an edit of a scenario must be able to re-send the
// user's own named-person row. A row naming a person already in the stored scenario passes; a row naming
// a person the AI chose is dropped (the note names it) and the rest applies.
describe("update_forecast_scenario under people protection", () => {
  const USER_ROW = { kind: "addPeople", who: { resourceId: 7, hoursPerWeek: 20 }, from: "2026-11-01", until: "", rampWeeks: 4 };
  const NEW_PERSON_ROW = { kind: "addPeople", who: { resourceId: 9, hoursPerWeek: 40 }, from: "2026-11-01", until: "", rampWeeks: 4 };
  const AVAILABILITY = { kind: "availability", percent: 80, from: "2026-11-01", until: "" };
  const STORED = { id: 2, name: "Plan B", changes: [USER_ROW] } as unknown as ForecastScenario;

  function forecastDispatcher(peopleProtected: boolean) {
    const updateForecastScenario = vi.fn((id: number, patch: Record<string, unknown>) => ({ id, ...patch }));
    const d = {
      isPeopleProtected: () => peopleProtected,
      isForecastEnabled: () => true,
      getForecastScenarioRow: (id: number) => (id === STORED.id ? STORED : null),
      updateForecastScenario,
    } as unknown as ToolDispatcher;
    return { d, updateForecastScenario };
  }
  const call = (changes: unknown[]) => ({ id: 2, expectedToken: entityToken("forecastScenario", STORED), changes });
  const sentChanges = (spy: ReturnType<typeof vi.fn>) => (spy.mock.calls[0]![1] as { changes: { kind: string; who?: { resourceId?: number } }[] }).changes;

  it("re-sending the user's own named-person row keeps it, and the other change applies", async () => {
    const { d, updateForecastScenario } = forecastDispatcher(true);
    const result = await runTool(d, "update_forecast_scenario", call([USER_ROW, AVAILABILITY]));
    expect(sentChanges(updateForecastScenario).map((c) => c.kind)).toEqual(["addPeople", "availability"]);
    expect(sentChanges(updateForecastScenario)[0]!.who!.resourceId).toBe(7);
    expect(result).not.toHaveProperty(PERSON_FIELDS_NOTE_KEY);
  });

  it("a row naming a person the AI chose is dropped with a note, and the rest applies", async () => {
    const { d, updateForecastScenario } = forecastDispatcher(true);
    const result = await runTool(d, "update_forecast_scenario", call([USER_ROW, NEW_PERSON_ROW, AVAILABILITY]));
    expect(sentChanges(updateForecastScenario).map((c) => c.who?.resourceId ?? c.kind)).toEqual([7, "availability"]);
    expect((result as Record<string, unknown>)[PERSON_FIELDS_NOTE_KEY]).toBe(PERSON_FIELDS_REMOVED_NOTE(["changes[].who.resourceId"]));
  });

  it("protection off: the AI's named-person row is applied (positive control)", async () => {
    const { d, updateForecastScenario } = forecastDispatcher(false);
    await runTool(d, "update_forecast_scenario", call([USER_ROW, NEW_PERSON_ROW, AVAILABILITY]));
    expect(sentChanges(updateForecastScenario).map((c) => c.who?.resourceId ?? c.kind)).toEqual([7, 9, "availability"]);
  });
});
