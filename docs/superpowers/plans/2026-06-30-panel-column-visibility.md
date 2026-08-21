# Panel Column Visibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users show/hide table columns in the RAID, Milestones, Changes, and Stakeholders panels and persist the choice inside a saved panel view.

**Architecture:** Add `hiddenCols` to the shared `PanelFiltersState` (so panel views already save/restore it), expose a `toggleColumn` setter on `panel-filters-context`, build a reusable `column-config-popover.tsx`, and in each of the four panels add a `CONFIGURABLE_COLS` registry, the popover in the toolbar, and `!hiddenSet.has(key)` guards on each toggleable `<th>`/`<td>` (with `colSpan` derived from the visible count).

**Tech Stack:** Next.js (forked) + React + TypeScript, Tailwind v4 AIPM tokens, Vitest + Testing Library, i18n EN/DE parity (tsc-enforced), Playwright axe gate.

---

## File Structure

- **Modify** `src/app/panel-views.ts` — `hiddenCols` on `PanelFiltersState` + `isValidState`.
- **Modify** `src/app/panel-filters-context.tsx` — `toggleColumn`; default `hiddenCols`.
- **Modify** `src/app/panel-views-control.tsx` — include `hiddenCols` in the saved state.
- **Modify** the four `*_FILTER_DEFAULTS` consts — add `hiddenCols: []`.
- **Create** `src/app/column-config-popover.tsx` (+ test) — reusable gear popover.
- **Modify** `src/app/i18n.ts` + `src/app/i18n.de.ts` — one new key `milestonesColAchieved`.
- **Modify** `src/app/stakeholders-panel.tsx`, `raid-panel.tsx`, `milestones-panel.tsx`, `change-panel.tsx` — registry + popover + guards.
- **Create/Modify** tests: `panel-views.test.ts`, `panel-filters-context.test.tsx`, `column-config-popover.test.tsx`, `stakeholders-panel.test.tsx`, `raid-panel.test.tsx`.

---

## Task 1: `hiddenCols` on the shared state

**Files:**
- Modify: `src/app/panel-views.ts`
- Test: `src/app/panel-views.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `src/app/panel-views.test.ts` (create the file with the import header if it does not exist):

```ts
import { describe, it, expect } from "vitest";
import { loadPanelViews, savePanelViews, type PanelView } from "./panel-views";

