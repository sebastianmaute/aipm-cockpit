"use client";

// RAID Log panel — Risks, Assumptions, Issues, Dependencies.
//
// Structure mirrors the GanttPanel for consistency: a toolbar with filters
// and a "+ Add" button, then a scrollable table. Clicking a row opens a
// modal that handles create + edit + delete + the "create mitigation task"
// shortcut.
//
// All state mutations go through callback props — the parent (TaskManager)
// owns the canonical `raid` array and persists it via the storage backend.

import { memo, useCallback, useEffect, useMemo, useState } from "react";
import { useWorkspaceTab } from "./workspace-tab-context";
import { TABLE_HEAD_CLASS } from "./table-styles";
import { type Lang, t } from "./i18n";
import { categoryLabel, severityLabel, statusLabel } from "./raid-labels";
import {
  buildRaidCausesIndex,
  compareRaid,
  defaultStatusForCategory,
  isTerminalStatus,
  nextRaidId,
  riskSeverityFromMatrix,
  severityRag,
  type RaidSortKey,
} from "./raid";
import {
  RAID_CATEGORIES,
  RAID_SEVERITIES,
  type RaidCategory,
  type RaidItem,
  type RaidSeverity,
  type RaidStatus,
  type Resource,
  type RiskScale,
  type Stakeholder,
  type Task,
} from "./types";
import type { Contact } from "./contacts";
import { RaidEditModal } from "./raid-edit-modal";
import { useColumnResize } from "./use-column-resize";
import { useResizable } from "./use-resizable";
import { VIEW_PANE_RESIZABLE_CLASS } from "./view-styles";
import { ColumnResizeHandle, ResetColWidthsButton, ResetSizeButton, ResizeCornerHint } from "./task-manager-ui";

const RAID_COL_WIDTHS = {
  id: 60,
  category: 100,
  title: 240,
  severity: 90,
  status: 110,
  owner: 140,
  targetDate: 110,
  linkedTasks: 140,
  causedBy: 140,
} as const;
type RaidCol = keyof typeof RAID_COL_WIDTHS;

// --- Props ---------------------------------------------------------------

export type RaidPanelProps = {
  lang: Lang;
  tasks: readonly Task[];
  raid: readonly RaidItem[];
  /** When false, the Stakeholders picker in the edit modal is hidden. Default true. */
  stakeholdersEnabled?: boolean;
  /** Selectable stakeholders for the picker; empty when the module is off. */
  stakeholders?: readonly Stakeholder[];
  /** Registry resources + remembered contacts for the owner ResourcePicker. */
  resources: readonly Resource[];
  contacts: Contact[];
  onCreateResource: (name: string, email: string) => number;
  /** YYYY-MM-DD; used for default `raisedDate` and "closed today" autofill. */
  today: string;
  /** When non-null, only items linking to this task id are shown. The task
   *  list passes it when the user clicks the RAID badge on a row. */
  filterTaskId: number | null;
  onClearTaskFilter: () => void;
  /** Upsert (create or replace) a RAID item. The parent stamps
   *  `localModifiedAt`. */
  onSave: (item: RaidItem) => void;
  onDelete: (id: number) => void;
  /** Spawns a Task pre-filled from the item; returns its new id so the
   *  modal can add it to `linkedTaskIds` immediately. In a read-only (popout)
   *  context the guard returns undefined; callers must treat undefined as null. */
  onCreateMitigationTask: (raidItemId: number) => number | null | undefined;
  /** Open the task edit modal for the given task id (used by linked-task
   *  chip clicks). */
  onJumpToTask: (taskId: number) => void;
};

// --- Color palette -------------------------------------------------------

const categoryPillClass: Record<RaidCategory, string> = {
  R: "bg-AIPM-pink/15 text-AIPM-dark-blue dark:bg-AIPM-pink/20 dark:text-AIPM-light-grey",
  A: "bg-AIPM-blue/15 text-AIPM-dark-blue dark:bg-AIPM-blue/20 dark:text-AIPM-light-grey",
  I: "bg-AIPM-purple/15 text-AIPM-dark-blue dark:bg-AIPM-purple/20 dark:text-AIPM-light-grey",
  D: "bg-AIPM-green/15 text-AIPM-dark-blue dark:bg-AIPM-green/20 dark:text-AIPM-light-grey",
};

