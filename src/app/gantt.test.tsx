import React from "react";
import { describe, it, test, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, act, fireEvent, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GanttPanel } from "./gantt";
import { t } from "./i18n";
import { expectButtonOrder } from "../test/toolbar-order";
import { expectRowUniqueNames } from "../test/row-unique-names";
import { rowLabel } from "./row-tokens";
import { DEFAULT_PREFS, type GanttPrefs, savePrefs } from "./gantt-engine";
import type { Milestone, Task } from "./types";

// useResizable reads/writes localStorage — mock it so tests run in JSDOM.
vi.mock("./use-resizable", () => ({
  useResizable: () => ({ ref: { current: null }, size: 400 }),
}));

// ---------- helpers --------------------------------------------------------

/** Returns today as YYYY-MM-DD (UTC). */
function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** today + n calendar days (UTC). */
function dayPlus(n: number): string {
  const x = new Date();
  x.setUTCDate(x.getUTCDate() + n);
  return isoDay(x);
}

const BASE_TASKS: Task[] = [
  {
    id: 1,
    taskName: "A",
    assignee: "x",
    priority: "Medium" as const,
    startDate: dayPlus(-30),
    dueDate: dayPlus(30),
  } as unknown as Task,
];

const BASE_PROPS = {
  lang: "en-US" as const,
  tasks: BASE_TASKS,
  absences: [] as const,
};

// ---------- scroll tests ---------------------------------------------------
//
// Strategy: mock clientWidth / scrollWidth on HTMLElement.prototype BEFORE
// rendering so the very first useLayoutEffect call sees non-zero dimensions.
// Without this the effect still fires on mount, clamps scrollLeft to 0 (since
// scrollWidth - clientWidth = 0), latches didInitialScroll, and the later
// Object.defineProperty call on the instance no longer helps.

describe("GanttPanel scroll-to-today", () => {
  it("centers today in the viewport on initial mount", () => {
    // Install prototype mocks before render so the first useLayoutEffect
    // already sees realistic dimensions.
    const clientWidthSpy = vi
      .spyOn(HTMLElement.prototype, "clientWidth", "get")
      .mockReturnValue(800);
    const scrollWidthSpy = vi
      .spyOn(HTMLElement.prototype, "scrollWidth", "get")
      .mockReturnValue(4000);

    try {
      const { container } = render(<GanttPanel {...BASE_PROPS} />);

      // The scroll target is the outer overflow-auto panel (panelRef from
      // useResizable). Use min-w-[480px] to disambiguate from any inner
      // overflow-auto regions.
      const wrapper = container.querySelector("div.overflow-auto.min-w-\\[480px\\]") as HTMLDivElement | null;
      expect(wrapper).not.toBeNull();
      if (!wrapper) return;

      expect(wrapper.scrollLeft).toBeGreaterThan(0);
      expect(wrapper.scrollLeft).toBeLessThanOrEqual(4000 - 800);
    } finally {
      clientWidthSpy.mockRestore();
      scrollWidthSpy.mockRestore();
    }
  });

  it("does not re-scroll after the initial mount", () => {
    const clientWidthSpy = vi
      .spyOn(HTMLElement.prototype, "clientWidth", "get")
      .mockReturnValue(800);
    const scrollWidthSpy = vi
      .spyOn(HTMLElement.prototype, "scrollWidth", "get")
      .mockReturnValue(4000);

    try {
      const { container, rerender } = render(<GanttPanel {...BASE_PROPS} />);

      const wrapper = container.querySelector("div.overflow-auto.min-w-\\[480px\\]") as HTMLDivElement | null;
      expect(wrapper).not.toBeNull();
      if (!wrapper) return;

      const initialScroll = wrapper.scrollLeft;
      expect(initialScroll).toBeGreaterThan(0);

      // Simulate user scrolling manually.
      wrapper.scrollLeft = 100;

      // Re-render with extra task — should NOT reset scrollLeft.
      const tasks2 = [
        ...BASE_TASKS,
        {
          id: 2,
          taskName: "B",
          assignee: "y",
          priority: "Medium" as const,
          startDate: dayPlus(0),
          dueDate: dayPlus(15),
        } as unknown as Task,
      ];
      act(() => {
        rerender(<GanttPanel {...BASE_PROPS} tasks={tasks2} />);
      });

      expect(wrapper.scrollLeft).toBe(100); // preserved, not re-centered
    } finally {
      clientWidthSpy.mockRestore();
      scrollWidthSpy.mockRestore();
    }
  });
});

// ---------- milestone rows -------------------------------------------------

describe("GanttPanel milestones", () => {
  it("renders a milestone row with one task without crashing", () => {
    const milestones: Milestone[] = [
      {
        id: 100,
        name: "Beta",
        date: dayPlus(10),
        linkedTaskIds: [],
      },
    ];
    const { container, getByText } = render(
      <GanttPanel {...BASE_PROPS} milestones={milestones} />,
    );
    // The milestone name appears in the left gutter.
    expect(getByText("Beta")).toBeTruthy();
    // The diamond is an SVG rotated rect — at least one exists in the chart.
    expect(container.querySelector('rect[transform^="rotate(45"]')).not.toBeNull();
  });

  it("draws a connector path when a milestone links a task that has a bar", () => {
    // Task id 1 has a bar (BASE_TASKS). Linking it should emit a dashed,
    // muted connector path in the dependency overlay — not a critical-path
    // red edge.
    const milestones: Milestone[] = [
      {
        id: 101,
        name: "Gamma",
        date: dayPlus(10),
        linkedTaskIds: [1],
      },
    ];
    const { container } = render(
      <GanttPanel {...BASE_PROPS} milestones={milestones} />,
    );
    const connector = container.querySelector(
      'path[data-milestone-connector]',
    );
    expect(connector).not.toBeNull();
    // Informational, not critical-path: must not be the critical red.
    expect(connector?.getAttribute("stroke")).not.toBe("rgb(220, 38, 38)");
  });

  it("draws no connector for a linked task that has no bar", () => {
    // Task id 999 does not exist -> no bar -> connector is skipped.
    const milestones: Milestone[] = [
      {
        id: 102,
        name: "Delta",
        date: dayPlus(10),
        linkedTaskIds: [999],
      },
    ];
    const { container } = render(
      <GanttPanel {...BASE_PROPS} milestones={milestones} />,
    );
    expect(
      container.querySelector('path[data-milestone-connector]'),
    ).toBeNull();
  });
});

