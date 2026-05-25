"use client";

// Absence editor modal — used by the Resources panel for create / edit /
// delete. State is owned here (the draft is populated from the `absence`
// prop on open and kept locally); the parent receives the final record via
// `onSave`. Validation: assignee + start + end required, end >= start.
//
// Type uses the new `SegmentedControl`. Assignee uses a plain input with a
// HTML5 datalist autocomplete of known assignees so the user can either
// pick an existing person or type a new one.

import { useMemo, useState } from "react";
import { type Lang, t } from "./i18n";
import { Modal } from "./modal";
import { SegmentedControl } from "./segmented-control";
import { ABSENCE_TYPES, type Absence, type AbsenceType } from "./types";

interface Props {
  lang: Lang;
  /** When null the modal is hidden. */
  absence: Absence | null;
  /** True when creating; false when editing an existing record. */
  isNew: boolean;
  /** Known assignees from tasks / existing absences for the datalist. */
  knownAssignees: ReadonlyArray<{ name: string; email?: string }>;
  onSave: (next: Absence) => void;
  onDelete: (id: number) => void;
  onClose: () => void;
}

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

const DATALIST_ID = "absence-assignee-options";

export function AbsenceEditModal({
  lang,
  absence,
  isNew,
  knownAssignees,
  onSave,
  onDelete,
  onClose,
}: Props) {
  // Local draft mirrors the absence prop. Reset whenever the prop changes
  // (open with a new record, or switch from one absence to another).
  const [prevAbsence, setPrevAbsence] = useState(absence);
  const [draft, setDraft] = useState<Absence | null>(absence);
  const [error, setError] = useState<string | null>(null);

  if (prevAbsence !== absence) {
    setPrevAbsence(absence);
    setDraft(absence);
    setError(null);
  }

  // Escape, focus management, and backdrop-click are owned by <Modal>.

  const datalistOptions = useMemo(() => {
    // Deduplicate by case-folded name; keep the first observed casing.
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

  function update<K extends keyof Absence>(key: K, value: Absence[K]) {
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));
    setError(null);
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!draft) return;
    const assignee = draft.assignee.trim();
    const startDate = draft.startDate.trim();
    const endDate = draft.endDate.trim();
    if (!assignee || !startDate || !endDate) {
      setError(t(lang, "absenceErrorRequired"));
      return;
    }
    if (endDate < startDate) {
      setError(t(lang, "absenceErrorEndBeforeStart"));
      return;
    }
    const cleanedEmail = draft.assigneeEmail?.trim() || undefined;
    const cleanedNote = draft.note?.trim() || undefined;
    onSave({
      ...draft,
      assignee,
      assigneeEmail: cleanedEmail,
      startDate,
      endDate,
      note: cleanedNote,
    });
  }

  function handleDeleteClick() {
    if (!draft) return;
    if (window.confirm(t(lang, "absenceConfirmDelete"))) {
      onDelete(draft.id);
    }
  }

  if (!draft) return null;

  return (
    <Modal
      open
      onClose={onClose}
      ariaLabel={
        isNew
          ? t(lang, "absenceNewItem")
          : t(lang, "absenceEditItem", draft.id)
      }
      align="center"
      backdropClassName="bg-black/40"
      zIndex={50}
    >
      <div className="relative flex w-[560px] min-w-[320px] max-w-[95vw] flex-col overflow-hidden rounded-xl border border-AIPM-light-grey bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950">
        <header className="flex shrink-0 items-center justify-between border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
          <h3 className="text-base font-semibold text-AIPM-dark-grey dark:text-AIPM-light-grey">
            {isNew
              ? t(lang, "absenceNewItem")
              : t(lang, "absenceEditItem", draft.id)}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label={t(lang, "cancel")}
            className="rounded p-1 text-AIPM-dark-grey hover:bg-AIPM-light-grey hover:text-AIPM-dark-blue dark:text-AIPM-medium-grey dark:hover:bg-zinc-800 dark:hover:text-AIPM-light-grey"
          >
            <svg
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
              className="h-4 w-4"
            >
              <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
            </svg>
          </button>
        </header>

        <form
          onSubmit={handleSubmit}
          className="grid grid-cols-1 gap-4 overflow-y-auto p-5 sm:grid-cols-2"
        >
          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="font-medium text-AIPM-dark-grey dark:text-AIPM-light-grey">
              {t(lang, "absenceAssignee")} *
            </span>
            <input
              type="text"
              required
              value={draft.assignee}
              onChange={(e) => {
                const name = e.target.value;
                update("assignee", name);
                // Auto-fill email when the typed name matches a known one.
                const match = datalistOptions.find(
                  (o) => o.name.toLowerCase() === name.trim().toLowerCase(),
                );
                if (match?.email && !draft.assigneeEmail) {
                  update("assigneeEmail", match.email);
                }
              }}
              list={DATALIST_ID}
              placeholder={t(lang, "absencePlaceholderAssignee")}
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
              {t(lang, "absenceAssigneeEmail")}
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

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-AIPM-dark-grey dark:text-AIPM-light-grey">
              {t(lang, "absenceStart")} *
            </span>
            <input
              type="date"
              required
              value={draft.startDate}
              onChange={(e) => update("startDate", e.target.value)}
              className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>

          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-AIPM-dark-grey dark:text-AIPM-light-grey">
              {t(lang, "absenceEnd")} *
            </span>
            <input
              type="date"
              required
              value={draft.endDate}
              onChange={(e) => update("endDate", e.target.value)}
              className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>

          <div className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="font-medium text-AIPM-dark-grey dark:text-AIPM-light-grey">
              {t(lang, "absenceType")}
            </span>
            <SegmentedControl<AbsenceType>
              value={draft.type}
              ariaLabel={t(lang, "absenceType")}
              options={ABSENCE_TYPES.map((tp) => ({
                value: tp,
                label:
                  tp === "vacation"
                    ? t(lang, "absenceTypeVacation")
                    : tp === "sick"
                      ? t(lang, "absenceTypeSick")
                      : tp === "training"
                        ? t(lang, "absenceTypeTraining")
                        : t(lang, "absenceTypeOther"),
              }))}
              onChange={(tp) => update("type", tp)}
            />
          </div>

          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="font-medium text-AIPM-dark-grey dark:text-AIPM-light-grey">
              {t(lang, "absenceNote")}
            </span>
            <textarea
              rows={2}
              value={draft.note ?? ""}
              onChange={(e) =>
                update("note", e.target.value || undefined)
              }
              placeholder={t(lang, "absencePlaceholderNote")}
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
                {t(lang, "absenceSave")}
              </button>
            </div>
          </footer>
        </form>
      </div>
    </Modal>
  );
}

/** Helper for callers that need a default empty absence to seed the modal. */
export function emptyAbsenceDraft(id: number): Absence {
  const today = isoToday();
  return {
    id,
    assignee: "",
    assigneeEmail: undefined,
    startDate: today,
    endDate: today,
    type: "vacation",
    note: undefined,
  };
}
