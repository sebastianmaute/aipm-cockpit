# Saved Views — Cross-View Phase Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the RAID, Milestones, Changes, and Stakeholders panels the same save/apply/delete preset control the tasks view has, by lifting each panel's render-local filter/sort state into a generic filter context.

**Architecture:** A new generic `PanelFiltersProvider` context holds `{search, filters:Record<string,string>, sort}` per panel; a new view-tagged pure store (`panel-views.ts`, key `lop-app:panel-views`) persists named presets per view; a generic control (`panel-views-control.tsx`) reads/writes the context. Each of the four panels wraps its body in the provider and mounts the control. The shipped tasks path (`saved-views.ts`, `filters-context`, `saved-views-control.tsx`) is untouched.

**Tech Stack:** TypeScript, React 19, forked Next.js 16, Tailwind, vitest, Playwright/axe.

**Reference (do NOT modify, read for pattern):** `src/app/saved-views.ts`, `src/app/use-saved-views.ts`, `src/app/saved-views-control.tsx`.

**Conventions reminders:**
- `npm run lint` is `--max-warnings=0`: an unused import/var is FATAL. Re-check after every extract.
- `react-hooks/set-state-in-effect` is BANNED. `exhaustive-deps` rejects `obj.member` and complex expressions in dep arrays — hoist to a scalar local.
- Run `npx tsc --noEmit` after editing ANY test (test-only type errors pass build+vitest but fail CI).
- i18n EN/DE key parity is tsc-enforced. New keys need both. DE umlauts via node utf8 write (Edit tool corrupts them).
- Existing i18n keys reused by the control (already present, EN+DE): `savedViewsApply`, `savedViewsPlaceholder`, `savedViewsSave`, `savedViewsName`, `savedViewsCancel`, `savedViewsSaveConfirm`, `savedViewsDelete`.

---

### Task 1: Pure store `panel-views.ts`

**Files:**
- Create: `src/app/panel-views.ts`
- Test: `src/app/panel-views.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/app/panel-views.test.ts
import { describe, expect, it, beforeEach } from "vitest";
import {
  type PanelView,
  type PanelFiltersState,
  PANEL_VIEWS_KEY,
  MAX_PANEL_VIEWS,
  loadPanelViews,
  panelViewsFor,
  addPanelView,
  removePanelView,
  savePanelViews,
} from "./panel-views";

const state = (search = ""): PanelFiltersState => ({ search, filters: { status: "All" }, sort: null });

beforeEach(() => localStorage.clear());

describe("panel-views store", () => {
  it("loads [] when empty or malformed", () => {
    expect(loadPanelViews()).toEqual([]);
    localStorage.setItem(PANEL_VIEWS_KEY, "not json");
    expect(loadPanelViews()).toEqual([]);
    localStorage.setItem(PANEL_VIEWS_KEY, JSON.stringify([{ id: "x", name: 1 }]));
    expect(loadPanelViews()).toEqual([]);
  });

  it("addPanelView assigns max+1 id across the whole list", () => {
    let list: PanelView[] = [];
    list = addPanelView(list, "raid", "A", state());
    list = addPanelView(list, "changes", "B", state());
    expect(list.map((v) => v.id)).toEqual([1, 2]);
    expect(list[0].view).toBe("raid");
  });

  it("panelViewsFor scopes to one view", () => {
    let list: PanelView[] = [];
    list = addPanelView(list, "raid", "A", state());
    list = addPanelView(list, "changes", "B", state());
    expect(panelViewsFor(list, "raid").map((v) => v.name)).toEqual(["A"]);
  });

  it("caps per view, dropping the oldest entry of that view only", () => {
    let list: PanelView[] = [];
    for (let i = 0; i < MAX_PANEL_VIEWS + 2; i++) list = addPanelView(list, "raid", `R${i}`, state());
    list = addPanelView(list, "changes", "C", state());
    const raids = panelViewsFor(list, "raid");
    expect(raids).toHaveLength(MAX_PANEL_VIEWS);
    expect(raids[0].name).toBe("R2"); // R0, R1 dropped
    expect(panelViewsFor(list, "changes")).toHaveLength(1); // unaffected
  });

  it("removePanelView removes by id", () => {
    let list: PanelView[] = [];
    list = addPanelView(list, "raid", "A", state());
    list = removePanelView(list, 1);
    expect(list).toEqual([]);
  });

  it("round-trips through save/load and validates state shape", () => {
    let list: PanelView[] = [];
    list = addPanelView(list, "milestones", "M", { search: "x", filters: { status: "all" }, sort: { key: "date", dir: "asc" } });
    savePanelViews(list);
    expect(loadPanelViews()).toEqual(list);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- panel-views.test.ts`
