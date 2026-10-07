import { describe, test, expect, vi } from "vitest";
import { render, act } from "@testing-library/react";
import { createRef, useRef, type Ref } from "react";
import { TasksTable } from "./tasks-section-rows";
import { RowContextProvider, type RowContextValue } from "./task-row";
import { VIRTUALIZE_MIN_ROWS, type TaskRowWindowHandle } from "./use-task-row-window";
import { visibleTaskCols } from "./open-points-table-geometry";
import type { Task } from "./types";

// jsdom has no layout, so the real virtualizer computes nothing useful. The
// mock returns a FIXED window — rows 11..30 on a 40px grid — so these tests pin
// what the TABLE does with a window: which rows render, the spacer rows, and
// the aria row counts. The hook's own arithmetic is pinned in
// use-task-row-window.test.tsx.
const ROW_PX = 40;
// ★ ODD on purpose: an even start gives the window's first row the same stripe
// parity whether the stripe reads the list index or the slice index.
const WINDOW_START = 11;
const WINDOW_END = 31; // exclusive
const measureElementSpy = vi.fn();
const scrollToIndexSpy = vi.fn();
// `pinned.index` adds one row far from the window, the way the range extractor
// does for a focused row (use-task-row-window.ts `withPinnedIndex`).
const pinned: { index: number | null } = { index: null };

vi.mock("@tanstack/react-virtual", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-virtual")>()),
  useVirtualizer: (opts: { count: number }) => {
    const indexes: number[] = [];
    for (let i = WINDOW_START; i < Math.min(WINDOW_END, opts.count); i++) indexes.push(i);
    if (pinned.index !== null) indexes.push(pinned.index);
    indexes.sort((a, b) => a - b);
    const items = indexes.map((i) => ({ index: i, start: i * ROW_PX, end: (i + 1) * ROW_PX, size: ROW_PX, key: i, lane: 0 }));
    return {
      getVirtualItems: () => items,
      getTotalSize: () => opts.count * ROW_PX,
      scrollToIndex: scrollToIndexSpy,
      measureElement: measureElementSpy,
      // What the hook reads as the window switches off (use-task-row-window.ts `measuredRows`).
      itemSizeCache: new Map(),
      measurementsCache: [],
    };
  },
}));

// Hide every optional column: the tests are about rows, and fewer cells keep
// a 250-row render fast in jsdom.
const HIDDEN = new Set([
  "status", "id", "assignee", "startDate", "dueDate", "lastUpdateDate", "createdDate", "priority",
  "taskStatus", "blockers", "description", "notesLog", "depRelations", "estimate", "spent",
]);
const VISIBLE_COLS = visibleTaskCols(HIDDEN);

function makeTasks(n: number): Task[] {
  return Array.from({ length: n }, (_, i) => ({
    id: i + 1,
    taskName: `Task ${i + 1}`,
    assignee: "",
    assigneeEmail: "",
    dueDate: "",
    lastUpdateDate: "2026-05-18",
    status: "To Do",
    priority: "Medium",
    blockers: "",
    description: "",
    group: "",
    labels: [],
    dependencies: [],
  }));
}

const CONTEXT: RowContextValue = {
  lang: "en-US",
  today: "2026-05-18",
  holidaySet: new Set(),
  jiraSiteUrl: "",
  jiraExtraProjects: [],
  jiraEnabled: false,
  jiraProjectKey: "",
  hiddenCols: HIDDEN,
  onToggleSelect: vi.fn(),
  onOpenNotes: vi.fn(),
  onOpenBlockers: vi.fn(),
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
};

const TH = { sortKey: null, sortDir: "asc" as const, onSort: vi.fn(), onResize: vi.fn() };

