import { describe, expect, it } from "vitest";
import { emptyForm, type TaskFormDraft } from "./task-form-context";
import { hasTaskErrors, validateTaskForm } from "./task-validation";

const TODAY = "2026-06-09";

function draft(over: Partial<TaskFormDraft>): TaskFormDraft {
  return { ...emptyForm(), ...over };
}

describe("validateTaskForm", () => {
  it("flags all three required fields on an empty form", () => {
    const errors = validateTaskForm(emptyForm(), TODAY);
    expect(errors.taskName).toBe("errorTaskNameRequired");
    expect(errors.assignee).toBe("errorAssigneeRequired");
    expect(errors.dueDate).toBe("errorDueDateRequired");
    expect(hasTaskErrors(errors)).toBe(true);
  });

  it("returns no errors for a complete, valid draft", () => {
    const errors = validateTaskForm(
      draft({ taskName: "Ship it", assignee: "Sam", dueDate: TODAY }),
      TODAY,
    );
    expect(errors).toEqual({});
    expect(hasTaskErrors(errors)).toBe(false);
  });

  it("rejects a due date before today", () => {
    const errors = validateTaskForm(
      draft({ taskName: "X", assignee: "Y", dueDate: "2026-06-08" }),
      TODAY,
    );
    expect(errors.dueDate).toBe("errorPastDate");
  });

  it("accepts a due date equal to today", () => {
    const errors = validateTaskForm(
      draft({ taskName: "X", assignee: "Y", dueDate: TODAY }),
      TODAY,
    );
    expect(errors.dueDate).toBeUndefined();
  });

  it("flags an invalid email but ignores a blank or valid one", () => {
    const base = draft({ taskName: "X", assignee: "Y", dueDate: TODAY });
    expect(validateTaskForm({ ...base, assigneeEmail: "not-an-email" }, TODAY).assigneeEmail).toBe("errorInvalidEmail");
    expect(validateTaskForm({ ...base, assigneeEmail: "" }, TODAY).assigneeEmail).toBeUndefined();
    expect(validateTaskForm({ ...base, assigneeEmail: "a@b.co" }, TODAY).assigneeEmail).toBeUndefined();
  });

  it("treats whitespace-only required fields as empty", () => {
    const errors = validateTaskForm(
      draft({ taskName: "   ", assignee: "  ", dueDate: TODAY }),
      TODAY,
    );
    expect(errors.taskName).toBe("errorTaskNameRequired");
    expect(errors.assignee).toBe("errorAssigneeRequired");
  });
});
