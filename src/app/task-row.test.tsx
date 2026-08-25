import { describe, test, expect, vi } from "vitest";
import { render, renderHook, act, fireEvent, within } from "@testing-library/react";
import React, { Profiler, type ReactNode, type ProfilerOnRenderCallback } from "react";
import {
  TaskRow,
  TaskActions,
  RowContextProvider,
  useTaskRowContext,
  type RowContextValue,
} from "./task-row";
import { type ChangeItem, type RaidItem, type Resource, type Task } from "./types";
import { indexDocumentsByEntity, type DocEntityRef } from "./document-ref";
import type { ProjectDocument } from "./document-model";
import { expectRowUniqueNames } from "../test/row-unique-names";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 1,
    taskName: "Sample task",
    assignee: "Alice",
    assigneeEmail: "",
    dueDate: "2026-12-01",
    lastUpdateDate: "2026-05-18",
    status: "To Do",
    priority: "Medium",
    blockers: "",
    description: "",
    group: "",
    labels: [],
    dependencies: [],
    ...overrides,
  };
}

function makeChange(overrides: Partial<ChangeItem> = {}): ChangeItem {
  return {
    id: 1,
    title: "Sample change",
    description: "",
    type: "Scope",
    status: "Proposed",
    raisedDate: "2026-05-18",
    linkedTaskIds: [],
    linkedRaidIds: [],
    stakeholderIds: [],
    ...overrides,
  };
}

function makeContext(overrides: Partial<RowContextValue> = {}): RowContextValue {
  return {
    lang: "en-US",
    today: "2026-05-18",
    holidaySet: new Set(),
    jiraSiteUrl: "",
    jiraExtraProjects: [],
    jiraEnabled: false,
    jiraProjectKey: "",
    hiddenCols: new Set(),
    onToggleSelect: vi.fn(),
    onOpenNotes: vi.fn(),
    onJumpToRaid: vi.fn(),
    onSendInquiry: vi.fn(),
    onPushToJira: vi.fn(),
    onStatusChange: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    onAiEdit: vi.fn(),
    aiEditEnabled: () => false,
    onInlinePatch: vi.fn(),
    resourcesById: new Map(),
    resources: [],
    ...overrides,
  };
}

function makeResource(overrides: Partial<Resource> = {}): Resource {
  return {
    id: 1,
    firstName: "First",
    lastName: "Last",
    roleId: null,
    utilizationMode: "percent",
    utilization: {},
    ...overrides,
  };
}

function rowWrapper({
  context,
  children,
  tasksById,
}: {
  context: RowContextValue;
  children: ReactNode;
  tasksById?: Map<number, Task>;
}) {
  // <tbody> wrapper required because TaskRow returns a <tr>.
  return (
    <table>
      <tbody>
        <RowContextProvider value={context} tasksById={tasksById}>
          {children}
        </RowContextProvider>
      </tbody>
    </table>
  );
}

