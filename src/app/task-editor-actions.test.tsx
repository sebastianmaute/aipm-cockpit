// src/app/task-editor-actions.test.tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TaskEditorActions } from "./task-editor-actions";
import type { Task } from "./types";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 1,
    taskName: "Test task",
    assignee: "Alice",
    assigneeEmail: "alice@example.com",
    dueDate: "2030-12-31",
    lastUpdateDate: "2030-01-01",
    status: "To Do",
    priority: "Medium",
    blockers: "",
    notes: "",
    ...overrides,
  };
}

describe("TaskEditorActions", () => {
  it("fires send-inquiry and delete; hides Push to Jira for an already-synced task", () => {
    const syncedTask = makeTask({ jiraKey: "LOP-7" });
    const onSendInquiry = vi.fn();
    const onPushToJira = vi.fn();
    const onDelete = vi.fn();

    render(
      <TaskEditorActions
        lang="en-US"
        task={syncedTask}
        jiraConfigured
        onSendInquiry={onSendInquiry}
        onPushToJira={onPushToJira}
        onDelete={onDelete}
      />,
    );

    expect(screen.queryByRole("button", { name: "Push to Jira" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Send inquiry" }));
    expect(onSendInquiry).toHaveBeenCalledWith(syncedTask);

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onDelete).toHaveBeenCalledWith(syncedTask.id);
  });

  it("shows Push to Jira for an unsynced task when Jira configured; click calls onPushToJira(id)", () => {
    const unsyncedTask = makeTask({ id: 42 });
    const onPushToJira = vi.fn();

    render(
      <TaskEditorActions
        lang="en-US"
        task={unsyncedTask}
        jiraConfigured
        onSendInquiry={vi.fn()}
        onPushToJira={onPushToJira}
        onDelete={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Push to Jira" }));
    expect(onPushToJira).toHaveBeenCalledWith(42);
  });

  it("hides Push to Jira when Jira not configured", () => {
    render(
      <TaskEditorActions
        lang="en-US"
        task={makeTask()}
        jiraConfigured={false}
        onSendInquiry={vi.fn()}
        onPushToJira={vi.fn()}
        onDelete={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: "Push to Jira" })).toBeNull();
  });
});
