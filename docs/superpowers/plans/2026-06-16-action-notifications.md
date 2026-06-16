# Desktop Notifications (Slice 6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Raise a browser desktop notification when a new urgent (`tier: "now"`) Action Center signal appears while the app tab is backgrounded — opt-in, off by default.

**Architecture:** A pure i18n-free `notifications.ts` (new-signal diff + plan) feeds a browser-glue hook `use-action-notifications.ts` that gates on enabled/permission/popout/focus and fires `new Notification(...)`. A settings `desktopUrgent` `ChannelConfig` toggle (in the existing notifications section) requests permission on enable. Engine untouched; dedup state is localStorage-only.

**Tech Stack:** TypeScript, React 19, Next.js (forked), Vitest + Testing Library, browser `Notification` API.

**Spec:** `docs/superpowers/specs/2026-06-16-action-notifications-design.md` (committed `2c9a718`).

**Branch:** `feat-action-notifications` (already checked out).

---

## File Structure

- **Create** `src/app/notifications.ts` — pure: `newUrgentActions`, `buildNotificationPlan`, `nextSeenIds`, `NotificationPlan` type.
- **Create** `src/app/notifications.test.ts` — unit tests for the pure module.
- **Create** `src/app/use-action-notifications.ts` — browser-glue hook (gate matrix, fire, persist seen-ids).
- **Create** `src/app/use-action-notifications.test.tsx` — hook tests (mock `Notification` + focus).
- **Modify** `src/app/settings-types.ts` — add `desktopUrgent: ChannelConfig` to `NotificationsConfig` + default.
- **Modify** `src/app/use-settings.ts` — coerce `desktopUrgent` in `migrateNotifications` (default `false`).
- **Modify** `src/app/settings-sections/notifications-section.tsx` — desktop toggle + permission flow.
- **Modify** `src/app/settings-sections/notifications-section.test.tsx` (create if absent) — toggle/permission test.
- **Modify** `src/app/task-manager.tsx` — call the hook after `nextActions` is computed.
- **Modify** `src/app/i18n.ts` + `src/app/i18n.de.ts` — new keys (EN/DE parity).
- **Modify** `src/app/version.ts` + `CHANGELOG.md` — release 0.94.0.

**Engineer context (read once):**
- `Lang` is `"en-US" | "en-GB" | "de"` — never `"en"`. `t(lang, key, ...params)` uses 0-based positional `{0}`/`{1}`.
- `i18n.de.ts` is **CRLF** and the Edit tool corrupts umlauts there — Task 6 patches it via a node UTF-8 write only, matching `\r\n`.
- CI runs `--max-warnings=0`: an unused import/var/param is a FATAL lint error. No `argsIgnorePattern`.
- `react-hooks/exhaustive-deps` rejects an `obj.member` dependency — hoist to a local const and depend on that.
- `SuggestedAction` (`next-actions/types.ts:27-36`): `{ id, source, moduleId?, title: I18nText, why: I18nText, score, tier: "now"|"soon"|"monitor", cta }`. `I18nText = { key: TranslationKey; params?: (string|number)[] }`. `cta` is `{ kind:"open"; view: AppView; id: string|number } | { kind:"snooze"; actionId: string }`.

---

## Task 1: Pure `notifications.ts` — new-signal diff + plan

**Files:**
- Create: `src/app/notifications.ts`
- Test: `src/app/notifications.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// src/app/notifications.test.ts
import { describe, it, expect } from "vitest";
import { newUrgentActions, buildNotificationPlan, nextSeenIds } from "./notifications";
import type { SuggestedAction } from "./next-actions/types";

function action(id: string, tier: SuggestedAction["tier"]): SuggestedAction {
  return {
    id,
    source: "milestone",
    title: { key: "actionMilestoneTitle", params: ["X"] },
    why: { key: "actionMilestoneWhyAtRisk" },
    score: 10,
    tier,
    cta: { kind: "open", view: "milestones", id: 1 },
  };
}

describe("newUrgentActions", () => {
  it("returns only now-tier actions whose id is unseen, preserving order", () => {
    const actions = [action("a", "now"), action("b", "soon"), action("c", "now")];
    expect(newUrgentActions(actions, ["c"]).map((a) => a.id)).toEqual(["a"]);
  });
  it("excludes soon and monitor tiers", () => {
    const actions = [action("a", "soon"), action("b", "monitor")];
    expect(newUrgentActions(actions, [])).toEqual([]);
  });
  it("is empty when every now-tier id is already seen", () => {
    const actions = [action("a", "now"), action("b", "now")];
    expect(newUrgentActions(actions, ["a", "b"])).toEqual([]);
  });
});

describe("buildNotificationPlan", () => {
  it("returns null when nothing is new", () => {
    expect(buildNotificationPlan([])).toBeNull();
  });
  it("returns a single plan carrying the action for exactly one", () => {
    const a = action("a", "now");
    expect(buildNotificationPlan([a])).toEqual({ kind: "single", action: a });
  });
  it("returns a summary plan with the count for more than one", () => {
    expect(buildNotificationPlan([action("a", "now"), action("b", "now")])).toEqual({
      kind: "summary",
      count: 2,
    });
  });
});

describe("nextSeenIds", () => {
  it("returns the present now-tier ids only (deduped)", () => {
    const actions = [action("a", "now"), action("a", "now"), action("b", "soon"), action("c", "now")];
    expect(nextSeenIds(actions).sort()).toEqual(["a", "c"]);
  });
  it("drops ids that are no longer present so a returning signal re-notifies", () => {
    expect(nextSeenIds([action("b", "now")])).toEqual(["b"]); // "a" from a prior cycle is gone
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:run -- src/app/notifications.test.ts`
Expected: FAIL — `notifications.ts` does not exist / functions undefined.

