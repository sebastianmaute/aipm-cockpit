# Slice 10 — useColumnManager + useContacts + useWorkspaceCollapsed Design

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Extract three localStorage-backed UI-state hooks from `task-manager.tsx`, removing ~175 lines of inline state, effects, and callbacks and replacing them with three focused, independently testable hooks.

**Architecture:** Three plain hooks (no context providers), following the pattern of slices 5–9. `useColumnManager` is zero-arg and owns column widths, hidden columns, the column-config dropdown, and the resize-drag interaction. `useContacts` takes `{ hydrated, tasks }` and owns the contacts address-book lifecycle. `useWorkspaceCollapsed` is zero-arg and owns the workspace-panel collapsed state. `task-manager.tsx` replaces ~175 inline lines with three hook calls.

**Tech Stack:** React 19, TypeScript, Vitest 3, @testing-library/react 16, localStorage (jsdom)

---

## Files

| Action | Path |
|--------|------|
| Create | `src/app/use-column-manager.ts` |
| Create | `src/app/use-column-manager.test.ts` |
| Create | `src/app/use-contacts.ts` |
| Create | `src/app/use-contacts.test.ts` |
| Create | `src/app/use-workspace-collapsed.ts` |
| Create | `src/app/use-workspace-collapsed.test.ts` |
| Modify | `src/app/task-manager.tsx` |
| Modify | `src/app/version.ts` |
| Modify | `CHANGELOG.md` |
| Modify | `README.md` |

---

## Hook Interfaces

### `useColumnManager`

```typescript
// src/app/use-column-manager.ts
export function useColumnManager(): {
  colWidths: Record<string, number>;
  setColWidths: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  hiddenCols: Set<string>;
  setHiddenCols: React.Dispatch<React.SetStateAction<Set<string>>>;
  colConfigOpen: boolean;
  setColConfigOpen: React.Dispatch<React.SetStateAction<boolean>>;
  colConfigRef: React.RefObject<HTMLDivElement | null>;
  resetColWidths: () => void;
  startColResize: (col: string, e: React.MouseEvent) => void;
}
```

Internally owns:
- Module-level constants (moved from `task-manager.tsx`): `COL_WIDTHS_KEY = "lop-app:col-widths"`, `HIDDEN_COLS_KEY = "lop-app:hidden-cols"`, `DEFAULT_COL_WIDTHS`
- `useState` for `colWidths` (initialised to `DEFAULT_COL_WIDTHS`), `hiddenCols` (initialised to `new Set()`), `colConfigOpen` (initialised to `false`)
- `useRef` for `colDragRef` (`{ col, startX, startW } | null`, initialised to `null`) and `colConfigRef` (`HTMLDivElement | null`, initialised to `null`)
- **colWidths hydration effect** (deps `[]`): reads `COL_WIDTHS_KEY` from localStorage, merges into current state if valid object
- **colWidths persist effect** (deps `[colWidths]`): debounced 250ms — uses `setTimeout`/`clearTimeout` to write `COL_WIDTHS_KEY`
- **hiddenCols hydration effect** (deps `[]`): reads `HIDDEN_COLS_KEY`, sets `hiddenCols` from parsed array
- **hiddenCols persist effect** (deps `[hiddenCols]`): writes `HIDDEN_COLS_KEY` as JSON array
- **colConfigOpen click-outside+Escape effect** (deps `[colConfigOpen]`): adds `mousedown` + `keydown` listeners while open, calls `setColConfigOpen(false)` on outside click or Escape
- **`resetColWidths`**: `useCallback` with `[]` deps — calls `setColWidths(DEFAULT_COL_WIDTHS)` and `localStorage.removeItem(COL_WIDTHS_KEY)`
- **`startColResize`**: `useCallback` with `[colWidths]` deps — sets `colDragRef.current`, adds `mousemove`/`mouseup` listeners on `window`, removes them on `mouseup`

### `useContacts`

```typescript
// src/app/use-contacts.ts
export interface UseContactsArgs {
  hydrated: boolean;   // from useSettings — gates seed-from-tasks logic
  tasks: Task[];
}

export function useContacts({ hydrated, tasks }: UseContactsArgs): {
  contacts: ContactsMap;
  setContacts: React.Dispatch<React.SetStateAction<ContactsMap>>;
  contactsList: Contact[];
  handleRemoveContact: (name: string) => void;
}
```

