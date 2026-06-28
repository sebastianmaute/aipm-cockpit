"use client";

// Address-book table for the Directory tab of the Resources pane.
// Each row shows a resource's contact details and inline discipline/grade
// selects. Clicking the name cell opens the edit modal.

import { memo, useMemo, useState } from "react";
import { type Lang, t } from "./i18n";
import { birthdayMonthDay } from "./birthdays";
import { resourceDisplayName } from "./resource-foundation";
import type { Discipline, Grade, Resource, Role } from "./types";
import { useColumnResize } from "./use-column-resize";
import { useResizable } from "./use-resizable";
import { INNER_TABLE_CLASS, VIEW_PANE_RESIZABLE_CLASS } from "./view-styles";
import { ColumnResizeHandle, ResetColWidthsButton, ResetSizeButton, PrintButton } from "./task-manager-ui";
import { TABLE_HEAD_CLASS } from "./table-styles";
import { FOCUS_RING, TRANSITION, INTERACTIVE } from "./interaction-styles";

const DIRECTORY_COL_WIDTHS = {
  name: 180,
  discipline: 120,
  grade: 100,
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
  onAssignRole: (resourceId: number, disciplineId: number, gradeId: number) => void;
  onEditResource: (resource: Resource) => void;
  onAddResource: () => void;
  onAddAbsence: () => void;
  onImportOutlook?: () => void;
}

// Inline discipline + grade selects for a single directory row.
// Mirrors the useState+useEffect re-sync pattern from the old ResourceRoleRow.
function DirectoryRoleSelects({
  resource,
  roles,
  disciplines,
  grades,
  onAssignRole,
}: {
  resource: Resource;
  roles: readonly Role[];
  disciplines: readonly Discipline[];
  grades: readonly Grade[];
  onAssignRole: (resourceId: number, disciplineId: number, gradeId: number) => void;
}) {
  const current = roles.find((x) => x.id === resource.roleId);
  const curDisc = current?.disciplineId ?? "";
  const curGrad = current?.gradeId ?? "";
  const [prevDisc, setPrevDisc] = useState<number | "">(curDisc);
  const [prevGrad, setPrevGrad] = useState<number | "">(curGrad);
  const [disc, setDisc] = useState<number | "">(curDisc);
  const [grad, setGrad] = useState<number | "">(curGrad);

  // Re-sync when the resource's role changes externally.
  if (prevDisc !== curDisc || prevGrad !== curGrad) {
    setPrevDisc(curDisc);
    setPrevGrad(curGrad);
    setDisc(curDisc);
    setGrad(curGrad);
  }

  return (
    <>
      <td className="px-3 py-2">
        <select
          aria-label={`Discipline for ${resourceDisplayName(resource)}`}
          value={disc === "" ? "" : String(disc)}
          // Stop the click bubbling to the row's onClick (opens the edit modal).
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => {
            const v = e.target.value === "" ? "" : Number(e.target.value);
            setDisc(v);
            if (v !== "" && grad !== "") onAssignRole(resource.id, v, Number(grad));
          }}
          className={`rounded border border-line bg-surface-muted px-1.5 py-0.5 text-xs ${FOCUS_RING} ${TRANSITION}`}
        >
          <option value="">—</option>
          {disciplines.map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
      </td>
      <td className="px-3 py-2">
        <select
          aria-label={`Grade for ${resourceDisplayName(resource)}`}
          value={grad === "" ? "" : String(grad)}
          // Stop the click bubbling to the row's onClick (opens the edit modal).
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => {
            const v = e.target.value === "" ? "" : Number(e.target.value);
            setGrad(v);
            if (disc !== "" && v !== "") onAssignRole(resource.id, Number(disc), v);
          }}
          className={`rounded border border-line bg-surface-muted px-1.5 py-0.5 text-xs ${FOCUS_RING} ${TRANSITION}`}
        >
          <option value="">—</option>
          {grades.map((g) => (
            <option key={g.id} value={g.id}>{g.name}</option>
          ))}
        </select>
      </td>
    </>
  );
}

type SortKey = "" | "name" | "discipline" | "grade" | "title" | "department" | "phone" | "email" | "birthday";

