"use client";

import { useMemo, useState } from "react";
import { type Lang, t, localeFor } from "./i18n";
import { currencySymbol } from "./resource-cost";
import type { Discipline, Grade, Role } from "./types";
import { ResetSizeButton, PrintButton } from "./task-manager-ui";
import { DataTable } from "./data-table";
import { INNER_TABLE_CLASS } from "./view-styles";
import { InfoTooltip } from "./info-tooltip";
import { useConfirm } from "./confirm-dialog";
import { dayFromHour, materializeRoleRates } from "./role-rates";
import { SegmentedControl } from "./segmented-control";
import { Button } from "./button";
import { IconButton } from "./icon-button";
import { XMarkIcon } from "@heroicons/react/24/outline";
import { useListReorderDnd } from "./use-list-reorder-dnd";
import { DragHandle } from "./drag-handle";

/** Shared chrome for the two reorder grips, both now the `DragHandle` primitive.
 *  ★ It was a native `<button>` rendering `≡` until the primitive learned to
 *  forward the whole `handleProps` bag; it is a `div role="button"` with the
 *  primitive's ⋮ glyph now, keyboard-focusable via the primitive's own
 *  `tabIndex={0}`. `select-none` and the focus-visible ring moved into the
 *  primitive's base, so only cursor + colour are left here.
 *
 *  ★★★ `handleProps` BELONGS ON THIS BUTTON, NEVER ON THE ROW/ITEM. It carries
 *  the hook's `onKeyDown`, which `preventDefault()`s ArrowUp/ArrowDown and
 *  reorders — and React synthetic keydown bubbles from EVERY descendant. On the
 *  container it swallowed the arrow keys of the four `<input type="number">`
 *  rate cells (native spinner step), the Hours/Days `SegmentedControl` (an APG
 *  radiogroup that handles the same keys and does not stop propagation, so ONE
 *  ArrowDown wrote the basis AND reordered the row) and the RefList rename
 *  input's caret movement. Only `itemProps` (the drop target) goes on the
 *  container. Same split as `reports.tsx` and `budget-panel.tsx`. */
const REORDER_HANDLE_CLASS = "cursor-move text-muted-foreground";

export const ROLES_COL_WIDTHS = {
  discipline: 160,
  grade: 120,
  internal: 120,
  external: 120,
  internalDay: 120,
  externalDay: 120,
  basis: 150,
} as const;

export interface RolesEditorProps {
  lang: Lang;
  /** Project base currency (ISO 4217, e.g. plan.currency) — drives the rate-field symbol. */
  currency: string;
  /** Conversion factor (settings.resources.workdayHours) between day and hour rates. */
  workdayHours: number;
  roles: readonly Role[];
  disciplines: readonly Discipline[];
  grades: readonly Grade[];
  onSaveRole: (role: Role) => void;
  onDeleteRole: (id: number) => void;
  onResolveOrCreateRole: (disciplineId: number, gradeId: number) => number;
  /** Reorder rate-card rows (manual drag order). Ids in the new order. */
  onReorderRoles: (ids: number[]) => void;
  onAddDiscipline: (name: string) => number | null;
  onRenameDiscipline: (id: number, name: string) => void;
  onDeleteDiscipline: (id: number) => void;
  onReorderDisciplines: (ids: number[]) => void;
  onAddGrade: (name: string) => number | null;
  onRenameGrade: (id: number, name: string) => void;
  onDeleteGrade: (id: number) => void;
  onReorderGrades: (ids: number[]) => void;
  /** Called when the user clicks the reset-pane-size button in the rate-card header. */
  onResetSize?: () => void;
}

