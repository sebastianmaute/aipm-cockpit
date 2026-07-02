// src/app/raid-panel-toolbar.tsx
//
// Presentational RAID toolbar (move-only extraction from raid-panel.tsx, mirrors
// the gantt-chrome split). Filters, calendar controls, saved-views, print, and
// reset buttons. Pure: all state + handlers arrive as props from the orchestrator.
import { type Lang, t } from "./i18n";
import { categoryLabel, severityLabel } from "./raid-labels";
import { RAID_CATEGORIES, RAID_SEVERITIES } from "./types";
import { PrintButton, ResetColWidthsButton, ResetSizeButton } from "./task-manager-ui";
import { INTERACTIVE, FOCUS_RING, TRANSITION } from "./interaction-styles";
import { PanelViewsControl } from "./panel-views-control";
import { ColumnConfigPopover } from "./column-config-popover";
import { RAID_CONFIG_COLS, type RaidCol } from "./raid-panel-columns";

export interface RaidToolbarProps {
  lang: Lang;
  search: string;
  onSearchChange: (value: string) => void;
  categoryFilter: string;
  severityFilter: string;
  statusFilter: string;
  onSetFilter: (key: string, value: string) => void;
  onResetFilters: () => void;
  onToggleColumn: (key: string) => void;
  hiddenSet: Set<RaidCol | string>;
  filterTaskId: number | null;
  onClearTaskFilter: () => void;
  filtersActive: boolean;
  onAddNew: () => void;
  onResetColWidths: () => void;
  onResetSize: () => void;
  m365Configured?: boolean;
  isPopout?: boolean;
  calendarEnabled?: boolean;
  onToggleCalendar?: (enabled: boolean) => void;
  onPushCalendar?: () => void;
  calendarPushBusy?: boolean;
  onPullCalendar?: () => void;
  calendarPullBusy?: boolean;
}

