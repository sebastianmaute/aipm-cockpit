"use client";

// Shift editor modal — used by the Resources panel for create / edit /
// delete. State is owned here (the draft is populated from the `shift`
// prop on open and kept locally); the parent receives the final record
// via `onSave`. Validation: assignee required + non-duplicate; each
// per-weekday hour value 0–24.
//
// Phase 4 of the Resource Planner. See docs/RESOURCE-PLANNER-PLAN.md.

import { useMemo, useState } from "react";
import { type Lang, t } from "./i18n";
import { Modal } from "./modal";
import { ModalHeader } from "./modal-header";
import { useDraggable } from "./use-draggable";
import {
  DEFAULT_WEEK_HOURS,
  MAX_HOURS_PER_DAY,
  type Shift,
  type WeekHours,
} from "./types";

interface Props {
  lang: Lang;
  /** When null the modal is hidden. */
  shift: Shift | null;
  /** True when creating; false when editing an existing record. */
  isNew: boolean;
  /** Lower-cased case-folded assignee keys for which a Shift already exists
   *  (used to block duplicate creation). The current draft's own key is
   *  excluded by the caller. */
  existingAssigneeKeys: ReadonlySet<string>;
  /** Known assignees from tasks / existing absences / shifts for autocomplete. */
  knownAssignees: ReadonlyArray<{ name: string; email?: string }>;
  onSave: (next: Shift) => void;
  onDelete: (id: number) => void;
  onClose: () => void;
}

const DATALIST_ID = "shift-assignee-options";

const DAY_KEYS: ReadonlyArray<
  | "shiftDaySun"
  | "shiftDayMon"
  | "shiftDayTue"
  | "shiftDayWed"
  | "shiftDayThu"
  | "shiftDayFri"
  | "shiftDaySat"
> = [
  "shiftDaySun",
  "shiftDayMon",
  "shiftDayTue",
  "shiftDayWed",
  "shiftDayThu",
  "shiftDayFri",
  "shiftDaySat",
];

function clampOnInput(raw: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > MAX_HOURS_PER_DAY) return MAX_HOURS_PER_DAY;
  return Math.round(n * 10) / 10;
}

