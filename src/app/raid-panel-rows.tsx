// src/app/raid-panel-rows.tsx
//
// Presentational RAID table (move-only extraction from raid-panel.tsx, mirrors
// the gantt-rows split). thead + tbody rendering only; all data + handlers arrive
// as props from the orchestrator, which owns state and derivation. Props are
// destructured to the same local names the inline JSX used, so the markup is
// reproduced verbatim.
import type React from "react";
import { PlusIcon } from "./icons";
import { Checkbox } from "./form-controls";
import { type Lang, t } from "./i18n";
import { Badge } from "./badge";
import { TextButton } from "./text-button";
import { categoryLabel, severityLabel, statusLabel } from "./raid-labels";
import { isTerminalStatus, severityRag, type RaidSortKey } from "./raid";
import { isRaidActiveForReview } from "./raid-review";
import type { RaidCategory, RaidItem, Resource, Task } from "./types";
import { effectivePersonName } from "./resource-foundation";
import { ColumnResizeHandle } from "./task-manager-ui";
import { SortResizeTh, useSortHeaderProps } from "./report-table";
import { RagDot } from "./rag-dot";
import { INTERACTIVE } from "./interaction-styles";
import { flashOutlineClass } from "./use-deeplink-row-flash";
import { RAID_CONFIG_COLS, RAID_COL_WIDTHS } from "./raid-panel-columns";
import type { PanelSort } from "./panel-views";
import type { useRowSelection } from "./use-row-selection";
import { InlineAiEditButton } from "./inline-ai-edit-button";
import { NotesBadgeButton } from "./notes-badge-button";
import { DocumentBadge } from "./document-badge";
import { refKey, type DocRefKind } from "./document-ref";
import type { ProjectDocument } from "./document-model";
import { DataTable } from "./data-table";

const categoryPillClass: Record<RaidCategory, string> = {
  R: "bg-ui-pink/15 text-ui-dark-blue dark:bg-ui-pink/20 dark:text-ui-light-grey",
  A: "bg-ui-blue/15 text-ui-dark-blue dark:bg-ui-blue/20 dark:text-ui-light-grey",
  I: "bg-ui-purple/15 text-ui-dark-blue dark:bg-ui-purple/20 dark:text-ui-light-grey",
  D: "bg-ui-green/15 text-ui-dark-blue dark:bg-ui-green/20 dark:text-ui-light-grey",
};