describe("panel-views hiddenCols", () => {
  it("round-trips hiddenCols through save/load", () => {
    const v: PanelView = { id: 1, name: "V", view: "stakeholders", state: { search: "", filters: {}, sort: null, hiddenCols: ["email", "title"] } };
    savePanelViews([v]);
    expect(loadPanelViews()[0].state.hiddenCols).toEqual(["email", "title"]);
  });
  it("accepts a legacy view with no hiddenCols (stays valid)", () => {
    localStorage.setItem("lop-app:panel-views", JSON.stringify([{ id: 2, name: "Old", view: "raid", state: { search: "", filters: {}, sort: null } }]));
    const loaded = loadPanelViews();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].state.hiddenCols).toBeUndefined();
  });
  it("rejects a view whose hiddenCols is not a string array", () => {
    localStorage.setItem("lop-app:panel-views", JSON.stringify([{ id: 3, name: "Bad", view: "raid", state: { search: "", filters: {}, sort: null, hiddenCols: [1, 2] } }]));
    expect(loadPanelViews()).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/panel-views.test.ts`
Expected: FAIL — TS error / `hiddenCols` not on the state type; the legacy + reject cases behave wrong.

- [ ] **Step 3: Implement**

In `src/app/panel-views.ts`, add `hiddenCols` to the state interface (optional, for legacy back-compat):

```ts
export interface PanelFiltersState {
  search: string;
  filters: Record<string, string>;
  sort: PanelSort;
  /** Column keys hidden in the table; absent on legacy saved views (treat as none). */
  hiddenCols?: readonly string[];
}
```

And tighten `isValidState` to validate `hiddenCols` when present:

```ts
function isValidState(value: unknown): value is PanelFiltersState {
  if (typeof value !== "object" || value === null) return false;
  const s = value as Record<string, unknown>;
  if (!(typeof s.search === "string" && isStringRecord(s.filters) && isValidSort(s.sort))) return false;
  if (s.hiddenCols === undefined) return true;
  return Array.isArray(s.hiddenCols) && s.hiddenCols.every((c) => typeof c === "string");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/panel-views.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/panel-views.ts src/app/panel-views.test.ts
git commit -m "feat(panel-views): hiddenCols in saved-view state"
```

---

## Task 2: `toggleColumn` on the filters context

**Files:**
- Modify: `src/app/panel-filters-context.tsx`
- Test: `src/app/panel-filters-context.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/app/panel-filters-context.test.tsx`:

```tsx
import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PanelFiltersProvider, usePanelFilters } from "./panel-filters-context";

function Probe() {
  const pf = usePanelFilters();
  return (
    <div>
      <span data-testid="hidden">{(pf.hiddenCols ?? []).join(",")}</span>
      <button onClick={() => pf.toggleColumn("email")}>toggle</button>
      <button onClick={() => pf.applyState({ search: "", filters: {}, sort: null, hiddenCols: ["title"] })}>apply</button>
      <button onClick={() => pf.reset()}>reset</button>
    </div>
  );
}

const DEFAULTS = { search: "", filters: {}, sort: null, hiddenCols: [] as string[] };

it("toggleColumn adds then removes a key", () => {
  render(<PanelFiltersProvider defaults={DEFAULTS}><Probe /></PanelFiltersProvider>);
  fireEvent.click(screen.getByText("toggle"));
  expect(screen.getByTestId("hidden")).toHaveTextContent("email");
  fireEvent.click(screen.getByText("toggle"));
  expect(screen.getByTestId("hidden")).toHaveTextContent("");
});

it("applyState replaces hiddenCols; reset clears them", () => {
  render(<PanelFiltersProvider defaults={DEFAULTS}><Probe /></PanelFiltersProvider>);
  fireEvent.click(screen.getByText("apply"));
  expect(screen.getByTestId("hidden")).toHaveTextContent("title");
  fireEvent.click(screen.getByText("reset"));
  expect(screen.getByTestId("hidden")).toHaveTextContent("");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/panel-filters-context.test.tsx`
Expected: FAIL — `pf.toggleColumn is not a function`.

- [ ] **Step 3: Implement**

In `src/app/panel-filters-context.tsx`, add `toggleColumn` to the interface and provider:

```tsx
interface PanelFiltersValue extends PanelFiltersState {
  setSearch: (s: string) => void;
  setFilter: (key: string, value: string) => void;
  setSort: (sort: PanelSort) => void;
  toggleColumn: (key: string) => void;
  applyState: (state: PanelFiltersState) => void;
  resetFilters: () => void;
  reset: () => void;
}
```

Inside `PanelFiltersProvider`, after `setSort`:

```tsx
  const toggleColumn = useCallback(
    (key: string) =>
      setState((s) => {
        const cur = s.hiddenCols ?? [];
        return { ...s, hiddenCols: cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key] };
      }),
    [],
  );
```

Add `toggleColumn` to the `value` object and its `useMemo` dep array:

```tsx
  const value = useMemo<PanelFiltersValue>(
    () => ({ ...state, setSearch, setFilter, setSort, toggleColumn, applyState, resetFilters, reset }),
    [state, setSearch, setFilter, setSort, toggleColumn, applyState, resetFilters, reset],
  );
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/panel-filters-context.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/panel-filters-context.tsx src/app/panel-filters-context.test.tsx
git commit -m "feat(panel-filters): toggleColumn setter"
```

---

## Task 3: Persist `hiddenCols` on save + default it in the four panels

**Files:**
- Modify: `src/app/panel-views-control.tsx:77`
- Modify: `src/app/stakeholders-panel.tsx:39`, `raid-panel.tsx:58`, `milestones-panel.tsx:13`, `change-panel.tsx:14`

- [ ] **Step 1: Include hiddenCols in the saved state**

In `src/app/panel-views-control.tsx`, change the `addView` call:

```tsx
              if (n) addView(n, { search: pf.search, filters: { ...pf.filters }, sort: pf.sort, hiddenCols: [...(pf.hiddenCols ?? [])] });
```

- [ ] **Step 2: Add `hiddenCols: []` to each FILTER_DEFAULTS**

`src/app/stakeholders-panel.tsx:39`:

```tsx
const STAKEHOLDER_FILTER_DEFAULTS: PanelFiltersState = { search: "", filters: {}, sort: null, hiddenCols: [] };
```

`src/app/raid-panel.tsx:58`, `milestones-panel.tsx:13`, `change-panel.tsx:14` — add `hiddenCols: []` to each `*_FILTER_DEFAULTS` object literal (they span multiple lines; add the property alongside `search`/`filters`/`sort`).

- [ ] **Step 3: Verify typecheck**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/app/panel-views-control.tsx src/app/stakeholders-panel.tsx src/app/raid-panel.tsx src/app/milestones-panel.tsx src/app/change-panel.tsx
git commit -m "feat(panel-views): save + default hiddenCols"
```

---

## Task 4: Reusable `column-config-popover.tsx`

**Files:**
- Create: `src/app/column-config-popover.tsx`
- Test: `src/app/column-config-popover.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/app/column-config-popover.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ColumnConfigPopover } from "./column-config-popover";
import { t } from "./i18n";

const COLS = [
  { key: "email", labelKey: "stakeholderFieldEmail" as const },
  { key: "title", labelKey: "stakeholderFieldTitle" as const },
];

it("opens the dialog and lists a checkbox per column (checked = visible)", () => {
  render(<ColumnConfigPopover lang="en-US" cols={COLS} hidden={new Set(["email"])} onToggle={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: t("en-US", "colConfigTitle") }));
  const email = screen.getByLabelText(t("en-US", "stakeholderFieldEmail")) as HTMLInputElement;
  const title = screen.getByLabelText(t("en-US", "stakeholderFieldTitle")) as HTMLInputElement;
  expect(email.checked).toBe(false); // hidden
  expect(title.checked).toBe(true);
});

it("fires onToggle(key) when a checkbox is clicked", () => {
  const onToggle = vi.fn();
  render(<ColumnConfigPopover lang="en-US" cols={COLS} hidden={new Set()} onToggle={onToggle} />);
  fireEvent.click(screen.getByRole("button", { name: t("en-US", "colConfigTitle") }));
  fireEvent.click(screen.getByLabelText(t("en-US", "stakeholderFieldEmail")));
  expect(onToggle).toHaveBeenCalledWith("email");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/column-config-popover.test.tsx`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/app/column-config-popover.tsx`:

```tsx
"use client";

import { useRef, useState } from "react";
import { type Lang, t, type TranslationKey } from "./i18n";
import { usePopoverDismiss } from "./use-popover-dismiss";
import { INTERACTIVE } from "./interaction-styles";

export interface ColumnConfigCol {
  key: string;
  labelKey: TranslationKey;
}

interface ColumnConfigPopoverProps {
  lang: Lang;
  cols: readonly ColumnConfigCol[];
  /** Currently hidden column keys. */
  hidden: Set<string>;
  onToggle: (key: string) => void;
}

/** Reusable "configure columns" gear popover: a checklist where a ticked box
 *  means the column is VISIBLE. Mirrors the tasks-view column manager. */
export function ColumnConfigPopover({ lang, cols, hidden, onToggle }: ColumnConfigPopoverProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  usePopoverDismiss(open, wrapRef, () => setOpen(false));

  return (
    <div ref={wrapRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={t(lang, "colConfigTitle")}
        title={t(lang, "colConfigTitle")}
        aria-expanded={open}
        className={`rounded-md p-1.5 text-muted-foreground hover:bg-surface-muted hover:text-foreground ${INTERACTIVE}`}
      >
        <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="h-4 w-4">
          <path fillRule="evenodd" d="M7.84 1.804A1 1 0 018.82 1h2.36a1 1 0 01.98.804l.25 1.252a6.013 6.013 0 011.317.757l1.198-.42a1 1 0 011.15.376l1.18 2.044a1 1 0 01-.205 1.274l-.96.836a6.02 6.02 0 010 1.514l.96.836a1 1 0 01.205 1.274l-1.18 2.044a1 1 0 01-1.15.376l-1.198-.42a6.014 6.014 0 01-1.317.757l-.25 1.252a1 1 0 01-.98.804H8.82a1 1 0 01-.98-.804l-.25-1.252a6.013 6.013 0 01-1.317-.757l-1.198.42a1 1 0 01-1.15-.376L2.745 13.3a1 1 0 01.205-1.274l.96-.836a6.023 6.023 0 010-1.514l-.96-.836a1 1 0 01-.205-1.274L3.925 5.52a1 1 0 011.15-.376l1.198.42a6.013 6.013 0 011.317-.757l.25-1.252zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
        </svg>
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={t(lang, "colConfigTitle")}
          className="absolute right-0 top-full z-40 mt-1 w-52 rounded-lg border border-line bg-surface p-3"
        >
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t(lang, "colConfigTitle")}</p>
          <ul className="space-y-1">
            {cols.map(({ key, labelKey }) => (
              <li key={key}>
                <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-sm text-foreground hover:bg-surface-muted">
                  <input
                    type="checkbox"
                    checked={!hidden.has(key)}
                    onChange={() => onToggle(key)}
                    className="h-3.5 w-3.5 rounded border-line text-AIPM-dark-blue focus:ring-AIPM-green"
                  />
                  {t(lang, labelKey)}
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/column-config-popover.test.tsx`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/column-config-popover.tsx src/app/column-config-popover.test.tsx
git commit -m "feat(documents): reusable column-config popover"
```

---

## Task 5: i18n key `milestonesColAchieved` (Milestones' achieved column has a blank header)

**Files:**
- Modify: `src/app/i18n.ts` (near `milestonesColStatus`)
- Modify: `src/app/i18n.de.ts` (near `milestonesColStatus`)

- [ ] **Step 1: Add the EN key**

In `src/app/i18n.ts`, immediately after the `milestonesColStatus: "...",` line, add:

```ts
  milestonesColAchieved: "Achieved",
```

- [ ] **Step 2: Add the DE key via node utf8 write**

Run (anchor is ASCII; no umlaut in these values, but use the node path for CRLF safety):

```bash
node -e '
const fs=require("fs");const p="src/app/i18n.de.ts";let s=fs.readFileSync(p,"utf8");
const m=s.match(/(  milestonesColStatus: "[^"]*",\r?\n)/);
if(!m){console.error("ANCHOR MISS");process.exit(1);}
s=s.replace(m[1], m[1]+"  milestonesColAchieved: \"Erreicht\",\r\n");
fs.writeFileSync(p,s);console.log("DE key inserted");
'
```

Expected: `DE key inserted`.

- [ ] **Step 3: Verify parity**

Run: `npx tsc --noEmit`
Expected: PASS (EN/DE parity holds).

- [ ] **Step 4: Commit**

```bash
git add src/app/i18n.ts src/app/i18n.de.ts
git commit -m "i18n(milestones): achieved column label"
```

---

## Task 6: Stakeholders panel — registry, popover, guards (fully worked template)

**Files:**
- Modify: `src/app/stakeholders-panel.tsx`
- Test: `src/app/stakeholders-panel.test.tsx`

- [ ] **Step 1: Write the failing test**

Add to `src/app/stakeholders-panel.test.tsx` a test that hides the email column. (Use the file's existing render helper + seeded stakeholder; if none, render `<StakeholdersPanel>` inside its `PanelFiltersProvider` with one stakeholder that has an email.) Assert:

```tsx
// Open the column config popover, untick "Email", assert the email cell is gone.
import { t } from "./i18n";
// ...inside a test, after rendering the panel with one stakeholder whose email shows:
fireEvent.click(screen.getByRole("button", { name: t("en-US", "colConfigTitle") }));
fireEvent.click(screen.getByLabelText(t("en-US", "stakeholderFieldEmail")));
expect(screen.queryByText("ada@example.com")).not.toBeInTheDocument();
```

(If the test file lacks a render harness, mirror the one in `raid-panel.test.tsx`/`change-panel.test.tsx`; those render the panel within `PanelFiltersProvider`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/stakeholders-panel.test.tsx`
Expected: FAIL — no column-config button exists yet.

- [ ] **Step 3: Implement**

3a. Add imports near the top of `src/app/stakeholders-panel.tsx`:

```tsx
import { ColumnConfigPopover } from "./column-config-popover";
```

3b. Add the registry next to `STAKEHOLDER_COL_WIDTHS`:

```tsx
const STAKEHOLDER_CONFIG_COLS = [
  { key: "name", labelKey: "stakeholderFieldName" },
  { key: "organization", labelKey: "stakeholderFieldOrganization" },
  { key: "title", labelKey: "stakeholderFieldTitle" },
  { key: "category", labelKey: "stakeholderFieldCategory" },
  { key: "influence", labelKey: "stakeholderFieldInfluence" },
  { key: "interest", labelKey: "stakeholderFieldInterest" },
  { key: "resource", labelKey: "stakeholderFieldResource" },
  { key: "email", labelKey: "stakeholderFieldEmail" },
] as const;
```

3c. In the panel body (after `const pf = usePanelFilters();`), derive the hidden set:

```tsx
  const hiddenSet = new Set(pf.hiddenCols ?? []);
```

3d. In the toolbar, immediately before `<PanelViewsControl lang={lang} view="stakeholders" />` (line ~281), add:

```tsx
      <ColumnConfigPopover lang={lang} cols={STAKEHOLDER_CONFIG_COLS} hidden={hiddenSet} onToggle={pf.toggleColumn} />
```

3e. Guard each toggleable header and body cell. For EACH key in `STAKEHOLDER_CONFIG_COLS` (`name, organization, title, category, influence, interest, resource, email`), wrap its `<th>…</th>` (in the `<thead>` around lines 342–435) and its matching `<td>…</td>` (in the row map) so they render only when visible. Pattern — a header that is currently:

```tsx
<th className="relative ..." style={{ width: colWidths.email, ... }}>…</th>
```

becomes:

```tsx
{!hiddenSet.has("email") && (
  <th className="relative ..." style={{ width: colWidths.email, ... }}>…</th>
)}
```

and the matching body cell:

```tsx
<td className="...">{s.email ...}</td>
```

becomes:

```tsx
{!hiddenSet.has("email") && <td className="...">{s.email ...}</td>}
```

Do this for all eight keys. Leave the leading row-select checkbox `<th>`/`<td>` (width 36) unguarded (always on).

3f. Fix the empty-state `colSpan` (line ~440, currently `colSpan={9}`):

```tsx
<td colSpan={1 + STAKEHOLDER_CONFIG_COLS.filter((c) => !hiddenSet.has(c.key)).length} className="p-10 text-center text-sm text-muted-foreground">
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/stakeholders-panel.test.tsx`
Expected: PASS.

- [ ] **Step 5: Typecheck + lint + commit**

```bash
npx tsc --noEmit
npx eslint src/app/stakeholders-panel.tsx src/app/column-config-popover.tsx --max-warnings=0
git add src/app/stakeholders-panel.tsx src/app/stakeholders-panel.test.tsx
git commit -m "feat(stakeholders): column show/hide saved in view"
```

---

## Task 7: RAID panel — registry, popover, guards

**Files:**
- Modify: `src/app/raid-panel.tsx`
- Test: `src/app/raid-panel.test.tsx`

- [ ] **Step 1: Write the failing test**

Add to `src/app/raid-panel.test.tsx` (it already renders the panel within `PanelFiltersProvider`): open the popover, untick "Owner" (`raidOwner`), and assert a seeded owner value disappears from the table. Use the same pattern as Task 6 Step 1 with `labelKey` `raidOwner`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/raid-panel.test.tsx`
Expected: FAIL — no column-config button.

- [ ] **Step 3: Implement**

3a. `import { ColumnConfigPopover } from "./column-config-popover";`

3b. Registry next to `RAID_COL_WIDTHS`:

```tsx
const RAID_CONFIG_COLS = [
  { key: "id", labelKey: "id" },
  { key: "category", labelKey: "raidCategory" },
  { key: "title", labelKey: "raidTitle" },
  { key: "severity", labelKey: "raidSeverity" },
  { key: "status", labelKey: "raidStatus" },
  { key: "owner", labelKey: "raidOwner" },
  { key: "targetDate", labelKey: "raidTargetDate" },
  { key: "linkedTasks", labelKey: "raidLinkedTasks" },
  { key: "causedBy", labelKey: "raidCausedBy" },
] as const;
```

3c. After `const pf = usePanelFilters();` (or equivalent), add `const hiddenSet = new Set(pf.hiddenCols ?? []);`.

3d. In the toolbar, before `<PanelViewsControl lang={lang} view="raid" ... />` (line ~487), add:

```tsx
      <ColumnConfigPopover lang={lang} cols={RAID_CONFIG_COLS} hidden={hiddenSet} onToggle={pf.toggleColumn} />
```

3e. Guard each toggleable `<th>` (thead ~542–589) and matching `<td>` for the nine keys with `{!hiddenSet.has("<key>") && ( … )}`, exactly as in Task 6 Step 3e. Leave the row-select checkbox column unguarded.

3f. Fix BOTH `colSpan` sites:
- line ~597 (empty state, `colSpan={10}`) → `colSpan={1 + RAID_CONFIG_COLS.filter((c) => !hiddenSet.has(c.key)).length}`.
- line ~734 (`colSpan={9}` — the expanded/detail row that spans the data columns without the select cell) → `colSpan={RAID_CONFIG_COLS.filter((c) => !hiddenSet.has(c.key)).length}`. Read the surrounding rows to confirm whether that cell also follows a rendered select `<td>`; if it does, add the `1 +`. Match whatever makes the row span exactly the rendered columns.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/raid-panel.test.tsx`
Expected: PASS.

- [ ] **Step 5: Typecheck + lint + commit**

```bash
npx tsc --noEmit
npx eslint src/app/raid-panel.tsx --max-warnings=0
git add src/app/raid-panel.tsx src/app/raid-panel.test.tsx
git commit -m "feat(raid): column show/hide saved in view"
```

---

## Task 8: Milestones panel — registry, popover, guards (no colSpan rows)

**Files:**
- Modify: `src/app/milestones-panel.tsx`

- [ ] **Step 1: Implement**

1a. `import { ColumnConfigPopover } from "./column-config-popover";`

1b. Registry next to `MILESTONE_COL_WIDTHS`:

```tsx
const MILESTONE_CONFIG_COLS = [
  { key: "name", labelKey: "milestonesColName" },
  { key: "date", labelKey: "milestonesColDate" },
  { key: "status", labelKey: "milestonesColStatus" },
  { key: "achieved", labelKey: "milestonesColAchieved" },
] as const;
```

1c. After `const pf = usePanelFilters();`, add `const hiddenSet = new Set(pf.hiddenCols ?? []);`.

1d. In the toolbar, before `<PanelViewsControl lang={lang} view="milestones" />` (line ~291), add:

```tsx
          <ColumnConfigPopover lang={lang} cols={MILESTONE_CONFIG_COLS} hidden={hiddenSet} onToggle={pf.toggleColumn} />
```

1e. Guard the four `<th>` (thead ~342–378) and matching `<td>` cells with `{!hiddenSet.has("<key>") && ( … )}`. The "achieved" header is currently an empty `<th>` containing only a `<ColumnResizeHandle>` — guard that `<th>` on `"achieved"` and its body cell too. Leave the row-select checkbox column unguarded.

> No `colSpan` changes here: Milestones' empty + no-match states render `<p>`/dashed-box, not table cells.

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit && npx eslint src/app/milestones-panel.tsx --max-warnings=0 && npx vitest run src/app/milestones-panel.test.tsx`
Expected: PASS (existing milestones tests still green).

- [ ] **Step 3: Commit**

```bash
git add src/app/milestones-panel.tsx
git commit -m "feat(milestones): column show/hide saved in view"
```

---

## Task 9: Changes panel — registry, popover, guards

**Files:**
- Modify: `src/app/change-panel.tsx`

- [ ] **Step 1: Implement**

1a. `import { ColumnConfigPopover } from "./column-config-popover";`

1b. Registry next to `CHANGE_COL_WIDTHS`:

```tsx
const CHANGE_CONFIG_COLS = [
  { key: "id", labelKey: "id" },
  { key: "type", labelKey: "changeFieldType" },
  { key: "title", labelKey: "changeFieldTitle" },
  { key: "impact", labelKey: "changeFieldImpact" },
  { key: "status", labelKey: "changeFieldStatus" },
  { key: "requestedBy", labelKey: "changeFieldRequestedBy" },
  { key: "raisedDate", labelKey: "changeFieldRaisedDate" },
] as const;
```

1c. After `const pf = usePanelFilters();`, add `const hiddenSet = new Set(pf.hiddenCols ?? []);`.

1d. In the toolbar, before `<PanelViewsControl lang={lang} view="changes" />` (line ~360), add:

```tsx
      <ColumnConfigPopover lang={lang} cols={CHANGE_CONFIG_COLS} hidden={hiddenSet} onToggle={pf.toggleColumn} />
```

1e. Guard the seven `<th>` (thead ~426–452) and matching `<td>` cells with `{!hiddenSet.has("<key>") && ( … )}`. Leave the row-select checkbox column unguarded.

1f. Fix the empty-state `colSpan` (line ~473, `colSpan={8}`):

```tsx
<td colSpan={1 + CHANGE_CONFIG_COLS.filter((c) => !hiddenSet.has(c.key)).length} className="p-10 text-center text-sm text-muted-foreground">
```

- [ ] **Step 2: Verify**

Run: `npx tsc --noEmit && npx eslint src/app/change-panel.tsx --max-warnings=0 && npx vitest run src/app/change-panel.test.tsx`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/app/change-panel.tsx
git commit -m "feat(changes): column show/hide saved in view"
```

---

## Task 10: Full verification + axe

**Files:** none (gates only).

- [ ] **Step 1: Typecheck + full lint**

Run: `npx tsc --noEmit && npx eslint . --max-warnings=0`
Expected: PASS (no output).

- [ ] **Step 2: Full unit suite**

Run: `npm run test:run`
Expected: PASS (all tests, including the new panel-views / context / popover / panel tests).

- [ ] **Step 3: axe gate for the two scanned panels**

Run: `npx playwright test e2e/a11y.spec.ts --project=chromium -g "RAID"` then `-g "Milestones"`
Expected: PASS (gear button labeled, checkboxes labeled, `role=dialog` named — no axe-critical).

- [ ] **Step 4: Eye-verify (manual)**

`npm run dev` → each of the four panels: gear popover toggles columns; hidden header + cells disappear together; empty/no-match rows still span the full width; save a view with columns hidden, switch away and back / re-apply the saved view → hidden set restored. Changes/Stakeholders are not axe-scanned — eye-check the gear button contrast + popover.

---

## Self-Review

- **Spec coverage:** shared state (T1), context setter (T2), persistence + defaults (T3), reusable control (T4), milestones label key (T5), per-panel registry+popover+guards (T6–T9), verification incl. axe (T10). All spec sections mapped.
- **Placeholder scan:** none — the per-cell guarding is given as an exact mechanical rule with worked th/td examples + the explicit key list per panel; `colSpan` formulas are concrete; the only spec "verify per panel" item (milestones blank header) is resolved by T5's concrete key.
- **Type consistency:** `hiddenCols?: readonly string[]` (T1) ↔ `pf.hiddenCols ?? []` (T2/T3/T6–T9); `toggleColumn(key)` (T2) ↔ `onToggle={pf.toggleColumn}` (T6–T9); `ColumnConfigCol {key,labelKey}` (T4) ↔ each `*_CONFIG_COLS` literal (T6–T9); `hidden: Set<string>` prop ↔ `hiddenSet = new Set(pf.hiddenCols ?? [])`.
- **Note:** `*_CONFIG_COLS` are declared `as const` so their `labelKey` string literals satisfy `TranslationKey`; if tsc rejects a literal, append `satisfies readonly ColumnConfigCol[]` (imported from `column-config-popover`).
