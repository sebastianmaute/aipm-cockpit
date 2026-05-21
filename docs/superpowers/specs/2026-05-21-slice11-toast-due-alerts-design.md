# Slice 11 — useToast + useDueAlerts Design

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extract two in-memory notification hooks from `task-manager.tsx`, removing ~48 lines of inline state, effects, and a helper function, replacing them with two focused, independently testable hooks.

**Architecture:** Two plain hooks (no context providers), following the pattern of slices 5–10. `useToast` is zero-arg and owns the transient toast state, `showToast` factory, and auto-dismiss timer. `useDueAlerts` takes `{ hydrated, tasks, holidaySet, settings, today, showToast }` and owns the banner/modal state, the session-once ref, and the due-date alert effect. `showToast` flows from `useToast` → `task-manager.tsx` destructuring → passed into `useDueAlerts` and all existing call sites.

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

## Hook Interfaces

### `useToast`

```typescript
// src/app/use-toast.ts
export function useToast(): {
  toast: { kind: "info" | "error"; text: string; id: number } | null;
  showToast: (kind: "info" | "error", text: string) => void;
}
```

Internally owns:
- `useState` for `toast` (init `null`)
- **Auto-dismiss effect** (deps `[toast?.id]`): `setTimeout(4000)` → `setToast(null)`, cleanup clears timer
- **`showToast`**: `useCallback` with `[]` deps — `setToast({ kind, text, id: Date.now() })`. Stable identity is required because `showToast` is passed into `useDueAlerts` and read inside an effect; without `useCallback` the `exhaustive-deps` rule would flag it as a missing dependency.

### `useDueAlerts`

```typescript
// src/app/use-due-alerts.ts
export interface UseDueAlertsArgs {
  hydrated: boolean;
  tasks: Task[];
  holidaySet: Set<string>;
  settings: Settings;
  today: string;
  showToast: (kind: "info" | "error", text: string) => void;
}

export function useDueAlerts(args: UseDueAlertsArgs): {
  bannerDismissed: boolean;
  setBannerDismissed: React.Dispatch<React.SetStateAction<boolean>>;
  dueModalOpen: boolean;
  setDueModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
}
```

Internally owns:
- `useState` for `bannerDismissed` (init `false`), `dueModalOpen` (init `false`)
- `useRef` for `notifiedThisSessionRef` (init `false`)
- **Session-once alert effect** (deps `[hydrated, tasks, holidaySet]`): guards on `hydrated` + ref, reads `settings.notifications` toast/popup config, calls `getAlertableTasks`, fires `showToast` and/or `setDueModalOpen(true)` as configured

---

## task-manager.tsx Changes

### Add imports (near existing hook imports)

```typescript
import { useDueAlerts } from "./use-due-alerts";
import { useToast } from "./use-toast";
```

### Replace inline blocks with two hook calls

**Remove** (~48 lines):
- `const [toast, setToast] = useState<...>(null)` + auto-dismiss effect
- `const [bannerDismissed, setBannerDismissed] = useState(false)`
- `const [dueModalOpen, setDueModalOpen] = useState(false)`
- `const notifiedThisSessionRef = useRef(false)`
- Session-once due-date alert effect (deps `[hydrated, tasks, holidaySet]`)
- `function showToast(kind, text) { ... }`

**Add** (immediately after `const { activityLog, ... } = useActivityLog({ lang })`):

```typescript
const { toast, showToast } = useToast();
const { bannerDismissed, setBannerDismissed, dueModalOpen, setDueModalOpen } =
  useDueAlerts({ hydrated, tasks, holidaySet, settings, today, showToast });
```

### Remove now-unused imports

`dueAlertsToastText` moves into `use-due-alerts.ts` — remove it from the `./notifications` import in `task-manager.tsx` if no longer referenced directly there.

---

## Tests

### `use-toast.test.ts` (4 tests, no wrapper needed)

1. `toast` is `null` initially
2. `showToast("info", "hello")` sets `toast` with correct `kind` and `text`
3. Auto-dismiss — `vi.useFakeTimers()`, advance 4000ms, `toast` becomes `null`
4. Calling `showToast` twice resets the timer (new `id` → effect re-fires, old timer cancelled)

### `use-due-alerts.test.ts` (4 tests, no wrapper needed)

1. `bannerDismissed` is `false` and `dueModalOpen` is `false` initially
2. Does NOT fire when `hydrated=false` (showToast mock not called, dueModalOpen stays false)
3. With `hydrated=true` + alertable tasks + `toast.enabled=true`: calls `showToast` once
4. With `hydrated=true` + alertable tasks + `popup.enabled=true`: sets `dueModalOpen=true`

Tests use `vi.fn()` for `showToast` mock and minimal `Settings` + `Task` fixtures.

---

## Version

- `APP_VERSION` → `"0.7.9"`
- `APP_BUILD_DATE` → `"2026-05-21"`
- Codename: **"García"**
- CHANGELOG entry: `[0.7.9] "García" — 2026-05-21`
- README badge: v0.7.8 → v0.7.9
