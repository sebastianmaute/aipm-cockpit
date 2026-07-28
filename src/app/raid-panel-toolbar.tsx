// src/app/raid-panel-toolbar.tsx
//
// Presentational RAID toolbar (move-only extraction from raid-panel.tsx, mirrors
// the gantt-chrome split). Filters, calendar controls, saved-views, print, and
// reset buttons. Pure: all state + handlers arrive as props from the orchestrator.
import { type Lang, t } from "./i18n";
import { categoryLabel, severityLabel } from "./raid-labels";
import { RAID_CATEGORIES, RAID_SEVERITIES } from "./types";
import { PrintButton, ResetColWidthsButton, ResetSizeButton } from "./task-manager-ui";
import { INTERACTIVE } from "./interaction-styles";
import { Select } from "./form-controls";
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
        clearLabel={`${t(lang, "clear")} – ${t(lang, "raidSearchPlaceholder")}`}
        title={t(lang, "raidSearchHint")}
      />
      <Select
        value={categoryFilter}
        onChange={(e) => onSetFilter("category", e.target.value)}
        aria-label={t(lang, "raidCategory")}
        title={t(lang, "raidCategoryFilterHint")}
        size="xs"
        className="h-[30px]"
      >
        <option value="All">{t(lang, "raidCategoryAll")}</option>
        {RAID_CATEGORIES.map((c) => (
          <option key={c} value={c}>
            {categoryLabel(c, lang)}
          </option>
        ))}
      </Select>
      <Select
        value={severityFilter}
        onChange={(e) => onSetFilter("severity", e.target.value)}
        aria-label={t(lang, "raidSeverity")}
        title={t(lang, "raidSeverityFilterHint")}
        size="xs"
        className="h-[30px]"
      >
        <option value="All">{t(lang, "raidSeverityAll")}</option>
        {RAID_SEVERITIES.map((s) => (
          <option key={s} value={s}>
            {severityLabel(s, lang)}
          </option>
        ))}
      </Select>
      <Select
        value={statusFilter}
        onChange={(e) => onSetFilter("status", e.target.value)}
        aria-label={t(lang, "raidStatus")}
        title={t(lang, "raidStatusFilterHint")}
        size="xs"
        className="h-[30px]"
      >
        <option value="All">{t(lang, "raidStatusAll")}</option>
        <option value="Open">{t(lang, "raidStatusOpen")}</option>
        <option value="Closed">{t(lang, "raidStatusClosed")}</option>
      </Select>
      {owners.length > 0 && (
        <Select
          value={ownerFilter}
          onChange={(e) => onSetFilter("owner", e.target.value)}
          aria-label={t(lang, "raidOwner")}
          size="xs"
          className="h-[30px]"
        >
          <option value="">{t(lang, "raidOwnerAll")}</option>
          {owners.map((name) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </Select>
      )}
      {filterTaskId !== null && (
        <button
          type="button"
          onClick={onClearTaskFilter}
          title={t(lang, "ganttResetFilters")}
          className={`rounded-md border border-ui-purple/40 bg-ui-purple/10 px-2.5 py-1.5 text-xs font-medium text-ui-purple hover:bg-ui-purple/20 dark:border-ui-purple/50 dark:bg-ui-purple/15 ${INTERACTIVE}`}
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
