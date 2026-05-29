// src/app/outlook-calendar-import-modal.tsx
"use client";

import { useMemo, useState } from "react";
import { type Lang, t } from "./i18n";
import { Modal } from "./modal";
import { dedupeKey, type OutlookEvent } from "./outlook-calendar";
import { ABSENCE_TYPES, type AbsenceType } from "./types";

export interface OutlookCalendarImportModalProps {
  lang: Lang;
  open: boolean;
  loading: boolean;
  error: string | null;
  events: OutlookEvent[];
  /** Display name the imported absences will be attributed to (for dedupe-key match). */
  targetAssignee: string;
  /** dedupeKey(assignee,start,end) of the target user's current absences. */
  existingKeys: ReadonlySet<string>;
  onConfirm: (rows: { event: OutlookEvent; type: AbsenceType }[]) => void;
  onClose: () => void;
}

const TYPE_LABEL_KEY: Record<AbsenceType, string> = {
  vacation: "absenceTypeVacation",
  sick: "absenceTypeSick",
  training: "absenceTypeTraining",
  other: "absenceTypeOther",
};

export function OutlookCalendarImportModal({
  lang,
  open,
  loading,
  error,
  events,
  targetAssignee,
  existingKeys,
  onConfirm,
  onClose,
}: OutlookCalendarImportModalProps) {
  const allIds = useMemo(() => events.map((e) => e.sourceId).join("|"), [events]);

  function defaultChecked(): Set<string> {
    return new Set(
      events
        .filter((e) => !existingKeys.has(dedupeKey(targetAssignee, e.startDate, e.endDate)))
        .map((e) => e.sourceId),
    );
  }
  function defaultTypes(): Record<string, AbsenceType> {
    return Object.fromEntries(events.map((e) => [e.sourceId, "vacation" as AbsenceType]));
  }

  const [prevIds, setPrevIds] = useState(allIds);
  const [checked, setChecked] = useState<Set<string>>(defaultChecked);
  const [types, setTypes] = useState<Record<string, AbsenceType>>(defaultTypes);
  if (prevIds !== allIds) {
    setPrevIds(allIds);
    setChecked(defaultChecked());
    setTypes(defaultTypes());
  }

  const selectedCount = checked.size;
  const allChecked = events.length > 0 && events.every((e) => checked.has(e.sourceId));

  function toggle(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setChecked(() => (allChecked ? new Set() : new Set(events.map((e) => e.sourceId))));
  }
  function setType(id: string, type: AbsenceType) {
    setTypes((prev) => ({ ...prev, [id]: type }));
  }
  function confirm() {
    onConfirm(
      events
        .filter((e) => checked.has(e.sourceId))
        .map((e) => ({ event: e, type: types[e.sourceId] ?? "vacation" })),
    );
  }

  const dateRange = (e: OutlookEvent) =>
    e.startDate === e.endDate ? e.startDate : `${e.startDate} – ${e.endDate}`;

  return (
    <Modal open={open} onClose={onClose} ariaLabel={t(lang, "outlookCalImportTitle")} align="center" zIndex={50}>
      <div className="flex max-h-[80vh] w-full max-w-xl flex-col overflow-hidden rounded-xl border border-line bg-surface">
        <header className="flex shrink-0 items-center justify-between border-b border-line px-6 py-4">
          <h2 className="text-lg font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey">
            {t(lang, "outlookCalImportTitle")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t(lang, "outlookCalImportCancel")}
            className="rounded-md p-2 text-AIPM-dark-grey hover:bg-surface-muted hover:text-AIPM-dark-blue"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="h-4 w-4">
              <path fillRule="evenodd" d="M4.28 4.28a.75.75 0 011.06 0L10 8.94l4.66-4.66a.75.75 0 111.06 1.06L11.06 10l4.66 4.66a.75.75 0 11-1.06 1.06L10 11.06l-4.66 4.66a.75.75 0 01-1.06-1.06L8.94 10 4.28 5.34a.75.75 0 010-1.06z" clipRule="evenodd" />
            </svg>
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-auto p-4">
          {loading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">{t(lang, "outlookCalImportLoading")}</p>
          ) : error ? (
            <p className="py-8 text-center text-sm text-AIPM-pink">{error}</p>
          ) : events.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">{t(lang, "outlookCalImportEmpty")}</p>
          ) : (
            <>
              <label className="mb-2 flex items-center gap-2 border-b border-line pb-2 text-sm font-medium text-foreground">
                <input type="checkbox" checked={allChecked} onChange={toggleAll} className="h-4 w-4" />
                <span>{t(lang, "outlookCalImportSelectAll")}</span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {t(lang, "outlookCalImportSelectedN", selectedCount)}
                </span>
              </label>
              <ul className="space-y-1">
                {events.map((e) => {
                  const exists = existingKeys.has(dedupeKey(targetAssignee, e.startDate, e.endDate));
                  const label = e.subject || t(lang, "outlookCalImportNoSubject");
                  return (
                    <li key={e.sourceId} className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-surface-muted">
                      <input
                        type="checkbox"
                        aria-label={`${label} ${dateRange(e)}`}
                        checked={checked.has(e.sourceId)}
                        onChange={() => toggle(e.sourceId)}
                        className="h-4 w-4"
                      />
                      <span className="min-w-0 flex-1 truncate font-medium text-foreground" title={label}>{label}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">{dateRange(e)}</span>
                      <select
                        aria-label={`${t(lang, "outlookCalImportType")} ${label}`}
                        value={types[e.sourceId] ?? "vacation"}
                        onChange={(ev) => setType(e.sourceId, ev.target.value as AbsenceType)}
                        className="shrink-0 rounded border border-line bg-surface-muted px-1.5 py-0.5 text-xs"
                      >
                        {ABSENCE_TYPES.map((ty) => (
                          <option key={ty} value={ty}>{t(lang, TYPE_LABEL_KEY[ty] as Parameters<typeof t>[1])}</option>
                        ))}
                      </select>
                      {exists && (
                        <span className="shrink-0 text-xs italic text-AIPM-purple">{t(lang, "outlookCalImportExisting")}</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>

        <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-line px-6 py-3">
          <button type="button" onClick={onClose} className="rounded-md border border-line bg-surface px-3 py-1.5 text-sm font-medium text-foreground hover:bg-surface-muted">
            {t(lang, "outlookCalImportCancel")}
          </button>
          <button
            type="button"
            onClick={confirm}
            disabled={selectedCount === 0 || loading || !!error}
            className="rounded-md border border-AIPM-dark-blue bg-AIPM-dark-blue px-3 py-1.5 text-sm font-medium text-white hover:bg-AIPM-dark-blue/90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t(lang, "outlookCalImportConfirm", selectedCount)}
          </button>
        </footer>
      </div>
    </Modal>
  );
}
