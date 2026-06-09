"use client";

// Shift editor modal — used by the Resources panel for create / edit /
// delete. State is owned here (the draft is populated from the `shift`
// prop on open and kept locally); the parent receives the final record
// via `onSave`. Validation: assignee required + non-duplicate; each
// per-weekday hour value 0–24.
//
// Phase 4 of the Resource Planner. See docs/RESOURCE-PLANNER-PLAN.md.

import { useState } from "react";
import { type Lang, t } from "./i18n";
import { Modal } from "./modal";
import { ModalHeader } from "./modal-header";
import { AssigneeField, ModalEditFooter } from "./modal-edit-fields";
import { useDraggable } from "./use-draggable";
import {
  MAX_HOURS_PER_DAY,
  type Shift,
  type WeekHours,
} from "./types";
import { FieldNotice } from "./field-feedback";
import { describeClamp } from "./sanitize-report";

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
  const [hourNotice, setHourNotice] = useState<Record<number, string>>({});

  if (prevShift !== shift) {
    setPrevShift(shift);
    setDraft(shift);
    setError(null);
  }

  const { offset, handleProps } = useDraggable(draft !== null);

  // Escape, focus management, and backdrop-click are owned by <Modal>.

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
        className="relative flex w-[640px] min-w-[320px] max-w-[95vw] flex-col overflow-hidden rounded-xl border border-line bg-surface"
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
          <AssigneeField
            datalistId={DATALIST_ID}
            assignee={draft.assignee}
            assigneeEmail={draft.assigneeEmail}
            knownAssignees={knownAssignees}
            onAssigneeChange={(name) => update("assignee", name)}
            onEmailChange={(email) => update("assigneeEmail", email)}
            assigneeLabel={t(lang, "shiftAssignee")}
            assigneeEmailLabel={t(lang, "shiftAssigneeEmail")}
            assigneePlaceholder={t(lang, "shiftPlaceholderAssignee")}
          />

          <div className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="font-medium text-foreground">
              {t(lang, "shiftHoursPerDay")}
            </span>
            <div className="grid grid-cols-7 gap-2">
              {DAY_KEYS.map((labelKey, idx) => (
                <label key={labelKey} className="flex flex-col gap-1">
                  <span className="text-center text-[10px] uppercase tracking-wide text-muted-foreground">
                    {t(lang, labelKey)}
                  </span>
                  <input
                    type="number"
                    min={0}
                    max={MAX_HOURS_PER_DAY}
                    step={0.5}
                    value={draft.hoursPerWeekday[idx] ?? 0}
                    onChange={(e) =>
                      updateHour(idx, Number(e.target.value))
                    }
                    onBlur={(e) => {
                      const r = describeClamp(e.target.value, { min: 0, max: MAX_HOURS_PER_DAY, round: 1 });
                      updateHour(idx, r.value ?? 0);
                      const adj = r.adjustment?.kind === "clamped" ? r.adjustment : null;
                      setHourNotice((n) => ({
                        ...n,
                        [idx]: adj
                          ? t(lang, adj.bound === "max" ? "fieldAdjustedMax" : "fieldAdjustedMin", adj.to)
                          : "",
                      }));
                    }}
                    className="w-full rounded-md border border-line bg-surface px-1 py-1 text-center text-sm tabular-nums"
                  />
                  <FieldNotice>{hourNotice[idx]}</FieldNotice>
                </label>
              ))}
            </div>
            <span className="mt-1 text-[11px] text-muted-foreground">
              {t(lang, "resourcesWeeklyHours")}:{" "}
              <span className="tabular-nums">{weeklyTotal}</span>
            </span>
          </div>

          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="font-medium text-foreground">
              {t(lang, "shiftNote")}
            </span>
            <textarea
              rows={2}
              value={draft.note ?? ""}
              onChange={(e) =>
                update("note", e.target.value || undefined)
              }
              placeholder={t(lang, "shiftPlaceholderNote")}
              className="rounded-md border border-line bg-surface px-3 py-2 text-sm"
            />
          </label>

          {error && (
            <p className="sm:col-span-2 text-sm text-AIPM-pink">
              {error}
            </p>
          )}

          <ModalEditFooter
            lang={lang}
            isNew={isNew}
            onDelete={handleDeleteClick}
            onClose={onClose}
            saveLabel={t(lang, "shiftSave")}
          />
        </form>
      </div>
    </Modal>
  );
}
