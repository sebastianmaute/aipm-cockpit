# Shared-primitive adoption Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adopt three primitives this repo already owns at the call sites that never took them up, closing a real `aria-sort` gap. (The duplication reduction this originally claimed did NOT
materialise — see Task 3 Step 4. The gate counts LINES and this refactor trades tokens for lines.)

**Architecture:** `SortResizeTh`'s `sortKey` prop widens to `K | null` (it is read in exactly one place), which lets every existing sort-state shape in the app feed it without a bespoke adapter. A new `useSortHeaderProps` bundles the four props identical across a table's columns. Six panels then drop their hand-rolled header trio, and `tasks-section` drops its inline copy of `ColumnConfigPopover` along with the three props that plumbed it.

**Tech Stack:** Next.js 16.2.11, React 19, TypeScript, Tailwind v4, vitest + @testing-library/react, Playwright + axe.

---

## Deviation from the approved spec — read this first

The spec called for **two named adapters** (`fromNullableSort`, `fromSplitSort`). Reading the
primitive during planning showed they are not needed, and the plan builds the simpler thing:

- `sortKey` is read in **exactly one place** in `SortResizeTh` — the `active` computation
  (`const active = sortKey === sortCol && sortDir !== "off"`). Widening the prop to `K | null` is a
  one-line, backwards-compatible change: `null === sortCol` is false, so an unsorted table reports
  `aria-sort="none"` on every column, which is correct.
- Family 2's `sortDir` is `"asc" | "desc"`, already a **subtype** of `SortDir`. It is assignable
  with no conversion at all.
- Family 1 then needs only `sort?.key ?? null` and `sort?.dir ?? "off"` at the one call site per
  file, which `useSortHeaderProps` already takes.

So: one prop widening plus the props bag subsumes both adapters. Everything else in the spec stands
unchanged. **If `useSortHeaderProps` turns out to need per-family logic during Task 3, stop and
raise it** — that would mean this simplification was wrong.

Three further facts found while planning that the spec does not carry:

1. **`raid-panel-rows` redeclares `PanelSort` badly.** It has a local
   `type SortState = { key: string; dir: string } | null` while `panel-views.ts` exports
   `type PanelSort = { key: string; dir: SortDir } | null`. The fix is to **use `PanelSort`**, not
   to hand-tighten the local copy. Task 5.
2. **Converting the first three panels changes header font weight.** `change-panel`,
   `stakeholders-panel` and `raid-panel-rows` render `className="relative px-3 py-2"` with **no**
   `font-medium`; `SortResizeTh` always emits `font-medium`. `activity-log-panel`,
   `resource-directory` and `roles-editor` already match. This is a real visual change in three
   panels and needs an eye-verify (Task 15), not just a green suite.
3. **`PanelSort.key` is `string`, not a generic.** Passing it raw would infer `K = string` and
   silently disable the `sortCol` checking the primitive exists to provide. Each of those panels
   passes an explicit generic and narrows once, at the single `useSortHeaderProps` call, instead of
   leaving seven unchecked call sites.

---

## File structure

**Modified — primitive layer:**
- `src/app/report-table.tsx` — widen `sortKey`; add `useSortHeaderProps`.
- `src/app/report-table.test.tsx` — cover both.

**Modified — existing `SortResizeTh` adopters (Part C, prop bag):** `raid-report-panel.tsx`,
`change-report-panel.tsx`, `resources-report.tsx`, `reports-tables.tsx`, `resources-panel-rows.tsx`,
`budget-report-panel.tsx`, `budget-panel.tsx`, `documents-list.tsx`, `milestones-panel.tsx`,
`calendar-series-list.tsx`, `asset-library.tsx`, `tasks-section.tsx`, `documents-panel.tsx`.

**Modified — hand-rolled conversions (Part B):** `change-panel.tsx`, `stakeholders-panel.tsx`,
`raid-panel-rows.tsx`, `activity-log-panel.tsx`, `resource-directory.tsx`, `roles-editor.tsx`, plus
a test file each.

**Modified — column-config (Part A):** `tasks-section.tsx`, `task-manager.tsx`,
`use-column-manager.ts`, `tasks-section.test.tsx`.

**Created:** none. Every primitive already exists.

---

## Ground rules

- **Never read a gate's exit code through a pipe.** Redirect, echo `$?` unpiped, then read the file:
  `npm run test:run > /tmp/suite.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/suite.log`
- **Run `npx tsc --noEmit` after editing any test.** `next build` does not typecheck `*.test.tsx`
  and vitest never typechecks.
- **Never run two vitest processes at once.**
- **Do not add an i18n key.** Every label this plan needs already exists. If one seems necessary,
  stop and raise it — `i18n.ts` is the one file that would conflict with the unshipped
  `feat/documents-s3c2-ooxml-media`.
- **Never `git commit --amend`** — this worktree shares its object store. New commits only.
- Commit with a Bash heredoc, not a PowerShell here-string.
- ★★★ **A test path that does not exist makes `vitest` print "no tests" and EXIT 0.** A task
  step naming a missing test file is a SILENT FALSE GREEN. Three files named in Task 4's own
  verify step did not exist (`reports-tables.test.tsx`, `resources-panel-rows.test.tsx`,
  `documents-list.test.tsx`). **Confirm every test path in a task exists before trusting its run:**
  `for p in <paths>; do [ -f "$p" ] || echo "MISSING: $p"; done`
- ★★ Heredocs in this environment turn a `\n` inside a quoted body into a REAL newline, which
  breaks any script string containing one. Use `String.fromCharCode(10)` instead of an escape.
- ★★ `git show HEAD:<path>` writes an LF blob under `core.autocrlf=true`, so a file restored that
  way shows as modified against an unchanged tree. Re-normalise to CRLF after restoring.
- ★★★ **`git hash-object` AND `git diff --exit-code` BOTH report CLEAN on a revert that changed
  every line ending.** Measured in Task 11: a mutation revert wrote `report-table.tsx` back LF-only
  against a CRLF working tree, and neither check saw it, because git NORMALISES line endings before
  hashing. Five task briefs in this plan told implementers to prove a revert with exactly those two
  commands — that instruction is INSUFFICIENT. Also count the line endings:
  `node -e "const s=require('fs').readFileSync('<file>','utf8');console.log((s.match(/\r\n/g)||[]).length,(s.match(/(?<!\r)\n/g)||[]).length)"`
  — the second number must be 0 on a CRLF file.
- ★ `git checkout -- <path>` is blocked by policy in subagent sessions. Restore via `git show`
  plus the CRLF re-normalisation above.
- The size gate counts `wc -l` **+ 1**. Read the real number with:
  `node -e "console.log(require('fs').readFileSync('<file>','utf8').split('\n').length)"`

---

### Task 1: Widen `SortResizeTh`'s `sortKey` to `K | null`

**Files:**
- Modify: `src/app/report-table.tsx`
- Test: `src/app/report-table.test.tsx`

- [ ] **Step 1: Write the failing test**

Add to the existing `describe("SortResizeTh", ...)` block in `src/app/report-table.test.tsx`:

```tsx
it("reports aria-sort none on every column when the table is unsorted (sortKey null)", () => {
  render(
    <table><thead><tr>
      <SortResizeTh label="Title" sortCol="title" sortKey={null} sortDir="off" onSort={() => {}} />
      <SortResizeTh label="Owner" sortCol="owner" sortKey={null} sortDir="off" onSort={() => {}} />
    </tr></thead></table>,
  );
  const headers = screen.getAllByRole("columnheader");
  expect(headers).toHaveLength(2);
  for (const th of headers) {
    expect(th).toHaveAttribute("aria-sort", "none");
    expect(th.textContent).not.toContain("↑");
    expect(th.textContent).not.toContain("↓");
  }
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
npx vitest run src/app/report-table.test.tsx -t "unsorted" > /tmp/t1.log 2>&1; echo "EXIT=$?"
grep -E "Tests |FAIL|error TS" /tmp/t1.log
```

Expected: FAIL. `sortKey={null}` is not assignable to `K`.

- [ ] **Step 3: Widen the prop**

In `src/app/report-table.tsx`, inside the `SortResizeTh` props type, change:

```tsx
  /** The table's active sort key — also fixes `K` so `sortCol` must be valid. */
  sortKey: K;
```

to:

```tsx
  /** The table's active sort key, or `null` when the table is unsorted — also
   *  fixes `K` so `sortCol` must be valid.
   *
   *  ★ `null` is a real value here, not an oversight: several panels hold sort
   *  as `{ key, dir } | null` (`PanelSort`). It is only ever compared against
   *  `sortCol`, so a null key makes every column inactive and every
   *  `aria-sort` "none", which is exactly right for an unsorted table. */
  sortKey: K | null;
```

Leave the `active` line untouched — `null === sortCol` is already false.

- [ ] **Step 4: Run the test and the whole file**

```bash
npx vitest run src/app/report-table.test.tsx > /tmp/t1.log 2>&1; echo "EXIT=$?"
grep -E "Tests |FAIL" /tmp/t1.log
npx tsc --noEmit; echo "TSC_EXIT=$?"
```

