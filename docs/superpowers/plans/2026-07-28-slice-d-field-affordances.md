# Slice D — field affordances (clear ✕ audit · linked-task wildcard · Knowledge sizing)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every search/filter field in the app a visible, keyboard-reachable clear button with a distinct accessible name; accept a `*` wildcard in the chip pickers; stop the Knowledge linked-tasks picker collapsing to content width.

**Architecture:** Reuse the shipped `ClearableSearchInput` primitive (19 sites already) at 15 more fields, reachable through **12 edits** because two of them are shared components (`PaneSearchInput` covers four panels; `EntityLinkPicker` covers five pickers). One new pure module `wildcard-match.ts` owns the `*`→RegExp translation that `customerMatcher` already implements, and both `filterPickerOptions` and the timelog scope filters delegate to it, so the escape logic exists once (`dup:check` is blocking). No new persisted state, no backend write path, no golden fixtures.

**Tech Stack:** Next.js 16 / React 19 / TypeScript · vitest + @testing-library/react + userEvent · Tailwind v4 tokens · Playwright axe gate.

**Spec:** `docs/superpowers/specs/2026-07-28-slice-d-field-affordances-design.md`

**Release:** 0.205.0 "Griffith".

---

## Standing rules for every task in this plan

- **Exact-name queries only.** Assert clear buttons by their full name (`"Clear – Search help"`), never `/clear/i` — that regex matches the unqualified string too and passes against reverted code. Slice C shipped exactly that mistake.
- **After a mutation check, read WHICH assertion failed**, not just that the test went red. A weaker assertion placed ahead of the headline one becomes the reported failure and masks it.
- The EN label literals below were read out of `src/app/i18n.ts` — they are the real strings, not guesses. If a test fails on the name, re-grep the key rather than editing the string.
- `npm run test:run -- <file>` runs one file. Full suite is `npm run test:run` (~8290 tests). A suspiciously LOW file count means crashed workers, not a small run.
- Lint is `--max-warnings=0`: one unused import is fatal.
- `i18n.de.ts` is CRLF and the Edit tool corrupts umlauts — patch it with a node utf8 write matching `\r\n`, then grep-verify.

**Label reference** (`clear` = `"Clear"`):

| Key | EN value |
|---|---|
| `activitySearchPlaceholder` | `Search (text, wildcards, or regex)…` |
| `diagnosticsSearchCode` | `Filter by code` |
| `searchPlaceholder` | `Search task name, assignee, blockers, notes…` |
| `directorySearchPlaceholder` | `Filter by name, title, department, email…` |
| `documentsSearchDocs` | `Search knowledge` |
| `timelogPeopleFilter` | `Filter loaded people` |
| `raciFilterAdd` | `Filter people…` |
| `searchLabel` | `Global search` |
| `jiraUserSearch` | `Type to search users…` |
| `spPickerSearchPlaceholder` | `Search sites…` |
| `helpSearchPlaceholder` | `Search help` |

---

## File structure

**Create:**
- `src/app/wildcard-match.ts` — pure `*`-wildcard matcher; sole owner of the query→RegExp translation.
- `src/app/wildcard-match.test.ts` — its unit tests (a new pure `.ts` file is coverage-gated).
- `src/app/picker-filter.test.ts` — proves the wildcard reaches the chip pickers and that no-`*` behaviour is unchanged.
- `src/app/clear-label-uniqueness.test.tsx` — guards every clear label against the bare `"Clear"`.

**Modify, by responsibility:**
- `clearable-search-input.tsx` — focus returns to the field after clearing (fixes all ~34 sites at once).
- `wildcard` wiring: `picker-filter.ts`, `use-timelog-picker-scope.ts`, `i18n.ts`, `i18n.de.ts`.
- Shared controls, one edit each covering many panels: `pane-toolbar.tsx` (4 panels), `entity-link-picker.tsx` (5 pickers).
- Per-field: `activity-log-panel` · `diagnostics-panel` · `gantt-chrome` · `global-search-box` · `help-menu` · `help-view` · `jira-settings` · `knowledge-panel` · `raci-panel` · `resource-directory` · `sharepoint-picker-modal` · `timelog-panel` · `tasks-section` (migration).
- Release: `version.ts`, `CHANGELOG.md`.

---

### Task 1: Primitive returns focus to the field after clearing

The button renders only while `value` is non-empty, so activating it unmounts it and focus falls to `<body>` — a keyboard dead end mid-form. Fix it once, before adding 15 more.

**Files:**
- Modify: `src/app/clearable-search-input.tsx`
- Test: `src/app/clearable-search-input.test.tsx`

- [ ] **Step 1: Write the failing tests**

The existing tests pass a static `value`, so the button never unmounts and cannot expose this. Add a *stateful* harness after the existing `setup` helper:

```tsx
import { useState } from "react";

function Harness({ initial }: { initial: string }) {
  const [v, setV] = useState(initial);
  return (
    <ClearableSearchInput value={v} onClear={() => setV("")} clearLabel="Clear">
      <input aria-label="Filter" value={v} onChange={(e) => setV(e.target.value)} />
    </ClearableSearchInput>
  );
}
```

Append inside the existing `describe("ClearableSearchInput", …)`:

```tsx
  // ★★ The button unmounts the instant `value` empties, so without an explicit
  // refocus the activating element disappears and focus lands on <body> — a
  // dead end mid-form. Both input paths are covered because they fail
  // differently: mouse relies on the mousedown preventDefault, keyboard on the
  // .focus() call.
  it("returns focus to the field after a mouse clear", async () => {
    render(<Harness initial="abc" />);
    await userEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(document.activeElement).toBe(screen.getByLabelText("Filter"));
    expect(screen.queryByRole("button", { name: "Clear" })).toBeNull();
  });

  it("returns focus to the field after a keyboard clear", async () => {
    render(<Harness initial="abc" />);
    screen.getByLabelText("Filter").focus();
    await userEvent.tab();
    await userEvent.keyboard("{Enter}");
    expect(document.activeElement).toBe(screen.getByLabelText("Filter"));
  });
```

★ The activeElement assertion comes FIRST in both, so a mutant cannot be killed by the weaker `queryByRole` line while the real claim goes unchecked.

- [ ] **Step 2: Run to verify they fail**

Run: `npm run test:run -- src/app/clearable-search-input.test.tsx`
Expected: both new tests FAIL on the activeElement line (`expected <body> to be <input>`). The six pre-existing tests pass.

- [ ] **Step 3: Implement**

Change the import line:

```tsx
import { useRef, type ReactNode } from "react";
```

Replace the component body:

```tsx
export function ClearableSearchInput({
  value,
  onClear,
  clearLabel,
  children,
  className,
}: ClearableSearchInputProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  return (
    <div ref={wrapRef} className={`relative${className ? ` ${className}` : ""}`}>
      {children}
      {value && (
        <button
          type="button"
          // ★ Mouse: keep focus in the field so it is never taken and then
          //   dropped when this button unmounts (also protects commit-on-blur
          //   callers — the ResourcePicker precedent).
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            onClear();
            // ★ Keyboard: activation focus WAS on this button, which the clear
            //   just unmounted, so focus would fall to <body>. `children` is
            //   contractually THE field, so query it rather than adding a
            //   fieldRef prop that would churn every shipped call site.
            wrapRef.current?.querySelector<HTMLElement>("input, textarea")?.focus();
          }}
          aria-label={clearLabel}
          title={clearLabel}
          className={`absolute right-1.5 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:bg-surface-muted hover:text-foreground ${FOCUS_RING} ${TRANSITION}`}
        >
          <XMarkIcon aria-hidden="true" className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npm run test:run -- src/app/clearable-search-input.test.tsx`
Expected: 8 passed.

- [ ] **Step 5: Mutation-check the claim**

Delete the `wrapRef.current?.…focus();` line, re-run, and confirm the **activeElement** assertion is the reported failure in the keyboard test. Restore it.

- [ ] **Step 6: Verify the 19 shipped sites**

