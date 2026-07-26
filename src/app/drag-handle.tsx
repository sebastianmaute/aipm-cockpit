"use client";
import type React from "react";
import { EllipsisVerticalIcon } from "@heroicons/react/24/outline";
import { FOCUS_RING, TRANSITION } from "./interaction-styles";

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
  onMouseDown?: (e: React.MouseEvent<HTMLElement>) => void;
  /** Composed AFTER the atom's own base classes (size, position, color,
   *  cursor stay entirely the caller's — this atom has no opinion on them). */
  className?: string;
}

export function DragHandle({
  ariaLabel,
  draggable,
  onDragStart,
  onMouseDown,
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
      onMouseDown={onMouseDown}
      // PRESS is omitted deliberately: a grip is held through the whole gesture, not
      // clicked-and-released, so active:translate-y-px would visibly fight the pointer
      // for the drag's duration. Gantt's grip and the old ColumnResizeHandle both
      // reached the same conclusion independently.
      className={`flex select-none items-center justify-center print:hidden ${TRANSITION} ${isAccessible ? `${FOCUS_RING} ` : ""}${className}`}
    >
      <EllipsisVerticalIcon aria-hidden="true" className="h-4 w-4" />
    </div>
  );
}
