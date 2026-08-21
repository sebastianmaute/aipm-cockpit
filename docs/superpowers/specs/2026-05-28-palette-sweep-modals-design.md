# Palette Sweep — Modals chunk (0.15.4) — Design

**Date:** 2026-05-28
**Status:** Approved (design); pending implementation plan
**Branch:** `feat/0.15.4-palette-sweep-modals`
**Context:** E-sweep chunk of sub-project **E** (after E0/0.15.1 tokens, chunk-1/0.15.2 panels, chunk-2/0.15.3 calendar). This chunk migrates the 8 modal components to `docs/DESIGN-TOKENS.md`. The mapping is the proven chunk pattern; design rules are settled. See [[design-system-batch]].

## Goal

Migrate 8 modals (~2833 LOC total) from `zinc-*`/shadows/off-palette status colors to the AIPM palette + semantic surface tokens, with no behavior/layout/markup changes.

## Scope (8 files)

`resource-edit-modal.tsx`, `shift-edit-modal.tsx`, `absence-edit-modal.tsx`, `roles-modal.tsx`, `budget-bucket-modal.tsx`, `task-form-modal.tsx`, `jira-conflicts-modal.tsx`, `bulk-edit-modal.tsx`.

The shared `modal.tsx` and `modal-header.tsx` were already migrated in E0 — not in scope here.

## Mapping — the chunk pattern (same as chunk 1, hardened)

| Current | → |
|---|---|
| `bg-white` | `bg-surface` |
| `bg-zinc-50/100` / `dark:bg-zinc-900/950` | `bg-surface-muted` |
| `border-zinc-200/300` / `dark:border-zinc-700/800` / `border-AIPM-light-grey` | `border-line` |
| `divide-zinc-*` / `divide-AIPM-light-grey` | `divide-line` |
| `bg-AIPM-light-grey`(`/NN`) (surface/header bg) | `bg-surface-muted` |
| `shadow-*` | removed |
| `focus:ring-AIPM-dark-blue` / `focus-visible:ring-AIPM-dark-blue` / `ring-zinc-*` | `ring-AIPM-green` |
| `hover:bg-zinc-*` / `dark:hover:bg-zinc-*` / `hover:bg-AIPM-light-grey` | `hover:bg-surface-muted` |
| `text-zinc-9/8/700` (+ paired dark) | `text-foreground` |
| `text-zinc-5/6/400` (+ paired dark) | `text-muted-foreground` |
| `text-AIPM-dark-grey` (+ any paired `dark:text-AIPM-light-grey`) | `text-foreground` |
| `text-AIPM-medium-grey` (+ any paired dark) | `text-muted-foreground` |
| `bg-gradient-*` / `from-*` / `via-*` / `to-*` | removed |

**KEEP UNCHANGED:** solid fills `bg-AIPM-dark-blue text-white`; heading pairs `text-AIPM-dark-blue dark:text-AIPM-light-grey`; all AIPM accent colors (`AIPM-pink`, `AIPM-green`, `AIPM-blue`, `AIPM-purple`); ALL non-class code.

**CRITICAL:** REPLACE each utility in place — never ADD a second color utility. After editing, no className may contain two `bg-*`, two `border-<color>`, two `divide-*`, or two `text-<color>` base utilities (variants like `hover:`/`dark:` are fine).

## Per-file named status edits