Expected: all pass, `TSC_EXIT=0`.

- [ ] **Step 5: Mutation-check the widening**

Temporarily change `active` to `const active = sortDir !== "off";` and re-run. The new test must
go RED (it passes `sortDir="off"`, so use the *existing* first test in the file as the witness —
it passes `sortDir="asc"` with a non-matching `sortKey`). Confirm at least one test reddens, then
**revert the mutation**.

```bash
git diff --stat src/app/report-table.tsx   # must show only the prop-type change
```

- [ ] **Step 6: Commit**

```bash
git add src/app/report-table.tsx src/app/report-table.test.tsx
git commit -m "feat(report-table): let SortResizeTh take a null sort key

Several panels hold sort as PanelSort ({key, dir} | null). sortKey is read
in exactly one place - the active computation - so accepting null there is
enough to feed every sort-state shape in the app without an adapter per
panel. An unsorted table now reports aria-sort=none on every column."
```

---

### Task 2: Add `useSortHeaderProps`

**Files:**
- Modify: `src/app/report-table.tsx`
- Test: `src/app/report-table.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
describe("useSortHeaderProps", () => {
  it("returns a stable object while its inputs are unchanged", () => {
    const onSort = vi.fn();
    const onResize = vi.fn();
    const seen: unknown[] = [];
    function Probe({ tick }: { tick: number }) {
      const th = useSortHeaderProps<"a" | "b">("a", "asc", onSort, onResize);
      seen.push(th);
      return <span data-testid="tick">{tick}</span>;
    }
    const { rerender } = render(<Probe tick={1} />);
    rerender(<Probe tick={2} />);
    expect(seen).toHaveLength(2);
    expect(seen[0]).toBe(seen[1]);
  });

  it("spreads into SortResizeTh and drives the active column", () => {
    const onSort = vi.fn();
    function Table() {
      const th = useSortHeaderProps<"title" | "owner">("owner", "desc", onSort);
      return (
        <table><thead><tr>
          <SortResizeTh {...th} label="Title" sortCol="title" />
          <SortResizeTh {...th} label="Owner" sortCol="owner" />
        </tr></thead></table>
      );
    }
    render(<Table />);
    const [title, owner] = screen.getAllByRole("columnheader");
    expect(title).toHaveAttribute("aria-sort", "none");
    expect(owner).toHaveAttribute("aria-sort", "descending");
    fireEvent.click(screen.getByRole("button", { name: /owner/i }));
    expect(onSort).toHaveBeenCalledWith("owner");
  });

  it("renders no resize grip when onResize is omitted", () => {
    function Table() {
      const th = useSortHeaderProps<"title">(null, "off", () => {});
      return <table><thead><tr><SortResizeTh {...th} label="Title" sortCol="title" /></tr></thead></table>;
    }
    const { container } = render(<Table />);
    expect(container.querySelector(".cursor-col-resize")).toBeNull();
  });
});
```

Add `useSortHeaderProps` to the existing import from `./report-table` at the top of the test file.

- [ ] **Step 2: Run it and confirm it fails**

```bash
npx vitest run src/app/report-table.test.tsx -t "useSortHeaderProps" > /tmp/t2.log 2>&1; echo "EXIT=$?"
grep -E "Tests |FAIL|is not exported" /tmp/t2.log
```

Expected: FAIL — `useSortHeaderProps` is not exported.

- [ ] **Step 3: Implement it**

Add to `src/app/report-table.tsx`, immediately after `useSortableFilter`:

```tsx
/**
 * Bundles the four `SortResizeTh` props that are identical for every column of
 * one table — the repetition that made these header blocks the top tsx clone
 * cluster (TD-6).
 *
 * ★ Returns a props OBJECT, never a bound component. A component built inside a
 *   hook gets a new identity every render, which remounts every header on every
 *   render; an object does not.
 *
 * Usage: `const th = useSortHeaderProps<MyKey>(sort?.key ?? null, sort?.dir ?? "off", toggleSort, startResize)`
 * then `<SortResizeTh {...th} label={...} sortCol="id" width={w.id} />`.
 */
export function useSortHeaderProps<K extends string>(
  sortKey: K | null,
  sortDir: SortDir,
  onSort: (col: K) => void,
  onResize?: (col: string, e: React.MouseEvent) => void,
) {
  return useMemo(
    () => ({ sortKey, sortDir, onSort, onResize }),
    [sortKey, sortDir, onSort, onResize],
  );
}
```

`useMemo` is already imported in this file; `SortDir` is declared above.

- [ ] **Step 4: Run the tests**

```bash
npx vitest run src/app/report-table.test.tsx > /tmp/t2.log 2>&1; echo "EXIT=$?"
grep -E "Tests |FAIL" /tmp/t2.log
npx tsc --noEmit; echo "TSC_EXIT=$?"
```

Expected: all pass, `TSC_EXIT=0`.

★ If the stability test fails, the caller's `onSort`/`onResize` are unstable — that is a finding
about the call site, not a reason to drop the `useMemo`. Note it and continue; Task 3 will show
whether it matters in practice.

- [ ] **Step 5: Commit**

```bash
git add src/app/report-table.tsx src/app/report-table.test.tsx
git commit -m "feat(report-table): add useSortHeaderProps

Bundles the four SortResizeTh props identical across a table's columns
(sortKey, sortDir, onSort, onResize). Returns an object rather than a bound
component: a component minted inside a hook changes identity every render
and would remount every header."
```

---

### Task 3: Adopt the props bag in the three heaviest report panels

**Files:**
- Modify: `src/app/raid-report-panel.tsx` (28 invocations), `src/app/change-report-panel.tsx` (6),
  `src/app/resources-report.tsx` (16)

These three carry the highest-fanout clone. Each already holds
`const { sorted, click } = useSortableFilter(...)`, `const w = colResize.colWidths` and a
`const sr = colResize.startColResize as (col: string, e: React.MouseEvent) => void`.

- [ ] **Step 0: Capture the BEFORE header markup**

The spec requires proving this refactor changes no DOM. Capture it **before touching anything**,
while the tree is still on the pre-refactor commit. Create `src/app/__dom-probe.test.tsx`:

```tsx
import { expect, it } from "vitest";
import { render } from "@testing-library/react";
import { writeFileSync } from "node:fs";
import { ChangeReportPanel } from "./change-report-panel";

it("dumps the header markup for a before/after comparison", () => {
  const { container } = render(<ChangeReportPanel {...probeProps} />);
  const heads = [...container.querySelectorAll("thead")].map((h) => h.outerHTML).join("\n");
  writeFileSync(process.env.DOM_PROBE_OUT ?? "/tmp/dom-before.html", heads);
  expect(heads.length).toBeGreaterThan(0);
});
```

Build `probeProps` from whatever `change-report-panel.test.tsx` already passes — import its fixture
rather than inventing one, so the probe renders a real table.

```bash
DOM_PROBE_OUT=/tmp/dom-before.html npx vitest run src/app/__dom-probe.test.tsx > /tmp/probe.log 2>&1; echo "EXIT=$?"
wc -c /tmp/dom-before.html
```

★ `expect(heads.length).toBeGreaterThan(0)` is not decoration — without it the probe passes on an
empty render and the later comparison would compare two empty files and report success.

- [ ] **Step 1: Add the hook call in each file**

Immediately after the existing `const sr = ...` line in each sortable table's component, add:

```tsx
const th = useSortHeaderProps(sort.key, sort.dir, click, sr);
```

Add `useSortHeaderProps` to that file's existing `./report-table` import.

★ These files pass `sort.key` from `useSortableFilter`, which is already the panel's own key
union — no generic argument and no cast is needed here. Only the `PanelSort` panels (Tasks 6–8)
need the explicit generic.

- [ ] **Step 2: Rewrite each call site**

Replace the four repeated props with the spread. Concretely, in `change-report-panel.tsx`:

```tsx
<SortResizeTh label={t(lang, "id")} sortCol="id" width={w.id} sortKey={sort.key} sortDir={sort.dir} onSort={click} onResize={sr} />
```

becomes

```tsx
<SortResizeTh {...th} label={t(lang, "id")} sortCol="id" width={w.id} />
```

Keep every other prop exactly as it is — `align`, `hint`, `resizeCol`, `title` and `stickyLeft` are
per-column and do not move into the bag. Put the spread **first** so a per-column prop can never be
silently overwritten by the bag.

★ Some components in these files have more than one table with its own sort state (e.g.
`raid-report-panel` renders several). Each table gets its **own** `th` — name them apart
(`thByCategory`, `thByStatus`) rather than reusing one across tables.

- [ ] **Step 3: Verify no behaviour changed**

```bash
npx vitest run src/app/raid-report-panel.test.tsx src/app/change-report-panel.test.tsx src/app/resources-report.test.tsx > /tmp/t3.log 2>&1; echo "EXIT=$?"
grep -E "Tests |FAIL" /tmp/t3.log
npx tsc --noEmit; echo "TSC_EXIT=$?"
```

