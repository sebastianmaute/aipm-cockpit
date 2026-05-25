"use client";

// Resource address-book editor modal — create / edit / delete a Resource.
// Mirrors AbsenceEditModal's structure: local `draft` state synced from prop
// via useEffect, `update(key, value)` helper, footer with Delete/Cancel/Save.
// Does NOT edit discipline/grade (those are owned by the Roles modal).

import { useEffect, useState } from "react";
import { type Lang, t } from "./i18n";
import { Modal } from "./modal";
import type { Resource } from "./types";

interface Props {
  lang: Lang;
  /** When null the modal is hidden. */
  resource: Resource | null;
  /** True when creating; false when editing an existing record. */
  isNew: boolean;
  onSave: (r: Resource) => void;
  onDelete: (id: number) => void;
  onClose: () => void;
}

const pad2 = (n: number) => String(n).padStart(2, "0");

function parseBirthday(b?: string): { mm: string; dd: string } {
  const m = (b ?? "").match(/^(\d{2})-(\d{2})$/);
  return m ? { mm: m[1], dd: m[2] } : { mm: "", dd: "" };
}

const months = Array.from({ length: 12 }, (_, i) => pad2(i + 1));
const days = Array.from({ length: 31 }, (_, i) => pad2(i + 1));

export function ResourceEditModal({
  lang,
  resource,
  isNew,
  onSave,
  onDelete,
  onClose,
}: Props) {
  const [draft, setDraft] = useState<Resource | null>(resource);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setDraft(resource);
    setError(null);
  }, [resource]);

  function update<K extends keyof Resource>(key: K, value: Resource[K]) {
    setDraft((prev) => (prev ? { ...prev, [key]: value } : prev));
    setError(null);
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!draft) return;
    const firstName = (draft.firstName ?? "").trim();
    const lastName = (draft.lastName ?? "").trim();
    if (!firstName && !lastName) {
      setError(t(lang, "resourceErrorName"));
      return;
    }
    const clean: Resource = {
      ...draft,
      firstName,
      lastName,
      title: draft.title?.trim() || undefined,
      company: draft.company?.trim() || undefined,
      department: draft.department?.trim() || undefined,
      location: draft.location?.trim() || undefined,
      businessPhone: draft.businessPhone?.trim() || undefined,
      email: draft.email?.trim() || undefined,
      notes: draft.notes?.trim() || undefined,
    };
    onSave(clean);
  }

  function handleDeleteClick() {
    if (!draft) return;
    if (window.confirm(t(lang, "resourceConfirmDelete"))) {
      onDelete(draft.id);
    }
  }

  if (!draft) return null;

  const { mm, dd } = parseBirthday(draft.birthday);

  function handleBirthdayChange(newMm: string, newDd: string) {
    if (newMm && newDd) {
      update("birthday", `${newMm}-${newDd}`);
    } else {
      update("birthday", undefined);
    }
  }

  return (
    <Modal
      open
      onClose={onClose}
      ariaLabel={isNew ? t(lang, "resourceNewTitle") : t(lang, "resourceEditTitle")}
      align="center"
      backdropClassName="bg-black/40"
      zIndex={50}
    >
      <div className="relative flex w-[560px] min-w-[320px] max-w-[95vw] flex-col overflow-hidden rounded-xl border border-AIPM-light-grey bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950">
        <header className="flex shrink-0 items-center justify-between border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
          <h3 className="text-base font-semibold text-AIPM-dark-grey dark:text-AIPM-light-grey">
            {isNew ? t(lang, "resourceNewTitle") : t(lang, "resourceEditTitle")}
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
          {/* First name */}
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-AIPM-dark-grey dark:text-AIPM-light-grey">
              {t(lang, "resourceFirstName")}
            </span>
            <input
              type="text"
              value={draft.firstName ?? ""}
              onChange={(e) => update("firstName", e.target.value)}
              className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>

          {/* Last name */}
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-AIPM-dark-grey dark:text-AIPM-light-grey">
              {t(lang, "resourceLastName")}
            </span>
            <input
              type="text"
              value={draft.lastName ?? ""}
              onChange={(e) => update("lastName", e.target.value)}
              className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>

          {/* Job title */}
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-AIPM-dark-grey dark:text-AIPM-light-grey">
              {t(lang, "resourceJobTitle")}
            </span>
            <input
              type="text"
              value={draft.title ?? ""}
              onChange={(e) => update("title", e.target.value || undefined)}
              className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>

          {/* Company */}
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-AIPM-dark-grey dark:text-AIPM-light-grey">
              {t(lang, "resourceCompany")}
            </span>
            <input
              type="text"
              value={draft.company ?? ""}
              onChange={(e) => update("company", e.target.value || undefined)}
              className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>

          {/* Department */}
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-AIPM-dark-grey dark:text-AIPM-light-grey">
              {t(lang, "resourceDepartment")}
            </span>
            <input
              type="text"
              value={draft.department ?? ""}
              onChange={(e) => update("department", e.target.value || undefined)}
              className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>

          {/* Location */}
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-AIPM-dark-grey dark:text-AIPM-light-grey">
              {t(lang, "resourceLocation")}
            </span>
            <input
              type="text"
              value={draft.location ?? ""}
              onChange={(e) => update("location", e.target.value || undefined)}
              className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>

          {/* Business phone */}
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-AIPM-dark-grey dark:text-AIPM-light-grey">
              {t(lang, "resourcePhone")}
            </span>
            <input
              type="tel"
              value={draft.businessPhone ?? ""}
              onChange={(e) =>
                update("businessPhone", e.target.value || undefined)
              }
              className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>

          {/* Email */}
          <label className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-AIPM-dark-grey dark:text-AIPM-light-grey">
              {t(lang, "resourceEmail")}
            </span>
            <input
              type="email"
              value={draft.email ?? ""}
              onChange={(e) => update("email", e.target.value || undefined)}
              className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>

          {/* Birthday — two selects */}
          <div className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="font-medium text-AIPM-dark-grey dark:text-AIPM-light-grey">
              {t(lang, "resourceBirthday")}
            </span>
            <div className="flex gap-2">
              <label className="flex flex-1 flex-col gap-1 text-sm">
                <span className="sr-only">{t(lang, "resourceBirthdayMonth")}</span>
                <select
                  value={mm}
                  onChange={(e) => handleBirthdayChange(e.target.value, dd ?? "")}
                  aria-label={t(lang, "resourceBirthdayMonth")}
                  className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm dark:border-zinc-700 dark:bg-zinc-900"
                >
                  <option value="">{t(lang, "resourceBirthdayMonth")}</option>
                  {months.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-1 flex-col gap-1 text-sm">
                <span className="sr-only">{t(lang, "resourceBirthdayDay")}</span>
                <select
                  value={dd}
                  onChange={(e) => handleBirthdayChange(mm ?? "", e.target.value)}
                  aria-label={t(lang, "resourceBirthdayDay")}
                  className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm dark:border-zinc-700 dark:bg-zinc-900"
                >
                  <option value="">{t(lang, "resourceBirthdayDay")}</option>
                  {days.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>

          {/* Notes — full width textarea */}
          <label className="flex flex-col gap-1 text-sm sm:col-span-2">
            <span className="font-medium text-AIPM-dark-grey dark:text-AIPM-light-grey">
              {t(lang, "resourceNotes")}
            </span>
            <textarea
              rows={3}
              value={draft.notes ?? ""}
              onChange={(e) => update("notes", e.target.value || undefined)}
              className="rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm shadow-sm dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>

          {error && (
            <p className="text-sm text-red-600 sm:col-span-2 dark:text-red-400">
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
                {t(lang, "resourceSave")}
              </button>
            </div>
          </footer>
        </form>
      </div>
    </Modal>
  );
}
