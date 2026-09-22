# Palette Sweep — Modals chunk (0.15.4) — Design

**Date:** 2026-05-28
**Status:** Approved (design); pending implementation plan
**Branch:** `feat/0.15.4-palette-sweep-modals`
**Context:** E-sweep chunk of sub-project **E** (after E0/0.15.1 tokens, chunk-1/0.15.2 panels, chunk-2/0.15.3 calendar). This chunk migrates the 8 modal components to `docs/DESIGN-TOKENS.md`. The mapping is the proven chunk pattern; design rules are settled. See [[design-system-batch]].

## Goal

Migrate 8 modals (~2833 LOC total) from `zinc-*`/shadows/off-palette status colors to the brand palette + semantic surface tokens, with no behavior/layout/markup changes.

## Scope (8 files)

`resource-edit-modal.tsx`, `shift-edit-modal.tsx`, `absence-edit-modal.tsx`, `roles-modal.tsx`, `budget-bucket-modal.tsx`, `task-form-modal.tsx`, `jira-conflicts-modal.tsx`, `bulk-edit-modal.tsx`.

The shared `modal.tsx` and `modal-header.tsx` were already migrated in E0 — not in scope here.

## Mapping — the chunk pattern (same as chunk 1, hardened)

| Current | → |
|---|---|
| `bg-white` | `bg-surface` |
| `bg-zinc-50/100` / `dark:bg-zinc-900/950` | `bg-surface-muted` |
| `border-zinc-200/300` / `dark:border-zinc-700/800` / `border-ui-light-grey` | `border-line` |
| `divide-zinc-*` / `divide-ui-light-grey` | `divide-line` |
| `bg-ui-light-grey`(`/NN`) (surface/header bg) | `bg-surface-muted` |
| `shadow-*` | removed |
| `focus:ring-ui-dark-blue` / `focus-visible:ring-ui-dark-blue` / `ring-zinc-*` | `ring-ui-green` |
| `hover:bg-zinc-*` / `dark:hover:bg-zinc-*` / `hover:bg-ui-light-grey` | `hover:bg-surface-muted` |
| `text-zinc-9/8/700` (+ paired dark) | `text-foreground` |
| `text-zinc-5/6/400` (+ paired dark) | `text-muted-foreground` |
| `text-ui-dark-grey` (+ any paired `dark:text-ui-light-grey`) | `text-foreground` |
| `text-ui-medium-grey` (+ any paired dark) | `text-muted-foreground` |
| `bg-gradient-*` / `from-*` / `via-*` / `to-*` | removed |

**KEEP UNCHANGED:** solid fills `bg-ui-dark-blue text-white`; heading pairs `text-ui-dark-blue dark:text-ui-light-grey`; all petrol accent colors (`ui-pink`, `ui-green`, `ui-blue`, `ui-purple`); ALL non-class code.

**CRITICAL:** REPLACE each utility in place — never ADD a second color utility. After editing, no className may contain two `bg-*`, two `border-<color>`, two `divide-*`, or two `text-<color>` base utilities (variants like `hover:`/`dark:` are fine).

## Per-file named status edits