describe("TaskRow", () => {
  test("renders task data: name, assignee, due date, priority label", () => {
    const ctx = makeContext();
    const task = makeTask({
      id: 7,
      taskName: "Showcase this app",
      assignee: "Paul",
      dueDate: "2026-09-01",
      priority: "High",
    });
    const { getByText } = render(
      rowWrapper({
        context: ctx,
        children: (
          <TaskRow
            task={task}
            isSelected={false}
            isEditing={false}            isPushing={false}
            raidRefs={undefined}
          />
        ),
      }),
    );
    expect(getByText("Showcase this app")).toBeTruthy();
    expect(getByText("Paul")).toBeTruthy();
    expect(getByText("2026-09-01")).toBeTruthy();
    // "High" is the English label for priority High.
    expect(getByText("High")).toBeTruthy();
  });

  test("assignee cell shows the LIVE resource name when the task is linked, not the stale cache", () => {
    // The task's cached `assignee` string is stale ("Old Removed") but its
    // resourceId resolves to a live resource renamed to "Correct Name". The
    // cell must render the resource's current name; the inline picker now makes
    // linked assignees editable too (an inline-edit button, not read-only text).
    const ctx = makeContext({
      resourcesById: new Map([[7, makeResource({ id: 7, firstName: "Correct", lastName: "Name" })]]),
    });
    const task = makeTask({ id: 3, taskName: "Linked task", assignee: "Old Removed", resourceId: 7 });
    const { getByText, queryByText, getByLabelText } = render(
      rowWrapper({
        context: ctx,
        children: (
          <TaskRow task={task} isSelected={false} isEditing={false} isPushing={false} raidRefs={undefined} />
        ),
      }),
    );
    expect(getByText("Correct Name")).toBeTruthy();
    expect(queryByText("Old Removed")).toBeNull();
    // Linked → the LIVE resource name renders on an editable inline button.
    const btn = getByLabelText("Assignee – Linked task");
    expect(btn.tagName).toBe("BUTTON");
    expect(btn.textContent).toContain("Correct Name");
  });

  test("assignee cell stays inline-editable (seeded from the cache) when the task is unlinked", () => {
    const ctx = makeContext({ resourcesById: new Map() });
    const task = makeTask({ id: 4, taskName: "Freetext task", assignee: "Freetext Person", resourceId: undefined });
    const { getByLabelText } = render(
      rowWrapper({
        context: ctx,
        children: (
          <TaskRow task={task} isSelected={false} isEditing={false} isPushing={false} raidRefs={undefined} />
        ),
      }),
    );
    // Unlinked → the inline-edit ghost button exists and shows the cached name.
    const btn = getByLabelText("Assignee – Freetext task");
    expect(btn).toBeTruthy();
    expect(btn.textContent).toContain("Freetext Person");
  });

  test("dependency chip resolves predecessor name from the split lookup context", () => {
    const ctx = makeContext();
    const predecessor = makeTask({ id: 5, taskName: "Predecessor task" });
    const task = makeTask({ id: 7, taskName: "Dependent", dependencies: [{ taskId: 5, type: "FS" }] });
    const { getByTitle } = render(
      rowWrapper({
        context: ctx,
        tasksById: new Map([[5, predecessor]]),
        children: (
          <TaskRow
            task={task}
            isSelected={false}
            isEditing={false}            isPushing={false}
            raidRefs={undefined}
          />
        ),
      }),
    );
    // The chip title carries the predecessor's name, read via useTaskLookup.
    expect(getByTitle(/Predecessor task/)).toBeTruthy();
  });

  test("dependency chip updates when only the lookup Map changes (task prop + row context held constant)", () => {
    const ctx = makeContext();
    const task = makeTask({ id: 7, taskName: "Dependent", dependencies: [{ taskId: 5, type: "FS" }] });
    // Same task element + same row context value across the rerender — only the
    // split lookup Map changes. Locks the context-bypasses-memo behavior the
    // split exists to preserve (audit #32): task B's chip must re-resolve A's
    // new name even though B's own props/row-context didn't change.
    const child = (
      <TaskRow
        task={task}
        isSelected={false}
        isEditing={false}
        isPushing={false}
        raidRefs={undefined}
      />
    );
    const { getByTitle, queryByTitle, rerender } = render(
      rowWrapper({ context: ctx, tasksById: new Map([[5, makeTask({ id: 5, taskName: "Old name" })]]), children: child }),
    );
    expect(getByTitle(/Old name/)).toBeTruthy();

    rerender(
      rowWrapper({ context: ctx, tasksById: new Map([[5, makeTask({ id: 5, taskName: "New name" })]]), children: child }),
    );
    expect(getByTitle(/New name/)).toBeTruthy();
    expect(queryByTitle(/Old name/)).toBeNull();
  });

  test("does not re-render on unrelated parent state change (memo holds)", () => {
    const ctx = makeContext();
    const task = makeTask({ id: 42 });
    let setCounter: (n: number) => void = () => {};
    const renderSpy = vi.fn<ProfilerOnRenderCallback>();

    function Harness() {
      const [, setN] = React.useState(0);
      setCounter = setN;
      // useMemo keeps the Profiler+TaskRow element stable across re-renders
      // so the only thing that can trigger Profiler is TaskRow itself rendering.
      const stableRow = React.useMemo(
        () => (
          <Profiler id="row" onRender={renderSpy}>
            <TaskRow
              task={task}
              isSelected={false}
              isEditing={false}              isPushing={false}
              raidRefs={undefined}
            />
          </Profiler>
        ),
        [],
      );
      return rowWrapper({ context: ctx, children: stableRow });
    }

    render(<Harness />);
    const initialRenders = renderSpy.mock.calls.length;
    expect(initialRenders).toBeGreaterThanOrEqual(1);

    act(() => setCounter(1));
    act(() => setCounter(2));

    expect(renderSpy.mock.calls.length).toBe(initialRenders);
  });

  test("re-renders when its own props change (isSelected flip)", () => {
    const ctx = makeContext();
    const task = makeTask({ id: 100 });
    let setSel: (b: boolean) => void = () => {};
    const renderSpy = vi.fn<ProfilerOnRenderCallback>();

    function Harness() {
      const [sel, setSelLocal] = React.useState(false);
      setSel = setSelLocal;
      return rowWrapper({
        context: ctx,
        children: (
          <Profiler id="row" onRender={renderSpy}>
            <TaskRow
              task={task}
              isSelected={sel}
              isEditing={false}              isPushing={false}
              raidRefs={undefined}
            />
          </Profiler>
        ),
      });
    }

    render(<Harness />);
    const before = renderSpy.mock.calls.length;

    act(() => setSel(true));

    expect(renderSpy.mock.calls.length).toBeGreaterThan(before);
  });
});

describe("TaskRow workflow-status badge", () => {
  test("renders the workflow-status label when the taskStatus column is visible", () => {
    const ctx = makeContext(); // hiddenCols is empty → taskStatus column shown
    const { getByText } = render(
      rowWrapper({
        context: ctx,
        children: (
          <TaskRow
            task={makeTask({ id: 21, status: "In Review" })}
            isSelected={false}
            isEditing={false}            isPushing={false}
            raidRefs={undefined}
          />
        ),
      }),
    );
    // statusInReview EN value is "In Review".
    expect(getByText("In Review")).toBeTruthy();
  });

  test("hides the workflow-status badge when the taskStatus column is hidden", () => {
    const ctx = makeContext({ hiddenCols: new Set(["taskStatus"]) });
    const { queryByText } = render(
      rowWrapper({
        context: ctx,
        children: (
          <TaskRow
            task={makeTask({ id: 22, status: "On Hold" })}
            isSelected={false}
            isEditing={false}            isPushing={false}
            raidRefs={undefined}
          />
        ),
      }),
    );
    expect(queryByText("On Hold")).toBeNull();
  });

  test("renders the Created column value when unhidden", () => {
    const ctx = makeContext(); // hiddenCols is empty → createdDate column shown
    const { getByText } = render(
      rowWrapper({
        context: ctx,
        children: (
          <TaskRow
            task={makeTask({ id: 23, createdDate: "2026-01-15" })}
            isSelected={false}
            isEditing={false} isPushing={false}
            raidRefs={undefined}
          />
        ),
      }),
    );
    expect(getByText("2026-01-15")).toBeTruthy();
  });

  test("hides the Created column value when hidden", () => {
    const ctx = makeContext({ hiddenCols: new Set(["createdDate"]) });
    const { queryByText } = render(
      rowWrapper({
        context: ctx,
        children: (
          <TaskRow
            task={makeTask({ id: 24, createdDate: "2026-01-15" })}
            isSelected={false}
            isEditing={false} isPushing={false}
            raidRefs={undefined}
          />
        ),
      }),
    );
    expect(queryByText("2026-01-15")).toBeNull();
  });

  test("changes status via the inline dropdown", () => {
    const onStatusChange = vi.fn();
    const ctx = makeContext({ onStatusChange });
    const { getByRole } = render(
      rowWrapper({
        context: ctx,
        children: (
          <TaskRow
            task={makeTask({ id: 1, taskName: "Alpha", status: "To Do" })}
            isSelected={false}
            isEditing={false}            isPushing={false}
            raidRefs={undefined}
          />
        ),
      }),
    );
    const select = getByRole("combobox", { name: "Status – Alpha" });
    fireEvent.change(select, { target: { value: "In Progress" } });
    expect(onStatusChange).toHaveBeenCalledWith(1, "In Progress");
  });

  test("disables the inline status select for a Jira-synced task", () => {
    const ctx = makeContext();
    const { getByRole } = render(
      rowWrapper({
        context: ctx,
        children: (
          <TaskRow
            task={makeTask({ id: 1, taskName: "Sync", status: "In Progress", jiraKey: "LOP-1" })}
            isSelected={false}
            isEditing={false}            isPushing={false}
            raidRefs={undefined}
          />
        ),
      }),
    );
    expect(getByRole("combobox", { name: "Status – Sync" })).toBeDisabled();
  });

  test("leaves the inline status select enabled for a non-synced task", () => {
    const ctx = makeContext();
    const { getByRole } = render(
      rowWrapper({
        context: ctx,
        children: (
          <TaskRow
            task={makeTask({ id: 2, taskName: "Local", status: "To Do" })}
            isSelected={false}
            isEditing={false}            isPushing={false}
            raidRefs={undefined}
          />
        ),
      }),
    );
    expect(getByRole("combobox", { name: "Status – Local" })).not.toBeDisabled();
  });
});

