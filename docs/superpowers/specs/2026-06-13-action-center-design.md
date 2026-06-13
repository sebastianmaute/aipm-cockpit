# Action Center (SP2) — Design

**Date:** 2026-06-13
**Status:** Approved (brainstorming complete) — SP2 of the 4-part "suggested next actions" feature
**Branch:** `feat-action-center`

## Goal

Surface the SP1 engine (`computeNextActions` → ranked `SuggestedAction[]`) to the user: a dedicated **Action Center** view, a **Dashboard "Top 5" widget**, and a **nav badge** of urgent actions. SP2 is read-only + open-only (snooze/dismiss is SP3).

## Roadmap context
SP1 engine ✅ (on main, MR !45). **SP2 = surface (this spec).** SP3 = supplant the due/RAID-review/stakeholder-comms reminders + per-action snooze store. SP4 = inline per-report action chips.

## Scope decisions (locked in brainstorming)
- **Layout:** Action Center groups actions into **Now / Soon / Monitor** sections (score-sorted within; empty sections hidden).
- **Nav badge:** counts **`now`-tier** actions only (urgent count, not total backlog).
- **Row interaction:** the **whole row is clickable** (RAID-style) AND an explicit `[Open]` button — both fire the CTA.
- **Actions view is CORE/always-on** (not a toggleable feature module) — gating happens at the signal level (a disabled module yields no actions).
- **CTA = open only** in SP2 (snooze CTA is SP3); `dismissed` is passed empty.

---

## Components & wiring

### 1. The `actions` view (core, always-on)
- `nav-config.ts`: add `"actions"` to the `AppView` union; add a nav item to the **Overview** `NAV_GROUPS` entry; add `actions: "navActions"` to `LABEL_KEYS`. `parseHash`/`buildHash` already handle any view id.
- `feature-modules.ts`: add `"actions"` to `CORE_VIEWS` (always enabled; `moduleForView("actions")` returns null → `isViewEnabled` true regardless of features). Do NOT add it to `FEATURE_MODULES` (not gateable).
- `workspace-section.tsx`: dynamic-import `ActionsPanel` and render it when `activeTab === "actions"` (mirrors the other panels; works in both classic and modern, since modern routes the same WorkspaceSection content into its workspace slot).

### 2. `next-actions-input.ts` — pure `buildActionInput`
A new pure builder so the assembly is unit-testable and task-manager stays lean:
```ts
export interface BuildActionInputArgs {
  tasks; raid; changes; milestones; stakeholders;
  dashboard: DashboardModel;
  commsReminders: readonly StakeholderCommsReminder[];
  features: readonly FeatureModuleId[];
  projectName: string;
  today: string; now: Date;
  reminderLeadDays: number; dueSoonWorkdays: number; raidReviewIntervalDays: number;
  dismissed?: ReadonlySet<string>;   // SP2 passes undefined → new Set()
}
export function buildActionInput(a: BuildActionInputArgs): ActionInput;
```
It just maps args → the `ActionInput` shape (defaulting `dismissed` to an empty set). Pure, no side effects.

