# Phase C — Persisted Reminder Snooze — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`).

**Goal:** Both reminder banners (due-date + birthday) gain a **Snooze ▾** control (In 1 hour / In 1 day) next to Dismiss. Snooze persists across reloads (localStorage `snoozedUntil` per kind), hides the banner + suppresses the load toast until it elapses, then the banner reappears automatically.

**Architecture:** `reminder-snooze.ts` stores a per-kind `snoozedUntil` epoch in localStorage. `useReminderSnooze(kind)` exposes `{ isSnoozed, snooze, clear }` and re-shows via a timer. Banners get an `onSnooze` prop + a `SnoozeMenu`. `task-manager` gates each banner on `!isSnoozed` and passes `onSnooze`. The alert hooks skip the load toast while snoozed.

**Tech Stack:** TypeScript, Next.js 16, React 19, Tailwind v4, Vitest + RTL. Source `src/app/`.

**Source spec:** [`../specs/2026-05-25-task-form-contact-and-reminder-snooze-design.md`](../specs/2026-05-25-task-form-contact-and-reminder-snooze-design.md) — Phase C of 3.

---

### Task 1: Snooze store + hook

**Files:** Create `src/app/reminder-snooze.ts`, `src/app/reminder-snooze.test.ts`, `src/app/use-reminder-snooze.ts`, `src/app/use-reminder-snooze.test.tsx`.

- [ ] **Step 1: Failing test** `src/app/reminder-snooze.test.ts`:
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { getSnoozedUntil, setSnoozedUntil, clearSnooze, SNOOZE_1H, SNOOZE_1D } from "./reminder-snooze";

describe("reminder-snooze store", () => {
  beforeEach(() => window.localStorage.clear());
  it("returns null when nothing is stored", () => {
    expect(getSnoozedUntil("due")).toBeNull();
  });
  it("round-trips a snoozedUntil epoch per kind", () => {
    setSnoozedUntil("due", 1_000_000);
    expect(getSnoozedUntil("due")).toBe(1_000_000);
    expect(getSnoozedUntil("birthday")).toBeNull();
  });
  it("clearSnooze removes the value", () => {
    setSnoozedUntil("birthday", 1_000_000);
    clearSnooze("birthday");
    expect(getSnoozedUntil("birthday")).toBeNull();
  });
  it("returns null for invalid stored values", () => {
    window.localStorage.setItem("lop-app:reminder-snooze:due", "nope");
    expect(getSnoozedUntil("due")).toBeNull();
  });
  it("exposes hour + day durations", () => {
    expect(SNOOZE_1H).toBe(60 * 60 * 1000);
    expect(SNOOZE_1D).toBe(24 * 60 * 60 * 1000);
  });
});
```
Run `npx vitest run src/app/reminder-snooze.test.ts` → FAIL.

- [ ] **Step 2: Implement `src/app/reminder-snooze.ts`:**
```ts
export type ReminderKind = "due" | "birthday";

export const SNOOZE_1H = 60 * 60 * 1000;
export const SNOOZE_1D = 24 * 60 * 60 * 1000;

const KEY = (k: ReminderKind) => `lop-app:reminder-snooze:${k}`;

/** Epoch ms the reminder is snoozed until, or null when not snoozed/invalid. */
export function getSnoozedUntil(kind: ReminderKind): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(KEY(kind));
    if (raw == null) return null;
    const v = Number(raw);
    return Number.isFinite(v) && v > 0 ? v : null;
  } catch {
    return null;
  }
}

export function setSnoozedUntil(kind: ReminderKind, untilMs: number): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(KEY(kind), String(untilMs));
  } catch {
    /* quota / disabled — non-fatal */
  }
}

export function clearSnooze(kind: ReminderKind): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(KEY(kind));
  } catch {
    /* non-fatal */
  }
}
```
Run tests → PASS.

- [ ] **Step 3: Failing test** `src/app/use-reminder-snooze.test.tsx`:
```tsx
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useReminderSnooze } from "./use-reminder-snooze";
import { SNOOZE_1H, getSnoozedUntil } from "./reminder-snooze";

describe("useReminderSnooze", () => {
  beforeEach(() => { window.localStorage.clear(); vi.useFakeTimers(); });
  afterEach(() => vi.useRealTimers());

  it("is not snoozed initially", () => {
    const { result } = renderHook(() => useReminderSnooze("due"));
    expect(result.current.isSnoozed).toBe(false);
  });
  it("becomes snoozed after snooze() and persists", () => {
    const { result } = renderHook(() => useReminderSnooze("due"));
    act(() => result.current.snooze(SNOOZE_1H));
    expect(result.current.isSnoozed).toBe(true);
    expect(getSnoozedUntil("due")).toBeGreaterThan(Date.now());
  });
  it("auto-clears (re-shows) after the duration elapses", () => {
    const { result } = renderHook(() => useReminderSnooze("due"));
    act(() => result.current.snooze(SNOOZE_1H));
    act(() => { vi.advanceTimersByTime(SNOOZE_1H + 1000); });
    expect(result.current.isSnoozed).toBe(false);
  });
  it("clear() unsnoozes immediately", () => {
    const { result } = renderHook(() => useReminderSnooze("due"));
    act(() => result.current.snooze(SNOOZE_1H));
    act(() => result.current.clear());
    expect(result.current.isSnoozed).toBe(false);
  });
});
```
Run → FAIL.

- [ ] **Step 4: Implement `src/app/use-reminder-snooze.ts`:**
```ts
"use client";
import { useCallback, useEffect, useState } from "react";
import {
  type ReminderKind,
  clearSnooze,
  getSnoozedUntil,
  setSnoozedUntil,
} from "./reminder-snooze";

