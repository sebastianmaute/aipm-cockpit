# Resources Tab Unification — Design

**Date:** 2026-05-28
**Status:** Approved (design); pending implementation plan
**Branch:** `feat/0.16.1-resources-tab-unify`
**Context:** Sub-project **B** — the last open item from the 2026-05-27 batch (see [[design-system-batch]]). Aligns the Resources panel's sibling sub-views to the Workload tab's table chrome so they read as a family.

## Goal

Unify three sibling table surfaces in the Resources panel — **Directory**, **Planning** (+ its **Rollup** sub-table), and the **Resources Report** popup — to the **Workload** tab's table recipe. Class strings only; no behavior, markup, or prop changes.

## Canonical recipe (Workload — unchanged)

```
<table class="w-full text-left text-sm">
  <thead class="sticky top-0 z-10 bg-surface-muted text-xs uppercase tracking-wide text-muted-foreground">
    <th class="px-3 py-2 font-medium">…</th>
  <tbody class="divide-y divide-line">
    <td class="px-3 py-2 [text-foreground | text-muted-foreground] [text-right tabular-nums]">…</td>
```

Name buttons: `font-medium text-foreground` at the table's inherited size, with `hover:border-AIPM-dark-blue hover:bg-surface-muted`. Number cells: `text-right tabular-nums`. Empty-field placeholder: `"—"`. Primary cells = `text-foreground`; secondary fields = `text-muted-foreground`.

## Per-file edits

### `src/app/resource-directory.tsx`

| Where | Before | After |
|---|---|---|
| Name button (~L253) | `text-xs font-medium text-foreground` | `font-medium text-foreground` |

Everything else already matches Workload.

### `src/app/resources-panel.tsx` — Planning view

| Where | Before | After |
|---|---|---|
| `<table>` (~L343) | `text-left text-xs` | `w-full text-left text-sm` |
| `<thead>` (~L344) | `sticky top-0 bg-surface-muted` | `sticky top-0 z-10 bg-surface-muted text-xs uppercase tracking-wide text-muted-foreground` |
| First `<th>` (~L346) | `px-2 py-1.5 text-left` | `px-3 py-2 font-medium` |
| Period-key `<th>` (~L348) | `px-2 py-1.5 text-right tabular-nums` | `px-3 py-2 text-right font-medium tabular-nums` |
| Capacity / cost / margin `<th>` (~L350–353) | `px-2 py-1.5 text-right` | `px-3 py-2 text-right font-medium` |
| Name `<td>` (~L371) | `px-2 py-1` | `px-3 py-2` |
| Number-input wrapper `<td>` (~L392) | `px-1 py-1 text-right align-top` | `px-3 py-2 text-right align-top` |
| Totals / cost `<td>` (~L411–414) | `px-2 py-1 text-right tabular-nums` (+ `font-medium` on totals) | `px-3 py-2 text-right tabular-nums` (preserve `font-medium`) |
| `<tfoot>` row (~L423–428) | `px-2 py-1.5` | `px-3 py-2` (preserve `text-right tabular-nums`, `font-semibold` on the tr) |

### `src/app/resources-panel.tsx` — Rollup sub-table

| Where | Before | After |
|---|---|---|
| `<table>` (~L448) | `text-left text-xs` | `w-full text-left text-sm` |
| `<thead>` (~L449) | `sticky top-0 bg-surface-muted` | `sticky top-0 z-10 bg-surface-muted text-xs uppercase tracking-wide text-muted-foreground` |
| First `<th>` (~L451) | `px-2 py-1.5 text-left` | `px-3 py-2 font-medium` |
| Period-key `<th>` (~L453) | `px-2 py-1.5 text-right tabular-nums` | `px-3 py-2 text-right font-medium tabular-nums` |
| Name `<td>` (~L462) | `px-2 py-1 font-medium text-foreground dark:text-AIPM-light-grey` | `px-3 py-2 font-medium text-foreground` |
| Period-value `<td>` (~L464) | `px-2 py-1 text-right tabular-nums text-muted-foreground` | `px-3 py-2 text-right tabular-nums text-muted-foreground` |

(The redundant `dark:text-AIPM-light-grey` on the Rollup name `<td>` is dropped — `text-foreground` already resolves to the right value in both modes. Same canonical rule as the palette sweep.)

### `src/app/resources-report.tsx`

