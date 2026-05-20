# Slice 9 — useSettings + useActivityLog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract `useSettings` and `useActivityLog` from `task-manager.tsx`, removing ~150 lines of inline state and effects and replacing them with two focused, independently testable hooks.

**Architecture:** Two plain hooks (no context providers). `useSettings` is zero-arg and owns settings state, localStorage load/persist, and i18n loading (`hydrated` + `i18nReady` gates). `useActivityLog({ lang })` owns activity log state, localStorage load/persist, `logActivity`, and `handleClearActivityLog`. `task-manager.tsx` replaces ~150 inline lines with two hook calls. Pattern mirrors slices 5–8.

**Tech Stack:** React 19, TypeScript, Vitest 3, @testing-library/react 16, localStorage (jsdom)

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `src/app/use-settings.ts` | Settings state + localStorage lifecycle + i18n loading |
| Create | `src/app/use-settings.test.ts` | 6 unit tests — no wrapper needed |
| Create | `src/app/use-activity-log.ts` | Activity log state + localStorage lifecycle |
| Create | `src/app/use-activity-log.test.ts` | 6 unit tests — no wrapper needed |
| Modify | `src/app/task-manager.tsx` | Replace ~150 inline lines with two hook calls |
| Modify | `src/app/version.ts` | Bump to 0.7.7 "Elias" |
| Modify | `CHANGELOG.md` | Add [0.7.7] entry |
| Modify | `README.md` | Update version badge |

---

## Context: What Is Being Moved

### From task-manager.tsx — settings block (lines ~247–254 + ~661–729)

```typescript
// State declarations (lines ~247–254)
const [settings, setSettings] = useState<Settings>(defaultSettings);
const [hydrated, setHydrated] = useState(false);
const [i18nReady, setI18nReady] = useState(false);

// Settings load effect (lines ~661–714) — reads SETTINGS_KEY from localStorage,
// merges nested defaults for ai/notifications/jira/holidayCountries, sets hydrated=true,
// calls loadI18n(resolvedLang).finally(() => setI18nReady(true))

// Settings persist effect (lines ~716–719)
useEffect(() => {
  if (!hydrated) return;
  window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}, [settings, hydrated]);

// document.lang effect (lines ~721–729)
useEffect(() => {
  document.documentElement.lang = settings.language;
  void loadI18n(settings.language);
}, [settings.language]);
```

### From task-manager.tsx — activity log block (lines ~259–280)

```typescript
const [activityLog, setActivityLog] = useState<ActivityEntry[]>([]);
const activityLogHydratedRef = useRef(false);
useEffect(() => {
  setActivityLog(loadActivityLog());
  activityLogHydratedRef.current = true;
}, []);
useEffect(() => {
  if (!activityLogHydratedRef.current) return;
  saveActivityLog(activityLog);
}, [activityLog]);
const logActivity = useCallback(
  (kind: ActivityKind, ...args: (string | number)[]) => {
    setActivityLog((prev) => appendActivity(prev, kind, ...args));
  },
  [],
);
const handleClearActivityLog = useCallback(() => {
  if (activityLog.length === 0) return;
  if (!window.confirm(t(settings.language, "confirmClearActivityLog", activityLog.length))) return;
  setActivityLog([]);
  clearActivityLogStorage();
}, [activityLog.length, settings.language]);
```

### Also removed from task-manager.tsx

`const lang = settings.language` at ~line 430 — `lang` now comes from `useSettings`.

### localStorage key

`SETTINGS_KEY = "lop-app:settings"` — currently a module-level const in task-manager.tsx (line ~211). Move it into `use-settings.ts` as a private const.

---

## Task 1: Scaffold use-settings.test.ts (RED)

**Files:**
- Create: `src/app/use-settings.test.ts`

- [ ] **Step 1: Create the test file**