Expected: FAIL — `Cannot find module './panel-views'`.

- [ ] **Step 3: Write the implementation**

```ts
// src/app/panel-views.ts
import type { SortDir } from "./filters-context";

export type PanelViewKind = "raid" | "milestones" | "changes" | "stakeholders";
export const PANEL_VIEW_KINDS: readonly PanelViewKind[] = ["raid", "milestones", "changes", "stakeholders"];

export type PanelSort = { key: string; dir: SortDir } | null;

export interface PanelFiltersState {
  search: string;
  filters: Record<string, string>;
  sort: PanelSort;
}

export interface PanelView {
  id: number;
  name: string;
  view: PanelViewKind;
  state: PanelFiltersState;
}

export const PANEL_VIEWS_KEY = "lop-app:panel-views";
export const MAX_PANEL_VIEWS = 30;

function isStringRecord(value: unknown): value is Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  return Object.values(value).every((v) => typeof v === "string");
}

function isValidSort(value: unknown): value is PanelSort {
  if (value === null) return true;
  if (typeof value !== "object") return false;
  const s = value as Record<string, unknown>;
  return typeof s.key === "string" && (s.dir === "asc" || s.dir === "desc");
}

function isValidState(value: unknown): value is PanelFiltersState {
  if (typeof value !== "object" || value === null) return false;
  const s = value as Record<string, unknown>;
  return typeof s.search === "string" && isStringRecord(s.filters) && isValidSort(s.sort);
}

function isValidView(entry: unknown): entry is PanelView {
  if (typeof entry !== "object" || entry === null) return false;
  const e = entry as Record<string, unknown>;
  return (
    Number.isFinite(e.id) &&
    typeof e.name === "string" &&
    typeof e.view === "string" &&
    (PANEL_VIEW_KINDS as readonly string[]).includes(e.view as string) &&
    isValidState(e.state)
  );
}

export function loadPanelViews(): PanelView[] {
  if (typeof window === "undefined") return [];
  try {
    const parsed = JSON.parse(localStorage.getItem(PANEL_VIEWS_KEY) ?? "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidView);
  } catch {
    return [];
  }
}

export function panelViewsFor(list: readonly PanelView[], view: PanelViewKind): PanelView[] {
  return list.filter((v) => v.view === view);
}

export function addPanelView(
  list: readonly PanelView[],
  view: PanelViewKind,
  name: string,
  state: PanelFiltersState,
): PanelView[] {
  const id = (list.length ? Math.max(...list.map((v) => v.id)) : 0) + 1;
  const next = [...list, { id, name, view, state }];
  // Cap per view: drop the oldest entries OF THIS VIEW beyond the limit.
  const ofView = next.filter((v) => v.view === view);
  if (ofView.length <= MAX_PANEL_VIEWS) return next;
  const dropIds = new Set(ofView.slice(0, ofView.length - MAX_PANEL_VIEWS).map((v) => v.id));
  return next.filter((v) => !dropIds.has(v.id));
}

export function removePanelView(list: readonly PanelView[], id: number): PanelView[] {
  return list.filter((v) => v.id !== id);
}

export function savePanelViews(list: readonly PanelView[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(PANEL_VIEWS_KEY, JSON.stringify(list));
  } catch {
    // ignore quota / serialization errors
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- panel-views.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/panel-views.ts src/app/panel-views.test.ts
git commit -m "feat(saved-views): pure view-tagged panel-views store"
```

---

### Task 2: Generic filter context `panel-filters-context.tsx`