// ---------- milestone placement toggle -------------------------------------

describe("GanttPanel milestone placement toggle", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => window.localStorage.clear());

  const milestones: Milestone[] = [
    { id: 100, name: "Beta", date: dayPlus(10), linkedTaskIds: [] },
  ];

  // The toggle moved into the toolbar's "View" popover, so both cases must OPEN
  // it first — otherwise "not in the DOM" would hold for the trivial reason that
  // nothing is rendered until the popover opens. The assertions are unchanged.
  const openViewMenu = (getByRole: ReturnType<typeof render>["getByRole"]) => {
    act(() => {
      fireEvent.click(getByRole("button", { name: t("en-US", "ganttViewMenu") }));
    });
  };

  it("hides the toggle when there are no milestones", () => {
    const { getByRole, queryByRole } = render(<GanttPanel {...BASE_PROPS} />);
    openViewMenu(getByRole);
    // Sanity: the popover really is open (a control that is NOT milestone-gated).
    expect(queryByRole("button", { name: t("en-US", "ganttShowGrid") })).not.toBeNull();
    expect(queryByRole("button", { name: /inline milestones/i })).toBeNull();
  });

  it("shows a pinned-label toggle whose aria-pressed tracks inline mode", () => {
    const { getByRole } = render(
      <GanttPanel {...BASE_PROPS} milestones={milestones} />,
    );
    openViewMenu(getByRole);
    const btn = getByRole("button", { name: /inline milestones/i });
    // Label is pinned to what it ENABLES; default (below) → not pressed.
    expect(btn.getAttribute("aria-pressed")).toBe("false");
    act(() => {
      fireEvent.click(btn);
    });
    expect(btn.getAttribute("aria-pressed")).toBe("true");
  });
});

// ---------- dependency arrows ----------------------------------------------

describe("GanttPanel dependency arrows", () => {
  it("draws a dependency edge between two placeable tasks", () => {
    const tasks = [
      ...BASE_TASKS,
      {
        id: 2,
        taskName: "B",
        assignee: "y",
        priority: "Medium" as const,
        startDate: dayPlus(1),
        dueDate: dayPlus(10),
        dependencies: [{ taskId: 1, type: "FS" as const }],
      } as unknown as Task,
    ];
    const { container } = render(<GanttPanel {...BASE_PROPS} tasks={tasks} />);
    // The edge is the only <path> carrying a marker-end (the <defs> arrowhead
    // paths and milestone connectors don't).
    const edges = container.querySelectorAll("path[marker-end]");
    expect(edges.length).toBe(1);
  });

  it("skips edges whose predecessor id is not in the visible rows", () => {
    const tasks = [
      ...BASE_TASKS,
      {
        id: 2,
        taskName: "B",
        assignee: "y",
        priority: "Medium" as const,
        startDate: dayPlus(1),
        dueDate: dayPlus(10),
        dependencies: [{ taskId: 999, type: "FS" as const }],
      } as unknown as Task,
    ];
    const { container } = render(<GanttPanel {...BASE_PROPS} tasks={tasks} />);
    expect(container.querySelectorAll("path[marker-end]").length).toBe(0);
  });

  it("gives the edge real coordinates and the layer a real height", () => {
    // The presence assertions above hold even for a degenerate path (all-zero
    // `d`, zero-height <svg>) — which is one of the ways "the arrows exist but
    // nobody sees them" could have been true. None of this depends on layout:
    // every number comes from DAY_WIDTH_PX / ROW_HEIGHT_PX arithmetic, so jsdom
    // (which reports every rect as zero) can still check it.
    const tasks = [
      ...BASE_TASKS,
      {
        id: 2,
        taskName: "B",
        assignee: "y",
        priority: "Medium" as const,
        startDate: dayPlus(1),
        dueDate: dayPlus(10),
        dependencies: [{ taskId: 1, type: "FS" as const }],
      } as unknown as Task,
    ];
    const { container } = render(<GanttPanel {...BASE_PROPS} tasks={tasks} />);
    const edge = container.querySelector("path[marker-end]") as SVGPathElement | null;
    expect(edge).not.toBeNull();
    const d = edge?.getAttribute("d") ?? "";
    const nums = [...d.matchAll(/-?\d+(?:\.\d+)?/g)].map((mm) => Number(mm[0]));
    expect(nums.length).toBeGreaterThan(0);
    expect(nums.every((n) => Number.isFinite(n))).toBe(true);
    expect(nums.some((n) => n !== 0)).toBe(true);
    // The two endpoints sit on DIFFERENT rows — a collapsed y would draw a flat
    // line hidden inside one row's own separator.
    const yStart = nums[1];
    const yEnd = nums[nums.length - 1];
    expect(yStart).not.toBe(yEnd);

    const svg = edge?.ownerSVGElement;
    expect(Number(svg?.getAttribute("height"))).toBeGreaterThan(0);
  });

  it("draws the non-critical edge heavily enough to read against the row lines", () => {
    // Pins the A3 values. The old 0.45 / 1.25 composited EDGE_STROKE_MUTED to a
    // pale grey; this is the only guard on that, since jsdom cannot measure
    // anything and axe scans neither opacity nor an aria-hidden overlay.
    const tasks = [
      ...BASE_TASKS,
      {
        id: 2,
        taskName: "B",
        assignee: "y",
        priority: "Medium" as const,
        startDate: dayPlus(1),
        dueDate: dayPlus(10),
        dependencies: [{ taskId: 1, type: "FS" as const }],
      } as unknown as Task,
    ];
    const { container } = render(<GanttPanel {...BASE_PROPS} tasks={tasks} />);
    const edge = container.querySelector("path[marker-end]");
    expect(edge?.getAttribute("stroke-opacity")).toBe("0.7");
    expect(edge?.getAttribute("stroke-width")).toBe("1.5");
  });
});

