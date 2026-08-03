// src/app/calendar-sync-controls.tsx
//
// Shared two-way Outlook calendar controls for a panel toolbar: the enable
// toggle plus (when enabled) the Push and Pull buttons. This block was
// duplicated verbatim in the RAID, Change, and Absence (Resources) toolbars —
// only the entity aria-label differed. Consolidated here (jscpd flagged the
// copies). Renders nothing unless M365 is configured, not in a popout, and a
// toggle handler is present — matching the former inline `m365Configured &&
// !isPopout && onToggleCalendar && (…)` guard exactly.
//
// Milestone push/pull is deliberately NOT routed through this (milestone is
// manual-only, with no enable toggle — a different shape).
import { ArrowDownTrayIcon, ArrowUpTrayIcon, CalendarDaysIcon } from "@heroicons/react/24/outline";
import { Button } from "./button";
import { ToggleButton } from "./toggle-button";
import { type Lang, t, type TranslationKey } from "./i18n";

export interface CalendarSyncControlsProps {
  lang: Lang;
  /** i18n key for the entity name in the enable toggle's accessible name. */
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
      {/* ★★ A ToggleButton, not a checkbox: the label is PINNED to what pressed=true
          ENABLES ("Add to Outlook") and `aria-pressed` tracks that same state, so
          "Add to Outlook, pressed" ⇒ sync is on (WCAG 4.1.2). Never let the label
          flip to the opposite action. ★ `ariaLabel` re-qualifies it per entity —
          several of these render in one view and N identical "Add to Outlook"
          names is a WCAG 2.4.6 failure that axe PASSES, since a name exists. */}
      <ToggleButton
        pressed={!!calendarEnabled}
        onToggle={() => onToggleCalendar(!calendarEnabled)}
        ariaLabel={`${t(lang, "calendarSyncEnable")} – ${t(lang, entityLabelKey)}`}
        title={t(lang, "calendarSyncEnableHint")}
        lang={lang}
        icon={<CalendarDaysIcon aria-hidden="true" className="h-3.5 w-3.5" />}
      >
        {t(lang, "calendarSyncEnable")}
      </ToggleButton>
      {calendarEnabled && onPushCalendar && (
        <Button
          variant="secondary"
          size="xs"
          onClick={onPushCalendar}
          disabled={calendarPushBusy}
          aria-busy={calendarPushBusy}
          aria-label={t(lang, calendarPushBusy ? "calendarPushing" : "calendarPush")}
          title={t(lang, calendarPushBusy ? "calendarPushing" : "calendarPush")}
          className="inline-flex items-center gap-1"
        >
          <ArrowUpTrayIcon aria-hidden="true" className="h-3.5 w-3.5" />
          {calendarPushBusy ? t(lang, "calendarPushing") : t(lang, "calendarPushShort")}
        </Button>
      )}
      {calendarEnabled && onPullCalendar && (
        <Button
          variant="secondary"
          size="xs"
          onClick={onPullCalendar}
          disabled={calendarPullBusy}
          aria-busy={calendarPullBusy}
          aria-label={t(lang, calendarPullBusy ? "calendarPulling" : "calendarPull")}
          title={t(lang, calendarPullBusy ? "calendarPulling" : "calendarPull")}
          className="inline-flex items-center gap-1"
        >
          <ArrowDownTrayIcon aria-hidden="true" className="h-3.5 w-3.5" />
          {calendarPullBusy ? t(lang, "calendarPulling") : t(lang, "calendarPullShort")}
        </Button>
      )}
    </>
  );
}