### 3. task-manager wiring (compute once, feed three surfaces)
At the existing `computeDashboard(...)` call site:
- Compute `commsReminders` by lifting the EXISTING `getStakeholderCommsItems` args (the `flags` from `isModuleEnabled(...)` + `leadDaysByQuadrant` from settings — same as the stakeholder-comms banner path; reuse, don't re-derive).
- `const actionInput = buildActionInput({...workspace lists, dashboard model, commsReminders, settings.features, project.name, today, new Date(), settings.notifications.{reminderLeadDays,dueSoonWorkdays,raidReviewIntervalDays}})`.
- `const nextActions = useMemo(() => computeNextActions(actionInput), [tasks, raid, changes, milestones, stakeholders, dashboardModel, settings.features, commsReminders, today])`.
- Derive `const nowCount = nextActions.filter(a => a.tier === "now").length`.
- Pass `nextActions` → `ActionsPanel`; `nextActions.slice(0,5)` → dashboard widget; `nowCount` → the nav badge.
- `settings.notifications` may lack `dueSoonWorkdays` — add it to `NotificationsConfig` (optional, default 3 via `DASHBOARD_DEFAULTS`/`resolveSnapshot`-style default) so the engine matches the dashboard's due-soon window.

### 4. `actions-panel.tsx` + `action-row.tsx`
- `ActionsPanel({ lang, actions, onOpen })`: `VIEW_PANE_FILL_CLASS` shell, a heading (`actionCenterTitle`), then three tier sections (`Now`/`Soon`/`Monitor`, each a label + its rows; hidden when empty). Empty overall → an "all caught up" empty state (`actionsEmptyState`).
- `ActionRow({ lang, action, onOpen })`: a `<div role="button" tabIndex=0 onClick={() => onOpen(action)} className="cursor-pointer … hover:bg-surface-muted">` containing: a small source marker, `t(lang, action.title.key, ...(action.title.params ?? []))`, a muted `why` line, a tier dot, and an `[Open]` `<button>` whose onClick `stopPropagation`s then `onOpen(action)`. AIPM palette; tier accent uses brand tokens (now=AIPM-pink/red-ish within palette, soon=amber-equivalent within palette, monitor=muted) — confirm against `AIPM-color-palette` (use existing health/RAG tokens, no new colors).
- `onOpen(action)` (in task-manager): executes the CTA — `if (action.cta.kind === "open") requestOpen(action.cta.view, action.cta.id)`. (The `snooze` kind is unreachable in SP2.)

### 5. CTA deep-link: generalize id to `string | number`
RAID ids are strings (e.g. `"R-12"`); the deep-link infra in `workspace-tab-context.tsx` types `requestOpen(view, id: number)` / `pendingOpen: {view, id: number}`. Generalize to `string | number`:
- `requestOpen(view: AppView, id: string | number)`, `pendingOpen: { view: AppView; id: string | number } | null`.
- `buildHash(view, id)` already stringifies; `parseHash` returns the id as-is (string) — confirm consumers that compare `pendingOpen.id` to a numeric entity id still match (number panels compare `Number(id)` or the panel already coerces; RAID compares string). Each consuming panel (raid/task/milestone/change/stakeholder) auto-opens its editor from `pendingOpen.id` — verify the comparison works for both id kinds (coerce where a panel uses numeric ids).
- This is backward-compatible: existing numeric callers keep passing numbers.

### 6. Nav badge plumbing
- `sidebar-nav.tsx`: add an optional `badges?: Partial<Record<AppView, number>>` prop; render a small pill (`bg-AIPM-pink text-white`, like the alerts badge) on a nav item when `badges[item.view]` > 0.
- Thread `badges={{ actions: nowCount }}` through `ModernShell → Sidebar → SidebarNav`. Classic layout (`workspace-section.tsx` sub-tabs) may render the same count next to the Actions tab; if the classic sub-tab plumbing is heavy, ship the badge in the modern sidebar (primary) for SP2 and note classic as a follow-up.

---

## i18n (EN + DE, real umlauts)
New keys: `navActions` ("Next actions" / "Nächste Schritte"), `actionCenterTitle`, `dashboardTopActions` ("Top actions" / "Wichtigste Schritte"), `actionsEmptyState`, `actionOpen` ("Open"/"Öffnen"), `actionTierNow`/`actionTierSoon`/`actionTierMonitor` ("Now/Soon/Monitor" / "Jetzt/Bald/Beobachten"), and short source labels (`actionSourceTask`/`Raid`/`Change`/`Milestone`/`Budget`/`Comms`) for the row marker tooltip. (The action title/why keys themselves already shipped in SP1.)

## Version
SP2 is user-visible → bump `version.ts` to **0.77.0** (next codename) + a CHANGELOG entry. `APP_HIGHLIGHT_KEYS` gains a `versionHighlightActionCenter` (EN/DE).

## Testing
- `next-actions-input.test.ts`: `buildActionInput` maps args correctly + defaults `dismissed` to an empty set.
- `actions-panel.test.tsx`: renders grouped Now/Soon/Monitor sections from a fixture list; hides an empty tier; row-click AND the `[Open]` button each call `onOpen` with the right action; the Open button click does NOT double-fire (stopPropagation); empty list → empty state.
- `dashboard-panel` test: the Top-actions card renders ≤5 rows and fires `onOpen`.
- `workspace-tab-context` test: `requestOpen("raid", "R-1")` sets `pendingOpen` to `{view:"raid", id:"R-1"}` (string id round-trips); a numeric caller still works.
- `sidebar-nav` test: a `badges={{actions:3}}` renders the pill; 0/absent → no pill.
- i18n EN/DE parity + encoding tests.
- Full suite green; no existing behavior changed except the (backward-compatible) deep-link id generalization.

## Out of scope (SP2)
- Snooze/dismiss UI + the per-action snooze store (SP3).
- Removing/!changing the existing reminder banners/modals (SP3).
- Inline per-report action chips (SP4).
- New action providers (burndown/birthdays/workload) — additive later.

## File summary
**New:** `next-actions-input.ts`, `actions-panel.tsx`, `action-row.tsx` (+ tests).
**Modified:** `nav-config.ts`, `feature-modules.ts`, `workspace-section.tsx`, `task-manager.tsx`, `workspace-tab-context.tsx`, `sidebar-nav.tsx`, `modern-shell.tsx` (badge passthrough), `dashboard-panel.tsx`, `settings-types.ts` (dueSoonWorkdays), `i18n.ts`/`i18n.de.ts`, `version.ts`, `CHANGELOG.md` (+ tests).
