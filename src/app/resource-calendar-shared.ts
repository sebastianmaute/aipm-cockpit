// Shared vocabulary for the resource calendar grid — day/assignee shapes and
// layout constants used by resource-calendar.tsx (orchestrator),
// resource-calendar-rows.tsx (assignee rows) and resource-calendar-band.tsx
// (meetings band). A dedicated leaf, owned by neither sibling: CELL_PX and
// ASSIGNEE_COL_PX are VALUE bindings, not type-only, so once both siblings
// need them, having one import from the other would be a genuine circular
// VALUE import — a real TDZ/evaluation-order risk, not a style concern.
// Mirrors the gantt-engine.ts precedent (shared vocabulary in its own leaf,
// row/chrome components hold only their own rendering).

export const CELL_PX = 40;
export const ASSIGNEE_COL_PX = 180;

export interface CalendarAssignee {
  /** Case-folded join key used to look up matching absences. */
  key: string;
  /** Original-case display name for the row label. */
  display: string;
  /** First non-empty email observed for this assignee (may be ""). */
  email: string;
}

export interface CalendarDay {
  iso: string;
  dayOfMonth: number;
  /** Localised short weekday, e.g. "Mon" / "Mo". */
  weekdayLabel: string;
  /** ISO-8601 week number (1-53) of this date. */
  isoWeek: number;
  /** Month label shown on the first day and at each month transition. */
  monthLabel: string;
  isWeekend: boolean;
  isHoliday: boolean;
  isToday: boolean;
}
