# Supplant Reminders + Per-Action Snooze (SP3) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fold the due-alerts / RAID-review / stakeholder-comms banners+modals into the Action Center queue, add a per-action snooze store (1h/1d) feeding the engine's `dismissed` set, and repoint the header bell to the Action Center.

**Architecture:** A pure `action-snooze.ts` store (localStorage actionId→untilMs) + a `useActionSnooze` hook supply the `dismissed` set the SP1 engine already filters. `ActionRow` gains a snooze menu. The three reminder surfaces (banners + modals) and `use-due-alerts.ts` are deleted; `use-stakeholder-comms`'s `items` computation is kept (the Action Center consumes it).

**Tech Stack:** Next.js 16, React 19, TS, Tailwind v4, Vitest 4 + Testing Library.

**Spec:** `docs/superpowers/specs/2026-06-13-supplant-reminders-design.md`

**Pinned facts (verified):**
- `reminder-snooze.ts` exports `ReminderKind = "due"|"birthday"|"jiraToken"|"raidReview"|"stakeholderComms"`, `SNOOZE_1H`, `SNOOZE_1D`, `getSnoozedUntil/setSnoozedUntil/clearSnooze`.
- `use-due-alerts.ts` returns `{bannerDismissed,setBannerDismissed,dueModalOpen,setDueModalOpen,raidReviewModalOpen,setRaidReviewModalOpen}` — consumed ONLY by task-manager's banners/modals → deletable.
- `use-stakeholder-comms.ts` returns `{items, bannerDismissed, setBannerDismissed, reviewModalOpen, setReviewModalOpen}` — KEEP `items`.
- task-manager: `useDueAlerts` call ~L435; five `useReminderSnooze` ~L442-447 (keep only birthday+jiraToken); `useStakeholderComms` ~L592; `nowCount` ~L651; `bannerItems` useMemo ~L967; bannersEl `DueBanner` ~L1494 / `RaidReviewBanner` ~L1522 / `StakeholderCommsBanner` ~L1531; AppModals `dueModalOpen` ~L1569; `RaidReviewModal` ~L1615 / `StakeholderCommsModal` ~L1623; classic `AppHeader` `bannerItems`/`setDueModalOpen` ~L1639; modern `TopBar` `bannerCount={bannerItems.length}` / `onShowAlerts` ~L1701; `navBadges={{actions: nowCount}}` ~L1729.
- Bell repoint is task-manager-only: pass `bannerCount={nowCount}` + `onShowAlerts={() => setActiveTab("actions")}` (`setActiveTab` from `useWorkspaceTab`). No AppHeader/TopBar internal change.
- `SuggestedAction.id` is stable (`source:entityId:reason`); engine already filters `input.dismissed` (SP1).

**Conventions:** `npx vitest run <path>`; `npx tsc --noEmit`; `npx eslint <files> --max-warnings=0`. i18n EN/DE parity, real umlauts.

---

## Task 1: i18n — add snooze keys

**Files:** Modify `src/app/i18n.ts`, `src/app/i18n.de.ts`. (Dead-key removal happens in Task 7, after the surfaces are gone.)

- [ ] **Step 1: EN** (after `snapshotNeedsTursoFirst`):
```ts
  // --- Action snooze (SP3) ---
  actionSnooze: "Snooze",
  actionSnooze1h: "1 hour",
  actionSnooze1d: "1 day",
  versionHighlightSnoozeActions: "Reminders folded into the Action Center: snooze actions (1h/1d); the due / RAID-review / stakeholder-comms banners are gone",
```
- [ ] **Step 2: DE** (real umlauts):
```ts
  // --- Aktion vertagen (SP3) ---
  actionSnooze: "Später",
  actionSnooze1h: "1 Stunde",
  actionSnooze1d: "1 Tag",
  versionHighlightSnoozeActions: "Erinnerungen ins Action Center integriert: Aktionen vertagen (1 Std./1 Tag); die Banner für Fälligkeiten / RAID-Überprüfung / Stakeholder-Kommunikation entfallen",
```
- [ ] **Step 3:** `npx tsc --noEmit && npx vitest run src/app/i18n-encoding.test.ts src/app/i18n.test.ts` → PASS.
- [ ] **Step 4: Commit** `feat: i18n keys for action snooze (EN/DE)`.

