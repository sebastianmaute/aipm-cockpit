// src/app/tasks-section-columns.ts
//
// The Open Points column id list, in render order. Extracted from
// `tasks-section.tsx` so the pure geometry module can import it without
// pulling in the React pane (and so the pane stays under its size ratchet).
export const ALL_TASK_COLS = ["sel","status","id","taskName","assignee","startDate","dueDate","lastUpdateDate","createdDate","priority","taskStatus","blockers","description","notesLog","depRelations","estimate","spent","actions"] as const;

/**
 * DECLARED width per column.
 *
 * ★ Lives HERE, beside the column list, rather than in `use-column-manager.ts`:
 *   that module is `"use client"` and pulls in React, so importing this from
 *   there put React into the pure geometry module's import graph — defeating the
 *   very extraction this leaf exists for. `use-column-manager` re-exports it, so
 *   existing importers are unaffected.
 * ★ Under `table-layout: fixed` every column that DECLARES a width keeps it and
 *   the leftover goes to `taskName`, the sole auto column (see
 *   `open-points-table-geometry.ts`). So each utility column is tuned to what it
 *   actually holds rather than padded to absorb slack.
 */
export const DEFAULT_COL_WIDTHS: Record<string, number> = {
  sel: 36, // a 16px checkbox plus its tap padding
  status: 28, // holds a single ~10px RAG dot
  id: 80,
  taskName: 200,
  assignee: 140,
  startDate: 110,
  dueDate: 110,
  lastUpdateDate: 110,
  createdDate: 110,
  priority: 90,
  taskStatus: 110,
  blockers: 140,
  description: 140,
  notesLog: 80,
  depRelations: 80, // an em-dash, or read-only chips (the edit pencil is gone)
  estimate: 80,
  spent: 80,
  // Two icon buttons — Send inquiry (an `IconButton`, `p-1` + `h-4 w-4` = 24px)
  // and the ⋮ overflow trigger (`border` + `px-2` + a ~4px glyph ≈ 22px, budgeted
  // at 24) — plus the `mr-1` between them: 24 + 4 + 24 = 52px of content, plus
  // the `<Td>`'s default `px-4` = 32px of padding = 84, rounded up to 88 for the
  // ⋮ glyph's font-metric variance and the focus ring.
  // ★ This width is a HARD limit, not a minimum: the column is `table-layout:
  //   fixed` and its `<Th>` has NO `onResize`, so content overflows and a user
  //   can never widen it. Under-declaring it here (it was 32, i.e. the padding
  //   alone, so the content box was exactly ZERO) makes the cell unusable with
  //   every gate green. Pinned by open-points-table-geometry.test.ts.
  actions: 88,
};