export function ShiftEditModal({
  lang,
  shift,
  isNew,
  existingAssigneeKeys,
  knownAssignees,
  onSave,
  onDelete,
  onClose,
}: Props) {
  const [prevShift, setPrevShift] = useState(shift);
  const [draft, setDraft] = useState<Shift | null>(shift);
  const [error, setError] = useState<string | null>(null);

  if (prevShift !== shift) {
    setPrevShift(shift);
    setDraft(shift);
    setError(null);
  }

  const { offset, handleProps } = useDraggable(draft !== null);

  // Escape, focus management, and backdrop-click are owned by <Modal>.

  const datalistOptions = useMemo(() => {
    const seen = new Set<string>();
    const out: { name: string; email?: string }[] = [];
    for (const a of knownAssignees) {
      const name = a.name.trim();
      if (!name) continue;
      const key = name.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ name, email: a.email });
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  }, [knownAssignees]);

  if (!draft) return null;

  function update<K extends keyof Shift>(key: K, value: Shift[K]) {
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));
    setError(null);
  }

  function updateHour(index: number, value: number) {
    setDraft((prev) => {
      if (!prev) return prev;
      const next = [...prev.hoursPerWeekday] as number[];
      next[index] = value;
      return { ...prev, hoursPerWeekday: next as unknown as WeekHours };
    });
    setError(null);
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!draft) return;
    const assignee = draft.assignee.trim();
    if (!assignee) {
      setError(t(lang, "shiftErrorAssigneeRequired"));
      return;
    }
    if (isNew && existingAssigneeKeys.has(assignee.toLowerCase())) {
      setError(t(lang, "shiftErrorAssigneeAlreadyHasShift"));
      return;
    }
    for (const h of draft.hoursPerWeekday) {
      if (!Number.isFinite(h) || h < 0 || h > MAX_HOURS_PER_DAY) {
        setError(t(lang, "shiftErrorHourRange"));
        return;
      }
    }
    onSave({
      ...draft,
      assignee,
      assigneeEmail: draft.assigneeEmail?.trim() || undefined,
      note: draft.note?.trim() || undefined,
    });
  }

  function handleDeleteClick() {
    if (!draft) return;
    if (window.confirm(t(lang, "shiftConfirmDelete"))) {
      onDelete(draft.id);
    }
  }

  const weeklyTotal = draft.hoursPerWeekday.reduce(
    (a, b) => a + (b || 0),
    0,
  );

  return (
    <Modal
      open
      onClose={onClose}
      ariaLabel={
        isNew ? t(lang, "shiftNewItem") : t(lang, "shiftEditItem", draft.id)
      }
      align="center"
      backdropClassName="bg-black/40"
      zIndex={50}
    >
      <div
        data-modal-panel
        style={{ transform: `translate(${offset.x}px, ${offset.y}px)` }}
        className="relative flex w-[640px] min-w-[320px] max-w-[95vw] flex-col overflow-hidden rounded-xl border border-AIPM-light-grey bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950"
      >
        <ModalHeader
          lang={lang}
          title={isNew ? t(lang, "shiftNewItem") : t(lang, "shiftEditItem", draft.id)}
          onClose={onClose}
          dragHandleProps={handleProps}
        />

        <form
          onSubmit={handleSubmit}
          className="grid grid-cols-1 gap-4 overflow-y-auto p-5 sm:grid-cols-2"
        >
          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="font-medium text-AIPM-dark-grey dark:text-AIPM-light-grey">
              {t(lang, "shiftAssignee")} *
            </span>
            <input
              type="text"
              required
              value={draft.assignee}
              onChange={(e) => {
                const name = e.target.value;
                update("assignee", name);
                const match = datalistOptions.find(
                  (o) => o.name.toLowerCase() === name.trim().toLowerCase(),
                );
                if (match?.email && !draft.assigneeEmail) {
                  update("assigneeEmail", match.email);
                }
              }}
              list={DATALIST_ID}
              placeholder={t(lang, "shiftPlaceholderAssignee")}
              className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
            <datalist id={DATALIST_ID}>
              {datalistOptions.map((o) => (
                <option key={o.name} value={o.name}>
                  {o.email ?? ""}
                </option>
              ))}
            </datalist>
          </label>

          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="font-medium text-AIPM-dark-grey dark:text-AIPM-light-grey">
              {t(lang, "shiftAssigneeEmail")}
            </span>
            <input
              type="email"
              value={draft.assigneeEmail ?? ""}
              onChange={(e) =>
                update("assigneeEmail", e.target.value || undefined)
              }
              className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>

          <div className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="font-medium text-AIPM-dark-grey dark:text-AIPM-light-grey">
              {t(lang, "shiftHoursPerDay")}
            </span>
            <div className="grid grid-cols-7 gap-2">
              {DAY_KEYS.map((labelKey, idx) => (
                <label key={labelKey} className="flex flex-col gap-1">
                  <span className="text-center text-[10px] uppercase tracking-wide text-AIPM-medium-grey">
                    {t(lang, labelKey)}
                  </span>
                  <input
                    type="number"
                    min={0}
                    max={MAX_HOURS_PER_DAY}
                    step={0.5}
                    value={draft.hoursPerWeekday[idx] ?? 0}
                    onChange={(e) =>
                      updateHour(idx, clampOnInput(e.target.value))
                    }
                    className="w-full rounded-md border border-zinc-300 bg-white px-1 py-1 text-center text-sm tabular-nums shadow-sm dark:border-zinc-700 dark:bg-zinc-900"
                  />
                </label>
              ))}
            </div>
            <span className="mt-1 text-[11px] text-AIPM-medium-grey">
              {t(lang, "resourcesWeeklyHours")}:{" "}
              <span className="tabular-nums">{weeklyTotal}</span>
            </span>
          </div>

          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="font-medium text-AIPM-dark-grey dark:text-AIPM-light-grey">
              {t(lang, "shiftNote")}
            </span>
            <textarea
              rows={2}
              value={draft.note ?? ""}
              onChange={(e) =>
                update("note", e.target.value || undefined)
              }
              placeholder={t(lang, "shiftPlaceholderNote")}
              className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>

          {error && (
            <p className="sm:col-span-2 text-sm text-red-600 dark:text-red-400">
              {error}
            </p>
          )}

          <footer className="flex items-center justify-between gap-2 border-t border-zinc-200 pt-3 sm:col-span-2 dark:border-zinc-800">
            <div>
              {!isNew && (
                <button
                  type="button"
                  onClick={handleDeleteClick}
                  className="rounded-md border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-700 shadow-sm hover:bg-red-50 dark:border-red-800 dark:bg-zinc-900 dark:text-red-400 dark:hover:bg-zinc-800"
                >
                  {t(lang, "delete")}
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-sm font-medium text-zinc-700 shadow-sm hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                {t(lang, "cancel")}
              </button>
              <button
                type="submit"
                className="rounded-md border border-AIPM-dark-blue bg-AIPM-dark-blue px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-AIPM-dark-blue/90"
              >
                {t(lang, "shiftSave")}
              </button>
            </div>
          </footer>
        </form>
      </div>
    </Modal>
  );
}

/** Helper for callers that need a default empty shift to seed the modal. */
export function emptyShiftDraft(id: number): Shift {
  return {
    id,
    assignee: "",
    assigneeEmail: undefined,
    hoursPerWeekday: DEFAULT_WEEK_HOURS,
    note: undefined,
  };
}
