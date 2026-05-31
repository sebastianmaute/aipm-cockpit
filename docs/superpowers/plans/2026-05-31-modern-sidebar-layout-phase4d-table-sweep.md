# Phase 4 Workstream D — Divergent-Table Sweep Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the 7 remaining bespoke table headers (across 5 files) to the shared Dark-Blue `TABLE_HEAD_CLASS`, and harden the source-level sweep guard so they can't drift back.

**Architecture:** Pure presentational sweep. Each file imports `TABLE_HEAD_CLASS` from `./table-styles` and swaps its bespoke `<thead className="…">` for `<thead className={TABLE_HEAD_CLASS}>`. In-header sort buttons that relied on dark hover/active colors (`hover:text-foreground` in reports, `hover:text-AIPM-dark-blue` in roles-modal) switch to the green accent so they stay legible on dark blue; header rows/cells drop `text-muted-foreground` so the inherited white shows; the resource-calendar frozen corner + default day cells get `bg-AIPM-dark-blue text-white` explicitly (a `<th>` background paints over the `<thead>` background). The guard (`table-head-sweep.test.ts`) grows its `SWEPT_FILES` list and gains a `FORBIDDEN_HEADS` array.

**Tech Stack:** Next.js 16 (App Router), React 18, TypeScript, Tailwind v4 (CSS-var tokens), Vitest + React Testing Library (jsdom).

**Branch:** `phase4d-table-sweep` (already created; spec committed at `b3dabe0`).

**Reference — the shared token** (`src/app/table-styles.ts`):
```ts
export const TABLE_HEAD_CLASS =
  "sticky top-0 z-10 bg-AIPM-dark-blue text-xs uppercase tracking-wide text-white";
```

**Standing constraints (carry through every task):**
- AIPM 9-color palette only — no gradients, no drop shadows, no off-palette colors. `bg-AIPM-dark-blue`, `text-white`, `hover:text-AIPM-green`, `text-AIPM-green` are all permitted tokens.
- NEVER touch or stage `README.md` or `public/*.png`. Use scoped `git add <path>` only — never `git add -A` / `git add .`.
- No `i18n.de.ts` edits this round.
- Before each file edit, the implementer MUST first Read the exact current region (line numbers below may have shifted) and match the verbatim string before editing.
- None of the 5 files import `TABLE_HEAD_CLASS` yet — every file task adds the import.

---

## Test commands

- Guard only: `npx vitest run src/app/table-head-sweep.test.ts`
- A single file's component test: `npx vitest run src/app/<file>.test.tsx`
- Type check: `npx tsc --noEmit`
- Full suite: `npx vitest run`

---

### Task 1: Harden the sweep guard (refactor — stays green)

**Files:**
- Modify: `src/app/table-head-sweep.test.ts`

Generalize the single `LEGACY_HEAD` string into a `FORBIDDEN_HEADS` array (adds the reports `text-foreground` variant) WITHOUT yet adding the 5 new files — so the existing 8 swept files keep passing. Pure refactor that locks in the stricter check before the sweep.

- [ ] **Step 1: Read the current guard file**

Read `src/app/table-head-sweep.test.ts` in full; confirm it matches the verbatim below.

- [ ] **Step 2: Replace the `LEGACY_HEAD` constant with `FORBIDDEN_HEADS`**

Replace:
```ts
// The exact legacy header string every swept <thead> used before Phase 3.
const LEGACY_HEAD =
  "bg-surface-muted text-xs uppercase tracking-wide text-muted-foreground";
```
with:
```ts
// The bespoke header strings swept files used before adopting TABLE_HEAD_CLASS.
// A swept file must contain NONE of these.
const FORBIDDEN_HEADS = [
  // Phase 3 muted header.
  "bg-surface-muted text-xs uppercase tracking-wide text-muted-foreground",
  // reports.tsx variant — text-foreground instead of text-muted-foreground.
  "bg-surface-muted text-foreground uppercase tracking-wide",
];
```

