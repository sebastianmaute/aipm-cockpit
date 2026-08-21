# Saved Views — Reports (SP3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend the per-device saved-views feature to the Reports panel — persist the 3 tables' (byAssignee / byGroup / byLabel) sort + filter state as named, reusable presets.

**Architecture:** A dedicated bespoke store (`reports-views.ts`) — Reports has 3 independent `{sort,filter}` pairs, which the generic `PanelFiltersState` ({search,filters,sort}) can't hold; widening the shipped generic store risks the 4 uniform panels. Mirrors the tasks bespoke path and `panel-views.ts` mechanics. A hook (`use-reports-views.ts`) + a props-based control (`reports-views-control.tsx`, no context — `ReportsPanel` already centralizes its 6 useState). Column widths / pane size persist separately and are untouched by presets.

**Tech Stack:** TypeScript, React 19, forked Next.js 16, Tailwind, vitest. Per-device localStorage (`lop-app:` prefix → OUT of exports/Turso, cleared by `clearAppConfig`'s `lop-app:*` sweep).

---

### Task 1: Pure store `reports-views.ts`

**Files:**
- Create: `src/app/reports-views.ts`
- Test: `src/app/reports-views.test.ts`

`SortDir` MUST come from `./report-table` (the 3-value superset `"asc"|"desc"|"off"` — Reports cycles asc→desc→off via `useSortableFilter`; the narrower union would silently fail validation and drop the saved view on reload, the Milestones landmine).

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, expect, it, beforeEach } from "vitest";
import {
  type ReportsSavedView,
  type ReportsViewState,
  REPORTS_VIEWS_KEY,
  MAX_REPORTS_VIEWS,
  loadReportsViews,
  addReportsView,
  removeReportsView,
  saveReportsViews,
} from "./reports-views";

const state = (filter = ""): ReportsViewState => ({
  assignee: { filter, sort: { key: "total", dir: "desc" } },
  group: { filter: "", sort: { key: "total", dir: "off" } },
  label: { filter: "", sort: { key: "name", dir: "asc" } },
});

beforeEach(() => localStorage.clear());

describe("reports-views store", () => {
  it("loads [] when empty or malformed", () => {
    expect(loadReportsViews()).toEqual([]);
    localStorage.setItem(REPORTS_VIEWS_KEY, "not json");
    expect(loadReportsViews()).toEqual([]);
    localStorage.setItem(REPORTS_VIEWS_KEY, JSON.stringify([{ id: "x", name: 1 }]));
    expect(loadReportsViews()).toEqual([]);
  });

  it("addReportsView assigns max+1 id", () => {
    let list: ReportsSavedView[] = [];
    list = addReportsView(list, "A", state());
    list = addReportsView(list, "B", state());
    expect(list.map((v) => v.id)).toEqual([1, 2]);
  });

  it("caps at MAX_REPORTS_VIEWS, dropping the oldest", () => {
    let list: ReportsSavedView[] = [];
    for (let i = 0; i < MAX_REPORTS_VIEWS + 2; i++) list = addReportsView(list, `V${i}`, state());
    expect(list).toHaveLength(MAX_REPORTS_VIEWS);
    expect(list[0].name).toBe("V2");
  });

  it("removeReportsView removes by id", () => {
    let list: ReportsSavedView[] = [];
    list = addReportsView(list, "A", state());
    list = removeReportsView(list, 1);
    expect(list).toEqual([]);
  });

  it("round-trips through save/load", () => {
    let list: ReportsSavedView[] = [];
    list = addReportsView(list, "M", state("x"));
    saveReportsViews(list);
    expect(loadReportsViews()).toEqual(list);
  });

  it("persists a sort dir of 'off' (tables cycle asc->desc->off)", () => {
    let list: ReportsSavedView[] = [];
    list = addReportsView(list, "Off", state());
    saveReportsViews(list);
    expect(loadReportsViews()).toEqual(list);
  });

  it("drops an entry whose sort dir is invalid", () => {
    const bad = [{ id: 1, name: "x", state: { assignee: { filter: "", sort: { key: "total", dir: "sideways" } }, group: { filter: "", sort: null }, label: { filter: "", sort: null } } }];
    localStorage.setItem(REPORTS_VIEWS_KEY, JSON.stringify(bad));
    expect(loadReportsViews()).toEqual([]);
  });
});
```

Run: `npx vitest run src/app/reports-views.test.ts` → FAIL (module not found).

- [ ] **Step 2: Implement `reports-views.ts`**

```typescript
// Reports has THREE independent sortable+filterable tables; a saved view stores
// each table's sort + filter. report-table's SortDir is the SUPERSET
// ("asc"|"desc"|"off") — the tables cycle through "off" via useSortableFilter,
// so the persisted sort must hold it (a narrower union would fail validation
// and silently drop the saved view on reload).
import type { SortDir } from "./report-table";

