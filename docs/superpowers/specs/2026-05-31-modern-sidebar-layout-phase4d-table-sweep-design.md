# Modern Sidebar Layout — Phase 4 Workstream D: Divergent-Table Sweep

**Date:** 2026-05-31
**Status:** Design approved, ready for implementation plan
**Phase:** Phase 4 "Shell Polish" — Workstream D (independent of A/B/C)

## Goal

Bring the 7 remaining bespoke table headers (across 5 files) onto the shared
Dark-Blue `TABLE_HEAD_CLASS` treatment, and grow the source-level sweep guard so
those files cannot drift back to bespoke headers.

## Background

Phases 3 and 4A–C swept eight files onto the single-source-of-truth header token
`TABLE_HEAD_CLASS` (in `table-styles.ts`):

```ts
export const TABLE_HEAD_CLASS =
  "sticky top-0 z-10 bg-AIPM-dark-blue text-xs uppercase tracking-wide text-white";
```

Five files were deferred and still render bespoke `<thead>` markup. They are NOT
tracked by any `PENDING_SWEEP` list — they are simply absent from the guard's
`SWEPT_FILES` array. This workstream finishes the sweep.

### Established patterns (verified in-repo)

- **Sweep guard** (`table-head-sweep.test.ts`): a cwd-based source check. For each
  file in `SWEPT_FILES` it asserts the source **contains** the identifier
  `"TABLE_HEAD_CLASS"` and does **not** contain the legacy string
  `"bg-surface-muted text-xs uppercase tracking-wide text-muted-foreground"`. It is
  a text-level check, not a DOM check.
- **In-header sort buttons**: white text (inherited from `TABLE_HEAD_CLASS`) with
  `hover:text-AIPM-green`; active column `text-AIPM-green`. The shared `SortableTh`
  (`task-manager-ui.tsx`) encodes this; `raid-panel`/`resource-directory` inline
  equivalent buttons with `className="… hover:text-AIPM-green"`.
- **Composition**: every swept `<thead>` uses the **bare** `className={TABLE_HEAD_CLASS}`.
  There is no precedent for composing extra classes onto a swept `<thead>`.

## Decisions (from brainstorming)

1. **Scope:** sweep all 5 files uniformly (no exemptions).
2. **Sort-button tone:** match the swept tables exactly — replace the now-invisible
   `hover:text-AIPM-dark-blue` with `hover:text-AIPM-green`; white text is inherited.
3. **Sticky stays everywhere:** keep `TABLE_HEAD_CLASS` bare (it carries
   `sticky top-0 z-10`). Short modal tables make sticky a no-op; no per-table opt-out.

## Architecture — the 7 headers

| File | `<thead>` today | Change |
|---|---|---|
| **reports.tsx** ×3 (L475 / L645 / L741) | `className="bg-surface-muted text-foreground uppercase tracking-wide"` | → `className={TABLE_HEAD_CLASS}`; sort `<button>` hovers → `hover:text-AIPM-green` |
| **roles-modal.tsx** (L121) | `className="text-xs uppercase tracking-wide text-muted-foreground"` | → `className={TABLE_HEAD_CLASS}`; sort buttons `hover:text-AIPM-dark-blue` → `hover:text-AIPM-green` |
| **budget-panel.tsx** (L263) | `<thead>` (no class) + `<tr className="text-muted-foreground">` | → `<thead className={TABLE_HEAD_CLASS}>`; drop `text-muted-foreground` on the header row so white is inherited |
| **jira-conflicts-modal.tsx** (L190) | `className="text-muted-foreground"` | → `className={TABLE_HEAD_CLASS}` (tiny per-conflict tables; `sticky top-0` is harmless on short tables) |
| **resource-calendar.tsx** (L159) | `<thead>` (no class); frozen corner `<th className="sticky left-0 top-0 z-30 … bg-surface-muted … text-muted-foreground">` | → `<thead className={TABLE_HEAD_CLASS}>`; corner th keeps `sticky left-0 z-30` but its **bg → `bg-AIPM-dark-blue`** and **text → `text-white`** so the frozen corner matches |

### The one special cell

Because a `<th>` background paints over the `<thead>` background, the calendar's
frozen top-left corner cell needs `bg-AIPM-dark-blue text-white` set **explicitly**
(kept sticky-left at `z-30`). This is a `<th>`-level change, not `<thead>`
composition, so it does not violate the "bare `TABLE_HEAD_CLASS`" convention and
the guard (which only inspects that the file references `TABLE_HEAD_CLASS`) still
passes. Every other change is a clean class swap; white/green are inherited or
already-permitted palette colors.

## Guard hardening

In `table-head-sweep.test.ts`:

1. Add the 5 files to `SWEPT_FILES`:
   `reports.tsx`, `budget-panel.tsx`, `jira-conflicts-modal.tsx`, `roles-modal.tsx`,
   `resource-calendar.tsx`.
2. Generalize the single `LEGACY_HEAD` constant into a `FORBIDDEN_HEADS` array that
   also includes the reports variant
   `"bg-surface-muted text-foreground uppercase tracking-wide"`, and assert each
   swept file contains none of them. This makes the no-drift check catch reports'
   bespoke string too (the original `LEGACY_HEAD` used `text-muted-foreground`, not
   `text-foreground`, so it would otherwise miss it).

## Data Flow & Error Handling

None. This is a presentational/styling sweep — no data paths, props, state, or
error surfaces change. Sort/column-resize logic is untouched.

## i18n

**None.** No translation keys added or changed; no `i18n.de.ts` edit, so the known
ASCII-quote→curly-quote corruption hazard does not apply this round.

## Testing

- **`table-head-sweep.test.ts`** (primary protection): extended `SWEPT_FILES` +
  `FORBIDDEN_HEADS` as above. RED first (the 5 new files fail the contains/forbidden
  checks), GREEN after each file is swept.
- **Existing component tests** — `reports.test.tsx`, `roles-modal.test.tsx`,
  `budget-panel.test.tsx`, `resource-calendar.test.tsx`, and the jira-conflicts host
  test — run to confirm no behavioral regression.
- **Focused render assertion** where cheap: confirm a swept table renders a
  `<thead>` carrying the dark-blue token (e.g. asserting the class string is present)
  in at least one of the converted files.
- Full `tsc` + `vitest` green before release.

## Release

- Next release: **0.35.0**, codename **"Muir"** (Tamsyn Muir) — verify no collision
  against existing CHANGELOG codenames during the release task.
- Branch: `phase4d-table-sweep`; merge to `main` locally; push only on request.

## Constraints Honored

- AIPM 9-color palette only; no gradients, no drop shadows, no off-palette colors
  (Dark Blue header + White text + Green accent hover are all permitted tokens).
- `README.md` and `public/*.png` are pre-existing uncommitted user changes — never
  touched or staged (scoped `git add` only; never `git add -A`/`.`).

## Out of Scope

- Any table feature, column, or sort-logic change.
- Any visual redesign beyond the header treatment.
- Workstreams A/B/C (already merged).
