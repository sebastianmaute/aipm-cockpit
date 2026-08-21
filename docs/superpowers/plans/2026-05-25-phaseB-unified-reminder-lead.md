# Phase B — Unified Reminder Lead + Working-Day-Shifted Trigger — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** One unified `notifications.reminderLeadDays` (calendar days) drives both due-date and birthday reminders, and each reminder's trigger is **shifted backward to the previous working day** (skipping weekends, holidays, and the subject person's absences) so reminders first fire during the work week (Sat→Fri +1, Sun→Fri +2).

**Architecture:** Pure helpers (`shiftToWorkingDay`, `absenceDayMap`) in `due-dates.ts`. Then one atomic change: restructure `notifications` settings (drop per-channel `thresholdWorkDays` + `birthday.leadDays`, add `reminderLeadDays`) with a migration, rework `getAlertableTasks` + `getUpcomingBirthdays` to the trigger-window model, and update all call sites/hooks/tests together to a green build.

**Tech Stack:** TypeScript, Next.js 16, React 19, Tailwind v4, Vitest + RTL. Source `src/app/`.

**Source spec:** [`../specs/2026-05-25-task-form-contact-and-reminder-snooze-design.md`](../specs/2026-05-25-task-form-contact-and-reminder-snooze-design.md) — Phase B of 3.

---

### Task 1: Working-day helpers in `due-dates.ts`

**Files:** Modify `src/app/due-dates.ts`; Test `src/app/due-dates.test.ts`.

- [ ] **Step 1: Failing tests** — add to `src/app/due-dates.test.ts`:
```ts
import { shiftToWorkingDay, absenceDayMap } from "./due-dates";
import type { Absence } from "./types";

describe("shiftToWorkingDay", () => {
  const NONE = new Set<string>();
  it("returns the date unchanged on a weekday", () => {
    expect(shiftToWorkingDay("2026-06-17", NONE, NONE)).toBe("2026-06-17"); // Wed
  });
  it("Saturday shifts back to Friday (+1)", () => {
    expect(shiftToWorkingDay("2026-06-20", NONE, NONE)).toBe("2026-06-19"); // Sat -> Fri
  });
  it("Sunday shifts back to Friday (+2)", () => {
    expect(shiftToWorkingDay("2026-06-21", NONE, NONE)).toBe("2026-06-19"); // Sun -> Fri
  });
  it("steps back over a holiday", () => {
    expect(shiftToWorkingDay("2026-06-20", new Set(["2026-06-19"]), NONE)).toBe("2026-06-18");
  });
  it("steps back over an absence day", () => {
    expect(shiftToWorkingDay("2026-06-19", NONE, new Set(["2026-06-19"]))).toBe("2026-06-18"); // Fri absent -> Thu
  });
});

describe("absenceDayMap", () => {
  it("expands an absence range to per-day entries keyed by case-folded name", () => {
    const abs: Absence[] = [{ id: 1, assignee: "Alex Example", startDate: "2026-06-10", endDate: "2026-06-12", type: "vacation" }];
    const map = absenceDayMap(abs);
    expect([...(map.get("Alex Example") ?? [])].sort()).toEqual(["2026-06-10", "2026-06-11", "2026-06-12"]);
  });
});
```
Run `npx vitest run src/app/due-dates.test.ts` → FAIL (not exported).

- [ ] **Step 2: Implement** — add to `src/app/due-dates.ts` (it imports `Task`; add `import type { Absence } from "./types";`):
```ts
function isoAddDays(iso: string, delta: number): string {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + delta);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function isNonWorkingDay(iso: string, holidays: ReadonlySet<string>, absenceDays: ReadonlySet<string>): boolean {
  const dow = new Date(iso + "T00:00:00").getDay(); // 0 Sun .. 6 Sat
  return dow === 0 || dow === 6 || holidays.has(iso) || absenceDays.has(iso);
}

/**
 * Step `iso` (YYYY-MM-DD) backward to the nearest working day, skipping
 * weekends, holidays, and absence days. Bounded to 366 steps. Pure.
 */
export function shiftToWorkingDay(
  iso: string,
  holidays: ReadonlySet<string>,
  absenceDays: ReadonlySet<string>,
): string {
  let cur = iso;
  for (let i = 0; i < 366 && isNonWorkingDay(cur, holidays, absenceDays); i++) {
    cur = isoAddDays(cur, -1);
  }
  return cur;
}

/** Map case-folded assignee name -> set of YYYY-MM-DD covered by their absences (inclusive). */
export function absenceDayMap(absences: readonly Absence[]): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const a of absences) {
    const key = (a.assignee ?? "").trim().toLowerCase();
    if (!key || !a.startDate || !a.endDate) continue;
    let set = map.get(key);
    if (!set) { set = new Set(); map.set(key, set); }
    let cur = a.startDate;
    for (let i = 0; i < 366 && cur <= a.endDate; i++) {
      set.add(cur);
      cur = isoAddDays(cur, 1);
    }
  }
  return map;
}

// Re-exported so birthdays.ts computes event − leadDays with the same calendar math.
export { isoAddDays };
```
Run tests → PASS. `npx tsc --noEmit` clean.

