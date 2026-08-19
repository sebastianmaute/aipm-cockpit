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
import { PanelFiltersProvider, usePanelFilters } from "./panel-filters-context";
import type { PanelFiltersState } from "./panel-views";
import { useWorkspaceTab } from "./workspace-tab-context";
import { useDeepLinkRowFlash } from "./use-deeplink-row-flash";
import { descriptionText } from "./rich-text-projection";
import { type Lang, t } from "./i18n";
import { severityLabel } from "./raid-labels";
import {
  buildRaidCausesIndex,
  compareRaid,
  defaultStatusForCategory,
  isTerminalStatus,
  nextRaidId,
  riskSeverityFromMatrix,
  type RaidSortKey,
} from "./raid";
import {
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
import type { ProjectDocument } from "./document-model";
import type { EntityPaneCalendarHintsProps } from "./workspace-section-types";
import { RaidEditModal } from "./raid-edit-modal";
import { useColumnResize } from "./use-column-resize";
import { useResizable } from "./use-resizable";
import { useRowSelection } from "./use-row-selection";
import { buildBulkFieldEdits } from "./undo/field-groups";
import { PanelTableScaffold } from "./panel-table-scaffold";
import { selectField, dateField, type BulkField } from "./bulk-edit-panel";
import { resourceDisplayName, effectivePersonName } from "./resource-foundation";
import { RaidToolbar } from "./raid-panel-toolbar";
import { RaidTable } from "./raid-panel-rows";
import { RAID_COL_WIDTHS, type RaidCol } from "./raid-panel-columns";

const RAID_FILTER_DEFAULTS: PanelFiltersState = {
  search: "",
  filters: { category: "All", severity: "All", status: "All", owner: "" },
  sort: null,
  hiddenCols: [],
};

// --- Props ---------------------------------------------------------------

export type RaidPanelProps = EntityPaneCalendarHintsProps & {
  lang: Lang;
  tasks: readonly Task[];
  raid: readonly RaidItem[];
  /** `refKey("raid", id)` → the documents referencing that item, for the row
   *  badge. Threaded from task-manager, NOT read from `useWorkspace()` here:
   *  this panel is `memo`'d and a context consumer re-renders on ANY context
   *  change regardless of the parent's bailout. */
  documentsByEntity?: ReadonlyMap<string, readonly ProjectDocument[]>;
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
  onSave: (item: RaidItem, isNew?: boolean, opts?: { suppressFieldUndo?: boolean }) => void;
  onDelete: (id: number) => void;
  /** Capture the selected rows' field patches for undo before a bulk apply. */
  onCaptureBulk?: (edits: readonly { id: number; before: Partial<RaidItem>; after: Partial<RaidItem> }[]) => void;
  /** Spawns a Task pre-filled from the item; returns its new id so the
   *  modal can add it to `linkedTaskIds` immediately. In a read-only (popout)
   *  context the guard returns undefined; callers must treat undefined as null. */
  onCreateMitigationTask: (raidItemId: number) => number | null | undefined;
  /** Open the task edit modal for the given task id (used by linked-task
   *  chip clicks). */
  onJumpToTask: (taskId: number) => void;
  /** Open the floating notes window (running note log) for a RAID item.
   *  Threaded to both the row badge and the edit modal's Notes button. */
  onOpenNotes: (id: number) => void;
  /** Inline "Ask Claude" per-row edit (SP2). Absent when AI is off/popout. */
  onAiEdit?: (item: RaidItem) => void;
  /** Gate the per-row ✨ button (e.g. AI enabled && not Jira-synced). */
  aiEditEnabled?: (item: RaidItem) => boolean;
  /** Send a status-inquiry email to an item's owner. Absent in popouts (the
   *  row + modal buttons hide when undefined). */
  onSendInquiry?: (item: RaidItem) => void;
};

// --- Color palette -------------------------------------------------------

const severityRank: Record<RaidSeverity, number> = {
  Critical: 0,
  High: 1,
  Medium: 2,
  Low: 3,
};

// --- Component -----------------------------------------------------------

function RaidPanelBody({
  lang,
  tasks,
  raid,
  documentsByEntity,
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
  onCaptureBulk,
  onCreateMitigationTask,
  onJumpToTask,
  onOpenNotes,
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
  onSendInquiry,
}: RaidPanelProps) {
  const pf = usePanelFilters();
  const { search, sort } = pf;
  const hiddenSet = new Set(pf.hiddenCols ?? []);
  const categoryFilter = pf.filters.category;
  const severityFilter = pf.filters.severity;
  const statusFilter = pf.filters.status;
  // Hoisted to a scalar local — exhaustive-deps rejects `pf.filters.owner` in a
  // useMemo dep array.
  const ownerFilter = pf.filters.owner ?? "";
  const toggleSort = (key: RaidSortKey) =>
    pf.setSort(
      pf.sort?.key !== key ? { key, dir: "asc" } : pf.sort.dir === "asc" ? { key, dir: "desc" } : null,
    );

  // Modal: null = closed, otherwise we're editing a draft (which may or may
  // not already exist in `raid`). `isNew` distinguishes — needed because
  // "Create mitigation task" can only run on saved items.
  const [draft, setDraft] = useState<RaidItem | null>(null);
  const [isNew, setIsNew] = useState(false);

  // Multi-row selection + bulk-edit panel (Severity / Owner / Target date).
  const sel = useRowSelection();
  const [bulkOpen, setBulkOpen] = useState(false);

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

  // Live directory lookup for the owner column: a linked resource's CURRENT
  // name wins over the cached `owner` string (which goes stale on rename).
  const resourcesById = useMemo(() => {
    const map = new Map<number, Resource>();
    for (const r of resources) map.set(r.id, r);
    return map;
  }, [resources]);

  // Parent → children index; used to (a) paint a "→ N" cause-count chip on
  // rows that are themselves causes and (b) list children inside an item's
  // edit modal.
  const causesIndex = useMemo(() => buildRaidCausesIndex(raid), [raid]);

  // ★★ QUERY-INDEPENDENT SEARCH TEXT, built once per data change — NOT per
  // keystroke. `description` and `mitigation` are rich HTML now, and
  // descriptionText runs a full DOMPurify parse-and-walk, so computing them
  // inside the filter body cost TWO sanitizer passes per surviving row on every
  // character typed (they were raw string reads before slice B). Same rule
  // global-search.ts follows: build the haystack memoized on the DATA, then
  // filter it by the query. Lower-cased here so the compare stays a bare
  // `includes`.
  const searchHaystack = useMemo(() => {
    const map = new Map<number, string>();
    for (const r of raid) {
      map.set(
        r.id,
        [
          r.title,
          descriptionText(r.description),
          descriptionText(r.mitigation),
          // Resolve the linked owner's live name so search matches the current
          // name, not the stale cached `owner` string.
          effectivePersonName(r.owner ?? "", r.ownerResourceId, resourcesById),
          r.ownerEmail ?? "",
        ]
          .join(" ")
          .toLowerCase(),
      );
    }
    return map;
  }, [raid, resourcesById]);

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
      if (
        ownerFilter &&
        effectivePersonName(r.owner ?? "", r.ownerResourceId, resourcesById) !== ownerFilter
      )
        return false;
      if (q && !(searchHaystack.get(r.id) ?? "").includes(q)) return false;
      return true;
    });

    const ordered = sort
      ? [...filtered].sort((a, b) => compareRaid(a, b, sort.key as RaidSortKey, sort.dir as "asc" | "desc", resourcesById))
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
  }, [raid, filterTaskId, categoryFilter, severityFilter, statusFilter, ownerFilter, search, sort, resourcesById, searchHaystack]);

  const visibleIds = useMemo(() => visible.map((r) => r.id), [visible]);

  // Distinct owners present (by LIVE name), for the toolbar owner filter.
  const ownerOptions = useMemo(() => {
    const set = new Set<string>();
    for (const r of raid) {
      const name = effectivePersonName(r.owner ?? "", r.ownerResourceId, resourcesById).trim();
      if (name) set.add(name);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [raid, resourcesById]);

  // Bulk-editable fields. Status is intentionally omitted: RAID status is
  // category-specific (sanitizeRaidItem silently defaults a mismatch), so a
  // single status across a mixed-category selection would surprise.
  const bulkFields = useMemo<BulkField[]>(() => {
    const fields: BulkField[] = [
      selectField(
        "severity",
        t(lang, "raidSeverity"),
        RAID_SEVERITIES.map((s) => ({ value: s, label: severityLabel(s, lang) })),
      ),
    ];
    if (resources.length > 0) {
      fields.push(
        selectField("owner", t(lang, "raidOwner"), [
          ...resources.map((r) => ({ value: String(r.id), label: resourceDisplayName(r) })),
          { value: "", label: "—" },
        ]),
      );
    }
    fields.push(dateField("targetDate", t(lang, "raidTargetDate")));
    return fields;
  }, [lang, resources]);

  const applyBulk = (changes: Record<string, string>) => {
    const patch = (item: RaidItem): RaidItem => {
      let patched: RaidItem = { ...item };
      if (changes.severity !== undefined) patched = { ...patched, severity: changes.severity as RaidSeverity };
      if (changes.targetDate !== undefined) patched = { ...patched, targetDate: changes.targetDate || undefined };
      if (changes.owner !== undefined) {
        const r = changes.owner ? resources.find((x) => String(x.id) === changes.owner) : undefined;
        patched = { ...patched, owner: r ? resourceDisplayName(r) : "", ownerEmail: r?.email, ownerResourceId: r ? r.id : null };
      }
      return patched;
    };
    const rows = Array.from(sel.selectedIds)
      .map((id) => raidById.get(id))
      .filter((item): item is RaidItem => item !== undefined)
      .map((item) => ({ before: item, after: patch(item) }));

    // Ordering between these two statements is NOT what matters — `rows` already
    // holds both sides, so the capture payload is the same either way. The write
    // set DERIVING from the capture is what matters: `buildBulkFieldEdits` drops a
    // row whose diff is empty, and saving such a row anyway stamps a fresh
    // `localModifiedAt` and logs a `raid.updated` that no undo entry can reverse.
    // ★ `buildBulkFieldEdits(rows)` is hoisted out of the optional call on purpose:
    // `onCaptureBulk?.(build())` would not evaluate `build()` at all when no
    // capture prop is wired, leaving `wrote` empty and writing nothing.
    const edits = buildBulkFieldEdits(rows);
    const wrote = new Set(edits.map((e) => e.id));
    onCaptureBulk?.(edits);
    for (const { after } of rows) {
      if (wrote.has(after.id)) onSave(after, undefined, { suppressFieldUndo: true });
    }
    setBulkOpen(false);
    sel.clear();
  };

  const effectiveCategory: RaidCategory =
    categoryFilter === "All" ? "R" : (categoryFilter as RaidCategory);

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
      knowledgeLinks: [],
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
  const { pendingOpen, clearPendingOpen, requestDocumentsForEntity } = useWorkspaceTab();
  const { flashId, containerRef } = useDeepLinkRowFlash("raid");
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

  /** `item` is the modal's capped draft — save THAT, not our own `draft` state,
   *  which is one render behind and still holds the uncapped rich fields. */
  function commitDraft(item: RaidItem) {
    if (!draft) return;
    if (!item.title.trim()) return;
    onSave(item, isNew);
    closeModal();
  }

  function commitDelete() {
    if (!draft) return;
    if (!isNew) onDelete(draft.id);
    closeModal();
  }

  function commitCreateMitigationTask() {
    if (!draft || isNew) return;
    onSave(draft, false); // guarded above: only ever an existing item
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
  const { ref: raidRef, reset: resetRaidSize } = useResizable("aipm-cockpit:raid-size");

  const filtersActive =
    search.trim() !== "" ||
    categoryFilter !== "All" ||
    severityFilter !== "All" ||
    statusFilter !== "All" ||
    ownerFilter !== "" ||
    filterTaskId !== null;


  return (
    <PanelTableScaffold
      paneRef={raidRef}
      containerRef={containerRef}
      view="raid"
      lang={lang}
      showHints={showHints}
      isPopout={isPopout}
      onLearnMore={onLearnMore}
      bulkPrintHidden={false}
      toolbar={
        <RaidToolbar
          lang={lang}
          search={search}
          onSearchChange={pf.setSearch}
          categoryFilter={categoryFilter}
          severityFilter={severityFilter}
          statusFilter={statusFilter}
          ownerFilter={ownerFilter}
          owners={ownerOptions}
          onSetFilter={pf.setFilter}
          onResetFilters={pf.resetFilters}
          onToggleColumn={pf.toggleColumn}
          hiddenSet={hiddenSet}
          filterTaskId={filterTaskId}
          onClearTaskFilter={onClearTaskFilter}
          filtersActive={filtersActive}
          onAddNew={() => openNew()}
          onResetColWidths={resetColWidths}
          onResetSize={resetRaidSize}
          m365Configured={m365Configured}
          isPopout={isPopout}
          calendarEnabled={calendarEnabled}
          onToggleCalendar={onToggleCalendar}
          onPushCalendar={onPushCalendar}
          calendarPushBusy={calendarPushBusy}
          onPullCalendar={onPullCalendar}
          calendarPullBusy={calendarPullBusy}
        />
      }
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
      count={raid.length}
      empty={{
        text: t(lang, "raidEmpty"),
        addLabel: `${t(lang, "raidAddItem")}…`,
        onAdd: () => openNew(effectiveCategory),
        ariaLabel: t(lang, "raidAddItem"),
      }}
      trailing={
        draft && (
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
            onApplyMatrix={(p, i) => setDraft((d) => (d ? applyMatrix(d, p, i) : d))}
            onSave={commitDraft}
            onCancel={closeModal}
            onDelete={commitDelete}
            onCreateMitigationTask={commitCreateMitigationTask}
            onJumpToRaid={(id) => {
              const target = raidById.get(id);
              if (target) openEdit(target);
            }}
            onSendInquiry={onSendInquiry}
            onOpenNotes={onOpenNotes}
          />
        )
      }
    >
        <RaidTable
          lang={lang}
          hiddenSet={hiddenSet}
          sel={sel}
          visibleIds={visibleIds}
          sort={sort}
          toggleSort={toggleSort}
          colWidths={colWidths}
          startResize={startResize}
          visible={visible}
          resourcesById={resourcesById}
          tasksById={tasksById}
          raidById={raidById}
          causesIndex={causesIndex}
          openEdit={openEdit}
          documentsByEntity={documentsByEntity}
          onOpenDocuments={requestDocumentsForEntity}
          onJumpToTask={onJumpToTask}
          onOpenNotes={onOpenNotes}
          effectiveCategory={effectiveCategory}
          openNew={openNew}
          flashId={flashId}
          onAiEdit={onAiEdit}
          aiEditEnabled={aiEditEnabled}
          onSendInquiry={onSendInquiry}
        />
    </PanelTableScaffold>
  );
}

// memo-wrap so the panel skips re-render when the parent re-renders for
// unrelated reasons (search keystrokes, column drag, etc.). Memoization
// relies on the handler props being stable refs — TaskManager wraps them in
// useCallback for that reason.
const RaidPanelMemo = memo(RaidPanelBody);

export function RaidPanel(props: RaidPanelProps) {
  return (
    <PanelFiltersProvider defaults={RAID_FILTER_DEFAULTS}>
      <RaidPanelMemo {...props} />
    </PanelFiltersProvider>
  );
}
