import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { TestProviders } from "./test-providers";
import { useFilters } from "./filters-context";
import { useViewDigest, type ViewDigestInput } from "./use-view-digest";
import { defaultSettings } from "./settings-types";
import { saveProjectAppearance } from "./project-appearance-prefs";
import type { ProjectAppearancePref } from "./project-appearance-prefs";
import type { Settings, SettingsOverrides } from "./settings-types";
import type { Resource, Task } from "./types";

function task(id: number, name: string, over: Partial<Task> = {}): Task {
  return {
    id,
    taskName: name,
    status: "To Do",
    priority: "Medium",
    assignee: "Ana",
    group: "",
    dueDate: "2026-09-01",
    startDate: "",
    completedDate: "",
    createdDate: "2026-08-01",
    lastUpdateDate: "2026-08-01",
    blockers: "",
    description: "",
    inquiriesSent: 0,
    labels: [],
    ...over,
  } as Task;
}

/** Minimal real Resource — only `.length` is read, but the input type is
 *  `readonly Resource[]`, so build the real shape rather than casting. */
function resource(id: number): Resource {
  return { id, firstName: `P${id}`, lastName: "X", roleId: null } as Resource;
}

/** Every field the hook reads, with the pane-level narrowings off by default. */
function input(over: Partial<ViewDigestInput> = {}): ViewDigestInput {
  const tasks = over.tasks ?? [];
  return {
    view: "open-points",
    tasks,
    filteredSortedTasks: tasks,
    effectiveFilters: { assignee: "All", group: "All", label: "All" },
    resources: [],
    budgets: [],
    milestones: [],
    today: "2026-08-05",
    settings: defaultSettings,
    settingsProjectId: "default",
    holidaySet: new Set<string>(),
    ...over,
  };
}

function render(inp: ViewDigestInput, tune?: (f: ReturnType<typeof useFilters>) => void) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <TestProviders>{children}</TestProviders>
  );
  const hook = renderHook(
    () => ({ digest: useViewDigest(inp), filters: useFilters() }),
    { wrapper },
  );
  if (tune) act(() => tune(hook.result.current.filters));
  return hook;
}

function withSettings(over: Partial<Settings>): Settings {
  return { ...defaultSettings, ...over };
}

describe("useViewDigest — open-points counts the rows the TABLE renders", () => {
  // ★★★ THE DEFECT THIS HOOK EXISTS TO FIX. `filteredSortedTasks` is upstream
  // of BOTH the health filter and hide-finished, so the digest used to name
  // rows the user could not see while telling the model to trust it over a
  // tool call. visible-task-rows.ts records the same bug being fixed once
  // before, for select-all.
  it("excludes finished tasks when the pane is hiding them", () => {
    const tasks = [
      task(1, "Open one"),
      task(2, "Open two"),
      task(3, "Shipped", { status: "Done", completedDate: "2026-08-02" }),
      task(4, "Dropped", { status: "Cancelled" }),
    ];
    const { result } = render(
      input({ tasks, settings: withSettings({ hideFinishedTasks: true }) }),
    );
    // 2, not 4 — Done AND Cancelled are both "finished" (isTaskClosed).
    expect(result.current.digest).toContain("2 task(s) visible");
    expect(result.current.digest).not.toContain("Shipped");
    expect(result.current.digest).not.toContain("Dropped");
  });

  it("counts every row when the pane is not hiding finished tasks", () => {
    const tasks = [
      task(1, "Open one"),
      task(2, "Shipped", { status: "Done", completedDate: "2026-08-02" }),
    ];
    const { result } = render(input({ tasks }));
    expect(result.current.digest).toContain("2 task(s) visible");
  });

  // ★★★ THE TWO LISTS MUST BE DISTINGUISHABLE. Everywhere else in this file
  // the fixture sets `filteredSortedTasks === tasks`, which is convenient but
  // means those tests CANNOT tell which of the two a branch reads: swapping
  // open-points to `tasks`, or gantt to `filteredSortedTasks`, survives all of
  // them. Pass a strict subset here and pin each branch to its own source.
  it("open-points reads the filtered list while gantt reads the raw one", () => {
    const tasks = [task(1, "A"), task(2, "B"), task(3, "C")];
    const filteredSortedTasks = [tasks[0]];
    const open = render(input({ view: "open-points", tasks, filteredSortedTasks }));
    expect(open.result.current.digest).toContain("1 task(s) visible");
    const gantt = render(input({ view: "gantt", tasks, filteredSortedTasks }));
    expect(gantt.result.current.digest).toContain("3 task(s)");
  });

  // ★★ The RAG health filter is one of the three pane values this hook exists
  // to reach (see its header) — untested, `visibleTaskRows(..., "all", ...)`
  // would be a silent no-op and the digest would name rows the table hides.
  it("applies the RAG health filter, and names it as active", () => {
    const tasks = [
      task(1, "Overdue one", { dueDate: "2026-07-01" }),
      task(2, "Comfortably future", { dueDate: "2027-06-01" }),
    ];
    const { result } = render(input({ tasks }), (f) => f.setHealthFilter("red"));
    expect(result.current.digest).toContain("1 task(s) visible");
    expect(result.current.digest).toContain("health=red");
    expect(result.current.digest).not.toContain("No filters active");
  });
});