Internally owns:
- `useState` for `contacts` (initialised to `{}`)
- `useRef` for `contactsHydratedRef` (initialised to `false`)
- **Hydration effect** (deps `[hydrated, tasks]`): guards on `contactsHydratedRef.current` (already run) and `hydrated` (not yet ready); calls `loadContacts()`, seeds from `tasks` via `seedContactsFromTasks` if empty, calls `setContacts`, sets ref to `true`; if seeded from tasks, calls `saveContacts` immediately
- **Persist effect** (deps `[contacts]`): guards on `contactsHydratedRef.current`; calls `saveContacts(contacts)`
- **`contactsList`**: `useMemo(() => listContacts(contacts), [contacts])`
- **`handleRemoveContact`**: plain function — calls `setContacts(prev => removeContact(prev, name))`

### `useWorkspaceCollapsed`

```typescript
// src/app/use-workspace-collapsed.ts
export function useWorkspaceCollapsed(): {
  workspaceCollapsed: boolean;
  setWorkspaceCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
}
```

Internally owns:
- Module-level constant (moved from `task-manager.tsx`): `WORKSPACE_COLLAPSED_KEY = "lop-app:workspace-collapsed"`
- `useState` for `workspaceCollapsed` (initialised to `false`)
- **Hydration effect** (deps `[]`): reads `WORKSPACE_COLLAPSED_KEY`; if `"1"`, calls `setWorkspaceCollapsed(true)`
- **Persist effect** (deps `[workspaceCollapsed]`): writes `"1"` or removes key based on value

---

## task-manager.tsx changes

### Add imports (near existing hook imports)

```typescript
import { useColumnManager } from "./use-column-manager";
import { useContacts } from "./use-contacts";
import { useWorkspaceCollapsed } from "./use-workspace-collapsed";
```

### Replace inline blocks with three hook calls

**Remove** (~175 lines):
- `const [workspaceCollapsed, setWorkspaceCollapsed] = useState(false)` + 2 workspace-collapsed effects
- `const [colWidths, setColWidths] = useState(DEFAULT_COL_WIDTHS)` + `colDragRef` + `hiddenCols` + `colConfigOpen` + `colConfigRef` + `resetColWidths` + `startColResize` + 4 col effects
- `const [contacts, setContacts] = useState<ContactsMap>({})` + `contactsHydratedRef` + 2 contacts effects + `handleRemoveContact` function + `contactsList` useMemo

**Add** (immediately after `const { activityLog, ... } = useActivityLog({ lang })`):
```typescript
const { workspaceCollapsed, setWorkspaceCollapsed } = useWorkspaceCollapsed();
const {
  colWidths, setColWidths, hiddenCols, setHiddenCols,
  colConfigOpen, setColConfigOpen, colConfigRef,
  resetColWidths, startColResize,
} = useColumnManager();
const { contacts, setContacts, contactsList, handleRemoveContact } =
  useContacts({ hydrated, tasks });
```

### Remove now-unused constants and imports

- Remove `const WORKSPACE_COLLAPSED_KEY`, `const COL_WIDTHS_KEY`, `const HIDDEN_COLS_KEY`, `const DEFAULT_COL_WIDTHS` from the module level
- From `./contacts` import: remove `ContactsMap`, `listContacts`, `loadContacts`, `removeContact as removeContactFromMap`, `saveContacts`, `seedContactsFromTasks` — keep `greetingName` and `upsertContact` (still used in `handleSubmit` and elsewhere)

---

## Tests

### `use-column-manager.test.ts` (no wrapper needed)

1. `colWidths` equals `DEFAULT_COL_WIDTHS` initially
2. `hiddenCols` is an empty `Set` initially
3. `colConfigOpen` is `false` initially
4. After mount, loads `colWidths` from pre-seeded localStorage
5. After mount, loads `hiddenCols` from pre-seeded localStorage
6. `resetColWidths` resets to `DEFAULT_COL_WIDTHS` and removes the localStorage key
7. `setColWidths` debounces persistence — `vi.useFakeTimers()`, advance 250ms, verify localStorage written

### `use-contacts.test.ts` (no wrapper needed)

1. `contacts` is `{}` and `contactsList` is `[]` initially
2. Does NOT hydrate when `hydrated=false`
3. Hydrates from pre-seeded localStorage when `hydrated=true`
4. `handleRemoveContact` removes the named entry from the contacts map

### `use-workspace-collapsed.test.ts` (no wrapper needed)

1. `workspaceCollapsed` is `false` initially
2. After mount, loads `true` from pre-seeded localStorage (`"1"`)
3. `setWorkspaceCollapsed(true)` persists `"1"` to localStorage
4. `setWorkspaceCollapsed(false)` removes the key from localStorage

---

## Version

- `APP_VERSION` → `"0.7.8"`
- `APP_BUILD_DATE` → `"2026-05-21"`
- Codename: **"Faulkner"**
- CHANGELOG entry: `[0.7.8] "Faulkner" — 2026-05-21`
- README badge: v0.7.7 → v0.7.8
