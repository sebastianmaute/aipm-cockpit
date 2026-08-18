"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownTrayIcon, ArrowUpTrayIcon } from "@heroicons/react/24/outline";
import {
  SortResizeTh,
  useSortableFilter,
  type SortDir,
} from "./report-table";
import { PanelFiltersProvider, usePanelFilters } from "./panel-filters-context";
import { PanelViewsControl } from "./panel-views-control";
import { ColumnConfigPopover } from "./column-config-popover";
import type { PanelFiltersState } from "./panel-views";

const MILESTONE_FILTER_DEFAULTS: PanelFiltersState = {
  search: "",
  filters: { status: "all" },
  sort: { key: "date", dir: "asc" },
  hiddenCols: [],
};
import { MilestoneEditModal } from "./milestone-edit-modal";
import { DocumentBadge } from "./document-badge";
import { refKey } from "./document-ref";
import type { ProjectDocument } from "./document-model";
import { useWorkspace } from "./workspace-context";
import { useWorkspaceTab } from "./workspace-tab-context";
import { useDeepLinkRowFlash, flashOutlineClass } from "./use-deeplink-row-flash";
import {
  filterMilestones,
  milestoneStatus,
  type MilestoneFilterStatus,
  type MilestoneStatus,
} from "./milestones";
import { type Lang, t } from "./i18n";
import { mintId } from "./id-mint-session";
import { resolveEntitySave } from "./entity-id-mint";
import { reportSilentFailure } from "./guard-feedback";
import { useToastContext } from "./toast-context";
import { useColumnResize } from "./use-column-resize";
import { ColumnResizeHandle, ResetSizeButton, ResetColWidthsButton, PrintButton } from "./task-manager-ui";
import { useResizable } from "./use-resizable";
import { VIEW_PANE_RESIZABLE_CLASS, INNER_TABLE_CLASS } from "./view-styles";
import { ViewCallout } from "./view-callout";
import { DataTable } from "./data-table";
import { Button } from "./button";
import { ToggleButton } from "./toggle-button";
import { INTERACTIVE } from "./interaction-styles";
import { Checkbox, Select } from "./form-controls";
import { AddButton, PaneSearchInput } from "./pane-toolbar";
import { AddFirstItemButton } from "./add-first-item-button";
import { useRowSelection } from "./use-row-selection";
import { BulkEditBar } from "./bulk-edit-bar";
import { BulkEditPanel, dateField, type BulkField } from "./bulk-edit-panel";
import { InlineAiEditButton } from "./inline-ai-edit-button";
import { diffFields, type ActivityKind, type FieldChange } from "./activity-log";
import type { Milestone } from "./types";
import { captureFieldChanges } from "./undo/capture-field-changes";
import { MILESTONE_UNDO_GROUPS, buildBulkFieldEdits } from "./undo/field-groups";

const MILESTONE_COL_WIDTHS = { name: 220, date: 130, status: 140, achieved: 130 } as const;
type MilestoneCol = keyof typeof MILESTONE_COL_WIDTHS;

const MILESTONE_CONFIG_COLS = [
  { key: "name", labelKey: "milestonesColName" },
  { key: "date", labelKey: "milestonesColDate" },
  { key: "status", labelKey: "milestonesColStatus" },
  { key: "achieved", labelKey: "milestonesColAchieved" },
] as const;

const STATUS_KEY: Record<
  MilestoneStatus,
  | "milestoneStatusAchieved"
  | "milestoneStatusOverdue"
  | "milestoneStatusAtRisk"
  | "milestoneStatusDueSoon"
  | "milestoneStatusOnTrack"
> = {
  achieved: "milestoneStatusAchieved",
  overdue: "milestoneStatusOverdue",
  "at-risk": "milestoneStatusAtRisk",
  "due-soon": "milestoneStatusDueSoon",
  "on-track": "milestoneStatusOnTrack",
};

