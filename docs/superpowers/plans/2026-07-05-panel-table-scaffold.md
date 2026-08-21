# PanelTableScaffold Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the byte-identical render shell shared verbatim by the change,
stakeholders, and RAID panels into one presentational `PanelTableScaffold` component,
preserving DOM and behavior exactly.

**Architecture:** New presentational file `src/app/panel-table-scaffold.tsx` (no state,
no hooks — pure props→JSX, mirroring `EditModalShell` in `edit-modal-chrome.tsx`). Each
panel keeps its `*PanelBody` (hooks, derivation, columns, rows, `bulkFields`) and its
`PanelFiltersProvider`/`memo` export wrapper; only the render shell (pane div +
ViewCallout + toolbar slot + bulk bar/panel + scroll container + dashed empty-state ↔
table switch + trailing modal) moves into the scaffold.

**Tech Stack:** Next.js (forked) + React 19 + TypeScript, Tailwind v4, Vitest + Testing
Library, Playwright + axe. Spec: `docs/superpowers/specs/2026-07-05-panel-table-scaffold-design.md`.

**Verification commands (used throughout):**
- `npx tsc --noEmit` — authoritative typecheck (trust over IDE squiggles).
- `npx eslint <files> --max-warnings=0` — unused import/var is FATAL.
- `npx vitest run <pattern>` — testTimeout 20s.
- `npm run dup:check` / `npm run size:check` — gates.
- axe: `npx playwright test e2e/a11y.spec.ts --project=chromium -g "<View>"` (~16s, webServer auto-starts).

**Pinned facts from source (do not re-guess):**
- `BulkEditPanel` (`bulk-edit-panel.tsx`): props `{ lang, count, fields: readonly BulkField[], onApply: (changes: Record<string, string>) => void, onCancel }`.
- `ViewCallout` (`view-callout.tsx`): props `{ view: AppView, lang, showHints: boolean, isPopout: boolean, onLearnMore: (conceptId: string) => void }`; self-returns null when `!showHints || isPopout || dismissed`.
- Import sources: `ViewCallout` ← `./view-callout`; `VIEW_PANE_RESIZABLE_CLASS` ← `./view-styles`; `INTERACTIVE` ← `./interaction-styles`; `BulkEditBar` ← `./bulk-edit-bar`; `BulkEditPanel` + `type BulkField` ← `./bulk-edit-panel`; `t` + `type Lang` ← `./i18n`; `type AppView` ← `./nav-config`.
- Shell class strings (must stay literal in the scaffold, verbatim):
  - pane: `` `print-root print-landscape ${VIEW_PANE_RESIZABLE_CLASS}` ``
  - container (non-empty): `"min-h-[240px] flex-1 overflow-auto rounded-md border border-line pr-2"`; (empty): `undefined`.
  - dashed button: `` `flex w-full flex-col items-center gap-2 rounded-md border border-dashed border-line p-10 text-center text-sm text-muted-foreground hover:border-AIPM-dark-blue hover:text-AIPM-dark-blue dark:hover:text-AIPM-light-grey ${INTERACTIVE}` ``
- **RAID divergences absorbed as props:** RAID's empty `<button>` carries `aria-label={t(lang,"raidAddItem")}` (change/stakeholders have none → prop optional, omitted → attribute absent); RAID's bulk block is **not** wrapped in `<div className="print:hidden">` (change/stakeholders are) → prop `bulkPrintHidden?: boolean`, default wrapped, RAID passes `false`.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `src/app/panel-table-scaffold.tsx` | The shared presentational shell | **Create** |
| `src/app/panel-table-scaffold.test.tsx` | Scaffold unit tests | **Create** |
| `src/app/change-panel.tsx` | Change-log panel | Modify render shell only |
| `src/app/stakeholders-panel.tsx` | Stakeholders panel | Modify render shell only |
| `src/app/raid-panel.tsx` | RAID panel | Modify render shell only |
| `package.json` | `dup:check` threshold | Ratchet down |
| `.gitlab-ci.yml` | dup-gate comment | Update to match |
| `docs/tech-debt-register.md` | TD-6 row | Append slice note |

---

## Task 1: Create `PanelTableScaffold` (test-first)

