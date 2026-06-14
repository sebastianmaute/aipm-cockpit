# Supplant Reminders + Per-Action Snooze (SP3) — Design

**Date:** 2026-06-13
**Status:** Approved (brainstorming complete) — SP3 of the 4-part "suggested next actions" feature
**Branch:** `feat-supplant-reminders`

## Goal

Fold the three **reminder** surfaces (due-alerts, RAID-review, stakeholder-comms — banners + modals) into the Action Center queue, and add a per-action **snooze** store so the queue is dismissable. Removes duplicated nudges; the Action Center becomes the single place to see and act on what's due.

## Roadmap context
SP1 engine ✅ · SP2 Action Center surface ✅ (both on main). **SP3 = supplant reminders + snooze (this spec).** SP4 = inline per-report action chips.

## Scope decisions (locked in brainstorming)
- **Supplant set:** the due-alerts, RAID-review, and stakeholder-comms **banners + modals** are removed. KEEP: Birthday, Jira-token, Storage, and safe-mode banners; all toasts.
- **Keep the comms computation:** `use-stakeholder-comms`'s `items` is consumed by the Action Center (`commsReminders`) — only its banner/modal/toast UI is removed.
- **Alerts bell:** repointed to navigate to the Action Center view; its count = the `now`-tier action count.
- **Snooze:** a per-row **Snooze ▾** with **1 hour / 1 day**; snoozed actions hide until the timer expires (NO un-snooze UI).

---

## §1 — Per-action snooze store + engine feed

### `action-snooze.ts` (new)
localStorage key `lop-app:action-snooze` holding `Record<string, number>` (actionId → snoozed-until epoch ms). All access try/catch + `typeof window` guarded (mirrors `reminder-snooze.ts`).
```ts
export function getSnoozedActionIds(now: number): Set<string>; // reads store, prunes expired (persists the pruned map), returns ids still snoozed
export function snoozeAction(actionId: string, durationMs: number, now: number): void; // store[actionId] = now + durationMs
export function clearActionSnooze(actionId: string): void; // optional helper (not surfaced in SP3 UI)
```
Reuses `SNOOZE_1H`/`SNOOZE_1D` (import from `reminder-snooze.ts`, or move the two constants to a shared spot if cleaner).

### `useActionSnooze()` hook (new — in `action-snooze.ts` or its own file)
Returns `{ dismissed: ReadonlySet<string>, snooze: (actionId: string, durationMs: number) => void }`.
- `dismissed = useMemo(() => getSnoozedActionIds(Date.now()), [tick])` — recomputed on a `tick` state bump.
- `snooze(id, ms)`: `snoozeAction(id, ms, Date.now())` then bump `tick` (action vanishes next render).
- A `useEffect` schedules a `setTimeout` to bump `tick` at the SOONEST upcoming expiry (so the action reappears when its snooze lapses), rescheduling whenever `dismissed` changes. (Date.now()/Math.random not banned in app code.)

### Engine feed (task-manager)
Replace the current `dismissed: new Set()` passed into `buildActionInput(...)` with the hook's `dismissed`. The SP1 engine already filters `input.dismissed` — snoozed actions drop out of `nextActions` (and therefore the view, dashboard widget, and `nowCount` badge).

---

## §2 — `ActionRow` snooze control

Add optional `onSnooze?: (action: SuggestedAction, durationMs: number) => void` to `ActionRowProps`. When provided, render a **Snooze ▾** control next to `[Open]`:
- A `<button>` toggles a small popover (local `open` state) of two `<button>`s: "1 hour" (`SNOOZE_1H`) and "1 day" (`SNOOZE_1D`).
- All these buttons `e.stopPropagation()` (the row is a plain `onClick` div post-SP2 — the inner buttons are fine, no nested-interactive since the div has no `role`). The a11y e2e check guards this.
- Picking a duration → `onSnooze(action, ms)` + close the popover.
- When `onSnooze` is omitted (dashboard Top-actions widget passes only `onOpen`), the Snooze control is not rendered.

`ActionsPanel` threads `onSnooze` down (new optional prop). task-manager passes the hook's `snooze` wrapped to `(action, ms) => snooze(action.id, ms)`.

---

## §3 — Remove the three reminder banners + modals