| File | Edits |
|---|---|
| `absence-edit-modal`, `shift-edit-modal`, `resource-edit-modal` | Identical pattern. Error `<p>`: `text-red-600 dark:text-red-400` → `text-AIPM-pink`. Destructive (Delete/Discard) button: `border-red-300 bg-white px-… text-red-700 shadow-sm hover:bg-red-50 dark:border-red-800 dark:bg-zinc-900 dark:text-red-400 dark:hover:bg-zinc-800` → `border-AIPM-pink/40 bg-surface px-… text-AIPM-pink hover:bg-AIPM-pink/10 dark:border-AIPM-pink/50` (shadow + zinc dropped). |
| `roles-modal` | Two close `×` buttons: `text-AIPM-medium-grey hover:bg-red-50 hover:text-red-600 dark:hover:bg-zinc-800` → `text-muted-foreground hover:bg-AIPM-pink/10 hover:text-AIPM-pink`. |
| `task-form-modal` | **RAG status tones** (R/A/G three-step ramp): `R: "border-red-500 bg-red-50 text-red-700 dark:border-red-500 dark:bg-red-950/40 dark:text-red-300"` → `R: "border-AIPM-pink bg-AIPM-pink/10 text-AIPM-pink dark:border-AIPM-pink dark:bg-AIPM-pink/15"`. `A: "border-amber-500 bg-amber-50 text-amber-800 dark:border-amber-500 dark:bg-amber-950/40 dark:text-amber-200"` → `A: "border-AIPM-purple bg-AIPM-purple/10 text-AIPM-purple dark:border-AIPM-purple dark:bg-AIPM-purple/15"`. `G: "border-emerald-500 bg-emerald-50 text-emerald-800 dark:border-emerald-500 dark:bg-emerald-950/40 dark:text-emerald-200"` → `G: "border-AIPM-green bg-AIPM-green/10 text-AIPM-green dark:border-AIPM-green dark:bg-AIPM-green/15"`. Plus: amber hint `text-amber-700 dark:text-amber-400` → `text-AIPM-purple`; red-50 error box `rounded-md bg-red-50 px-… text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300` → `rounded-md bg-AIPM-pink/10 px-… text-sm text-AIPM-pink dark:bg-AIPM-pink/15`; required-asterisk `text-red-500` → `text-AIPM-pink`. |
| `jira-conflicts-modal`, `bulk-edit-modal` | Apply the standard red→`AIPM-pink` mapping wherever red appears (the implementer confirms during the per-file pass). Otherwise pure chrome. |
| `budget-bucket-modal` | Pure chrome — no status colors. |

The RAG mapping matches `DESIGN-TOKENS.md` status semantics: Risk→alert (pink), Amber→warning (purple), Green→positive (green) — a 3-step semantic ramp.

## Non-goals

- No layout, logic, markup, prop, or behavior changes — class strings only.
- No new tokens (E0 covered them).
- Files outside the 8 listed modals stay untouched (other E-sweep chunks remain pending).

## Edge cases

- **Destructive button background:** original was `bg-white` with red text/border + a `red-50` hover. New version uses `bg-surface` (token) with `AIPM-pink/40` border, `text-AIPM-pink`, and `hover:bg-AIPM-pink/10` — a soft tinted hover that works in both modes (no separate `dark:` hover needed since the alpha tint composites over the surface).
- **Mixed AIPM-light-grey usages:** like earlier files, `border-AIPM-light-grey`/`divide-AIPM-light-grey`/`bg-AIPM-light-grey` (chrome) → `-line`/`-line`/`surface-muted`. `dark:text-AIPM-light-grey` as heading-text dark variant stays.
- **task-form-modal RAG keys:** the tone helper is a record literal `{ R: "…", A: "…", G: "…" }` — these are class-string literals; preserving the keys and string structure (just swapping the class contents) keeps the data-driven coloring intact.

## Testing

- Each modal has tests (form behavior, role queries, click handlers) — none assert specific zinc classes → all must stay green.
- **Per-file verification grep** (on each migrated file) → ZERO: `zinc-|shadow-|bg-gradient|from-\[|(amber|red|emerald|sky|rose|slate|gray|orange|yellow|teal|cyan|indigo|violet|fuchsia|green|blue|purple|pink)-[0-9]` AND ZERO: `border-AIPM-light-grey|divide-AIPM-light-grey|bg-AIPM-light-grey|text-AIPM-dark-grey|text-AIPM-medium-grey`.
- **Duplicate-utility scan** per file: no element with two same-property color utilities.
- Gates each task: `npx tsc --noEmit` (0), `npm run lint` (0), the file's `vitest run` green.

## Release

Patch → **0.15.4** (keep "Le Guin"), no highlight key. Bump `version.ts` (top comment, `APP_VERSION = "0.15.4"`, build date 2026-05-28), add a `[0.15.4]` CHANGELOG entry, update the `docs/DESIGN-TOKENS.md` migration status (modals ✅; remaining: tasks/RAID/gantt/reports + menus+chrome+misc). Gates: lint 0, tsc 0, `test:coverage` green (≥70%).
