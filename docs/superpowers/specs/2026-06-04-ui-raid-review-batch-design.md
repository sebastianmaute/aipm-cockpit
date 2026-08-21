# UI polish batch + RAID review reminders — design

**Date:** 2026-06-04
**Branch:** `feat-ui-raid-review-batch`
**Target version:** 0.51.0 "Pratchett"

A batch of 10 small UI refinements across the Dashboard, Budget Report, Reports,
Chat and Help surfaces, plus one new feature: **RAID review reminders** that
extend the existing due-date nudge mechanism to flag RAID items overdue for
review.

## Decisions (from brainstorming)

- **RAID "overdue for review" rule:** *Both combined* — an active RAID item is
  flagged if it is past its `targetDate` **or** has not been touched within a
  configurable review interval.
- **Budget Report Revenue RAG:** *Profitability* — the Revenue bubble reflects
  contribution-margin health (`marginHealth`).
- **Help search:** *Filter + highlight + jump* — filter the section list,
  auto-select the first match, highlight matched terms in the body.
- **Report removal:** *Also remove via dropdown* — keep the existing `×`
  buttons and add a "Remove report" dropdown.

## A. Dashboard (`dashboard-panel.tsx`)

1. **Colorize R / A / G counts.** Replace the single `Tile label="R / A / G"`
   string value with a `ReactNode`: three spans colored via the existing
   `healthText` map (`healthText.R` pink, `healthText.A` purple, `healthText.G`
   green), separated by `/`. This requires widening `report-table.tsx`
   `Tile.value` from `string` to `React.ReactNode` — backward compatible because
   every current caller passes a string.
2. **Budget-burn RAG bubbles.** Add `rag` to the two burn tiles:
   - Budget tile → `<RagBadge value={ratioHealth(burn.consumedValue, burn.budgetValue)} />`
   - hours tile → `<RagBadge value={ratioHealth(burn.actualHours, burn.budgetHours)} />`
3. **Box Progress + Budget-burn.** Add `boxed` to both `<Section>`s so they get
   the same rounded bordered card as the RAID / upcoming sections.
4. **Status-summary Save button + last-updated label.** Add an explicit **Save**
   button beside the narrative, disabled when the draft equals the stored value,
   committing via the existing `commitNarrative`. Always render the
   "Updated {date}" label once a narrative has been saved. Blur-autosave stays.

## B. Budget Report (`budget-report-panel.tsx`)

5. **Burndown caption.** Render the existing `dashboardBurnCaption` string
   beneath the burndown chart (reused, not duplicated).
6. **Project-total RAG bubbles.** Add `rag` to three tiles:
   - Plan (h) → `ratioHealth(proj.plannedHours, proj.budgetHours)`
   - Actual (h) → `ratioHealth(proj.actualHours, proj.budgetHours)`
   - Revenue → `marginHealth(proj.contributionMargin.percent)`

## C. Reports (`reports.tsx`)

7. **Remove via dropdown.** Keep the existing per-report `×` buttons. Add a
   second small `<select>` ("− Remove report") to the `ReportCard` toolbar,
   shown only when `extraReports.length > 0`, listing currently-added reports;
   selecting one calls `onChangeExtraReports(extraReports.filter(...))`. New i18n
   keys `reportsRemoveReportSelect` (label) reusing existing `reportsRemoveReport`.

## D. Chat (`chat-panel.tsx`)

8. **Reset-size button on the left, vertically centered.** Move
   `ResetSizeButton` out of the right button column to the left of the textarea,
   with `self-center`.
9. **Textarea height matches the Send+Clear stack.** Make the input row
   `items-stretch` and the textarea `self-stretch` (drop the fixed `rows`
   reliance) so its height equals the stacked Send + Clear buttons. Final order:
   `[Reset ⟳] [textarea] [Send / Clear column]`.

## E. Help (`help-menu.tsx`)

10. **Full-text search — filter + highlight + jump.**
    - Add a search `<input>` above the section tablist.
    - Filter `SECTIONS` to those whose translated title **or** body contains the
      query (case-insensitive).
    - When the query changes, auto-select the first matching section; clamp
      `activeIdx` to the filtered list.
    - Highlight matched substrings in the rendered body using a pure
      `highlightMatches(text, query)` helper that returns React segments wrapping
      matches in `<mark>` (no `dangerouslySetInnerHTML`).
    - Keyboard nav (Arrow/Home/End) and a "no results" empty state operate over
      the filtered list.
    - New i18n keys: `helpSearchPlaceholder`, `helpSearchNoResults`.

## F. RAID review reminders (feature)

### Pure logic — new module `raid-review.ts`

