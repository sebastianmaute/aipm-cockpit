# Inline Action Chips (SP4) — Design

**Date:** 2026-06-14
**Status:** Approved (brainstorming complete) — SP4 of the 4-part "suggested next actions" feature; COMPLETES it.
**Branch:** `feat-a11y-degflake-and-action-chips` (shared with the a11y-gate de-flake fix `2b5ab22`)

## Goal

Surface the next action(s) **inline where the data lives** — a compact chip strip on each data view and on each Reports card — so the user acts without first going to the Action Center. Pure consumer of the existing `nextActions` queue (SP1 engine); no engine change. Also folds in the **classic-layout nav badge** deferred from SP2/SP3.

## Roadmap context
SP1 engine ✅ · SP2 Action Center ✅ · SP3 supplant-reminders + per-action snooze ✅ · **SP4 = inline chips (this spec) — closes the feature.**

## Scope decisions (locked in brainstorming)
- **Surfaces:** BOTH the live data-view headers (RAID, Open Points, Budget, Milestones, Changes, Stakeholders) AND the Reports cards.
- **Click:** a chip executes the action's CTA = open the entity (reuse `requestOpen(view, Number(id))`). NO inline snooze.
- **Count/tier:** at most **3** chips per surface from **now+soon** tiers (skip `monitor`); a trailing **`+N more`** chip → Action Center when truncated; the strip is **hidden entirely** when a surface has no now/soon actions.

---

## §1 — `action-chips.tsx` (new, presentational)

```ts
interface ActionChipsProps {
  lang: Lang;
  actions: readonly SuggestedAction[];   // already-filtered-to-this-surface list
  onOpen: (action: SuggestedAction) => void;
  onShowMore: () => void;                // navigate to the Action Center
  className?: string;
}
export function ActionChips({ lang, actions, onOpen, onShowMore, className }: ActionChipsProps): JSX.Element | null;
```

Behavior:
- `const ranked = actions.filter(a => a.tier === "now" || a.tier === "soon")` (engine already score-sorts the input, so order is preserved; no re-sort needed).
- If `ranked.length === 0` → return `null` (strip hidden — no empty state).
- Render the first **3** as chips; `const extra = ranked.length - shown.length` (only counting now/soon).
- Each chip = a `<button type="button" onClick={() => onOpen(action)}>` with:
  - a tier dot (`now` = `bg-AIPM-pink`, `soon` = `bg-AIPM-purple` — reuse the SP2 `TIER_DOT` values; extract `TIER_DOT` into a tiny shared spot or duplicate the 2 used here),
  - `t(lang, action.title.key, ...(action.title.params ?? []))` (the source is obvious from context, so NO source label on the chip).
  - palette-safe classes: `inline-flex items-center gap-1.5 rounded-md border border-line bg-surface px-2 py-1 text-xs text-foreground hover:bg-surface-muted`.
- If `extra > 0`, a trailing `+N more` `<button onClick={onShowMore}>` (`t(lang, "actionChipsMore", extra)`), same chip styling but `text-muted-foreground`.
- Wrapper: `<div role="group" aria-label={t(lang,"actionChipsLabel")} className={`flex flex-wrap items-center gap-1.5 ${className ?? ""}`}>`.

Pure/presentational — no `nextActions` computation, no engine import beyond the `SuggestedAction` type.

## §2 — Data-view strip (single injection in `workspace-section.tsx`)

`WorkspaceSection` already receives `nextActions`, the CTA executor (`onOpenAction`), and `activeTab`. Inject ONE strip above the panel switch:

```tsx
const viewChips = nextActions.filter(a => a.cta.kind === "open" && a.cta.view === activeTab);
// rendered just inside the panel container, above the activeTab switch:
<ActionChips
  lang={lang}
  actions={viewChips}
  onOpen={onOpenAction}
  onShowMore={() => /* navigate to the actions view via the existing tab-select path */}
  className="mb-2 shrink-0"
/>
```

