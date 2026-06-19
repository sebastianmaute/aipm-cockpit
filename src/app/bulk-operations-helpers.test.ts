import { describe, it, expect } from "vitest";
import { buildBulkEditUpdates, buildInquiryMessage } from "./bulk-operations-helpers";
import { emptyBulkEdit } from "./task-form-context";
import type { Task } from "./types";

function task(over: Partial<Task> = {}): Task {
  return {
    id: 1,
    taskName: "Spec",
    assignee: "Ada",
    assigneeEmail: "ada@example.com",
    dueDate: "2030-01-01",
    lastUpdateDate: "2029-01-01",
    status: "To Do",
    priority: "Medium",
    blockers: "",
    notes: "",
    inquiriesSent: 0,
    localModifiedAt: "2029-01-01T00:00:00.000Z",
    ...over,
  };
}

describe("buildBulkEditUpdates", () => {
  it("returns an empty patch when nothing is enabled", () => {
    const result = buildBulkEditUpdates(emptyBulkEdit(), "2030-06-01");
    expect(result).toEqual({ ok: true, updates: {} });
  });

  it("rejects a past due date", () => {
    const d = emptyBulkEdit();
    d.enabled.dueDate = true;
    d.dueDate = "2020-01-01";
    expect(buildBulkEditUpdates(d, "2030-06-01")).toEqual({ ok: false, error: "pastDate" });
  });

  it("rejects an invalid assignee email", () => {
    const d = emptyBulkEdit();
    d.enabled.assigneeEmail = true;
    d.assigneeEmail = "not-an-email";
    expect(buildBulkEditUpdates(d, "2030-06-01")).toEqual({ ok: false, error: "invalidEmail" });
  });

  it("validates due date before email (past-date wins when both bad)", () => {
    const d = emptyBulkEdit();
    d.enabled.dueDate = true;
    d.dueDate = "2020-01-01";
    d.enabled.assigneeEmail = true;
    d.assigneeEmail = "bad";
    expect(buildBulkEditUpdates(d, "2030-06-01")).toEqual({ ok: false, error: "pastDate" });
  });

  it("builds a sanitized patch for enabled fields only", () => {
    const d = emptyBulkEdit();
    d.enabled.priority = true;
    d.priority = "High";
    d.enabled.notes = true;
    d.notes = "Follow up";
    d.enabled.dueDate = true;
    d.dueDate = "2031-03-03";
    const result = buildBulkEditUpdates(d, "2030-06-01");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.updates).toEqual({ priority: "High", notes: "Follow up", dueDate: "2031-03-03" });
    }
  });
});

describe("buildInquiryMessage", () => {
  it("uses the single-task template for one task", () => {
    const { subject, body } = buildInquiryMessage([task({ id: 7, taskName: "Ship" })], "en-US");
    expect(subject).toContain("7");
    expect(subject).toContain("Ship");
    expect(body).toContain("Ship");
  });

  it("uses the bulk template and lists each task for multiple tasks", () => {
    const list = [task({ id: 7, taskName: "Ship" }), task({ id: 8, taskName: "Test" })];
    const { body } = buildInquiryMessage(list, "en-US");
    expect(body).toContain("#7: Ship");
    expect(body).toContain("#8: Test");
  });
});
