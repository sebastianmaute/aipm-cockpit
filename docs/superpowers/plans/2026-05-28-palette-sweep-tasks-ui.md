# Palette Sweep — Tasks UI + Inputs + Reports (0.15.5) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate 8 component files (~2849 LOC) from `zinc-*`/shadows/off-palette status colors to the AIPM palette + semantic surface tokens, with no behavior/markup change.

**Architecture:** Mechanical per-file class-string migration applying the shared mapping table below + per-file named status-color edits (priority ramp in `task-row`, RAG triple in `reports`). *Transform → grep-verify-clean → existing tests stay green → commit* per file. Files ordered easiest → most-involved.

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind v4, Vitest. No new deps.

**Spec:** `docs/superpowers/specs/2026-05-28-palette-sweep-tasks-ui-design.md`
**Reference (binding):** `docs/DESIGN-TOKENS.md`
**Branch:** `feat/0.15.5-palette-sweep-tasks-ui` (already created off `main`).

## Shared mapping table (apply to every file task)

| Current utility | Replace with |
|---|---|
| `bg-white` | `bg-surface` |
| `bg-zinc-50/100`, `dark:bg-zinc-900`, `dark:bg-zinc-950` | `bg-surface-muted` |
| `border-zinc-200/300`, `dark:border-zinc-700/800`, `border-AIPM-light-grey` | `border-line` |
| `divide-zinc-*`, `divide-AIPM-light-grey` | `divide-line` |
| `bg-AIPM-light-grey`, `bg-AIPM-light-grey/NN` (chrome bg) | `bg-surface-muted` |
| `shadow-*` | remove |
| `focus:ring-AIPM-dark-blue` / `focus-visible:ring-AIPM-dark-blue` / `ring-zinc-*` | `ring-AIPM-green` / `focus-visible:ring-AIPM-green` |
| `hover:bg-zinc-*`, `dark:hover:bg-zinc-*`, `hover:bg-AIPM-light-grey` | `hover:bg-surface-muted` |
| `text-zinc-900/800/700` (+ paired dark) | `text-foreground` |
| `text-zinc-500/600/400` (+ paired dark) | `text-muted-foreground` |
| `text-AIPM-dark-grey` (+ any paired `dark:text-AIPM-light-grey`) | `text-foreground` |
| `text-AIPM-medium-grey` (+ any paired dark) | `text-muted-foreground` |
| `bg-gradient-*`, `from-*`, `via-*`, `to-*` | remove |

**KEEP UNCHANGED:** `bg-AIPM-dark-blue text-white` fills; heading pairs `text-AIPM-dark-blue dark:text-AIPM-light-grey` (`dark:text-AIPM-light-grey` heading-text variant must remain); all AIPM accent colors (`AIPM-pink`, `AIPM-green`, `AIPM-blue`, `AIPM-purple`); ALL non-class code.

**CRITICAL:** REPLACE each utility in place — never ADD a second color utility. After editing, no className may contain two `bg-*`, two `border-<color>`, two `divide-*`, or two `text-<color>` base utilities. `border` width + `border-line` color is fine; `bg-X hover:bg-Y` state variants are fine; `text-X dark:text-Y` is fine.

## Per-file verification (run after each file)

Use the Grep tool on the single migrated file with BOTH regexes; expect **zero matches** for each:
1. `zinc-|shadow-|bg-gradient|from-\[|(amber|red|emerald|sky|rose|slate|gray|orange|yellow|teal|cyan|indigo|violet|fuchsia|green|blue|purple|pink)-[0-9]`
2. `border-AIPM-light-grey|divide-AIPM-light-grey|bg-AIPM-light-grey|text-AIPM-dark-grey|text-AIPM-medium-grey`

`AIPM-*` alpha utilities (`bg-AIPM-pink/15`, `text-AIPM-purple`, `border-AIPM-green`, etc.) do NOT match either pattern. `dark:text-AIPM-light-grey` heading-text variant does NOT match.

