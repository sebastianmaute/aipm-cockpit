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
  "min-h-0 flex-1 overflow-auto rounded-xl border border-line bg-surface pr-2";

/** Full-height pane card that is ALSO user-resizable: fills by default, but the
 *  bottom-right corner drags to a custom size (persisted via useResizable). */
export const VIEW_PANE_RESIZABLE_CLASS =
  VIEW_PANE_FILL_CLASS + " resize min-h-[300px] min-w-[480px]";

/** Centered, user-resizable pane card for the Influence / Interest map (§756): on a large screen (2xl, 1536px
 *  and up) half the view's width and height with `p-6`, as the map always was; below that the WHOLE view with
 *  `p-4`. Half of a 1280×720 window left a 488×360 pane and four 184×83 quadrants, which cut the second name
 *  card off (measured 2026-10-20); the full view gives them about twice the width and well over twice the
 *  height. Drag the corner for a custom size, as before. */
export const CENTERED_MAP_PANE_CLASS =
  "relative mx-auto flex h-full max-h-full min-h-[360px] w-full min-w-[420px] flex-col overflow-hidden rounded-xl border border-line bg-surface p-4 resize 2xl:h-[50%] 2xl:w-[50%] 2xl:p-6";

/** A centered, half-height pane with the width taken from the available space
 *  instead of half of it: full width up to a readable cap of 64rem. Used by
 *  Projects, whose card row carries a name, code, badge and actions that were
 *  wrapping inside a half-width column while the rest of the page sat empty.
 *  A size the user DRAGGED still wins — `useResizable` writes it inline —
 *  and the cap lives in the `width` value rather than a `max-width` for exactly
 *  that reason: a `max-w-*` would clamp an inline drag wider than the cap. */
export const CENTERED_WIDE_PANE_CLASS =
  "relative mx-auto flex h-[50%] max-h-full min-h-[360px] w-[min(100%,64rem)] min-w-[420px] flex-col overflow-hidden rounded-xl border border-line bg-surface p-6 resize";

/** Centered pane that grows with its content but never exceeds the viewport
 *  (then its body scrolls), AND is user-resizable: the default height tracks the
 *  content, but the bottom-right corner drags to a custom size (the drag
 *  overrides the content-fit height/width within the min/max bounds). Used by
 *  Manage Roles. The width is the whole content area up to 72rem, which the rate
 *  card (about 1,050px of table) fits in (§766): half of the area left it
 *  420–488px below a 1366px window (measured 2026-10-23). As in
 *  CENTERED_WIDE_PANE_CLASS the cap lives in `width`, not a `max-w-*`, so a drag
 *  wider than the cap still wins. */
export const CENTERED_FIT_PANE_CLASS =
  "relative mx-auto flex w-[min(100%,72rem)] min-w-[420px] max-h-[calc(100vh-7rem)] min-h-[280px] flex-col overflow-hidden rounded-xl border border-line bg-surface p-6 resize";
