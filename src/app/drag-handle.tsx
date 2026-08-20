"use client";
import type React from "react";
import { EllipsisVerticalIcon } from "@heroicons/react/24/outline";
import { TRANSITION } from "./interaction-styles";

/** Grip focus ring — deliberately `focus-visible:`, NOT the shared FOCUS_RING
 *  primitive (which is `focus:`). A grip is PRESSED and held for the whole
 *  gesture, so a `focus:` ring would paint for the drag's entire duration.
 *  All five hand-rolled reorder grips reached this independently and spell it
 *  exactly this way — reports.tsx, budget-panel.tsx, dashboard-tile.tsx, and
 *  roles-editor.tsx's two via its own REORDER_HANDLE_CLASS; dashboard-tile.tsx
 *  carries the rationale inline. `outline-none` deliberately stays on plain
 *  `focus:`, matching every focus-visible ring call site in the app.
 *  ★ No count is quoted on purpose: the constant below IS one of those call
 *  sites, so any grep for the spelling now matches this file too. */
const GRIP_FOCUS_RING =
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-ui-green";

/**
 * Shared drag/resize grip shell: an always-visible ⋮ affordance for a
 * mouse-driven drag gesture. The MEANING (what dragging it does — resize a
 * table column, resize a calendar event, ...) is entirely the caller's;
 * this atom owns only the generic shape, glyph and a11y wiring.
 *
 * Extracted from `ColumnResizeHandle` (task-manager-ui.tsx), which is
 * DECORATIVE (mouse-only enhancement — the underlying control stays usable
 * without it, e.g. via a Reset-widths button), so it renders `aria-hidden`
 * with no role. A caller where the grip is load-bearing (the only way to
 * perform the gesture) passes `ariaLabel` to get a real `role="button"`
 * with that accessible name instead — never both at once.
 *
 * ★★ IT FORWARDS THE FULL `useListReorderDnd().handleProps(id)` CONTRACT —
 * `draggable`, `onDragStart`, `onDragEnd`, `onKeyDown` — so a reorder caller
 * can spread that return value straight onto the grip. It carried only the
 * first two until this change, and a spread caller lost the other two
 * SILENTLY (excess props on a typed component are a tsc error only for
 * literal JSX attributes, never for a spread of a wider object). Both are
 * load-bearing: without `onDragEnd` the hook's `dragId` stays set for the
 * rest of the session and a later drop reorders an item nobody picked up;
 * without `onKeyDown` there is no ArrowUp/ArrowDown reorder, which is the
 * ONLY reorder path available without a mouse.
 *
 * ★ Forwarding them MIGRATES NOTHING BY ITSELF. The five hand-rolled reorder
 * grips (reports.tsx, budget-panel.tsx, dashboard-tile.tsx, roles-editor.tsx
 * ×2) are still hand-rolled `<button>`s; docs/handrolled-ui-inventory.md
 * records the gap above as the reason. This change removes that blocker —
 * it does not close the inventory row.
 */
// NOTE: named DragGripProps, not DragHandleProps — `use-draggable.ts` already
// exports an unrelated DragHandleProps (window-repositioning drag, consumed by
// edit-modal-chrome.tsx / modal-header.tsx) in this same flat `src/app/`
// directory. Two different concepts must not share a name here.
export interface DragGripProps {
  /** Accessible name. Pass it to make the handle a real, independently
   *  announced/keyboard-focusable control; omit it to keep the handle
   *  purely decorative (aria-hidden, mouse-only — the original
   *  ColumnResizeHandle behavior). Must be unique per row where several
   *  handles coexist (e.g. one grip per column, one per calendar event). */
  ariaLabel?: string;
  draggable?: boolean;
  onDragStart?: (e: React.DragEvent<HTMLElement>) => void;
  /** Drag cleanup. Forwarded because `useListReorderDnd().handleProps(id)`
   *  supplies it and dropping it silently leaves `dragId` set for the session
   *  — a later drop then reorders an item nobody picked up. */
  onDragEnd?: () => void;
  /** The ArrowUp/ArrowDown reorder path — the ONLY reorder path available
   *  without a mouse. Also supplied by `handleProps`. */
  onKeyDown?: (e: React.KeyboardEvent<HTMLElement>) => void;
  onMouseDown?: (e: React.MouseEvent<HTMLElement>) => void;
  /** Hover tooltip. Forwarded because every reorder grip that migrated onto
   *  this primitive carries one, and without it each migration would drop the
   *  tooltip SILENTLY — an unknown JSX attribute on a typed component is a tsc
   *  error, but a caller that simply stops passing it is not.
   *  ★ It is NOT the accessible name: alongside `ariaLabel` (which wins the
   *  name) a `title` is the accessible DESCRIPTION, so the two may differ —
   *  every migrated grip pairs a row-QUALIFIED `ariaLabel` with a short
   *  unqualified `title`. */
  title?: string;
  /** Composed AFTER the atom's own base classes (size, position, color,
   *  cursor stay entirely the caller's — this atom has no opinion on them). */
  className?: string;
}

export function DragHandle({
  ariaLabel,
  draggable,
  onDragStart,
  onDragEnd,
  onKeyDown,
  onMouseDown,
  title,
  className = "",
}: DragGripProps) {
  const isAccessible = ariaLabel !== undefined;
  return (
    <div
      role={isAccessible ? "button" : undefined}
      aria-label={isAccessible ? ariaLabel : undefined}
      aria-hidden={isAccessible ? undefined : "true"}
      tabIndex={isAccessible ? 0 : undefined}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onKeyDown={onKeyDown}
      onMouseDown={onMouseDown}
      title={title}
      // PRESS is omitted deliberately: a grip is held through the whole gesture, not
      // clicked-and-released, so active:translate-y-px would visibly fight the pointer
      // for the drag's duration. Gantt's grip and the old ColumnResizeHandle both
      // reached the same conclusion independently.
      className={`flex select-none items-center justify-center print:hidden ${TRANSITION} ${isAccessible ? `${GRIP_FOCUS_RING} ` : ""}${className}`}
    >
      <EllipsisVerticalIcon aria-hidden="true" className="h-4 w-4" />
    </div>
  );
}