```ts
export type RaidReviewReason = "overdue" | "stale";
export type RaidReviewItem = {
  item: RaidItem;
  reason: RaidReviewReason;   // "overdue" wins when both apply
  daysOverdue: number;        // days past targetDate (0 for stale-only)
  daysSinceReview: number;    // days since last touch
};

export function getRaidReviewItems(
  raid: RaidItem[],
  today: string,
  reviewIntervalDays: number,
): RaidReviewItem[];

export function summarizeRaidReview(
  items: RaidReviewItem[],
): { overdue: number; stale: number };
```

- **Active item:** no `closedDate` **and** `status` not in a terminal set
  (`Closed`, `Resolved`, `Delivered`, `Validated`, `Invalidated`). The
  implementer must check `raid.ts` for an existing open/closed helper and reuse
  it if present.
- **overdue:** `item.targetDate && item.targetDate < today`.
- **stale:** last touch = `(item.localModifiedAt?.slice(0,10)) ?? item.raisedDate`;
  flagged when day-difference `>= reviewIntervalDays`.
- An item flagged for both reasons reports `reason: "overdue"`.
- Sort: overdue before stale, then by `daysOverdue` desc, then `daysSinceReview` desc.
- Pure and deterministic (date math mirrors `due-dates.ts`; no `Date.now()`).

### Settings (`settings-types.ts`, `notifications-section.tsx`)

Extend `NotificationsConfig`:

```ts
raidReview: ChannelConfig;        // default { enabled: true }
raidReviewIntervalDays: number;   // default 14
```

- Update `defaultNotificationsConfig`.
- Ensure the settings load/merge path backfills both keys for old saved
  settings (verify where `notifications` is parsed; add defaulting if missing).
- `NotificationsSection`: a toggle (`notifRaidReview`) + an interval number
  input (`raidReviewIntervalDays`, clamped 1–365) with tooltips.

### UI (`notifications.tsx`, `reminder-snooze.ts`, `use-due-alerts.ts`, `task-manager.tsx`)

- Add `"raidReview"` to the `ReminderKind` union in `reminder-snooze.ts`.
- `notifications.tsx`: add `raidReviewToastText(items, lang)`, a
  `RaidReviewBanner` (mirrors `DueBanner`; summary "N overdue · M stale";
  snooze + dismiss) and a `RaidReviewModal` (mirrors `DueDatesModal`; lists
  items with category chip, owner, target/last-review date, and an Edit action
  → `onOpenRaid(id)`).
- `use-due-alerts.ts`: accept `raid` and `raidReviewIntervalDays`; compute the
  once-per-session RAID-review items (gated by `raidReview.enabled` + snooze);
  fire toast (when toast channel on) and open the review modal (when popup
  channel on). Return `raidReviewModalOpen` / `setRaidReviewModalOpen`.
- `task-manager.tsx`: compute `raidReviewItems` (gated by
  `notifications.raidReview.enabled`), render `RaidReviewBanner` in `bannersEl`
  with a `"raidReview"` snooze, and `RaidReviewModal` in the modals block wired
  to the existing RAID-open handler.

## G. Cross-cutting

- **i18n** (`i18n.ts` EN + `i18n.de.ts` DE — DE strings ASCII only, verify with
  grep after editing per the known Edit-tool curly-quote corruption): help
  search, reports remove dropdown label, status save, and all RAID-review
  banner/modal/summary/toast/settings strings.
- **Version bump** (`version.ts`, `package.json`, `CHANGELOG.md`, `README.md`,
  codemaps): `0.51.0` / `"Pratchett"`, build date `2026-06-04`; append a
  `versionHighlight*` key for the RAID-review reminder.
- **AIPM palette:** only the 9 permitted tokens; pink/purple/green for RAG, no
  gradients/shadows/off-palette.

## Testing (TDD)

- `raid-review.test.ts` — overdue vs stale vs both, terminal-status exclusion,
  interval boundary, sort order, empty input.
- `settings-types` sanitize/merge — old settings backfill the two new keys.
- Help search — `highlightMatches` segments + section filtering + activeIdx clamp.
- Component coverage — dashboard colorized counts + burn RAG, boxed sections,
  status Save button; Budget Report three new RAG bubbles + caption; reports
  remove-dropdown; chat input layout; `RaidReviewBanner`/`RaidReviewModal`.
- Full suite green; coverage gate (70%) holds.

## Process

Subagent-driven (one implementer + one reviewer per task), each task committed
separately on `feat-ui-raid-review-batch`. The 10 UI items are small and mostly
independent; the RAID-review feature is ~6 tasks (module → settings → snooze →
notifications UI → hook wiring → task-manager wiring). Merge to main locally;
push on request.
