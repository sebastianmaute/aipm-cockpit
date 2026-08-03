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
  depRelations: 96, // an em-dash, or a short chip plus a pencil
  estimate: 80,
  spent: 80,
  actions: 32, // one ⋮ icon button
};