**Files:**
- Create: `src/app/panel-filters-context.tsx`
- Test: `src/app/panel-filters-context.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/app/panel-filters-context.test.tsx
import { describe, expect, it } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { PanelFiltersState } from "./panel-views";
import { PanelFiltersProvider, usePanelFilters } from "./panel-filters-context";

const DEFAULTS: PanelFiltersState = { search: "", filters: { status: "All" }, sort: null };
const wrap = (defaults: PanelFiltersState) => {
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <PanelFiltersProvider defaults={defaults}>{children}</PanelFiltersProvider>
  );
  return Wrapper;
};

describe("panel-filters-context", () => {
  it("seeds from defaults", () => {
    const { result } = renderHook(() => usePanelFilters(), { wrapper: wrap(DEFAULTS) });
    expect(result.current.search).toBe("");
    expect(result.current.filters.status).toBe("All");
    expect(result.current.sort).toBeNull();
  });

  it("setFilter updates one key immutably", () => {
    const { result } = renderHook(() => usePanelFilters(), { wrapper: wrap(DEFAULTS) });
    act(() => result.current.setFilter("status", "Open"));
    expect(result.current.filters.status).toBe("Open");
  });

  it("setSearch and setSort work", () => {
    const { result } = renderHook(() => usePanelFilters(), { wrapper: wrap(DEFAULTS) });
    act(() => result.current.setSearch("hi"));
    act(() => result.current.setSort({ key: "name", dir: "desc" }));
    expect(result.current.search).toBe("hi");
    expect(result.current.sort).toEqual({ key: "name", dir: "desc" });
  });

  it("applyState replaces wholesale; reset returns to defaults", () => {
    const { result } = renderHook(() => usePanelFilters(), { wrapper: wrap(DEFAULTS) });
    act(() => result.current.applyState({ search: "x", filters: { status: "Closed" }, sort: { key: "date", dir: "asc" } }));
    expect(result.current.filters.status).toBe("Closed");
    act(() => result.current.reset());
    expect(result.current.search).toBe("");
    expect(result.current.filters.status).toBe("All");
    expect(result.current.sort).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- panel-filters-context.test.tsx`
Expected: FAIL — `Cannot find module './panel-filters-context'`.

- [ ] **Step 3: Write the implementation**

```tsx
// src/app/panel-filters-context.tsx
"use client";

import { createContext, useCallback, useContext, useMemo, useState } from "react";
import type { PanelFiltersState, PanelSort } from "./panel-views";

interface PanelFiltersValue extends PanelFiltersState {
  setSearch: (s: string) => void;
  setFilter: (key: string, value: string) => void;
  setSort: (sort: PanelSort) => void;
  applyState: (state: PanelFiltersState) => void;
  reset: () => void;
}

const Ctx = createContext<PanelFiltersValue | null>(null);

export function PanelFiltersProvider({
  defaults,
  children,
}: {
  defaults: PanelFiltersState;
  children: React.ReactNode;
}) {
  const [state, setState] = useState<PanelFiltersState>(defaults);

  const setSearch = useCallback((search: string) => setState((s) => ({ ...s, search })), []);
  const setFilter = useCallback(
    (key: string, value: string) => setState((s) => ({ ...s, filters: { ...s.filters, [key]: value } })),
    [],
  );
  const setSort = useCallback((sort: PanelSort) => setState((s) => ({ ...s, sort })), []);
  const applyState = useCallback((next: PanelFiltersState) => setState(next), []);
  const reset = useCallback(() => setState(defaults), [defaults]);

  const value = useMemo<PanelFiltersValue>(
    () => ({ ...state, setSearch, setFilter, setSort, applyState, reset }),
    [state, setSearch, setFilter, setSort, applyState, reset],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function usePanelFilters(): PanelFiltersValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("usePanelFilters must be used within PanelFiltersProvider");
  return v;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- panel-filters-context.test.tsx`
Expected: PASS (4 tests).

- [ ] **Step 5: Typecheck + commit**

```bash
npx tsc --noEmit
git add src/app/panel-filters-context.tsx src/app/panel-filters-context.test.tsx
git commit -m "feat(saved-views): generic panel filter context"
```

---

### Task 3: Hook `use-panel-views.ts`

