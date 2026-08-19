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
import { descriptionText } from "./rich-text-projection";

const CHANGE_FILTER_DEFAULTS: PanelFiltersState = {
  search: "",
  filters: { type: "All", status: "All" },
  sort: null,
  hiddenCols: [],
};
import { ChangeEditModal } from "./change-edit-modal";
import { ColumnConfigPopover, type ColumnConfigCol } from "./column-config-popover";
import { CalendarSyncControls } from "./calendar-sync-controls";
import { InlineAiEditButton } from "./inline-ai-edit-button";
import { DocumentBadge } from "./document-badge";
import { NotesBadgeButton } from "./notes-badge-button";
import { refKey } from "./document-ref";
import type { ProjectDocument } from "./document-model";
import { PanelTableScaffold } from "./panel-table-scaffold";
import { useWorkspaceTab } from "./workspace-tab-context";
import { useDeepLinkRowFlash, flashOutlineClass } from "./use-deeplink-row-flash";
import {
  applyChangeStatus,
  changeImpactRag,
  compareChange,
  defaultChangeStatus,
  nextChangeId,
  type ChangeSortKey,
} from "./change-log";
import { ChangeStatusSelect, changeStatusLabel } from "./change-status-select";
import { type Lang, t, type TranslationKey } from "./i18n";
import { DataTable } from "./data-table";
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
import type { EntityPaneCalendarHintsProps } from "./workspace-section-types";
import { useColumnResize } from "./use-column-resize";
import { useResizable } from "./use-resizable";
import { buildBulkFieldEdits } from "./undo/field-groups";
import { ColumnResizeHandle, ResetColWidthsButton, ResetSizeButton, PrintButton } from "./task-manager-ui";
import { InfoTooltip } from "./info-tooltip";
import { RagDot } from "./rag-dot";
import { INTERACTIVE } from "./interaction-styles";
import { Checkbox, Select } from "./form-controls";
import { PaneToolbar, PaneSearchInput, AddButton } from "./pane-toolbar";
import { useRowSelection } from "./use-row-selection";
import { selectField, textField, type BulkField } from "./bulk-edit-panel";

const CHANGE_COL_WIDTHS = {
  id: 60,
  type: 110,
  title: 260,
  impact: 110,
  status: 130,
  requestedBy: 150,
  raisedDate: 110,
  notesLog: 80,
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
  { key: "notesLog", labelKey: "noteLogTitle" },
] as const satisfies readonly ColumnConfigCol[];

// Mirrors `requestedBy`'s sanitize cap (BUDGET_NAME_MAX in sanitize-entities).
const REQUESTED_BY_MAX = 200;

// --- Props ---------------------------------------------------------------

export type ChangePanelProps = EntityPaneCalendarHintsProps & {
  lang: Lang;
  tasks: readonly Task[];
  raid: readonly RaidItem[];
  changes: readonly ChangeItem[];
  /** YYYY-MM-DD; default `raisedDate` for new drafts + decisionDate autofill. */
  today: string;
  onSave: (item: ChangeItem, isNew?: boolean, opts?: { suppressFieldUndo?: boolean }) => void;
  onDelete: (id: number, title: string) => void;
  /** Inline status change from the row select. Must route through
   *  `applyChangeStatus`, where every status TRANSITION in the app stamps or
   *  clears `decisionDate` — not the only writer of that field, see its
   *  docblock in `change-log.ts`. */
  onStatusChange: (id: number, next: ChangeStatus) => void;
  /** Open the shared floating notes window (running note log) for a change.
   *  ★ The log is WRITE-THROUGH: the window commits straight into the workspace
   *  `changes` array, never through `onSave` — which reads `noteLog` back from
   *  the stored row and would drop a note added while an editor was open. */
  onOpenNotes: (id: number) => void;
  /** Capture the selected rows' field patches for undo before a bulk apply. */
  onCaptureBulk?: (edits: readonly { id: number; before: Partial<ChangeItem>; after: Partial<ChangeItem> }[]) => void;
  /** When false, the RAID-link editor is hidden in the edit modal. Default true. */
  raidEnabled?: boolean;
  /** When false, the Stakeholders picker is hidden in the edit modal. Default true. */
  stakeholdersEnabled?: boolean;
  /** Selectable stakeholders for the picker; empty when the module is off. */
  stakeholders?: readonly Stakeholder[];
  /** Inline "Ask Claude" per-row edit (SP2). Absent when AI is off / in popouts. */
  onAiEdit?: (item: ChangeItem) => void;
  /** Per-row gate for the ✨ button (AI enabled && !jira-synced-style predicate). */
  aiEditEnabled?: (item: ChangeItem) => boolean;
  /** `refKey("change", id)` → the documents referencing that item, for the row
   *  badge. Threaded from task-manager, NOT read from `useWorkspace()` here:
   *  this panel is `memo`'d and a context consumer re-renders on ANY context
   *  change regardless of the parent's bailout. */
  documentsByEntity?: ReadonlyMap<string, readonly ProjectDocument[]>;
};

