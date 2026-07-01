"use client";

// Change-control Register panel — the change-request log. Mirrors RaidPanel:
// a toolbar (Add button BEFORE the search box, plus type + status filter
// <select>s) over a scrollable, sortable, column-resizable table. Clicking a
// row opens ChangeEditModal (create / edit / delete). All mutations go through
// callback props — the parent owns the canonical `changes` array.

import { memo, useEffect, useMemo, useState } from "react";
import { PanelFiltersProvider, usePanelFilters } from "./panel-filters-context";
import { PanelViewsControl } from "./panel-views-control";
import type { PanelFiltersState } from "./panel-views";

const CHANGE_FILTER_DEFAULTS: PanelFiltersState = {
  search: "",
  filters: { type: "All", status: "All" },
  sort: null,
  hiddenCols: [],
};
import { ChangeEditModal } from "./change-edit-modal";
import { ColumnConfigPopover, type ColumnConfigCol } from "./column-config-popover";
import { ViewCallout } from "./view-callout";
import { useWorkspaceTab } from "./workspace-tab-context";
import { useDeepLinkRowFlash, flashOutlineClass } from "./use-deeplink-row-flash";
import {
  changeImpactRag,
  compareChange,
  defaultChangeStatus,
  nextChangeId,
  type ChangeSortKey,
} from "./change-log";
import { applyChangeStatus } from "./use-change-log";
import { type Lang, t, type TranslationKey } from "./i18n";
import { TABLE_HEAD_CLASS } from "./table-styles";
import {
  CHANGE_STATUSES,
  CHANGE_TYPES,
  RAID_SEVERITIES,
  type ChangeImpact,
  type ChangeItem,
  type ChangeStatus,
  type ChangeType,
  type RaidItem,
  type Stakeholder,
  type Task,
} from "./types";
import { useColumnResize } from "./use-column-resize";
import { useResizable } from "./use-resizable";
import { VIEW_PANE_RESIZABLE_CLASS } from "./view-styles";
import { ColumnResizeHandle, ResetColWidthsButton, ResetSizeButton, PrintButton } from "./task-manager-ui";
import { InfoTooltip } from "./info-tooltip";
import { INTERACTIVE, FOCUS_RING, TRANSITION } from "./interaction-styles";
import { useRowSelection } from "./use-row-selection";
import { BulkEditBar } from "./bulk-edit-bar";
import { BulkEditPanel, selectField, textField, type BulkField } from "./bulk-edit-panel";

const CHANGE_COL_WIDTHS = {
  id: 60,
  type: 110,
  title: 260,
  impact: 110,
  status: 130,
  requestedBy: 150,
  raisedDate: 110,
} as const;
type ChangeCol = keyof typeof CHANGE_COL_WIDTHS;

// Toggleable columns (the row-select checkbox is always on). Drives the
// ColumnConfigPopover checklist + the empty-state colSpan.
const CHANGE_CONFIG_COLS = [
  { key: "id", labelKey: "id" },
  { key: "type", labelKey: "changeFieldType" },
  { key: "title", labelKey: "changeFieldTitle" },
  { key: "impact", labelKey: "changeFieldImpact" },
  { key: "status", labelKey: "changeFieldStatus" },
  { key: "requestedBy", labelKey: "changeFieldRequestedBy" },
  { key: "raisedDate", labelKey: "changeFieldRaisedDate" },
] as const satisfies readonly ColumnConfigCol[];

// Mirrors `requestedBy`'s sanitize cap (BUDGET_NAME_MAX in sanitize-entities).
const REQUESTED_BY_MAX = 200;

// --- Props ---------------------------------------------------------------

export type ChangePanelProps = {
  lang: Lang;
  tasks: readonly Task[];
  raid: readonly RaidItem[];
  changes: readonly ChangeItem[];
  /** YYYY-MM-DD; default `raisedDate` for new drafts + decisionDate autofill. */
  today: string;
  onSave: (item: ChangeItem) => void;
  onDelete: (id: number, title: string) => void;
  /** When false, the RAID-link editor is hidden in the edit modal. Default true. */
  raidEnabled?: boolean;
  /** When false, the Stakeholders picker is hidden in the edit modal. Default true. */
  stakeholdersEnabled?: boolean;
  /** Selectable stakeholders for the picker; empty when the module is off. */
  stakeholders?: readonly Stakeholder[];
  /** Show the per-view Help callout (default true when `onLearnMore` is provided). */
  showHints?: boolean;
  /** Popout windows render the callout read-only (no dismiss). */
  isPopout?: boolean;
  /** Deep-link a Help concept; when absent the callout is not rendered. */
  onLearnMore?: (conceptId: string) => void;
  /** M365 configured — gates the calendar toggle/button (hidden otherwise). */
  m365Configured?: boolean;
  /** Change decision-date Outlook write-back (SP3). Absent in popouts. */
  calendarEnabled?: boolean;
  onToggleCalendar?: (enabled: boolean) => void;
  onPushCalendar?: () => void;
  calendarPushBusy?: boolean;
};

