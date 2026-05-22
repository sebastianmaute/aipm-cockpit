# Inline Add Rows Design

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an inline "add" row at the bottom of the task table and the RAID panel, matching the existing Gantt panel pattern — a dashed-border clickable row that opens the relevant creation modal.

---

## Motivation

The Gantt panel already has this affordance. The task table and RAID panel require the user to click a toolbar button to add entries. An inline bottom row provides a faster, more discoverable path that follows the established visual pattern.

---

## Behaviour

| Panel | Row label | On click | Category default |
|-------|-----------|----------|-----------------|
| Task table | `t(lang, "addTask")` | `handleCancelEdit()` + `setTaskModalOpen(true)` | n/a |
| RAID panel | `t(lang, "raidAddItem")` | `openNew(category)` | Active filter category, or `"R"` when filter is `"All"` |

Both rows are **always visible** — they appear below all data rows, and also below the empty-state placeholder when the panel has no entries.

---

## Visual Spec

Both rows match the Gantt `onAddTask` row exactly:

```tsx
<tr>
  <td colSpan={visibleColumnCount}>
    <div
      role="button"
      tabIndex={0}
      onClick={handler}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          handler();
        }
      }}
      className="group flex cursor-pointer items-center gap-2 border-b border-dashed
                 border-zinc-200 px-3 py-1.5 text-sm text-zinc-400
                 hover:bg-AIPM-dark-blue/5 hover:text-AIPM-dark-blue
                 dark:border-zinc-700 dark:hover:bg-white/5"
    >
      <PlusIcon className="h-3.5 w-3.5 opacity-50 group-hover:opacity-100" />
      {label}
    </div>
  </td>
</tr>
```

`PlusIcon` is already used elsewhere in the codebase — import from the existing source.

---

## Architecture

### Task table (`tasks-section.tsx`)

- Add the row inside `<tbody>` after the last `<TaskRow>`.
- `colSpan`: use the count of visible columns (same logic already used for the empty-state `<td colSpan={...}>`).
- Handler: `() => { handleCancelEdit(); setTaskModalOpen(true); }` — both are existing `TasksSectionProps`.
- No new props required.

### RAID panel (`raid-panel.tsx`)

- Add the row inside the RAID `<tbody>` after the last data row.
- `colSpan`: span the full RAID table column count (fixed, inspect existing table header).
- Handler: `() => openNew(effectiveCategory)` where:
  ```typescript
  const effectiveCategory: RaidCategory =
    categoryFilter === "All" ? "R" : categoryFilter;
  ```
  `openNew` is already defined inside `RaidPanelInner`; `categoryFilter` is already local state.
- No new props or state required.

---

## Files Modified

| File | Change |
|------|--------|
| `src/app/tasks-section.tsx` | Add inline add row to task `<tbody>` |
| `src/app/raid-panel.tsx` | Add inline add row to RAID `<tbody>` |

No new files. No new i18n keys (both labels use existing keys).

---

## Testing

### `tasks-section.test.tsx` (modify existing)

1. Add row is present when tasks list is non-empty
2. Add row is present when tasks list is empty (below empty-state placeholder)
3. Clicking the add row calls `setTaskModalOpen` with `true`

### `raid-panel.test.tsx` (new or modify existing)

4. Add row is present in the RAID table
5. Clicking the add row when category filter is `"All"` calls `openNew` with `"R"`
6. Clicking the add row when category filter is `"A"` calls `openNew` with `"A"`

---

## Tasks (for implementation plan)

1. Add inline add row to `tasks-section.tsx` + tests
2. Add inline add row to `raid-panel.tsx` + tests