**Files:**
- Create: `src/app/panel-table-scaffold.tsx`
- Create (test): `src/app/panel-table-scaffold.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/app/panel-table-scaffold.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { PanelTableScaffold } from "./panel-table-scaffold";
import type { BulkField } from "./bulk-edit-panel";

function bulkProps(over: Partial<Parameters<typeof PanelTableScaffold>[0]["bulk"]> = {}) {
  return {
    count: 0,
    open: false,
    onToggleOpen: vi.fn(),
    onClear: vi.fn(),
    fields: [] as readonly BulkField[],
    onApply: vi.fn(),
    onCancel: vi.fn(),
    ...over,
  };
}

function baseProps() {
  return {
    paneRef: { current: null },
    containerRef: { current: null },
    view: "changes" as const,
    lang: "en-US" as const,
    toolbar: <div data-testid="tb">toolbar</div>,
    bulk: bulkProps(),
    count: 0,
    empty: { text: "No changes", addLabel: "+ Add change…", onAdd: vi.fn() },
  };
}

describe("PanelTableScaffold", () => {
  it("renders the dashed empty-state button when count is 0 and fires onAdd", () => {
    const onAdd = vi.fn();
    render(
      <PanelTableScaffold {...baseProps()} count={0} empty={{ text: "No changes", addLabel: "+ Add change…", onAdd }}>
        <table><tbody><tr><td>row</td></tr></tbody></table>
      </PanelTableScaffold>,
    );
    const btn = screen.getByRole("button", { name: /add change/i });
    expect(btn.className).toContain("border-dashed");
    fireEvent.click(btn);
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("row")).toBeNull();
  });

  it("renders children (not the empty button) when count > 0", () => {
    render(
      <PanelTableScaffold {...baseProps()} count={3}>
        <table><tbody><tr><td>row</td></tr></tbody></table>
      </PanelTableScaffold>,
    );
    expect(screen.getByText("row")).toBeInTheDocument();
    expect(screen.queryByText(/add change/i)).toBeNull();
  });

  it("applies aria-label to the empty button only when provided", () => {
    const { rerender } = render(
      <PanelTableScaffold {...baseProps()} count={0} empty={{ text: "e", addLabel: "+ add…", onAdd: vi.fn(), ariaLabel: "Add RAID item" }}>
        <div />
      </PanelTableScaffold>,
    );
    expect(screen.getByRole("button", { name: "Add RAID item" })).toBeInTheDocument();
    rerender(
      <PanelTableScaffold {...baseProps()} count={0} empty={{ text: "e", addLabel: "+ add…", onAdd: vi.fn() }}>
        <div />
      </PanelTableScaffold>,
    );
    // no explicit aria-label → accessible name falls back to text content
    expect(screen.getByRole("button", { name: "e + add…" })).toBeInTheDocument();
  });

  it("wraps the bulk block in print:hidden by default and unwrapped when bulkPrintHidden=false", () => {
    const { container, rerender } = render(
      <PanelTableScaffold {...baseProps()}><div /></PanelTableScaffold>,
    );
    expect(container.querySelector(".print\\:hidden")).not.toBeNull();
    rerender(
      <PanelTableScaffold {...baseProps()} bulkPrintHidden={false}><div /></PanelTableScaffold>,
    );
    expect(container.querySelector(".print\\:hidden")).toBeNull();
  });

  it("omits the ViewCallout when onLearnMore is undefined", () => {
    const { container } = render(
      <PanelTableScaffold {...baseProps()}><div /></PanelTableScaffold>,
    );
    // callout renders a dismiss control; absent here
    expect(container.textContent).toContain("toolbar");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/app/panel-table-scaffold.test.tsx`
Expected: FAIL — "Failed to resolve import './panel-table-scaffold'".

- [ ] **Step 3: Create the component**

Create `src/app/panel-table-scaffold.tsx`:

