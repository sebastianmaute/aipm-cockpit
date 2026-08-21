# Stakeholder / UI Refinement Batch (v0.53.0 "Asimov") — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Seven independent refinements building on the v0.52.0 Stakeholder/RACI feature plus existing UI patterns.

**Architecture:** Mostly small, localized UI edits. Two new files (`influence-interest-matrix.tsx`, `stakeholder-report-panel.tsx`). One read-only report wired through the existing `ADDABLE_REPORTS` registry. Sample data seeded into both sample-workspace files and guarded by a round-trip parse test. No storage schema change (stays v8).

**Tech Stack:** Next.js (app dir), React, TypeScript, Tailwind (AIPM 9-colour palette), Vitest 4 + Testing Library, fake-indexeddb.

**Branch:** `feat-stakeholder-ui-batch` (already created off `main`; truncated `sample-workspace.md` already restored from HEAD).

**Project-specific constraints (read before any task):**
- Commands: `npm run test:run` (all tests), `npx vitest run src/app/<file>` (one file), `npm run lint` (**`--max-warnings=0`** — any unused import/var FAILS), `npx tsc --noEmit`.
- `Lang` type is `"en-US" | "en-GB" | "de"`. Use `"en-US"` in component tests, never `"en"`.
- Palette: only AIPM tokens (`AIPM-green`, `AIPM-dark-blue`, `AIPM-purple` #aa4899, `AIPM-pink`, `AIPM-light-grey`, `AIPM-blue`, surface/line/foreground/muted-foreground). Amber RAG = dot `bg-amber-500`, text `text-AIPM-purple`. No gradients/shadows/off-palette (`text-amber-700` etc. are forbidden).
- **`i18n.ts`** is ASCII — edit with the Edit tool freely.
- **`i18n.de.ts` MUST stay ASCII-only and CRLF.** Do NOT use the Edit tool on it (it corrupts `"` into curly quotes). Patch it via a Node one-liner with a CRLF-aware anchor (match the line WITHOUT its trailing newline). Verify after with `npx tsc --noEmit` (a missing DE key fails typecheck) and a grep for non-ASCII.
- Commit via the Bash tool heredoc: `git commit -F - <<'EOF' … EOF`. Conventional-commit subjects. No attribution footer (disabled globally).

---

## Type / signature reference (used across tasks)

```ts
// types.ts (existing)
export type InfluenceInterest = "Low" | "Medium" | "High";
export const INFLUENCE_INTEREST_LEVELS: InfluenceInterest[]; // ["Low","Medium","High"]
export type Stakeholder = {
  id: number; name: string; organization?: string; title?: string; email?: string;
  category: StakeholderCategory; influence: InfluenceInterest; interest: InfluenceInterest;
  notes?: string; resourceId?: number | null; raci: Record<string, RaciRole>; localModifiedAt?: string;
};
export type Milestone = { id: number; name: string; date: string; description?: string; achievedDate?: string; linkedTaskIds: number[]; localModifiedAt?: string; };

// stakeholders.ts (existing)
quadrantFor(s: Stakeholder): StakeholderQuadrant; // "manage-closely"|"keep-satisfied"|"keep-informed"|"monitor"; only "High" counts as high on each axis
accountableCountByMilestone(stakeholders, milestoneId): number;
raciWarningFor(count): "missing" | "multiple" | null; // 0 → "missing", >1 → "multiple"
```

---

## Task 1: `+` prefix on the Change Log "Add" button

**Files:**
- Modify: `src/app/change-panel.tsx` (toolbar button, ~line 206-212)

- [ ] **Step 1: Edit the button label**

In `change-panel.tsx`, the toolbar button currently renders `{t(lang, "changesAdd")}`. Change its children to prepend a `+`:

```tsx
      <button
        type="button"
        onClick={openNew}
        className="rounded-md border border-AIPM-dark-blue bg-AIPM-dark-blue px-2.5 py-1.5 text-xs font-medium text-white hover:bg-AIPM-dark-blue/90"
      >
        + {t(lang, "changesAdd")}
      </button>
```

- [ ] **Step 2: Verify build + existing tests**

Run: `npx vitest run src/app/change-panel.test.tsx` (if present) and `npx tsc --noEmit`
Expected: PASS. If a test asserts the button's exact text equals "Add change", update it to match `+ Add change` (use `getByRole("button", { name: /add change/i })`, which matches regardless of the `+`).

- [ ] **Step 3: Commit**

```bash
git add src/app/change-panel.tsx src/app/change-panel.test.tsx 2>/dev/null
git commit -F - <<'EOF'
feat: prefix the Change Log add button with "+"
EOF
```

---

## Task 2: Visible "+ Add stakeholder" label on the Stakeholders button

**Files:**
- Modify: `src/app/stakeholders-panel.tsx` (toolbar button, ~line 162-174)
- Test: `src/app/stakeholders-panel.test.tsx`

- [ ] **Step 1: Inspect the existing test assumptions**

Read `src/app/stakeholders-panel.test.tsx`. Any assertion that relies on the add button showing only `+` (e.g. `getByText("+")`, or a comment that "Add stakeholder" text appears only in the modal `<h2>`) must be updated in Step 3.

- [ ] **Step 2: Edit the button to show the label**

In `stakeholders-panel.tsx`, replace the toolbar add button (keep the `aria-label`/`title` for the accessible name; add visible text):

```tsx
      <button
        type="button"
        onClick={openNew}
        aria-label={t(lang, "stakeholdersAdd")}
        title={t(lang, "stakeholdersAdd")}
        className="rounded-md border border-AIPM-dark-blue bg-AIPM-dark-blue px-2.5 py-1.5 text-xs font-medium text-white hover:bg-AIPM-dark-blue/90"
      >
        + {t(lang, "stakeholdersAdd")}
      </button>
```

Also delete the now-stale comment block immediately above the button (the one explaining that the visible text is only `+`).

- [ ] **Step 3: Update tests that assumed bare `+`**

Any test opening the modal via the add button should select it by role:
```tsx
fireEvent.click(screen.getByRole("button", { name: /add stakeholder/i }));
```
If a test asserted that "Add stakeholder" text appears exactly once (only in the modal heading), scope that assertion to the dialog, e.g. `within(screen.getByRole("dialog")).getByText(...)`, or assert on the heading role instead: `screen.getByRole("heading", { name: /add stakeholder/i })`.

- [ ] **Step 4: Run tests**

Run: `npx vitest run src/app/stakeholders-panel.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/app/stakeholders-panel.tsx src/app/stakeholders-panel.test.tsx
git commit -F - <<'EOF'
feat: show "+ Add stakeholder" label on the register add button
EOF
```

---

## Task 3: Dashboard "Clear" button (clear + persist empty narrative)

**Files:**
- Modify: `src/app/dashboard-panel.tsx` (Status-Summary section, ~line 125-206)
- Modify: `src/app/i18n.ts` (after `dashboardStatusSave`, ~line 1344)
- Modify: `src/app/i18n.de.ts` (after `dashboardStatusSave`, ~line 1362)
- Test: `src/app/dashboard-panel.test.tsx`

- [ ] **Step 1: Add the i18n key (EN)**

In `src/app/i18n.ts`, immediately after the `dashboardStatusSave: "Save",` line, add:
```ts
  dashboardStatusClear: "Clear",
```

- [ ] **Step 2: Add the i18n key (DE) via Node byte-patch (CRLF-aware)**

Do NOT use the Edit tool on `i18n.de.ts`. Run this from the repo root (PowerShell or Bash tool):
```bash
node -e "const fs=require('fs');const p='src/app/i18n.de.ts';let s=fs.readFileSync(p,'utf8');const a='  dashboardStatusSave: \"Speichern\",';if(!s.includes(a))throw new Error('anchor not found');s=s.replace(a, a+'\r\n  dashboardStatusClear: \"Leeren\",');fs.writeFileSync(p,s);console.log('patched');"
```
Then verify ASCII-only and typecheck:
```bash
node -e "const s=require('fs').readFileSync('src/app/i18n.de.ts','utf8');const m=s.match(/[^\x00-\x7F]/);console.log(m?('NON-ASCII at '+s.indexOf(m[0])):'ASCII OK')"
npx tsc --noEmit
```
Expected: `patched`, `ASCII OK`, tsc clean.

- [ ] **Step 3: Write the failing test**

In `src/app/dashboard-panel.test.tsx`, add a test. Follow the existing render harness in that file (it renders `<DashboardPanel … />` inside the workspace provider). The clear button is found by role and, when clicked, persists an empty narrative. Use whatever the file's existing pattern is for seeding `status.narrative`; assert the textarea empties and the saved value becomes empty:

```tsx
it("Clear empties and persists the status narrative", () => {
  // Arrange: render with a non-empty narrative (use the file's existing harness/helper)
  renderDashboard({ status: { narrative: "Some summary", scopeOverride: "G" } });
  const clear = screen.getByRole("button", { name: /clear/i });
  expect(clear).not.toBeDisabled();
  // Act
  fireEvent.click(clear);
  // Assert
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("");
});

it("Clear is disabled when the narrative is already empty", () => {
  renderDashboard({ status: { narrative: "", scopeOverride: "G" } });
  expect(screen.getByRole("button", { name: /clear/i })).toBeDisabled();
});
```
If the file lacks a `renderDashboard` helper that accepts a seeded status, adapt to its actual setup (it may set status via the workspace context mock). Match the existing tests' approach exactly.

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run src/app/dashboard-panel.test.tsx`
Expected: FAIL (no "Clear" button yet).

- [ ] **Step 5: Add a clearNarrative handler**

In `dashboard-panel.tsx`, just after `commitNarrative` (~line 129), add:
```tsx
  const clearNarrative = () => {
    setDraftNarrative("");
    if ((status.narrative ?? "") !== "") {
      setStatus((s) => ({ ...s, narrative: "", narrativeUpdatedAt: new Date().toISOString() }));
    }
  };
```

- [ ] **Step 6: Render the Clear button right of Save**

In the Status-Summary footer (~line 198-205), wrap Save + Clear so Clear sits to the right of Save:
```tsx
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={commitNarrative}
                disabled={draftNarrative.trim() === (status.narrative ?? "")}
                className="rounded-md bg-AIPM-dark-blue px-3 py-1 text-xs font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 print:hidden"
              >
                {t(lang, "dashboardStatusSave")}
              </button>
              <button
                type="button"
                onClick={clearNarrative}
                disabled={(status.narrative ?? "") === "" && draftNarrative === ""}
                className="rounded-md border border-line bg-surface px-3 py-1 text-xs font-medium text-foreground hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50 print:hidden"
              >
                {t(lang, "dashboardStatusClear")}
              </button>
            </div>
```
(The existing Save button is currently the last child of the flex row that also holds the "updated" span; keep that span before this `<div>`.)

- [ ] **Step 7: Run test to verify it passes**

Run: `npx vitest run src/app/dashboard-panel.test.tsx`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/app/dashboard-panel.tsx src/app/dashboard-panel.test.tsx src/app/i18n.ts src/app/i18n.de.ts
git commit -F - <<'EOF'
feat: add a Clear button to the dashboard status summary
EOF
```

---

## Task 4: Resizable RACI matrix + Influence/Interest map panes

**Files:**
- Modify: `src/app/raci-panel.tsx`
- Modify: `src/app/stakeholder-map-panel.tsx`
- Test: `src/app/raci-panel.test.tsx`, `src/app/stakeholder-map-panel.test.tsx`

Reference pattern (from `stakeholders-panel.tsx`): `useResizable("lop-app:<key>")` returns `{ ref, reset }`; wrap root in `VIEW_PANE_RESIZABLE_CLASS` with `ref`; add `<ResetSizeButton onClick={reset} lang={lang} />` in a toolbar; render `<ResizeCornerHint lang={lang} />` last. Imports:
```tsx
import { useResizable } from "./use-resizable";
import { VIEW_PANE_RESIZABLE_CLASS } from "./view-styles";
import { ResetSizeButton, ResizeCornerHint } from "./task-manager-ui";
```

- [ ] **Step 1: Write a failing test for the RACI pane reset button**

In `src/app/raci-panel.test.tsx`, add (use the file's existing `stakeholders`/`milestones` fixtures):
```tsx
it("renders a reset-size button (resizable pane)", () => {
  render(<RaciPanel lang="en-US" stakeholders={stakeholders} milestones={milestones} onSave={vi.fn()} />);
  expect(screen.getByRole("button", { name: /reset size/i })).toBeInTheDocument();
});
```
Note: `ResetSizeButton`'s accessible name comes from i18n key `resetSize` (verify the exact EN string in `i18n.ts`; if it differs, match the regex to it, e.g. `/reset size/i`).

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run src/app/raci-panel.test.tsx`
Expected: FAIL (no reset button).

- [ ] **Step 3: Make `raci-panel.tsx` resizable**

Replace the main return (the non-empty-state branch) so the root uses the resizable pane and a toolbar carries the reset button beside the title. Keep the two early `return` empty states as-is (they use `VIEW_PANE_CLASS` and need no resize). Add the hook call near the top of the component body:
```tsx
  const { ref: paneRef, reset: resetPaneSize } = useResizable("lop-app:raci-size");
```
Main return:
```tsx
  return (
    <div ref={paneRef} className={`${VIEW_PANE_RESIZABLE_CLASS} print-root`}>
      <div className="mb-2 flex shrink-0 flex-wrap items-center gap-2">
        <h2 className="text-base font-semibold text-foreground">
          {t(lang, "stakeholderRaciTitle")}
        </h2>
        <span className="ml-auto" />
        <ResetSizeButton onClick={resetPaneSize} lang={lang} />
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-md border border-line">
        <table className="min-w-full text-left text-sm">
          {/* …unchanged thead/tbody… */}
        </table>
      </div>

      <p className="mt-3 shrink-0 text-xs text-muted-foreground">{t(lang, "raciLegend")}</p>
      <ResizeCornerHint lang={lang} />
    </div>
  );
```
(Move the existing `<table>` markup into the new scroll `<div>`; drop the old outer `p-6` wrapper. The previous `overflow-x-auto rounded-md border` div is replaced by the `flex-1 overflow-auto` one.)

- [ ] **Step 4: Run the RACI test**

Run: `npx vitest run src/app/raci-panel.test.tsx`
Expected: PASS.

- [ ] **Step 5: Write a failing test for the map pane reset button**

In `src/app/stakeholder-map-panel.test.tsx`:
```tsx
it("renders a reset-size button (resizable pane)", () => {
  render(<StakeholderMapPanel lang="en-US" stakeholders={items} />);
  expect(screen.getByRole("button", { name: /reset size/i })).toBeInTheDocument();
});
```

- [ ] **Step 6: Run it to confirm it fails**

Run: `npx vitest run src/app/stakeholder-map-panel.test.tsx`
Expected: FAIL.

- [ ] **Step 7: Make `stakeholder-map-panel.tsx` resizable**

Add the hook in the component body:
```tsx
  const { ref: paneRef, reset: resetPaneSize } = useResizable("lop-app:stakeholder-map-size");
```
Change the root wrapper from `${VIEW_PANE_CLASS} flex flex-col gap-4 p-6` to the resizable class and attach the ref, add a header row with the reset button, and a corner hint at the end:
```tsx
  return (
    <div ref={paneRef} className={`${VIEW_PANE_RESIZABLE_CLASS} gap-4`}>
      <div className="flex shrink-0 items-center gap-2">
        <h2 className="text-sm font-semibold text-AIPM-dark-blue">
          {t(lang, "stakeholderMapTitle")}
        </h2>
        <span className="ml-auto" />
        <ResetSizeButton onClick={resetPaneSize} lang={lang} />
      </div>

      {/* …existing empty-state / grid body unchanged, but ensure the grid
          container keeps `min-h-0 flex-1` so it fills the resized pane… */}

      <ResizeCornerHint lang={lang} />
    </div>
  );
```
Keep the inner axis-label + 2×2 grid markup exactly as-is (it already uses `min-h-0 flex-1`). Remove the now-duplicated outer `flex flex-col` since `VIEW_PANE_RESIZABLE_CLASS` already provides the column flex (verify by reading `view-styles.ts`; if it does not include `flex flex-col`, keep those utilities).

- [ ] **Step 8: Run the map test**

Run: `npx vitest run src/app/stakeholder-map-panel.test.tsx`
Expected: PASS.

- [ ] **Step 9: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: clean (remove any now-unused `VIEW_PANE_CLASS` import if it's no longer referenced — unused imports FAIL lint).

- [ ] **Step 10: Commit**

```bash
git add src/app/raci-panel.tsx src/app/stakeholder-map-panel.tsx src/app/raci-panel.test.tsx src/app/stakeholder-map-panel.test.tsx
git commit -F - <<'EOF'
feat: make the RACI matrix and influence/interest map resizable panes
EOF
```

---

## Task 5: Influence/Interest 3×3 click-matrix (replaces the two dropdowns)

**Files:**
- Create: `src/app/influence-interest-matrix.tsx`
- Create: `src/app/influence-interest-matrix.test.tsx`
- Modify: `src/app/stakeholder-edit-modal.tsx` (replace the Influence + Interest `<select>`s, ~line 202-238)
- Modify: `src/app/stakeholder-edit-modal.test.tsx`

Orientation (matches `stakeholder-map-panel.tsx`): **X = Interest** Low→High left→right; **Y = Influence** High(top)→Low(bottom). Level↔index: `Low=1, Medium=2, High=3`.

- [ ] **Step 1: Write the failing component test**

Create `src/app/influence-interest-matrix.test.tsx`:
```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { InfluenceInterestMatrix } from "./influence-interest-matrix";

describe("InfluenceInterestMatrix", () => {
  it("renders 9 cells and marks the selected one pressed", () => {
    render(<InfluenceInterestMatrix lang="en-US" influence="High" interest="Medium" onPick={vi.fn()} />);
    const cells = screen.getAllByRole("button");
    expect(cells).toHaveLength(9);
    // selected cell = influence High + interest Medium
    const selected = screen.getByRole("button", { name: /influence high.*interest medium/i });
    expect(selected).toHaveAttribute("aria-pressed", "true");
  });

  it("calls onPick with the clicked cell's influence and interest", () => {
    const onPick = vi.fn();
    render(<InfluenceInterestMatrix lang="en-US" influence="Low" interest="Low" onPick={onPick} />);
    fireEvent.click(screen.getByRole("button", { name: /influence high.*interest high/i }));
    expect(onPick).toHaveBeenCalledWith("High", "High");
  });
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run src/app/influence-interest-matrix.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement the component**

Create `src/app/influence-interest-matrix.tsx`:
```tsx
"use client";

// Clickable 3x3 influence/interest matrix. Adapted from RaidPanel's RiskMatrix
// (function, style, makeup): one <button> per cell, axis labels flanking the
// grid, selected cell ringed. X = interest (Low->High, left->right),
// Y = influence (High at top -> Low at bottom), matching the stakeholder map.
// Clicking a cell reports BOTH influence and interest in one onPick call.

import { type Lang, t, type TranslationKey } from "./i18n";
import { INFLUENCE_INTEREST_LEVELS, type InfluenceInterest } from "./types";

const LEVEL_LABEL_KEYS: Record<InfluenceInterest, TranslationKey> = {
  Low: "levelLow",
  Medium: "levelMedium",
  High: "levelHigh",
};

// Score 2..6 (influenceIdx + interestIdx, 1-based) → quadrant-ish tint using
// brand tokens only. High/High is the strongest; Low/Low the faintest.
function cellTint(score: number): string {
  if (score >= 6) return "bg-AIPM-green/30 hover:bg-AIPM-green/40";
  if (score >= 5) return "bg-AIPM-green/20 hover:bg-AIPM-green/30";
  if (score >= 4) return "bg-AIPM-purple/15 hover:bg-AIPM-purple/25";
  if (score >= 3) return "bg-AIPM-light-grey/30 hover:bg-AIPM-light-grey/40";
  return "bg-surface-muted hover:bg-AIPM-light-grey/30";
}

export interface InfluenceInterestMatrixProps {
  lang: Lang;
  influence: InfluenceInterest;
  interest: InfluenceInterest;
  onPick: (influence: InfluenceInterest, interest: InfluenceInterest) => void;
}

export function InfluenceInterestMatrix({ lang, influence, interest, onPick }: InfluenceInterestMatrixProps) {
  const idx = (l: InfluenceInterest) => INFLUENCE_INTEREST_LEVELS.indexOf(l) + 1; // 1..3
  // Rows top->bottom: High, Medium, Low (influence). Cols left->right: Low, Medium, High (interest).
  const rows: InfluenceInterest[] = ["High", "Medium", "Low"];
  const cols: InfluenceInterest[] = ["Low", "Medium", "High"];
  const influenceLabel = t(lang, "stakeholderFieldInfluence");
  const interestLabel = t(lang, "stakeholderFieldInterest");

  return (
    <div className="inline-flex items-stretch gap-1">
      {/* Vertical influence axis label */}
      <div className="flex w-4 items-center justify-center">
        <span className="whitespace-nowrap text-[10px] text-muted-foreground" style={{ transform: "rotate(-90deg)" }}>
          &larr; {influenceLabel} &rarr;
        </span>
      </div>

      <div className="inline-block">
        {rows.map((inf) => (
          <div key={`row-${inf}`} className="grid grid-cols-[auto_repeat(3,3.5rem)] gap-0.5">
            <span className="self-center pr-1 text-right text-[10px] text-muted-foreground" style={{ width: "3rem" }}>
              {t(lang, LEVEL_LABEL_KEYS[inf])}
            </span>
            {cols.map((intr) => {
              const isSelected = influence === inf && interest === intr;
              const score = idx(inf) + idx(intr);
              return (
                <button
                  key={`cell-${inf}-${intr}`}
                  type="button"
                  aria-pressed={isSelected}
                  aria-label={`${influenceLabel} ${t(lang, LEVEL_LABEL_KEYS[inf])}, ${interestLabel} ${t(lang, LEVEL_LABEL_KEYS[intr])}`}
                  onClick={() => onPick(inf, intr)}
                  className={`h-12 w-14 rounded text-[10px] font-medium text-foreground ${cellTint(score)} ${isSelected ? "ring-2 ring-AIPM-green ring-offset-1" : ""}`}
                />
              );
            })}
          </div>
        ))}
        {/* Horizontal interest axis label */}
        <div className="mt-1 grid grid-cols-[auto_repeat(3,3.5rem)] gap-0.5">
          <span style={{ width: "3rem" }} />
          <span className="col-span-3 text-center text-[10px] text-muted-foreground">
            &larr; {interestLabel} &rarr;
          </span>
        </div>
      </div>
    </div>
  );
}
```
Note: the aria-label regex `/influence high.*interest medium/i` in the test matches `"Influence High, Interest Medium"` because `stakeholderFieldInfluence` = "Influence" and `stakeholderFieldInterest` = "Interest" (verify those EN strings in `i18n.ts`; if they read differently, adjust the test regex to the actual labels).

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run src/app/influence-interest-matrix.test.tsx`
Expected: PASS.

- [ ] **Step 5: Swap the dropdowns in the edit modal**

In `src/app/stakeholder-edit-modal.tsx`:
- Add import: `import { InfluenceInterestMatrix } from "./influence-interest-matrix";`
- Remove the two `<label>` blocks for Influence and Interest (the two `<select>`s, ~line 202-238).
- In their place (spanning both columns) add:
```tsx
          {/* Influence / Interest matrix — one click sets both */}
          <div className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="font-medium text-foreground">
              {t(lang, "stakeholderFieldInfluence")} / {t(lang, "stakeholderFieldInterest")}
            </span>
            <InfluenceInterestMatrix
              lang={lang}
              influence={draft.influence}
              interest={draft.interest}
              onPick={(influence, interest) => onChange({ ...draft, influence, interest })}
            />
            <span className="text-xs text-muted-foreground">
              {t(lang, "stakeholderFieldInfluence")}: {t(lang, LEVEL_LABEL_KEYS[draft.influence])}
              {" · "}
              {t(lang, "stakeholderFieldInterest")}: {t(lang, LEVEL_LABEL_KEYS[draft.interest])}
            </span>
          </div>
```
`LEVEL_LABEL_KEYS` already exists in this file. If `INFLUENCE_INTEREST_LEVELS` import becomes unused after removing the selects, drop it from the import list (lint fails on unused imports).

- [ ] **Step 6: Update the edit-modal test**

In `src/app/stakeholder-edit-modal.test.tsx`, the existing tests should still pass (they only test name-required and a RACI cell). Add one test proving the matrix sets both axes:
```tsx
it("picks influence and interest together from the matrix", () => {
  const p = setup({ draft: { ...draft, influence: "Low", interest: "Low" } });
  fireEvent.click(screen.getByRole("button", { name: /influence high.*interest high/i }));
  expect(p.onChange).toHaveBeenCalledWith(expect.objectContaining({ influence: "High", interest: "High" }));
});
```

- [ ] **Step 7: Run modal tests + typecheck + lint**

Run: `npx vitest run src/app/stakeholder-edit-modal.test.tsx && npx tsc --noEmit && npm run lint`
Expected: PASS / clean.

- [ ] **Step 8: Commit**

```bash
git add src/app/influence-interest-matrix.tsx src/app/influence-interest-matrix.test.tsx src/app/stakeholder-edit-modal.tsx src/app/stakeholder-edit-modal.test.tsx
git commit -F - <<'EOF'
feat: replace influence/interest dropdowns with a 3x3 click-matrix
EOF
```

---

## Task 6: Addable Stakeholder report

**Files:**
- Modify: `src/app/addable-reports.ts`
- Create: `src/app/stakeholder-report-panel.tsx`
- Create: `src/app/stakeholder-report-panel.test.tsx`
- Modify: `src/app/reports.tsx` (props + `renderEmbedded`)
- Modify: `src/app/workspace-section.tsx` (pass `stakeholders` + `milestones` to `<ReportsPanel>`)
- Modify: `src/app/i18n.ts` + `src/app/i18n.de.ts` (`stakeholderReportTitle`)
- Modify: `src/app/addable-reports.test.ts` (registry now has 4 entries)
- Test: `src/app/reports.test.tsx` (composed report renders)

- [ ] **Step 1: Add the i18n key (EN)**

In `src/app/i18n.ts`, after `raidReportTitle: "RAID Report",` add:
```ts
  stakeholderReportTitle: "Stakeholder Report",
```

- [ ] **Step 2: Add the i18n key (DE) via Node byte-patch**

```bash
node -e "const fs=require('fs');const p='src/app/i18n.de.ts';let s=fs.readFileSync(p,'utf8');const a='  raidReportTitle: \"RAID-Report\",';if(!s.includes(a))throw new Error('anchor not found');s=s.replace(a, a+'\r\n  stakeholderReportTitle: \"Stakeholder-Bericht\",');fs.writeFileSync(p,s);console.log('patched');"
node -e "const s=require('fs').readFileSync('src/app/i18n.de.ts','utf8');const m=s.match(/[^\x00-\x7F]/);console.log(m?('NON-ASCII '+s.indexOf(m[0])):'ASCII OK')"
```
Expected: `patched`, `ASCII OK`.

- [ ] **Step 3: Register the report**

In `src/app/addable-reports.ts`, append to `ADDABLE_REPORTS` (after the resource-report entry), keeping it out of `DEFAULT_EXTRA_REPORTS`:
```ts
  { id: "resource-report", titleKey: "resourcesReportTitle" },
  { id: "stakeholder-report", titleKey: "stakeholderReportTitle" },
```
If `src/app/addable-reports.test.ts` asserts the exact registry length/contents, update it (length 3 → 4, add the new id).

- [ ] **Step 4: Write the failing report-panel test**

Create `src/app/stakeholder-report-panel.test.tsx`:
```tsx
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { StakeholderReportPanel } from "./stakeholder-report-panel";
import type { Stakeholder, Milestone } from "./types";

const milestones: Milestone[] = [
  { id: 1, name: "Sign-off", date: "2026-04-20", linkedTaskIds: [] },
  { id: 2, name: "Go-Live", date: "2026-09-01", linkedTaskIds: [] },
];
const stakeholders: Stakeholder[] = [
  { id: 1, name: "Elena", category: "Sponsor", influence: "High", interest: "High", raci: { "1": "A" } },
  { id: 2, name: "Fictional", category: "Internal", influence: "High", interest: "Medium", raci: { "1": "A", "2": "A" } },
  { id: 3, name: "David", category: "Customer", influence: "Medium", interest: "Medium", raci: {} },
];

describe("StakeholderReportPanel", () => {
  it("shows the total stakeholder count", () => {
    render(<StakeholderReportPanel embedded lang="en-US" stakeholders={stakeholders} milestones={milestones} />);
    // total tile shows 3 somewhere
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("flags a milestone with multiple Accountables in RACI coverage", () => {
    render(<StakeholderReportPanel embedded lang="en-US" stakeholders={stakeholders} milestones={milestones} />);
    // milestone 2 (Go-Live) has two A's -> "multiple" warning chip present
    const go = screen.getByText("Go-Live").closest("tr")!;
    expect(within(go).getByText(/multiple/i)).toBeInTheDocument();
  });

  it("renders an empty state with no stakeholders", () => {
    render(<StakeholderReportPanel embedded lang="en-US" stakeholders={[]} milestones={milestones} />);
    expect(screen.getByText(/no stakeholders/i)).toBeInTheDocument();
  });
});
```
Note: the "multiple" chip text is `t(lang, "raciAccountableMultiple")` — verify its EN string contains "multiple" (it does: e.g. "Multiple Accountable"). Adjust the regex if needed. The empty-state regex must match whatever EN string you use in Step 5 (reuse an existing key — see below).

- [ ] **Step 5: Run it to confirm it fails**

Run: `npx vitest run src/app/stakeholder-report-panel.test.tsx`
Expected: FAIL (module not found).

- [ ] **Step 6: Implement the report panel**

Create `src/app/stakeholder-report-panel.tsx`. Reuse existing i18n keys (category labels `stakeholderCategory*`, level labels `level*`, quadrant labels `quadrant*`, `raciAccountableMissing`/`raciAccountableMultiple`, `raciSectionTitle`/`stakeholderRaciTitle`, `stakeholdersEmpty`, `raciNoMilestones`, field labels `stakeholderField*`, `navMilestones`). Structure mirrors `RaidReportPanel`'s embedded shape (`embedded?: boolean`, wrap content in `<div className="space-y-6">` when embedded; otherwise wrap in a `ReportCard`). Use `TABLE_HEAD_CLASS` for table headers and the amber chip classes for warnings.

```tsx
"use client";

// Read-only stakeholder report: summary tiles, influence/interest 2x2 grid,
// RACI coverage per milestone, and a register table. Embeddable in ReportsPanel
// like RaidReportPanel. No mutation — purely derived from props.

import { type Lang, t, type TranslationKey } from "./i18n";
import { TABLE_HEAD_CLASS } from "./table-styles";
import { ReportCard } from "./report-table";
import {
  quadrantFor, accountableCountByMilestone, raciWarningFor,
  type StakeholderQuadrant,
} from "./stakeholders";
import {
  STAKEHOLDER_CATEGORIES, type InfluenceInterest, type Milestone,
  type Stakeholder, type StakeholderCategory,
} from "./types";

const CATEGORY_KEY: Record<StakeholderCategory, TranslationKey> = {
  Internal: "stakeholderCategoryInternal", Customer: "stakeholderCategoryCustomer",
  Vendor: "stakeholderCategoryVendor", Sponsor: "stakeholderCategorySponsor",
  Regulator: "stakeholderCategoryRegulator", Other: "stakeholderCategoryOther",
};
const LEVEL_KEY: Record<InfluenceInterest, TranslationKey> = {
  Low: "levelLow", Medium: "levelMedium", High: "levelHigh",
};
const QUADRANTS: { id: StakeholderQuadrant; labelKey: TranslationKey }[] = [
  { id: "keep-satisfied", labelKey: "quadrantKeepSatisfied" },
  { id: "manage-closely", labelKey: "quadrantManageClosely" },
  { id: "monitor", labelKey: "quadrantMonitor" },
  { id: "keep-informed", labelKey: "quadrantKeepInformed" },
];
const AMBER_CHIP = "inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium bg-amber-500/20 text-AIPM-purple";

export interface StakeholderReportPanelProps {
  lang: Lang;
  stakeholders: readonly Stakeholder[];
  milestones: readonly Milestone[];
  embedded?: boolean;
}

export function StakeholderReportPanel({ lang, stakeholders, milestones, embedded = false }: StakeholderReportPanelProps) {
  const byCategory = STAKEHOLDER_CATEGORIES.map((c) => ({
    category: c, count: stakeholders.filter((s) => s.category === c).length,
  }));
  const byQuadrant: Record<StakeholderQuadrant, Stakeholder[]> = {
    "manage-closely": [], "keep-satisfied": [], "keep-informed": [], monitor: [],
  };
  for (const s of stakeholders) byQuadrant[quadrantFor(s)].push(s);

  const content = stakeholders.length === 0 ? (
    <p className="p-6 text-center text-sm text-muted-foreground">{t(lang, "stakeholdersEmpty")}</p>
  ) : (
    <div className="space-y-6">
      {/* Summary tiles */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-lg border border-line bg-surface p-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">{t(lang, "navStakeholders")}</p>
          <p className="mt-1 text-2xl font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey">{stakeholders.length}</p>
        </div>
        {byCategory.filter((c) => c.count > 0).map((c) => (
          <div key={c.category} className="rounded-lg border border-line bg-surface p-3">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{t(lang, CATEGORY_KEY[c.category])}</p>
            <p className="mt-1 text-2xl font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey">{c.count}</p>
          </div>
        ))}
      </div>

      {/* Influence / Interest 2x2 */}
      <div>
        <h3 className="mb-2 text-sm font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey">{t(lang, "stakeholderMapTitle")}</h3>
        <div className="grid grid-cols-2 gap-2">
          {QUADRANTS.map((q) => (
            <div key={q.id} className="rounded-lg border border-line p-3">
              <p className="text-xs font-semibold text-AIPM-dark-blue">{t(lang, q.labelKey)}</p>
              <div className="mt-1 flex flex-wrap gap-1">
                {byQuadrant[q.id].map((s) => (
                  <span key={s.id} className="inline-block rounded px-1.5 py-0.5 text-xs font-medium bg-surface-muted text-foreground">{s.name}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* RACI coverage */}
      <div>
        <h3 className="mb-2 text-sm font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey">{t(lang, "stakeholderRaciTitle")}</h3>
        {milestones.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t(lang, "raciNoMilestones")}</p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-line">
            <table className="min-w-full text-left text-sm">
              <thead className={TABLE_HEAD_CLASS}>
                <tr>
                  <th className="px-3 py-2 font-medium">{t(lang, "navMilestones")}</th>
                  <th className="px-3 py-2 font-medium text-right">A</th>
                  <th className="px-3 py-2 font-medium">&nbsp;</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {milestones.map((m) => {
                  const count = accountableCountByMilestone(stakeholders, m.id);
                  const warning = raciWarningFor(count);
                  return (
                    <tr key={m.id}>
                      <td className="px-3 py-2 font-medium text-foreground">{m.name}</td>
                      <td className="px-3 py-2 text-right">{count}</td>
                      <td className="px-3 py-2">
                        {warning === "missing" && <span className={AMBER_CHIP}>{t(lang, "raciAccountableMissing")}</span>}
                        {warning === "multiple" && <span className={AMBER_CHIP}>{t(lang, "raciAccountableMultiple")}</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Register table */}
      <div>
        <h3 className="mb-2 text-sm font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey">{t(lang, "navStakeholders")}</h3>
        <div className="overflow-x-auto rounded-md border border-line">
          <table className="min-w-full text-left text-sm">
            <thead className={TABLE_HEAD_CLASS}>
              <tr>
                <th className="px-3 py-2 font-medium">{t(lang, "stakeholderFieldName")}</th>
                <th className="px-3 py-2 font-medium">{t(lang, "stakeholderFieldOrganization")}</th>
                <th className="px-3 py-2 font-medium">{t(lang, "stakeholderFieldCategory")}</th>
                <th className="px-3 py-2 font-medium">{t(lang, "stakeholderFieldInfluence")}</th>
                <th className="px-3 py-2 font-medium">{t(lang, "stakeholderFieldInterest")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {stakeholders.map((s) => (
                <tr key={s.id}>
                  <td className="px-3 py-2 font-medium text-foreground">{s.name}</td>
                  <td className="px-3 py-2 text-foreground">{s.organization ?? ""}</td>
                  <td className="px-3 py-2 text-foreground">{t(lang, CATEGORY_KEY[s.category])}</td>
                  <td className="px-3 py-2 text-foreground">{t(lang, LEVEL_KEY[s.influence])}</td>
                  <td className="px-3 py-2 text-foreground">{t(lang, LEVEL_KEY[s.interest])}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );

  if (embedded) return content;
  return <ReportCard lang={lang} title={t(lang, "stakeholderReportTitle")}>{content}</ReportCard>;
}
```
Verify: `navStakeholders`, `stakeholderMapTitle`, `stakeholderRaciTitle`, `raciNoMilestones`, `stakeholdersEmpty`, `raciAccountableMissing`, `raciAccountableMultiple`, the `quadrant*`, `stakeholderCategory*`, `stakeholderField*`, and `level*` keys all exist in `i18n.ts`/`i18n.de.ts` (they were added in v0.52.0). The non-embedded `ReportCard` call: check `report-table.tsx` for `ReportCard`'s required props — if `sizeRef`/`onResetSize` are required, pass `sizeRef={undefined as never}` is NOT acceptable; instead read the signature and pass a `useRef` + `() => undefined` like `DashboardPanel` does. (The embedded path is what ReportsPanel uses, so the non-embedded branch is only for completeness — keep it compiling.)

- [ ] **Step 7: Run report-panel test**

Run: `npx vitest run src/app/stakeholder-report-panel.test.tsx`
Expected: PASS.

- [ ] **Step 8: Wire into reports.tsx**

In `src/app/reports.tsx`:
- Add import: `import { StakeholderReportPanel } from "./stakeholder-report-panel";`
- Add `Stakeholder`, `Milestone` to the `./types` import.
- Extend `ReportsPanel`'s destructured props + type with:
  ```tsx
  stakeholders = [], milestones = [],
  ```
  and in the prop type:
  ```tsx
  stakeholders?: Stakeholder[];
  milestones?: Milestone[];
  ```
- In `renderEmbedded`, add before the final `return null;`:
  ```tsx
  if (id === "stakeholder-report") return <StakeholderReportPanel embedded lang={lang} stakeholders={stakeholders} milestones={milestones} />;
  ```

- [ ] **Step 9: Pass props from the call site**

In `src/app/workspace-section.tsx`, in the `<ReportsPanel … />` block (~line 404-421), add two props (both `stakeholders` and `milestones` are already in scope):
```tsx
              extraReports={settings.reports?.extra ?? DEFAULT_EXTRA_REPORTS}
              onChangeExtraReports={(next) => setSettings((s) => ({ ...s, reports: { ...s.reports, extra: next } }))}
              stakeholders={stakeholders}
              milestones={milestones}
```

- [ ] **Step 10: Add a composed-report test**

In `src/app/reports.test.tsx`, add to the "composed reports" describe (the `renderComposed` helper passes `extraReports`):
```tsx
it("renders the Stakeholder report when added", () => {
  renderComposed(["stakeholder-report"]);
  expect(screen.getByRole("heading", { name: /stakeholder report/i })).toBeInTheDocument();
});
```
The embedded report's section header text comes from `reports.tsx`'s wrapper (`<h3>{t(lang, meta.titleKey)}</h3>` → "Stakeholder Report"). `renderComposed` renders with at least one task so `stats.total > 0`. The report body needs no stakeholders to render its heading (empty state still renders under the `<h3>`).

- [ ] **Step 11: Run reports + addable-reports tests, typecheck, lint**

Run: `npx vitest run src/app/reports.test.tsx src/app/addable-reports.test.ts && npx tsc --noEmit && npm run lint`
Expected: PASS / clean.

- [ ] **Step 12: Commit**

```bash
git add src/app/addable-reports.ts src/app/addable-reports.test.ts src/app/stakeholder-report-panel.tsx src/app/stakeholder-report-panel.test.tsx src/app/reports.tsx src/app/reports.test.tsx src/app/workspace-section.tsx src/app/i18n.ts src/app/i18n.de.ts
git commit -F - <<'EOF'
feat: add an addable Stakeholder report
EOF
```

---

## Task 7: Seed sample-workspace data (Milestones + Stakeholders + RACI)

**Files:**
- Modify: `sample-workspace.csv` (add `# MILESTONES` + `# STAKEHOLDERS` sections)
- Modify: `sample-workspace.md` (add `## Milestones` + `## Stakeholders` sections)
- Create: `src/app/sample-workspace-stakeholders.test.ts` (round-trip guard)

**Sample data (exact):**

Milestones:
| id | name | date | linkedTaskIds |
|----|------|------|----|
| 1 | Design Sign-off | 2026-04-20 | [] |
| 2 | Go-Live | 2026-09-01 | [] |
| 3 | Hypercare Exit | 2026-12-15 | [] |

Stakeholders (covers all 6 categories + all 4 quadrants; M1=1 Accountable, M2=2 Accountable→multiple, M3=0 Accountable→missing):
| id | name | organization | category | influence | interest | resourceId | raci |
|----|------|------|------|------|------|------|------|
| 1 | Elena Fischer | Acme | Sponsor | High | High | (none) | 1=A\|2=A\|3=C |
| 2 | Sam Placeholder | Acme | Internal | High | Medium | 2 | 1=R\|2=A\|3=R |
| 3 | Taylor Specimen | Acme | Internal | Medium | High | 3 | 1=C\|2=R\|3=I |
| 4 | David Okoro | Acme Corp | Customer | Medium | Medium | (none) | 1=I\|2=C\|3=C |
| 5 | Morgan Standin | InfoSec Authority | Regulator | High | Low | 4 | 1=I\|2=I\|3=C |
| 6 | Lena Vogt | CloudVendor GmbH | Vendor | Low | Low | (none) | (empty) |
| 7 | Sam Rivera | Community Forum | Other | Low | High | (none) | 1=I\|2=I\|3=R |

Quadrant check (`quadrantFor`, only High counts as high): manage-closely = {Elena}; keep-satisfied = {Fictional(H/M), Invented(H/L)}; keep-informed = {Aria(M/H), Sam(L/H)}; monitor = {David(M/M), Lena(L/L)} — all four non-empty. ✓
Accountable per milestone: M1 → Elena only = 1 (no warning); M2 → Elena+Fictional = 2 (multiple); M3 → none = 0 (missing). ✓

- [ ] **Step 1: Write the failing round-trip test**

Create `src/app/sample-workspace-stakeholders.test.ts`:
```ts
import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { csvToWorkspace, markdownToWorkspace } from "./storage";
import { quadrantFor, accountableCountByMilestone, raciWarningFor } from "./stakeholders";

const root = join(import.meta.dirname, "..", "..");
const csv = csvToWorkspace(readFileSync(join(root, "sample-workspace.csv"), "utf8"));
const md = markdownToWorkspace(readFileSync(join(root, "sample-workspace.md"), "utf8"));

for (const [name, ws] of [["csv", csv], ["md", md]] as const) {
  describe(`sample-workspace ${name}: milestones + stakeholders`, () => {
    test("has the three seeded milestones", () => {
      expect((ws.milestones ?? []).map((m) => m.name).sort())
        .toEqual(["Design Sign-off", "Go-Live", "Hypercare Exit"]);
    });
    test("has seven stakeholders covering all four quadrants", () => {
      const sh = ws.stakeholders ?? [];
      expect(sh).toHaveLength(7);
      const quads = new Set(sh.map(quadrantFor));
      expect(quads).toEqual(new Set(["manage-closely", "keep-satisfied", "keep-informed", "monitor"]));
    });
    test("RACI coverage drives both warnings", () => {
      const sh = ws.stakeholders ?? [];
      const byName = (n: string) => (ws.milestones ?? []).find((m) => m.name === n)!.id;
      expect(raciWarningFor(accountableCountByMilestone(sh, byName("Design Sign-off")))).toBeNull();
      expect(raciWarningFor(accountableCountByMilestone(sh, byName("Go-Live")))).toBe("multiple");
      expect(raciWarningFor(accountableCountByMilestone(sh, byName("Hypercare Exit")))).toBe("missing");
    });
  });
}
```
Note: RACI keys are milestone ids. The sample's RACI strings must reference the SAME milestone ids the milestone rows declare (1/2/3 above). The generation step (Step 3) builds both from one in-memory object, so ids stay consistent.

- [ ] **Step 2: Run it to confirm it fails**

Run: `npx vitest run src/app/sample-workspace-stakeholders.test.ts`
Expected: FAIL (no milestones/stakeholders in the sample files yet).

- [ ] **Step 3: Generate the exact section text via the real serializers**

Write a throwaway Node/TS snippet (run with `npx tsx` if available, else a temporary `*.mjs` importing the compiled functions is not possible — use a temporary vitest test that `console.log`s, then delete it). Simplest reliable path — add a temporary test that prints the serialized sections, run it, copy the output, then remove the temp test:

Create `src/app/_seed-gen.test.ts` (temporary):
```ts
import { test } from "vitest";
import { workspaceToCsv, workspaceToMarkdown, emptyWorkspace } from "./storage";

const milestones = [
  { id: 1, name: "Design Sign-off", date: "2026-04-20", linkedTaskIds: [] },
  { id: 2, name: "Go-Live", date: "2026-09-01", linkedTaskIds: [] },
  { id: 3, name: "Hypercare Exit", date: "2026-12-15", linkedTaskIds: [] },
];
const stakeholders = [
  { id: 1, name: "Elena Fischer", organization: "Acme", category: "Sponsor", influence: "High", interest: "High", raci: { "1": "A", "2": "A", "3": "C" } },
  { id: 2, name: "Sam Placeholder", organization: "Acme", category: "Internal", influence: "High", interest: "Medium", resourceId: 2, raci: { "1": "R", "2": "A", "3": "R" } },
  { id: 3, name: "Taylor Specimen", organization: "Acme", category: "Internal", influence: "Medium", interest: "High", resourceId: 3, raci: { "1": "C", "2": "R", "3": "I" } },
  { id: 4, name: "David Okoro", organization: "Acme Corp", category: "Customer", influence: "Medium", interest: "Medium", raci: { "1": "I", "2": "C", "3": "C" } },
  { id: 5, name: "Morgan Standin", organization: "InfoSec Authority", category: "Regulator", influence: "High", interest: "Low", resourceId: 4, raci: { "1": "I", "2": "I", "3": "C" } },
  { id: 6, name: "Lena Vogt", organization: "CloudVendor GmbH", category: "Vendor", influence: "Low", interest: "Low", raci: {} },
  { id: 7, name: "Sam Rivera", organization: "Community Forum", category: "Other", influence: "Low", interest: "High", raci: { "1": "I", "2": "I", "3": "R" } },
];
const ws = { ...emptyWorkspace(), milestones, stakeholders } as never;

test("emit", () => {
  console.log("=====CSV=====\n" + workspaceToCsv(ws));
  console.log("=====MD=====\n" + workspaceToMarkdown(ws));
});
```
Run: `npx vitest run src/app/_seed-gen.test.ts 2>&1`
From the CSV output, copy the `# MILESTONES … ` and `# STAKEHOLDERS …` blocks. From the MD output, copy the `## Milestones …` and `## Stakeholders …` blocks. Then **delete** `src/app/_seed-gen.test.ts`.
(If `npx tsx`/`vitest` cannot import `workspaceToCsv`/`emptyWorkspace` by those names, check `storage.ts` exports and use the actual exported serializer names — `workspaceToCsv` and `workspaceToMarkdown` are the canonical ones used by export.ts.)

- [ ] **Step 4: Paste the generated sections into the sample files**

- `sample-workspace.csv`: append the `# MILESTONES` and `# STAKEHOLDERS` blocks. Match the existing file's line-ending style (the CSV uses `\r\n` between rows; append with a blank line separating sections, consistent with how `workspaceToCsv` joins them). Easiest: since `workspaceToCsv(ws)` for a ws with ONLY milestones+stakeholders emits exactly those sections, you can paste verbatim with a leading blank line after the existing `# PLAN` section.
- `sample-workspace.md`: append the `## Milestones` and `## Stakeholders` blocks before/after the existing `## Plan` section (order does not matter to the parser). Preserve CRLF if the file uses it (check with the same non-ASCII/EOL check; the md is line-based and the parser splits on lines).

Use the Write tool only if you reproduce the entire file faithfully; otherwise append via a Node script to avoid clobbering existing content:
```bash
node -e "const fs=require('fs');const f='sample-workspace.csv';const add='\r\n'+`<PASTE CSV SECTIONS>`;fs.appendFileSync(f, add);"
```
(Prefer a precise append over a full rewrite to avoid disturbing the intact task/budget data.)

- [ ] **Step 5: Run the round-trip test**

Run: `npx vitest run src/app/sample-workspace-stakeholders.test.ts`
Expected: PASS for both csv and md.

- [ ] **Step 6: Confirm the budget test still passes (md not regressed)**

Run: `npx vitest run src/app/sample-workspace-budget.test.ts`
Expected: PASS (the md still contains its original tasks/budgets/plan; you only appended).

- [ ] **Step 7: Commit**

```bash
git add sample-workspace.csv sample-workspace.md src/app/sample-workspace-stakeholders.test.ts
git commit -F - <<'EOF'
chore: seed sample-workspace with milestones, stakeholders, and RACI
EOF
```

---

## Task 8: Release v0.53.0 "Asimov" (version, changelog, docs)

**Files:**
- Modify: `src/app/version.ts`
- Modify: `package.json`
- Modify: `CHANGELOG.md`
- Modify: `README.md` (if it carries a "latest release" highlight)
- Modify: `docs/CODEMAPS/frontend.md` (add the two new files)

- [ ] **Step 1: Read the current version wiring**

Read `src/app/version.ts` to see the version constant, build date, and any `versionHighlight*` / version-history array pattern. Read the top of `CHANGELOG.md` for the entry format.

- [ ] **Step 2: Bump the version**

- `package.json`: set `"version": "0.53.0"`.
- `src/app/version.ts`: set the version to `0.53.0`, codename `"Asimov"`, build date `2026-06-04`, and add a highlight entry following the existing pattern (e.g. a `versionHighlightAsimov` i18n key or an array item) summarizing: "Stakeholder report, influence/interest matrix, resizable RACI/map panes, dashboard Clear, sample data." If the highlight uses an i18n key, add EN (`i18n.ts`) and DE (`i18n.de.ts`, Node byte-patch) strings.

- [ ] **Step 3: Update CHANGELOG**

Add a top entry:
```markdown
## 0.53.0 — "Asimov" (2026-06-04)

### Added
- Addable **Stakeholder report** (summary, influence/interest grid, RACI coverage, register).
- Influence/Interest **3×3 click-matrix** in the stakeholder editor (replaces the two dropdowns; one click sets both).
- **Clear** button on the dashboard status summary.
- Sample workspace now seeds milestones, stakeholders, and RACI data.

### Changed
- RACI matrix and influence/interest map are now resizable panes.
- "+" prefix on the Change Log add button; "+ Add stakeholder" label on the register add button.
```

- [ ] **Step 4: Update codemaps**

In `docs/CODEMAPS/frontend.md`, add one-line entries for `influence-interest-matrix.tsx` and `stakeholder-report-panel.tsx` next to the other stakeholder files, following the existing format.

- [ ] **Step 5: Full verification**

Run: `npm run test:run && npx tsc --noEmit && npm run lint`
Expected: ALL pass, lint clean (`--max-warnings=0`), tsc clean. Also confirm the DE file is ASCII:
```bash
node -e "const s=require('fs').readFileSync('src/app/i18n.de.ts','utf8');const m=s.match(/[^\x00-\x7F]/);console.log(m?('NON-ASCII '+s.indexOf(m[0])):'ASCII OK')"
```

- [ ] **Step 6: Commit**

```bash
git add src/app/version.ts package.json CHANGELOG.md README.md docs/CODEMAPS/frontend.md src/app/i18n.ts src/app/i18n.de.ts
git commit -F - <<'EOF'
chore: release 0.53.0 "Asimov" — stakeholder report, I/I matrix, UI polish
EOF
```

---

## Final verification (after all tasks)

- [ ] `npm run test:run` — all green
- [ ] `npx tsc --noEmit` — clean
- [ ] `npm run lint` — clean (`--max-warnings=0`)
- [ ] `i18n.de.ts` ASCII-only (Node check above)
- [ ] Manual sanity: Reports view → add "Stakeholder Report"; stakeholder editor shows the matrix; RACI/map panes resize; dashboard Clear works; both sample files load with stakeholders/milestones.

Then hand off to **superpowers:finishing-a-development-branch**.

---

## Self-Review

**Spec coverage:** Item 1 → Task 1. Item 2 → Task 2. Item 3 → Task 4. Item 4 → Task 3. Item 5 → Task 5. Item 6 → Task 6. Item 7 → Task 7. Release/i18n/docs → folded into Tasks 3/6 (i18n) and Task 8 (version/changelog/codemaps). All covered.

**Placeholder scan:** No "TBD"/"handle edge cases". Each code step shows concrete code. The seed-generation step uses a concrete temp-test technique with exact data. The few "verify the exact EN string" notes are guardrails against i18n drift, not missing content (the canonical strings are named).

**Type consistency:** `InfluenceInterestMatrix` props `{ lang, influence, interest, onPick }` consistent across Task 5 component + edit-modal usage + tests. `StakeholderReportPanel` props `{ lang, stakeholders, milestones, embedded }` consistent across Task 6 component + reports wiring + tests. Milestone/Stakeholder shapes match `types.ts`. RACI ids in Task 7 data (1/2/3) match the milestone ids and the round-trip test's id lookups. `quadrantFor`/`accountableCountByMilestone`/`raciWarningFor` signatures match `stakeholders.ts`.
