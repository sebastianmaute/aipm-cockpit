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

/** The toolbar Outlook enable-toggle's settings write for one entity type.
 *  Switching OFF also forces `auto` off (mirrors the Settings toggle), so a
 *  later re-enable from the toolbar cannot silently reactivate unattended
 *  two-way sync; switching ON keeps whatever `auto` was stored. The one writer
 *  behind all four toolbar toggles (open-followups §57 — four hand-copied
 *  guards that no fixture exercised with `auto: true`). */
export function withCalendarEnabled(s: Settings, type: CalendarEntityType, enabled: boolean): Settings {
  return {
    ...s,
    outlookCalendar: {
      ...s.outlookCalendar,
      [type]: { enabled, auto: enabled ? (s.outlookCalendar?.[type]?.auto ?? false) : false },
    },
  };
}
