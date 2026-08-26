"use client";
import { Checkbox } from "./form-controls";
import { Badge } from "./badge";

// Stakeholder Register panel — sortable, searchable table of stakeholders.
// Mirrors change-panel.tsx: Add button BEFORE the search, local draft/isNew
// modal state, row-click opens StakeholderEditModal. All mutations go through
// callback props — the parent owns the canonical `stakeholders` array.

import { memo, useEffect, useMemo, useState } from "react";
import { StakeholderEditModal } from "./stakeholder-edit-modal";
import { InlineAiEditButton } from "./inline-ai-edit-button";
import { useWorkspaceTab } from "./workspace-tab-context";
import { useDeepLinkRowFlash, flashOutlineClass } from "./use-deeplink-row-flash";
import { compareStakeholder, nextStakeholderId, type StakeholderSortKey } from "./stakeholders";
import { type Lang, t, type TranslationKey } from "./i18n";
import { PanelFiltersProvider, usePanelFilters } from "./panel-filters-context";
import { useRowTokens } from "./use-row-tokens";
import { PanelViewsControl } from "./panel-views-control";
import { ColumnConfigPopover, type ColumnConfigCol } from "./column-config-popover";
import type { PanelFiltersState } from "./panel-views";
import { DataTable } from "./data-table";
import {
  INFLUENCE_INTEREST_LEVELS,
  STAKEHOLDER_CATEGORIES,
  type InfluenceInterest,
  type Milestone,
  type Resource,
  type Stakeholder,
  type StakeholderCategory,
} from "./types";
import type { EntityPaneHintsProps } from "./workspace-section-types";
import { useColumnResize } from "./use-column-resize";
import { useResizable } from "./use-resizable";
import { ColumnResizeHandle, PrintButton, ResetColWidthsButton, ResetSizeButton } from "./task-manager-ui";
import { SortResizeTh, useSortHeaderProps } from "./report-table";
import { resourceDisplayName } from "./resource-foundation";
import { PaneToolbar, PaneSearchInput, AddButton } from "./pane-toolbar";
import { useRowSelection } from "./use-row-selection";
import { PanelTableScaffold } from "./panel-table-scaffold";
import { selectField, type BulkField } from "./bulk-edit-panel";
import { buildBulkFieldEdits } from "./undo/field-groups";

const STAKEHOLDER_FILTER_DEFAULTS: PanelFiltersState = { search: "", filters: {}, sort: null, hiddenCols: [] };

// --- Column widths ----------------------------------------------------------

const STAKEHOLDER_COL_WIDTHS = {
  name: 160,
  organization: 140,
  title: 130,
  category: 110,
  influence: 100,
  interest: 100,
  resource: 140,
  email: 180,
} as const;
type StakeholderCol = keyof typeof STAKEHOLDER_COL_WIDTHS;

// Toggleable columns (the leading row-select checkbox column is always on).
const STAKEHOLDER_CONFIG_COLS: readonly ColumnConfigCol[] = [
  { key: "name", labelKey: "stakeholderFieldName" },
  { key: "organization", labelKey: "stakeholderFieldOrganization" },
  { key: "title", labelKey: "stakeholderFieldTitle" },
  { key: "category", labelKey: "stakeholderFieldCategory" },
  { key: "influence", labelKey: "stakeholderFieldInfluence" },
  { key: "interest", labelKey: "stakeholderFieldInterest" },
  { key: "resource", labelKey: "stakeholderFieldResource" },
  { key: "email", labelKey: "stakeholderFieldEmail" },
];

// --- Props ------------------------------------------------------------------

export interface StakeholdersPanelProps extends EntityPaneHintsProps {
  lang: Lang;
  stakeholders: readonly Stakeholder[];
  resources: readonly Resource[];
  milestones: readonly Milestone[];
  onSave: (item: Stakeholder, isNew?: boolean, opts?: { suppressFieldUndo?: boolean }) => void;
  onDelete: (id: number, name: string) => void;
  /** Capture the selected rows' field patches for undo before a bulk apply. */
  onCaptureBulk?: (edits: readonly { id: number; before: Partial<Stakeholder>; after: Partial<Stakeholder> }[]) => void;
  /** Stakeholder ids with a pending stakeholder-comms next-action (drives the matrix icon). */
  commsPendingStakeholderIds?: ReadonlySet<number>;
  /** Jump to the Action Center for the given stakeholder. */
  onJumpToComms?: (stakeholderId: number) => void;
  /** Open the inline "Ask Claude" edit popover for a stakeholder (SP2). */
  onAiEdit?: (item: Stakeholder) => void;
  /** Whether the ✨ inline-AI-edit affordance should render for this stakeholder. */
  aiEditEnabled?: (item: Stakeholder) => boolean;
}