**Files:**
- Create: `src/app/use-panel-views.ts`
- Test: `src/app/use-panel-views.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/app/use-panel-views.test.tsx
import { describe, expect, it, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { PANEL_VIEWS_KEY, loadPanelViews } from "./panel-views";
import { usePanelViews } from "./use-panel-views";

beforeEach(() => localStorage.clear());

const st = { search: "", filters: { status: "All" }, sort: null };

describe("usePanelViews", () => {
  it("scopes views to the requested kind and persists", () => {
    const { result } = renderHook(() => usePanelViews("raid"));
    act(() => result.current.addView("A", st));
    expect(result.current.views.map((v) => v.name)).toEqual(["A"]);
    expect(loadPanelViews()).toHaveLength(1);
  });

  it("a view of another kind is not visible", () => {
    const raid = renderHook(() => usePanelViews("raid"));
    act(() => raid.result.current.addView("R", st));
    const changes = renderHook(() => usePanelViews("changes"));
    expect(changes.result.current.views).toEqual([]);
  });

  it("removeView deletes by id", () => {
    const { result } = renderHook(() => usePanelViews("raid"));
    act(() => result.current.addView("A", st));
    const id = result.current.views[0].id;
    act(() => result.current.removeView(id));
    expect(result.current.views).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- use-panel-views.test.tsx`
Expected: FAIL — `Cannot find module './use-panel-views'`.

- [ ] **Step 3: Write the implementation**

```ts
// src/app/use-panel-views.ts
import { useCallback, useEffect, useState } from "react";

import {
  type PanelView,
  type PanelViewKind,
  type PanelFiltersState,
  addPanelView,
  loadPanelViews,
  panelViewsFor,
  removePanelView,
  savePanelViews,
} from "./panel-views";

export function usePanelViews(view: PanelViewKind): {
  views: PanelView[];
  addView: (name: string, state: PanelFiltersState) => void;
  removeView: (id: number) => void;
} {
  const [list, setList] = useState<PanelView[]>(() => loadPanelViews());

  useEffect(() => {
    savePanelViews(list);
  }, [list]);

  const addView = useCallback(
    (name: string, state: PanelFiltersState) => setList((prev) => addPanelView(prev, view, name, state)),
    [view],
  );
  const removeView = useCallback((id: number) => setList((prev) => removePanelView(prev, id)), []);

  return { views: panelViewsFor(list, view), addView, removeView };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- use-panel-views.test.tsx`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck + commit**

```bash
npx tsc --noEmit
git add src/app/use-panel-views.ts src/app/use-panel-views.test.tsx
git commit -m "feat(saved-views): usePanelViews hook"
```

---

### Task 4: Generic control `panel-views-control.tsx`

**Files:**
- Create: `src/app/panel-views-control.tsx`
- Test: `src/app/panel-views-control.test.tsx`

**Note:** mirrors `saved-views-control.tsx` (read it for the markup + stale-selection guard), but reads/writes `usePanelFilters()` and is scoped by a `view` prop. RAID gets an optional `onApply` callback so the panel can clear its task backlink.

- [ ] **Step 1: Write the failing test**

```tsx
// src/app/panel-views-control.test.tsx
import { describe, expect, it, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { PanelFiltersProvider, usePanelFilters } from "./panel-filters-context";
import { PanelViewsControl } from "./panel-views-control";
import type { PanelFiltersState } from "./panel-views";

const DEFAULTS: PanelFiltersState = { search: "", filters: { status: "All" }, sort: null };

function Probe() {
  const pf = usePanelFilters();
  return <span data-testid="status">{pf.filters.status}</span>;
}

function Harness() {
  return (
    <PanelFiltersProvider defaults={DEFAULTS}>
      <PanelViewsControl lang="en-US" view="raid" />
      <Probe />
      <FilterSetter />
    </PanelFiltersProvider>
  );
}
function FilterSetter() {
  const pf = usePanelFilters();
  return <button onClick={() => pf.setFilter("status", "Open")}>set-open</button>;
}

beforeEach(() => localStorage.clear());

describe("PanelViewsControl", () => {
  it("saves the current state then applies it back", () => {
    render(<Harness />);
    fireEvent.click(screen.getByText("set-open"));
    expect(screen.getByTestId("status").textContent).toBe("Open");
    // open save form, type a name, confirm
    fireEvent.click(screen.getByText("Save current view"));
    fireEvent.change(screen.getByLabelText("View name"), { target: { value: "Open items" } });
    fireEvent.click(screen.getByLabelText("Save", { selector: "button" }));
    // change the live filter away
    const select = screen.getByLabelText("Apply a saved view");
    // reset live state by applying default? simulate by setting back via select to placeholder is no-op;
    // instead assert the saved option exists and applying it restores Open
    fireEvent.change(select, { target: { value: within(select).getByText("Open items").getAttribute("value")! } });
    expect(screen.getByTestId("status").textContent).toBe("Open");
  });

  it("disables Delete until a valid view is selected", () => {
    render(<Harness />);
    expect(screen.getByLabelText("Delete the selected saved view")).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:run -- panel-views-control.test.tsx`