describe("TaskRow zebra striping", () => {
  test("striped row carries the alternating background", () => {
    const ctx = makeContext();
    const { container } = render(
      rowWrapper({
        context: ctx,
        children: (
          <TaskRow
            task={makeTask({ id: 2 })}
            isSelected={false}
            isEditing={false}            isPushing={false}
            raidRefs={undefined}
            isStriped
          />
        ),
      }),
    );
    const tr = container.querySelector("tbody tr");
    expect(tr?.className).toContain("bg-surface-muted/40");
  });

  test("unstriped default row has no alternating background", () => {
    const ctx = makeContext();
    const { container } = render(
      rowWrapper({
        context: ctx,
        children: (
          <TaskRow
            task={makeTask({ id: 3 })}
            isSelected={false}
            isEditing={false}            isPushing={false}
            raidRefs={undefined}
            isStriped={false}
          />
        ),
      }),
    );
    const tr = container.querySelector("tbody tr");
    expect(tr?.className).not.toContain("bg-surface-muted/40");
  });

  test("editing state wins over striping (no stripe on an editing row)", () => {
    const ctx = makeContext();
    const { container } = render(
      rowWrapper({
        context: ctx,
        children: (
          <TaskRow
            task={makeTask({ id: 4 })}
            isSelected={false}
            isEditing            isPushing={false}
            raidRefs={undefined}
            isStriped
          />
        ),
      }),
    );
    const tr = container.querySelector("tbody tr");
    expect(tr?.className).toContain("bg-ui-purple/10");
    expect(tr?.className).not.toContain("bg-surface-muted/40");
  });

  test("completed row uses a muted tint, not an opacity dim (WCAG contrast)", () => {
    const ctx = makeContext();
    const { container } = render(
      rowWrapper({
        context: ctx,
        children: (
          <TaskRow
            // status + completedDate move together (`status === "Done" ⟺
            // completedDate set`); a completedDate on a "To Do" task is a shape
            // applyStatusChange never produces.
            task={makeTask({ id: 5, status: "Done", completedDate: "2026-05-20" })}
            isSelected={false}
            isEditing={false}            isPushing={false}
            raidRefs={undefined}
            isStriped
          />
        ),
      }),
    );
    const tr = container.querySelector("tbody tr");
    // opacity-dimming drags text/badges below the AA contrast threshold, so the
    // completed affordance is a full-opacity muted tint (+ strikethrough title).
    expect(tr?.className).not.toContain("opacity-60");
    expect(tr?.className).toContain("bg-surface-muted/60");
  });

  test("a cancelled row reads as closed but shows no completion date", () => {
    // Cancelled carries no completedDate, so the row must take the closed
    // styling (muted tint + strikethrough) WITHOUT claiming a delivery date —
    // a single `isComplete` flag would render "Completed on undefined".
    const ctx = makeContext();
    const { container, queryByLabelText, getByLabelText } = render(
      rowWrapper({
        context: ctx,
        children: (
          <TaskRow
            task={makeTask({ id: 6, status: "Cancelled", dueDate: "2026-01-01" })}
            isSelected={false}
            isEditing={false}
            isPushing={false}
            raidRefs={undefined}
            isStriped
          />
        ),
      }),
    );
    const tr = container.querySelector("tbody tr");
    expect(tr?.className).toContain("bg-surface-muted/60");
    expect(container.querySelector("td.line-through")).not.toBeNull();
    // The health cell falls back to the health tooltip, never a completion date.
    expect(queryByLabelText(/completed on/i)).toBeNull();
    expect(getByLabelText(/cancelled/i)).toBeInTheDocument();
  });
});

describe("TaskRow closed glyph", () => {
  // isClosed covers Done AND Cancelled, but only Done is DELIVERED — the
  // status cell must render a different glyph SHAPE (not just colour) for
  // the two, so a cancelled row can never be read as a delivered one.
  function renderClosedRow(task: Task) {
    const ctx = makeContext();
    return render(
      rowWrapper({
        context: ctx,
        children: (
          <TaskRow
            task={task}
            isSelected={false}
            isEditing={false}
            isPushing={false}
            raidRefs={undefined}
            isStriped={false}
          />
        ),
      }),
    );
  }

  test("shows a cross, not a check, for a cancelled task", () => {
    const { container } = renderClosedRow(makeTask({ id: 1, status: "Cancelled" }));
    expect(container.textContent).toContain("✕");
    expect(container.textContent).not.toContain("✓");
  });

  test("still shows the check for a delivered task", () => {
    const { container } = renderClosedRow(
      makeTask({ id: 2, status: "Done", completedDate: "2026-05-20" }),
    );
    expect(container.textContent).toContain("✓");
    expect(container.textContent).not.toContain("✕");
  });
});

describe("useTaskRowContext", () => {
  test("throws a documented error when used outside RowContext.Provider", () => {
    const original = console.error;
    console.error = () => {};
    try {
      expect(() => renderHook(() => useTaskRowContext())).toThrow(
        "useTaskRowContext must be used within RowContext.Provider",
      );
    } finally {
      console.error = original;
    }
  });
});