Expected: all pass with no test edits. These are pure refactors — **if a test needs changing,
the refactor is wrong.**

- [ ] **Step 3b: Prove the DOM did not change, then delete the probe**

```bash
DOM_PROBE_OUT=/tmp/dom-after.html npx vitest run src/app/__dom-probe.test.tsx > /tmp/probe.log 2>&1; echo "EXIT=$?"
diff /tmp/dom-before.html /tmp/dom-after.html; echo "DIFF_EXIT=$?"
```

Expected: `DIFF_EXIT=0` — the header markup is byte-identical. A non-empty diff means a per-column
prop was dropped or the spread overwrote one; fix it rather than re-baselining the probe.

Then remove the scratch file so it cannot reach a commit:

```bash
rm src/app/__dom-probe.test.tsx
git status --porcelain -uall   # must not list __dom-probe
```

★ An untracked file in `src/app` is charged by the coverage gate even though `git diff HEAD` cannot
see it — `git status --porcelain -uall` is the check that catches it.

- [ ] **Step 4: Measure the duplication (it RISES — this is expected)**

```bash
npm run dup:check > /tmp/dup-after3.log 2>&1; echo "EXIT=$?"
grep -E "Total:|Found" /tmp/dup-after3.log
```

★★★ MEASURED 2026-08-23: it goes 1.18% → 1.20% (1844 → 1870 duplicated lines),
apples-to-apples on one commit. This was expected to FALL and does not. `dup:check` compares
duplicated **lines**; collapsing four props into `{...th}` removes ~814 tokens while ADDING 15
lines, so jscpd's `--min-tokens 50` window spans more lines per clone and every pre-existing
clone in these files grew in line count. Record the number and confirm it stays under the 1.75
threshold. Do NOT revert the refactor or re-baseline anything over this.

- [ ] **Step 5: Commit**

```bash
git add src/app/raid-report-panel.tsx src/app/change-report-panel.tsx src/app/resources-report.tsx
git commit -m "refactor(reports): bind the repeated sort-header props once per table

The three heaviest SortResizeTh consumers repeated sortKey/sortDir/onSort/
onResize on every column - the highest-fanout tsx clone in the tree. Each
table now binds them once via useSortHeaderProps and spreads. No DOM change."
```

---

### Task 4: Adopt the props bag in the remaining nine adopters

**Files:**
- Modify: `src/app/reports-tables.tsx`, `src/app/resources-panel-rows.tsx`,
  `src/app/budget-report-panel.tsx`, `src/app/budget-panel.tsx`, `src/app/documents-list.tsx`,
  `src/app/milestones-panel.tsx`, `src/app/calendar-series-list.tsx`, `src/app/asset-library.tsx`

★★ MEASURED: `documents-panel.tsx` has **zero** `<SortResizeTh>` call sites and was wrongly listed
here — its only mention of the name is a comment about the `onResize` false-affordance rule. Its
three real sites live in `documents-list.tsx`. `budget-panel.tsx` was transformed and then
REVERTED: one call site, a literal `sortKey="role"`, an inline-arrow `onSort` — no repetition to
remove and a memo that can never hold. `tasks-section.tsx` is DEFERRED to after Task 14, which
frees ~40 lines in it; applying the bag now grows the file past its zero-headroom size baseline.

- [ ] **Step 1: Apply the same transformation**

Identical to Task 3. Two shape notes:

- `resources-panel-rows.tsx` names its state `planSort` / `planColWidths` —
  `const th = useSortHeaderProps(planSort.key, planSort.dir, planClick, planResize)`, using
  whatever the file already calls its click and resize handlers.
- `documents-list.tsx` and `tasks-section.tsx` hold **split** state (`sortKey` + `sortDir`
  separately) rather than a `sort` object — pass those two directly:
  `const th = useSortHeaderProps(sortKey, sortDir, onSort, onResize)`.
- `calendar-series-list.tsx` **and `asset-library.tsx`** pass **no** `onResize` today. Keep both
  that way: omit the fourth argument. Do not pass a no-op — that would draw a grip that looks
  draggable and does nothing. (The plan originally named only `calendar-series-list`.)

- [ ] **Step 2: Run the affected suites**

```bash
# ★★ reports-tables.test.tsx / resources-panel-rows.test.tsx / documents-list.test.tsx DO NOT
# EXIST. Naming them here would print "no tests" and exit 0 - a silent false green. These are
# the suites that actually render those components:
npx vitest run src/app/reports.test.tsx src/app/resources-panel.test.tsx src/app/documents-panel.test.tsx src/app/budget-panel.test.tsx src/app/milestones-panel.test.tsx src/app/calendar-series-list.test.tsx src/app/asset-library.test.tsx src/app/tasks-section.test.tsx > /tmp/t4.log 2>&1; echo "EXIT=$?"
grep -E "Tests |FAIL" /tmp/t4.log
npx tsc --noEmit; echo "TSC_EXIT=$?"
```

Expected: all pass with no test edits.

- [ ] **Step 3: Commit**

```bash
git add src/app/reports-tables.tsx src/app/resources-panel-rows.tsx src/app/budget-report-panel.tsx src/app/budget-panel.tsx src/app/documents-list.tsx src/app/milestones-panel.tsx src/app/calendar-series-list.tsx src/app/asset-library.tsx src/app/tasks-section.tsx src/app/documents-panel.tsx
git commit -m "refactor: bind sort-header props once in the remaining adopters

Same transformation as the report panels. calendar-series-list keeps its
deliberate absence of onResize - a no-op there would draw a grip that looks
draggable and is not."
```

---

### Task 5: Replace `raid-panel-rows`'s loose local sort type with `PanelSort`

**Files:**
- Modify: `src/app/raid-panel-rows.tsx`

This is a latent bug independent of the conversion, so it lands first and alone.

- [ ] **Step 1: Delete the local type**

`src/app/raid-panel-rows.tsx` declares:

```tsx
type SortState = { key: string; dir: string } | null;
```

`dir: string` accepts `"sideways"`. `src/app/panel-views.ts` already exports the correct shape:

```tsx
export type PanelSort = { key: string; dir: SortDir } | null;
```

Delete the local declaration, import `PanelSort` from `./panel-views`, and replace every
`SortState` reference in the file with `PanelSort`.

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit; echo "TSC_EXIT=$?"
```

Expected: `TSC_EXIT=0`. If a real error appears, it is a genuine mismatch the loose type was
hiding — fix the mismatch, do not widen `PanelSort`.

- [ ] **Step 3: Run the suite**

```bash
# raid-panel-rows.test.tsx DOES NOT EXIST (Task 8 says so) - naming it here would print
# "no tests" and exit 0. raid-panel-rows is covered through raid-panel.test.tsx.
npx vitest run src/app/raid-panel.test.tsx > /tmp/t5.log 2>&1; echo "EXIT=$?"
grep -E "Tests |FAIL" /tmp/t5.log
```

- [ ] **Step 4: Commit**

```bash
git add src/app/raid-panel-rows.tsx
git commit -m "fix(raid): type the sort direction instead of accepting any string

The local SortState declared dir: string, a loose duplicate of the PanelSort
type panel-views already exports. Use PanelSort."
```

---

### Task 6: Convert `change-panel` to `SortResizeTh`

**Files:**
- Modify: `src/app/change-panel.tsx`
- Test: `src/app/change-panel.test.tsx`

Seven sortable columns: `id`, `type`, `title`, `impact`, `status`, `requestedBy`, `raisedDate`.
Each is wrapped in `{!hiddenSet.has("<col>") && ( ... )}` — **keep those wrappers exactly as they
are.**

- [ ] **Step 1: Write the failing test**

Add to `src/app/change-panel.test.tsx`:

```tsx
it("announces sort state through aria-sort, not through the button name", async () => {
  // change-panel.test.tsx has no render helper: it renders inline against the
  // `base` props object it already defines, with the Providers wrapper.
  render(<ChangePanel {...base} />, { wrapper: Providers });
  const header = screen.getByRole("columnheader", { name: /title/i });
  expect(header).toHaveAttribute("aria-sort", "none");

  const btn = screen.getByRole("button", { name: /^title$/i });
  await userEvent.click(btn);
  expect(screen.getByRole("columnheader", { name: /title/i })).toHaveAttribute("aria-sort", "ascending");

  await userEvent.click(btn);
  expect(screen.getByRole("columnheader", { name: /title/i })).toHaveAttribute("aria-sort", "descending");

  // Third click returns to unsorted - PanelSort's third state is null.
  await userEvent.click(btn);
  expect(screen.getByRole("columnheader", { name: /title/i })).toHaveAttribute("aria-sort", "none");

  // The glyph stays VISIBLE but is out of the accessible name.
  expect(screen.getByRole("button", { name: /^title$/i })).toBeInTheDocument();
});
```

★ `{ name: /^title$/i }` is the assertion that matters. Today the button's name carries the sort
glyph, so an unanchored match would pass either way.

- [ ] **Step 2: Run it and confirm it fails**

```bash
npx vitest run src/app/change-panel.test.tsx -t "aria-sort" > /tmp/t6.log 2>&1; echo "EXIT=$?"
grep -E "Tests |FAIL" /tmp/t6.log
```

Expected: FAIL — the third state and the anchored name do not hold yet.

- [ ] **Step 3: Bind the props once**

After the existing `const startResize = startColResize as (col: string, e: React.MouseEvent) => void;`
line, add:

```tsx
// PanelSort.key is a bare `string`, so narrow ONCE here rather than leaving
// seven unchecked sortCol call sites: the explicit generic is what makes a
// typo in `sortCol` a compile error.
const th = useSortHeaderProps<ChangeSortKey>(
  (pf.sort?.key ?? null) as ChangeSortKey | null,
  pf.sort?.dir ?? "off",
  toggleSort,
  startResize,
);
```

Import `useSortHeaderProps` from `./report-table`.

- [ ] **Step 4: Replace each header**

For example:

```tsx
{!hiddenSet.has("id") && (
<th className="relative px-3 py-2" style={{ width: colWidths.id, minWidth: colWidths.id }} aria-sort={ariaSort("id")}>
  <button type="button" onClick={() => toggleSort("id")} aria-label={t(lang, "id")} className={`inline-flex items-center gap-1 hover:text-[var(--table-head-accent)] ${INTERACTIVE}`}>
    #{sortArrow("id")}
  </button>
  <ColumnResizeHandle col="id" onMouseDown={startResize} />
</th>
)}
```

becomes

```tsx
{!hiddenSet.has("id") && (
  <SortResizeTh {...th} label="#" sortCol="id" width={colWidths.id} title={t(lang, "id")} />
)}
```

★ **The `id` column is the label-in-name fix.** Its visible text is `#` while its accessible name
was `ID` — the visible label was not contained in the name. `label="#"` plus `title={t(lang,"id")}`
makes the name match what is on screen and keeps the meaning available on hover.