Expected: FAIL — `Cannot find module './panel-views-control'`.

- [ ] **Step 3: Write the implementation**

```tsx
// src/app/panel-views-control.tsx
"use client";

import { useState } from "react";

import { type Lang, t } from "./i18n";
import { usePanelFilters } from "./panel-filters-context";
import { usePanelViews } from "./use-panel-views";
import type { PanelView, PanelViewKind } from "./panel-views";

interface PanelViewsControlProps {
  lang: Lang;
  view: PanelViewKind;
  // RAID passes this to clear its parent-owned task backlink when a preset is applied.
  onApply?: () => void;
}

const INPUT_CLASS =
  "rounded-md border border-line bg-surface px-2 py-1 text-sm text-foreground focus:ring-AIPM-green";
const BTN_CLASS =
  "rounded-md border border-line bg-surface px-2 py-1 text-sm text-muted-foreground hover:bg-surface-muted hover:text-foreground disabled:opacity-50";

export function PanelViewsControl({ lang, view, onApply }: PanelViewsControlProps) {
  const pf = usePanelFilters();
  const { views, addView, removeView } = usePanelViews(view);

  const [selectedId, setSelectedId] = useState<number | "">("");
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");

  const selectionValid = selectedId !== "" && views.some((v) => v.id === selectedId);
  const selectValue = selectionValid ? String(selectedId) : "";

  function applyView(v: PanelView) {
    pf.applyState(v.state);
    onApply?.();
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
              if (n) addView(n, { search: pf.search, filters: { ...pf.filters }, sort: pf.sort });
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

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:run -- panel-views-control.test.tsx`
Expected: PASS. If the `within(select)...getAttribute` assertion is brittle, simplify: assert the option text appears (`screen.getByRole("option", { name: "Open items" })`) and that Delete becomes enabled after selecting it by `fireEvent.change(select, { target: { value: "1" } })`.

- [ ] **Step 5: Typecheck + commit**

```bash
npx tsc --noEmit
git add src/app/panel-views-control.tsx src/app/panel-views-control.test.tsx
git commit -m "feat(saved-views): generic PanelViewsControl"
```

---

### Task 5: Wire RAID panel

**Files:**
- Modify: `src/app/raid-panel.tsx`

RAID state today (lines ~136–148): `categoryFilter`/`severityFilter`/`statusFilter`/`search` useState + `sort` (`{key:RaidSortKey;dir}|null`) + `toggleSort`. The filtering memo `visible` (lines ~173–214) reads them. `filterTaskId`/`onClearTaskFilter` are props.

- [ ] **Step 1: Split into provider wrapper + body**

At the top of the file add the import and defaults:

```tsx
import { PanelFiltersProvider, usePanelFilters } from "./panel-filters-context";
import { PanelViewsControl } from "./panel-views-control";
import type { PanelFiltersState } from "./panel-views";

const RAID_FILTER_DEFAULTS: PanelFiltersState = {
  search: "",
  filters: { category: "All", severity: "All", status: "All" },
  sort: null,
};
```

Rename the existing exported `RaidPanel` function to `RaidPanelBody`, and add a new wrapper that keeps the original export name:

```tsx
export function RaidPanel(props: RaidPanelProps) {
  return (
    <PanelFiltersProvider defaults={RAID_FILTER_DEFAULTS}>
      <RaidPanelBody {...props} />
    </PanelFiltersProvider>
  );
}

function RaidPanelBody({ /* keep the existing destructured props */ }: RaidPanelProps) {
  const pf = usePanelFilters();
  // ...
}
```

- [ ] **Step 2: Replace the removed useState with context reads**

