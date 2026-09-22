# Palette Sweep — Modals chunk (0.15.4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate 8 modal components (~2833 LOC) from `zinc-*`/shadows/off-palette status colors to the brand palette + semantic surface tokens, with no behavior/markup change.

**Architecture:** Mechanical per-file class-string migration applying the shared mapping table below (proven in chunk 1) + per-file named status-color edits. *Transform → grep-verify-clean → existing tests stay green → commit* per file. Files ordered easiest (pure chrome) → hardest (RAG indicator).

**Tech Stack:** Next.js 16, React 19, TypeScript, Tailwind v4, Vitest. No new deps.

**Spec:** `docs/superpowers/specs/2026-05-28-palette-sweep-modals-design.md`
**Reference (binding):** `docs/DESIGN-TOKENS.md`
**Branch:** `feat/0.15.4-palette-sweep-modals` (already created off `main`).

## Shared mapping table (apply to every file task)

| Current utility | Replace with |
|---|---|
| `bg-white` | `bg-surface` |
| `bg-zinc-50/100`, `dark:bg-zinc-900`, `dark:bg-zinc-950` | `bg-surface-muted` |
| `border-zinc-200/300`, `dark:border-zinc-700/800` | `border-line` |
| `border-ui-light-grey` | `border-line` |
| `divide-zinc-*`, `divide-ui-light-grey` | `divide-line` |
| `bg-ui-light-grey`, `bg-ui-light-grey/NN` (chrome bg) | `bg-surface-muted` |
| `shadow-*` | remove |
| `focus:ring-ui-dark-blue` / `focus-visible:ring-ui-dark-blue` / `ring-zinc-*` | `ring-ui-green` / `focus-visible:ring-ui-green` |
| `hover:bg-zinc-*`, `dark:hover:bg-zinc-*`, `hover:bg-ui-light-grey` | `hover:bg-surface-muted` (single class, both modes) |
| `text-zinc-900/800/700` (+ paired dark) | `text-foreground` |
| `text-zinc-500/600/400` (+ paired dark) | `text-muted-foreground` |
| `text-ui-dark-grey` (+ any paired `dark:text-ui-light-grey`) | `text-foreground` |
| `text-ui-medium-grey` (+ any paired dark) | `text-muted-foreground` |
| `bg-gradient-*`, `from-*`, `via-*`, `to-*` | remove |

**KEEP UNCHANGED:** `bg-ui-dark-blue text-white` fills; heading pairs `text-ui-dark-blue dark:text-ui-light-grey` (the `dark:text-ui-light-grey` heading-text variant must remain); all petrol accent colors (`ui-pink`, `ui-green`, `ui-blue`, `ui-purple`); ALL non-class code.

**CRITICAL:** REPLACE each utility in place — never ADD a second color utility. After editing, no className may contain two `bg-*`, two `border-<color>`, two `divide-*`, or two `text-<color>` base utilities. `border` + `border-line` (width + color) is fine; `bg-X hover:bg-Y` (state variants) is fine; `text-X dark:text-Y` is fine. Two `bg-` (no variant), two `text-` (no variant), etc. are NOT fine.

## Per-file verification (run after each file)

Use the Grep tool on the single migrated file with BOTH regexes; expect **zero matches** for each:
1. `zinc-|shadow-|bg-gradient|from-\[|(amber|red|emerald|sky|rose|slate|gray|orange|yellow|teal|cyan|indigo|violet|fuchsia|green|blue|purple|pink)-[0-9]`
2. `border-ui-light-grey|divide-ui-light-grey|bg-ui-light-grey|text-ui-dark-grey|text-ui-medium-grey`

`ui-*` utilities with alpha (`bg-ui-pink/10`, `border-ui-green`, `text-ui-purple`, etc.) do NOT match either pattern. `dark:text-ui-light-grey` (heading-text variant) does NOT match (no digit after the color word).

