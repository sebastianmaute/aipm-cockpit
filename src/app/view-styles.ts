/** The standard view-pane chrome — a rounded, bordered surface card. Matches the
 *  Open Points (tasks) pane so every primary view reads consistently. */
export const VIEW_PANE_CLASS = "rounded-xl border border-line bg-surface";

/** Standard inner scroll-area chrome for tables inside a view pane. Keeps the
 *  resources sub-views visually identical to the tasks table (no divergent
 *  rounded-md inset card). */
export const INNER_TABLE_CLASS =
  "min-h-0 flex-1 overflow-auto rounded-xl border border-line bg-surface";
