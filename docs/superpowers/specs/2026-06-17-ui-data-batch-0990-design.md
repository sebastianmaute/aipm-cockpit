# UI/Data Batch (v0.99.0) — Design

**Date:** 2026-06-17
**Branch:** `feat-ui-data-batch-0990`
**Scope:** A cohesive 16-item UI/data polish batch across the pane-resize system, Documents, Calendar, Next Actions, Dashboard Trends, Reports nav, Influence/Interest matrix, and the Ask-Claude top-bar control.

This is surface-level UI work plus one data-derivation addition (dashboard variance summary). No new persisted `Workspace` fields. No new Turso tables. Engines stay i18n-free; surfaces translate.

---

## Locked decisions

1. **Reports menu (#3):** Move `budget-report` + `raid-report` to be **children under the Reports nav item**, removing them from under Budget and RAID. Single "Reports" home.
2. **Embedded Dashboard Trends (#4):** Replace the dead stub with a **Turso-gated variance summary** (KPI deltas vs. baseline). No chart, no snapshot list.

---

## Item-by-item design

### A. Pane chrome & resize system (global)

**#13 — Remove the `⠿` corner hint everywhere.**
`ResizeCornerHint` (`task-manager-ui.tsx:294-304`, renders the braille `⠿` glyph at `absolute bottom-1 right-1`) is removed from every pane. Approach: delete each `<ResizeCornerHint … />` usage **and its import** (lint `--max-warnings=0` makes an unused import fatal). Also remove the now-unused `ResizeCornerHint` export from `task-manager-ui.tsx`. The native CSS `resize` grip and the reset-size button remain as the resize affordance.

Surfaces to sweep (each has a usage + import): `milestones-panel`, `report-table` (Dashboard), `trends-panel`, `budget-panel`, `change-panel`, `raid-panel`, `stakeholders-panel`, `stakeholder-map-panel`, `projects-panel`, `resources-panel`, `activity-log-panel`, `chat-panel`, plus the new Documents/Calendar/Actions panes (which therefore never add it).

**#12 — Reset-size button → right side of pane header (convention).**
Today Milestones renders `ResetSizeButton` in the header **left**, next to the title (`milestones-panel.tsx:168`). Move it into a right-aligned controls group (`ml-auto` / `justify-between` header with controls on the right), matching the `report-table.tsx` toolbar pattern (title left, controls right). Apply the same right-alignment to every reset button added in this batch (Documents, Calendar, Next Actions, Influence/Interest).

**#6 — Scrollbar gap (all content panes).**
The scrollable region's scrollbar currently sits flush against the content/border. Add a small right inset (`pr-2`, 8px) to the shared scrollable regions so the scrollbar floats off the edge. Targets: the ReportCard body (`report-table.tsx:202` `min-h-0 flex-1 space-y-6 overflow-y-auto`), the Actions scroll (`actions-panel.tsx:65`), the Documents inner table, Trends body, and the register tables. Keep it consistent so all panes read identically.

**#7 — Dashboard reset-resize bug.**
Real bug: `dashboard-panel.tsx` creates a `sizeRef` but never wires it to `useResizable`, and passes `onResetSize={() => undefined}` (a no-op) into `ReportCard`. Fix: call `useResizable("lop-app:dashboard-size")` in the dashboard, attach its `ref` to the ReportCard pane container (thread the hook's ref through the existing `sizeRef` prop), and pass `reset` as `onResetSize`.

### B. Documents & Calendar (#9, #10, #11, #15)

**#9 + #10 + #11 — Documents & Calendar become Milestones-style resizable panes.**
Documents currently uses the bare `VIEW_PANE_CLASS` (`"rounded-xl border border-line bg-surface"` — **no padding**, no flex/height), so content touches the edges. Switch **both Documents and Calendar** to the Milestones pattern:
- Container class → `CENTERED_HALF_PANE_CLASS` (centered, 50%×50%, `p-6`, `resize`).
- `const { ref, reset } = useResizable("lop-app:documents-size")` (and `"lop-app:calendar-size"`); attach `ref` to the container.
- Header: title left, `ResetSizeButton` right (per #12).
- Inner scroll region keeps `INNER_TABLE_CLASS` + the `pr-2` from #6.

This single change resolves padding (#9), resizable + reset button (#10), and "size/orientation like Milestones" (#11).

**#15 — Gate the Add-document button.**
Hide the "+ Add document" button (`documents-panel.tsx:91-97`) unless M365+SharePoint is configured and enabled. Reuse the existing predicate from `document-links-field-gated.tsx:20-24`:
```ts
const m365 = settings.integrations?.m365;
const sharePointEnabled = (m365?.enabled ?? false) && (m365?.sharepoint ?? false);
```
When `!sharePointEnabled`, omit the button (and close any open add-panel). Extract the predicate to a small pure helper so it can be unit-tested and reused.

### C. Next Actions / Action Center (#1, #5, #8)

**#1 — Learning ON/OFF tooltip + correct settings link.**
The flag (`actions-panel.tsx:44-60`) is already a button calling `onOpenLearningSettings`. Add a tooltip (the app's `InfoTooltip`, or a `title`) explaining what learning does and that clicking opens its settings. Verify `onOpenLearningSettings` navigates to the next-actions/learning settings section specifically (not the generic Settings root); fix the target if it doesn't.

**#8 — Action Center resizable + reset button right of the flag.**
Make the Action Center pane resizable: `useResizable("lop-app:actions-size")`, attach `ref`, switch the container to a resizable pane class (`VIEW_PANE_RESIZABLE_CLASS` to keep its current fill orientation, or `CENTERED_HALF_PANE_CLASS` — **use `VIEW_PANE_RESIZABLE_CLASS`** so the Action Center keeps its full-width list orientation, since it is a primary working view, not a Milestones-style dialog pane). Place a `ResetSizeButton` **to the right of** the Learning flag in the header controls group.

**#5 — Strengthen action-button hover.**
Action-row CTAs use `hover:bg-surface-muted` (`action-row.tsx`), nearly invisible in light mode. Add `transition-colors` and a palette-safe emphasis on hover (e.g. `hover:border-AIPM-dark-blue/40` alongside the existing `hover:bg-surface-muted`). Stay within sanctioned AIPM tokens; no shadows/off-palette.

### D. Dashboard Trends + Trends links + Reports menu (#2, #3, #4)

**#4 — Embedded Trends → Turso-gated variance summary.**
Replace the placeholder block (`dashboard-panel.tsx:395-403`, which always renders the `trendsRequireTurso` text) with a compact variance summary when Turso is available:
- Gate on `tursoConfig !== null` (per the standing Turso-gated-features constraint — *not* just `storageConfig.kind === "turso"`). When unavailable, keep the existing "requires Turso" message.
- Reuse the existing variance derivation used by `TrendsPanel` (the `VarianceRow` shape: remaining hours, remaining cost, %complete, forecast end date, SPI, CPI — baseline vs. current with delta). Extract/whichever pure function `TrendsPanel` already uses so the dashboard and the full Trends view share one source of truth (no duplicated math).
- Render a small table/grid of the KPI deltas. **No snapshot list, no chart.**
- The dashboard reads snapshots via the same Turso-gated hook the Trends view uses; if there is no baseline snapshot yet, show a friendly "no baseline yet" message.

**#2 — Trends snapshot links → Open Points link style.**
Restyle the snapshot action links in `trends-panel.tsx` (currently `text-xs … underline hover:opacity-80`) to match the Open Points links (`task-row.tsx:370-415`): `text-xs font-medium underline-offset-2 hover:underline`, keeping the existing color roles (`text-AIPM-green-strong` for primary actions, `text-foreground` for edit, `text-AIPM-pink-strong` for delete).

**#3 — Reports nav restructure.**
In `nav-config.ts`, remove `budget-report` from the `budget` item's `children` and `raid-report` from the `raid` item's `children`, and add both as `children` of the `reports` nav item. Verify the existing `reports.tsx` / addable-reports flow still resolves these views. No view IDs change — only their nav placement.

### E. Influence/Interest + Ask Claude (#14, #16)

**#14 — Influence/Interest reset button + dark-mode contrast.**
- **Reset button:** ensure the Influence/Interest pane (`stakeholder-map-panel.tsx`) has a right-aligned `ResetSizeButton` (add if missing; reposition to the right if present).
- **Contrast:** in `influence-interest-matrix.tsx`, stakeholder names must sit on a solid chip (`bg-surface` + `text-foreground`) rather than directly on the translucent cell tint (`bg-AIPM-green/15` etc.), which is unreadable in dark mode. Verify the exact offending element; if axis labels (`text-muted-foreground`) are also low-contrast in dark mode, bump them to `text-foreground`. Palette-safe, theme-aware tokens only.

**#16 — Ask Claude labeled pill, left of the icon row.**
Restyle the `AskClaudeMenu` trigger (`ask-claude-menu.tsx`, currently icon-only `p-2`) as a labeled dark-blue pill matching the modal Add-task submit button (`task-form-modal.tsx:134`):
```
rounded-md bg-AIPM-dark-blue px-4 py-2 text-sm font-medium text-white hover:opacity-90
focus:outline-none focus:ring-2 focus:ring-AIPM-dark-blue focus:ring-offset-2
```
with an icon + the "Ask Claude" text label (reuse the existing `askClaude` i18n key). Position it to the **left** of the top-bar icon row. Wire into **both** header sites — classic `AppHeader` (`appHeaderEl`) **and** modern `ModernShell` `topBarMenus` (`task-manager.tsx`) — per the dual-header landmine. Keep `aria-haspopup="dialog"` and the dropdown behavior. The popout `legacyTree` renders no header, so it correctly stays out of popouts.

---

## Cross-cutting

- **Versioning:** bump `src/app/version.ts` to `0.99.0` with a new SF-author codename (grep `CHANGELOG.md` first to avoid a collision), add a `CHANGELOG.md` entry, and append a new `versionHighlight*` key to `APP_HIGHLIGHT_KEYS` (+ EN/DE strings).
- **i18n:** EN (`i18n.ts`) + DE (`i18n.de.ts`) key parity is tsc-enforced. New keys: learning-flag tooltip, any new variance-summary label not already present, the highlight string. DE edits via a **node UTF-8 CRLF write** (the Edit tool corrupts umlauts/quotes); real umlauts only.
- **Palette:** sanctioned AIPM tokens only — no gradients, shadows, or off-palette colors (check new markup by eye; palette-sweep only scans CSS).
- **a11y (axe gate):** every control needs an accessible name + keyboard operability. The Ask-Claude pill (top bar) is scanned via all 12 views; Dashboard, Documents, and Settings views are directly scanned. Run `npx playwright test e2e/a11y.spec.ts --project=chromium` for the affected views before push — vitest never runs playwright, so axe regressions only fail in CI otherwise.
- **No new write paths:** no persisted `Workspace` fields and no new Turso tables are introduced, so the six-write-path and TABLE_NAMES constraints are not engaged.

## Testing

- **Unit (vitest):**
  - M365+SharePoint gating predicate (pure helper): enabled/disabled/partial combinations.
  - Dashboard variance-summary derivation: shares the `TrendsPanel` pure function; assert deltas for a known baseline+current snapshot pair, and the "no baseline" path.
  - `nav-config` shape: `budget-report`/`raid-report` are children of `reports`, absent from `budget`/`raid`.
  - Component tests use `"en-US"` (there is no `"en"`); DE assertions call `loadI18n("de")` in `beforeAll`.
- **a11y (playwright):** Dashboard, Documents, Settings, and a top-bar scan (Ask-Claude pill) pass axe.
- **Full suite:** `npm run test:run` (vitest) + `npx tsc --noEmit` + `npm run lint` + `npm run build` green before push.

## Out of scope

- No changes to the next-actions engine logic, the learning algorithm, or snapshot capture.
- No new persisted fields or storage backends.
- The Ask-Claude prompt catalog (SP1) is unchanged — only the trigger's styling/placement changes.
