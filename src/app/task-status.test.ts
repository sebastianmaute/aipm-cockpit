import { describe, expect, it } from "vitest";
import {
  isTaskFinished,
  applyStatusChange,
  migrateTaskStatus,
  statusSortIndex,
} from "./task-status";
import type { Task } from "./types";

const base = (over: Partial<Task> = {}): Task =>
  ({
    id: 1,
    taskName: "T",
    assignee: "",
    assigneeEmail: "",
    dueDate: "2026-06-01",
    lastUpdateDate: "2026-05-01",
    priority: "Medium",
    blockers: "",
    notes: "",
    status: "To Do",
    ...over,
  }) as Task;

describe("isTaskFinished", () => {
  it("is true for Done and Cancelled", () => {
    expect(isTaskFinished(base({ status: "Done" }))).toBe(true);
    expect(isTaskFinished(base({ status: "Cancelled" }))).toBe(true);
  });
  it("is false for the four open statuses", () => {
    for (const s of ["To Do", "In Progress", "On Hold", "In Review"] as const)
      expect(isTaskFinished(base({ status: s }))).toBe(false);
  });
});

describe("applyStatusChange", () => {
  it("stamps completedDate when moving to Done", () => {
    const out = applyStatusChange(base({ status: "In Progress" }), "Done", "2026-06-19");
    expect(out.status).toBe("Done");
    expect(out.completedDate).toBe("2026-06-19");
  });
  it("keeps an existing completedDate when already Done", () => {
    const out = applyStatusChange(base({ status: "Done", completedDate: "2026-01-01" }), "Done", "2026-06-19");
    expect(out.completedDate).toBe("2026-01-01");
  });
  it("clears completedDate when moving off Done", () => {
    const out = applyStatusChange(base({ status: "Done", completedDate: "2026-01-01" }), "In Progress", "2026-06-19");
    expect(out.completedDate).toBe("");
  });
  it("leaves completedDate empty for Cancelled", () => {
    const out = applyStatusChange(base({ status: "In Progress" }), "Cancelled", "2026-06-19");
    expect(out.completedDate).toBe("");
  });
  it("clears completedDate when moving from Done to Cancelled", () => {
    const out = applyStatusChange(base({ status: "Done", completedDate: "2026-01-01" }), "Cancelled", "2026-06-19");
    expect(out.status).toBe("Cancelled");
    expect(out.completedDate).toBe("");
  });
  it("returns a new object (immutable)", () => {
    const input = base({ status: "To Do" });
    const out = applyStatusChange(input, "In Progress", "2026-06-19");
    expect(out).not.toBe(input);
    expect(input.status).toBe("To Do");
  });
});

describe("migrateTaskStatus", () => {
  it("derives Done from a set completedDate when status is absent", () => {
    const raw = { ...base(), completedDate: "2026-01-01" } as Partial<Task>;
    delete (raw as Record<string, unknown>).status;
    expect(migrateTaskStatus(raw as Task).status).toBe("Done");
  });
  it("derives To Do when no completedDate and status absent", () => {
    const raw = { ...base() } as Partial<Task>;
    delete (raw as Record<string, unknown>).status;
    expect(migrateTaskStatus(raw as Task).status).toBe("To Do");
  });
  it("keeps a valid existing status", () => {
    expect(migrateTaskStatus(base({ status: "On Hold" })).status).toBe("On Hold");
  });
  it("falls back to To Do on an invalid status string", () => {
    expect(migrateTaskStatus(base({ status: "garbage" as unknown as Task["status"] })).status).toBe("To Do");
  });
});

describe("statusSortIndex", () => {
  it("orders by TASK_STATUSES position", () => {
    expect(statusSortIndex("To Do")).toBeLessThan(statusSortIndex("Done"));
    expect(statusSortIndex("Cancelled")).toBeLessThan(statusSortIndex("Done"));
  });
});
