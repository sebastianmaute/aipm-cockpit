"use client";

import { useRef, useState } from "react";
import { type Lang, t } from "./i18n";
import { Modal } from "./modal";
import { ModalHeader } from "./modal-header";
import { roleLabel } from "./resource-foundation";
import type { Discipline, Grade, Role } from "./types";
import { useDraggable } from "./use-draggable";

interface Props {
  lang: Lang;
  open: boolean;
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
  onClose: () => void;
}

function clampRate(raw: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100) / 100;
}

export function RolesModal({
  lang, open, roles, disciplines, grades,
  onSaveRole, onDeleteRole, onResolveOrCreateRole,
  onAddDiscipline, onRenameDiscipline, onDeleteDiscipline, onReorderDisciplines,
  onAddGrade, onRenameGrade, onDeleteGrade, onReorderGrades,
  onClose,
}: Props) {
  const [newDiscipline, setNewDiscipline] = useState("");
  const [newGrade, setNewGrade] = useState("");
  const [comboDiscipline, setComboDiscipline] = useState<number | "">("");
  const [comboGrade, setComboGrade] = useState<number | "">("");
  const { offset, handleProps } = useDraggable(open);

  if (!open) return null;

  const sortedRoles = [...roles].sort((a, b) =>
    roleLabel(a, disciplines, grades).localeCompare(roleLabel(b, disciplines, grades)),
  );

  return (
    <Modal open onClose={onClose} ariaLabel={t(lang, "rolesManageTitle")} align="center" backdropClassName="bg-black/40" zIndex={50}>
      <div
        data-modal-panel
        style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
        className="relative flex max-h-[90vh] w-[720px] min-w-[320px] max-w-[95vw] flex-col overflow-hidden rounded-xl border border-AIPM-light-grey bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950"
      >
        <ModalHeader
          lang={lang}
          title={t(lang, "rolesManageTitle")}
          onClose={onClose}
          dragHandleProps={handleProps}
        />

        <div className="flex flex-col gap-6 overflow-y-auto p-5">
          <section>
            <h4 className="mb-2 text-sm font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey">{t(lang, "rolesRateCard")}</h4>
            {sortedRoles.length === 0 ? (
              <p className="text-sm text-AIPM-medium-grey">{t(lang, "rolesNoRoles")}</p>
            ) : (
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase tracking-wide text-AIPM-medium-grey">
                  <tr>
                    <th className="py-1">{t(lang, "rolesDiscipline")}</th>
                    <th className="py-1">{t(lang, "rolesGrade")}</th>
                    <th className="py-1 text-right">{t(lang, "rolesInternalRate")}</th>
                    <th className="py-1 text-right">{t(lang, "rolesExternalRate")}</th>
                    <th className="py-1" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
                  {sortedRoles.map((r) => (
                    <tr key={r.id}>
                      <td className="py-1.5">{disciplines.find((d) => d.id === r.disciplineId)?.name ?? "n/a"}</td>
                      <td className="py-1.5">{grades.find((g) => g.id === r.gradeId)?.name ?? "n/a"}</td>
                      <td className="py-1.5 text-right">
                        <input type="number" min={0} step={1} value={r.internalRate}
                          onChange={(e) => onSaveRole({ ...r, internalRate: clampRate(e.target.value) })}
                          className="w-24 rounded-md border border-zinc-300 px-2 py-1 text-right text-sm tabular-nums dark:border-zinc-700 dark:bg-zinc-900" />
                      </td>
                      <td className="py-1.5 text-right">
                        <input type="number" min={0} step={1} value={r.externalRate}
                          onChange={(e) => onSaveRole({ ...r, externalRate: clampRate(e.target.value) })}
                          className="w-24 rounded-md border border-zinc-300 px-2 py-1 text-right text-sm tabular-nums dark:border-zinc-700 dark:bg-zinc-900" />
                      </td>
                      <td className="py-1.5 text-right">
                        <button type="button" onClick={() => onDeleteRole(r.id)} aria-label={t(lang, "delete")}
                          className="rounded p-1 text-AIPM-medium-grey hover:bg-red-50 hover:text-red-600 dark:hover:bg-zinc-800">×</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <hr className="my-3 border-t border-zinc-200 dark:border-zinc-800" />
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <select value={comboDiscipline} onChange={(e) => setComboDiscipline(e.target.value ? Number(e.target.value) : "")}
                className="rounded-md border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900">
                <option value="">{t(lang, "rolesDiscipline")}</option>
                {disciplines.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
              <select value={comboGrade} onChange={(e) => setComboGrade(e.target.value ? Number(e.target.value) : "")}
                className="rounded-md border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900">
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
      </div>
    </Modal>
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
              className="cursor-move select-none px-1 text-AIPM-medium-grey"
              aria-hidden={true}
            >≡</span>
            <input defaultValue={it.name}
              onBlur={(e) => { if (e.target.value.trim() && e.target.value.trim() !== it.name) onRename(it.id, e.target.value); }}
              className="flex-1 rounded-md border border-zinc-200 px-2 py-1 text-sm dark:border-zinc-800 dark:bg-zinc-900" />
            <button
              type="button"
              aria-label={t(lang, "delete")}
              onClick={() => {
                if (window.confirm(t(lang, "rolesConfirmDeleteRef"))) onDelete(it.id);
              }}
              className="rounded p-1 text-AIPM-medium-grey hover:bg-red-50 hover:text-red-600 dark:hover:bg-zinc-800"
            >×</button>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex items-center gap-2">
        <input value={addValue} onChange={(e) => setAddValue(e.target.value)} placeholder={addPlaceholder}
          className="flex-1 rounded-md border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900" />
        <button type="button" onClick={onAdd} aria-label={addPlaceholder}
          className="rounded-md border border-AIPM-dark-blue px-3 py-1 text-sm font-medium text-AIPM-dark-blue hover:bg-AIPM-dark-blue/5">+</button>
      </div>
    </div>
  );
}