- [ ] **Step 3: Write the implementation**

```ts
// src/app/notifications.ts
import type { SuggestedAction } from "./next-actions/types";

const URGENT_TIER = "now" as const;

/** now-tier actions whose id is not yet in the seen set. Order preserved. */
export function newUrgentActions(
  actions: readonly SuggestedAction[],
  seenIds: readonly string[],
): SuggestedAction[] {
  const seen = new Set(seenIds);
  return actions.filter((a) => a.tier === URGENT_TIER && !seen.has(a.id));
}

export type NotificationPlan =
  | { kind: "single"; action: SuggestedAction }
  | { kind: "summary"; count: number };

/** null when nothing new; single for exactly one; summary for more than one. */
export function buildNotificationPlan(
  newUrgent: readonly SuggestedAction[],
): NotificationPlan | null {
  if (newUrgent.length === 0) return null;
  if (newUrgent.length === 1) return { kind: "single", action: newUrgent[0] };
  return { kind: "summary", count: newUrgent.length };
}

/**
 * Next seen-id set = exactly the currently present-and-urgent ids (deduped).
 * An id enters "seen" only while present and urgent and drops out the moment it
 * is gone, so a cleared-then-returning signal is treated as new and re-notifies.
 */
export function nextSeenIds(actions: readonly SuggestedAction[]): string[] {
  const urgentIds = actions.filter((a) => a.tier === URGENT_TIER).map((a) => a.id);
  return [...new Set(urgentIds)];
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:run -- src/app/notifications.test.ts`
Expected: PASS (all 8).

- [ ] **Step 5: Lint + typecheck**

Run: `npm run lint && npx tsc --noEmit`
Expected: clean (no warnings — CI is `--max-warnings=0`).

- [ ] **Step 6: Commit**

```bash
git add src/app/notifications.ts src/app/notifications.test.ts
git commit -m "feat: pure notifications module (new-signal diff + plan)"
```

---

## Task 2: Settings type + default — `desktopUrgent` channel

**Files:**
- Modify: `src/app/settings-types.ts:64-91` (`NotificationsConfig` type + `defaultNotificationsConfig`)

- [ ] **Step 1: Add the field to the type**

In `src/app/settings-types.ts`, add `desktopUrgent` to the `NotificationsConfig` type (after `jiraTokenError`):

```ts
export type NotificationsConfig = {
  reminderLeadDays: number;
  useGlobalLeadDays: boolean;
  birthday: ChannelConfig;
  raidReview: ChannelConfig;
  raidReviewIntervalDays: number;
  dueSoonWorkdays: number;
  stakeholderComms: ChannelConfig;
  stakeholderCommsLeadDays: Record<StakeholderQuadrant, number>;
  jiraTokenError: ChannelConfig;
  /** Desktop browser notifications for urgent ("now") Action Center signals. Off by default. */
  desktopUrgent: ChannelConfig;
};
```

- [ ] **Step 2: Add the default**

In `defaultNotificationsConfig` (same file), add after `jiraTokenError: { enabled: true },`:

```ts
  jiraTokenError: { enabled: true },
  desktopUrgent: { enabled: false },
};
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: FAIL — `migrateNotifications` in `use-settings.ts` returns an object missing `desktopUrgent`. (Task 3 fixes this; this proves the field is required.)

- [ ] **Step 4: Commit**

```bash
git add src/app/settings-types.ts
git commit -m "feat: add desktopUrgent channel to NotificationsConfig (default off)"
```

---

## Task 3: Settings coercion — `desktopUrgent` defaults to false

**Files:**
- Modify: `src/app/use-settings.ts:30-70` (`migrateNotifications`)

- [ ] **Step 1: Write the failing test**

Add to `src/app/use-settings.test.ts` (the file exists; if a `migrateNotifications`-style test block is present, add there; otherwise add this block). First check the export — `migrateNotifications` is module-private, so test it through the public load path. Use this focused test that drives the default via a partial blob:

```ts
// src/app/use-settings.test.ts  (add)
import { describe, it, expect } from "vitest";
import { migrateNotifications } from "./use-settings";