export interface ReportsTableState {
  filter: string;
  sort: { key: string; dir: SortDir } | null;
}

export interface ReportsViewState {
  assignee: ReportsTableState;
  group: ReportsTableState;
  label: ReportsTableState;
}

export interface ReportsSavedView {
  id: number;
  name: string;
  state: ReportsViewState;
}

export const REPORTS_VIEWS_KEY = "lop-app:reports-views";
export const MAX_REPORTS_VIEWS = 30;

function isValidSort(value: unknown): value is ReportsTableState["sort"] {
  if (value === null) return true;
  if (typeof value !== "object") return false;
  const s = value as Record<string, unknown>;
  return typeof s.key === "string" && (s.dir === "asc" || s.dir === "desc" || s.dir === "off");
}

function isValidTable(value: unknown): value is ReportsTableState {
  if (typeof value !== "object" || value === null) return false;
  const s = value as Record<string, unknown>;
  return typeof s.filter === "string" && isValidSort(s.sort);
}

function isValidState(value: unknown): value is ReportsViewState {
  if (typeof value !== "object" || value === null) return false;
  const s = value as Record<string, unknown>;
  return isValidTable(s.assignee) && isValidTable(s.group) && isValidTable(s.label);
}

function isValidView(entry: unknown): entry is ReportsSavedView {
  if (typeof entry !== "object" || entry === null) return false;
  const e = entry as Record<string, unknown>;
  return Number.isFinite(e.id) && typeof e.name === "string" && isValidState(e.state);
}

export function loadReportsViews(): ReportsSavedView[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(REPORTS_VIEWS_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidView);
  } catch {
    return [];
  }
}

export function addReportsView(
  list: readonly ReportsSavedView[],
  name: string,
  state: ReportsViewState,
): ReportsSavedView[] {
  const id = (list.length ? Math.max(...list.map((v) => v.id)) : 0) + 1;
  const next = [...list, { id, name, state }];
  if (next.length <= MAX_REPORTS_VIEWS) return next;
  return next.slice(next.length - MAX_REPORTS_VIEWS);
}

export function removeReportsView(list: readonly ReportsSavedView[], id: number): ReportsSavedView[] {
  return list.filter((v) => v.id !== id);
}

export function saveReportsViews(list: readonly ReportsSavedView[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(REPORTS_VIEWS_KEY, JSON.stringify(list));
  } catch {
    // ignore quota / serialization errors
  }
}
```

- [ ] **Step 3: Run tests** → PASS. Then `npx tsc --noEmit` → EXIT 0.

- [ ] **Step 4: Commit** `feat(saved-views): pure reports-views store`

---

### Task 2: Hook `use-reports-views.ts`

**Files:**
- Create: `src/app/use-reports-views.ts`
- Test: `src/app/use-reports-views.test.tsx`

- [ ] **Step 1: Write failing test** (mirror `use-panel-views.test.tsx`)

```typescript
import { describe, expect, it, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useReportsViews } from "./use-reports-views";
import { loadReportsViews, type ReportsViewState } from "./reports-views";

const state: ReportsViewState = {
  assignee: { filter: "", sort: { key: "total", dir: "desc" } },
  group: { filter: "", sort: null },
  label: { filter: "", sort: null },
};

beforeEach(() => localStorage.clear());

describe("useReportsViews", () => {
  it("adds and persists a view", () => {
    const { result } = renderHook(() => useReportsViews());
    act(() => result.current.addView("A", state));
    expect(result.current.views.map((v) => v.name)).toEqual(["A"]);
    expect(loadReportsViews().map((v) => v.name)).toEqual(["A"]);
  });

  it("removes a view", () => {
    const { result } = renderHook(() => useReportsViews());
    act(() => result.current.addView("A", state));
    const id = result.current.views[0].id;
    act(() => result.current.removeView(id));
    expect(result.current.views).toEqual([]);
  });
});
```

Run: `npx vitest run src/app/use-reports-views.test.tsx` → FAIL.

- [ ] **Step 2: Implement** (mirror `use-panel-views.ts`)

```typescript
import { useCallback, useEffect, useState } from "react";

