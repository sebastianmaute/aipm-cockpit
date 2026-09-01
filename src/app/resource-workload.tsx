"use client";

import { useMemo } from "react";
import { shortDateRange } from "./date-format";
import { type Lang, t } from "./i18n";
import { buildResourceWorkload } from "./resource-workload-rows";
import { ABSENCE_TYPES, type Absence, type AbsenceType, type RaidItem, type Resource, type Shift, type Task } from "./types";
import { absenceBg, absenceLegendBg } from "./absence-style";
import { INNER_TABLE_CLASS } from "./view-styles";
import { FOCUS_RING, INTERACTIVE, TRANSITION } from "./interaction-styles";
import { XMarkIcon } from "./icons";
import { IconButton } from "./icon-button";
import { buildRowTokens, rowLabel } from "./row-tokens";
import { ColumnResizeHandle } from "./task-manager-ui";
import { WorkloadOverdueTriage } from "./resource-workload-triage";
import { DataTable } from "./data-table";
import { useConfirm } from "./confirm-dialog";

function absenceTypeLabel(type: AbsenceType, lang: Lang): string {
  switch (type) {
    case "vacation":
      return t(lang, "absenceTypeVacation");
    case "sick":
      return t(lang, "absenceTypeSick");
    case "training":
      return t(lang, "absenceTypeTraining");
    default:
      return t(lang, "absenceTypeOther");
  }
}

/**
 * One absence chip's accessible name: its own VISIBLE text, then the row it
 * belongs to. The chip is content-named today, so two people off on the same
 * days for the same reason announce identically (WCAG 2.4.6) — the row is what
 * tells them apart.
 *
 * ★★ THE MISSING SPACE BETWEEN THE RANGE AND THE TYPE IS DELIBERATE, and
 * "tidying" it breaks WCAG 2.5.3. The chip renders two INLINE spans, and
 * name-from-content concatenates inline content with NO separator — measured,
 * not reasoned: before this qualifier existed the two colliding chips computed
 * to `Jul 01–Jul 05vacation`. 2.5.3 wants the visible label CONTAINED in the
 * accessible name, so this half has to reproduce that concatenation verbatim.
 * `a.type` (not the localized `absenceTypeLabel`) for the same reason — the raw
 * enum value is what the span renders.
 */
function absenceChipName(a: Absence, lang: Lang, rowToken: string): string {
  return `${shortDateRange(a, lang)}${a.type} – ${rowToken}`;
}

export const WORKLOAD_COL_WIDTHS = {
  assignee: 160,
  email: 180,
  openTasks: 110,
  overdue: 110,
  openRaid: 90,
  weeklyHours: 120,
  util: 100,
  upcoming: 200,
} as const;
export type WorkloadCol = keyof typeof WORKLOAD_COL_WIDTHS;

