# Resource Address Book — Phase 5 (Birthday Reminders) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Remind about resource birthdays — a **top banner** (beside the overdue banner) and a **load-time toast**, driven by a configurable lead-time setting (`settings.notifications.birthday = { enabled, leadDays }`, default `{ true, 7 }`) and a pure `getUpcomingBirthdays` helper that handles year-wrap.

**Architecture:** Pure `birthdays.ts#getUpcomingBirthdays(resources, today, leadDays)` → sorted upcoming list with `daysUntil`. `BirthdayBanner` + `birthdayToastText` live in `notifications.tsx` (mirroring `DueBanner`/`dueAlertsToastText`). `useBirthdayAlerts` mirrors `useDueAlerts` (toast once per session, dismissable banner flag). `task-manager.tsx` computes `birthdayItems`, wires the hook, and renders `<BirthdayBanner>` directly below the overdue `<DueBanner>` (both gated `!isPopout`). Settings gain a birthday row. All banner/toast UI is gated `!isPopout`.

**Tech Stack:** TypeScript, Next.js 16, React 19, Tailwind v4, Vitest + RTL. Source `src/app/`.

**Source spec:** [`../specs/2026-05-24-resource-address-book-design.md`](../specs/2026-05-24-resource-address-book-design.md) — Phase 5 of 5 (final).

---

### Task 1: Pure helper `getUpcomingBirthdays`

**Files:** Create `src/app/birthdays.ts`, `src/app/birthdays.test.ts`.

- [ ] **Step 1: Failing tests** `src/app/birthdays.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { getUpcomingBirthdays } from "./birthdays";
import type { Resource } from "./types";
const r = (id: number, firstName: string, lastName: string, birthday?: string): Resource =>
  ({ id, firstName, lastName, birthday, roleId: null, utilizationMode: "percent", utilization: {} });

describe("getUpcomingBirthdays", () => {
  it("includes a birthday today with daysUntil 0", () => {
    const out = getUpcomingBirthdays([r(1, "A", "B", "06-15")], "2026-06-15", 7);
    expect(out).toHaveLength(1);
    expect(out[0].daysUntil).toBe(0);
  });
  it("includes a birthday within the lead window", () => {
    const out = getUpcomingBirthdays([r(1, "A", "B", "06-20")], "2026-06-15", 7);
    expect(out[0].daysUntil).toBe(5);
  });
  it("excludes a birthday beyond the lead window", () => {
    expect(getUpcomingBirthdays([r(1, "A", "B", "06-25")], "2026-06-15", 7)).toHaveLength(0);
  });
  it("excludes a birthday that already passed this year (until it wraps)", () => {
    expect(getUpcomingBirthdays([r(1, "A", "B", "06-10")], "2026-06-15", 7)).toHaveLength(0);
  });
  it("handles year-wrap (Dec → Jan)", () => {
    const out = getUpcomingBirthdays([r(1, "A", "B", "01-02")], "2026-12-30", 7);
    expect(out).toHaveLength(1);
    expect(out[0].daysUntil).toBe(3);
  });
  it("skips missing or invalid birthdays", () => {
    expect(getUpcomingBirthdays([r(1, "A", "B"), r(2, "C", "D", "13-40")], "2026-06-15", 7)).toHaveLength(0);
  });
  it("sorts by daysUntil ascending", () => {
    const out = getUpcomingBirthdays([r(1, "A", "B", "06-20"), r(2, "C", "D", "06-16")], "2026-06-15", 7);
    expect(out.map((b) => b.resource.id)).toEqual([2, 1]);
  });
  it("returns [] for an unparseable today", () => {
    expect(getUpcomingBirthdays([r(1, "A", "B", "06-15")], "nope", 7)).toHaveLength(0);
  });
});
```
Run → FAIL.

