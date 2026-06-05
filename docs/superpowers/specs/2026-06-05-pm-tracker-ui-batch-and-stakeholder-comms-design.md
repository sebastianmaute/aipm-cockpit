# v0.55.0 "Clarke" — PM-Tracker UI Batch + Stakeholder Communication Reminders

**Date:** 2026-06-05
**Status:** Approved (design)
**Predecessor:** v0.54.0 "Herbert" (Simple/Modular/Advanced mode)

## Goal

Ship a 13-item batch as one release: a German-i18n correctness sweep, six small UI-polish
tweaks, a stakeholder-visual refresh, a milestones table upgrade, a sidebar mode indicator,
and a new **stakeholder communication reminder** subsystem (banner + toast + snooze) that is
mode-aware.

## Constraints (inherited)

- AIPM 9-color brand palette ONLY; one allowed amber (`bg-amber-500/20 text-AIPM-purple`); no
  gradients/shadows/off-palette.
- `i18n.de.ts` edits via a CRLF-aware Node byte-patch, NEVER the Edit tool (it curls ASCII
  quote delimiters into curly quotes). Verify 0 mojibake / 0 curly delimiters after.
- Strict TypeScript (no `any`), immutable updates, lint runs `--max-warnings=0`.
- Mode gating must pause new automation per the established checklist (a disabled module
  contributes nothing; its surfaces are hidden everywhere).
- TDD: every behavioural unit gets a failing test first.

---

## Workstream A — i18n UTF-8 audit (item 1)

The `i18n.*.ts` files are already UTF-8 (no BOM) and `i18n.de.ts` already carries real umlaut
characters with no mojibake. The remaining risk is *missing* or *ASCII-substituted* umlauts in
individual German values (e.g. `fur`→`für`, `Anderung`→`Änderung`, `mussen`→`müssen`,
`Schliessen`→`Schließen`, `gultig`→`gültig`), plus any stray `\uXXXX` escapes.

**Scope:**
- Audit every German value in `i18n.de.ts` (and the `en-GB` block / `i18n.ts`) for missing or
  wrong umlauts and `ß`. Fix in place via the byte-patch.
- Add a **guard test** (`i18n-encoding.test.ts`) asserting: (a) no mojibake byte sequences
  (`Ã`, `Â`) in any bundle; (b) no `\uXXXX` escapes in the DE source; (c) a curated allow-list
  of German terms that MUST contain their umlaut (spot-check the highest-traffic keys) are
  present with the correct character. This locks the fix and prevents regression.

**Out of scope:** wording/translation changes beyond umlaut/ß correctness.

---

## Workstream B — small UI polish (items 2, 3, 5, 9, 11)

### B2 — Dashboard Save/Clear buttons (chat layout)
`dashboard-panel.tsx`: today the narrative textarea sits above a `flex justify-between` row
holding the timestamp + Save/Clear. Restructure to the chat input pattern:
- Row container `flex items-stretch gap-2`; textarea `min-w-0 flex-1`; a right-hand
  `flex flex-col gap-2` column holding **Save** (solid `bg-AIPM-dark-blue text-white`) then
  **Clear** (outline `border border-line bg-surface`).
- The "updated at" timestamp moves to a line **below** the row (`text-xs text-muted-foreground`).
- Preserve existing disabled logic and `onMouseDown` preventDefault on Clear.

### B3 — RACI legend style
`i18n.ts` / `i18n.de.ts`: change `raciLegend` to
**`"(R)esponsible, (A)ccountable, (C)onsulted, (I)nformed"`** (parenthesized initial, canonical
RACI order to match the dropdown). German: `"(R)esponsible/Durchführend, (A)ccountable/…"` —
final DE wording set during implementation, keeping the `(X)` style. The legend already renders
from `t(lang, "raciLegend")` in `raci-panel.tsx`; no structural change.

### B5 / B9 — hover parity (stakeholders + milestones)
Reuse the Resources-Workload name-button hover: a `rounded-md border border-transparent px-2
py-0.5 … hover:border-AIPM-dark-blue hover:bg-surface-muted focus-visible:ring-2
focus-visible:ring-AIPM-green` button. Apply to the stakeholder name cell
(`stakeholders-panel.tsx`, replacing the current chip/row treatment) and the milestone name cell
(`milestones-panel.tsx`, replacing `hover:underline`).

