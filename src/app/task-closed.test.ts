import { describe, expect, it } from "vitest";
import { isTaskClosed, isTaskDelivered, isTaskOutOfScope } from "./task-closed";
import { type Task } from "./types";

const task = (over: Partial<Task>): Task => ({
  id: 1,
  taskName: "t",
  assignee: "a",
  priority: "Medium",
  status: "To Do",
  dueDate: "2026-08-01",
  ...over,
} as Task);

describe("isTaskClosed", () => {
  it("is true for Done", () => {
    expect(isTaskClosed(task({ status: "Done", completedDate: "2026-08-01" }))).toBe(true);
  });

  it("is true for Cancelled even with no completedDate", () => {
    expect(isTaskClosed(task({ status: "Cancelled" }))).toBe(true);
  });

  it("is false for In Progress", () => {
    expect(isTaskClosed(task({ status: "In Progress" }))).toBe(false);
  });
});

describe("isTaskDelivered", () => {
  it("is true only for a task carrying a completion date", () => {
    expect(isTaskDelivered(task({ status: "Done", completedDate: "2026-08-01" }))).toBe(true);
    expect(isTaskDelivered(task({ status: "Cancelled" }))).toBe(false);
    expect(isTaskDelivered(task({ status: "To Do" }))).toBe(false);
  });
});

describe("isTaskOutOfScope", () => {
  it("is true for a cancelled task", () => {
    expect(isTaskOutOfScope(task({ status: "Cancelled" }))).toBe(true);
  });

  // The pair open-followups §65 is about: closed, but nothing was delivered.
  it("is true for Done with no completedDate", () => {
    expect(isTaskOutOfScope(task({ status: "Done" }))).toBe(true);
  });

  it("is false for a delivered task", () => {
    expect(isTaskOutOfScope(task({ status: "Done", completedDate: "2026-08-01" }))).toBe(false);
  });

  it("is false for an open task", () => {
    expect(isTaskOutOfScope(task({ status: "In Progress" }))).toBe(false);
  });
});