interface Props {
  lang: Lang;
  resources: readonly Resource[];
  tasks: readonly Task[];
  absences: readonly Absence[];
  shifts: readonly Shift[];
  raid: readonly RaidItem[];
  /** When false (RAID module off), the "Open RAID" column is hidden. */
  raidEnabled: boolean;
  today: string;
  onEditResource: (r: Resource) => void;
  onAddResource: (seed: Partial<Resource>) => void;
  /** Clear an unlinked row so it stops being derived. ★★ TWO DIFFERENT
   *  OPERATIONS, and reading this as one cost real work: tasks and RAID are
   *  EDITED (the assignee/owner is blanked, the record stays), while matching
   *  absences and shifts are REMOVED from the workspace outright. Only the
   *  second kind empties anything, which is why `task-manager.tsx` arms the
   *  one-shot destructive-save bypass here, gated on `removesAbsence ||
   *  removesShift` — two `.some(matchName)` probes read off the LIVE arrays
   *  BEFORE any setter runs, deliberately not from inside an updater (React
   *  may invoke one twice). An edit-only clear must not arm. An earlier
   *  revision of this comment described all four as blanking, which reads as
   *  "removes no record" and would justify dropping that arming. Omitted in
   *  read-only popouts. */
  onClearUnlinked?: (row: { display: string; email: string; firstName: string; lastName: string }) => void;
  onEditAbsence: (a: Absence) => void;
  onEditShift: (
    existing: Shift | null,
    assignee: { display: string; email: string },
  ) => void;
  /** Canonical near-term period key (periods[0]) — the one the over-allocation
   *  alert flags; null when there's no plan. */
  nearTermPeriodKey: string | null;
  /** resource.id → near-term utilization percent (for the over-allocation highlight). */
  nearTermPctByResource: ReadonlyMap<number, number>;
  /** Over-allocation threshold percent — MATCHES the alert's configurable
   *  `workloadAllocatedPct` so the pink highlight fires exactly when the alert does. */
  overAllocatedPct: number;
  onSetUtilization: (resourceId: number, periodKey: string, value: number) => void;
  /** Reassign an overdue task to a resource (null = unassign). */
  onReassignTask: (taskId: number, resource: Resource | null) => void;
  /** Reschedule an overdue task's due date. */
  onRescheduleTask: (taskId: number, iso: string) => void;
  colResize: {
    colWidths: Record<WorkloadCol, number>;
    startColResize: (col: WorkloadCol, e: React.MouseEvent) => void;
    resetColWidths: () => void;
  };
  /** Drop external resources from the managed rows (display filter).
   *  ★★ This MUST filter the BUILT rows, never `resources` on the way in:
   *  `buildResourceWorkload` derives its id/name lookups from that argument
   *  alone, so a withheld resource does not vanish — its tasks miss both
   *  lookups and land in `unlinked`, whose "Clear unlinked" DELETES matching
   *  absences and shifts. `resources` must stay complete for that reason and
   *  because it is also the reassign-picker's target list. */
  hideExternal?: boolean;
}

