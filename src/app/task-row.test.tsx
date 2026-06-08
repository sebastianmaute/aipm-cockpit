import { describe, test, expect, vi } from "vitest";
import { render, renderHook, act, fireEvent } from "@testing-library/react";
import React, { Profiler, type ReactNode, type ProfilerOnRenderCallback } from "react";
import {
  TaskRow,
  NotesCell,
  TaskActions,
  RowContextProvider,
  useTaskRowContext,
  type RowContextValue,
} from "./task-row";
import { type ChangeItem, type RaidItem, type Task } from "./types";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 1,
    taskName: "Sample task",
    assignee: "Alice",
    assigneeEmail: "",
    dueDate: "2026-12-01",
    lastUpdateDate: "2026-05-18",
    priority: "Medium",
    blockers: "",
    notes: "",
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
    jiraEnabled: false,
    jiraProjectKey: "",
    hiddenCols: new Set(),
    tasksById: new Map(),
    onToggleSelect: vi.fn(),
    onToggleNoteExpanded: vi.fn(),
    onJumpToRaid: vi.fn(),
    onToggleComplete: vi.fn(),
    onSendInquiry: vi.fn(),
    onPushToJira: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(),
    ...overrides,
  };
}

function rowWrapper({
  context,
  children,
}: {
  context: RowContextValue;
  children: ReactNode;
}) {
  // <tbody> wrapper required because TaskRow returns a <tr>.
  return (
    <table>
      <tbody>
        <RowContextProvider value={context}>{children}</RowContextProvider>
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
            isEditing={false}
            isExpanded={false}
            isPushing={false}
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
              isEditing={false}
              isExpanded={false}
              isPushing={false}
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
              isEditing={false}
              isExpanded={false}
              isPushing={false}
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
            isEditing={false}
            isExpanded={false}
            isPushing={false}
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
            isEditing={false}
            isExpanded={false}
            isPushing={false}
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
            isEditing
            isExpanded={false}
            isPushing={false}
            raidRefs={undefined}
            isStriped
          />
        ),
      }),
    );
    const tr = container.querySelector("tbody tr");
    expect(tr?.className).toContain("bg-AIPM-purple/10");
    expect(tr?.className).not.toContain("bg-surface-muted/40");
  });

  test("completed striped row composes the dim and the stripe tint", () => {
    const ctx = makeContext();
    const { container } = render(
      rowWrapper({
        context: ctx,
        children: (
          <TaskRow
            task={makeTask({ id: 5, completedDate: "2026-05-20" })}
            isSelected={false}
            isEditing={false}
            isExpanded={false}
            isPushing={false}
            raidRefs={undefined}
            isStriped
          />
        ),
      }),
    );
    const tr = container.querySelector("tbody tr");
    expect(tr?.className).toContain("opacity-60");
    expect(tr?.className).toContain("bg-surface-muted/40");
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

describe("NotesCell", () => {
  test("isolation: re-rendering cell A does not re-render cell B", () => {
    const ctx = makeContext();
    let setExpA: (b: boolean) => void = () => {};
    const renderSpyB = vi.fn<ProfilerOnRenderCallback>();

    function Harness() {
      const [expA, setExpALocal] = React.useState(false);
      setExpA = setExpALocal;
      const cellBTree = React.useMemo(
        () => (
          <Profiler id="cellB" onRender={renderSpyB}>
            <NotesCell
              notes="B note also long enough to trigger expansion behaviour with more than fifty characters of body text here."
              isExpanded={false}
              taskId={2}
            />
          </Profiler>
        ),
        [],
      );
      return (
        <table>
          <tbody>
            <tr>
              <td>
                <RowContextProvider value={ctx}>
                  <NotesCell
                    notes="A note long enough to trigger expansion behaviour with more than fifty characters of body text here."
                    isExpanded={expA}
                    taskId={1}
                  />
                </RowContextProvider>
              </td>
              <td>
                <RowContextProvider value={ctx}>{cellBTree}</RowContextProvider>
              </td>
            </tr>
          </tbody>
        </table>
      );
    }

    render(<Harness />);
    const before = renderSpyB.mock.calls.length;

    act(() => setExpA(true));

    expect(renderSpyB.mock.calls.length).toBe(before);
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
            isEditing={false}
            isExpanded={false}
            isPushing={false}
            raidRefs={undefined}
          />
        ),
      }),
    );
    fireEvent.click(getByRole("button", { name: /#7/ }));
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }));
  });

  test("opens the editor when the task name is clicked", () => {
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
            isEditing={false}
            isExpanded={false}
            isPushing={false}
            raidRefs={undefined}
          />
        ),
      }),
    );
    fireEvent.click(getByRole("button", { name: /review the deck/i }));
    expect(onEdit).toHaveBeenCalledWith(expect.objectContaining({ id: 7 }));
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
            isEditing={false}
            isExpanded={false}
            isPushing={false}
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
            isEditing={false}
            isExpanded={false}
            isPushing={false}
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
            isEditing={false}
            isExpanded={false}
            isPushing={false}
            raidRefs={undefined}
          />
        ),
      }),
    );
    expect(queryByText(/changes$/)).toBeNull();
  });
});

describe("TaskActions", () => {
  test("each button calls the corresponding handler with the right argument", () => {
    const ctx = makeContext({ jiraEnabled: true, jiraProjectKey: "MCP" });
    const task = makeTask({ id: 99 });

    const { getByText } = render(
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

    fireEvent.click(getByText("Mark complete"));
    expect(ctx.onToggleComplete).toHaveBeenCalledTimes(1);
    expect(ctx.onToggleComplete).toHaveBeenCalledWith(task);

    fireEvent.click(getByText("Edit"));
    expect(ctx.onEdit).toHaveBeenCalledTimes(1);
    expect(ctx.onEdit).toHaveBeenCalledWith(task);

    fireEvent.click(getByText("Delete"));
    expect(ctx.onDelete).toHaveBeenCalledTimes(1);
    expect(ctx.onDelete).toHaveBeenCalledWith(99);
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
            isEditing={false}
            isExpanded={false}
            isPushing={false}
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
            isEditing={false}
            isExpanded={false}
            isPushing={false}
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
            isEditing={false}
            isExpanded={false}
            isPushing={false}
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
            isEditing={false}
            isExpanded={false}
            isPushing={false}
            raidRefs={[makeRaidItem({ id: 1 })]}
          />
        ),
      }),
    );
    fireEvent.click(getByRole("button", { name: /raid item/i }));
    expect(onJumpToRaid).toHaveBeenCalledWith(14);
  });
});