- [ ] **Step 2: Implement `src/app/birthdays.ts`:**
```ts
import type { Resource } from "./types";

export interface UpcomingBirthday {
  resource: Resource;
  /** Whole days from `today` to the next occurrence of the birthday (0 = today). */
  daysUntil: number;
}

const MS_PER_DAY = 86_400_000;

/**
 * Resources whose `MM-DD` birthday falls within `[today, today + leadDays]`
 * (inclusive), handling year-wrap (e.g. today 12-30, birthday 01-02). Invalid
 * or missing birthdays are skipped. Sorted by `daysUntil` ascending.
 * `today` is "YYYY-MM-DD"; comparisons are in UTC.
 */
export function getUpcomingBirthdays(
  resources: readonly Resource[],
  today: string,
  leadDays: number,
): UpcomingBirthday[] {
  const base = new Date(`${today}T00:00:00Z`);
  if (Number.isNaN(base.valueOf()) || leadDays < 0) return [];
  const baseMs = base.valueOf();
  const year = base.getUTCFullYear();

  const out: UpcomingBirthday[] = [];
  for (const r of resources) {
    const m = (r.birthday ?? "").match(/^(\d{2})-(\d{2})$/);
    if (!m) continue;
    const mm = Number(m[1]);
    const dd = Number(m[2]);
    if (mm < 1 || mm > 12 || dd < 1 || dd > 31) continue;
    let occ = Date.UTC(year, mm - 1, dd);
    if (occ < baseMs) occ = Date.UTC(year + 1, mm - 1, dd);
    const daysUntil = Math.round((occ - baseMs) / MS_PER_DAY);
    if (daysUntil >= 0 && daysUntil <= leadDays) out.push({ resource: r, daysUntil });
  }
  out.sort((a, b) => a.daysUntil - b.daysUntil);
  return out;
}
```
Run tests → PASS. `npx tsc --noEmit` clean.

- [ ] **Step 3: Commit**
```bash
git add src/app/birthdays.ts src/app/birthdays.test.ts
git commit -m "feat(resources): pure getUpcomingBirthdays helper (year-wrap aware)"
```

---

### Task 2: Settings + BirthdayBanner + toast + useBirthdayAlerts + wiring

**Files:**
- Modify: `src/app/settings-menu.tsx` (config type + default + UI row), `src/app/notifications.tsx` (`BirthdayBanner` + `birthdayToastText`), `src/app/task-manager.tsx` (items + hook + render), `src/app/i18n.ts`, `src/app/i18n.de.ts`
- Create: `src/app/use-birthday-alerts.ts`, `src/app/use-birthday-alerts.test.tsx`, and a `BirthdayBanner` test (extend `notifications.test.tsx`, or create it)

- [ ] **Step 1: Settings config.** In `src/app/settings-menu.tsx`:
  - Add to `NotificationsConfig`: `birthday: { enabled: boolean; leadDays: number };`
  - Add to `defaultNotificationsConfig`: `birthday: { enabled: true, leadDays: 7 },`
  - In the notifications section (after the popup `NotificationRow`, ~line 326), add a dedicated birthday control (NOT `NotificationRow`, which uses `thresholdWorkDays`). A toggle + a number input bound to `leadDays`:
```tsx
<div className="mt-2 flex items-center justify-between gap-3">
  <label className="flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
    <input
      type="checkbox"
      checked={settings.notifications.birthday.enabled}
      onChange={(e) =>
        onChange({ ...settings, notifications: { ...settings.notifications, birthday: { ...settings.notifications.birthday, enabled: e.target.checked } } })
      }
    />
    {t(lang, "notifBirthday")}
  </label>
  <label className="flex items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400">
    {t(lang, "birthdayLeadDays")}
    <input
      type="number" min={0} max={365}
      value={settings.notifications.birthday.leadDays}
      onChange={(e) =>
        onChange({ ...settings, notifications: { ...settings.notifications, birthday: { ...settings.notifications.birthday, leadDays: Math.max(0, Number(e.target.value) || 0) } } })
      }
      className="w-16 rounded border border-zinc-300 px-1.5 py-0.5 text-right tabular-nums dark:border-zinc-700 dark:bg-zinc-900"
    />
  </label>
</div>
```
  (Old persisted settings gain `birthday` automatically via the `notifications: { ...defaultNotificationsConfig, ...parsed.notifications }` merge in `use-settings.ts` — no migration code needed.)

