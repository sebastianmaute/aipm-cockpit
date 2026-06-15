# UI Polish & Feature Batch — Design (0.85.0)

**Date:** 2026-06-14
**Status:** Approved (brainstorm) — ready for implementation plan
**Feature area:** many panels (planning, manage-roles, stakeholders, reports, history, settings, projects, dashboard, calendar, budget, raid-report)

---

## Goal

A cohesive batch of UI-polish fixes plus three small features, gathered from a single review pass.
18 items, each independently testable. Built as one branch / one plan with many small tasks.

## Decisions taken during brainstorming

1. **Budget CPI + Consumption** lead with the **percent** as the primary figure, currency demoted
   to secondary. **Margin** stays currency-led. (CPI is a ratio; a currency headline misreads it.)
2. **History snapshot delete:** per-row delete (trash + confirm) **and** multi-select checkboxes
   with a "Delete selected (N)" action (confirm). Turso-only; reuses the existing
   `deleteSnapshot` store function — add a `deleteSnapshots(ids)` batch path.
3. **Next-actions formula context:** an explanatory block derived from the real `score.ts`, below
   a divider at the bottom of the Settings → Next actions section (drafted in §6 below).

---

## Items

Each item lists the surface, the change, and how to verify. Grouped by area.

### Layout / chrome fixes

**1. Planning — margin tooltip clips on the right.**
The contribution-margin field tooltip in the planning view overflows the viewport's right edge.
Fix: the `InfoTooltip`/portal position must clamp to the viewport (shift left when it would
overflow). If `InfoTooltip` already portals, add right-edge clamping; otherwise switch the margin
hint to the portalled tooltip. Verify: tooltip fully visible at the right-most planning column.

**2. Manage Roles — two reset buttons stacked, should be side-by-side.**
The "reset column widths" and "reset size" buttons in the Manage Roles pane render vertically.
Wrap them in a `flex flex-row items-center gap-2` container. Verify: both buttons on one row.

**3. Stakeholders — influence/interest matrix contrast is poor.**
The 2×2 influence/interest quadrant cells use low-contrast colours. Re-map to sanctioned AIPM
tokens with adequate text/background contrast (the a11y gate enforces contrast). Verify: axe gate
green; quadrant labels legible in light + dark.

**7. Settings — extract a "Storage" section.**
"Storage" currently lives inside the General section. Move it into its own rail section
("Storage") separated by a divider, following the existing rail-section pattern
(`settings-view.tsx`). Verify: Storage is its own entry; General no longer shows it.

**9. Dashboard — Changes as a second column right of Milestones.**
The dashboard currently stacks Milestones and Changes. Put Changes in a second column to the
right of Milestones (a 2-col grid row). Verify: Milestones left, Changes right, same row.

**10. Dashboard — Top actions left of Recent activity.**
Place the Top-actions panel as a second column to the **left** of Recent activity (2-col row,
actions left, activity right). Verify: side-by-side, actions on the left.

**18. RAID report — "by aging" right of "by category".**
The RAID report's "by category" and "by aging" breakdowns stack; put "by aging" in a second
column to the right of "by category". Verify: side-by-side.

### Resize/reset buttons (reuse the Manage-Roles reset-size pattern)

**8. Projects — reset-resize button right of "New project".**
The Projects pane is user-resizable (like Manage Roles). Add a reset-size button to the right of
the "New project" button that clears the inline width/height (content-fit). Reuse the
`ResetSizeButton` + handler from `roles-panel.tsx`. Verify: drag-resize, click reset → content-fit.

**12. Milestones — reset-resize button.**
Same: the Milestones pane is resizable; add the reset-size button. Verify: as above.

### Sizing / alignment

**13. Calendar — row height matches Workload/Directory.**
The resource calendar rows are visually compressed vs the Workload and Directory tables. Match the
row height (padding/line-height) to those tables (find the shared row-height class or value).
Verify: calendar row height == workload row height.

**14. Budget — bucket date aligned with plan/actual steppers.**
In a budget bucket, the date field is misaligned with the plan/actual stepper inputs. Align them
(same grid column / baseline). Verify: date and steppers line up vertically.

**15. Budget — bucket stepper fields match Planning stepper size.**
The stepper inputs inside buckets are a different size than the Planning view steppers. Make them
the same width/height (shared class). Verify: bucket steppers == planning steppers.

### Budget CCI display (decision 1)

**16. CPI + Consumption lead with percent.**
`Cci` (`budget-panel.tsx`) currently renders `formatCurrency(amount)` as the big figure and the
percent as secondary, for all three cards. Add a `primary: "amount" | "percent"` prop (default
`"amount"`). For the **CPI** and **Consumption** cards pass `primary="percent"`: the big figure
becomes `pct`, the secondary becomes the currency amount. **Margin** keeps `primary="amount"`.
Applies at BOTH the project-total cards and the per-bucket cards. Verify: CPI/Consumption show
`95.0%` big + `€…` small; Margin unchanged; a unit test on `Cci` for both modes.

