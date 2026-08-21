# Palette Sweep — Tasks UI + Inputs + Reports chunk (0.15.5) — Design

**Date:** 2026-05-28
**Status:** Approved (design); pending implementation plan
**Branch:** `feat/0.15.5-palette-sweep-tasks-ui`
**Context:** E-sweep chunk 4a of sub-project **E** (after E0/0.15.1 tokens; chunk-1/0.15.2 panels; chunk-2/0.15.3 calendar; chunk-3/0.15.4 modals). The user split the tasks/RAID/gantt/reports area into three chunks: **(4a) tasks UI + inputs + reports** (this spec — mechanical), **(4b) raid-panel** (own cycle with R/A/I/D + severity design), **(4c) gantt** (own cycle with lateness ramp). See [[design-system-batch]].

## Goal

Migrate 8 component files (~2849 LOC) from `zinc-*`/shadows/off-palette status colors to the AIPM palette + semantic surface tokens, with no behavior/markup change. Status colors all map to already-documented `DESIGN-TOKENS.md` patterns; no new design.

## Scope (8 files)

`combo-input.tsx`, `contact-input.tsx`, `labels-input.tsx`, `dependencies-editor.tsx`, `task-manager-ui.tsx`, `tasks-section.tsx`, `reports.tsx`, `task-row.tsx`.

**Out of scope** (later cycles): `raid-panel.tsx`, `gantt.tsx`, the menus + chrome misc files.

## Mapping — the chunk pattern (same as chunks 1, 3 — hardened)

| Current utility | Replace with |
|---|---|
| `bg-white` | `bg-surface` |
| `bg-zinc-50/100`, `dark:bg-zinc-900`, `dark:bg-zinc-950` | `bg-surface-muted` |
| `border-zinc-200/300`, `dark:border-zinc-700/800`, `border-AIPM-light-grey` | `border-line` |
| `divide-zinc-*`, `divide-AIPM-light-grey` | `divide-line` |
| `bg-AIPM-light-grey`(`/NN`) (chrome bg) | `bg-surface-muted` |
| `shadow-*` | remove |
| `focus:ring-AIPM-dark-blue` / `focus-visible:ring-AIPM-dark-blue` / `ring-zinc-*` | `ring-AIPM-green` |
| `hover:bg-zinc-*` / `dark:hover:bg-zinc-*` / `hover:bg-AIPM-light-grey` | `hover:bg-surface-muted` |
| `text-zinc-900/800/700` (+ paired dark) | `text-foreground` |
| `text-zinc-500/600/400` (+ paired dark) | `text-muted-foreground` |
| `text-AIPM-dark-grey` (+ any paired `dark:text-AIPM-light-grey`) | `text-foreground` |
| `text-AIPM-medium-grey` (+ any paired dark) | `text-muted-foreground` |
| `bg-gradient-*`, `from-*`, `via-*`, `to-*` | remove |

**KEEP UNCHANGED:** `bg-AIPM-dark-blue text-white` fills; heading pairs `text-AIPM-dark-blue dark:text-AIPM-light-grey`; all AIPM accent colors (`AIPM-pink`, `AIPM-green`, `AIPM-blue`, `AIPM-purple`); ALL non-class code.

**CRITICAL:** REPLACE each utility in place — never ADD a second color utility. After editing, no className may contain two `bg-*`, two `border-<color>`, two `divide-*`, or two `text-<color>` base utilities (variants like `hover:`/`dark:` are fine).

## Per-file named status edits

**`task-row.tsx`** — Priority chip ramp + a few status bits:

