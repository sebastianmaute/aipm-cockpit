"use client";

// Resource Planner panel — view shell + per-assignee list view.
//
// Three views, switchable via a single SegmentedControl in the header:
//   - "list"     — stats table (open/overdue counts + upcoming absences).
//                  Phases 1 + 2 of the planner.
//   - "calendar" — 30-day grid (rows × days). Phase 3. Rendered by the
//                  sibling <ResourceCalendar /> component.
//   - "planning" — per-period utilization grid (resources × periods) with a
//                  planning-window (start/end date) + granularity (week/month)
//                  control row above the table.
//
// All views share the same per-assignee aggregation: trim + lowercase
// the assignee name so "Alex Example" and "Alex Example" land in the same
// row; display uses the first observed original casing. See
// docs/RESOURCE-PLANNER-PLAN.md.

import { memo, useEffect, useMemo, useState } from "react";
import { type Lang, t } from "./i18n";
import { ResourceCalendar } from "./resource-calendar";
import { SegmentedControl } from "./segmented-control";
import { generatePeriods, displayCapacityHours, absencesForResource, absenceWorkdays } from "./resource-capacity";
import { periodCost, formatCurrency } from "./resource-cost";
import {
  type Absence,
  DEFAULT_WEEK_HOURS,
  type Discipline,
  type Grade,
  type Resource,
  type ResourcePlan,
  type Role,
  type Shift,
  type Task,
  type WeekHours,
} from "./types";

interface Props {
  lang: Lang;
  tasks: readonly Task[];
  absences: readonly Absence[];
  shifts: readonly Shift[];
  resources: readonly Resource[];
  today: string;
  holidaySet: ReadonlySet<string>;
  onAddAbsence: (seed?: Partial<Absence>) => void;
  onEditAbsence: (absence: Absence) => void;
  /** Open the shift modal for a row. `existingShift` is the shift to edit,
   *  or null when the row has no shift yet (modal opens in create mode
   *  pre-filled with the row's assignee). */
  onEditShift: (
    existingShift: Shift | null,
    assignee: { display: string; email: string },
  ) => void;
  roles: readonly Role[];
  disciplines: readonly Discipline[];
  grades: readonly Grade[];
  onManageRoles: () => void;
  onOpenReport: () => void;
  onAssignRole: (resourceId: number, disciplineId: number, gradeId: number) => void;
  plan: ResourcePlan;
  workdayHours: number;
  onSetUtilization: (resourceId: number, periodKey: string, value: number) => void;
  onSetUtilizationMode: (resourceId: number, mode: "percent" | "hours") => void;
  onSetAbsenceOverride: (resourceId: number, periodKey: string, hours: number | null) => void;
  onSetPlanWindow: (startDate: string, endDate: string) => void;
  onSetPlanGranularity: (granularity: "week" | "month") => void;
}

type View = "list" | "calendar" | "planning";

interface AssigneeRow {
  key: string;          // case-folded join key
  display: string;      // first observed original casing
  email: string;        // first non-empty email observed
  openCount: number;
  overdueCount: number;
  upcoming: Absence[];  // sorted by startDate asc, within 60-day window
  shift: Shift | null;  // matching shift (case-folded join), or null = default
  weeklyHours: number;  // sum of hoursPerWeekday — uses DEFAULT_WEEK_HOURS when shift is null
}

function sumHours(h: WeekHours): number {
  return h.reduce((a, b) => a + (b || 0), 0);
}

const DEFAULT_WEEKLY_HOURS_TOTAL = sumHours(DEFAULT_WEEK_HOURS);

function localeFor(lang: Lang): string {
  if (lang === "de") return "de-DE";
  if (lang === "en-GB") return "en-GB";
  return "en-US";
}