> **Heads-up for every implementer subagent:**
> 1. Fact-forcing gate. Before FIRST shell command print 2 facts (task + what the command does). Before EVERY Edit, in the SAME message print 4 facts — (a) importers (Grep `<ComponentName>` in same turn), (b) symbols affected (none — class strings only), (c) data fields (none — styling), (d) instruction verbatim: "adjust the design to follow the following table:". Then retry the Edit.
> 2. win32 — Bash tool, no `&&`-chained `cd`, don't touch eslint.config.mjs.
> 3. After test runs, if `git status` shows `src/app/sample-workspace.md` dirty, `git restore` it BEFORE committing.
> 4. **Class strings ONLY** (plus the explicit named string-literal edits where listed). Targeted edits — preserve all logic/markup/tests byte-for-byte.

---

## Task 1: `combo-input.tsx` (pure chrome)

**Files:** Modify `src/app/combo-input.tsx`.

- [ ] **Step 1: Migrate** — READ the file. Apply the shared mapping table. Pure chrome (input with dropdown — borders, bg, focus ring, hover).
- [ ] **Step 2: Grep-verify** — both regexes return ZERO; duplicate-utility scan clean.
- [ ] **Step 3: Gates** — `npx vitest run combo-input`; `npx tsc --noEmit` (0); `npm run lint` (0).
- [ ] **Step 4: Commit**
```bash
git add src/app/combo-input.tsx
git commit -m "style(palette): combo-input to surface tokens (no zinc/shadow)"
```

---

## Task 2: `contact-input.tsx` (pure chrome)

**Files:** Modify `src/app/contact-input.tsx`.

- [ ] **Step 1: Migrate** — READ the file. Apply the shared mapping table. Pure chrome (contact picker — input + dropdown list).
- [ ] **Step 2: Grep-verify** — both regexes return ZERO; duplicate-utility scan clean.
- [ ] **Step 3: Gates** — `npx vitest run contact-input`; `npx tsc --noEmit` (0); `npm run lint` (0).
- [ ] **Step 4: Commit**
```bash
git add src/app/contact-input.tsx
git commit -m "style(palette): contact-input to surface tokens (no zinc/shadow)"
```

---

## Task 3: `labels-input.tsx` (pure chrome)

**Files:** Modify `src/app/labels-input.tsx`.

- [ ] **Step 1: Migrate** — READ the file. Apply the shared mapping table. Pure chrome (label chips + input + dropdown).
- [ ] **Step 2: Grep-verify** — both regexes return ZERO; duplicate-utility scan clean.
- [ ] **Step 3: Gates** — `npx vitest run labels-input`; `npx tsc --noEmit` (0); `npm run lint` (0).
- [ ] **Step 4: Commit**
```bash
git add src/app/labels-input.tsx
git commit -m "style(palette): labels-input to surface tokens (no zinc/shadow)"
```

---

## Task 4: `dependencies-editor.tsx` (pure chrome)

**Files:** Modify `src/app/dependencies-editor.tsx`.

- [ ] **Step 1: Migrate** — READ the file. Apply the shared mapping table. Pure chrome (dependency picker — chips + list).
- [ ] **Step 2: Grep-verify** — both regexes return ZERO; duplicate-utility scan clean.
- [ ] **Step 3: Gates** — `npx vitest run dependencies-editor`; `npx tsc --noEmit` (0); `npm run lint` (0).
- [ ] **Step 4: Commit**
```bash
git add src/app/dependencies-editor.tsx
git commit -m "style(palette): dependencies-editor to surface tokens (no zinc/shadow)"
```

---

## Task 5: `task-manager-ui.tsx` (pure chrome)

**Files:** Modify `src/app/task-manager-ui.tsx`.

- [ ] **Step 1: Migrate** — READ the file. Apply the shared mapping table. Pure chrome (shared UI helpers — `TabButton`, `Th`, `SortableTh`, the reset/eraser icons).
- [ ] **Step 2: Grep-verify** — both regexes return ZERO; duplicate-utility scan clean.
- [ ] **Step 3: Gates** — `npx vitest run task-manager-ui`; `npx tsc --noEmit` (0); `npm run lint` (0).
- [ ] **Step 4: Commit**
```bash
git add src/app/task-manager-ui.tsx
git commit -m "style(palette): task-manager-ui to surface tokens (no zinc/shadow)"
```

