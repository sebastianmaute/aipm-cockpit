# Slice 11 — useToast + useDueAlerts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract toast state + auto-dismiss timer into `useToast`, and banner/modal state + session-once due-date alert effect into `useDueAlerts`, removing ~48 lines from `task-manager.tsx`.

**Architecture:** Two plain hooks (no context providers). `useToast` is zero-arg and owns toast state, the `showToast` useCallback factory, and the auto-dismiss timer. `useDueAlerts` takes `{ hydrated, tasks, holidaySet, settings, today, showToast }` and owns bannerDismissed, dueModalOpen, notifiedThisSessionRef, and the session-once alert effect. `showToast` flows from `useToast` → `task-manager.tsx` destructuring → passed into `useDueAlerts`.

**Tech Stack:** React 19, TypeScript, Vitest 3, @testing-library/react 16

---

## Files

| Action | Path |
|--------|------|
| Create | `src/app/use-toast.ts` |
| Create | `src/app/use-toast.test.ts` |
| Create | `src/app/use-due-alerts.ts` |
| Create | `src/app/use-due-alerts.test.ts` |
| Modify | `src/app/task-manager.tsx` |
| Modify | `src/app/version.ts` |
| Modify | `CHANGELOG.md` |
| Modify | `README.md` |

---

### Task 1: Scaffold use-toast.test.ts (failing tests)

**Files:**
- Create: `src/app/use-toast.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/app/use-toast.test.ts
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useToast } from "./use-toast";

describe("useToast", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("toast is null initially", () => {
    const { result } = renderHook(() => useToast());
    expect(result.current.toast).toBeNull();
  });

  it("showToast sets toast with correct kind and text", () => {
    const { result } = renderHook(() => useToast());
    act(() => {
      result.current.showToast("info", "hello");
    });
    expect(result.current.toast).not.toBeNull();
    expect(result.current.toast?.kind).toBe("info");
    expect(result.current.toast?.text).toBe("hello");
  });

  it("auto-dismisses toast after 4000ms", async () => {
    const { result } = renderHook(() => useToast());
    act(() => {
      result.current.showToast("error", "oops");
    });
    expect(result.current.toast).not.toBeNull();
    await act(async () => {
      vi.advanceTimersByTime(4000);
    });
    expect(result.current.toast).toBeNull();
  });

  it("calling showToast twice resets the timer", async () => {
    const { result } = renderHook(() => useToast());
    act(() => {
      result.current.showToast("info", "first");
    });
    const firstId = result.current.toast?.id;
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    act(() => {
      result.current.showToast("info", "second");
    });
    const secondId = result.current.toast?.id;
    expect(secondId).not.toBe(firstId);
    // Advance another 2000ms (4000ms total from first) — still alive because timer restarted
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(result.current.toast).not.toBeNull();
    expect(result.current.toast?.text).toBe("second");
    // Advance to 4000ms from second showToast call
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(result.current.toast).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```
npx vitest run src/app/use-toast.test.ts
```

Expected: FAIL — "Cannot find module './use-toast'"

---

### Task 2: Implement use-toast.ts

**Files:**
- Create: `src/app/use-toast.ts`

- [ ] **Step 1: Write the implementation**

```typescript
// src/app/use-toast.ts
"use client";
import { useCallback, useEffect, useState } from "react";

type Toast = { kind: "info" | "error"; text: string; id: number };