// ---------- dependency overlay ↔ the View popover's toggle ------------------
//
// The layer rendered unconditionally until now: `prefs.showDependencies` existed
// and drove a toggle, but nothing read it. Both directions matter — without the
// "on" case, deleting the layer outright would still satisfy the "off" case.

describe("GanttPanel dependency toggle", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => window.localStorage.clear());

  // savePrefs over the FULL default blob, not a bare `{ v: 2, showDependencies }`
  // — a v2 blob with no `statuses` key hydrates to an empty selection, which
  // shows no rows at all and would make every assertion here pass or fail for
  // the wrong reason.
  const seedPrefs = (patch: Partial<GanttPrefs>): void =>
    savePrefs({ ...DEFAULT_PREFS, ...patch });

  const DEP_TASKS: Task[] = [
    ...BASE_TASKS,
    {
      id: 2,
      taskName: "B",
      assignee: "y",
      priority: "Medium" as const,
      startDate: dayPlus(1),
      dueDate: dayPlus(10),
      dependencies: [{ taskId: 1, type: "FS" as const }],
    } as unknown as Task,
  ];

  it("draws the edges when showDependencies is on", () => {
    seedPrefs({ showDependencies: true });
    const { container } = render(<GanttPanel {...BASE_PROPS} tasks={DEP_TASKS} />);
    expect(container.querySelectorAll("path[marker-end]").length).toBe(1);
  });

  it("draws none when showDependencies is off", () => {
    seedPrefs({ showDependencies: false });
    const { container } = render(<GanttPanel {...BASE_PROPS} tasks={DEP_TASKS} />);
    expect(container.querySelectorAll("path[marker-end]").length).toBe(0);
    // The task rows themselves are untouched — this hides an overlay, not data.
    expect(screen.getByText("B")).toBeInTheDocument();
  });

  it("takes the milestone connectors down with it", () => {
    // The connectors live in the SAME <svg>, so the toggle governs both. Stated
    // here so the coupling is a pinned decision rather than an accident.
    seedPrefs({ showDependencies: false });
    const { container } = render(
      <GanttPanel
        {...BASE_PROPS}
        milestones={[
          { id: 1, name: "Gamma", date: dayPlus(10), linkedTaskIds: [1] } as unknown as Milestone,
        ]}
      />,
    );
    expect(container.querySelector("path[data-milestone-connector]")).toBeNull();
  });
});

// ---------- source-scan tests (Task 6: toolbar ordering + pane resize) ------

test("gantt toolbar: + Add Task markup precedes the search input", () => {
  // Toolbar markup lives in gantt-chrome.tsx (GanttToolbar) since the
  // GanttPanel decomposition; the ordering guarantee moved with it.
  const src = readFileSync(join(__dirname, "gantt-chrome.tsx"), "utf8");
  const addIdx = src.indexOf("onClick={onAddTask}");
  const searchIdx = src.indexOf('type="search"');
  expect(addIdx).toBeGreaterThan(-1);
  expect(addIdx).toBeLessThan(searchIdx);
});

test("gantt pane uses VIEW_PANE_RESIZABLE_CLASS", () => {
  const src = readFileSync(join(__dirname, "gantt.tsx"), "utf8");
  expect(src).toMatch(/VIEW_PANE_RESIZABLE_CLASS/);
});

// ---------- print button ---------------------------------------------------

test("gantt toolbar renders a Print button", () => {
  const { getByRole } = render(<GanttPanel {...BASE_PROPS} />);
  const btn = getByRole("button", { name: /print/i });
  expect(btn).toBeTruthy();
});

test("gantt root pane has print-root and print-landscape classes", () => {
  const src = readFileSync(join(__dirname, "gantt.tsx"), "utf8");
  expect(src).toMatch(/print-root/);
  expect(src).toMatch(/print-landscape/);
});

// ---------- resizable task-name column (Task 1) ----------------------------

describe("GanttPanel task-name column resize", () => {
  const KEY = "aipm-cockpit:gantt-namecol";

  it("persists a resize drag and clears it on reset", () => {
    window.localStorage.removeItem(KEY);
    const { getByLabelText } = render(<GanttPanel {...BASE_PROPS} />);

    // The reset control is present in the toolbar.
    const resetBtn = getByLabelText(/reset the task name column width/i);
    expect(resetBtn).toBeTruthy();

    // Drag the gutter's right-edge handle +80px → 240 default + 80 = 320.
    const handle = getByLabelText(/resize the task name column/i);
    fireEvent.mouseDown(handle, { clientX: 100 });
    act(() => {
      fireEvent.mouseMove(window, { clientX: 180 });
      fireEvent.mouseUp(window);
    });
    expect(JSON.parse(window.localStorage.getItem(KEY) as string)).toBe(320);

    // Reset clears the persisted width.
    act(() => {
      fireEvent.click(resetBtn);
    });
    expect(window.localStorage.getItem(KEY)).toBeNull();
  });
});