| Spot | Before → After |
|---|---|
| Priority chip Medium (~line 92) | `bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300` → `bg-AIPM-blue/15 text-AIPM-blue dark:bg-AIPM-blue/20` |
| Priority chip High (~line 93) | `bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300` → `bg-AIPM-purple/15 text-AIPM-purple dark:bg-AIPM-purple/20` |
| Priority chip Urgent (~line 94) | `bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300` → `bg-AIPM-pink/15 text-AIPM-pink dark:bg-AIPM-pink/20` |
| Row editing highlight (~line 159) | `bg-amber-50 dark:bg-amber-950/20` → `bg-AIPM-purple/10 dark:bg-AIPM-purple/15` |
| Row selected highlight (~line 159) | `bg-AIPM-light-grey dark:bg-zinc-900` → `bg-surface-muted` |
| Inquiry-sent link (~line 382) | `text-red-600 ... dark:text-red-400` → `text-AIPM-pink` |
| Stale badge (~line 441) | `bg-amber-100 text-amber-800 hover:bg-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:hover:bg-amber-950/60` → `bg-AIPM-purple/15 text-AIPM-purple hover:bg-AIPM-purple/25 dark:bg-AIPM-purple/20 dark:hover:bg-AIPM-purple/30` |

The Priority ramp **Low (implicit/unchipped) → Medium=AIPM-blue → High=AIPM-purple → Urgent=AIPM-pink** is the documented status mapping (info → warning → alert), 3 distinct hues for the 3 chipped levels.

**`reports.tsx`** — RAG legend + a chart bar color:

| Spot | Before → After |
|---|---|
| RAG record R (~line 262) | `R: "bg-red-500"` → `R: "bg-AIPM-pink"` |
| RAG record A (~line 263) | `A: "bg-amber-500"` → `A: "bg-AIPM-purple"` |
| RAG record G (~line 264) | `G: "bg-emerald-500"` → `G: "bg-AIPM-green"` |
| Other chart color (~line 358) | `color: "bg-amber-500"` → `color: "bg-AIPM-purple"` (amber → purple per the standard mapping) |

**`combo-input`, `contact-input`, `labels-input`, `dependencies-editor`, `task-manager-ui`, `tasks-section`** — pure chrome (form inputs, sections, sticky headers, buttons). No named status edits — apply the chunk mapping only.

## Non-goals

- No layout/logic/markup/prop/behavior changes — class strings only (plus the named string-literal edits to the RAG record in reports.tsx and the priority record in task-row.tsx).
- No new tokens (E0 covered them).
- `raid-panel.tsx`, `gantt.tsx`, and the menus + chrome files are out of scope (future chunks).

## Edge cases

- **Priority "Low"** in task-row may have no chip color today (the chip class record might omit Low → renders unchipped). The migration only edits Medium/High/Urgent; if Low has a class, it's already neutral and stays untouched (verify by reading).
- **Selected vs editing row highlights** can both be active on the same row; they currently share the same `<tr>` className conditional — the order is preserved so editing wins over selected (same behavior as before).
- **reports chart bars** beyond the RAG legend may use other Tailwind palette shades — the verification grep catches them. If any are found beyond the listed `bg-amber-500` at ~358, map them per the standard rule (amber→purple, etc.) during implementation.

## Testing

- Each file's existing tests (where present) assert behavior/roles/text — not zinc classes — and must stay green.
- **Per-file verification grep** (on each migrated file) → ZERO matches for:
  - (a) `zinc-|shadow-|bg-gradient|from-\[|(amber|red|emerald|sky|rose|slate|gray|orange|yellow|teal|cyan|indigo|violet|fuchsia|green|blue|purple|pink)-[0-9]`
  - (b) `border-AIPM-light-grey|divide-AIPM-light-grey|bg-AIPM-light-grey|text-AIPM-dark-grey|text-AIPM-medium-grey`
- **Duplicate-utility scan** per file: no element with two same-property color utilities.
- Gates each task: `npx tsc --noEmit` (0), `npm run lint` (0), the file's `vitest run` green.

## Release

Patch → **0.15.5** (keep "Le Guin"), no highlight key. Bump `version.ts` (top comment, `APP_VERSION = "0.15.5"`, date 2026-05-28), add a `[0.15.5]` CHANGELOG entry, update `docs/DESIGN-TOKENS.md` migration status with a "E-sweep tasks UI + inputs + reports (0.15.5)" line and adjust the "Remaining" line to drop these 8 files. Gates: lint 0, tsc 0, `test:coverage` green (≥70%).
