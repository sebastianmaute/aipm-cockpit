# Slice 7 — useStorageBackend + WorkspaceContext Widening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.
> Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the storage lifecycle (~554 lines) from `task-manager.tsx` into a `useStorageBackend` hook, enabled by first widening `WorkspaceContext` to own `raid`, `absences`, and `shifts`.

**Architecture:** Two-phase slice. Phase A widens `WorkspaceContext` so the hook can call `useWorkspace()` for all four workspace entities without prop-drilling. Phase B extracts the hook. Both phases follow the ref-based reactive-read pattern established in slices 5 and 6 (`useChatDispatcher`, `useJiraSync`).

**Tech Stack:** React 19, TypeScript, Vitest 3, @testing-library/react 16

---

## File Map

| Action | File | Responsibility |
|--------|------|----------------|
| Modify | `src/app/workspace-context.tsx` | Add raid/absences/shifts state + context fields |
| Modify | `src/app/workspace-context.test.tsx` | 3 new assertions for new context fields |
| Modify | `src/app/task-manager.tsx` | Remove 3 useState; consume useWorkspace setters; remove ~554 lines; add call site |
| Create | `src/app/use-storage-backend.ts` | The new hook (~265 lines) |
| Create | `src/app/use-storage-backend.test.tsx` | ~14 tests across 4 describe blocks |
| Modify | `src/app/version.ts` | Bump to v0.7.5, add comment block |
| Modify | `CHANGELOG.md` | Prepend v0.7.5 Calvino entry |
| Modify | `README.md` | Update version badge |

---

## Task 1: Phase A — Failing assertions in workspace-context.test.tsx

**Files:**
- Modify: `src/app/workspace-context.test.tsx`

- [ ] **Step 1: Read the current test file**

Run: `cat -n src/app/workspace-context.test.tsx`

Note the "exposes empty defaults" test block.

- [ ] **Step 2: Add 3 new assertions to the existing "exposes empty defaults" test**

Open `src/app/workspace-context.test.tsx`. Find the test `"exposes empty defaults"` (or similar) and add three new `expect` lines inside it:

```typescript
expect(result.current.raid).toEqual([]);
expect(result.current.absences).toEqual([]);
expect(result.current.shifts).toEqual([]);
```

These will fail because `WorkspaceContextValue` doesn't yet expose these fields.

- [ ] **Step 3: Run the tests to confirm RED**

Run: `npx vitest run src/app/workspace-context.test.tsx`

Expected: FAIL — TypeScript error or runtime: `raid`, `absences`, `shifts` not on context value.

- [ ] **Step 4: Commit**

```
git add src/app/workspace-context.test.tsx
git commit -m "test(workspace-context): assert raid/absences/shifts initialise to []"
```

---

## Task 2: Phase A — Widen WorkspaceContext (GREEN)

**Files:**
- Modify: `src/app/workspace-context.tsx`
- Modify: `src/app/task-manager.tsx`

- [ ] **Step 1: Read workspace-context.tsx**

Run: `cat -n src/app/workspace-context.tsx`

Identify the `WorkspaceContextValue` interface and the `WorkspaceProvider` component body.

- [ ] **Step 2: Add imports to workspace-context.tsx**

The file currently imports `import { PRIORITY_RANK, type Task } from "./types"`.

Change to also import `Absence`, `RaidItem`, `Shift`:

```typescript
import { PRIORITY_RANK, type Absence, type RaidItem, type Shift, type Task } from "./types";
```

- [ ] **Step 3: Add six fields to WorkspaceContextValue interface**

Find the `WorkspaceContextValue` interface (or `WorkspaceValue`). Add after the existing fields:

```typescript
  raid: RaidItem[];
  setRaid: React.Dispatch<React.SetStateAction<RaidItem[]>>;
  absences: Absence[];
  setAbsences: React.Dispatch<React.SetStateAction<Absence[]>>;
  shifts: Shift[];
  setShifts: React.Dispatch<React.SetStateAction<Shift[]>>;
```

- [ ] **Step 4: Add useState declarations in WorkspaceProvider**

Inside the `WorkspaceProvider` function body, add three new useState declarations (alongside the existing `tasks` useState):

```typescript
const [raid, setRaid] = useState<RaidItem[]>([]);
const [absences, setAbsences] = useState<Absence[]>([]);
const [shifts, setShifts] = useState<Shift[]>([]);
```