For the other six, `label` is the same `t(lang, ...)` call the button already rendered, `sortCol`
is the key already passed to `toggleSort`, and `width` is the same `colWidths.<col>`:

| sortCol | label | width |
|---|---|---|
| `type` | `t(lang, "changeFieldType")` | `colWidths.type` |
| `title` | `t(lang, "changeFieldTitle")` | `colWidths.title` |
| `impact` | `t(lang, "changeFieldImpact")` | `colWidths.impact` |
| `status` | `t(lang, "changeFieldStatus")` | `colWidths.status` |
| `requestedBy` | `t(lang, "changeFieldRequestedBy")` | `colWidths.requestedBy` |
| `raisedDate` | `t(lang, "changeFieldRaisedDate")` | `colWidths.raisedDate` |

Read each label key off the file rather than trusting this table — it was transcribed, and a wrong
key is a silently wrong header.

Then delete the now-unused `sortArrow` and `ariaSort` helpers and any import
(`ColumnResizeHandle`, `INTERACTIVE`) that no longer has a user in this file. **`lint` has no
`--max-warnings` gate, so an unused import ships green — remove them by hand.**

- [ ] **Step 5: Run tests and typecheck**

```bash
npx vitest run src/app/change-panel.test.tsx > /tmp/t6.log 2>&1; echo "EXIT=$?"
grep -E "Tests |FAIL" /tmp/t6.log
npx tsc --noEmit; echo "TSC_EXIT=$?"
npx eslint src/app/change-panel.tsx; echo "LINT_EXIT=$?"
```

- [ ] **Step 6: Commit**

```bash
git add src/app/change-panel.tsx src/app/change-panel.test.tsx
git commit -m "refactor(changes): fold the header trio into SortResizeTh

Seven hand-rolled th + sort button + resize handle groups become the shared
primitive, which carries aria-sort derived from the same value as the arrow.

Also fixes a label-in-name gap on the id column: its visible text is '#'
while its accessible name was 'ID', so the visible label was not contained
in the name (WCAG 2.5.3). The name is now '#' and 'ID' moved to title."
```

---

### Task 7: Convert `stakeholders-panel` to `SortResizeTh`

**Files:**
- Modify: `src/app/stakeholders-panel.tsx`
- Test: `src/app/stakeholders-panel.test.tsx`

Five sortable columns: `name`, `organization`, `category`, `influence`, `interest`. Same `pf`
(`usePanelFilters`) shape as Task 6, same `toggleSort`/`sortArrow`/`ariaSort` helpers.

- [ ] **Step 1: Write the failing test**

```tsx
it("announces sort state through aria-sort across the full asc/desc/none cycle", async () => {
  // Use the file's existing helper and its existing two-stakeholder fixture.
  renderStakeholders({ stakeholders: twoStakeholders });
  const btn = screen.getByRole("button", { name: /^organization$/i });
  expect(screen.getByRole("columnheader", { name: /organization/i })).toHaveAttribute("aria-sort", "none");
  await userEvent.click(btn);
  expect(screen.getByRole("columnheader", { name: /organization/i })).toHaveAttribute("aria-sort", "ascending");
  await userEvent.click(screen.getByRole("button", { name: /^organization$/i }));
  expect(screen.getByRole("columnheader", { name: /organization/i })).toHaveAttribute("aria-sort", "descending");
  await userEvent.click(screen.getByRole("button", { name: /^organization$/i }));
  expect(screen.getByRole("columnheader", { name: /organization/i })).toHaveAttribute("aria-sort", "none");
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
npx vitest run src/app/stakeholders-panel.test.tsx -t "aria-sort" > /tmp/t7.log 2>&1; echo "EXIT=$?"
grep -E "Tests |FAIL" /tmp/t7.log
```

Expected: FAIL on the anchored button name — today the glyph is inside it.

- [ ] **Step 3: Bind the props once**

```tsx
const th = useSortHeaderProps<StakeholderSortKey>(
  (pf.sort?.key ?? null) as StakeholderSortKey | null,
  pf.sort?.dir ?? "off",
  toggleSort,
  startResize,
);
```

`StakeholderSortKey` is already imported from `./stakeholders`. Import `useSortHeaderProps` from
`./report-table`.

- [ ] **Step 4: Replace the five headers**

Each becomes `<SortResizeTh {...th} label={<the same t(lang, ...) call>} sortCol="<key>" width={colWidths.<key>} />`,
preserving any `{!hiddenSet.has(...)}` wrapper. Delete the now-unused `sortArrow` / `ariaSort`
helpers and any import left without a user.

- [ ] **Step 5: Run tests and typecheck**

```bash
npx vitest run src/app/stakeholders-panel.test.tsx > /tmp/t7.log 2>&1; echo "EXIT=$?"
grep -E "Tests |FAIL" /tmp/t7.log
npx tsc --noEmit; echo "TSC_EXIT=$?"
npx eslint src/app/stakeholders-panel.tsx; echo "LINT_EXIT=$?"
```

- [ ] **Step 6: Commit**

```bash
git add src/app/stakeholders-panel.tsx src/app/stakeholders-panel.test.tsx
git commit -m "refactor(stakeholders): fold the header trio into SortResizeTh

Five hand-rolled headers adopt the shared primitive. The sort glyph leaves
the button's accessible name, where it duplicated the aria-sort the th
already carries."
```

---

### Task 8: Convert `raid-panel-rows` to `SortResizeTh`

**Files:**
- Modify: `src/app/raid-panel-rows.tsx`
- Test: `src/app/raid-panel.test.tsx`

Seven sortable columns: `id`, `category`, `title`, `severity`, `status`, `owner`, `targetDate`.
Depends on Task 5 having replaced `SortState` with `PanelSort`.

★★ **`raid-panel-rows.tsx` has no test file of its own.** The only file matching
`grep -rln raid-panel-rows src/app --include="*.test.tsx"` is `report-table.test.tsx`, and that is a
comment, not coverage. This component is exercised through `src/app/raid-panel.test.tsx`, whose
helper is `renderPanel(props: RaidPanelProps)` — put the new test there rather than creating a
second harness for one assertion.

- [ ] **Step 1: Write the failing test**

Add to `src/app/raid-panel.test.tsx`:

```tsx
it("announces sort state through aria-sort on every sortable header", async () => {
  renderPanel(baseProps);        // the file's existing helper + its RaidPanelProps fixture
  const btn = screen.getByRole("button", { name: /^severity$/i });
  expect(screen.getByRole("columnheader", { name: /severity/i })).toHaveAttribute("aria-sort", "none");
  await userEvent.click(btn);
  expect(screen.getByRole("columnheader", { name: /severity/i })).toHaveAttribute("aria-sort", "ascending");
});
```

- [ ] **Step 2: Run it and confirm it fails**

```bash
npx vitest run src/app/raid-panel.test.tsx -t "aria-sort" > /tmp/t8.log 2>&1; echo "EXIT=$?"
grep -E "Tests |FAIL" /tmp/t8.log
```

- [ ] **Step 3: Bind and replace**

`raid-panel-rows` receives `sort` as a **prop** (`sort: PanelSort`), not from a context hook, so
bind from the prop:

