"use client";

// Address-book table for the Directory tab of the Resources pane.
// Each row shows a resource's contact details and inline discipline/grade
// selects. Clicking the name cell opens the edit modal.

import { memo, useMemo, useState } from "react";
import { type Lang, t } from "./i18n";
import { birthdayMonthDay } from "./birthdays";
import { resourceDisplayName, roleLabel } from "./resource-foundation";
import type { Discipline, Grade, Resource, Role } from "./types";
import { useColumnResize } from "./use-column-resize";
import { useResizable } from "./use-resizable";
import { INNER_TABLE_CLASS, VIEW_PANE_RESIZABLE_CLASS } from "./view-styles";
import { useToastContext } from "./toast-context";
import { useRowSelection } from "./use-row-selection";
import { BulkEditBar } from "./bulk-edit-bar";
import { BulkEditPanel, selectField, textField, type BulkField } from "./bulk-edit-panel";
import { useConfirm } from "./confirm-dialog";
import { ColumnResizeHandle, ResetColWidthsButton, ResetSizeButton, PrintButton } from "./task-manager-ui";
import { TABLE_HEAD_CLASS } from "./table-styles";
import { FOCUS_RING, TRANSITION, INTERACTIVE } from "./interaction-styles";

const DIRECTORY_COL_WIDTHS = {
  name: 180,
  role: 200,
  title: 160,
  department: 140,
  phone: 120,
  email: 180,
  birthday: 90,
} as const;
type DirectoryCol = keyof typeof DIRECTORY_COL_WIDTHS;

interface Props {
  lang: Lang;
  resources: readonly Resource[];
  roles: readonly Role[];
  disciplines: readonly Discipline[];
  grades: readonly Grade[];
  onAssignRoleById: (resourceId: number, roleId: number | null) => void;
  onEditResource: (resource: Resource) => void;
  onAddResource: () => void;
  onAddAbsence: () => void;
  onImportOutlook?: () => void;
  /** Bulk-apply a patch to selected resources (omitted → no bulk UI). */
  onBulkEditResources?: (ids: readonly number[], patch: Partial<Resource>) => void;
  /** Bulk-delete selected resources (omitted → no bulk delete). */
  onBulkDeleteResources?: (ids: readonly number[]) => void;
}

// Inline single role picker for a directory row. Lists the existing rate-card
// roles (labelled discipline + grade); new combos are authored in the rate-card
// editor. Assigns resource.roleId directly (or null to clear).
function DirectoryRoleSelect({
  resource,
  roles,
  disciplines,
  grades,
  onAssignRoleById,
}: {
  resource: Resource;
  roles: readonly Role[];
  disciplines: readonly Discipline[];
  grades: readonly Grade[];
  onAssignRoleById: (resourceId: number, roleId: number | null) => void;
}) {
  const sortedRoles = [...roles].sort((a, b) =>
    roleLabel(a, disciplines, grades).localeCompare(roleLabel(b, disciplines, grades)),
  );
  return (
    <td className="px-3 py-2">
      <select
        aria-label={`Role for ${resourceDisplayName(resource)}`}
        value={resource.roleId == null ? "" : String(resource.roleId)}
        // Stop the click bubbling to the row's onClick (opens the edit modal).
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => {
          const v = e.target.value === "" ? null : Number(e.target.value);
          onAssignRoleById(resource.id, v);
        }}
        className={`w-full rounded border border-line bg-surface-muted px-1.5 py-0.5 text-xs ${FOCUS_RING} ${TRANSITION}`}
      >
        <option value="">—</option>
        {sortedRoles.map((r) => (
          <option key={r.id} value={r.id}>{roleLabel(r, disciplines, grades)}</option>
        ))}
      </select>
    </td>
  );
}

type SortKey = "" | "name" | "role" | "title" | "department" | "phone" | "email" | "birthday";