function Harness({ tasks, handle }: { tasks: Task[]; handle?: Ref<TaskRowWindowHandle> }) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  return (
    <div ref={scrollRef}>
      <RowContextProvider value={CONTEXT}>
        <TasksTable
          lang="en-US"
          visibleCols={VISIBLE_COLS}
          sizedWidths={{}}
          tableMinWidth={600}
          th={TH}
          hiddenCols={HIDDEN}
          startColResize={vi.fn()}
          allVisibleSelected={false}
          toggleSelectAllVisible={vi.fn()}
          visibleRows={tasks}
          visibleColumnCount={VISIBLE_COLS.length}
          tableTokens={new Map()}
          selectedIds={new Set()}
          editingId={null}
          pushingIds={new Set()}
          raidByTask={new Map()}
          changeByTask={new Map()}
          documentsByEntity={new Map()}
          onOpenDocuments={vi.fn()}
          onJumpToChanges={vi.fn()}
          flashId={null}
          onAdd={vi.fn()}
          scrollRef={scrollRef}
          rowWindowRef={handle ?? null}
        />
      </RowContextProvider>
    </div>
  );
}

const taskRows = (c: HTMLElement) => Array.from(c.querySelectorAll<HTMLTableRowElement>("tbody tr[data-deeplink-row]"));
const spacerRows = (c: HTMLElement) => Array.from(c.querySelectorAll<HTMLTableRowElement>("tbody tr[data-row-spacer]"));

