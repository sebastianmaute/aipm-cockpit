// src/app/task-editor-actions.test.tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { buildTaskEditorChrome, TaskDeleteButton, TaskEditorActions, TaskEditorExtras, type TaskEditorChromeDeps } from "./task-editor-actions";
import type { Task } from "./types";
import { Button } from "./button";

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

  // §102: the footer's Delete was the last hand-rolled footer button (px-4, beside three
  // size="sm" buttons). It is the destructive Button now, plus its dark-mode hover.
  it("renders Delete as the destructive Button at the footer's size", () => {
    // The primitive's own classes, rendered rather than spelled, so a Button change cannot
    // leave this assertion pinning a stale copy.
    const ref = render(<Button variant="destructive" size="sm">x</Button>);
    const expected = ref.container.querySelector("button")!.className;
    ref.unmount();
    render(<TaskDeleteButton lang="en-US" taskId={1} onDelete={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Delete" }).className).toBe(`${expected} dark:hover:bg-ui-pink/5`);
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

  // Eye check, batch 17: with the RAID form open, the linked-task button sat
  // level with the form's LABELS (`items-start` on the outer row) while Add and
  // the fields sat at the bottom. It now renders INSIDE the mini's bottom-aligned
  // form row when open, and beside the toggle when collapsed — not after the
  // whole mini, whose staged list would otherwise drag a bottom-aligned button
  // down with it.
  it("puts the linked-task button in the RAID form's bottom-aligned row when open", () => {
    render(
      <TaskEditorExtras
        lang="en-US"
        onAddRaid={vi.fn()}
        pendingRaid={[{ category: "R", title: "Staged risk" }]}
        onNewLinkedTask={vi.fn()}
      />,
    );

    const toggle = screen.getByRole("button", { name: "+ Create RAID" });
    const collapsedRow = screen.getByRole("button", { name: "+ New linked task" }).parentElement;
    expect(collapsedRow).toBe(toggle.parentElement);
    expect(collapsedRow?.className).toMatch(/\bitems-center\b/);

    fireEvent.click(toggle);
    const formRow = screen.getByRole("button", { name: "Add" }).parentElement;
    expect(screen.getByRole("button", { name: "+ New linked task" }).parentElement).toBe(formRow);
    expect(formRow?.className).toMatch(/\bitems-end\b/);
    // The staged list stays outside that row.
    expect(formRow?.contains(screen.getByText("Staged risk"))).toBe(false);
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

// §491 step 11 — the footer chrome builder moved out of task-manager.
describe("buildTaskEditorChrome", () => {
  function makeDeps(over: Partial<TaskEditorChromeDeps> = {}): TaskEditorChromeDeps {
    return {
      lang: "en-US",
      isPopout: false,
      editingTask: makeTask({ id: 7 }),
      editingIsJiraLinked: false,
      jira: { enabled: true, projectKey: "LOP" },
      jiraSyncing: false,
      onSendInquiry: vi.fn(),
      onPushToJira: vi.fn(async () => true),
      handleJiraSync: vi.fn(async () => {}),
      onDelete: vi.fn(),
      onAddRaid: vi.fn(),
      pendingRaid: [],
      onNewLinkedTask: vi.fn(),
      ...over,
    };
  }

  function renderChrome(deps: TaskEditorChromeDeps) {
    const c = buildTaskEditorChrome(deps);
    return render(
      <>
        <div data-testid="leading">{c.editorLeadingActions}</div>
        <div data-testid="delete">{c.editorDeleteAction}</div>
        <div data-testid="extras">{c.editorExtrasEl}</div>
      </>,
    );
  }

  const btn = (name: string) => screen.queryByRole("button", { name });

  it("renders send-inquiry, push, Delete and the extras for an existing task outside a popout", () => {
    renderChrome(makeDeps());
    expect(btn("Send inquiry")).not.toBeNull();
    expect(btn("Push to Jira")).not.toBeNull();
    expect(btn("Delete")).not.toBeNull();
    expect(btn("+ New linked task")).not.toBeNull();
    expect(btn("Sync with Jira")).toBeNull();
  });

  // §102: the three footer buttons are one primitive at one size. Send inquiry and Push to
  // Jira were hand-rolled at px-4 while the sync button beside them was size="sm" (px-3).
  // ★ No task shows all three: Push needs a task NOT in Jira, sync needs one that is. So
  // each real state is rendered, and Send inquiry (present in both) ties the two together.
  it("renders send-inquiry, push and the Jira sync button with the same Button classes", () => {
    const { unmount } = renderChrome(makeDeps({ editingTask: makeTask({ id: 7 }), editingIsJiraLinked: false }));
    const [inquiryUnlinked, push] = ["Send inquiry", "Push to Jira"].map((name) => btn(name)!.className);
    expect(btn("Sync with Jira")).toBeNull();
    unmount();
    renderChrome(makeDeps({ editingTask: makeTask({ id: 7, jiraKey: "LOP-7" }), editingIsJiraLinked: true }));
    const [inquiryLinked, sync] = ["Send inquiry", "Sync with Jira"].map((name) => btn(name)!.className);
    expect(btn("Push to Jira")).toBeNull();
    expect(inquiryUnlinked).toContain("px-3");
    expect(push).toBe(inquiryUnlinked);
    expect(inquiryLinked).toBe(inquiryUnlinked);
    expect(sync).toBe(inquiryUnlinked);
  });

  it("renders no leading actions and no Delete in create mode, but keeps the extras", () => {
    renderChrome(makeDeps({ editingTask: null }));
    expect(btn("Send inquiry")).toBeNull();
    expect(btn("Delete")).toBeNull();
    expect(btn("+ New linked task")).not.toBeNull();
  });

  it("renders nothing in a popout", () => {
    renderChrome(makeDeps({ isPopout: true, editingIsJiraLinked: true }));
    expect(btn("Send inquiry")).toBeNull();
    expect(btn("Delete")).toBeNull();
    expect(btn("+ New linked task")).toBeNull();
    // The sync button's own gate does not read isPopout (verbatim from task-manager).
    expect(btn("Sync with Jira")).not.toBeNull();
  });

  it("hides Push to Jira when Jira is disabled or has no project key", () => {
    const { unmount } = renderChrome(makeDeps({ jira: { enabled: false, projectKey: "LOP" } }));
    expect(btn("Push to Jira")).toBeNull();
    unmount();
    renderChrome(makeDeps({ jira: { enabled: true, projectKey: "" } }));
    expect(btn("Push to Jira")).toBeNull();
  });

  it("shows the Jira sync button only for a Jira-linked task with Jira enabled", () => {
    const { unmount } = renderChrome(makeDeps({ editingIsJiraLinked: true, jira: { enabled: false, projectKey: "LOP" } }));
    expect(btn("Sync with Jira")).toBeNull();
    unmount();
    renderChrome(makeDeps({ editingIsJiraLinked: true }));
    const sync = btn("Sync with Jira");
    expect(sync).not.toBeNull();
    expect(sync).toHaveAttribute("type", "button");
    expect(sync).not.toBeDisabled();
  });

  it("switches the sync label and disables it while syncing", () => {
    renderChrome(makeDeps({ editingIsJiraLinked: true, jiraSyncing: true }));
    expect(btn("Sync with Jira")).toBeNull();
    expect(btn("Syncing…")).toBeDisabled();
  });

  it("calls handleJiraSync on a sync click", () => {
    const deps = makeDeps({ editingIsJiraLinked: true });
    renderChrome(deps);
    fireEvent.click(btn("Sync with Jira")!);
    expect(deps.handleJiraSync).toHaveBeenCalledTimes(1);
  });

  it("wires send-inquiry, push, Delete, the RAID add and the linked-task button", () => {
    const task = makeTask({ id: 7 });
    const deps = makeDeps({ editingTask: task, pendingRaid: [{ category: "R", title: "Staged risk" }] });
    renderChrome(deps);
    fireEvent.click(btn("Send inquiry")!);
    expect(deps.onSendInquiry).toHaveBeenCalledWith(task);
    fireEvent.click(btn("Push to Jira")!);
    expect(deps.onPushToJira).toHaveBeenCalledWith(7);
    fireEvent.click(btn("Delete")!);
    expect(deps.onDelete).toHaveBeenCalledWith(7);
    fireEvent.click(btn("+ New linked task")!);
    expect(deps.onNewLinkedTask).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Staged risk")).toBeInTheDocument();
    fireEvent.click(btn("+ Create RAID")!);
    fireEvent.change(screen.getByLabelText("RAID Title"), { target: { value: "New risk" } });
    fireEvent.click(btn("Add")!);
    expect(deps.onAddRaid).toHaveBeenCalledWith(expect.objectContaining({ title: "New risk" }));
  });
});