type MilestonesPanelProps = {
  lang: Lang;
  today: string;
  holidaySet: ReadonlySet<string>;
  logActivity?: (kind: ActivityKind, ...args: (string | number)[]) => void;
  logActivityChanges?: (
    kind: ActivityKind,
    changes: readonly FieldChange[],
    ...args: (string | number)[]
  ) => void;
  /** Capture a pre-op snapshot for undo (delete). */
  capture?: import("./undo/use-undo-stack").UndoStackApi["capture"];
  /** Capture a per-field undo entry for a save-triggered edit. */
  captureFieldEdit?: import("./undo/use-undo-stack").UndoStackApi["captureFieldEdit"];
  /** Capture a bulk field-patch edit for undo (bulk apply) — immune by
   *  construction to a concurrent write on a written-through field
   *  (`outlookEventId`, stamped by the calendar sync) landing on a selected
   *  row between the apply and the undo (open-followups #50). */
  captureFieldRows?: import("./undo/use-undo-stack").UndoStackApi["captureFieldRows"];
  openCreateNonce?: number;
  /** Called after an `openCreateNonce` create-request has been honoured so the
   *  parent can reset the nonce. Without it a stale nonce re-opens the create
   *  modal every time this panel remounts (e.g. navigating in from Gantt). */
  onCreateConsumed?: () => void;
  onPushToOutlook?: () => void;
  calendarPushBusy?: boolean;
  onPullFromOutlook?: () => void;
  calendarPullBusy?: boolean;
  showHints?: boolean;
  isPopout?: boolean;
  onLearnMore?: (conceptId: string) => void;
  /** Inline "Ask Claude" per-row edit: opens the NL edit popover for the item. */
  onAiEdit?: (item: Milestone) => void;
  /** Gate for the per-row ✨ affordance (AI enabled, not popout, etc.). */
  aiEditEnabled?: (item: Milestone) => boolean;
  /** `refKey("milestone", id)` → the documents referencing it, for the row badge.
   *  Threaded from task-manager rather than read from `useWorkspace()` — this
   *  panel is un-memoized so it would work either way, but one mechanism across
   *  all four badge surfaces is easier to keep correct than two. */
  documentsByEntity?: ReadonlyMap<string, readonly ProjectDocument[]>;
};

export function MilestonesPanel(props: MilestonesPanelProps) {
  return (
    <PanelFiltersProvider defaults={MILESTONE_FILTER_DEFAULTS}>
      <MilestonesPanelBody {...props} />
    </PanelFiltersProvider>
  );
}