```typescript
// src/app/use-settings.test.ts
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { defaultSettings } from "./settings-menu";
import { useSettings } from "./use-settings";

const SETTINGS_KEY = "lop-app:settings";

beforeEach(() => {
  localStorage.clear();
});

describe("useSettings", () => {
  describe("initial state", () => {
    it("settings equals defaultSettings before effects fire", () => {
      const { result } = renderHook(() => useSettings());
      expect(result.current.settings).toEqual(defaultSettings);
    });

    it("lang equals settings.language", async () => {
      const { result } = renderHook(() => useSettings());
      await act(async () => {});
      expect(result.current.lang).toBe(result.current.settings.language);
    });
  });

  describe("hydration", () => {
    it("hydrated is false initially, true after mount", async () => {
      const { result } = renderHook(() => useSettings());
      expect(result.current.hydrated).toBe(false);
      await act(async () => {});
      expect(result.current.hydrated).toBe(true);
    });

    it("i18nReady is true after mount (en-US resolves synchronously)", async () => {
      const { result } = renderHook(() => useSettings());
      await act(async () => {});
      expect(result.current.i18nReady).toBe(true);
    });

    it("loads and merges saved settings from localStorage on mount", async () => {
      localStorage.setItem(
        SETTINGS_KEY,
        JSON.stringify({ ...defaultSettings, language: "en-GB" }),
      );
      const { result } = renderHook(() => useSettings());
      await act(async () => {});
      expect(result.current.settings.language).toBe("en-GB");
    });
  });

  describe("persistence", () => {
    it("persists settings to localStorage when setSettings is called", async () => {
      const { result } = renderHook(() => useSettings());
      await act(async () => {});
      act(() => {
        result.current.setSettings((s) => ({ ...s, language: "en-GB" as const }));
      });
      const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}") as {
        language?: string;
      };
      expect(stored.language).toBe("en-GB");
    });
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL (module not found)**

```
npx vitest run src/app/use-settings.test.ts --reporter=verbose
```

Expected: FAIL — `Cannot find module './use-settings'`

---

## Task 2: Create use-settings.ts (GREEN)

**Files:**
- Create: `src/app/use-settings.ts`

- [ ] **Step 1: Create the hook**

```typescript
// src/app/use-settings.ts
"use client";

import { type Dispatch, type SetStateAction, useEffect, useState } from "react";
import { type Lang, loadI18n, migrateLang } from "./i18n";
import { defaultSettings, type Settings } from "./settings-menu";
import { isPlainObject } from "./sanitize";

const SETTINGS_KEY = "lop-app:settings";

