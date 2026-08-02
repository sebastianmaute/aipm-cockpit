// src/app/tasks-section-columns.ts
//
// The Open Points column id list, in render order. Extracted from
// `tasks-section.tsx` so the pure geometry module can import it without
// pulling in the React pane (and so the pane stays under its size ratchet).
export const ALL_TASK_COLS = ["sel","status","id","taskName","assignee","startDate","dueDate","lastUpdateDate","createdDate","priority","taskStatus","blockers","description","notesLog","depRelations","estimate","spent","actions"] as const;