- [ ] **Step 3: Update the assertion loop**

Replace:
```ts
  for (const file of SWEPT_FILES) {
    it(`${file} uses TABLE_HEAD_CLASS, not the legacy muted header`, () => {
      // Resolve from the vitest root (process.cwd()). Using import.meta.url
      // here is unreliable on Windows when this file runs alongside others —
      // its base collapses to the drive root and readFileSync throws ENOENT.
      const src = readFileSync(join(process.cwd(), "src/app", file), "utf8");
      expect(src).not.toContain(LEGACY_HEAD);
      expect(src).toContain("TABLE_HEAD_CLASS");
    });
  }
```
with:
```ts
  for (const file of SWEPT_FILES) {
    it(`${file} uses TABLE_HEAD_CLASS, not a bespoke header`, () => {
      // Resolve from the vitest root (process.cwd()). Using import.meta.url
      // here is unreliable on Windows when this file runs alongside others —
      // its base collapses to the drive root and readFileSync throws ENOENT.
      const src = readFileSync(join(process.cwd(), "src/app", file), "utf8");
      for (const forbidden of FORBIDDEN_HEADS) {
        expect(src).not.toContain(forbidden);
      }
      expect(src).toContain("TABLE_HEAD_CLASS");
    });
  }
```

- [ ] **Step 4: Run the guard — expect PASS (still green)**

Run: `npx vitest run src/app/table-head-sweep.test.ts`
Expected: PASS. The 8 existing swept files contain neither forbidden string and do contain `TABLE_HEAD_CLASS`.

- [ ] **Step 5: Commit**

```bash
git add src/app/table-head-sweep.test.ts
git commit -m "test: generalize table-head sweep guard to FORBIDDEN_HEADS"
```

---

### Task 2: Sweep `jira-conflicts-modal.tsx` (no sort buttons)

**Files:**
- Modify: `src/app/table-head-sweep.test.ts` (add file to `SWEPT_FILES`)
- Modify: `src/app/jira-conflicts-modal.tsx`

Tiny 3-column comparison table rendered once per conflict; no sort buttons. Current header (verbatim, L190):
```tsx
                <thead className="text-muted-foreground">
```
Imports are react + `./i18n`, `./jira-api`, `./modal`, `./modal-header`, `./use-draggable`, `./use-resizable`, `./use-column-resize`, `./task-manager-ui`. No `./table-styles` import.

- [ ] **Step 1 (RED):** Add `"jira-conflicts-modal.tsx",` to `SWEPT_FILES` in `src/app/table-head-sweep.test.ts`.

- [ ] **Step 2: Run guard — expect FAIL**

Run: `npx vitest run src/app/table-head-sweep.test.ts`
Expected: FAIL on `jira-conflicts-modal.tsx` (no `TABLE_HEAD_CLASS` yet).

- [ ] **Step 3: Add the import** (alongside the other `./` imports near the top):
```tsx
import { TABLE_HEAD_CLASS } from "./table-styles";
```

- [ ] **Step 4: Swap the thead**

Replace:
```tsx
                <thead className="text-muted-foreground">
```
with:
```tsx
                <thead className={TABLE_HEAD_CLASS}>
```
The `<th>` cells keep `text-left font-medium`; white is inherited. No other change.

- [ ] **Step 5: Run guard + host test — expect PASS**

Run: `npx vitest run src/app/table-head-sweep.test.ts`
Then the covering test: `npx vitest run src/app/jira-conflicts-modal` (run the jira test that renders this modal if there is no dedicated file).
Expected: PASS.

- [ ] **Step 6: Type check** — `npx tsc --noEmit` → no errors.

- [ ] **Step 7: Commit**

```bash
git add src/app/jira-conflicts-modal.tsx src/app/table-head-sweep.test.ts
git commit -m "style: sweep jira-conflicts-modal header onto TABLE_HEAD_CLASS"
```

---

### Task 3: Sweep `roles-modal.tsx` (green sort hover)