describe("GanttPanel effective assignee names (stale resource-link)", () => {
  // Two tasks linked to the SAME resource (id 7, live name "Live") but each
  // carrying a DIFFERENT stale cached `assignee` string. The Gantt must group /
  // filter / list by the live resource name, not the stale caches.
  const RESOURCES = [
    {
      id: 7,
      firstName: "Live",
      lastName: "",
      roleId: null,
      utilizationMode: "percent" as const,
      utilization: {},
    },
  ] as unknown as import("./types").Resource[];

  const STALE_TASKS: Task[] = [
    {
      id: 1,
      taskName: "A",
      assignee: "Old A",
      resourceId: 7,
      priority: "Medium" as const,
      startDate: dayPlus(-10),
      dueDate: dayPlus(10),
    } as unknown as Task,
    {
      id: 2,
      taskName: "B",
      assignee: "Old B",
      resourceId: 7,
      priority: "Medium" as const,
      startDate: dayPlus(-5),
      dueDate: dayPlus(15),
    } as unknown as Task,
  ];

  it("lists the live resource name in the assignee filter, collapsing the stale caches", () => {
    const { getByRole, queryByRole } = render(
      <GanttPanel {...BASE_PROPS} tasks={STALE_TASKS} resources={RESOURCES} />,
    );
    // Open the multi-select Assignee popover and read its checkbox options.
    fireEvent.click(getByRole("button", { name: "Assignee" }));
    expect(getByRole("checkbox", { name: "Live" })).toBeTruthy();
    expect(queryByRole("checkbox", { name: "Old A" })).toBeNull();
    expect(queryByRole("checkbox", { name: "Old B" })).toBeNull();
  });

  it("filters both stale-named tasks under the single live resource name", () => {
    const { getByRole } = render(
      <GanttPanel
        {...BASE_PROPS}
        tasks={STALE_TASKS}
        resources={RESOURCES}
        onEditTask={() => {}}
      />,
    );
    fireEvent.click(getByRole("button", { name: "Assignee" }));
    act(() => {
      fireEvent.click(getByRole("checkbox", { name: "Live" }));
    });
    // Both rows remain visible because each task's EFFECTIVE assignee is "Live".
    expect(getByRole("button", { name: "A" })).toBeTruthy();
    expect(getByRole("button", { name: "B" })).toBeTruthy();
  });
});

describe("GanttPanel multi-select filter semantics", () => {
  // Gantt prefs persist in localStorage; clear so selections don't bleed.
  beforeEach(() => window.localStorage.clear());
  afterEach(() => window.localStorage.clear());

  const TASKS: Task[] = [
    { id: 1, taskName: "HighTask", assignee: "Alice", priority: "High", startDate: dayPlus(-10), dueDate: dayPlus(10) } as unknown as Task,
    { id: 2, taskName: "LowTask", assignee: "Bob", priority: "Low", startDate: dayPlus(-10), dueDate: dayPlus(10) } as unknown as Task,
  ];

  it("ORs within the priority filter — selecting two priorities shows the union", () => {
    const { getByRole, queryByRole } = render(<GanttPanel {...BASE_PROPS} tasks={TASKS} onEditTask={() => {}} />);
    fireEvent.click(getByRole("button", { name: /Priority/ }));
    // Select High only → only HighTask shows.
    fireEvent.click(getByRole("checkbox", { name: "High" }));
    expect(getByRole("button", { name: "HighTask" })).toBeTruthy();
    expect(queryByRole("button", { name: "LowTask" })).toBeNull();
    // Add Low → both show (OR within the filter).
    fireEvent.click(getByRole("checkbox", { name: "Low" }));
    expect(getByRole("button", { name: "HighTask" })).toBeTruthy();
    expect(getByRole("button", { name: "LowTask" })).toBeTruthy();
  });

  it("ANDs across filters — priority AND assignee both must match", () => {
    const { getByRole, queryByRole } = render(<GanttPanel {...BASE_PROPS} tasks={TASKS} onEditTask={() => {}} />);
    // Priority = High.
    fireEvent.click(getByRole("button", { name: /Priority/ }));
    fireEvent.click(getByRole("checkbox", { name: "High" }));
    // Assignee = Bob (Bob's task is Low, so the AND yields nothing).
    fireEvent.click(getByRole("button", { name: /Assignee/ }));
    fireEvent.click(getByRole("checkbox", { name: "Bob" }));
    expect(queryByRole("button", { name: "HighTask" })).toBeNull();
    expect(queryByRole("button", { name: "LowTask" })).toBeNull();
  });
});

describe("GanttPanel baseline ghost range folding", () => {
  it("folds a far baseline date into the range so the ghost diamond stays on-axis", () => {
    const milestones: Milestone[] = [
      { id: 1, name: "M1", date: dayPlus(0), linkedTaskIds: [] },
    ];
    // Baseline pinned ~200 days before the live milestone (a big slip). Without
    // folding it into the range, its ghost x would be far negative (off-axis).
    const baselineMilestoneDates = new Map<number, string>([[1, dayPlus(-200)]]);
    const { container } = render(
      <GanttPanel {...BASE_PROPS} milestones={milestones} baselineMilestoneDates={baselineMilestoneDates} />,
    );
    const ghost = container.querySelector("rect[fill='none'][stroke='var(--line)']");
    expect(ghost).not.toBeNull();
    expect(Number(ghost!.getAttribute("x"))).toBeGreaterThanOrEqual(0);
  });
});