export function useReminderSnooze(kind: ReminderKind): {
  isSnoozed: boolean;
  snoozedUntil: number | null;
  snooze: (durationMs: number) => void;
  clear: () => void;
} {
  const [snoozedUntil, setSnoozedUntilState] = useState<number | null>(() => getSnoozedUntil(kind));

  // Re-show automatically when the snooze elapses (no reload needed).
  useEffect(() => {
    if (snoozedUntil == null) return;
    const remaining = snoozedUntil - Date.now();
    if (remaining <= 0) {
      setSnoozedUntilState(null);
      clearSnooze(kind);
      return;
    }
    const timer = setTimeout(() => {
      setSnoozedUntilState(null);
      clearSnooze(kind);
    }, remaining);
    return () => clearTimeout(timer);
  }, [snoozedUntil, kind]);

  const snooze = useCallback((durationMs: number) => {
    const until = Date.now() + durationMs;
    setSnoozedUntil(kind, until);
    setSnoozedUntilState(until);
  }, [kind]);

  const clear = useCallback(() => {
    clearSnooze(kind);
    setSnoozedUntilState(null);
  }, [kind]);

  const isSnoozed = snoozedUntil != null && Date.now() < snoozedUntil;
  return { isSnoozed, snoozedUntil, snooze, clear };
}
```
Run tests → PASS. `npx tsc --noEmit` clean.

- [ ] **Step 5: Commit**
```bash
git add src/app/reminder-snooze.ts src/app/reminder-snooze.test.ts src/app/use-reminder-snooze.ts src/app/use-reminder-snooze.test.tsx
git commit -m "feat(reminders): persisted snooze store + useReminderSnooze hook"
```

---

### Task 2: Snooze control on banners + wiring + toast suppression

**Files:** Modify `src/app/notifications.tsx`, `src/app/notifications.test.tsx`, `src/app/i18n.ts`, `src/app/i18n.de.ts`, `src/app/task-manager.tsx`, `src/app/use-due-alerts.ts`, `src/app/use-birthday-alerts.ts`.

- [ ] **Step 1: i18n keys.** Add to `i18n.ts` (en-US + en-GB if separate) and `i18n.de.ts`:
```
reminderSnooze: "Snooze"            // de: "Erinnern"
reminderSnooze1h: "In 1 hour"       // de: "In 1 Stunde"
reminderSnooze1d: "In 1 day"        // de: "In 1 Tag"
```

- [ ] **Step 2: `SnoozeMenu` + `onSnooze` on both banners** (`notifications.tsx`). Add `import { SNOOZE_1H, SNOOZE_1D } from "./reminder-snooze";`. Add a shared subcomponent:
```tsx
function SnoozeMenu({ lang, onSnooze }: { lang: Lang; onSnooze: (ms: number) => void }) {
  return (
    <details className="relative">
      <summary className="cursor-pointer list-none rounded-md border border-AIPM-medium-grey/40 bg-white px-3 py-1.5 text-xs font-medium text-AIPM-dark-grey hover:bg-AIPM-light-grey dark:border-zinc-700 dark:bg-zinc-900 dark:text-AIPM-medium-grey">
        {t(lang, "reminderSnooze")} ▾
      </summary>
      <div className="absolute right-0 z-10 mt-1 flex flex-col rounded-md border border-zinc-200 bg-white py-1 shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
        <button type="button" onClick={() => onSnooze(SNOOZE_1H)}
          className="whitespace-nowrap px-3 py-1.5 text-left text-xs text-AIPM-dark-grey hover:bg-AIPM-light-grey dark:text-AIPM-light-grey dark:hover:bg-zinc-800">
          {t(lang, "reminderSnooze1h")}
        </button>
        <button type="button" onClick={() => onSnooze(SNOOZE_1D)}
          className="whitespace-nowrap px-3 py-1.5 text-left text-xs text-AIPM-dark-grey hover:bg-AIPM-light-grey dark:text-AIPM-light-grey dark:hover:bg-zinc-800">
          {t(lang, "reminderSnooze1d")}
        </button>
      </div>
    </details>
  );
}
```
Add `onSnooze: (ms: number) => void` to BOTH `DueBanner`'s and `BirthdayBanner`'s prop types + destructure, and render `<SnoozeMenu lang={lang} onSnooze={onSnooze} />` in each banner's button row (DueBanner: inside the `<div className="flex gap-2">` before the Dismiss button; BirthdayBanner: wrap its Dismiss button + the menu in a `flex gap-2` row). The open `<details>` disappears with the banner when snoozed, so no manual close is needed.

- [ ] **Step 3: Banner snooze test** (`notifications.test.tsx`). Add:
```tsx
import { SNOOZE_1H, SNOOZE_1D } from "./reminder-snooze";
import { DueBanner } from "./notifications";
// ...
it("DueBanner fires onSnooze with the chosen duration", () => {
  const onSnooze = vi.fn();
  const items = [{ task: { id: 1, taskName: "T", dueDate: "2026-12-31" } as any, category: "soon" as const, workDaysLeft: 1 }];
  render(<DueBanner items={items as any} lang="en-US" onOpenList={vi.fn()} onDismiss={vi.fn()} onSnooze={onSnooze} />);
  fireEvent.click(screen.getByRole("button", { name: /in 1 hour/i }));
  expect(onSnooze).toHaveBeenCalledWith(SNOOZE_1H);
  fireEvent.click(screen.getByRole("button", { name: /in 1 day/i }));
  expect(onSnooze).toHaveBeenCalledWith(SNOOZE_1D);
});
```
Also add `onSnooze={vi.fn()}` to any existing `BirthdayBanner` render in this test file, and a parallel BirthdayBanner snooze assertion. Run → FAIL, then PASS after Step 2.

- [ ] **Step 4: Wire `task-manager.tsx`.** Add `import { useReminderSnooze } from "./use-reminder-snooze";`. Near the `useDueAlerts`/`useBirthdayAlerts` calls:
```ts
const dueSnooze = useReminderSnooze("due");
const birthdaySnooze = useReminderSnooze("birthday");
```
Update the banner renders:
```tsx
{!isPopout && !bannerDismissed && !dueSnooze.isSnoozed && (
  <DueBanner
    items={bannerItems}
    lang={lang}
    onOpenList={() => setDueModalOpen(true)}
    onDismiss={() => setBannerDismissed(true)}
    onSnooze={dueSnooze.snooze}
  />
)}