export function useSettings(): {
  settings: Settings;
  setSettings: Dispatch<SetStateAction<Settings>>;
  hydrated: boolean;
  i18nReady: boolean;
  lang: Lang;
} {
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [hydrated, setHydrated] = useState(false);
  const [i18nReady, setI18nReady] = useState(false);

  // Load settings from localStorage once on mount; lift hydrated + i18nReady gates.
  useEffect(() => {
    let cancelled = false;
    let resolvedLang: Lang = defaultSettings.language;
    try {
      const settingsRaw = window.localStorage.getItem(SETTINGS_KEY);
      if (settingsRaw) {
        const parsed = JSON.parse(settingsRaw);
        if (isPlainObject(parsed)) {
          resolvedLang = migrateLang(
            (parsed as Record<string, unknown>).language,
          );
          setSettings({
            ...defaultSettings,
            ...parsed,
            language: resolvedLang,
            ai: {
              ...defaultSettings.ai,
              ...(isPlainObject(parsed.ai) ? parsed.ai : {}),
            },
            notifications: {
              ...defaultSettings.notifications,
              ...(isPlainObject(parsed.notifications)
                ? parsed.notifications
                : {}),
            },
            jira: {
              ...defaultSettings.jira,
              ...(isPlainObject(parsed.jira) ? parsed.jira : {}),
            },
            holidayCountries: Array.isArray(parsed.holidayCountries)
              ? (parsed.holidayCountries as unknown[]).filter(
                  (v): v is string => typeof v === "string",
                )
              : defaultSettings.holidayCountries,
          });
        }
      }
    } catch {
      // ignore corrupt storage
    }
    setHydrated(true);
    loadI18n(resolvedLang).finally(() => {
      if (!cancelled) setI18nReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Persist settings on every change, guarded by hydration so mount doesn't overwrite.
  useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }, [settings, hydrated]);

  // Sync document language attribute and ensure dict is loaded on mid-session switch.
  useEffect(() => {
    document.documentElement.lang = settings.language;
    void loadI18n(settings.language);
  }, [settings.language]);

  const lang = settings.language;

  return { settings, setSettings, hydrated, i18nReady, lang };
}
```

- [ ] **Step 2: Run tests — expect PASS**

```
npx vitest run src/app/use-settings.test.ts --reporter=verbose
```

Expected: 6 passed

- [ ] **Step 3: Commit**

```
git add src/app/use-settings.ts src/app/use-settings.test.ts
git commit -m "feat(use-settings): extract settings lifecycle hook (GREEN)"
```

---

## Task 3: Scaffold use-activity-log.test.ts (RED)

**Files:**
- Create: `src/app/use-activity-log.test.ts`

- [ ] **Step 1: Create the test file**

```typescript
// src/app/use-activity-log.test.ts
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Lang } from "./i18n";
import { useActivityLog } from "./use-activity-log";

function renderLog(lang: Lang = "en-US" as Lang) {
  return renderHook(() => useActivityLog({ lang }));
}

describe("useActivityLog", () => {
  describe("initial state", () => {
    it("activityLog is empty initially", () => {
      const { result } = renderLog();
      expect(result.current.activityLog).toHaveLength(0);
    });
  });

  describe("logActivity", () => {
    it("logActivity appends an entry", () => {
      const { result } = renderLog();
      act(() => {
        result.current.logActivity("task.created", 1, "Test task");
      });
      expect(result.current.activityLog).toHaveLength(1);
    });

    it("calling logActivity twice appends two entries", () => {
      const { result } = renderLog();
      act(() => {
        result.current.logActivity("task.created", 1, "Task A");
      });
      act(() => {
        result.current.logActivity("task.updated", 1, "Task A");
      });
      expect(result.current.activityLog).toHaveLength(2);
    });
  });

  describe("handleClearActivityLog", () => {
    it("does nothing when log is empty (no window.confirm call)", () => {
      const { result } = renderLog();
      const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
      act(() => {
        result.current.handleClearActivityLog();
      });
      expect(confirmSpy).not.toHaveBeenCalled();
      confirmSpy.mockRestore();
    });

    it("clears log when window.confirm returns true", () => {
      const { result } = renderLog();
      act(() => {
        result.current.logActivity("task.created", 1, "Task A");
      });
      const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
      act(() => {
        result.current.handleClearActivityLog();
      });
      expect(result.current.activityLog).toHaveLength(0);
      confirmSpy.mockRestore();
    });

    it("does NOT clear when window.confirm returns false", () => {
      const { result } = renderLog();
      act(() => {
        result.current.logActivity("task.created", 1, "Task A");
      });
      const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
      act(() => {
        result.current.handleClearActivityLog();
      });
      expect(result.current.activityLog).toHaveLength(1);
      confirmSpy.mockRestore();
    });
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL (module not found)**

```
npx vitest run src/app/use-activity-log.test.ts --reporter=verbose
```

Expected: FAIL — `Cannot find module './use-activity-log'`

---

## Task 4: Create use-activity-log.ts (GREEN)

**Files:**
- Create: `src/app/use-activity-log.ts`

- [ ] **Step 1: Create the hook**

```typescript
// src/app/use-activity-log.ts
"use client";

import { type Dispatch, type SetStateAction, useCallback, useEffect, useRef, useState } from "react";
import {
  appendActivity,
  type ActivityEntry,
  type ActivityKind,
  clearActivityLog as clearActivityLogStorage,
  loadActivityLog,
  saveActivityLog,
} from "./activity-log";
import { type Lang, t } from "./i18n";

export interface UseActivityLogArgs {
  lang: Lang;
}

export function useActivityLog({ lang }: UseActivityLogArgs): {
  activityLog: ActivityEntry[];
  setActivityLog: Dispatch<SetStateAction<ActivityEntry[]>>;
  logActivity: (kind: ActivityKind, ...args: (string | number)[]) => void;
  handleClearActivityLog: () => void;
} {
  const [activityLog, setActivityLog] = useState<ActivityEntry[]>([]);
  const activityLogHydratedRef = useRef(false);

  useEffect(() => {
    setActivityLog(loadActivityLog());
    activityLogHydratedRef.current = true;
  }, []);

  useEffect(() => {
    if (!activityLogHydratedRef.current) return;
    saveActivityLog(activityLog);
  }, [activityLog]);

  const logActivity = useCallback(
    (kind: ActivityKind, ...args: (string | number)[]) => {
      setActivityLog((prev) => appendActivity(prev, kind, ...args));
    },
    [],
  );

  const handleClearActivityLog = useCallback(() => {
    if (activityLog.length === 0) return;
    if (
      !window.confirm(
        t(lang, "confirmClearActivityLog", activityLog.length),
      )
    )
      return;
    setActivityLog([]);
    clearActivityLogStorage();
  }, [activityLog.length, lang]);

  return { activityLog, setActivityLog, logActivity, handleClearActivityLog };
}
```

- [ ] **Step 2: Run tests — expect PASS**

```
npx vitest run src/app/use-activity-log.test.ts --reporter=verbose
```

Expected: 6 passed

- [ ] **Step 3: Run full suite to confirm no regressions**

```
npx vitest run --reporter=verbose 2>&1 | tail -10
```

Expected: all previously-passing tests still pass

- [ ] **Step 4: Commit**

```
git add src/app/use-activity-log.ts src/app/use-activity-log.test.ts
git commit -m "feat(use-activity-log): extract activity log lifecycle hook (GREEN)"
```

---

## Task 5: Refactor task-manager.tsx to consume both hooks

**Files:**
- Modify: `src/app/task-manager.tsx`

**What to do:**

1. Add two imports near the existing hook imports (around line 22–26):
   ```typescript
   import { useSettings } from "./use-settings";
   import { useActivityLog } from "./use-activity-log";
   ```

2. At the top of `TaskManagerInner` (line ~247), **replace** the settings + activity-log state block:

   **Remove** (lines ~247–280):
   ```typescript
   const [settings, setSettings] = useState<Settings>(defaultSettings);
   const [hydrated, setHydrated] = useState(false);
   // ...i18nReady comment...
   const [i18nReady, setI18nReady] = useState(false);

   // Activity log — ...
   const [activityLog, setActivityLog] = useState<ActivityEntry[]>([]);
   const activityLogHydratedRef = useRef(false);
   useEffect(() => {
     setActivityLog(loadActivityLog());
     activityLogHydratedRef.current = true;
   }, []);
   useEffect(() => {
     if (!activityLogHydratedRef.current) return;
     saveActivityLog(activityLog);
   }, [activityLog]);
   const logActivity = useCallback(
     (kind: ActivityKind, ...args: (string | number)[]) => {
       setActivityLog((prev) => appendActivity(prev, kind, ...args));
     },
     [],
   );
   const handleClearActivityLog = useCallback(() => {
     if (activityLog.length === 0) return;
     if (!window.confirm(t(settings.language, "confirmClearActivityLog", activityLog.length))) return;
     setActivityLog([]);
     clearActivityLogStorage();
   }, [activityLog.length, settings.language]);
   ```

   **Add** in their place:
   ```typescript
   const { settings, setSettings, hydrated, i18nReady, lang } = useSettings();
   const { activityLog, setActivityLog, logActivity, handleClearActivityLog } =
     useActivityLog({ lang });
   ```

3. **Remove** the three settings effects (lines ~661–729):
   - The load effect (block starting `// Load settings (synchronous, blocks task hydration)`)
   - The persist effect (`useEffect(() => { if (!hydrated) return; window.localStorage.setItem(SETTINGS_KEY, ...`)
   - The document.lang effect (`useEffect(() => { document.documentElement.lang = ...`)

4. **Remove** `const lang = settings.language` at ~line 430 (`lang` now comes from `useSettings`).

5. **Remove** the now-unused imports and constants from task-manager.tsx:
   - Remove `const SETTINGS_KEY = "lop-app:settings"` at ~line 211
   - Remove `defaultSettings` from the `settings-menu` import (verify no other usage first)
   - Remove `isPlainObject` from the `sanitize` import (only used in settings block)
   - Remove `migrateLang` from the `./i18n` import (only used in settings block)
   - Remove `loadI18n` from the `./i18n` import (only used in settings block)
   - Remove `appendActivity`, `type ActivityEntry`, `type ActivityKind`, `clearActivityLog as clearActivityLogStorage`, `loadActivityLog`, `saveActivityLog` from the `./activity-log` import

- [ ] **Step 1: Make the edits described above**

- [ ] **Step 2: Run TypeScript check**

```
npx tsc --noEmit 2>&1 | head -30
```

Expected: no errors. If unused-import errors appear, remove those specific imports.

- [ ] **Step 3: Run full test suite**

```
npx vitest run --reporter=verbose 2>&1 | tail -15
```

Expected: all tests pass (149 total: 137 previous + 12 new)

- [ ] **Step 4: Commit**

```
git add src/app/task-manager.tsx
git commit -m "refactor(task-manager): consume useSettings + useActivityLog"
```

---

## Task 6: Version bump v0.7.7 "Elias"

**Files:**
- Modify: `src/app/version.ts`
- Modify: `CHANGELOG.md`
- Modify: `README.md`

- [ ] **Step 1: Update version.ts**

At the top of the comment block, add:
```
// 0.7.7 extracts useSettings (~100 LoC) and useActivityLog (~50 LoC) from
// task-manager.tsx. Slice 9 of the decomposition: useSettings owns settings
// state, localStorage load/persist, i18n loading, and the hydrated + i18nReady
// gates. useActivityLog owns activityLog state, localStorage load/persist,
// logActivity, and handleClearActivityLog. 12 new unit tests. task-manager.tsx
// ~−150 lines; now ~2,145 lines.
```

Update the exports at the bottom:
```typescript
export const APP_VERSION = "0.7.7";
export const APP_BUILD_DATE = "2026-05-20";
```

- [ ] **Step 2: Update CHANGELOG.md**

Replace the `## [Unreleased]` section with:
```markdown
## [Unreleased]

_No unreleased changes._

## [0.7.7] "Elias" — 2026-05-20

### Refactored
- Extracted `useSettings` hook (~100 lines): settings state, localStorage load/persist, `hydrated` + `i18nReady` gates, i18n loading
- Extracted `useActivityLog` hook (~50 lines): activity log state, localStorage load/persist, `logActivity`, `handleClearActivityLog`
- `task-manager.tsx` ~−150 lines; now ~2,145 lines

### Tests
- `use-settings.test.ts`: 6 tests — initial state, hydration gates, localStorage load/persist
- `use-activity-log.test.ts`: 6 tests — state-init, logActivity append, handleClearActivityLog confirm variants
```

- [ ] **Step 3: Update README.md**

Change `**v0.7.6**` to `**v0.7.7**`.

- [ ] **Step 4: Run full test suite one final time**

```
npx vitest run --reporter=verbose 2>&1 | tail -10
```

Expected: all tests pass

- [ ] **Step 5: Commit**

```
git add src/app/version.ts CHANGELOG.md README.md
git commit -m "release(v0.7.7): Elias - useSettings + useActivityLog extraction"
```