- **`task-manager.tsx` `bannersEl`:** delete the three guard blocks rendering `DueBanner`, `RaidReviewBanner`, `StakeholderCommsBanner`. Keep Birthday / Jira-token / Storage / safe-mode.
- **Modals:** delete `DueDatesModal` (rendered via `app-modals.tsx`), `RaidReviewModal`, `StakeholderCommsModal` (rendered in task-manager). Remove their open-state props/plumbing.
- **`notifications.tsx`:** delete `DueBanner`, `DueDatesModal`, `RaidReviewBanner`, `RaidReviewModal`, `StakeholderCommsBanner`, `StakeholderCommsModal` + any helpers that become orphaned. Keep `BirthdayBanner`, `JiraTokenBanner`, `StorageBanner`.
- **`use-due-alerts.ts`:** DELETE (it only drove the removed due + RAID-review surfaces; `getAlertableTasks`/`getRaidReviewItems` are recomputed by the engine). Remove its call + the `dueModalOpen`/`raidReviewModalOpen` state from task-manager.
- **`use-stakeholder-comms.ts`:** strip the banner/modal/toast state (`bannerDismissed`, `reviewModalOpen`, the snooze/toast). KEEP the `items` computation. If the hook reduces to just returning `items`, either keep it as a thin hook OR inline `getStakeholderCommsItems(...)` in task-manager and delete the hook — pick whichever keeps task-manager cleanest; `comms.items` must still flow into `buildActionInput`.
- **`reminder-snooze.ts`:** remove `"due"`/`"raidReview"`/`"stakeholderComms"` from the `ReminderKind` union (keep `"birthday"`/`"jiraToken"`). Remove the three `useReminderSnooze(...)` calls in task-manager (keep birthday/jiraToken). The `SNOOZE_1H`/`SNOOZE_1D` constants stay (now also used by `action-snooze`).
- **`app-modals.tsx`:** remove the `DueDatesModal` block + its props from the `AppModals` interface.

> Removal must not break the `AppModals`/task-manager prop contracts — update each interface as you delete props. Run the full suite; several tests assert on these banners/modals and must be removed or updated.

---

## §4 — Repoint the alerts bell

The header bell button exists in classic `AppHeader` and modern `TopBar` with a count (`bannerItems.length` today). Repoint:
- Its `onClick` navigates to the Action Center view: `requestOpen("actions", …)` or `setActiveTab("actions")` (use whichever the header already has access to; the bell may need a new `onOpenActions` callback prop wired from task-manager).
- Its count becomes the `now`-tier action count (`nowCount`, already computed in SP2) — pass that as the badge number instead of the due-items length.
- Remove the now-dead `bannerItems`/`setDueModalOpen` wiring the bell used.

---

## §5 — Settings/i18n cleanup, version, testing

- **Settings:** the lead-time (`reminderLeadDays`), `raidReviewIntervalDays`, `dueSoonWorkdays`, and `leadDaysByQuadrant` settings STAY (the engine consumes them). The now-dead per-reminder banner/popup *toggle* settings are removed from the settings UI **only where straightforward** (a clearly-dead toggle in `notifications-section`); otherwise leave inert and note. Conservative — no broad settings refactor.
- **i18n:** ADD `actionSnooze` ("Snooze"/"Später"), `actionSnooze1h` ("1 hour"/"1 Stunde"), `actionSnooze1d` ("1 day"/"1 Tag"). REMOVE i18n keys that become clearly dead with the deleted banners/modals (e.g. due-banner/raid-review-banner/comms-banner+modal-specific keys) — keep any key still referenced elsewhere; preserve EN/DE parity (tsc enforces via `Record<TranslationKey,…>`).
- **Version:** bump to **0.78.0** (next codename) + CHANGELOG + `versionHighlightSnoozeActions` (EN/DE) appended to `APP_HIGHLIGHT_KEYS`.
- **Testing:**
  - `action-snooze.test.ts`: `snoozeAction` then `getSnoozedActionIds(now)` includes it; an expired entry is pruned (and removed from the persisted store); localStorage-disabled → no throw, empty set.
  - `useActionSnooze` test: `snooze(id, ms)` adds id to `dismissed`; advancing fake timers past expiry removes it.
  - `action-row` test: the Snooze menu renders 1h/1d; clicking fires `onSnooze(action, SNOOZE_1H|1D)`; menu buttons stopPropagation (no row open); when `onSnooze` omitted, no Snooze control.
  - task-manager / app-modals: assert the three reminder banners + modals no longer render; the bell click navigates to `actions`; `dismissed` flows into the engine (a snoozed action id is absent from the rendered queue).
  - Remove/!update existing tests that assert the deleted banners/modals.
  - i18n parity/encoding; full suite + e2e green.

## Out of scope (SP3)
- Un-snooze UI / a "Snoozed" section.
- SP4 inline per-report chips.
- New action providers.
- A broad notifications-settings redesign (only the clearly-dead toggle is touched).

## File summary
**New:** `action-snooze.ts` (+ test), `use-action-snooze` (in that file or its own) (+ test).
**Modified:** `action-row.tsx`, `actions-panel.tsx`, `task-manager.tsx`, `notifications.tsx`, `app-modals.tsx`, `use-stakeholder-comms.ts`, `reminder-snooze.ts`, `app-header.tsx`, `top-bar.tsx`, `i18n.ts`/`i18n.de.ts`, `version.ts`, `CHANGELOG.md`, `settings-sections/notifications-section.tsx` (conservative), (+ tests).
**Deleted:** `use-due-alerts.ts` (+ its test).
