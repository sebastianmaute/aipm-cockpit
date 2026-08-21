# UI Batch — Five Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship five independent UI fixes — content-fit resource modal, a calendar "Hide externals" toggle beside the Outlook block, a wider Time-bookings customer scope, a fixed Total column + total row in Budget, and a configurable start-window logo.

**Architecture:** Five slices with no shared code except i18n additions and one additive prop on the shared `SortResizeTh` primitive. No persisted `Workspace` field changes anywhere — so no six-write-path chore, no golden-fixture regeneration, no Turso migration. Two settings fields are touched (`branding.startLogo` is new; `calendarIncludeExternals` keeps its existing inverted sense so no migration is needed).

**Tech Stack:** Next.js 16 / React 19 / TypeScript, Tailwind v4, vitest + @testing-library/react, Playwright (axe gate).

**Spec:** `docs/superpowers/specs/2026-08-04-ui-batch-five-fixes-design.md`

---

## File Structure

| File | Slice | Responsibility change |
|---|---|---|
| `src/app/resource-edit-modal.tsx` | 1 | `heightClassName` → auto; `sizeKey` bumped |
| `src/app/edit-modal-chrome.test.tsx` | 1 | guard accepts `h-auto` as well as `h-[Npx]` |
| `src/app/resource-edit-modal.test.tsx` | 1 | new height assertion |
| `src/app/resources-panel.tsx` | 2 | builds `calendarHideExternalToggle` |
| `src/app/resources-panel-toolbar.tsx` | 2 | `CalendarToolbar` takes a toggle node, drops the checkbox |
| `src/app/resources-panel.test.tsx` | 2 | grouping + write-semantics tests |
| `src/app/timelog-customer-scope.tsx` | 3 | width classes only |
| `src/app/report-table.tsx` | 4 | `SortResizeTh` gains optional `stickyLeft` |
| `src/app/report-table.test.tsx` | 4 | `stickyLeft` test |
| `src/app/budget-panel.tsx` | 4 | `TotalsTd`, Total column, total row, sticky leading columns |
| `src/app/budget-panel.test.tsx` | 4 | totals + sticky-offset tests |
| `src/app/settings-types.ts` | 5 | `BrandingConfig.startLogo` + sanitizer arm |
| `src/app/settings-types.test.ts` | 5 | sanitizer tests |
| `src/app/project-empty-state.tsx` | 5 | start logo + harbor-banner default |
| `src/app/project-empty-state.test.tsx` | 5 | default/override tests |
| `src/app/settings-sections/appearance-section.tsx` | 5 | third `BrandingImageInput` row |
| `src/app/i18n.ts`, `src/app/i18n.de.ts` | 2/4/5 | add 4 keys, delete 1 |

---

## Conventions for every task

- **Never read a gate's exit code through a pipe.** Redirect, echo `$?`, then grep the file:
  ```bash
  npx vitest run src/app/foo.test.tsx > /tmp/t.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t.log
  ```
- `npm run lint` does NOT reproduce the CI gate (it has no `--max-warnings`). Use `npx eslint --max-warnings=0 src/app` with **no pipe**. An unused import or variable is FATAL.
- Any test edit requires `npx tsc --noEmit` — `next build` does not typecheck tests and vitest never typechecks.
- `i18n.de.ts` is CRLF and the Edit tool corrupts umlauts there. Patch it with the node scripts given below, which **assert the anchor matched** (an LF-anchored replace on a CRLF file silently no-ops).

---

### Task 1: Resource edit modal — content-fit height

**Files:**
- Modify: `src/app/resource-edit-modal.tsx:133-137`
- Modify: `src/app/edit-modal-chrome.test.tsx:100-119`
- Test: `src/app/resource-edit-modal.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `src/app/resource-edit-modal.test.tsx` (inside the existing top-level `describe`, or as a new `describe` at the end of the file):

```tsx
describe("panel height", () => {
  it("fits its content instead of pinning 620px", () => {
    setup();
    const panel = document.querySelector("[data-modal-panel]") as HTMLElement;
    // h-auto lets the panel shrink to the visible field set; the floor keeps the
    // useResizable drag contract and the cap keeps it inside the viewport.
    expect(panel.className).toContain("h-auto");
    expect(panel.className).toContain("min-h-[280px]");
    expect(panel.className).toContain("max-h-[95vh]");
    expect(panel.className).not.toContain("h-[620px]");
  });

  it("uses a bumped size key so a stored 620px height cannot win", () => {
    // useResizable writes an inline height that beats any class. Without the
    // bump, every user who ever dragged this modal keeps the old fixed height
    // and sees no change at all.
    const src = readFileSync(join(process.cwd(), "src/app", "resource-edit-modal.tsx"), "utf8");
    expect(src).toContain('sizeKey="aipm-cockpit:modal-size:resource-edit-v2"');
  });
});
```

Add these imports at the top of that test file if not already present:

```tsx
import { readFileSync } from "node:fs";
import { join } from "node:path";
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/app/resource-edit-modal.test.tsx > /tmp/t1.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t1.log
```
Expected: FAIL — `h-auto` not found (the panel still says `h-[620px]`).

- [ ] **Step 3: Change the modal**

In `src/app/resource-edit-modal.tsx`, replace:

```tsx
      sizeKey="aipm-cockpit:modal-size:resource-edit"
      widthClassName="w-[560px] min-w-[320px]"
      /* Slightly under the shell's 720px default — ~11 rows in a two-column
         grid, several of them field-visibility gated. */
      heightClassName="h-[620px] min-h-[400px] max-h-[95vh]"
```

with:

```tsx
      /* ★★ KEY BUMPED (`-v2`) WITH THE HEIGHT CHANGE. `useResizable` persists an
         inline height that beats any class, so on the old key every user who had
         ever dragged this modal would keep the fixed 620px and see nothing
         change. Same remedy as the `useResizable` storage-key bump rule. */
      sizeKey="aipm-cockpit:modal-size:resource-edit-v2"
      widthClassName="w-[560px] min-w-[320px]"
      /* Content-fit: the field set here is field-visibility gated, so a pinned
         height opened with dead space under short sets. The panel is
         flex-col + overflow-hidden and the form is flex-1 min-h-0 overflow-y-auto,
         so it grows to its content and only scrolls once the 95vh cap bites.
         The min-h- floor stays — a drag below it would collapse the panel. */
      heightClassName="h-auto min-h-[280px] max-h-[95vh]"