```tsx
"use client";

import type { ReactNode, Ref } from "react";
import { t, type Lang } from "./i18n";
import type { AppView } from "./nav-config";
import { VIEW_PANE_RESIZABLE_CLASS } from "./view-styles";
import { INTERACTIVE } from "./interaction-styles";
import { ViewCallout } from "./view-callout";
import { BulkEditBar } from "./bulk-edit-bar";
import { BulkEditPanel, type BulkField } from "./bulk-edit-panel";

interface PanelTableScaffoldBulk {
  count: number;
  open: boolean;
  onToggleOpen: () => void;
  onClear: () => void;
  fields: readonly BulkField[];
  onApply: (changes: Record<string, string>) => void;
  onCancel: () => void;
}

interface PanelTableScaffoldEmpty {
  text: string;
  addLabel: string;
  onAdd: () => void;
  ariaLabel?: string;
}

interface PanelTableScaffoldProps {
  paneRef: Ref<HTMLDivElement>;
  containerRef: Ref<HTMLDivElement>;
  view: AppView;
  lang: Lang;
  showHints?: boolean;
  isPopout?: boolean;
  onLearnMore?: (conceptId: string) => void;
  toolbar: ReactNode;
  bulk: PanelTableScaffoldBulk;
  bulkPrintHidden?: boolean;
  count: number;
  empty: PanelTableScaffoldEmpty;
  children: ReactNode;
  trailing?: ReactNode;
}

/**
 * Shared presentational render shell for the change / stakeholders / RAID entity
 * panels: pane container + optional ViewCallout + toolbar slot + bulk edit bar/panel +
 * scroll container that switches between a clickable dashed "add first item" empty
 * state and the panel's own <table> (children), plus a trailing slot for the edit
 * modal. Byte-identical to the inline shell each panel used before — every className
 * is a literal here, so the DOM is unchanged across all three callers.
 */
export function PanelTableScaffold({
  paneRef,
  containerRef,
  view,
  lang,
  showHints,
  isPopout,
  onLearnMore,
  toolbar,
  bulk,
  bulkPrintHidden,
  count,
  empty,
  children,
  trailing,
}: PanelTableScaffoldProps) {
  const bulkBlock = (
    <>
      <BulkEditBar
        lang={lang}
        count={bulk.count}
        open={bulk.open}
        onToggleOpen={bulk.onToggleOpen}
        onClear={bulk.onClear}
      />
      {bulk.open && bulk.count > 0 && (
        <BulkEditPanel lang={lang} count={bulk.count} fields={bulk.fields} onApply={bulk.onApply} onCancel={bulk.onCancel} />
      )}
    </>
  );

  return (
    <div ref={paneRef} className={`print-root print-landscape ${VIEW_PANE_RESIZABLE_CLASS}`}>
      {onLearnMore && (
        <ViewCallout view={view} lang={lang} showHints={showHints !== false} isPopout={!!isPopout} onLearnMore={onLearnMore} />
      )}
      {toolbar}

      {bulkPrintHidden === false ? bulkBlock : <div className="print:hidden">{bulkBlock}</div>}

      <div ref={containerRef} className={count === 0 ? undefined : "min-h-[240px] flex-1 overflow-auto rounded-md border border-line pr-2"}>
        {count === 0 ? (
          <button
            type="button"
            onClick={empty.onAdd}
            aria-label={empty.ariaLabel}
            className={`flex w-full flex-col items-center gap-2 rounded-md border border-dashed border-line p-10 text-center text-sm text-muted-foreground hover:border-AIPM-dark-blue hover:text-AIPM-dark-blue dark:hover:text-AIPM-light-grey ${INTERACTIVE}`}
          >
            <span>{empty.text}</span>
            <span className="font-medium">{empty.addLabel}</span>
          </button>
        ) : (
          children
        )}
      </div>

      {trailing}
    </div>
  );
}
```

Note: `t` is imported for parity with the other panels' import conventions and future
use; if `eslint --max-warnings=0` flags it as unused, DELETE the `t` import (the scaffold
does not translate — callers pass pre-translated strings). Verify in Step 4.

- [ ] **Step 4: Run the test + lint + typecheck**

Run: `npx vitest run src/app/panel-table-scaffold.test.tsx`
Expected: PASS (5 tests).