describe("TasksTable — virtualized row window (§5)", () => {
  test(`renders every row at ${VIRTUALIZE_MIN_ROWS} rows and no spacer rows`, () => {
    const { container } = render(<Harness tasks={makeTasks(VIRTUALIZE_MIN_ROWS)} />);
    expect(taskRows(container)).toHaveLength(VIRTUALIZE_MIN_ROWS);
    expect(spacerRows(container)).toHaveLength(0);
    // Below the threshold the table is exactly today's: no aria row counts.
    expect(container.querySelector("table")!.hasAttribute("aria-rowcount")).toBe(false);
    expect(taskRows(container)[0].hasAttribute("aria-rowindex")).toBe(false);
    expect(taskRows(container)[0].hasAttribute("data-index")).toBe(false);
  });

  test(`renders only the window plus two aria-hidden spacer rows above ${VIRTUALIZE_MIN_ROWS} rows`, () => {
    const count = 250;
    const { container } = render(<Harness tasks={makeTasks(count)} />);
    const rows = taskRows(container);
    expect(rows.map((r) => r.getAttribute("data-deeplink-row"))).toEqual(
      Array.from({ length: WINDOW_END - WINDOW_START }, (_, k) => String(WINDOW_START + k + 1)),
    );
    const spacers = spacerRows(container);
    expect(spacers).toHaveLength(2);
    const [top, bottom] = spacers;
    for (const s of spacers) {
      expect(s.getAttribute("aria-hidden")).toBe("true");
      // One cell spanning the gutter plus every visible column, so a spacer
      // can never narrow the table or shift a <col> width.
      expect(s.cells).toHaveLength(1);
      expect(s.cells[0].colSpan).toBe(VISIBLE_COLS.length + 1);
    }
    expect(top.cells[0].style.height).toBe(`${WINDOW_START * ROW_PX}px`);
    expect(bottom.cells[0].style.height).toBe(`${(count - WINDOW_END) * ROW_PX}px`);
    // Order: top spacer, the window, bottom spacer.
    const tbodyRows = Array.from(container.querySelectorAll("tbody > tr"));
    expect(tbodyRows.indexOf(top)).toBeLessThan(tbodyRows.indexOf(rows[0]));
    expect(tbodyRows.indexOf(bottom)).toBeGreaterThan(tbodyRows.indexOf(rows[rows.length - 1]));
  });

  test("keeps the stripe on the row's position in the whole list, not in the window", () => {
    const { container } = render(<Harness tasks={makeTasks(250)} />);
    // Window starts at list index 11 (odd) → its first row IS striped, the second is NOT.
    const [first, second] = taskRows(container);
    expect(first.className).toContain("bg-surface-muted/40");
    expect(second.className).not.toContain("bg-surface-muted/40");
  });

  test("sets aria-rowcount on the table and aria-rowindex on every rendered row", () => {
    const count = 250;
    const { container } = render(<Harness tasks={makeTasks(count)} />);
    // Header row + every task + the trailing "+ Add task" row.
    expect(container.querySelector("table")!.getAttribute("aria-rowcount")).toBe(String(count + 2));
    expect(container.querySelector("thead tr")!.getAttribute("aria-rowindex")).toBe("1");
    taskRows(container).forEach((r, k) => {
      // Header is row 1, so the task at list index i is row i + 2.
      expect(r.getAttribute("aria-rowindex")).toBe(String(WINDOW_START + k + 2));
    });
    const addRow = container.querySelector("tbody > tr:last-child")!;
    expect(addRow.getAttribute("aria-rowindex")).toBe(String(count + 2));
  });

  test("hands every rendered row to the virtualizer to measure, tagged with its list index", () => {
    measureElementSpy.mockClear();
    const { container } = render(<Harness tasks={makeTasks(250)} />);
    const rows = taskRows(container);
    expect(measureElementSpy.mock.calls.map(([el]) => el)).toEqual(rows);
    rows.forEach((r, k) => expect(r.getAttribute("data-index")).toBe(String(WINDOW_START + k)));
  });

  test("renders every row and no spacer while printing", () => {
    const { container } = render(<Harness tasks={makeTasks(250)} />);
    expect(taskRows(container)).toHaveLength(WINDOW_END - WINDOW_START);
    act(() => {
      window.dispatchEvent(new Event("beforeprint"));
    });
    expect(taskRows(container)).toHaveLength(250);
    expect(spacerRows(container)).toHaveLength(0);
    act(() => {
      window.dispatchEvent(new Event("afterprint"));
    });
    expect(taskRows(container)).toHaveLength(WINDOW_END - WINDOW_START);
  });

  test("a spacer row draws no divide-y border (an inline border: 0 beats the utility)", () => {
    const { container } = render(<Harness tasks={makeTasks(250)} />);
    for (const sp of spacerRows(container)) expect(sp.style.border).toMatch(/^0(px)?/);
  });

  test("renders a focused row held outside the window with its own spacer before it", () => {
    pinned.index = 200;
    try {
      const count = 250;
      const { container } = render(<Harness tasks={makeTasks(count)} />);
      const rows = taskRows(container);
      expect(rows.at(-1)!.getAttribute("data-index")).toBe("200");
      expect(rows.at(-1)!.getAttribute("aria-rowindex")).toBe("202");
      const spacers = spacerRows(container);
      // Leading, the gap between the window and row 200, trailing.
      expect(spacers.map((sp) => sp.cells[0].style.height)).toEqual([
        `${WINDOW_START * ROW_PX}px`,
        `${(200 - WINDOW_END) * ROW_PX}px`,
        `${(count - 201) * ROW_PX}px`,
      ]);
      const tbodyRows = Array.from(container.querySelectorAll("tbody > tr"));
      expect(tbodyRows.indexOf(spacers[1])).toBe(tbodyRows.indexOf(rows.at(-1)!) - 1);
    } finally {
      pinned.index = null;
    }
  });

  test("hands the window's scrollToIndex to the pane through rowWindowRef", () => {
    scrollToIndexSpy.mockClear();
    const handle = createRef<TaskRowWindowHandle>();
    render(<Harness tasks={makeTasks(250)} handle={handle} />);
    handle.current!.scrollToIndex(120);
    expect(scrollToIndexSpy).toHaveBeenCalledWith(120, { align: "center" });
  });

  test("drops back to the plain path with no spacer when a filter takes the count from 250 to 150", () => {
    const all = makeTasks(250);
    const { container, rerender } = render(<Harness tasks={all} />);
    expect(spacerRows(container)).toHaveLength(2);
    rerender(<Harness tasks={all.slice(0, 150)} />);
    expect(taskRows(container)).toHaveLength(150);
    expect(spacerRows(container)).toHaveLength(0);
    expect(container.querySelector("table")!.hasAttribute("aria-rowcount")).toBe(false);
  });
});