| File | Edits |
|---|---|
| `absence-edit-modal`, `shift-edit-modal`, `resource-edit-modal` | Identical pattern. Error `<p>`: `text-red-600 dark:text-red-400` → `text-ui-pink`. Destructive (Delete/Discard) button: `border-red-300 bg-white px-… text-red-700 shadow-sm hover:bg-red-50 dark:border-red-800 dark:bg-zinc-900 dark:text-red-400 dark:hover:bg-zinc-800` → `border-ui-pink/40 bg-surface px-… text-ui-pink hover:bg-ui-pink/10 dark:border-ui-pink/50` (shadow + zinc dropped). |
| `roles-modal` | Two close `×` buttons: `text-ui-medium-grey hover:bg-red-50 hover:text-red-600 dark:hover:bg-zinc-800` → `text-muted-foreground hover:bg-ui-pink/10 hover:text-ui-pink`. |
| `task-form-modal` | **RAG status tones** (R/A/G three-step ramp): `R: "border-red-500 bg-red-50 text-red-700 dark:border-red-500 dark:bg-red-950/40 dark:text-red-300"` → `R: "border-ui-pink bg-ui-pink/10 text-ui-pink dark:border-ui-pink dark:bg-ui-pink/15"`. `A: "border-amber-500 bg-amber-50 text-amber-800 dark:border-amber-500 dark:bg-amber-950/40 dark:text-amber-200"` → `A: "border-ui-purple bg-ui-purple/10 text-ui-purple dark:border-ui-purple dark:bg-ui-purple/15"`. `G: "border-emerald-500 bg-emerald-50 text-emerald-800 dark:border-emerald-500 dark:bg-emerald-950/40 dark:text-emerald-200"` → `G: "border-ui-green bg-ui-green/10 text-ui-green dark:border-ui-green dark:bg-ui-green/15"`. Plus: amber hint `text-amber-700 dark:text-amber-400` → `text-ui-purple`; red-50 error box `rounded-md bg-red-50 px-… text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300` → `rounded-md bg-ui-pink/10 px-… text-sm text-ui-pink dark:bg-ui-pink/15`; required-asterisk `text-red-500` → `text-ui-pink`. |
| `jira-conflicts-modal`, `bulk-edit-modal` | Apply the standard red→`ui-pink` mapping wherever red appears (the implementer confirms during the per-file pass). Otherwise pure chrome. |
| `budget-bucket-modal` | Pure chrome — no status colors. |

The RAG mapping matches `DESIGN-TOKENS.md` status semantics: Risk→alert (pink), Amber→warning (purple), Green→positive (green) — a 3-step semantic ramp.

## Non-goals

- No layout, logic, markup, prop, or behavior changes — class strings only.
- No new tokens (E0 covered them).
- Files outside the 8 listed modals stay untouched (other E-sweep chunks remain pending).

## Edge cases

- **Destructive button background:** original was `bg-white` with red text/border + a `red-50` hover. New version uses `bg-surface` (token) with `ui-pink/40` border, `text-ui-pink`, and `hover:bg-ui-pink/10` — a soft tinted hover that works in both modes (no separate `dark:` hover needed since the alpha tint composites over the surface).
- **Mixed ui-light-grey usages:** like earlier files, `border-ui-light-grey`/`divide-ui-light-grey`/`bg-ui-light-grey` (chrome) → `-line`/`-line`/`surface-muted`. `dark:text-ui-light-grey` as heading-text dark variant stays.
- **task-form-modal RAG keys:** the tone helper is a record literal `{ R: "…", A: "…", G: "…" }` — these are class-string literals; preserving the keys and string structure (just swapping the class contents) keeps the data-driven coloring intact.

## Testing

- Each modal has tests (form behavior, role queries, click handlers) — none assert specific zinc classes → all must stay green.
- **Per-file verification grep** (on each migrated file) → ZERO: `zinc-|shadow-|bg-gradient|from-\[|(amber|red|emerald|sky|rose|slate|gray|orange|yellow|teal|cyan|indigo|violet|fuchsia|green|blue|purple|pink)-[0-9]` AND ZERO: `border-ui-light-grey|divide-ui-light-grey|bg-ui-light-grey|text-ui-dark-grey|text-ui-medium-grey`.
- **Duplicate-utility scan** per file: no element with two same-property color utilities.
- Gates each task: `npx tsc --noEmit` (0), `npm run lint` (0), the file's `vitest run` green.

## Release

Patch → **0.15.4** (keep "Le Guin"), no highlight key. Bump `version.ts` (top comment, `APP_VERSION = "0.15.4"`, build date 2026-05-28), add a `[0.15.4]` CHANGELOG entry, update the `docs/DESIGN-TOKENS.md` migration status (modals ✅; remaining: tasks/RAID/gantt/reports + menus+chrome+misc). Gates: lint 0, tsc 0, `test:coverage` green (≥70%).