### B11 — rename "List of Open Points" → "Project Management Tracker"
EN + DE, every occurrence:
- `appTitle: "List of Open Points Tracker"` → `"Project Management Tracker"`
- `sidebarBrandSubtitle: "LIST OF OPEN POINTS"` → `"PROJECT MANAGEMENT TRACKER"`
- `appSubtitle` and the help/about copy (`i18n.ts` help blocks referencing "List of Open
  Points Tracker").
- Leave `navOpenPoints: "Open Points"` (the view label) unchanged — that's the tasks view, not
  the product name.

---

## Workstream C — stakeholder visuals (items 4, 6)

### C4 — influence/interest matrix sized like chat
`stakeholder-map-panel.tsx`: swap the outer pane class from `VIEW_PANE_RESIZABLE_CLASS` to
`CENTERED_HALF_PANE_CLASS` (the centered, 50%/50%, resizable pane chat uses). Keep the 2×2 grid
and the rotated Influence↑ / Interest→ axis labels; they reflow inside the smaller centered box.

### C6 — dark-mode-readable colors
The unreadable pairs are dark text on translucent tints in dark mode. New chips
(`stakeholders-panel.tsx` `LEVEL_CHIP`), all palette-legal:
- `Low`    → `bg-AIPM-light-grey/40 text-foreground dark:bg-AIPM-medium-grey/30 dark:text-AIPM-light-grey`
- `Medium` → `bg-AIPM-purple/15 text-AIPM-purple dark:bg-AIPM-purple/25 dark:text-AIPM-light-grey`
- `High`   → `bg-AIPM-green/20 text-AIPM-dark-blue dark:bg-AIPM-green/25 dark:text-AIPM-light-grey`

Quadrant tints (`stakeholder-map-panel.tsx`) gain matching `dark:` variants so quadrant text
stays legible:
- keep-satisfied `bg-AIPM-green/10 dark:bg-AIPM-green/15`
- manage-closely `bg-AIPM-green/20 dark:bg-AIPM-green/25`
- monitor `bg-surface-muted` (already theme-aware — verify contrast)
- keep-informed `bg-AIPM-light-grey/20 dark:bg-AIPM-medium-grey/25`

---

## Workstream D — milestones table upgrade (items 7, 8, 9, 10)

Move `milestones-panel.tsx` onto the shared report-table machinery (the same `useColumnResize`
+ filter/search pattern used by Resources/RAID/Reports), gaining:
- **D7 — resizable columns** via `useColumnResize` with a `MILESTONE_COL_WIDTHS` default map
  (Name / Date / Status / Mark-achieved).
- **D8 — filters:** a **name search** input + a **status filter** select with options
  `All / Pending / Achieved / Overdue` (Overdue = unachieved & `date < today`). Pure
  `filterMilestones(milestones, {query, status, today})` helper, unit-tested.
- **D9 — row hover** from Workstream B.
- **D10 — "+ New milestone" button** moved to the **left** end of the toolbar and restyled to
  the solid Gantt add-button (`rounded-md border border-AIPM-dark-blue bg-AIPM-dark-blue px-2.5
  py-1.5 text-xs font-medium text-white hover:bg-AIPM-dark-blue/90`).

Sorting (existing Name/Date) is preserved.

---

## Workstream E — sidebar mode indicator (item 12)

`sidebar.tsx` footer: render the derived mode (`deriveMode(settings.features)`) as a pill next
to / above the version button, reusing the Settings mode-badge style adapted for the dark
sidebar:
`rounded-full bg-AIPM-green/15 px-2.5 py-0.5 text-[11px] font-semibold text-AIPM-light-grey`,
labelled `t(lang, MODE_LABEL_KEY[mode])` (Simple/Modular/Advanced). Hidden when the sidebar is
collapsed to the icon rail. The sidebar receives `settings` (or the derived mode) via props —
thread `mode`/`features` from `task-manager.tsx`.

---

## Workstream F — stakeholder communication reminders (item 13)

### F-data — explicit links
Add optional `stakeholderIds?: number[]` to `RaidItem` (types.ts:146) and `ChangeItem`
(types.ts:206). Milestones already link to stakeholders via `Stakeholder.raci`
(`Record<milestoneId, RaciRole>`).
- Edit modals (`raid` edit, `change-edit-modal.tsx`) gain a stakeholder multi-select.
- Serializers: CSV / Markdown / JSON / Turso round-trip the new array (column-driven where the
  serializer is column-driven). Storage save/load/broadcast + `BrowserBackend` KV unaffected
  beyond the field living on the existing entities (no new entity).
- Sanitizers default missing/invalid to `[]`; orphan ids (stakeholder deleted) are filtered at
  read/render time, like RACI orphan keys.

### F-engine — `stakeholder-comms.ts`
Pure `getStakeholderCommsItems(args)` returning `StakeholderCommsReminder[]`
(`{ stakeholderId, stakeholderName, quadrant, itemKind: "milestone"|"raid"|"change", itemId,
itemTitle, reasonKey, priority }`).

For each stakeholder, gather related items:
- milestones where `stakeholder.raci[milestoneId]` is set,
- RAID items whose `stakeholderIds` includes the id,
- changes whose `stakeholderIds` includes the id.

Keep only items in a **notable state**, modulated by quadrant policy:

| Quadrant | Lead days | Sources | RAID min severity |
|---|---|---|---|
| manage-closely | 14 | milestone, raid, change | Medium |
| keep-satisfied | 7 | milestone, raid, change | High |
| keep-informed | 7 | milestone, change | — |
| monitor | 3 | milestone (overdue only) | — |

**Notable-state rules:**
- **Milestone:** not achieved AND (`date` within `leadDays` of `today` → upcoming, OR
  `date < today` → overdue). For `monitor`, overdue only.
- **RAID:** status non-terminal (reuse the flat terminal-status set) AND
  (`severity >= policy.minRaidSeverity` OR `targetDate` overdue). Only if `raid` in sources.
- **Change:** status in the pending set (`Proposed`, `Under Review`). Only if `change` in
  sources.

`priority` derives from quadrant (manage-closely highest → monitor lowest) for ordering. The
engine is fully pure and unit-tested across the policy matrix and each notable rule.

### F-surfaces — reuse existing infra
- **Banner:** dismissible summary ("N stakeholders need an update"), modelled on the due-alerts
  banner; opens a review **modal** listing each reminder (stakeholder · item · reason) with a
  click-through to the related item.
- **Toast:** info toast on hydrate when there are reminders and not snoozed (`showToast`).
- **Snooze:** new `ReminderKind` `"stakeholderComms"` using the existing
  `lop-app:reminder-snooze:*` mechanism + `SNOOZE_1H` / `SNOOZE_1D`.
- **Settings:** add `stakeholderComms: ChannelConfig` to `NotificationsConfig` +
  `defaultNotificationsConfig`; expose a toggle in Settings → Notifications. Lead days are
  owned entirely by the quadrant policy table (no separate global lead-days knob — YAGNI).

Wire into the alert layer as a sibling of `useDueAlerts` (or an extension), returning banner +
modal state; render through the existing banner/modal slots.

### F-mode — gating (pauses correctly)
Reminders require the **stakeholders** module enabled. Each source contributes only if its
module is enabled: `milestonesEnabled`, `raidEnabled`, `changesEnabled`. With stakeholders
disabled the engine returns `[]` and no banner/toast/snooze surfaces appear. The hook receives
these flags from `task-manager.tsx`, mirroring the existing `raidEnabled` plumbing. The
stakeholder multi-select on RAID/change edit modals shows only when stakeholders is enabled.

---

## Release (Workstream G)

Bump to **v0.55.0 "Clarke"**: `version.ts` (`APP_VERSION`, `APP_MILESTONE`, a
`versionHighlightClarke` highlight key + narrative), `package.json`, `CHANGELOG.md`, and the
`docs/CODEMAPS/frontend.md` notes for the new module/files. New i18n keys (modes already exist;
add comms reminder keys, milestone filter keys, RACI legend update, rename keys) EN + DE.

## Testing

- Unit: `filterMilestones`, `getStakeholderCommsItems` (policy matrix + each notable rule + mode
  flags), i18n encoding guard, serializer round-trips for `stakeholderIds`.
- Component: dashboard button layout, milestones resize/filter, sidebar mode pill, stakeholder
  chips, comms banner/modal/snooze.
- Keep the suite green (`npm run test:run`), lint clean, `tsc --noEmit` clean.

## Out of scope / YAGNI

- No email/push delivery — in-app banner/toast only.
- No per-stakeholder custom cadence UI — quadrant policy table is the single source.
- No new workspace entity — `stakeholderIds` lives on existing RAID/Change items.