// --- Chip helpers -----------------------------------------------------------

const CATEGORY_KEY: Record<StakeholderCategory, TranslationKey> = {
  Internal: "stakeholderCategoryInternal",
  Customer: "stakeholderCategoryCustomer",
  Vendor: "stakeholderCategoryVendor",
  Sponsor: "stakeholderCategorySponsor",
  Regulator: "stakeholderCategoryRegulator",
  Other: "stakeholderCategoryOther",
};

const LEVEL_KEY: Record<InfluenceInterest, TranslationKey> = {
  Low: "levelLow",
  Medium: "levelMedium",
  High: "levelHigh",
};

const LEVEL_CHIP: Record<InfluenceInterest, string> = {
  Low: "bg-surface-muted/40 text-foreground dark:text-ui-light-grey",
  Medium: "bg-ui-purple/20 text-ui-dark-blue dark:bg-ui-purple/25 dark:text-ui-light-grey",
  High: "bg-ui-green/20 text-ui-dark-blue dark:bg-ui-green/25 dark:text-ui-light-grey",
};


// --- Component --------------------------------------------------------------

// Module-scope accessor for useRowTokens: an inline arrow here would be a
// fresh closure every render, defeating the hook's useMemo and tripping
// react-hooks/exhaustive-deps (fatal in this repo).
const nameOfStakeholder = (item: Stakeholder) => item.name;