function ResourceDirectoryInner({
  lang,
  resources,
  roles,
  disciplines,
  grades,
  onAssignRole,
  onEditResource,
  onAddResource,
  onAddAbsence,
  onImportOutlook,
}: Props) {
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
    const discName = (r: Resource): string => {
      const role = roles.find((x) => x.id === r.roleId);
      return role ? (disciplines.find((d) => d.id === role.disciplineId)?.name ?? "") : "";
    };
    const gradeName = (r: Resource): string => {
      const role = roles.find((x) => x.id === r.roleId);
      return role ? (grades.find((g) => g.id === role.gradeId)?.name ?? "") : "";
    };
    const q = filter.trim().toLowerCase();
    const keyOf = (r: Resource): string => {
      switch (sortKey) {
        case "name": return resourceDisplayName(r).toLowerCase();
        case "discipline": return discName(r).toLowerCase();
        case "grade": return gradeName(r).toLowerCase();
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
          [resourceDisplayName(r), r.title, r.department, r.businessPhone, r.email, r.company, discName(r), gradeName(r)]
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

  return (
    <div ref={dirRef} className={`print-root print-landscape ${VIEW_PANE_RESIZABLE_CLASS}`}>
      <div className="mb-2 flex shrink-0 items-center gap-2 print:hidden">
        <button
          type="button"
          onClick={onAddResource}
          className={`rounded-md border border-AIPM-dark-blue bg-AIPM-dark-blue px-2.5 py-1.5 text-xs font-medium text-white hover:bg-AIPM-dark-blue/90 ${INTERACTIVE}`}
        >
          {t(lang, "resourcesAddResource")}
        </button>
        <button
          type="button"
          onClick={onAddAbsence}
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
      {resources.length === 0 ? (
        <div className="mt-3 flex-1 rounded-md border border-dashed border-line p-6 text-center text-sm text-muted-foreground">
          {t(lang, "resourcesEmpty")}
        </div>
      ) : (
        <div className={INNER_TABLE_CLASS}>
          <table className="w-full text-left text-sm">
            <thead className={TABLE_HEAD_CLASS}>
              <tr>
                <th className="relative px-3 py-2 font-medium" style={{ width: colWidths.name, minWidth: colWidths.name }}>
                  <button type="button" onClick={() => toggleSort("name")} aria-label={t(lang, "sortBy", t(lang, "assignee"))} title={t(lang, "sortBy", t(lang, "assignee"))} className={`hover:text-AIPM-green ${INTERACTIVE}`}>
                    {t(lang, "assignee")}{sortIndicator("name")}
                  </button>
                  <ColumnResizeHandle col="name" onMouseDown={startColResize} />
                </th>
                <th className="relative px-3 py-2 font-medium" style={{ width: colWidths.discipline, minWidth: colWidths.discipline }}>
                  <button type="button" onClick={() => toggleSort("discipline")} aria-label={t(lang, "sortBy", t(lang, "rolesDiscipline"))} title={t(lang, "sortBy", t(lang, "rolesDiscipline"))} className={`hover:text-AIPM-green ${INTERACTIVE}`}>
                    {t(lang, "rolesDiscipline")}{sortIndicator("discipline")}
                  </button>
                  <ColumnResizeHandle col="discipline" onMouseDown={startColResize} />
                </th>
                <th className="relative px-3 py-2 font-medium" style={{ width: colWidths.grade, minWidth: colWidths.grade }}>
                  <button type="button" onClick={() => toggleSort("grade")} aria-label={t(lang, "sortBy", t(lang, "rolesGrade"))} title={t(lang, "sortBy", t(lang, "rolesGrade"))} className={`hover:text-AIPM-green ${INTERACTIVE}`}>
                    {t(lang, "rolesGrade")}{sortIndicator("grade")}
                  </button>
                  <ColumnResizeHandle col="grade" onMouseDown={startColResize} />
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
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); onEditResource(r); }}
                      className={`rounded-md border border-transparent px-2 py-0.5 font-medium text-foreground hover:border-AIPM-dark-blue hover:bg-surface-muted ${INTERACTIVE}`}
                    >
                      {resourceDisplayName(r)}
                    </button>
                  </td>
                  <DirectoryRoleSelects
                    resource={r}
                    roles={roles}
                    disciplines={disciplines}
                    grades={grades}
                    onAssignRole={onAssignRole}
                  />
                  <td className="px-3 py-2 text-muted-foreground" title={r.title ?? ""}>{r.title ?? "—"}</td>
                  <td className="px-3 py-2 text-muted-foreground" title={r.department ?? ""}>{r.department ?? "—"}</td>
                  <td className="px-3 py-2 text-muted-foreground" title={r.businessPhone ?? ""}>{r.businessPhone ?? "—"}</td>
                  <td className="px-3 py-2 text-muted-foreground" title={r.email ?? ""}>{r.email ?? "—"}</td>
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
