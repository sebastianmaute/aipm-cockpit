"use client";

// Stakeholder Register panel — sortable, searchable table of stakeholders.
// Mirrors change-panel.tsx: Add button BEFORE the search, local draft/isNew
// modal state, row-click opens StakeholderEditModal. All mutations go through
// callback props — the parent owns the canonical `stakeholders` array.

import { memo, useEffect, useMemo, useState } from "react";
import { StakeholderEditModal } from "./stakeholder-edit-modal";
import { useWorkspaceTab } from "./workspace-tab-context";
import { compareStakeholder, nextStakeholderId, type StakeholderSortKey } from "./stakeholders";
import { type Lang, t, type TranslationKey } from "./i18n";
import { TABLE_HEAD_CLASS } from "./table-styles";
import {
  type InfluenceInterest,
  type Milestone,
  type Resource,
  type Stakeholder,
  type StakeholderCategory,
} from "./types";
import { useColumnResize } from "./use-column-resize";
import { useResizable } from "./use-resizable";
import { VIEW_PANE_RESIZABLE_CLASS } from "./view-styles";
import { ColumnResizeHandle, ResetColWidthsButton, ResetSizeButton } from "./task-manager-ui";
import { InfoTooltip } from "./info-tooltip";
import { resourceDisplayName } from "./resource-foundation";

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

// --- Props ------------------------------------------------------------------

export interface StakeholdersPanelProps {
  lang: Lang;
  stakeholders: readonly Stakeholder[];
  resources: readonly Resource[];
  milestones: readonly Milestone[];
  onSave: (item: Stakeholder) => void;
  onDelete: (id: number, name: string) => void;
  /** Stakeholder ids with a pending stakeholder-comms next-action (drives the matrix icon). */
  commsPendingStakeholderIds?: ReadonlySet<number>;
  /** Jump to the Action Center for the given stakeholder. */
  onJumpToComms?: (stakeholderId: number) => void;
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
  Low: "bg-surface-muted/40 text-foreground dark:text-AIPM-light-grey",
  Medium: "bg-AIPM-purple/20 text-AIPM-dark-blue dark:bg-AIPM-purple/25 dark:text-AIPM-light-grey",
  High: "bg-AIPM-green/20 text-AIPM-dark-blue dark:bg-AIPM-green/25 dark:text-AIPM-light-grey",
};