```

- [ ] **Step 4: Relax the shared guard test**

In `src/app/edit-modal-chrome.test.tsx`, replace the body of the `test.each(NARROW_CONSUMERS)` case (lines ~100-119) after `const rendered = src.slice(shellAt);` with:

```tsx
    // Accepts EITHER a pixel height shorter than the shell's 720px default OR
    // `h-auto` (content-fit). The guard's point is unchanged: no consumer may
    // silently fall back to the 720px default, and every override must carry
    // its own floor and cap because the prop REPLACES all three classes.
    const all = [...rendered.matchAll(/heightClassName="(h-auto|h-\[(\d+)px\])[^"]*"/g)];
    expect(all, `${name} declares no heightClassName on the shell`).toHaveLength(1);

    const [declared, , px] = all[0];
    if (px !== undefined) expect(Number(px)).toBeLessThan(720);
    expect(declared).toContain("max-h-[95vh]");
    expect(declared, `${name} height override has no min-h- floor`).toMatch(/min-h-\[\d+px\]/);
```

- [ ] **Step 5: Run both test files to verify they pass**

```bash
npx vitest run src/app/resource-edit-modal.test.tsx src/app/edit-modal-chrome.test.tsx > /tmp/t1.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t1.log
```
Expected: PASS, all four narrow consumers still graded.

- [ ] **Step 6: Prove the relaxed guard still bites**

Temporarily delete the whole `heightClassName="…"` line from `src/app/absence-edit-modal.tsx:124`, re-run the guard, confirm it FAILS with "declares no heightClassName on the shell", then restore the line with `git checkout -- src/app/absence-edit-modal.tsx`.

```bash
npx vitest run src/app/edit-modal-chrome.test.tsx > /tmp/t1m.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/t1m.log
git checkout -- src/app/absence-edit-modal.tsx
```
Expected: EXIT=1 before the restore.

- [ ] **Step 7: Typecheck + lint**

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app; echo "EXIT=$?"
```
Expected: both EXIT=0.

- [ ] **Step 8: Commit**

```bash
git add src/app/resource-edit-modal.tsx src/app/resource-edit-modal.test.tsx src/app/edit-modal-chrome.test.tsx
git commit -F - <<'EOF'
fix(resources): the resource edit modal fits its content instead of a fixed 620px

The panel is now h-auto with a 280px floor and the 95vh cap, so a short
field-visibility set no longer opens with dead space under the form. The
useResizable storage key is bumped to -v2 in the same change: a persisted inline
height beats the class, so without the bump anyone who had ever dragged this
modal would have kept the old fixed height.

The shared narrow-consumer guard now accepts h-auto alongside a sub-720px pixel
height, and still requires the floor and the cap.
EOF
```

---

### Task 2: Calendar — "Hide externals" ToggleButton beside the Outlook block

**Files:**
- Modify: `src/app/resources-panel.tsx` (add a toggle node ~line 507; calendar render ~line 644)
- Modify: `src/app/resources-panel-toolbar.tsx:98-234`
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts` (delete one key)
- Test: `src/app/resources-panel.test.tsx`

- [ ] **Step 1: Write the failing tests**

Add to `src/app/resources-panel.test.tsx`, inside the same `describe` that holds the existing `"planning: Hide externals sits inside the trailing Outlook group"` test (so `baseProps`, `calendarProps` and `PLAN` are in scope):

```tsx
  // The calendar's externals filter was a bare checkbox sitting BEFORE the
  // ml-auto group. Assert CONTAINMENT, never DOM order: the checkbox already
  // preceded that group, so an order-only assertion passes against the unfixed
  // code — the vacuous version of this test.
  test("calendar: Hide externals is a toggle button inside the trailing Outlook group", () => {
    render(
      <ResourcesPanel {...baseProps} {...calendarProps} view="calendar" lang="en-US" plan={PLAN}
        workdayHours={8} holidaySet={new Set()} onSetUtilization={() => {}}
        onSetAbsenceOverride={() => {}} onSetPlanWindow={() => {}} />,
    );

    const hide = screen.getByRole("button", { name: t("en-US", "planningHideExternal") });
    const outlook = screen.getByRole("button", {
      name: new RegExp(t("en-US", "calendarSyncEnable"), "i"),
    });

    const trailingGroup = hide.closest("div.ml-auto");
    expect(trailingGroup).not.toBeNull();
    expect(trailingGroup).toContainElement(outlook);
  });

  test("calendar: the old Include-externals checkbox is gone", () => {
    render(
      <ResourcesPanel {...baseProps} {...calendarProps} view="calendar" lang="en-US" plan={PLAN}
        workdayHours={8} holidaySet={new Set()} onSetUtilization={() => {}}
        onSetAbsenceOverride={() => {}} onSetPlanWindow={() => {}} />,
    );
    expect(screen.queryByRole("checkbox", { name: /externals/i })).toBeNull();
  });

  // The stored field keeps its INVERTED sense (`calendarIncludeExternals`), so
  // pressed must mean "excluded". Reading the state back off aria-pressed proves
  // the write and the render agree — a write test alone could pass while the
  // button showed the opposite state.
  test("calendar: pressing the toggle flips to hiding externals and back", () => {
    render(
      <ResourcesPanel {...baseProps} {...calendarProps} view="calendar" lang="en-US" plan={PLAN}
        workdayHours={8} holidaySet={new Set()} onSetUtilization={() => {}}
        onSetAbsenceOverride={() => {}} onSetPlanWindow={() => {}} />,
    );
    const hide = screen.getByRole("button", { name: t("en-US", "planningHideExternal") });
    expect(hide).toHaveAttribute("aria-pressed", "false"); // externals shown by default

    fireEvent.click(hide);
    expect(hide).toHaveAttribute("aria-pressed", "true");

    fireEvent.click(hide);
    expect(hide).toHaveAttribute("aria-pressed", "false");
  });
```

If `fireEvent` is not yet imported in that file, add it to the `@testing-library/react` import.

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/app/resources-panel.test.tsx > /tmp/t2.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t2.log
```
Expected: FAIL — no button named "Hide externals" in the calendar view.

- [ ] **Step 3: Build the toggle node in the orchestrator**

In `src/app/resources-panel.tsx`, immediately after the existing `hideExternalToggle` const (ends ~line 507), add:

```tsx
  // Calendar's externals filter is the PERSISTED per-device
  // `settings.calendarIncludeExternals`, NOT planning's view-local `hideExternal`
  // — so it gets its own node rather than sharing the one above.
  // ★ The stored field keeps its INVERTED sense (include), which is what avoids a
  //   settings migration; the label is pinned to what pressing ENABLES (hiding),
  //   so "Hide externals, pressed" ⇒ externals are hidden (WCAG 4.1.2).
  // ★ The next value is read out of the updater's OWN state, never the closure —
  //   the same rule the tasks-section hide-externals toggle follows.
  const calendarHideExternalToggle = (
    <ToggleButton lang={lang}
      pressed={!includeExternals}
      onToggle={() =>
        setSettings((s) => ({ ...s, calendarIncludeExternals: s.calendarIncludeExternals === false }))
      }
      icon={<EyeSlashIcon aria-hidden="true" className="h-3.5 w-3.5" />}
    >
      {t(lang, "planningHideExternal")}
    </ToggleButton>
  );
```

Then in the `view === "calendar"` block, replace these two `CalendarToolbar` props:

```tsx
            includeExternals={includeExternals}
            onToggleIncludeExternals={(checked) => setSettings((s) => ({ ...s, calendarIncludeExternals: checked }))}
```

with:

```tsx
            hideExternalToggle={calendarHideExternalToggle}
```

Leave the `<ResourceCalendar includeExternals={includeExternals} …>` prop untouched.

- [ ] **Step 4: Change the toolbar**

In `src/app/resources-panel-toolbar.tsx`, in `CalendarToolbarProps` replace:

```tsx
  includeExternals: boolean;
  onToggleIncludeExternals: (checked: boolean) => void;
```

with:

```tsx
  /** The "Hide externals" toggle, built by the orchestrator (its state is the
   *  persisted per-device setting, so the closure stays there). Rendered in the
   *  trailing group beside the Outlook controls, mirroring PlanningToolbar. */
  hideExternalToggle: ReactNode;
```

In the destructure, replace `includeExternals,` and `onToggleIncludeExternals,` with `hideExternalToggle,`.

Delete the whole checkbox block:

```tsx
      <label className="flex items-center gap-1.5 text-foreground">
        <input
          type="checkbox"
          checked={includeExternals}
          aria-label={t(lang, "calendarIncludeExternals")}
          onChange={(e) => onToggleIncludeExternals(e.target.checked)}
          className={`align-middle ${FOCUS_RING}`}
        />
        <span>{t(lang, "calendarIncludeExternals")}</span>
      </label>
      <div className="ml-auto">{headerActions}</div>
```

and replace it with:

```tsx
      <div className="ml-auto flex items-center gap-2">
        {hideExternalToggle}
        {headerActions}
      </div>
```

- [ ] **Step 5: Drop the now-unused import**

```bash
grep -n "FOCUS_RING" src/app/resources-panel-toolbar.tsx
```
The checkbox was its only use, so exactly one hit remains (the import on line 17). Change that line to:

```tsx
import { INTERACTIVE } from "./interaction-styles";
```

An unused import is a FATAL lint error under `--max-warnings=0`.

- [ ] **Step 6: Run tests to verify they pass**

```bash
npx vitest run src/app/resources-panel.test.tsx > /tmp/t2.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t2.log
```
Expected: PASS.

- [ ] **Step 7: Delete the orphaned i18n key**

```bash
grep -rn "calendarIncludeExternals" src/ | grep -v "settings-types\|i18n"
```
Expected: no hits (the settings FIELD of the same name stays — only the i18n string goes).

Delete `calendarIncludeExternals: "Include externals",` from `src/app/i18n.ts` (line ~1546) with the Edit tool. Delete the DE line with a node write (CRLF + umlaut safety):

```bash
node -e "const fs=require('fs');const p='src/app/i18n.de.ts';let s=fs.readFileSync(p,'utf8');const line='  calendarIncludeExternals: \"Externe einbeziehen\",\r\n';if(!s.includes(line)){console.error('ANCHOR NOT FOUND');process.exit(1);}fs.writeFileSync(p,s.replace(line,''),'utf8');console.log('OK');"
```
Expected: `OK`. If it prints `ANCHOR NOT FOUND`, re-read the exact line (including its indentation and trailing comma) before retrying — do not "fix" it by loosening the anchor.

- [ ] **Step 8: Typecheck + lint + DE encoding guard**

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app; echo "EXIT=$?"
npx vitest run src/app/i18n-encoding.test.ts > /tmp/t2e.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/t2e.log
```
Expected: all EXIT=0 (tsc enforces EN/DE key parity, so a one-sided delete fails here).

- [ ] **Step 9: Commit**

```bash
git add src/app/resources-panel.tsx src/app/resources-panel-toolbar.tsx src/app/resources-panel.test.tsx src/app/i18n.ts src/app/i18n.de.ts
git commit -F - <<'EOF'
feat(resources): calendar externals filter becomes a Hide-externals toggle beside Outlook

The calendar's "Include externals" checkbox is now a ToggleButton labelled
"Hide externals", sitting inside the trailing ml-auto group with the Outlook
controls — the same shape planning already used. The label is pinned to what
pressing enables, so aria-pressed and the label agree, and the primitive brings
the non-colour pressed marker a hand-rolled aria-pressed button lacks.

The stored setting keeps its inverted sense (calendarIncludeExternals), so there
is no settings migration; the toggle writes the negation read out of the
updater's own state.
EOF
```

---

### Task 3: Time bookings — wider customer scope

**Files:**
- Modify: `src/app/timelog-customer-scope.tsx:50,71`

- [ ] **Step 1: Widen both controls**

In `src/app/timelog-customer-scope.tsx`, change the `ClearableSearchInput` wrapper class:

```tsx
        className="w-28 print:hidden"
```
to
```tsx
        className="w-[21rem] print:hidden"
```

and the `Select` class:

```tsx
        className="max-w-[14rem] print:hidden"
```
to
```tsx
        className="max-w-[20rem] print:hidden"
```

The sizing stays on the POSITIONING wrapper and the `<Input>` stays `w-full` — moving it onto the field would size it independently of the box the clear ✕ is positioned against.

- [ ] **Step 2: Run the timelog tests**

```bash
npx vitest run src/app/timelog-panel.test.tsx > /tmp/t3.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t3.log
```
Expected: PASS, unchanged (these are class-only edits).

- [ ] **Step 3: Lint**

```bash
npx eslint --max-warnings=0 src/app; echo "EXIT=$?"
```
Expected: EXIT=0.

- [ ] **Step 4: Commit**

```bash
git add src/app/timelog-customer-scope.tsx
git commit -F - <<'EOF'
fix(timelog): triple the customer filter width and raise the customer select cap

The 7rem filter box could not show a typed customer fragment, and the 14rem
select truncated most customer names. Sizing stays on the positioning wrapper so
the overlaid clear button keeps its target.
EOF
```

---

### Task 4: Budget — fixed Total column + total row

Split into 4a (`SortResizeTh` gains `stickyLeft`) and 4b (the panel).

#### Task 4a: `SortResizeTh` sticky support

**Files:**
- Modify: `src/app/report-table.tsx:203-262`
- Test: `src/app/report-table.test.tsx`

- [ ] **Step 1: Write the failing test**

Append to `src/app/report-table.test.tsx`:

```tsx
describe("SortResizeTh stickyLeft", () => {
  function renderTh(extra: { stickyLeft?: number } = {}) {
    render(
      <table><thead><tr>
        <SortResizeTh
          label="Role"
          sortCol="role"
          width={160}
          sortKey="role"
          sortDir="off"
          onSort={() => {}}
          {...extra}
        />
      </tr></thead></table>,
    );
    return document.querySelector("th") as HTMLElement;
  }

  it("stays a plain header cell when stickyLeft is omitted", () => {
    const th = renderTh();
    expect(th.style.position).toBe("");
    expect(th.className).not.toContain("print:static");
  });

  it("pins the column at the given offset when stickyLeft is passed", () => {
    const th = renderTh({ stickyLeft: 28 });
    expect(th.style.position).toBe("sticky");
    expect(th.style.left).toBe("28px");
    // The print stylesheet resets the scroll container out from under a sticky
    // cell, so a pinned column must opt back out for print.
    expect(th.className).toContain("print:static");
  });

  it("pins at offset 0 (a falsy but real offset)", () => {
    const th = renderTh({ stickyLeft: 0 });
    expect(th.style.position).toBe("sticky");
    expect(th.style.left).toBe("0px");
  });
});
```

Ensure `SortResizeTh` is imported in that test file.

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run src/app/report-table.test.tsx > /tmp/t4a.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t4a.log
```
Expected: FAIL — `stickyLeft` is not a prop (and tsc would reject it too).

- [ ] **Step 3: Add the prop**

In `src/app/report-table.tsx`, add to the `SortResizeTh` destructure and its prop type:

```tsx
  stickyLeft,
```

```tsx
  /** Pins this column at the given px offset inside a horizontally scrolling
   *  table (`position: sticky`). Omit for an ordinary scrolling column. `0` is a
   *  REAL offset — the leading fixed column — so this is checked for `undefined`,
   *  never for truthiness. */
  stickyLeft?: number;
```

and replace the `className` / `style` on the `<th>`:

```tsx
      className={`${
        align === "right"
          ? "relative px-3 py-2 text-right font-medium"
          : "relative px-3 py-2 font-medium"
      }${stickyLeft === undefined ? "" : " print:static"}`}
      style={{
        ...(width === undefined ? undefined : { width, minWidth: width }),
        ...(stickyLeft === undefined ? undefined : { position: "sticky" as const, left: stickyLeft }),
      }}
```

Note: `style` is now always an object. That is a no-op for the existing consumers — an empty style object renders no `style` attribute content.

- [ ] **Step 4: Run test to verify it passes**

```bash
npx vitest run src/app/report-table.test.tsx > /tmp/t4a.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t4a.log
```
Expected: PASS.

- [ ] **Step 5: Run every consumer's tests (the primitive is shared by 9 panels)**

```bash
npx vitest run src/app/raid-report-panel.test.tsx src/app/resources-report.test.tsx src/app/reports.test.tsx src/app/calendar-series-list.test.tsx src/app/tasks-section.test.tsx src/app/budget-panel.test.tsx > /tmp/t4c.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t4c.log
```
Expected: PASS. If a file name does not exist, list the real ones with `ls src/app | grep -E "report|panel" ` and run those instead — do not skip this step.

- [ ] **Step 6: Commit**

```bash
git add src/app/report-table.tsx src/app/report-table.test.tsx
git commit -F - <<'EOF'
feat(report-table): SortResizeTh can pin a column with stickyLeft

Additive and opt-in: without the prop the emitted header cell is unchanged. With
it the cell gets position: sticky at the given offset plus print:static, since
the print stylesheet resets the scroll container out from under a sticky cell.
Offset 0 is a real value, so the prop is checked against undefined.
EOF
```

#### Task 4b: Budget Total column + total row

**Files:**
- Modify: `src/app/budget-panel.tsx` (constants ~line 37, new `TotalsTd` ~line 228, bucket block ~line 518, table ~line 619-704)
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts` (one new key)
- Test: `src/app/budget-panel.test.tsx`

- [ ] **Step 1: Add the i18n key**

In `src/app/i18n.ts`, beside the other `budget*` cell keys (search `budgetCellActual`), add:

```ts
  budgetTotal: "Total",
```

DE, via node (CRLF-safe, anchor asserted):

```bash
node -e "const fs=require('fs');const p='src/app/i18n.de.ts';let s=fs.readFileSync(p,'utf8');const m=s.match(/^  budgetCellActual: \"[^\"]*\",\r\n/m);if(!m){console.error('ANCHOR NOT FOUND');process.exit(1);}s=s.replace(m[0], m[0]+'  budgetTotal: \"Gesamt\",\r\n');fs.writeFileSync(p,s,'utf8');console.log('OK');"
```
Expected: `OK`.

- [ ] **Step 2: Write the failing tests**

Append to `src/app/budget-panel.test.tsx`. The file's shared `props` fixture has ONE allocation over ONE booked month, which cannot tell a row sum from a column sum from a grand total — so this describe brings its own two-row, two-period bucket:

```tsx
describe("BudgetPanel — Total column + total row", () => {
  // 2 rows x 2 periods, every marginal distinct:
  //   rows    : 80/65 and 40/50
  //   columns : 60/55 (Jan) and 60/60 (Feb)
  //   grand   : 120/115
  // A single-row or single-period fixture passes whether the code sums the right
  // axis or not, which is the whole failure mode being guarded here.
  const totalsRoles: Role[] = [
    { id: 3, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 150 },
    { id: 4, disciplineId: 1, gradeId: 2, internalRate: 100, externalRate: 150 },
  ];
  const totalsBuckets: BudgetBucket[] = [{
    id: 1, name: "PAM", type: "tm", currency: "EUR",
    startDate: "2026-01-01", endDate: "2026-02-28", status: "open",
    allocations: [
      { roleId: 3, resourceIds: [], budgetHours: { "2026-01": 40, "2026-02": 40 }, actualHours: { "2026-01": 30, "2026-02": 35 } },
      { roleId: 4, resourceIds: [], budgetHours: { "2026-01": 20, "2026-02": 20 }, actualHours: { "2026-01": 25, "2026-02": 25 } },
    ],
  }];
  const renderTotals = () =>
    render(<BudgetPanel {...props} roles={totalsRoles} buckets={totalsBuckets} />);

  test("each row carries its summed budget and actual in the Total column", () => {
    renderTotals();
    expect(screen.getByRole("columnheader", { name: t("en-US", "budgetTotal") })).toBeInTheDocument();

    // Row-scoped: the CCI tiles above the table render their own numbers, so a
    // bare getByText could match one of those instead.
    const rows = screen.getAllByRole("row");
    const firstCells = within(rows[1]).getAllByRole("cell");
    expect(firstCells[2].textContent).toContain("80");
    expect(firstCells[2].textContent).toContain("65");
    const secondCells = within(rows[2]).getAllByRole("cell");
    expect(secondCells[2].textContent).toContain("40");
    expect(secondCells[2].textContent).toContain("50");
  });

  test("the total row carries each period's column sums and the grand total", () => {
    renderTotals();
    const totalRow = screen.getByText(t("en-US", "budgetTotal"), { selector: "td" }).closest("tr") as HTMLElement;
    const cells = within(totalRow).getAllByRole("cell");
    // cell 0 = RAG dot, 1 = "Total", 2 = grand, 3.. = per-period sums
    expect(cells[2].textContent).toContain("120");
    expect(cells[2].textContent).toContain("115");
    expect(cells[3].textContent).toContain("60");
    expect(cells[3].textContent).toContain("55");
    expect(cells[4].textContent).toContain("60");
  });

  test("the three leading columns are pinned, Total offset by the live role width", () => {
    renderTotals();
    const headers = screen.getAllByRole("columnheader");
    expect(headers[0].style.position).toBe("sticky");
    expect(headers[0].style.left).toBe("0px");
    expect(headers[1].style.position).toBe("sticky");
    expect(headers[1].style.left).toBe("28px");
    // 28 + the 160px default role width. The role column is user-resizable, so
    // this offset is derived from its live width, never hardcoded.
    expect(headers[2].style.position).toBe("sticky");
    expect(headers[2].style.left).toBe("188px");
  });

  test("the pinned body cells carry an opaque background", () => {
    // Without it the scrolled period cells show straight through the pinned ones
    // — these rows carry no background of their own.
    renderTotals();
    const cells = within(screen.getAllByRole("row")[1]).getAllByRole("cell");
    expect(cells[0].className).toContain("bg-surface");
    expect(cells[1].className).toContain("bg-surface");
    expect(cells[2].className).toContain("bg-surface");
  });
});
```

Add `within` to the `@testing-library/react` import (the file currently imports `render, screen, fireEvent`).

- [ ] **Step 3: Run tests to verify they fail**

```bash
npx vitest run src/app/budget-panel.test.tsx > /tmp/t4b.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t4b.log
```
Expected: FAIL — no Total column header.

- [ ] **Step 4: Add the constants**

In `src/app/budget-panel.tsx`, after `BUDGET_COL_WIDTHS` / `BudgetCol` (~line 41):

```tsx
/** The leading RAG-dot column, and the fixed Total column that follows the role
 *  label. Neither is in BUDGET_COL_WIDTHS: they are not resizable, so they mint
 *  no persisted column key and draw no grip (a handle that does nothing is the
 *  false affordance ColumnResizeHandle exists to avoid). TOTAL_COL_PX matches a
 *  period cell's content box: a w-14 label plus a w-16 number. */
const DOT_COL_PX = 28;
const TOTAL_COL_PX = 104;
```

- [ ] **Step 5: Add the read-only totals cell**

In `src/app/budget-panel.tsx`, after `HoursTd` (~line 227):

```tsx
/** A read-only totals `<td>`: the Total column's cells and every cell of a
 *  bucket's total row. Mirrors HoursCell's two-row layout (budget over actual)
 *  without the inputs, the tooltips or the RagBadge — the row/bucket dot already
 *  carries health, and a second badge over the same numbers is a place for the
 *  two to disagree. Values are rounded for DISPLAY the same way mirrored plan
 *  hours are, so float noise (10.559999999999999) cannot leak into a total. */
function TotalsTd({
  budget, actual, lang, left,
}: {
  budget: number;
  actual: number;
  lang: Lang;
  /** Sticky offset in px — passed for the fixed Total column, omitted for the
   *  total row's scrolling period cells. `0` would be a real offset, so this is
   *  checked against undefined. */
  left?: number;
}) {
  return (
    <td
      className={`px-3 py-2${left === undefined ? "" : " bg-surface print:static"}`}
      style={
        left === undefined
          ? undefined
          : { position: "sticky", left, width: TOTAL_COL_PX, minWidth: TOTAL_COL_PX }
      }
    >
      <div className="flex flex-col gap-0.5">
        <div className="flex items-center gap-1">
          <span className="w-14 text-[10px] text-muted-foreground">{t(lang, "budgetCellBudget")}</span>
          <span className="w-16 px-1 py-0.5 text-right tabular-nums">{displayHours(budget, true)}</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="w-14 text-[10px] text-muted-foreground">{t(lang, "budgetCellActual")}</span>
          <span className="w-16 px-1 py-0.5 text-right tabular-nums">{displayHours(actual, true)}</span>
        </div>
      </div>
    </td>
  );
}
```

- [ ] **Step 6: Compute the totals inside the bucket block**

In `src/app/budget-panel.tsx`, after the `blendedRows` const (~line 535):

```tsx
          // Column + grand totals for this bucket's total row. Derived from the
          // SAME accessors the row totals use — `cellBudget` honours the
          // budget-follows-plan mirroring — so the row sums, the column sums and
          // the grand total cannot disagree.
          // The cast is structural: both allocation shapes carry exactly these
          // three fields, and a bare ternary over the two arrays makes `.reduce`
          // a union-of-signatures call TS refuses.
          const rowsForTotals = (isBlended ? blendedRows : detailedRows) as readonly {
            resourceIds: readonly number[];
            budgetHours: Record<string, number>;
            actualHours: Record<string, number>;
          }[];
          const columnTotals = periods.map((p) => ({
            key: p.key,
            budget: rowsForTotals.reduce((s, a) => s + cellBudget(a, p, periods), 0),
            actual: rowsForTotals.reduce((s, a) => s + (a.actualHours[p.key] ?? 0), 0),
          }));
          const grandBudget = columnTotals.reduce((s, c) => s + c.budget, 0);
          const grandActual = columnTotals.reduce((s, c) => s + c.actual, 0);
```

- [ ] **Step 7: Pin the header columns and add the Total header**

Replace the header row (~lines 623-644) with:

```tsx
                    <tr>
                      <th
                        className="px-1 py-1 text-left font-medium print:static"
                        style={{ position: "sticky", left: 0, width: DOT_COL_PX, minWidth: DOT_COL_PX }}
                      >
                        {t(lang, "budgetRoleStatus")}
                      </th>
                      <SortResizeTh
                        label={t(lang, isBlended ? "budgetDiscipline" : "budgetRole")}
                        sortCol="role"
                        width={colWidths.role}
                        stickyLeft={DOT_COL_PX}
                        sortKey="role"
                        sortDir={roleSort}
                        onSort={() => setRoleSort((d) => nextSortDir(d))}
                        onResize={startResize}
                      />
                      {/* Fixed Total column. Its offset tracks the LIVE role width —
                          the role column is user-resizable, so a hardcoded offset
                          drifts the moment it is dragged. */}
                      <th
                        className="px-3 py-2 font-medium print:static"
                        style={{
                          position: "sticky",
                          left: DOT_COL_PX + colWidths.role,
                          width: TOTAL_COL_PX,
                          minWidth: TOTAL_COL_PX,
                        }}
                      >
                        {t(lang, "budgetTotal")}
                      </th>
                      {periods.map((p) => (
                        <th
                          key={p.key}
                          className="relative px-3 py-2 font-medium"
                          style={{ width: colWidths.period, minWidth: colWidths.period }}
                        >
                          {p.key}
                          <ColumnResizeHandle col="period" onMouseDown={startResize} />
                        </th>
                      ))}
                    </tr>
```

- [ ] **Step 8: Pin the body cells and add the Total cell — detailed rows**

In the `!isBlended && detailedRows.map(...)` branch, replace the row's first two `<td>`s with the pinned pair plus the Total cell:

```tsx
                      <tr key={a.roleId} className="border-t border-line">
                        <td className="bg-surface px-1 py-1 print:static" style={{ position: "sticky", left: 0 }}>
                          <RagBadge value={ratioHealth(totActual, totBudget)} lang={lang} title={t(lang, "budgetRoleStatus")} />
                        </td>
                        <td className="bg-surface px-3 py-2 print:static" style={{ position: "sticky", left: DOT_COL_PX }}>
                          {roleLabel(roles.find((r) => r.id === a.roleId), props.disciplines, props.grades) || `#${a.roleId}`}
                        </td>
                        <TotalsTd budget={totBudget} actual={totActual} lang={lang} left={DOT_COL_PX + colWidths.role} />
                        {periods.map((p) => (
```

(the `periods.map` body and the closing tags are unchanged)

- [ ] **Step 9: Same for the blended rows**

In the `isBlended && blendedRows.map(...)` branch:

```tsx
                      <tr key={a.disciplineId} className="border-t border-line">
                        <td className="bg-surface px-1 py-1 print:static" style={{ position: "sticky", left: 0 }}>
                          <RagBadge value={ratioHealth(totActual, totBudget)} lang={lang} title={t(lang, "budgetRoleStatus")} />
                        </td>
                        <td className="bg-surface px-3 py-2 print:static" style={{ position: "sticky", left: DOT_COL_PX }}>
                          {props.disciplines.find((d) => d.id === a.disciplineId)?.name || `#${a.disciplineId}`}
                        </td>
                        <TotalsTd budget={totBudget} actual={totActual} lang={lang} left={DOT_COL_PX + colWidths.role} />
                        {periods.map((p) => (
```

- [ ] **Step 10: Add the total row**

Immediately after the `blendedRows.map(...)` block and before the closing `</DataTable>` (~line 703):

```tsx
                    {rowsForTotals.length > 0 && (
                      <tr className="border-t-2 border-line font-medium">
                        <td className="bg-surface px-1 py-1 print:static" style={{ position: "sticky", left: 0 }}>
                          <RagBadge value={ratioHealth(grandActual, grandBudget)} lang={lang} title={t(lang, "budgetRoleStatus")} />
                        </td>
                        <td className="bg-surface px-3 py-2 print:static" style={{ position: "sticky", left: DOT_COL_PX }}>
                          {t(lang, "budgetTotal")}
                        </td>
                        <TotalsTd budget={grandBudget} actual={grandActual} lang={lang} left={DOT_COL_PX + colWidths.role} />
                        {columnTotals.map((c) => (
                          <TotalsTd key={c.key} budget={c.budget} actual={c.actual} lang={lang} />
                        ))}
                      </tr>
                    )}
```

- [ ] **Step 11: Run tests to verify they pass**

```bash
npx vitest run src/app/budget-panel.test.tsx src/app/budget-panel-edit.test.tsx > /tmp/t4b.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t4b.log
```
Expected: PASS. Pre-existing tests that index cells positionally may now be off by one — fix those by index, never by removing the Total column.

- [ ] **Step 12: Prove the totals tests are not vacuous**

Temporarily change `grandBudget` to `grandBudget + 1`, re-run, confirm the total-row test FAILS, then revert:

```bash
npx vitest run src/app/budget-panel.test.tsx > /tmp/t4m.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/t4m.log
git diff src/app/budget-panel.tsx | head -20
```
Revert the mutation with a targeted Edit (NOT `git checkout` — that would discard the whole task's work).

- [ ] **Step 13: Typecheck + lint**

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app; echo "EXIT=$?"
```
Expected: both EXIT=0.

- [ ] **Step 14: Commit**

```bash
git add src/app/budget-panel.tsx src/app/budget-panel.test.tsx src/app/i18n.ts src/app/i18n.de.ts
git commit -F - <<'EOF'
feat(budget): fixed Total column and per-bucket total row

Each bucket table gains a Total column carrying the row's summed budget and
actual, plus a total row carrying each period's column sums and the grand total.
The RAG dot, the role/discipline label and Total are pinned left; only the month
columns scroll. Total's offset is derived from the live role-column width, since
that column is user-resizable.

Every figure comes from the same accessors the row totals already used, so the
row sums, the column sums and the grand total cannot disagree. Pinned body cells
carry bg-surface (the rows have no background of their own) and print:static
(the print stylesheet removes the scroll container).
EOF
```

---

### Task 5: Configurable start-window logo

**Files:**
- Modify: `src/app/settings-types.ts:452-490`
- Modify: `src/app/project-empty-state.tsx:113,139-148`
- Modify: `src/app/settings-sections/appearance-section.tsx:53,251-267`
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts`
- Test: `src/app/settings-types.test.ts`, `src/app/project-empty-state.test.tsx`

- [ ] **Step 1: Write the failing sanitizer tests**

Append to `src/app/settings-types.test.ts` inside the existing `describe("sanitizeBranding", …)`:

```ts
  it("keeps a raster startLogo", () => {
    const png = "data:image/png;base64,iVBORw0KGgo=";
    expect(sanitizeBranding({ startLogo: png })).toEqual({ startLogo: png });
  });

  it("rejects an SVG startLogo (the data-URL XSS surface)", () => {
    expect(sanitizeBranding({ startLogo: "data:image/svg+xml;base64,PHN2Zz4=" })).toBeUndefined();
  });

  it("rejects an oversized startLogo", () => {
    const huge = "data:image/png;base64," + "A".repeat(BRANDING_LOGO_MAX_LEN);
    expect(sanitizeBranding({ startLogo: huge })).toBeUndefined();
  });
```

The third test is the one that catches a missed `startLogo` in the final presence check: without it the function returns `undefined` for a valid start-logo-only blob and the field silently never persists.

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run src/app/settings-types.test.ts > /tmp/t5.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t5.log
```
Expected: FAIL — `sanitizeBranding({startLogo})` returns `undefined`.

- [ ] **Step 3: Add the field and the sanitizer arm**

In `src/app/settings-types.ts`, extend the interface:

```ts
export interface BrandingConfig {
  logo?: string;
  slogan?: string;
  footerSlogan?: string;
  favicon?: string;
  /** Start-window logo (shown while no project exists yet). SEPARATE from
   *  `logo`, which is the sidebar mark. Unset ⇒ the shipped harbor banner.
   *  Schemes do not own this field — mergeAppliedBranding spreads `current` and
   *  overwrites only the other four, so it survives a scheme apply and stays out
   *  of the portable scheme format. */
  startLogo?: string;
}
```

and in `sanitizeBranding`, after the `favicon` arm:

```ts
  if (typeof o.startLogo === "string" && BRANDING_LOGO_RE.test(o.startLogo) && o.startLogo.length <= BRANDING_LOGO_MAX_LEN) {
    out.startLogo = o.startLogo;
  }
```

and extend the presence check:

```ts
  return out.logo || out.slogan || out.footerSlogan || out.favicon || out.startLogo ? out : undefined;
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run src/app/settings-types.test.ts > /tmp/t5.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t5.log
```
Expected: PASS.

- [ ] **Step 5: Write the failing empty-state tests**

Append to `src/app/project-empty-state.test.tsx`:

```tsx
describe("start-window logo", () => {
  it("shows the shipped harbor banner when no start logo is configured", () => {
    setup();
    const img = document.querySelector("img[src='/ai-pm-cockpit-banner-harbor.svg']");
    expect(img).not.toBeNull();
  });

  it("shows the configured start logo instead", () => {
    const png = "data:image/png;base64,iVBORw0KGgo=";
    setup({ settings: { ...defaultSettings, branding: { startLogo: png } } });
    expect(document.querySelector(`img[src='${png}']`)).not.toBeNull();
    expect(document.querySelector("img[src='/ai-pm-cockpit-banner-harbor.svg']")).toBeNull();
  });

  it("does not fall back to the sidebar logo", () => {
    // The sidebar mark and the start banner are different images at different
    // aspect ratios; sharing one field made a sidebar upload distort here.
    const png = "data:image/png;base64,iVBORw0KGgo=";
    setup({ settings: { ...defaultSettings, branding: { logo: png } } });
    expect(document.querySelector(`img[src='${png}']`)).toBeNull();
    expect(document.querySelector("img[src='/ai-pm-cockpit-banner-harbor.svg']")).not.toBeNull();
  });
});
```

- [ ] **Step 6: Run tests to verify they fail**

```bash
npx vitest run src/app/project-empty-state.test.tsx > /tmp/t5b.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t5b.log
```
Expected: FAIL — the img still points at `/AIPM-logo.svg`.

- [ ] **Step 7: Change the empty state**

In `src/app/project-empty-state.tsx`, add near the other module-level constants (top of file, after the imports):

```tsx
/** Shipped default for the start window. A path, not a data URL — user overrides
 *  are raster data URLs (SVG uploads stay rejected), but the shipped asset is our
 *  own file and is served same-origin. */
const DEFAULT_START_LOGO = "/ai-pm-cockpit-banner-harbor.svg";
```

Replace `const brandLogo = settings.branding?.logo;` with:

```tsx
  const startLogo = settings.branding?.startLogo;
```

and replace the `logo={…}` block:

```tsx
          logo={
            view === "choices" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={startLogo || DEFAULT_START_LOGO}
                alt={settings.branding?.slogan ?? t(lang, "appTitle")}
                // One sizing for both branches: the default is a WIDE banner, and
                // the old max-w-[200px] squeezed it to near-illegible.
                className="max-h-12 w-auto max-w-[280px] object-contain"
              />
            ) : undefined
          }
```

- [ ] **Step 8: Run tests to verify they pass**

```bash
npx vitest run src/app/project-empty-state.test.tsx > /tmp/t5b.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t5b.log
```
Expected: PASS.

- [ ] **Step 9: Add the i18n keys**

In `src/app/i18n.ts`, after `brandingFaviconHint`:

```ts
  brandingStartLogo: "Start-window logo",
  brandingStartLogoChoose: "Choose start logo…",
  brandingStartLogoHint: "Shown on the start window before any project exists. A wide banner works best (up to ~280×48 px on screen). PNG, JPG, WebP or GIF, up to 512 KB.",
```

DE, via node:

```bash
node -e "const fs=require('fs');const p='src/app/i18n.de.ts';let s=fs.readFileSync(p,'utf8');const m=s.match(/^  brandingFaviconHint: \"[^\"]*\",\r\n/m);if(!m){console.error('ANCHOR NOT FOUND');process.exit(1);}const add='  brandingStartLogo: \"Logo im Startfenster\",\r\n  brandingStartLogoChoose: \"Startlogo auswählen…\",\r\n  brandingStartLogoHint: \"Wird im Startfenster angezeigt, solange kein Projekt existiert. Ein breites Banner passt am besten (bis ca. 280×48 px). PNG, JPG, WebP oder GIF, bis 512 KB.\",\r\n';s=s.replace(m[0],m[0]+add);fs.writeFileSync(p,s,'utf8');console.log('OK');"
```
Expected: `OK`. Then verify the umlauts survived:

```bash
grep -c "auswählen" src/app/i18n.de.ts
```
Expected: ≥ 1 (a corrupted write shows `auswaehlen` or mojibake).

- [ ] **Step 10: Add the Appearance row**

In `src/app/settings-sections/appearance-section.tsx`, add beside the other error states (~line 54):

```tsx
  const [startLogoError, setStartLogoError] = useState<string | null>(null);
```

and after the favicon block (~line 267):

```tsx
          {/* Start-window logo (shown before any project exists) */}
          <div className="mb-3">
            <span className="mb-1 flex items-center gap-1 text-xs font-medium text-muted-foreground">
              {t(lang, "brandingStartLogo")}
              <InfoTooltip text={t(lang, "brandingStartLogoHint")} />
            </span>
            <BrandingImageInput
              label={t(lang, "brandingStartLogoChoose")}
              removeLabel={`${t(lang, "remove")} – ${t(lang, "brandingStartLogo")}`}
              value={branding?.startLogo}
              onChange={(startLogo) => { setStartLogoError(null); setBranding({ ...branding, startLogo }); }}
              onRemove={() => { setStartLogoError(null); setBranding({ ...branding, startLogo: undefined }); }}
              error={startLogoError}
              invalidMessage={t(lang, "brandingLogoError")}
              onError={(m) => setStartLogoError(m)}
            />
          </div>
```

- [ ] **Step 11: Typecheck, lint, and run the touched suites**

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app; echo "EXIT=$?"
npx vitest run src/app/settings-types.test.ts src/app/project-empty-state.test.tsx src/app/color-schemes.test.ts src/app/i18n-encoding.test.ts > /tmp/t5c.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t5c.log
```
Expected: all EXIT=0. `color-schemes.test.ts` is included because `mergeAppliedBranding` must still leave `startLogo` alone.

- [ ] **Step 12: Commit**

```bash
git add src/app/settings-types.ts src/app/settings-types.test.ts src/app/project-empty-state.tsx src/app/project-empty-state.test.tsx src/app/settings-sections/appearance-section.tsx src/app/i18n.ts src/app/i18n.de.ts
git commit -F - <<'EOF'
feat(branding): the start-window logo is configurable and defaults to the harbor banner

New per-device branding.startLogo, edited in Settings → Appearance beside the
sidebar logo and favicon, and validated by the same raster-only rule (SVG
uploads stay rejected). Unset, the start window shows the shipped
ai-pm-cockpit-banner-harbor.svg instead of the AIPM mark, sized for a wide banner.

Schemes do not own the field: mergeAppliedBranding overwrites only the other
four, so a scheme apply leaves it intact and it stays out of the scheme format.
EOF
```

---

### Task 6: Full gate run

**Files:** none (verification only)

- [ ] **Step 1: Unit suite + coverage floors**

```bash
npm run test:coverage > /tmp/cov.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests |ERROR|threshold" /tmp/cov.log
```
Expected: EXIT=0. `test:run` does NOT enforce the floors — a new coverage-gated file would pass there and fail CI.

- [ ] **Step 2: Lint + typecheck (the real CI gates)**

```bash
npx eslint --max-warnings=0 src/app; echo "EXIT=$?"
npx tsc --noEmit; echo "EXIT=$?"
```
Expected: both EXIT=0.

- [ ] **Step 3: Duplication + size ratchets**

```bash
npm run dup:check > /tmp/dup.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/dup.log
npm run size:check > /tmp/size.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/size.log
```
Expected: both EXIT=0. If `budget-panel.tsx` trips the size ratchet, split the totals pieces into a `budget-panel-totals.tsx` leaf (the gantt convention) rather than raising the baseline.

- [ ] **Step 4: Build**

```bash
npm run build > /tmp/build.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/build.log
```
Expected: EXIT=0.

- [ ] **Step 5: axe gate on a FRESH isolated server**

Task 4 changes an axe-scanned view (Budget) and Task 5 changes an axe-scanned view (Settings → Appearance). Never reuse a long-running dev server for this.

```bash
PORT=3100 npm run dev > /tmp/dev.log 2>&1 &
npx playwright test e2e/a11y.spec.ts --project=chromium -g "Budget" > /tmp/axe1.log 2>&1; echo "EXIT=$?"; grep -E "passed|failed" /tmp/axe1.log
npx playwright test e2e/a11y.spec.ts --project=chromium -g "Settings" > /tmp/axe2.log 2>&1; echo "EXIT=$?"; grep -E "passed|failed" /tmp/axe2.log
PORT=3100 npm run stop
```
Expected: both EXIT=0.

- [ ] **Step 6: Eye-verify (nothing above can see any of this — jsdom has no layout)**

Start the dev server and check, in both a light and a dark scheme:

1. **Resource edit modal** — open it at a minimal and at a Full field-visibility tier: the panel height should follow the content with no dead space, and dragging it larger should still work.
2. **Resources → Calendar** — the "Hide externals" toggle sits beside the Outlook controls, its pressed state shows the check marker, and pressing it removes external rows.
3. **Time bookings** — the customer filter and select are comfortably wide and the toolbar still wraps rather than overflowing at a narrow width.
4. **Budget** — scroll a bucket with enough months to overflow: the dot / role / Total columns must stay put, and their `bg-surface` must match the bucket card behind them (a visible seam here is the likely defect). Drag the role column wider and confirm Total stays flush against it. Print-preview one bucket and confirm no overlapping columns.
5. **Start window** — clear the project registry (or use a fresh profile): the harbor banner should render at a readable size; upload a start logo in Settings → Appearance and confirm it replaces the banner and that the sidebar logo is unaffected.

- [ ] **Step 7: Commit anything the eye-verify fixed**

```bash
git status --short
```
If nothing changed, skip. Otherwise commit with a `fix:` message naming what the visual check caught.

---

### Task 7: Release bookkeeping

Only run this task when the user asks for a release. Do NOT push, open an MR, or merge without an explicit instruction.

**Files:**
- Modify: `src/app/version.ts`, `CHANGELOG.md`, `src/app/i18n.ts`, `src/app/i18n.de.ts`, `package.json`, `package-lock.json`, `README.md`, `docs/CODEMAPS/*.md`

- [ ] **Step 1: Confirm the codename is unused**

```bash
grep -ic "lostetter" CHANGELOG.md; echo "EXIT=$?"
```
Expected: `0`. If it is not 0, pick another sci-fi/fantasy author surname and re-check — codenames are unique per minor series.

- [ ] **Step 2: Bump `src/app/version.ts`**

```ts
export const APP_VERSION = "0.214.0";
export const APP_BUILD_DATE = "2026-08-04"; // 0.214.0: content-fit resource modal + calendar hide-externals toggle + budget totals column + configurable start logo (Lostetter)
```
and set `APP_MILESTONE` to `"Lostetter"`.

- [ ] **Step 3: Add the highlight key**

```bash
grep -n "APP_HIGHLIGHT_KEYS" -A 8 src/app/version.ts
```

Append `"versionHighlightUiBatchLostetter"` to that array, add the EN string in `src/app/i18n.ts`:

```ts
  versionHighlightUiBatchLostetter: "Budget buckets gain a fixed Total column and a total row — the sums stay in view while the months scroll. The resource editor now sizes itself to its fields, the Resource calendar's externals filter became a Hide-externals toggle beside the Outlook controls, the Time-bookings customer picker is wide enough to read, and the start window's logo is configurable in Settings → Appearance.",
```

and the DE string via node (anchor on the EN-side key's DE twin — find it with `grep -n "versionHighlight" src/app/i18n.de.ts | tail -3` and anchor on that exact line, asserting the match as in Task 5).

- [ ] **Step 4: Add the CHANGELOG entry**

Add a `## 0.214.0 "Lostetter"` section at the top listing the five changes, matching the file's existing entry format.

- [ ] **Step 5: Bump the FIVE ungated places in the SAME commit**

```bash
grep -n '"version"' package.json
grep -n '"version": "0\.' package-lock.json | head -3   # root + packages[""] — TWO occurrences
grep -n "shields.io\|badge" README.md | head -5
grep -rn "Generated:.*App 0\." docs/CODEMAPS/ | head -6   # five files
```
Set every one to `0.214.0` (and the README badge codename to `Lostetter`). No gate checks any of these; skipping them restarts the drift.

- [ ] **Step 6: Verify + commit**

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx vitest run src/app/i18n-encoding.test.ts > /tmp/t7.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/t7.log
git add -A
git commit -F - <<'EOF'
chore(release): 0.214.0 "Lostetter"

Content-fit resource editor, calendar hide-externals toggle, wider Time-bookings
customer picker, budget Total column + total row, configurable start-window logo.

Bumps version.ts, CHANGELOG, the highlight key, package.json, both
package-lock occurrences, the README badge and the five codemap headers.
EOF
```

---

## Notes for the implementer

- Tasks 1, 2, 3, 5 and 4a are independent and can be done in any order. Task 4b depends on 4a.
- No task adds a persisted `Workspace` field, so nothing here touches the six write paths, the golden fixtures or `turso-migrate`.
- Two tests deliberately mutate source to prove they are not vacuous (Task 1 Step 6, Task 4b Step 12). Revert the Task 4b mutation with a targeted Edit — `git checkout` there would discard the whole task's work.
- If a step's code does not apply cleanly because the surrounding file moved, re-read the region and adapt — but keep every comment: they encode the reason each choice is load-bearing.