- Filtering by `a.cta.view === activeTab` reuses the CTA target — NO new view→source map. Views with no matching actions get an empty list → `ActionChips` renders `null`, so the strip self-hides (the `actions`/`reports`/`dashboard`/`settings`/etc. views never show it). Works in BOTH classic and modern (both route through `WorkspaceSection`).
- `onShowMore` navigates to the `"actions"` view. Wire it to the SAME mechanism the nav uses — `requestOpen("actions", 0)` or the sub-tab select callback already in scope (the plan pins the exact symbol after reading the component; do NOT invent a new context).
- Place the strip so it does not break the existing `fillHeight`/resizable panes — a `shrink-0` row above the scroll/flex body.

## §3 — Reports cards (`reports.tsx` + `report-table.tsx`)

- `ReportCard` (`report-table.tsx:161`) gains an OPTIONAL `actions?: ReactNode` prop, rendered between the title/toolbar row and the card body (a `shrink-0` row).
- `ReportsPanel` (`reports.tsx`) gains props `nextActions: readonly SuggestedAction[]`, `onOpenAction: (a) => void`, `onShowActions: () => void` — threaded from `WorkspaceSection`'s `activeTab === "reports"` render site (which already has them).
- Map each report id → its action-source view, then pass per-card chips:
  - `raid-report` → `"raid"`, `budget-report` → `"budget"`, `stakeholder-report` → `"stakeholders"`, `resource-report` → none (Resources is not an action source → no chips).
  - `<ReportCard … actions={<ActionChips lang actions={nextActions.filter(a => a.cta.view === SRC)} onOpen={onOpenAction} onShowMore={onShowActions} />}>`.
- The top-level Reports `ReportCard` (the wrapper at `reports.tsx:428`, `title={tabReports}`) gets NO chips (the data-view strip already self-hides on `activeTab==="reports"` since no action has `cta.view==="reports"`).

## §4 — Classic-layout now-count: ALREADY DONE (no work)

Investigation correction: the classic `legacyTree` has **no "Actions" tab** — its primary chrome is `AppHeader` + the workspace card's legacy tab strip (chat/reports/gantt/raid/resources/budget/activity) + the Tasks section; the modern sidebar (with `navBadges`) is modern-only. The classic now-tier count is **already surfaced** by the SP3 bell repoint (`AppHeader … bannerCount={nowCount}`, `onShowAlerts → setActiveTab("actions")`). The modern sidebar badge shipped in SP2. So both layouts already show the now-tier count — **SP4 adds no nav badge.** (The inline chips' `+N more` is the in-view path to the full Action Center.)

## §5 — i18n, version, testing

- **i18n (EN + DE, real umlauts):** `actionChipsMore` = `"+{0} more"` / `"+{0} weitere"`; `actionChipsLabel` = `"Suggested actions"` / `"Vorgeschlagene Schritte"` (group aria-label). (Chip titles reuse the SP1 `action*Title` keys.)
- **Version:** bump `version.ts` to **0.79.0** "Willis" (Connie Willis) + `APP_BUILD_DATE` comment + CHANGELOG; append `"versionHighlightActionChips"` to `APP_HIGHLIGHT_KEYS` (+ EN/DE key).
- **Testing:**
  - `action-chips.test.tsx`: filters out `monitor`; caps at 3 chips; `+N more` shows the correct N (now/soon only) and fires `onShowMore`; clicking a chip fires `onOpen` with that action; empty/all-monitor list → renders nothing; chip title uses `t(...)`.
  - `workspace-section` test: the strip renders for a view with matching now/soon actions and is absent for a view with none; `onShowMore` navigates to `actions`.
  - `report-table`/`reports` test: a `ReportCard` with an `actions` slot renders it; `ReportsPanel` passes the right per-card source filter.
  - i18n EN/DE parity + encoding; full suite + e2e green (the e2e a11y gate is now deterministic after `2b5ab22`).

## Out of scope (SP4)
- Inline snooze on chips (the Action Center has it).
- New action providers / engine changes.
- A separate per-report action *report* (chips only).

## File summary
**New:** `action-chips.tsx` (+ test).
**Modified:** `workspace-section.tsx` (data-view strip + thread chips to ReportsPanel), `reports.tsx` (per-card chips), `report-table.tsx` (`ReportCard.actions` slot), `i18n.ts`/`i18n.de.ts`, `version.ts`, `CHANGELOG.md` (+ tests).
