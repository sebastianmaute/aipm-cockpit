/** The standard view-pane chrome — a rounded, bordered surface card. Matches the
 *  Open Points (tasks) pane so every primary view reads consistently. */
export const VIEW_PANE_CLASS = "rounded-xl border border-line bg-surface";

/** Full-height pane card for primary views in the modern shell. Identical chrome
 *  to the Open Points (tasks) pane — it fills the viewport (h-full) and clips, so
 *  internal scroll lives in child regions. Every primary view uses this constant
 *  so they read identically: same inset, padding, radius, and height-fill. */
export const VIEW_PANE_FILL_CLASS =
  "relative flex h-full min-h-0 w-full flex-col overflow-hidden rounded-xl border border-line bg-surface p-6";

/** Standard inner scroll-area chrome for tables inside a view pane. Keeps the
 *  resources sub-views visually identical to the tasks table (no divergent
 *  rounded-md inset card). */
export const INNER_TABLE_CLASS =
  "min-h-0 flex-1 overflow-auto rounded-xl border border-line bg-surface";

/** Full-height pane card that is ALSO user-resizable: fills by default, but the
 *  bottom-right corner drags to a custom size (persisted via useResizable). */
export const VIEW_PANE_RESIZABLE_CLASS =
  VIEW_PANE_FILL_CLASS + " resize min-h-[300px] min-w-[480px]";