export function RaidToolbar({
  lang,
  search,
  onSearchChange,
  categoryFilter,
  severityFilter,
  statusFilter,
  onSetFilter,
  onResetFilters,
  onToggleColumn,
  hiddenSet,
  filterTaskId,
  onClearTaskFilter,
  filtersActive,
  onAddNew,
  onResetColWidths,
  onResetSize,
  m365Configured,
  isPopout,
  calendarEnabled,
  onToggleCalendar,
  onPushCalendar,
  calendarPushBusy,
  onPullCalendar,
  calendarPullBusy,
}: RaidToolbarProps) {
  return (
    <div className="mb-2 flex shrink-0 flex-wrap items-center gap-2 print:hidden">
      <button
        type="button"
        onClick={onAddNew}
        className={`rounded-md border border-AIPM-dark-blue bg-AIPM-dark-blue px-2.5 py-1.5 text-xs font-medium text-white hover:bg-AIPM-dark-blue/90 ${INTERACTIVE}`}
      >
        {t(lang, "raidAddItem")}
      </button>
      <input
        type="search"
        value={search}
        onChange={(e) => onSearchChange(e.target.value)}
        placeholder={t(lang, "raidSearchPlaceholder")}
        aria-label={t(lang, "raidSearchPlaceholder")}
        title={t(lang, "raidSearchHint")}
        className={`min-w-[12rem] flex-1 rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs text-foreground focus:border-AIPM-dark-blue focus:outline-none ${FOCUS_RING} ${TRANSITION}`}
      />
      <select
        value={categoryFilter}
        onChange={(e) => onSetFilter("category", e.target.value)}
        aria-label={t(lang, "raidCategory")}
        title={t(lang, "raidCategoryFilterHint")}
        className={`h-[30px] rounded-md border border-line bg-surface px-2 py-1.5 text-xs text-foreground ${FOCUS_RING} ${TRANSITION}`}
      >
        <option value="All">{t(lang, "raidCategoryAll")}</option>
        {RAID_CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {categoryLabel(c, lang)}
          </option>
        ))}
      </select>
      <select
        value={severityFilter}
        onChange={(e) => onSetFilter("severity", e.target.value)}
        aria-label={t(lang, "raidSeverity")}
        title={t(lang, "raidSeverityFilterHint")}
        className={`h-[30px] rounded-md border border-line bg-surface px-2 py-1.5 text-xs text-foreground ${FOCUS_RING} ${TRANSITION}`}
      >
        <option value="All">{t(lang, "raidSeverityAll")}</option>
        {RAID_SEVERITIES.map((s) => (
          <option key={s} value={s}>
            {severityLabel(s, lang)}
          </option>
        ))}
      </select>
      <select
        value={statusFilter}
        onChange={(e) => onSetFilter("status", e.target.value)}
        aria-label={t(lang, "raidStatus")}
        title={t(lang, "raidStatusFilterHint")}
        className={`h-[30px] rounded-md border border-line bg-surface px-2 py-1.5 text-xs text-foreground ${FOCUS_RING} ${TRANSITION}`}
      >
        <option value="All">{t(lang, "raidStatusAll")}</option>
        <option value="Open">{t(lang, "raidStatusOpen")}</option>
        <option value="Closed">{t(lang, "raidStatusClosed")}</option>
      </select>
      {filterTaskId !== null && (
        <button
          type="button"
          onClick={onClearTaskFilter}
          title={t(lang, "ganttResetFilters")}
          className={`rounded-md border border-AIPM-purple/40 bg-AIPM-purple/10 px-2.5 py-1.5 text-xs font-medium text-AIPM-purple hover:bg-AIPM-purple/20 dark:border-AIPM-purple/50 dark:bg-AIPM-purple/15 ${INTERACTIVE}`}
        >
          #{filterTaskId} ×
        </button>
      )}
      {filtersActive && (
        <button
          type="button"
          onClick={() => {
            onResetFilters();
            onClearTaskFilter();
          }}
          title={t(lang, "resetFiltersHint")}
          className={`rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-surface-muted ${INTERACTIVE}`}
        >
          {t(lang, "ganttResetFilters")}
        </button>
      )}
      <ColumnConfigPopover lang={lang} cols={RAID_CONFIG_COLS} hidden={hiddenSet} onToggle={onToggleColumn} />
      <PanelViewsControl lang={lang} view="raid" onApply={() => { if (filterTaskId !== null) onClearTaskFilter?.(); }} />
      {m365Configured && !isPopout && onToggleCalendar && (
        <>
          <label className="flex items-center gap-1.5 text-xs text-foreground">
            <input
              type="checkbox"
              checked={!!calendarEnabled}
              onChange={(e) => onToggleCalendar(e.target.checked)}
              aria-label={`${t(lang, "calendarSyncEnable")} – ${t(lang, "calendarSyncEntityRaid")}`}
              className={`h-3.5 w-3.5 rounded border-line text-AIPM-dark-blue ${FOCUS_RING} ${TRANSITION}`}
            />
            {t(lang, "calendarSyncEnable")}
          </label>
          {calendarEnabled && onPushCalendar && (
            <button
              type="button"
              onClick={onPushCalendar}
              disabled={calendarPushBusy}
              aria-label={t(lang, "calendarPush")}
              title={t(lang, "calendarPush")}
              className={`rounded-md border border-AIPM-dark-blue bg-surface px-2.5 py-1.5 text-xs font-medium text-AIPM-dark-blue hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50 ${INTERACTIVE}`}
            >
              {calendarPushBusy ? t(lang, "calendarPushing") : t(lang, "calendarPush")}
            </button>
          )}
          {calendarEnabled && onPullCalendar && (
            <button
              type="button"
              onClick={onPullCalendar}
              disabled={calendarPullBusy}
              aria-label={t(lang, "calendarPull")}
              title={t(lang, "calendarPull")}
              className={`rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50 ${INTERACTIVE}`}
            >
              {calendarPullBusy ? t(lang, "calendarPulling") : t(lang, "calendarPull")}
            </button>
          )}
        </>
      )}
      <PrintButton lang={lang} />
      <ResetColWidthsButton onClick={onResetColWidths} lang={lang} />
      <ResetSizeButton onClick={onResetSize} lang={lang} />
    </div>
  );
}