> **Heads-up for every implementer subagent:**
> 1. Fact-forcing gate. Before FIRST shell command print 2 facts (task + what the command does). Before EVERY Edit, in the SAME message print 4 facts — (a) importers (Grep `<ComponentName>` in same turn), (b) symbols affected (none — classes only), (c) data fields (none — styling), (d) instruction verbatim: "adjust the design to follow the following table:". Then retry the Edit.
> 2. win32 — Bash tool, no `&&`-chained `cd`, don't touch eslint.config.mjs.
> 3. After test runs, if `git status` shows `src/app/sample-workspace.md` dirty, `git restore` it BEFORE committing.
> 4. **Class strings ONLY** (plus a handful of explicit string-literal class edits where the task lists them). Targeted edits — preserve all logic/markup/tests byte-for-byte. Do NOT rewrite the file wholesale.

---

## Task 1: `budget-bucket-modal.tsx` (pure chrome)

**Files:** Modify `src/app/budget-bucket-modal.tsx`.

- [ ] **Step 1: Migrate** — READ the file. Apply the shared mapping table to every off-palette class. This file is pure chrome (form inputs, sections, primary/secondary buttons, role-picker, the bucket allocations table). No status colors. Notable spots: outer panel `bg-white dark:bg-zinc-950` → `bg-surface`; section `<h3>` headings keep `text-ui-dark-blue dark:text-ui-light-grey`; primary action `bg-ui-dark-blue` stays; outlined secondary `border-ui-dark-blue bg-white … dark:bg-zinc-900` → `bg-surface` with the standard hover/shadow drops.
- [ ] **Step 2: Grep-verify** — both regexes return ZERO matches; duplicate-utility scan clean.
- [ ] **Step 3: Gates** — `npx vitest run src/app/budget-bucket-modal.test.tsx` (or `npx vitest run budget-bucket` if no dedicated test); `npx tsc --noEmit` (0); `npm run lint` (0).
- [ ] **Step 4: Commit**
```bash
git add src/app/budget-bucket-modal.tsx
git commit -m "style(palette): budget-bucket-modal to surface tokens (no zinc/shadow)"
```

---

## Task 2: `jira-conflicts-modal.tsx`

**Files:** Modify `src/app/jira-conflicts-modal.tsx`.

- [ ] **Step 1: Migrate** — READ the file. Apply the shared mapping table. The file has one Tailwind status-color spot (likely an error/conflict styling) — wherever red appears, map per the destructive pattern: solid red text → `text-ui-pink`; red border + red-50 bg → `border-ui-pink/40 bg-ui-pink/10`; red hover bg → `hover:bg-ui-pink/10`. Replace `dark:bg-zinc-*` companions with the surface tokens.
- [ ] **Step 2: Grep-verify** — both regexes return ZERO matches; duplicate-utility scan clean.
- [ ] **Step 3: Gates** — `npx vitest run jira-conflicts` (or the existing matching tests); `npx tsc --noEmit` (0); `npm run lint` (0).
- [ ] **Step 4: Commit**
```bash
git add src/app/jira-conflicts-modal.tsx
git commit -m "style(palette): jira-conflicts-modal to surface tokens; red->pink"
```

---

## Task 3: `bulk-edit-modal.tsx`

**Files:** Modify `src/app/bulk-edit-modal.tsx`.

- [ ] **Step 1: Migrate** — READ the file. Apply the shared mapping table. Map any red (likely an error or "Clear all"-style hint) → `ui-pink` per the destructive pattern.
- [ ] **Step 2: Grep-verify** — both regexes return ZERO matches; duplicate-utility scan clean.
- [ ] **Step 3: Gates** — `npx vitest run bulk-edit-modal`; `npx tsc --noEmit` (0); `npm run lint` (0).
- [ ] **Step 4: Commit**
```bash
git add src/app/bulk-edit-modal.tsx
git commit -m "style(palette): bulk-edit-modal to surface tokens (red->pink)"
```

---

## Task 4: `roles-modal.tsx` (close-button red→pink)