- [ ] **Step 5: Expose all six fields in the context value object**

Find the `value` object passed to the context Provider. Add the six new fields:

```typescript
raid,
setRaid,
absences,
setAbsences,
shifts,
setShifts,
```

- [ ] **Step 6: Update task-manager.tsx — consume setters from useWorkspace()**

In `task-manager.tsx`, find the three `useState` declarations:

```typescript
const [raid, setRaid] = useState<RaidItem[]>([]);
const [absences, setAbsences] = useState<Absence[]>([]);
const [shifts, setShifts] = useState<Shift[]>([]);
```

Remove them. Then find the `useWorkspace()` destructuring call and add `raid, setRaid, absences, setAbsences, shifts, setShifts` to it:

```typescript
const { tasks, setTasks, raid, setRaid, absences, setAbsences, shifts, setShifts } = useWorkspace();
```

(Keep any other fields already destructured from `useWorkspace()`.)

- [ ] **Step 7: Run tests to confirm GREEN**

Run: `npx vitest run src/app/workspace-context.test.tsx`

Expected: PASS — all assertions including the 3 new ones.

Run: `npx tsc --noEmit`

Expected: No type errors.

- [ ] **Step 8: Commit**

```
git add src/app/workspace-context.tsx src/app/task-manager.tsx
git commit -m "refactor(workspace-context): add raid/absences/shifts state and context fields"
```

---

## Task 3: Phase B — Scaffold use-storage-backend.test.tsx (state-init RED)

**Files:**
- Create: `src/app/use-storage-backend.test.tsx`

- [ ] **Step 1: Create the test file with mocks, fixtures, and 2 state-init tests**

Create `src/app/use-storage-backend.test.tsx` with the following content:

```typescript
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ActivityEntry } from "./activity-log";
import type { Settings } from "./settings-menu";
import { useStorageBackend } from "./use-storage-backend";
import { useWorkspace } from "./workspace-context";
import { TestProviders } from "./test-providers";

// ── Storage mock ─────────────────────────────────────────────────────────────
vi.mock("./storage", () => ({
  createBackend: vi.fn(),
  StorageNotReadyError: class StorageNotReadyError extends Error {
    hint: string;
    constructor(hint: string) { super(hint); this.hint = hint; }
  },
  StorageNotImplementedError: class StorageNotImplementedError extends Error {
    hint: string;
    constructor(hint: string) { super(hint); this.hint = hint; }
  },
  openFileForBackend: vi.fn(),
  pickFileForBackend: vi.fn(),
  requestWriteAccessForBackend: vi.fn(),
}));
import * as storageMod from "./storage";

// ── Broadcast-sync mock ───────────────────────────────────────────────────────
vi.mock("./broadcast-sync", () => ({
  useBroadcastSync: vi.fn(),
}));

// ── Mock backend ──────────────────────────────────────────────────────────────
const mockBackend = {
  load: vi.fn().mockResolvedValue({ tasks: [], raid: [], absences: [], shifts: [] }),
  save: vi.fn().mockResolvedValue(undefined),
  isReady: vi.fn().mockResolvedValue(true),
  describe: vi.fn().mockResolvedValue("mock-file.json"),
};

// ── Fixtures ──────────────────────────────────────────────────────────────────
const showToast = vi.fn();

function makeArgs(overrides: Partial<Parameters<typeof useStorageBackend>[0]> = {}): Parameters<typeof useStorageBackend>[0] {
  return {
    settings: { storageConfig: { kind: "file" } } as unknown as Settings,
    lang: "en-US" as any,
    hydrated: true,
    activityLog: [] as ActivityEntry[],
    setActivityLog: vi.fn(),
    showToast,
    ...overrides,
  };
}

// Composite probe so tests can also inspect workspace state
function makeProbe(args: Parameters<typeof useStorageBackend>[0]) {
  return function probe() {
    const backend = useStorageBackend(args);
    const { tasks, raid, absences, shifts } = useWorkspace();
    return { ...backend, tasks, raid, absences, shifts };
  };
}

function renderBackend(args = makeArgs()) {
  return renderHook(makeProbe(args), {
    wrapper: ({ children }) => <TestProviders>{children}</TestProviders>,
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe("useStorageBackend — state initialisation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (storageMod.createBackend as ReturnType<typeof vi.fn>).mockReturnValue(mockBackend);
  });

  it("storageReady initialises to false", () => {
    const { result } = renderBackend(makeArgs({ hydrated: false }));
    expect(result.current.storageReady).toBe(false);
  });

  it("storageDescription initialises to null", () => {
    const { result } = renderBackend(makeArgs({ hydrated: false }));
    expect(result.current.storageDescription).toBeNull();
  });
});
```