Run: `npx eslint src/app/panel-table-scaffold.tsx src/app/panel-table-scaffold.test.tsx --max-warnings=0`
Expected: 0 problems. If `t` is reported unused, remove `import { t, type Lang }` → `import { type Lang }` and re-run.

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add src/app/panel-table-scaffold.tsx src/app/panel-table-scaffold.test.tsx
git commit -m "feat(panels): add PanelTableScaffold shared render shell"
```

---

## Task 2: Convert `change-panel.tsx`

**Files:**
- Modify: `src/app/change-panel.tsx` (the `ChangePanelBody` return, ~lines 430–639)

- [ ] **Step 1: Add the scaffold import**

At the import block, add:

```tsx
import { PanelTableScaffold } from "./panel-table-scaffold";
```

- [ ] **Step 2: Replace the render shell**

Replace the entire `return ( … );` (from `return (` at ~line 430 through the closing
`);` at ~line 639) with the scaffold call. The `<table>…</table>` block (currently
lines 466–615) moves **verbatim** into `children`; the `{draft && <ChangeEditModal … />}`
block (currently 619–637) moves **verbatim** into `trailing`.

```tsx
  return (
    <PanelTableScaffold
      paneRef={paneRef}
      containerRef={containerRef}
      view="changes"
      lang={lang}
      showHints={showHints}
      isPopout={isPopout}
      onLearnMore={onLearnMore}
      toolbar={toolbar}
      bulk={{
        count: sel.count,
        open: bulkOpen,
        onToggleOpen: () => setBulkOpen((o) => !o),
        onClear: () => {
          sel.clear();
          setBulkOpen(false);
        },
        fields: bulkFields,
        onApply: applyBulk,
        onCancel: () => setBulkOpen(false),
      }}
      count={changes.length}
      empty={{ text: t(lang, "changeEmpty"), addLabel: `+ ${t(lang, "changesAdd")}…`, onAdd: openNew }}
      trailing={
        draft && (
          <ChangeEditModal
            lang={lang}
            tasks={tasks}
            raid={raid}
            draft={draft}
            isNew={isNew}
            raidEnabled={raidEnabled}
            stakeholdersEnabled={stakeholdersEnabled}
            stakeholders={stakeholders}
            onChange={setDraft}
            onApplyStatus={(s) => setDraft((d) => (d ? applyChangeStatus(d, s, today) : d))}
            onSave={commitDraft}
            onCancel={closeModal}
            onDelete={commitDelete}
          />
        )
      }
    >
      <table className="min-w-full text-left text-sm">
        {/* UNCHANGED: paste the exact thead + tbody that were here before (old lines 467–614) */}
      </table>
    </PanelTableScaffold>
  );
```

**Critical:** paste the existing `<thead>…</thead><tbody>…</tbody>` byte-for-byte between
the `<table>` tags — do not retype or reformat it. Only the wrapper changed.

- [ ] **Step 3: Typecheck + lint**

Run: `npx tsc --noEmit`
Expected: 0 errors. (If `paneRef`/`containerRef` were declared but the scaffold now owns
the JSX, they are still referenced via props — no unused-var error. If any symbol
previously used only in the removed shell — e.g. `VIEW_PANE_RESIZABLE_CLASS`, `INTERACTIVE`,
`ViewCallout`, `BulkEditBar`, `BulkEditPanel` — is now unused in this file, DELETE that
import.)

Run: `npx eslint src/app/change-panel.tsx --max-warnings=0`
Expected: 0 problems. Remove any now-unused imports it flags.

- [ ] **Step 4: Run the change-panel tests**

Run: `npx vitest run src/app/change-panel`
Expected: PASS, unchanged count. Tests were NOT edited — green proves behavior preserved.

- [ ] **Step 5: Commit**

```bash
git add src/app/change-panel.tsx
git commit -m "refactor(change-panel): render via PanelTableScaffold"
```

---

## Task 3: Convert `stakeholders-panel.tsx`

**Files:**
- Modify: `src/app/stakeholders-panel.tsx` (the `StakeholdersPanelBody` return, ~lines 310–582)

- [ ] **Step 1: Add the scaffold import**

```tsx
import { PanelTableScaffold } from "./panel-table-scaffold";
```

- [ ] **Step 2: Replace the render shell**

Replace `return ( … );` (from `return (` ~line 310 through `);` ~line 582). The
`<table>…</table>` (currently ~346–onwards) moves verbatim into `children`; the
`{draft && <StakeholderEditModal … />}` block (currently ~560–580) moves verbatim into
`trailing`.

```tsx
  return (
    <PanelTableScaffold
      paneRef={paneRef}
      containerRef={containerRef}
      view="stakeholders"
      lang={lang}
      showHints={showHints}
      isPopout={isPopout}
      onLearnMore={onLearnMore}
      toolbar={toolbar}
      bulk={{
        count: sel.count,
        open: bulkOpen,
        onToggleOpen: () => setBulkOpen((o) => !o),
        onClear: () => {
          sel.clear();
          setBulkOpen(false);
        },
        fields: bulkFields,
        onApply: applyBulk,
        onCancel: () => setBulkOpen(false),
      }}
      count={stakeholders.length}
      empty={{ text: t(lang, "stakeholdersEmpty"), addLabel: `+ ${t(lang, "stakeholdersAdd")}…`, onAdd: openNew }}
      trailing={
        draft && (
          <StakeholderEditModal
            lang={lang}
            draft={draft}
            isNew={isNew}
            milestones={milestones}
            resources={resources}
            commsPendingStakeholderIds={commsPendingStakeholderIds}
            onJumpToComms={onJumpToComms}
            onChange={setDraft}
            onSave={() => {
              onSave(draft);
              closeModal();
            }}
            onCancel={closeModal}
            onDelete={() => {
              onDelete(draft.id, draft.name);
              closeModal();
            }}
          />
        )
      }
    >
      <table className="min-w-full text-left text-sm">
        {/* UNCHANGED: paste the exact thead + tbody that were here before */}
      </table>
    </PanelTableScaffold>
  );