describe("migrateNotifications desktopUrgent", () => {
  it("defaults desktopUrgent.enabled to false when absent", () => {
    expect(migrateNotifications({}).desktopUrgent).toEqual({ enabled: false });
  });
  it("preserves desktopUrgent.enabled=true when set", () => {
    expect(migrateNotifications({ desktopUrgent: { enabled: true } }).desktopUrgent).toEqual({
      enabled: true,
    });
  });
  it("treats a non-true value as disabled", () => {
    expect(migrateNotifications({ desktopUrgent: { enabled: "yes" } }).desktopUrgent).toEqual({
      enabled: false,
    });
  });
});
```

NOTE: `migrateNotifications` is currently NOT exported. In `use-settings.ts` change `function migrateNotifications` to `export function migrateNotifications` so the test can import it (it is a pure helper — exporting it is safe and matches how other coercers like `coerceLayout` are exported in the same file).

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:run -- src/app/use-settings.test.ts`
Expected: FAIL — `desktopUrgent` is `undefined` (not returned by `migrateNotifications`).

- [ ] **Step 3: Implement**

In `src/app/use-settings.ts`, export the function and add `desktopUrgent` to the returned object. The existing `ch()` helper defaults `enabled` to **true** (`enabled !== false`), which is wrong here — desktop must default **off**. Add a dedicated coercion:

```ts
export function migrateNotifications(raw: unknown): Settings["notifications"] {
  // ...existing body unchanged...
  return {
    reminderLeadDays: Number.isFinite(lead) && lead >= 0 ? lead : 7,
    useGlobalLeadDays: typeof p.useGlobalLeadDays === "boolean" ? p.useGlobalLeadDays : true,
    birthday: ch(p.birthday),
    raidReview: ch(p.raidReview),
    raidReviewIntervalDays:
      Number.isFinite(raidInterval) && raidInterval >= 1 ? Math.min(365, raidInterval) : 14,
    dueSoonWorkdays:
      Number.isFinite(dueSoonWd) && dueSoonWd >= 1 ? Math.min(365, dueSoonWd) : 3,
    stakeholderComms: ch(p.stakeholderComms),
    stakeholderCommsLeadDays,
    jiraTokenError: ch(p.jiraTokenError),
    desktopUrgent: {
      enabled:
        isPlainObject(p.desktopUrgent) &&
        (p.desktopUrgent as { enabled?: unknown }).enabled === true,
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:run -- src/app/use-settings.test.ts`
Expected: PASS. Also run `npx tsc --noEmit` — the Task 2 type error is now resolved.

- [ ] **Step 5: Lint**

Run: `npm run lint`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add src/app/use-settings.ts src/app/use-settings.test.ts
git commit -m "feat: coerce desktopUrgent setting (default off, only true enables)"
```

---

## Task 4: Browser-glue hook `use-action-notifications.ts`

**Files:**
- Create: `src/app/use-action-notifications.ts`
- Test: `src/app/use-action-notifications.test.tsx`

**Context:** This hook is the only place that touches the browser `Notification` API. It seeds a seen-id set from `localStorage["lop-app:notified-urgent"]`, and on every change of `actions` applies the gate matrix, fires at most one notification, and persists the updated seen set. The FIRST gated cycle seeds the seen set silently (no fire) to avoid a popup-storm the instant the feature turns on.

- [ ] **Step 1: Write the failing tests**

```tsx
// src/app/use-action-notifications.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import { useActionNotifications } from "./use-action-notifications";
import type { SuggestedAction } from "./next-actions/types";

function action(id: string, tier: SuggestedAction["tier"] = "now"): SuggestedAction {
  return {
    id,
    source: "milestone",
    title: { key: "actionMilestoneTitle", params: ["X"] },
    why: { key: "actionMilestoneWhyAtRisk" },
    score: 10,
    tier,
    cta: { kind: "open", view: "milestones", id: 1 },
  };
}

let notifInstances: Array<{ onclick: (() => void) | null; close: () => void; tag?: string }>;
let ctor: ReturnType<typeof vi.fn>;

function installNotification(permission: NotificationPermission) {
  notifInstances = [];
  ctor = vi.fn(function (this: Record<string, unknown>, _title: string, opts?: NotificationOptions) {
    const inst = { onclick: null as null | (() => void), close: vi.fn(), tag: opts?.tag };
    notifInstances.push(inst);
    return inst;
  });
  (ctor as unknown as { permission: NotificationPermission }).permission = permission;
  (ctor as unknown as { requestPermission: () => Promise<NotificationPermission> }).requestPermission =
    vi.fn(async () => permission);
  (globalThis as unknown as { Notification: unknown }).Notification = ctor;
}