- [ ] **Step 2: i18n keys.** Add to `i18n.ts` (en-US + en-GB if separate) and `i18n.de.ts`:
```
notifBirthday: "Birthday reminders"      // de: "Geburtstagserinnerungen"
birthdayLeadDays: "Days ahead"           // de: "Tage im Voraus"
birthdayBannerAria: "Upcoming birthdays" // de: "Bevorstehende Geburtstage"
birthdayBannerTitle: "{0} upcoming birthday(s)"   // de: "{0} bevorstehende Geburtstage"
birthdayToday: "today"                   // de: "heute"
birthdayInDays: "in {0}d"                // de: "in {0} T"
birthdayToast: "🎂 {0} upcoming birthday(s)"      // de: "🎂 {0} bevorstehende Geburtstage"
```
(Reuse the existing `alertBannerDismiss` key for the dismiss button.) Match the `t(lang, key, ...args)` positional-interpolation style already used by `alertBannerTitle`.

- [ ] **Step 3: `BirthdayBanner` + `birthdayToastText` in `src/app/notifications.tsx`.** Mirror `DueBanner` styling (the `bg-AIPM-pink/10` card) but with a 🎂 glyph and no "open list" button — just a summary + dismiss. Import `resourceDisplayName` from `./resource-foundation` and the `UpcomingBirthday` type from `./birthdays`.
```tsx
export function birthdayToastText(items: UpcomingBirthday[], lang: Lang): string {
  return t(lang, "birthdayToast", items.length);
}

export function BirthdayBanner({
  items, lang, onDismiss,
}: { items: UpcomingBirthday[]; lang: Lang; onDismiss: () => void }) {
  if (items.length === 0) return null;
  const summary = items
    .map((b) => `${resourceDisplayName(b.resource)} (${b.daysUntil === 0 ? t(lang, "birthdayToday") : t(lang, "birthdayInDays", b.daysUntil)})`)
    .join(", ");
  return (
    <div role="region" aria-label={t(lang, "birthdayBannerAria")}
      className="mb-6 flex flex-wrap items-center gap-3 rounded-lg border border-AIPM-pink/40 bg-AIPM-pink/10 px-4 py-3 dark:border-AIPM-pink/60 dark:bg-AIPM-pink/15">
      <span aria-hidden className="text-lg">🎂</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey">{t(lang, "birthdayBannerTitle", items.length)}</p>
        <p className="text-xs text-AIPM-dark-grey dark:text-AIPM-medium-grey">{summary}</p>
      </div>
      <button type="button" onClick={onDismiss} aria-label={t(lang, "alertBannerDismiss")}
        className="rounded-md border border-AIPM-medium-grey/40 bg-white px-3 py-1.5 text-xs font-medium text-AIPM-dark-grey hover:bg-AIPM-light-grey dark:border-zinc-700 dark:bg-zinc-900 dark:text-AIPM-medium-grey">
        {t(lang, "alertBannerDismiss")}
      </button>
    </div>
  );
}
```
Add `import type { UpcomingBirthday } from "./birthdays";` and `import { resourceDisplayName } from "./resource-foundation";` at the top (check `Lang`/`t` already imported).

- [ ] **Step 4: `src/app/use-birthday-alerts.ts`** — mirror `use-due-alerts.ts`:
```ts
"use client";
import { type Dispatch, type SetStateAction, useEffect, useRef, useState } from "react";
import { getUpcomingBirthdays } from "./birthdays";
import { birthdayToastText } from "./notifications";
import type { Settings } from "./settings-menu";
import type { Resource } from "./types";

export interface UseBirthdayAlertsArgs {
  hydrated: boolean;
  resources: Resource[];
  today: string;
  settings: Settings;
  showToast: (kind: "info" | "error", text: string) => void;
}

export function useBirthdayAlerts({
  hydrated, resources, today, settings, showToast,
}: UseBirthdayAlertsArgs): {
  birthdayDismissed: boolean;
  setBirthdayDismissed: Dispatch<SetStateAction<boolean>>;
} {
  const [birthdayDismissed, setBirthdayDismissed] = useState(false);
  const notifiedThisSessionRef = useRef(false);
  const settingsRef = useRef(settings);
  useEffect(() => { settingsRef.current = settings; }, [settings]);
  const todayRef = useRef(today);
  useEffect(() => { todayRef.current = today; }, [today]);

  useEffect(() => {
    if (!hydrated || notifiedThisSessionRef.current) return;
    if (resources.length === 0) return;
    const cfg = settingsRef.current.notifications.birthday;
    if (!cfg.enabled) return;
    notifiedThisSessionRef.current = true;
    const items = getUpcomingBirthdays(resources, todayRef.current, cfg.leadDays);
    const lang = settingsRef.current.language;
    void Promise.resolve().then(() => {
      if (items.length > 0) showToast("info", birthdayToastText(items, lang));
    });
  }, [hydrated, resources, showToast]);

  return { birthdayDismissed, setBirthdayDismissed };
}
```