describe("TaskRow description + notes-log cells", () => {
  test("renders a plain-text preview of the rich description", () => {
    const ctx = makeContext();
    const task = makeTask({ id: 60, description: "<p>Ship <strong>v2</strong> soon</p>" });
    const { getByText } = render(
      rowWrapper({
        context: ctx,
        children: (
          <TaskRow task={task} isSelected={false} isEditing={false} isPushing={false} raidRefs={undefined} />
        ),
      }),
    );
    expect(getByText("Ship v2 soon")).toBeTruthy();
  });

  test("shows an em dash when the description is empty", () => {
    const ctx = makeContext();
    const task = makeTask({ id: 61, description: "" });
    const { getAllByText } = render(
      rowWrapper({
        context: ctx,
        children: (
          <TaskRow task={task} isSelected={false} isEditing={false} isPushing={false} raidRefs={undefined} />
        ),
      }),
    );
    expect(getAllByText("—").length).toBeGreaterThan(0);
  });

  test("notes-log badge shows the entry count and opens the notes window on click", () => {
    const onOpenNotes = vi.fn();
    const ctx = makeContext({ onOpenNotes });
    const task = makeTask({
      id: 62,
      taskName: "Log task",
      noteLog: [
        { id: 1, timestamp: "2026-05-01T00:00:00.000Z", html: "<p>a</p>", text: "a" },
        { id: 2, timestamp: "2026-05-02T00:00:00.000Z", html: "<p>b</p>", text: "b" },
      ],
    });
    const { getByRole } = render(
      rowWrapper({
        context: ctx,
        children: (
          <TaskRow task={task} isSelected={false} isEditing={false} isPushing={false} raidRefs={undefined} />
        ),
      }),
    );
    // Row-unique accessible name (Notes log – <task>).
    const badge = getByRole("button", { name: "Notes log – Log task" });
    expect(badge.textContent).toContain("2");
    fireEvent.click(badge);
    expect(onOpenNotes).toHaveBeenCalledWith(62);
  });

  test("notes-log badge shows 0 when the log is absent", () => {
    const ctx = makeContext();
    const task = makeTask({ id: 63, taskName: "No log" });
    const { getByRole } = render(
      rowWrapper({
        context: ctx,
        children: (
          <TaskRow task={task} isSelected={false} isEditing={false} isPushing={false} raidRefs={undefined} />
        ),
      }),
    );
    expect(getByRole("button", { name: "Notes log – No log" }).textContent).toContain("0");
  });
});

