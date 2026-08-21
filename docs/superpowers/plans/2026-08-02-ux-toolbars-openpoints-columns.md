# UX Toolbars + Open Points Column Geometry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the Planning "Hide externals" toggle next to the Outlook sync block, make "Suggest RACI" lead the RACI toolbar, and stop the Open Points table wasting horizontal space in its narrow utility columns.

**Architecture:** Two are pure JSX reorders in presentational toolbars. The third changes table geometry: `useColumnResize` starts returning the *raw* user-sized width map beside the merged one; `tasks-section` binds to the raw map so it can tell "user sized this" from "default", makes `taskName` the single auto-width column that absorbs all leftover, and computes the table's `minWidth` from a new pure module instead of relying on `width: max-content`.

**Tech Stack:** Next.js 16 / React 19 / TypeScript / Tailwind v4 / vitest + @testing-library/react / Playwright + axe.

---

## Background you need before touching anything

Read `docs/superpowers/specs/2026-08-02-ux-toolbars-openpoints-columns-design.md` first. Then the following, which the plan depends on and which are not obvious:

**1. Never read a gate's exit code through a pipe.** `npm run test:run | tail` reports *tail's* status — a failing suite reads as green, and the diagnostic is discarded. Same with grep. Always:

```bash
npm run test:run > /tmp/suite.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/suite.log
npx eslint --max-warnings=0 src/app; echo "EXIT=$?"     # no pipe at all
```

**2. `npm run lint` does NOT reproduce the CI gate.** It is bare `eslint` with no `--max-warnings`, so it exits 0 with warnings present. The gate is `npx eslint --max-warnings=0 src/app`. An unused import or variable is FATAL there.

**3. The file-size ratchet is at zero headroom on two files.** `docs/baselines/file-sizes.json` records `src/app/tasks-section.tsx => 1043` (currently 1042) and `src/app/task-manager.tsx => 2966` (currently 2965). `npm run size:check` is BLOCKING in CI and fails on a baselined file that grows past its entry. This plan is designed to stay within +1 line on each; Task 5 checks it explicitly. Do not "just update the baseline" — that defeats the ratchet.

**4. jsdom has no layout engine.** Every `getBoundingClientRect` is 0. Assert the *emitted style attribute* and the *computed number*, never a rendered pixel width.

**5. `react-hooks/exhaustive-deps` rejects an `obj.member` or `?.length` expression in a dependency array**, and it is fatal under `--max-warnings=0`. Hoist to a scalar local and depend on that.

**6. Run tests from the repo root** (`C:\Projects\aipm-wt-a`), e.g. `npx vitest run src/app/use-column-resize.test.ts`.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `src/app/resources-panel-toolbar.tsx` | Modify (~line 86) | Presentational Planning/Calendar control rows. Moves one `ReactNode` slot. |
| `src/app/resources-panel.test.tsx` | Modify (append test) | Asserts Planning DOM order. |
| `src/app/raci-panel.tsx` | Modify (~lines 170, 239) | RACI matrix orchestrator. Moves the Suggest button between two flex groups. |
| `src/app/raci-panel.test.tsx` | Modify (append test) | Asserts RACI DOM order. |
| `src/app/use-column-resize.ts` | Modify | Shared width/drag/reset hook. Gains a v2 persist payload + a `sizedWidths` return. 19 consumers must be unaffected. |
| `src/app/use-column-resize.test.ts` | Modify (append tests) | v1 read / v2 round-trip / reset semantics. |
| `src/app/open-points-table-geometry.ts` | **Create** | Pure, i18n-free: which columns are visible, the table's minimum width, and the per-column emitted width. No React, no DOM. |
| `src/app/open-points-table-geometry.test.ts` | **Create** | Unit tests for the above. Required — a new `.ts` file is coverage-gated. |
| `src/app/use-column-manager.ts` | Modify | Open Points column state. Bumps the tableId and re-exports `sizedWidths`. Not baselined, so line growth is free here. |
| `src/app/use-column-manager.test.ts` | Modify (append test) | Storage-key bump. |
| `src/app/task-manager.tsx` | Modify (lines 220, 2374) | Orchestrator. Swaps *which* map it passes as `colWidths`. Must be net **0** lines. |
| `src/app/tasks-section.tsx` | Modify (~lines 114, 931–944) | Open Points pane. Table geometry. Must be net **≤ +1** line. |
| `src/app/tasks-section.test.tsx` | Modify (append tests) | colgroup + minWidth assertions. |
| `src/app/use-column-manager.ts` `DEFAULT_COL_WIDTHS` | Modify (lines 26, 39, 42) | New declared widths. |

---

### Task 1: Planning toolbar — move "Hide externals" next to the Outlook block

**Files:**
- Modify: `src/app/resources-panel-toolbar.tsx:86-87`
- Test: `src/app/resources-panel.test.tsx` (append inside the existing top-level `describe("ResourcesPanel", …)`)

Context: `PlanningToolbar` currently renders `{hideExternalToggle}` as the last child of the left control group, then `<div className="ml-auto">{headerActions}</div>`. `headerActions` (built in `resources-panel.tsx`) contains the Outlook `CalendarSyncControls` block followed by Print · reset-columns · reset-size. The Workload header (`renderWorkloadHeader`) already renders `{hideExternalToggle}{headerActions}` adjacent — Planning is the outlier.

- [ ] **Step 1: Write the failing test**

Append to `src/app/resources-panel.test.tsx`. Note `calendarProps` and `PLAN` already exist in this file (declared around line 493) — reuse them, do not redeclare.

```tsx
  // The Planning row used to render Hide-externals at the end of the LEFT group,
  // with `ml-auto` pushing the Outlook block away from it, while the Workload
  // header already rendered the two adjacent. Same pane, two arrangements.
  // ★ `CalendarSyncControls` returns null unless m365Configured && !isPopout &&
  //   onToggleCalendar — without `calendarProps` there is no Outlook checkbox to
  //   order against and this assertion would pass vacuously.
  test("planning: Hide externals sits immediately before the Outlook sync block", () => {
    render(
      <ResourcesPanel {...baseProps} {...calendarProps} view="planning" lang="en-US" plan={PLAN}
        workdayHours={8} holidaySet={new Set()} onSetUtilization={() => {}}
        onSetAbsenceOverride={() => {}} onSetPlanWindow={() => {}} />,
    );

    const hide = screen.getByRole("button", { name: t("en-US", "planningHideExternal") });
    const outlook = screen.getByRole("checkbox", {
      name: new RegExp(t("en-US", "calendarSyncEnable"), "i"),
    });

    // DOCUMENT_POSITION_FOLLOWING === 4: `outlook` comes after `hide` in DOM order.
    expect(hide.compareDocumentPosition(outlook) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    // …and nothing interactive sits between them.
    const between = Array.from(
      document.querySelectorAll("button, input, select"),
    ).filter((el) => {
      const afterHide = hide.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING;
      const beforeOutlook = outlook.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_PRECEDING;
      return Boolean(afterHide && beforeOutlook);
    });
    expect(between).toHaveLength(0);
  });
```