- [ ] **Step 3: Commit**
```bash
git add src/app/due-dates.ts src/app/due-dates.test.ts
git commit -m "feat(reminders): shiftToWorkingDay + absenceDayMap helpers"
```

---

### Task 2: Unified lead + trigger-window rework (atomic)

This changes the `notifications` settings shape and the signatures of `getAlertableTasks`/`getUpcomingBirthdays`; it does not compile partway through, so all edits land together and end on green `tsc` + `npx vitest run`.

**Files:** `settings-menu.tsx`, `use-settings.ts`, `due-dates.ts`, `birthdays.ts`, `use-due-alerts.ts`, `use-birthday-alerts.ts`, `task-manager.tsx`, `i18n.ts`/`i18n.de.ts`; tests `due-dates.test.ts`, `birthdays.test.ts`, `use-due-alerts.test.ts`, `use-birthday-alerts.test.tsx`, `settings-menu.test.tsx`, `use-chat-dispatcher.test.tsx`.

- [ ] **Step 1: Failing tests for the new signatures.** Update existing `getAlertableTasks` tests in `due-dates.test.ts` to `(tasks, reminderLeadDays, today, holidays, absences)`; update `birthdays.test.ts`'s 8 tests to `(resources, today, leadDays, holidays, absences)` (add `new Set()` + `[]`). Add window cases:
```ts
const tk = (id:number, dueDate:string): Task => ({ id, taskName:"T", assignee:"A", assigneeEmail:"", dueDate, lastUpdateDate:"2026-01-01", priority:"Medium", blockers:"", notes:"", inquiriesSent:0 });
expect(getAlertableTasks([tk(1,"2026-06-22")], 2, "2026-06-18", new Set(), [])).toHaveLength(0); // before shifted trigger (Fri 06-19)
expect(getAlertableTasks([tk(1,"2026-06-22")], 2, "2026-06-19", new Set(), [])[0].category).toBe("soon");

const rb = (b:string): Resource => ({ id:1, firstName:"A", lastName:"B", birthday:b, roleId:null, utilizationMode:"percent", utilization:{} });
expect(getUpcomingBirthdays([rb("06-22")], "2026-06-18", 2, new Set(), [])).toHaveLength(0);
expect(getUpcomingBirthdays([rb("06-22")], "2026-06-19", 2, new Set(), [])).toHaveLength(1);
```
Run → FAIL.

- [ ] **Step 2: Rework `getAlertableTasks`** (`due-dates.ts`) — keep `AlertCategory`/`AlertableTask`/`workdaysUntil`/`summarizeAlerts`:
```ts
export function getAlertableTasks(
  tasks: Task[],
  reminderLeadDays: number,
  today: string,
  holidays: Set<string>,
  absences: readonly Absence[],
): AlertableTask[] {
  const absMap = absenceDayMap(absences);
  const EMPTY: ReadonlySet<string> = new Set();
  const out: AlertableTask[] = [];
  for (const task of tasks) {
    if (!task.dueDate || task.completedDate) continue;
    if (task.dueDate < today) { out.push({ task, category: "overdue", workDaysLeft: 0 }); continue; }
    if (task.dueDate === today) { out.push({ task, category: "today", workDaysLeft: 0 }); continue; }
    const absenceDays = absMap.get(task.assignee.trim().toLowerCase()) ?? EMPTY;
    const trigger = shiftToWorkingDay(isoAddDays(task.dueDate, -reminderLeadDays), holidays, absenceDays);
    if (today >= trigger) {
      out.push({ task, category: "soon", workDaysLeft: workdaysUntil(task.dueDate, today, holidays) });
    }
  }
  out.sort((a, b) => a.task.dueDate.localeCompare(b.task.dueDate));
  return out;
}
```