Run: `npm run test:run -- src/app/report-table.test.tsx src/app/timelog-panel.test.tsx`
Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add src/app/clearable-search-input.tsx src/app/clearable-search-input.test.tsx
git commit -m "fix(a11y): return focus to the field after clearing a search box"
```

---

### Task 2: `wildcard-match.ts` — the pure `*` matcher

**Files:**
- Create: `src/app/wildcard-match.ts`
- Test: `src/app/wildcard-match.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/app/wildcard-match.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { wildcardMatcher } from "./wildcard-match";

describe("wildcardMatcher", () => {
  it("matches everything on an empty or blank query", () => {
    expect(wildcardMatcher("")("anything")).toBe(true);
    expect(wildcardMatcher("   ")("anything")).toBe(true);
  });

  it("is an unanchored case-insensitive substring test when there is no *", () => {
    const m = wildcardMatcher("Ship");
    expect(m("Ship the release")).toBe(true);
    expect(m("RESHIPMENT")).toBe(true);
    expect(m("deploy")).toBe(false);
  });

  it("lets * span any run of characters", () => {
    const m = wildcardMatcher("api*docs");
    expect(m("API reference docs")).toBe(true);
    expect(m("api docs")).toBe(true);
    expect(m("docs before api")).toBe(false);
  });

  it("treats a bare * as match-all and honours leading/trailing *", () => {
    expect(wildcardMatcher("*")("anything")).toBe(true);
    expect(wildcardMatcher("*fix")("hotfix")).toBe(true);
    expect(wildcardMatcher("fix*")("fixture")).toBe(true);
  });

  // ★ The query is user text, not a pattern language. A regex metachar must be
  //   literal — otherwise "c++" throws "Nothing to repeat" and takes the panel
  //   down, and "a.b" would match "axb".
  it("treats regex metacharacters as literal", () => {
    expect(() => wildcardMatcher("c++")("c++ refactor")).not.toThrow();
    expect(wildcardMatcher("c++")("c++ refactor")).toBe(true);
    expect(wildcardMatcher("a.b")("axb")).toBe(false);
    expect(wildcardMatcher("a.b")("a.b")).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:run -- src/app/wildcard-match.test.ts`
Expected: FAIL — `Failed to resolve import "./wildcard-match"`.

- [ ] **Step 3: Implement**

Create `src/app/wildcard-match.ts`:

```ts
// Pure i18n-free `*` wildcard matching for user-typed filter text. The single
// owner of the query→RegExp translation: `customerMatcher` (timelog scope
// filters) and `filterPickerOptions` (every chip picker) both delegate here, so
// the regex-escape can't drift between them — and `dup:check` is blocking.
//
// Semantics, deliberately narrow: `*` spans any run of characters, everything
// else is LITERAL (a query is user text, not a pattern language), matching is
// case-insensitive and UNANCHORED. Consequence worth knowing: a query with no
// `*` behaves exactly like `String.includes` on the lowercased text, so
// adopting this matcher never changes existing behaviour.

/** `*` is a wildcard, everything else literal. Case-insensitive substring. */
export function wildcardMatcher(query: string): (text: string) => boolean {
  const q = query.trim().toLowerCase();
  if (!q) return () => true;
  const escaped = q
    .split("*")
    .map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  const re = new RegExp(escaped, "i");
  return (text: string) => re.test(text);
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test:run -- src/app/wildcard-match.test.ts`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add src/app/wildcard-match.ts src/app/wildcard-match.test.ts
git commit -m "feat(search): add the shared * wildcard matcher"
```

---

### Task 3: Route the chip pickers and timelog through the matcher

**Files:**
- Create: `src/app/picker-filter.test.ts`
- Modify: `src/app/picker-filter.ts:20-35`, `src/app/use-timelog-picker-scope.ts:31-38`, `src/app/i18n.ts:3124`, `src/app/i18n.de.ts:3105`

- [ ] **Step 1: Write the failing test**

Create `src/app/picker-filter.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { filterPickerOptions } from "./picker-filter";

interface Row {
  id: number;
  name: string;
}
const ROWS: readonly Row[] = [
  { id: 1, name: "Draft the API spec" },
  { id: 2, name: "Review the API docs" },
  { id: 3, name: "Ship the release" },
];
const base = {
  excludeIds: new Set<number>(),
  getId: (r: Row) => r.id,
  getText: (r: Row) => r.name,
};

describe("filterPickerOptions", () => {
  it("matches a * wildcard across the text", () => {
    const out = filterPickerOptions(ROWS, { ...base, query: "api*docs" });
    expect(out.map((r) => r.id)).toEqual([2]);
  });

  it("leaves a query without * as a plain substring match", () => {
    const out = filterPickerOptions(ROWS, { ...base, query: "api" });
    expect(out.map((r) => r.id)).toEqual([1, 2]);
  });

  it("still short-circuits on an exact id and still drops excluded ids", () => {
    expect(filterPickerOptions(ROWS, { ...base, query: "3" }).map((r) => r.id)).toEqual([3]);
    const out = filterPickerOptions(ROWS, { ...base, query: "api", excludeIds: new Set([1]) });
    expect(out.map((r) => r.id)).toEqual([2]);
  });
});
```

- [ ] **Step 2: Run to verify only the wildcard case fails**

Run: `npm run test:run -- src/app/picker-filter.test.ts`
Expected: the `*` test FAILS (`expected [] to equal [2]`); the other two PASS — that pair is the regression guard for the path that must NOT change.

- [ ] **Step 3: Implement in `picker-filter.ts`**

```ts
import { wildcardMatcher } from "./wildcard-match";
```

```ts
export function filterPickerOptions<T>(
  items: readonly T[],
  opts: PickerFilterOptions<T>,
): T[] {
  const { query, excludeIds, getId, getText, extraFilter, limit = 20 } = opts;
  const q = query.trim().toLowerCase();
  // Built once per call — a matcher per item would recompile the RegExp for
  // every row on every keystroke.
  const matches = wildcardMatcher(q);
  return items
    .filter((item) => !excludeIds.has(getId(item)))
    .filter((item) => (extraFilter ? extraFilter(item) : true))
    .filter((item) => {
      if (!q) return true;
      if (String(getId(item)) === q) return true;
      return matches(getText(item));
    })
    .slice(0, limit);
}
```

In the module header comment, after "match a query against the id OR a text field", add "(`*` accepted as a wildcard — see `wildcard-match.ts`)".

- [ ] **Step 4: Delegate `customerMatcher`**

`src/app/use-timelog-picker-scope.ts` — add the import and replace lines 31-38 (keep the export; two callers and its tests use it):

```ts
import { wildcardMatcher } from "./wildcard-match";
```

```ts
/** Wildcard customer-name match: `*` is a wildcard, everything else literal.
 *  Thin alias kept for its call sites; the logic lives in the shared matcher so
 *  the chip pickers and this filter cannot drift. */
export function customerMatcher(query: string): (name: string) => boolean {
  return wildcardMatcher(query);
}
```

- [ ] **Step 5: Run the affected suites**

Run: `npm run test:run -- src/app/picker-filter.test.ts src/app/timelog-panel.test.tsx src/app/change-edit-modal.test.tsx src/app/raid-edit-modal.test.tsx`
Expected: all pass.

- [ ] **Step 6: i18n — advertise the wildcard**

EN, `src/app/i18n.ts:3124`:

```ts
  taskLinkSearchPlaceholder: "Search tasks to link (* wildcard)…",
```

DE — node utf8 write, **not** the Edit tool (CRLF file, umlaut in the string):

```bash
node -e "const f='src/app/i18n.de.ts';const fs=require('fs');const s=fs.readFileSync(f,'utf8');const from='  taskLinkSearchPlaceholder: \"Aufgaben zum Verknüpfen suchen…\",\r\n';const to='  taskLinkSearchPlaceholder: \"Aufgaben zum Verknüpfen suchen (* Platzhalter)…\",\r\n';if(!s.includes(from))throw new Error('anchor not found');fs.writeFileSync(f,s.replace(from,to),'utf8');console.log('ok');"
grep -n "taskLinkSearchPlaceholder" src/app/i18n.de.ts
```
Expected: `Aufgaben zum Verknüpfen suchen (* Platzhalter)…` with a real `ü`.

- [ ] **Step 7: Typecheck (i18n key parity is tsc-enforced)**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 8: Commit**

```bash
git add src/app/picker-filter.ts src/app/picker-filter.test.ts src/app/use-timelog-picker-scope.ts src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat(pickers): accept a * wildcard in linked-entity search"
```

---

### Task 4: `PaneSearchInput` — one edit, four panels

`pane-toolbar.tsx`'s shared search atom is used by `change-panel`, `milestones-panel`, `raid-panel-toolbar` and `stakeholders-panel` (Milestones and RAID are axe-scanned). Adding the clear here covers all four.

**Files:**
- Modify: `src/app/pane-toolbar.tsx:26-57`
- Modify: `src/app/change-panel.tsx:343`, `src/app/milestones-panel.tsx:339`, `src/app/raid-panel-toolbar.tsx:80`, `src/app/stakeholders-panel.tsx:276`
- Test: `src/app/pane-toolbar.test.tsx`

- [ ] **Step 1: Update the two existing tests and add the new one**

The `flex-1` / `min-w-*` classes move from the input to the positioning wrapper (the input becomes `w-full`), so the two existing className assertions must move with them. Replace the `PaneSearchInput` describe block with:

```tsx
describe("PaneSearchInput", () => {
  test("is a search input named by ariaLabel, with the flex width on its wrapper", () => {
    const { container } = render(
      <PaneSearchInput value="" onChange={() => {}} ariaLabel="Search changes" clearLabel="Clear – Search changes" />,
    );
    const input = screen.getByRole("searchbox", { name: "Search changes" });
    expect(input).toHaveAttribute("placeholder", "Search changes");
    expect(input.className).toContain("w-full");
    // The clear button is overlaid, so the flex sizing lives on the wrapper.
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toContain("flex-1");
    expect(wrapper.className).toContain("min-w-[12rem]");
  });

  test("emits the raw value on change and honours minW/placeholder overrides", async () => {
    const onChange = vi.fn();
    const { container } = render(
      <PaneSearchInput
        value=""
        onChange={onChange}
        ariaLabel="Find"
        clearLabel="Clear – Find"
        placeholder="Type…"
        minW="min-w-[10rem]"
      />,
    );
    const input = screen.getByRole("searchbox", { name: "Find" });
    expect(input).toHaveAttribute("placeholder", "Type…");
    expect((container.firstChild as HTMLElement).className).toContain("min-w-[10rem]");
    await userEvent.type(input, "ab");
    expect(onChange).toHaveBeenLastCalledWith("b");
  });

  test("clears the value from a labelled button once non-empty", async () => {
    const onChange = vi.fn();
    render(
      <PaneSearchInput value="risk" onChange={onChange} ariaLabel="Find" clearLabel="Clear – Find" />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Clear – Find" }));
    expect(onChange).toHaveBeenCalledWith("");
  });

  test("renders no clear button while empty", () => {
    render(<PaneSearchInput value="" onChange={() => {}} ariaLabel="Find" clearLabel="Clear – Find" />);
    expect(screen.queryByRole("button", { name: "Clear – Find" })).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm run test:run -- src/app/pane-toolbar.test.tsx`
Expected: the two clear tests FAIL (no such button / unknown prop) and the two updated tests FAIL on the wrapper className.

- [ ] **Step 3: Implement**

`src/app/pane-toolbar.tsx` — add the import, the required prop, and the wrapper:

```tsx
import { ClearableSearchInput } from "./clearable-search-input";
```

```tsx
export interface PaneSearchInputProps
  extends Omit<HTMLAttributes<HTMLInputElement>, "onChange"> {
  value: string;
  onChange: (value: string) => void;
  /** Accessible name (also used as placeholder unless `placeholder` given). */
  ariaLabel: string;
  /** Already-translated accessible name for the clear button. REQUIRED and
   *  qualified by the caller (`${t(lang,"clear")} – ${ariaLabel}`): four panels
   *  render this atom and a bare "Clear" would announce identically on any
   *  view showing two of them. axe cannot see duplicate names. */
  clearLabel: string;
  placeholder?: string;
  /** Minimum-width utility (panels vary: `min-w-[12rem]` default, `min-w-[10rem]`, …). */
  minW?: string;
}

/** The `flex-1` search box shared by the register/directory toolbars. */
export function PaneSearchInput({
  value,
  onChange,
  ariaLabel,
  clearLabel,
  placeholder,
  minW = "min-w-[12rem]",
  className,
  ...props
}: PaneSearchInputProps) {
  return (
    // ★ The flex sizing moves to the wrapper because the wrapper is now the
    //   flex child of the toolbar row; the input fills it.
    <ClearableSearchInput
      value={value}
      onClear={() => onChange("")}
      clearLabel={clearLabel}
      className={`${minW} flex-1`}
    >
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? ariaLabel}
        aria-label={ariaLabel}
        className={`w-full rounded-md border border-line bg-surface px-2.5 py-1.5 pr-8 text-xs text-foreground focus:border-ui-dark-blue focus:outline-none [&::-webkit-search-cancel-button]:appearance-none ${FOCUS_RING} ${TRANSITION}${className ? ` ${className}` : ""}`}
        {...props}
      />
    </ClearableSearchInput>
  );
}
```

- [ ] **Step 4: Pass `clearLabel` at the four call sites**

`change-panel.tsx:343`:

```tsx
      <PaneSearchInput
        value={search}
        onChange={pf.setSearch}
        ariaLabel={t(lang, "changeFilterSearch")}
        clearLabel={`${t(lang, "clear")} – ${t(lang, "changeFilterSearch")}`}
      />
```

`milestones-panel.tsx:339`:

```tsx
        <PaneSearchInput
          value={pf.search}
          onChange={pf.setSearch}
          ariaLabel={t(lang, "milestonesFilterName")}
          clearLabel={`${t(lang, "clear")} – ${t(lang, "milestonesFilterName")}`}
          minW="min-w-[10rem]"
        />
```

`raid-panel-toolbar.tsx:80` and `stakeholders-panel.tsx:276`: add the same one line, using whatever key that call site already passes as `ariaLabel`. `npx tsc --noEmit` names any site you miss — that is why the prop is required rather than optional.

- [ ] **Step 5: Run to verify they pass**

Run: `npm run test:run -- src/app/pane-toolbar.test.tsx src/app/change-panel.test.tsx src/app/milestones-panel.test.tsx src/app/raid-panel.test.tsx src/app/stakeholders-panel.test.tsx`
Expected: all pass. `raid-panel.test.tsx` has a source-scan asserting `<PaneSearchInput` ordering in the toolbar — unaffected, but confirm it ran.

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 7: Commit**

```bash
git add src/app/pane-toolbar.tsx src/app/pane-toolbar.test.tsx src/app/change-panel.tsx src/app/milestones-panel.tsx src/app/raid-panel-toolbar.tsx src/app/stakeholders-panel.tsx
git commit -m "feat(a11y): clear button on the shared pane search input"
```

---

### Task 5: Open Points search — migrate to the shared atom

`tasks-section.tsx` is **baselined at 1073 lines** and the ratchet fails on any growth of an already-oversized file, so wrapping in place is not available. Migrating its bespoke `<Input type="search">` to `PaneSearchInput` (clearable as of Task 4) is net ≈ −3 lines and removes the last register toolbar that did not use the atom.

**Files:**
- Modify: `src/app/tasks-section.tsx:629-638`
- Test: `src/app/tasks-section.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
  it("clears the task search from a labelled button", async () => {
    renderSection();                    // use the suite's existing helper
    const field = screen.getByLabelText(
      "Search task name, assignee, blockers, notes…",
    ) as HTMLInputElement;
    await userEvent.type(field, "spec");
    await userEvent.click(
      screen.getByRole("button", {
        name: "Clear – Search task name, assignee, blockers, notes…",
      }),
    );
    expect(field.value).toBe("");
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:run -- src/app/tasks-section.test.tsx`
Expected: FAIL — no such button.

- [ ] **Step 3: Implement**

Replace the `<Input type="search" …/>` block (lines 629-638) with:

```tsx
        <PaneSearchInput
          value={search}
          onChange={setSearch}
          ariaLabel={t(lang, "searchPlaceholder")}
          clearLabel={`${t(lang, "clear")} – ${t(lang, "searchPlaceholder")}`}
          title={t(lang, "tasksSearchHint")}
        />
```

`PaneSearchInput` is already imported in this file if it uses `PaneToolbar`/`AddButton` from `./pane-toolbar`; extend that import rather than adding a second one. If `setSearch` is not already `(v: string) => void`, keep the inline arrow: `onChange={(v) => setSearch(v)}` — `npx tsc --noEmit` decides.

★ The atom's default `minW` is `min-w-[12rem]` and it is `flex-1`, matching the classes the old field carried — no toolbar-layout change intended.

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test:run -- src/app/tasks-section.test.tsx src/app/task-kanban-board.test.tsx`
Expected: all pass. If any test queried the old field by placeholder, it still resolves — the atom passes `ariaLabel` through as the placeholder default, and this call site keeps the same string for both.

- [ ] **Step 5: Prove the ratchet is satisfied**

Run: `npm run size:check`
Expected: `file-size ratchet ok`. Then confirm the direction of travel:

```bash
node -e "console.log(require('fs').readFileSync('src/app/tasks-section.tsx','utf8').split('\n').length)"
```
Expected: **≤ 1073**. If it is higher, do NOT run `--update` — reduce the diff instead.

- [ ] **Step 6: Eye-verify the toolbar**

```bash
PORT=3100 npm run dev
```
Open Points: confirm the search box width, height and padding still line up with the neighbouring selects, and the ✕ sits inside the field. `PORT=3100 npm run stop`.

- [ ] **Step 7: Commit**

```bash
git add src/app/tasks-section.tsx src/app/tasks-section.test.tsx
git commit -m "refactor(tasks): move the Open Points search onto the shared clearable atom"
```

---

### Task 6: `EntityLinkPicker` — clear the query box, and unpin the chip width

One edit covers the linked-task pickers in change / RAID / Knowledge / budget-bucket **and** RAID caused-by, plus the shared half of the Knowledge sizing fix.

**Files:**
- Modify: `src/app/entity-link-picker.tsx` (chip label ~216 and ~219; query `Input` ~238)
- Modify: `src/app/task-link-picker.tsx`
- Test: `src/app/entity-link-picker.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
  it("clears the query via a labelled button that names the field", async () => {
    const onQueryChange = vi.fn();
    render(
      <EntityLinkPicker
        selected={[]}
        options={[]}
        query="api"
        onQueryChange={onQueryChange}
        onAdd={vi.fn()}
        onRemove={vi.fn()}
        searchLabel="Linked tasks"
        clearLabel="Clear – Linked tasks"
        placeholder="Search tasks…"
        removeLabel="Unlink"
      />,
    );
    // ★ Exact name, not /clear/i: the point of the label is that it is
    //   qualified, and a loose regex passes against the unqualified string too.
    await userEvent.click(screen.getByRole("button", { name: "Clear – Linked tasks" }));
    expect(onQueryChange).toHaveBeenCalledWith("");
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:run -- src/app/entity-link-picker.test.tsx`
Expected: FAIL — no such button (and `clearLabel` is not a known prop).

- [ ] **Step 3: Implement**

```tsx
import { ClearableSearchInput } from "./clearable-search-input";
```

Add to the props interface, beside `removeLabel`:

```tsx
  /** Already-translated accessible name for the query box's clear button.
   *  Callers qualify it (e.g. "Clear – Linked tasks – <card name>") because
   *  several pickers can render on one surface. */
  clearLabel: string;
```

Destructure `clearLabel`, then wrap the query `Input` — INSIDE the existing `relative` div (the one the listbox is positioned against), so the ✕ sits over the input, not the list. Keep every existing comment:

```tsx
      <div className="relative">
        <ClearableSearchInput value={query} onClear={() => onQueryChange("")} clearLabel={clearLabel}>
          <Input
            type="text"
            role="combobox"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            onClick={() => setDismissed(false)}
            onKeyDown={onKeyDown}
            aria-label={searchLabel}
            aria-expanded={open}
            aria-controls={open ? listId : undefined}
            aria-activedescendant={open && active >= 0 ? `${listId}-opt-${active}` : undefined}
            aria-autocomplete="list"
            placeholder={placeholder}
            size={inputSize}
            className="w-full pr-8"
          />
        </ClearableSearchInput>
        {open && (
```

Chip label, BOTH branches (`onOpen` button branch and the inert branch):

```tsx
                <span className="max-w-full truncate">{entry.label}</span>
```

- [ ] **Step 4: Pass the prop from `task-link-picker.tsx`**

```tsx
      searchLabel={label}
      clearLabel={`${t(lang, "clear")} – ${label}`}
```

`label` is already row-unique per Knowledge card, so the clear inherits that.

- [ ] **Step 5: Run to verify it passes**

Run: `npm run test:run -- src/app/entity-link-picker.test.tsx src/app/change-edit-modal.test.tsx src/app/raid-edit-modal.test.tsx src/app/knowledge-panel.test.tsx src/app/budget-panel.test.tsx`
Expected: all pass. If a chip assertion trips on the width class, `max-w-full` is the intended new value.

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0 — a missed `clearLabel` at any call site fails here.

- [ ] **Step 7: Commit**

```bash
git add src/app/entity-link-picker.tsx src/app/entity-link-picker.test.tsx src/app/task-link-picker.tsx
git commit -m "feat(a11y): clear button on the entity-link picker query box"
```

---

### Task 7: Knowledge linked-tasks sizing

**Files:**
- Modify: `src/app/knowledge-panel.tsx` (the `{isStandalone && (` linked-tasks `<label>` ~290; the library-card grid ~398)
- Test: `src/app/knowledge-panel.test.tsx`

- [ ] **Step 1: Write the failing test**

Add these imports to the test file if absent:

```tsx
import { readFileSync } from "node:fs";
import { join } from "node:path";
```

```tsx
  it("gives the standalone add-form linked-tasks field a flex basis so it cannot collapse", () => {
    const src = readFileSync(join(__dirname, "knowledge-panel.tsx"), "utf8");
    // The field sits in a `flex flex-wrap items-end` row where every sibling
    // declares a basis; without one it shrinks to content width. Asserted on
    // the source because jsdom reports every rect as zero.
    expect(src).toMatch(/flex flex-1 min-w-\[16rem\] flex-col gap-1 text-xs text-foreground/);
  });

  it("does not pack library cards three-up before xl", () => {
    const src = readFileSync(join(__dirname, "knowledge-panel.tsx"), "utf8");
    expect(src).toMatch(/grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3/);
    expect(src).not.toMatch(/lg:grid-cols-3/);
  });
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm run test:run -- src/app/knowledge-panel.test.tsx`
Expected: both new tests FAIL.

- [ ] **Step 3: Implement**

The linked-tasks `<label>` wrapping `<TaskLinkPicker>` in the add-form (currently `className="flex flex-col gap-1 text-xs text-foreground"`, guarded by `{isStandalone && (`):

```tsx
                  <label className="flex flex-1 min-w-[16rem] flex-col gap-1 text-xs text-foreground">
```

The library-card grid:

```tsx
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm run test:run -- src/app/knowledge-panel.test.tsx`
Expected: all pass.

- [ ] **Step 5: Eye-verify (jsdom has no layout — the tests only pin the classes)**

```bash
PORT=3100 npm run dev
```
Knowledge view at 375px, 1280px, 1920px: the add-form linked-tasks field is a usable width and does not push the Add button off-row; library-card chips truncate at the card edge; two cards per row at lg, three at xl. `PORT=3100 npm run stop`.

- [ ] **Step 6: Commit**

```bash
git add src/app/knowledge-panel.tsx src/app/knowledge-panel.test.tsx
git commit -m "fix(knowledge): stop the linked-tasks picker collapsing to content width"
```

---

### Task 8: Clear buttons — batch A (activity log · diagnostics · gantt · resource directory)

Four independent files. Label is always `${t(lang, "clear")} – <the field's existing accessible name>`; EN literals are in the reference table at the top.

**Files:**
- Modify: `src/app/activity-log-panel.tsx:197-208`, `src/app/diagnostics-panel.tsx:110-117`, `src/app/gantt-chrome.tsx:100-108`, `src/app/resource-directory.tsx:250-258`
- Test: `src/app/activity-log-panel.test.tsx`, `src/app/diagnostics-panel.test.tsx`, `src/app/gantt.test.tsx`, `src/app/resource-directory.test.tsx`

- [ ] **Step 1: Write the four failing tests**

`activity-log-panel.test.tsx` (use the suite's existing render helper / props):

```tsx
  it("clears the search box from a labelled button", async () => {
    render(<ActivityLogPanel {...BASE_PROPS} />);
    const field = screen.getByLabelText("Search (text, wildcards, or regex)…") as HTMLInputElement;
    await userEvent.type(field, "jira");
    await userEvent.click(
      screen.getByRole("button", { name: "Clear – Search (text, wildcards, or regex)…" }),
    );
    expect(field.value).toBe("");
  });
```

`diagnostics-panel.test.tsx`:

```tsx
  it("clears the code filter from a labelled button", async () => {
    render(<DiagnosticsPanel {...BASE_PROPS} />);
    const field = screen.getByLabelText("Filter by code") as HTMLInputElement;
    await userEvent.type(field, "turso");
    await userEvent.click(screen.getByRole("button", { name: "Clear – Filter by code" }));
    expect(field.value).toBe("");
  });
```

`gantt.test.tsx`:

```tsx
test("gantt toolbar clears the task search from a labelled button", async () => {
  const { getByRole, getByLabelText } = render(<GanttPanel {...BASE_PROPS} />);
  const field = getByLabelText("Search task name, assignee, blockers, notes…") as HTMLInputElement;
  await userEvent.type(field, "spec");
  await userEvent.click(
    getByRole("button", { name: "Clear – Search task name, assignee, blockers, notes…" }),
  );
  expect(field.value).toBe("");
});
```

`resource-directory.test.tsx`:

```tsx
  it("clears the directory filter from a labelled button", async () => {
    render(<ResourceDirectory {...BASE_PROPS} />);
    const field = screen.getByLabelText(
      "Filter by name, title, department, email…",
    ) as HTMLInputElement;
    await userEvent.type(field, "anna");
    await userEvent.click(
      screen.getByRole("button", { name: "Clear – Filter by name, title, department, email…" }),
    );
    expect(field.value).toBe("");
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm run test:run -- src/app/activity-log-panel.test.tsx src/app/diagnostics-panel.test.tsx src/app/gantt.test.tsx src/app/resource-directory.test.tsx`
Expected: four "unable to find … button" failures.

- [ ] **Step 3: Implement — `activity-log-panel.tsx`**

The field already sits in a `relative min-w-[14rem] flex-1` div that also hosts the absolute invalid-regex hint. Wrap only the `Input`; leave that div and the hint alone:

```tsx
        <div className="relative min-w-[14rem] flex-1">
          <ClearableSearchInput
            value={searchQuery}
            onClear={() => setSearchQuery("")}
            clearLabel={`${t(lang, "clear")} – ${t(lang, "activitySearchPlaceholder")}`}
          >
            <Input
              type="search"
              size="xs"
              invalid={!!matcher?.invalid}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t(lang, "activitySearchPlaceholder")}
              aria-label={t(lang, "activitySearchPlaceholder")}
              title={t(lang, "activitySearchHint")}
              className="w-full pr-8 [&::-webkit-search-cancel-button]:appearance-none"
            />
          </ClearableSearchInput>
          {matcher?.invalid && (
```

- [ ] **Step 4: Implement — `diagnostics-panel.tsx`**

```tsx
            <ClearableSearchInput
              value={query}
              onClear={() => setQuery("")}
              clearLabel={`${t(lang, "clear")} – ${t(lang, "diagnosticsSearchCode")}`}
              className="min-w-0 flex-1"
            >
              <Input
                type="text"
                size="xs"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t(lang, "diagnosticsSearchCode")}
                aria-label={t(lang, "diagnosticsSearchCode")}
                className="w-full pr-8"
              />
            </ClearableSearchInput>
```

★ The flex sizing moves to the wrapper (it is the flex child now) and the field becomes `w-full`. Same rule at every site whose field carried the flex classes.

- [ ] **Step 5: Implement — `gantt-chrome.tsx`**

```tsx
      <ClearableSearchInput
        value={prefs.search}
        onClear={() => setSearch("")}
        clearLabel={`${t(lang, "clear")} – ${t(lang, "searchPlaceholder")}`}
        className="min-w-[12rem] flex-1"
      >
        <Input
          type="search"
          size="xs"
          value={prefs.search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t(lang, "searchPlaceholder")}
          aria-label={t(lang, "searchPlaceholder")}
          title={t(lang, "ganttSearchHint")}
          className="w-full pr-8 [&::-webkit-search-cancel-button]:appearance-none"
        />
      </ClearableSearchInput>
```

★ `gantt.test.tsx` has a source-ORDER test asserting `onClick={onAddTask}` precedes `type="search"` in this file. The wrapper is inserted after the add button so the order holds — re-run it, do not assume.

- [ ] **Step 6: Implement — `resource-directory.tsx`**

```tsx
        <ClearableSearchInput
          value={filter}
          onClear={() => setFilter("")}
          clearLabel={`${t(lang, "clear")} – ${t(lang, "directorySearchPlaceholder")}`}
          className="min-w-0 flex-1"
        >
          <Input
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t(lang, "directorySearchPlaceholder")}
            aria-label={t(lang, "directorySearchPlaceholder")}
            title={t(lang, "directorySearchHint")}
            size="xs"
            className="w-full pr-8 [&::-webkit-search-cancel-button]:appearance-none"
          />
        </ClearableSearchInput>
```

Add `import { ClearableSearchInput } from "./clearable-search-input";` to each of the four files.

- [ ] **Step 7: Run to verify they pass**

Run: `npm run test:run -- src/app/activity-log-panel.test.tsx src/app/diagnostics-panel.test.tsx src/app/gantt.test.tsx src/app/resource-directory.test.tsx`
Expected: all pass, including the gantt source-order test.

- [ ] **Step 8: Commit**

```bash
git add src/app/activity-log-panel.tsx src/app/diagnostics-panel.tsx src/app/gantt-chrome.tsx src/app/resource-directory.tsx src/app/activity-log-panel.test.tsx src/app/diagnostics-panel.test.tsx src/app/gantt.test.tsx src/app/resource-directory.test.tsx
git commit -m "feat(a11y): clear buttons on the activity, diagnostics, gantt and directory filters"
```

---

### Task 9: Clear buttons — batch B (knowledge search · timelog people · RACI · global search)

**Files:**
- Modify: `src/app/knowledge-panel.tsx:366-373`, `src/app/timelog-panel.tsx:594-602`, `src/app/raci-panel.tsx:143-166`, `src/app/global-search-box.tsx:226-247`
- Test: the matching `.test.tsx` for each

- [ ] **Step 1: Write the four failing tests**

```tsx
  // knowledge-panel.test.tsx
  it("clears the documents search from a labelled button", async () => {
    render(<KnowledgePanel {...BASE_PROPS} />);
    const field = screen.getByLabelText("Search knowledge") as HTMLInputElement;
    await userEvent.type(field, "spec");
    await userEvent.click(screen.getByRole("button", { name: "Clear – Search knowledge" }));
    expect(field.value).toBe("");
  });
```

```tsx
  // timelog-panel.test.tsx — use the suite's existing render helper
  it("clears the people filter from a labelled button", async () => {
    renderPanel();
    const field = screen.getByLabelText("Filter loaded people") as HTMLInputElement;
    await userEvent.type(field, "anna");
    await userEvent.click(screen.getByRole("button", { name: "Clear – Filter loaded people" }));
    expect(field.value).toBe("");
  });
```

```tsx
  // raci-panel.test.tsx
  it("clears the add field without adding anyone", async () => {
    render(<RaciPanel {...BASE_PROPS} />);
    const field = screen.getByLabelText("Filter people…") as HTMLInputElement;
    await userEvent.type(field, "Ann");
    await userEvent.click(screen.getByRole("button", { name: "Clear – Filter people…" }));
    // ★ Headline claim FIRST: this field auto-adds on an exact label match via
    //   onChange, so clearing must not trip that path.
    expect(screen.queryByRole("button", { name: /remove/i })).toBeNull();
    expect(field.value).toBe("");
  });
```

```tsx
  // global-search-box.test.tsx
  it("clears the query from a labelled button", async () => {
    render(<GlobalSearchBox {...BASE_PROPS} />);
    const field = screen.getByLabelText("Global search") as HTMLInputElement;
    await userEvent.type(field, "risk");
    await userEvent.click(screen.getByRole("button", { name: "Clear – Global search" }));
    expect(field.value).toBe("");
  });
```

- [ ] **Step 2: Run to verify they fail**

Run: `npm run test:run -- src/app/knowledge-panel.test.tsx src/app/timelog-panel.test.tsx src/app/raci-panel.test.tsx src/app/global-search-box.test.tsx`
Expected: four "unable to find … button" failures. In the RACI test confirm the FIRST assertion is not the failing one — a false pass there would hide the real claim.

- [ ] **Step 3: Implement — `knowledge-panel.tsx`**

```tsx
            <ClearableSearchInput
              value={query}
              onClear={() => setQuery("")}
              clearLabel={`${t(lang, "clear")} – ${t(lang, "documentsSearchDocs")}`}
              className="min-w-[8rem] flex-1"
            >
              <Input
                type="search"
                value={query}
                aria-label={t(lang, "documentsSearchDocs")}
                placeholder={t(lang, "documentsSearchDocs")}
                onChange={(e) => setQuery(e.target.value)}
                size="xs"
                className="w-full pr-8 [&::-webkit-search-cancel-button]:appearance-none"
              />
            </ClearableSearchInput>
```

- [ ] **Step 4: Implement — `timelog-panel.tsx`**

```tsx
            <ClearableSearchInput
              value={peopleFilter}
              onClear={() => setPeopleFilter("")}
              clearLabel={`${t(lang, "clear")} – ${t(lang, "timelogPeopleFilter")}`}
              className="mb-2 print:hidden"
            >
              <Input
                type="search"
                size="xs"
                value={peopleFilter}
                onChange={(e) => setPeopleFilter(e.target.value)}
                placeholder={t(lang, "timelogPeopleFilter")}
                aria-label={t(lang, "timelogPeopleFilter")}
                className="w-full pr-8 [&::-webkit-search-cancel-button]:appearance-none"
              />
            </ClearableSearchInput>
```

★ `mb-2` and `print:hidden` move to the wrapper — it is the element in the flow now. This file is 721/800 lines; the wrap adds ~5. `npm run size:check` at Task 12 confirms.

- [ ] **Step 5: Implement — `raci-panel.tsx`**

Wrap the `Input`, keeping every handler byte-identical:

```tsx
          <ClearableSearchInput
            value={filterInput}
            onClear={() => setFilterInput("")}
            clearLabel={`${t(lang, "clear")} – ${t(lang, "raciFilterAdd")}`}
            className="w-48"
          >
            <Input
              type="text"
              size="xs"
              value={filterInput}
              onChange={(e) => {
                const v = e.target.value;
                setFilterInput(v);
                // Picking a datalist option fires change with the full (possibly
                // disambiguated) label → add it.
                const needle = v.trim().toLowerCase();
                if (stakeholders.some((s) => labelFor(s).toLowerCase() === needle || s.name.trim().toLowerCase() === needle)) {
                  addPerson(v);
                }
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addPerson(filterInput);
                }
              }}
              list="raci-filter-people"
              aria-label={t(lang, "raciFilterAdd")}
              placeholder={t(lang, "raciFilterAdd")}
              className="w-full pr-8"
            />
          </ClearableSearchInput>
```

★ `onClear` calls `setFilterInput("")` **directly**, never the field's `onChange` — routing it through `onChange` would re-run the auto-add match. `""` can match no `labelFor(s)`, but the direct setter means that safety does not depend on it.

- [ ] **Step 6: Implement — `global-search-box.tsx`**

Wrap ONLY the `<input>`. The outer `relative` root, the ⌘K `kbd` hint and the listbox stay where they are:

```tsx
    <div ref={rootRef} className="relative">
      <ClearableSearchInput
        value={query}
        onClear={() => setQuery("")}
        clearLabel={`${t(lang, "clear")} – ${t(lang, "searchLabel")}`}
      >
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-label={t(lang, "searchLabel")}
          placeholder={t(lang, "searchGlobalPlaceholder")}
          aria-expanded={isOpen}
          aria-controls={isOpen && items.length > 0 ? listId : undefined}
          aria-activedescendant={
            isOpen && items.length > 0 && highlight >= 0 ? `${listId}-opt-${highlight}` : undefined
          }
          aria-autocomplete="list"
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onKeyDown={onKeyDown}
          className={`w-full rounded-md border border-line bg-surface py-1.5 pl-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-ui-dark-blue focus:outline-none ${FOCUS_RING} ${TRANSITION} ${showingRecents ? "pr-14" : "pr-8"}`}
        />
      </ClearableSearchInput>
```

★ `pr-3` → `pr-8` in the non-recents branch only. The hint renders while `showingRecents` (focused + empty query) and the ✕ only while the query is non-empty, so they never overlap. Refocusing after clear re-fires `onFocus` → recents reopen on an empty query, the correct state.

Add the `ClearableSearchInput` import to all four files.

- [ ] **Step 7: Run to verify they pass**

Run: `npm run test:run -- src/app/knowledge-panel.test.tsx src/app/timelog-panel.test.tsx src/app/raci-panel.test.tsx src/app/global-search-box.test.tsx`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add src/app/knowledge-panel.tsx src/app/timelog-panel.tsx src/app/raci-panel.tsx src/app/global-search-box.tsx src/app/knowledge-panel.test.tsx src/app/timelog-panel.test.tsx src/app/raci-panel.test.tsx src/app/global-search-box.test.tsx
git commit -m "feat(a11y): clear buttons on the knowledge, timelog, RACI and global search fields"
```

---

### Task 10: Clear buttons — batch C (help ×2 · Jira user search · SharePoint picker)

This batch carries the prerequisites: two fields have no accessible name at all, and the two help fields share one.

**Files:**
- Modify: `src/app/help-menu.tsx:141-149`, `src/app/help-view.tsx:126-134`, `src/app/jira-settings.tsx:570-576`, `src/app/sharepoint-picker-modal.tsx:161-169`
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts` (new key `helpSearchPanelLabel`)
- Test: the matching `.test.tsx` for each

- [ ] **Step 1: Add the new i18n key**

EN — insert directly after `helpSearchPlaceholder` (`src/app/i18n.ts:2999`):

```ts
  helpSearchPanelLabel: "Search help (window)",
```

DE — node utf8 write after `src/app/i18n.de.ts:2959`:

```bash
node -e "const f='src/app/i18n.de.ts';const fs=require('fs');const s=fs.readFileSync(f,'utf8');const anchor='  helpSearchPlaceholder: \"Hilfe durchsuchen\",\r\n';const add=anchor+'  helpSearchPanelLabel: \"Hilfe durchsuchen (Fenster)\",\r\n';if(!s.includes(anchor))throw new Error('anchor not found');fs.writeFileSync(f,s.replace(anchor,add),'utf8');console.log('ok');"
grep -n "helpSearchPanelLabel" src/app/i18n.de.ts
npx tsc --noEmit
```
Expected: the DE line present with a real `ü`, tsc exit 0 (key parity is enforced there, so a one-sided add fails immediately).

- [ ] **Step 2: Write the four failing tests**

```tsx
  // help-menu.test.tsx
  it("names its search field distinctly from the in-pane one and clears it", async () => {
    render(<HelpMenu {...BASE_PROPS} />);
    // ★ The floating window can be open ON TOP of the Help view, so a shared
    //   name puts two identically-named fields and two identically-named
    //   clears in one accessibility tree. axe cannot see that.
    const field = screen.getByLabelText("Search help (window)") as HTMLInputElement;
    await userEvent.type(field, "tour");
    await userEvent.click(screen.getByRole("button", { name: "Clear – Search help (window)" }));
    expect(field.value).toBe("");
  });
```

```tsx
  // help-view.test.tsx
  it("clears the in-pane help search from a labelled button", async () => {
    render(<HelpView {...BASE_PROPS} />);
    const field = screen.getByLabelText("Search help") as HTMLInputElement;
    await userEvent.type(field, "tour");
    await userEvent.click(screen.getByRole("button", { name: "Clear – Search help" }));
    expect(field.value).toBe("");
  });
```

```tsx
  // jira-settings.test.tsx — the headline claim is the missing NAME, so it is first
  it("labels the user search field and clears it", async () => {
    render(<JiraSettingsSection {...PROPS_WITH_SPECIFIC_ASSIGNEE} />);
    // ★ Was placeholder-only. A placeholder is NOT an accessible name.
    const field = screen.getByLabelText("Type to search users…") as HTMLInputElement;
    await userEvent.type(field, "anna");
    await userEvent.click(screen.getByRole("button", { name: "Clear – Type to search users…" }));
    expect(field.value).toBe("");
  });
```

```tsx
  // sharepoint-picker-modal.test.tsx
  it("labels the site search field and clears it", async () => {
    render(<SharePointPickerModal {...BASE_PROPS} />);
    const field = screen.getByLabelText("Search sites…") as HTMLInputElement;
    await userEvent.type(field, "team");
    await userEvent.click(screen.getByRole("button", { name: "Clear – Search sites…" }));
    expect(field.value).toBe("");
  });
```

★ The Jira field only renders when `assigneeMode === "specific"` and a `projectKey` is set — build the props accordingly or the field is absent for the wrong reason.

- [ ] **Step 3: Run to verify they fail**

Run: `npm run test:run -- src/app/help-menu.test.tsx src/app/help-view.test.tsx src/app/jira-settings.test.tsx src/app/sharepoint-picker-modal.test.tsx`
Expected: four failures. For Jira and SharePoint the failure must be the `getByLabelText` line (no accessible name yet) — that is the prerequisite being proven, not the button.

- [ ] **Step 4: Implement — `help-menu.tsx`** (raw `<input>`, keeps its own classes)

```tsx
          <div className="shrink-0 border-b border-line p-2">
            <ClearableSearchInput
              value={query}
              onClear={() => setQuery("")}
              clearLabel={`${t(lang, "clear")} – ${t(lang, "helpSearchPanelLabel")}`}
            >
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t(lang, "helpSearchPlaceholder")}
                aria-label={t(lang, "helpSearchPanelLabel")}
                className="w-full rounded-md border border-line bg-surface px-2 py-1 pr-8 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ui-green [&::-webkit-search-cancel-button]:appearance-none"
              />
            </ClearableSearchInput>
          </div>
```

- [ ] **Step 5: Implement — `help-view.tsx`**

```tsx
        {activeTab === "help" && (
          <ClearableSearchInput
            value={query}
            onClear={() => setQuery("")}
            clearLabel={`${t(lang, "clear")} – ${t(lang, "helpSearchPlaceholder")}`}
            className="min-w-[12rem] flex-1 print:hidden"
          >
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t(lang, "helpSearchPlaceholder")}
              aria-label={t(lang, "helpSearchPlaceholder")}
              className={`w-full rounded-md border border-line bg-surface px-2 py-1 pr-8 text-sm text-foreground placeholder:text-muted-foreground [&::-webkit-search-cancel-button]:appearance-none ${FOCUS_RING} ${TRANSITION}`}
            />
          </ClearableSearchInput>
        )}
```

★ `min-w-[12rem] flex-1 print:hidden` move to the wrapper; the field becomes `w-full` and keeps `FOCUS_RING`/`TRANSITION`.

- [ ] **Step 6: Implement — `jira-settings.tsx`** (gains the missing `aria-label`)

```tsx
                  <ClearableSearchInput
                    value={userQuery}
                    onClear={() => setUserQuery("")}
                    clearLabel={`${t(lang, "clear")} – ${t(lang, "jiraUserSearch")}`}
                  >
                    <input
                      type="text"
                      value={userQuery}
                      onChange={(e) => setUserQuery(e.target.value)}
                      placeholder={t(lang, "jiraUserSearch")}
                      aria-label={t(lang, "jiraUserSearch")}
                      className={`${inputClass} pr-8`}
                    />
                  </ClearableSearchInput>
```

- [ ] **Step 7: Implement — `sharepoint-picker-modal.tsx`** (gains the missing `aria-label`)

```tsx
            <ClearableSearchInput
              value={searchQuery}
              onClear={() => setSearchQuery("")}
              clearLabel={`${t(lang, "clear")} – ${t(lang, "spPickerSearchPlaceholder")}`}
              className="flex-1"
            >
              <Input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                placeholder={t(lang, "spPickerSearchPlaceholder")}
                aria-label={t(lang, "spPickerSearchPlaceholder")}
                className="w-full pr-8"
              />
            </ClearableSearchInput>
```

Add the `ClearableSearchInput` import to all four files.

- [ ] **Step 8: Run to verify they pass**

Run: `npm run test:run -- src/app/help-menu.test.tsx src/app/help-view.test.tsx src/app/jira-settings.test.tsx src/app/sharepoint-picker-modal.test.tsx`
Expected: all pass.

- [ ] **Step 9: Commit**

```bash
git add src/app/help-menu.tsx src/app/help-view.tsx src/app/jira-settings.tsx src/app/sharepoint-picker-modal.tsx src/app/i18n.ts src/app/i18n.de.ts src/app/help-menu.test.tsx src/app/help-view.test.tsx src/app/jira-settings.test.tsx src/app/sharepoint-picker-modal.test.tsx
git commit -m "feat(a11y): label and clear the help, Jira and SharePoint search fields"
```

---

### Task 11: Duplicate-name guard

axe reports a MISSING accessible name and is blind to a DUPLICATE one. Slice C shipped two "Clear" buttons on one scanned view through a full 5/5 pass. This slice adds clears to many views at once, so the guard has to be a test.

**Files:**
- Create: `src/app/clear-label-uniqueness.test.tsx`

- [ ] **Step 1: Write the test**

```tsx
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// ★ A SOURCE scan, deliberately. Rendering every panel with enough props to
//   surface all its clears is a large fixture per view, and the failure mode is
//   a label that is not qualified at all — visible in the source. The per-panel
//   render tests in Tasks 4/6/8/9/10 cover the runtime name.
const BARE = /clearLabel=\{t\(lang,\s*"clear"\)\}/;

function callSites(): string[] {
  return readdirSync(__dirname)
    .filter((f) => /\.tsx?$/.test(f) && !/\.test\./.test(f))
    .filter((f) => f !== "clearable-search-input.tsx")
    .filter((f) => readFileSync(join(__dirname, f), "utf8").includes("clearLabel"));
}

describe("clear-button labels", () => {
  it("are never the bare `clear` key — every one is qualified", () => {
    const offenders = callSites().filter((f) =>
      BARE.test(readFileSync(join(__dirname, f), "utf8")),
    );
    expect(offenders).toEqual([]);
  });

  it("finds every call site by scanning the directory, so a new one cannot slip past", () => {
    // Discovery, not a hand-maintained list: a hardcoded array goes stale the
    // first time someone adds a clear without reading this file.
    const found = callSites();
    expect(found.length).toBeGreaterThanOrEqual(15);
    expect(found).toContain("pane-toolbar.tsx");
    expect(found).toContain("entity-link-picker.tsx");
    expect(found).toContain("report-table.tsx");
  });
});
```

- [ ] **Step 2: Run it**

Run: `npm run test:run -- src/app/clear-label-uniqueness.test.tsx`
Expected: PASS. If the count assertion fails low, list `callSites()` and reconcile against the audit — a missing file means a site was skipped, which is the useful signal.

- [ ] **Step 3: Mutation-check it**

Change one site's `clearLabel` to a bare `{t(lang, "clear")}`, re-run, confirm the FIRST test fails and names that file. Revert.

- [ ] **Step 4: Commit**

```bash
git add src/app/clear-label-uniqueness.test.tsx
git commit -m "test(a11y): guard clear-button labels against the bare 'Clear' name"
```

---

### Task 12: Full gate run

- [ ] **Step 1: Lint**

Run: `npm run lint`
Expected: 0 errors, 0 warnings. A now-unused `Input` import (tasks-section, after the migration) is fatal here — that is the likeliest failure in this slice.

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0. Trust this over any IDE squiggle.

- [ ] **Step 3: Full unit suite**

Run: `npm run test:run`
Expected: all pass (~8290 plus ~25 added).

- [ ] **Step 4: Coverage**

Run: `npm run test:coverage`
Expected: at or above global lines 92 / funcs 91 / branch 80 / stmts 89. `wildcard-match.ts` is a new coverage-gated pure module carried by its own test — do NOT add it to `coverage.exclude` (that is a fallback for UI glue hooks, not pure modules).

- [ ] **Step 5: Duplication**

Run: `npm run dup:check`
Expected: under 1.75% (baseline entering this slice: 1.16% / 1.47%). If it trips, the cause is more likely a copied test block than the wraps — extract a helper, never raise the threshold.

- [ ] **Step 6: File-size ratchet**

Run: `npm run size:check`
Expected: `file-size ratchet ok`. `tasks-section.tsx` must be ≤ 1073 and `timelog-panel.tsx` under 800.

- [ ] **Step 7: axe, on a FRESH isolated server**

```bash
PORT=3100 npm run dev
npx playwright test e2e/a11y.spec.ts --project=chromium -g "Gantt"
npx playwright test e2e/a11y.spec.ts --project=chromium -g "Open Points"
npx playwright test e2e/a11y.spec.ts --project=chromium -g "Milestones"
npx playwright test e2e/a11y.spec.ts --project=chromium -g "RAID"
npx playwright test e2e/a11y.spec.ts --project=chromium -g "Changes"
npx playwright test e2e/a11y.spec.ts --project=chromium -g "Stakeholders"
npx playwright test e2e/a11y.spec.ts --project=chromium -g "Reports"
npx playwright test e2e/a11y.spec.ts --project=chromium -g "Resources"
npx playwright test e2e/a11y.spec.ts --project=chromium -g "Settings"
npx playwright test e2e/a11y.spec.ts --project=chromium -g "Time bookings"
PORT=3100 npm run stop
```
Expected: 5/5 per view. axe proves names EXIST, not that they are distinct — Task 11 covers the latter.

- [ ] **Step 8: Eye-verify the unscanned surfaces**

Knowledge · Help (floating window AND the in-pane view, ideally both open at once) · the SharePoint picker modal · Settings → Integrations → Jira · the Open Points toolbar after the atom migration. For each: the ✕ sits inside its field, never over text, and focus lands back in the field after clicking it.

---

### Task 13: Release chain

**Files:**
- Modify: `src/app/version.ts`, `CHANGELOG.md`

- [ ] **Step 1: Confirm the codename is still free**

Run: `grep -c "Griffith" CHANGELOG.md`
Expected: `0`. If not, pick another and re-check (~230 used).

- [ ] **Step 2: Bump the version**

In `src/app/version.ts`, set `APP_VERSION` to `0.205.0` and the milestone to `Griffith`, matching the surrounding format exactly.

- [ ] **Step 3: CHANGELOG entry**

Add at the top of `CHANGELOG.md`, matching the existing format:

```markdown
## 0.205.0 "Griffith"

- **Every search and filter field can now be cleared with one click.** The clear ✕ shipped for the
  report tables and timelog scope filters reaches 15 more fields: Open Points, changes, milestones,
  RAID, stakeholders, activity log, diagnostics, Gantt, global search, Help (window and page), Jira
  user search, Knowledge documents, RACI, resource directory, SharePoint picker, the linked-entity
  pickers and the timelog people filter. Clearing now returns focus to the field it cleared, on every
  one of them.
- **Linked-task search accepts a `*` wildcard**, matching the timelog scope filters — `api*docs`
  finds "Review the API docs". Applies to linked tasks in changes, RAID, Knowledge and budget
  buckets, and to RAID "caused by".
- **Fixed:** the Knowledge linked-tasks picker collapsed to a few characters wide in the add-link
  row, and library cards packed three-up too early.
- **Accessibility:** the Jira user search and SharePoint site search had no accessible name (a
  placeholder is not one), and the floating Help window's search shared a name with the Help page's.
  All three now announce distinctly.
```

- [ ] **Step 4: No highlight key**

`APP_HIGHLIGHT_KEYS` is a cumulative list of FEATURE AREAS, not per-release entries. Nothing to add.

- [ ] **Step 5: Commit**

```bash
git add src/app/version.ts CHANGELOG.md
git commit -m "chore(release): 0.205.0 Griffith"
```

- [ ] **Step 6: Cumulative archive — the mandated step, and the one that already nearly destroyed 298 documents**

`docs/superpowers/` is gitignored, so the zip is the only copy. A walk-the-tree zip is a strict SUBSET of the previous archive (the tree was pruned; the archive holds ~334 entries). Merge the old one in and ASSERT the superset property. Save as `scripts/archive-slice-docs.py` or run inline:

```python
import glob, os, zipfile

old = sorted(glob.glob("docs/superpowers/_archive-slice-docs-*.zip"))[-1]
new = "docs/superpowers/_archive-slice-docs-2026-07-29.zip"        # today's date
assert new != old, "pick today's date; never overwrite the previous archive"

tree = {}
for root, _, files in os.walk("docs/superpowers"):
    for f in files:
        if f.endswith(".zip"):
            continue
        p = os.path.join(root, f)
        tree[os.path.relpath(p, "docs/superpowers").replace("\\", "/")] = p

with zipfile.ZipFile(old) as o, zipfile.ZipFile(new, "w", zipfile.ZIP_DEFLATED) as n:
    for name, path in tree.items():          # working tree WINS on collision
        n.write(path, name)
    for name in o.namelist():                # everything else carried forward
        if name not in tree:
            n.writestr(name, o.read(name))

with zipfile.ZipFile(old) as o, zipfile.ZipFile(new) as n:
    missing = set(o.namelist()) - set(n.namelist())
    assert not missing, f"ARCHIVE WOULD LOSE {len(missing)} FILES: {sorted(missing)[:5]}"
    print(f"ok: {len(n.namelist())} entries, superset of {len(o.namelist())}")
```

Expected: `ok: <n> entries, superset of <m>` with n ≥ m. **Do not delete the old zip** until that line prints.

- [ ] **Step 7: Stop**

Do NOT push, open an MR, or merge. Report the gate results and wait for an explicit "release".

---

## Verification summary

| Spec requirement | Task |
|---|---|
| Focus returns to the field after clearing | 1 |
| `wildcard-match.ts` pure module + tests | 2 |
| `filterPickerOptions` + `customerMatcher` delegate; placeholder hint | 3 |
| ✕ site 14 (`PaneSearchInput` → change · milestones · RAID · stakeholders) | 4 |
| ✕ site 15 (Open Points) without growing a baselined file | 5 |
| ✕ site 12 (`EntityLinkPicker`, 5 pickers) + chip width | 6 |
| Knowledge add-form basis + card grid | 7 |
| ✕ sites 1, 2, 3, 10 | 8 |
| ✕ sites 8, 13, 9, 4 | 9 |
| ✕ sites 5, 6, 7, 11 + the two missing `aria-label`s + `helpSearchPanelLabel` | 10 |
| Duplicate-name guard | 11 |
| Gates incl. axe, dup, size, coverage | 12 |
| 0.205.0 "Griffith", CHANGELOG, cumulative archive | 13 |