```tsx
const th = useSortHeaderProps<RaidSortKey>(
  (sort?.key ?? null) as RaidSortKey | null,
  sort?.dir ?? "off",
  toggleSort,
  startResize,
);
```

`RaidSortKey` is already imported from `./raid`. Replace all seven headers as in Task 6 and delete
the helpers and imports left unused.

- [ ] **Step 4: Run tests and typecheck**

```bash
npx vitest run src/app/raid-panel.test.tsx > /tmp/t8.log 2>&1; echo "EXIT=$?"
grep -E "Tests |FAIL" /tmp/t8.log
npx tsc --noEmit; echo "TSC_EXIT=$?"
npx eslint src/app/raid-panel-rows.tsx; echo "LINT_EXIT=$?"
```

- [ ] **Step 5: Commit**

```bash
git add src/app/raid-panel-rows.tsx src/app/raid-panel.test.tsx
git commit -m "refactor(raid): fold the header trio into SortResizeTh

Seven hand-rolled headers adopt the shared primitive and its aria-sort."
```

---

### Task 9: Convert `resource-directory` to `SortResizeTh`

**Files:**
- Modify: `src/app/resource-directory.tsx`
- Test: `src/app/resource-directory.test.tsx`

Seven columns: `name`, `role`, `title`, `department`, `phone`, `email`, `birthday`. **This file has
zero `aria-sort` today** — it is one of the two the slice exists for. Split state
(`sortKey: SortKey` where `""` means unsorted, `sortDir: "asc" | "desc"`).

- [ ] **Step 1: Write the failing test**

```tsx
it("announces sort state through aria-sort, which it did not carry at all before", async () => {
  // This file has no helper: it renders inline against the `common` props
  // object and the `twoResources` fixture it already defines.
  render(<ResourceDirectory {...common} resources={twoResources} />);
  // Unsorted on mount: sortKey is "" and matches no column.
  for (const th of screen.getAllByRole("columnheader")) {
    expect(th).toHaveAttribute("aria-sort", "none");
  }
  await userEvent.click(screen.getByRole("button", { name: /^department$/i }));
  expect(screen.getByRole("columnheader", { name: /department/i })).toHaveAttribute("aria-sort", "ascending");
  await userEvent.click(screen.getByRole("button", { name: /^department$/i }));
  expect(screen.getByRole("columnheader", { name: /department/i })).toHaveAttribute("aria-sort", "descending");
});
```

★ The bulk-select header is a `<th>` with no `aria-sort`. If the "every columnheader" loop fails on
it, scope the loop to the sortable headers by name rather than deleting the assertion — the point
is that no sortable column claims a sort it does not have.

- [ ] **Step 2: Run it and confirm it fails**

```bash
npx vitest run src/app/resource-directory.test.tsx -t "aria-sort" > /tmp/t9.log 2>&1; echo "EXIT=$?"
grep -E "Tests |FAIL" /tmp/t9.log
```

Expected: FAIL — there is no `aria-sort` anywhere in this file today.

- [ ] **Step 3: Bind the props**

Split state needs no null-coalescing and no cast: `sortDir` is `"asc" | "desc"`, already a subtype
of `SortDir`, and `sortKey` is already the union.

```tsx
const th = useSortHeaderProps<SortKey>(sortKey, sortDir, toggleSort, startColResize);
```

- [ ] **Step 4: Replace the seven headers**

```tsx
<th className="relative px-3 py-2 font-medium" style={{ width: colWidths.name, minWidth: colWidths.name }}>
  <button type="button" onClick={() => toggleSort("name")} aria-label={t(lang, "sortBy", t(lang, "assignee"))} title={t(lang, "sortBy", t(lang, "assignee"))} className={`hover:text-ui-green ${INTERACTIVE}`}>
    {t(lang, "assignee")}{sortIndicator("name")}
  </button>
  <ColumnResizeHandle col="name" onMouseDown={startColResize} />
</th>
```

becomes

```tsx
<SortResizeTh {...th} label={t(lang, "assignee")} sortCol="name" width={colWidths.name} title={t(lang, "sortBy", t(lang, "assignee"))} />
```

★ **The accessible name changes on purpose.** It was `Sort by Assignee` (via `aria-label`) and
becomes `Assignee` — the visible text. Both satisfy WCAG 2.5.3, which is **containment, not
prefix**; keeping the "Sort by" wording in `title` preserves it on hover. Do not re-add an
`aria-label`: it would take precedence and re-introduce a name that differs from the visible label.

The remaining six follow the same pattern with `label` = the `t(lang, ...)` already rendered,
`sortCol` = the key passed to `toggleSort`, `width` = `colWidths.<col>`, and `title` = the same
`t(lang, "sortBy", ...)` call.

Delete `sortIndicator` and any import left unused.

- [ ] **Step 5: Run tests and typecheck**

```bash
npx vitest run src/app/resource-directory.test.tsx > /tmp/t9.log 2>&1; echo "EXIT=$?"
grep -E "Tests |FAIL" /tmp/t9.log
npx tsc --noEmit; echo "TSC_EXIT=$?"
npx eslint src/app/resource-directory.tsx; echo "LINT_EXIT=$?"
```

- [ ] **Step 6: Commit**

```bash
git add src/app/resource-directory.tsx src/app/resource-directory.test.tsx
git commit -m "refactor(resources): give the directory headers a real aria-sort

This table announced its sort state nowhere: seven hand-rolled headers, zero
aria-sort attributes, the glyph carried only inside each button's name. axe
has no rule for a missing aria-sort, so nothing flagged it.

The accessible name moves from 'Sort by X' to the visible 'X', with the
former kept as a title. Both satisfy 2.5.3 - containment, not prefix."
```

---

### Task 10: Convert `roles-editor` to `SortResizeTh`

**Files:**
- Modify: `src/app/roles-editor.tsx`
- Test: `src/app/roles-editor.test.tsx`

Four sortable columns: `discipline`, `grade`, `internal`, `external`. **Two further headers
(`internalDay`, `externalDay`) are not sortable — leave them as raw `<th>`.**

Three shape notes specific to this file:

- Headers are **not resizable** (fixed `ROLES_COL_WIDTHS`). Omit `onResize`; no grip is rendered.
- Each sortable header wraps `<button>` + `<InfoTooltip>` in
  `<span className="inline-flex items-center gap-1">`. `SortHeaderButton` renders **exactly** that
  structure when given `hint`, so the hand-rolled span disappears into the `hint` prop.
- `internal` and `external` are right-aligned → `align="right"`.

- [ ] **Step 1: Write the failing test**

```tsx
it("announces sort state through aria-sort and keeps each column's hint", async () => {
  renderEditor();                // the file's existing helper (currency defaults to "EUR")
  expect(screen.getByRole("columnheader", { name: /discipline/i })).toHaveAttribute("aria-sort", "none");
  await userEvent.click(screen.getByRole("button", { name: /^discipline$/i }));
  expect(screen.getByRole("columnheader", { name: /discipline/i })).toHaveAttribute("aria-sort", "ascending");
  await userEvent.click(screen.getByRole("button", { name: /^discipline$/i }));
  expect(screen.getByRole("columnheader", { name: /discipline/i })).toHaveAttribute("aria-sort", "descending");
});

it("renders no resize grip - these columns are fixed width", () => {
  const { container } = renderEditor();
  expect(container.querySelector(".cursor-col-resize")).toBeNull();
});
```

- [ ] **Step 2: Run and confirm failure**

```bash
npx vitest run src/app/roles-editor.test.tsx -t "aria-sort" > /tmp/t10.log 2>&1; echo "EXIT=$?"
grep -E "Tests |FAIL" /tmp/t10.log
```

- [ ] **Step 3: Bind and replace**

```tsx
const th = useSortHeaderProps<SortKey>(sort?.key ?? null, sort?.dir ?? "off", toggleSort);
```

★ No cast here: this file's `sort` is `{ key: SortKey; dir: "asc" | "desc" } | null` — already
typed with its own union, unlike the `PanelSort` panels.

★ Its `toggleSort` never produces `null` after the first click, so `"off"` only ever appears before
any column has been clicked. That is correct and needs no extra handling.

Replace the four sortable headers:

```tsx
<SortResizeTh {...th} label={t(lang, "rolesDiscipline")} sortCol="discipline" width={ROLES_COL_WIDTHS.discipline} hint={t(lang, "rolesDisciplineHint")} />
<SortResizeTh {...th} label={t(lang, "rolesGrade")} sortCol="grade" width={ROLES_COL_WIDTHS.grade} hint={t(lang, "rolesGradeHint")} />
<SortResizeTh {...th} label={t(lang, "rolesInternalRate")} sortCol="internal" width={ROLES_COL_WIDTHS.internal} align="right" hint={t(lang, "rolesInternalRateHint")} />
<SortResizeTh {...th} label={t(lang, "rolesExternalRate")} sortCol="external" width={ROLES_COL_WIDTHS.external} align="right" hint={t(lang, "rolesExternalRateHint")} />
```

★ Hover colour changes here, deliberately: these buttons hover `text-ui-green` while the primitive
hovers to the shared `--table-head-accent` token. This normalises them onto the same token every
other sortable header in the app uses.