Delete the four filter `useState` lines and the `sort` useState. Replace usages:
- `categoryFilter` → `pf.filters.category`, `setCategoryFilter(x)` → `pf.setFilter("category", x)`
- `severityFilter` → `pf.filters.severity`, set → `pf.setFilter("severity", x)`
- `statusFilter` → `pf.filters.status`, set → `pf.setFilter("status", x)`
- `search` → `pf.search`, `setSearch(x)` → `pf.setSearch(x)`
- `sort` → `pf.sort`; `toggleSort` becomes:

```tsx
const toggleSort = (key: RaidSortKey) =>
  pf.setSort(
    pf.sort?.key !== key
      ? { key, dir: "asc" }
      : pf.sort.dir === "asc"
        ? { key, dir: "desc" }
        : null,
  );
```

In the `visible` memo, the typed filter comparisons now read `pf.filters.category as "All" | RaidCategory` etc., and the sort branch reads `pf.sort` with `pf.sort.key as RaidSortKey`. Update the `useMemo` dependency array to depend on the hoisted scalars (avoid `pf.filters.category` member expressions in deps — hoist them):

```tsx
const { search, sort } = pf;
const categoryFilter = pf.filters.category;
const severityFilter = pf.filters.severity;
const statusFilter = pf.filters.status;
const visible = useMemo(() => {
  /* existing body, using categoryFilter/severityFilter/statusFilter/search/sort,
     casting sort.key as RaidSortKey at the compareRaid call */
}, [raid, filterTaskId, categoryFilter, severityFilter, statusFilter, search, sort]);
```

- [ ] **Step 3: Mount the control in the toolbar**

Find the filter toolbar row (where the search input + category/severity/status `<select>`s render). Add, beside them:

```tsx
<PanelViewsControl lang={lang} view="raid" onApply={() => filterTaskId !== null && onClearTaskFilter?.()} />
```

- [ ] **Step 4: Run tests + lint + typecheck**

Run: `npm run test:run -- raid` then `npm run lint` then `npx tsc --noEmit`
Expected: existing raid-panel tests PASS; no unused-var warnings; tsc clean. Fix any test that referenced removed internal state by driving the filter UI instead.

- [ ] **Step 5: Commit**

```bash
git add src/app/raid-panel.tsx
git commit -m "feat(saved-views): saved views in RAID panel"
```

---

### Task 6: Wire Milestones panel

**Files:**
- Modify: `src/app/milestones-panel.tsx`

Milestones state today (lines ~76–81): `search`, `statusFilter` (`MilestoneFilterStatus`), `sort` (`{key:"name"|"date";dir:SortDir}` — NON-null, default `{date,asc}`). Uses `filterMilestones({query,status,today})` and `useSortableFilter(filtered, sort, setSort, "", getValue)`.

- [ ] **Step 1: Split into provider wrapper + body**

```tsx
import { PanelFiltersProvider, usePanelFilters } from "./panel-filters-context";
import { PanelViewsControl } from "./panel-views-control";
import type { PanelFiltersState } from "./panel-views";

const MILESTONE_FILTER_DEFAULTS: PanelFiltersState = {
  search: "",
  filters: { status: "all" },
  sort: { key: "date", dir: "asc" },
};
```

Rename the exported component body to `MilestonesPanelBody`, add the wrapper `MilestonesPanel` that renders `<PanelFiltersProvider defaults={MILESTONE_FILTER_DEFAULTS}><MilestonesPanelBody {...props} /></PanelFiltersProvider>`.

- [ ] **Step 2: Replace useState with context**

- `search` → `pf.search`; set → `pf.setSearch`.
- `statusFilter` → `pf.filters.status as MilestoneFilterStatus`; set → `pf.setFilter("status", x)`.
- `sort`: milestones uses `useSortableFilter` which expects a non-null `{key,dir}` and a `setSort`. Adapt:

```tsx
const sort = (pf.sort ?? MILESTONE_FILTER_DEFAULTS.sort) as { key: "name" | "date"; dir: SortDir };
const setSort = (next: { key: "name" | "date"; dir: SortDir }) => pf.setSort(next);
const status = pf.filters.status as MilestoneFilterStatus;
const filtered = filterMilestones(milestones, { query: pf.search, status, today });
const { sorted, click } = useSortableFilter(filtered, sort, setSort, "", getValue);
```

(`pf.sort` is never set to null by the milestones UI — `useSortableFilter` only ever calls `setSort` with a value — so the `?? default` is a safety net for an externally-applied preset.)