**Files:**
- Modify: `src/app/table-head-sweep.test.ts` (add file to `SWEPT_FILES`)
- Modify: `src/app/roles-modal.tsx`

Current header (verbatim, L121–124); the 4 sortable buttons all share the same className with `hover:text-AIPM-dark-blue`:
```tsx
                <thead className="text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="relative py-1" style={{ width: colWidths.discipline, minWidth: colWidths.discipline }}>
                      <button type="button" onClick={() => toggleSort("discipline")} className="inline-flex items-center gap-1 hover:text-AIPM-dark-blue">
```
The four header buttons are at L124/130/136/142, each ending `className="inline-flex items-center gap-1 hover:text-AIPM-dark-blue"`. No `./table-styles` import.

- [ ] **Step 1 (RED):** Add `"roles-modal.tsx",` to `SWEPT_FILES`.

- [ ] **Step 2: Run guard — expect FAIL** for `roles-modal.tsx`.
Run: `npx vitest run src/app/table-head-sweep.test.ts` → FAIL.

- [ ] **Step 3: Add the import**:
```tsx
import { TABLE_HEAD_CLASS } from "./table-styles";
```

- [ ] **Step 4: Swap the thead**

Replace:
```tsx
                <thead className="text-xs uppercase tracking-wide text-muted-foreground">
```
with:
```tsx
                <thead className={TABLE_HEAD_CLASS}>
```

- [ ] **Step 5: Re-tone the four sort buttons to green**

First confirm scope: `git grep -n "hover:text-AIPM-dark-blue" src/app/roles-modal.tsx`. The header buttons are the occurrences inside the `<thead>` (L124/130/136/142). For EACH header button, replace the substring `hover:text-AIPM-dark-blue` with `hover:text-AIPM-green` in:
```tsx
className="inline-flex items-center gap-1 hover:text-AIPM-dark-blue"
```
→
```tsx
className="inline-flex items-center gap-1 hover:text-AIPM-green"
```
If the grep shows occurrences OUTSIDE the `<thead>` (non-header controls), leave those untouched — change only the four header buttons. White text is inherited from the thead.

- [ ] **Step 6: Run guard + roles test — expect PASS**

Run: `npx vitest run src/app/table-head-sweep.test.ts src/app/roles-modal.test.tsx`
Expected: PASS.

- [ ] **Step 7: Type check** — `npx tsc --noEmit` → no errors.

- [ ] **Step 8: Commit**

```bash
git add src/app/roles-modal.tsx src/app/table-head-sweep.test.ts
git commit -m "style: sweep roles-modal header onto TABLE_HEAD_CLASS (green sort hover)"
```

---

### Task 4: Sweep `budget-panel.tsx` (no sort buttons)

**Files:**
- Modify: `src/app/table-head-sweep.test.ts` (add file to `SWEPT_FILES`)
- Modify: `src/app/budget-panel.tsx`

Editable grid; header cells are plain labels (no buttons). Current header (verbatim, L263–264):
```tsx
                  <thead>
                    <tr className="text-muted-foreground">
```
No `./table-styles` import.

- [ ] **Step 1 (RED):** Add `"budget-panel.tsx",` to `SWEPT_FILES`.

- [ ] **Step 2: Run guard — expect FAIL** for `budget-panel.tsx`.
Run: `npx vitest run src/app/table-head-sweep.test.ts` → FAIL.

- [ ] **Step 3: Add the import**:
```tsx
import { TABLE_HEAD_CLASS } from "./table-styles";
```

- [ ] **Step 4: Swap the thead and de-mute the header row**

Replace:
```tsx
                  <thead>
                    <tr className="text-muted-foreground">
```
with:
```tsx
                  <thead className={TABLE_HEAD_CLASS}>
                    <tr>
```
The `<th>` cells keep `relative px-2 py-1 text-left font-medium` / `relative px-2 py-1 text-right`; white is inherited. No other change (no in-header buttons exist).