- [ ] **Step 4: Run tests and typecheck**

```bash
npx vitest run src/app/roles-editor.test.tsx > /tmp/t10.log 2>&1; echo "EXIT=$?"
grep -E "Tests |FAIL" /tmp/t10.log
npx tsc --noEmit; echo "TSC_EXIT=$?"
npx eslint src/app/roles-editor.tsx; echo "LINT_EXIT=$?"
```

- [ ] **Step 5: Commit**

```bash
git add src/app/roles-editor.tsx src/app/roles-editor.test.tsx
git commit -m "refactor(roles): fold the sortable headers into SortResizeTh

Four sortable headers adopt the primitive; the two rate-per-day columns stay
raw, since they do not sort. The hand-rolled span wrapping button and
InfoTooltip is exactly what the primitive's hint prop renders, so it goes.

Hover normalises from text-ui-green to the shared table-head accent token."
```

---

### Task 11: Convert `activity-log-panel` to `SortResizeTh`

**Files:**
- Modify: `src/app/activity-log-panel.tsx`
- Test: `src/app/activity-log-panel.test.tsx`

Three sortable columns today: `timestamp`, `kind`, `message`. **This file has zero real `aria-sort`**
— its two matches are prose inside a JSX comment. Split state, `SortKey` has no unsorted member and
`sortDir` is `"asc" | "desc"`.

- [ ] **Step 1: Write the failing test**

```tsx
it("announces sort state through aria-sort, which it did not carry at all before", async () => {
  // The file's helper wraps in DisplayTimezoneProvider: renderPanel(ui: React.ReactNode).
  renderPanel(<ActivityLogPanel lang="en-US" entries={[entry({ id: "1" }), entry({ id: "2" })]} />);
  // The panel mounts sorted by "when", descending.
  const whenLabel = t("en-US", "activityHeaderWhen");
  expect(screen.getByRole("columnheader", { name: whenLabel })).toHaveAttribute("aria-sort", "descending");
  await userEvent.click(screen.getByRole("button", { name: t("en-US", "activityHeaderKind") }));
  expect(screen.getByRole("columnheader", { name: t("en-US", "activityHeaderKind") }))
    .toHaveAttribute("aria-sort", "ascending");
});
```

★ The four header keys are `activityHeaderWhen`, `activityHeaderKind`, `activityHeaderActor` and
`activityHeaderMessage`, rendered in that order. There is no `activityHeaderTimestamp`. Match the
props on `ActivityLogPanel`'s real signature and reuse the file's own `entry()` fixture builder.

- [ ] **Step 2: Run and confirm failure**

```bash
npx vitest run src/app/activity-log-panel.test.tsx -t "aria-sort" > /tmp/t11.log 2>&1; echo "EXIT=$?"
grep -E "Tests |FAIL" /tmp/t11.log
```

- [ ] **Step 3: Bind and replace**

```tsx
const th = useSortHeaderProps<SortKey>(sortKey, sortDir, toggleSort, startResize);
```

Replace the three sortable headers with `<SortResizeTh {...th} label={...} sortCol="..." width={colWidths.<col>} />`,
keeping each existing `t(lang, ...)` label.

★ **`"off"` is unreachable in this panel** — `SortKey` has no unsorted member, so some column is
always sorted. The binding above is still correct for it; do not add a branch for a state that
cannot occur.

★★ **Do not touch the comparator.** This file carries a guard for a comparator that **threw on
first render** under the default `timestamp` sort with two or more entries. It is a load path, not
a header concern.

Delete `sortIndicator` and now-unused imports. **Delete the JSX comment that says these headers
have no `aria-sort`** — it is about to become false, and a stale comment here is exactly what made
the earlier `grep -c aria-sort` reading of this file wrong.

- [ ] **Step 4: Run tests and typecheck**

```bash
npx vitest run src/app/activity-log-panel.test.tsx > /tmp/t11.log 2>&1; echo "EXIT=$?"
grep -E "Tests |FAIL" /tmp/t11.log
npx tsc --noEmit; echo "TSC_EXIT=$?"
```

- [ ] **Step 5: Commit**

```bash
git add src/app/activity-log-panel.tsx src/app/activity-log-panel.test.tsx
git commit -m "refactor(activity): give the log headers a real aria-sort

Three hand-rolled headers adopt SortResizeTh. This file carried no aria-sort
at all - the only two matches for the string were prose in a comment saying
so, which is why a grep of it read as covered.

Drops that comment, now that it is false."
```

---

### Task 12: Make the activity log's actor column sortable

**Files:**
- Modify: `src/app/activity-log-panel.tsx`
- Test: `src/app/activity-log-panel.test.tsx`

The `actor` header is deliberately non-sortable, and its comment says why: a fourth hand-rolled sort
button would deepen the `aria-sort` debt, and folding the table into `SortResizeTh` is the named
follow-up. Task 11 did that, so the reason is gone.

- [ ] **Step 1: Write the failing test**

```tsx
it("sorts by actor", async () => {
  // Header order is When, Kind, Actor, Message - so the actor cell is td index 2.
  renderPanel(
    <ActivityLogPanel
      lang="en-US"
      entries={[entry({ id: "1", actor: "zoe" }), entry({ id: "2", actor: "alice" })]}
    />,
  );
  const actorLabel = t("en-US", "activityHeaderActor");
  await userEvent.click(screen.getByRole("button", { name: actorLabel }));
  expect(screen.getByRole("columnheader", { name: actorLabel }))
    .toHaveAttribute("aria-sort", "ascending");
  const firstRowCells = screen.getAllByRole("row")[1].querySelectorAll("td");
  expect(firstRowCells[2]?.textContent).toContain("alice");
});
```

★ Confirm `actor` is the real field name on `ActivityEntry` before writing the fixture — the
`entry()` builder takes a `Partial<ActivityEntry>`, so a misspelled key is silently ignored and the
seed would be two identical rows, which sorts green either way.

★ The row assertion is the load-bearing half. A test asserting only `aria-sort` passes with the
comparator branch missing entirely — the header would announce a sort that never happened.

- [ ] **Step 2: Run and confirm failure**

```bash
npx vitest run src/app/activity-log-panel.test.tsx -t "sorts by actor" > /tmp/t12.log 2>&1; echo "EXIT=$?"
grep -E "Tests |FAIL" /tmp/t12.log
```

Expected: FAIL — there is no actor sort button.

- [ ] **Step 3: Implement**

Add `"actor"` to the `SortKey` union, add its branch to the existing comparator `useMemo` beside the
`kind` branch, and convert the actor `<th>` to
`<SortResizeTh {...th} label={t(lang, "activityHeaderActor")} sortCol="actor" width={colWidths.actor} />`
— reading the real label key off the file.

★ Use the same defensive read the neighbouring branches use. The comment above them records that a
raw `.localeCompare` on a non-string field is what threw on first render.

- [ ] **Step 4: Run and typecheck**

```bash
npx vitest run src/app/activity-log-panel.test.tsx > /tmp/t12.log 2>&1; echo "EXIT=$?"
grep -E "Tests |FAIL" /tmp/t12.log
npx tsc --noEmit; echo "TSC_EXIT=$?"
```

- [ ] **Step 5: Commit**

```bash
git add src/app/activity-log-panel.tsx src/app/activity-log-panel.test.tsx
git commit -m "feat(activity): let the log sort by actor

This column was deliberately left unsortable because a fourth hand-rolled
sort button would have deepened the aria-sort debt, with folding the table
into SortResizeTh named as the prerequisite. That is now done."
```

---

### Task 13: `tasks-section` adopts `ColumnConfigPopover`

**Files:**
- Modify: `src/app/tasks-section.tsx`
- Test: `src/app/tasks-section.test.tsx`

The primitive's own docstring says *"Mirrors the tasks-view column manager"* — it was extracted from
here and this call site never adopted it.

- [ ] **Step 1: Write the failing test**

```tsx
it("renders the column checklist through the shared popover, portaled out of the toolbar", async () => {
  // tasks-section.test.tsx defines renderTable(over: Partial<TasksSectionProps>)
  // inside its table describe block - add this test there so the helper is in scope.
  renderTable();
  await userEvent.click(screen.getByRole("button", { name: /column/i }));
  const dialog = screen.getByRole("dialog", { name: /column/i });
  // PopoverPanel portals to <body>; the hand-rolled copy rendered inside the toolbar.
  expect(dialog.closest("table")).toBeNull();
  const box = within(dialog).getAllByRole("checkbox")[0];
  expect(box).toBeInTheDocument();
  await userEvent.click(box);
  expect(box).not.toBeChecked();
});
```

Import `within` from `@testing-library/react`.

- [ ] **Step 2: Run and confirm failure**

```bash
npx vitest run src/app/tasks-section.test.tsx -t "shared popover" > /tmp/t13.log 2>&1; echo "EXIT=$?"
grep -E "Tests |FAIL" /tmp/t13.log
```

- [ ] **Step 3: Replace the inline block**