// --- Color palette -------------------------------------------------------

// Impact RAG dot — same three-colour mapping as RaidPanel's severity dot.
const impactDotClass: Record<"R" | "A" | "G", string> = {
  R: "bg-AIPM-pink",
  A: "bg-AIPM-purple",
  G: "bg-AIPM-green",
};

// --- Translation lookups -------------------------------------------------

const TYPE_KEY: Record<ChangeType, TranslationKey> = {
  Scope: "changeTypeScope",
  Schedule: "changeTypeSchedule",
  Cost: "changeTypeCost",
  Quality: "changeTypeQuality",
  Other: "changeTypeOther",
};

const STATUS_KEY: Record<ChangeStatus, TranslationKey> = {
  Proposed: "changeStatusProposed",
  "Under Review": "changeStatusUnderReview",
  Approved: "changeStatusApproved",
  Rejected: "changeStatusRejected",
  Implemented: "changeStatusImplemented",
  Deferred: "changeStatusDeferred",
};

const IMPACT_KEY: Record<NonNullable<ChangeItem["impact"]>, TranslationKey> = {
  Low: "raidSeverityLow",
  Medium: "raidSeverityMedium",
  High: "raidSeverityHigh",
  Critical: "raidSeverityCritical",
};

function typeLabel(c: ChangeType, lang: Lang): string {
  return t(lang, TYPE_KEY[c]);
}
function statusLabel(s: ChangeStatus, lang: Lang): string {
  return t(lang, STATUS_KEY[s]);
}
function impactLabel(i: NonNullable<ChangeItem["impact"]>, lang: Lang): string {
  return t(lang, IMPACT_KEY[i]);
}

// --- Component -----------------------------------------------------------