// ---------- toolbar search clear (slice D) ---------------------------------

// ★ The task is named to MATCH the typed query on purpose. GanttPanel returns
// two structurally different trees (the `rowsCount === 0` empty-state branch vs
// the chart), so a query that filters every row away remounts the toolbar and
// the field loses focus mid-word — a pre-existing behaviour, unrelated to the
// clear button, that a non-matching fixture would let masquerade as a failure
// here (it truncated the typed value to "j").
test("gantt toolbar clears the search box from a labelled button", async () => {
  const user = userEvent.setup();
  const tasks = [{ ...BASE_TASKS[0], taskName: "Jira sync" }] as Task[];
  render(<GanttPanel {...BASE_PROPS} tasks={tasks} />);
  const field = screen.getByRole("searchbox", {
    name: t("en-US", "searchPlaceholder"),
  }) as HTMLInputElement;
  await user.type(field, "jira");
  expect(field.value).toBe("jira");
  await user.click(
    screen.getByRole("button", {
      name: `${t("en-US", "clear")} – ${t("en-US", "searchPlaceholder")}`,
    }),
  );
  expect(field.value).toBe("");
});

// ---------- dedupButton slot (slice F, Task 2) ------------------------------
//
// GanttPanel/GanttToolbar don't build the AI dedup trigger themselves (that's
// gantt-view.tsx's job, Task 3) — they just render whatever ReactNode the
// caller hands them, in the same toolbar slot the Open Points toolbar uses
// (Add · [Jira sync] · dedup · search).