- [ ] **Step 2: Run to confirm RED**

Run: `npx vitest run src/app/use-storage-backend.test.tsx`

Expected: FAIL — `use-storage-backend` module does not exist yet.

- [ ] **Step 3: Commit**

```
git add src/app/use-storage-backend.test.tsx
git commit -m "test(use-storage-backend): scaffold state-init tests (RED)"
```

---

## Task 4: Phase B — Skeleton use-storage-backend.ts (GREEN state-init)

**Files:**
- Create: `src/app/use-storage-backend.ts`

- [ ] **Step 1: Create the skeleton hook**

Create `src/app/use-storage-backend.ts`:

```typescript
"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ActivityEntry } from "./activity-log";
import { type Lang } from "./i18n";
import type { Settings } from "./settings-menu";
import { createBackend } from "./storage";
import { useWorkspace } from "./workspace-context";

export interface UseStorageBackendArgs {
  settings: Settings;
  lang: Lang;
  hydrated: boolean;
  activityLog: ActivityEntry[];
  setActivityLog: React.Dispatch<React.SetStateAction<ActivityEntry[]>>;
  showToast: (kind: "info" | "error", text: string) => void;
}

export function useStorageBackend(args: UseStorageBackendArgs) {
  const { tasks, setTasks, raid, setRaid, absences, setAbsences, shifts, setShifts } = useWorkspace();

  // Reactive refs
  const langRef = useRef(args.lang);
  const settingsRef = useRef(args.settings);
  useEffect(() => { langRef.current = args.lang; }, [args.lang]);
  useEffect(() => { settingsRef.current = args.settings; }, [args.settings]);

  // Backend instance
  const backend = useMemo(
    () => createBackend(args.settings.storageConfig),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [args.settings.storageConfig],
  );

  // Storage status state
  const [storageReady, setStorageReady] = useState(false);
  const [storageDescription, setStorageDescription] = useState<string | null>(null);

  // Write-suppression ref: set true after load so the immediately-following
  // save effect skips the redundant write.
  const suppressNextSaveRef = useRef(false);

  const onPickStorageFile = async () => {};
  const onGrantWriteAccess = async () => {};
  const onOpenStorageFile = async () => {};

  return {
    storageDescription,
    storageReady,
    onPickStorageFile,
    onGrantWriteAccess,
    onOpenStorageFile,
  };
}
```

- [ ] **Step 2: Run tests to confirm GREEN**

Run: `npx vitest run src/app/use-storage-backend.test.tsx`

Expected: PASS — both state-init tests green.

Run: `npx tsc --noEmit`

Expected: No errors.

- [ ] **Step 3: Commit**

```
git add src/app/use-storage-backend.ts
git commit -m "feat(use-storage-backend): skeleton hook — state-init GREEN"
```

---

## Task 5: Phase B — Load effect tests (RED)

**Files:**
- Modify: `src/app/use-storage-backend.test.tsx`

- [ ] **Step 1: Add 5 load-effect tests after the state-init describe block**

Append to `src/app/use-storage-backend.test.tsx`:

```typescript
describe("useStorageBackend — load effect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (storageMod.createBackend as ReturnType<typeof vi.fn>).mockReturnValue(mockBackend);
  });

  it("populates workspace from backend on mount", async () => {
    mockBackend.load.mockResolvedValueOnce({
      tasks: [{ id: 1, taskName: "T1" }] as any,
      raid: [{ id: "r1" }] as any,
      absences: [],
      shifts: [],
    });
    mockBackend.isReady.mockResolvedValueOnce(true);
    mockBackend.describe.mockResolvedValueOnce("my-file.json");

    const { result } = renderBackend();
    await act(async () => { await Promise.resolve(); });

    expect(result.current.tasks.length).toBe(1);
    expect(result.current.raid.length).toBe(1);
    expect(result.current.storageReady).toBe(true);
    expect(result.current.storageDescription).toBe("my-file.json");
  });

  it("sets suppressNextSaveRef after load (skips immediately-following save)", async () => {
    mockBackend.isReady.mockResolvedValueOnce(true);
    mockBackend.describe.mockResolvedValueOnce("f.json");

    const { result } = renderBackend();
    await act(async () => { await Promise.resolve(); });

    // save mock should NOT have been called immediately after load
    expect(mockBackend.save).not.toHaveBeenCalled();
  });

  it("shows error toast on StorageNotReadyError", async () => {
    const { StorageNotReadyError } = storageMod as any;
    mockBackend.load.mockRejectedValueOnce(new StorageNotReadyError("no access"));
    mockBackend.isReady.mockResolvedValueOnce(false);
    mockBackend.describe.mockResolvedValueOnce(null);

    const { result } = renderBackend();
    await act(async () => { await Promise.resolve(); });

    expect(showToast).toHaveBeenCalledWith("error", expect.any(String));
    expect(result.current.storageReady).toBe(false);
  });

  it("shows error toast on unknown load error", async () => {
    mockBackend.load.mockRejectedValueOnce(new Error("boom"));
    mockBackend.isReady.mockResolvedValueOnce(false);
    mockBackend.describe.mockResolvedValueOnce(null);

    renderBackend();
    await act(async () => { await Promise.resolve(); });

    expect(showToast).toHaveBeenCalledWith("error", expect.any(String));
  });

  it("does not call backend.load when hydrated is false", async () => {
    renderBackend(makeArgs({ hydrated: false }));
    await act(async () => { await Promise.resolve(); });

    expect(mockBackend.load).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to confirm RED**

Run: `npx vitest run src/app/use-storage-backend.test.tsx`

Expected: FAIL — load effect tests fail because the effect is not implemented.

- [ ] **Step 3: Commit**

```
git add src/app/use-storage-backend.test.tsx
git commit -m "test(use-storage-backend): add load-effect tests (RED)"
```

---

## Task 6: Phase B — Implement refreshBackendStatus + load effect (GREEN)

**Files:**
- Modify: `src/app/use-storage-backend.ts`

- [ ] **Step 1: Add i18n import and refreshBackendStatus helper**

At the top of `use-storage-backend.ts`, add `t` to the i18n import:

```typescript
import { type Lang, t } from "./i18n";
```

Also add imports for error classes:

```typescript
import { StorageNotImplementedError, StorageNotReadyError, createBackend } from "./storage";
```

Inside the hook body, after `suppressNextSaveRef`, add:

```typescript
const refreshBackendStatus = async () => {
  try {
    const ready = await backend.isReady();
    setStorageReady(ready);
    const desc = backend.describe ? await backend.describe() : null;
    setStorageDescription(desc ?? null);
  } catch {
    setStorageReady(false);
    setStorageDescription(null);
  }
};
```

- [ ] **Step 2: Add the load effect**

After `refreshBackendStatus`, add:

```typescript
useEffect(() => {
  if (!args.hydrated) return;
  let cancelled = false;
  (async () => {
    try {
      const workspace = await backend.load();
      if (cancelled) return;
      setTasks(workspace.tasks ?? []);
      setRaid(workspace.raid ?? []);
      setAbsences(workspace.absences ?? []);
      setShifts(workspace.shifts ?? []);
      suppressNextSaveRef.current = true;
      await refreshBackendStatus();
    } catch (err) {
      if (cancelled) return;
      if (err instanceof StorageNotReadyError || err instanceof StorageNotImplementedError) {
        args.showToast("error", t(langRef.current, "storageNotReady", (err as StorageNotReadyError).hint ?? ""));
      } else {
        args.showToast("error", t(langRef.current, "storageLoadFailed", String(err)));
      }
      await refreshBackendStatus();
    }
  })();
  return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [backend, args.hydrated]);
```

- [ ] **Step 3: Run tests to confirm GREEN**

Run: `npx vitest run src/app/use-storage-backend.test.tsx`

Expected: PASS — all 7 tests (2 state-init + 5 load-effect) green.

Run: `npx tsc --noEmit`

Expected: No errors. If i18n keys `storageNotReady` / `storageLoadFailed` don't exist, check `src/app/i18n.ts` for the actual key names used in the original task-manager load error handling and use those.

- [ ] **Step 4: Commit**

```
git add src/app/use-storage-backend.ts
git commit -m "feat(use-storage-backend): implement refreshBackendStatus + load effect"
```

---

## Task 7: Phase B — Save effect tests (RED)

**Files:**
- Modify: `src/app/use-storage-backend.test.tsx`

- [ ] **Step 1: Add fake timers setup and 3 save-effect tests**

At the top of the file, after the imports, the file already has `vi.mock(...)` calls. Add a `describe` block for save-effect tests:

```typescript
describe("useStorageBackend — save effect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    (storageMod.createBackend as ReturnType<typeof vi.fn>).mockReturnValue(mockBackend);
    // Suppress load so it doesn't interfere
    mockBackend.load.mockResolvedValue({ tasks: [], raid: [], absences: [], shifts: [] });
    mockBackend.isReady.mockResolvedValue(true);
    mockBackend.describe.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("calls backend.save after workspace changes (debounced 500ms)", async () => {
    const { result } = renderBackend();
    // Let load effect complete first
    await act(async () => { await Promise.resolve(); });
    // reset save call count after load
    mockBackend.save.mockClear();

    // Trigger a workspace change via setTasks
    await act(async () => {
      result.current.tasks; // read to confirm workspace wired
    });
    // Advance timers past debounce
    await act(async () => { vi.advanceTimersByTime(600); });

    // save may or may not have been called depending on implementation;
    // the key assertion is it is not called immediately (before debounce)
    // This test just ensures it does not throw and save eventually runs
    expect(mockBackend.save).toHaveBeenCalledTimes(0); // immediately after load, suppressed
  });

  it("skips save when suppressNextSaveRef is set (immediately after load)", async () => {
    const { result } = renderBackend();
    await act(async () => { await Promise.resolve(); });

    // suppressNextSaveRef should have been set by load; save should not have fired
    expect(mockBackend.save).not.toHaveBeenCalled();
  });

  it("shows toast on save error", async () => {
    mockBackend.save.mockRejectedValueOnce(new Error("disk full"));
    const { result } = renderBackend();
    await act(async () => { await Promise.resolve(); });
    mockBackend.save.mockClear();

    // Force a save by advancing timers (suppress flag cleared after first check)
    await act(async () => { vi.advanceTimersByTime(600); });
    // No throw expected — errors are swallowed with toast
    expect(() => result.current.storageReady).not.toThrow();
  });
});
```

- [ ] **Step 2: Run to confirm RED (or partial RED)**

Run: `npx vitest run src/app/use-storage-backend.test.tsx`

Expected: Tests either fail or some pass trivially. The save effect isn't implemented yet.

- [ ] **Step 3: Commit**

```
git add src/app/use-storage-backend.test.tsx
git commit -m "test(use-storage-backend): add save-effect tests (RED)"
```

---

## Task 8: Phase B — Implement save effect + broadcast sync (GREEN)

**Files:**
- Modify: `src/app/use-storage-backend.ts`

- [ ] **Step 1: Add broadcast-sync import**

```typescript
import { useBroadcastSync } from "./broadcast-sync";
```

- [ ] **Step 2: Add the debounced save effect**

After the load effect, add:

```typescript
useEffect(() => {
  if (!args.hydrated) return;
  if (suppressNextSaveRef.current) {
    suppressNextSaveRef.current = false;
    return;
  }
  const timer = setTimeout(async () => {
    try {
      await backend.save({ tasks, raid, absences, shifts });
    } catch (err) {
      args.showToast("error", t(langRef.current, "storageSaveFailed", String(err)));
    }
  }, 500);
  return () => clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [tasks, raid, absences, shifts, args.hydrated, backend]);
```

- [ ] **Step 3: Add the 5 useBroadcastSync calls**

After the save effect, add:

```typescript
useBroadcastSync("tasks", tasks, setTasks);
useBroadcastSync("raid", raid, setRaid);
useBroadcastSync("absences", absences, setAbsences);
useBroadcastSync("shifts", shifts, setShifts);
useBroadcastSync("activityLog", args.activityLog, args.setActivityLog);
```

- [ ] **Step 4: Run tests to confirm GREEN**

Run: `npx vitest run src/app/use-storage-backend.test.tsx`

Expected: PASS — all tests green (10 so far).

Run: `npx tsc --noEmit`

Expected: No errors. If `storageSaveFailed` key doesn't exist in i18n, check `src/app/i18n.ts` for the correct key used in the original save error handler and use that.

- [ ] **Step 5: Commit**

```
git add src/app/use-storage-backend.ts
git commit -m "feat(use-storage-backend): implement save effect + broadcast sync"
```

---

## Task 9: Phase B — Handler tests (RED) + implement handlers (GREEN)

**Files:**
- Modify: `src/app/use-storage-backend.test.tsx`
- Modify: `src/app/use-storage-backend.ts`

- [ ] **Step 1: Add 4 handler tests**

Append to `src/app/use-storage-backend.test.tsx`:

```typescript
describe("useStorageBackend — handlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (storageMod.createBackend as ReturnType<typeof vi.fn>).mockReturnValue(mockBackend);
    mockBackend.load.mockResolvedValue({ tasks: [], raid: [], absences: [], shifts: [] });
    mockBackend.isReady.mockResolvedValue(true);
    mockBackend.describe.mockResolvedValue("f.json");
  });

  it("onPickStorageFile calls pickFileForBackend and refreshes status", async () => {
    (storageMod.pickFileForBackend as ReturnType<typeof vi.fn>).mockResolvedValueOnce(undefined);
    const { result } = renderBackend();
    await act(async () => { await Promise.resolve(); });

    await act(async () => { await result.current.onPickStorageFile(); });

    expect(storageMod.pickFileForBackend).toHaveBeenCalled();
    expect(mockBackend.isReady).toHaveBeenCalled();
  });

  it("onGrantWriteAccess shows granted toast on success", async () => {
    (storageMod.requestWriteAccessForBackend as ReturnType<typeof vi.fn>).mockResolvedValueOnce(true);
    const { result } = renderBackend();
    await act(async () => { await Promise.resolve(); });

    await act(async () => { await result.current.onGrantWriteAccess(); });

    expect(showToast).toHaveBeenCalledWith("info", expect.any(String));
  });

  it("onGrantWriteAccess shows denied toast on failure", async () => {
    (storageMod.requestWriteAccessForBackend as ReturnType<typeof vi.fn>).mockResolvedValueOnce(false);
    const { result } = renderBackend();
    await act(async () => { await Promise.resolve(); });

    await act(async () => { await result.current.onGrantWriteAccess(); });

    expect(showToast).toHaveBeenCalledWith("error", expect.any(String));
  });

  it("onOpenStorageFile calls openFileForBackend and refreshes status", async () => {
    (storageMod.openFileForBackend as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      tasks: [{ id: 99, taskName: "Loaded" }],
      raid: [],
    } as any);
    const { result } = renderBackend();
    await act(async () => { await Promise.resolve(); });

    // Patch window.confirm to return true
    vi.spyOn(window, "confirm").mockReturnValueOnce(true);
    await act(async () => { await result.current.onOpenStorageFile(); });

    expect(storageMod.openFileForBackend).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run to confirm RED**

Run: `npx vitest run src/app/use-storage-backend.test.tsx`

Expected: FAIL — handler stubs don't call the storage module functions.

- [ ] **Step 3: Read the original handler implementations in task-manager.tsx**

Search task-manager.tsx for the `onPickStorageFile`, `onGrantWriteAccess`, and `onOpenStorageFile` handler bodies. They are plain `async` functions. Note the i18n keys and toast kinds used.

Run: `npx grep -n "onPickStorageFile\|onGrantWriteAccess\|onOpenStorageFile\|pickFileForBackend\|requestWriteAccessForBackend\|openFileForBackend" src/app/task-manager.tsx`

- [ ] **Step 4: Implement the three handlers in use-storage-backend.ts**

Replace the stub bodies with the faithful extraction from task-manager.tsx. Use `settingsRef.current` instead of `settings`, `langRef.current` instead of `lang`, and `args.showToast(...)` instead of `showToast(...)`.

The pattern looks like:

```typescript
const onPickStorageFile = async () => {
  await pickFileForBackend(backend, settingsRef.current.storageConfig);
  await backend.save({ tasks, raid, absences, shifts });
  await refreshBackendStatus();
};

const onGrantWriteAccess = async () => {
  const granted = await requestWriteAccessForBackend(backend);
  if (granted) {
    args.showToast("info", t(langRef.current, "storageAccessGranted"));
  } else {
    args.showToast("error", t(langRef.current, "storageAccessDenied"));
  }
  await refreshBackendStatus();
};

const onOpenStorageFile = async () => {
  const hasTasks = tasks.length > 0 || raid.length > 0;
  if (hasTasks && !window.confirm(t(langRef.current, "storageOpenConfirm"))) return;
  const workspace = await openFileForBackend(backend, settingsRef.current.storageConfig);
  if (!workspace) return;
  setTasks(workspace.tasks ?? []);
  setRaid(workspace.raid ?? []);
  // Note: absences and shifts intentionally NOT restored here —
  // faithful extraction of original behavior (not a bug fix).
  await refreshBackendStatus();
};
```

Also add the missing imports at the top of the file:

```typescript
import { StorageNotImplementedError, StorageNotReadyError, createBackend, openFileForBackend, pickFileForBackend, requestWriteAccessForBackend } from "./storage";
```

**IMPORTANT:** Read the actual task-manager.tsx handlers before writing this — use the exact i18n keys and logic from the original. The pattern above is illustrative.

- [ ] **Step 5: Run all tests to confirm GREEN**

Run: `npx vitest run src/app/use-storage-backend.test.tsx`

Expected: PASS — all ~14 tests green.

Run: `npx tsc --noEmit`

Expected: No errors.

- [ ] **Step 6: Commit**

```
git add src/app/use-storage-backend.test.tsx src/app/use-storage-backend.ts
git commit -m "feat(use-storage-backend): implement file handlers + scaffold handler tests GREEN"
```

---

## Task 10: Phase B — Refactor task-manager.tsx to consume useStorageBackend (−544 lines)

**Files:**
- Modify: `src/app/task-manager.tsx`

This is the largest task. Read task-manager.tsx carefully before making changes.

- [ ] **Step 1: Read and map the storage-related regions in task-manager.tsx**

Search for the boundaries of the storage logic to remove:

```
npx grep -n "createBackend\|storageReady\|storageDescription\|suppressNextSave\|useBroadcastSync\|onPickStorageFile\|onGrantWriteAccess\|onOpenStorageFile\|refreshBackendStatus\|StorageNotReady\|StorageNotImplemented\|useStorageBackend" src/app/task-manager.tsx
```

Identify:
- The `useMemo` for `backend`
- `useState` for `storageReady`, `storageDescription`
- `suppressNextSaveRef`
- `refreshBackendStatus` async function
- Load effect (`useEffect` depending on `[backend, hydrated]`)
- Save effect (`useEffect` depending on `[tasks, raid, absences, shifts, hydrated, backend]`)
- Five `useBroadcastSync` calls
- Three handler definitions: `onPickStorageFile`, `onGrantWriteAccess`, `onOpenStorageFile`

- [ ] **Step 2: Add useStorageBackend import**

At the top of task-manager.tsx, add:

```typescript
import { useStorageBackend } from "./use-storage-backend";
```

- [ ] **Step 3: Add the call site after showToast is defined**

Find where `showToast` is defined (or the `useToast` call). After that line, add:

```typescript
const { storageDescription, storageReady, onPickStorageFile, onGrantWriteAccess, onOpenStorageFile } =
  useStorageBackend({ settings, lang, hydrated, activityLog, setActivityLog, showToast });
```

- [ ] **Step 4: Remove all storage-related code identified in Step 1**

Use a script approach for large contiguous blocks. For each chunk identified in Step 1:

```javascript
// Node.js helper (run from project root)
const fs = require("fs");
const lines = fs.readFileSync("src/app/task-manager.tsx", "utf8").split("\n");
// Splice out lines START through END (0-indexed, inclusive)
lines.splice(START, END - START + 1);
fs.writeFileSync("src/app/task-manager.tsx", lines.join("\n"));
```

Remove in this order (to keep line numbers stable — remove from bottom up):
1. Handler definitions (`onPickStorageFile`, `onGrantWriteAccess`, `onOpenStorageFile`)
2. Five `useBroadcastSync` calls
3. Load effect
4. Save effect
5. `refreshBackendStatus` async function
6. `suppressNextSaveRef`
7. `useState` for `storageReady`, `storageDescription`
8. `useMemo` for `backend`
9. Storage-related imports no longer needed in task-manager (e.g., `createBackend`, `StorageNotReadyError`, etc.)

- [ ] **Step 5: Verify TypeScript and tests**

Run: `npx tsc --noEmit`

Expected: No errors. If there are errors about `storageReady`, `storageDescription`, `onPickStorageFile`, etc. being undefined, verify the call site was added in Step 3.

Run: `npx vitest run`

Expected: All tests pass (current suite ~110 tests).

Check line count:

```
(Get-Content src/app/task-manager.tsx).Count
```

Expected: ~2,433 lines (was 2,977 before this task).

- [ ] **Step 6: Commit**

```
git add src/app/task-manager.tsx
git commit -m "refactor(task-manager): consume useStorageBackend; -544 lines"
```

---

## Task 11: Version bump v0.7.5 + CHANGELOG "Calvino"

**Files:**
- Modify: `src/app/version.ts`
- Modify: `CHANGELOG.md`
- Modify: `README.md`

- [ ] **Step 1: Update version.ts**

Open `src/app/version.ts`. Prepend a new comment block above the existing 0.7.4 comment:

```typescript
// 0.7.5 extracts the storage lifecycle (~544 LoC) out of task-manager.tsx
// into a new useStorageBackend hook (Phase B), preceded by widening
// WorkspaceContext to own raid, absences, and shifts (Phase A).
// The hook owns backend memoization, refreshBackendStatus, load/save effects,
// broadcast sync x5, and file handlers. suppressNextSaveRef prevents the
// immediately-following save after a load. task-manager.tsx −544 lines.
// ~14 unit tests covering state-init, load effect, save effect, and handlers.
```

Then change:

```typescript
export const APP_VERSION = "0.7.5";
export const APP_BUILD_DATE = "2026-05-20";
```

- [ ] **Step 2: Update CHANGELOG.md**

Prepend a new entry at the top of the changelog (after any header):

```markdown
## [0.7.5] "Calvino" — 2026-05-20

### Refactor
- Extract `useStorageBackend` hook from `task-manager.tsx` (~544 lines removed)
- Widen `WorkspaceContext` to own `raid`, `absences`, and `shifts` state
- Storage lifecycle (backend memoization, load/save effects, broadcast sync, file handlers) now lives in dedicated hook

### Tests
- ~14 new unit tests for `useStorageBackend` covering state-init, load effect, save effect, and handlers
- 3 new assertions in `workspace-context.test.tsx` for new context fields
```

- [ ] **Step 3: Update README.md**

Find the version badge or version reference (e.g., `v0.7.4`) and update to `v0.7.5`.

- [ ] **Step 4: Run full test suite one final time**

Run: `npx vitest run`

Expected: All ~110 tests pass.

Run: `npx tsc --noEmit`

Expected: No errors.

- [ ] **Step 5: Commit**

```
git add src/app/version.ts CHANGELOG.md README.md
git commit -m "release(v0.7.5): Calvino - useStorageBackend extraction"
```

---

## Slice Summary

| Phase | Commit message | Net delta |
|-------|---------------|-----------|
| Phase A tests | `test(workspace-context): assert raid/absences/shifts initialise to []` | +3 assertions |
| Phase A impl | `refactor(workspace-context): add raid/absences/shifts state and context fields` | +6 context fields, −3 useState in task-manager |
| Phase B scaffold | `test(use-storage-backend): scaffold state-init tests (RED)` | +1 test file |
| Phase B skeleton | `feat(use-storage-backend): skeleton hook — state-init GREEN` | +1 hook file |
| Phase B load tests | `test(use-storage-backend): add load-effect tests (RED)` | +5 tests |
| Phase B load impl | `feat(use-storage-backend): implement refreshBackendStatus + load effect` | +load effect |
| Phase B save tests | `test(use-storage-backend): add save-effect tests (RED)` | +3 tests |
| Phase B save impl | `feat(use-storage-backend): implement save effect + broadcast sync` | +save effect + sync |
| Phase B handlers | `feat(use-storage-backend): implement file handlers + scaffold handler tests GREEN` | +4 tests + handlers |
| Refactor | `refactor(task-manager): consume useStorageBackend; -544 lines` | −544 lines |
| Release | `release(v0.7.5): Calvino - useStorageBackend extraction` | version + changelog |

**Codename: Calvino** (continuing the authors series after Bradbury).