import {
  type ReportsSavedView,
  type ReportsViewState,
  addReportsView,
  loadReportsViews,
  removeReportsView,
  saveReportsViews,
} from "./reports-views";

export function useReportsViews(): {
  views: ReportsSavedView[];
  addView: (name: string, state: ReportsViewState) => void;
  removeView: (id: number) => void;
} {
  const [list, setList] = useState<ReportsSavedView[]>(() => loadReportsViews());

  useEffect(() => {
    saveReportsViews(list);
  }, [list]);

  const addView = useCallback(
    (name: string, state: ReportsViewState) => setList((prev) => addReportsView(prev, name, state)),
    [],
  );
  const removeView = useCallback((id: number) => setList((prev) => removeReportsView(prev, id)), []);

  return { views: list, addView, removeView };
}
```

- [ ] **Step 3: Run tests** → PASS. `npx tsc --noEmit` → EXIT 0.

- [ ] **Step 4: Commit** `feat(saved-views): useReportsViews hook`

---

### Task 3: Control `reports-views-control.tsx` + wire into `reports.tsx`

**Files:**
- Create: `src/app/reports-views-control.tsx`
- Test: `src/app/reports-views-control.test.tsx`
- Modify: `src/app/reports.tsx`

- [ ] **Step 1: Write failing test for the control**

```typescript
import { describe, expect, it, beforeEach, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ReportsViewsControl } from "./reports-views-control";
import { type ReportsViewState } from "./reports-views";

const current: ReportsViewState = {
  assignee: { filter: "alice", sort: { key: "total", dir: "desc" } },
  group: { filter: "", sort: { key: "name", dir: "off" } },
  label: { filter: "", sort: null },
};

beforeEach(() => localStorage.clear());