- [ ] **Step 2: Run the test and verify it FAILS**

```bash
npx vitest run src/app/resources-panel.test.tsx -t "Hide externals sits immediately before"
```

Expected: FAIL. Either the `compareDocumentPosition` assertion is falsy, or `between` contains the Print/reset buttons — because `hideExternalToggle` currently precedes the whole `ml-auto` group rather than sitting inside it.

★ If it PASSES here, stop. Either `calendarProps` did not render the checkbox (check the accessible name — grep `calendarSyncEnable` in `src/app/i18n.ts` and in `calendar-sync-controls.tsx` for how the entity label is appended) or you are asserting something that was already true. A green test at this step is a broken test, not a finished task.

- [ ] **Step 3: Make the change**

In `src/app/resources-panel-toolbar.tsx`, replace lines 86-87:

```jsx
        {hideExternalToggle}
        <div className="ml-auto">{headerActions}</div>
```

with:

```jsx
        <div className="ml-auto flex items-center gap-2">
          {hideExternalToggle}
          {headerActions}
        </div>
```

- [ ] **Step 4: Run the test and verify it PASSES**

```bash
npx vitest run src/app/resources-panel.test.tsx; echo "EXIT=$?"
```

Expected: PASS, and every pre-existing test in the file still passes — in particular the two `test.each(["workload","planning"])` cases asserting exactly one Hide-external button and a contiguous Print · reset-columns · reset-size group. That group is unchanged: `headerActions` was not touched, and the toggle now sits *before* it, which the convention allows.

- [ ] **Step 5: Commit**

```bash
git add src/app/resources-panel-toolbar.tsx src/app/resources-panel.test.tsx
git commit -F - <<'EOF'
fix(resources): put Hide externals beside the Outlook block in Planning

The Planning control row rendered the toggle at the end of the left group
with `ml-auto` pushing the Outlook sync controls away from it, while the
Workload header already rendered the two adjacent. Move the toggle into
the trailing group so both sub-views read the same.

The trailing Print / reset-columns / reset-size group is untouched and
stays contiguous; `headerActions` is unchanged and still shared by
planning, workload and calendar.
EOF
```

---

### Task 2: RACI toolbar — "Suggest RACI" leads, person filter to its right

**Files:**
- Modify: `src/app/raci-panel.tsx` (the toolbar `<div>` opening around line 169, and the trailing group around line 239)
- Test: `src/app/raci-panel.test.tsx` (append inside the existing `describe("RaciPanel", …)`)

Context: the toolbar is one row with two groups — a leading `flex flex-1 flex-wrap items-center gap-2` holding the person-filter combobox, its chips and a Clear button, and a trailing `flex shrink-0 items-center gap-2` holding `{suggest.button}`, `PrintButton`, `ResetSizeButton`. `suggest.button` is `null` when AI is off or in a popout.

- [ ] **Step 1: Write the failing test**

Append to `src/app/raci-panel.test.tsx`:

```tsx
  it("renders Suggest RACI ahead of the person filter, with Print/Reset still trailing", () => {
    stubSettings(AI_ON);
    render(<RaciPanel lang="en-US" stakeholders={stakeholders} milestones={milestones} onSave={vi.fn()} />);

    const suggest = screen.getByRole("button", { name: t("en-US", "raciSuggest") });
    const filter = screen.getByRole("combobox", { name: /filter people/i });
    const print = screen.getByRole("button", { name: /print/i });

    // Suggest → filter → Print, in DOM order.
    expect(suggest.compareDocumentPosition(filter) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(filter.compareDocumentPosition(print) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  // The button is null when AI is off, so the filter must simply become first —
  // no placeholder, no reserved gap.
  it("leaves the filter first when the Suggest trigger is absent", () => {
    render(<RaciPanel lang="en-US" stakeholders={stakeholders} milestones={milestones} onSave={vi.fn()} />);
    expect(screen.queryByRole("button", { name: t("en-US", "raciSuggest") })).toBeNull();
    expect(screen.getByRole("combobox", { name: /filter people/i })).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run the tests and verify the FIRST one fails**

```bash
npx vitest run src/app/raci-panel.test.tsx -t "renders Suggest RACI ahead of the person filter"
```

Expected: FAIL on the first `expect` — `suggest` currently comes *after* `filter`, so the position bitmask is 0.

The second test ("leaves the filter first") passes already. That is fine and expected: it is a guard against a regression the change could introduce, not a driver of the change.

- [ ] **Step 3: Make the change**

In `src/app/raci-panel.tsx`, remove `{suggest.button}` from the trailing group so it reads:

```jsx
        <div className="flex shrink-0 items-center gap-2">
          <PrintButton lang={lang} />
          <ResetSizeButton onClick={resetPaneSize} lang={lang} />
        </div>
```

and make it the first child of the leading group:

```jsx
        <div className="flex flex-1 flex-wrap items-center gap-2">
          {suggest.button}
          {/* ★ onClear hits the setter DIRECTLY, never the onChange above —
              routing it through onChange would re-run the auto-add match. */}
          <ClearableSearchInput
```

Leave every other line of that group — the `ClearableSearchInput`, the `<datalist>`, the chip `map`, the Clear button — exactly as it is.

- [ ] **Step 4: Run the whole file and verify it passes**

```bash
npx vitest run src/app/raci-panel.test.tsx; echo "EXIT=$?"
```

Expected: PASS, all tests. The pre-existing "offers the Suggest RACI trigger when AI is configured" and "hides the trigger in a popout" tests query by role+name and are position-independent, so they are unaffected.

- [ ] **Step 5: Commit**

```bash
git add src/app/raci-panel.tsx src/app/raci-panel.test.tsx
git commit -F - <<'EOF'
fix(raci): lead the toolbar with Suggest RACI, filter to its right