- [ ] **Step 5: Wire `task-manager.tsx`.**
  - Import `getUpcomingBirthdays` from `./birthdays`, `BirthdayBanner` from `./notifications`, `useBirthdayAlerts` from `./use-birthday-alerts`. Ensure `resources` is destructured from `useWorkspace()` (add it if not already pulled).
  - Add `birthdayItems` memo near `bannerItems`:
```tsx
const birthdayItems = useMemo(
  () => settings.notifications.birthday.enabled
    ? getUpcomingBirthdays(resources, today, settings.notifications.birthday.leadDays)
    : [],
  [resources, settings.notifications.birthday, today],
);
```
  - Wire the hook near `useDueAlerts(...)`:
```tsx
const { birthdayDismissed, setBirthdayDismissed } = useBirthdayAlerts({ hydrated, resources, today, settings, showToast });
```
  - Render `<BirthdayBanner>` directly AFTER the existing `{!isPopout && !bannerDismissed && (<DueBanner .../>)}` block:
```tsx
{!isPopout && !birthdayDismissed && birthdayItems.length > 0 && (
  <BirthdayBanner items={birthdayItems} lang={lang} onDismiss={() => setBirthdayDismissed(true)} />
)}
```

- [ ] **Step 6: Tests.**
  - `src/app/use-birthday-alerts.test.tsx`: render the hook (mirror `use-due-alerts.test.ts` if it exists, else a minimal `renderHook` with a fake `showToast`). Assert: a toast fires once when `enabled` + an upcoming birthday exists; does NOT fire when `enabled: false`; does NOT fire when there are no upcoming birthdays. Behavior-based; build a `Settings` via `defaultSettings` with `notifications.birthday` set.
  - `BirthdayBanner` render test (in `notifications.test.tsx`, create if absent): renders the summary + fires `onDismiss`; renders nothing when `items` is empty.

- [ ] **Step 7: Verify** — `npx tsc --noEmit` clean; `npx vitest run` green (only the known `use-holiday-set` flake acceptable).

- [ ] **Step 8: Commit**
```bash
git add src/app/settings-menu.tsx src/app/notifications.tsx src/app/use-birthday-alerts.ts src/app/use-birthday-alerts.test.tsx src/app/task-manager.tsx src/app/i18n.ts src/app/i18n.de.ts src/app/notifications.test.tsx
git commit -m "feat(resources): birthday banner + load-time toast with configurable lead time"
```

---

## Self-Review

**Spec coverage (Phase 5):** pure `getUpcomingBirthdays` with year-wrap (Task 1) ✓; `settings.notifications.birthday = { enabled, leadDays }` default `{true,7}` + settings control + auto-migration (Task 2 Step 1) ✓; top `BirthdayBanner` below the overdue banner, gated `!isPopout` (Step 5) ✓; load-time toast once per session via `useBirthdayAlerts` (Steps 4–5) ✓; i18n en/de (Step 2) ✓.

**Placeholder scan:** all code shown; Step 6 references mirroring `use-due-alerts.test.ts` — the concrete harness reference in-repo.

**Type consistency:** `UpcomingBirthday` defined in Task 1, consumed by `BirthdayBanner`/`birthdayToastText`/`useBirthdayAlerts`. `notifications.birthday: { enabled, leadDays }` used identically in settings default, the settings UI, the `birthdayItems` memo, and the hook. Banner render mirrors the `DueBanner` block.

**Completes the feature** — after this, all 5 phases are done; recommend a final cross-cutting review before merge.