**Files:** Modify `src/app/roles-modal.tsx`.

- [ ] **Step 1: Migrate** — READ the file. Apply the shared mapping table to its form chrome.
- [ ] **Step 2: Named edit** — TWO close `×` buttons (at the discipline-row and grade-row delete positions): change each `text-ui-medium-grey hover:bg-red-50 hover:text-red-600 dark:hover:bg-zinc-800` → `text-muted-foreground hover:bg-ui-pink/10 hover:text-ui-pink`.
- [ ] **Step 3: Grep-verify** — both regexes return ZERO matches; duplicate-utility scan clean.
- [ ] **Step 4: Gates** — `npx vitest run roles-modal`; `npx tsc --noEmit` (0); `npm run lint` (0).
- [ ] **Step 5: Commit**
```bash
git add src/app/roles-modal.tsx
git commit -m "style(palette): roles-modal to surface tokens; close-button red->pink"
```

---

## Task 5: `absence-edit-modal.tsx` (destructive-button pattern)

**Files:** Modify `src/app/absence-edit-modal.tsx`.

- [ ] **Step 1: Migrate** — READ the file. Apply the shared mapping table to all form chrome (inputs, labels, section divider, primary `bg-ui-dark-blue` stays, etc.).
- [ ] **Step 2: Named status edits** (exact before→after):
  - Error `<p>`: `sm:col-span-2 text-sm text-red-600 dark:text-red-400` → `sm:col-span-2 text-sm text-ui-pink`
  - Delete `<button>` className: `rounded-md border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-700 shadow-sm hover:bg-red-50 dark:border-red-800 dark:bg-zinc-900 dark:text-red-400 dark:hover:bg-zinc-800` → `rounded-md border border-ui-pink/40 bg-surface px-3 py-1.5 text-sm font-medium text-ui-pink hover:bg-ui-pink/10 dark:border-ui-pink/50`
- [ ] **Step 3: Grep-verify** — both regexes return ZERO matches; duplicate-utility scan clean.
- [ ] **Step 4: Gates** — `npx vitest run absence-edit-modal`; `npx tsc --noEmit` (0); `npm run lint` (0).
- [ ] **Step 5: Commit**
```bash
git add src/app/absence-edit-modal.tsx
git commit -m "style(palette): absence-edit-modal to surface tokens; red->pink (error + delete button)"
```

---

## Task 6: `shift-edit-modal.tsx` (destructive-button pattern)

**Files:** Modify `src/app/shift-edit-modal.tsx`.

- [ ] **Step 1: Migrate** — READ the file. Apply the shared mapping table.
- [ ] **Step 2: Named status edits** (identical pattern to Task 5):
  - Error `<p>`: `sm:col-span-2 text-sm text-red-600 dark:text-red-400` → `sm:col-span-2 text-sm text-ui-pink`
  - Delete `<button>` className: `rounded-md border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-700 shadow-sm hover:bg-red-50 dark:border-red-800 dark:bg-zinc-900 dark:text-red-400 dark:hover:bg-zinc-800` → `rounded-md border border-ui-pink/40 bg-surface px-3 py-1.5 text-sm font-medium text-ui-pink hover:bg-ui-pink/10 dark:border-ui-pink/50`
- [ ] **Step 3: Grep-verify** — both regexes return ZERO matches; duplicate-utility scan clean.
- [ ] **Step 4: Gates** — `npx vitest run shift-edit-modal`; `npx tsc --noEmit` (0); `npm run lint` (0).
- [ ] **Step 5: Commit**
```bash
git add src/app/shift-edit-modal.tsx
git commit -m "style(palette): shift-edit-modal to surface tokens; red->pink (error + delete button)"
```

---

## Task 7: `resource-edit-modal.tsx` (destructive-button pattern)

**Files:** Modify `src/app/resource-edit-modal.tsx`.