function clampRate(raw: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100) / 100;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function RolesEditor({
  lang, currency, workdayHours, roles, disciplines, grades,
  onSaveRole, onDeleteRole, onResolveOrCreateRole, onReorderRoles,
  onAddDiscipline, onRenameDiscipline, onDeleteDiscipline, onReorderDisciplines,
  onAddGrade, onRenameGrade, onDeleteGrade, onReorderGrades,
  onResetSize,
}: RolesEditorProps) {
  const curSymbol = currencySymbol(currency, localeFor(lang));
  const [newDiscipline, setNewDiscipline] = useState("");
  const [newGrade, setNewGrade] = useState("");
  const [comboDiscipline, setComboDiscipline] = useState<number | "">("");
  const [comboGrade, setComboGrade] = useState<number | "">("");
  type SortKey = "discipline" | "grade" | "internal" | "external";
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" } | null>(null);
  function toggleSort(key: SortKey) {
    setSort((s) => (s?.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
  }

  const sortedRoles = useMemo(() => {
    const arr = [...roles];
    if (!sort) {
      // Default (no column sort): manual drag order. `order` when present,
      // else the array index — stable, and the drag handle rewrites `order`.
      return arr
        .map((r, i) => ({ r, i }))
        .sort((a, b) => (a.r.order ?? a.i) - (b.r.order ?? b.i) || a.i - b.i)
        .map((x) => x.r);
    }
    const val = (r: Role): string | number => {
      switch (sort.key) {
        case "discipline": return disciplines.find((d) => d.id === r.disciplineId)?.name ?? "";
        case "grade": return grades.find((g) => g.id === r.gradeId)?.name ?? "";
        case "internal": return r.internalRate ?? 0;
        case "external": return r.externalRate ?? 0;
      }
    };
    return arr.sort((a, b) => {
      const av = val(a), bv = val(b);
      const cmp =
        typeof av === "number" && typeof bv === "number"
          ? av - bv
          : String(av).localeCompare(String(bv));
      return sort.dir === "asc" ? cmp : -cmp;
    });
  }, [roles, disciplines, grades, sort]);

  // Drag reorder only in the default (unsorted) view — dragging a column-sorted
  // view would fight the sort, so the hook is disabled rather than the caller
  // re-implementing a `reorderable ? … : undefined` on every prop.
  const roleOrder = useListReorderDnd<number>({
    ids: sortedRoles.map((r) => r.id),
    onReorder: onReorderRoles,
    disabled: !!sort,
  });

  // Render one rate cell. Per role, only the unit matching `rateBasis` (default
  // "hour") is editable; the sibling unit is read-only + auto-derived. Editing a
  // cell materializes BOTH units (and the hourly cost source) via
  // materializeRoleRates; clearing the editable cell flips which unit is entered.
  const editInputClass = "w-24 rounded-md border border-line px-2 py-1 text-right text-sm tabular-nums bg-surface-muted";
  const readInputClass = "w-24 rounded-md border border-transparent px-2 py-1 text-right text-sm tabular-nums bg-transparent text-muted-foreground";
  // Flip which unit the row is entered in. Switching to "day" pins the currently
  // displayed (derived) day rates as the new authoritative values so no figure
  // jumps; switching to "hour" keeps the already-authoritative hourly rates.
  // materializeRoleRates then re-derives the sibling unit + the hourly cost source.
  function flipBasis(r: Role, next: "hour" | "day") {
    if ((r.rateBasis ?? "hour") === next) return;
    const flipped: Role =
      next === "day"
        ? {
            ...r,
            rateBasis: "day",
            internalRateDay: dayFromHour(r.internalRate, workdayHours),
            externalRateDay: dayFromHour(r.externalRate, workdayHours),
          }
        : { ...r, rateBasis: "hour" };
    onSaveRole(materializeRoleRates(flipped, workdayHours));
  }
  function rateCell(r: Role, rowCtx: string, unit: "hour" | "day", field: "internal" | "external") {
    const dayBasis = (r.rateBasis ?? "hour") === "day";
    const editable = unit === "day" ? dayBasis : !dayBasis;
    // Day-basis: the stored day rate is authoritative (editable). Hour-basis: the
    // day figure is display-only and ALWAYS recomputed live from the current
    // workday hours (never a frozen `internalRateDay`), so two hour-basis roles
    // with the same hourly always show the same day rate regardless of edit history.
    const internalDay = dayBasis ? round2(r.internalRateDay ?? 0) : dayFromHour(r.internalRate, workdayHours);
    const externalDay = dayBasis ? round2(r.externalRateDay ?? 0) : dayFromHour(r.externalRate, workdayHours);
    const value =
      field === "internal"
        ? unit === "day" ? internalDay : r.internalRate
        : unit === "day" ? externalDay : r.externalRate;
    const labelKey =
      field === "internal"
        ? unit === "day" ? "rolesInternalRateDay" : "rolesInternalRate"
        : unit === "day" ? "rolesExternalRateDay" : "rolesExternalRate";
    const onChange = (raw: string) => {
      if (raw.trim() === "") {
        // Clear-to-switch: flip which unit the whole row is entered in (same
        // outcome as the Hours/Days switch on the basis column).
        flipBasis(r, unit === "day" ? "hour" : "day");
        return;
      }
      const v = clampRate(raw);
      const patched: Role =
        unit === "day"
          ? field === "internal" ? { ...r, internalRateDay: v } : { ...r, externalRateDay: v }
          : field === "internal" ? { ...r, internalRate: v } : { ...r, externalRate: v };
      onSaveRole(materializeRoleRates(patched, workdayHours));
    };
    return (
      <td className="px-3 py-2 text-right">
        <span className="inline-flex items-center justify-end gap-1">
          <span aria-hidden className="text-muted-foreground">{curSymbol}</span>
          <input type="number" min={0} step={1} value={value} readOnly={!editable}
            aria-label={`${rowCtx} — ${t(lang, labelKey)}`}
            onChange={editable ? (e) => onChange(e.target.value) : undefined}
            className={editable ? editInputClass : readInputClass} />
        </span>
      </td>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <section>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h4 className="text-sm font-semibold text-ui-dark-blue dark:text-ui-light-grey">{t(lang, "rolesRateCard")}</h4>
          <div className="flex flex-row flex-nowrap items-center gap-2">
            {onResetSize && <ResetSizeButton onClick={onResetSize} lang={lang} />}
            <PrintButton lang={lang} />
          </div>
        </div>
        {sortedRoles.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t(lang, "rolesNoRoles")}</p>
        ) : (
          <>
          <div className={INNER_TABLE_CLASS}>
          <DataTable className="w-full text-left text-sm" head={<>
              <tr>
                <th className="relative px-3 py-2 font-medium" style={{ width: ROLES_COL_WIDTHS.discipline, minWidth: ROLES_COL_WIDTHS.discipline }}>
                  <span className="inline-flex items-center gap-1">
                    <button type="button" onClick={() => toggleSort("discipline")} className="inline-flex items-center gap-1 hover:text-ui-green">
                      {t(lang, "rolesDiscipline")}{sort?.key === "discipline" ? (sort.dir === "asc" ? " ▲" : " ▼") : ""}
                    </button>
                    <InfoTooltip text={t(lang, "rolesDisciplineHint")} />
                  </span>
                </th>
                <th className="relative px-3 py-2 font-medium" style={{ width: ROLES_COL_WIDTHS.grade, minWidth: ROLES_COL_WIDTHS.grade }}>
                  <span className="inline-flex items-center gap-1">
                    <button type="button" onClick={() => toggleSort("grade")} className="inline-flex items-center gap-1 hover:text-ui-green">
                      {t(lang, "rolesGrade")}{sort?.key === "grade" ? (sort.dir === "asc" ? " ▲" : " ▼") : ""}
                    </button>
                    <InfoTooltip text={t(lang, "rolesGradeHint")} />
                  </span>
                </th>
                <th className="relative px-3 py-2 text-right font-medium" style={{ width: ROLES_COL_WIDTHS.internal, minWidth: ROLES_COL_WIDTHS.internal }}>
                  <span className="inline-flex items-center gap-1">
                    <button type="button" onClick={() => toggleSort("internal")} className="inline-flex items-center gap-1 hover:text-ui-green">
                      {t(lang, "rolesInternalRate")}{sort?.key === "internal" ? (sort.dir === "asc" ? " ▲" : " ▼") : ""}
                    </button>
                    <InfoTooltip text={t(lang, "rolesInternalRateHint")} />
                  </span>
                </th>
                <th className="relative px-3 py-2 text-right font-medium" style={{ width: ROLES_COL_WIDTHS.external, minWidth: ROLES_COL_WIDTHS.external }}>
                  <span className="inline-flex items-center gap-1">
                    <button type="button" onClick={() => toggleSort("external")} className="inline-flex items-center gap-1 hover:text-ui-green">
                      {t(lang, "rolesExternalRate")}{sort?.key === "external" ? (sort.dir === "asc" ? " ▲" : " ▼") : ""}
                    </button>
                    <InfoTooltip text={t(lang, "rolesExternalRateHint")} />
                  </span>
                </th>
                <th className="relative px-3 py-2 text-right font-medium" style={{ width: ROLES_COL_WIDTHS.internalDay, minWidth: ROLES_COL_WIDTHS.internalDay }}>
                  <span className="inline-flex items-center justify-end gap-1">
                    {t(lang, "rolesInternalRateDay")}
                    <InfoTooltip text={t(lang, "rolesRateBasisHint")} />
                  </span>
                </th>
                <th className="relative px-3 py-2 text-right font-medium" style={{ width: ROLES_COL_WIDTHS.externalDay, minWidth: ROLES_COL_WIDTHS.externalDay }}>
                  <span className="inline-flex items-center justify-end gap-1">
                    {t(lang, "rolesExternalRateDay")}
                    <InfoTooltip text={t(lang, "rolesRateBasisHint")} />
                  </span>
                </th>
                <th className="relative px-3 py-2 font-medium" style={{ width: ROLES_COL_WIDTHS.basis, minWidth: ROLES_COL_WIDTHS.basis }}>
                  <span className="inline-flex items-center gap-1">
                    {t(lang, "rolesRateBasis")}
                    <InfoTooltip text={t(lang, "rolesRateBasisHint")} />
                  </span>
                </th>
                <th className="px-3 py-2" />
              </tr>
            </>} tbodyClassName="divide-y divide-line">
              {sortedRoles.map((r) => {
                const disciplineName = disciplines.find((d) => d.id === r.disciplineId)?.name ?? "n/a";
                const gradeName = grades.find((g) => g.id === r.gradeId)?.name ?? "n/a";
                // The rate inputs sit in bare <td>s with no per-row header, so
                // each needs an explicit name carrying its row + column context.
                const rowCtx = `${disciplineName} / ${gradeName}`;
                // The GRIP is the drag source AND the keyboard entry point, so
                // `handleProps` lands on IT (see REORDER_HANDLE_CLASS); the row
                // is only the drop target. The handle renders only while the
                // hook is live (see `disabled` above).
                const reorderable = !sort;
                return (
                <tr
                  key={r.id}
                  {...roleOrder.itemProps(r.id)}
                >
                  <td className="px-3 py-2">
                    {/* ★★ An explicit flex line, unlike the four other migrated grips.
                        `DragHandle`'s base display is `flex` — a BLOCK box — so dropped
                        straight into this cell it would take a line of its own and push
                        the discipline name underneath it. The other grips are already
                        flex ITEMS of a flex parent, where a block child is laid out
                        inline anyway, so only this one needs the wrapper. Overriding the
                        primitive's `flex` with an `inline-flex` in the caller className
                        would work only while Tailwind emits `.inline-flex` AFTER `.flex`
                        (equal specificity, source order decides) — not a guarantee to
                        build a layout on. ★ jsdom has no layout, so nothing in the unit
                        suite can see any of this. */}
                    <span className="flex items-center">
                      {reorderable && (
                        // ★★ Row-UNIQUE name (WCAG 2.4.6): N identical reorder
                        // handles is a fail axe cannot see at any seed size, so
                        // the qualifier is written at the source.
                        <DragHandle
                          {...roleOrder.handleProps(r.id)}
                          ariaLabel={`${t(lang, "reorderHandle")} – ${rowCtx}`}
                          title={t(lang, "reorderHandle")}
                          className={`mr-1 ${REORDER_HANDLE_CLASS}`}
                        />
                      )}
                      {disciplineName}
                    </span>
                  </td>
                  <td className="px-3 py-2">{gradeName}</td>
                  {rateCell(r, rowCtx, "hour", "internal")}
                  {rateCell(r, rowCtx, "hour", "external")}
                  {rateCell(r, rowCtx, "day", "internal")}
                  {rateCell(r, rowCtx, "day", "external")}
                  <td className="px-3 py-2">
                    <SegmentedControl<"hour" | "day">
                      value={(r.rateBasis ?? "hour") === "day" ? "day" : "hour"}
                      options={[
                        { value: "hour", label: t(lang, "rolesBasisHours") },
                        { value: "day", label: t(lang, "rolesBasisDays") },
                      ]}
                      onChange={(next) => flipBasis(r, next)}
                      ariaLabel={`${rowCtx} — ${t(lang, "rolesRateBasisSwitch")}`}
                      optionAriaLabel={(v) => `${rowCtx} — ${t(lang, v === "day" ? "rolesBasisDays" : "rolesBasisHours")}`}
                      title={t(lang, "rolesRateBasisHint")}
                    />
                  </td>
                  <td className="px-3 py-2 text-right print:hidden">
                    <IconButton variant="danger" onClick={() => onDeleteRole(r.id)} label={`${t(lang, "delete")} – ${rowCtx}`} title={`${t(lang, "delete")} – ${rowCtx}`}>
                      <XMarkIcon aria-hidden="true" className="h-4 w-4" />
                    </IconButton>
                  </td>
                </tr>
                );
              })}
          </DataTable>
          </div>
          <hr className="my-3 border-t border-line" />
          </>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2 print:hidden">
          <select value={comboDiscipline} onChange={(e) => setComboDiscipline(e.target.value ? Number(e.target.value) : "")}
            className="rounded-md border border-line px-2 py-1 text-sm bg-surface-muted">
            <option value="">{t(lang, "rolesDiscipline")}</option>
            {disciplines.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <select value={comboGrade} onChange={(e) => setComboGrade(e.target.value ? Number(e.target.value) : "")}
            className="rounded-md border border-line px-2 py-1 text-sm bg-surface-muted">
            <option value="">{t(lang, "rolesGrade")}</option>
            {grades.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
          </select>
          <Button variant="primary" size="sm"
            disabled={comboDiscipline === "" || comboGrade === ""}
            onClick={() => { if (comboDiscipline !== "" && comboGrade !== "") onResolveOrCreateRole(Number(comboDiscipline), Number(comboGrade)); }}>
            {t(lang, "rolesAddCombo")}
          </Button>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        <RefList lang={lang} title={t(lang, "rolesDiscipline")} items={disciplines}
          onRename={onRenameDiscipline} onDelete={onDeleteDiscipline} onReorder={onReorderDisciplines}
          addPlaceholder={t(lang, "rolesAddDiscipline")}
          addValue={newDiscipline} setAddValue={setNewDiscipline}
          onAdd={() => { if (onAddDiscipline(newDiscipline) != null) setNewDiscipline(""); }} />
        <RefList lang={lang} title={t(lang, "rolesGrade")} items={grades}
          onRename={onRenameGrade} onDelete={onDeleteGrade} onReorder={onReorderGrades}
          addPlaceholder={t(lang, "rolesAddGrade")}
          addValue={newGrade} setAddValue={setNewGrade}
          onAdd={() => { if (onAddGrade(newGrade) != null) setNewGrade(""); }} />
      </section>
    </div>
  );
}

function RefList({
  lang, title, items, onRename, onDelete, onReorder,
  addPlaceholder, addValue, setAddValue, onAdd,
}: {
  lang: Lang;
  title: string;
  items: readonly { id: number; name: string }[];
  onRename: (id: number, name: string) => void;
  onDelete: (id: number) => void;
  onReorder: (ids: number[]) => void;
  addPlaceholder: string;
  addValue: string;
  setAddValue: (v: string) => void;
  onAdd: () => void;
}) {
  const itemOrder = useListReorderDnd<number>({
    ids: items.map((it) => it.id),
    onReorder,
  });
  const confirm = useConfirm();

  return (
    <div>
      <h4 className="mb-2 text-sm font-semibold text-ui-dark-blue dark:text-ui-light-grey">{title}</h4>
      <ul className="flex flex-col gap-1.5">
        {items.map((it) => (
          <li
            key={it.id}
            // Drop target only — `handleProps` goes on the GRIP below, because
            // this item also holds the rename input (see REORDER_HANDLE_CLASS).
            {...itemOrder.itemProps(it.id)}
            className="flex items-center gap-1"
          >
            {/* ★★ Row-UNIQUE name (WCAG 2.4.6) — see the rate-card handle. */}
            <DragHandle
              {...itemOrder.handleProps(it.id)}
              ariaLabel={`${t(lang, "reorderHandle")} – ${it.name}`}
              title={t(lang, "reorderHandle")}
              className={`px-1 ${REORDER_HANDLE_CLASS}`}
            />
            <input defaultValue={it.name}
              onBlur={(e) => { if (e.target.value.trim() && e.target.value.trim() !== it.name) onRename(it.id, e.target.value); }}
              className="flex-1 rounded-md border border-line px-2 py-1 text-sm bg-surface-muted" />
            <IconButton
              variant="danger"
              label={`${t(lang, "delete")} – ${it.name}`}
              title={`${t(lang, "delete")} – ${it.name}`}
              onClick={async () => {
                if (await confirm({ message: t(lang, "rolesConfirmDeleteRef") })) onDelete(it.id);
              }}
            >
              <XMarkIcon aria-hidden="true" className="h-4 w-4" />
            </IconButton>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex items-center gap-2 print:hidden">
        <input value={addValue} onChange={(e) => setAddValue(e.target.value)} placeholder={addPlaceholder}
          aria-label={addPlaceholder}
          className="flex-1 rounded-md border border-line px-2 py-1 text-sm bg-surface-muted" />
        <Button variant="secondary" size="sm" onClick={onAdd} aria-label={addPlaceholder} title={addPlaceholder}>+</Button>
      </div>
    </div>
  );
}
