import type { Settings, CalendarEntityType } from "./settings-types";

/** Effective calendar-sync flags for an entity type. `auto` is only true when
 *  `enabled` is also true (auto is meaningless while disabled). */
export function calendarSyncFor(
  s: Settings,
  type: CalendarEntityType,
): { enabled: boolean; auto: boolean } {
  const e = s.outlookCalendar?.[type];
  const enabled = e?.enabled === true;
  return { enabled, auto: enabled && e?.auto === true };
}
