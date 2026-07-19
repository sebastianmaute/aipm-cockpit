// src/app/calendar-sync-controls.tsx
//
// Shared two-way Outlook calendar controls for a panel toolbar: the enable
// checkbox plus (when enabled) the Push and Pull buttons. This block was
// duplicated verbatim in the RAID, Change, and Absence (Resources) toolbars —
// only the entity aria-label differed. Consolidated here (jscpd flagged the
// copies). Renders nothing unless M365 is configured, not in a popout, and a
// toggle handler is present — matching the former inline `m365Configured &&
// !isPopout && onToggleCalendar && (…)` guard exactly.
//
// Milestone push/pull is deliberately NOT routed through this (milestone is
// manual-only, with no enable toggle — a different shape).
import { ArrowUpTrayIcon } from "@heroicons/react/24/outline";
import { type Lang, t, type TranslationKey } from "./i18n";
import { INTERACTIVE, FOCUS_RING, TRANSITION } from "./interaction-styles";

export interface CalendarSyncControlsProps {
  lang: Lang;
  /** i18n key for the entity name in the enable checkbox's accessible name. */
  entityLabelKey: TranslationKey;
  m365Configured?: boolean;
  isPopout?: boolean;
  calendarEnabled?: boolean;
  onToggleCalendar?: (enabled: boolean) => void;
  onPushCalendar?: () => void;
  calendarPushBusy?: boolean;
  onPullCalendar?: () => void;
  calendarPullBusy?: boolean;
}

export function CalendarSyncControls({
  lang,
  entityLabelKey,
  m365Configured,
  isPopout,
  calendarEnabled,
  onToggleCalendar,
  onPushCalendar,
  calendarPushBusy,
  onPullCalendar,
  calendarPullBusy,
}: CalendarSyncControlsProps) {
  if (!(m365Configured && !isPopout && onToggleCalendar)) return null;
  return (
    <>
      <label className="flex items-center gap-1.5 text-xs text-foreground">
        <input
          type="checkbox"
          checked={!!calendarEnabled}
          onChange={(e) => onToggleCalendar(e.target.checked)}
          aria-label={`${t(lang, "calendarSyncEnable")} – ${t(lang, entityLabelKey)}`}
          className={`h-3.5 w-3.5 rounded border-line text-ui-dark-blue ${FOCUS_RING} ${TRANSITION}`}
        />
        {t(lang, "calendarSyncEnable")}
      </label>
      {calendarEnabled && onPushCalendar && (
        <button
          type="button"
          onClick={onPushCalendar}
          disabled={calendarPushBusy}
          aria-busy={calendarPushBusy}
          aria-label={t(lang, "calendarPush")}
          title={t(lang, "calendarPush")}
          className={`inline-flex items-center gap-1 rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50 ${INTERACTIVE}`}
        >
          <ArrowUpTrayIcon aria-hidden="true" className="h-3.5 w-3.5" />
          {calendarPushBusy ? t(lang, "calendarPushing") : t(lang, "calendarPush")}
        </button>
      )}
      {calendarEnabled && onPullCalendar && (
        <button
          type="button"
          onClick={onPullCalendar}
          disabled={calendarPullBusy}
          aria-busy={calendarPullBusy}
          aria-label={t(lang, "calendarPull")}
          title={t(lang, "calendarPull")}
          className={`rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50 ${INTERACTIVE}`}
        >
          {calendarPullBusy ? t(lang, "calendarPulling") : t(lang, "calendarPull")}
        </button>
      )}
    </>
  );
}