- [ ] **Step 3: Rework `getUpcomingBirthdays`** (`birthdays.ts`). Add `import { shiftToWorkingDay, absenceDayMap, isoAddDays } from "./due-dates";`, `import { resourceDisplayName } from "./resource-foundation";`, and extend the types import to `import type { Absence, Resource } from "./types";`. New body:
```ts
export function getUpcomingBirthdays(
  resources: readonly Resource[],
  today: string,
  leadDays: number,
  holidays: ReadonlySet<string>,
  absences: readonly Absence[],
): UpcomingBirthday[] {
  const base = new Date(`${today}T00:00:00Z`);
  if (Number.isNaN(base.valueOf()) || leadDays < 0) return [];
  const baseMs = base.valueOf();
  const year = base.getUTCFullYear();
  const absMap = absenceDayMap(absences);
  const EMPTY: ReadonlySet<string> = new Set();

  const out: UpcomingBirthday[] = [];
  for (const r of resources) {
    const m = (r.birthday ?? "").match(/^(\d{2})-(\d{2})$/);
    if (!m) continue;
    const mm = Number(m[1]); const dd = Number(m[2]);
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) continue;
    let occMs = Date.UTC(year, mm - 1, dd);
    if (occMs < baseMs) occMs = Date.UTC(year + 1, mm - 1, dd);
    const eventIso = new Date(occMs).toISOString().slice(0, 10);
    const absenceDays = absMap.get(resourceDisplayName(r).trim().toLowerCase()) ?? EMPTY;
    const trigger = shiftToWorkingDay(isoAddDays(eventIso, -leadDays), holidays, absenceDays);
    if (today >= trigger && today <= eventIso) {
      out.push({ resource: r, daysUntil: Math.round((occMs - baseMs) / MS_PER_DAY) });
    }
  }
  out.sort((a, b) => a.daysUntil - b.daysUntil);
  return out;
}
```
(`MS_PER_DAY` already declared in birthdays.ts.)

- [ ] **Step 4: Settings restructure** (`settings-menu.tsx`). Replace `DueNotificationConfig`/`NotificationsConfig`/`defaultNotificationsConfig`:
```ts
type ChannelConfig = { enabled: boolean };
type NotificationsConfig = {
  reminderLeadDays: number;
  banner: ChannelConfig;
  toast: ChannelConfig;
  popup: ChannelConfig;
  birthday: ChannelConfig;
};
const defaultNotificationsConfig: NotificationsConfig = {
  reminderLeadDays: 7,
  banner: { enabled: true }, toast: { enabled: true }, popup: { enabled: true }, birthday: { enabled: true },
};
```
Simplify `NotificationRow` to a toggle only: `config: ChannelConfig`; remove the `thresholdWorkDays` number input and the `notifThreshold`/`notifThresholdSuffix` spans. In the notifications section, add ONE "Days ahead" input above the rows:
```tsx
<label className="mb-2 flex items-center justify-between gap-2 text-sm text-zinc-700 dark:text-zinc-300">
  {t(lang, "reminderLeadDays")}
  <input type="number" min={0} max={365}
    value={settings.notifications.reminderLeadDays}
    onChange={(e) => onChange({ ...settings, notifications: { ...settings.notifications, reminderLeadDays: Math.max(0, Math.min(365, Math.round(Number(e.target.value) || 0))) } })}
    className="w-20 rounded-md border border-zinc-300 px-2 py-1 text-right tabular-nums dark:border-zinc-700 dark:bg-zinc-900" />
</label>
```
The Phase-5 birthday control drops its `leadDays` number input — keep only the enable toggle.

- [ ] **Step 5: i18n.** Add `reminderLeadDays: "Days ahead"` (de "Tage im Voraus") to `i18n.ts`/`i18n.de.ts`. (`notifThreshold`/`notifThresholdSuffix`/`birthdayLeadDays` become unused — harmless to leave.)

- [ ] **Step 6: Migration** (`use-settings.ts`). Add:
```ts
function migrateNotifications(raw: unknown): Settings["notifications"] {
  const p = (isPlainObject(raw) ? raw : {}) as Record<string, unknown>;
  const pick = (v: unknown) => (isPlainObject(v) ? (v as Record<string, unknown>) : {});
  const ch = (v: unknown) => ({ enabled: isPlainObject(v) ? (v as { enabled?: unknown }).enabled !== false : true });
  const lead = Number(p.reminderLeadDays ?? pick(p.birthday).leadDays ?? pick(p.banner).thresholdWorkDays);
  return {
    reminderLeadDays: Number.isFinite(lead) && lead >= 0 ? lead : 7,
    banner: ch(p.banner), toast: ch(p.toast), popup: ch(p.popup), birthday: ch(p.birthday),
  };
}
```
Replace the `notifications: { ...defaultSettings.notifications, ...(isPlainObject(parsed.notifications) ? parsed.notifications : {}) }` line with `notifications: migrateNotifications(parsed.notifications),`.