describe("GanttPanel dedupButton slot", () => {
  it("renders a passed dedupButton inside the toolbar", () => {
    render(
      <GanttPanel
        {...BASE_PROPS}
        dedupButton={<button type="button">Dedup trigger</button>}
      />,
    );
    expect(screen.getByRole("button", { name: "Dedup trigger" })).toBeInTheDocument();
  });

  it("places the dedupButton after Add task and before the search input in DOM order", () => {
    render(
      <GanttPanel
        {...BASE_PROPS}
        onAddTask={() => {}}
        dedupButton={<button type="button">Dedup trigger</button>}
      />,
    );
    const dedupBtn = screen.getByRole("button", { name: "Dedup trigger" });
    // Scope the neighbour lookups to the toolbar itself — the chart body also
    // renders an unrelated "Add task" row-affordance with the same accessible
    // name, which a document-wide query would collide with.
    const toolbar = dedupBtn.parentElement as HTMLElement;
    const addTaskBtn = within(toolbar).getByRole("button", { name: t("en-US", "addTaskButton") });
    const searchField = within(toolbar).getByRole("searchbox", { name: t("en-US", "searchPlaceholder") });

    // Node.DOCUMENT_POSITION_FOLLOWING (4): addTaskBtn precedes dedupBtn.
    expect(addTaskBtn.compareDocumentPosition(dedupBtn) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    // dedupBtn precedes searchField.
    expect(dedupBtn.compareDocumentPosition(searchField) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it("renders nothing extra when dedupButton is omitted", () => {
    const { queryByRole } = render(<GanttPanel {...BASE_PROPS} />);
    expect(queryByRole("button", { name: "Dedup trigger" })).toBeNull();
  });

  it("shows the dedupButton in the empty-state branch too (no tasks, no milestones)", () => {
    render(
      <GanttPanel
        {...BASE_PROPS}
        tasks={[]}
        dedupButton={<button type="button">Dedup trigger</button>}
      />,
    );
    expect(screen.getByRole("button", { name: "Dedup trigger" })).toBeInTheDocument();
  });
});

// ---------- v2 status filter semantics (Task 8) ----------------------------
//
// Under the v2 prefs schema an EMPTY `statuses` array means "show nothing", not
// "show everything", and the milestone rows obey the same buckets. These tests
// seed the persisted prefs blob directly (stamped `v: 2` so loadPrefs leaves an
// empty status list alone instead of migrating it to "all ticked").

describe("GanttPanel v2 status filter", () => {
  const PREFS_KEY = "aipm-cockpit:gantt-prefs";
  beforeEach(() => window.localStorage.clear());
  afterEach(() => window.localStorage.clear());

  function seedPrefs(partial: Record<string, unknown>) {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify({ v: 2, ...partial }));
  }

  function mkTask(over: Partial<Task> & { id: number; taskName: string }): Task {
    return {
      assignee: "x",
      priority: "Medium" as const,
      startDate: dayPlus(-10),
      dueDate: dayPlus(10),
      ...over,
    } as unknown as Task;
  }

  it("shows nothing and says why when no status is ticked", () => {
    seedPrefs({ statuses: [] });
    render(
      <GanttPanel
        {...BASE_PROPS}
        tasks={[mkTask({ id: 1, taskName: "Visible normally" })]}
      />,
    );
    expect(screen.queryByText("Visible normally")).toBeNull();
    expect(
      screen.getByText(t("en-US", "ganttNoStatusSelected")),
    ).toBeInTheDocument();
  });

  it("still says why when the chart itself renders (milestones present)", () => {
    // A project with milestones takes the full-chart branch rather than the
    // `rowsCount === 0 && no milestones` early return, so the message has to
    // exist on BOTH paths.
    seedPrefs({ statuses: [] });
    render(
      <GanttPanel
        {...BASE_PROPS}
        tasks={[mkTask({ id: 1, taskName: "Visible normally" })]}
        milestones={[
          { id: 1, name: "Pending", date: dayPlus(30), linkedTaskIds: [] } as unknown as Milestone,
        ]}
      />,
    );
    expect(screen.queryByText("Visible normally")).toBeNull();
    expect(screen.queryByText("Pending")).toBeNull();
    expect(
      screen.getByText(t("en-US", "ganttNoStatusSelected")),
    ).toBeInTheDocument();
  });

  it("explains a non-empty selection that matches nothing, instead of a blank grid", () => {
    // The sibling of the no-status case, and the one that had no message: a
    // status IS ticked, but neither the task nor the milestone lands in it. The
    // milestone keeps `sortedMilestones.length > 0`, so the whole-panel early
    // return is NOT taken and the chart body used to render a header and a
    // today marker over nothing at all.
    seedPrefs({ statuses: ["overdue"] });
    render(
      <GanttPanel
        {...BASE_PROPS}
        tasks={[mkTask({ id: 1, taskName: "Later", dueDate: dayPlus(10) })]}
        milestones={[
          { id: 1, name: "Pending", date: dayPlus(30), linkedTaskIds: [] } as unknown as Milestone,
        ]}
      />,
    );
    expect(screen.queryByText("Later")).toBeNull();
    expect(screen.queryByText("Pending")).toBeNull();
    // "No matches" — a filter IS narrowing, and it is not the empty-selection case.
    expect(screen.getByText(t("en-US", "ganttNoMatches"))).toBeInTheDocument();
    expect(screen.queryByText(t("en-US", "ganttNoStatusSelected"))).toBeNull();
  });

  it("hides a cancelled task when only 'open' is ticked", () => {
    seedPrefs({ statuses: ["open"] });
    render(
      <GanttPanel
        {...BASE_PROPS}
        tasks={[mkTask({ id: 1, taskName: "Dropped", status: "Cancelled" })]}
      />,
    );
    expect(screen.queryByText("Dropped")).toBeNull();
  });

  it("shows a cancelled task under 'completed'", () => {
    seedPrefs({ statuses: ["completed"] });
    render(
      <GanttPanel
        {...BASE_PROPS}
        tasks={[mkTask({ id: 1, taskName: "Dropped", status: "Cancelled" })]}
      />,
    );
    expect(screen.getByText("Dropped")).toBeInTheDocument();
  });

  it("keeps a cancelled task out of the 'overdue' bucket", () => {
    // The bar ends in the past, so the pre-v2 code would have called it
    // overdue. Cancelled work is closed, not late.
    seedPrefs({ statuses: ["overdue"] });
    render(
      <GanttPanel
        {...BASE_PROPS}
        tasks={[
          mkTask({
            id: 1,
            taskName: "Dropped",
            status: "Cancelled",
            startDate: dayPlus(-20),
            dueDate: dayPlus(-10),
          }),
        ]}
      />,
    );
    expect(screen.queryByText("Dropped")).toBeNull();
  });

  it("filters milestone rows by the status buckets", () => {
    seedPrefs({ statuses: ["completed"] });
    render(
      <GanttPanel
        {...BASE_PROPS}
        tasks={[]}
        milestones={[
          {
            id: 1,
            name: "Shipped",
            date: dayPlus(-30),
            achievedDate: dayPlus(-30),
            linkedTaskIds: [],
          } as unknown as Milestone,
          { id: 2, name: "Pending", date: dayPlus(30), linkedTaskIds: [] } as unknown as Milestone,
        ]}
      />,
    );
    expect(screen.getByText("Shipped")).toBeInTheDocument();
    expect(screen.queryByText("Pending")).toBeNull();
  });

  it("hides every milestone when the milestones toggle is off", () => {
    seedPrefs({ statuses: ["open", "completed", "overdue"], showMilestones: false });
    render(
      <GanttPanel
        {...BASE_PROPS}
        tasks={[]}
        milestones={[
          { id: 1, name: "Pending", date: dayPlus(30), linkedTaskIds: [] } as unknown as Milestone,
        ]}
      />,
    );
    expect(screen.queryByText("Pending")).toBeNull();
  });

  it("draws no milestone connector for a milestone the SHOW-MILESTONES toggle hid", () => {
    // Connector layer and the row list must see the SAME milestone set — a
    // connector drawn to a row index that no longer exists points at nothing.
    // NOTE the input: all three statuses are ticked, so this is the toggle arm
    // of `visibleMilestones`, not the bucket arm. The bucket arm is the test
    // below (this one used to be titled as though it covered both).
    seedPrefs({ statuses: ["open", "completed", "overdue"], showMilestones: false });
    const { container } = render(
      <GanttPanel
        {...BASE_PROPS}
        milestones={[
          { id: 1, name: "Gamma", date: dayPlus(10), linkedTaskIds: [1] } as unknown as Milestone,
        ]}
      />,
    );
    expect(container.querySelector("path[data-milestone-connector]")).toBeNull();
  });

  it("draws no milestone connector for a milestone the STATUS BUCKET hid", () => {
    // The bucket arm. The task must land in the ticked bucket so at least one
    // row renders — otherwise the chart body's empty state takes over and the
    // connector would be absent for a reason that has nothing to do with the
    // milestone filter.
    seedPrefs({ statuses: ["completed"] });
    const { container } = render(
      <GanttPanel
        {...BASE_PROPS}
        tasks={[
          mkTask({
            id: 1,
            taskName: "Shipped",
            status: "Done",
            completedDate: dayPlus(-2),
            startDate: dayPlus(-10),
            dueDate: dayPlus(-2),
          }),
        ]}
        milestones={[
          // Unachieved and future → bucket "open" → filtered out.
          { id: 1, name: "Gamma", date: dayPlus(10), linkedTaskIds: [1] } as unknown as Milestone,
        ]}
      />,
    );
    // The chart really did render (so the assertion below is not vacuous).
    expect(screen.getByText("Shipped")).toBeInTheDocument();
    expect(screen.queryByText("Gamma")).toBeNull();
    expect(container.querySelector("path[data-milestone-connector]")).toBeNull();
  });

  it("reads an empty project as 'no tasks yet', not 'filtered out', under default prefs", () => {
    // Default v2 prefs tick every status, so a `statuses.length > 0` test for
    // "a filter is active" would mislabel an untouched, empty project.
    render(<GanttPanel {...BASE_PROPS} tasks={[]} />);
    expect(screen.getByText(t("en-US", "ganttEmpty"))).toBeInTheDocument();
    expect(screen.queryByText(t("en-US", "ganttNoMatches"))).toBeNull();
  });
});

// ---------- bar drag-editability -------------------------------------------
//
// `editable` in gantt-rows.tsx moved from a completedDate test to `isTaskClosed`
// (Done OR Cancelled), so a CANCELLED bar lost its drag handles. That was an
// unmentioned behaviour change; this pins it. Tested through the panel rather
// than the row so it covers the wiring (`onUpdateBar` threading) too.

describe("GanttPanel bar drag handles", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => window.localStorage.clear());

  const mk = (over: Partial<Task> & { id: number; taskName: string }): Task =>
    ({
      assignee: "x",
      priority: "Medium" as const,
      startDate: dayPlus(-10),
      dueDate: dayPlus(10),
      ...over,
    }) as unknown as Task;

  it("gives an active task a move handle when onUpdateBar is wired", () => {
    render(
      <GanttPanel
        {...BASE_PROPS}
        tasks={[mk({ id: 1, taskName: "Live" })]}
        onUpdateBar={() => {}}
      />,
    );
    expect(
      // ★ The handle labels are row-qualified (WCAG 2.4.6 — three identical
      // names per row would otherwise repeat across every editable task), so
      // the whole-string RTL `name` match has to carry the row token too.
      screen.getAllByRole("button", {
        name: rowLabel(t("en-US", "ganttBarMove"), "Live"),
      }),
    ).toHaveLength(1);
  });

  it("gives a cancelled task none", () => {
    render(
      <GanttPanel
        {...BASE_PROPS}
        tasks={[mk({ id: 1, taskName: "Dropped", status: "Cancelled" })]}
        onUpdateBar={() => {}}
      />,
    );
    // The row is still rendered (default prefs tick "completed") — it is only
    // the drag affordance that is gone.
    expect(screen.getByText("Dropped")).toBeInTheDocument();
    expect(
      screen.queryAllByRole("button", {
        name: rowLabel(t("en-US", "ganttBarMove"), "Dropped"),
      }),
    ).toHaveLength(0);
  });
});

// ---------- toolbar order ---------------------------------------------------

describe("GanttToolbar control order", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => window.localStorage.clear());

  it("keeps Print · reset-columns · reset-size as the contiguous trailing group", () => {
    render(<GanttPanel {...BASE_PROPS} />);
    // `contiguous` is what catches a control drifting BETWEEN two members —
    // plain ordering would still read as ascending and miss it.
    expectButtonOrder(["printHint", "ganttResetNameCol", "tableResetSizeHint"], {
      contiguous: true,
    });
  });

  it("puts the View menu before that trailing group", () => {
    render(<GanttPanel {...BASE_PROPS} />);
    // A leading control only has to PRECEDE the group, so no `contiguous` here.
    expectButtonOrder(["ganttViewMenu", "printHint"]);
  });
});