---

## Task 2: `action-snooze.ts` store

**Files:** Create `src/app/action-snooze.ts`, `src/app/action-snooze.test.ts`.

- [ ] **Step 1: Write the failing test**
```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { snoozeAction, getSnoozedActionIds, clearActionSnooze, ACTION_SNOOZE_KEY } from "./action-snooze";

describe("action-snooze", () => {
  beforeEach(() => window.localStorage.clear());
  afterEach(() => { window.localStorage.clear(); vi.restoreAllMocks(); });

  it("snoozes an action and reports it as dismissed until expiry", () => {
    snoozeAction("raid:1:severity", 1000, 10_000);
    expect(getSnoozedActionIds(10_500).has("raid:1:severity")).toBe(true);
    expect(getSnoozedActionIds(11_001).has("raid:1:severity")).toBe(false); // expired
  });
  it("prunes expired entries from the persisted store on read", () => {
    snoozeAction("a", 100, 0);
    getSnoozedActionIds(1000); // a expired → pruned
    const raw = window.localStorage.getItem(ACTION_SNOOZE_KEY);
    expect(raw === null || JSON.parse(raw).a === undefined).toBe(true);
  });
  it("clearActionSnooze removes an entry", () => {
    snoozeAction("b", 10_000, 0);
    clearActionSnooze("b");
    expect(getSnoozedActionIds(1).has("b")).toBe(false);
  });
  it("does not throw when localStorage is unavailable", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("disabled"); });
    expect(() => snoozeAction("c", 1000, 0)).not.toThrow();
    expect(getSnoozedActionIds(0)).toEqual(new Set());
  });
});
```
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Write `src/app/action-snooze.ts`**
```ts
// src/app/action-snooze.ts
//
// Per-action snooze store: actionId → snoozed-until epoch ms. Feeds the
// next-actions engine's `dismissed` set so snoozed actions drop out of the
// queue until their timer expires. localStorage-backed, fully guarded.
export const ACTION_SNOOZE_KEY = "lop-app:action-snooze";

function read(): Record<string, number> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(ACTION_SNOOZE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, number>) : {};
  } catch {
    return {};
  }
}

function write(map: Record<string, number>): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(ACTION_SNOOZE_KEY, JSON.stringify(map));
  } catch {
    /* quota / disabled — non-fatal */
  }
}

/** Snoozed action ids whose timer is still in the future. Prunes expired
 *  entries (persisting the pruned map). */
export function getSnoozedActionIds(now: number): Set<string> {
  const map = read();
  const live: Record<string, number> = {};
  let pruned = false;
  for (const [id, until] of Object.entries(map)) {
    if (typeof until === "number" && until > now) live[id] = until;
    else pruned = true;
  }
  if (pruned) write(live);
  return new Set(Object.keys(live));
}

export function snoozeAction(actionId: string, durationMs: number, now: number): void {
  const map = read();
  map[actionId] = now + durationMs;
  write(map);
}

export function clearActionSnooze(actionId: string): void {
  const map = read();
  if (actionId in map) {
    delete map[actionId];
    write(map);
  }
}

/** The next upcoming expiry > now, or null. Used to schedule a re-render. */
export function nextSnoozeExpiry(now: number): number | null {
  const future = Object.values(read()).filter((v) => typeof v === "number" && v > now);
  return future.length ? Math.min(...future) : null;
}
```
- [ ] **Step 4:** Run → PASS. tsc + eslint clean. Purity grep (no react/t(lang)).
- [ ] **Step 5: Commit** `feat: per-action snooze store`.

---

## Task 3: `useActionSnooze` hook

**Files:** Create `src/app/use-action-snooze.ts`, `src/app/use-action-snooze.test.tsx`.