---

## Task 6: `tasks-section.tsx` (chrome, 537 lines)

**Files:** Modify `src/app/tasks-section.tsx`.

- [ ] **Step 1: Migrate** — READ the file. Apply the shared mapping table to the section wrapper, the filter/search bar, the table, sticky headers, footer, etc. No named status edits — pure chrome.
- [ ] **Step 2: Grep-verify** — both regexes return ZERO; duplicate-utility scan clean.
- [ ] **Step 3: Gates** — `npx vitest run tasks-section`; `npx tsc --noEmit` (0); `npm run lint` (0).
- [ ] **Step 4: Commit**
```bash
git add src/app/tasks-section.tsx
git commit -m "style(palette): tasks-section to surface tokens (no zinc/shadow)"
```

---

## Task 7: `reports.tsx` (chrome + RAG legend + chart color)

**Files:** Modify `src/app/reports.tsx`.

- [ ] **Step 1: Migrate** — READ the file. Apply the shared mapping table to the chrome (charts, legends, sections, headers).
- [ ] **Step 2: Named status edits** (exact before→after):
  - RAG record R (~line 262): `R: "bg-red-500"` → `R: "bg-AIPM-pink"`
  - RAG record A (~line 263): `A: "bg-amber-500"` → `A: "bg-AIPM-purple"`
  - RAG record G (~line 264): `G: "bg-emerald-500"` → `G: "bg-AIPM-green"`
  - Other chart color (~line 358): `color: "bg-amber-500"` → `color: "bg-AIPM-purple"`
- [ ] **Step 3: Grep-verify** — both regexes return ZERO; duplicate-utility scan clean.
- [ ] **Step 4: Gates** — `npx vitest run reports`; `npx tsc --noEmit` (0); `npm run lint` (0).
- [ ] **Step 5: Commit**
```bash
git add src/app/reports.tsx
git commit -m "style(palette): reports to surface tokens; RAG (R->pink, A->purple, G->green)"
```

---

## Task 8: `task-row.tsx` (chrome + Priority chips + selection/status — most-involved)

**Files:** Modify `src/app/task-row.tsx`.

- [ ] **Step 1: Migrate** — READ the file. Apply the shared mapping table to all chrome (cells, hover states, action buttons, etc.).
- [ ] **Step 2: Named status edits** (exact before→after):
  - Priority chip Medium (~line 92): `bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300` → `bg-AIPM-blue/15 text-AIPM-blue dark:bg-AIPM-blue/20`
  - Priority chip High (~line 93): `bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300` → `bg-AIPM-purple/15 text-AIPM-purple dark:bg-AIPM-purple/20`
  - Priority chip Urgent (~line 94): `bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300` → `bg-AIPM-pink/15 text-AIPM-pink dark:bg-AIPM-pink/20`
  - Row editing highlight (~line 159): `bg-amber-50 dark:bg-amber-950/20` → `bg-AIPM-purple/10 dark:bg-AIPM-purple/15`
  - Row selected highlight (~line 159): `bg-AIPM-light-grey dark:bg-zinc-900` → `bg-surface-muted`
  - Inquiry-sent link (~line 382): the className `text-xs font-medium text-red-600 underline-offset-2 hover:underline dark:text-red-400` → `text-xs font-medium text-AIPM-pink underline-offset-2 hover:underline`
  - Stale badge (~line 441): `bg-amber-100 text-amber-800 hover:bg-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:hover:bg-amber-950/60` → `bg-AIPM-purple/15 text-AIPM-purple hover:bg-AIPM-purple/25 dark:bg-AIPM-purple/20 dark:hover:bg-AIPM-purple/30`
- [ ] **Step 3: Grep-verify** — both regexes return ZERO; duplicate-utility scan clean.
- [ ] **Step 4: Gates** — `npx vitest run task-row`; `npx tsc --noEmit` (0); `npm run lint` (0).
- [ ] **Step 5: Commit**
```bash
git add src/app/task-row.tsx
git commit -m "style(palette): task-row to surface tokens; priority chips (blue/purple/pink); stale & editing -> purple; inquiry -> pink"
```