describe("ReportsViewsControl", () => {
  it("saves the current state and applies it back", () => {
    const onApply = vi.fn();
    render(<ReportsViewsControl lang="en-US" currentState={current} onApply={onApply} />);

    fireEvent.click(screen.getByRole("button", { name: "Save current view" }));
    fireEvent.change(screen.getByRole("textbox", { name: "View name" }), { target: { value: "Mine" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    fireEvent.change(screen.getByRole("combobox", { name: "Apply a saved view" }), {
      target: { value: screen.getByRole("option", { name: "Mine" }).getAttribute("value")! },
    });
    expect(onApply).toHaveBeenCalledWith(current);
  });

  it("deletes the selected view", () => {
    render(<ReportsViewsControl lang="en-US" currentState={current} onApply={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: "Save current view" }));
    fireEvent.change(screen.getByRole("textbox", { name: "View name" }), { target: { value: "Mine" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    fireEvent.change(screen.getByRole("combobox", { name: "Apply a saved view" }), {
      target: { value: screen.getByRole("option", { name: "Mine" }).getAttribute("value")! },
    });
    fireEvent.click(screen.getByRole("button", { name: "Delete the selected saved view" }));
    expect(screen.queryByRole("option", { name: "Mine" })).toBeNull();
  });
});
```

Run: `npx vitest run src/app/reports-views-control.test.tsx` → FAIL.

NOTE (tsc/CI): a string `name` in `getByRole` is ALREADY an exact match — do NOT add `{exact:...}`. Run `npx tsc --noEmit` after editing the test.

- [ ] **Step 2: Implement `reports-views-control.tsx`** (props-based; mirrors `saved-views-control.tsx`, generic over `ReportsViewState`)

```tsx
"use client";

import { useState } from "react";

import { type Lang, t } from "./i18n";
import { useReportsViews } from "./use-reports-views";
import { type ReportsSavedView, type ReportsViewState } from "./reports-views";

interface ReportsViewsControlProps {
  lang: Lang;
  currentState: ReportsViewState;
  onApply: (state: ReportsViewState) => void;
}

const INPUT_CLASS =
  "rounded-md border border-line bg-surface px-2 py-1 text-sm text-foreground focus:ring-AIPM-green";
const BTN_CLASS =
  "rounded-md border border-line bg-surface px-2 py-1 text-sm text-muted-foreground hover:bg-surface-muted hover:text-foreground disabled:opacity-50";

export function ReportsViewsControl({ lang, currentState, onApply }: ReportsViewsControlProps) {
  const { views, addView, removeView } = useReportsViews();

  const [selectedId, setSelectedId] = useState<number | "">("");
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");

  const selectionValid = selectedId !== "" && views.some((v) => v.id === selectedId);
  const selectValue = selectionValid ? String(selectedId) : "";

  function applyView(v: ReportsSavedView) {
    onApply(v.state);
  }

  return (
    <div className="inline-flex items-center gap-1">
      <select
        aria-label={t(lang, "savedViewsApply")}
        value={selectValue}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === "") {
            setSelectedId("");
            return;
          }
          const id = Number(raw);
          setSelectedId(id);
          const v = views.find((x) => x.id === id);
          if (v) applyView(v);
        }}
        className={INPUT_CLASS}
      >
        <option value="">{t(lang, "savedViewsPlaceholder")}</option>
        {views.map((v) => (
          <option key={v.id} value={v.id}>
            {v.name}
          </option>
        ))}
      </select>

      {saving ? (
        <>
          <input
            aria-label={t(lang, "savedViewsName")}
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={INPUT_CLASS}
          />
          <button
            type="button"
            aria-label={t(lang, "savedViewsSave")}
            disabled={name.trim() === ""}
            onClick={() => {
              const n = name.trim();
              if (n) addView(n, currentState);
              setSaving(false);
              setName("");
            }}
            className={BTN_CLASS}
          >
            {t(lang, "savedViewsSaveConfirm")}
          </button>
          <button
            type="button"
            onClick={() => {
              setSaving(false);
              setName("");
            }}
            className={BTN_CLASS}
          >
            {t(lang, "savedViewsCancel")}
          </button>
        </>
      ) : (
        <button
          type="button"
          onClick={() => {
            setSaving(true);
            setName("");
          }}
          className={BTN_CLASS}
        >
          {t(lang, "savedViewsSave")}
        </button>
      )}

      <button
        type="button"
        aria-label={t(lang, "savedViewsDelete")}
        title={t(lang, "savedViewsDelete")}
        disabled={!selectionValid}
        onClick={() => {
          if (selectionValid) {
            removeView(Number(selectedId));
            setSelectedId("");
          }
        }}
        className={BTN_CLASS}
      >
        <span aria-hidden="true">✕</span>
      </button>
    </div>
  );
}
```

- [ ] **Step 3: Wire into `reports.tsx`**

Import at top:
```tsx
import { ReportsViewsControl } from "./reports-views-control";
import { type ReportsViewState } from "./reports-views";
```

Add the captured-state + apply handler near the existing sort/filter useState (BEFORE the `if (stats.total === 0)` early return, so hook order is stable — `useReportsViews` runs inside the control, but the control is only rendered in the non-empty branch; capturing the state object below is plain render code and may sit anywhere before the return that uses it). Place this block right after `const { ref: reportsRef, ... } = useResizable(...)` (line ~160), still above the early return:

```tsx
const reportsViewState: ReportsViewState = {
  assignee: { filter: assigneeFilter, sort: assigneeSort },
  group: { filter: groupFilter, sort: groupSort },
  label: { filter: labelFilter, sort: labelSort },
};
const applyReportsView = (s: ReportsViewState) => {
  setAssigneeFilter(s.assignee.filter);
  if (s.assignee.sort) setAssigneeSort(s.assignee.sort as AssigneeSort);
  setGroupFilter(s.group.filter);
  if (s.group.sort) setGroupSort(s.group.sort as GroupOrLabelSort);
  setLabelFilter(s.label.filter);
  if (s.label.sort) setLabelSort(s.label.sort as GroupOrLabelSort);
};
```

Then add the control to `toolbarExtra` in the `ReportCard` (line ~258). Change:
```tsx
toolbarExtra={<>{addReportControl}{removeReportControl}</>}
```
to:
```tsx
toolbarExtra={<><ReportsViewsControl lang={lang} currentState={reportsViewState} onApply={applyReportsView} />{addReportControl}{removeReportControl}</>}
```

NOTE: `AssigneeSort.sort` and `GroupOrLabelSort` use the SAME `SortDir` superset as `ReportsTableState.sort.dir`, so the `as AssigneeSort`/`as GroupOrLabelSort` casts only narrow the `key: string` back to the table's key union — safe (the keys came from that table's own setter when captured). A saved view from a different-shaped project can only carry keys this table emitted, so no invalid key lands.

- [ ] **Step 4: Run** `npx vitest run src/app/reports-views-control.test.tsx` → PASS. `npx tsc --noEmit` → EXIT 0. `npm run lint` (no unused imports — CI `--max-warnings=0`).

- [ ] **Step 5: a11y** — Reports IS axe-scanned. Verify:
`npx playwright test e2e/a11y.spec.ts --project=chromium -g "Reports"` → PASS.

- [ ] **Step 6: Commit** `feat(saved-views): saved views in Reports panel`

---

### Task 4: Release metadata (version, i18n highlight, CHANGELOG, README, AGENTS.md)

**Files:**
- Modify: `src/app/version.ts`, `src/app/i18n.ts`, `src/app/i18n.de.ts`, `CHANGELOG.md`, `README.md`, `package.json`, `AGENTS.md`

- [ ] **Step 1: `version.ts`** — `APP_VERSION="0.133.0"`, `APP_MILESTONE="Tiptree"` (James Tiptree Jr.), `APP_BUILD_DATE="2026-06-22"`, update the 0.133.0 comment, append `"versionHighlightSavedViewsReports"` to `APP_HIGHLIGHT_KEYS`.

- [ ] **Step 2: i18n EN** (`i18n.ts`): add
`versionHighlightSavedViewsReports: "Saved views now cover the Reports panel too",`

- [ ] **Step 3: i18n DE** (`i18n.de.ts`): add the matching key. File is CRLF with real umlauts — the Edit tool corrupts umlauts; this string has none ("Gespeicherte Ansichten gelten jetzt auch fuer den Bereich Berichte" — but use the real umlaut ü in "für"). Write via node utf8 to be safe:
`versionHighlightSavedViewsReports: "Gespeicherte Ansichten gelten jetzt auch für den Bereich Berichte",`
Then verify EN/DE key parity: `npx tsc --noEmit` (enforces parity) and `npx vitest run src/app/i18n-encoding.test.ts`.

- [ ] **Step 4: CHANGELOG.md** — add a `## 0.133.0 "Tiptree" — YYYY-MM-DD` entry describing Reports saved views.

- [ ] **Step 5: README.md** — bump the version badge to `0.133.0_%22Tiptree%22`.

- [ ] **Step 6: package.json** — `"version": "0.133.0"`.

- [ ] **Step 7: AGENTS.md** — add a short architecture bullet under the saved-views entries:
"**Saved views — Reports (SP3, v0.133.0):** dedicated bespoke store `reports-views.ts` (`lop-app:reports-views`, `MAX_REPORTS_VIEWS=30`) — Reports' 3 tables (byAssignee/byGroup/byLabel) each carry `{filter, sort}`, which the generic `PanelFiltersState` can't hold, so it's separate from both the tasks path and the `panel-views.ts` generic stack. `useReportsViews` + props-based `reports-views-control.tsx` (no context — `ReportsPanel` already centralizes the 6 useState; control takes `currentState`+`onApply`). Sort `dir` uses report-table's SortDir superset incl `"off"`. Column widths/pane size persist separately (untouched). OUT of exports/Turso, cleared by `clearAppConfig`'s `lop-app:*` sweep. CLOSES the saved-views roadmap (tasks SP1, cross-view SP2, Reports SP3)."

- [ ] **Step 8: Verify** `npx tsc --noEmit` → 0; `npm run lint` → 0; `npm run test:run` (full suite — tolerate the known `task-manager.portfolio-mode.test.tsx` full-load flake, confirm green in isolation if it trips).

- [ ] **Step 9: Commit** `release: 0.133.0 "Tiptree" — saved views for Reports`

---

## Self-review notes
- SortDir superset ("off") landmine handled in store validation + control casts.
- Hook-order stability: state capture is plain render code; the control (with `useReportsViews`) renders only in the non-empty branch — acceptable because the empty branch returns BEFORE rendering it and never conditionally calls the hook itself.
- No new control i18n strings (reuses `savedViews*`); only one new highlight key (EN+DE parity).
- Store is per-device localStorage → no backend write paths, no exports/Turso, swept by `clearAppConfig`.