- [ ] **Step 1: Write the failing test**
```tsx
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useActionSnooze } from "./use-action-snooze";
import { SNOOZE_1H } from "./reminder-snooze";

describe("useActionSnooze", () => {
  beforeEach(() => { window.localStorage.clear(); vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); window.localStorage.clear(); });

  it("adds a snoozed id to dismissed, and removes it after expiry", () => {
    const { result } = renderHook(() => useActionSnooze());
    act(() => result.current.snooze("raid:1:severity", SNOOZE_1H));
    expect(result.current.dismissed.has("raid:1:severity")).toBe(true);
    act(() => { vi.advanceTimersByTime(SNOOZE_1H + 1000); });
    expect(result.current.dismissed.has("raid:1:severity")).toBe(false);
  });
});
```
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Write `src/app/use-action-snooze.ts`**
```ts
// src/app/use-action-snooze.ts
"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { getSnoozedActionIds, snoozeAction, nextSnoozeExpiry } from "./action-snooze";

export interface UseActionSnooze {
  dismissed: ReadonlySet<string>;
  snooze: (actionId: string, durationMs: number) => void;
}

export function useActionSnooze(): UseActionSnooze {
  const [tick, setTick] = useState(0);
  const dismissed = useMemo(() => getSnoozedActionIds(Date.now()), [tick]);

  const snooze = useCallback((actionId: string, durationMs: number) => {
    snoozeAction(actionId, durationMs, Date.now());
    setTick((t) => t + 1);
  }, []);

  // Re-render when the soonest snooze expires, so the action reappears.
  useEffect(() => {
    const next = nextSnoozeExpiry(Date.now());
    if (next == null) return;
    const delay = Math.max(0, next - Date.now()) + 50;
    const timer = setTimeout(() => setTick((t) => t + 1), delay);
    return () => clearTimeout(timer);
  }, [tick]);

  return { dismissed, snooze };
}
```
- [ ] **Step 4:** Run → PASS. tsc + eslint clean.
- [ ] **Step 5: Commit** `feat: useActionSnooze hook`.

---

## Task 4: `ActionRow` snooze menu + `ActionsPanel` passthrough

**Files:** Modify `src/app/action-row.tsx`, `src/app/actions-panel.tsx`. Tests: append to `action-row.test.tsx`.