function StakeholdersPanelBody({
  lang,
  stakeholders,
  resources,
  milestones,
  onSave,
  onDelete,
  onCaptureBulk,
  commsPendingStakeholderIds,
  onJumpToComms,
  showHints,
  isPopout,
  onLearnMore,
  onAiEdit,
  aiEditEnabled,
}: StakeholdersPanelProps) {
  const pf = usePanelFilters();
  const { search, sort } = pf;
  const hiddenSet = new Set(pf.hiddenCols ?? []);

  const toggleSort = (key: StakeholderSortKey) =>
    pf.setSort(
      pf.sort?.key !== key ? { key, dir: "asc" } : pf.sort.dir === "asc" ? { key, dir: "desc" } : null,
    );

  const [draft, setDraft] = useState<Stakeholder | null>(null);
  const [isNew, setIsNew] = useState(false);

  // Multi-row selection + bulk-edit panel (Category / Influence / Interest).
  const sel = useRowSelection();
  const [bulkOpen, setBulkOpen] = useState(false);

  const stakeholderById = useMemo(() => {
    const map = new Map<number, Stakeholder>();
    for (const s of stakeholders) map.set(s.id, s);
    return map;
  }, [stakeholders]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q
      ? stakeholders.filter((s) =>
          [s.name, s.organization ?? "", s.title ?? "", s.email ?? ""]
            .join(" ")
            .toLowerCase()
            .includes(q),
        )
      : stakeholders;

    return sort
      ? [...filtered].sort((a, b) => compareStakeholder(a, b, sort.key as StakeholderSortKey, sort.dir as "asc" | "desc"))
      : filtered.slice().sort((a, b) => compareStakeholder(a, b, "name", "asc"));
  }, [stakeholders, search, sort]);

  const visibleIds = useMemo(() => visible.map((s) => s.id), [visible]);

  // Row-unique accessible names (WCAG 2.4.6) for the checkbox / name button /
  // Ask-Claude button — all three key on a stakeholder's name, so two
  // stakeholders sharing a name would otherwise render identically-named
  // controls. Built over `visible` (filtered + sorted), the SAME array
  // actually rendered below, because an occurrence index only means anything
  // against what is on screen.
  const rowTokens = useRowTokens(visible, nameOfStakeholder);

  // Bulk-editable fields: Category / Influence / Interest (all are simple
  // enums, so a single value applies cleanly across a mixed selection).
  const bulkFields = useMemo<BulkField[]>(
    () => [
      selectField(
        "category",
        t(lang, "stakeholderFieldCategory"),
        STAKEHOLDER_CATEGORIES.map((c) => ({ value: c, label: t(lang, CATEGORY_KEY[c]) })),
      ),
      selectField(
        "influence",
        t(lang, "stakeholderFieldInfluence"),
        INFLUENCE_INTEREST_LEVELS.map((v) => ({ value: v, label: t(lang, LEVEL_KEY[v]) })),
      ),
      selectField(
        "interest",
        t(lang, "stakeholderFieldInterest"),
        INFLUENCE_INTEREST_LEVELS.map((v) => ({ value: v, label: t(lang, LEVEL_KEY[v]) })),
      ),
    ],
    [lang],
  );

  const applyBulk = (changes: Record<string, string>) => {
    const patch = (item: Stakeholder): Stakeholder => {
      let patched: Stakeholder = { ...item };
      if (changes.category !== undefined) patched = { ...patched, category: changes.category as StakeholderCategory };
      if (changes.influence !== undefined) patched = { ...patched, influence: changes.influence as InfluenceInterest };
      if (changes.interest !== undefined) patched = { ...patched, interest: changes.interest as InfluenceInterest };
      return patched;
    };
    const rows = Array.from(sel.selectedIds)
      .map((id) => stakeholderById.get(id))
      .filter((item): item is Stakeholder => item !== undefined)
      .map((item) => ({ before: item, after: patch(item) }));

    // The capture payload does not depend on this statement's position — `rows`
    // snapshots both sides above. The binding that DOES matter is that the write
    // set comes out of the capture: `buildBulkFieldEdits` drops a row whose diff
    // is empty, so a selected row already holding the target value produces no
    // edit, and writing it regardless would stamp a fresh `localModifiedAt` and
    // log a `stakeholder.updated` with nothing on the undo stack behind it.
    // ★ Hoisting the build out of the optional call is load-bearing, not tidiness:
    // `onCaptureBulk?.(build())` skips `build()` entirely when no capture prop is
    // wired, which would empty `wrote` and suppress every save.
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
      id: nextStakeholderId([...stakeholders]),
      name: "",
      category: "Internal",
      influence: "Medium",
      interest: "Medium",
      raci: {},
      knowledgeLinks: [],
    });
    setIsNew(true);
  }

  function openEdit(item: Stakeholder) {
    setDraft({ ...item, raci: { ...item.raci } });
    setIsNew(false);
  }

  // Deep-link: when a suggested-action chip requests opening a stakeholder,
  // open its edit modal once and clear the pending signal.
  const { pendingOpen, clearPendingOpen } = useWorkspaceTab();
  const { flashId, containerRef } = useDeepLinkRowFlash("stakeholders");
  useEffect(() => {
    if (pendingOpen?.view !== "stakeholders") return;
    const item = stakeholders.find((s) => s.id === pendingOpen.id);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-way deep-link
    if (item && draft?.id !== item.id) openEdit(item);
    clearPendingOpen();
    // openEdit is a stable hoisted declaration; depend only on the signal + data.
  }, [pendingOpen, stakeholders, draft, clearPendingOpen]);

  function closeModal() {
    setDraft(null);
    setIsNew(false);
  }

  const { colWidths, startColResize, resetColWidths } = useColumnResize<StakeholderCol>(
    "stakeholder",
    STAKEHOLDER_COL_WIDTHS,
  );
  const startResize = startColResize as (col: string, e: React.MouseEvent) => void;
  // PanelSort.key is a bare `string`, so narrow ONCE here: the explicit generic
  // is what makes a typo in any of the five `sortCol` props a compile error.
  const th = useSortHeaderProps<StakeholderSortKey>(
    (pf.sort?.key ?? null) as StakeholderSortKey | null,
    pf.sort?.dir ?? "off",
    toggleSort,
    startResize,
  );
  const { ref: paneRef, reset: resetPaneSize } = useResizable("aipm-cockpit:stakeholder-size");

  // Build a resource lookup map for display in rows.
  const resourceById = useMemo(() => {
    const map = new Map<number, Resource>();
    for (const r of resources) map.set(r.id, r);
    return map;
  }, [resources]);

  const toolbar = (
    <PaneToolbar>
      <AddButton
        onClick={openNew}
        aria-label={t(lang, "stakeholdersAdd")}
        title={t(lang, "stakeholdersAdd")}
      >
        + {t(lang, "stakeholdersAdd")}
      </AddButton>
      <PaneSearchInput
        value={search}
        onChange={pf.setSearch}
        ariaLabel={t(lang, "stakeholderFieldName")}
        clearLabel={`${t(lang, "clear")} – ${t(lang, "stakeholderFieldName")}`}
      />
      {/* ★ The atom now overlays its own ✕, so the former sibling clear button
          was removed: two clears for one field is exactly what the shared
          ClearableSearchInput exists to avoid, and its bare "Clear" name would
          also collide with the qualified one. */}
      <ColumnConfigPopover lang={lang} cols={STAKEHOLDER_CONFIG_COLS} hidden={hiddenSet} onToggle={pf.toggleColumn} />
      <PanelViewsControl lang={lang} view="stakeholders" />
      <PrintButton lang={lang} />
      <ResetColWidthsButton onClick={resetColWidths} lang={lang} />
      <ResetSizeButton onClick={resetPaneSize} lang={lang} />
    </PaneToolbar>
  );

  return (
    <PanelTableScaffold
      paneRef={paneRef}
      containerRef={containerRef}
      view="stakeholders"
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
      count={stakeholders.length}
      empty={{ text: t(lang, "stakeholdersEmpty"), addLabel: `+ ${t(lang, "stakeholdersAdd")}…`, onAdd: openNew }}
      trailing={
        draft && (
          <StakeholderEditModal
            lang={lang}
            draft={draft}
            isNew={isNew}
            milestones={milestones}
            resources={resources}
            commsPendingStakeholderIds={commsPendingStakeholderIds}
            onJumpToComms={onJumpToComms}
            onChange={setDraft}
            onSave={() => {
              onSave(draft, isNew);
              closeModal();
            }}
            onCancel={closeModal}
            onDelete={() => {
              onDelete(draft.id, draft.name);
              closeModal();
            }}
          />
        )
      }
    >
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
              {!hiddenSet.has("name") && (
                <SortResizeTh {...th} label={t(lang, "stakeholderFieldName")} sortCol="name" width={colWidths.name} />
              )}
              {!hiddenSet.has("organization") && (
                <SortResizeTh {...th} label={t(lang, "stakeholderFieldOrganization")} sortCol="organization" width={colWidths.organization} />
              )}
              {!hiddenSet.has("title") && (
              <th
                className="relative px-3 py-2 font-medium"
                style={{ width: colWidths.title, minWidth: colWidths.title }}
              >
                <span className="inline-flex items-center gap-1">
                  {t(lang, "stakeholderFieldTitle")}
                </span>
                <ColumnResizeHandle col="title" onMouseDown={startResize} />
              </th>
              )}
              {!hiddenSet.has("category") && (
                <SortResizeTh {...th} label={t(lang, "stakeholderFieldCategory")} sortCol="category" width={colWidths.category} />
              )}
              {!hiddenSet.has("influence") && (
                <SortResizeTh {...th} label={t(lang, "stakeholderFieldInfluence")} sortCol="influence" width={colWidths.influence} hint={t(lang, "stakeholderFieldInfluenceHint")} />
              )}
              {!hiddenSet.has("interest") && (
                <SortResizeTh {...th} label={t(lang, "stakeholderFieldInterest")} sortCol="interest" width={colWidths.interest} hint={t(lang, "stakeholderFieldInterestHint")} />
              )}
              {!hiddenSet.has("resource") && (
              <th
                className="relative px-3 py-2 font-medium"
                style={{ width: colWidths.resource, minWidth: colWidths.resource }}
              >
                <span className="inline-flex items-center gap-1">
                  {t(lang, "stakeholderFieldResource")}
                </span>
                <ColumnResizeHandle col="resource" onMouseDown={startResize} />
              </th>
              )}
              {!hiddenSet.has("email") && (
              <th
                className="relative px-3 py-2 font-medium"
                style={{ width: colWidths.email, minWidth: colWidths.email }}
              >
                <span className="inline-flex items-center gap-1">
                  {t(lang, "stakeholderFieldEmail")}
                </span>
                <ColumnResizeHandle col="email" onMouseDown={startResize} />
              </th>
              )}
            </tr>
          </>} tbodyClassName="divide-y divide-line">
            {visible.length === 0 && (
              <tr>
                <td colSpan={1 + STAKEHOLDER_CONFIG_COLS.filter((c) => !hiddenSet.has(c.key)).length} className="p-10 text-center text-sm text-muted-foreground">
                  {t(lang, "stakeholdersNoResults")}
                </td>
              </tr>
            )}
            {visible.map((item) => {
              const linked = item.resourceId != null ? resourceById.get(item.resourceId) : undefined;
              // ★ Cannot miss: buildRowTokens covers every id in `visible`, and
              // `item` is drawn from that same array by this very .map().
              const token = rowTokens.get(item.id) ?? item.name;
              return (
                <tr
                  key={item.id}
                  data-deeplink-row={item.id}
                  className={["group cursor-pointer align-top hover:bg-surface-muted", flashOutlineClass(flashId === item.id)]
                    .filter(Boolean)
                    .join(" ")}
                  onClick={() => openEdit(item)}
                >
                  <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                    <Checkbox
                      aria-label={t(lang, "selectItem", token)}
                      checked={sel.isSelected(item.id)}
                      onChange={() => sel.toggle(item.id)}
                      className="cursor-pointer"
                    />
                  </td>
                  {!hiddenSet.has("name") && (
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); openEdit(item); }}
                        // ★ Without this the accessible name is the CONTENT —
                        // two stakeholders named "Dana" render two identically
                        // named buttons on the row's most prominent control.
                        // Visible text stays item.name; 2.5.3 holds by
                        // containment (the token starts with it), and with no
                        // collision the token IS the bare name, so this
                        // restates the content when unique.
                        aria-label={token}
                        title={item.name}
                        className="rounded-md border border-transparent px-2 py-0.5 text-left font-medium text-foreground hover:border-ui-dark-blue hover:bg-surface-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ui-green"
                      >
                        {item.name}
                      </button>
                      {onAiEdit && aiEditEnabled?.(item) && (
                        <InlineAiEditButton lang={lang} label={token} onClick={() => onAiEdit(item)} />
                      )}
                    </div>
                  </td>
                  )}
                  {!hiddenSet.has("organization") && <td className="px-3 py-2 text-foreground">{item.organization ?? ""}</td>}
                  {!hiddenSet.has("title") && <td className="px-3 py-2 text-foreground">{item.title ?? ""}</td>}
                  {!hiddenSet.has("category") && (
                  <td className="px-3 py-2">
                    <Badge className="font-medium bg-surface-muted text-foreground">
                      {t(lang, CATEGORY_KEY[item.category])}
                    </Badge>
                  </td>
                  )}
                  {!hiddenSet.has("influence") && (
                  <td className="px-3 py-2">
                    <Badge className={`font-medium ${LEVEL_CHIP[item.influence]}`}>
                      {t(lang, LEVEL_KEY[item.influence])}
                    </Badge>
                  </td>
                  )}
                  {!hiddenSet.has("interest") && (
                  <td className="px-3 py-2">
                    <Badge className={`font-medium ${LEVEL_CHIP[item.interest]}`}>
                      {t(lang, LEVEL_KEY[item.interest])}
                    </Badge>
                  </td>
                  )}
                  {!hiddenSet.has("resource") && (
                  <td className="px-3 py-2 text-foreground">
                    {linked ? resourceDisplayName(linked) : ""}
                  </td>
                  )}
                  {!hiddenSet.has("email") && <td className="px-3 py-2 text-xs text-muted-foreground">{item.email ?? ""}</td>}
                </tr>
              );
            })}
        </DataTable>
    </PanelTableScaffold>
  );
}

const StakeholdersPanelMemo = memo(StakeholdersPanelBody);

export function StakeholdersPanel(props: StakeholdersPanelProps) {
  return (
    <PanelFiltersProvider defaults={STAKEHOLDER_FILTER_DEFAULTS}>
      <StakeholdersPanelMemo {...props} />
    </PanelFiltersProvider>
  );
}
