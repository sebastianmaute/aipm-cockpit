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

import { memo, useEffect, useMemo, useState } from "react";
import { SegmentedControl } from "./segmented-control";
import { TABLE_HEAD_CLASS } from "./table-styles";
import { type Lang, t, type TranslationKey } from "./i18n";
import {
  buildRaidCausesIndex,
  compareRaid,
  defaultStatusForCategory,
  isTerminalStatus,
  nextRaidId,
  riskSeverityFromMatrix,
  severityRag,
  statusOptionsFor,
  wouldCreateCycle,
  type RaidSortKey,
} from "./raid";
import {
  RAID_CATEGORIES,
  RAID_SEVERITIES,
  RISK_SCALES,
  type RaidCategory,
  type RaidItem,
  type RaidSeverity,
  type RaidStatus,
  type RiskScale,
  type Task,
} from "./types";
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
  tasks: Task[];
  raid: RaidItem[];
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
  R: "bg-AIPM-pink/15 text-AIPM-pink dark:bg-AIPM-pink/20",
  A: "bg-AIPM-blue/15 text-AIPM-blue dark:bg-AIPM-blue/20",
  I: "bg-AIPM-purple/15 text-AIPM-purple dark:bg-AIPM-purple/20",
  D: "bg-AIPM-green/15 text-AIPM-green dark:bg-AIPM-green/20",
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

// --- Translation lookups -------------------------------------------------

function categoryLabel(c: RaidCategory, lang: Lang): string {
  return t(
    lang,
    c === "R"
      ? "raidCategoryR"
      : c === "A"
        ? "raidCategoryA"
        : c === "I"
          ? "raidCategoryI"
          : "raidCategoryD",
  );
}

function severityLabel(s: RaidSeverity, lang: Lang): string {
  switch (s) {
    case "Low":
      return t(lang, "raidSeverityLow");
    case "Medium":
      return t(lang, "raidSeverityMedium");
    case "High":
      return t(lang, "raidSeverityHigh");
    case "Critical":
      return t(lang, "raidSeverityCritical");
  }
}

const STATUS_KEY: Record<RaidStatus, TranslationKey> = {
  Open: "raidStatusOpen",
  Mitigated: "raidStatusMitigated",
  Realized: "raidStatusRealized",
  Closed: "raidStatusClosed",
  Pending: "raidStatusPending",
  Validated: "raidStatusValidated",
  Invalidated: "raidStatusInvalidated",
  "In Progress": "raidStatusInProgress",
  Resolved: "raidStatusResolved",
  Delivered: "raidStatusDelivered",
  Blocked: "raidStatusBlocked",
};

function statusLabel(s: RaidStatus, lang: Lang): string {
  return t(lang, STATUS_KEY[s]);
}

// --- Component -----------------------------------------------------------

function RaidPanelInner({
  lang,
  tasks,
  raid,
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
      raisedDate: today,
    });
    setIsNew(true);
  }

  function openEdit(item: RaidItem) {
    setDraft({
      ...item,
      linkedTaskIds: [...item.linkedTaskIds],
      causedByRaidIds: [...item.causedByRaidIds],
    });
    setIsNew(false);
  }

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
    <div className="flex shrink-0 flex-wrap items-center gap-2 pb-2">
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
        className="min-w-[12rem] flex-1 rounded-md border border-line bg-surface px-3 py-1.5 text-sm text-foreground focus:border-AIPM-dark-blue focus:outline-none focus:ring-1 focus:ring-AIPM-green"
      />
      <select
        value={categoryFilter}
        onChange={(e) =>
          setCategoryFilter(e.target.value as "All" | RaidCategory)
        }
        aria-label={t(lang, "raidCategory")}
        title={t(lang, "raidCategoryFilterHint")}
        className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-foreground"
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
        className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-foreground"
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
        className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-foreground"
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

// --- Edit modal ----------------------------------------------------

type RaidEditModalProps = {
  lang: Lang;
  tasks: Task[];
  raid: readonly RaidItem[];
  draft: RaidItem;
  isNew: boolean;
  onChange: (next: RaidItem) => void;
  onApplyStatus: (s: RaidStatus) => void;
  onApplyMatrix: (probability: RiskScale, impact: RiskScale) => void;
  onSave: () => void;
  onCancel: () => void;
  onDelete: () => void;
  onCreateMitigationTask: () => void;
  /** Switch the panel's modal to a different RAID item. Used by the
   *  "Caused by" link and the "Items caused by this" chips. */
  onJumpToRaid: (id: number) => void;
};