function ChangePanelBody({
  lang,
  tasks,
  raid,
  changes,
  today,
  onSave,
  onDelete,
  raidEnabled = true,
  stakeholdersEnabled = true,
  stakeholders = [],
  showHints,
  isPopout,
  onLearnMore,
  m365Configured,
  calendarEnabled,
  onToggleCalendar,
  onPushCalendar,
  calendarPushBusy,
}: ChangePanelProps) {
  const pf = usePanelFilters();
  const hiddenSet = new Set(pf.hiddenCols ?? []);
  const { search, sort } = pf;
  const typeFilter = pf.filters.type;
  const statusFilter = pf.filters.status;
  const toggleSort = (key: ChangeSortKey) =>
    pf.setSort(
      pf.sort?.key !== key ? { key, dir: "asc" } : pf.sort.dir === "asc" ? { key, dir: "desc" } : null,
    );

  // Modal: null = closed, otherwise editing a draft. `isNew` gates the modal's
  // Delete button (a brand-new draft has nothing to delete yet).
  const [draft, setDraft] = useState<ChangeItem | null>(null);
  const [isNew, setIsNew] = useState(false);

  // Multi-row selection + bulk-edit panel (Status / Type / Impact / Requested by).
  const sel = useRowSelection();
  const [bulkOpen, setBulkOpen] = useState(false);

  const changesById = useMemo(() => {
    const map = new Map<number, ChangeItem>();
    for (const c of changes) map.set(c.id, c);
    return map;
  }, [changes]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = changes.filter((c) => {
      if (typeFilter !== "All" && c.type !== typeFilter) return false;
      if (statusFilter !== "All" && c.status !== statusFilter) return false;
      if (q) {
        const hay = [c.title, c.description ?? "", c.requestedBy ?? ""]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    return sort
      ? [...filtered].sort((a, b) => compareChange(a, b, sort.key as ChangeSortKey, sort.dir as "asc" | "desc"))
      : filtered
          .slice()
          .sort((a, b) => compareChange(a, b, "raisedDate", "desc") || a.id - b.id);
  }, [changes, typeFilter, statusFilter, search, sort]);

  const visibleIds = useMemo(() => visible.map((c) => c.id), [visible]);

  // Bulk-editable fields. ChangeStatus is NOT category-specific (unlike RAID),
  // so Status is safe to bulk-set across any selection.
  const bulkFields = useMemo<BulkField[]>(
    () => [
      selectField(
        "status",
        t(lang, "changeFieldStatus"),
        CHANGE_STATUSES.map((s) => ({ value: s, label: statusLabel(s, lang) })),
      ),
      selectField(
        "type",
        t(lang, "changeFieldType"),
        CHANGE_TYPES.map((ty) => ({ value: ty, label: typeLabel(ty, lang) })),
      ),
      selectField("impact", t(lang, "changeFieldImpact"), [
        ...RAID_SEVERITIES.map((i) => ({ value: i, label: impactLabel(i, lang) })),
        { value: "", label: "—" },
      ]),
      textField("requestedBy", t(lang, "changeFieldRequestedBy"), { maxLength: REQUESTED_BY_MAX }),
    ],
    [lang],
  );

  const applyBulk = (patch: Record<string, string>) => {
    for (const id of sel.selectedIds) {
      const item = changesById.get(id);
      if (!item) continue;
      let patched: ChangeItem = { ...item };
      if (patch.status !== undefined) patched = { ...patched, status: patch.status as ChangeStatus };
      if (patch.type !== undefined) patched = { ...patched, type: patch.type as ChangeType };
      if (patch.impact !== undefined)
        patched = { ...patched, impact: patch.impact ? (patch.impact as ChangeImpact) : undefined };
      if (patch.requestedBy !== undefined)
        patched = { ...patched, requestedBy: patch.requestedBy || undefined };
      onSave(patched);
    }
    setBulkOpen(false);
    sel.clear();
  };

  function openNew() {
    setDraft({
      id: nextChangeId(changes),
      title: "",
      description: "",
      type: "Other",
      status: defaultChangeStatus(),
      raisedDate: today,
      linkedTaskIds: [],
      linkedRaidIds: [],
      stakeholderIds: [],
      documentLinks: [],
    });
    setIsNew(true);
  }

  function openEdit(item: ChangeItem) {
    setDraft({
      ...item,
      linkedTaskIds: [...item.linkedTaskIds],
      linkedRaidIds: [...item.linkedRaidIds],
      stakeholderIds: [...(item.stakeholderIds ?? [])],
      documentLinks: [...(item.documentLinks ?? [])],
    });
    setIsNew(false);
  }

  // Deep-link: when a suggested-action chip requests opening a change, open its
  // edit modal once and clear the pending signal. Skip id 0 — the aggregate
  // change CTA only navigates to the view.
  const { pendingOpen, clearPendingOpen } = useWorkspaceTab();
  const { flashId, containerRef } = useDeepLinkRowFlash("changes");
  useEffect(() => {
    if (pendingOpen?.view !== "changes" || pendingOpen.id === 0) return;
    const item = changes.find((c) => c.id === pendingOpen.id);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-way deep-link
    if (item && draft?.id !== item.id) openEdit(item);
    clearPendingOpen();
    // openEdit is a stable hoisted declaration; depend only on the signal + data.
  }, [pendingOpen, changes, draft, clearPendingOpen]);

  function closeModal() {
    setDraft(null);
    setIsNew(false);
  }

  function commitDraft() {
    if (!draft) return;
    if (!draft.title.trim()) return;
    onSave(draft);
    closeModal();
  }

  function commitDelete() {
    if (!draft) return;
    if (!isNew) onDelete(draft.id, draft.title);
    closeModal();
  }

  const { colWidths, startColResize, resetColWidths } = useColumnResize<ChangeCol>(
    "change",
    CHANGE_COL_WIDTHS,
  );
  const startResize = startColResize as (col: string, e: React.MouseEvent) => void;
  const { ref: paneRef, reset: resetPaneSize } = useResizable("lop-app:change-size");

  const filtersActive =
    search.trim() !== "" || typeFilter !== "All" || statusFilter !== "All";

  const sortArrow = (key: ChangeSortKey) =>
    sort?.key === key ? (sort.dir === "asc" ? " ▲" : " ▼") : "";
  const ariaSort = (key: ChangeSortKey): "ascending" | "descending" | "none" =>
    sort?.key === key ? (sort.dir === "asc" ? "ascending" : "descending") : "none";

  const toolbar = (
    <div className="mb-2 flex shrink-0 flex-wrap items-center gap-2 print:hidden">
      <button
        type="button"
        onClick={openNew}
        className={`rounded-md border border-AIPM-dark-blue bg-AIPM-dark-blue px-2.5 py-1.5 text-xs font-medium text-white hover:bg-AIPM-dark-blue/90 ${INTERACTIVE}`}
      >
        + {t(lang, "changesAdd")}
      </button>
      <input
        type="search"
        value={search}
        onChange={(e) => pf.setSearch(e.target.value)}
        placeholder={t(lang, "changeFilterSearch")}
        aria-label={t(lang, "changeFilterSearch")}
        className={`min-w-[12rem] flex-1 rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs text-foreground focus:border-AIPM-dark-blue focus:outline-none ${FOCUS_RING} ${TRANSITION}`}
      />
      <select
        value={typeFilter}
        onChange={(e) => pf.setFilter("type", e.target.value)}
        aria-label={t(lang, "changeFieldType")}
        className={`h-[30px] rounded-md border border-line bg-surface px-2 py-1.5 text-xs text-foreground ${FOCUS_RING} ${TRANSITION}`}
      >
        <option value="All">{t(lang, "changeFilterTypeAll")}</option>
        {CHANGE_TYPES.map((ty) => (
          <option key={ty} value={ty}>
            {typeLabel(ty, lang)}
          </option>
        ))}
      </select>
      <select
        value={statusFilter}
        onChange={(e) => pf.setFilter("status", e.target.value)}
        aria-label={t(lang, "changeFieldStatus")}
        className={`h-[30px] rounded-md border border-line bg-surface px-2 py-1.5 text-xs text-foreground ${FOCUS_RING} ${TRANSITION}`}
      >
        <option value="All">{t(lang, "changeFilterStatusAll")}</option>
        {CHANGE_STATUSES.map((st) => (
          <option key={st} value={st}>
            {statusLabel(st, lang)}
          </option>
        ))}
      </select>
      <ColumnConfigPopover lang={lang} cols={CHANGE_CONFIG_COLS} hidden={hiddenSet} onToggle={pf.toggleColumn} />
      <PanelViewsControl lang={lang} view="changes" />
      {m365Configured && !isPopout && onToggleCalendar && (
        <>
          <label className="flex items-center gap-1.5 text-xs text-foreground">
            <input
              type="checkbox"
              checked={!!calendarEnabled}
              onChange={(e) => onToggleCalendar(e.target.checked)}
              aria-label={`${t(lang, "calendarSyncEnable")} – ${t(lang, "calendarSyncEntityChange")}`}
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
        </>
      )}
      <PrintButton lang={lang} />
      {filtersActive && (
        <button
          type="button"
          onClick={() => pf.resetFilters()}
          title={t(lang, "resetFiltersHint")}
          className={`rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-surface-muted ${INTERACTIVE}`}
        >
          {t(lang, "ganttResetFilters")}
        </button>
      )}
      <ResetColWidthsButton onClick={resetColWidths} lang={lang} />
      <ResetSizeButton onClick={resetPaneSize} lang={lang} />
    </div>
  );

  return (
    <div ref={paneRef} className={`print-root print-landscape ${VIEW_PANE_RESIZABLE_CLASS}`}>
      {onLearnMore && (
        <ViewCallout view="changes" lang={lang} showHints={showHints !== false} isPopout={!!isPopout} onLearnMore={onLearnMore} />
      )}
      {toolbar}

      <div className="print:hidden">
        <BulkEditBar
          lang={lang}
          count={sel.count}
          open={bulkOpen}
          onToggleOpen={() => setBulkOpen((o) => !o)}
          onClear={() => {
            sel.clear();
            setBulkOpen(false);
          }}
        />
        {bulkOpen && sel.count > 0 && (
          <BulkEditPanel lang={lang} count={sel.count} fields={bulkFields} onApply={applyBulk} onCancel={() => setBulkOpen(false)} />
        )}
      </div>

      <div ref={containerRef} className={changes.length === 0 ? undefined : "min-h-[240px] flex-1 overflow-auto rounded-md border border-line pr-2"}>
        {changes.length === 0 ? (
          // Empty → clickable dashed box (mirrors the budget "+ add bucket"
          // empty state): descriptive text + "+ Add change…", the box adds one.
          <button
            type="button"
            onClick={openNew}
            className={`flex w-full flex-col items-center gap-2 rounded-md border border-dashed border-line p-10 text-center text-sm text-muted-foreground hover:border-AIPM-dark-blue hover:text-AIPM-dark-blue dark:hover:text-AIPM-light-grey ${INTERACTIVE}`}
          >
            <span>{t(lang, "changeEmpty")}</span>
            <span className="font-medium">+ {t(lang, "changesAdd")}…</span>
          </button>
        ) : (
        <table className="min-w-full text-left text-sm">
          <thead className={TABLE_HEAD_CLASS}>
            <tr>
              <th className="px-3 py-2" style={{ width: 36, minWidth: 36 }}>
                <input
                  type="checkbox"
                  aria-label={t(lang, "selectAllVisibleRows")}
                  checked={sel.allSelected(visibleIds)}
                  onChange={() => sel.toggleAllVisible(visibleIds)}
                  className={`h-4 w-4 cursor-pointer rounded border-line text-AIPM-dark-blue ${FOCUS_RING} ${TRANSITION}`}
                />
              </th>
              {!hiddenSet.has("id") && (
              <th className="relative px-3 py-2" style={{ width: colWidths.id, minWidth: colWidths.id }} aria-sort={ariaSort("id")}>
                <button type="button" onClick={() => toggleSort("id")} aria-label={t(lang, "id")} className={`inline-flex items-center gap-1 hover:text-AIPM-green ${INTERACTIVE}`}>
                  #{sortArrow("id")}
                </button>
                <ColumnResizeHandle col="id" onMouseDown={startResize} />
              </th>
              )}
              {!hiddenSet.has("type") && (
              <th className="relative px-3 py-2" style={{ width: colWidths.type, minWidth: colWidths.type }} aria-sort={ariaSort("type")}>
                <button type="button" onClick={() => toggleSort("type")} className={`inline-flex items-center gap-1 hover:text-AIPM-green ${INTERACTIVE}`}>
                  {t(lang, "changeFieldType")}{sortArrow("type")}
                </button>
                <ColumnResizeHandle col="type" onMouseDown={startResize} />
              </th>
              )}
              {!hiddenSet.has("title") && (
              <th className="relative px-3 py-2" style={{ width: colWidths.title, minWidth: colWidths.title }} aria-sort={ariaSort("title")}>
                <button type="button" onClick={() => toggleSort("title")} className={`inline-flex items-center gap-1 hover:text-AIPM-green ${INTERACTIVE}`}>
                  {t(lang, "changeFieldTitle")}{sortArrow("title")}
                </button>
                <ColumnResizeHandle col="title" onMouseDown={startResize} />
              </th>
              )}
              {!hiddenSet.has("impact") && (
              <th className="relative px-3 py-2" style={{ width: colWidths.impact, minWidth: colWidths.impact }} aria-sort={ariaSort("impact")}>
                <button type="button" onClick={() => toggleSort("impact")} className={`inline-flex items-center gap-1 hover:text-AIPM-green ${INTERACTIVE}`}>
                  {t(lang, "changeFieldImpact")}{sortArrow("impact")}
                </button>
                <InfoTooltip text={t(lang, "changeFieldImpactHint")} />
                <ColumnResizeHandle col="impact" onMouseDown={startResize} />
              </th>
              )}
              {!hiddenSet.has("status") && (
              <th className="relative px-3 py-2" style={{ width: colWidths.status, minWidth: colWidths.status }} aria-sort={ariaSort("status")}>
                <button type="button" onClick={() => toggleSort("status")} className={`inline-flex items-center gap-1 hover:text-AIPM-green ${INTERACTIVE}`}>
                  {t(lang, "changeFieldStatus")}{sortArrow("status")}
                </button>
                <ColumnResizeHandle col="status" onMouseDown={startResize} />
              </th>
              )}
              {!hiddenSet.has("requestedBy") && (
              <th className="relative px-3 py-2" style={{ width: colWidths.requestedBy, minWidth: colWidths.requestedBy }} aria-sort={ariaSort("requestedBy")}>
                <button type="button" onClick={() => toggleSort("requestedBy")} className={`inline-flex items-center gap-1 hover:text-AIPM-green ${INTERACTIVE}`}>
                  {t(lang, "changeFieldRequestedBy")}{sortArrow("requestedBy")}
                </button>
                <ColumnResizeHandle col="requestedBy" onMouseDown={startResize} />
              </th>
              )}
              {!hiddenSet.has("raisedDate") && (
              <th className="relative px-3 py-2" style={{ width: colWidths.raisedDate, minWidth: colWidths.raisedDate }} aria-sort={ariaSort("raisedDate")}>
                <button type="button" onClick={() => toggleSort("raisedDate")} className={`inline-flex items-center gap-1 hover:text-AIPM-green ${INTERACTIVE}`}>
                  {t(lang, "changeFieldRaisedDate")}{sortArrow("raisedDate")}
                </button>
                <ColumnResizeHandle col="raisedDate" onMouseDown={startResize} />
              </th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {visible.length === 0 && (
              <tr>
                <td colSpan={1 + CHANGE_CONFIG_COLS.filter((c) => !hiddenSet.has(c.key)).length} className="p-10 text-center text-sm text-muted-foreground">
                  {t(lang, "changeNoMatches")}
                </td>
              </tr>
            )}
            {visible.map((item) => {
              const rag = changeImpactRag(item.impact);
              return (
                <tr
                  key={item.id}
                  data-deeplink-row={item.id}
                  onClick={() => openEdit(item)}
                  className={["cursor-pointer align-top hover:bg-surface-muted", flashOutlineClass(flashId === item.id)]
                    .filter(Boolean)
                    .join(" ")}
                >
                  <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      aria-label={t(lang, "selectItem", item.title)}
                      checked={sel.isSelected(item.id)}
                      onChange={() => sel.toggle(item.id)}
                      className={`h-4 w-4 cursor-pointer rounded border-line text-AIPM-dark-blue ${FOCUS_RING} ${TRANSITION}`}
                    />
                  </td>
                  {!hiddenSet.has("id") && (
                  <td className="px-3 py-2 font-mono text-muted-foreground">
                    #{item.id}
                  </td>
                  )}
                  {!hiddenSet.has("type") && (
                  <td className="px-3 py-2 text-foreground">
                    {typeLabel(item.type, lang)}
                  </td>
                  )}
                  {!hiddenSet.has("title") && (
                  <td className="px-3 py-2 font-medium text-foreground">
                    {item.title}
                  </td>
                  )}
                  {!hiddenSet.has("impact") && (
                  <td className="px-3 py-2">
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        aria-hidden
                        className={`inline-block h-2 w-2 rounded-full ${impactDotClass[rag]}`}
                      />
                      <span>{item.impact ? impactLabel(item.impact, lang) : "—"}</span>
                    </span>
                  </td>
                  )}
                  {!hiddenSet.has("status") && (
                  <td className="px-3 py-2 text-foreground">
                    {statusLabel(item.status, lang)}
                  </td>
                  )}
                  {!hiddenSet.has("requestedBy") && (
                  <td className="px-3 py-2 text-foreground">
                    {item.requestedBy ?? ""}
                  </td>
                  )}
                  {!hiddenSet.has("raisedDate") && (
                  <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                    {item.raisedDate}
                  </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
        )}
      </div>

      {draft && (
        <ChangeEditModal
          lang={lang}
          tasks={tasks}
          raid={raid}
          draft={draft}
          isNew={isNew}
          raidEnabled={raidEnabled}
          stakeholdersEnabled={stakeholdersEnabled}
          stakeholders={stakeholders}
          onChange={setDraft}
          onApplyStatus={(s) =>
            setDraft((d) => (d ? applyChangeStatus(d, s, today) : d))
          }
          onSave={commitDraft}
          onCancel={closeModal}
          onDelete={commitDelete}
        />
      )}
    </div>
  );
}

// memo-wrap so the panel skips re-render when the parent re-renders for
// unrelated reasons. Relies on handler props being stable refs (the parent
// wraps them in useCallback).
const ChangePanelMemo = memo(ChangePanelBody);

export function ChangePanel(props: ChangePanelProps) {
  return (
    <PanelFiltersProvider defaults={CHANGE_FILTER_DEFAULTS}>
      <ChangePanelMemo {...props} />
    </PanelFiltersProvider>
  );
}