function Chip({ label, className }: { label: string; className?: string }) {
  return (
    <span
      className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${className ?? "bg-surface-muted text-foreground"}`}
    >
      {label}
    </span>
  );
}

// --- Component --------------------------------------------------------------

function StakeholdersPanelInner({
  lang,
  stakeholders,
  resources,
  milestones,
  onSave,
  onDelete,
  commsPendingStakeholderIds,
  onJumpToComms,
}: StakeholdersPanelProps) {
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<{ key: StakeholderSortKey; dir: "asc" | "desc" } | null>(null);

  const toggleSort = (key: StakeholderSortKey) =>
    setSort((s) =>
      s?.key !== key ? { key, dir: "asc" } : s.dir === "asc" ? { key, dir: "desc" } : null,
    );

  const [draft, setDraft] = useState<Stakeholder | null>(null);
  const [isNew, setIsNew] = useState(false);

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
      ? [...filtered].sort((a, b) => compareStakeholder(a, b, sort.key, sort.dir))
      : filtered.slice().sort((a, b) => compareStakeholder(a, b, "name", "asc"));
  }, [stakeholders, search, sort]);

  function openNew() {
    setDraft({
      id: nextStakeholderId([...stakeholders]),
      name: "",
      category: "Internal",
      influence: "Medium",
      interest: "Medium",
      raci: {},
      documentLinks: [],
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
  const { ref: paneRef, reset: resetPaneSize } = useResizable("lop-app:stakeholder-size");

  const sortArrow = (key: StakeholderSortKey) =>
    sort?.key === key ? (sort.dir === "asc" ? " ▲" : " ▼") : "";
  const ariaSort = (key: StakeholderSortKey): "ascending" | "descending" | "none" =>
    sort?.key === key ? (sort.dir === "asc" ? "ascending" : "descending") : "none";

  // Build a resource lookup map for display in rows.
  const resourceById = useMemo(() => {
    const map = new Map<number, Resource>();
    for (const r of resources) map.set(r.id, r);
    return map;
  }, [resources]);

  const toolbar = (
    <div className="mb-2 flex shrink-0 flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={openNew}
        aria-label={t(lang, "stakeholdersAdd")}
        title={t(lang, "stakeholdersAdd")}
        className="rounded-md border border-AIPM-dark-blue bg-AIPM-dark-blue px-2.5 py-1.5 text-xs font-medium text-white hover:bg-AIPM-dark-blue/90"
      >
        + {t(lang, "stakeholdersAdd")}
      </button>
      <input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder={t(lang, "stakeholderFieldName")}
        aria-label={t(lang, "stakeholderFieldName")}
        className="min-w-[12rem] flex-1 rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs text-foreground focus:border-AIPM-dark-blue focus:outline-none focus:ring-1 focus:ring-AIPM-green"
      />
      {search && (
        <button
          type="button"
          onClick={() => setSearch("")}
          aria-label={t(lang, "clear")}
          className="rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-foreground hover:bg-surface-muted"
        >
          ×
        </button>
      )}
      <ResetColWidthsButton onClick={resetColWidths} lang={lang} />
      <ResetSizeButton onClick={resetPaneSize} lang={lang} />
    </div>
  );

  return (
    <div ref={paneRef} className={VIEW_PANE_RESIZABLE_CLASS}>
      {toolbar}

      <div className="min-h-[240px] flex-1 overflow-auto rounded-md border border-line pr-2">
        <table className="min-w-full text-left text-sm">
          <thead className={TABLE_HEAD_CLASS}>
            <tr>
              <th
                className="relative px-3 py-2"
                style={{ width: colWidths.name, minWidth: colWidths.name }}
                aria-sort={ariaSort("name")}
              >
                <button
                  type="button"
                  onClick={() => toggleSort("name")}
                  className="inline-flex items-center gap-1 hover:text-AIPM-green"
                >
                  {t(lang, "stakeholderFieldName")}{sortArrow("name")}
                </button>
                <ColumnResizeHandle col="name" onMouseDown={startResize} />
              </th>
              <th
                className="relative px-3 py-2"
                style={{ width: colWidths.organization, minWidth: colWidths.organization }}
                aria-sort={ariaSort("organization")}
              >
                <button
                  type="button"
                  onClick={() => toggleSort("organization")}
                  className="inline-flex items-center gap-1 hover:text-AIPM-green"
                >
                  {t(lang, "stakeholderFieldOrganization")}{sortArrow("organization")}
                </button>
                <ColumnResizeHandle col="organization" onMouseDown={startResize} />
              </th>
              <th
                className="relative px-3 py-2"
                style={{ width: colWidths.title, minWidth: colWidths.title }}
              >
                <span className="inline-flex items-center gap-1">
                  {t(lang, "stakeholderFieldTitle")}
                </span>
                <ColumnResizeHandle col="title" onMouseDown={startResize} />
              </th>
              <th
                className="relative px-3 py-2"
                style={{ width: colWidths.category, minWidth: colWidths.category }}
                aria-sort={ariaSort("category")}
              >
                <button
                  type="button"
                  onClick={() => toggleSort("category")}
                  className="inline-flex items-center gap-1 hover:text-AIPM-green"
                >
                  {t(lang, "stakeholderFieldCategory")}{sortArrow("category")}
                </button>
                <ColumnResizeHandle col="category" onMouseDown={startResize} />
              </th>
              <th
                className="relative px-3 py-2"
                style={{ width: colWidths.influence, minWidth: colWidths.influence }}
                aria-sort={ariaSort("influence")}
              >
                <button
                  type="button"
                  onClick={() => toggleSort("influence")}
                  className="inline-flex items-center gap-1 hover:text-AIPM-green"
                >
                  {t(lang, "stakeholderFieldInfluence")}{sortArrow("influence")}
                </button>
                <InfoTooltip text={t(lang, "stakeholderFieldInfluenceHint")} />
                <ColumnResizeHandle col="influence" onMouseDown={startResize} />
              </th>
              <th
                className="relative px-3 py-2"
                style={{ width: colWidths.interest, minWidth: colWidths.interest }}
                aria-sort={ariaSort("interest")}
              >
                <button
                  type="button"
                  onClick={() => toggleSort("interest")}
                  className="inline-flex items-center gap-1 hover:text-AIPM-green"
                >
                  {t(lang, "stakeholderFieldInterest")}{sortArrow("interest")}
                </button>
                <InfoTooltip text={t(lang, "stakeholderFieldInterestHint")} />
                <ColumnResizeHandle col="interest" onMouseDown={startResize} />
              </th>
              <th
                className="relative px-3 py-2"
                style={{ width: colWidths.resource, minWidth: colWidths.resource }}
              >
                <span className="inline-flex items-center gap-1">
                  {t(lang, "stakeholderFieldResource")}
                </span>
                <ColumnResizeHandle col="resource" onMouseDown={startResize} />
              </th>
              <th
                className="relative px-3 py-2"
                style={{ width: colWidths.email, minWidth: colWidths.email }}
              >
                <span className="inline-flex items-center gap-1">
                  {t(lang, "stakeholderFieldEmail")}
                </span>
                <ColumnResizeHandle col="email" onMouseDown={startResize} />
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {stakeholders.length === 0 && (
              <tr>
                <td colSpan={8} className="p-10 text-center text-sm text-muted-foreground">
                  {t(lang, "stakeholdersEmpty")}
                </td>
              </tr>
            )}
            {stakeholders.length > 0 && visible.length === 0 && (
              <tr>
                <td colSpan={8} className="p-10 text-center text-sm text-muted-foreground">
                  {t(lang, "stakeholdersNoResults")}
                </td>
              </tr>
            )}
            {visible.map((item) => {
              const linked = item.resourceId != null ? resourceById.get(item.resourceId) : undefined;
              return (
                <tr
                  key={item.id}
                  className="cursor-pointer align-top hover:bg-surface-muted"
                  onClick={() => openEdit(item)}
                >
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); openEdit(item); }}
                      title={item.name}
                      className="rounded-md border border-transparent px-2 py-0.5 text-left font-medium text-foreground hover:border-AIPM-dark-blue hover:bg-surface-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-AIPM-green"
                    >
                      {item.name}
                    </button>
                  </td>
                  <td className="px-3 py-2 text-foreground">{item.organization ?? ""}</td>
                  <td className="px-3 py-2 text-foreground">{item.title ?? ""}</td>
                  <td className="px-3 py-2">
                    <Chip
                      label={t(lang, CATEGORY_KEY[item.category])}
                      className="bg-surface-muted text-foreground"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <Chip
                      label={t(lang, LEVEL_KEY[item.influence])}
                      className={LEVEL_CHIP[item.influence]}
                    />
                  </td>
                  <td className="px-3 py-2">
                    <Chip
                      label={t(lang, LEVEL_KEY[item.interest])}
                      className={LEVEL_CHIP[item.interest]}
                    />
                  </td>
                  <td className="px-3 py-2 text-foreground">
                    {linked ? resourceDisplayName(linked) : ""}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{item.email ?? ""}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {draft && (
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
            onSave(draft);
            closeModal();
          }}
          onCancel={closeModal}
          onDelete={() => {
            onDelete(draft.id, draft.name);
            closeModal();
          }}
        />
      )}
    </div>
  );
}

export const StakeholdersPanel = memo(StakeholdersPanelInner);