- [ ] **Step 7: Call sites** (`task-manager.tsx`).
  - `bannerItems` memo → `getAlertableTasks(tasks, settings.notifications.reminderLeadDays, today, holidaySet, absences)`; deps `[tasks, settings.notifications.reminderLeadDays, today, holidaySet, absences]`.
  - The other `getAlertableTasks(...)` call (dueModalItems) → same new args + deps.
  - `birthdayItems` memo → `settings.notifications.birthday.enabled ? getUpcomingBirthdays(resources, today, settings.notifications.reminderLeadDays, holidaySet, absences) : []`; deps include `settings.notifications.reminderLeadDays`, `settings.notifications.birthday`, `holidaySet`, `absences`.
  - `useDueAlerts({...})` → add `absences`; `useBirthdayAlerts({...})` → add `holidaySet` + `absences`. (`absences`/`holidaySet` already in scope.)

- [ ] **Step 8: Hooks.**
  - `use-due-alerts.ts`: add `absences: Absence[]` to `UseDueAlertsArgs` (import `Absence` from `./types`); both `getAlertableTasks(...)` calls become `getAlertableTasks(tasks, settingsRef.current.notifications.reminderLeadDays, todayRef.current, holidaySet, absences)`; keep the `toast`/`popup` `.enabled` gating (`settingsRef.current.notifications.toast.enabled` etc.).
  - `use-birthday-alerts.ts`: add `holidaySet: Set<string>` + `absences: Absence[]` to `UseBirthdayAlertsArgs`; the call becomes `getUpcomingBirthdays(resources, todayRef.current, settingsRef.current.notifications.reminderLeadDays, holidaySet, absences)`.

- [ ] **Step 9: Update remaining tests/fixtures.**
  - `use-due-alerts.test.ts` / `use-birthday-alerts.test.tsx`: pass the new args; `notifications` fixtures use the new shape (`reminderLeadDays` + `{enabled}` channels).
  - `settings-menu.test.tsx`: simplified `NotificationRow` (no threshold) + new `reminderLeadDays`.
  - `use-chat-dispatcher.test.tsx` and any other inline `notifications` fixture: new shape.
  - Grep `thresholdWorkDays` and `notifications.birthday` / `leadDays` across `src/app/*.test.*` and fix all.

- [ ] **Step 10: Verify.** `npx tsc --noEmit` clean; `npx vitest run` green (only the known `use-holiday-set` flake acceptable). If tsc flags a missed `thresholdWorkDays`/`leadDays` reader, grep `thresholdWorkDays` and `notifications.birthday.leadDays` across `src/app` and fix.

- [ ] **Step 11: Commit.**
```bash
git add src/app/settings-menu.tsx src/app/use-settings.ts src/app/due-dates.ts src/app/due-dates.test.ts src/app/birthdays.ts src/app/birthdays.test.ts src/app/use-due-alerts.ts src/app/use-due-alerts.test.ts src/app/use-birthday-alerts.ts src/app/use-birthday-alerts.test.tsx src/app/task-manager.tsx src/app/settings-menu.test.tsx src/app/use-chat-dispatcher.test.tsx src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat(reminders): unified reminderLeadDays + working-day-shifted trigger"
```

---

## Self-Review

**Spec coverage (Phase B):** unified `reminderLeadDays` replacing per-channel `thresholdWorkDays` + `birthday.leadDays` (Steps 4,6) ✓; settings UI one "Days ahead" + toggles (Step 4) ✓; migration (Step 6) ✓; working-day shift over weekend/holiday/absence, Sat→Fri/Sun→Fri (Task 1) ✓; "soon" = today ≥ shifted trigger, overdue/today unchanged (Step 2) ✓; birthday upcoming = today ≥ shifted trigger (Step 3) ✓; non-working day = weekend ∪ holiday ∪ subject absences via `absenceDayMap` keyed by assignee/display name (Task 1 + Steps 2,3) ✓; call sites + hooks pass `reminderLeadDays`/`holidaySet`/`absences` (Steps 7,8) ✓.

**Placeholder scan:** Step 9's "grep and fix all fixtures" is a concrete sweep against a fully-specified shape, not a vague placeholder. All function bodies shown in full.

**Type consistency:** `getAlertableTasks(tasks, reminderLeadDays, today, holidays, absences)` and `getUpcomingBirthdays(resources, today, leadDays, holidays, absences)` used identically in due-dates/birthdays, the hooks, and task-manager. `NotificationsConfig` (reminderLeadDays + four `{enabled}` channels) consistent across settings/default/migration/UI/readers. `shiftToWorkingDay`/`absenceDayMap`/`isoAddDays` signatures consistent between Task 1 and Task 2.

**Out of scope:** banner snooze (Phase C). Overdue/today categorization unchanged. Per-channel `enabled` gating preserved as-is.
