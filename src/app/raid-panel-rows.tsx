// src/app/raid-panel-rows.tsx
//
// Presentational RAID table (move-only extraction from raid-panel.tsx, mirrors
// the gantt-rows split). thead + tbody rendering only; all data + handlers arrive
// as props from the orchestrator, which owns state and derivation. Props are
// destructured to the same local names the inline JSX used, so the markup is
// reproduced verbatim.
import type React from "react";
import { type Lang, t } from "./i18n";
import { Badge } from "./badge";
import { categoryLabel, severityLabel, statusLabel } from "./raid-labels";
import { isTerminalStatus, severityRag, type RaidSortKey } from "./raid";
import { isRaidActiveForReview } from "./raid-review";
import type { RaidCategory, RaidItem, Resource, Task } from "./types";
import { effectivePersonName } from "./resource-foundation";
import { TABLE_HEAD_CLASS } from "./table-styles";
import { ColumnResizeHandle } from "./task-manager-ui";
import { InfoTooltip } from "./info-tooltip";
import { RagDot } from "./rag-dot";
import { INTERACTIVE, FOCUS_RING, TRANSITION } from "./interaction-styles";
import { flashOutlineClass } from "./use-deeplink-row-flash";
import { RAID_CONFIG_COLS, RAID_COL_WIDTHS } from "./raid-panel-columns";
import type { useRowSelection } from "./use-row-selection";
import { InlineAiEditButton } from "./inline-ai-edit-button";

const categoryPillClass: Record<RaidCategory, string> = {
  R: "bg-AIPM-pink/15 text-AIPM-dark-blue dark:bg-AIPM-pink/20 dark:text-AIPM-light-grey",
  A: "bg-AIPM-blue/15 text-AIPM-dark-blue dark:bg-AIPM-blue/20 dark:text-AIPM-light-grey",
  I: "bg-AIPM-purple/15 text-AIPM-dark-blue dark:bg-AIPM-purple/20 dark:text-AIPM-light-grey",
  D: "bg-AIPM-green/15 text-AIPM-dark-blue dark:bg-AIPM-green/20 dark:text-AIPM-light-grey",
};


type SortState = { key: string; dir: string } | null;

export interface RaidTableProps {
  lang: Lang;
  hiddenSet: Set<string>;
  sel: ReturnType<typeof useRowSelection>;
  visibleIds: number[];
  sort: SortState;
  toggleSort: (key: RaidSortKey) => void;
  colWidths: Record<keyof typeof RAID_COL_WIDTHS, number>;
  startResize: (col: string, e: React.MouseEvent) => void;
  visible: readonly RaidItem[];
  /** Live directory lookup so the owner cell shows the linked resource's
   *  CURRENT name, not the (possibly stale) cached `owner` string. */
  resourcesById: ReadonlyMap<number, Resource>;
  tasksById: Map<number, Task>;
  raidById: Map<number, RaidItem>;
  causesIndex: Map<number, readonly RaidItem[]>;
  openEdit: (item: RaidItem) => void;
  onJumpToTask: (taskId: number) => void;
  effectiveCategory: RaidCategory;
  openNew: (category?: RaidCategory) => void;
  flashId: number | null;
  /** Inline "Ask Claude" per-row edit (SP2). Absent when AI is off/popout. */
  onAiEdit?: (item: RaidItem) => void;
  /** Gate the per-row ✨ button (e.g. AI enabled && not Jira-synced). */
  aiEditEnabled?: (item: RaidItem) => boolean;
  /** Send a status-inquiry email to the item's owner. Absent in popouts; the
   *  button only renders for review-active items. */
  onSendInquiry?: (item: RaidItem) => void;
}