---

## Task 9: Release 0.15.5

**Files:** `src/app/version.ts`, `CHANGELOG.md`, `docs/DESIGN-TOKENS.md`.

- [ ] **Step 1: version.ts** — READ. Set `export const APP_VERSION = "0.15.5";`. Keep `APP_BUILD_DATE = "2026-05-28"; // Le Guin milestone`. Do NOT add a highlight key. Add a top comment above the existing `// 0.15.4 …` block:
```ts
// 0.15.5 sweeps the tasks UI + form inputs + reports onto the AIPM palette —
// surface tokens, no shadows, task-row priority chips remapped (Medium=blue,
// High=purple, Urgent=pink), reports RAG legend in pink/purple/green.
```

- [ ] **Step 2: CHANGELOG** — READ to match style; add above `[0.15.4]`:
```markdown
## [0.15.5] — 2026-05-28

### Changed
- Continued the AIPM design-system rollout: the tasks table (including the task row, sticky headers and toolbar), the task-form input controls (combo, contact, labels, dependencies), the reports panel and the shared task-manager UI helpers now use the AIPM palette and surface tokens — consistent light/dark surfaces, no drop shadows, task-row priority chips remapped to the palette (Medium=blue, High=purple, Urgent=pink), and the reports RAG chart in pink/purple/green.
```
(Match whatever format `[0.15.4]` actually uses if it differs.)

- [ ] **Step 3: DESIGN-TOKENS.md** — under "## Migration status (sub-project E)" add:
```markdown
- E-sweep tasks UI + inputs + reports (0.15.5): combo-input, contact-input, labels-input, dependencies-editor, task-manager-ui, tasks-section, reports, task-row. ✅
```
And update the existing "Remaining" line so these 8 files are removed (only `raid-panel`, `gantt`, and menus+chrome+misc remain).

- [ ] **Step 4: Verify** — `npx tsc --noEmit` (0); `npm run lint` (0); `npm run test:coverage` (green, ≥70%). Then `git status`; if `src/app/sample-workspace.md` is dirty, `git restore` it.

- [ ] **Step 5: Commit**
```bash
git add src/app/version.ts CHANGELOG.md docs/DESIGN-TOKENS.md
git commit -m "docs(release): 0.15.5 — palette sweep of tasks UI + inputs + reports"
```

---

## Final review

Dispatch a final reviewer over `git diff main...HEAD`. Read `version.ts`/`CHANGELOG.md` directly. Confirm: `APP_VERSION === "0.15.5"`, no new highlight key, real `[0.15.5]` entry, DESIGN-TOKENS migration-status updated. For EACH of the 8 files, run BOTH verification regexes → ZERO matches each. Confirm the named edits landed (task-row priority ramp + selection + inquiry + stale; reports RAG + chart). Confirm class-strings only — no logic/markup/behavior change; full suite green. Then use `superpowers:finishing-a-development-branch`.

---

## Self-Review (author)

**Spec coverage:** Each of the 8 in-scope files → its own task (1–8); the shared mapping covers the chrome; named status edits (task-row priority/editing/selected/inquiry/stale, reports RAG + chart) are exact strings in Tasks 7 and 8; release + DESIGN-TOKENS + CHANGELOG → Task 9.

**Placeholder scan:** No TBD/TODO; named edits are exact before→after strings. The "match `[0.15.4]` style" CHANGELOG note is a source-confirmation, not a placeholder.

**Type consistency:** Only Tailwind utility names; targets (`bg-surface`, `bg-surface-muted`, `border-line`, `text-foreground`, `text-muted-foreground`, `ring-AIPM-green`, plus `bg-AIPM-blue/15`, `bg-AIPM-purple/15`, `bg-AIPM-pink/15`, `bg-AIPM-green`, `bg-AIPM-purple`, `bg-AIPM-pink`, `text-AIPM-blue`, `text-AIPM-purple`, `text-AIPM-pink`) all resolve (palette + E0 surface tokens). The verification grep deliberately excludes `AIPM-*` utilities (no digit after the color word).