export function ResourceWorkload({
  lang,
  resources,
  tasks,
  absences,
  shifts,
  raid,
  raidEnabled,
  today,
  onEditResource,
  onAddResource,
  onClearUnlinked,
  onEditAbsence,
  onEditShift,
  nearTermPeriodKey,
  nearTermPctByResource,
  overAllocatedPct,
  onSetUtilization,
  onReassignTask,
  onRescheduleTask,
  colResize,
  hideExternal,
}: Props) {
  const { managed: allManaged, unlinked } = useMemo(
    () => buildResourceWorkload(resources, tasks, absences, shifts, raid, today),
    [resources, tasks, absences, shifts, raid, today],
  );
  // Post-filter (see the `hideExternal` prop note): the builder always sees the
  // complete directory, so an external stays MATCHED — hidden here, never
  // re-surfaced as an unlinked row.
  const managed = useMemo(
    () => (hideExternal ? allManaged.filter((r) => !r.resource.isExternal) : allManaged),
    [allManaged, hideExternal],
  );
  // ★★ Two resources can carry ONE display name: `buildResourceWorkload` keys
  // `managed` on the resource id and only its `nameToId` join map de-duplicates
  // by name, so both rows render. The row's name button has no `aria-label`, so
  // its accessible name falls back to its CONTENT and both announced the same
  // string (WCAG 2.4.6); the utilization input and the triage trigger
  // interpolate the same free-text value and collided with it.
  // ★ Built over the POST-filter `managed` list, in rendered order — a row
  // `hideExternal` withholds is not on screen and must not consume an
  // occurrence index.
  const rowTokens = useMemo(
    () => buildRowTokens(managed.map((row) => ({ id: row.resource.id, name: row.display }))),
    [managed],
  );
  // ★★★ THE UNLINKED TABLE TAKES A TOKEN TOO, and the premise this file used to
  // carry — "`row.display` cannot repeat here, so a plain qualifier suffices" —
  // is FALSE. `buildResourceWorkload` keys unlinked rows on
  // `display.toLowerCase()`: a TRIM and a case-fold, but NOT a whitespace
  // COLLAPSE. Accessible-name comparison DOES collapse internal runs (which is
  // why `buildRowTokens` keys on `collapse(name)` and why the shared test
  // harness collapses before comparing), so "Bob  Smith" and "Bob Smith" are
  // TWO rows rendering ONE announced name — the exact vector the old comment
  // denied.
  // ★ Behaviour-neutral for every name that differs today: `buildRowTokens`
  // emits a BARE token for a name unique within its map, so only the colliding
  // pair gains an occurrence index.
  const unlinkedRowTokens = useMemo(
    () => buildRowTokens(unlinked.map((row) => ({ id: row.display.toLowerCase(), name: row.display }))),
    [unlinked],
  );
  // ★★ ONE MAP PER RENDERED TABLE, deliberately, even though both tables share
  // one DOM `<table>` and uniqueness is a whole-surface property. The two lists
  // carry different identity schemes (a numeric resource id vs a case-folded
  // display name), and their chip names cannot collide across the split: an
  // unlinked row exists precisely BECAUSE its name matched no resource
  // case-folded, so no unlinked `display` can equal a managed one. A single map
  // would have to invent a common key type to buy nothing.
  // ★ The row qualifier alone is not sufficient, which is why the composed name
  // still goes through `buildRowTokens`: one person can hold two absence
  // records with the same window and type, so the composed value can repeat.
  const managedAbsenceTokens = useMemo(
    () =>
      buildRowTokens(
        managed.flatMap((row) =>
          row.upcoming.map((a) => ({
            id: `${row.resource.id}:${a.id}`,
            name: absenceChipName(a, lang, rowTokens.get(row.resource.id) ?? row.display),
          })),
        ),
      ),
    [managed, rowTokens, lang],
  );
  const unlinkedAbsenceTokens = useMemo(
    () =>
      buildRowTokens(
        unlinked.flatMap((row) =>
          row.upcoming.map((a) => ({
            id: `${row.display.toLowerCase()}:${a.id}`,
            name: absenceChipName(a, lang, row.display),
          })),
        ),
      ),
    [unlinked, lang],
  );
  const confirm = useConfirm();

  const { colWidths } = colResize;
  const startColResize = colResize.startColResize as (col: string, e: React.MouseEvent) => void;

  return (
    // max-h-full (not h-full): the card shrinks to its content so a short
    // workload list (reference resources are NOT replicated, so even the huge
    // sample has only a handful) does not stretch a mostly-empty table down past
    // the viewport; it still scrolls if the list ever exceeds the pane.
    <div className="flex max-h-full min-h-0 flex-col">
      <div className={INNER_TABLE_CLASS}>
      <DataTable className="w-full text-left text-sm" head={<>
          <tr>
            <th className="relative px-3 py-2 font-medium" style={{ width: colWidths.assignee, minWidth: colWidths.assignee }}>
              {t(lang, "assignee")}
              <ColumnResizeHandle col="assignee" onMouseDown={startColResize} />
            </th>
            <th className="relative px-3 py-2 font-medium" style={{ width: colWidths.email, minWidth: colWidths.email }}>
              {t(lang, "email")}
              <ColumnResizeHandle col="email" onMouseDown={startColResize} />
            </th>
            <th className="relative px-3 py-2 font-medium text-right" style={{ width: colWidths.openTasks, minWidth: colWidths.openTasks }}>
              {t(lang, "resourcesOpenTasks")}
              <ColumnResizeHandle col="openTasks" onMouseDown={startColResize} />
            </th>
            <th className="relative px-3 py-2 font-medium text-right" style={{ width: colWidths.overdue, minWidth: colWidths.overdue }}>
              {t(lang, "resourcesOverdueTasks")}
              <ColumnResizeHandle col="overdue" onMouseDown={startColResize} />
            </th>
            {raidEnabled && (
              <th className="relative px-3 py-2 font-medium text-right" style={{ width: colWidths.openRaid, minWidth: colWidths.openRaid }}>
                {t(lang, "workloadOpenRaid")}
                <ColumnResizeHandle col="openRaid" onMouseDown={startColResize} />
              </th>
            )}
            <th className="relative px-3 py-2 font-medium text-right" style={{ width: colWidths.weeklyHours, minWidth: colWidths.weeklyHours }}>
              {t(lang, "resourcesWeeklyHours")}
              <ColumnResizeHandle col="weeklyHours" onMouseDown={startColResize} />
            </th>
            <th className="relative px-3 py-2 font-medium text-right" style={{ width: colWidths.util, minWidth: colWidths.util }}>
              {t(lang, "workloadNearTermUtil")}
              <ColumnResizeHandle col="util" onMouseDown={startColResize} />
            </th>
            <th className="relative px-3 py-2 font-medium" style={{ width: colWidths.upcoming, minWidth: colWidths.upcoming }}>
              {t(lang, "resourcesUpcomingAbsences")}
              <ColumnResizeHandle col="upcoming" onMouseDown={startColResize} />
            </th>
          </tr>
        </>} tbodyClassName="divide-y divide-line">
          {managed.map((row) => {
            // Cannot miss: the map is built over this exact list, keyed on the
            // same resource id. The fallback keeps the pre-token name rather
            // than leaving the control unnamed if it ever did.
            const rowToken = rowTokens.get(row.resource.id) ?? row.display;
            return (
            <tr key={`res-${row.resource.id}`} className="cursor-pointer align-top hover:bg-surface-muted" onClick={() => onEditResource(row.resource)}>
              <td className="px-3 py-2 font-medium text-foreground">
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onEditResource(row.resource); }}
                  className="rounded-md border border-transparent px-2 py-0.5 text-left font-medium text-foreground hover:border-ui-dark-blue hover:bg-surface-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-ui-green"
                  title={row.display}
                  // WCAG 2.5.3 holds by CONTAINMENT: the token is the visible
                  // `row.display` with at most a trailing occurrence index.
                  aria-label={rowToken}
                >
                  {row.display}
                </button>
              </td>
              <td className="px-3 py-2 text-muted-foreground">
                {row.email || "—"}
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-foreground">
                {row.openCount}
              </td>
              <td className="px-3 py-2 text-right tabular-nums" onClick={(e) => e.stopPropagation()}>
                {row.overdueCount > 0 ? (
                  <WorkloadOverdueTriage
                    lang={lang}
                    rowDisplay={rowToken}
                    overdueTasks={row.overdueTasks}
                    resources={resources}
                    onReassignTask={onReassignTask}
                    onRescheduleTask={onRescheduleTask}
                  />
                ) : (
                  <span className="text-muted-foreground">{row.overdueCount}</span>
                )}
              </td>
              {raidEnabled && (
                <td className="px-3 py-2 text-right tabular-nums text-foreground">
                  {row.raidOpenCount}
                </td>
              )}
              <td className="px-3 py-2 text-right tabular-nums">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onEditShift(row.shift, {
                      display: row.display,
                      email: row.email,
                    });
                  }}
                  title={
                    row.shift
                      ? t(lang, "resourcesEditShift")
                      : t(lang, "resourcesDefaultShift")
                  }
                  // WCAG 2.4.6 (§315) — this button's name came from its
                  // CONTENT alone, the contracted hours, so every row on a
                  // standard week announced "40". THE TOKEN, not a plain
                  // `row.display`: `managed` is keyed on the numeric resource
                  // id, so two rows CAN carry one display name and the
                  // occurrence index is what tells them apart.
                  // ★ The hours LEAD, so the visible text is contained in the
                  // accessible name and WCAG 2.5.3 holds with front-position
                  // for free; the `title` keeps carrying the verb.
                  aria-label={rowLabel(String(row.weeklyHours), rowToken)}
                  className={`rounded-md border border-transparent px-2 py-0.5 text-xs hover:border-ui-dark-blue hover:bg-surface-muted ${INTERACTIVE} ${
                    row.shift
                      ? "text-foreground"
                      : "text-muted-foreground italic"
                  }`}
                >
                  {row.weeklyHours}
                </button>
              </td>
              <td className="px-3 py-2 text-right tabular-nums" onClick={(e) => e.stopPropagation()}>
                {nearTermPeriodKey ? (
                  <input
                    type="number"
                    min={0}
                    step={row.resource.utilizationMode === "percent" ? 5 : 1}
                    value={row.resource.utilization[nearTermPeriodKey] ?? ""}
                    aria-label={t(lang, "workloadNearTermUtilLabel", rowToken)}
                    onChange={(e) =>
                      onSetUtilization(row.resource.id, nearTermPeriodKey, Number(e.target.value) || 0)
                    }
                    className={`w-16 rounded border px-1 py-0.5 text-right tabular-nums dark:bg-surface ${FOCUS_RING} ${TRANSITION} ${
                      (nearTermPctByResource.get(row.resource.id) ?? 0) > overAllocatedPct
                        ? "border-ui-pink-strong font-medium text-ui-pink-strong"
                        : "border-line text-foreground"
                    }`}
                  />
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </td>
              <td className="px-3 py-2 text-muted-foreground">
                {row.upcoming.length === 0 ? (
                  "—"
                ) : (
                  <ul className="flex flex-wrap gap-1.5">
                    {row.upcoming.map((a) => (
                      <li key={a.id}>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); onEditAbsence(a); }}
                          title={a.note ?? ""}
                          aria-label={
                            managedAbsenceTokens.get(`${row.resource.id}:${a.id}`) ??
                            absenceChipName(a, lang, rowToken)
                          }
                          className={`inline-flex items-center gap-1 rounded-md border border-line px-2 py-0.5 text-xs text-foreground hover:border-ui-dark-blue ${absenceBg(a.type)} ${INTERACTIVE}`}
                        >
                          <span>{shortDateRange(a, lang)}</span>
                          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                            {a.type}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </td>
            </tr>
            );
          })}

          {unlinked.length > 0 && (
            <>
              <tr>
                <td
                  colSpan={raidEnabled ? 8 : 7}
                  className="bg-surface-muted px-3 py-1.5"
                >
                  <span className="font-semibold text-foreground">
                    {t(lang, "resourcesUnlinked")}
                  </span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {t(lang, "resourcesUnlinkedHint")}
                  </span>
                </td>
              </tr>
              {unlinked.map((row) => (
                <tr
                  key={`unl-${row.display.toLowerCase()}`}
                  className="align-top"
                >
                  <td className="px-3 py-2 font-medium text-foreground">
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
                      // WCAG 2.4.6 (open-followups §276) — this button's name
                      // came from its CONTENT alone, so every unlinked row
                      // announced the same "Add as resource"; the row's identity
                      // sits in the SIBLING span, outside the button.
                      // ★★★ THE ROW TOKEN, NOT A PLAIN `row.display`. The comment
                      // that stood here justified the plain qualifier by saying
                      // `buildResourceWorkload` keys unlinked rows on
                      // `display.toLowerCase()`, so a display name "cannot repeat
                      // in this list". That key TRIMS and CASE-FOLDS but does NOT
                      // collapse internal whitespace runs, while accessible-name
                      // comparison DOES — so "Bob  Smith" and "Bob Smith" are two
                      // rows announcing one name here exactly as they were on the
                      // weekly-hours button. See `unlinkedRowTokens`.
                      // ★ Behaviour-neutral for names that differ today: a name
                      // unique within its map gets a BARE token.
                      aria-label={rowLabel(t(lang, "resourcesAddAsResource"), unlinkedRowTokens.get(row.display.toLowerCase()) ?? row.display)}
                      className={`ml-2 rounded-md border border-line bg-surface px-2 py-0.5 text-xs font-normal text-foreground hover:border-ui-dark-blue hover:bg-surface-muted ${INTERACTIVE}`}
                    >
                      {t(lang, "resourcesAddAsResource")}
                    </button>
                    {onClearUnlinked && (
                      <IconButton
                        variant="danger"
                        // ★ Same collapse hazard as the sibling add button — the
                        //   token, not the raw display. ★★ `resourcesClearUnlinked`
                        //   is "Clear {0}" in EN but "{0} entfernen" in DE, so the
                        //   occurrence index lands MID-STRING in German and
                        //   `requireCollisionSeed`'s end-anchored regex cannot strip
                        //   it. Uniqueness still holds in both; only the shared
                        //   harness's seed guard is DE-blind here.
                        label={t(lang, "resourcesClearUnlinked", unlinkedRowTokens.get(row.display.toLowerCase()) ?? row.display)}
                        title={t(lang, "resourcesClearUnlinkedHint")}
                        onClick={async () => {
                          if (await confirm({ message: t(lang, "resourcesClearUnlinkedConfirm", row.display), tone: "danger" })) {
                            onClearUnlinked({ display: row.display, email: row.email, firstName: row.firstName, lastName: row.lastName });
                          }
                        }}
                        className="ml-1"
                      >
                        <XMarkIcon aria-hidden="true" className="h-4 w-4" />
                      </IconButton>
                    )}
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">
                    {row.email || "—"}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-foreground">
                    {row.openCount}
                  </td>
                  <td
                    className={`px-3 py-2 text-right tabular-nums ${
                      row.overdueCount > 0
                        ? "font-medium text-ui-pink-strong"
                        : "text-muted-foreground"
                    }`}
                  >
                    {row.overdueCount}
                  </td>
                  {raidEnabled && (
                    <td className="px-3 py-2 text-right tabular-nums text-foreground">
                      {row.raidOpenCount}
                    </td>
                  )}
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
                      // WCAG 2.4.6 (§315), the same content-named collision as
                      // the managed hours button above — and it takes the same
                      // TOKEN. The old comment here claimed `row.display`
                      // "cannot repeat" because unlinked rows are accumulated
                      // into a Map keyed on `display.toLowerCase()`; that key
                      // trims and case-folds but does NOT collapse internal
                      // whitespace runs, while accessible-name comparison does.
                      // See `unlinkedRowTokens` for the full reasoning.
                      aria-label={rowLabel(
                        String(row.weeklyHours),
                        unlinkedRowTokens.get(row.display.toLowerCase()) ?? row.display,
                      )}
                      className={`rounded-md border border-transparent px-2 py-0.5 text-xs hover:border-ui-dark-blue hover:bg-surface-muted ${
                        row.shift
                          ? "text-foreground"
                          : "text-muted-foreground italic"
                      }`}
                    >
                      {row.weeklyHours}
                    </button>
                  </td>
                  <td className="px-3 py-2 text-right text-muted-foreground">—</td>
                  <td className="px-3 py-2 text-muted-foreground">
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
                              // A plain `row.display` qualifier is enough for
                              // the ROW half here (unlinked rows are keyed on
                              // `display.toLowerCase()`, so it cannot repeat),
                              // but the CHIP half still can — hence the token.
                              aria-label={
                                unlinkedAbsenceTokens.get(`${row.display.toLowerCase()}:${a.id}`) ??
                                absenceChipName(a, lang, row.display)
                              }
                              className={`inline-flex items-center gap-1 rounded-md border border-line px-2 py-0.5 text-xs text-foreground hover:border-ui-dark-blue ${absenceBg(a.type)} ${INTERACTIVE}`}
                            >
                              <span>{shortDateRange(a, lang)}</span>
                              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
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
      </DataTable>
    </div>
      <ul
        className="mt-2 flex flex-wrap items-center gap-3 px-1 text-xs text-muted-foreground"
        aria-label={t(lang, "absenceLegendLabel")}
      >
        {ABSENCE_TYPES.map((type) => (
          <li key={type} className="flex items-center gap-1.5">
            <span aria-hidden="true" className={`inline-block h-3 w-3 rounded-sm ${absenceLegendBg(type)}`} />
            {absenceTypeLabel(type, lang)}
          </li>
        ))}
      </ul>
    </div>
  );
}