// ---------- display toggles → overlay wiring --------------------------------
//
// gantt-overlays.test.tsx proves the two layers themselves. THESE tests prove
// the seam the leaf tests can't see: that the panel actually mounts them, gated
// on the right pref, and that the absence bands are gated too. jsdom has no
// layout engine, so nothing here (or anywhere) can check that a grid line lines
// up with its day label — that stays eye-only.

describe("GanttPanel display toggles", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => window.localStorage.clear());

  /** Seed the persisted prefs blob the panel hydrates from on mount. */
  function seedPrefs(patch: Partial<GanttPrefs>): void {
    savePrefs({ ...DEFAULT_PREFS, ...patch });
  }

  const ABSENT_TASKS: Task[] = [
    {
      id: 1,
      taskName: "A",
      assignee: "Ada",
      priority: "Medium" as const,
      startDate: dayPlus(-3),
      dueDate: dayPlus(3),
    } as unknown as Task,
  ];
  const ABSENCES = [
    {
      id: 7,
      assignee: "Ada",
      type: "vacation",
      startDate: dayPlus(-1),
      endDate: dayPlus(1),
    },
  ] as unknown as React.ComponentProps<typeof GanttPanel>["absences"];

  it("draws no day grid by default and one line per day once showGrid is on", () => {
    const { container: off } = render(<GanttPanel {...BASE_PROPS} />);
    expect(off.querySelectorAll("[data-grid-line]")).toHaveLength(0);

    seedPrefs({ showGrid: true });
    const { container: on } = render(<GanttPanel {...BASE_PROPS} />);
    // One rule per day column in the derived window — a non-empty count is the
    // claim; the exact window width is the range memo's business, not this test's.
    expect(on.querySelectorAll("[data-grid-line]").length).toBeGreaterThan(0);
  });

  it("shades a holiday that falls inside the window, and stops when showHolidays is off", () => {
    const holidaySet = new Set([dayPlus(0), dayPlus(1)]);
    const { container: on } = render(
      <GanttPanel {...BASE_PROPS} holidaySet={holidaySet} />,
    );
    // Both seeded days sit inside the window (it always includes today plus
    // padding), so the count is exact rather than merely non-zero.
    expect(on.querySelectorAll("[data-holiday]")).toHaveLength(2);

    seedPrefs({ showHolidays: false });
    const { container: off } = render(
      <GanttPanel {...BASE_PROPS} holidaySet={holidaySet} />,
    );
    expect(off.querySelectorAll("[data-holiday]")).toHaveLength(0);
  });

  it("shades no holiday when the caller passes none (the default backend state)", () => {
    const { container } = render(<GanttPanel {...BASE_PROPS} />);
    expect(container.querySelectorAll("[data-holiday]")).toHaveLength(0);
  });

  it("draws absence bands by default and drops them when showAbsences is off", () => {
    const { container: on } = render(
      <GanttPanel {...BASE_PROPS} tasks={ABSENT_TASKS} absences={ABSENCES} />,
    );
    expect(on.querySelectorAll("[data-absence]")).toHaveLength(1);

    seedPrefs({ showAbsences: false });
    const { container: off } = render(
      <GanttPanel {...BASE_PROPS} tasks={ABSENT_TASKS} absences={ABSENCES} />,
    );
    expect(off.querySelectorAll("[data-absence]")).toHaveLength(0);
  });
});