describe("TaskRow click-to-edit", () => {
  test("opens the editor when the task id is clicked", () => {
    const onEdit = vi.fn();
    const ctx = makeContext({ onEdit });
    const task = makeTask({ id: 7, taskName: "Review the deck" });
    const { getByRole } = render(
      rowWrapper({
        context: ctx,
        children: (
          <TaskRow
            task={task}
            isSelected={false}
            isEditing={false}            isPushing={false}
            raidRefs={undefined}
          />
        ),
      }),
    );
    fireEvent.click(getByRole("button", { name: /#7/ }));
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }));
  });

  test("opens the editor a beat after the task name is single-clicked", () => {
    vi.useFakeTimers();
    try {
      const onEdit = vi.fn();
      const ctx = makeContext({ onEdit });
      const task = makeTask({ id: 7, taskName: "Review the deck" });
      const { getByRole } = render(
        rowWrapper({
          context: ctx,
          children: (
            <TaskRow
              task={task}
              isSelected={false}
              isEditing={false}              isPushing={false}
              raidRefs={undefined}
            />
          ),
        }),
      );
      // Single-click defers so a double-click can cancel it (inline rename).
      fireEvent.click(getByRole("button", { name: "Review the deck" }));
      expect(onEdit).not.toHaveBeenCalled();
      act(() => { vi.advanceTimersByTime(250); });
      expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }));
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("TaskRow changes badge", () => {
  test("shows a changes badge when changeRefs is non-empty", () => {
    const ctx = makeContext();
    const { getByText } = render(
      rowWrapper({
        context: ctx,
        children: (
          <TaskRow
            task={makeTask({ id: 8 })}
            isSelected={false}
            isEditing={false}            isPushing={false}
            raidRefs={undefined}
            changeRefs={[makeChange({ id: 1 }), makeChange({ id: 2 })]}
          />
        ),
      }),
    );
    // taskRowChangesBadge EN value is "{0} changes" → "2 changes".
    expect(getByText("2 changes")).toBeTruthy();
  });

  test("renders no changes badge when changeRefs is empty", () => {
    const ctx = makeContext();
    const { queryByText } = render(
      rowWrapper({
        context: ctx,
        children: (
          <TaskRow
            task={makeTask({ id: 9 })}
            isSelected={false}
            isEditing={false}            isPushing={false}
            raidRefs={undefined}
            changeRefs={[]}
          />
        ),
      }),
    );
    expect(queryByText(/changes$/)).toBeNull();
  });

  test("renders no changes badge when changeRefs is undefined", () => {
    const ctx = makeContext();
    const { queryByText } = render(
      rowWrapper({
        context: ctx,
        children: (
          <TaskRow
            task={makeTask({ id: 10 })}
            isSelected={false}
            isEditing={false}            isPushing={false}
            raidRefs={undefined}
          />
        ),
      }),
    );
    expect(queryByText(/changes$/)).toBeNull();
  });
});

describe("TaskActions", () => {
  const renderActions = (ctx: RowContextValue, task: Task) =>
    render(
      <table>
        <tbody>
          <tr>
            <td>
              <RowContextProvider value={ctx}>
                <TaskActions task={task} isPushing={false} />
              </RowContextProvider>
            </td>
          </tr>
        </tbody>
      </table>,
    );

  test("the menu-only row verbs stay hidden until ⋮ opens", () => {
    // Send inquiry is deliberately NOT in this list — it is a visible button
    // now, asserted by the "Send inquiry" describe below.
    const ctx = makeContext({ jiraEnabled: true, jiraProjectKey: "MCP" });
    const task = makeTask({ id: 99 });
    const { getByText, getByRole, queryByText } = renderActions(ctx, task);

    // Nothing renders while the overflow is closed.
    expect(queryByText("Edit")).toBeNull();
    expect(queryByText("Push to Jira")).toBeNull();
    expect(queryByText("Delete")).toBeNull();

    // Opening the ⋮ menu (row-unique accessible name) reveals all three.
    fireEvent.click(getByRole("button", { name: "More actions – Sample task" }));
    expect(getByText("Edit")).toBeInTheDocument();
    expect(getByText("Push to Jira")).toBeInTheDocument();
    expect(getByText("Delete")).toBeInTheDocument();
  });

  test("a cancelled task offers no Send inquiry and no Push to Jira", () => {
    // Nobody should be chased about work that will never be done, and there is
    // nothing left to push. Cancelled carries no completedDate, so the old
    // `!task.completedDate` guard kept both verbs on offer.
    const ctx = makeContext({ jiraEnabled: true, jiraProjectKey: "MCP" });
    const task = makeTask({ id: 99, status: "Cancelled" });
    const { getByText, getByRole, queryByText, queryByRole } = renderActions(ctx, task);

    fireEvent.click(getByRole("button", { name: "More actions – Sample task" }));
    // Guard: the menu really is open, so the two absences below mean something.
    expect(getByText("Edit")).toBeInTheDocument();
    expect(getByText("Delete")).toBeInTheDocument();
    // ★ By ROLE+NAME, never by TEXT. Send inquiry is icon-only, so it has no
    //   visible text at all — a `queryByText("Send inquiry")` assertion here
    //   passes for an OPEN task too, i.e. it cannot distinguish the guard
    //   working from the guard deleted. (It did exactly that until 0.245.0.)
    expect(queryByRole("button", { name: /^Send inquiry/ })).toBeNull();
    expect(queryByText("Push to Jira")).toBeNull();
  });

  test("overflow Delete fires onDelete with the task id", () => {
    const ctx = makeContext({ jiraEnabled: true, jiraProjectKey: "MCP" });
    const task = makeTask({ id: 99 });
    const { getByText, getByRole } = renderActions(ctx, task);

    fireEvent.click(getByRole("button", { name: "More actions – Sample task" }));
    fireEvent.click(getByText("Delete"));
    expect(ctx.onDelete).toHaveBeenCalledTimes(1);
    expect(ctx.onDelete).toHaveBeenCalledWith(99);
  });

  test("offers Edit inside the overflow menu and no longer renders it inline", () => {
    const ctx = makeContext({ jiraEnabled: true, jiraProjectKey: "MCP" });
    const task = makeTask({ id: 99 });
    const { getByRole, queryByRole } = renderActions(ctx, task);

    expect(queryByRole("button", { name: "Edit" })).toBeNull();

    fireEvent.click(getByRole("button", { name: "More actions – Sample task" }));
    fireEvent.click(getByRole("menuitem", { name: "Edit" }));
    expect(ctx.onEdit).toHaveBeenCalledTimes(1);
    expect(ctx.onEdit).toHaveBeenCalledWith(task);
  });

});

describe("TaskActions Send inquiry", () => {
  const renderActions = (ctx: RowContextValue, tasks: Task[]) =>
    render(
      <table>
        <tbody>
          <RowContextProvider value={ctx}>
            {tasks.map((task) => (
              <tr key={task.id}>
                <td>
                  <TaskActions task={task} isPushing={false} />
                </td>
              </tr>
            ))}
          </RowContextProvider>
        </tbody>
      </table>,
    );

  // ★★★ RECORDED, NOT FIXED — a genuine, pre-existing WCAG 2.4.6 collision,
  // and a bigger one than this single control: `TaskActionsImpl` derives
  // EVERY accessible name in this row (Send inquiry, the ⋮ "More actions"
  // menu, and — in `TaskRow` itself — the field-edit buttons, inline AI edit,
  // task-name button, assignee and priority controls, task-row.tsx:281-702)
  // from `task.taskName` alone, with no per-render disambiguation. Two same-
  // named tasks in the same table collide on ALL of them at once — confirmed
  // for Send inquiry + More actions (both x2) by seeding a twin here. Fixing
  // it means threading a row-token map from wherever the task list is mapped
  // (tasks-section.tsx, which maps the list into `<TaskRow>`; there has never
  // been a tasks-panel.tsx on any branch — `git ls-files | grep -i tasks-panel`
  // is empty) down through `RowContextProvider`/`TaskRow`'s props —
  // real restructuring of the table's data flow, not a local qualifier swap,
  // and the single largest surface found in this bucket (raid-panel-rows.tsx
  // and task-kanban-card.tsx each had 2-3 colliding controls; this file has
  // 10+ call sites on the same pattern). Kept as the ORIGINAL single-row
  // test; seeding a twin here would only pin the bug in place.
  test("renders a row-unique Send inquiry button for an open task", () => {
    const ctx = makeContext();
    const task = makeTask({ id: 7, taskName: "Draft SOW", status: "To Do" });
    const { getByRole } = renderActions(ctx, [task]);

    fireEvent.click(getByRole("button", { name: "Send inquiry – Draft SOW" }));
    expect(ctx.onSendInquiry).toHaveBeenCalledTimes(1);
    expect(ctx.onSendInquiry).toHaveBeenCalledWith(
      expect.objectContaining({ id: 7 }),
    );
  });

  // ★ ICON-ONLY, and that is a geometry constraint, not a style choice: the
  //   actions column is `table-layout: fixed` with a declared width and a
  //   non-resizable header, so a text label there had a zero-width content box
  //   and rendered unusable. WCAG 2.5.3 (label in name) does NOT apply — it
  //   constrains a control that HAS a visible label, and this one has none —
  //   so the row-unique `aria-label` is conformant as written.
  test("is icon-only: no visible text, a hover title, and the glyph stays out of the name", () => {
    const ctx = makeContext();
    const task = makeTask({ id: 7, taskName: "Draft SOW", status: "To Do" });
    const { getByRole } = renderActions(ctx, [task]);

    const btn = getByRole("button", { name: "Send inquiry – Draft SOW" });
    // No visible text: the accessible name above therefore comes from the
    // aria-label alone, and the SVG glyph contributes nothing to it.
    expect(btn.textContent).toBe("");
    // Mouse users still get the verb (the accessible name carries the row
    // qualifier; the tooltip is the bare verb, matching the ⋮ button).
    expect(btn).toHaveAttribute("title", "Send inquiry");
  });

  test("hides the button for a closed task", () => {
    const ctx = makeContext();
    const task = makeTask({
      id: 8,
      taskName: "Done thing",
      status: "Done",
      completedDate: "2026-08-01",
    });
    const { queryByRole } = renderActions(ctx, [task]);

    expect(queryByRole("button", { name: /Send inquiry/ })).toBeNull();
  });

  // ★ Exactly ONE control per row. Two controls sharing an accessible name is
  //   the WCAG 2.4.6 defect the axe gate provably cannot see, so keeping the
  //   menu item alongside the button would create it silently.
  test("no longer offers Send inquiry inside the overflow menu", () => {
    const ctx = makeContext();
    const task = makeTask({ id: 7, taskName: "Draft SOW", status: "To Do" });
    const { getByRole, queryByRole } = renderActions(ctx, [task]);

    fireEvent.click(getByRole("button", { name: "More actions – Draft SOW" }));
    // Guard: the menu really is open, so the absence below means something.
    expect(getByRole("menuitem", { name: "Edit" })).toBeInTheDocument();
    expect(queryByRole("menuitem", { name: "Send inquiry" })).toBeNull();
  });

  // ★ One row cannot express a name collision at ANY assertion count, and axe
  //   cannot see one at any seed size — this is the only possible detector.
  test("two open rows get DIFFERENT Send inquiry accessible names", () => {
    const ctx = makeContext();
    const { getByRole, getAllByRole } = renderActions(ctx, [
      makeTask({ id: 7, taskName: "Draft SOW", status: "To Do" }),
      makeTask({ id: 8, taskName: "Review budget", status: "To Do" }),
    ]);

    // Both render...
    expect(getAllByRole("button", { name: /^Send inquiry/ })).toHaveLength(2);
    // ...and each is reachable by its OWN name (getByRole throws on a tie).
    expect(getByRole("button", { name: "Send inquiry – Draft SOW" })).toBeInTheDocument();
    expect(
      getByRole("button", { name: "Send inquiry – Review budget" }),
    ).toBeInTheDocument();
  });
});

describe("TaskRow Ask-Claude leading cell", () => {
  test("renders the Ask-Claude trigger in a leading, hover-revealed cell when enabled, and fires onAiEdit", () => {
    const onAiEdit = vi.fn();
    const ctx = makeContext({ onAiEdit, aiEditEnabled: () => true });
    const task = makeTask({ id: 30, taskName: "Draft the report" });

    const { getByRole, container } = render(
      rowWrapper({
        context: ctx,
        children: (
          <TaskRow
            task={task}
            isSelected={false}
            isEditing={false}            isPushing={false}
            raidRefs={undefined}
          />
        ),
      }),
    );

    const trigger = getByRole("button", { name: "Ask Claude – Draft the report" });
    const cell = trigger.closest("td");
    const row = container.querySelector("tbody tr") as HTMLElement;
    const cells = within(row).getAllByRole("cell");
    // The trigger lives in the FIRST (leading) cell of the row.
    expect(cell).toBe(cells[0]);
    // Hidden by default, revealed on row hover / keyboard focus.
    expect(trigger.className).toMatch(/opacity-0/);
    expect(trigger.className).toMatch(/group-hover:opacity-100/);
    expect(trigger.className).toMatch(/focus-visible:opacity-100/);

    fireEvent.click(trigger);
    expect(onAiEdit).toHaveBeenCalledTimes(1);
    expect(onAiEdit).toHaveBeenCalledWith(task);
  });

  test("omits the trigger when aiEditEnabled is false (e.g. Jira-synced) but keeps the reserved leading cell", () => {
    const ctx = makeContext({ aiEditEnabled: () => false });
    const task = makeTask({ id: 31, taskName: "Skip AI", jiraKey: "LOP-1" });

    const { queryByRole, container } = render(
      rowWrapper({
        context: ctx,
        children: (
          <TaskRow
            task={task}
            isSelected={false}
            isEditing={false}            isPushing={false}
            raidRefs={undefined}
          />
        ),
      }),
    );

    expect(queryByRole("button", { name: /Ask Claude/ })).toBeNull();
    // Leading cell still renders (reserves width → no hover layout shift).
    const row = container.querySelector("tbody tr") as HTMLElement;
    expect(within(row).getAllByRole("cell").length).toBeGreaterThan(0);
  });
});

function makeRaidItem(overrides: Partial<RaidItem> = {}): RaidItem {
  return {
    id: 1,
    category: "R",
    title: "Sample risk",
    description: "",
    status: "Open",
    severity: "Medium",
    owner: "",
    raisedDate: "2026-05-18",
    linkedTaskIds: [],
    causedByRaidIds: [],
    stakeholderIds: [],
    ...overrides,
  };
}

describe("TaskRow RAID badge", () => {
  test("shows the RAID badge when raidRefs is non-empty", () => {
    const ctx = makeContext();
    const { getByRole } = render(
      rowWrapper({
        context: ctx,
        children: (
          <TaskRow
            task={makeTask({ id: 11 })}
            isSelected={false}
            isEditing={false}            isPushing={false}
            raidRefs={[makeRaidItem({ id: 1 }), makeRaidItem({ id: 2 })]}
          />
        ),
      }),
    );
    // RaidBadge renders a button with aria-label matching "raidReferencedBy"
    // i18n key — EN value is "{0} RAID item(s) reference this task".
    expect(getByRole("button", { name: /raid item/i })).toBeTruthy();
  });

  test("renders no RAID badge when raidRefs is undefined (module disabled path)", () => {
    // task-manager passes raidRefs={undefined} (via an empty Map) when the
    // raid module is disabled — verify the badge is absent at the row level.
    const ctx = makeContext();
    const { queryByRole } = render(
      rowWrapper({
        context: ctx,
        children: (
          <TaskRow
            task={makeTask({ id: 12 })}
            isSelected={false}
            isEditing={false}            isPushing={false}
            raidRefs={undefined}
          />
        ),
      }),
    );
    expect(queryByRole("button", { name: /raid item/i })).toBeNull();
  });

  test("renders no RAID badge when raidRefs is an empty array (module disabled path)", () => {
    // An empty Map in task-manager produces raidRefs=[] per-row — same result.
    const ctx = makeContext();
    const { queryByRole } = render(
      rowWrapper({
        context: ctx,
        children: (
          <TaskRow
            task={makeTask({ id: 13 })}
            isSelected={false}
            isEditing={false}            isPushing={false}
            raidRefs={[]}
          />
        ),
      }),
    );
    expect(queryByRole("button", { name: /raid item/i })).toBeNull();
  });

  test("clicking the RAID badge calls onJumpToRaid with the task id", () => {
    const onJumpToRaid = vi.fn();
    const ctx = makeContext({ onJumpToRaid });
    const { getByRole } = render(
      rowWrapper({
        context: ctx,
        children: (
          <TaskRow
            task={makeTask({ id: 14 })}
            isSelected={false}
            isEditing={false}            isPushing={false}
            raidRefs={[makeRaidItem({ id: 1 })]}
          />
        ),
      }),
    );
    fireEvent.click(getByRole("button", { name: /raid item/i }));
    expect(onJumpToRaid).toHaveBeenCalledWith(14);
  });
});

describe("TaskRow inline cell editing", () => {
  function renderRow(context: RowContextValue, task: Task) {
    return render(
      rowWrapper({
        context,
        children: (
          <TaskRow
            task={task}
            isSelected={false}
            isEditing={false}            isPushing={false}
            raidRefs={undefined}
          />
        ),
      }),
    );
  }

  test("double-clicking the name reveals an input (cancelling the deferred editor-open); typing + Enter commits a taskName patch", () => {
    vi.useFakeTimers();
    try {
      const onInlinePatch = vi.fn();
      const onEdit = vi.fn();
      const ctx = makeContext({ onInlinePatch, onEdit });
      const task = makeTask({ id: 40, taskName: "Old name" });
      const { getByRole, getByLabelText } = renderRow(ctx, task);

      // A real double-click fires click (schedules the deferred open) then dblclick
      // (which must cancel it and start inline rename).
      const btn = getByRole("button", { name: "Old name" });
      fireEvent.click(btn);
      fireEvent.doubleClick(btn);
      act(() => { vi.advanceTimersByTime(300); });
      expect(onEdit).not.toHaveBeenCalled(); // deferred open was cancelled

      const input = getByLabelText("Task name – Old name") as HTMLInputElement;
      fireEvent.change(input, { target: { value: "New name" } });
      fireEvent.keyDown(input, { key: "Enter" });
      expect(onInlinePatch).toHaveBeenCalledWith(40, { taskName: "New name" });
    } finally {
      vi.useRealTimers();
    }
  });

  test("single-clicking the due-date cell reveals a date input; change + blur commits a dueDate patch", () => {
    const onInlinePatch = vi.fn();
    const ctx = makeContext({ onInlinePatch });
    const task = makeTask({ id: 41, taskName: "Ship it", dueDate: "2026-07-01" });
    const { getByRole, getByLabelText } = renderRow(ctx, task);

    fireEvent.click(getByRole("button", { name: "Due date – Ship it" }));
    const input = getByLabelText("Due date – Ship it") as HTMLInputElement;
    expect(input.type).toBe("date");
    fireEvent.change(input, { target: { value: "2026-07-20" } });
    fireEvent.blur(input);

    expect(onInlinePatch).toHaveBeenCalledWith(41, { dueDate: "2026-07-20" });
  });

  test("Escape cancels an inline edit without committing", () => {
    const onInlinePatch = vi.fn();
    const ctx = makeContext({ onInlinePatch });
    const task = makeTask({ id: 42, taskName: "Keep me", startDate: "2026-07-01" });
    const { getByRole, getByLabelText, queryByLabelText } = renderRow(ctx, task);

    fireEvent.click(getByRole("button", { name: "Start date – Keep me" }));
    const input = getByLabelText("Start date – Keep me") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "2026-07-09" } });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(onInlinePatch).not.toHaveBeenCalled();
    // Editor closed → the labelled input is gone, the display button is back.
    expect(queryByLabelText("Start date – Keep me")?.tagName).toBe("BUTTON");
  });

  test("priority select commits the chosen value directly", () => {
    const onInlinePatch = vi.fn();
    const ctx = makeContext({ onInlinePatch });
    const task = makeTask({ id: 43, taskName: "Rank me", priority: "Low" });
    const { getByRole } = renderRow(ctx, task);

    fireEvent.click(getByRole("button", { name: "Priority – Rank me" }));
    const select = getByRole("combobox", { name: "Priority – Rank me" });
    fireEvent.change(select, { target: { value: "High" } });

    expect(onInlinePatch).toHaveBeenCalledWith(43, { priority: "High" });
  });

  test("Jira-synced rows render no inline edit affordance (read-only)", () => {
    const onInlinePatch = vi.fn();
    const ctx = makeContext({ onInlinePatch });
    const task = makeTask({ id: 44, taskName: "Synced", jiraKey: "LOP-9", assignee: "Alice" });
    const { queryByRole, getByText } = renderRow(ctx, task);

    // No editable buttons for the inline fields; plain display only.
    expect(queryByRole("button", { name: "Assignee – Synced" })).toBeNull();
    expect(queryByRole("button", { name: "Due date – Synced" })).toBeNull();
    expect(queryByRole("button", { name: "Priority – Synced" })).toBeNull();
    expect(getByText("Alice")).toBeTruthy();
  });

  test("assignee cell opens the ResourcePicker and commits name/email/resourceId on blur", () => {
    const onInlinePatch = vi.fn();
    const ctx = makeContext({ onInlinePatch });
    const task = makeTask({ id: 45, taskName: "Pick me", assignee: "Alice", assigneeEmail: "a@b.com" });
    const { getByRole } = renderRow(ctx, task);

    fireEvent.click(getByRole("button", { name: "Assignee – Pick me" }));
    const combo = getByRole("combobox", { name: "Assignee – Pick me" }) as HTMLInputElement;
    fireEvent.change(combo, { target: { value: "Bob" } }); // free-text breaks any FK link
    fireEvent.blur(combo);

    expect(onInlinePatch).toHaveBeenCalledWith(45, {
      assignee: "Bob",
      assigneeEmail: "a@b.com",
      resourceId: undefined,
    });
  });

  // The reported bug, end to end on the surface it was reported on: clearing a
  // LINKED assignee inline must empty the cell, not merely drop the FK behind an
  // unchanged name.
  test("clearing a linked assignee inline commits an empty name, email and FK", () => {
    const onInlinePatch = vi.fn();
    const resource = makeResource({ id: 7, firstName: "Alice", lastName: "Smith", email: "alice@x.com" });
    const ctx = makeContext({
      onInlinePatch,
      resources: [resource],
      resourcesById: new Map([[7, resource]]),
    });
    const task = makeTask({
      id: 48,
      taskName: "Linked",
      assignee: "Alice Smith",
      assigneeEmail: "alice@x.com",
      resourceId: 7,
    });
    const { getByRole } = renderRow(ctx, task);

    fireEvent.click(getByRole("button", { name: "Assignee – Linked" }));
    const combo = getByRole("combobox", { name: "Assignee – Linked" }) as HTMLInputElement;
    expect(combo).toHaveValue("Alice Smith");

    const clearBtn = getByRole("button", { name: /^clear$/i });
    // jsdom has no focus-follows-mousedown, so this cannot reproduce the real
    // blur race — the preventDefault that stops it is guarded upstream in
    // resource-picker.test.tsx. Dispatched only to match the real event order.
    fireEvent.mouseDown(clearBtn);
    fireEvent.click(clearBtn);
    expect(combo).toHaveValue(""); // the visible field empties immediately

    fireEvent.blur(combo);
    expect(onInlinePatch).toHaveBeenCalledWith(48, {
      assignee: "",
      assigneeEmail: "",
      resourceId: undefined,
    });
  });

  test("double-clicking the blockers cell opens a textarea and commits a blockers patch on blur", () => {
    const onInlinePatch = vi.fn();
    const ctx = makeContext({ onInlinePatch });
    const task = makeTask({ id: 47, taskName: "Block me", blockers: "waiting on X" });
    const { getByText, getByLabelText } = renderRow(ctx, task);

    fireEvent.doubleClick(getByText("waiting on X"));
    const area = getByLabelText("Blockers – Block me") as HTMLTextAreaElement;
    fireEvent.change(area, { target: { value: "waiting on Y" } });
    fireEvent.blur(area);

    expect(onInlinePatch).toHaveBeenCalledWith(47, { blockers: "waiting on Y" });
  });

  // Replaces "relations cell exposes an edit button that opens the dependency
  // editor popover". That popover wrote through live via `onInlinePatch` and had
  // no draft, so it could not stage a successor link; it is deleted rather than
  // given a second commit model, and editing now lives only in the task modal.
  test("relations cell is read-only chips — no inline edit affordance", () => {
    const ctx = makeContext();
    const task = makeTask({ id: 48, taskName: "Relate me", dependencies: [{ taskId: 12, type: "FS" }] });
    const { getByTitle } = renderRow(ctx, task);

    // ★ The positive observable comes FIRST and on purpose: the absence
    // assertion below would pass just as well against a cell that rendered
    // nothing at all, so something has to prove this cell really is the
    // relations cell and really has a link in it.
    const chip = getByTitle(/#12 \(FS\)/);
    const cell = chip.closest("td");
    expect(cell).not.toBeNull();
    expect(cell!.querySelectorAll("button")).toHaveLength(0);
  });
});