function ResourceDirectoryInner({
  lang,
  resources,
  roles,
  disciplines,
  grades,
  onAssignRoleById,
  onEditResource,
  onAddResource,
  onAddAbsence,
  onImportOutlook,
  onBulkEditResources,
  onBulkDeleteResources,
}: Props) {
  const showToast = useToastContext();
  const confirm = useConfirm();
  const sel = useRowSelection();
  const [bulkOpen, setBulkOpen] = useState(false);
  const bulkEnabled = !!onBulkEditResources;
  const copyEmail = async (addr: string) => {
    try {
      await navigator.clipboard.writeText(addr);
      showToast("info", t(lang, "resourceEmailCopied", addr));
    } catch {
      showToast("error", t(lang, "resourceEmailCopyFailed"));
    }
  };
  const { ref: dirRef, reset: resetDirSize } = useResizable("lop-app:directory-size");
  const { colWidths, startColResize: _startColResize, resetColWidths } = useColumnResize<DirectoryCol>(
    "directory",
    DIRECTORY_COL_WIDTHS,
  );
  const startColResize = _startColResize as (col: string, e: React.MouseEvent) => void;
  const [filter, setFilter] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const rows = useMemo(() => {
    const roleName = (r: Resource): string => {
      const role = roles.find((x) => x.id === r.roleId);
      return role ? roleLabel(role, disciplines, grades) : "";
    };
    const q = filter.trim().toLowerCase();
    const keyOf = (r: Resource): string => {
      switch (sortKey) {
        case "name": return resourceDisplayName(r).toLowerCase();
        case "role": return roleName(r).toLowerCase();
        case "title": return (r.title ?? "").toLowerCase();
        case "department": return (r.department ?? "").toLowerCase();
        case "phone": return (r.businessPhone ?? "").toLowerCase();
        case "email": return (r.email ?? "").toLowerCase();
        case "birthday": return birthdayMonthDay(r.birthday) ?? "";
        default: return "";
      }
    };
    const filtered = q
      ? resources.filter((r) =>
          [resourceDisplayName(r), r.title, r.department, r.businessPhone, r.email, r.company, roleName(r)]
            .some((v) => (v ?? "").toLowerCase().includes(q)))
      : resources.slice();
    if (sortKey !== "") {
      filtered.sort((a, b) => {
        const ka = keyOf(a), kb = keyOf(b);
        // Blanks always sort last, regardless of asc/desc.
        if (ka === "" && kb !== "") return 1;
        if (kb === "" && ka !== "") return -1;
        const cmp = ka.localeCompare(kb);
        return sortDir === "asc" ? cmp : -cmp;
      });
    }
    return filtered;
  }, [resources, roles, disciplines, grades, filter, sortKey, sortDir]);

  const sortIndicator = (key: SortKey) =>
    sortKey === key ? (sortDir === "asc" ? " ▲" : " ▼") : "";

  const visibleIds = rows.map((r) => r.id);
  const roleOptions = [
    { value: "", label: "—" },
    ...[...roles]
      .sort((a, b) => roleLabel(a, disciplines, grades).localeCompare(roleLabel(b, disciplines, grades)))
      .map((r) => ({ value: String(r.id), label: roleLabel(r, disciplines, grades) })),
  ];
  const bulkFields: BulkField[] = [
    selectField("roleId", t(lang, "role"), roleOptions),
    selectField("isExternal", t(lang, "resourceExternal"), [
      { value: "no", label: t(lang, "resourceInternal") },
      { value: "yes", label: t(lang, "resourceExternalBadge") },
    ]),
    selectField("active", t(lang, "resourceActiveLabel"), [
      { value: "active", label: t(lang, "resourceStatusActive") },
      { value: "archived", label: t(lang, "resourceStatusArchived") },
    ]),
    textField("department", t(lang, "resourceColDepartment")),
    textField("title", t(lang, "resourceColTitle")),
    textField("location", t(lang, "resourceLocation")),
    textField("company", t(lang, "resourceCompany")),
  ];

  const applyBulk = (changes: Record<string, string>) => {
    if (!onBulkEditResources) return;
    const patch: Partial<Resource> = {};
    if (changes.roleId !== undefined) patch.roleId = changes.roleId === "" ? null : Number(changes.roleId);
    if (changes.isExternal !== undefined) patch.isExternal = changes.isExternal === "yes";
    if (changes.active !== undefined) patch.active = changes.active !== "archived";
    if (changes.department !== undefined) patch.department = changes.department || undefined;
    if (changes.title !== undefined) patch.title = changes.title || undefined;
    if (changes.location !== undefined) patch.location = changes.location || undefined;
    if (changes.company !== undefined) patch.company = changes.company || undefined;
    onBulkEditResources(Array.from(sel.selectedIds), patch);
    setBulkOpen(false);
    sel.clear();
  };

  const handleBulkDelete = async () => {
    if (!onBulkDeleteResources || sel.count === 0) return;
    if (await confirm({ message: t(lang, "resourceBulkDeleteConfirm", String(sel.count)) })) {
      onBulkDeleteResources(Array.from(sel.selectedIds));
      sel.clear();
      setBulkOpen(false);
    }
  };

  return (
    <div ref={dirRef} className={`print-root print-landscape ${VIEW_PANE_RESIZABLE_CLASS}`}>
      <div className="mb-2 flex shrink-0 items-center gap-2 print:hidden">
        <button
          type="button"
          onClick={() => onAddResource()}
          className={`rounded-md border border-AIPM-dark-blue bg-AIPM-dark-blue px-2.5 py-1.5 text-xs font-medium text-white hover:bg-AIPM-dark-blue/90 ${INTERACTIVE}`}
        >
          {t(lang, "resourcesAddResource")}
        </button>
        <button
          type="button"
          onClick={() => onAddAbsence()}
          className={`rounded-md border border-AIPM-dark-blue bg-AIPM-dark-blue px-2.5 py-1.5 text-xs font-medium text-white hover:bg-AIPM-dark-blue/90 ${INTERACTIVE}`}
        >
          {t(lang, "resourcesAddAbsence")}
        </button>
        <input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={t(lang, "directorySearchPlaceholder")}
          aria-label={t(lang, "directorySearchPlaceholder")}
          title={t(lang, "directorySearchHint")}
          className={`min-w-0 flex-1 rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs text-foreground placeholder:text-muted-foreground focus:border-AIPM-dark-blue focus:outline-none ${FOCUS_RING} ${TRANSITION}`}
        />
        {onImportOutlook && (
          <button
            type="button"
            onClick={onImportOutlook}
            className={`shrink-0 rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs font-medium text-foreground hover:border-AIPM-dark-blue hover:bg-surface-muted ${INTERACTIVE}`}
          >
            {t(lang, "outlookImportButton")}
          </button>
        )}
        <PrintButton lang={lang} />
        <ResetColWidthsButton onClick={resetColWidths} lang={lang} />
        <ResetSizeButton onClick={resetDirSize} lang={lang} />
      </div>
      {bulkEnabled && sel.count > 0 && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 print:hidden">
          <BulkEditBar
            lang={lang}
            count={sel.count}
            open={bulkOpen}
            onToggleOpen={() => setBulkOpen((o) => !o)}
            onClear={() => { sel.clear(); setBulkOpen(false); }}
          />
          {onBulkDeleteResources && (
            <button
              type="button"
              onClick={handleBulkDelete}
              className={`mb-2 rounded-md border border-AIPM-pink/40 bg-surface px-2 py-1 text-xs font-medium text-AIPM-pink-strong hover:bg-AIPM-pink/10 ${INTERACTIVE}`}
            >
              {t(lang, "resourceBulkDelete")}
            </button>
          )}
        </div>
      )}
      {bulkEnabled && sel.count > 0 && bulkOpen && (
        <BulkEditPanel lang={lang} count={sel.count} fields={bulkFields} onApply={applyBulk} onCancel={() => setBulkOpen(false)} />
      )}
      {resources.length === 0 ? (
        <div className="mt-3 flex-1 rounded-md border border-dashed border-line p-6 text-center text-sm text-muted-foreground">
          {t(lang, "resourcesEmpty")}
        </div>
      ) : (
        <div className={INNER_TABLE_CLASS}>
          <table className="w-full text-left text-sm">
            <thead className={TABLE_HEAD_CLASS}>
              <tr>
                {bulkEnabled && (
                  <th className="px-3 py-2" style={{ width: 36, minWidth: 36 }}>
                    <input
                      type="checkbox"
                      aria-label={t(lang, "selectAllVisibleRows")}
                      checked={sel.allSelected(visibleIds)}
                      onChange={() => sel.toggleAllVisible(visibleIds)}
                      className={`h-4 w-4 cursor-pointer rounded border-line text-AIPM-dark-blue ${FOCUS_RING} ${TRANSITION}`}
                    />
                  </th>
                )}
                <th className="relative px-3 py-2 font-medium" style={{ width: colWidths.name, minWidth: colWidths.name }}>
                  <button type="button" onClick={() => toggleSort("name")} aria-label={t(lang, "sortBy", t(lang, "assignee"))} title={t(lang, "sortBy", t(lang, "assignee"))} className={`hover:text-AIPM-green ${INTERACTIVE}`}>
                    {t(lang, "assignee")}{sortIndicator("name")}
                  </button>
                  <ColumnResizeHandle col="name" onMouseDown={startColResize} />
                </th>
                <th className="relative px-3 py-2 font-medium" style={{ width: colWidths.role, minWidth: colWidths.role }}>
                  <button type="button" onClick={() => toggleSort("role")} aria-label={t(lang, "sortBy", t(lang, "role"))} title={t(lang, "sortBy", t(lang, "role"))} className={`hover:text-AIPM-green ${INTERACTIVE}`}>
                    {t(lang, "role")}{sortIndicator("role")}
                  </button>
                  <ColumnResizeHandle col="role" onMouseDown={startColResize} />
                </th>
                <th className="relative px-3 py-2 font-medium" style={{ width: colWidths.title, minWidth: colWidths.title }}>
                  <button type="button" onClick={() => toggleSort("title")} aria-label={t(lang, "sortBy", t(lang, "resourceColTitle"))} title={t(lang, "sortBy", t(lang, "resourceColTitle"))} className={`hover:text-AIPM-green ${INTERACTIVE}`}>
                    {t(lang, "resourceColTitle")}{sortIndicator("title")}
                  </button>
                  <ColumnResizeHandle col="title" onMouseDown={startColResize} />
                </th>
                <th className="relative px-3 py-2 font-medium" style={{ width: colWidths.department, minWidth: colWidths.department }}>
                  <button type="button" onClick={() => toggleSort("department")} aria-label={t(lang, "sortBy", t(lang, "resourceColDepartment"))} title={t(lang, "sortBy", t(lang, "resourceColDepartment"))} className={`hover:text-AIPM-green ${INTERACTIVE}`}>
                    {t(lang, "resourceColDepartment")}{sortIndicator("department")}
                  </button>
                  <ColumnResizeHandle col="department" onMouseDown={startColResize} />
                </th>
                <th className="relative px-3 py-2 font-medium" style={{ width: colWidths.phone, minWidth: colWidths.phone }}>
                  <button type="button" onClick={() => toggleSort("phone")} aria-label={t(lang, "sortBy", t(lang, "resourceColPhone"))} title={t(lang, "sortBy", t(lang, "resourceColPhone"))} className={`hover:text-AIPM-green ${INTERACTIVE}`}>
                    {t(lang, "resourceColPhone")}{sortIndicator("phone")}
                  </button>
                  <ColumnResizeHandle col="phone" onMouseDown={startColResize} />
                </th>
                <th className="relative px-3 py-2 font-medium" style={{ width: colWidths.email, minWidth: colWidths.email }}>
                  <button type="button" onClick={() => toggleSort("email")} aria-label={t(lang, "sortBy", t(lang, "email"))} title={t(lang, "sortBy", t(lang, "email"))} className={`hover:text-AIPM-green ${INTERACTIVE}`}>
                    {t(lang, "email")}{sortIndicator("email")}
                  </button>
                  <ColumnResizeHandle col="email" onMouseDown={startColResize} />
                </th>
                <th className="relative px-3 py-2 font-medium" style={{ width: colWidths.birthday, minWidth: colWidths.birthday }}>
                  <button type="button" onClick={() => toggleSort("birthday")} aria-label={t(lang, "sortBy", t(lang, "resourceColBirthday"))} title={t(lang, "sortBy", t(lang, "resourceColBirthday"))} className={`hover:text-AIPM-green ${INTERACTIVE}`}>
                    {t(lang, "resourceColBirthday")}{sortIndicator("birthday")}
                  </button>
                  <ColumnResizeHandle col="birthday" onMouseDown={startColResize} />
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {rows.map((r) => (
                <tr key={r.id} className="cursor-pointer align-middle hover:bg-surface-muted" onClick={() => onEditResource(r)}>
                  {bulkEnabled && (
                    <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        aria-label={t(lang, "selectItem", resourceDisplayName(r))}
                        checked={sel.isSelected(r.id)}
                        onChange={() => sel.toggle(r.id)}
                        className={`h-4 w-4 cursor-pointer rounded border-line text-AIPM-dark-blue ${FOCUS_RING} ${TRANSITION}`}
                      />
                    </td>
                  )}
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onEditResource(r); }}
                      className={`rounded-md border border-transparent px-2 py-0.5 font-medium text-foreground hover:border-AIPM-dark-blue hover:bg-surface-muted ${INTERACTIVE}`}
                    >
                      {resourceDisplayName(r)}
                    </button>
                    {r.isExternal && (
                      <span className="ml-1.5 rounded border border-line bg-surface-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                        {t(lang, "resourceExternalBadge")}
                      </span>
                    )}
                  </td>
                  <DirectoryRoleSelect
                    resource={r}
                    roles={roles}
                    disciplines={disciplines}
                    grades={grades}
                    onAssignRoleById={onAssignRoleById}
                  />
                  <td className="px-3 py-2 text-muted-foreground" title={r.title ?? ""}>{r.title ?? "—"}</td>
                  <td className="px-3 py-2 text-muted-foreground" title={r.department ?? ""}>{r.department ?? "—"}</td>
                  <td className="px-3 py-2 text-muted-foreground" title={r.businessPhone ?? ""}>{r.businessPhone ?? "—"}</td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {(() => {
                      const emailList = [r.email, ...(r.emails ?? [])].filter((e): e is string => !!e);
                      if (emailList.length === 0) return "—";
                      return emailList.map((addr, i) => (
                        <span key={addr}>
                          {i > 0 && <span aria-hidden="true">; </span>}
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); void copyEmail(addr); }}
                            aria-label={t(lang, "resourceEmailCopyLabel", addr)}
                            title={t(lang, "resourceEmailCopyLabel", addr)}
                            className={`rounded text-foreground hover:text-AIPM-dark-blue hover:underline ${FOCUS_RING} ${TRANSITION}`}
                          >
                            {addr}
                          </button>
                        </span>
                      ));
                    })()}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground" title={r.birthday ?? ""}>{r.birthday ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export const ResourceDirectory = memo(ResourceDirectoryInner);