export function useToast(): {
  toast: Toast | null;
  showToast: (kind: "info" | "error", text: string) => void;
} {
  const [toast, setToast] = useState<Toast | null>(null);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast?.id]);

  const showToast = useCallback((kind: "info" | "error", text: string) => {
    setToast({ kind, text, id: Date.now() });
  }, []);

  return { toast, showToast };
}
```

- [ ] **Step 2: Run tests to verify they pass**

```
npx vitest run src/app/use-toast.test.ts
```

Expected: PASS — 4 tests

- [ ] **Step 3: Commit**

```
git add src/app/use-toast.ts src/app/use-toast.test.ts
git commit -m "feat(use-toast): extract toast state and auto-dismiss effect"
```

---

### Task 3: Scaffold use-due-alerts.test.ts (failing tests)

**Files:**
- Create: `src/app/use-due-alerts.test.ts`

**Context:** The test needs minimal Settings and Task fixtures. `Settings` comes from `src/app/settings-menu.tsx`. The relevant types are:
```typescript
// From settings-menu.tsx:
type NotificationsConfig = {
  banner: DueNotificationConfig;
  toast: DueNotificationConfig;
  popup: DueNotificationConfig;
};
type DueNotificationConfig = { enabled: boolean; thresholdWorkDays: number };
// Full Settings type has: language, holidayCountries, storageConfig, ai, notifications, jira
```

`TODAY = "2030-01-15"`, `OVERDUE_TASK.dueDate = "2030-01-10"` — this task will be returned by `getAlertableTasks`.

- [ ] **Step 1: Write the failing tests**

```typescript
// src/app/use-due-alerts.test.ts
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useDueAlerts } from "./use-due-alerts";
import type { Settings } from "./settings-menu";
import type { Task } from "./types";

const TODAY = "2030-01-15";

const OVERDUE_TASK: Task = {
  id: "t1",
  title: "Overdue task",
  status: "open",
  dueDate: "2030-01-10",
  priority: "medium",
  tags: [],
  subtasks: [],
  contacts: [],
  createdAt: "2030-01-01T00:00:00.000Z",
  updatedAt: "2030-01-01T00:00:00.000Z",
};

function makeSettings(overrides: {
  toastEnabled?: boolean;
  popupEnabled?: boolean;
} = {}): Settings {
  return {
    language: "en",
    holidayCountries: [],
    storageConfig: { backend: "local" },
    ai: { provider: "none", model: "" },
    notifications: {
      banner: { enabled: true, thresholdWorkDays: 3 },
      toast: { enabled: overrides.toastEnabled ?? false, thresholdWorkDays: 3 },
      popup: { enabled: overrides.popupEnabled ?? false, thresholdWorkDays: 3 },
    },
    jira: { enabled: false, baseUrl: "", email: "", apiToken: "", projectKey: "" },
  } as Settings;
}