- [ ] **Step 1: Append a failing test to `action-row.test.tsx`**
```tsx
import { SNOOZE_1H, SNOOZE_1D } from "./reminder-snooze";
// ... existing imports/action fixture ...
describe("ActionRow snooze", () => {
  it("opens the snooze menu and fires onSnooze with 1h / 1d", () => {
    const onSnooze = vi.fn();
    const { getByRole } = render(<ActionRow lang="en-US" action={action} onOpen={() => {}} onSnooze={onSnooze} />);
    fireEvent.click(getByRole("button", { name: /Snooze/i }));
    fireEvent.click(getByRole("button", { name: "1 hour" }));
    expect(onSnooze).toHaveBeenCalledWith(action, SNOOZE_1H);
    fireEvent.click(getByRole("button", { name: /Snooze/i }));
    fireEvent.click(getByRole("button", { name: "1 day" }));
    expect(onSnooze).toHaveBeenCalledWith(action, SNOOZE_1D);
  });
  it("snooze menu clicks do not fire onOpen (stopPropagation)", () => {
    const onOpen = vi.fn();
    const { getByRole } = render(<ActionRow lang="en-US" action={action} onOpen={onOpen} onSnooze={() => {}} />);
    fireEvent.click(getByRole("button", { name: /Snooze/i }));
    fireEvent.click(getByRole("button", { name: "1 hour" }));
    expect(onOpen).not.toHaveBeenCalled();
  });
  it("renders no Snooze control when onSnooze is omitted", () => {
    const { queryByRole } = render(<ActionRow lang="en-US" action={action} onOpen={() => {}} />);
    expect(queryByRole("button", { name: /Snooze/i })).toBeNull();
  });
});
```
- [ ] **Step 2:** Run → FAIL.
- [ ] **Step 3: Edit `action-row.tsx`.** Add `useState` import. Extend props:
```tsx
interface ActionRowProps {
  lang: Lang;
  action: SuggestedAction;
  onOpen: (action: SuggestedAction) => void;
  onSnooze?: (action: SuggestedAction, durationMs: number) => void;
}
```
Import the snooze constants: `import { SNOOZE_1H, SNOOZE_1D } from "./reminder-snooze";`. Inside the component add `const [menuOpen, setMenuOpen] = useState(false);`. Replace the trailing `[Open]` button area with a flex container holding Open + the Snooze control:
```tsx
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onOpen(action); }}
          className="rounded-md border border-line px-3 py-1 text-xs font-medium text-AIPM-dark-blue hover:bg-surface-muted dark:text-AIPM-light-grey"
        >
          {t(lang, "actionOpen")}
        </button>
        {onSnooze && (
          <span className="relative">
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={(e) => { e.stopPropagation(); setMenuOpen((o) => !o); }}
              className="rounded-md border border-line px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-surface-muted"
            >
              {t(lang, "actionSnooze")} ▾
            </button>
            {menuOpen && (
              <span
                role="menu"
                className="absolute right-0 top-full z-20 mt-1 flex w-max flex-col rounded-md border border-line bg-surface py-1 shadow-md"
              >
                <button type="button" role="menuitem"
                  onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onSnooze(action, SNOOZE_1H); }}
                  className="px-3 py-1 text-left text-xs text-foreground hover:bg-surface-muted">
                  {t(lang, "actionSnooze1h")}
                </button>
                <button type="button" role="menuitem"
                  onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onSnooze(action, SNOOZE_1D); }}
                  className="px-3 py-1 text-left text-xs text-foreground hover:bg-surface-muted">
                  {t(lang, "actionSnooze1d")}
                </button>
              </span>
            )}
          </span>
        )}
      </div>
```
(Replace ONLY the single trailing `<button>{t(lang,"actionOpen")}</button>` with this block; keep the rest of the row unchanged. The row is a plain `onClick` div — these nested buttons are fine, all stopPropagation.)
- [ ] **Step 4: `actions-panel.tsx`** — add `onSnooze?: (action: SuggestedAction, durationMs: number) => void;` to `ActionsPanelProps`, and pass it to each `<ActionRow … onSnooze={onSnooze} />`.
- [ ] **Step 5:** Run the action-row tests + tsc + eslint (`action-row.tsx` + `actions-panel.tsx` + test) → clean.
- [ ] **Step 6: Commit** `feat: ActionRow snooze menu (1h/1d)`.

---

## Task 5: Feed snooze into task-manager (additive)

**Files:** Modify `src/app/task-manager.tsx`, `src/app/workspace-section.tsx` (thread `onSnooze` to `ActionsPanel`).