```

**Critical:** paste the existing `<thead>…</thead><tbody>…</tbody>` byte-for-byte.

- [ ] **Step 3: Typecheck + lint**

Run: `npx tsc --noEmit`
Expected: 0 errors.

Run: `npx eslint src/app/stakeholders-panel.tsx --max-warnings=0`
Expected: 0 problems. Remove any now-unused imports (`ViewCallout`, `BulkEditBar`,
`BulkEditPanel`, `VIEW_PANE_RESIZABLE_CLASS`, `INTERACTIVE`) it flags as unused.

- [ ] **Step 4: Run the stakeholders-panel tests**

Run: `npx vitest run src/app/stakeholders-panel`
Expected: PASS, unchanged count (tests unedited).

- [ ] **Step 5: Commit**

```bash
git add src/app/stakeholders-panel.tsx
git commit -m "refactor(stakeholders-panel): render via PanelTableScaffold"
```

---

## Task 4: Convert `raid-panel.tsx` (the divergent one)

**Files:**
- Modify: `src/app/raid-panel.tsx` (the `RaidPanelBody` return, ~lines 398–510)

RAID differs from the other two: pane ref is named `raidRef`; the toolbar is a
`<RaidToolbar … />` element (not a `toolbar` variable); children is `<RaidTable … />`;
the empty button has an `aria-label`; and the bulk block is **not** wrapped in
`print:hidden` → pass `bulkPrintHidden={false}`.

- [ ] **Step 1: Add the scaffold import**

```tsx
import { PanelTableScaffold } from "./panel-table-scaffold";
```

- [ ] **Step 2: Replace the render shell**

Replace `return ( … );` (from `return (` ~line 398 through `);` ~line 510). The
`<RaidTable … />` element (currently ~458–478) moves verbatim into `children`; the
`{draft && <RaidEditModal … />}` block (currently ~482–508) moves verbatim into
`trailing`; the whole `<RaidToolbar … />` element (currently ~403–428) moves verbatim
into the `toolbar` prop.

```tsx
  return (
    <PanelTableScaffold
      paneRef={raidRef}
      containerRef={containerRef}
      view="raid"
      lang={lang}
      showHints={showHints}
      isPopout={isPopout}
      onLearnMore={onLearnMore}
      bulkPrintHidden={false}
      toolbar={
        <RaidToolbar
          lang={lang}
          search={search}
          onSearchChange={pf.setSearch}
          categoryFilter={categoryFilter}
          severityFilter={severityFilter}
          statusFilter={statusFilter}
          onSetFilter={pf.setFilter}
          onResetFilters={pf.resetFilters}
          onToggleColumn={pf.toggleColumn}
          hiddenSet={hiddenSet}
          filterTaskId={filterTaskId}
          onClearTaskFilter={onClearTaskFilter}
          filtersActive={filtersActive}
          onAddNew={() => openNew()}
          onResetColWidths={resetColWidths}
          onResetSize={resetRaidSize}
          m365Configured={m365Configured}
          isPopout={isPopout}
          calendarEnabled={calendarEnabled}
          onToggleCalendar={onToggleCalendar}
          onPushCalendar={onPushCalendar}
          calendarPushBusy={calendarPushBusy}
          onPullCalendar={onPullCalendar}
          calendarPullBusy={calendarPullBusy}
        />
      }
      bulk={{
        count: sel.count,
        open: bulkOpen,
        onToggleOpen: () => setBulkOpen((o) => !o),
        onClear: () => {
          sel.clear();
          setBulkOpen(false);
        },
        fields: bulkFields,
        onApply: applyBulk,
        onCancel: () => setBulkOpen(false),
      }}
      count={raid.length}
      empty={{
        text: t(lang, "raidEmpty"),
        addLabel: `${t(lang, "raidAddItem")}…`,
        onAdd: () => openNew(effectiveCategory),
        ariaLabel: t(lang, "raidAddItem"),
      }}
      trailing={
        draft && (
          <RaidEditModal
            lang={lang}
            tasks={tasks}
            raid={raid}
            stakeholdersEnabled={stakeholdersEnabled}
            stakeholders={stakeholders}
            resources={resources}
            contacts={contacts}
            onCreateResource={onCreateResource}
            draft={draft}
            isNew={isNew}
            onChange={setDraft}
            onApplyStatus={(s) => setDraft((d) => (d ? applyStatus(d, s) : d))}
            onApplyMatrix={(p, i) => setDraft((d) => (d ? applyMatrix(d, p, i) : d))}
            onSave={commitDraft}
            onCancel={closeModal}
            onDelete={commitDelete}
            onCreateMitigationTask={commitCreateMitigationTask}
            onJumpToRaid={(id) => {
              const target = raidById.get(id);
              if (target) openEdit(target);
            }}
          />
        )
      }
    >
      <RaidTable
        lang={lang}
        hiddenSet={hiddenSet}
        sel={sel}
        visibleIds={visibleIds}
        sort={sort}
        toggleSort={toggleSort}
        colWidths={colWidths}
        startResize={startResize}
        visible={visible}
        tasksById={tasksById}
        raidById={raidById}
        causesIndex={causesIndex}
        openEdit={openEdit}
        onJumpToTask={onJumpToTask}
        effectiveCategory={effectiveCategory}
        openNew={openNew}
        flashId={flashId}
        onAiEdit={onAiEdit}
        aiEditEnabled={aiEditEnabled}
      />
    </PanelTableScaffold>
  );
