// The Kanban board's per-column page size (§5). A pure module on purpose: the opt-in
// perf probe (e2e/perf-task-board.spec.ts) reads it in Node, and importing it from
// task-kanban-board.tsx would pull the board's whole React import graph in with it.

/** A status column renders at most this many cards, then a "Show more" button that
 *  adds this many again (docs/superpowers/specs/2026-10-08-kanban-column-cap-design.md).
 *  At or under it a column renders exactly as it did before the cap. */
export const KANBAN_COLUMN_PAGE = 100;
