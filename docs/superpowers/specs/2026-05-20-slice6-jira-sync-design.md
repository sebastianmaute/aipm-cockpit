# Slice 6 — `useJiraSync` Extraction Design

## Goal

Extract the Jira sync state machine and conflict resolver from `task-manager.tsx` into a dedicated `useJiraSync` hook. Reduces `task-manager.tsx` by ~300 lines and isolates all Jira-specific state and async logic behind a clean, testable interface.

## Context

`task-manager.tsx` is currently 3,289 lines (down from ~4,200 before slices 1–5). The two largest remaining inline blocks are the Jira sync handlers:

- `handleJiraSync` (lines 1508–1709, ~201 lines): full sync state machine — credential check → JQL search → diff local vs. remote → pull new/updated remote tasks, push local changes, surface conflicts, create missing Jira issues
- `handleResolveConflicts` (lines 1711–1809, ~100 lines): field-by-field conflict resolution, sequential Jira updates

Both share `jiraSyncing` (boolean) and `jiraConflicts` (array) state, and read `tasks` + `settings.jira` via refs.

## Approach

**Plain hook — `useJiraSync`** (mirrors the `useChatDispatcher` pattern from Slice 5).

Rejected alternatives:
- **Context + Provider**: only `task-manager` consumes this state — a provider adds boilerplate for no benefit
- **Two separate hooks**: `handleResolveConflicts` directly reads and writes `jiraConflicts` state owned alongside `handleJiraSync`; splitting introduces indirection without clarity

## File Changes

| File | Action | Net |
|------|--------|-----|
| `src/app/use-jira-sync.ts` | Create | +~310 lines |
| `src/app/use-jira-sync.test.tsx` | Create | +~200 lines |
| `src/app/task-manager.tsx` | Modify | −~300 lines |

`task-manager.tsx` target: ~2,989 lines.

## Interface

```ts
// src/app/use-jira-sync.ts

export interface UseJiraSyncArgs {
  settings: Settings;
  today: string;
  lang: string;
  showToast: (msg: string, type?: ToastType) => void;
  logActivity: (kind: ActivityKind, payload: ActivityPayload) => void;
}

export function useJiraSync(args: UseJiraSyncArgs): {
  handleJiraSync: () => Promise<void>;
  handleResolveConflicts: (resolutions: ConflictResolution[]) => Promise<void>;
  jiraSyncing: boolean;
  jiraConflicts: ConflictItem[];
  clearConflicts: () => void;
}
```

## Hook Internals

`tasks` / `setTasks` are consumed from `useWorkspace()` inside the hook — no prop drilling.

All reactive values are routed through refs so `useCallback` deps stay minimal:

```ts
const tasksRef    = useRef(tasks);
const settingsRef = useRef(args.settings);
const todayRef    = useRef(args.today);
const langRef     = useRef(args.lang);

useEffect(() => { tasksRef.current = tasks; },            [tasks]);
useEffect(() => { settingsRef.current = args.settings; }, [args.settings]);
useEffect(() => { todayRef.current = args.today; },       [args.today]);
useEffect(() => { langRef.current = args.lang; },         [args.lang]);
```

`handleJiraSync` and `handleResolveConflicts` are `useCallback`s whose deps are only `args.showToast` and `args.logActivity` (both stable `useCallback`s in `task-manager`). Hook identity is stable across re-renders.

Owned state:

```ts
const [jiraSyncing,   setJiraSyncing]   = useState(false);
const [jiraConflicts, setJiraConflicts] = useState<ConflictItem[]>([]);
```

Returns:

```ts
return {
  handleJiraSync,
  handleResolveConflicts,
  jiraSyncing,
  jiraConflicts,
  clearConflicts: useCallback(() => setJiraConflicts([]), []),
};
```

## task-manager.tsx Changes

Remove:
- `const [jiraSyncing, setJiraSyncing] = useState(false);`
- `const [jiraConflicts, setJiraConflicts] = useState<ConflictItem[]>([]);`
- `handleJiraSync` function body (~201 lines)
- `handleResolveConflicts` function body (~100 lines)

Add one call site after the existing hook calls:

```ts
const {
  handleJiraSync,
  handleResolveConflicts,
  jiraSyncing,
  jiraConflicts,
  clearConflicts,
} = useJiraSync({ settings, today, lang, showToast, logActivity });
```

Update `JiraConflictsModal` `onClose` prop: replace `() => setJiraConflicts([])` with `clearConflicts`.

## Tests

File: `src/app/use-jira-sync.test.tsx`

Harness: `renderHook` + `TestProviders` (same pattern as `use-chat-dispatcher.test.tsx`).
`loadJiraApi` vi-mocked at module level.

**State initialisation (2 tests)**
1. `jiraSyncing` initialises to `false`, `jiraConflicts` initialises to `[]`
2. `clearConflicts` resets a pre-populated `jiraConflicts` array to `[]`

**`handleJiraSync` (7 tests)**
3. No credentials → credential-error toast shown, `jiraSyncing` stays `false`
4. `jiraSyncing` flips `true` during call, resets to `false` on completion
5. Pull path: remote task absent locally → added to tasks, `logActivity` called with pull kind
6. Push path: local task with `jiraIssueKey` + dirty fields → `updateIssue` called
7. Conflict path: same field changed on both sides → `jiraConflicts` populated, task list unchanged
8. Create path: local task without `jiraIssueKey` → `createIssue` called, key written back to task
9. Error path: `loadJiraApi` throws → error toast shown, `jiraSyncing` reset to `false`

**`handleResolveConflicts` (3 tests)**
10. "Keep local" resolution → task unchanged, `updateIssue` called with local value
11. "Use remote" resolution → task updated with remote value, `updateIssue` not called for that field
12. After resolution completes → `jiraConflicts` cleared to `[]`

**Total test count:** 84 → 96

## Commit Plan

| # | Message |
|---|---------|
| 1 | `test(use-jira-sync): scaffold hook + state-init tests` |
| 2 | `feat(use-jira-sync): implement hook skeleton + jiraSyncing/jiraConflicts state` |
| 3 | `test(use-jira-sync): no-credentials + jiraSyncing flip tests` |
| 4 | `feat(use-jira-sync): implement handleJiraSync pull + push paths` |
| 5 | `test(use-jira-sync): pull, push, conflict, create, error path tests` |
| 6 | `feat(use-jira-sync): implement conflict detection + create-issue path` |
| 7 | `test(use-jira-sync): handleResolveConflicts tests` |
| 8 | `feat(use-jira-sync): implement handleResolveConflicts` |
| 9 | `refactor(task-manager): consume useJiraSync; drop inline sync handlers` |
| 10 | `release(v0.7.4): slice6 useJiraSync extraction` |
