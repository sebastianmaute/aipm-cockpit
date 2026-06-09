"use client";

import { useMemo, useRef, useState } from "react";
import { type Lang, t } from "./i18n";
import { roleLabel } from "./resource-foundation";
import type { Discipline, Grade, Role } from "./types";
import { useColumnResize } from "./use-column-resize";
import { ColumnResizeHandle } from "./task-manager-ui";
import { TABLE_HEAD_CLASS } from "./table-styles";
import { INNER_TABLE_CLASS } from "./view-styles";

export const ROLES_COL_WIDTHS = {
  discipline: 160,
  grade: 120,
  internal: 120,
  external: 120,
} as const;
export type RolesCol = keyof typeof ROLES_COL_WIDTHS;

export interface RolesEditorProps {
  lang: Lang;
  roles: readonly Role[];
  disciplines: readonly Discipline[];
  grades: readonly Grade[];
  onSaveRole: (role: Role) => void;
  onDeleteRole: (id: number) => void;
  onResolveOrCreateRole: (disciplineId: number, gradeId: number) => number;
  onAddDiscipline: (name: string) => number | null;
  onRenameDiscipline: (id: number, name: string) => void;
  onDeleteDiscipline: (id: number) => void;
  onReorderDisciplines: (ids: number[]) => void;
  onAddGrade: (name: string) => number | null;
  onRenameGrade: (id: number, name: string) => void;
  onDeleteGrade: (id: number) => void;
  onReorderGrades: (ids: number[]) => void;
}

function clampRate(raw: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100) / 100;
}

