"use client";

// Presentational control rows for the Resource Planner panel (gantt-convention
// `*-toolbar` leaf). PURE: the orchestrator (`resources-panel.tsx`) owns state
// and passes values + handlers; the shared `headerActions` / `hideExternalToggle`
// nodes are threaded as `ReactNode` so their closures stay in the orchestrator.

import type { ReactNode } from "react";
import { localeFor, shortDateRangeIso } from "./date-format";
import { type CalendarMode } from "./calendar-window";
import { type Lang, t } from "./i18n";
import { SegmentedControl } from "./segmented-control";
import { Input } from "./form-controls";
import { InfoTooltip } from "./info-tooltip";
import { TableFilter } from "./report-table";
import type { PlanGranularity } from "./types";
import { FOCUS_RING, INTERACTIVE } from "./interaction-styles";

interface PlanningToolbarProps {
  lang: Lang;
  planStartDate: string;
  planEndDate: string;
  onSetPlanWindow: (startDate: string, endDate: string) => void;
  viewGranularity: PlanGranularity;
  onSetViewGranularity: (g: PlanGranularity) => void;
  /** Current shared utilization mode (or "percent" when resources disagree). */
  utilizationMode: "percent" | "hours";
  onSetAllUtilizationMode: (mode: "percent" | "hours") => void;
  hideExternalToggle: ReactNode;
  headerActions: ReactNode;
  planFilter: string;
  onPlanFilter: (value: string) => void;
}

export function PlanningToolbar({
  lang,
  planStartDate,
  planEndDate,
  onSetPlanWindow,
  viewGranularity,
  onSetViewGranularity,
  utilizationMode,
  onSetAllUtilizationMode,
  hideExternalToggle,
  headerActions,
  planFilter,
  onPlanFilter,
}: PlanningToolbarProps) {
  return (
    <>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs print:hidden">
        <label className="flex items-center gap-1">
          <span className="flex items-center gap-1">{t(lang, "resourcesPlanStart")}<InfoTooltip text={t(lang, "resourcesPlanStartHint")} /></span>
          <Input type="date" aria-label={t(lang, "resourcesPlanStart")} value={planStartDate}
            onChange={(e) => onSetPlanWindow(e.target.value, planEndDate)} />
        </label>
        <label className="flex items-center gap-1">
          <span className="flex items-center gap-1">{t(lang, "resourcesPlanEnd")}<InfoTooltip text={t(lang, "resourcesPlanEndHint")} /></span>
          <Input type="date" aria-label={t(lang, "resourcesPlanEnd")} value={planEndDate}
            onChange={(e) => onSetPlanWindow(planStartDate, e.target.value)} />
        </label>
        <SegmentedControl<"week" | "month">
          value={viewGranularity}
          ariaLabel={t(lang, "resourcesViewPlanning")}
          title={t(lang, "resourcesGranularityHint")}
          options={[
            { value: "month", label: t(lang, "resourcesGranularityMonth") },
            { value: "week", label: t(lang, "resourcesGranularityWeek") },
          ]}
          onChange={onSetViewGranularity}
        />
        <SegmentedControl<"percent" | "hours">
          value={utilizationMode}
          ariaLabel={t(lang, "resourcesUtilModeHint")}
          title={t(lang, "resourcesUtilModeHint")}
          options={[
            { value: "percent", label: t(lang, "resourcesUtilModePercent") },
            { value: "hours", label: t(lang, "resourcesUtilModeHours") },
          ]}
          onChange={onSetAllUtilizationMode}
        />
        {hideExternalToggle}
        <div className="ml-auto">{headerActions}</div>
      </div>
      <div className="print:hidden">
        <TableFilter lang={lang} value={planFilter} onChange={onPlanFilter} placeholderKey="planningFilterResource" />
      </div>
    </>
  );
}

