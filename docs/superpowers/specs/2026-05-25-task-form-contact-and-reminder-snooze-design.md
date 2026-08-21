# Add-Contact-from-Task-Form + Unified Reminders (lead, working-day shift, snooze) Design

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:writing-plans to turn this into a phased implementation plan, then superpowers:subagent-driven-development. Three independent phases (A, B, C) — see [Phased Build Order](#phased-build-order).

**Goal:**
- **A.** From the task create/edit window, a **+** next to the Assignee opens the address-book **Add entry** modal (seeded with the typed name/email); saving creates the resource and fills the task's assignee.
- **B.** **Unified reminder lead** — one "days ahead" control for both birthday and due-date reminders — and a **working-day shift**: a reminder whose trigger would land on a weekend, holiday, or the subject person's vacation is pulled **earlier** to the previous working day, so reminders first fire during the work week.
- **C.** Reminder banners gain a **persisted Snooze** (In 1 hour / In 1 day) next to Dismiss.

Builds on the merged Resource Address Book feature and the pop-out/sync fixes (both in `main`).

---

## Decisions (resolved during brainstorming)

| # | Decision | Choice |
|---|----------|--------|
| 1 | "+" behavior | **Create + fill the assignee** — open the add-entry modal seeded with the typed name/email; on save, create the resource and set the task's assignee/email. |
| 2 | Task↔resource link | **By name** (case-folded display name), matching how the Workload tab already joins. The task form is NOT extended with `resourceId`. |
| 3 | Days-ahead control | **Unified.** A single `notifications.reminderLeadDays` (calendar days, default 7) drives both birthday and due reminders. Replaces per-channel `thresholdWorkDays` and `birthday.leadDays`. |
| 4 | Working-day shift | Reminder **trigger date = `shiftToWorkingDay(event − leadDays)`**, stepping **backward** to the previous working day. Sat→Fri (+1), Sun→Fri (+2); holidays/vacation step back further. Reminder active when `trigger ≤ today ≤ event`. |
| 5 | Non-working day | **weekend ∪ holiday (`holidaySet`) ∪ subject person's absences** — task assignee's absences for due reminders, the resource's absences for birthday reminders. |
| 6 | Settings restructure | **Yes**, with migration: drop per-channel `thresholdWorkDays` + `birthday.leadDays`, add `reminderLeadDays`; keep per-channel enable toggles. |
| 7 | Reminder scope for snooze | **Both** birthday and due-date banners. |
| 8 | Snooze persistence / UI | **Persist across reloads** (localStorage `snoozedUntil` per kind); control lives **on the existing banners** (In 1 hour / In 1 day). |

---

## Phase A — Add address-book entry from the task form

### UI (`task-form-modal.tsx`)
Beside the **Assignee** `Field` label, add a small **+** icon button (title/`aria-label` = `taskAddAssigneeToAddressBook`). No-op/disabled when `editingIsJiraLinked`. Clicking it calls a new prop `onAddAssigneeToAddressBook(name, email)` with `form.assignee` / `form.assigneeEmail`. The existing `ResourceEditModal` opens in create mode seeded with the split name + email, stacked above the task modal (its `Modal` `zIndex` ≥ the task modal's; task modal stays mounted). On cancel nothing changes; on save the resource is created and the task assignee/email are filled.

### Wiring (`task-manager.tsx`)
`task-manager` holds both `useTaskForm` (`form`, `setForm`) and `useResourcePlanner` (`handleOpenAddResource(seed)`, `handleSaveResource`, `handleCloseResourceModal`).

```ts
const [fillTaskAssigneeOnSave, setFillTaskAssigneeOnSave] = useState(false);

const handleAddAssigneeToAddressBook = useCallback((name: string, email: string) => {
  const { firstName, lastName } = splitName(name);
  setFillTaskAssigneeOnSave(true);
  handleOpenAddResource({ firstName, lastName, email: email.trim() || undefined });
}, [handleOpenAddResource]);

const handleSaveResourceFromAnywhere = useCallback((next: Resource) => {
  handleSaveResource(next);                       // existing: upsert + close
  if (fillTaskAssigneeOnSave) {
    setForm((prev) => ({ ...prev, assignee: resourceDisplayName(next), assigneeEmail: next.email ?? "" }));
    setFillTaskAssigneeOnSave(false);
  }
}, [handleSaveResource, fillTaskAssigneeOnSave, setForm]);

const handleCloseResourceFromAnywhere = useCallback(() => {
  handleCloseResourceModal();
  setFillTaskAssigneeOnSave(false);               // cancel → don't fill a later unrelated add
}, [handleCloseResourceModal]);
```

Pass `onSaveResource={handleSaveResourceFromAnywhere}` + `onCloseResourceModal={handleCloseResourceFromAnywhere}` to `<AppModals>` (replacing the direct planner handlers), and thread `onAddAssigneeToAddressBook` through `AppModalsProps` → `TaskFormModal`. Import `splitName`/`resourceDisplayName` from `./resource-foundation`.

### i18n
`taskAddAssigneeToAddressBook` ("Add to address book" / de "Zum Adressbuch hinzufügen").

### Tests
- `task-form-modal.test`: **+** renders, disabled for Jira-managed, fires `onAddAssigneeToAddressBook(name, email)`.
- `app-modals` prop-threading; fill-on-save covered via the planner/modal units (extract the wrapper if helpful).

### Edge cases
Two stacked modals (resource over task) — verify z-order; resource Escape/backdrop closes only it. No `resourceId` on the form; association is by display name.

---

## Phase B — Unified reminder lead + working-day-shifted trigger

### B1. Settings restructure (`settings-menu.tsx`, `use-settings.ts`)
New shape:
```ts
type ChannelConfig = { enabled: boolean };
type NotificationsConfig = {
  reminderLeadDays: number;          // unified, calendar days
  banner: ChannelConfig;             // due-date channels
  toast: ChannelConfig;
  popup: ChannelConfig;
  birthday: ChannelConfig;
};
const defaultNotificationsConfig: NotificationsConfig = {
  reminderLeadDays: 7,
  banner: { enabled: true }, toast: { enabled: true }, popup: { enabled: true },
  birthday: { enabled: true },
};
```
**Migration** (`use-settings.ts`): the current `{ ...default, ...parsed.notifications }` spread is insufficient for a shape change. Add a `migrateNotifications(parsed)` that produces the new shape:
- `reminderLeadDays = parsed?.birthday?.leadDays ?? parsed?.banner?.thresholdWorkDays ?? 7`
- each channel `{ enabled: parsed?.<ch>?.enabled ?? true }` (drops `thresholdWorkDays`); `birthday: { enabled: parsed?.birthday?.enabled ?? true }`.

**Settings UI** (notifications section): one **"Days ahead"** number input bound to `reminderLeadDays` (min 0, max 365), then four simple enable toggles (Banner / Toast / Popup / Birthday). `NotificationRow` simplifies to a toggle (drop the per-row threshold input); the birthday control drops its leadDays input.

### B2. Working-day shift helper (`due-dates.ts`)
```ts
// True if `iso` (YYYY-MM-DD) is Sat/Sun, a holiday, or an absence day.
// Step `iso` backward day-by-day until it is a working day; return that date.
export function shiftToWorkingDay(
  iso: string,
  holidays: ReadonlySet<string>,
  absenceDays: ReadonlySet<string>,
): string;

// Expand a person's absences ([startDate,endDate] inclusive) to a Set of
// YYYY-MM-DD, filtered to a case-folded assignee/display name.
export function absenceDaysFor(
  absences: readonly Absence[],
  personKey: string,        // case-folded name
): Set<string>;
```
`shiftToWorkingDay` is bounded (e.g., cap the backward steps, say 366, to avoid pathological loops) and pure.

### B3. Rework alert selection to the trigger-window model
**`getAlertableTasks`** — new signature `(tasks, reminderLeadDays, today, holidays, absences)`:
- `overdue` (due < today) and `today` (due == today) unchanged.
- A future task is **`soon`** when `today >= shiftToWorkingDay(addDays(dueDate, -reminderLeadDays), holidays, absenceDaysFor(absences, task.assignee))` (and `today < dueDate`). `workDaysLeft` (display) keeps using `workdaysUntil`.
- `workdaysUntil`/`summarizeAlerts` unchanged.

**`getUpcomingBirthdays`** (`birthdays.ts`) — new signature `(resources, today, leadDays, holidays, absences)`:
- For each resource with a birthday, compute the next occurrence `E` (existing year-wrap logic), then `trigger = shiftToWorkingDay(addDays(E, -leadDays), holidays, absenceDaysFor(absences, resourceDisplayName(r)))`.
- Include the resource when `trigger <= today <= E`; `daysUntil = E − today`. Sorted by `daysUntil`.

### B4. Call sites
- `task-manager.tsx`: `bannerItems`/`birthdayItems` memos call the new signatures with `settings.notifications.reminderLeadDays`, `holidaySet`, `absences`. (Channels: a due reminder shows in banner/toast/popup per the respective `enabled` flag, all sharing the one lead.)
- `use-due-alerts.ts` / `use-birthday-alerts.ts`: pass `reminderLeadDays` + `holidaySet` + `absences`; respect the per-channel `enabled` flags.

### Tests
- `due-dates.test.ts`: `shiftToWorkingDay` (Sat→Fri, Sun→Fri, holiday/absence step-back, bounded); `getAlertableTasks` soon-window using the shifted trigger.
- `birthdays.test.ts`: updated signature; trigger shift incl. weekend/holiday/absence; year-wrap preserved.
- `use-settings` migration test: old notifications shape → `reminderLeadDays` derived, channels carried, thresholds dropped.
- Update `use-due-alerts.test`, `use-birthday-alerts.test`, `settings-menu.test`, and any inline `notifications` fixtures (e.g. `use-chat-dispatcher.test`) to the new shape.

---

## Phase C — Persisted snooze on the reminder banners

### Snooze store — `reminder-snooze.ts`
```ts
export type ReminderKind = "due" | "birthday";
const KEY = (k: ReminderKind) => `lop-app:reminder-snooze:${k}`;
export const SNOOZE_1H = 60 * 60 * 1000;
export const SNOOZE_1D = 24 * 60 * 60 * 1000;

export function getSnoozedUntil(kind: ReminderKind): number | null {
  try { const v = Number(window.localStorage.getItem(KEY(kind))); return Number.isFinite(v) && v > 0 ? v : null; }
  catch { return null; }
}
export function setSnoozedUntil(kind: ReminderKind, untilMs: number): void {
  try { window.localStorage.setItem(KEY(kind), String(untilMs)); } catch { /* quota/disabled — non-fatal */ }
}
export function clearSnooze(kind: ReminderKind): void {
  try { window.localStorage.removeItem(KEY(kind)); } catch { /* non-fatal */ }
}
```

### Hook — `use-reminder-snooze.ts`
`useReminderSnooze(kind) -> { isSnoozed, snoozedUntil, snooze(ms), clear }`. On mount read `getSnoozedUntil`; `isSnoozed = until != null && Date.now() < until`. When snoozed, a `setTimeout(until − now)` clears it so the banner reappears without a reload (cleaned up on unmount/re-snooze). `snooze(ms)` persists `Date.now()+ms`; `clear()` removes it.

### Banner UI — `notifications.tsx`
`DueBanner` + `BirthdayBanner` gain `onSnooze(ms)` and a **Snooze ▾** control (In 1 hour `SNOOZE_1H` / In 1 day `SNOOZE_1D`) beside Dismiss. New i18n `reminderSnooze`, `reminderSnooze1h`, `reminderSnooze1d` (+ de).

### Wiring — `task-manager.tsx`
`const dueSnooze = useReminderSnooze("due"); const birthdaySnooze = useReminderSnooze("birthday");`
- Due gate: `!isPopout && !bannerDismissed && !dueSnooze.isSnoozed && bannerItems.length > 0`; `onSnooze={dueSnooze.snooze}`.
- Birthday gate: `!isPopout && !birthdayDismissed && !birthdaySnooze.isSnoozed && birthdayItems.length > 0`; `onSnooze={birthdaySnooze.snooze}`.

### Toast suppression
`use-due-alerts.ts` / `use-birthday-alerts.ts`: skip the load toast when `getSnoozedUntil(kind)` is in the future.

### Tests
- `reminder-snooze.test.ts`: get/set/clear; null for absent/invalid.
- `use-reminder-snooze.test.tsx`: `isSnoozed` after `snooze()`; clears after timer (fake timers); `clear()`.
- `notifications.test.tsx`: banners render Snooze + fire `onSnooze` with the right durations.
- alert hooks: no load toast while snoozed.

---

## Files

**New:** `reminder-snooze.ts` (+test), `use-reminder-snooze.ts` (+test).
**Changed:**
- A: `task-form-modal.tsx`, `app-modals.tsx`, `task-manager.tsx`, `i18n.ts`/`i18n.de.ts`, `task-form-modal.test`.
- B: `settings-menu.tsx`, `use-settings.ts`, `due-dates.ts`, `birthdays.ts`, `task-manager.tsx`, `use-due-alerts.ts`, `use-birthday-alerts.ts`, `i18n.ts`/`i18n.de.ts`, plus tests (`due-dates.test.ts`, `birthdays.test.ts`, `use-settings`/`settings-menu.test.tsx`, `use-due-alerts.test.ts`, `use-birthday-alerts.test.tsx`, `use-chat-dispatcher.test.tsx`).
- C: `notifications.tsx`, `task-manager.tsx`, `use-due-alerts.ts`, `use-birthday-alerts.ts`, `notifications.test.tsx`, `i18n.ts`/`i18n.de.ts`.

---

## Phased Build Order
1. **Phase A** — Add contact from task form (additive, independently shippable).
2. **Phase B** — Unified `reminderLeadDays` + settings migration + working-day-shifted trigger across due + birthday alerts. (Biggest phase: reworks `due-dates.ts`/`birthdays.ts`, settings shape, alert hooks, and their tests.)
3. **Phase C** — Persisted banner snooze (depends on the banners; independent of A/B logic otherwise).

Each phase ends green (`tsc` + tests) and passes spec + code-quality review.

---

## Out of scope
- A dedicated reminders inbox/panel (snooze lives on the banners).
- Adding `resourceId` to the task form (link by name).
- Snooze for the load-time popup modal (snooze targets banners + toast).
- Changing the overdue/today categorization (only the "soon" inclusion rule changes).