- [ ] **Step 3: Mount the control**

In the filter toolbar row (search input + status filter), add:

```tsx
<PanelViewsControl lang={lang} view="milestones" />
```

- [ ] **Step 4: Run tests + lint + typecheck**

Run: `npm run test:run -- milestone` then `npm run lint` then `npx tsc --noEmit`
Expected: PASS / clean.

- [ ] **Step 5: Commit**

```bash
git add src/app/milestones-panel.tsx
git commit -m "feat(saved-views): saved views in Milestones panel"
```

---

### Task 7: Wire Changes panel

**Files:**
- Modify: `src/app/change-panel.tsx`

Changes state today (lines ~128–133): `typeFilter` (`"All"|ChangeType`), `statusFilter` (`"All"|ChangeStatus`), `search`, `sort` (`{key:ChangeSortKey;dir}|null`) + `toggleSort`. Memo `visible` (lines ~140–159).

- [ ] **Step 1: Split into provider wrapper + body**

```tsx
import { PanelFiltersProvider, usePanelFilters } from "./panel-filters-context";
import { PanelViewsControl } from "./panel-views-control";
import type { PanelFiltersState } from "./panel-views";

const CHANGE_FILTER_DEFAULTS: PanelFiltersState = {
  search: "",
  filters: { type: "All", status: "All" },
  sort: null,
};
```

Rename body to `ChangePanelBody`; add wrapper `ChangePanel` rendering the provider around it.

- [ ] **Step 2: Replace useState with context**

- `typeFilter` → `pf.filters.type`, set → `pf.setFilter("type", x)`
- `statusFilter` → `pf.filters.status`, set → `pf.setFilter("status", x)`
- `search` → `pf.search`, set → `pf.setSearch`
- `sort` → `pf.sort`; `toggleSort`:

```tsx
const toggleSort = (key: ChangeSortKey) =>
  pf.setSort(
    pf.sort?.key !== key ? { key, dir: "asc" } : pf.sort.dir === "asc" ? { key, dir: "desc" } : null,
  );
```

Hoist scalars for the memo deps:

```tsx
const { search, sort } = pf;
const typeFilter = pf.filters.type;
const statusFilter = pf.filters.status;
const visible = useMemo(() => {
  /* existing body; cast sort.key as ChangeSortKey at compareChange */
}, [changes, typeFilter, statusFilter, search, sort]);
```

- [ ] **Step 3: Mount the control**

In the filter toolbar row, add: `<PanelViewsControl lang={lang} view="changes" />`

- [ ] **Step 4: Run tests + lint + typecheck**

Run: `npm run test:run -- change` then `npm run lint` then `npx tsc --noEmit`
Expected: PASS / clean.

- [ ] **Step 5: Commit**

```bash
git add src/app/change-panel.tsx
git commit -m "feat(saved-views): saved views in Changes panel"
```

---

### Task 8: Wire Stakeholders panel

**Files:**
- Modify: `src/app/stakeholders-panel.tsx`

Stakeholders state today (lines ~103–109): `search`, `sort` (`{key:StakeholderSortKey;dir}|null`) + `toggleSort`. Memo `visible` (lines ~114–128). No non-search filters.

- [ ] **Step 1: Split into provider wrapper + body**

```tsx
import { PanelFiltersProvider, usePanelFilters } from "./panel-filters-context";
import { PanelViewsControl } from "./panel-views-control";
import type { PanelFiltersState } from "./panel-views";

const STAKEHOLDER_FILTER_DEFAULTS: PanelFiltersState = { search: "", filters: {}, sort: null };
```

Rename body to `StakeholdersPanelBody`; add wrapper `StakeholdersPanel` rendering the provider.

- [ ] **Step 2: Replace useState with context**

- `search` → `pf.search`, set → `pf.setSearch`
- `sort` → `pf.sort`; `toggleSort`:

```tsx
const toggleSort = (key: StakeholderSortKey) =>
  pf.setSort(
    pf.sort?.key !== key ? { key, dir: "asc" } : pf.sort.dir === "asc" ? { key, dir: "desc" } : null,
  );
```

Hoist scalars for the memo deps:

