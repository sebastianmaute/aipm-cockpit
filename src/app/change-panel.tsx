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
};
import { ChangeEditModal } from "./change-edit-modal";
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
import { ColumnResizeHandle, ResetColWidthsButton, ResetSizeButton } from "./task-manager-ui";
import { InfoTooltip } from "./info-tooltip";

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
}: ChangePanelProps) {
  const pf = usePanelFilters();
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
      ? [...filtered].sort((a, b) => compareChange(a, b, sort.key as ChangeSortKey, sort.dir))
      : filtered
          .slice()
          .sort((a, b) => compareChange(a, b, "raisedDate", "desc") || a.id - b.id);
  }, [changes, typeFilter, statusFilter, search, sort]);

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
    <div className="mb-2 flex shrink-0 flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={openNew}
        className="rounded-md border border-AIPM-dark-blue bg-AIPM-dark-blue px-2.5 py-1.5 text-xs font-medium text-white hover:bg-AIPM-dark-blue/90"
      >
        + {t(lang, "changesAdd")}
      </button>
      <input
        type="search"
        value={search}
        onChange={(e) => pf.setSearch(e.target.value)}
        placeholder={t(lang, "changeFilterSearch")}
        aria-label={t(lang, "changeFilterSearch")}
        className="min-w-[12rem] flex-1 rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs text-foreground focus:border-AIPM-dark-blue focus:outline-none focus:ring-1 focus:ring-AIPM-green"
      />
      <select
        value={typeFilter}
        onChange={(e) => pf.setFilter("type", e.target.value)}
        aria-label={t(lang, "changeFieldType")}
        className="h-[30px] rounded-md border border-line bg-surface px-2 py-1.5 text-xs text-foreground"
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
        className="h-[30px] rounded-md border border-line bg-surface px-2 py-1.5 text-xs text-foreground"
      >
        <option value="All">{t(lang, "changeFilterStatusAll")}</option>
        {CHANGE_STATUSES.map((st) => (
          <option key={st} value={st}>
            {statusLabel(st, lang)}
          </option>
        ))}
      </select>
      <PanelViewsControl lang={lang} view="changes" />
      {filtersActive && (
        <button
          type="button"
          onClick={() => pf.reset()}
          title={t(lang, "resetFiltersHint")}
          className="rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-surface-muted"
        >
          {t(lang, "ganttResetFilters")}
        </button>
      )}
      <ResetColWidthsButton onClick={resetColWidths} lang={lang} />
      <ResetSizeButton onClick={resetPaneSize} lang={lang} />
    </div>
  );

  return (
    <div ref={paneRef} className={VIEW_PANE_RESIZABLE_CLASS}>
      {toolbar}

      <div ref={containerRef} className="min-h-[240px] flex-1 overflow-auto rounded-md border border-line pr-2">
        <table className="min-w-full text-left text-sm">
          <thead className={TABLE_HEAD_CLASS}>
            <tr>
              <th className="relative px-3 py-2" style={{ width: colWidths.id, minWidth: colWidths.id }} aria-sort={ariaSort("id")}>
                <button type="button" onClick={() => toggleSort("id")} aria-label={t(lang, "id")} className="inline-flex items-center gap-1 hover:text-AIPM-green">
                  #{sortArrow("id")}
                </button>
                <ColumnResizeHandle col="id" onMouseDown={startResize} />
              </th>
              <th className="relative px-3 py-2" style={{ width: colWidths.type, minWidth: colWidths.type }} aria-sort={ariaSort("type")}>
                <button type="button" onClick={() => toggleSort("type")} className="inline-flex items-center gap-1 hover:text-AIPM-green">
                  {t(lang, "changeFieldType")}{sortArrow("type")}
                </button>
                <ColumnResizeHandle col="type" onMouseDown={startResize} />
              </th>
              <th className="relative px-3 py-2" style={{ width: colWidths.title, minWidth: colWidths.title }} aria-sort={ariaSort("title")}>
                <button type="button" onClick={() => toggleSort("title")} className="inline-flex items-center gap-1 hover:text-AIPM-green">
                  {t(lang, "changeFieldTitle")}{sortArrow("title")}
                </button>
                <ColumnResizeHandle col="title" onMouseDown={startResize} />
              </th>
              <th className="relative px-3 py-2" style={{ width: colWidths.impact, minWidth: colWidths.impact }} aria-sort={ariaSort("impact")}>
                <button type="button" onClick={() => toggleSort("impact")} className="inline-flex items-center gap-1 hover:text-AIPM-green">
                  {t(lang, "changeFieldImpact")}{sortArrow("impact")}
                </button>
                <InfoTooltip text={t(lang, "changeFieldImpactHint")} />
                <ColumnResizeHandle col="impact" onMouseDown={startResize} />
              </th>
              <th className="relative px-3 py-2" style={{ width: colWidths.status, minWidth: colWidths.status }} aria-sort={ariaSort("status")}>
                <button type="button" onClick={() => toggleSort("status")} className="inline-flex items-center gap-1 hover:text-AIPM-green">
                  {t(lang, "changeFieldStatus")}{sortArrow("status")}
                </button>
                <ColumnResizeHandle col="status" onMouseDown={startResize} />
              </th>
              <th className="relative px-3 py-2" style={{ width: colWidths.requestedBy, minWidth: colWidths.requestedBy }} aria-sort={ariaSort("requestedBy")}>
                <button type="button" onClick={() => toggleSort("requestedBy")} className="inline-flex items-center gap-1 hover:text-AIPM-green">
                  {t(lang, "changeFieldRequestedBy")}{sortArrow("requestedBy")}
                </button>
                <ColumnResizeHandle col="requestedBy" onMouseDown={startResize} />
              </th>
              <th className="relative px-3 py-2" style={{ width: colWidths.raisedDate, minWidth: colWidths.raisedDate }} aria-sort={ariaSort("raisedDate")}>
                <button type="button" onClick={() => toggleSort("raisedDate")} className="inline-flex items-center gap-1 hover:text-AIPM-green">
                  {t(lang, "changeFieldRaisedDate")}{sortArrow("raisedDate")}
                </button>
                <ColumnResizeHandle col="raisedDate" onMouseDown={startResize} />
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {changes.length === 0 && (
              <tr>
                <td colSpan={7} className="p-10 text-center text-sm text-muted-foreground">
                  {t(lang, "changeEmpty")}
                </td>
              </tr>
            )}
            {changes.length > 0 && visible.length === 0 && (
              <tr>
                <td colSpan={7} className="p-10 text-center text-sm text-muted-foreground">
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
                  <td className="px-3 py-2 font-mono text-muted-foreground">
                    #{item.id}
                  </td>
                  <td className="px-3 py-2 text-foreground">
                    {typeLabel(item.type, lang)}
                  </td>
                  <td className="px-3 py-2 font-medium text-foreground">
                    {item.title}
                  </td>
                  <td className="px-3 py-2">
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        aria-hidden
                        className={`inline-block h-2 w-2 rounded-full ${impactDotClass[rag]}`}
                      />
                      <span>{item.impact ? impactLabel(item.impact, lang) : "—"}</span>
                    </span>
                  </td>
                  <td className="px-3 py-2 text-foreground">
                    {statusLabel(item.status, lang)}
                  </td>
                  <td className="px-3 py-2 text-foreground">
                    {item.requestedBy ?? ""}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                    {item.raisedDate}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
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