describe("useViewDigest — filters beyond assignee/group/label", () => {
  // ★★★ "No filters active — the table shows every task" is the sentence that
  // tells the model it need not call a tool. TaskFilterValues covers only
  // three keys, so a search or priority filter used to leave that sentence
  // standing while it hid most of the table.
  it("names an active search rather than claiming no filters are active", () => {
    const tasks = [task(1, "Budget review")];
    // setSearchImmediate, not setSearch: the hook reads `searchDebounced`,
    // which is the same value `filteredSortedTasks` filters on.
    const { result } = render(input({ tasks }), (f) => f.setSearchImmediate("budget"));
    expect(result.current.digest).not.toContain("No filters active");
    expect(result.current.digest).toContain('search="budget"');
  });

  // ★★★ THE CLEAR DIRECTION, which is the dangerous one. Reading the RAW box
  // value made this emit "No filters active — the table shows every task" over
  // a row set still narrowed by the old query, for the ~150 ms until the
  // debounce caught up: the exact under-report the extraFilters list exists to
  // prevent, with the reassuring sentence attached. Here raw is cleared while
  // debounced still holds "budget" — the digest must still name the filter.
  // ★ Mechanism note: `setSearchImmediate` sets an OVERRIDE that the provider
  // clears only when the underlying `useDebounce` value changes, and no timer
  // is advanced here — so the two values diverge via that override, not via a
  // real 150 ms window. The assertion is still non-vacuous (it fails if the
  // hook reads raw `search`), but it does not exercise `useDebounce` itself.
  it("keeps naming the search while the box is cleared but the rows are still filtered", () => {
    const tasks = [task(1, "Budget review")];
    const { result } = render(input({ tasks }), (f) => {
      f.setSearchImmediate("budget");
      f.setSearch("");
    });
    expect(result.current.digest).toContain('search="budget"');
    expect(result.current.digest).not.toContain("No filters active");
  });

  it("names an active priority filter", () => {
    const tasks = [task(1, "Urgent thing", { priority: "High" })];
    const { result } = render(input({ tasks }), (f) => f.setPriorityFilter("High"));
    expect(result.current.digest).not.toContain("No filters active");
    expect(result.current.digest).toContain("priority=High");
  });

  // ★★ hide-externals narrows UPSTREAM of this hook — workspace-context filters
  // `visibleTasks` by isExternalTask before filteredSortedTasks is built — so
  // rows genuinely vanish from the count, and this push is the ONLY thing
  // stopping the digest calling that "no filters active".
  it("names hide-externals as a filter, since it narrows the table upstream", () => {
    const { result } = render(
      input({
        tasks: [task(1, "Open one")],
        settings: withSettings({ hideExternalTasks: true }),
      }),
    );
    expect(result.current.digest).not.toContain("No filters active");
    expect(result.current.digest).toContain("external people's tasks hidden");
  });

  it("names hide-finished as a filter, since it narrows the table", () => {
    const { result } = render(
      input({ tasks: [task(1, "Open one")], settings: withSettings({ hideFinishedTasks: true }) }),
    );
    expect(result.current.digest).not.toContain("No filters active");
    expect(result.current.digest).toContain("finished tasks hidden");
  });

  // CONTROL: with genuinely nothing set the reassuring sentence must still
  // appear, or the two negatives above would pass against a digest that had
  // simply stopped emitting it.
  it("still says no filters are active when nothing narrows the table", () => {
    const { result } = render(input({ tasks: [task(1, "Open one")] }));
    expect(result.current.digest).toContain("No filters active");
  });
});

/** `true` when K is a key of T. Used below as a compile-time assertion. */
type HasKey<T, K extends string> = K extends keyof T ? true : false;

