<!-- Generated: 2026-07-30 · counts re-verified 2026-08-10 at the merge with main 528dd5fe | App 0.243.0 "Waldrop" | Files scanned: 318 .tsx + 518 .ts under src/app (excl. 852 test files) | Token estimate: ~1050 -->

# Frontend

Single-page Next.js App Router client. One route, three layout modes, ~35 views, all state
client-side.

```
src/proxy.ts              middleware — per-request CSP nonce
src/app/layout.tsx        root layout, security headers, globals.css,
                          no-flash boot theme script
  └── task-manager.tsx    ROOT ORCHESTRATOR (2975 lines)
        ├── ModernShell   default — sidebar, off-canvas drawer <1024px, topBarMenus
        ├── legacyTree    classic (AppHeader + tab strip) and popout (no header)
        ├── workspace-section.tsx   view router → tabpanel switch
        │     └── workspace-panels.tsx  ~20 lazy dynamic(ssr:false) panels
        └── app-modals.tsx  modal stack + fixed footer
```

## Views — `AppView` in `nav-config.ts` (35)

`projects` · `open-points` · `dashboard` · `actions` · `insights` · `trends` · `history` · `chat` ·
`gantt` · `milestones` · `resources` (`directory` · `workload` · `calendar` · `planning`) ·
`manage-roles` · `budget` · `budget-report` · `raid` · `raid-report` · `changes` · `change-report` ·
`stakeholders` · `raci` · `stakeholder-map` · `knowledge` · `reports` · `activity` · `settings` ·
`help` · `learning-insights` · `steering-committee` · `timelog` · `portfolio-health`

★ Adding a member forces four exhaustive-`Record` edits or tsc/runtime breaks: `CORE_VIEWS`
(`feature-modules.ts`), `LABEL_KEYS` + `navLabelKey` (`nav-config.ts`), `ICON_PATHS`
(`nav-icons.tsx`), plus the i18n key. Turso-only views also go in `TURSO_ONLY_VIEWS` **and**
`subTabsFor`.

## State

| Concern | Provider |
|---|---|
| Entities + setters | `workspace-context.tsx` (~30 slices in one `useMemo`) |
| Active view | `workspace-tab-context.tsx` — also the `requestOpen`/`requestChat`/`requestHelpConcept` deep-link channels |
| Task filters | `filters-context` (tasks) / `panel-filters-context` (other panels) |
| Row lookup | `RowLookupContext` — split out of `RowContextValue` so a volatile `tasksById` re-renders one cell, not every row |
| Settings | `use-settings` (per-device) + `settings-effective` (per-project overrides) |
| Display timezone | `display-timezone-context` — ephemeral, never persisted |

★ A context consumer re-renders on value change **regardless of an ancestor `memo` bailout**. That is
why `tasksById` was split out, and why `ResourcesPanel` (the only `memo()`'d panel) must take props
rather than call `useWorkspace()`.

## Panel decomposition pattern

A panel crossing ~700 lines splits into **orchestrator + `*-rows` + `*-toolbar`** (+ a `*-columns`
leaf), rows and toolbar being purely presentational. Precedents: `gantt`, `reports`, `raid-panel`,
`resources-panel`, `timelog-panel`, `resource-calendar`.

Cross-cutting orchestration extracted from task-manager uses a **deps-object hook**: typed `deps` of
live render-scope values, named `use*`, called unconditionally, returning **non-memoized** handlers
(they read live scope each render). `use-storage-file-ops.ts` is the reference.

## Design system — use these, do not hand-roll

`Button` / `IconButton` / `TextButton` · `Input` / `Select` / `Textarea` / `Checkbox` ·
`SegmentedControl` · `ToggleButton` · `Modal` / `ModalHeader` / `EditModalShell` · `PopoverPanel` ·
`Card` · `Banner` · `EmptyState` / `Skeleton` / `PanelSkeleton` · `DataTable` / `SortResizeTh` /
`SortHeaderButton` / `ColumnResizeHandle` · `RagDot` / `RagBadge` / `Badge` / `CountBadge` ·
`ProgressTrack` · `FieldError` / `FieldHint` / `InfoTooltip` · `EntityLinkPicker` ·
interaction atoms `INTERACTIVE` / `FOCUS_RING` / `TRANSITION` / `PRESS`.

★ Primitives concatenate `className` with **no** tailwind-merge — a class fighting a variant prop
loses on source order. Only the three Button types forward `ref`.

## Rich text surfaces

`RichTextEditor variant="lean"` is the one editor for all seven rich HTML fields (the register
descriptions) **and** for a note-log entry (`commitOnEnter`); it loads via `dynamic(ssr:false)` —
Tiptap/ProseMirror needs `Range.getClientRects`, which jsdom lacks, so tests stub it. The note log
itself is one shared non-modal floating window (`notes-window.tsx`) plus a `🗒 N` badge on the Open
Points and RAID rows.

★★ Rendering stored HTML is `dangerouslySetInnerHTML`, so `NoteBody` re-sanitizes at the **sink**
(`sanitizeRichHtml`, idempotent) rather than trusting the load path. ★★ A form must never write
`noteLog` back — the log is write-through and owns itself, so a draft that snapshots it at
modal-open and spreads it over the live row destroys any note added while the editor was open.
See [data.md](data.md) for the projection rules and the DOM-free constraint.

## Dismissal (Escape / Tab)

`dismissal-stack.ts` holds a module-level stack of open layers in OPEN order. `escapeOwner()` walks
top-down to the first layer that CLAIMS the key; `isTopmostOfKind(token, "modal")` is the separate
Tab question. React surface is `use-dismissable.ts`, bubble phase.

★ `kind: "modal"` means **"traps Tab"**, not "looks like a dialog". ★ Push/pop effects depend on
`[open]` alone with handlers on refs — re-running moves the token to the top and makes the wrong
layer topmost. ★ Stack order must equal nesting order; it is asserted, not detected (portals defeat
DOM containment), so a test that mounts a popover inside an already-open modal in one commit
inverts Escape.

## Styling

Scheme-driven tokens applied as inline custom properties (`use-style` `syncScheme` is the sole apply
path); `data-style` is the constant `"custom"`. Only sanctioned `--ui-*` brand tokens — no
off-palette colors, gradients or shadows except via `--shadow-*` / `--gradient-kpi` tokens. Guards:
`shell-palette-guard`, `palette-chrome-sweep` (both scan comments too), plus the axe gate.

## a11y

16 views × 5 scheme combos = 85 axe checks (harbor light+dark, meridian light+dark, umber light — umber
dark is deliberately unscanned to hold the count at five). **Not scanned:** Projects, Knowledge, Resources→Calendar,
Kanban board, Help, tour, chat, and anything inside a closed modal. Axe also has no rule for
`aria-modal`-without-a-trap or a missing `aria-sort` — see `open-followups.md` §8–§10.
