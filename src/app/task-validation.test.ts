import { describe, expect, it } from "vitest";
import { emptyForm, type TaskFormDraft } from "./task-form-context";
import { hasTaskErrors, validateTaskForm } from "./task-validation";

const TODAY = "2026-06-09";

function draft(over: Partial<TaskFormDraft>): TaskFormDraft {
  return { ...emptyForm(), ...over };
}

// These cases describe the CREATE ruleset (`isNew: true`), which is the strictest
// one and matches the behaviour before the flag existed. The edit-mode relaxation
// is covered by the "past-date rule" block below.
describe("validateTaskForm", () => {
  it("flags all three required fields on an empty form", () => {
    const errors = validateTaskForm(emptyForm(), TODAY, true);
    expect(errors.taskName).toBe("errorTaskNameRequired");
    expect(errors.assignee).toBe("errorAssigneeRequired");
    expect(errors.dueDate).toBe("errorDueDateRequired");
    expect(hasTaskErrors(errors)).toBe(true);
  });

  it("returns no errors for a complete, valid draft", () => {
    const errors = validateTaskForm(
      draft({ taskName: "Ship it", assignee: "Sam", dueDate: TODAY }),
      TODAY,
      true,
    );
    expect(errors).toEqual({});
    expect(hasTaskErrors(errors)).toBe(false);
  });

  it("rejects a due date before today", () => {
    const errors = validateTaskForm(
      draft({ taskName: "X", assignee: "Y", dueDate: "2026-06-08" }),
      TODAY,
      true,
    );
    expect(errors.dueDate).toBe("errorPastDate");
  });

  it("accepts a due date equal to today", () => {
    const errors = validateTaskForm(
      draft({ taskName: "X", assignee: "Y", dueDate: TODAY }),
      TODAY,
      true,
    );
    expect(errors.dueDate).toBeUndefined();
  });

  it("flags an invalid email but ignores a blank or valid one", () => {
    const base = draft({ taskName: "X", assignee: "Y", dueDate: TODAY });
    expect(validateTaskForm({ ...base, assigneeEmail: "not-an-email" }, TODAY, true).assigneeEmail).toBe("errorInvalidEmail");
    expect(validateTaskForm({ ...base, assigneeEmail: "" }, TODAY, true).assigneeEmail).toBeUndefined();
    expect(validateTaskForm({ ...base, assigneeEmail: "a@b.co" }, TODAY, true).assigneeEmail).toBeUndefined();
  });

  it("treats whitespace-only required fields as empty", () => {
    const errors = validateTaskForm(
      draft({ taskName: "   ", assignee: "  ", dueDate: TODAY }),
      TODAY,
      true,
    );
    expect(errors.taskName).toBe("errorTaskNameRequired");
    expect(errors.assignee).toBe("errorAssigneeRequired");
  });
});

describe("validateTaskForm past-date rule", () => {
  const base = draft({
    taskName: "Ship the thing",
    assignee: "Ada",
    dueDate: "2020-01-01",
  });

  it("rejects a past due date when creating", () => {
    expect(validateTaskForm(base, TODAY, true).dueDate).toBe("errorPastDate");
  });

  it("accepts a past due date when editing an existing task", () => {
    expect(validateTaskForm(base, TODAY, false).dueDate).toBeUndefined();
  });

  it("still requires a due date when editing", () => {
    expect(validateTaskForm({ ...base, dueDate: "" }, TODAY, false).dueDate).toBe(
      "errorDueDateRequired",
    );
  });
});