function MilestonesPanelBody({
  lang,
  capture,
  captureFieldEdit,
  captureFieldRows,
  today,
  holidaySet,
  logActivity,
  logActivityChanges,
  openCreateNonce,
  onCreateConsumed,
  onPushToOutlook,
  calendarPushBusy,
  onPullFromOutlook,
  calendarPullBusy,
  showHints,
  isPopout,
  onLearnMore,
  onAiEdit,
  aiEditEnabled,
  documentsByEntity,
}: MilestonesPanelProps) {
  const { milestones, setMilestones, tasks } = useWorkspace();
  // `-full` suffix: the view changed from a centered half-width pane to full
  // width, so use a fresh key — a stale half-width size persisted under the old
  // key would otherwise override `w-full` and leave a gap on the right.
  const { ref, reset: resetSize } = useResizable("aipm-cockpit:milestones-size-full");
  const [editing, setEditing] = useState<Milestone | null>(null);
  const [isNew, setIsNew] = useState(false);
  const showToast = useToastContext();
  const pf = usePanelFilters();
  const hiddenSet = new Set(pf.hiddenCols ?? []);

  const sort = (pf.sort ?? MILESTONE_FILTER_DEFAULTS.sort) as { key: "name" | "date"; dir: SortDir };
  const setSort = (next: { key: "name" | "date"; dir: SortDir }) =>
    pf.setSort({ key: next.key, dir: next.dir });
  const status = pf.filters.status as MilestoneFilterStatus;

  const getValue = useCallback(
    (m: Milestone, key: "name" | "date") => (key === "name" ? m.name : m.date),
    [],
  );

  const filtered = filterMilestones(milestones, {
    query: pf.search,
    status,
    today,
  });

  const { sorted, click } = useSortableFilter(
    filtered,
    sort,
    setSort,
    "",
    getValue,
  );

  const { colWidths, startColResize, resetColWidths } =
    useColumnResize<MilestoneCol>("milestone", MILESTONE_COL_WIDTHS);
  const startResize = startColResize as (col: string, e: React.MouseEvent) => void;

  const tasksById = new Map(tasks.map((tk) => [tk.id, tk] as const));

  // Multi-row selection + bulk-edit panel (Target date / Achieved date).
  const sel = useRowSelection();
  const [bulkOpen, setBulkOpen] = useState(false);

  const milestoneById = useMemo(() => {
    const map = new Map<number, Milestone>();
    for (const ms of milestones) map.set(ms.id, ms);
    return map;
  }, [milestones]);

  const visibleIds = useMemo(() => sorted.map((m) => m.id), [sorted]);

  // Bulk-editable fields. Milestones have no status/owner; the two date fields
  // mirror the edit modal (target date + sign-off / achieved date).
  const bulkFields = useMemo<BulkField[]>(
    () => [
      dateField("date", t(lang, "milestoneDate")),
      dateField("achievedDate", t(lang, "achievedDate")),
    ],
    [lang],
  );

  const applyBulk = (changes: Record<string, string>) => {
    const patch = (item: Milestone): Milestone => {
      const patched: Milestone = { ...item };
      // `date` is required — only overwrite when the user supplied a value.
      if (changes.date !== undefined && changes.date) patched.date = changes.date;
      if (changes.achievedDate !== undefined) patched.achievedDate = changes.achievedDate || undefined;
      return patched;
    };
    const rows = Array.from(sel.selectedIds)
      .map((id) => milestoneById.get(id))
      .filter((item): item is Milestone => item !== undefined)
      .map((item) => ({ before: item, after: patch(item) }));

    // Capture BEFORE the saves — a capture built from the post-save rows would
    // record the already-patched value as `before`, making the undo a no-op.
    const edits = buildBulkFieldEdits(rows);
    if (edits.length) captureFieldRows?.({ setter: setMilestones, kind: "bulk.edit", edits, entityKey: "milestone" });
    for (const { after } of rows) save(after, undefined, { suppressFieldUndo: true });
    setBulkOpen(false);
    sel.clear();
  };

  function openNew() {
    setIsNew(true);
    setEditing({ id: mintId("milestone", milestones), name: "", date: today, linkedTaskIds: [], knowledgeLinks: [] });
  }

  // One-way signal from the parent (Gantt "Add milestone"): when the nonce
  // changes to a positive value, open the create modal. The ref seeds from
  // `undefined` (NOT the live prop) so a positive nonce that is already set when
  // this panel first mounts — the Gantt→Milestones case, where the click both
  // bumps the nonce and switches the tab, remounting us — still opens the modal.
  // After honouring it we tell the parent to reset the nonce (onCreateConsumed)
  // so a stale value does not re-open the modal on a later normal navigation.
  const prevNonceRef = useRef<number | undefined>(undefined);
  useEffect(() => {
    const next = openCreateNonce ?? 0;
    if (next !== prevNonceRef.current) {
      prevNonceRef.current = next;
      if (next > 0) {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: a one-way parent signal must open the modal on a nonce transition, not at render time
        openNew();
        onCreateConsumed?.();
      }
    }
    // openNew is a stable hoisted declaration; depend only on the nonce.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openCreateNonce]);

  // Deep-link: when a suggested-action chip requests opening a milestone, open
  // its edit modal once and clear the pending signal.
  const { pendingOpen, clearPendingOpen, requestDocumentsForEntity } = useWorkspaceTab();
  const { flashId, containerRef } = useDeepLinkRowFlash("milestones");
  useEffect(() => {
    if (pendingOpen?.view !== "milestones") return;
    const m = milestones.find((x) => x.id === pendingOpen.id);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-way deep-link
    if (m && editing?.id !== m.id) setEditing(m);
    clearPendingOpen();
  }, [pendingOpen, milestones, editing, setEditing, clearPendingOpen]);

  // isNewIntent carries the modal's create/edit intent so a create can't be
  // misread as an update and clobber a row committed since the modal opened
  // (id-mint race). Bulk edit omits it → id-existence fallback (unchanged).
  function save(next: Milestone, isNewIntent?: boolean, opts?: { suppressFieldUndo?: boolean }) {
    const { create, id } = resolveEntitySave(milestones, next.id, isNewIntent, () => mintId("milestone", milestones));
    const finalItem: Milestone = { ...next, id };
    const previous = create ? undefined : milestones.find((m) => m.id === id);
    // Editing a row a concurrent writer already deleted: the map-replace below
    // would silently no-op. Surface it instead of dropping the edit in silence.
    if (!create && !previous) {
      reportSilentFailure(showToast, lang, "milestone.editVanished", "concurrent delete during edit", "guardEditVanished");
      setEditing(null);
      return;
    }
    setMilestones((prev) =>
      create ? [...prev, finalItem] : prev.map((m) => (m.id === id ? finalItem : m)),
    );
    if (!create && previous && !opts?.suppressFieldUndo) {
      captureFieldChanges(captureFieldEdit, {
        setter: setMilestones, kind: "milestone.updated", id,
        prev: previous, next: finalItem, groups: MILESTONE_UNDO_GROUPS,
        name: finalItem.name,
      });
    }
    if (create) {
      logActivity?.("milestone.created", id, finalItem.name);
    } else if (previous && logActivityChanges) {
      logActivityChanges("milestone.updated", diffFields(previous, finalItem), id);
    } else {
      logActivity?.("milestone.updated", id);
    }
    setEditing(null);
  }

  function del(id: number) {
    const doomed = milestones.find((m) => m.id === id);
    if (doomed) capture?.({ setter: setMilestones, kind: "milestone.deleted", removed: [doomed], fromArray: milestones, name: doomed.name });
    setMilestones((prev) => prev.filter((m) => m.id !== id));
    logActivity?.("milestone.deleted", id);
    setEditing(null);
  }

  function toggleAchieved(m: Milestone) {
    setMilestones((prev) =>
      prev.map((x) =>
        x.id === m.id
          ? { ...x, achievedDate: x.achievedDate ? undefined : today }
          : x,
      ),
    );
  }

  return (
    <div ref={ref} className={`print-root print-landscape ${VIEW_PANE_RESIZABLE_CLASS}`}>
      {onLearnMore && (
        <ViewCallout view="milestones" lang={lang} showHints={showHints !== false} isPopout={!!isPopout} onLearnMore={onLearnMore} />
      )}
      <header className="mb-2 flex shrink-0 flex-wrap items-center gap-2 print:hidden">
        <AddButton onClick={openNew}>
          + {t(lang, "milestoneNew")}
        </AddButton>
        {onPushToOutlook ? (
          <Button
            variant="secondary"
            size="xs"
            onClick={onPushToOutlook}
            disabled={calendarPushBusy}
            aria-label={t(lang, calendarPushBusy ? "calendarPushing" : "calendarPush")}
            title={t(lang, calendarPushBusy ? "calendarPushing" : "calendarPush")}
            className="inline-flex items-center gap-1"
          >
            <ArrowUpTrayIcon aria-hidden="true" className="h-3.5 w-3.5" />
            {calendarPushBusy ? t(lang, "calendarPushing") : t(lang, "calendarPushShort")}
          </Button>
        ) : null}
        {onPullFromOutlook ? (
          <Button
            variant="secondary"
            size="xs"
            onClick={onPullFromOutlook}
            disabled={calendarPullBusy}
            aria-label={t(lang, calendarPullBusy ? "calendarPulling" : "calendarPull")}
            title={t(lang, calendarPullBusy ? "calendarPulling" : "calendarPull")}
            className="inline-flex items-center gap-1"
          >
            <ArrowDownTrayIcon aria-hidden="true" className="h-3.5 w-3.5" />
            {calendarPullBusy ? t(lang, "calendarPulling") : t(lang, "calendarPullShort")}
          </Button>
        ) : null}
        <PaneSearchInput
          value={pf.search}
          onChange={pf.setSearch}
          ariaLabel={t(lang, "milestonesFilterName")}
          clearLabel={`${t(lang, "clear")} – ${t(lang, "milestonesFilterName")}`}
          minW="min-w-[10rem]"
        />
        <Select
          value={status}
          onChange={(e) => pf.setFilter("status", e.target.value)}
          aria-label={t(lang, "milestonesFilterStatus")}
          size="xs"
          className="h-[30px]"
        >
          <option value="all">{t(lang, "milestonesFilterAll")}</option>
          <option value="pending">{t(lang, "milestonesFilterPending")}</option>
          <option value="achieved">{t(lang, "milestonesFilterAchieved")}</option>
          <option value="overdue">{t(lang, "milestonesFilterOverdue")}</option>
        </Select>
        <ColumnConfigPopover lang={lang} cols={MILESTONE_CONFIG_COLS} hidden={hiddenSet} onToggle={pf.toggleColumn} />
        <PanelViewsControl lang={lang} view="milestones" />
        <PrintButton lang={lang} />
        <ResetColWidthsButton onClick={resetColWidths} lang={lang} />
        <ResetSizeButton onClick={resetSize} lang={lang} />
      </header>

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

      <div ref={containerRef} className={milestones.length === 0 ? undefined : INNER_TABLE_CLASS}>
      {milestones.length === 0 ? (
        // Truly empty → clickable dashed box (mirrors the budget "+ add bucket"
        // empty state): descriptive text + "+ New milestone…", the box adds one.
        <AddFirstItemButton
          onAdd={openNew}
          text={t(lang, "milestonesEmpty")}
          addLabel={`+ ${t(lang, "milestoneNew")}…`}
        />
      ) : sorted.length === 0 ? (
        // Filtered to no matches → message inside the bordered scroller (not the add box).
        <p className="p-10 text-center text-sm text-muted-foreground">{t(lang, "milestonesNoMatches")}</p>
      ) : (
        <DataTable
          className="w-full text-sm"
          head={<>
            <tr className="text-left">
              <th className="px-3 py-1" style={{ width: 36, minWidth: 36 }}>
                <Checkbox
                  aria-label={t(lang, "selectAllVisibleRows")}
                  checked={sel.allSelected(visibleIds)}
                  onChange={() => sel.toggleAllVisible(visibleIds)}
                  className="cursor-pointer"
                />
              </th>
              {!hiddenSet.has("name") && (
                <SortResizeTh
                  label={t(lang, "milestonesColName")}
                  sortCol="name"
                  width={colWidths.name}
                  sortKey={sort.key}
                  sortDir={sort.dir}
                  onSort={click}
                  onResize={startResize}
                />
              )}
              {!hiddenSet.has("date") && (
                <SortResizeTh
                  label={t(lang, "milestonesColDate")}
                  sortCol="date"
                  width={colWidths.date}
                  sortKey={sort.key}
                  sortDir={sort.dir}
                  onSort={click}
                  onResize={startResize}
                />
              )}
              {!hiddenSet.has("status") && (
                <th
                  className="relative px-3 py-2 font-medium"
                  style={{ width: colWidths.status, minWidth: colWidths.status }}
                >
                  {t(lang, "milestonesColStatus")}
                  <ColumnResizeHandle col="status" onMouseDown={startResize} />
                </th>
              )}
              {!hiddenSet.has("achieved") && (
                <th
                  className="relative px-3 py-2 font-medium"
                  style={{ width: colWidths.achieved, minWidth: colWidths.achieved }}
                >
                  {t(lang, "milestonesColAchieved")}
                  <ColumnResizeHandle col="achieved" onMouseDown={startResize} />
                </th>
              )}
            </tr>
          </>}
        >
            {sorted.map((m) => {
              const s = milestoneStatus(m, tasksById, today, holidaySet);
              return (
                <tr
                  key={m.id}
                  data-deeplink-row={m.id}
                  className={["group border-t border-line", flashOutlineClass(flashId === m.id)].filter(Boolean).join(" ")}
                >
                  <td className="px-3 py-1" onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      aria-label={t(lang, "selectItem", m.name)}
                      checked={sel.isSelected(m.id)}
                      onChange={() => sel.toggle(m.id)}
                      className="cursor-pointer"
                    />
                  </td>
                  {!hiddenSet.has("name") && (
                    <td className="px-3 py-2" style={{ width: colWidths.name }}>
                      <div className="flex items-center gap-1">
                        <button
                          type="button"
                          title={m.name}
                          className={`rounded-md border border-transparent px-2 py-0.5 text-left font-medium text-foreground hover:border-ui-dark-blue hover:bg-surface-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ui-green ${INTERACTIVE}`}
                          onClick={() => {
                            setIsNew(false);
                            setEditing(m);
                          }}
                        >
                          {m.name}
                        </button>
                        {onAiEdit && aiEditEnabled?.(m) && (
                          <InlineAiEditButton lang={lang} label={m.name} onClick={() => onAiEdit(m)} />
                        )}
                        <DocumentBadge
                          lang={lang}
                          count={documentsByEntity?.get(refKey("milestone", m.id))?.length ?? 0}
                          entityTitle={m.name}
                          onOpen={() => requestDocumentsForEntity("milestone", m.id)}
                        />
                      </div>
                    </td>
                  )}
                  {!hiddenSet.has("date") && <td className="px-3 py-2">{m.date}</td>}
                  {!hiddenSet.has("status") && (
                    <td className="px-3 py-2">
                      {s === "achieved" ? "✓ " : s === "at-risk" ? "⚠ " : ""}
                      {t(lang, STATUS_KEY[s])}
                    </td>
                  )}
                  {!hiddenSet.has("achieved") && (
                    <td className="px-3 py-2">
                      {/* ★ Row-UNIQUE accessible name. N identical "Achieved"
                          labels is a WCAG 2.4.6 failure the axe gate passes
                          whenever the e2e seed renders a single milestone. */}
                      <ToggleButton
                        lang={lang}
                        pressed={!!m.achievedDate}
                        onToggle={() => toggleAchieved(m)}
                        ariaLabel={`${t(lang, "milestoneAchieved")} – ${m.name}`}
                      >
                        {t(lang, "milestoneAchieved")}
                      </ToggleButton>
                    </td>
                  )}
                </tr>
              );
            })}
        </DataTable>
      )}
      </div>
      {editing ? (
        <MilestoneEditModal
          lang={lang}
          milestone={editing}
          isNew={isNew}
          tasks={tasks}
          onSave={(m) => save(m, isNew)}
          onDelete={del}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}