function shortDateRange(a: Absence, lang: Lang): string {
  const loc = localeFor(lang);
  const start = new Date(a.startDate);
  const end = new Date(a.endDate);
  const sameDay = a.startDate === a.endDate;
  const fmt: Intl.DateTimeFormatOptions = { month: "short", day: "2-digit" };
  if (Number.isNaN(start.valueOf()) || Number.isNaN(end.valueOf())) {
    return sameDay ? a.startDate : `${a.startDate}–${a.endDate}`;
  }
  if (sameDay) return start.toLocaleDateString(loc, fmt);
  return `${start.toLocaleDateString(loc, fmt)}–${end.toLocaleDateString(loc, fmt)}`;
}

function ResourceRoleRow({
  lang, resource, roles, disciplines, grades, onAssignRole,
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
  // Re-sync when the resource's role changes externally (assignment elsewhere,
  // role deletion nulling roleId, cross-window broadcast).
  useEffect(() => {
    setDisc(curDisc);
    setGrad(curGrad);
  }, [curDisc, curGrad]);

  return (
    <li className="flex flex-wrap items-center gap-2 rounded-md border border-zinc-200 px-2 py-1 text-sm dark:border-zinc-800">
      <span className="font-medium text-AIPM-dark-grey dark:text-AIPM-light-grey">{resource.name}</span>
      {resource.roleId == null && (
        <span className="text-xs text-AIPM-medium-grey italic">{t(lang, "resourcesUnassignedRole")}</span>
      )}
      <select
        aria-label={`Discipline for ${resource.name}`}
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
      <select
        aria-label={`Grade for ${resource.name}`}
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
    </li>
  );
}

function ResourcesPanelInner({
  lang,
  tasks,
  absences,
  shifts,
  resources,
  today,
  holidaySet,
  onAddAbsence,
  onEditAbsence,
  onEditShift,
  roles,
  disciplines,
  grades,
  onManageRoles,
  onOpenReport,
  onAssignRole,
  plan,
  workdayHours,
  onSetUtilization,
  onSetUtilizationMode,
  onSetAbsenceOverride,
  onSetPlanWindow,
  onSetPlanGranularity,
}: Props) {
  const [view, setView] = useState<View>("list");
  const [showRollup, setShowRollup] = useState(false);

  const rows = useMemo<AssigneeRow[]>(() => {
    const byKey = new Map<string, AssigneeRow>();
    const upsert = (
      rawAssignee: string,
      rawEmail: string | undefined,
    ): AssigneeRow | null => {
      const trimmed = rawAssignee.trim();
      if (!trimmed) return null;
      const key = trimmed.toLowerCase();
      let row = byKey.get(key);
      if (!row) {
        row = {
          key,
          display: trimmed,
          email: rawEmail?.trim() ?? "",
          openCount: 0,
          overdueCount: 0,
          upcoming: [],
          shift: null,
          weeklyHours: DEFAULT_WEEKLY_HOURS_TOTAL,
        };
        byKey.set(key, row);
      } else if (!row.email && rawEmail) {
        row.email = rawEmail.trim();
      }
      return row;
    };

    // Tasks contribute the assignee + open/overdue counts.
    for (const task of tasks) {
      const row = upsert(task.assignee, task.assigneeEmail);
      if (!row) continue;
      if (!task.completedDate) {
        row.openCount++;
        if (task.dueDate && task.dueDate < today) row.overdueCount++;
      }
    }

    // Absences contribute upcoming (next 60 days) + ensure the assignee
    // exists even if they have no tasks yet.
    const horizon = (() => {
      const d = new Date(today);
      if (Number.isNaN(d.valueOf())) return null;
      d.setUTCDate(d.getUTCDate() + 60);
      return d.toISOString().slice(0, 10);
    })();
    for (const a of absences) {
      const row = upsert(a.assignee, a.assigneeEmail);
      if (!row) continue;
      if (a.endDate < today) continue;
      if (horizon && a.startDate > horizon) continue;
      row.upcoming.push(a);
    }
    // Shifts contribute weekly-hours + ensure the assignee row exists.
    for (const s of shifts) {
      const row = upsert(s.assignee, s.assigneeEmail);
      if (!row) continue;
      row.shift = s;
      row.weeklyHours = sumHours(s.hoursPerWeekday);
    }
    for (const row of byKey.values()) {
      row.upcoming.sort((x, y) => x.startDate.localeCompare(y.startDate));
    }

    return Array.from(byKey.values()).sort((a, b) =>
      a.display.localeCompare(b.display),
    );
  }, [tasks, absences, shifts, today]);

  // Header: title + (when there are rows) view-toggle + "+ Add absence".
  const renderHeader = (showToggle: boolean) => (
    <header className="mb-3 flex shrink-0 items-baseline justify-between gap-2">
      <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-100">
        {t(lang, "tabResources")}
        {rows.length > 0 && (
          <span className="ml-2 text-sm font-normal text-AIPM-medium-grey">
            {t(lang, "tasksCount", rows.length)}
          </span>
        )}
      </h2>
      <div className="flex items-center gap-3">
        {showToggle && (
          <SegmentedControl<View>
            value={view}
            ariaLabel={t(lang, "tabResources")}
            options={[
              { value: "list", label: t(lang, "resourcesViewList") },
              { value: "calendar", label: t(lang, "resourcesViewCalendar") },
              { value: "planning", label: t(lang, "resourcesViewPlanning") },
            ]}
            onChange={(v) => setView(v)}
          />
        )}
        <button
          type="button"
          onClick={onManageRoles}
          className="rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-xs font-medium text-AIPM-dark-grey shadow-sm hover:border-AIPM-dark-blue hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-AIPM-light-grey dark:hover:bg-zinc-800"
        >
          {t(lang, "resourcesManageRoles")}
        </button>
        <button
          type="button"
          onClick={onOpenReport}
          className="rounded-md border border-zinc-300 bg-white px-2.5 py-1.5 text-xs font-medium text-AIPM-dark-grey shadow-sm hover:border-AIPM-dark-blue hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-AIPM-light-grey dark:hover:bg-zinc-800"
        >
          {t(lang, "resourcesOpenReport")}
        </button>
        <button
          type="button"
          onClick={() => onAddAbsence()}
          className="rounded-md border border-AIPM-dark-blue bg-AIPM-dark-blue px-2.5 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-AIPM-dark-blue/90"
        >
          {t(lang, "resourcesAddAbsence")}
        </button>
      </div>
    </header>
  );

  const resourceRoster = resources.length > 0 && (
    <ul className="mb-3 flex flex-col gap-2">
      {resources.map((r) => (
        <ResourceRoleRow
          key={r.id}
          lang={lang}
          resource={r}
          roles={roles}
          disciplines={disciplines}
          grades={grades}
          onAssignRole={onAssignRole}
        />
      ))}
    </ul>
  );

  const showToggle = true;
  const isEmpty = rows.length === 0 && resources.length === 0;

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-950">
      {renderHeader(showToggle)}
      {isEmpty && view !== "planning" && (
        <div className="mt-3 flex-1 rounded-md border border-dashed border-zinc-300 p-6 text-center text-sm text-AIPM-medium-grey dark:border-zinc-800">
          {t(lang, "resourcesEmpty")}
        </div>
      )}
      {view === "planning" && (() => {
        const periods = generatePeriods(plan.startDate, plan.endDate, plan.granularity);
        return (
          <>
            <div className="mb-2 flex flex-wrap items-center gap-3 text-xs">
              <label className="flex items-center gap-1">
                <span>{t(lang, "resourcesPlanStart")}</span>
                <input type="date" aria-label={t(lang, "resourcesPlanStart")} value={plan.startDate}
                  onChange={(e) => onSetPlanWindow(e.target.value, plan.endDate)}
                  className="rounded border border-zinc-300 px-1.5 py-0.5 dark:border-zinc-700 dark:bg-zinc-900" />
              </label>
              <label className="flex items-center gap-1">
                <span>{t(lang, "resourcesPlanEnd")}</span>
                <input type="date" aria-label={t(lang, "resourcesPlanEnd")} value={plan.endDate}
                  onChange={(e) => onSetPlanWindow(plan.startDate, e.target.value)}
                  className="rounded border border-zinc-300 px-1.5 py-0.5 dark:border-zinc-700 dark:bg-zinc-900" />
              </label>
              <SegmentedControl<"week" | "month">
                value={plan.granularity}
                ariaLabel={t(lang, "resourcesViewPlanning")}
                options={[
                  { value: "month", label: t(lang, "resourcesGranularityMonth") },
                  { value: "week", label: t(lang, "resourcesGranularityWeek") },
                ]}
                onChange={onSetPlanGranularity}
              />
            </div>
            <div className="min-h-0 flex-1 overflow-auto rounded-md border border-zinc-200 dark:border-zinc-800">
            <table className="text-left text-xs">
              <thead className="sticky top-0 bg-zinc-50 dark:bg-zinc-900">
                <tr>
                  <th className="px-2 py-1.5 text-left">{t(lang, "assignee")}</th>
                  {periods.map((p) => (
                    <th key={p.key} className="px-2 py-1.5 text-right tabular-nums">{p.key}</th>
                  ))}
                  <th className="px-2 py-1.5 text-right">{t(lang, "resourcesCapacityDays")}</th>
                  <th className="px-2 py-1.5 text-right">{t(lang, "resourcesInternalCost")}</th>
                  <th className="px-2 py-1.5 text-right">{t(lang, "resourcesExternalCost")}</th>
                  <th className="px-2 py-1.5 text-right">{t(lang, "resourcesMargin")}</th>
                </tr>
              </thead>
              {(() => {
                const loc = localeFor(lang);
                const totals = { days: 0, internal: 0, external: 0, margin: 0 };
                const rowsJsx = resources.map((r) => {
                  const resAbs = absencesForResource(absences, r);
                  const totalHours = periods.reduce((sum, p) =>
                    sum + displayCapacityHours(p, periods, r, resAbs, workdayHours, holidaySet, plan.granularity, plan.granularity), 0);
                  const role = roles.find((x) => x.id === r.roleId);
                  const cost = periodCost(totalHours, role);
                  totals.days += totalHours / workdayHours;
                  totals.internal += cost.internal;
                  totals.external += cost.external;
                  totals.margin += cost.margin;
                  return (
                    <tr key={r.id}>
                      <td className="px-2 py-1 font-medium text-AIPM-dark-grey dark:text-AIPM-light-grey">{r.name}</td>
                      {periods.map((p) => (
                        <td key={p.key} className="px-1 py-1 text-right align-top">
                          <input type="number" min={0} step={r.utilizationMode === "percent" ? 5 : 1}
                            aria-label={`Utilization for ${r.name} in ${p.key}`}
                            value={r.utilization[p.key] ?? ""}
                            onChange={(e) => onSetUtilization(r.id, p.key, Number(e.target.value) || 0)}
                            className="w-16 rounded border border-zinc-300 px-1 py-0.5 text-right tabular-nums dark:border-zinc-700 dark:bg-zinc-900" />
                          <input type="number" min={0} step={1}
                            aria-label={`Absence override for ${r.name} in ${p.key}`}
                            title={t(lang, "resourcesAbsenceOverrideHint")}
                            value={r.absenceOverride?.[p.key] ?? ""}
                            placeholder={String(absenceWorkdays(resAbs, p.start, p.end, holidaySet) * workdayHours)}
                            onChange={(e) => onSetAbsenceOverride(r.id, p.key, e.target.value === "" ? null : Number(e.target.value))}
                            className="mt-0.5 w-16 rounded border border-amber-200 px-1 py-0.5 text-right text-[10px] tabular-nums text-amber-700 dark:border-amber-900/50 dark:bg-zinc-900 dark:text-amber-400" />
                        </td>
                      ))}
                      <td className="px-2 py-1 text-right tabular-nums font-medium">{(totalHours / workdayHours).toFixed(1)}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{formatCurrency(cost.internal, plan.currency, loc)}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{formatCurrency(cost.external, plan.currency, loc)}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{formatCurrency(cost.margin, plan.currency, loc)}</td>
                    </tr>
                  );
                });
                return (
                  <>
                    <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">{rowsJsx}</tbody>
                    <tfoot className="border-t border-zinc-300 dark:border-zinc-700">
                      <tr className="font-semibold">
                        <td className="px-2 py-1.5">{t(lang, "resourcesTotal")}</td>
                        <td className="px-1 py-1.5" colSpan={periods.length} />
                        <td className="px-2 py-1.5 text-right tabular-nums">{totals.days.toFixed(1)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{formatCurrency(totals.internal, plan.currency, loc)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{formatCurrency(totals.external, plan.currency, loc)}</td>
                        <td className="px-2 py-1.5 text-right tabular-nums">{formatCurrency(totals.margin, plan.currency, loc)}</td>
                      </tr>
                    </tfoot>
                  </>
                );
              })()}
            </table>
          </div>
          {(() => {
            const other: "week" | "month" = plan.granularity === "month" ? "week" : "month";
            const rollupPeriods = generatePeriods(plan.startDate, plan.endDate, other);
            return (
              <div className="mt-3">
                <button type="button" onClick={() => setShowRollup((v) => !v)}
                  className="rounded-md border border-zinc-300 bg-white px-2.5 py-1 text-xs font-medium text-AIPM-dark-grey shadow-sm hover:border-AIPM-dark-blue hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-AIPM-light-grey">
                  {showRollup ? t(lang, "resourcesRollupHide") : t(lang, "resourcesRollupShow")}
                </button>
                {showRollup && (
                  <div className="mt-2 overflow-auto rounded-md border border-zinc-200 dark:border-zinc-800">
                    <table className="text-left text-xs">
                      <thead className="sticky top-0 bg-zinc-50 dark:bg-zinc-900">
                        <tr>
                          <th className="px-2 py-1.5 text-left">{t(lang, "assignee")}</th>
                          {rollupPeriods.map((rp) => (
                            <th key={rp.key} className="px-2 py-1.5 text-right tabular-nums">{rp.key}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                        {resources.map((r) => {
                          const resAbs2 = absencesForResource(absences, r);
                          return (
                            <tr key={r.id}>
                              <td className="px-2 py-1 font-medium text-AIPM-dark-grey dark:text-AIPM-light-grey">{r.name}</td>
                              {rollupPeriods.map((rp) => (
                                <td key={rp.key} className="px-2 py-1 text-right tabular-nums text-AIPM-medium-grey">
                                  {(displayCapacityHours(rp, periods, r, resAbs2, workdayHours, holidaySet, plan.granularity, other) / workdayHours).toFixed(1)}
                                </td>
                              ))}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })()}
          </>
        );
      })()}
      {view === "list" ? (
        <>
          {resourceRoster}
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
              {rows.map((row) => (
                <tr key={row.key} className="align-top">
                  <td className="px-3 py-2 font-medium text-AIPM-dark-grey dark:text-AIPM-light-grey">
                    {row.display}
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
            </tbody>
          </table>
        </div>
        </>
      ) : view === "calendar" ? (
        <ResourceCalendar
          lang={lang}
          rows={rows}
          absences={absences}
          today={today}
          holidaySet={holidaySet}
          onAddAbsence={onAddAbsence}
          onEditAbsence={onEditAbsence}
        />
      ) : null}
    </section>
  );
}

export const ResourcesPanel = memo(ResourcesPanelInner);
