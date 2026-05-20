# Slice 9 — useSettings + useActivityLog Design

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extract `useSettings` and `useActivityLog` from `task-manager.tsx`, removing ~150 lines of inline state and effects and replacing them with two focused, independently testable hooks.

**Architecture:** Two plain hooks (no context providers), following the pattern of slices 5–8. `useSettings` is zero-arg and owns the full settings lifecycle (load, persist, i18n). `useActivityLog` takes `{ lang }` and owns the activity log lifecycle (load, persist, logActivity, handleClearActivityLog). `task-manager.tsx` replaces ~150 inline lines with two hook calls.

**Tech Stack:** React 19, TypeScript, Vitest 3, @testing-library/react 16, localStorage

---

## Files

| Action | Path |
|--------|------|
| Create | `src/app/use-settings.ts` |
| Create | `src/app/use-settings.test.ts` |
| Create | `src/app/use-activity-log.ts` |
| Create | `src/app/use-activity-log.test.ts` |
| Modify | `src/app/task-manager.tsx` |
| Modify | `src/app/version.ts` |
| Modify | `CHANGELOG.md` |
| Modify | `README.md` |

---

## Hook Interfaces

### `useSettings`

```typescript
// src/app/use-settings.ts
export function useSettings(): {
  settings: Settings;
  setSettings: React.Dispatch<React.SetStateAction<Settings>>;
  hydrated: boolean;   // true after localStorage read on mount
  i18nReady: boolean;  // true after loadI18n resolves; gates JSX render
  lang: Lang;          // derived: settings.language
}
```

Internally owns:
- `useState` for `settings` (initialised to `defaultSettings`), `hydrated` (false), `i18nReady` (false)
- **Mount effect** (runs once): reads `SETTINGS_KEY` from localStorage, merges nested defaults for `ai`, `notifications`, `jira`, `holidayCountries`, calls `migrateLang`, calls `setSettings`, sets `hydrated = true`, calls `loadI18n(resolvedLang).finally(() => setI18nReady(true))`
- **Persist effect**: writes `SETTINGS_KEY` when `settings` changes, guarded by `hydrated`
- **document.lang effect**: sets `document.documentElement.lang` and calls `void loadI18n(settings.language)` when `settings.language` changes
- Derives `lang = settings.language` as an inline `const` (no memo)

### `useActivityLog`

```typescript
// src/app/use-activity-log.ts
export interface UseActivityLogArgs {
  lang: Lang;
}

export function useActivityLog({ lang }: UseActivityLogArgs): {
  activityLog: ActivityEntry[];
  setActivityLog: React.Dispatch<React.SetStateAction<ActivityEntry[]>>;
  logActivity: (kind: ActivityKind, ...args: (string | number)[]) => void;
  handleClearActivityLog: () => void;
}
```

Internally owns:
- `useState` for `activityLog` (initialised to `[]`)
- `useRef` for `activityLogHydratedRef` (initialised to `false`)
- **Mount effect**: calls `setActivityLog(loadActivityLog())`, sets ref to `true`
- **Persist effect**: calls `saveActivityLog(activityLog)` when `activityLog` changes, guarded by `activityLogHydratedRef.current`
- **`logActivity`**: `useCallback` with `[]` deps — calls `setActivityLog(prev => appendActivity(prev, kind, ...args))`
- **`handleClearActivityLog`**: `useCallback` with `[activityLog.length, lang]` deps — guards on `activityLog.length === 0` (no-op), calls `window.confirm(t(lang, "confirmClearActivityLog", activityLog.length))`, on true: calls `setActivityLog([])` + `clearActivityLogStorage()`
- `setActivityLog` is exposed because `useStorageBackend` calls it directly to overwrite the log on workspace import

---

## task-manager.tsx changes

Replace the following inline blocks with two hook calls (placed immediately after the existing context hook calls):

**Remove** (~150 lines):
- `const [settings, setSettings] = useState<Settings>(defaultSettings)`
- `const [hydrated, setHydrated] = useState(false)`
- `const [i18nReady, setI18nReady] = useState(false)`
- `const [activityLog, setActivityLog] = useState<ActivityEntry[]>([])`
- `const activityLogHydratedRef = useRef(false)`
- All five associated `useEffect` calls (settings load, settings persist, document.lang, activity log load, activity log persist)
- `const logActivity = useCallback(...)`
- `const handleClearActivityLog = useCallback(...)`

**Add**:
```typescript
const { settings, setSettings, hydrated, i18nReady, lang } = useSettings();
const { activityLog, setActivityLog, logActivity, handleClearActivityLog } =
  useActivityLog({ lang });
```

The inline `const lang = settings.language` line (currently at ~line 430) is also removed — `lang` now comes from `useSettings`.

---

## Tests

### `use-settings.test.ts` (no wrapper needed — hook uses no context)

1. `settings` equals `defaultSettings` before mount effects fire
2. `hydrated` is false before mount, true after mount
3. `i18nReady` is true after mount (en-US resolves synchronously)
4. `lang` equals `settings.language`
5. After mount, `localStorage.setItem` is called with `SETTINGS_KEY` when `setSettings` is called
6. On mount, loads and merges saved settings from localStorage (pre-seeded before render)
7. Changing `settings.language` via `setSettings` calls `loadI18n` with the new language

### `use-activity-log.test.ts` (no wrapper needed)

1. `activityLog` is empty initially
2. `logActivity` appends an entry (length becomes 1)
3. calling `logActivity` twice appends two entries
4. `handleClearActivityLog` does nothing when log is empty (no `window.confirm` call)
5. `handleClearActivityLog` clears log when `window.confirm` returns `true`
6. `handleClearActivityLog` does NOT clear when `window.confirm` returns `false`

---

## Version

- `APP_VERSION` → `"0.7.7"`
- `APP_BUILD_DATE` → `"2026-05-20"`
- Codename: **"Elias"**
- CHANGELOG entry: `[0.7.7] "Elias" — 2026-05-20`
- README badge: v0.7.6 → v0.7.7