- [ ] **Step 5: Run guard + budget tests — expect PASS**

Run: `npx vitest run src/app/table-head-sweep.test.ts src/app/budget-panel.test.tsx src/app/budget-panel-edit.test.tsx`
Expected: PASS.

- [ ] **Step 6: Type check** — `npx tsc --noEmit` → no errors.

- [ ] **Step 7: Commit**

```bash
git add src/app/budget-panel.tsx src/app/table-head-sweep.test.ts
git commit -m "style: sweep budget-panel header onto TABLE_HEAD_CLASS"
```

---

### Task 5: Sweep `reports.tsx` (3 headers; green sort hover)

**Files:**
- Modify: `src/app/table-head-sweep.test.ts` (add file to `SWEPT_FILES`)
- Modify: `src/app/reports.tsx`

Three tables share the same bespoke thead (L475 / L645 / L741):
```tsx
              <thead className="bg-surface-muted text-foreground uppercase tracking-wide">
```
Tables 2 & 3 have sort buttons that use `hover:text-foreground` and active `text-foreground` — both illegible on dark blue, so they must become green. No `./table-styles` import.

- [ ] **Step 1 (RED):** Add `"reports.tsx",` to `SWEPT_FILES`.

- [ ] **Step 2: Run guard — expect FAIL** for `reports.tsx` (it contains the forbidden `bg-surface-muted text-foreground uppercase tracking-wide` AND lacks `TABLE_HEAD_CLASS`).
Run: `npx vitest run src/app/table-head-sweep.test.ts` → FAIL.

- [ ] **Step 3: Add the import**:
```tsx
import { TABLE_HEAD_CLASS } from "./table-styles";
```

- [ ] **Step 4: Swap all three theads (replace-all)**

Replace every occurrence (exactly 3) of:
```tsx
<thead className="bg-surface-muted text-foreground uppercase tracking-wide">
```
with:
```tsx
<thead className={TABLE_HEAD_CLASS}>
```

- [ ] **Step 5: Re-tone the "name" sort button (table 2, ~L651)**

Replace:
```tsx
                  className={`inline-flex items-center gap-1 ${sort.key === "name" && sort.dir !== "off" ? "text-foreground" : ""} hover:text-foreground`}
```
with:
```tsx
                  className={`inline-flex items-center gap-1 ${sort.key === "name" && sort.dir !== "off" ? "text-AIPM-green" : ""} hover:text-AIPM-green`}
```

- [ ] **Step 6: Re-tone the "assignee" sort button (table 3, ~L747)**

Replace:
```tsx
                  className={`inline-flex items-center gap-1 ${sort.key === "assignee" && sort.dir !== "off" ? "text-foreground" : ""} hover:text-foreground`}
```
with:
```tsx
                  className={`inline-flex items-center gap-1 ${sort.key === "assignee" && sort.dir !== "off" ? "text-AIPM-green" : ""} hover:text-AIPM-green`}
```

- [ ] **Step 7: Re-tone the mapped-column sort buttons (tables 2 & 3, replace-all)**

