# Slice 7 — `useStorageBackend` + WorkspaceContext widening

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extract the storage lifecycle (backend memoization, load/save effects, broadcast sync,
file-picker handlers) from `task-manager.tsx` into a `useStorageBackend` hook, enabled by first
widening `WorkspaceContext` to own `raid`, `absences`, and `shifts`.

**Architecture:** Two-phase slice. Phase A widens `WorkspaceContext` so the hook can call
`useWorkspace()` for all four workspace entities without prop-drilling. Phase B extracts the hook.
Both phases follow the ref-based reactive-read pattern established in slices 5 and 6.

**Tech Stack:** React 19, TypeScript, Vitest 3, @testing-library/react 16

---

## Phase A — Widen `WorkspaceContext`

### Files

- Modify: `src/app/workspace-context.tsx`
- Modify: `src/app/task-manager.tsx` (remove 3 useState; update CRUD handler setter sources)
- Modify: `src/app/workspace-context.test.tsx` (3 new assertions)

### What moves into WorkspaceContext

Three `useState` declarations migrate from `task-manager.tsx` into `WorkspaceProvider`:

```ts
const [raid, setRaid] = useState<RaidItem[]>([]);
const [absences, setAbsences] = useState<Absence[]>([]);
const [shifts, setShifts] = useState<Shift[]>([]);
```

`WorkspaceContextValue` gains six new fields:

```ts
raid: RaidItem[];
setRaid: React.Dispatch<React.SetStateAction<RaidItem[]>>;
absences: Absence[];
setAbsences: React.Dispatch<React.SetStateAction<Absence[]>>;
shifts: Shift[];
setShifts: React.Dispatch<React.SetStateAction<Shift[]>>;
```

Initial values remain `[]`. The storage load effect (Phase B) populates them after mount,
exactly as today.

### task-manager.tsx mechanical update

All RAID, absence, and shift CRUD handlers call `setRaid` / `setAbsences` / `setShifts`
obtained from `useWorkspace()` instead of local `useState`. No logic changes — only the
source of the setter changes. The handlers themselves stay in `task-manager.tsx`.

```ts
// Before (task-manager.tsx)
const [raid, setRaid] = useState<RaidItem[]>([]);

// After
const { ..., raid, setRaid, absences, setAbsences, shifts, setShifts } = useWorkspace();
```

### Existing consumers

`useWorkspace()` is called in several files (chat-dispatcher, task-row, etc.). None of them
use `raid`/`absences`/`shifts` today, so the new fields are purely additive — no existing
consumers break.

---

## Phase B — `useStorageBackend` hook

### Files

- Create: `src/app/use-storage-backend.ts`
- Create: `src/app/use-storage-backend.test.tsx`
- Modify: `src/app/task-manager.tsx` (~544 lines removed, ~10 added)

### Hook interface

```ts
export interface UseStorageBackendArgs {
  settings: Settings;
  lang: Lang;
  hydrated: boolean;
  activityLog: ActivityEntry[];
  setActivityLog: React.Dispatch<React.SetStateAction<ActivityEntry[]>>;
  showToast: (kind: "info" | "error", text: string) => void;
}

export function useStorageBackend(args: UseStorageBackendArgs): {
  storageDescription: string | null;
  storageReady: boolean;
  onPickStorageFile: () => Promise<void>;
  onGrantWriteAccess: () => Promise<void>;
  onOpenStorageFile: () => Promise<void>;
}
```

### What the hook owns

| Concern | Implementation |
|---|---|
| Backend instance | `useMemo(() => createBackend(settings.storageConfig), [settings.storageConfig])` |
| Storage status | `storageDescription` + `storageReady` state + `refreshBackendStatus()` helper |
| Write-suppression | `suppressNextSaveRef` — set by load effect to skip the immediately-following save |
| Load effect | Triggered by `[backend, hydrated]`; calls `backend.load()`, populates workspace via context setters, handles `StorageNotReadyError` / `StorageNotImplementedError` |
| Save effect | Triggered by `[tasks, raid, absences, shifts, hydrated, backend]`; debounced 500 ms; checks `suppressNextSaveRef`; calls `backend.save({ tasks, raid, absences, shifts })` |
| Broadcast sync | Five `useBroadcastSync` calls: tasks, raid, absences, shifts, activityLog |
| File handlers | `onPickStorageFile`, `onGrantWriteAccess`, `onOpenStorageFile` |

### Reactive-ref strategy