Delete the whole `<div ref={colConfigRef} className="relative">…</div>` group — trigger button,
`{colConfigOpen && (<div role="dialog" …>)}` panel, `<ul>` of `CONFIGURABLE_COLS` and its raw
checkboxes — and put in its place:

```tsx
<ColumnConfigPopover
  lang={lang}
  cols={CONFIGURABLE_COLS}
  hidden={hiddenCols}
  onToggle={(key) =>
    setHiddenCols((prev) => {
      const next = new Set(prev);
      if (next.has(key)) { next.delete(key); } else { next.add(key); }
      return next;
    })
  }
/>
```

Import `ColumnConfigPopover` from `./column-config-popover`.

★ `CONFIGURABLE_COLS` must satisfy `readonly ColumnConfigCol[]` — `{ key: string; labelKey: TranslationKey }`.
If its element type differs, adapt at this call site; do not loosen `ColumnConfigCol`.

Remove `colConfigOpen`, `setColConfigOpen` and `colConfigRef` from this component's props and from
`TasksSectionProps`. Remove imports left without a user (`Cog6ToothIcon` if nothing else uses it).

- [ ] **Step 4: Run and typecheck**

```bash
npx vitest run src/app/tasks-section.test.tsx > /tmp/t13.log 2>&1; echo "EXIT=$?"
grep -E "Tests |FAIL" /tmp/t13.log
npx tsc --noEmit; echo "TSC_EXIT=$?"
```

Expected: `tsc` now reports `task-manager.tsx` passing three props that no longer exist. That is
Task 14; it is the intended breakage.

- [ ] **Step 5: Commit**

```bash
git add src/app/tasks-section.tsx src/app/tasks-section.test.tsx
git commit -m "refactor(tasks): adopt ColumnConfigPopover for the column manager

The primitive's docstring says it mirrors the tasks-view column manager: it
was extracted from here and this call site was never converted, so four
panels used it and the original did not.

Three real divergences go with it. The inline copy rendered absolute inside
the toolbar and was subject to its overflow clip, where PopoverPanel portals
to body; it used a raw checkbox input rather than the Checkbox primitive;
and it hovered to text-muted-foreground, so hovering did nothing."
```

---

### Task 14: Drop the column-config plumbing

**Files:**
- Modify: `src/app/task-manager.tsx`, `src/app/use-column-manager.ts`

`ColumnConfigPopover` owns its own open state, so the three values that plumbed the old inline copy
now have no consumer.

- [ ] **Step 1: Remove from `use-column-manager.ts`**

Delete from the return type and the returned object: `colConfigOpen`, `setColConfigOpen`,
`colConfigRef`. Delete the three lines that create them and the `usePopoverDismiss(colConfigOpen, colConfigRef, closeColConfig)`
call plus `closeColConfig`. Remove the `usePopoverDismiss` and `useRef` imports if nothing else in
the file uses them.

★ **Keep `hiddenCols` and `setHiddenCols`.** They are the persisted state, they have other
consumers, and the `v1`/`v2` localStorage migration hangs off them.

- [ ] **Step 2: Remove from `task-manager.tsx`**

Delete the three names from the `useColumnManager()` destructure and the three
`colConfigOpen={...}` / `setColConfigOpen={...}` / `colConfigRef={...}` props passed to the tasks
section.

- [ ] **Step 3: Typecheck and run the full suite**

```bash
npx tsc --noEmit; echo "TSC_EXIT=$?"
npm run test:run > /tmp/t14.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " /tmp/t14.log
```

Expected: `TSC_EXIT=0`, suite green.

- [ ] **Step 4: Confirm both zero-headroom files shrank**

```bash
for f in src/app/tasks-section.tsx src/app/task-manager.tsx; do
  node -e "console.log(require('fs').readFileSync('$f','utf8').split('\n').length, '$f')"
done
grep -oE '"src/app/(tasks-section|task-manager)\.tsx": [0-9]+' docs/baselines/file-sizes.json
```

Both must now read **below** their baselines (1081 and 3020). The gate metric is `wc -l` + 1, which
is what the node command reports.

- [ ] **Step 4b: Apply the sort-header bag to `tasks-section.tsx` — the Task 4 work deferred to here**

★★★ **This is the one piece of Task 4 that was NOT done, and it is easy to lose between tasks.**
`tasks-section.tsx` holds 11 `<SortResizeTh>` call sites and was excluded from Task 4 because all
eleven are single-line JSX: removing four props shortens each line but deletes none, so the bag is
pure addition — the file went 1081 → 1082 against a zero-headroom baseline and `size:check` failed.
Tasks 13–14 have now removed roughly 40 lines from this same file, so the headroom exists.

★ Do NOT restore a parked snapshot — Task 13 rewrote a different region of this file, so any
pre-Task-13 copy is stale. Re-run the transform fresh.

The shape is the simple one: a single bag built from the file's split state and its hoisted
`toggleSort`, placed with the other `const` declarations; spread `{...th}` FIRST on all eleven
sites; every per-column prop preserved. Read the file for the real local names.

```bash
node -e "console.log(require('fs').readFileSync('src/app/tasks-section.tsx','utf8').split('\n').length)"
npx vitest run src/app/tasks-section.test.tsx > /tmp/t14b.log 2>&1; echo "EXIT=$?"
grep -E "Tests |FAIL" /tmp/t14b.log
npx tsc --noEmit; echo "TSC_EXIT=$?"
npm run size:check > /tmp/size14b.log 2>&1; echo "SIZE_EXIT=$?"; tail -5 /tmp/size14b.log
```

`SIZE_EXIT` must be 0. If it is not, the headroom from Tasks 13–14 did not materialise — report
that rather than bumping the baseline or deleting a blank line to squeeze under the gate.

- [ ] **Step 5: Commit**

```bash
git add src/app/task-manager.tsx src/app/use-column-manager.ts
git commit -m "refactor: drop the column-config plumbing the primitive replaced

ColumnConfigPopover owns its own open state, so colConfigOpen, its setter and
colConfigRef no longer have a consumer: they leave TasksSectionProps,
task-manager's threading and useColumnManager's return, along with the
usePopoverDismiss call that served them.

hiddenCols stays - it is the persisted state, and the v1/v2 localStorage
migration hangs off it."
```

---

### Task 15: Full gate sweep and eye-verify

**Files:** none modified unless a gate fails.

- [ ] **Step 1: Run every fast gate, unpiped**

```bash
npx tsc --noEmit; echo "TSC_EXIT=$?"
npx eslint src/app; echo "LINT_EXIT=$?"
npm run test:run > /tmp/suite.log 2>&1; echo "TEST_EXIT=$?"; grep -E "Test Files|Tests " /tmp/suite.log
npm run size:check > /tmp/size.log 2>&1; echo "SIZE_EXIT=$?"; tail -5 /tmp/size.log
npm run dup:check > /tmp/dup.log 2>&1; echo "DUP_EXIT=$?"; grep -E "Total:|Found" /tmp/dup.log
npm run docs:symbols:check > /tmp/sym.log 2>&1; echo "SYM_EXIT=$?"
npm run docs:claims:check > /tmp/claims.log 2>&1; echo "CLAIMS_EXIT=$?"; tail -3 /tmp/claims.log
```

All must be 0. `dup:check` must stay under the 1.75 threshold; it reads ~1.20% after Task 3, up from 1.18% (see Task 3 Step 4).

- [ ] **Step 1b: Retrofit the swapped-`sortCol` test to the two panels converted without it**

★★ `change-panel` (Task 6) and `stakeholders-panel` (Task 7) were converted BEFORE the
swapped-`sortCol` detector was designed, so between them 10 of 12 columns have no coverage of
their own `label`/`sortCol` wiring. Every later conversion carries the test; these two do not.

Add it to `src/app/change-panel.test.tsx` (7 columns) and `src/app/stakeholders-panel.test.tsx`
(5 columns), in the shape the design document's Testing section specifies: click each column's
button, assert exactly ONE header reports a non-`none` `aria-sort`, and assert it is that
column's own header. Preserve each file's existing interaction style.

**Mutation-prove both** by moving one real column's key onto another header and confirming the
test reddens — a swap detector that cannot see a swap is worse than none, because it reads as
coverage.

```bash
npx vitest run src/app/change-panel.test.tsx src/app/stakeholders-panel.test.tsx > /tmp/t15b.log 2>&1; echo "EXIT=$?"
grep -E "Tests |FAIL" /tmp/t15b.log
npx tsc --noEmit; echo "TSC_EXIT=$?"
```

- [ ] **Step 2: Run the shuffled suite**

New tests were added, so this is the only local reproduction of the `unit-tests-shuffled` gate:

```bash
npm run test:shuffle > /tmp/shuffle.log 2>&1; echo "SHUFFLE_EXIT=$?"; grep -E "Test Files|Tests " /tmp/shuffle.log
```

- [ ] **Step 3: Run axe over the affected views**