- [ ] **Step 1: Migrate** — READ the file. Apply the shared mapping table.
- [ ] **Step 2: Named status edits** (identical pattern to Tasks 5–6):
  - Error `<p>`: `text-sm text-red-600 sm:col-span-2 dark:text-red-400` → `text-sm text-ui-pink sm:col-span-2`
  - Delete `<button>` className: `rounded-md border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-700 shadow-sm hover:bg-red-50 dark:border-red-800 dark:bg-zinc-900 dark:text-red-400 dark:hover:bg-zinc-800` → `rounded-md border border-ui-pink/40 bg-surface px-3 py-1.5 text-sm font-medium text-ui-pink hover:bg-ui-pink/10 dark:border-ui-pink/50`
- [ ] **Step 3: Grep-verify** — both regexes return ZERO matches; duplicate-utility scan clean.
- [ ] **Step 4: Gates** — `npx vitest run resource-edit-modal`; `npx tsc --noEmit` (0); `npm run lint` (0).
- [ ] **Step 5: Commit**
```bash
git add src/app/resource-edit-modal.tsx
git commit -m "style(palette): resource-edit-modal to surface tokens; red->pink (error + delete button)"
```

---

## Task 8: `task-form-modal.tsx` (RAG indicator + multiple status edits — the largest)

**Files:** Modify `src/app/task-form-modal.tsx`.

- [ ] **Step 1: Migrate** — READ the file (590 lines — the biggest). Apply the shared mapping table to all form chrome. This file has many `<input>`/`<select>`/`<textarea>`/labels with `border-zinc-300 dark:border-zinc-700 dark:bg-zinc-900` patterns — all → `border-line` + appropriate surface/foreground tokens. The primary submit `bg-ui-dark-blue` stays; section headings stay.
- [ ] **Step 2: Named status edits** (exact before→after):
  - **RAG tones** (the `R: …, A: …, G: …` record literal — lines ~412–414):
    - `R: "border-red-500 bg-red-50 text-red-700 dark:border-red-500 dark:bg-red-950/40 dark:text-red-300"` → `R: "border-ui-pink bg-ui-pink/10 text-ui-pink dark:border-ui-pink dark:bg-ui-pink/15"`
    - `A: "border-amber-500 bg-amber-50 text-amber-800 dark:border-amber-500 dark:bg-amber-950/40 dark:text-amber-200"` → `A: "border-ui-purple bg-ui-purple/10 text-ui-purple dark:border-ui-purple dark:bg-ui-purple/15"`
    - `G: "border-emerald-500 bg-emerald-50 text-emerald-800 dark:border-emerald-500 dark:bg-emerald-950/40 dark:text-emerald-200"` → `G: "border-ui-green bg-ui-green/10 text-ui-green dark:border-ui-green dark:bg-ui-green/15"`
    (Preserve the keys `R`/`A`/`G` and the record-literal structure — only the string contents change.)
  - **Amber hint text** (~line 285): the `<span>`/`<p>` carrying `text-xs text-amber-700 dark:text-amber-400` → `text-xs text-ui-purple`.
  - **Red error box** (~line 466): `rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300 sm:col-span-2` → `rounded-md bg-ui-pink/10 px-3 py-2 text-sm text-ui-pink dark:bg-ui-pink/15 sm:col-span-2`.
  - **Required asterisk** (~line 585): `ml-0.5 text-red-500` → `ml-0.5 text-ui-pink`.
- [ ] **Step 3: Grep-verify** — both regexes return ZERO matches; duplicate-utility scan clean.
- [ ] **Step 4: Gates** — `npx vitest run task-form-modal` (the largest modal has the most tests; ALL must pass); `npx tsc --noEmit` (0); `npm run lint` (0).
- [ ] **Step 5: Commit**
```bash
git add src/app/task-form-modal.tsx
git commit -m "style(palette): task-form-modal to surface tokens; RAG (R->pink, A->purple, G->green); red->pink"
```

---

## Task 9: Release 0.15.4

**Files:** `src/app/version.ts`, `CHANGELOG.md`, `docs/DESIGN-TOKENS.md`.

