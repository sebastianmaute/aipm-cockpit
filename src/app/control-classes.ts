// Shared class strings for control looks that have no component of their own
// (owner decision 2026-10-09: share a constant rather than add a primitive).
// Unlike interaction-styles.ts these carry colour, from the palette tokens only.
import { INTERACTIVE } from "./interaction-styles";

/** The click-through cell (§687): a borderless box that outlines in dark blue
 *  and fills on hover, used to open an entity from a table cell, a Gantt row, a
 *  Kanban card or a dashboard tile. The caller adds padding (`px-2 py-0.5` for
 *  text), layout and text classes. */
export const CELL_BUTTON = `cursor-pointer rounded-md border border-transparent hover:border-ui-dark-blue hover:bg-surface-muted ${INTERACTIVE}`;