const baseArgs = () => ({
  enabled: true,
  isPopout: false,
  lang: "en-US" as const,
  requestOpen: vi.fn(),
  openActionCenter: vi.fn(),
});

beforeEach(() => {
  localStorage.clear();
  vi.spyOn(document, "hasFocus").mockReturnValue(false); // backgrounded by default
});
afterEach(() => {
  vi.restoreAllMocks();
  delete (globalThis as unknown as { Notification?: unknown }).Notification;
});

describe("useActionNotifications gate matrix", () => {
  it("does not fire when disabled", () => {
    installNotification("granted");
    renderHook(({ actions }) => useActionNotifications({ ...baseArgs(), enabled: false, actions }), {
      initialProps: { actions: [action("a")] },
    });
    expect(ctor).not.toHaveBeenCalled();
  });

  it("does not fire in a popout", () => {
    installNotification("granted");
    renderHook(({ actions }) => useActionNotifications({ ...baseArgs(), isPopout: true, actions }), {
      initialProps: { actions: [action("a")] },
    });
    expect(ctor).not.toHaveBeenCalled();
  });

  it("does not fire when permission is not granted", () => {
    installNotification("denied");
    renderHook(({ actions }) => useActionNotifications({ ...baseArgs(), actions }), {
      initialProps: { actions: [action("a")] },
    });
    expect(ctor).not.toHaveBeenCalled();
  });

  it("does not fire while the document is focused (marks seen instead)", () => {
    installNotification("granted");
    (document.hasFocus as unknown as ReturnType<typeof vi.fn>).mockReturnValue(true);
    const { rerender } = renderHook(({ actions }) => useActionNotifications({ ...baseArgs(), actions }), {
      initialProps: { actions: [action("a")] },
    });
    // focused: a is marked seen; backgrounding then re-rendering with same a must NOT fire
    (document.hasFocus as unknown as ReturnType<typeof vi.fn>).mockReturnValue(false);
    rerender({ actions: [action("a")] });
    expect(ctor).not.toHaveBeenCalled();
  });

  it("does not fire on the first gated cycle (backlog avoidance), only on later new ids", () => {
    installNotification("granted");
    const { rerender } = renderHook(({ actions }) => useActionNotifications({ ...baseArgs(), actions }), {
      initialProps: { actions: [action("a")] },
    });
    expect(ctor).not.toHaveBeenCalled(); // "a" was already present at mount
    rerender({ actions: [action("a"), action("b")] });
    expect(ctor).toHaveBeenCalledTimes(1); // only the newly-appeared "b"
  });
});