| Where | Before | After |
|---|---|---|
| `<Table>` `<table>` (~L122) | `min-w-full text-left text-xs` | `min-w-full text-left text-sm` |
| `<Table>` `<thead>` (~L123) | `bg-surface-muted uppercase tracking-wide text-muted-foreground` | `sticky top-0 z-10 bg-surface-muted text-xs uppercase tracking-wide text-muted-foreground` |
| `<Table>` `<th>` (~L124) | `px-3 py-2 ${i === 0 ? "" : "text-right"}` | `px-3 py-2 font-medium ${i === 0 ? "" : "text-right"}` |
| `<Td>` helper (~L133) | `px-3 py-2 font-medium text-AIPM-dark-blue dark:text-AIPM-light-grey` | `px-3 py-2 font-medium text-foreground` |

`<TdR>` already matches; no change.

## Non-goals

- The Calendar sub-view is a 30-day grid, not a table — out of scope.
- The 4 summary `<Tile>` cards at the top of the Resources Report keep their `text-AIPM-dark-blue` value styling — a stat-tile primitive, not a table cell.
- The Report's `<Section>` `<h3>` titles keep their existing styling — not table parts.
- No new components, no shared `<ResourceTable>` extraction (YAGNI — the four siblings have real structural differences and the unification is class-strings only).
- No i18n string changes — the `uppercase tracking-wide` is CSS, the strings stay sentence-case in source.

## Edge cases

- **Planning grid horizontal width.** The Planning table bumps from `text-xs` to `text-sm` and from `px-2 py-1` to `px-3 py-2`. With many period columns (e.g. 52 weeks/year) the table will scroll horizontally inside its `overflow-auto` wrapper — acceptable and intentional; week-view at very small viewports was already near the limit.
- **Number input cell padding.** The `<td>` wrapping the utilization + absence-override inputs goes from `px-1 py-1` to `px-3 py-2`. The inputs themselves keep their `w-16` width and own padding; only the cell breathing-room expands.
- **Rollup dark-variant drop.** Removing `dark:text-AIPM-light-grey` from the rollup name `<td>` is safe — `text-foreground` is the semantic token that already resolves correctly in both themes (this matches the canonical rule we hardened during the palette sweep: never pair a `text-AIPM-*` light value with its `dark:` partner when a surface token covers both).
- **Report Td color change.** `text-AIPM-dark-blue` → `text-foreground` lightens the report's first-column values slightly in light mode. Workload's first-column already reads as `text-foreground`, so this brings the report in line. Section titles (`<h3>`) and Tiles keep `text-AIPM-dark-blue` — the report still has its identifiable accents.

## Testing

- Existing tests in `resource-directory.test.tsx`, `resource-workload.test.tsx`, `resources-panel.test.tsx`, and `resources-report.test.tsx` assert behavior, not classes — they should stay green. If any test asserts on `text-xs` (directory name), `px-2 py-1` (planning), or `text-AIPM-dark-blue` (report Td), update those assertions to the new tokens.
- Per-file scoped grep — ZERO matches each:
  - `resource-directory.tsx` name button line: no `text-xs` on the name button (`<button … >resourceDisplayName(r)</button>`).
  - `resources-panel.tsx` Planning + Rollup tables: no `text-left text-xs` table base; no `px-2 py-1(\.5)?` inside the planning view; thead has the full uppercase recipe.
  - `resources-report.tsx`: `<table>` is `text-sm`; thead is `sticky top-0 z-10 …`; `Td` is `text-foreground`.
- Full suite: `npx vitest run` green, `npx tsc --noEmit` 0, `npm run lint` 0, `npm run test:coverage` ≥ 70%.

## Release

Patch → **0.16.1** (codename stays "Butler"). No highlight key — this is consistency polish, not a user-facing feature.

- `src/app/version.ts`: `APP_VERSION = "0.16.1"`. New top-of-file comment block recording the unification.
- `CHANGELOG.md` `[0.16.1] — 2026-05-28` entry:
  > "Resources panel: Directory / Planning / Report tables now share the Workload tab's table chrome — sticky uppercase header, consistent padding and density."
- No DESIGN-TOKENS.md change (the canonical Workload recipe is already documented implicitly via the surface-token rules from E0; no new tokens introduced).

## What this closes

After 0.16.1 ships, the original 2026-05-27 batch (`design-system-batch`) is complete: **C** RAID sort (0.14.2), **A** assignee click (0.14.3), **D** theme (0.15.0), **E** palette (0.15.1 → 0.16.0), **B** resources unification (0.16.1).