function RaidEditModal({
  lang,
  tasks,
  raid,
  draft,
  isNew,
  onChange,
  onApplyStatus,
  onApplyMatrix,
  onSave,
  onCancel,
  onDelete,
  onCreateMitigationTask,
  onJumpToRaid,
}: RaidEditModalProps) {
  const [error, setError] = useState<string | null>(null);
  const [taskPickerQuery, setTaskPickerQuery] = useState("");
  const [causePickerQuery, setCausePickerQuery] = useState("");
  // Category is locked after creation by default (changing it can lose
  // status / matrix data). Users can unlock it with the inline "Advanced"
  // affordance. Re-locks whenever the user navigates to a different item.
  const [categoryUnlocked, setCategoryUnlocked] = useState(false);
  const [prevDraftId, setPrevDraftId] = useState(draft.id);
  if (prevDraftId !== draft.id) {
    setPrevDraftId(draft.id);
    setCategoryUnlocked(false);
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  const statusOpts = statusOptionsFor(draft.category);

  const availableTasks = useMemo(() => {
    const linked = new Set(draft.linkedTaskIds);
    const q = taskPickerQuery.trim().toLowerCase();
    return tasks
      .filter((tk) => !linked.has(tk.id))
      .filter((tk) => {
        if (!q) return true;
        if (String(tk.id) === q) return true;
        return tk.taskName.toLowerCase().includes(q);
      })
      .slice(0, 20);
  }, [tasks, draft.linkedTaskIds, taskPickerQuery]);

  // RAID items eligible to be added as a cause of this draft. Excludes the
  // draft itself, already-selected parents, and any item whose selection
  // would close a cycle. Filtering happens before the search query is
  // applied so typing can't bring an invalid pick back into view.
  const availableCauses = useMemo(() => {
    const q = causePickerQuery.trim().toLowerCase();
    const selected = new Set(draft.causedByRaidIds);
    return raid
      .filter((r) => r.id !== draft.id)
      .filter((r) => !selected.has(r.id))
      .filter((r) => !wouldCreateCycle(raid, draft.id, r.id))
      .filter((r) => {
        if (!q) return true;
        if (String(r.id) === q) return true;
        return r.title.toLowerCase().includes(q);
      })
      .slice(0, 20);
  }, [raid, draft.id, draft.causedByRaidIds, causePickerQuery]);

  // Items whose `causedByRaidIds` includes this draft — only meaningful for
  // saved items (a brand-new draft can't have caused anything yet).
  const causedChildren = useMemo(() => {
    if (isNew) return [];
    return raid.filter((r) => r.causedByRaidIds.includes(draft.id));
  }, [raid, draft.id, isNew]);

  const parentItems = useMemo(
    () =>
      draft.causedByRaidIds
        .map((id) => raid.find((r) => r.id === id))
        .filter((r): r is RaidItem => !!r),
    [draft.causedByRaidIds, raid],
  );

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.title.trim()) {
      setError(t(lang, "raidErrorTitleRequired"));
      return;
    }
    setError(null);
    onSave();
  }

  function addLinked(taskId: number) {
    if (draft.linkedTaskIds.includes(taskId)) return;
    onChange({ ...draft, linkedTaskIds: [...draft.linkedTaskIds, taskId] });
    setTaskPickerQuery("");
  }

  function removeLinked(taskId: number) {
    onChange({
      ...draft,
      linkedTaskIds: draft.linkedTaskIds.filter((id) => id !== taskId),
    });
  }

  function addCausedBy(parentId: number) {
    if (parentId === draft.id) {
      setError(t(lang, "raidErrorCausedBySelf"));
      return;
    }
    if (draft.causedByRaidIds.includes(parentId)) return;
    if (wouldCreateCycle(raid, draft.id, parentId)) {
      setError(t(lang, "raidErrorCausedByCycle"));
      return;
    }
    setError(null);
    onChange({
      ...draft,
      causedByRaidIds: [...draft.causedByRaidIds, parentId],
    });
    setCausePickerQuery("");
  }

  function removeCausedBy(parentId: number) {
    onChange({
      ...draft,
      causedByRaidIds: draft.causedByRaidIds.filter((id) => id !== parentId),
    });
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={
        isNew ? t(lang, "raidNewItem") : t(lang, "raidEditItem", draft.id)
      }
      className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-AIPM-dark-blue/40 p-4 sm:p-10"
      onClick={onCancel}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="relative flex w-[720px] min-w-[460px] max-w-[95vw] flex-col overflow-hidden rounded-xl border border-line bg-surface"
      >
        <header className="sticky top-0 z-10 flex shrink-0 items-center justify-between gap-4 border-b border-line bg-surface px-6 py-4">
          <h2 className="text-lg font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey">
            {isNew ? t(lang, "raidNewItem") : t(lang, "raidEditItem", draft.id)}
          </h2>
          <button
            type="button"
            onClick={onCancel}
            aria-label={t(lang, "cancel")}
            className="rounded-md p-2 text-foreground hover:bg-surface-muted hover:text-AIPM-dark-blue"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="h-4 w-4">
              <path
                fillRule="evenodd"
                d="M4.28 4.28a.75.75 0 011.06 0L10 8.94l4.66-4.66a.75.75 0 111.06 1.06L11.06 10l4.66 4.66a.75.75 0 11-1.06 1.06L10 11.06l-4.66 4.66a.75.75 0 01-1.06-1.06L8.94 10 4.28 5.34a.75.75 0 010-1.06z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        </header>

        <form onSubmit={handleSubmit} className="grid grid-cols-1 gap-4 overflow-y-auto p-6 sm:grid-cols-2">
          <div className="flex flex-col gap-1 text-sm">
            <label className="flex flex-col gap-1">
              <span className="font-medium text-foreground">
                {t(lang, "raidCategory")}
              </span>
              <SegmentedControl<RaidCategory>
                value={draft.category}
                disabled={!isNew && !categoryUnlocked}
                ariaLabel={t(lang, "raidCategory")}
                title={t(lang, "raidFieldCategoryHint")}
                options={RAID_CATEGORIES.map((c) => ({
                  value: c,
                  label: categoryLabel(c, lang),
                }))}
                onChange={(c) => {
                  // Smart status mapping: keep the current status when the
                  // new category still permits it (common values like
                  // "Open", "Closed", "In Progress" appear in multiple
                  // enums). Otherwise fall back to the new category's
                  // default. This makes "change category" feel non-lossy
                  // in the common case (R↔I↔D), while still being correct
                  // for Assumption transitions.
                  const validStatuses = statusOptionsFor(c);
                  const newStatus = validStatuses.includes(draft.status)
                    ? draft.status
                    : defaultStatusForCategory(c);
                  // Risk-only matrix fields: initialize when becoming R,
                  // clear when leaving R.
                  let probability = draft.probability;
                  let impact = draft.impact;
                  let severity = draft.severity;
                  if (c === "R" && (probability === undefined || impact === undefined)) {
                    probability = 3;
                    impact = 3;
                    severity = riskSeverityFromMatrix(probability, impact);
                  } else if (c !== "R" && (probability !== undefined || impact !== undefined)) {
                    probability = undefined;
                    impact = undefined;
                  }
                  onChange({
                    ...draft,
                    category: c,
                    status: newStatus,
                    probability,
                    impact,
                    severity,
                  });
                }}
              />
            </label>
            {!isNew && !categoryUnlocked && (
              <button
                type="button"
                onClick={() => setCategoryUnlocked(true)}
                className="self-start text-[11px] font-medium text-muted-foreground underline-offset-2 hover:text-AIPM-dark-blue hover:underline"
              >
                {t(lang, "raidAdvancedChangeCategory")}
              </button>
            )}
            {!isNew && categoryUnlocked && (
              <span className="text-[11px] italic text-AIPM-purple">
                {t(lang, "raidCategoryChangedWarning")}
              </span>
            )}
          </div>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-foreground">
              {t(lang, "raidStatus")}
            </span>
            <SegmentedControl<RaidStatus>
              value={draft.status}
              ariaLabel={t(lang, "raidStatus")}
              title={t(lang, "raidFieldStatusHint")}
              options={statusOpts.map((s) => ({
                value: s,
                label: statusLabel(s, lang),
              }))}
              onChange={(s) => onApplyStatus(s)}
            />
          </label>

          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="font-medium text-foreground">
              {t(lang, "raidTitle")} *
            </span>
            <input
              type="text"
              required
              value={draft.title}
              onChange={(e) => onChange({ ...draft, title: e.target.value })}
              placeholder={t(lang, "raidPlaceholderTitle")}
              title={t(lang, "raidFieldTitleHint")}
              className="rounded-md border border-line bg-surface px-3 py-2 text-sm"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="font-medium text-foreground">
              {t(lang, "raidDescription")}
            </span>
            <textarea
              rows={2}
              value={draft.description ?? ""}
              onChange={(e) =>
                onChange({ ...draft, description: e.target.value || undefined })
              }
              placeholder={t(lang, "raidPlaceholderDescription")}
              title={t(lang, "raidFieldDescriptionHint")}
              className="rounded-md border border-line bg-surface px-3 py-2 text-sm"
            />
          </label>

          {draft.category === "R" ? (
            <div className="sm:col-span-2" title={t(lang, "raidFieldRiskMatrixHint")}>
              <div className="mb-2 flex items-baseline justify-between gap-2">
                <span className="text-sm font-medium text-foreground">
                  {t(lang, "raidRiskMatrix")}
                </span>
                <span className="text-xs text-muted-foreground">
                  {draft.probability && draft.impact
                    ? `${draft.probability} × ${draft.impact} = ${draft.probability * draft.impact} → ${draft.severity ? severityLabel(draft.severity, lang) : ""}`
                    : ""}
                </span>
              </div>
              <RiskMatrix
                probability={draft.probability ?? 3}
                impact={draft.impact ?? 3}
                onPick={onApplyMatrix}
                lang={lang}
              />
            </div>
          ) : (
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-foreground">
                {t(lang, "raidSeverity")}
              </span>
              <SegmentedControl<RaidSeverity>
                value={draft.severity ?? "Medium"}
                ariaLabel={t(lang, "raidSeverity")}
                title={t(lang, "raidFieldSeverityHint")}
                options={RAID_SEVERITIES.map((s) => ({
                  value: s,
                  label: severityLabel(s, lang),
                }))}
                onChange={(s) => onChange({ ...draft, severity: s })}
              />
            </label>
          )}

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-foreground">
              {t(lang, "raidOwner")}
            </span>
            <input
              type="text"
              value={draft.owner ?? ""}
              onChange={(e) =>
                onChange({ ...draft, owner: e.target.value || undefined })
              }
              title={t(lang, "raidFieldOwnerHint")}
              className="rounded-md border border-line bg-surface px-3 py-2 text-sm"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-foreground">
              {t(lang, "email")}
            </span>
            <input
              type="email"
              value={draft.ownerEmail ?? ""}
              onChange={(e) =>
                onChange({ ...draft, ownerEmail: e.target.value || undefined })
              }
              title={t(lang, "raidFieldOwnerEmailHint")}
              className="rounded-md border border-line bg-surface px-3 py-2 text-sm"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-foreground">
              {t(lang, "raidRaisedDate")}
            </span>
            <input
              type="date"
              value={draft.raisedDate}
              onChange={(e) => onChange({ ...draft, raisedDate: e.target.value })}
              title={t(lang, "raidFieldRaisedDateHint")}
              className="rounded-md border border-line bg-surface px-3 py-2 text-sm"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-foreground">
              {t(lang, "raidTargetDate")}
            </span>
            <input
              type="date"
              value={draft.targetDate ?? ""}
              onChange={(e) =>
                onChange({ ...draft, targetDate: e.target.value || undefined })
              }
              title={t(lang, "raidFieldTargetDateHint")}
              className="rounded-md border border-line bg-surface px-3 py-2 text-sm"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="font-medium text-foreground">
              {t(lang, "raidMitigation")}
            </span>
            <textarea
              rows={3}
              value={draft.mitigation ?? ""}
              onChange={(e) =>
                onChange({ ...draft, mitigation: e.target.value || undefined })
              }
              placeholder={t(lang, "raidPlaceholderMitigation")}
              title={t(lang, "raidFieldMitigationHint")}
              className="rounded-md border border-line bg-surface px-3 py-2 text-sm"
            />
          </label>

          <div className="sm:col-span-2">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-foreground">
                {t(lang, "raidLinkedTasks")}
              </span>
              <button
                type="button"
                onClick={onCreateMitigationTask}
                disabled={isNew}
                title={t(lang, "raidCreateMitigationTaskHint")}
                className="rounded-md border border-AIPM-dark-blue bg-surface px-2 py-1 text-xs font-medium text-AIPM-dark-blue hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50 dark:border-AIPM-blue dark:text-AIPM-blue"
              >
                {t(lang, "raidCreateMitigationTask")}
              </button>
            </div>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {draft.linkedTaskIds.length === 0 && (
                <span className="text-xs italic text-muted-foreground">—</span>
              )}
              {draft.linkedTaskIds.map((tid) => {
                const tk = tasks.find((task) => task.id === tid);
                return (
                  <span
                    key={tid}
                    className="inline-flex items-center gap-1 rounded bg-surface-muted px-2 py-0.5 text-xs text-foreground"
                  >
                    <span className="font-mono">#{tid}</span>
                    <span className="max-w-[200px] truncate">
                      {tk?.taskName ?? ""}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeLinked(tid)}
                      aria-label={t(lang, "raidUnlinkTask")}
                      title={t(lang, "raidUnlinkTask")}
                      className="text-muted-foreground hover:text-AIPM-pink"
                    >
                      ×
                    </button>
                  </span>
                );
              })}
            </div>
            <div className="relative">
              <input
                type="text"
                value={taskPickerQuery}
                onChange={(e) => setTaskPickerQuery(e.target.value)}
                placeholder={t(lang, "raidLinkPickerPlaceholder")}
                title={t(lang, "raidFieldLinkedTasksHint")}
                className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm"
              />
              {taskPickerQuery.trim() !== "" && availableTasks.length > 0 && (
                <ul className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-md border border-line bg-surface">
                  {availableTasks.map((tk) => (
                    <li key={tk.id}>
                      <button
                        type="button"
                        onClick={() => addLinked(tk.id)}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-surface-muted"
                      >
                        <span className="font-mono text-xs text-muted-foreground">
                          #{tk.id}
                        </span>
                        <span className="truncate">{tk.taskName}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* Caused by ----------------------------------------------- */}
          <div className="sm:col-span-2">
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-foreground">
                {t(lang, "raidCausedBy")}
              </span>
            </div>
            <div className="mb-2 flex flex-wrap items-center gap-1.5">
              {parentItems.length === 0 && (
                <span className="text-xs italic text-muted-foreground">—</span>
              )}
              {parentItems.map((p) => (
                <span
                  key={p.id}
                  className="inline-flex items-center gap-1 rounded bg-surface-muted px-2 py-0.5 text-xs text-foreground"
                >
                  <button
                    type="button"
                    onClick={() => onJumpToRaid(p.id)}
                    title={p.title}
                    className="inline-flex items-center gap-1 hover:underline"
                  >
                    <span className="font-mono">
                      ↩ {p.category}#{p.id}
                    </span>
                    <span className="max-w-[220px] truncate">{p.title}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => removeCausedBy(p.id)}
                    aria-label={t(lang, "raidCausedByClear")}
                    title={t(lang, "raidCausedByClear")}
                    className="text-muted-foreground hover:text-AIPM-pink"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
            <div className="relative">
              <input
                type="text"
                value={causePickerQuery}
                onChange={(e) => setCausePickerQuery(e.target.value)}
                placeholder={t(lang, "raidCausedByPlaceholder")}
                title={t(lang, "raidFieldCausedByHint")}
                className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm"
              />
              {causePickerQuery.trim() !== "" && availableCauses.length > 0 && (
                <ul className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-md border border-line bg-surface">
                  {availableCauses.map((r) => (
                    <li key={r.id}>
                      <button
                        type="button"
                        onClick={() => addCausedBy(r.id)}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-surface-muted"
                      >
                        <span className="font-mono text-xs text-muted-foreground">
                          {r.category}#{r.id}
                        </span>
                        <span className="truncate">{r.title}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          {/* Items caused by this — read-only. The user breaks the link by
              editing the child. Only shown for saved items with children. */}
          {!isNew && causedChildren.length > 0 && (
            <div className="sm:col-span-2">
              <span className="mb-2 block text-sm font-medium text-foreground">
                {t(lang, "raidCausedThis")}
              </span>
              <div className="flex flex-wrap gap-1.5">
                {causedChildren.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => onJumpToRaid(c.id)}
                    title={c.title}
                    className="inline-flex items-center gap-1 rounded bg-AIPM-purple/10 px-2 py-0.5 text-xs text-AIPM-purple hover:bg-AIPM-purple/20 dark:bg-AIPM-purple/15 dark:hover:bg-AIPM-purple/25"
                  >
                    <span className="font-mono">{c.category}#{c.id}</span>
                    <span className="max-w-[220px] truncate">{c.title}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {error && (
            <p
              role="alert"
              className="rounded-md bg-AIPM-pink/10 px-3 py-2 text-sm text-AIPM-pink dark:bg-AIPM-pink/15 sm:col-span-2"
            >
              {error}
            </p>
          )}

          <div className="flex justify-between gap-2 sm:col-span-2">
            <button
              type="button"
              onClick={() => {
                if (window.confirm(t(lang, "raidConfirmDelete"))) onDelete();
              }}
              disabled={isNew}
              title={t(lang, "raidFieldDeleteHint")}
              className="rounded-md border border-AIPM-pink/40 bg-surface px-3 py-2 text-sm font-medium text-AIPM-pink hover:bg-AIPM-pink/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {t(lang, "raidDelete")}
            </button>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={onCancel}
                className="rounded-md border border-line bg-surface px-4 py-2 text-sm font-medium text-foreground hover:bg-surface-muted"
              >
                {t(lang, "cancel")}
              </button>
              <button
                type="submit"
                className="rounded-md bg-AIPM-dark-blue px-4 py-2 text-sm font-medium text-white hover:opacity-90"
              >
                {t(lang, "raidSave")}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}

// --- 5×5 risk matrix --------------------------------------------------

function RiskMatrix({
  probability,
  impact,
  onPick,
  lang,
}: {
  probability: RiskScale;
  impact: RiskScale;
  onPick: (probability: RiskScale, impact: RiskScale) => void;
  lang: Lang;
}) {
  function cellColor(p: RiskScale, i: RiskScale): string {
    const score = p * i;
    if (score <= 5)
      return "bg-AIPM-green/20 hover:bg-AIPM-green/30 dark:bg-AIPM-green/20 dark:hover:bg-AIPM-green/30";
    if (score <= 10)
      return "bg-AIPM-blue/20 hover:bg-AIPM-blue/30 dark:bg-AIPM-blue/20 dark:hover:bg-AIPM-blue/30";
    if (score <= 15)
      return "bg-AIPM-purple/25 hover:bg-AIPM-purple/35 dark:bg-AIPM-purple/25 dark:hover:bg-AIPM-purple/35";
    return "bg-AIPM-pink/30 hover:bg-AIPM-pink/40 dark:bg-AIPM-pink/30 dark:hover:bg-AIPM-pink/40";
  }

  return (
    <div className="inline-flex items-center gap-1">
      {/* Vertical probability axis label — mirrors the horizontal "← Impact →"
          footer. Rotated -90deg so the arrows end up pointing ↓ (low) at the
          bottom and ↑ (high) at the top, matching the matrix orientation
          (5 at the top, 1 at the bottom). */}
      <div className="flex w-4 items-center justify-center">
        <span
          className="whitespace-nowrap text-[10px] text-muted-foreground"
          style={{ transform: "rotate(-90deg)" }}
        >
          ← {t(lang, "raidProbability")} →
        </span>
      </div>
      <div className="inline-block">
      <div className="mb-1 grid grid-cols-[auto_repeat(5,2rem)] gap-0.5 text-[10px] text-muted-foreground">
        <span />
        {RISK_SCALES.map((i) => (
          <span key={`imp-${i}`} className="text-center">
            {i}
          </span>
        ))}
      </div>
      {/* Probability rows from 5 (top) down to 1 (bottom) so higher risk
          appears in the top-right corner, matching standard risk-matrix
          orientation. */}
      {([5, 4, 3, 2, 1] as RiskScale[]).map((p) => (
        <div
          key={`row-${p}`}
          className="grid grid-cols-[auto_repeat(5,2rem)] gap-0.5"
        >
          <span className="self-center pr-1 text-[10px] text-muted-foreground">
            {p}
          </span>
          {RISK_SCALES.map((i) => {
            const isSelected = probability === p && impact === i;
            return (
              <button
                key={`cell-${p}-${i}`}
                type="button"
                onClick={() => onPick(p, i)}
                aria-label={`${t(lang, "raidProbability")} ${p}, ${t(lang, "raidImpact")} ${i}`}
                className={`h-8 w-8 rounded text-[10px] font-medium text-foreground ${cellColor(p, i)} ${
                  isSelected ? "ring-2 ring-AIPM-green ring-offset-1" : ""
                }`}
              >
                {p * i}
              </button>
            );
          })}
        </div>
      ))}
      <div className="mt-1 grid grid-cols-[auto_repeat(5,2rem)] gap-0.5">
        <span />
        <span className="col-span-5 text-center text-[10px] text-muted-foreground">
          ← {t(lang, "raidImpact")} →
        </span>
      </div>
      </div>
    </div>
  );
}

// memo-wrap so the panel skips re-render when the parent re-renders for
// unrelated reasons (search keystrokes, column drag, etc.). Memoization
// relies on the handler props being stable refs — TaskManager wraps them in
// useCallback for that reason.
export const RaidPanel = memo(RaidPanelInner);
