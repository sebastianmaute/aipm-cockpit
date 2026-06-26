// src/app/task-editor-actions.test.tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TaskDeleteButton, TaskEditorActions } from "./task-editor-actions";
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
  it("fires send-inquiry; hides Push to Jira for an already-synced task", () => {
    const syncedTask = makeTask({ jiraKey: "LOP-7" });
    const onSendInquiry = vi.fn();
    const onPushToJira = vi.fn();

    render(
      <TaskEditorActions
        lang="en-US"
        task={syncedTask}
        jiraConfigured
        onSendInquiry={onSendInquiry}
        onPushToJira={onPushToJira}
      />,
    );

    expect(screen.queryByRole("button", { name: "Push to Jira" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Send inquiry" }));
    expect(onSendInquiry).toHaveBeenCalledWith(syncedTask);
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
      />,
    );

    expect(screen.queryByRole("button", { name: "Push to Jira" })).toBeNull();
  });
});

describe("TaskDeleteButton", () => {
  it("renders a pink Delete button and fires onDelete with the task id", () => {
    const onDelete = vi.fn();

    render(
      <TaskDeleteButton lang="en-US" taskId={99} onDelete={onDelete} />,
    );

    const btn = screen.getByRole("button", { name: "Delete" });
    expect(btn).toBeInTheDocument();
    expect(btn.className).toMatch(/AIPM-pink/);

    fireEvent.click(btn);
    expect(onDelete).toHaveBeenCalledWith(99);
  });
});