- [ ] **Step 1: version.ts** — READ it. Set `export const APP_VERSION = "0.15.4";`. Update `APP_BUILD_DATE = "2026-05-28"; // Le Guin milestone`. Do NOT add a highlight key. Add a top comment above the existing `// 0.15.3 …` block:
```ts
// 0.15.4 sweeps the modal layer (resource/shift/absence edit, roles,
// budget-bucket, task form, jira conflicts, bulk edit) onto the brand palette —
// surface tokens, no shadows, destructive actions in pink, RAG status in
// pink/purple/green.
```
- [ ] **Step 2: CHANGELOG** — READ to match style; add above `[0.15.3]`:
```markdown
## [0.15.4] — 2026-05-28

### Changed
- Continued the brand design-system rollout: all editor modals (resource, shift, absence, roles, budget bucket, task, Jira conflicts, bulk edit) now use the brand palette and surface tokens — consistent light/dark surfaces, no drop shadows, destructive (Delete/Discard) actions in pink, and the task RAG status indicator mapped to pink (Risk) / purple (Amber) / green (Green).
```
(Match the format `[0.15.3]` actually uses if it differs.)
- [ ] **Step 3: DESIGN-TOKENS.md** — under "## Migration status (sub-project E)" add:
```markdown
- E-sweep modals (0.15.4): resource-edit, shift-edit, absence-edit, roles, budget-bucket, task-form, jira-conflicts, bulk-edit. ✅
```
And adjust the "Remaining" line so modals are removed (only tasks/RAID/gantt/reports + menus+chrome+misc remain).
- [ ] **Step 4: Verify** — `npx tsc --noEmit` (0); `npm run lint` (0); `npm run test:coverage` (green, ≥70%). Then `git status`; if `src/app/sample-workspace.md` is dirty, `git restore` it.
- [ ] **Step 5: Commit**
```bash
git add src/app/version.ts CHANGELOG.md docs/DESIGN-TOKENS.md
git commit -m "docs(release): 0.15.4 — palette sweep of all editor modals"
```

---

## Final review

Dispatch a final reviewer over `git diff main...HEAD`. Read `version.ts`/`CHANGELOG.md` directly. Confirm: `APP_VERSION === "0.15.4"`, no new highlight key, real `[0.15.4]` entry, DESIGN-TOKENS migration-status updated. For EACH of the 8 modal files, run BOTH verification regexes → ZERO matches each. Confirm the named edits landed (the destructive button recipe in 3 modals; the close-button red→pink in roles; the RAG tones + amber hint + error box + required-asterisk in task-form-modal). Confirm class-strings only — no logic/markup/behavior change; full suite green. Then use `superpowers:finishing-a-development-branch`.

---

## Self-Review (author)

**Spec coverage:** Each of the 8 in-scope modals → its own task (1–8); the shared mapping covers the chrome; per-file named status edits are explicit (Tasks 4, 5, 6, 7, 8); release + DESIGN-TOKENS + CHANGELOG → Task 9. RAG mapping (R→pink, A→purple, G→green) lives in Task 8 Step 2 with exact before→after for the record literal.

**Placeholder scan:** No TBD/TODO; the destructive-button recipe and the RAG triple are exact strings. Tasks 2 and 3 say "wherever red appears" because their non-chrome usage is light and verified by the grep at the end — the implementer applies the standard destructive recipe to any red they find. The "match `[0.15.3]` style" CHANGELOG note is a source-confirmation, not a placeholder.

**Type consistency:** Only Tailwind utility names; targets (`bg-surface`, `bg-surface-muted`, `border-line`, `text-foreground`, `text-muted-foreground`, `ring-ui-green`, plus the palette accent utilities and `bg-ui-pink/10`, `bg-ui-purple/15`, `bg-ui-green/15`) all resolve. The verification grep deliberately excludes `ui-*` alpha utilities (no digit after the color word). The `dark:text-ui-light-grey` heading-text variant is correctly preserved by the KEEP rule.