There are two identical occurrences (~L672 and ~L769). Replace every occurrence of:
```tsx
                      className={`inline-flex items-center gap-1 ${active ? "text-foreground" : ""} hover:text-foreground`}
```
with:
```tsx
                      className={`inline-flex items-center gap-1 ${active ? "text-AIPM-green" : ""} hover:text-AIPM-green`}
```
(Table 1's header has no buttons — only static labels — so it needs no button change. Do NOT alter any `<td>` body cells, which legitimately use `text-foreground`/`text-AIPM-green`/`text-AIPM-pink`.)

- [ ] **Step 8: Run guard + reports test — expect PASS**

Run: `npx vitest run src/app/table-head-sweep.test.ts src/app/reports.test.tsx`
Expected: PASS (no forbidden string remains; `TABLE_HEAD_CLASS` present; component test green).

- [ ] **Step 9: Type check** — `npx tsc --noEmit` → no errors.

- [ ] **Step 10: Commit**

```bash
git add src/app/reports.tsx src/app/table-head-sweep.test.ts
git commit -m "style: sweep all three reports tables onto TABLE_HEAD_CLASS (green sort hover)"
```

---

### Task 6: Sweep `resource-calendar.tsx` (sticky-corner + day cells)

**Files:**
- Modify: `src/app/table-head-sweep.test.ts` (add file to `SWEPT_FILES`)
- Modify: `src/app/resource-calendar.tsx`

Matrix with a frozen top-left corner and per-day header cells. Current (verbatim, L159–184):
```tsx
          <thead>
            <tr>
              <th
                className="sticky left-0 top-0 z-30 border-b border-r border-line bg-surface-muted px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground"
                style={{ minWidth: ASSIGNEE_COL_PX, width: ASSIGNEE_COL_PX }}
              >
                {t(lang, "assignee")}
              </th>
              {days.map((d) => (
                <th
                  key={d.iso}
                  title={ … }
                  className={[
                    "sticky top-0 z-20 border-b border-r border-line px-0 py-1 text-center text-[10px] font-medium tracking-wide",
                    d.isToday
                      ? "bg-AIPM-green/20 text-AIPM-dark-blue dark:bg-AIPM-green/20 dark:text-AIPM-light-grey"
                      : d.isHoliday
                        ? "bg-AIPM-purple/15 text-AIPM-purple dark:bg-AIPM-purple/20 dark:text-AIPM-purple"
                        : d.isWeekend
                          ? "bg-surface-muted text-muted-foreground"
                          : "bg-surface-muted text-muted-foreground",
                  ].join(" ")}
```
No `./table-styles` import. The today (green) and holiday (purple) tints are intentional indicators and MUST be preserved; only the default/weekend day cells go dark-blue.

- [ ] **Step 1 (RED):** Add `"resource-calendar.tsx",` to `SWEPT_FILES`.

- [ ] **Step 2: Run guard — expect FAIL** for `resource-calendar.tsx`.
Run: `npx vitest run src/app/table-head-sweep.test.ts` → FAIL.

- [ ] **Step 3: Add the import**:
```tsx
import { TABLE_HEAD_CLASS } from "./table-styles";
```

- [ ] **Step 4: Swap the thead**

Replace (the calendar header's opening tag at ~L159):
```tsx
          <thead>
            <tr>
```
with:
```tsx
          <thead className={TABLE_HEAD_CLASS}>
            <tr>
```

- [ ] **Step 5: Re-skin the frozen corner cell**

Replace:
```tsx
                className="sticky left-0 top-0 z-30 border-b border-r border-line bg-surface-muted px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-muted-foreground"
```
with:
```tsx
                className="sticky left-0 top-0 z-30 border-b border-r border-line bg-AIPM-dark-blue px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-white"
```

- [ ] **Step 6: Re-skin the default/weekend day cells**

Replace:
```tsx
                        : d.isWeekend
                          ? "bg-surface-muted text-muted-foreground"
                          : "bg-surface-muted text-muted-foreground",
```
with:
```tsx
                        : d.isWeekend
                          ? "bg-AIPM-dark-blue text-white"
                          : "bg-AIPM-dark-blue text-white",
```
Leave the `d.isToday` (green) and `d.isHoliday` (purple) branches untouched. Do NOT alter any `<tbody>` cells (the sticky left-column body cells stay as they are).

- [ ] **Step 7: Run guard + calendar test — expect PASS**

Run: `npx vitest run src/app/table-head-sweep.test.ts src/app/resource-calendar.test.tsx`
Expected: PASS.

- [ ] **Step 8: Type check** — `npx tsc --noEmit` → no errors.

- [ ] **Step 9: Commit**

```bash
git add src/app/resource-calendar.tsx src/app/table-head-sweep.test.ts
git commit -m "style: sweep resource-calendar header onto TABLE_HEAD_CLASS (dark-blue corner + day cells)"
```

---

### Task 7: Release 0.35.0 "Muir"

**Files:**
- Modify: `src/app/version.ts`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Confirm the codename is unused**

Run: `git grep -i "muir" CHANGELOG.md` and skim `CHANGELOG.md` headers.
Expected: no existing `"Muir"` release. If it collides, use the next unused author surname (fallbacks: Hurley, Kowal, Valente, Nagata) consistently below.

- [ ] **Step 2: Read `src/app/version.ts`** to see the exact current `APP_VERSION` / `APP_BUILD_DATE` lines and milestone-comment style.

- [ ] **Step 3: Bump the version**

Set `APP_VERSION` to `"0.35.0"`, set `APP_BUILD_DATE` to `"2026-05-31"` with a trailing `// Muir` codename comment matching the existing pattern, and add a Phase 4 Workstream D milestone comment consistent with the existing comments in that file.

- [ ] **Step 4: Add the CHANGELOG entry**

Read the top of `CHANGELOG.md`, then add above the latest entry:
```markdown
## [0.35.0] — 2026-05-31 "Muir"

### Changed
- All remaining data-table headers (reports ×3, roles modal, budget panel, Jira-conflicts modal, resource calendar) now use the shared Dark-Blue `TABLE_HEAD_CLASS`, completing the Phase 3/4 header sweep. In-header sort buttons use the green accent; the resource-calendar frozen corner and default day cells paint dark blue with white text (today/holiday tints preserved).

### Internal
- Generalized the `table-head-sweep` guard to a `FORBIDDEN_HEADS` list and added the five swept files, so these headers cannot drift back to bespoke styling.
```

- [ ] **Step 5: Run the full suite + type check**

Run: `npx vitest run` then `npx tsc --noEmit`
Expected: all tests PASS, no type errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/version.ts CHANGELOG.md
git commit -m "release: 0.35.0 — divergent-table sweep (Phase 4 Workstream D)"
```

---

### Final: Finish the branch

After all tasks pass, use **superpowers:finishing-a-development-branch**: verify the full suite is green, then **merge to `main` locally** (`git merge --ff-only` if possible) and delete the branch. Do NOT push — the user pushes on explicit request only. Confirm `git status` shows no accidental staging of `README.md` or `public/*.png`.

---

## Self-Review

**Spec coverage:**
- Sweep all 5 files uniformly → Tasks 2–6. ✓
- Sort-button tone = green accent (match swept tables) → Task 3 (roles `hover:text-AIPM-dark-blue`→green), Task 5 (reports `text-foreground`/`hover:text-foreground`→`text-AIPM-green`/`hover:text-AIPM-green`). ✓
- Sticky stays everywhere (bare `TABLE_HEAD_CLASS`) → all thead swaps use the bare token. ✓
- Calendar frozen corner + default day cells get explicit `bg-AIPM-dark-blue text-white`; today/holiday tints preserved → Task 6 Steps 5–6. ✓
- Guard hardening: 5 files added + `FORBIDDEN_HEADS` with reports variant → Task 1 + per-file `SWEPT_FILES` additions. ✓
- Release 0.35.0 "Muir" → Task 7. ✓
- Constraints (palette, README/PNG untouched, no i18n) → header + per-task. ✓

**Placeholder scan:** No "TBD"/"add handling". Every code step shows the exact old→new string. The only verify-first step (Task 3 Step 5 grep for scope) is a safety confirmation, not a placeholder — the replacement string is fully specified.

**Type/identifier consistency:** `TABLE_HEAD_CLASS`, `FORBIDDEN_HEADS`, `SWEPT_FILES`, `bg-AIPM-dark-blue`, `text-white`, `text-AIPM-green`, `hover:text-AIPM-green` used consistently. Import path `./table-styles` consistent. Codename "Muir" / version "0.35.0" consistent between Task 7 and the CHANGELOG block. Reports button edits account for both the single-key buttons (name/assignee) and the shared mapped-column buttons (`active ? … : …`), matching the verbatim source.