describe("useDueAlerts", () => {
  it("bannerDismissed and dueModalOpen are false initially", () => {
    const { result } = renderHook(() =>
      useDueAlerts({
        hydrated: false,
        tasks: [],
        holidaySet: new Set(),
        settings: makeSettings(),
        today: TODAY,
        showToast: vi.fn(),
      })
    );
    expect(result.current.bannerDismissed).toBe(false);
    expect(result.current.dueModalOpen).toBe(false);
  });

  it("does NOT fire when hydrated=false", () => {
    const showToast = vi.fn();
    const { result } = renderHook(() =>
      useDueAlerts({
        hydrated: false,
        tasks: [OVERDUE_TASK],
        holidaySet: new Set(),
        settings: makeSettings({ toastEnabled: true, popupEnabled: true }),
        today: TODAY,
        showToast,
      })
    );
    expect(showToast).not.toHaveBeenCalled();
    expect(result.current.dueModalOpen).toBe(false);
  });

  it("calls showToast once when hydrated=true and toast.enabled=true", async () => {
    const showToast = vi.fn();
    renderHook(() =>
      useDueAlerts({
        hydrated: true,
        tasks: [OVERDUE_TASK],
        holidaySet: new Set(),
        settings: makeSettings({ toastEnabled: true }),
        today: TODAY,
        showToast,
      })
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith("info", expect.any(String));
  });

  it("sets dueModalOpen=true when hydrated=true and popup.enabled=true", async () => {
    const showToast = vi.fn();
    const { result } = renderHook(() =>
      useDueAlerts({
        hydrated: true,
        tasks: [OVERDUE_TASK],
        holidaySet: new Set(),
        settings: makeSettings({ popupEnabled: true }),
        today: TODAY,
        showToast,
      })
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.dueModalOpen).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```
npx vitest run src/app/use-due-alerts.test.ts
```

Expected: FAIL — "Cannot find module './use-due-alerts'"

---

### Task 4: Implement use-due-alerts.ts

**Files:**
- Create: `src/app/use-due-alerts.ts`

**Context:**
- `getAlertableTasks` is in `./due-dates` — signature: `getAlertableTasks(tasks: Task[], thresholdWorkDays: number, today: string, holidays: Set<string>): AlertableTask[]`
- `dueAlertsToastText` is in `./notifications` — signature: `dueAlertsToastText(items: AlertableTask[], lang: Lang): string`
- `Settings` type is in `./settings-menu`
- `Task` type is in `./types`
- `settingsRef`/`todayRef` pattern: sync refs with useEffect to read inside the alert effect without listing in deps (avoids spurious re-fires of the session-once effect)
- `Promise.resolve().then()` deferral: setState calls inside useEffect wrapped in `void Promise.resolve().then()` to satisfy `react-hooks/set-state-in-effect` ESLint rule

- [ ] **Step 1: Write the implementation**

```typescript
// src/app/use-due-alerts.ts
"use client";
import {
  type Dispatch,
  type SetStateAction,
  useEffect,
  useRef,
  useState,
} from "react";
import { getAlertableTasks } from "./due-dates";
import { dueAlertsToastText } from "./notifications";
import type { Settings } from "./settings-menu";
import type { Task } from "./types";

export interface UseDueAlertsArgs {
  hydrated: boolean;
  tasks: Task[];
  holidaySet: Set<string>;
  settings: Settings;
  today: string;
  showToast: (kind: "info" | "error", text: string) => void;
}

export function useDueAlerts({
  hydrated,
  tasks,
  holidaySet,
  settings,
  today,
  showToast,
}: UseDueAlertsArgs): {
  bannerDismissed: boolean;
  setBannerDismissed: Dispatch<SetStateAction<boolean>>;
  dueModalOpen: boolean;
  setDueModalOpen: Dispatch<SetStateAction<boolean>>;
} {
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [dueModalOpen, setDueModalOpen] = useState(false);
  const notifiedThisSessionRef = useRef(false);

  const settingsRef = useRef(settings);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  const todayRef = useRef(today);
  useEffect(() => {
    todayRef.current = today;
  }, [today]);

  useEffect(() => {
    if (!hydrated || notifiedThisSessionRef.current) return;
    if (tasks.length === 0) return;
    notifiedThisSessionRef.current = true;

    const { toast: toastCfg, popup: popupCfg } =
      settingsRef.current.notifications;

    const toastItems = toastCfg.enabled
      ? getAlertableTasks(
          tasks,
          toastCfg.thresholdWorkDays,
          todayRef.current,
          holidaySet
        )
      : [];

    const popupItems = popupCfg.enabled
      ? getAlertableTasks(
          tasks,
          popupCfg.thresholdWorkDays,
          todayRef.current,
          holidaySet
        )
      : [];

    void Promise.resolve().then(() => {
      if (toastItems.length > 0)
        showToast(
          "info",
          dueAlertsToastText(toastItems, settingsRef.current.language)
        );
      if (popupItems.length > 0) setDueModalOpen(true);
    });
  }, [hydrated, tasks, holidaySet, showToast]);

  return { bannerDismissed, setBannerDismissed, dueModalOpen, setDueModalOpen };
}
```

- [ ] **Step 2: Run tests to verify they pass**

```
npx vitest run src/app/use-due-alerts.test.ts
```

Expected: PASS — 4 tests

- [ ] **Step 3: Commit**

```
git add src/app/use-due-alerts.ts src/app/use-due-alerts.test.ts
git commit -m "feat(use-due-alerts): extract banner/modal state and session-once alert effect"
```

---

### Task 5: Refactor task-manager.tsx

**Files:**
- Modify: `src/app/task-manager.tsx`

**Context:** The notifications import line currently includes `dueAlertsToastText` (lines 33-37):
```typescript
import { DueBanner, DueDatesModal, dueAlertsToastText } from "./notifications";
```
After refactoring, `dueAlertsToastText` is used only inside `use-due-alerts.ts` — remove it from this import.

The inline blocks to remove are approximately:
- Lines 316-318: `const [toast, setToast] = ...` state
- Line 320: `const [bannerDismissed, setBannerDismissed] = useState(false)`
- Line 321: `const [dueModalOpen, setDueModalOpen] = useState(false)`
- Line 322: `const notifiedThisSessionRef = useRef(false)`
- Lines 580-584: auto-dismiss effect (deps `[toast?.id]`)
- Lines 586-588: `function showToast(kind, text) { ... }`
- Lines 870-898: session-once due-date alert effect (deps `[hydrated, tasks, holidaySet]`)

The `bannerItems` and `dueModalItems` useMemo blocks (lines 859-868) STAY — they compute display data for JSX.

- [ ] **Step 1: Add imports**

In `task-manager.tsx`, add next to the existing hook imports:
```typescript
import { useDueAlerts } from "./use-due-alerts";
import { useToast } from "./use-toast";
```

- [ ] **Step 2: Remove `dueAlertsToastText` from the notifications import**

Change:
```typescript
import { DueBanner, DueDatesModal, dueAlertsToastText } from "./notifications";
```
To:
```typescript
import { DueBanner, DueDatesModal } from "./notifications";
```

- [ ] **Step 3: Remove inline toast state, bannerDismissed, dueModalOpen, notifiedThisSessionRef**

Remove these four lines (around lines 316-322):
```typescript
const [toast, setToast] = useState<{ kind: "info" | "error"; text: string; id: number } | null>(null);
// ...
const [bannerDismissed, setBannerDismissed] = useState(false);
const [dueModalOpen, setDueModalOpen] = useState(false);
const notifiedThisSessionRef = useRef(false);
```

- [ ] **Step 4: Remove the auto-dismiss effect and showToast function**

Remove the auto-dismiss effect (deps `[toast?.id]`) and the `showToast` helper function (~lines 580-588).

- [ ] **Step 5: Remove the session-once due-date alert effect**

Remove the `useEffect` with deps `[hydrated, tasks, holidaySet]` that fires `showToast` and `setDueModalOpen` (~lines 870-898).

- [ ] **Step 6: Add the two hook calls**

Immediately after the `const { activityLog, ... } = useActivityLog({ lang })` line, add:
```typescript
const { toast, showToast } = useToast();
const { bannerDismissed, setBannerDismissed, dueModalOpen, setDueModalOpen } =
  useDueAlerts({ hydrated, tasks, holidaySet, settings, today, showToast });
```

- [ ] **Step 7: Run full test suite**

```
npx vitest run
```

Expected: All tests pass (164+ tests green). Also run:

```
npx tsc --noEmit
```

Expected: No type errors.

- [ ] **Step 8: Commit**

```
git add src/app/task-manager.tsx
git commit -m "refactor(task-manager): consume useToast and useDueAlerts; remove ~48 inline lines"
```

---

### Task 6: Version bump v0.7.9 "García"

**Files:**
- Modify: `src/app/version.ts`
- Modify: `CHANGELOG.md`
- Modify: `README.md`

- [ ] **Step 1: Update version.ts**

```typescript
// src/app/version.ts
export const APP_VERSION = "0.7.9";
export const APP_BUILD_DATE = "2026-05-21";
export const APP_CODENAME = "García";
```

- [ ] **Step 2: Add CHANGELOG entry**

At the top of the releases section in `CHANGELOG.md`, add:
```markdown
## [0.7.9] "García" — 2026-05-21

### Refactored
- Extracted `useToast` hook: toast state, `showToast` factory, auto-dismiss timer
- Extracted `useDueAlerts` hook: banner/modal state, session-once due-date alert effect
- `task-manager.tsx` net −48 lines
```

- [ ] **Step 3: Update README badge**

Change the version badge in `README.md` from `v0.7.8` to `v0.7.9`.

- [ ] **Step 4: Run full test suite one final time**

```
npx vitest run
```

Expected: All tests pass.

- [ ] **Step 5: Commit**

```
git add src/app/version.ts CHANGELOG.md README.md
git commit -m "release(v0.7.9): García - useToast + useDueAlerts extraction"
```
