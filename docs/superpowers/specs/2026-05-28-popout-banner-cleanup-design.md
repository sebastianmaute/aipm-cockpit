# Popout Banner Cleanup — Design

**Date:** 2026-05-28
**Status:** Approved (design); pending implementation plan
**Branch:** `feat/0.18.1-popout-banner-cleanup`
**Context:** Sub-project **S1** — small UX cleanup split off from a 5-item user request (S1 banner cleanup; S2 Reports sort+filter; S3 Print buttons; S4 PDF export). Ships first as a focused patch; S2–S4 follow as separate brainstorm cycles.

## Goal

Hide the **read-only-mirror banner** in the three report-style popouts (`resource-report`, `reports`, `raid-report`) where it is redundant — reports are read-only by their nature, and the banner just adds visual noise without delivering signal. Keep the banner in the editing popouts (`gantt`, `raid`, `resources`, `activity`, `address-book`, `budget`, `chat`) where it usefully tells the user "edit in the main window."

Also: confirm via a quick audit that the three notification banners (DueBanner, BirthdayBanner, JiraTokenBanner) are already hidden in all popouts. The user noted "popouts should not show the reminder banner" — they already don't. Acknowledge the existing behaviour in the CHANGELOG so the user knows nothing was needed there.

## Non-goals

- No change to the editing popouts' banner behaviour.
- No change to the main-window banner stack.
- No restructuring of the banner components themselves.
- No related popout-versus-main-window logic refactor.

## Architecture

Single targeted change in `src/app/task-manager.tsx`. The current line at ~L464 is:

```tsx
{isPopout && <ReadOnlyMirrorBanner lang={lang} />}
```

Both `isPopout` and `activeTab` are already destructured from `useWorkspaceTab()` at L86, so no new state is needed. Add an inline predicate near the existing banner block (or just inline the condition), excluding the three report tabs:

```tsx
const isReportPopout =
  activeTab === "resource-report" ||
  activeTab === "reports" ||
  activeTab === "raid-report";

{isPopout && !isReportPopout && <ReadOnlyMirrorBanner lang={lang} />}
```

The `isReportPopout` constant goes right above the JSX return (next to other derived locals in the function body). The banner-render line gains a `!isReportPopout` clause.

### Edge cases

- **Switching tabs inside a single popout.** Popouts are single-tab (the URL pin in `broadcast-sync.ts` locks them to one tab), so `activeTab` doesn't change after mount. No mid-session flicker concern.
- **Future report popouts.** Adding a 4th report-style popout means amending `isReportPopout`'s OR chain. Trivial. A constant array (`REPORT_POPOUT_TABS`) is a cleaner home if/when we add #4 — for now (3 values) the inline OR is fine and matches the codebase's style for small enums.
- **Reminder banners.** Confirmed already guarded:
  - `<DueBanner>` at ~L482: `{!isPopout && !bannerDismissed && !dueSnooze.isSnoozed && (...)}`
  - `<BirthdayBanner>` at ~L492: `{!isPopout && !birthdaySnooze.isSnoozed && !birthdayDismissed && birthdayItems.length > 0 && (...)}`
  - `<JiraTokenBanner>` at ~L496: `{!isPopout && jiraTokenAlert && !jiraTokenSnooze.isSnoozed && !jiraTokenDismissed && (...)}`
  No code change needed for any of these. The CHANGELOG entry acknowledges the existing behaviour.

## Testing

- **New test** in `src/app/task-manager.test.tsx` (or whichever existing test file covers the banner render). Two assertions:
  1. With `isPopout = true` and `activeTab = "raid-report"` → ReadOnlyMirrorBanner is NOT rendered.
  2. With `isPopout = true` and `activeTab = "raid"` (editing popout) → ReadOnlyMirrorBanner IS rendered.
- Existing tests must stay green.
- If no test file already covers `<TaskManager>` banner rendering, add a focused new test file `task-manager-banner.test.tsx` with the minimal mock surface (mock `useWorkspaceTab`, mock the storage hook, render the component, query for the banner via its data-testid or role).
- Gates: `npx tsc --noEmit` 0; `npm run lint` 0; full suite green (existing 911 + 1–2 new).

## Release

Patch → **0.18.1** "Jemisin" (codename stays). No highlight key.

- `src/app/version.ts`: `APP_VERSION = "0.18.1"`. Top-of-file comment block:
  ```
  // 0.18.1 hides the read-only-mirror banner in report-style popouts
  // (resource-report, reports, raid-report) where it was redundant.
  // No change to editing popouts; reminder banners (Due / Birthday /
  // Jira token) remain hidden in all popouts as before.
  ```
- `CHANGELOG.md` `[0.18.1] — 2026-05-28` entry:
  ```markdown
  ## [0.18.1] — 2026-05-28

  ### Changed
  - Report popouts (Resources Report, Reports, RAID Report) no longer show the read-only-mirror banner — these views are read-only by their nature and the banner was redundant. Editing popouts still show it as before. Confirmed that due-task / birthday / Jira-token reminder banners remain hidden in every popout.
  ```
- No i18n, no DESIGN-TOKENS change.

## Plan shape (preview — `writing-plans` skill expands)

1. Add the `isReportPopout` predicate + tighten the banner gate; add the focused test.
2. Release 0.18.1 (version.ts + CHANGELOG).

A 2-task plan — small enough to also run inline if preferred over subagent-driven.

## What this closes

After 0.18.1 ships, the original 5-item batch's first item is done. Sub-projects **S2 (Reports sort+filter)**, **S3 (Print buttons)**, and **S4 (PDF export)** each get their own brainstorm cycle next.