Suggest RACI sat in the trailing group beside Print and Reset, reading as
a trailing utility rather than the pane's primary action. Planning renders
its AI action (`aiPlanButton`) first in the control row; match that.

Print and Reset stay trailing and contiguous. The trigger is null when AI
is off or in a popout, in which case the filter is simply first.
EOF
```

---

### Task 3: `useColumnResize` — persist only user-sized widths, expose them

**Files:**
- Modify: `src/app/use-column-resize.ts`
- Test: `src/app/use-column-resize.test.ts` (append)

Why: the hook currently writes the ENTIRE merged map (all 18 Open Points keys) to localStorage on any drag, and reads it back as `{...defaults, ...persisted}`. So once a user drags any one column, every default is permanently masked and changing `DEFAULT_COL_WIDTHS` is a no-op for them. It also means nothing downstream can distinguish "the user chose 200px" from "200px is the default" — which Task 5 needs.

The fix persists `{ v: 2, widths }` where `widths` holds ONLY keys the user actually dragged, and returns that raw map as `sizedWidths` alongside the unchanged merged `colWidths`. All 19 existing consumers read `colWidths` and are unaffected.

- [ ] **Step 1: Write the failing tests**

Append to `src/app/use-column-resize.test.ts`, inside the existing `describe("useColumnResize", …)`:

```ts
  it("persists a v2 payload holding only dragged keys", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useColumnResize("t2", DEFAULTS));

    const ev = { clientX: 100, preventDefault: () => {} } as unknown as React.MouseEvent;
    act(() => { result.current.startColResize("a", ev); });
    act(() => { window.dispatchEvent(new MouseEvent("mousemove", { clientX: 180 })); });
    act(() => { window.dispatchEvent(new MouseEvent("mouseup")); });
    act(() => { vi.advanceTimersByTime(300); });

    const raw = JSON.parse(localStorage.getItem(KEY("t2")) as string);
    expect(raw.v).toBe(2);
    // Only "a" was dragged. "b" must NOT be written, or a future change to its
    // default would be permanently masked for this user.
    expect(Object.keys(raw.widths)).toEqual(["a"]);
    expect(raw.widths.a).toBe(180);
  });

  it("exposes sizedWidths as the raw user-set map, with colWidths still merged", async () => {
    localStorage.setItem(KEY("t3"), JSON.stringify({ v: 2, widths: { a: 333 } }));
    const { result } = renderHook(() => useColumnResize("t3", DEFAULTS));
    await act(async () => {});

    expect(result.current.sizedWidths).toEqual({ a: 333 });
    expect(result.current.sizedWidths.b).toBeUndefined();
    // Unchanged public contract: colWidths is still every key, defaults filled.
    expect(result.current.colWidths).toEqual({ a: 333, b: 200 });
  });

  it("still reads a v1 bare-object payload (other tables keep their widths)", async () => {
    localStorage.setItem(KEY("t4"), JSON.stringify({ a: 333, x: 999 }));
    const { result } = renderHook(() => useColumnResize("t4", DEFAULTS));
    await act(async () => {});
    expect(result.current.colWidths.a).toBe(333);
    expect(result.current.colWidths.b).toBe(200);
    // A v1 blob cannot distinguish dragged from default, so every key it holds
    // counts as user-set. That is the conservative direction: it preserves the
    // user's widths rather than silently discarding them.
    expect(result.current.sizedWidths.a).toBe(333);
  });

  it("reset clears sizedWidths and the stored payload", async () => {
    localStorage.setItem(KEY("t5"), JSON.stringify({ v: 2, widths: { a: 333 } }));
    const { result } = renderHook(() => useColumnResize("t5", DEFAULTS));
    await act(async () => {});
    act(() => { result.current.resetColWidths(); });

    expect(result.current.sizedWidths).toEqual({});
    expect(result.current.colWidths).toEqual(DEFAULTS);
    expect(localStorage.getItem(KEY("t5"))).toBeNull();
  });
```

- [ ] **Step 2: Run them and verify they FAIL**

```bash
npx vitest run src/app/use-column-resize.test.ts
```

Expected: FAIL — `result.current.sizedWidths` is `undefined` (property does not exist yet), and the persisted payload is a bare merged object with both keys, so `raw.v` is `undefined`.

- [ ] **Step 3: Rewrite the hook**

Replace the whole body of `src/app/use-column-resize.ts` with:

```ts
// src/app/use-column-resize.ts
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const KEY_PREFIX = "aipm-cockpit:col-widths";

/** Reads the stored payload as the raw USER-SET map.
 *
 *  v2 is `{ v: 2, widths }` where `widths` holds only columns the user actually
 *  dragged — so a later change to a DEFAULT still reaches them. v1 is a bare
 *  object written when the hook persisted the whole merged map; it cannot tell
 *  dragged from default, so every key in it counts as user-set. That direction
 *  is deliberate: it preserves widths rather than silently discarding them. */
function readSized<TId extends string>(storageKey: string): Partial<Record<TId, number>> {
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const v2 = parsed as { v?: unknown; widths?: unknown };
    if (v2.v === 2) {
      const w = v2.widths;
      if (w && typeof w === "object" && !Array.isArray(w)) return { ...(w as Partial<Record<TId, number>>) };
      return {};
    }
    return { ...(parsed as Partial<Record<TId, number>>) };
  } catch {
    return {};
  }
}