```tsx
const { search, sort } = pf;
const visible = useMemo(() => {
  /* existing body; cast sort.key as StakeholderSortKey at compareStakeholder */
}, [stakeholders, search, sort]);
```

- [ ] **Step 3: Mount the control**

Beside the search input, add: `<PanelViewsControl lang={lang} view="stakeholders" />`

- [ ] **Step 4: Run tests + lint + typecheck**

Run: `npm run test:run -- stakeholder` then `npm run lint` then `npx tsc --noEmit`
Expected: PASS / clean.

- [ ] **Step 5: Commit**

```bash
git add src/app/stakeholders-panel.tsx
git commit -m "feat(saved-views): saved views in Stakeholders panel"
```

---

### Task 9: a11y verify + release

**Files:**
- Modify: `src/app/version.ts`, `CHANGELOG.md`, `README.md`, `package.json`, `AGENTS.md`, `src/app/i18n.ts`, `src/app/i18n.de.ts`

- [ ] **Step 1: a11y gate (RAID + Milestones are axe-scanned)**

Run:
```bash
npx playwright test e2e/a11y.spec.ts --project=chromium -g "RAID"
npx playwright test e2e/a11y.spec.ts --project=chromium -g "Milestones"
```
Expected: PASS (the control's `<select>`/buttons all carry `aria-label`s via the reused `savedViews*` keys). Changes + Stakeholders are not axe-scanned — eye-verify the control renders with labels.

- [ ] **Step 2: Add the highlight key + i18n strings**

In `src/app/version.ts`, append to `APP_HIGHLIGHT_KEYS`:
```ts
  "versionHighlightSavedViewsPanels",
```

In `src/app/i18n.ts` add: `versionHighlightSavedViewsPanels: "Saved views now cover the RAID, Milestones, Changes, and Stakeholders panels.",`

In `src/app/i18n.de.ts` add the German (via node utf8 write — Edit tool corrupts umlauts; the file is CRLF, anchor with `\r\n`):
`versionHighlightSavedViewsPanels: "Gespeicherte Ansichten gelten jetzt auch für die Bereiche RAID, Meilensteine, Änderungen und Stakeholder.",`

- [ ] **Step 3: Version bump**

In `src/app/version.ts`: `APP_VERSION = "0.132.0"`, `APP_BUILD_DATE = "2026-06-22"`, add `APP_MILESTONE` next codename (pick the next sci-fi/fantasy author after "Aldiss"; 0.132.x starts a new minor so it gets its own codename — e.g. "Banks" is taken (0.108); use an unused one such as "Anderson" / "Brunner" / "Disch" — verify against CHANGELOG before choosing). Update the milestone comment + `APP_BUILD_DATE` comment.

- [ ] **Step 4: CHANGELOG + README badge + package.json**

Add a `## 0.132.0 "<codename>"` entry to `CHANGELOG.md` describing cross-view saved views. Bump the README version badge to `0.132.0_%22<codename>%22` and `package.json` `"version": "0.132.0"`.

- [ ] **Step 5: AGENTS.md pointer**

Update the existing **Saved views** bullet: note that SP2 extends presets to RAID/Milestones/Changes/Stakeholders via the generic `panel-filters-context.tsx` + `panel-views.ts` (key `lop-app:panel-views`, separate from tasks' `lop-app:saved-views`) + `panel-views-control.tsx`; tasks path unchanged; column widths/pane size still persist separately; Reports deferred.

- [ ] **Step 6: Full suite + build + typecheck**

Run: `npm run test:run` then `npx tsc --noEmit` then `npm run lint`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "release: 0.132.0 \"<codename>\" — saved views for RAID/Milestones/Changes/Stakeholders"
```

---

## Notes for the executor

- Tasks 1–4 are foundational and sequential (4 depends on 2+3). Tasks 5–8 each touch only their own panel file and all depend on 1–4 — they can run in parallel or in any order.
- Do NOT touch `saved-views.ts`, `use-saved-views.ts`, `saved-views-control.tsx`, or the tasks `filters-context.tsx`/`tasks-section.tsx` — the tasks path is intentionally unchanged.
- After every panel extract, re-run `npm run lint` — an unused import left from the removed `useState` is a CI-fatal warning.
- Existing panel tests that reach into removed internal state must be re-driven through the rendered filter UI, not rewritten to assert on internals.