// --- Color palette -------------------------------------------------------

// --- Translation lookups -------------------------------------------------

const TYPE_KEY: Record<ChangeType, TranslationKey> = {
  Scope: "changeTypeScope",
  Schedule: "changeTypeSchedule",
  Cost: "changeTypeCost",
  Quality: "changeTypeQuality",
  Other: "changeTypeOther",
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
  onStatusChange,
  onOpenNotes,
  onCaptureBulk,
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
  onPullCalendar,
  calendarPullBusy,
  onAiEdit,
  aiEditEnabled,
  documentsByEntity,
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

  // ★★ QUERY-INDEPENDENT SEARCH TEXT, built once per data change — NOT per
  // keystroke. `description` is rich HTML now, and descriptionText runs a full
  // DOMPurify parse-and-walk, so computing it inside the filter body cost a
  // sanitizer pass per surviving row on every character typed (it was a raw
  // string read before slice B). Same rule global-search.ts follows: build the
  // haystack memoized on the DATA, then filter it by the query. Lower-cased here
  // so the compare stays a bare `includes`.
  const searchHaystack = useMemo(() => {
    const map = new Map<number, string>();
    for (const c of changes) {
      map.set(c.id, [c.title, descriptionText(c.description), c.requestedBy ?? ""].join(" ").toLowerCase());
    }
    return map;
  }, [changes]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = changes.filter((c) => {
      if (typeFilter !== "All" && c.type !== typeFilter) return false;
      if (statusFilter !== "All" && c.status !== statusFilter) return false;
      if (q && !(searchHaystack.get(c.id) ?? "").includes(q)) return false;
      return true;
    });

    return sort
      ? [...filtered].sort((a, b) => compareChange(a, b, sort.key as ChangeSortKey, sort.dir as "asc" | "desc"))
      : filtered
          .slice()
          .sort((a, b) => compareChange(a, b, "raisedDate", "desc") || a.id - b.id);
  }, [changes, typeFilter, statusFilter, search, sort, searchHaystack]);

  const visibleIds = useMemo(() => visible.map((c) => c.id), [visible]);

  // Bulk-editable fields. ChangeStatus is NOT category-specific (unlike RAID),
  // so Status is safe to bulk-set across any selection.
  const bulkFields = useMemo<BulkField[]>(
    () => [
      selectField(
        "status",
        t(lang, "changeFieldStatus"),
        CHANGE_STATUSES.map((s) => ({ value: s, label: changeStatusLabel(s, lang) })),
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
    const apply = (item: ChangeItem): ChangeItem => {
      let patched: ChangeItem = { ...item };
      // Through applyChangeStatus, exactly like the row select and the modal:
      // setting `status` raw left a bulk-approved row with NO decisionDate (so
      // the Outlook decision-date push skipped it) and a bulk-reopened one with
      // a stale date. The bulk <select> only offers CHANGE_STATUSES values.
      if (patch.status !== undefined) patched = applyChangeStatus(patched, patch.status as ChangeStatus, today);
      if (patch.type !== undefined) patched = { ...patched, type: patch.type as ChangeType };
      if (patch.impact !== undefined)
        patched = { ...patched, impact: patch.impact ? (patch.impact as ChangeImpact) : undefined };
      if (patch.requestedBy !== undefined)
        patched = { ...patched, requestedBy: patch.requestedBy || undefined };
      return patched;
    };
    const rows = Array.from(sel.selectedIds)
      .map((id) => changesById.get(id))
      .filter((item): item is ChangeItem => item !== undefined)
      .map((item) => ({ before: item, after: apply(item) }));

    // `rows` materialises both `before` and `after` above, so the capture payload
    // does not depend on where these two statements sit relative to each other.
    // What IS load-bearing: the write set is DERIVED from the capture.
    // `buildBulkFieldEdits` drops a row whose diff is empty, so bulk-setting a
    // field to the value a row already holds yields no edit — and saving it anyway
    // would stamp a fresh `localModifiedAt` and log a bulk edit with no undo entry
    // behind it (the tasks path had the same split; `use-bulk-operations.ts`).
    // ★ Hoisted out of the optional call deliberately: `onCaptureBulk?.(build())`
    // never evaluates `build()` when no capture prop is wired, which would leave
    // `wrote` empty and write NOTHING at all.
    const edits = buildBulkFieldEdits(rows);
    const wrote = new Set(edits.map((e) => e.id));
    onCaptureBulk?.(edits);
    for (const { after } of rows) {
      if (wrote.has(after.id)) onSave(after, undefined, { suppressFieldUndo: true });
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
      knowledgeLinks: [],
    });
    setIsNew(true);
  }

  function openEdit(item: ChangeItem) {
    setDraft({
      ...item,
      linkedTaskIds: [...item.linkedTaskIds],
      linkedRaidIds: [...item.linkedRaidIds],
      stakeholderIds: [...(item.stakeholderIds ?? [])],
      knowledgeLinks: [...(item.knowledgeLinks ?? [])],
    });
    setIsNew(false);
  }

  // Deep-link: when a suggested-action chip requests opening a change, open its
  // edit modal once and clear the pending signal. Skip id 0 — the aggregate
  // change CTA only navigates to the view.
  const { pendingOpen, clearPendingOpen, requestDocumentsForEntity } = useWorkspaceTab();
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

  /** `item` is the modal's capped draft — save THAT, not our own `draft` state,
   *  which is one render behind and still holds the uncapped rich fields. */
  function commitDraft(item: ChangeItem) {
    if (!draft) return;
    if (!item.title.trim()) return;
    onSave(item, isNew);
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
  const { ref: paneRef, reset: resetPaneSize } = useResizable("aipm-cockpit:change-size");

  const filtersActive =
    search.trim() !== "" || typeFilter !== "All" || statusFilter !== "All";

  const sortArrow = (key: ChangeSortKey) =>
    sort?.key === key ? (sort.dir === "asc" ? " ▲" : " ▼") : "";
  const ariaSort = (key: ChangeSortKey): "ascending" | "descending" | "none" =>
    sort?.key === key ? (sort.dir === "asc" ? "ascending" : "descending") : "none";

  const toolbar = (
    <PaneToolbar>
      <AddButton onClick={openNew}>+ {t(lang, "changesAdd")}</AddButton>
      <PaneSearchInput
        value={search}
        onChange={pf.setSearch}
        ariaLabel={t(lang, "changeFilterSearch")}
        clearLabel={`${t(lang, "clear")} – ${t(lang, "changeFilterSearch")}`}
      />
      <Select
        value={typeFilter}
        onChange={(e) => pf.setFilter("type", e.target.value)}
        aria-label={t(lang, "changeFieldType")}
        size="xs"
        className="h-[30px]"
      >
        <option value="All">{t(lang, "changeFilterTypeAll")}</option>
        {CHANGE_TYPES.map((ty) => (
          <option key={ty} value={ty}>
            {typeLabel(ty, lang)}
          </option>
        ))}
      </Select>
      <Select
        value={statusFilter}
        onChange={(e) => pf.setFilter("status", e.target.value)}
        aria-label={t(lang, "changeFieldStatus")}
        size="xs"
        className="h-[30px]"
      >
        <option value="All">{t(lang, "changeFilterStatusAll")}</option>
        {CHANGE_STATUSES.map((st) => (
          <option key={st} value={st}>
            {changeStatusLabel(st, lang)}
          </option>
        ))}
      </Select>
      <ColumnConfigPopover lang={lang} cols={CHANGE_CONFIG_COLS} hidden={hiddenSet} onToggle={pf.toggleColumn} />
      <PanelViewsControl lang={lang} view="changes" />
      <CalendarSyncControls
        lang={lang}
        entityLabelKey="calendarSyncEntityChange"
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
    </PaneToolbar>
  );

  return (
    <PanelTableScaffold
      paneRef={paneRef}
      containerRef={containerRef}
      view="changes"
      lang={lang}
      showHints={showHints}
      isPopout={isPopout}
      onLearnMore={onLearnMore}
      toolbar={toolbar}
      bulk={{
        count: sel.count,
        open: bulkOpen,
        onToggleOpen: () => setBulkOpen((o) => !o),
        onClear: () => {
          sel.clear();
          setBulkOpen(false);
        },
        fields: bulkFields,
        onApply: applyBulk,
        onCancel: () => setBulkOpen(false),
      }}
      count={changes.length}
      empty={{ text: t(lang, "changeEmpty"), addLabel: `+ ${t(lang, "changesAdd")}…`, onAdd: openNew }}
      trailing={
        draft && (
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
            onApplyStatus={(s) => setDraft((d) => (d ? applyChangeStatus(d, s, today) : d))}
            onSave={commitDraft}
            onCancel={closeModal}
            onDelete={commitDelete}
            onOpenNotes={onOpenNotes}
          />
        )
      }
    >
        <DataTable
          className="min-w-full text-left text-sm"
          tbodyClassName="divide-y divide-line"
          head={<>
            <tr>
              <th className="px-3 py-2" style={{ width: 36, minWidth: 36 }}>
                <Checkbox
                  aria-label={t(lang, "selectAllVisibleRows")}
                  checked={sel.allSelected(visibleIds)}
                  onChange={() => sel.toggleAllVisible(visibleIds)}
                  className="cursor-pointer"
                  />
              </th>
              {!hiddenSet.has("id") && (
              <th className="relative px-3 py-2" style={{ width: colWidths.id, minWidth: colWidths.id }} aria-sort={ariaSort("id")}>
                <button type="button" onClick={() => toggleSort("id")} aria-label={t(lang, "id")} className={`inline-flex items-center gap-1 hover:text-[var(--table-head-accent)] ${INTERACTIVE}`}>
                  #{sortArrow("id")}
                </button>
                <ColumnResizeHandle col="id" onMouseDown={startResize} />
              </th>
              )}
              {!hiddenSet.has("type") && (
              <th className="relative px-3 py-2" style={{ width: colWidths.type, minWidth: colWidths.type }} aria-sort={ariaSort("type")}>
                <button type="button" onClick={() => toggleSort("type")} className={`inline-flex items-center gap-1 hover:text-[var(--table-head-accent)] ${INTERACTIVE}`}>
                  {t(lang, "changeFieldType")}{sortArrow("type")}
                </button>
                <ColumnResizeHandle col="type" onMouseDown={startResize} />
              </th>
              )}
              {!hiddenSet.has("title") && (
              <th className="relative px-3 py-2" style={{ width: colWidths.title, minWidth: colWidths.title }} aria-sort={ariaSort("title")}>
                <button type="button" onClick={() => toggleSort("title")} className={`inline-flex items-center gap-1 hover:text-[var(--table-head-accent)] ${INTERACTIVE}`}>
                  {t(lang, "changeFieldTitle")}{sortArrow("title")}
                </button>
                <ColumnResizeHandle col="title" onMouseDown={startResize} />
              </th>
              )}
              {!hiddenSet.has("impact") && (
              <th className="relative px-3 py-2" style={{ width: colWidths.impact, minWidth: colWidths.impact }} aria-sort={ariaSort("impact")}>
                <button type="button" onClick={() => toggleSort("impact")} className={`inline-flex items-center gap-1 hover:text-[var(--table-head-accent)] ${INTERACTIVE}`}>
                  {t(lang, "changeFieldImpact")}{sortArrow("impact")}
                </button>
                <InfoTooltip text={t(lang, "changeFieldImpactHint")} />
                <ColumnResizeHandle col="impact" onMouseDown={startResize} />
              </th>
              )}
              {!hiddenSet.has("status") && (
              <th className="relative px-3 py-2" style={{ width: colWidths.status, minWidth: colWidths.status }} aria-sort={ariaSort("status")}>
                <button type="button" onClick={() => toggleSort("status")} className={`inline-flex items-center gap-1 hover:text-[var(--table-head-accent)] ${INTERACTIVE}`}>
                  {t(lang, "changeFieldStatus")}{sortArrow("status")}
                </button>
                <ColumnResizeHandle col="status" onMouseDown={startResize} />
              </th>
              )}
              {!hiddenSet.has("requestedBy") && (
              <th className="relative px-3 py-2" style={{ width: colWidths.requestedBy, minWidth: colWidths.requestedBy }} aria-sort={ariaSort("requestedBy")}>
                <button type="button" onClick={() => toggleSort("requestedBy")} className={`inline-flex items-center gap-1 hover:text-[var(--table-head-accent)] ${INTERACTIVE}`}>
                  {t(lang, "changeFieldRequestedBy")}{sortArrow("requestedBy")}
                </button>
                <ColumnResizeHandle col="requestedBy" onMouseDown={startResize} />
              </th>
              )}
              {!hiddenSet.has("raisedDate") && (
              <th className="relative px-3 py-2" style={{ width: colWidths.raisedDate, minWidth: colWidths.raisedDate }} aria-sort={ariaSort("raisedDate")}>
                <button type="button" onClick={() => toggleSort("raisedDate")} className={`inline-flex items-center gap-1 hover:text-[var(--table-head-accent)] ${INTERACTIVE}`}>
                  {t(lang, "changeFieldRaisedDate")}{sortArrow("raisedDate")}
                </button>
                <ColumnResizeHandle col="raisedDate" onMouseDown={startResize} />
              </th>
              )}
              {!hiddenSet.has("notesLog") && (
              <th className="relative px-3 py-2" style={{ width: colWidths.notesLog, minWidth: colWidths.notesLog }}>
                {t(lang, "noteLogTitle")}
                <ColumnResizeHandle col="notesLog" onMouseDown={startResize} />
              </th>
              )}
            </tr>
          </>}
        >
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
                  className={["group cursor-pointer align-top hover:bg-surface-muted", flashOutlineClass(flashId === item.id)]
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
                  {!hiddenSet.has("type") && (
                  <td className="px-3 py-2 text-foreground">
                    {typeLabel(item.type, lang)}
                  </td>
                  )}
                  {!hiddenSet.has("title") && (
                  <td className="px-3 py-2 font-medium text-foreground">
                    <span className="inline-flex items-center gap-1">
                      {item.title}
                      {onAiEdit && aiEditEnabled?.(item) && (
                        <InlineAiEditButton lang={lang} label={item.title} onClick={() => onAiEdit(item)} />
                      )}
                      <DocumentBadge
                        lang={lang}
                        count={documentsByEntity?.get(refKey("change", item.id))?.length ?? 0}
                        entityTitle={item.title}
                        onOpen={() => requestDocumentsForEntity("change", item.id)}
                      />
                    </span>
                  </td>
                  )}
                  {!hiddenSet.has("impact") && (
                  <td className="px-3 py-2">
                    <span className="inline-flex items-center gap-1.5">
                      <RagDot level={rag} />
                      <span>{item.impact ? impactLabel(item.impact, lang) : "—"}</span>
                    </span>
                  </td>
                  )}
                  {/* The row opens the editor on click; without stopPropagation
                      picking a status would ALSO open the modal. */}
                  {!hiddenSet.has("status") && (
                  <td className="px-3 py-2 text-foreground" onClick={(e) => e.stopPropagation()}>
                    <ChangeStatusSelect lang={lang} item={item} onStatusChange={onStatusChange} />
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
                  {/* Cell-level stopPropagation so opening the notes window does
                      not also fire the row click (which opens the edit modal) —
                      same reason the status cell above does it. */}
                  {!hiddenSet.has("notesLog") && (
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
        </DataTable>
    </PanelTableScaffold>
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
