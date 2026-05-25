"use client";

import { useMemo } from "react";
import { localeFor, shortDateRange } from "./date-format";
import { type Lang, t } from "./i18n";
import { buildResourceWorkload } from "./resource-workload-rows";
import type { Absence, Resource, Shift, Task } from "./types";

interface Props {
  lang: Lang;
  resources: readonly Resource[];
  tasks: readonly Task[];
  absences: readonly Absence[];
  shifts: readonly Shift[];
  today: string;
  onEditResource: (r: Resource) => void;
  onAddResource: (seed: Partial<Resource>) => void;
  onEditAbsence: (a: Absence) => void;
  onEditShift: (
    existing: Shift | null,
    assignee: { display: string; email: string },
  ) => void;
}

export function ResourceWorkload({
  lang,
  resources,
  tasks,
  absences,
  shifts,
  today,
  onEditResource,
  onAddResource,
  onEditAbsence,
  onEditShift,
}: Props) {
  const { managed, unlinked } = useMemo(
    () => buildResourceWorkload(resources, tasks, absences, shifts, today),
    [resources, tasks, absences, shifts, today],
  );

  return (
    <div className="min-h-0 flex-1 overflow-auto rounded-md border border-zinc-200 dark:border-zinc-800">
      <table className="w-full text-left text-sm">
        <thead className="sticky top-0 z-10 bg-zinc-50 text-xs uppercase tracking-wide text-zinc-500 shadow-sm dark:bg-zinc-900 dark:text-zinc-400">
          <tr>
            <th className="px-3 py-2 font-medium">{t(lang, "assignee")}</th>
            <th className="px-3 py-2 font-medium">{t(lang, "email")}</th>
            <th className="px-3 py-2 font-medium text-right">
              {t(lang, "resourcesOpenTasks")}
            </th>
            <th className="px-3 py-2 font-medium text-right">
              {t(lang, "resourcesOverdueTasks")}
            </th>
            <th className="px-3 py-2 font-medium text-right">
              {t(lang, "resourcesWeeklyHours")}
            </th>
            <th className="px-3 py-2 font-medium">
              {t(lang, "resourcesUpcomingAbsences")}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
          {managed.map((row) => (
            <tr key={`res-${row.resource.id}`} className="align-top">
              <td className="px-3 py-2 font-medium text-AIPM-dark-grey dark:text-AIPM-light-grey">
                <button
                  type="button"
                  onClick={() => onEditResource(row.resource)}
                  className="rounded px-1 py-0.5 text-left hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-AIPM-dark-blue"
                >
                  {row.display}
                </button>
              </td>
              <td className="px-3 py-2 text-AIPM-medium-grey">
                {row.email || "—"}
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-AIPM-dark-grey dark:text-AIPM-light-grey">
                {row.openCount}
              </td>
              <td
                className={`px-3 py-2 text-right tabular-nums ${
                  row.overdueCount > 0
                    ? "font-medium text-red-600 dark:text-red-400"
                    : "text-AIPM-medium-grey"
                }`}
              >
                {row.overdueCount}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                <button
                  type="button"
                  onClick={() =>
                    onEditShift(row.shift, {
                      display: row.display,
                      email: row.email,
                    })
                  }
                  title={
                    row.shift
                      ? t(lang, "resourcesEditShift")
                      : t(lang, "resourcesDefaultShift")
                  }
                  className={`rounded-md border border-transparent px-2 py-0.5 text-xs shadow-sm hover:border-AIPM-dark-blue hover:bg-zinc-50 dark:hover:bg-zinc-800 ${
                    row.shift
                      ? "text-AIPM-dark-grey dark:text-AIPM-light-grey"
                      : "text-AIPM-medium-grey italic"
                  }`}
                >
                  {row.weeklyHours}
                </button>
              </td>
              <td className="px-3 py-2 text-AIPM-medium-grey">
                {row.upcoming.length === 0 ? (
                  "—"
                ) : (
                  <ul className="flex flex-wrap gap-1.5">
                    {row.upcoming.map((a) => (
                      <li key={a.id}>
                        <button
                          type="button"
                          onClick={() => onEditAbsence(a)}
                          title={a.note ?? ""}
                          className="inline-flex items-center gap-1 rounded-md border border-zinc-300 bg-white px-2 py-0.5 text-xs text-AIPM-dark-grey shadow-sm hover:border-AIPM-dark-blue hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-AIPM-light-grey dark:hover:bg-zinc-800"
                        >
                          <span>{shortDateRange(a, lang)}</span>
                          <span className="text-[10px] uppercase tracking-wide text-AIPM-medium-grey">
                            {a.type}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </td>
            </tr>
          ))}

          {unlinked.length > 0 && (
            <>
              <tr>
                <td
                  colSpan={6}
                  className="bg-zinc-50 px-3 py-1.5 dark:bg-zinc-900"
                >
                  <span className="font-semibold text-AIPM-dark-grey dark:text-AIPM-light-grey">
                    {t(lang, "resourcesUnlinked")}
                  </span>
                  <span className="ml-2 text-xs text-AIPM-medium-grey">
                    {t(lang, "resourcesUnlinkedHint")}
                  </span>
                </td>
              </tr>
              {unlinked.map((row) => (
                <tr
                  key={`unl-${row.display.toLowerCase()}`}
                  className="align-top"
                >
                  <td className="px-3 py-2 font-medium text-AIPM-dark-grey dark:text-AIPM-light-grey">
                    <span>{row.display}</span>
                    <button
                      type="button"
                      onClick={() =>
                        onAddResource({
                          firstName: row.firstName,
                          lastName: row.lastName,
                          email: row.email || undefined,
                        })
                      }
                      className="ml-2 rounded-md border border-zinc-300 bg-white px-2 py-0.5 text-xs font-normal text-AIPM-dark-grey shadow-sm hover:border-AIPM-dark-blue hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-AIPM-light-grey dark:hover:bg-zinc-800"
                    >
                      {t(lang, "resourcesAddAsResource")}
                    </button>
                  </td>
                  <td className="px-3 py-2 text-AIPM-medium-grey">
                    {row.email || "—"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-AIPM-dark-grey dark:text-AIPM-light-grey">
                    {row.openCount}
                  </td>
                  <td
                    className={`px-3 py-2 text-right tabular-nums ${
                      row.overdueCount > 0
                        ? "font-medium text-red-600 dark:text-red-400"
                        : "text-AIPM-medium-grey"
                    }`}
                  >
                    {row.overdueCount}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    <button
                      type="button"
                      onClick={() =>
                        onEditShift(row.shift, {
                          display: row.display,
                          email: row.email,
                        })
                      }
                      title={
                        row.shift
                          ? t(lang, "resourcesEditShift")
                          : t(lang, "resourcesDefaultShift")
                      }
                      className={`rounded-md border border-transparent px-2 py-0.5 text-xs shadow-sm hover:border-AIPM-dark-blue hover:bg-zinc-50 dark:hover:bg-zinc-800 ${
                        row.shift
                          ? "text-AIPM-dark-grey dark:text-AIPM-light-grey"
                          : "text-AIPM-medium-grey italic"
                      }`}
                    >
                      {row.weeklyHours}
                    </button>
                  </td>
                  <td className="px-3 py-2 text-AIPM-medium-grey">
                    {row.upcoming.length === 0 ? (
                      "—"
                    ) : (
                      <ul className="flex flex-wrap gap-1.5">
                        {row.upcoming.map((a) => (
                          <li key={a.id}>
                            <button
                              type="button"
                              onClick={() => onEditAbsence(a)}
                              title={a.note ?? ""}
                              className="inline-flex items-center gap-1 rounded-md border border-zinc-300 bg-white px-2 py-0.5 text-xs text-AIPM-dark-grey shadow-sm hover:border-AIPM-dark-blue hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-AIPM-light-grey dark:hover:bg-zinc-800"
                            >
                              <span>{shortDateRange(a, lang)}</span>
                              <span className="text-[10px] uppercase tracking-wide text-AIPM-medium-grey">
                                {a.type}
                              </span>
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                </tr>
              ))}
            </>
          )}
        </tbody>
      </table>
    </div>
  );
}