describe("TaskRow linked-documents badge", () => {
  const doc = (id: number, links: DocEntityRef[]): ProjectDocument => ({
    id,
    title: `Doc ${id}`,
    blocks: [],
    createdAt: "2026-06-01T00:00:00.000Z",
    updatedAt: "2026-06-01T00:00:00.000Z",
    linkedEntities: links,
  });

  // Built with the REAL indexer over real documents, so the (kind, id) key
  // derivation is exercised end to end rather than stubbed. `doc(12)` is a DECOY
  // linking raid:7 while Alpha IS task 7 — a count keyed on the bare id inflates
  // Alpha to 3 and fails.
  const documentsByEntity = indexDocumentsByEntity([
    doc(10, [{ kind: "task", id: 7 }, { kind: "task", id: 8 }]),
    doc(11, [{ kind: "task", id: 7 }]),
    doc(12, [{ kind: "raid", id: 7 }]),
  ]);

  // THREE rows on purpose. Two carry a badge with DIFFERENT counts (2 vs 1), so
  // a hardcoded number cannot pass and the `– <taskName>` qualifier is proved to
  // make the name row-unique (WCAG 2.4.6 — axe has no rule for a duplicate
  // accessible name at any seed size, so this test is the only detector).
  function renderRows(onOpenDocuments = vi.fn()) {
    const utils = render(
      rowWrapper({
        context: makeContext(),
        children: [
          makeTask({ id: 7, taskName: "Alpha" }),
          makeTask({ id: 8, taskName: "Beta" }),
          makeTask({ id: 9, taskName: "Gamma" }),
        ].map((task) => (
          <TaskRow
            key={task.id}
            task={task}
            isSelected={false}
            isEditing={false}
            isPushing={false}
            raidRefs={undefined}
            documentsByEntity={documentsByEntity}
            onOpenDocuments={onOpenDocuments}
          />
        )),
      }),
    );
    return { ...utils, onOpenDocuments };
  }

  test("badges only the referenced rows, with the real count and a row-unique name", () => {
    const { getAllByRole, queryByRole, container } = renderRows();
    const badges = getAllByRole("button", { name: /^Referenced by/ });
    expect(badges.map((b) => b.getAttribute("aria-label"))).toEqual([
      "Referenced by 2 document(s) – Alpha",
      "Referenced by 1 document(s) – Beta",
    ]);
    // Gamma links no document → no badge at all (not a badge reading 0).
    expect(queryByRole("button", { name: /Referenced by .* – Gamma/ })).toBeNull();
    expectRowUniqueNames({ minControls: 29, scope: container });
  });

  test("clicking a badge opens the Documents pane for THAT task", () => {
    const { getByRole, onOpenDocuments } = renderRows();
    fireEvent.click(getByRole("button", { name: "Referenced by 1 document(s) – Beta" }));
    expect(onOpenDocuments).toHaveBeenCalledWith(8);
  });
});