const severityDotClass: Record<"R" | "A" | "G", string> = {
  R: "bg-AIPM-pink",
  A: "bg-AIPM-purple",
  G: "bg-AIPM-green",
};

const severityRank: Record<RaidSeverity, number> = {
  Critical: 0,
  High: 1,
  Medium: 2,
  Low: 3,
};

// --- Component -----------------------------------------------------------

function RaidPanelInner({
  lang,
  tasks,
  raid,
  stakeholdersEnabled = true,
  stakeholders = [],
  resources,
  contacts,
  onCreateResource,
  today,
  filterTaskId,
  onClearTaskFilter,
  onSave,
  onDelete,
  onCreateMitigationTask,
  onJumpToTask,
}: RaidPanelProps) {
  const [categoryFilter, setCategoryFilter] = useState<"All" | RaidCategory>(
    "All",
  );
  const [severityFilter, setSeverityFilter] = useState<"All" | RaidSeverity>(
    "All",
  );
  const [statusFilter, setStatusFilter] = useState<"All" | "Open" | "Closed">(
    "All",
  );
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ key: RaidSortKey; dir: "asc" | "desc" } | null>(null);
  const toggleSort = (key: RaidSortKey) =>
    setSort((s) => (s?.key !== key ? { key, dir: "asc" } : s.dir === "asc" ? { key, dir: "desc" } : null));

  // Modal: null = closed, otherwise we're editing a draft (which may or may
  // not already exist in `raid`). `isNew` distinguishes — needed because
  // "Create mitigation task" can only run on saved items.
  const [draft, setDraft] = useState<RaidItem | null>(null);
  const [isNew, setIsNew] = useState(false);

  const tasksById = useMemo(() => {
    const map = new Map<number, Task>();
    for (const tk of tasks) map.set(tk.id, tk);
    return map;
  }, [tasks]);

  const raidById = useMemo(() => {
    const map = new Map<number, RaidItem>();
    for (const r of raid) map.set(r.id, r);
    return map;
  }, [raid]);

  // Parent → children index; used to (a) paint a "→ N" cause-count chip on
  // rows that are themselves causes and (b) list children inside an item's
  // edit modal.
  const causesIndex = useMemo(() => buildRaidCausesIndex(raid), [raid]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = raid.filter((r) => {
      if (filterTaskId !== null && !r.linkedTaskIds.includes(filterTaskId))
        return false;
      if (categoryFilter !== "All" && r.category !== categoryFilter)
        return false;
      if (severityFilter !== "All" && r.severity !== severityFilter)
        return false;
      if (statusFilter === "Open" && isTerminalStatus(r.status, r.category))
        return false;
      if (statusFilter === "Closed" && !isTerminalStatus(r.status, r.category))
        return false;
      if (q) {
        const hay = [
          r.title,
          r.description ?? "",
          r.mitigation ?? "",
          r.owner ?? "",
          r.ownerEmail ?? "",
        ]
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    const ordered = sort
      ? [...filtered].sort((a, b) => compareRaid(a, b, sort.key, sort.dir))
      : filtered.slice().sort((a, b) => {
          const aClosed = isTerminalStatus(a.status, a.category);
          const bClosed = isTerminalStatus(b.status, b.category);
          if (aClosed !== bClosed) return aClosed ? 1 : -1;
          const sa = a.severity ? severityRank[a.severity] : 99;
          const sb = b.severity ? severityRank[b.severity] : 99;
          if (sa !== sb) return sa - sb;
          const da = a.raisedDate ?? "";
          const db = b.raisedDate ?? "";
          if (da !== db) return da < db ? -1 : 1;
          return a.id - b.id;
        });
    return ordered;
  }, [raid, filterTaskId, categoryFilter, severityFilter, statusFilter, search, sort]);

  const effectiveCategory: RaidCategory =
    categoryFilter === "All" ? "R" : categoryFilter;

  function openNew(category: RaidCategory = "R") {
    const probability: RiskScale = 3;
    const impact: RiskScale = 3;
    setDraft({
      id: nextRaidId(raid),
      category,
      title: "",
      severity:
        category === "R"
          ? riskSeverityFromMatrix(probability, impact)
          : "Medium",
      probability: category === "R" ? probability : undefined,
      impact: category === "R" ? impact : undefined,
      status: defaultStatusForCategory(category),
      linkedTaskIds: [],
      causedByRaidIds: [],
      stakeholderIds: [],
      documentLinks: [],
      raisedDate: today,
    });
    setIsNew(true);
  }

  const openEdit = useCallback((item: RaidItem) => {
    setDraft({
      ...item,
      linkedTaskIds: [...item.linkedTaskIds],
      causedByRaidIds: [...item.causedByRaidIds],
      stakeholderIds: [...(item.stakeholderIds ?? [])],
    });
    setIsNew(false);
  }, []);

  // Deep-link: when the workspace requests opening a specific RAID item, open
  // its edit modal once and immediately clear the pending request so it does
  // not re-fire on subsequent renders.
  const { pendingOpen, clearPendingOpen } = useWorkspaceTab();
  useEffect(() => {
    if (pendingOpen?.view !== "raid") return;
    const item = raidById.get(pendingOpen.id);
    // Skip when this item's editor is already open — a self-induced hashchange
    // (requestOpen writes the hash) can re-fire pendingOpen; reopening would
    // clobber an in-progress edit of the same item.
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: a one-way deep-link signal must open the edit modal on a pendingOpen transition, not at render time
    if (item && draft?.id !== item.id) openEdit(item);
    clearPendingOpen();
  }, [pendingOpen, raidById, clearPendingOpen, openEdit, draft]);

  function closeModal() {
    setDraft(null);
    setIsNew(false);
  }

  /** When the user transitions a draft into a terminal status, auto-fill
   *  `closedDate` to today (matches what the user almost always wants). */
  function applyStatus(d: RaidItem, status: RaidStatus): RaidItem {
    const terminal = isTerminalStatus(status, d.category);
    return {
      ...d,
      status,
      closedDate: terminal ? d.closedDate ?? today : undefined,
    };
  }

  function applyMatrix(
    d: RaidItem,
    probability: RiskScale,
    impact: RiskScale,
  ): RaidItem {
    return {
      ...d,
      probability,
      impact,
      severity: riskSeverityFromMatrix(probability, impact),
    };
  }

  function commitDraft() {
    if (!draft) return;
    if (!draft.title.trim()) return;
    onSave(draft);
    closeModal();
  }

  function commitDelete() {
    if (!draft) return;
    if (!isNew) onDelete(draft.id);
    closeModal();
  }

  function commitCreateMitigationTask() {
    if (!draft || isNew) return;
    onSave(draft);
    const newTaskId = onCreateMitigationTask(draft.id);
    if (newTaskId != null) {
      setDraft({ ...draft, linkedTaskIds: [...draft.linkedTaskIds, newTaskId] });
    }
  }

  const { colWidths, startColResize, resetColWidths } = useColumnResize<RaidCol>(
    "raid",
    RAID_COL_WIDTHS,
  );
  const startResize = startColResize as (col: string, e: React.MouseEvent) => void;
  const { ref: raidRef, reset: resetRaidSize } = useResizable("lop-app:raid-size");

  const filtersActive =
    search.trim() !== "" ||
    categoryFilter !== "All" ||
    severityFilter !== "All" ||
    statusFilter !== "All" ||
    filterTaskId !== null;

  const toolbar = (
    <div className="mb-2 flex shrink-0 flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => openNew()}
        className="rounded-md border border-AIPM-dark-blue bg-AIPM-dark-blue px-2.5 py-1.5 text-xs font-medium text-white hover:bg-AIPM-dark-blue/90"
      >
        {t(lang, "raidAddItem")}
      </button>
      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t(lang, "raidSearchPlaceholder")}
        aria-label={t(lang, "raidSearchPlaceholder")}
        title={t(lang, "raidSearchHint")}
        className="min-w-[12rem] flex-1 rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs text-foreground focus:border-AIPM-dark-blue focus:outline-none focus:ring-1 focus:ring-AIPM-green"
      />
      <select
        value={categoryFilter}
        onChange={(e) =>
          setCategoryFilter(e.target.value as "All" | RaidCategory)
        }
        aria-label={t(lang, "raidCategory")}
        title={t(lang, "raidCategoryFilterHint")}
        className="h-[30px] rounded-md border border-line bg-surface px-2 py-1.5 text-xs text-foreground"
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
        onChange={(e) =>
          setSeverityFilter(e.target.value as "All" | RaidSeverity)
        }
        aria-label={t(lang, "raidSeverity")}
        title={t(lang, "raidSeverityFilterHint")}
        className="h-[30px] rounded-md border border-line bg-surface px-2 py-1.5 text-xs text-foreground"
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
        onChange={(e) =>
          setStatusFilter(e.target.value as "All" | "Open" | "Closed")
        }
        aria-label={t(lang, "raidStatus")}
        title={t(lang, "raidStatusFilterHint")}
        className="h-[30px] rounded-md border border-line bg-surface px-2 py-1.5 text-xs text-foreground"
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
          className="rounded-md border border-AIPM-purple/40 bg-AIPM-purple/10 px-2.5 py-1.5 text-xs font-medium text-AIPM-purple hover:bg-AIPM-purple/20 dark:border-AIPM-purple/50 dark:bg-AIPM-purple/15"
        >
          #{filterTaskId} ×
        </button>
      )}
      {filtersActive && (
        <button
          type="button"
          onClick={() => {
            setSearch("");
            setCategoryFilter("All");
            setSeverityFilter("All");
            setStatusFilter("All");
            onClearTaskFilter();
          }}
          title={t(lang, "resetFiltersHint")}
          className="rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-surface-muted"
        >
          {t(lang, "ganttResetFilters")}
        </button>
      )}
      <ResetColWidthsButton onClick={resetColWidths} lang={lang} />
      <ResetSizeButton onClick={resetRaidSize} lang={lang} />
    </div>
  );

  return (
    <div ref={raidRef} className={VIEW_PANE_RESIZABLE_CLASS}>
      {toolbar}

      <div className="min-h-[240px] flex-1 overflow-auto rounded-md border border-line">
        <table className="min-w-full text-left text-sm">
          <thead className={TABLE_HEAD_CLASS}>
            <tr>
              <th className="relative px-3 py-2" style={{ width: colWidths.id, minWidth: colWidths.id }} aria-sort={sort?.key === "id" ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
                <button type="button" onClick={() => toggleSort("id")} aria-label={t(lang, "id")} className="inline-flex items-center gap-1 hover:text-AIPM-green">
                  #{sort?.key === "id" ? (sort.dir === "asc" ? " ▲" : " ▼") : ""}
                </button>
                <ColumnResizeHandle col="id" onMouseDown={startResize} />
              </th>
              <th className="relative px-3 py-2" style={{ width: colWidths.category, minWidth: colWidths.category }} aria-sort={sort?.key === "category" ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
                <button type="button" onClick={() => toggleSort("category")} className="inline-flex items-center gap-1 hover:text-AIPM-green">
                  {t(lang, "raidCategory")}{sort?.key === "category" ? (sort.dir === "asc" ? " ▲" : " ▼") : ""}
                </button>
                <ColumnResizeHandle col="category" onMouseDown={startResize} />
              </th>
              <th className="relative px-3 py-2" style={{ width: colWidths.title, minWidth: colWidths.title }} aria-sort={sort?.key === "title" ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
                <button type="button" onClick={() => toggleSort("title")} className="inline-flex items-center gap-1 hover:text-AIPM-green">
                  {t(lang, "raidTitle")}{sort?.key === "title" ? (sort.dir === "asc" ? " ▲" : " ▼") : ""}
                </button>
                <ColumnResizeHandle col="title" onMouseDown={startResize} />
              </th>
              <th className="relative px-3 py-2" style={{ width: colWidths.severity, minWidth: colWidths.severity }} aria-sort={sort?.key === "severity" ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
                <button type="button" onClick={() => toggleSort("severity")} className="inline-flex items-center gap-1 hover:text-AIPM-green">
                  {t(lang, "raidSeverity")}{sort?.key === "severity" ? (sort.dir === "asc" ? " ▲" : " ▼") : ""}
                </button>
                <ColumnResizeHandle col="severity" onMouseDown={startResize} />
              </th>
              <th className="relative px-3 py-2" style={{ width: colWidths.status, minWidth: colWidths.status }} aria-sort={sort?.key === "status" ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
                <button type="button" onClick={() => toggleSort("status")} className="inline-flex items-center gap-1 hover:text-AIPM-green">
                  {t(lang, "raidStatus")}{sort?.key === "status" ? (sort.dir === "asc" ? " ▲" : " ▼") : ""}
                </button>
                <ColumnResizeHandle col="status" onMouseDown={startResize} />
              </th>
              <th className="relative px-3 py-2" style={{ width: colWidths.owner, minWidth: colWidths.owner }} aria-sort={sort?.key === "owner" ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
                <button type="button" onClick={() => toggleSort("owner")} className="inline-flex items-center gap-1 hover:text-AIPM-green">
                  {t(lang, "raidOwner")}{sort?.key === "owner" ? (sort.dir === "asc" ? " ▲" : " ▼") : ""}
                </button>
                <ColumnResizeHandle col="owner" onMouseDown={startResize} />
              </th>
              <th className="relative px-3 py-2" style={{ width: colWidths.targetDate, minWidth: colWidths.targetDate }} aria-sort={sort?.key === "targetDate" ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
                <button type="button" onClick={() => toggleSort("targetDate")} className="inline-flex items-center gap-1 hover:text-AIPM-green">
                  {t(lang, "raidTargetDate")}{sort?.key === "targetDate" ? (sort.dir === "asc" ? " ▲" : " ▼") : ""}
                </button>
                <ColumnResizeHandle col="targetDate" onMouseDown={startResize} />
              </th>
              <th className="relative px-3 py-2" style={{ width: colWidths.linkedTasks, minWidth: colWidths.linkedTasks }}>
                {t(lang, "raidLinkedTasks")}
                <ColumnResizeHandle col="linkedTasks" onMouseDown={startResize} />
              </th>
              <th className="relative px-3 py-2" style={{ width: colWidths.causedBy, minWidth: colWidths.causedBy }}>
                {t(lang, "raidCausedBy")}
                <ColumnResizeHandle col="causedBy" onMouseDown={startResize} />
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {raid.length === 0 && (
              <tr>
                <td colSpan={9} className="p-10 text-center text-sm text-muted-foreground">
                  {t(lang, "raidEmpty")}
                </td>
              </tr>
            )}
            {raid.length > 0 && visible.length === 0 && (
              <tr>
                <td colSpan={9} className="p-10 text-center text-sm text-muted-foreground">
                  {t(lang, "raidNoMatches")}
                </td>
              </tr>
            )}
            {visible.map((item) => {
              const rag = severityRag(item.severity);
              const terminal = isTerminalStatus(item.status, item.category);
              return (
                <tr
                  key={item.id}
                  onClick={() => openEdit(item)}
                  className={`cursor-pointer align-top hover:bg-surface-muted ${
                    terminal ? "opacity-60" : ""
                  }`}
                >
                  <td className="px-3 py-2 font-mono text-muted-foreground">
                    #{item.id}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[11px] font-medium ${categoryPillClass[item.category]}`}
                      title={categoryLabel(item.category, lang)}
                    >
                      {item.category}
                    </span>
                  </td>
                  <td className="px-3 py-2 font-medium text-foreground">
                    {item.title}
                  </td>
                  <td className="px-3 py-2">
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        aria-hidden
                        className={`inline-block h-2 w-2 rounded-full ${severityDotClass[rag]}`}
                      />
                      <span>
                        {item.severity ? severityLabel(item.severity, lang) : "—"}
                        {item.category === "R" && item.probability && item.impact
                          ? ` (${item.probability}×${item.impact})`
                          : ""}
                      </span>
                    </span>
                  </td>
                  <td className="px-3 py-2 text-foreground">
                    {statusLabel(item.status, lang)}
                  </td>
                  <td className="px-3 py-2 text-foreground">
                    {item.owner ?? ""}
                  </td>
                  <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                    {item.targetDate ?? ""}
                  </td>
                  <td className="px-3 py-2">
                    {item.linkedTaskIds.length === 0 ? (
                      <span className="text-muted-foreground">—</span>
                    ) : (
                      <span className="flex flex-wrap gap-1">
                        {item.linkedTaskIds.map((tid) => {
                          const tk = tasksById.get(tid);
                          return (
                            <button
                              key={tid}
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                onJumpToTask(tid);
                              }}
                              title={tk?.taskName ?? `#${tid}`}
                              className="inline-flex rounded bg-surface-muted px-1.5 py-0.5 font-mono text-[10px] text-AIPM-dark-blue hover:bg-AIPM-dark-blue hover:text-white"
                            >
                              #{tid}
                            </button>
                          );
                        })}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {(() => {
                      const parentIds = item.causedByRaidIds ?? [];
                      const children = causesIndex.get(item.id) ?? [];
                      if (parentIds.length === 0 && children.length === 0) {
                        return <span className="text-muted-foreground">—</span>;
                      }
                      return (
                        <span className="flex flex-wrap items-center gap-1">
                          {parentIds.map((pid) => {
                            const parent = raidById.get(pid);
                            return (
                              <button
                                key={pid}
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (parent) openEdit(parent);
                                }}
                                title={parent?.title ?? `RAID #${pid}`}
                                className="inline-flex items-center gap-1 rounded bg-surface-muted px-1.5 py-0.5 font-mono text-[10px] text-AIPM-dark-blue hover:bg-AIPM-dark-blue hover:text-white"
                              >
                                ↩ #{pid}
                              </button>
                            );
                          })}
                          {children.length > 0 && (
                            <span
                              title={t(lang, "raidCausedThisCount", children.length)}
                              className="inline-flex items-center rounded bg-AIPM-purple/15 px-1.5 py-0.5 text-[10px] font-medium text-AIPM-purple dark:bg-AIPM-purple/20"
                            >
                              → {children.length}
                            </span>
                          )}
                        </span>
                      );
                    })()}
                  </td>
                </tr>
              );
            })}
            <tr>
              <td colSpan={9}>
                <button
                  type="button"
                  onClick={() => openNew(effectiveCategory)}
                  aria-label={t(lang, "raidAddItem")}
                  className="group flex w-full cursor-pointer items-center gap-2 border-b border-dashed border-line px-3 py-1.5 text-sm text-muted-foreground hover:bg-AIPM-dark-blue/5 hover:text-AIPM-dark-blue"
                >
                  <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="h-3.5 w-3.5 opacity-50 group-hover:opacity-100">
                    <path d="M10.75 4.75a.75.75 0 00-1.5 0v4.5h-4.5a.75.75 0 000 1.5h4.5v4.5a.75.75 0 001.5 0v-4.5h4.5a.75.75 0 000-1.5h-4.5v-4.5z" />
                  </svg>
                  {t(lang, "raidAddItem")}
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {draft && (
        <RaidEditModal
          lang={lang}
          tasks={tasks}
          raid={raid}
          stakeholdersEnabled={stakeholdersEnabled}
          stakeholders={stakeholders}
          resources={resources}
          contacts={contacts}
          onCreateResource={onCreateResource}
          draft={draft}
          isNew={isNew}
          onChange={setDraft}
          onApplyStatus={(s) => setDraft((d) => (d ? applyStatus(d, s) : d))}
          onApplyMatrix={(p, i) =>
            setDraft((d) => (d ? applyMatrix(d, p, i) : d))
          }
          onSave={commitDraft}
          onCancel={closeModal}
          onDelete={commitDelete}
          onCreateMitigationTask={commitCreateMitigationTask}
          onJumpToRaid={(id) => {
            const target = raidById.get(id);
            if (target) openEdit(target);
          }}
        />
      )}
      <ResizeCornerHint lang={lang} />
    </div>
  );
}

// memo-wrap so the panel skips re-render when the parent re-renders for
// unrelated reasons (search keystrokes, column drag, etc.). Memoization
// relies on the handler props being stable refs — TaskManager wraps them in
// useCallback for that reason.
export const RaidPanel = memo(RaidPanelInner);
