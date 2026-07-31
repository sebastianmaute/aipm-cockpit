// src/app/task-editor-actions.test.tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { TaskDeleteButton, TaskEditorActions, TaskEditorExtras } from "./task-editor-actions";
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
    description: "",
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
    expect(btn.className).toMatch(/ui-pink/);

    fireEvent.click(btn);
    expect(onDelete).toHaveBeenCalledWith(99);
  });

  it("remains available for a Jira-synced task (delete is NOT gated on jiraKey)", () => {
    // Jira-synced tasks are read-only for status/fields, but they must stay
    // DELETABLE from the editor — the button takes only an id, with no jiraKey
    // gate, so a future read-only sweep can't silently make synced tasks
    // undeletable. (The editor-level gate is editingTask && !isPopout only.)
    const onDelete = vi.fn();
    render(<TaskDeleteButton lang="en-US" taskId={7} onDelete={onDelete} />);
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(onDelete).toHaveBeenCalledWith(7);
  });
});

describe("TaskEditorExtras", () => {
  // The create-RAID mini and the new-linked-task button used to stack (a bare
  // fragment inside task-form-modal's `space-y-3` wrapper) — they must share
  // ONE row. `flex-wrap` is what lets the RAID mini expand in place (into its
  // wide category+title form) while the linked-task button drops to the next
  // line on its own, rather than a fixed two-column layout.
  it("renders the create-RAID trigger and the new-linked-task button on one flex-wrap row", () => {
    render(
      <TaskEditorExtras
        lang="en-US"
        onAddRaid={vi.fn()}
        pendingRaid={[]}
        onNewLinkedTask={vi.fn()}
      />,
    );

    const raidTrigger = screen.getByRole("button", { name: "+ Create RAID" });
    const linkedTaskButton = screen.getByRole("button", { name: "+ New linked task" });
    expect(raidTrigger).toBeInTheDocument();
    expect(linkedTaskButton).toBeInTheDocument();

    // Both controls' shared ancestor is the row this component owns.
    const row = raidTrigger.closest("div.flex");
    expect(row).not.toBeNull();
    expect(row?.className).toMatch(/flex-wrap/);
    expect(row?.contains(linkedTaskButton)).toBe(true);
  });

  it("wires onAdd/pending through to the RAID mini and calls onNewLinkedTask on click", () => {
    const onAddRaid = vi.fn();
    const onNewLinkedTask = vi.fn();
    render(
      <TaskEditorExtras
        lang="en-US"
        onAddRaid={onAddRaid}
        pendingRaid={[{ category: "R", title: "Staged risk" }]}
        onNewLinkedTask={onNewLinkedTask}
      />,
    );

    // The staged (pending) spec renders — proves `pending` reached the mini.
    expect(screen.getByText("Staged risk")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "+ New linked task" }));
    expect(onNewLinkedTask).toHaveBeenCalledTimes(1);
  });
});
