# Slice 5 — Chat Dispatcher Extraction & ChatPanel Memoization

**Date:** 2026-05-19

## Problem

`task-manager.tsx` (~3,517 lines after slice 4) still owns the entire Claude chat-tool dispatcher:

- **`task-manager.tsx:2173-2186`** — `tasksRef`, `settingsRef`, `todayRef` plus three sync `useEffect`s. Their *sole* purpose is to keep the dispatcher `useMemo` from rebuilding every render.
- **`task-manager.tsx:2187-2219`** — `dispatcherSendInquiry` `useCallback`. Only consumer: the dispatcher.
- **`task-manager.tsx:2221-2230`** — `applyFilters` `useCallback`. Only consumer: the dispatcher.
- **`task-manager.tsx:2232-2409`** — the ~180-line dispatcher `useMemo` itself, with deps `[editingId, dispatcherSendInquiry, applyFilters]`.

Combined: ~240 lines of code whose *only* consumer is `<ChatPanel dispatcher={dispatcher} />` at line 2742.

The `editingId` dep on the dispatcher `useMemo` is the last reactive value preventing a stable dispatcher identity. As long as the dispatcher reference changes on every `editingId` flip (i.e. every time the user opens or closes the edit form), `ChatPanel` cannot be memoized — it re-renders alongside `task-manager` on every keystroke in the form input.

The codemap diff's "open items" lists *ChatPanel memoization (gated on dispatcher useMemo deps audit)* — slice 5 closes that gate.

## Goal

1. **Move** the dispatcher + its three refs + its two helper callbacks into a custom hook `useChatDispatcher` in `src/app/use-chat-dispatcher.ts`.
2. **Stabilize** the dispatcher identity by routing `editingId` through a ref. Empty `useMemo` deps; dispatcher reference never changes after first render.
3. **Memoize** `ChatPanel` with `React.memo`. `onAcceptConsent` at the call site becomes a `useCallback` so all four props are reference-stable.
4. **Cover** the new hook with ~14 unit tests (one happy-path per dispatcher method + 2 identity-stability tests).

Net: ~−200 lines from `task-manager.tsx`, one new hook file, one new test file, one new tiny test helper.

## Non-goals

- **Pushing helpers into `chat-tools.ts`.** Validation/sanitization logic (e.g. `createTask`'s `sanitizeTaskName` chain, `updateTask`'s Jira-lock invariants) stays inside the hook. Moving it to `chat-tools.ts` would require a second indirection layer and isn't needed for the memoization payoff.
- **Promoting `selectedIds` or `settings` to a new context.** They stay as `task-manager.tsx` `useState` and are passed into the hook as args. Promoting them is scope creep — neither is consumed by any other slice-eligible component.
- **Memoizing components inside ChatPanel.** Out of scope. `React.memo(ChatPanel)` alone closes the original bottleneck (parent re-renders during form input).
- **Adding E2E coverage for chat tool calls.** Out of scope. Pre-existing gap; tracked separately in `.reports/codemap-diff.txt` open items.
- **Refactoring the `ToolDispatcher` type.** Stays in `chat-tools.ts` exactly as it is.

## Change

Three new files, two modified files.

### 1. `src/app/use-chat-dispatcher.ts` (NEW)

**Public surface:**

```ts
import type { Settings } from "./types";
import type { ToolDispatcher } from "./chat-tools";

export interface ChatDispatcherArgs {
  settings: Settings;
  today: string;             // "YYYY-MM-DD"
  setSelectedIds: React.Dispatch<React.SetStateAction<Set<number>>>;
  setSettings: React.Dispatch<React.SetStateAction<Settings>>;
}

export function useChatDispatcher(args: ChatDispatcherArgs): ToolDispatcher;
```

**Reads from context (not args):**

| Context | What it provides |
|---|---|
| `useWorkspace()` | `tasks`, `setTasks` |
| `useTaskForm()` | `editingId`, `setEditingId`, `setForm` |
| `useFilters()` | `setSearch`, `setPriorityFilter`, `setAssigneeFilter`, `setGroupFilter`, `setLabelFilter` |

**Stabilization strategy (internal):**

```ts
const tasksRef       = useRef(tasks);
const settingsRef    = useRef(args.settings);
const todayRef       = useRef(args.today);
const editingIdRef   = useRef(editingId);
useEffect(() => { tasksRef.current      = tasks;          }, [tasks]);
useEffect(() => { settingsRef.current   = args.settings;  }, [args.settings]);
useEffect(() => { todayRef.current      = args.today;     }, [args.today]);
useEffect(() => { editingIdRef.current  = editingId;      }, [editingId]);
```

