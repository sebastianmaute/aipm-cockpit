"use client";

// Address-book table for the Directory tab of the Resources pane.
// Each row shows a resource's contact details and inline discipline/grade
// selects. Clicking the name cell opens the edit modal.

import { memo, useEffect, useState } from "react";
import { type Lang, t } from "./i18n";
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
  const [disc, setDisc] = useState<number | "">(curDisc);
  const [grad, setGrad] = useState<number | "">(curGrad);

  // Re-sync when the resource's role changes externally.
  useEffect(() => {
    setDisc(curDisc);
    setGrad(curGrad);
  }, [curDisc, curGrad]);

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
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="mb-2 flex shrink-0 items-center justify-between">
        <button
          type="button"
          onClick={onAddResource}
          className="rounded-md border border-AIPM-dark-blue bg-AIPM-dark-blue px-2.5 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-AIPM-dark-blue/90"
        >
          {t(lang, "resourcesAddResource")}
        </button>
        {onOpenAddressBook && (
          <button
            type="button"
            onClick={onOpenAddressBook}
            className="rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-xs font-medium text-AIPM-dark-grey shadow-sm hover:border-AIPM-dark-blue hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-AIPM-light-grey dark:hover:bg-zinc-800"
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
                <th className="px-3 py-2 font-medium">{t(lang, "assignee")}</th>
                <th className="px-3 py-2 font-medium">{t(lang, "rolesDiscipline")}</th>
                <th className="px-3 py-2 font-medium">{t(lang, "rolesGrade")}</th>
                <th className="px-3 py-2 font-medium">{t(lang, "resourceColTitle")}</th>
                <th className="px-3 py-2 font-medium">{t(lang, "resourceColDepartment")}</th>
                <th className="px-3 py-2 font-medium">{t(lang, "resourceColPhone")}</th>
                <th className="px-3 py-2 font-medium">{t(lang, "email")}</th>
                <th className="px-3 py-2 font-medium">{t(lang, "resourceColBirthday")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {resources.map((r) => (
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
                  <td className="px-3 py-2 text-AIPM-medium-grey">{r.title ?? "—"}</td>
                  <td className="px-3 py-2 text-AIPM-medium-grey">{r.department ?? "—"}</td>
                  <td className="px-3 py-2 text-AIPM-medium-grey">{r.businessPhone ?? "—"}</td>
                  <td className="px-3 py-2 text-AIPM-medium-grey">{r.email ?? "—"}</td>
                  <td className="px-3 py-2 text-AIPM-medium-grey">{r.birthday ?? "—"}</td>
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