Four converted panels sit in scanned views (`change-panel`, `stakeholders-panel`,
`raid-panel-rows`, `resource-directory` via Resources, plus Reports). **`--workers=1` is mandatory
for a multi-view run** — local defaults to CPU count while CI runs serially, and the contention
failure prints as a 60s timeout with no violation text, which reads like a real failure.

```bash
npx playwright test e2e/a11y.spec.ts --project=chromium --workers=1 -g "Changes|Stakeholders|RAID|Resources|Reports|Activity|Open Points" > /tmp/axe.log 2>&1; echo "AXE_EXIT=$?"
grep -E "passed|failed" /tmp/axe.log
```

★ If it reddens, read the failure **body**, not the summary line. A real violation names a rule id
and an impact; a contention timeout names neither.

- [ ] **Step 4: Eye-verify every visible change the conversions made**

★★ The list below was assembled from what each conversion actually MEASURED, not from what this
plan predicted. jsdom has no layout and these panels carry no visual baseline, so **nothing in the
unit suite or the axe gate can see any of it.** The cascades are settled; what needs eyes is
whether each surface still reads right.

| surface | change |
|---|---|
| Changes, Stakeholders, RAID | header row weight: converted headers emit `font-medium` (500) while an unstyled `<th>` keeps the UA `bold` (700) — raw cells in those rows were given `font-medium` so the row stays uniform |
| Stakeholders, Resources directory, Roles, Activity | hover moves `text-ui-green` → `--table-head-accent` |
| all six | the ACTIVE column is now tinted in the accent token; none of the six did this before |
| all six | sort glyph `▲`/`▼` → `↑`/`↓`, and it leaves the accessible name (stays visible, now `aria-hidden`) |
| Activity log | the three sort labels lose `uppercase tracking-wide` and render normal-case; the raw actor cell had the same classes dropped so the row does not split. These were the LAST uppercase `<th>` labels in the app |
| Changes, RAID | the `#` column's accessible name changes from `ID` to `#`, with `ID` moved to `title` (hover-only) |
| Resources directory | every header's accessible name changes from `Sort by X` to `X`, with `Sort by X` kept as `title` |

★ Resources → **Calendar** and the Roles rate-card are NOT axe-scanned (Resources defaults to the
directory), so those two surfaces have never been scanned and are not covered by Step 3 either.

`change-panel`, `stakeholders-panel` and `raid-panel-rows` render their `<th>` without
`font-medium` today, and `SortResizeTh` always emits it. **No test in this repo can see this** —
jsdom has no layout and these panels have no visual baseline.

```bash
PORT=3100 npm run dev
```

Open Changes, Stakeholders and RAID. Confirm the header row is legible and consistent with the
report panels (which have always been `font-medium`). Then:

```bash
PORT=3100 npm run stop
```

If the heavier weight looks wrong, the fix is a decision to make explicitly — either accept it, or
add an opt-out prop to the primitive. **Do not silently re-add a hand-rolled `<th>`.**

- [ ] **Step 5: Verify no mutants or scratch files survive**

```bash
git status --porcelain -uall
git diff origin/main --stat | tail -3
```

The diff must contain only the files this plan names.

- [ ] **Step 6: Commit any gate fixes**

If nothing needed fixing, there is nothing to commit and this step is a no-op. Record the gate
results in the final report rather than inventing a commit.

---

### Task 16: Bump the patch version to 0.255.2

**Files:**
- Modify: `src/app/version.ts`, `package.json`, `package-lock.json`, `README.md`,
  `docs/CODEMAPS/architecture.md`, `docs/CODEMAPS/backend.md`, `docs/CODEMAPS/data.md`,
  `docs/CODEMAPS/dependencies.md`, `docs/CODEMAPS/frontend.md`, `CHANGELOG.md`

Refactor-only normally carries no bump; this one was requested explicitly.

★★ **0.255.2, not 0.256.0.** The unshipped `feat/documents-s3c2-ooxml-media` branch has already
claimed `0.256.0 "Khaw"`. A patch keeps the minor-series milestone, exactly as 0.255.1 kept
"Bisson" from 0.255.0.

★★ **No `versionHighlight*` key, and therefore no i18n edit.** 0.255.1 added none either.
`version-highlights.test.ts` reads like a release-bump guard and its own comment says it is not —
`at(-1)` is pinned to the literal `"versionHighlightIconSet"`, so bumping without adding a
highlight leaves it green. Adding one would both redden that test and put this branch into
`i18n.ts`, the one file that conflicts with S3c-2.

- [ ] **Step 1: Confirm all eight sites currently agree**

They were verified consistent at `0.255.1` on 2026-08-23, but drift is the normal state here — this
file's own history records `package.json` stuck six releases behind and `package-lock.json` eleven.

```bash
grep -nE "APP_VERSION =|APP_BUILD_DATE =|APP_MILESTONE =" src/app/version.ts
grep -n '"version"' package.json | head -1
grep -n '"version": "0\.' package-lock.json | head -2
grep -n "badge/version" README.md
grep -h -oE 'App [0-9.]+ "[A-Za-z]+"' docs/CODEMAPS/*.md
```

Every one must read `0.255.1` / `Bisson`. If any disagrees, fix it to 0.255.1 in a separate commit
first, so the bump commit stays readable.

- [ ] **Step 2: Edit all eight**

- `src/app/version.ts`: `APP_VERSION` to `"0.255.2"`; `APP_BUILD_DATE` to the real build date with
  its trailing comment rewritten to `// 0.255.2: shared-primitive adoption (Bisson)`.
  **Leave `APP_MILESTONE` at `"Bisson"`** — the codename tracks the minor series.
- `package.json`: the top-level `"version"`.
- `package-lock.json`: **both** occurrences — the root `"version"` and the one under `packages[""]`.
  The third match (`0.21.2`) is a dependency; do not touch it.
- `README.md`: the shields badge, which encodes version **and** codename —
  `version-v0.255.2_%22Bisson%22-2e7d32`.
- All five `docs/CODEMAPS/*.md` `Generated:` headers: version only, codename unchanged.

- [ ] **Step 3: Add the CHANGELOG entry**

Insert above the `## [0.255.1]` heading, matching the existing style (prose entries, not bullets of
file names):

```markdown
## [0.255.2] - 2026-08-23 "Bisson"

### Changed
- **Six data tables now announce their sort state properly.** The changes, stakeholders, RAID, activity-log, resource-directory and roles tables each hand-rolled their own sortable header instead of using the shared one. Two of them — the activity log and the resource directory — announced their sort order nowhere at all, so a screen-reader user could not tell which column a table was sorted by; the other four repeated it inside the button's name, where it was read out twice. All six now carry a real `aria-sort`.
- The tasks view's column-configuration popover was a copy of the shared one it had been extracted from, and had drifted: it was clipped by its own toolbar rather than floating above it, and its gear button's hover state did nothing.

### Fixed
- The changes table's `#` column announced itself as "ID" while displaying "#", so its spoken name did not contain its visible label (WCAG 2.5.3). It now announces "#", with "ID" available on hover.
- The RAID table typed its sort direction as a free-form string, accepting values that are not directions.
```

★ Do **not** put a `[session link removed]...` URL in `CHANGELOG.md`.

- [ ] **Step 4: Verify nothing else pins the old version**

```bash
grep -rn "0\.255\.1" --include="*.ts" --include="*.tsx" --include="*.json" --include="*.md" . \
  | grep -v node_modules | grep -v "^\./CHANGELOG.md" | grep -v "\.next/"
```

Expected: no hits outside `CHANGELOG.md`'s historical entries. A hit anywhere else is a ninth site
this plan did not know about — record it.

- [ ] **Step 5: Run the gates that read the version**

```bash
npx vitest run src/app/version-highlights.test.ts > /tmp/t16.log 2>&1; echo "EXIT=$?"
grep -E "Tests |FAIL" /tmp/t16.log
npx tsc --noEmit; echo "TSC_EXIT=$?"
```

★ `e2e/a11y.spec.ts` carries a guard asserting the **served** app's `data-app-version` matches this
checkout. If e2e is run after this task against an already-running dev server, that guard fails
because the server predates the bump — restart the server, do not edit the guard.

- [ ] **Step 6: Commit**

```bash
git add src/app/version.ts package.json package-lock.json README.md docs/CODEMAPS/ CHANGELOG.md
git commit -m "chore(release): 0.255.2

Patch bump for the shared-primitive adoption slice. 0.255.2 rather than
0.256.0: the unshipped documents OOXML branch has already claimed 0.256.0
as Khaw. The milestone stays Bisson - the codename tracks the minor series.

No versionHighlight key, matching 0.255.1: version-highlights.test.ts pins
at(-1) to a literal, so adding one would redden it, and it would put this
branch into i18n.ts - the only file that conflicts with the S3c-2 branch."
```

---

## What this plan does NOT do

- **No push and no MR.** The bump in Task 16 prepares a release; it does not perform one. Pushing,
  opening an MR, polling the pipeline and merging on green are separate, explicitly requested steps.
- **No combobox or dialog work.** Both clusters were surveyed and rejected with reasons recorded in
  the design document.
- **No new i18n key.**
- **No file splitting.**
