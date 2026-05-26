"use client";

// Address-book table for the Directory tab of the Resources pane.
// Each row shows a resource's contact details and inline discipline/grade
// selects. Clicking the name cell opens the edit modal.

import { memo, useMemo, useState } from "react";
import { type Lang, t } from "./i18n";
import { birthdayMonthDay } from "./birthdays";
import { resourceDisplayName } from "./resource-foundation";
import type { Discipline, Grade, Resource, Role } from "./types";

interface Props {
  lang: Lang;
  resources: readonly Resource[];
  roles: readonly Role[];
  disciplines: readonly Discipline[];
  grades: readonly Grade[];
  onAssignRole: (resourceId: number, disciplineId: number, gradeId: number) => void;
  onEditResource: (resource: Resource) => void;
  onAddResource: () => void;
  onOpenAddressBook?: () => void;
}

// Inline discipline + grade selects for a single directory row.
// Mirrors the useState+useEffect re-sync pattern from the old ResourceRoleRow.
function DirectoryRoleSelects({
  lang,
  resource,
  roles,
  disciplines,
  grades,
  onAssignRole,
}: {
  lang: Lang;
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
          onChange={(e) => {
            const v = e.target.value === "" ? "" : Number(e.target.value);
            setDisc(v);
            if (v !== "" && grad !== "") onAssignRole(resource.id, v, Number(grad));
          }}
          className="rounded border border-zinc-300 px-1.5 py-0.5 text-xs dark:border-zinc-700 dark:bg-zinc-900"
        >
          <option value="">{t(lang, "rolesDiscipline")}</option>
          {disciplines.map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
      </td>
      <td className="px-3 py-2">
        <select
          aria-label={`Grade for ${resourceDisplayName(resource)}`}
          value={grad === "" ? "" : String(grad)}
          onChange={(e) => {
            const v = e.target.value === "" ? "" : Number(e.target.value);
            setGrad(v);
            if (disc !== "" && v !== "") onAssignRole(resource.id, Number(disc), v);
          }}
          className="rounded border border-zinc-300 px-1.5 py-0.5 text-xs dark:border-zinc-700 dark:bg-zinc-900"
        >
          <option value="">{t(lang, "rolesGrade")}</option>
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
  onOpenAddressBook,
}: Props) {
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
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="mb-2 flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={onAddResource}
          className="rounded-md border border-AIPM-dark-blue bg-AIPM-dark-blue px-2.5 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-AIPM-dark-blue/90"
        >
          {t(lang, "resourcesAddResource")}
        </button>
        <input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder={t(lang, "directorySearchPlaceholder")}
          aria-label={t(lang, "directorySearchPlaceholder")}
          title={t(lang, "directorySearchHint")}
          className="min-w-0 flex-1 rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-xs text-AIPM-dark-grey placeholder:text-zinc-400 focus:border-AIPM-dark-blue focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-AIPM-light-grey dark:placeholder:text-zinc-500"
        />
        {onOpenAddressBook && (
          <button
            type="button"
            onClick={onOpenAddressBook}
            className="shrink-0 rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-xs font-medium text-AIPM-dark-grey shadow-sm hover:border-AIPM-dark-blue hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-AIPM-light-grey dark:hover:bg-zinc-800"
          >
            {t(lang, "resourcesOpenAddressBook")}
          </button>
        )}
      </div>
      {resources.length === 0 ? (
        <div className="mt-3 flex-1 rounded-md border border-dashed border-zinc-300 p-6 text-center text-sm text-AIPM-medium-grey dark:border-zinc-800">
          {t(lang, "resourcesEmpty")}
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto rounded-md border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 z-10 bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500 shadow-sm dark:bg-zinc-900 dark:text-zinc-400">
              <tr>
                <th className="px-3 py-2 font-medium">
                  <button type="button" onClick={() => toggleSort("name")} aria-label={t(lang, "sortBy", t(lang, "assignee"))} title={t(lang, "sortBy", t(lang, "assignee"))} className="hover:text-zinc-800 dark:hover:text-zinc-200">
                    {t(lang, "assignee")}{sortIndicator("name")}
                  </button>
                </th>
                <th className="px-3 py-2 font-medium">
                  <button type="button" onClick={() => toggleSort("discipline")} aria-label={t(lang, "sortBy", t(lang, "rolesDiscipline"))} title={t(lang, "sortBy", t(lang, "rolesDiscipline"))} className="hover:text-zinc-800 dark:hover:text-zinc-200">
                    {t(lang, "rolesDiscipline")}{sortIndicator("discipline")}
                  </button>
                </th>
                <th className="px-3 py-2 font-medium">
                  <button type="button" onClick={() => toggleSort("grade")} aria-label={t(lang, "sortBy", t(lang, "rolesGrade"))} title={t(lang, "sortBy", t(lang, "rolesGrade"))} className="hover:text-zinc-800 dark:hover:text-zinc-200">
                    {t(lang, "rolesGrade")}{sortIndicator("grade")}
                  </button>
                </th>
                <th className="px-3 py-2 font-medium">
                  <button type="button" onClick={() => toggleSort("title")} aria-label={t(lang, "sortBy", t(lang, "resourceColTitle"))} title={t(lang, "sortBy", t(lang, "resourceColTitle"))} className="hover:text-zinc-800 dark:hover:text-zinc-200">
                    {t(lang, "resourceColTitle")}{sortIndicator("title")}
                  </button>
                </th>
                <th className="px-3 py-2 font-medium">
                  <button type="button" onClick={() => toggleSort("department")} aria-label={t(lang, "sortBy", t(lang, "resourceColDepartment"))} title={t(lang, "sortBy", t(lang, "resourceColDepartment"))} className="hover:text-zinc-800 dark:hover:text-zinc-200">
                    {t(lang, "resourceColDepartment")}{sortIndicator("department")}
                  </button>
                </th>
                <th className="px-3 py-2 font-medium">
                  <button type="button" onClick={() => toggleSort("phone")} aria-label={t(lang, "sortBy", t(lang, "resourceColPhone"))} title={t(lang, "sortBy", t(lang, "resourceColPhone"))} className="hover:text-zinc-800 dark:hover:text-zinc-200">
                    {t(lang, "resourceColPhone")}{sortIndicator("phone")}
                  </button>
                </th>
                <th className="px-3 py-2 font-medium">
                  <button type="button" onClick={() => toggleSort("email")} aria-label={t(lang, "sortBy", t(lang, "email"))} title={t(lang, "sortBy", t(lang, "email"))} className="hover:text-zinc-800 dark:hover:text-zinc-200">
                    {t(lang, "email")}{sortIndicator("email")}
                  </button>
                </th>
                <th className="px-3 py-2 font-medium">
                  <button type="button" onClick={() => toggleSort("birthday")} aria-label={t(lang, "sortBy", t(lang, "resourceColBirthday"))} title={t(lang, "sortBy", t(lang, "resourceColBirthday"))} className="hover:text-zinc-800 dark:hover:text-zinc-200">
                    {t(lang, "resourceColBirthday")}{sortIndicator("birthday")}
                  </button>
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {rows.map((r) => (
                <tr key={r.id} className="align-middle">
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => onEditResource(r)}
                      className="rounded-md border border-transparent px-2 py-0.5 text-xs font-medium text-AIPM-dark-grey shadow-sm hover:border-AIPM-dark-blue hover:bg-zinc-50 dark:text-AIPM-light-grey dark:hover:bg-zinc-800"
                    >
                      {resourceDisplayName(r)}
                    </button>
                  </td>
                  <DirectoryRoleSelects
                    lang={lang}
                    resource={r}
                    roles={roles}
                    disciplines={disciplines}
                    grades={grades}
                    onAssignRole={onAssignRole}
                  />
                  <td className="px-3 py-2 text-AIPM-medium-grey" title={r.title ?? ""}>{r.title ?? "—"}</td>
                  <td className="px-3 py-2 text-AIPM-medium-grey" title={r.department ?? ""}>{r.department ?? "—"}</td>
                  <td className="px-3 py-2 text-AIPM-medium-grey" title={r.businessPhone ?? ""}>{r.businessPhone ?? "—"}</td>
                  <td className="px-3 py-2 text-AIPM-medium-grey" title={r.email ?? ""}>{r.email ?? "—"}</td>
                  <td className="px-3 py-2 text-AIPM-medium-grey" title={r.birthday ?? ""}>{r.birthday ?? "—"}</td>
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
