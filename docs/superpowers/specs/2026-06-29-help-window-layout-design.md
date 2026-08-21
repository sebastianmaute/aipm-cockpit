# Help Window Layout — Design

**Date:** 2026-06-29
**Status:** Approved (brainstorming)
**Scope:** Improve and unify the layout of the two Help surfaces (floating panel + in-pane view) via one shared content component.

## Goal

Both Help surfaces share one refined two-pane layout. Fix: weak hierarchy/density, cramped TOC, inconsistency between the surfaces, and the floating panel's oversized fixed default. Achieved by extracting the two-pane TOC+content render into a single reusable component consumed by both surfaces.

## Approach

Approach **A** (refined two-pane) via a **shared presentational component** (`HelpContentPane`). Surface-specific chrome (drag/resize frame + footer for the floating panel; header search + tours + relations map + print for the in-pane view) stays in each consumer. The shared component owns only the grouped TOC + grouped content + scroll-to-section.

Both surfaces unify on the **scroll + TOC-jump** interaction model (the in-pane view's). The floating panel **drops its `tablist`/`tabpanel` + keyboard-tab navigation** — this is the change that removes the inconsistency at the root.

## Components

### New: `src/app/help-content-pane.tsx` — `HelpContentPane`

Presentational, pure. No tours / relations / search input / footer (parents own those).

**Props:**
- `lang: Lang`
- `query: string` — parent owns the search `<input>`; passes the current string down.
- `onNavigateView?: (view: AppView) => void` — Related→view links (optional; absent → render the view name as plain text, mirroring `help-view`'s current behavior).

**Renders:**
- Grouped **TOC** (`<nav aria-label={t(lang,"helpContents")}>`, `w-52`): per group (`HELP_GROUP_ORDER`) a label header (`HELP_GROUP_LABEL[group]`) + an entry jump-button per matching entry. Active entry gets `border-l-2 border-AIPM-dark-blue bg-surface-muted`.
- Grouped **content**: all matching entries; per group a divider header, then per entry an `<h3>` title + body paragraph. Related concept links (scroll within pane) + Related view links (`onNavigateView`).
- Owns its content scroll container ref + `scrollToSection(id)`.
- Filters `HELP_ENTRIES` via existing `matchesQuery(title, body, query)`; groups via `HELP_GROUP_ORDER`. Empty result → `helpNoResults`.
- Search-match highlight via existing `highlightSegments` → `<mark className="bg-AIPM-green/20 text-inherit">`.

### Modified: `src/app/help-view.tsx`

Keep all chrome: header (`<h2>` + search `<input>` + Take-tour + Print + Reset), Guided-tours `<details open>`, relations-map `<details open>`. Replace the inline two-pane block (current grouped TOC + content) with `<HelpContentPane lang={lang} query={query} onNavigateView={onNavigateView} />`. The header search `query` state threads into the shared component. Pane still wrapped in the `rounded-md border border-line` scroll container.

### Modified: `src/app/help-menu.tsx`

Keep the draggable/resizable frame, title bar (HELP + ✕), intro line, and footer (Take-tour + License; policy link already removed). Replace the `tablist`/`tabpanel` block AND its keyboard-tab nav (`onTabKeyDown`, `tabRefs`, `activeIdx`) with: a search `<input>` (owns `query` state) + `<HelpContentPane lang={lang} query={query} />`.

- Default size → **760 × 620** (from 1120 × 960). **Bump** the resize storage key `lop-app:help-size` → `lop-app:help-size-v2` so a stale persisted size is discarded (AGENTS.md: `useResizable` inline-size overrides class width). Update the first-render default-pos fallback numbers (1120/960 → 760/620).
- `HELP_ENTRIES` already in use here (from the prior content-parity change) — grouping headers already present in the TOC; this change replaces the tab mechanics with scroll+jump.

## Layout / hierarchy (applies to both via the shared component)

- Group divider header: `text-xs font-semibold uppercase tracking-wide text-AIPM-dark-blue dark:text-AIPM-light-grey border-b border-line pb-1`.
- Entry title: `text-sm font-semibold text-foreground`.
- Entry body: `text-sm text-muted-foreground leading-relaxed max-w-[64ch] whitespace-pre-line`.
- Group gap `mb-6`; entry gap `gap-4`. TOC items `text-xs`. TOC width `w-52` (replaces cramped `w-40` / `w-56`).

## Responsive (container query — panel is draggable, decoupled from viewport)

- Pane root: `@container/help`.
- Layout: `flex flex-col @[560px]/help:flex-row`.
- ≥560px: TOC `@[560px]/help:w-52 @[560px]/help:border-r`, content scrolls beside it.
- <560px: stacks — TOC becomes a horizontal scrollable group-jump strip (`flex-row gap-1 overflow-x-auto border-b`) above the content; never a crushed two-column.
- In-pane view is always wide → always gets the row layout via the same code path.
- Tailwind v4 container-query syntax only (`@container/help`, `@[560px]/help:`); no `|` or `*` inside arbitrary-value brackets.

## Accessibility

Neither Help surface is in the axe gate (`A11Y_VIEWS`) → eye-verify (incl. dark + Mockup). Keep clean regardless:
- TOC `<nav aria-label={helpContents}>`; jump buttons are real `<button>`s with text labels; entries use `<h3>` headings; search input keeps `aria-label`.
- Tablist/tab roles removed (no longer tabs).

## Testing

- **New** `help-content-pane.test.tsx`: renders all 4 groups + entries; a TOC jump button per visible entry; `query` prop filters both TOC + content (a known title hidden after a non-matching query); empty match → no-results message; `onNavigateView` fires from a Related view link; DE renders after `loadI18n("de")` in `beforeAll`.
- **Rewrite** `help-menu.test.tsx`: the two existing tests query `role="tab"` (gone). Replace with: search filters visible entries; the existing no-results test (kept); assert policy link absent + license link present.
- **`help-view.test.tsx`**: keep green — chrome unchanged, content via shared component still renders titles/sections/Related; fix any selector assuming the old inline markup.
- Run `npx tsc --noEmit` after test edits (test-only type errors pass build + vitest but fail CI).

## i18n

No new keys. Reuse `HELP_GROUP_LABEL`, `helpContents`, `helpSearchPlaceholder`, `helpNoResults` / `helpSearchNoResults`, `helpRelated`, `helpRelationsGoToView`, `helpIntro`. `helpPolicyLink` stays unused (EN/DE parity intact).

## Landmines (AGENTS.md)

- `useResizable` inline-size beats class width → bump floating-panel storage key (`lop-app:help-size-v2`) + update default-pos fallback.
- New file is `.tsx`; no `help-content-pane.ts` collision (only `help-content.ts` exists).
- Palette: only AIPM tokens (border-line, bg-surface-muted, text-AIPM-*); no shadow/gradient.
- Help NOT in `A11Y_VIEWS` → eye-verify both surfaces.
- Tailwind v4 container-query classes only; no `|`/`*` inside arbitrary brackets.

## Out of scope (YAGNI)

- Chat-panel AI-usage-policy link (kept, per earlier decision).
- Tours / relations-map redesign.
- New or rewritten help content.
