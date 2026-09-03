import { describe, expect, it } from "vitest";
import { entityToken, TOKEN_EXCLUDED } from "./ai-entity-token";
import type { Task } from "./types";

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: 1,
    taskName: "Ship it",
    assignee: "Alice",
    assigneeEmail: "alice@example.com",
    dueDate: "2030-12-31",
    lastUpdateDate: "2030-01-01",
    status: "To Do",
    priority: "Medium",
    blockers: "",
    description: "<p>original</p>",
    ...overrides,
  } as Task;
}

describe("entityToken", () => {
  it("is stable for an unchanged entity", () => {
    expect(entityToken("task", task())).toBe(entityToken("task", task()));
  });

  it("changes when a COVERED field changes", () => {
    // The positive direction. Without it a constant would pass every other case.
    expect(entityToken("task", task({ description: "<p>edited</p>" })))
      .not.toBe(entityToken("task", task()));
    expect(entityToken("task", task({ status: "Done" })))
      .not.toBe(entityToken("task", task()));
  });

  it("does NOT change when an EXCLUDED field changes", () => {
    // The negative direction, and the reason the exclusion set exists: a Jira
    // sync stamp or a note append must not refuse an unrelated edit.
    for (const field of TOKEN_EXCLUDED.task) {
      const mutated = task({ [field]: "2031-01-01" } as Partial<Task>);
      expect(entityToken("task", mutated)).toBe(entityToken("task", task()));
    }
  });
});