export interface RaidTableProps {
  lang: Lang;
  hiddenSet: Set<string>;
  sel: ReturnType<typeof useRowSelection>;
  visibleIds: number[];
  sort: PanelSort;
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
  /** `refKey("raid", id)` → the documents referencing that item (row badge). */
  documentsByEntity?: ReadonlyMap<string, readonly ProjectDocument[]>;
  /** Deep-link to the Documents pane filtered to this item. */
  onOpenDocuments: (kind: DocRefKind, id: number) => void;
  onJumpToTask: (taskId: number) => void;
  /** Open the floating notes window (running note log) for a RAID item. */
  onOpenNotes: (id: number) => void;
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
  documentsByEntity,
  onOpenDocuments,
  onJumpToTask,
  onOpenNotes,
  effectiveCategory,
  openNew,
  flashId,
  onAiEdit,
  aiEditEnabled,
  onSendInquiry,
}: RaidTableProps) {
  // PanelSort.key is a bare `string`, so narrow ONCE here rather than leaving
  // seven unchecked `sortCol` call sites: the explicit generic is what makes a
  // typo in one of them a compile error.
  const th = useSortHeaderProps<RaidSortKey>(
    (sort?.key ?? null) as RaidSortKey | null,
    sort?.dir ?? "off",
    toggleSort,
    startResize,
  );
  return (
    <DataTable className="min-w-full text-left text-sm" head={<>
        <tr>
          <th className="px-3 py-2 font-medium" style={{ width: 36, minWidth: 36 }}>
            <Checkbox
              aria-label={t(lang, "selectAllVisibleRows")}
              checked={sel.allSelected(visibleIds)}
              onChange={() => sel.toggleAllVisible(visibleIds)}
              className="cursor-pointer"
              />
          </th>
          {!hiddenSet.has("id") && (
            <SortResizeTh {...th} label="#" sortCol="id" width={colWidths.id} title={t(lang, "id")} />
          )}
          {!hiddenSet.has("category") && (
            <SortResizeTh {...th} label={t(lang, "raidCategory")} sortCol="category" width={colWidths.category} />
          )}
          {!hiddenSet.has("title") && (
            <SortResizeTh {...th} label={t(lang, "raidTitle")} sortCol="title" width={colWidths.title} />
          )}
          {!hiddenSet.has("severity") && (
            <SortResizeTh {...th} label={t(lang, "raidSeverity")} sortCol="severity" width={colWidths.severity} hint={t(lang, "raidSeverityHint")} />
          )}
          {!hiddenSet.has("status") && (
            <SortResizeTh {...th} label={t(lang, "raidStatus")} sortCol="status" width={colWidths.status} />
          )}
          {!hiddenSet.has("owner") && (
            <SortResizeTh {...th} label={t(lang, "raidOwner")} sortCol="owner" width={colWidths.owner} />
          )}
          {!hiddenSet.has("targetDate") && (
            <SortResizeTh {...th} label={t(lang, "raidTargetDate")} sortCol="targetDate" width={colWidths.targetDate} />
          )}
          {!hiddenSet.has("linkedTasks") && (
          <th className="relative px-3 py-2 font-medium" style={{ width: colWidths.linkedTasks, minWidth: colWidths.linkedTasks }}>
            {t(lang, "raidLinkedTasks")}
            <ColumnResizeHandle col="linkedTasks" onMouseDown={startResize} />
          </th>
          )}
          {!hiddenSet.has("causedBy") && (
          <th className="relative px-3 py-2 font-medium" style={{ width: colWidths.causedBy, minWidth: colWidths.causedBy }}>
            {t(lang, "raidCausedBy")}
            <ColumnResizeHandle col="causedBy" onMouseDown={startResize} />
          </th>
          )}
          {!hiddenSet.has("notesLog") && (
          <th className="relative px-3 py-2 font-medium" style={{ width: colWidths.notesLog, minWidth: colWidths.notesLog }}>
            {t(lang, "noteLogTitle")}
            <ColumnResizeHandle col="notesLog" onMouseDown={startResize} />
          </th>
          )}
        </tr>
      </>} tbodyClassName="divide-y divide-line">
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
                <Checkbox
                  aria-label={t(lang, "selectItem", item.title)}
                  checked={sel.isSelected(item.id)}
                  onChange={() => sel.toggle(item.id)}
                  className="cursor-pointer"
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
                  <DocumentBadge
                    lang={lang}
                    count={documentsByEntity?.get(refKey("raid", item.id))?.length ?? 0}
                    entityTitle={item.title}
                    onOpen={() => onOpenDocuments("raid", item.id)}
                  />
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
                    <TextButton
                      onClick={(e) => {
                        e.stopPropagation();
                        onSendInquiry(item);
                      }}
                      aria-label={`${t(lang, "sendInquiry")} – ${item.title}`}
                      className="text-xs"
                    >
                      {t(lang, "sendInquiry")}
                    </TextButton>
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
                          className={`inline-flex rounded bg-surface-muted px-1.5 py-0.5 font-mono text-[10px] text-ui-dark-blue hover:bg-ui-dark-blue hover:text-white dark:text-foreground ${INTERACTIVE}`}
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
                            className={`inline-flex items-center gap-1 rounded bg-surface-muted px-1.5 py-0.5 font-mono text-[10px] text-ui-dark-blue hover:bg-ui-dark-blue hover:text-white dark:text-foreground ${INTERACTIVE}`}
                          >
                            ↩ #{pid}
                          </button>
                        );
                      })}
                      {children.length > 0 && (
                        <span
                          title={t(lang, "raidCausedThisCount", children.length)}
                          className="inline-flex items-center rounded bg-ui-purple px-1.5 py-0.5 text-[10px] font-medium text-white"
                        >
                          → {children.length}
                        </span>
                      )}
                    </span>
                  );
                })()}
              </td>
              )}
              {!hiddenSet.has("notesLog") && (
              // Cell-level stopPropagation so opening the notes window does not
              // also fire the row click (which opens the edit modal).
              <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                <NotesBadgeButton
                  count={item.noteLog?.length ?? 0}
                  entityName={item.title}
                  lang={lang}
                  onClick={() => onOpenNotes(item.id)}
                />
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
              className={`group flex w-full cursor-pointer items-center gap-2 border-b border-dashed border-line px-3 py-1.5 text-sm text-muted-foreground hover:bg-ui-dark-blue/5 hover:text-ui-dark-blue ${INTERACTIVE}`}
            >
              <PlusIcon aria-hidden="true" className="h-3.5 w-3.5 opacity-50 group-hover:opacity-100" />
              {t(lang, "raidAddItem")}
            </button>
          </td>
        </tr>
    </DataTable>
  );
}