export function RaidTable({
  lang,
  hiddenSet,
  sel,
  visibleIds,
  sort,
  toggleSort,
  colWidths,
  startResize,
  visible,
  resourcesById,
  tasksById,
  raidById,
  causesIndex,
  openEdit,
  onJumpToTask,
  effectiveCategory,
  openNew,
  flashId,
  onAiEdit,
  aiEditEnabled,
  onSendInquiry,
}: RaidTableProps) {
  return (
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
          <th className="relative px-3 py-2" style={{ width: colWidths.id, minWidth: colWidths.id }} aria-sort={sort?.key === "id" ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
            <button type="button" onClick={() => toggleSort("id")} aria-label={t(lang, "id")} className={`inline-flex items-center gap-1 hover:text-AIPM-green ${INTERACTIVE}`}>
              #{sort?.key === "id" ? (sort.dir === "asc" ? " ▲" : " ▼") : ""}
            </button>
            <ColumnResizeHandle col="id" onMouseDown={startResize} />
          </th>
          )}
          {!hiddenSet.has("category") && (
          <th className="relative px-3 py-2" style={{ width: colWidths.category, minWidth: colWidths.category }} aria-sort={sort?.key === "category" ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
            <button type="button" onClick={() => toggleSort("category")} className={`inline-flex items-center gap-1 hover:text-AIPM-green ${INTERACTIVE}`}>
              {t(lang, "raidCategory")}{sort?.key === "category" ? (sort.dir === "asc" ? " ▲" : " ▼") : ""}
            </button>
            <ColumnResizeHandle col="category" onMouseDown={startResize} />
          </th>
          )}
          {!hiddenSet.has("title") && (
          <th className="relative px-3 py-2" style={{ width: colWidths.title, minWidth: colWidths.title }} aria-sort={sort?.key === "title" ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
            <button type="button" onClick={() => toggleSort("title")} className={`inline-flex items-center gap-1 hover:text-AIPM-green ${INTERACTIVE}`}>
              {t(lang, "raidTitle")}{sort?.key === "title" ? (sort.dir === "asc" ? " ▲" : " ▼") : ""}
            </button>
            <ColumnResizeHandle col="title" onMouseDown={startResize} />
          </th>
          )}
          {!hiddenSet.has("severity") && (
          <th className="relative px-3 py-2" style={{ width: colWidths.severity, minWidth: colWidths.severity }} aria-sort={sort?.key === "severity" ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
            <button type="button" onClick={() => toggleSort("severity")} className={`inline-flex items-center gap-1 hover:text-AIPM-green ${INTERACTIVE}`}>
              {t(lang, "raidSeverity")}{sort?.key === "severity" ? (sort.dir === "asc" ? " ▲" : " ▼") : ""}
            </button>
            <InfoTooltip text={t(lang, "raidSeverityHint")} />
            <ColumnResizeHandle col="severity" onMouseDown={startResize} />
          </th>
          )}
          {!hiddenSet.has("status") && (
          <th className="relative px-3 py-2" style={{ width: colWidths.status, minWidth: colWidths.status }} aria-sort={sort?.key === "status" ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
            <button type="button" onClick={() => toggleSort("status")} className={`inline-flex items-center gap-1 hover:text-AIPM-green ${INTERACTIVE}`}>
              {t(lang, "raidStatus")}{sort?.key === "status" ? (sort.dir === "asc" ? " ▲" : " ▼") : ""}
            </button>
            <ColumnResizeHandle col="status" onMouseDown={startResize} />
          </th>
          )}
          {!hiddenSet.has("owner") && (
          <th className="relative px-3 py-2" style={{ width: colWidths.owner, minWidth: colWidths.owner }} aria-sort={sort?.key === "owner" ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
            <button type="button" onClick={() => toggleSort("owner")} className={`inline-flex items-center gap-1 hover:text-AIPM-green ${INTERACTIVE}`}>
              {t(lang, "raidOwner")}{sort?.key === "owner" ? (sort.dir === "asc" ? " ▲" : " ▼") : ""}
            </button>
            <ColumnResizeHandle col="owner" onMouseDown={startResize} />
          </th>
          )}
          {!hiddenSet.has("targetDate") && (
          <th className="relative px-3 py-2" style={{ width: colWidths.targetDate, minWidth: colWidths.targetDate }} aria-sort={sort?.key === "targetDate" ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
            <button type="button" onClick={() => toggleSort("targetDate")} className={`inline-flex items-center gap-1 hover:text-AIPM-green ${INTERACTIVE}`}>
              {t(lang, "raidTargetDate")}{sort?.key === "targetDate" ? (sort.dir === "asc" ? " ▲" : " ▼") : ""}
            </button>
            <ColumnResizeHandle col="targetDate" onMouseDown={startResize} />
          </th>
          )}
          {!hiddenSet.has("linkedTasks") && (
          <th className="relative px-3 py-2" style={{ width: colWidths.linkedTasks, minWidth: colWidths.linkedTasks }}>
            {t(lang, "raidLinkedTasks")}
            <ColumnResizeHandle col="linkedTasks" onMouseDown={startResize} />
          </th>
          )}
          {!hiddenSet.has("causedBy") && (
          <th className="relative px-3 py-2" style={{ width: colWidths.causedBy, minWidth: colWidths.causedBy }}>
            {t(lang, "raidCausedBy")}
            <ColumnResizeHandle col="causedBy" onMouseDown={startResize} />
          </th>
          )}
        </tr>
      </thead>
      <tbody className="divide-y divide-line">
        {visible.length === 0 && (
          <tr>
            <td colSpan={1 + RAID_CONFIG_COLS.filter((c) => !hiddenSet.has(c.key)).length} className="p-10 text-center text-sm text-muted-foreground">
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
              data-deeplink-row={item.id}
              onClick={() => openEdit(item)}
              className={[
                "group cursor-pointer align-top hover:bg-surface-muted",
                // De-emphasize terminal rows with a background tint, NOT opacity
                // (opacity dims all text/badges below the WCAG AA threshold —
                // mirrors the task-row precedent).
                terminal ? "bg-surface-muted" : "",
                flashOutlineClass(flashId === item.id),
              ]
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
              {!hiddenSet.has("category") && (
              <td className="px-3 py-2">
                <Badge
                  size="sm"
                  className={`font-medium ${categoryPillClass[item.category]}`}
                  title={categoryLabel(item.category, lang)}
                >
                  {item.category}
                </Badge>
              </td>
              )}
              {!hiddenSet.has("title") && (
              <td className="px-3 py-2 font-medium text-foreground">
                <span className="inline-flex items-center gap-1">
                  <span>{item.title}</span>
                  {onAiEdit && aiEditEnabled?.(item) && (
                    <InlineAiEditButton lang={lang} label={item.title} onClick={() => onAiEdit(item)} />
                  )}
                </span>
              </td>
              )}
              {!hiddenSet.has("severity") && (
              <td className="px-3 py-2">
                <span className="inline-flex items-center gap-1.5">
                  <RagDot level={rag} />
                  <span>
                    {item.severity ? severityLabel(item.severity, lang) : "—"}
                    {item.category === "R" && item.probability && item.impact
                      ? ` (${item.probability}×${item.impact})`
                      : ""}
                  </span>
                </span>
              </td>
              )}
              {!hiddenSet.has("status") && (
              <td className="px-3 py-2 text-foreground">
                {statusLabel(item.status, lang)}
              </td>
              )}
              {!hiddenSet.has("owner") && (
              <td className="px-3 py-2 text-foreground">
                <span className="inline-flex flex-col items-start gap-0.5">
                  <span>{effectivePersonName(item.owner ?? "", item.ownerResourceId, resourcesById)}</span>
                  {onSendInquiry && isRaidActiveForReview(item) && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onSendInquiry(item);
                      }}
                      aria-label={`${t(lang, "sendInquiry")} – ${item.title}`}
                      className={`text-xs font-medium text-AIPM-dark-blue underline-offset-2 hover:underline dark:text-AIPM-blue ${INTERACTIVE}`}
                    >
                      {t(lang, "sendInquiry")}
                    </button>
                  )}
                </span>
              </td>
              )}
              {!hiddenSet.has("targetDate") && (
              <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                {item.targetDate ?? ""}
              </td>
              )}
              {!hiddenSet.has("linkedTasks") && (
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
                          className={`inline-flex rounded bg-surface-muted px-1.5 py-0.5 font-mono text-[10px] text-AIPM-dark-blue hover:bg-AIPM-dark-blue hover:text-white dark:text-foreground ${INTERACTIVE}`}
                        >
                          #{tid}
                        </button>
                      );
                    })}
                  </span>
                )}
              </td>
              )}
              {!hiddenSet.has("causedBy") && (
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
                            className={`inline-flex items-center gap-1 rounded bg-surface-muted px-1.5 py-0.5 font-mono text-[10px] text-AIPM-dark-blue hover:bg-AIPM-dark-blue hover:text-white dark:text-foreground ${INTERACTIVE}`}
                          >
                            ↩ #{pid}
                          </button>
                        );
                      })}
                      {children.length > 0 && (
                        <span
                          title={t(lang, "raidCausedThisCount", children.length)}
                          className="inline-flex items-center rounded bg-AIPM-purple px-1.5 py-0.5 text-[10px] font-medium text-white"
                        >
                          → {children.length}
                        </span>
                      )}
                    </span>
                  );
                })()}
              </td>
              )}
            </tr>
          );
        })}
        <tr>
          <td colSpan={1 + RAID_CONFIG_COLS.filter((c) => !hiddenSet.has(c.key)).length}>
            <button
              type="button"
              onClick={() => openNew(effectiveCategory)}
              aria-label={t(lang, "raidAddItem")}
              className={`group flex w-full cursor-pointer items-center gap-2 border-b border-dashed border-line px-3 py-1.5 text-sm text-muted-foreground hover:bg-AIPM-dark-blue/5 hover:text-AIPM-dark-blue ${INTERACTIVE}`}
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
  );
}