**Dispatcher build:** `useMemo<ToolDispatcher>(() => ({ ... }), [])` — empty deps. Each method reads reactive values via refs. `tasksRef.current = next` assignment inside `createTask` / `updateTask` / `deleteTask` / `deleteAllTasks` is retained — required so back-to-back tool calls in one chat turn see each other's writes before the next `useEffect` flush.

**Two internal helpers** (kept inside the hook, not exported):

- `sendInquiry(id)` — drafts mailto, increments `inquiriesSent`. Uses `tasksRef`, `settingsRef`, `setTasks`.
- `applyFilters(f)` — forwards a `Filters` object to the five filter setters from `useFilters()`.

Both are `useCallback(..., [])` since they read only refs and stable setters.

### 2. `src/app/use-chat-dispatcher.test.ts` (NEW)

~14 unit tests via `renderHook` from `@testing-library/react`, wrapped in a `TestProvider` stack:

```tsx
function wrapper({ children }: { children: ReactNode }) {
  return (
    <FiltersProvider>
      <WorkspaceProvider initial={seedTasks}>
        <TaskFormProvider>{children}</TaskFormProvider>
      </WorkspaceProvider>
    </FiltersProvider>
  );
}
```

Tests:

1. `listTasks()` returns workspace tasks — seed 3 tasks, assert length + ids.
2. `getTask(id)` — hit case returns row; miss case returns `null`.
3. `createTask` appends + assigns `id = max+1` + sanitizes inputs (whitespace, casing).
4. `createTask` throws on missing `taskName` / `assignee` / `dueDate` (three sub-cases).
5. `updateTask` patches a field + bumps `localModifiedAt` to ISO timestamp.
6. `updateTask` rejects assignee change on a `jiraKey`-linked task with the documented error message.
7. `deleteTask` removes the row **and** cascades dependency cleanup (predecessor stripped from dependants' `dependencies[]`).
8. `deleteAllTasks` empties tasks, clears `selectedIds`, sets `editingId` to `null`, clears `form`.
9. `sendInquiry` opens mailto (mock `window.open`), increments `inquiriesSent` on the row.
10. `setFilters({ search: "x" })` forwards to `FiltersProvider` — `useFilters().search` reflects it.
11. `setLanguage("de")` calls `setSettings` with an updater merging `language`.
12. `getSnapshot` returns sorted unique groups/labels, accurate `taskCount`, `today`, `language`, `holidayCountries`, `storageKind`.
13. **Identity stability vs tasks:** trigger a `setTasks`, assert dispatcher reference === prev.
14. **Identity stability vs editingId:** flip `editingId` via TaskFormProvider, assert dispatcher reference === prev.

### 3. `src/app/test-providers.tsx` (NEW — tiny helper)

~30 lines. `WorkspaceProvider` currently does **not** accept an `initial` prop (confirmed against `src/app/workspace-context.tsx:30` — signature is `{ children }: { children: ReactNode }`). Two paths considered; we take the second for minimum-disruption:

**Option A (rejected — out of scope):** Extend `WorkspaceProvider` to accept `initial?: Task[]` and pass it as the `useState` seed. Clean, but changes a public API the rest of the app already consumes; not slice-5 work.

**Option B (chosen):** Seed via a tiny `Seeder` child that calls `setTasks(initial)` once on mount. Slice-5 owns this file in full; no change to `workspace-context.tsx`.

```tsx
function Seeder({ tasks }: { tasks: Task[] }) {
  const { setTasks } = useWorkspace();
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current) return;
    seededRef.current = true;
    if (tasks.length > 0) setTasks(tasks);
  }, [tasks, setTasks]);
  return null;
}

export function TestProviders({
  children,
  tasks = [],
}: {
  children: ReactNode;
  tasks?: Task[];
}) {
  return (
    <FiltersProvider>
      <WorkspaceProvider>
        <Seeder tasks={tasks} />
        <TaskFormProvider>{children}</TaskFormProvider>
      </WorkspaceProvider>
    </FiltersProvider>
  );
}
```

The `seededRef` guard prevents re-seeding when the test re-renders. Tests that need to observe post-seed state use `await act(async () => {})` after the initial render, then assert.

### 4. `src/app/task-manager.tsx` (MODIFIED — net −200 lines)

**Removed:**

- Lines 2173-2186: three refs + three sync `useEffect`s.
- Lines 2187-2219: `dispatcherSendInquiry` `useCallback`.
- Lines 2221-2230: `applyFilters` `useCallback`.
- Lines 2232-2409: the ~180-line dispatcher `useMemo`.

**Added** (~10 lines):

```tsx
const dispatcher = useChatDispatcher({
  settings,
  today,
  setSelectedIds,
  setSettings,
});

const handleAcceptAiConsent = useCallback(() => {
  setSettings((s) => ({ ...s, ai: { ...s.ai, consentAccepted: true } }));
}, []);
```

**Modified ChatPanel call site (lines 2742-2752):**

```tsx
<ChatPanel
  lang={lang}
  ai={settings.ai}
  dispatcher={dispatcher}
  onAcceptConsent={handleAcceptAiConsent}
/>
```

**Import audit:** `Filters` and `ToolDispatcher` from `./chat-tools` move with the dispatcher; remove from `task-manager`. All `sanitize*` and `isValidEmail` / `greetingName` imports stay if and only if they have other consumers in `task-manager` (`handleSubmit`, `handleDelete`, voice command handler, etc.). Audit each in the implementation step; drop only the genuinely-orphaned ones.

### 5. `src/app/chat-panel.tsx` (MODIFIED — 2 lines)

Wrap the existing default export with `React.memo`:

```tsx
function ChatPanelImpl(props: ChatPanelProps) { /* ...existing body... */ }
export const ChatPanel = memo(ChatPanelImpl);
```

`React.memo` does a shallow reference-equality compare on the four props (`lang`, `ai`, `dispatcher`, `onAcceptConsent`). With the dispatcher now stable and `onAcceptConsent` `useCallback`-wrapped, only changes to `lang` or `settings.ai` trigger a `ChatPanel` re-render.

## Behaviour parity

One intentional behavioural shift, documented:

- **`deleteTask` reads `editingIdRef.current` instead of the `editingId` closure value.** In practice these are identical for tool calls (which fire synchronously from chat handlers, not mid-render). The shift is invisible to users and correct under React's render → effect ordering. The two identity-stability tests pin this in place.

Everything else: identical method signatures, identical semantics, identical sanitization, identical Jira-lock invariants.

## Risks & rollback

| Risk | Likelihood | Mitigation |
|---|---|---|
| `editingIdRef` same-tick staleness in `deleteTask` | Very low | `useEffect` flushes before next React event; chat tool calls aren't fired mid-render. Covered by test #14 (identity stability) and visual smoke at the end. |
| `tasksRef.current = next` assignment looks duplicative with the sync `useEffect` | Cosmetic | Required for back-to-back tool calls in one chat turn — without it, `tasksRef.current.find(...)` in the second call sees pre-write state. Documented with an inline comment. |
| `Seeder` re-fires when tests trigger re-renders | Low | `seededRef.current` guard runs the seed exactly once per mount; tests that need a clean slate `unmount()` and re-render. |
| `React.memo(ChatPanel)` masks a stale prop bug | Low | Memo is shallow; relies on the four props being reference-stable. The two identity-stability tests catch dispatcher regression. `onAcceptConsent` is the only other unstable-by-default candidate; its `useCallback` deps are `[]` (uses `setSettings` updater form). |
| Orphaned `sanitize*` imports in `task-manager` | Cosmetic | Audited and dropped in the same commit. TypeScript will not flag them — they're unused but valid. ESLint `no-unused-vars` will. |

**Rollback:** `git revert` the implementation commit. `src/app/use-chat-dispatcher.{ts,test.ts}` and `test-providers.tsx` get deleted; the inline dispatcher and helpers come back. No storage, data, migration, or API surface concern.

## Verification

| Command | Expected |
|---|---|
| `npx tsc --noEmit` | exit 0 |
| `npx vitest run` | 83 tests across 12 files (69 + 14 new) |
| `npm run build` | Next.js production build green |
| Manual smoke A — Chat | Open Chat tab, ask Claude to `listTasks`, then `createTask`, then `updateTask`, then `deleteTask`. Each call reflects the previous one (back-to-back state propagation via `tasksRef`). |
| Manual smoke B — Memoization payoff | Open the edit-task form. React DevTools → highlight re-renders. Type in the name input. `ChatPanel` does NOT highlight on each keystroke (it does pre-slice — that's the visible win). |
| Manual smoke C — Edit/Delete from chat | While a task is open in the edit form, ask Claude to `deleteTask` that same id. The form should close (because `deleteAllTasks` / `deleteTask` still clears `editingId` via `setEditingId(null)`). |

## What this unlocks

- Closes the codemap's *ChatPanel memoization (gated on dispatcher useMemo deps audit)* open item.
- `task-manager.tsx` drops below ~3,320 lines.
- Pattern complete: every workspace-tab panel (Chat → Reports → Gantt → RAID → Resources → Activity) now consumes its inputs via context + small, stable prop interfaces.
- The dispatcher is testable in isolation for the first time — future tool additions get unit-test coverage by default.

## What this does NOT unlock

- Virtualized task table — separate, larger refactor.
- Canvas-based Gantt — separate.
- SharePoint backend wiring — separate; the `useChatDispatcher` doesn't read storage, so it's orthogonal.
- E2E coverage for chat tool calls — separate; the unit tests give behaviour parity but don't replace an E2E.