export function useColumnResize<TId extends string>(
  tableId: string,
  defaults: Readonly<Record<TId, number>>,
): {
  /** Every column, defaults filled in. The long-standing public contract. */
  colWidths: Record<TId, number>;
  /** ONLY the columns the user explicitly sized. A key absent here is at its
   *  default, which is what lets a consumer emit no width at all for it. */
  sizedWidths: Partial<Record<TId, number>>;
  startColResize: (col: TId, e: React.MouseEvent) => void;
  resetColWidths: () => void;
} {
  const storageKey = `${KEY_PREFIX}:${tableId}`;
  const [sizedWidths, setSizedWidths] = useState<Partial<Record<TId, number>>>(() => readSized<TId>(storageKey));

  const colWidths = useMemo(
    () => ({ ...defaults, ...sizedWidths }) as Record<TId, number>,
    [defaults, sizedWidths],
  );

  const dragRef = useRef<{ col: TId; startX: number; startW: number } | null>(null);
  const colWidthsRef = useRef(colWidths);
  useEffect(() => { colWidthsRef.current = colWidths; }, [colWidths]);

  // Debounced persist (250 ms): drag fires setSizedWidths on every mousemove,
  // so without the timeout we'd write localStorage ~60x/sec.
  useEffect(() => {
    const id = setTimeout(() => {
      try {
        window.localStorage.setItem(storageKey, JSON.stringify({ v: 2, widths: sizedWidths }));
      } catch { /* non-fatal */ }
    }, 250);
    return () => clearTimeout(id);
  }, [sizedWidths, storageKey]);

  const resetColWidths = useCallback(() => {
    setSizedWidths({});
    try { window.localStorage.removeItem(storageKey); } catch { /* non-fatal */ }
  }, [storageKey]);

  const startColResize = useCallback((col: TId, e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = {
      col,
      startX: e.clientX,
      startW: colWidthsRef.current[col] ?? defaults[col] ?? 80,
    };
    function onMove(mv: MouseEvent) {
      if (!dragRef.current) return;
      const { col: c, startX, startW } = dragRef.current;
      setSizedWidths((prev) => ({
        ...prev,
        [c]: Math.max(40, startW + mv.clientX - startX),
      }));
    }
    function onUp() {
      dragRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [defaults]);

  return { colWidths, sizedWidths, startColResize, resetColWidths };
}
```

Two things to notice, because getting either wrong is silent:

- `startColResize` still seeds `startW` from the MERGED `colWidthsRef`, so dragging an un-sized column starts from its default (e.g. 200 for `taskName`), not from 0 or 80. Unchanged behaviour.
- The reset effect writes `{v:2,widths:{}}` on the next tick after `resetColWidths` removed the key. That is harmless (an empty payload reads back as `{}`), and matches the pre-existing behaviour where reset also re-wrote the defaults.

- [ ] **Step 4: Run the tests and verify they PASS**

```bash
npx vitest run src/app/use-column-resize.test.ts; echo "EXIT=$?"
```

Expected: PASS, including the four pre-existing tests (defaults when empty, merge-over-defaults, 40px clamp, reset).

- [ ] **Step 5: Verify the 19 other consumers are unaffected**

```bash
npx vitest run src/app/use-column-manager.test.ts src/app/jira-conflicts-modal.test.tsx > /tmp/consumers.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " /tmp/consumers.log
```

Expected: EXIT=0. These read `colWidths`, whose shape and values are unchanged.

- [ ] **Step 6: Commit**

```bash
git add src/app/use-column-resize.ts src/app/use-column-resize.test.ts
git commit -F - <<'EOF'
refactor(columns): persist only user-dragged widths, expose sizedWidths

The hook wrote the whole merged width map on any drag and read it back
over the defaults, so one drag permanently masked every default — a later
change to DEFAULT_COL_WIDTHS could never reach that user. It also left no
way to tell a chosen width from a default one.

Persist `{v:2, widths}` holding only dragged keys, and return that raw map
as `sizedWidths` beside the unchanged merged `colWidths`. A v1 bare-object
payload still reads, with every key treated as user-set — the conservative
direction, preserving existing widths rather than discarding them.
EOF
```

---

### Task 4: Pure table-geometry module

**Files:**
- Create: `src/app/open-points-table-geometry.ts`
- Create: `src/app/open-points-table-geometry.test.ts`

Why a separate module: `tasks-section.tsx` has ONE line of size-ratchet headroom, so the arithmetic cannot live there. It is also pure and i18n-free, which is where this codebase puts derivation logic.

★ A new `.ts` file is COVERAGE-GATED (`vitest.config.ts` floors: lines 92 / funcs 91 / branch 80 / stmts 89). The test file below is not optional — an untested new module can pass `test:run` locally and fail the CI unit job.

- [ ] **Step 1: Write the failing tests**

Create `src/app/open-points-table-geometry.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  GUTTER_WIDTH_PX,
  TASK_NAME_MIN_PX,
  colWidthStyle,
  tableMinWidthPx,
  visibleTaskCols,
} from "./open-points-table-geometry";
import { DEFAULT_COL_WIDTHS } from "./use-column-manager";

describe("visibleTaskCols", () => {
  it("drops hidden columns and preserves declaration order", () => {
    const cols = visibleTaskCols(new Set(["assignee", "sel"]));
    expect(cols).not.toContain("assignee");
    expect(cols).not.toContain("sel");
    expect(cols.indexOf("id")).toBeLessThan(cols.indexOf("taskName"));
  });

  it("returns every column when nothing is hidden", () => {
    expect(visibleTaskCols(new Set())).toHaveLength(18);
  });
});

describe("tableMinWidthPx", () => {
  it("sums the gutter plus every visible column's width", () => {
    const width = tableMinWidthPx(["id", "taskName", "actions"], {});
    expect(width).toBe(
      GUTTER_WIDTH_PX + DEFAULT_COL_WIDTHS.id + TASK_NAME_MIN_PX + DEFAULT_COL_WIDTHS.actions,
    );
  });

  it("counts taskName at its floor, not at a larger default", () => {
    // The floor is what guarantees the flex column stays readable once the
    // container is narrower than the table; a bigger number here would force
    // horizontal scroll earlier than intended.
    const width = tableMinWidthPx(["taskName"], {});
    expect(width).toBe(GUTTER_WIDTH_PX + TASK_NAME_MIN_PX);
  });

  it("honours a user-sized taskName above the floor", () => {
    const width = tableMinWidthPx(["taskName"], { taskName: 500 });
    expect(width).toBe(GUTTER_WIDTH_PX + 500);
  });

  it("never drops below the floor for a user-sized taskName under it", () => {
    const width = tableMinWidthPx(["taskName"], { taskName: 60 });
    expect(width).toBe(GUTTER_WIDTH_PX + TASK_NAME_MIN_PX);
  });

  it("drops by exactly a column's width when that column is hidden", () => {
    const all = tableMinWidthPx(["id", "taskName", "priority"], {});
    const without = tableMinWidthPx(["id", "taskName"], {});
    expect(all - without).toBe(DEFAULT_COL_WIDTHS.priority);
  });

  it("uses a user-sized width over the default", () => {
    expect(tableMinWidthPx(["id"], { id: 300 }) - tableMinWidthPx(["id"], {})).toBe(
      300 - DEFAULT_COL_WIDTHS.id,
    );
  });
});

describe("colWidthStyle", () => {
  it("returns undefined for an un-sized taskName so it becomes the flex column", () => {
    expect(colWidthStyle("taskName", {})).toBeUndefined();
  });

  it("returns the user's width for a sized taskName", () => {
    expect(colWidthStyle("taskName", { taskName: 420 })).toBe(420);
  });

  it("returns the default for every other un-sized column", () => {
    expect(colWidthStyle("status", {})).toBe(DEFAULT_COL_WIDTHS.status);
    expect(colWidthStyle("actions", {})).toBe(DEFAULT_COL_WIDTHS.actions);
  });

  it("returns the user's width for a sized non-flex column", () => {
    expect(colWidthStyle("status", { status: 77 })).toBe(77);
  });
});
```

- [ ] **Step 2: Run and verify it fails to resolve**

```bash
npx vitest run src/app/open-points-table-geometry.test.ts
```

Expected: FAIL — `Failed to resolve import "./open-points-table-geometry"`.

- [ ] **Step 3: Create the module**

Create `src/app/open-points-table-geometry.ts`:

```ts
// src/app/open-points-table-geometry.ts
//
// Pure, i18n-free geometry for the Open Points table. No React, no DOM — jsdom
// reports every rect as 0, so every number here has to be derivable from the
// declared widths alone.
//
// ★ WHY THIS EXISTS AT ALL. The table is `table-layout: fixed`. When its used
//   width exceeds the sum of the declared <col> widths, Blink hands the leftover
//   out EQUALLY to every column — not in proportion to declared width. So a 36px
//   utility column gained the same ~7-13px a 200px content column did, which is
//   invisible on the wide ones and a ~35% inflation on the narrow ones. Making
//   `taskName` the single auto-width column sends all of that leftover to the one
//   column that can use it.
//
// ★ WHY NOT `width: max-content` (what the table used before). With an auto
//   column present, max-content resolves against that column's longest unwrapped
//   content — the longest task title — so the table would outgrow the viewport
//   and the pane would scroll horizontally at all times. `tableMinWidthPx` gives
//   the same overflow floor deterministically, from numbers we already hold.

import { ALL_TASK_COLS } from "./tasks-section-columns";
import { DEFAULT_COL_WIDTHS } from "./use-column-manager";

/** The leading gutter <col className="w-7"> that matches the per-row hover
 *  Ask-Claude cell. Tailwind `w-7` is 1.75rem = 28px at the default root size. */
export const GUTTER_WIDTH_PX = 28;

/** Floor for the flex column. Below this the task titles stop being readable,
 *  so the table overflows and the pane scrolls instead. */
export const TASK_NAME_MIN_PX = 200;

/** The one column that takes the leftover. */
const FLEX_COL = "taskName";

export type TaskColId = (typeof ALL_TASK_COLS)[number];

/** Visible columns, in declaration order. */
export function visibleTaskCols(hiddenCols: ReadonlySet<string>): TaskColId[] {
  return ALL_TASK_COLS.filter((col) => !hiddenCols.has(col));
}

/**
 * The inline `width` a column's <col> should carry, or `undefined` to leave it
 * auto.
 *
 * ★ Only an UN-SIZED flex column goes auto. Once the user has dragged it they
 *   have expressed a width, and silently ignoring it would make the resize grip
 *   look broken on that one column.
 */
export function colWidthStyle(
  col: string,
  sizedWidths: Readonly<Partial<Record<string, number>>>,
): number | undefined {
  const sized = sizedWidths[col];
  if (sized !== undefined) return sized;
  if (col === FLEX_COL) return undefined;
  return DEFAULT_COL_WIDTHS[col];
}

/**
 * Smallest width the table may take: the gutter plus every visible column, with
 * the flex column counted at its floor. Below this the browser would shrink the
 * flex column past readability instead of overflowing.
 */
export function tableMinWidthPx(
  visibleCols: readonly string[],
  sizedWidths: Readonly<Partial<Record<string, number>>>,
): number {
  return visibleCols.reduce((sum, col) => {
    const sized = sizedWidths[col];
    if (col === FLEX_COL) return sum + Math.max(TASK_NAME_MIN_PX, sized ?? 0);
    return sum + (sized ?? DEFAULT_COL_WIDTHS[col] ?? 0);
  }, GUTTER_WIDTH_PX);
}
```

- [ ] **Step 4: Extract the column list so the module can import it**

The module imports `ALL_TASK_COLS` from `./tasks-section-columns`, which does not exist yet — today the list is a `const` inside `tasks-section.tsx:66`. Moving it out also buys back a line in the ratcheted file.

Create `src/app/tasks-section-columns.ts`:

```ts
// src/app/tasks-section-columns.ts
//
// The Open Points column id list, in render order. Extracted from
// `tasks-section.tsx` so the pure geometry module can import it without
// pulling in the React pane (and so the pane stays under its size ratchet).
export const ALL_TASK_COLS = ["sel","status","id","taskName","assignee","startDate","dueDate","lastUpdateDate","createdDate","priority","taskStatus","blockers","description","notesLog","depRelations","estimate","spent","actions"] as const;
```

In `src/app/tasks-section.tsx`, delete the `const ALL_TASK_COLS = [...]` declaration at line 66 and import it instead.

Verified at plan time: the const is module-LOCAL (not exported) with exactly two uses, both inside `tasks-section.tsx` — line 515 (`visibleColumnCount`) and line 940 (the colgroup map), and Task 5 rewrites both. So no re-export is needed. Confirm that still holds:

```bash
grep -rn "ALL_TASK_COLS" src/ --include=*.ts --include=*.tsx
```

Expected: only `tasks-section.tsx` (2 uses) and the new leaf. If any OTHER file appears, add `export { ALL_TASK_COLS } from "./tasks-section-columns";` to `tasks-section.tsx` rather than editing every importer.

★ Check for a name collision before creating the file: a bare `./tasks-section-columns` import resolves `.ts` AHEAD of `.tsx`, so a pure `.ts` can silently hijack an existing component import.

```bash
ls src/app/tasks-section-columns.* 2>/dev/null; echo "exists=$?"
```

Expected: no output, `exists=1`.

- [ ] **Step 5: Run the geometry tests and verify they PASS**

```bash
npx vitest run src/app/open-points-table-geometry.test.ts; echo "EXIT=$?"
```

Expected: PASS, 12 tests.

- [ ] **Step 6: Typecheck**

```bash
npx tsc --noEmit; echo "EXIT=$?"
```

Expected: EXIT=0.

★ Ignore the IDE's inline squiggles here — after a multi-file edit they routinely show phantom "Cannot find module" that a real `tsc --noEmit` contradicts. Trust the exit code.

- [ ] **Step 7: Commit**

```bash
git add src/app/open-points-table-geometry.ts src/app/open-points-table-geometry.test.ts src/app/tasks-section-columns.ts src/app/tasks-section.tsx
git commit -F - <<'EOF'
feat(open-points): add pure table-geometry module

Extracts ALL_TASK_COLS into its own leaf and adds a pure, i18n-free module
computing the table's minimum width and each column's emitted width.

The pane is at its file-size ratchet baseline, so the arithmetic cannot
live there; it is also pure derivation, which this codebase keeps out of
React surfaces. Not yet wired — Task 5 consumes it.
EOF
```

---

### Task 5: Wire the geometry into Open Points and retune the declared widths

**Files:**
- Modify: `src/app/use-column-manager.ts` (lines 26, 39, 42, 46, 59-62, and the return object)
- Modify: `src/app/task-manager.tsx` (lines 220, 2374) — must be net **0** lines
- Modify: `src/app/tasks-section.tsx` (line 114, lines 931-944) — must be net **≤ +1** line
- Test: `src/app/tasks-section.test.tsx`, `src/app/use-column-manager.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/app/tasks-section.test.tsx`, inside the top-level describe. This suite stubs `TaskRow`, but the `<colgroup>` and `<table>` are rendered by `TasksSection` itself, so both are assertable. Use the file's existing `makeProps()` / `stubWorkspace(...)` helpers, and pass at least one task so the table renders rather than the empty dashed box.

```tsx
  // Geometry, not pixels: jsdom has no layout engine, so assert what we EMIT.
  describe("table geometry", () => {
    function renderTable(over: Partial<TasksSectionProps> = {}) {
      const task = { id: 1, taskName: "T1", priority: "Medium", status: "To Do" };
      stubWorkspace([task], [task]);
      stubFilters(); stubTaskForm(); stubSettings(); stubHolidaySet();
      return render(<TasksSection {...makeProps()} {...over} />);
    }

    it("leaves taskName's <col> width-free so it absorbs the leftover", () => {
      const { container } = renderTable();
      const cols = Array.from(container.querySelectorAll("colgroup col"));
      // [0] is the leading w-7 gutter; the rest follow ALL_TASK_COLS order with
      // the default-hidden estimate/spent/createdDate removed.
      const taskNameCol = cols[4];
      expect(taskNameCol.getAttribute("style") ?? "").not.toMatch(/width/);
      // Every other column DOES carry one — otherwise they would all go auto
      // and share the leftover again, which is the bug this fixes.
      expect(cols[3].getAttribute("style") ?? "").toMatch(/width/);
    });

    it("emits a width for taskName once the user has sized it", () => {
      const { container } = renderTable({ colWidths: { taskName: 420 } });
      const cols = Array.from(container.querySelectorAll("colgroup col"));
      expect(cols[4].getAttribute("style") ?? "").toMatch(/width:\s*420px/);
    });

    it("sets minWidth from the declared widths and drops it when a column hides", () => {
      const { container, unmount } = renderTable();
      const wide = (container.querySelector("table") as HTMLTableElement).style.minWidth;
      unmount();

      const { container: c2 } = renderTable({ hiddenCols: new Set(["priority"]) });
      const narrow = (c2.querySelector("table") as HTMLTableElement).style.minWidth;

      expect(parseInt(wide, 10) - parseInt(narrow, 10)).toBe(DEFAULT_COL_WIDTHS.priority);
    });

    it("no longer relies on width:max-content", () => {
      // With an auto column present, max-content resolves against the longest
      // task title, which would mean permanent horizontal scroll.
      const { container } = renderTable();
      const table = container.querySelector("table") as HTMLTableElement;
      expect(table.style.width).toBe("100%");
      expect(table.style.width).not.toBe("max-content");
    });
  });
```

Add the import this needs at the top of the file, beside the existing imports:

```tsx
import { DEFAULT_COL_WIDTHS } from "./use-column-manager";
```

And append to `src/app/use-column-manager.test.ts`:

```ts
  it("reads widths from the v2 table key, ignoring a stale open-points blob", () => {
    // The pre-bump blob held all 18 keys, so it masked every default. Bumping
    // the tableId is what lets the new declared widths actually reach a user
    // who once dragged one unrelated column.
    localStorage.setItem(
      "aipm-cockpit:col-widths:open-points",
      JSON.stringify({ status: 999, actions: 999 }),
    );
    const { result } = renderHook(() => useColumnManager());
    expect(result.current.colWidths.status).toBe(DEFAULT_COL_WIDTHS.status);
    expect(result.current.colWidths.actions).toBe(DEFAULT_COL_WIDTHS.actions);
  });
```

- [ ] **Step 2: Run them and verify they FAIL**

```bash
npx vitest run src/app/tasks-section.test.tsx -t "table geometry" src/app/use-column-manager.test.ts
```

Expected: FAIL — `taskName`'s col still carries `width: 200px`, `table.style.width` is `max-content` (so `minWidth` is the string `"100%"` and `parseInt` gives 100), and the stale `open-points` blob still wins.

- [ ] **Step 3: Update the declared widths and the tableId**

In `src/app/use-column-manager.ts`, change three entries in `DEFAULT_COL_WIDTHS`:

```ts
  status: 28,        // was 36 — holds a single ~10px RAG dot
  depRelations: 96,  // was 120 — renders an em-dash or a short chip + pencil
  actions: 32,       // was 36 — holds one ⋮ icon button
```

Leave `sel: 36` (a 16px checkbox plus tight padding needs it) and `taskName: 200` (still the drag-start width, and the geometry module's floor is independent).

Then change the `useColumnResize` call and the return object:

```ts
  const { colWidths, sizedWidths, startColResize, resetColWidths } = useColumnResize<string>(
    "open-points-v2",
    DEFAULT_COL_WIDTHS,
  );
```

Add `sizedWidths: Partial<Record<string, number>>;` to the hook's declared return type, and `sizedWidths,` to the returned object. Update the doc comment on line 46 from `(tableId "open-points")` to `(tableId "open-points-v2" — bumped so the pre-bump blob, which held every key and masked every default, is discarded)`.

★ Why bump rather than migrate: the old blob cannot distinguish a dragged width from a default one, so migrating it would carry the fat widths forward and the retune would be a no-op for exactly the users who see the problem. Users keep the "reset columns" button; only stale widths for this one table are lost. Same rule the codebase already applies to `useResizable` storage keys.

- [ ] **Step 4: Swap what `task-manager` passes — net ZERO lines**

`src/app/task-manager.tsx` is at its ratchet baseline (2966; currently 2965), so this must not add a line.

At the `useColumnManager()` destructure (around line 220), change the `colWidths,` entry to:

```ts
    sizedWidths,
```

and at the `<TasksSection …>` call site (around line 2374), change:

```tsx
      colWidths={colWidths}
```

to:

```tsx
      colWidths={sizedWidths}
```

Both are one-line-for-one-line swaps. Verify nothing else in the file reads `colWidths`:

```bash
grep -n "colWidths" src/app/task-manager.tsx
```

Expected: exactly one hit, the `colWidths={sizedWidths}` prop line. If there is another, stop and re-plan — this swap assumes the pane is the only consumer.

- [ ] **Step 5: Consume the geometry in `tasks-section.tsx`**

Change the prop type at line 114 (same line count):

```ts
  /** ONLY the columns the user explicitly sized — an absent key is at its
   *  default, which is what lets taskName render width-free. */
  colWidths: Partial<Record<string, number>>;
```

Add the import beside the existing ones:

```ts
import { colWidthStyle, tableMinWidthPx, visibleTaskCols } from "./open-points-table-geometry";
```

Replace the `<table>` opening tag and its `<colgroup>` (lines 931-944) with:

```jsx
          <table
            className="divide-y divide-line text-left text-sm"
            style={{ tableLayout: "fixed", width: "100%", minWidth: `${tableMinWidth}px` }}
          >
            <colgroup>
              {/* Leading gutter column matching the per-row hover Ask-Claude cell
                  and the leading <th> below — under table-layout:fixed a missing
                  <col> shifts every column's width to its left neighbour. */}
              <col className="w-7" />
              {visibleCols.map((col) => (
                <col key={col} style={{ width: colWidthStyle(col, colWidths) }} />
              ))}
            </colgroup>
```

`style={{ width: undefined }}` emits no `width` in the style attribute, which is exactly what makes `taskName` the auto column.

Add the two derived values near the existing `visibleColumnCount` (line 515), and reuse them for it so the count is not derived twice:

```ts
  const visibleCols = useMemo(() => visibleTaskCols(hiddenCols), [hiddenCols]);
  const tableMinWidth = useMemo(() => tableMinWidthPx(visibleCols, colWidths), [visibleCols, colWidths]);
  const visibleColumnCount = visibleCols.length;
```

★ `hiddenCols` and `colWidths` are whole values, not member expressions, so they are legal dep-array entries. Do NOT write `hiddenCols.size` or `colWidths.taskName` in a dep array — `react-hooks/exhaustive-deps` rejects a member expression and it is fatal under `--max-warnings=0`.

★ Line 943's existing `colWidths[col] ?? DEFAULT_COL_WIDTHS[col]` is now handled inside `colWidthStyle`, so `DEFAULT_COL_WIDTHS` may become an unused import in this file. An unused import is FATAL under the CI gate — remove it if `grep -n "DEFAULT_COL_WIDTHS" src/app/tasks-section.tsx` returns nothing else.

- [ ] **Step 6: Run the tests and verify they PASS**

```bash
npx vitest run src/app/tasks-section.test.tsx src/app/use-column-manager.test.ts src/app/open-points-table-geometry.test.ts > /tmp/t5.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " /tmp/t5.log
```

Expected: EXIT=0.

- [ ] **Step 7: Check the size ratchet BEFORE committing**

```bash
npm run size:check > /tmp/size.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/size.log
wc -l src/app/tasks-section.tsx src/app/task-manager.tsx
```

Expected: EXIT=0, with `tasks-section.tsx` ≤ 1043 and `task-manager.tsx` ≤ 2966.

If `tasks-section.tsx` is over: the `ALL_TASK_COLS` extraction in Task 4 freed one line and the `visibleColumnCount` rewrite above replaces one line with three. Recover the difference by moving the `<colgroup>` block into a small presentational `src/app/open-points-colgroup.tsx` (a `.tsx` file is coverage-EXCLUDED, so it needs no new tests) and rendering `<OpenPointsColgroup cols={visibleCols} colWidths={colWidths} />`. Do NOT edit `docs/baselines/file-sizes.json`.

- [ ] **Step 8: Run the full gates**

```bash
npx tsc --noEmit; echo "TSC=$?"
npx eslint --max-warnings=0 src/app; echo "LINT=$?"
npm run test:run > /tmp/suite.log 2>&1; echo "TEST=$?"; grep -E "Test Files|Tests " /tmp/suite.log
```

Expected: all three EXIT=0. No pipes on the eslint line.

- [ ] **Step 9: Commit**

```bash
git add src/app/use-column-manager.ts src/app/use-column-manager.test.ts src/app/task-manager.tsx src/app/tasks-section.tsx src/app/tasks-section.test.tsx
git commit -F - <<'EOF'
fix(open-points): stop narrow columns absorbing the table's leftover width

The table was `table-layout: fixed` with `width: max-content; min-width:
100%`. When the table is wider than the sum of its declared columns Blink
hands the leftover out EQUALLY to every column, so a 36px utility column
gained as much as a 200px content column — invisible on the wide ones, a
~35% inflation on the narrow ones. That is the wasted space at both edges
of the table.

Make taskName the single auto-width column so it takes all of the
leftover, and replace `width: max-content` (which, with an auto column
present, would resolve against the longest task title and force permanent
horizontal scroll) with a min-width computed from the declared widths.

Also retunes status 36->28, depRelations 120->96, actions 36->32, and
bumps the width storage key to open-points-v2 so the pre-bump blob — which
held every key and therefore masked every default — is discarded.
EOF
```

---

### Task 6: Accessibility gate, eye verification, and docs

**Files:**
- Modify: `AGENTS.md` (the Open Points toolbar bullet and the shared-calendar-toolbar bullet)

- [ ] **Step 1: Run axe against the three affected views**

Open Points and Resources are both in `A11Y_VIEWS`. RACI is not (Stakeholders is; the RACI matrix is a separate view).

★ Use a FRESH isolated server, never a long-running reused one — Playwright's `reuseExistingServer` will attach to a stale `:3000` whose Tailwind has not regenerated, producing phantom failures.

```bash
PORT=3100 npm run dev &
npx playwright test e2e/a11y.spec.ts --project=chromium -g "Open Points" > /tmp/axe1.log 2>&1; echo "EXIT=$?"
npx playwright test e2e/a11y.spec.ts --project=chromium -g "Resources" > /tmp/axe2.log 2>&1; echo "EXIT=$?"
PORT=3100 npm run stop
```

Expected: both EXIT=0. No control was added, removed or relabelled in this plan, so a failure here means something structural broke — read the log, do not retry blindly.

- [ ] **Step 2: Eye-verify (jsdom cannot see any of this)**

```bash
npm run dev
```

Check, at a ~1920px window and again at ~1280px:

1. **Resources → Planning** — "Hide externals" sits immediately left of the "Add to Outlook calendar" checkbox, with Print · reset-columns · reset-size still contiguous at the far right. Toggle it and confirm rows filter.
2. **Resources → Workload** — unchanged (it already had this arrangement).
3. **Stakeholders → RACI** — "Suggest RACI" is the leftmost control, the person filter directly right of it, Print · Reset at the right.
4. **Open Points** — the left gutter, checkbox and health-dot columns are snug; the strip right of Relations is gone; task titles have visibly more room. Drag the Task column's resize grip and confirm it now holds an explicit width (it stops flexing — that is intended). Click "reset columns" and confirm it flexes again.
5. **Open Points, narrow window** — shrink below the table's minimum and confirm it scrolls horizontally rather than crushing the task titles.

- [ ] **Step 3: Correct AGENTS.md**

`AGENTS.md` is ungated — no test checks any claim in it, and stale claims there have caused real bugs. Two bullets are now wrong:

1. The Open Points bullet describing the table's `width: max-content` geometry — update it to the `width: 100%` + computed `minWidth` + flex-`taskName` model, and record the equal-leftover-distribution reason, because that is the non-obvious part a future edit would undo.
2. The `useResizable` inline-size bullet — extend it to note that `useColumnResize` now persists only user-dragged keys, so a `DEFAULT_COL_WIDTHS` change DOES reach existing users going forward, and that `open-points` was bumped to `open-points-v2` once for the pre-v2 blobs.

While there, verify the two claims this plan touched and correct anything that has drifted:

```bash
grep -n "max-content\|open-points\|hideExternalToggle\|Suggest RACI\|raciSuggest" AGENTS.md
```

- [ ] **Step 4: Commit the docs**

```bash
git add AGENTS.md
git commit -F - <<'EOF'
docs(agents): correct the Open Points table-geometry and column-width claims

The table no longer uses `width: max-content`, and useColumnResize no
longer persists the whole merged map, so a DEFAULT_COL_WIDTHS change now
reaches existing users. Both bullets described the old behaviour.
EOF
```

- [ ] **Step 5: Version bump (user-facing change — required before release)**

This is a user-visible UX change, so it takes a version bump. Refactor-only work would not.

★ SIX places carry the version and NO gate checks any of them. Bump all of them in ONE commit or the drift restarts:

1. `src/app/version.ts` — `APP_VERSION` → `0.212.0`, `APP_BUILD_DATE`, milestone codename
2. `CHANGELOG.md` — new entry
3. `package.json` — `version`
4. `package-lock.json` — TWO occurrences (root `version` and `packages[""]`)
5. `README.md` — the shields badge (version **and** codename)
6. `docs/CODEMAPS/*.md` — the `<!-- Generated: … | App <version> "<codename>" … -->` header on all five

The codename must be UNIQUE across the project's history. Verify before choosing:

```bash
grep -c "<your-candidate-codename>" CHANGELOG.md    # must print 0
```

If a `versionHighlight*` i18n key is added for this release, append it to `APP_HIGHLIGHT_KEYS` and add both EN and DE strings.

★ `i18n.de.ts` is CRLF and the Edit tool corrupts umlauts there — patch it via a node utf8 write and grep-verify, and match `\r\n` in any anchor.

- [ ] **Step 6: Final full-gate run**

```bash
npx tsc --noEmit; echo "TSC=$?"
npx eslint --max-warnings=0 src/app; echo "LINT=$?"
npm run test:run > /tmp/final.log 2>&1; echo "TEST=$?"; grep -E "Test Files|Tests " /tmp/final.log
npm run size:check > /tmp/size.log 2>&1; echo "SIZE=$?"
npm run dup:check > /tmp/dup.log 2>&1; echo "DUP=$?"
npm run build > /tmp/build.log 2>&1; echo "BUILD=$?"
```

Expected: every EXIT=0. Note `dup:check` is blocking in CI and the two toolbar reorders move near-identical JSX around — if it trips, read `/tmp/dup.log` rather than assuming it is noise.

★ STOP HERE. Do not push, open an MR, or merge. Those happen only on an explicit instruction from the user.

---

## Self-review

**Spec coverage:** T1 → Task 1. T2 → Task 2. T3a (`useColumnResize` v2 + raw map) → Task 3. T3b (flex column, minWidth, new declared widths, key bump) → Tasks 4 and 5. T3c (tests) → Tasks 3, 4, 5. Spec's axe/eye-verify section → Task 6. Spec's "out of scope" items (gutter removal, the 40px drag floor) are stated as out of scope in Task 5 Step 3 and are not implemented.

**Deviation from the spec, deliberate:** the spec proposed threading a new `sizedCols` prop. The file-size ratchet has one line of headroom on both `tasks-section.tsx` and `task-manager.tsx`, which that approach would exceed. Returning `sizedWidths` and swapping *which map* is passed as the existing `colWidths` prop achieves the same thing at net zero lines. The spec's `sizedCols` naming does not appear anywhere in this plan.

**Naming consistency:** `sizedWidths` (hook return, prop value) · `colWidths` (prop name, merged map for the other 19 consumers) · `visibleTaskCols` / `tableMinWidthPx` / `colWidthStyle` / `GUTTER_WIDTH_PX` / `TASK_NAME_MIN_PX` (geometry module) · `ALL_TASK_COLS` (extracted leaf) — each used with the same signature in every task that references it.