export function RolesEditor({
  lang, roles, disciplines, grades,
  onSaveRole, onDeleteRole, onResolveOrCreateRole,
  onAddDiscipline, onRenameDiscipline, onDeleteDiscipline, onReorderDisciplines,
  onAddGrade, onRenameGrade, onDeleteGrade, onReorderGrades,
}: RolesEditorProps) {
  const [newDiscipline, setNewDiscipline] = useState("");
  const [newGrade, setNewGrade] = useState("");
  const [comboDiscipline, setComboDiscipline] = useState<number | "">("");
  const [comboGrade, setComboGrade] = useState<number | "">("");
  const { colWidths, startColResize } = useColumnResize<RolesCol>(
    "roles",
    ROLES_COL_WIDTHS,
  );
  const startResize = startColResize as (col: string, e: React.MouseEvent) => void;

  type SortKey = "discipline" | "grade" | "internal" | "external";
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" } | null>(null);
  function toggleSort(key: SortKey) {
    setSort((s) => (s?.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
  }

  const sortedRoles = useMemo(() => {
    const arr = [...roles];
    if (!sort) {
      return arr.sort((a, b) =>
        roleLabel(a, disciplines, grades).localeCompare(roleLabel(b, disciplines, grades)),
      );
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

  return (
    <div className="flex flex-col gap-6">
      <section>
        <h4 className="mb-2 text-sm font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey">{t(lang, "rolesRateCard")}</h4>
        {sortedRoles.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t(lang, "rolesNoRoles")}</p>
        ) : (
          <>
          <div className={INNER_TABLE_CLASS}>
          <table className="w-full text-left text-sm">
            <thead className={TABLE_HEAD_CLASS}>
              <tr>
                <th className="relative px-3 py-2 font-medium" style={{ width: colWidths.discipline, minWidth: colWidths.discipline }}>
                  <button type="button" onClick={() => toggleSort("discipline")} className="inline-flex items-center gap-1 hover:text-AIPM-green">
                    {t(lang, "rolesDiscipline")}{sort?.key === "discipline" ? (sort.dir === "asc" ? " ▲" : " ▼") : ""}
                  </button>
                  <ColumnResizeHandle col="discipline" onMouseDown={startResize} />
                </th>
                <th className="relative px-3 py-2 font-medium" style={{ width: colWidths.grade, minWidth: colWidths.grade }}>
                  <button type="button" onClick={() => toggleSort("grade")} className="inline-flex items-center gap-1 hover:text-AIPM-green">
                    {t(lang, "rolesGrade")}{sort?.key === "grade" ? (sort.dir === "asc" ? " ▲" : " ▼") : ""}
                  </button>
                  <ColumnResizeHandle col="grade" onMouseDown={startResize} />
                </th>
                <th className="relative px-3 py-2 text-right font-medium" style={{ width: colWidths.internal, minWidth: colWidths.internal }}>
                  <button type="button" onClick={() => toggleSort("internal")} className="inline-flex items-center gap-1 hover:text-AIPM-green">
                    {t(lang, "rolesInternalRate")}{sort?.key === "internal" ? (sort.dir === "asc" ? " ▲" : " ▼") : ""}
                  </button>
                  <ColumnResizeHandle col="internal" onMouseDown={startResize} />
                </th>
                <th className="relative px-3 py-2 text-right font-medium" style={{ width: colWidths.external, minWidth: colWidths.external }}>
                  <button type="button" onClick={() => toggleSort("external")} className="inline-flex items-center gap-1 hover:text-AIPM-green">
                    {t(lang, "rolesExternalRate")}{sort?.key === "external" ? (sort.dir === "asc" ? " ▲" : " ▼") : ""}
                  </button>
                  <ColumnResizeHandle col="external" onMouseDown={startResize} />
                </th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {sortedRoles.map((r) => {
                const disciplineName = disciplines.find((d) => d.id === r.disciplineId)?.name ?? "n/a";
                const gradeName = grades.find((g) => g.id === r.gradeId)?.name ?? "n/a";
                // The rate inputs sit in bare <td>s with no per-row header, so
                // each needs an explicit name carrying its row + column context.
                const rowCtx = `${disciplineName} / ${gradeName}`;
                return (
                <tr key={r.id}>
                  <td className="px-3 py-2">{disciplineName}</td>
                  <td className="px-3 py-2">{gradeName}</td>
                  <td className="px-3 py-2 text-right">
                    <input type="number" min={0} step={1} value={r.internalRate}
                      aria-label={`${rowCtx} — ${t(lang, "rolesInternalRate")}`}
                      onChange={(e) => onSaveRole({ ...r, internalRate: clampRate(e.target.value) })}
                      className="w-24 rounded-md border border-line px-2 py-1 text-right text-sm tabular-nums bg-surface-muted" />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <input type="number" min={0} step={1} value={r.externalRate}
                      aria-label={`${rowCtx} — ${t(lang, "rolesExternalRate")}`}
                      onChange={(e) => onSaveRole({ ...r, externalRate: clampRate(e.target.value) })}
                      className="w-24 rounded-md border border-line px-2 py-1 text-right text-sm tabular-nums bg-surface-muted" />
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button type="button" onClick={() => onDeleteRole(r.id)} aria-label={t(lang, "delete")}
                      className="rounded p-1 text-muted-foreground hover:bg-AIPM-pink/10 hover:text-AIPM-pink">×</button>
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
          </div>
          <hr className="my-3 border-t border-line" />
          </>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-2">
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
          <button type="button"
            disabled={comboDiscipline === "" || comboGrade === ""}
            onClick={() => { if (comboDiscipline !== "" && comboGrade !== "") onResolveOrCreateRole(Number(comboDiscipline), Number(comboGrade)); }}
            className="rounded-md border border-AIPM-dark-blue bg-AIPM-dark-blue px-3 py-1 text-sm font-medium text-white disabled:opacity-50">
            {t(lang, "rolesAddCombo")}
          </button>
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
  const draggedIdRef = useRef<number | null>(null);

  return (
    <div>
      <h4 className="mb-2 text-sm font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey">{title}</h4>
      <ul className="flex flex-col gap-1.5">
        {items.map((it) => (
          <li
            key={it.id}
            draggable
            onDragStart={(e) => {
              draggedIdRef.current = it.id;
              e.dataTransfer.effectAllowed = "move";
            }}
            onDragOver={(e) => { e.preventDefault(); }}
            onDrop={(e) => {
              e.preventDefault();
              const fromId = draggedIdRef.current;
              if (fromId === null || fromId === it.id) return;
              const ids = items.map((x) => x.id);
              const filtered = ids.filter((id) => id !== fromId);
              const dropIdx = filtered.indexOf(it.id);
              filtered.splice(dropIdx, 0, fromId);
              onReorder(filtered);
              draggedIdRef.current = null;
            }}
            onDragEnd={() => { draggedIdRef.current = null; }}
            className="flex items-center gap-1"
          >
            <span
              title={t(lang, "reorderHint")}
              className="cursor-move select-none px-1 text-muted-foreground"
              aria-hidden={true}
            >≡</span>
            <input defaultValue={it.name}
              onBlur={(e) => { if (e.target.value.trim() && e.target.value.trim() !== it.name) onRename(it.id, e.target.value); }}
              className="flex-1 rounded-md border border-line px-2 py-1 text-sm bg-surface-muted" />
            <button
              type="button"
              aria-label={t(lang, "delete")}
              onClick={() => {
                if (window.confirm(t(lang, "rolesConfirmDeleteRef"))) onDelete(it.id);
              }}
              className="rounded p-1 text-muted-foreground hover:bg-AIPM-pink/10 hover:text-AIPM-pink"
            >×</button>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex items-center gap-2">
        <input value={addValue} onChange={(e) => setAddValue(e.target.value)} placeholder={addPlaceholder}
          aria-label={addPlaceholder}
          className="flex-1 rounded-md border border-line px-2 py-1 text-sm bg-surface-muted" />
        <button type="button" onClick={onAdd} aria-label={addPlaceholder}
          className="rounded-md border border-AIPM-dark-blue px-3 py-1 text-sm font-medium text-AIPM-dark-blue hover:bg-AIPM-dark-blue/5">+</button>
      </div>
    </div>
  );
}
