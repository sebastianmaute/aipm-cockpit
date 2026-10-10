// Shared class strings for control looks that have no component of their own
// (owner decision 2026-10-09: share a constant rather than add a primitive).
// Unlike interaction-styles.ts these carry colour, from the palette tokens only.
import { INTERACTIVE } from "./interaction-styles";

/** The click-through cell (§687): a borderless box that outlines in dark blue
 *  and fills on hover, used to open an entity from a table cell, a Gantt row, a
 *  Kanban card or a dashboard tile. The caller adds padding (`px-2 py-0.5` for
 *  text), layout and text classes. */
export const CELL_BUTTON = `cursor-pointer rounded-md border border-transparent hover:border-ui-dark-blue hover:bg-surface-muted ${INTERACTIVE}`;

export type MenuItemTone = "default" | "danger" | "current";

const MENU_ITEM_TONE: Record<MenuItemTone, string> = {
  default: "text-foreground hover:bg-surface-muted",
  // A destructive item (Delete): pink text and a pink-tinted hover.
  danger: "text-ui-pink-strong hover:bg-ui-pink/5",
  // The item for the current choice (the rich-text block style in use).
  current: "font-semibold text-ui-dark-blue hover:bg-surface-muted dark:text-ui-light-grey",
};

/** A popover menu item (§692): one size for every menu (`px-3 py-1.5 text-sm`),
 *  full width and left-aligned, with the shared focus ring, press feedback and
 *  disabled look. The caller adds alignment and gap (`items-center gap-2` for
 *  an icon row, `flex-col items-start gap-0.5` for a two-line item). */
export function menuItemClass(tone: MenuItemTone = "default"): string {
  return `flex w-full rounded-md px-3 py-1.5 text-left text-sm ${MENU_ITEM_TONE[tone]} disabled:cursor-not-allowed disabled:opacity-50 ${INTERACTIVE}`;
}