describe("useActionNotifications firing", () => {
  it("fires a single notification for one new urgent signal and deep-links on click", () => {
    installNotification("granted");
    const args = baseArgs();
    const { rerender } = renderHook(({ actions }) => useActionNotifications({ ...args, actions }), {
      initialProps: { actions: [] as SuggestedAction[] },
    });
    rerender({ actions: [action("a")] });
    expect(ctor).toHaveBeenCalledTimes(1);
    expect(notifInstances[0].tag).toBe("a");
    notifInstances[0].onclick?.();
    expect(args.requestOpen).toHaveBeenCalledWith("milestones", 1);
  });

  it("fires one summary notification for a burst and opens the action center on click", () => {
    installNotification("granted");
    const args = baseArgs();
    const { rerender } = renderHook(({ actions }) => useActionNotifications({ ...args, actions }), {
      initialProps: { actions: [] as SuggestedAction[] },
    });
    rerender({ actions: [action("a"), action("b"), action("c")] });
    expect(ctor).toHaveBeenCalledTimes(1);
    expect(notifInstances[0].tag).toBe("urgent-summary");
    notifInstances[0].onclick?.();
    expect(args.openActionCenter).toHaveBeenCalledTimes(1);
  });

  it("re-notifies a signal that cleared and returned", () => {
    installNotification("granted");
    const { rerender } = renderHook(({ actions }) => useActionNotifications({ ...baseArgs(), actions }), {
      initialProps: { actions: [] as SuggestedAction[] },
    });
    rerender({ actions: [action("a")] });   // fire 1
    rerender({ actions: [] });               // a clears (pruned from seen)
    rerender({ actions: [action("a")] });   // fire 2
    expect(ctor).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:run -- src/app/use-action-notifications.test.tsx`
Expected: FAIL — hook does not exist.

- [ ] **Step 3: Implement the hook**

```ts
// src/app/use-action-notifications.ts
"use client";

import { useEffect, useRef } from "react";
import { t, type Lang } from "./i18n";
import type { AppView } from "./nav-config";
import type { SuggestedAction } from "./next-actions/types";
import { buildNotificationPlan, newUrgentActions, nextSeenIds } from "./notifications";

const SEEN_KEY = "lop-app:notified-urgent";
const SUMMARY_TAG = "urgent-summary";

interface UseActionNotificationsArgs {
  actions: readonly SuggestedAction[];
  enabled: boolean;
  isPopout: boolean;
  lang: Lang;
  requestOpen: (view: AppView, id: number) => void;
  openActionCenter: () => void;
}

function readSeen(): string[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(SEEN_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function writeSeen(ids: readonly string[]): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(SEEN_KEY, JSON.stringify(ids));
  } catch {
    /* storage full / unavailable — dedup degrades to per-session, non-fatal */
  }
}

/**
 * Side-effecting hook: raises a desktop Notification when a new urgent ("now")
 * action appears while the tab is backgrounded. Gated on enabled + granted
 * permission + non-popout. Never fires while the document is focused. The first
 * gated cycle seeds the seen set silently (no popup-storm on enable).
 */
export function useActionNotifications({
  actions,
  enabled,
  isPopout,
  lang,
  requestOpen,
  openActionCenter,
}: UseActionNotificationsArgs): void {
  const seenRef = useRef<string[] | null>(null);
  const seededRef = useRef(false);
  // Keep the latest callbacks/lang without widening the effect's dep set.
  const cbRef = useRef({ lang, requestOpen, openActionCenter });
  cbRef.current = { lang, requestOpen, openActionCenter };

  useEffect(() => {
    if (seenRef.current === null) seenRef.current = readSeen();

    const granted =
      typeof Notification !== "undefined" && Notification.permission === "granted";
    if (!enabled || isPopout || !granted) return;

    // First gated cycle: adopt the on-screen urgent ids as already-seen, no fire.
    if (!seededRef.current) {
      seededRef.current = true;
      seenRef.current = nextSeenIds(actions);
      writeSeen(seenRef.current);
      return;
    }

    const focused = typeof document !== "undefined" && document.hasFocus();
    if (!focused) {
      const plan = buildNotificationPlan(newUrgentActions(actions, seenRef.current));
      if (plan) {
        const { lang: l, requestOpen: open, openActionCenter: center } = cbRef.current;
        try {
          if (plan.kind === "single") {
            const a = plan.action;
            const n = new Notification(t(l, a.title.key, ...(a.title.params ?? [])), {
              body: t(l, a.why.key, ...(a.why.params ?? [])),
              tag: a.id,
            });
            n.onclick = () => {
              window.focus();
              if (a.cta.kind === "open") open(a.cta.view, Number(a.cta.id));
              n.close();
            };
          } else {
            const n = new Notification(t(l, "notifySummaryTitle", plan.count), {
              body: t(l, "notifySummaryBody"),
              tag: SUMMARY_TAG,
            });
            n.onclick = () => {
              window.focus();
              center();
              n.close();
            };
          }
        } catch {
          /* some environments throw on construct even when granted — non-fatal */
        }
      }
    }

    seenRef.current = nextSeenIds(actions);
    writeSeen(seenRef.current);
  }, [actions, enabled, isPopout]);
}
```

NOTE on deps: the effect intentionally depends only on `[actions, enabled, isPopout]`. `lang`/`requestOpen`/`openActionCenter` are read through `cbRef` (a ref mirror) so a new callback identity each render does not re-run the effect (which would mis-handle the seed/seen lifecycle). This is the established ref-mirror pattern in this codebase. Confirm `eslint` does not flag exhaustive-deps — `cbRef` is a ref, exempt.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:run -- src/app/use-action-notifications.test.tsx`
Expected: PASS (all 8).

- [ ] **Step 5: Lint + typecheck**

Run: `npm run lint && npx tsc --noEmit`
Expected: clean. If `AppView` is not exported from `nav-config`, find its real module via `grep -rn "export type AppView\|export interface AppView" src/app` and fix the import.

- [ ] **Step 6: Commit**

```bash
git add src/app/use-action-notifications.ts src/app/use-action-notifications.test.tsx
git commit -m "feat: useActionNotifications hook (gated desktop notifications)"
```

---

## Task 5: Settings UI — desktop toggle + permission flow

**Files:**
- Modify: `src/app/settings-sections/notifications-section.tsx`
- Test: `src/app/settings-sections/notifications-section.test.tsx` (create)

**Context:** Add a checkbox row "Desktop notifications for urgent actions". Enabling it must call `Notification.requestPermission()` and only set `enabled: true` on `"granted"`; on denial/unsupported, keep it off and toast an error. Use `useToastContext()` (returns a no-op without a provider, so tests are safe).

- [ ] **Step 1: Write the failing test**

```tsx
// src/app/settings-sections/notifications-section.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NotificationsSection } from "./notifications-section";
import { defaultSettings } from "../settings-types";

function installNotification(result: NotificationPermission) {
  const ctor = vi.fn();
  (ctor as unknown as { permission: NotificationPermission }).permission = "default";
  (ctor as unknown as { requestPermission: () => Promise<NotificationPermission> }).requestPermission =
    vi.fn(async () => result);
  (globalThis as unknown as { Notification: unknown }).Notification = ctor;
  return ctor;
}

afterEach(() => {
  vi.restoreAllMocks();
  delete (globalThis as unknown as { Notification?: unknown }).Notification;
});

describe("NotificationsSection desktop toggle", () => {
  it("requests permission on enable and turns on when granted", async () => {
    installNotification("granted");
    const onChange = vi.fn();
    render(<NotificationsSection lang="en-US" settings={defaultSettings} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText(/Desktop notifications for urgent actions/i));
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    const next = onChange.mock.calls.at(-1)![0];
    expect(next.notifications.desktopUrgent.enabled).toBe(true);
  });

  it("stays off when permission is denied", async () => {
    installNotification("denied");
    const onChange = vi.fn();
    render(<NotificationsSection lang="en-US" settings={defaultSettings} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText(/Desktop notifications for urgent actions/i));
    // give the awaited requestPermission a tick; onChange must NOT enable
    await new Promise((r) => setTimeout(r, 0));
    const calls = onChange.mock.calls.map((c) => c[0].notifications.desktopUrgent.enabled);
    expect(calls.every((v: boolean) => v === false)).toBe(true);
  });

  it("disabling does not request permission", () => {
    const ctor = installNotification("granted");
    const onChange = vi.fn();
    const settings = {
      ...defaultSettings,
      notifications: { ...defaultSettings.notifications, desktopUrgent: { enabled: true } },
    };
    render(<NotificationsSection lang="en-US" settings={settings} onChange={onChange} />);
    fireEvent.click(screen.getByLabelText(/Desktop notifications for urgent actions/i));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        notifications: expect.objectContaining({ desktopUrgent: { enabled: false } }),
      }),
    );
    expect((ctor as unknown as { requestPermission: ReturnType<typeof vi.fn> }).requestPermission)
      .not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test:run -- src/app/settings-sections/notifications-section.test.tsx`
Expected: FAIL — no control with that accessible name.

- [ ] **Step 3: Implement the toggle**

In `notifications-section.tsx`, add the toast import and a handler, and render a new row after the Jira token-error row (before the closing `</div>` of the section). Import at top:

```ts
import { useToastContext } from "../toast-context";
```

Inside the `NotificationsSection` component body (after `function patchNotif`):

```ts
  const showToast = useToastContext();

  async function handleDesktopToggle(checked: boolean) {
    if (!checked) {
      patchNotif({ desktopUrgent: { enabled: false } });
      return;
    }
    if (typeof Notification === "undefined") {
      showToast("error", t(lang, "notifyPermissionDenied"));
      return;
    }
    try {
      const result = await Notification.requestPermission();
      if (result === "granted") {
        patchNotif({ desktopUrgent: { enabled: true } });
      } else {
        showToast("error", t(lang, "notifyPermissionDenied"));
      }
    } catch {
      showToast("error", t(lang, "notifyPermissionDenied"));
    }
  }
```

Render this row immediately after the Jira token-error block (after its closing `</div>` at line ~149):

```tsx
      {/* Desktop notifications for urgent Action Center signals */}
      <div className="mt-2 flex items-center gap-2 text-sm text-foreground">
        <label className="flex items-center gap-2">
          <input
            type="checkbox"
            checked={notifications.desktopUrgent.enabled}
            onChange={(e) => handleDesktopToggle(e.target.checked)}
            className="h-4 w-4 cursor-pointer rounded border-line text-AIPM-dark-blue focus:ring-AIPM-green"
          />
          {t(lang, "settingsDesktopNotify")}
        </label>
        <InfoTooltip text={t(lang, "settingsDesktopNotifyHint")} />
      </div>
```

NOTE: the `<label>` wraps the checkbox AND the text, so the accessible name is the label text — `getByLabelText(/Desktop notifications for urgent actions/i)` resolves the checkbox. This satisfies the axe gate (labeled control). Do not rely on `placeholder`.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test:run -- src/app/settings-sections/notifications-section.test.tsx`
Expected: PASS (3). The strings come from Task 6; if it runs before Task 6, `t()` returns the key name and `getByLabelText(/Desktop notifications.../i)` would fail — so **run Task 6 first OR** temporarily assert on the key. To keep tasks independent, do Task 6 before Step 4 here. (Reorder note: implement Task 6 i18n keys, then this step passes.)

- [ ] **Step 5: Lint**

Run: `npm run lint`
Expected: clean. (Watch the unused-import rule — `useToastContext` and `InfoTooltip` are both used.)

- [ ] **Step 6: Commit**

```bash
git add src/app/settings-sections/notifications-section.tsx src/app/settings-sections/notifications-section.test.tsx
git commit -m "feat: desktop-notification settings toggle with permission flow"
```

---

## Task 6: i18n keys (EN + DE)

**Files:**
- Modify: `src/app/i18n.ts`
- Modify: `src/app/i18n.de.ts` (CRLF — node UTF-8 write only)

**Context:** Five new keys. `tsc` enforces EN/DE key-set parity, so add to BOTH. The single-notification title/body reuse the action's own keys — no new per-signal strings.

- [ ] **Step 1: Add the EN keys**

In `src/app/i18n.ts`, near the other `versionHighlight*` and action strings, add:

```ts
  notifySummaryTitle: "{0} new urgent actions",
  notifySummaryBody: "Open the app to review them.",
  settingsDesktopNotify: "Desktop notifications for urgent actions",
  settingsDesktopNotifyHint:
    "Browser only; the app tab must be open. Notifies once per new urgent signal while the tab is in the background.",
  notifyPermissionDenied: "Notification permission was not granted.",
  versionHighlightDesktopNotify:
    "Desktop notifications for newly urgent Action Center signals while the tab is in the background.",
```

(Use a distinct `versionHighlightDesktopNotify` — `versionHighlightNotifications` already exists for the old reminders feature.)

- [ ] **Step 2: Add the DE keys via a node UTF-8 write**

The Edit tool corrupts umlauts in `i18n.de.ts` and the file is CRLF. Add the DE strings with a node script. Create `scripts/_add-de-notif.mjs` (temporary):

```js
import { readFileSync, writeFileSync } from "node:fs";
const path = "src/app/i18n.de.ts";
let s = readFileSync(path, "utf8");
const anchor = "  versionHighlightRebaseline:"; // an existing DE key line (CRLF file)
const idx = s.indexOf(anchor);
if (idx === -1) throw new Error("anchor not found");
const insert =
  '  notifySummaryTitle: "{0} neue dringende Aktionen",\r\n' +
  '  notifySummaryBody: "Öffnen Sie die App, um sie zu prüfen.",\r\n' +
  '  settingsDesktopNotify: "Desktop-Benachrichtigungen für dringende Aktionen",\r\n' +
  '  settingsDesktopNotifyHint:\r\n' +
  '    "Nur im Browser; der App-Tab muss geöffnet sein. Benachrichtigt einmal pro neuem dringenden Signal, während der Tab im Hintergrund ist.",\r\n' +
  '  notifyPermissionDenied: "Berechtigung für Benachrichtigungen wurde nicht erteilt.",\r\n' +
  '  versionHighlightDesktopNotify:\r\n' +
  '    "Desktop-Benachrichtigungen für neu dringende Aktionscenter-Signale, während der Tab im Hintergrund ist.",\r\n';
s = s.slice(0, idx) + insert + s.slice(idx);
writeFileSync(path, s, "utf8");
console.log("DE keys inserted");
```

Run: `node scripts/_add-de-notif.mjs && rm scripts/_add-de-notif.mjs`
Expected: `DE keys inserted`.

- [ ] **Step 3: Verify parity + umlauts**

Run: `npx tsc --noEmit && npm run test:run -- i18n-encoding`
Expected: tsc clean (EN/DE parity holds); the `i18n-encoding` test passes (real umlauts `ö`/`ü`/`ä`, no ASCII subs).

- [ ] **Step 4: Commit**

```bash
git add src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat: i18n keys for desktop notifications (EN/DE)"
```

---

## Task 7: Wire the hook into `task-manager.tsx`

**Files:**
- Modify: `src/app/task-manager.tsx` (after the `nextActions` useMemo, ~line 684)

**Context:** Call `useActionNotifications` once with the computed `nextActions`, the setting, `isPopout`, `lang`, `requestOpen`, and an `openActionCenter` that focuses + navigates to `open-points`.

- [ ] **Step 1: Add the import**

Near the other hook imports in `task-manager.tsx` (e.g. by `useActionSnooze`):

```ts
import { useActionNotifications } from "./use-action-notifications";
```

- [ ] **Step 2: Hoist the stable callback + call the hook**

`useActionNotifications` is a side-effecting hook; call it after `nextActions` is computed (after line ~690, near `openAction`). `setActiveTab` is already destructured from `useWorkspaceTab()` (line 156); `requestOpen`, `isPopout`, `lang` are in scope:

```ts
  const openActionCenter = useCallback(() => {
    if (typeof window !== "undefined") window.focus();
    setActiveTab("open-points");
  }, [setActiveTab]);

  useActionNotifications({
    actions: nextActions,
    enabled: settings.notifications.desktopUrgent.enabled,
    isPopout,
    lang,
    requestOpen,
    openActionCenter,
  });
```

- [ ] **Step 3: Typecheck + lint**

Run: `npx tsc --noEmit && npm run lint`
Expected: clean. (`useCallback` is already imported in this file; confirm no duplicate import.)

- [ ] **Step 4: Run the full unit suite**

Run: `npm run test:run`
Expected: PASS. In particular `task-manager`-touching tests and `workspace-section.test.tsx` (which mocks settings) must still pass — `defaultSettings.notifications.desktopUrgent` now exists, so no mock needs `desktopUrgent` unless a test hand-builds a `NotificationsConfig` literal. If a test fails on a missing `desktopUrgent`, add `desktopUrgent: { enabled: false }` to that test's notifications literal.

- [ ] **Step 5: Commit**

```bash
git add src/app/task-manager.tsx
git commit -m "feat: wire desktop notifications into the Action Center"
```

---

## Task 8: Release 0.94.0

**Files:**
- Modify: `src/app/version.ts`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Bump version.ts**

In `src/app/version.ts`:
- `APP_VERSION = "0.94.0";`
- `APP_BUILD_DATE = "2026-06-16"; // 0.94.0 desktop notifications`
- `APP_MILESTONE = "<codename>";` — pick the next sci-fi/fantasy author surname not already used (the controller will choose; e.g. "Mieville", "Vandermeer", "Hopkinson"). Update the codename doc-comment to the chosen name.
- Append to `APP_HIGHLIGHT_KEYS` (end of the array): `"versionHighlightDesktopNotify",`

- [ ] **Step 2: Add the CHANGELOG entry**

Prepend under the top of `CHANGELOG.md`:

```markdown
## [0.94.0] - 2026-06-16 "<codename>"

### Added
- **Desktop notifications for urgent actions** — opt-in browser notifications raised when a new
  urgent ("now") Action Center signal appears while the app tab is in the background. One popup per
  new signal (deduped); a burst coalesces into a single "N new urgent actions" summary. Enable it in
  Settings → Notifications (requests browser permission). Browser-only; the tab must be open.
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npm run test:run -- version`
Expected: clean; any version/highlight-keys test passes (every `APP_HIGHLIGHT_KEYS` entry has an EN+DE string).

- [ ] **Step 4: Commit**

```bash
git add src/app/version.ts CHANGELOG.md
git commit -m "chore: release 0.94.0 desktop notifications"
```

---

## Task 9: Full green gate

- [ ] **Step 1: Lint + typecheck + unit**

Run: `npm run lint && npx tsc --noEmit && npm run test:run`
Expected: all clean/green.

- [ ] **Step 2: Build**

Run: `npm run build`
Expected: success (prebuild script-docs sync passes).

- [ ] **Step 3: (If a dev server is running) restart note**

No CSP edit was made (`proxy.ts` untouched — Notification API is not a network call), so no dev-server restart is required for CSP. Confirm `src/proxy.ts` is unchanged in `git diff --stat`.

---

## Self-Review (completed by plan author)

**Spec coverage:** trigger A/new-signal (Task 1 `newUrgentActions` + Task 4 effect) ✓; now-tier only (Task 1 `URGENT_TIER`) ✓; hybrid burst (Task 1 `buildNotificationPlan`, Task 4 single/summary) ✓; focus gate + backlog seed (Task 4) ✓; resolve→reappear (Task 1 `nextSeenIds`, Task 4 test) ✓; localStorage dedup, no Workspace field (Task 4 `readSeen`/`writeSeen`) ✓; canonical-instance/popout suppression (Task 4 gate + Task 7 `isPopout`) ✓; settings toggle + permission (Task 5) ✓; off-by-default coercion (Tasks 2-3) ✓; i18n EN/DE (Task 6) ✓; release (Task 8) ✓; no CSP/Turso/serializer/engine change (Task 9 Step 3 + none touched) ✓.

**Placeholder scan:** the only `<codename>` placeholder is in Task 8, deliberately chosen at execution (the controller picks the next author name) — every other step has concrete code.

**Type consistency:** `newUrgentActions(actions, seenIds)`, `buildNotificationPlan(newUrgent)`, `nextSeenIds(actions)`, `NotificationPlan = {kind:"single",action} | {kind:"summary",count}`, `useActionNotifications({actions, enabled, isPopout, lang, requestOpen, openActionCenter})`, setting path `settings.notifications.desktopUrgent.enabled`, i18n keys `notifySummaryTitle`/`notifySummaryBody`/`settingsDesktopNotify`/`settingsDesktopNotifyHint`/`notifyPermissionDenied`/`versionHighlightDesktopNotify` — all consistent across tasks.

**Ordering caveat:** Task 5 Step 4 (UI test green) depends on Task 6 strings. Execute Task 6 before re-running Task 5's assertion (noted inline).