`lang` and `settings` are routed through refs (synced via `useEffect`) so the load/save
effects don't re-register on every render. `showToast` is a plain inline function — its
identity changes each render but it is only called inside async callbacks, never listed as
an effect dependency, so no ref is needed.

```ts
const langRef = useRef(args.lang);
const settingsRef = useRef(args.settings);
useEffect(() => { langRef.current = args.lang; }, [args.lang]);
useEffect(() => { settingsRef.current = args.settings; }, [args.settings]);
```

### Internal data flow

```
useWorkspace() ──► tasks, setTasks
                   raid,  setRaid
                   absences, setAbsences
                   shifts,   setShifts

args.settings.storageConfig ──► backend (useMemo)

backend + hydrated ──► load effect ──► setTasks / setRaid / setAbsences / setShifts
                                       suppressNextSaveRef.current = true
                                       showToast (on error)

tasks/raid/absences/shifts + hydrated + backend ──► save effect (debounced 500 ms)
                                                     suppressNextSaveRef check
                                                     backend.save(workspace)
                                                     showToast (on error)

useBroadcastSync x5  ──► keeps tasks/raid/absences/shifts/activityLog
                          in sync across main + popout windows
```

### Call site in task-manager.tsx

Placed after `showToast` is defined (same convention as `useJiraSync`):

```ts
const { storageDescription, storageReady, onPickStorageFile, onGrantWriteAccess, onOpenStorageFile } =
  useStorageBackend({ settings, lang, hydrated, activityLog, setActivityLog, showToast });
```

### Net reduction

~554 lines removed, ~10 lines added — **task-manager.tsx -~544 lines** (2,977 -> ~2,433).

---

## Testing

### Phase A additions to `workspace-context.test.tsx`

Three new assertions (no new file needed):

1. `raid` initialises to `[]`
2. `absences` initialises to `[]`
3. `shifts` initialises to `[]` and setter updates correctly through the provider

### Phase B — `use-storage-backend.test.tsx`

**~14 tests across 4 describe blocks. Target: 96 -> ~110 tests.**

#### Mocking strategy

```ts
vi.mock("./storage", () => ({
  createBackend: vi.fn(),
  StorageNotReadyError: class StorageNotReadyError extends Error {},
  StorageNotImplementedError: class StorageNotImplementedError extends Error {},
  openFileForBackend: vi.fn(),
  pickFileForBackend: vi.fn(),
  requestWriteAccessForBackend: vi.fn(),
}));

vi.mock("./broadcast-sync", () => ({
  useBroadcastSync: vi.fn(),
}));
```

`createBackend` returns a mock backend object:

```ts
const mockBackend = {
  load: vi.fn().mockResolvedValue({ tasks: [], raid: [], absences: [], shifts: [] }),
  save: vi.fn().mockResolvedValue(undefined),
  isReady: vi.fn().mockResolvedValue(true),
  describe: vi.fn().mockResolvedValue("mock-file.json"),
};
```

`TestProviders` wraps each `renderHook` call for WorkspaceContext access.

#### Test coverage

| Describe block | Tests |
|---|---|
| **state initialisation** | `storageReady` false on mount; `storageDescription` null on mount |
| **load effect** | populates workspace from backend on mount; suppresses next save after load; shows error toast on `StorageNotReadyError`; shows error toast on unknown error; no-ops when `!hydrated` |
| **save effect** | calls `backend.save` after workspace changes (debounced); skips save when `suppressNextSaveRef` is set; shows toast on save error |
| **handlers** | `onPickStorageFile` saves current workspace + refreshes status; `onGrantWriteAccess` shows granted toast on success + denied toast on failure; `onOpenStorageFile` prompts confirm when tasks exist + loads on confirm |

---

## Slice summary

| Phase | Commit message | Net delta |
|---|---|---|
| A | `refactor(workspace-context): add raid/absences/shifts` | -3 useState in task-manager, +6 context fields |
| B (tests RED) | `test(use-storage-backend): scaffold ~14 tests` | +345 lines test file |
| B (impl GREEN) | `feat(use-storage-backend): implement hook` | +265 lines hook file |
| B (refactor) | `refactor(task-manager): consume useStorageBackend; -544 lines` | -544 lines task-manager |
| Release | `release(v0.7.5): Calvino - useStorageBackend extraction` | version.ts + CHANGELOG |

**Codename: Calvino** (continuing the authors series after Bradbury).
