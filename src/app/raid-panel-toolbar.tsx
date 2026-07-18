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
import { PaneToolbar, PaneSearchInput, AddButton } from "./pane-toolbar";
import { PanelViewsControl } from "./panel-views-control";
import { ColumnConfigPopover } from "./column-config-popover";
import { CalendarSyncControls } from "./calendar-sync-controls";
import { RAID_CONFIG_COLS, type RaidCol } from "./raid-panel-columns";

export interface RaidToolbarProps {
  lang: Lang;
  search: string;
  onSearchChange: (value: string) => void;
  categoryFilter: string;
  severityFilter: string;
  statusFilter: string;
  /** Selected owner (LIVE name) or "" for all owners. */
  ownerFilter: string;
  /** Distinct owner names present in the register. */
  owners: readonly string[];
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
  ownerFilter,
  owners,
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
    <PaneToolbar>
      <AddButton onClick={onAddNew}>{t(lang, "raidAddItem")}</AddButton>
      <PaneSearchInput
        value={search}
        onChange={onSearchChange}
        ariaLabel={t(lang, "raidSearchPlaceholder")}
        title={t(lang, "raidSearchHint")}
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
      {owners.length > 0 && (
        <select
          value={ownerFilter}
          onChange={(e) => onSetFilter("owner", e.target.value)}
          aria-label={t(lang, "raidOwner")}
          className={`h-[30px] rounded-md border border-line bg-surface px-2 py-1.5 text-xs text-foreground ${FOCUS_RING} ${TRANSITION}`}
        >
          <option value="">{t(lang, "raidOwnerAll")}</option>
          {owners.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
      )}
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
      <CalendarSyncControls
        lang={lang}
        entityLabelKey="calendarSyncEntityRaid"
        m365Configured={m365Configured}
        isPopout={isPopout}
        calendarEnabled={calendarEnabled}
        onToggleCalendar={onToggleCalendar}
        onPushCalendar={onPushCalendar}
        calendarPushBusy={calendarPushBusy}
        onPullCalendar={onPullCalendar}
        calendarPullBusy={calendarPullBusy}
      />
      <PrintButton lang={lang} />
      <ResetColWidthsButton onClick={onResetColWidths} lang={lang} />
      <ResetSizeButton onClick={onResetSize} lang={lang} />
    </PaneToolbar>
  );
}