// ---------- WCAG 2.4.6: row-unique accessible names -------------------------
//
// ★★★ THE AXE GATE CANNOT CATCH THIS, in this view or any other, at any seed
// size: of axe-core 4.12.1's 105 rules, the 69 carrying a tag `e2e/a11y.spec.ts`
// requests contain NOT ONE that flags two controls sharing an accessible name.
// Gantt IS in `A11Y_VIEWS`, so a green scan says nothing here — this test is
// the only detector that can exist for the surface.
//
// ★★ IT LIVES IN THIS FILE, NOT `gantt-rows.test.tsx`, ON PURPOSE. The defect
// is that the token map has to REACH the row: the map is built by `GanttPanel`
// (a per-row component has no sibling visibility and cannot disambiguate
// itself) and threaded through `GanttChart`. Rendering `GanttTaskRow` in
// isolation with a hand-made token passes with that threading severed.

describe("GanttPanel row-unique accessible names", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => window.localStorage.clear());

  const mk = (over: Partial<Task> & { id: number; taskName: string }): Task =>
    ({
      assignee: "x",
      priority: "Medium" as const,
      startDate: dayPlus(-10),
      dueDate: dayPlus(10),
      ...over,
    }) as unknown as Task;

  const mkMilestone = (id: number, name: string): Milestone =>
    ({ id, name, date: dayPlus(20), linkedTaskIds: [] }) as unknown as Milestone;

  it("keeps every per-row control distinct when two tasks and two milestones share a name", () => {
    const { container } = render(
      <GanttPanel
        {...BASE_PROPS}
        tasks={[mk({ id: 1, taskName: "Alpha" }), mk({ id: 2, taskName: "Alpha" })]}
        milestones={[mkMilestone(1, "M1"), mkMilestone(2, "M1")]}
        onEditTask={() => {}}
        onEditMilestone={() => {}}
        onUpdateBar={() => {}}
      />,
    );

    // ★ Whole-container scope, per `expectRowUniqueNames`' guidance: the Gantt
    // toolbar carries no collision of its own to dodge, so there is nothing to
    // justify narrowing — and narrowing would drop the bar-drag handles, which
    // are part of what this test covers.
    // ★ `minControls` is the MEASURED control count for this fixture, not a
    // round number. It only proves the scope is non-empty; kept exact so a
    // silently narrowed `roles` array cannot slip past while
    // `requireCollisionSeed` is satisfied by some unrelated pair.
    expectRowUniqueNames({
      scope: container,
      minControls: 18,
      requireCollisionSeed: true,
    });

    // The uniqueness scan alone cannot say the names are the RIGHT ones — it is
    // equally satisfied by two differently-broken labels. Pin each of the three
    // fixed surfaces positively.
    expect(screen.getByRole("button", { name: "Alpha (1)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Alpha (2)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "M1 (1)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "M1 (2)" })).toBeInTheDocument();
    for (const key of ["ganttBarResizeStart", "ganttBarMove", "ganttBarResizeEnd"] as const) {
      expect(
        screen.getByRole("button", { name: rowLabel(t("en-US", key), "Alpha (1)") }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: rowLabel(t("en-US", key), "Alpha (2)") }),
      ).toBeInTheDocument();
    }
  });

  it("qualifies a task and a milestone that share a name, across the kind boundary", () => {
    // ★★ THE CROSS-KIND CASE, and the reason GanttPanel builds ONE token map
    // rather than one per row kind. Task rows and milestone rows are siblings
    // in a single view, so a task called "Sync" and a milestone called "Sync"
    // are two controls with one accessible name — the same 2.4.6 failure as
    // two tasks. Numbering each kind against only its own siblings leaves both
    // BARE: each is unique within its kind, so neither gets a suffix, and the
    // test above cannot see it because its two collisions are within-kind.
    const { container } = render(
      <GanttPanel
        {...BASE_PROPS}
        tasks={[mk({ id: 1, taskName: "Sync" })]}
        milestones={[mkMilestone(1, "Sync")]}
        onEditTask={() => {}}
        onEditMilestone={() => {}}
      />,
    );

    // ★ No `onUpdateBar` here, so no bar-drag handles — the measured floor is
    // lower than the test above on purpose, and kept exact for the same reason.
    expectRowUniqueNames({
      scope: container,
      minControls: 10,
      requireCollisionSeed: true,
    });
    expect(screen.getByRole("button", { name: "Sync (1)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sync (2)" })).toBeInTheDocument();
  });
});