{!isPopout && !birthdaySnooze.isSnoozed && !birthdayDismissed && birthdayItems.length > 0 && (
  <BirthdayBanner items={birthdayItems} lang={lang} onDismiss={() => setBirthdayDismissed(true)} onSnooze={birthdaySnooze.snooze} />
)}
```

- [ ] **Step 5: Toast suppression in hooks.**
  - `use-due-alerts.ts`: `import { getSnoozedUntil } from "./reminder-snooze";`. In the one-shot effect (after the early returns), compute `const u = getSnoozedUntil("due"); const snoozed = u != null && Date.now() < u;` and gate BOTH `toastCfg.enabled` / `popupCfg.enabled` branches with `&& !snoozed`.
  - `use-birthday-alerts.ts`: `import { getSnoozedUntil } from "./reminder-snooze";`. In the one-shot effect, after the `cfg.enabled` check, add: `const u = getSnoozedUntil("birthday"); if (u != null && Date.now() < u) { notifiedThisSessionRef.current = true; return; }` (set the ref so it doesn't re-check every render).

- [ ] **Step 6: Verify.** `npx tsc --noEmit` clean; `npx vitest run` green (only the known `use-holiday-set` flake acceptable; re-run alone to confirm if it appears).

- [ ] **Step 7: Commit**
```bash
git add src/app/notifications.tsx src/app/notifications.test.tsx src/app/i18n.ts src/app/i18n.de.ts src/app/task-manager.tsx src/app/use-due-alerts.ts src/app/use-birthday-alerts.ts
git commit -m "feat(reminders): snooze control on reminder banners (1h / 1d), persisted"
```

---

## Self-Review

**Spec coverage (Phase C):** persisted per-kind snooze store (Task 1) ✓; `useReminderSnooze` with auto-reshow timer (Task 1) ✓; Snooze ▾ (1h/1d) on BOTH banners next to Dismiss (Step 2) ✓; banner gated on `!isSnoozed` (Step 4) ✓; load toast suppressed while snoozed (Step 5) ✓; persists across reloads (initial state reads `getSnoozedUntil`) ✓.

**Placeholder scan:** all code shown; Step 5's birthday gate is described precisely. No vague items.

**Type consistency:** `ReminderKind = "due" | "birthday"` used in store, hook, and both `useReminderSnooze(...)` calls. `SNOOZE_1H`/`SNOOZE_1D` consistent across store/SnoozeMenu/tests. `onSnooze: (ms: number) => void` identical on both banners + the `dueSnooze.snooze`/`birthdaySnooze.snooze` passed in.

**Out of scope:** snooze for the load-time popup modal; a reminders inbox. Dismiss keeps its existing session-only behavior.
