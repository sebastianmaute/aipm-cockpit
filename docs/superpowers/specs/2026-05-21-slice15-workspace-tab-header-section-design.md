# Slice 15 — WorkspaceTabContext + AppHeader + WorkspaceSection Extraction Design

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extract the app `<header>` JSX and the workspace `<section>` JSX from `task-manager.tsx` into two new components (`AppHeader`, `WorkspaceSection`), backed by a new `WorkspaceTabContext` that manages `activeTab`/`isPopout` state, and update `useTaskRowHandlers` to read that context instead of receiving `setActiveTab`/`setWorkspaceCollapsed` as arguments. Net: ~−340 lines from `task-manager.tsx` (~1,038 → ~698 lines).

**Version bump:** v0.8.3 "Kafka"

---

## Motivation

Slices 1–14 extracted all hooks and the tasks section. The two largest remaining JSX blocks in `task-manager.tsx` are:
- The app `<header>` (~90 lines, lines ~487–577): logo, title, voice button, add-task button, bell/due-alerts button, ExportMenu, HelpMenu, VersionMenu, SettingsMenu.
- The workspace `<section>` (~250 lines, lines ~605–854): tab strip (6 `TabButton`s + collapse/reset buttons), 6 dynamic tab panels (Chat, Reports, Gantt, RAID, Resources, Activity).

Both blocks reference `activeTab`/`setActiveTab`/`isPopout` state that currently lives in `TaskManagerInner`. Moving that state into a dedicated `WorkspaceTabContext` makes both components self-sufficient context readers.

`useTaskRowHandlers` also receives `setActiveTab`/`setWorkspaceCollapsed` as arguments to imperatively navigate to the RAID tab when a user jumps from a task. After this slice it reads those from context directly.

---

## New Files

### `src/app/workspace-tab-context.tsx`

Manages `activeTab`, `setActiveTab`, and `isPopout`. Provider reads `readPopoutTabFromUrl()` at init.

```typescript
export type TopTab = "chat" | "reports" | "gantt" | "raid" | "resources" | "activity";

interface WorkspaceTabContextValue {
  activeTab: TopTab;
  setActiveTab: React.Dispatch<React.SetStateAction<TopTab>>;
  isPopout: boolean;
}

export const WorkspaceTabContext = React.createContext<WorkspaceTabContextValue | null>(null);

export function WorkspaceTabProvider({ children }: { children: React.ReactNode }) {
  const [popoutTab] = useState<PopoutTab | null>(() => readPopoutTabFromUrl());
  const isPopout = popoutTab !== null;
  const [activeTab, setActiveTab] = useState<TopTab>(popoutTab ?? "chat");
  return (
    <WorkspaceTabContext.Provider value={{ activeTab, setActiveTab, isPopout }}>
      {children}
    </WorkspaceTabContext.Provider>
  );
}

export function useWorkspaceTab(): WorkspaceTabContextValue {
  const ctx = useContext(WorkspaceTabContext);
  if (!ctx) throw new Error("useWorkspaceTab must be used inside WorkspaceTabProvider");
  return ctx;
}
```

`TopTab` moves here from `task-manager.tsx` (was exported there at line 159). `PopoutTab` and `readPopoutTabFromUrl` are imported from `./broadcast-sync`.

### `src/app/app-header.tsx`

Renders the app `<header>` element (brand, title, action buttons). Returned only; the `{!isPopout && <AppHeader />}` guard lives in `TaskManagerInner`.

**Context consumed internally:**
- `useSettings()` — `settings`, `setSettings`, `lang` (= `settings.lang`)
- `useWorkspace()` — `tasks`, `raid`, `absences`, `shifts` (for `ExportMenu`)

**Explicit props (`AppHeaderProps`):**
```typescript
export interface AppHeaderProps {
  handleCancelEdit: () => void;
  setTaskModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  bannerItems: { taskId: number; taskName: string; daysUntilDue: number }[];
  setBannerDismissed: React.Dispatch<React.SetStateAction<boolean>>;
  setDueModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  showToast: (kind: "success" | "error", text: string) => void;
  handleCommand: (cmd: string) => void;
  storageDescription: string;
  storageReady: boolean;
  onPickStorageFile: () => void;
  onOpenStorageFile: () => void;
  onGrantStorageWrite: () => void;
}
```