interface CalendarToolbarProps {
  lang: Lang;
  calendarMode: CalendarMode;
  onCalendarMode: (mode: CalendarMode) => void;
  winStartDate: string;
  winEndDate: string;
  onCalendarPrev: () => void;
  onCalendarNext: () => void;
  onCalendarToday: () => void;
  calendarFrom: string;
  onCalendarFrom: (value: string) => void;
  calendarTo: string;
  onCalendarTo: (value: string) => void;
  onCalendarCustomToday: () => void;
  includeExternals: boolean;
  onToggleIncludeExternals: (checked: boolean) => void;
  headerActions: ReactNode;
}

export function CalendarToolbar({
  lang,
  calendarMode,
  onCalendarMode,
  winStartDate,
  winEndDate,
  onCalendarPrev,
  onCalendarNext,
  onCalendarToday,
  calendarFrom,
  onCalendarFrom,
  calendarTo,
  onCalendarTo,
  onCalendarCustomToday,
  includeExternals,
  onToggleIncludeExternals,
  headerActions,
}: CalendarToolbarProps) {
  return (
    <div className="mb-2 flex flex-wrap items-center gap-2 text-xs print:hidden">
      <SegmentedControl<CalendarMode>
        value={calendarMode}
        ariaLabel={t(lang, "resourcesViewCalendar")}
        title={t(lang, "resourcesViewCalendar")}
        options={[
          { value: "month", label: t(lang, "resourcesGranularityMonth") },
          { value: "week", label: t(lang, "resourcesGranularityWeek") },
          { value: "custom", label: t(lang, "calendarModeCustom") },
        ]}
        onChange={onCalendarMode}
      />
      {calendarMode !== "custom" && (
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label={t(lang, "calendarPrev")}
            title={t(lang, "calendarPrev")}
            onClick={onCalendarPrev}
            className={`rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-surface-muted ${INTERACTIVE}`}
          >
            ◀
          </button>
          <span className="min-w-[8rem] text-center font-medium text-foreground tabular-nums">
            {calendarMode === "week"
              ? shortDateRangeIso(winStartDate, winEndDate, lang)
              : new Date(`${winStartDate}T00:00:00Z`).toLocaleDateString(localeFor(lang), { month: "long", year: "numeric", timeZone: "UTC" })}
          </span>
          <button
            type="button"
            aria-label={t(lang, "calendarNext")}
            title={t(lang, "calendarNext")}
            onClick={onCalendarNext}
            className={`rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-surface-muted ${INTERACTIVE}`}
          >
            ▶
          </button>
          <button
            type="button"
            aria-label={t(lang, "calendarToday")}
            title={t(lang, "calendarToday")}
            onClick={onCalendarToday}
            className={`rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-surface-muted ${INTERACTIVE}`}
          >
            {t(lang, "calendarToday")}
          </button>
        </div>
      )}
      {calendarMode === "custom" && (
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1">
            <span>{t(lang, "calendarFrom")}</span>
            <Input
              type="date"
              size="xs"
              aria-label={t(lang, "calendarFrom")}
              value={calendarFrom}
              onChange={(e) => onCalendarFrom(e.target.value)}
            />
          </label>
          <label className="flex items-center gap-1">
            <span>{t(lang, "calendarTo")}</span>
            <Input
              type="date"
              size="xs"
              aria-label={t(lang, "calendarTo")}
              value={calendarTo}
              onChange={(e) => onCalendarTo(e.target.value)}
            />
          </label>
          <button
            type="button"
            aria-label={t(lang, "calendarToday")}
            title={t(lang, "calendarToday")}
            onClick={onCalendarCustomToday}
            className={`rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-surface-muted ${INTERACTIVE}`}
          >
            {t(lang, "calendarToday")}
          </button>
        </div>
      )}
      <label className="flex items-center gap-1.5 text-foreground">
        <input
          type="checkbox"
          checked={includeExternals}
          aria-label={t(lang, "calendarIncludeExternals")}
          onChange={(e) => onToggleIncludeExternals(e.target.checked)}
          className={`align-middle ${FOCUS_RING}`}
        />
        <span>{t(lang, "calendarIncludeExternals")}</span>
      </label>
      <div className="ml-auto">{headerActions}</div>
    </div>
  );
}