- [ ] **Step 1:** In `task-manager.tsx` add `import { useActionSnooze } from "./use-action-snooze";`. Near the other hooks: `const actionSnooze = useActionSnooze();`. In the `buildActionInput({...})` call, change `dismissed: new Set()` (or the absent dismissed → it defaults) to `dismissed: actionSnooze.dismissed`. Add the memo dep `actionSnooze.dismissed`.
- [ ] **Step 2:** Define `const snoozeAction = useCallback((a: SuggestedAction, ms: number) => actionSnooze.snooze(a.id, ms), [actionSnooze]);`. Pass it to the surfaces that should allow snoozing: thread `onSnooze={snoozeAction}` to `<WorkspaceSection>` (which forwards to `<ActionsPanel>`). Do NOT pass `onSnooze` to the dashboard widget (the dashboard Top-actions stays open-only — `ActionRow` hides the control when `onSnooze` is omitted).
- [ ] **Step 3:** In `workspace-section.tsx` add an `onSnooze?: (a: SuggestedAction, ms: number) => void` prop and pass it to `<ActionsPanel … onSnooze={onSnooze} />`.
- [ ] **Step 4: Verify** `npx tsc --noEmit && npx eslint src/app/task-manager.tsx src/app/workspace-section.tsx --max-warnings=0` → clean. Run `npx vitest run src/app/workspace-section.test.tsx` (update its props if `onSnooze` is required — it's optional, so fine). A snoozed action should drop from `nextActions` — manual smoke acceptable; record the wiring.
- [ ] **Step 5: Commit** `feat: wire per-action snooze into the Action Center`.

---

## Task 6: Remove the three reminder banners + modals + dead hooks + repoint bell

**Files:** Modify `src/app/task-manager.tsx`, `src/app/notifications.tsx`, `src/app/app-modals.tsx`, `src/app/use-stakeholder-comms.ts`, `src/app/reminder-snooze.ts`. Delete `src/app/use-due-alerts.ts` (+ its test). Update/remove the affected tests.

This is the load-bearing subtractive task — work carefully, run the full suite, and remove/update every test that asserts on the deleted surfaces.

- [ ] **Step 1: task-manager — remove the reminder UI + hooks.**
  - Delete the `useDueAlerts({...})` call (~L435) and all use of its returns (`bannerDismissed/setBannerDismissed/dueModalOpen/setDueModalOpen/raidReviewModalOpen/setRaidReviewModalOpen`).
  - Delete `const dueSnooze`, `const raidReviewSnooze`, `const stakeholderCommsSnooze` (`useReminderSnooze` calls ~L442-447). KEEP `birthdaySnooze`, `jiraTokenSnooze`.
  - Delete the `bannerItems` useMemo (~L967) and `markDone`/due-modal helpers (~L1048-1052) that only served the due modal.
  - In `bannersEl`: delete the `<DueBanner …>`, `<RaidReviewBanner …>`, `<StakeholderCommsBanner …>` blocks (~L1494/1522/1531). Keep Birthday/JiraToken/Storage/recovery banners.
  - Delete the `<RaidReviewModal …>` (~L1615) and `<StakeholderCommsModal …>` (~L1623) renders.
  - Update the `<AppModals …>` props: remove `dueModalOpen` / `onCloseDueModal` / `bannerItems` / `setDueModalOpen` (~L1569-1572, 1639-1641) — whatever the due modal needed.
  - Fix the `notifications` import (~L50) to drop `DueBanner, RaidReviewBanner, RaidReviewModal, StakeholderCommsBanner, StakeholderCommsModal` (keep `BirthdayBanner, JiraTokenBanner, StorageBanner`). Drop the `useDueAlerts` import (~L11).
- [ ] **Step 2: Repoint the bell (task-manager).** The modern `TopBar` gets `bannerCount={nowCount}` and `onShowAlerts={() => setActiveTab("actions")}` (~L1701-1702); the classic `AppHeader` similarly (`bannerItems`/`onShowAlerts` → drive from `nowCount` + navigate to `actions`). `setActiveTab` is available from `useWorkspaceTab()` (already in scope as `requestOpen`/`setActiveTab`). Keep the bell's existing icon/label.
- [ ] **Step 3: `use-stakeholder-comms.ts` — slim to items.** Remove `bannerDismissed`/`setBannerDismissed`/`reviewModalOpen`/`setReviewModalOpen` state + the snooze/toast logic; keep the `items` computation and return `{ items }`. Update the task-manager `comms = useStakeholderComms({...})` call site to use only `comms.items` (it already feeds `commsReminders`). If the hook now does nothing but compute `items` from its args, you MAY inline `getStakeholderCommsItems(...)` in task-manager and delete the hook — choose whichever is cleaner; `commsReminders` must keep flowing.
- [ ] **Step 4: `reminder-snooze.ts`** — change `ReminderKind` to `"birthday" | "jiraToken"` (drop the three). tsc will flag any remaining `useReminderSnooze("due"|...)` — there should be none after Step 1.
- [ ] **Step 5: `notifications.tsx`** — delete the components `DueBanner`, `DueDatesModal`, `RaidReviewBanner`, `RaidReviewModal`, `StakeholderCommsBanner`, `StakeholderCommsModal` and any helper functions/consts that become unused (let eslint `no-unused-vars` + tsc guide you). Keep `BirthdayBanner`, `JiraTokenBanner`, `StorageBanner`.
- [ ] **Step 6: `app-modals.tsx`** — remove the `DueDatesModal` import + its render block + the related props (`dueModalOpen`, `onCloseDueModal`, `dueItems`/whatever) from the `AppModalsProps` interface.
- [ ] **Step 7: Delete `src/app/use-due-alerts.ts` and `src/app/use-due-alerts.test.ts`** (`git rm`).
- [ ] **Step 8: Fix the test fallout.** Run `npx tsc --noEmit` and `npx vitest run` — REMOVE or UPDATE every test that referenced the deleted components/hooks/props: `notifications.test.tsx` (banner/modal tests for the 3 — delete those describe blocks, keep birthday/jira/storage), `app-modals.test.tsx` (due-modal assertions), any `use-stakeholder-comms` test asserting banner/modal state (keep the items test), and any task-manager test asserting the bell opened the due modal (update to assert it navigates to `actions`). Do NOT weaken kept tests.
- [ ] **Step 9: Verify** `npx tsc --noEmit && npx eslint src/app --max-warnings=0 && npx vitest run` → all green. Report totals + which tests you removed/updated.
- [ ] **Step 10: Commit**
```bash
git add -A
git commit -m "feat: remove due/RAID-review/stakeholder-comms reminders (folded into Action Center); repoint bell"
```

---

## Task 7: i18n dead-key cleanup + docs + sweep

**Files:** Modify `src/app/i18n.ts`, `src/app/i18n.de.ts`, `src/app/version.ts`, `CHANGELOG.md`.

- [ ] **Step 1: Remove dead i18n keys.** Grep each candidate banner/modal key across `src/app` (exclude i18n files): for keys that were ONLY used by the deleted `DueBanner`/`DueDatesModal`/`RaidReviewBanner`/`RaidReviewModal`/`StakeholderCommsBanner`/`StakeholderCommsModal` (e.g. `due*`/`raidReview*`/`stakeholderComms*` banner/modal strings — list them by reading the deleted components' keys from git), confirm zero references remain, then delete them from BOTH `i18n.ts` and `i18n.de.ts` (preserve parity). Keep ANY key still referenced (e.g. shared RAID-review interval setting labels). After removal: `npx tsc --noEmit && npx vitest run src/app/i18n-encoding.test.ts src/app/i18n.test.ts` → PASS.
- [ ] **Step 2: version.ts** — `APP_VERSION` `"0.77.0"`→`"0.78.0"`; `APP_MILESTONE` `"Russ"`→`"Hopkinson"`; update the `APP_BUILD_DATE` comment to `// 0.78.0 reminders folded into the Action Center + per-action snooze`; append `"versionHighlightSnoozeActions",` to `APP_HIGHLIGHT_KEYS` (key added in Task 1).
- [ ] **Step 3: CHANGELOG** above `## [0.77.0]`:
```markdown
## [0.78.0] - 2026-06-13 "Hopkinson"

### Changed
- The due-dates, RAID-review, and stakeholder-comms **reminder banners and
  modals are gone** — those nudges now live in the **Action Center** as ranked
  actions. The header bell opens the Action Center. Snooze any action for 1 hour
  or 1 day; it returns when the timer lapses. (Birthday, Jira-token, storage, and
  safe-mode banners are unchanged.)
```
- [ ] **Step 4: FULL sweep** `npx tsc --noEmit && npx vitest run && npx eslint src/app --max-warnings=0`. Report totals; all green.
- [ ] **Step 5: Commit** `git add src/app/i18n.ts src/app/i18n.de.ts src/app/version.ts CHANGELOG.md && git commit -m "docs: 0.78.0 Hopkinson — reminders folded into Action Center + snooze"`

---

## Final verification (after all tasks)
- [ ] `npx tsc --noEmit` clean; `npx vitest run` all green; `npx eslint src/app --max-warnings=0` clean.
- [ ] Manual smoke (dev server): no due/RAID-review/stakeholder-comms banners or modals appear; those items show in the Action Center instead; the header bell opens the Action Center and its count = the now-tier count; snoozing an action (1h/1d) removes it from the queue and the count; birthday/jira/storage/safe-mode banners + toasts still work.
- [ ] e2e/a11y green (the snooze menu must not introduce a nested-interactive violation — it won't: the row is a plain onClick div).
- [ ] Use **superpowers:finishing-a-development-branch**.