**17. Budget report — add tooltips, hidden in print.**
Add `InfoTooltip` hints to the budget report where sensible (column headers / CCI figures),
matching the hint style used in other reports. These tooltips must **NOT** appear in the print/PDF
output — the printed report stays clean. Mark the tooltip trigger/content print-hidden (a
`print:hidden` utility or a print CSS rule in `globals.css` targeting the tooltip element), so the
icon and any portalled bubble are excluded when printing. Verify: tooltips show + work on screen;
print preview shows NO tooltip icons or bubbles; the rest of the report prints unchanged.

### Reusing the add/remove + DnD patterns

**4. Reports — drag-reorder added reports.**
Added reports (the `Settings.reports.extra` / `ADDABLE_REPORTS` list rendered in `reports.tsx`)
should be draggable to reorder, like budget buckets. Reuse the budget-panel bucket DnD
(`onDragStart`/`onDrop` reorder). Persist the new order in `Settings.reports.extra`. Verify: drag a
report card, order persists across reload.

**11. Dashboard — add/remove Trends.**
Mirror the reports add/remove mechanism (`ADDABLE_REPORTS` / the "add a report" checklist) for the
dashboard's Trends panel: let the user add/remove the Trends widget on the dashboard. Reuse the
same settings-backed pattern (a dashboard-widgets list in `Settings`). Scope: Trends specifically
(the item the user named); the mechanism is generic but only Trends is wired now. Verify: add
Trends to dashboard, remove it, persists.

**5. History — delete snapshots (single + bulk).**
In the Trends/History snapshot list (`trends-panel.tsx`), add a per-row delete (trash icon →
confirm) and multi-select checkboxes with a "Delete selected (N)" button (confirm dialog). Wire to
`deleteSnapshot` (single, already exists in `snapshot-store.ts` / `use-snapshots.ts`) and a new
`deleteSnapshots(config, ids, projectId)` batch helper. Turso-only (the feature is already gated).
Verify: delete one snapshot; select several + delete; list + variance update; confirm required.

### Next-actions formula context (decision 3)

**6. Settings → Next actions — formula background + explanation, below a divider.**
At the bottom of the Next actions section, after a divider, add a read-only explanatory block so
users understand how the configurable weights/thresholds feed the ranking. Drafted content
(derived from `score.ts` — review wording):

> **How actions are ranked**
> Each signal gets a score, then is bucketed into *Now / Soon / Monitor*.
>
> `score = urgency + risk + impact + quickWin + staleness + clarity − staticPenalty`
> (never below 0)
>
> - **urgency, risk, impact, quickWin, staleness** — derived from the signal itself (how overdue,
>   how severe, whether it blocks a milestone, how long it's lingered). Not configurable.
> - **clarity** — added when an action has a clear fix: the **Clarity bonus** (or **Semi-clarity
>   bonus** for several-lever actions) you set above.
> - **staticPenalty** — subtracted from vague, aggregate signals (e.g. total budget/SPI): the
>   **Static penalty** above. Halved automatically when the signal is *worsening* over recent
>   snapshots.
> - **Tier** — *Now* at score ≥ 60, *Soon* ≥ 30, otherwise *Monitor*.
>
> The **threshold** settings above (pending-change count, SPI warn/critical, workload %, overdue
> counts) decide **whether** a signal fires at all, before it is scored.

New i18n keys for the heading + each line (EN/DE). The block is below an `<hr>`/divider, visually
de-emphasised (muted text). Verify: block renders at the bottom; key parity; reads correctly.

---

## Components / file map

| Area | File(s) | Items |
|---|---|---|
| Planning tooltip | `info-tooltip.tsx` (clamp) / planning view | 1 |
| Manage Roles | `roles-panel.tsx` | 2 |
| Stakeholders | stakeholder matrix component | 3 |
| Reports DnD | `reports.tsx` | 4 |
| History delete | `trends-panel.tsx`, `snapshot-store.ts`, `use-snapshots.ts` | 5 |
| Next-actions formula | `settings-sections/next-actions-section.tsx`, i18n | 6 |
| Settings Storage section | `settings-view.tsx` | 7 |
| Projects reset | `projects-panel.tsx` | 8 |
| Dashboard layout + trends | `dashboard-panel.tsx`, `Settings` | 9, 10, 11 |
| Milestones reset | milestones panel | 12 |
| Calendar row height | resource-calendar component | 13 |
| Budget align/size/CCI | `budget-panel.tsx` (+ bucket UI) | 14, 15, 16 |
| Budget report print | budget-report + print CSS (`globals.css`) | 17 |
| RAID report layout | `raid-report-panel.tsx` | 18 |

## Constraints

- Palette: only sanctioned AIPM tokens; the a11y gate + palette-sweep test enforce contrast (esp.
  items 3, 16).
- i18n: any new string → EN + DE (real umlauts via node write); tsc enforces parity.
- Persisted settings (items 4, 11) follow the existing `Settings` + resolver pattern; if a NEW
  persisted **Workspace** field were needed it would need six write-paths — but these live in
  `Settings` (the blob), not `Workspace`, so no six-path concern.
- Each item is independently committed + tested; the e2e 12-view axe gate must stay green.

## Out of scope

- Generalising the dashboard-widget add/remove beyond Trends (only Trends wired now).
- Any backend/schema change beyond the `deleteSnapshots` batch helper.

## Release

0.85.0, new minor codename (next author after "Cherryh"). Standard release checklist (version,
CHANGELOG, one `versionHighlight*` key EN/DE).