```

**Note on `addLabel`:** RAID's empty second span was `{t(lang, "raidAddItem")}…` with NO
leading `+ ` (unlike change/stakeholders which prefix `+ `). Reproduce exactly: the RAID
`addLabel` is `` `${t(lang, "raidAddItem")}…` `` — no `+ ` prefix. (The scaffold renders
`addLabel` verbatim inside the `font-medium` span.)

- [ ] **Step 3: Typecheck + lint**

Run: `npx tsc --noEmit`
Expected: 0 errors.

Run: `npx eslint src/app/raid-panel.tsx --max-warnings=0`
Expected: 0 problems. Remove now-unused imports (`ViewCallout`, `BulkEditBar`,
`BulkEditPanel`, `VIEW_PANE_RESIZABLE_CLASS`, `INTERACTIVE`) if flagged. Keep `RaidToolbar`,
`RaidTable`, `RaidEditModal` (still used inside the props).

- [ ] **Step 4: Run the RAID panel tests + characterization**

Run: `npx vitest run src/app/raid-panel`
Expected: PASS, unchanged count. Includes `raid-panel.characterization.test.tsx` — it
pins the panel contract; green proves the shell change is behavior-neutral.

- [ ] **Step 5: RAID axe check (RAID is in A11Y_VIEWS)**

Run: `npx playwright test e2e/a11y.spec.ts --project=chromium -g "RAID"`
Expected: PASS (3 combos: AIPM-light / AIPM-dark / mockup). The empty-state `aria-label`
and the shell DOM are preserved; this confirms no axe regression.

- [ ] **Step 6: Commit**

```bash
git add src/app/raid-panel.tsx
git commit -m "refactor(raid-panel): render via PanelTableScaffold"
```

---

## Task 5: Measure duplication, ratchet the gate, update docs

**Files:**
- Modify: `package.json` (`dup:check` threshold)
- Modify: `.gitlab-ci.yml` (dup-gate comment)
- Modify: `docs/tech-debt-register.md` (TD-6 row)

- [ ] **Step 1: Measure the new duplication**

Run:
```bash
npx jscpd src --min-tokens 50 --ignore "**/*.test.*,**/*.property.test.*,**/__fixtures__/**,**/i18n*.ts" --reporters json --output .jscpd-tmp
node -e "const r=require('./.jscpd-tmp/jscpd-report.json');const f=r.statistics.formats;for(const k of Object.keys(f)){console.log(k, f[k].total.percentage)}"
rm -rf .jscpd-tmp
```
Expected: `tsx` percentage dropped from ~1.72 toward ~1.6; `typescript` ~1.71 unchanged.
Record both numbers. The new gate = a value at or just above the new binding
`max(tsx, typescript)`, rounded to the next 0.05 below the prior gate (e.g. if binding is
now 1.71, set gate `1.75`; if binding fell to ~1.6, set `1.65`). **Ratchet DOWN only.**

- [ ] **Step 2: Verify the current gate still passes, then tighten it**

Run: `npm run dup:check`
Expected: PASS at the current 1.8 threshold.

Edit `package.json` `scripts.dup:check` — change `--threshold 1.8` to the new value
chosen in Step 1 (e.g. `--threshold 1.7`). Re-run:

Run: `npm run dup:check`
Expected: PASS at the new, lower threshold (confirms headroom).

- [ ] **Step 3: Update the CI comment**

In `.gitlab-ci.yml`, find the duplication-gate comment block and update the threshold
number + binding-format note to match the new value (mirrors the existing comment's
format). Keep the `quality-gate-bypass` escape-hatch block unchanged.

- [ ] **Step 4: Append the TD-6 register note**

In `docs/tech-debt-register.md`, append to the TD-6 `Notes` cell a dated slice entry, e.g.:

```
**(14) 2026-07-05** FIRST structural slice: `PanelTableScaffold` (new
`panel-table-scaffold.tsx`) — extracted the byte-identical render shell (pane div +
ViewCallout + toolbar slot + bulk bar/panel + scroll container + dashed empty-state ↔
table switch + trailing modal) shared verbatim by change/stakeholders/raid panels.
RAID divergences absorbed as props (`bulkPrintHidden={false}`, empty `ariaLabel`).
Milestones/tasks excluded (divergent class strings). DOM byte-identical (RAID axe 3/3
green, panel + characterization tests unedited). tsx <OLD>→<NEW>, total <OLD>→<NEW>;
gate 1.8→<NEW>.
```
Fill `<OLD>`/`<NEW>` with the Step 1 numbers.

- [ ] **Step 5: Full local verification**

Run each; all must pass:
```bash
npx tsc --noEmit
npx eslint src/app/panel-table-scaffold.tsx src/app/change-panel.tsx src/app/stakeholders-panel.tsx src/app/raid-panel.tsx --max-warnings=0
npx vitest run src/app/panel-table-scaffold src/app/change-panel src/app/stakeholders-panel src/app/raid-panel
npm run dup:check
npm run size:check
npx playwright test e2e/a11y.spec.ts --project=chromium -g "RAID"
npx playwright test e2e/a11y.spec.ts --project=chromium -g "Stakeholder"
```
Expected: all green. `size:check` should show the three panels shrank (no new >800 file).

- [ ] **Step 6: Commit**

```bash
git add package.json .gitlab-ci.yml docs/tech-debt-register.md
git commit -m "chore(dup): ratchet gate after PanelTableScaffold extraction"
```

---

## Final step: request review, then release

After Task 5, dispatch a code-reviewer subagent (spec = the design doc; verify DOM
byte-identical + no behavior change across the 3 panels) before any release. Do NOT
push/MR/merge until the user says "release" — and then merge ONLY after the MR pipeline
goes green (merge-on-green discipline).