`bannerItems` type matches the return of `getAlertableTasks`; exact shape can use `import type { AlertableTask } from "./due-dates"` or inline. `showToast` signature matches `useToast`'s return.

### `src/app/workspace-section.tsx`

Renders the resizable workspace `<section>`: tab strip with collapse/reset buttons and 6 dynamic panel slots.

**Context consumed internally:**
- `useSettings()` — `settings`, `lang`
- `useWorkspace()` — `tasks`, `absences`, `shifts`
- `useWorkspaceCollapsed()` — `workspaceCollapsed`, `setWorkspaceCollapsed`
- `useWorkspaceTab()` — `activeTab`, `setActiveTab`, `isPopout`
- `useFilters()` — `raidFilterTaskId`, `setRaidFilterTaskId`

`openPopoutWindow` is a module-level import from `./broadcast-sync` — not a prop.

**Explicit props (`WorkspaceSectionProps`):**
```typescript
export interface WorkspaceSectionProps {
  today: string;
  holidaySet: Set<string>;
  workspaceRef: React.RefObject<HTMLElement | null>;
  resetWorkspaceSize: () => void;
  dispatcher: ToolDispatcher;
  handleAcceptAiConsent: () => void;
  handleGanttBarUpdate: (edit: { taskId: number; startDate: string; dueDate: string }) => void;
  handleCancelEdit: () => void;
  setTaskModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  handleClearRaidTaskFilter: () => void;
  handleSaveRaidItem: (item: RaidItem) => void;
  handleDeleteRaidItem: (id: number) => void;
  handleCreateMitigationTaskFromRaid: (raidId: number) => void;
  handleJumpToTaskFromRaid: (taskId: number) => void;
  activityLog: ActivityEntry[];
  handleClearActivityLog: () => void;
  handleOpenAddAbsence: () => void;
  handleEditAbsence: (absence: Absence) => void;
  handleOpenShiftEditor: (shift: Shift) => void;
}
```

`ToolDispatcher` is imported from `./chat-tools`. `RaidItem`, `Absence`, `Shift` from `./types`. `ActivityEntry` from `./activity-log`.

---

## Changes to `use-task-row-handlers.ts`

Remove `setActiveTab` and `setWorkspaceCollapsed` from `UseTaskRowHandlersArgs`. Inside `onJumpToRaid`, call `useWorkspaceTab()` and `useWorkspaceCollapsed()` via the module-level hook calls at the top of the hook body (same pattern as other context-reading hooks in this codebase).

Before:
```typescript
interface UseTaskRowHandlersArgs {
  ...
  setActiveTab: React.Dispatch<React.SetStateAction<TopTab>>;
  setWorkspaceCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  ...
}
```

After:
```typescript
// setActiveTab and setWorkspaceCollapsed removed from args
export function useTaskRowHandlers(args: UseTaskRowHandlersArgs) {
  const { setActiveTab } = useWorkspaceTab();
  const { setWorkspaceCollapsed } = useWorkspaceCollapsed();
  ...
}
```

`TopTab` is now imported from `./workspace-tab-context` (not `./task-manager`).

---

## Changes to `task-manager.tsx`

**Remove:**
- `export type TopTab = ...` definition (line 159) — now lives in `workspace-tab-context.tsx`
- `const TAB_LABEL_KEYS` constant (was only used internally in the old tab strip)
- `const [popoutTab]` + `const [activeTab, setActiveTab]` state (lines ~201–203)
- `setActiveTab`, `setWorkspaceCollapsed` from `useTaskRowHandlers` call args (lines 368–369)
- The full `<header>` JSX block (~90 lines)
- The full workspace `<section>` JSX block (~250 lines)

**Add:**
```typescript
import { WorkspaceTabProvider, useWorkspaceTab } from "./workspace-tab-context";
import { AppHeader } from "./app-header";
import { WorkspaceSection } from "./workspace-section";
```

**Replace header block** with:
```tsx
{!isPopout && (
  <AppHeader
    handleCancelEdit={handleCancelEdit}
    setTaskModalOpen={setTaskModalOpen}
    bannerItems={bannerItems}
    setBannerDismissed={setBannerDismissed}
    setDueModalOpen={setDueModalOpen}
    showToast={showToast}
    handleCommand={handleCommand}
    storageDescription={storageDescription}
    storageReady={storageReady}
    onPickStorageFile={onPickStorageFile}
    onOpenStorageFile={onOpenStorageFile}
    onGrantStorageWrite={onGrantWriteAccess}
  />
)}
```