describe("useViewDigest — Open Points has three view modes", () => {
  // ★★★ hide-finished is TABLE-ONLY. The board and swimlanes render
  // `healthFilteredTasks` — health filter only — so their Done/Cancelled
  // columns still populate; `tasks-section.tsx` states this at both render
  // sites. Applying hide-finished unconditionally under-reported a board by
  // every finished card AND called the cards "rows in the table".
  const finishedFixture = () => [
    task(1, "Open one"),
    task(2, "Shipped", { status: "Done", completedDate: "2026-08-02" }),
  ];

  it("does NOT apply hide-finished on the board, and calls them cards", () => {
    const { result } = render(
      input({
        tasks: finishedFixture(),
        settings: withSettings({ hideFinishedTasks: true, tasksViewMode: "board" }),
      }),
    );
    expect(result.current.digest).toContain("2 task(s)");
    expect(result.current.digest).toContain("card(s) in the board");
    // ★ The SAMPLE line must follow the surface too. It hardcoded "Visible
    // rows:" after the count line had already been made mode-aware, so a board
    // digest named the wrong surface twice per message.
    expect(result.current.digest).toContain("Visible cards:");
    expect(result.current.digest).not.toContain("Visible rows:");
    // The toggle is real but inert here, so claiming it would name a filter
    // whose effect the user cannot see.
    expect(result.current.digest).not.toContain("finished tasks hidden");
  });

  // ★★★ THE PROJECT OVERRIDE IS THE WHOLE REASON `settingsProjectId` is threaded
  // task-manager → dispatcher → hook, and the reason for the
  // `useSyncExternalStore` subscription. Every other test in this file sets the
  // mode via device settings, so dropping `appearance.tasksViewMode ??` would
  // leave them all green while the digest named the wrong surface for any
  // project carrying an override.
  it("prefers this project's appearance override over the device default", () => {
    saveProjectAppearance("proj-override", { tasksViewMode: "board" });
    const { result } = render(
      input({
        tasks: finishedFixture(),
        settingsProjectId: "proj-override",
        settings: withSettings({ tasksViewMode: "table" }),
      }),
    );
    expect(result.current.digest).toContain("card(s) in the board");
    expect(result.current.digest).not.toContain("row(s) in the table");
  });

  it("names swimlanes as swimlanes", () => {
    const { result } = render(
      input({ tasks: finishedFixture(), settings: withSettings({ tasksViewMode: "swimlane" }) }),
    );
    expect(result.current.digest).toContain("card(s) in the swimlanes");
  });

  // CONTROL: the table keeps the old behaviour, so the three assertions above
  // cannot pass by the mode branch simply never applying hide-finished.
  it("still applies hide-finished in table mode", () => {
    const { result } = render(
      input({
        tasks: finishedFixture(),
        settings: withSettings({ hideFinishedTasks: true, tasksViewMode: "table" }),
      }),
    );
    expect(result.current.digest).toContain("1 task(s)");
    expect(result.current.digest).toContain("row(s) in the table");
    expect(result.current.digest).toContain("finished tasks hidden");
  });
});

describe("useViewDigest — device-vs-effective settings", () => {
  // ★★★ FORCING FUNCTION, NOT A BEHAVIOUR TEST. This hook reads
  // `hideFinishedTasks`/`hideExternalTasks` off the RAW device settings the
  // dispatcher is handed, while `tasks-section.tsx:319` reads them off
  // EFFECTIVE settings — and its comment warns that reading device "would
  // silently re-open the drift the shared visibleTaskRows() exists to close".
  // The two agree TODAY only because neither flag is overridable:
  // `resolveEffectiveSettings` touches nextActions, notifications, timezone,
  // additionalTimezones, dashboardDensity, showViewHints and tasksViewMode,
  // and nothing else.
  //
  // ★★ A RUNTIME test cannot guard this — a future override key would simply be
  // absent from any fixture I could write here, so the assertion would pass
  // while the drift shipped. These are TYPE assertions instead: add either flag
  // to `ProjectAppearancePref` and `HasKey` flips to `true`, assigning to
  // `false` becomes a tsc error, and CI fails at THIS comment, which says where
  // the fix goes — thread effective settings into `useViewDigest`.
  it("neither hide flag is a per-project appearance override", () => {
    const hideFinishedIsOverridable: HasKey<
      ProjectAppearancePref,
      "hideFinishedTasks"
    > = false;
    const hideExternalIsOverridable: HasKey<
      ProjectAppearancePref,
      "hideExternalTasks"
    > = false;
    expect(hideFinishedIsOverridable).toBe(false);
    expect(hideExternalIsOverridable).toBe(false);
  });

  // ★ The MIRROR. `resolveEffectiveSettings` folds TWO override sources onto the
  // device blob — per-project appearance (above) and the policy overrides that
  // travel with the project. Guarding only appearance leaves the policy path
  // open, and the drift would be identical.
  it("neither hide flag is a policy override either", () => {
    const hideFinishedIsPolicy: HasKey<SettingsOverrides, "hideFinishedTasks"> = false;
    const hideExternalIsPolicy: HasKey<SettingsOverrides, "hideExternalTasks"> = false;
    expect(hideFinishedIsPolicy).toBe(false);
    expect(hideExternalIsPolicy).toBe(false);
  });
});

describe("useViewDigest — the other views report project totals honestly", () => {
  it("does not apply the open-points narrowing to gantt, and says the counts are not the drawn bars", () => {
    const tasks = [
      task(1, "Open one"),
      task(2, "Shipped", { status: "Done", completedDate: "2026-08-02" }),
    ];
    const { result } = render(
      input({ view: "gantt", tasks, settings: withSettings({ hideFinishedTasks: true }) }),
    );
    // Still 2: hide-finished is an OPEN POINTS control and must not silently
    // reshape a Gantt count the chart never applied.
    expect(result.current.digest).toContain("2 task(s)");
    expect(result.current.digest).toContain("NOT the bars drawn");
  });

  it("tells the model the workload count is the directory, not the visible rows", () => {
    const { result } = render(
      input({ view: "workload", resources: [resource(1), resource(2)] }),
    );
    expect(result.current.digest).toContain("2 resource(s)");
    expect(result.current.digest).toContain("NOT reflected");
  });

  it("returns nothing for a view with no digest", () => {
    const { result } = render(input({ view: "settings" }));
    expect(result.current.digest).toBeUndefined();
  });
});