Note: `isPopout` now comes from `useWorkspaceTab()` (add to TaskManagerInner).

**Replace workspace section block** with:
```tsx
<WorkspaceSection
  today={today}
  holidaySet={holidaySet}
  workspaceRef={workspaceRef}
  resetWorkspaceSize={resetWorkspaceSize}
  dispatcher={dispatcher}
  handleAcceptAiConsent={handleAcceptAiConsent}
  handleGanttBarUpdate={handleGanttBarUpdate}
  handleCancelEdit={handleCancelEdit}
  setTaskModalOpen={setTaskModalOpen}
  handleClearRaidTaskFilter={handleClearRaidTaskFilter}
  handleSaveRaidItem={handleSaveRaidItem}
  handleDeleteRaidItem={handleDeleteRaidItem}
  handleCreateMitigationTaskFromRaid={handleCreateMitigationTaskFromRaid}
  handleJumpToTaskFromRaid={handleJumpToTaskFromRaid}
  activityLog={activityLog}
  handleClearActivityLog={handleClearActivityLog}
  handleOpenAddAbsence={handleOpenAddAbsence}
  handleEditAbsence={handleEditAbsence}
  handleOpenShiftEditor={handleOpenShiftEditor}
/>
```

**Update provider nesting** in `export default function TaskManager()`:
```tsx
export default function TaskManager() {
  return (
    <FiltersProvider>
      <WorkspaceProvider>
        <TaskFormProvider>
          <WorkspaceTabProvider>
            <TaskManagerInner />
          </WorkspaceTabProvider>
        </TaskFormProvider>
      </WorkspaceProvider>
    </FiltersProvider>
  );
}
```

**Net:** ~−340 lines; `task-manager.tsx` ~698 lines.

---

## Testing

### `src/app/workspace-tab-context.test.tsx` — 2 smoke tests

1. **Default tab is "chat"** — render `WorkspaceTabProvider` + a spy child; verify `activeTab === "chat"` and `isPopout === false` (URL has no popout param).
2. **setActiveTab updates context** — call `setActiveTab("reports")` via a `Probe` component using `useLayoutEffect`; verify `activeTab` updates to `"reports"`.

### `src/app/app-header.test.tsx` — 2 smoke tests

Must wrap in `WorkspaceProvider` + `WorkspaceTabProvider`. `useSettings` and `useWorkspaceCollapsed` read localStorage directly — no provider needed.

1. **Renders the heading** — mount with required providers; verify `<h1>` is present in the DOM.
2. **Bell badge shows count** — pass `bannerItems` with 2 entries; verify the badge `<span>` contains `"2"`.

### `src/app/workspace-section.test.tsx` — 3 smoke tests

Must wrap in `WorkspaceProvider` + `WorkspaceTabProvider` + `FiltersProvider`. `useSettings` and `useWorkspaceCollapsed` read localStorage directly — no provider needed.

1. **Chat panel visible by default** — default `activeTab="chat"`; `div#panel-chat` does NOT have the `hidden` attribute.
2. **Non-active panel hidden** — default `activeTab="chat"`; `div#panel-raid` has the `hidden` attribute.
3. **Section renders with required ref** — mount with a valid `workspaceRef`; the `<section>` element is present in the DOM.

---

## Task Breakdown

1. **Create `workspace-tab-context.tsx`** — `WorkspaceTabProvider`, `useWorkspaceTab`, move `TopTab` type; 2 smoke tests (RED → GREEN); commit
2. **Update `use-task-row-handlers.ts`** — remove `setActiveTab`/`setWorkspaceCollapsed` from args, read contexts internally; update existing test; tsc clean; commit
3. **Create `app-header.tsx`** — implement `AppHeader`; 2 smoke tests (RED → GREEN); commit
4. **Create `workspace-section.tsx`** — implement `WorkspaceSection`; 3 smoke tests (RED → GREEN); commit
5. **Refactor `task-manager.tsx`** — add `WorkspaceTabProvider`, replace header + workspace blocks with new components, read `isPopout` from `useWorkspaceTab()`; tsc clean, 192+ tests green; commit
6. **Version bump** — `version.ts` → `"0.8.3"`, CHANGELOG entry "Kafka"; commit
