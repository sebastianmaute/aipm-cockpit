// src/app/outlook-calendar-import-modal.tsx
"use client";

import { useMemo, useState } from "react";
import { type Lang, t } from "./i18n";
import { Checkbox, Select } from "./form-controls";
import { dedupeKey, type OutlookEvent } from "./outlook-calendar";
import { ABSENCE_TYPES, type AbsenceType } from "./types";
import { useImportSelection } from "./use-import-selection";
import { PickListImportModal } from "./pick-list-import-modal";
import { buildRowTokens } from "./row-tokens";

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

const eventId = (e: OutlookEvent) => e.sourceId;
const dateRange = (e: OutlookEvent) =>
  e.startDate === e.endDate ? e.startDate : `${e.startDate} – ${e.endDate}`;

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
  const sel = useImportSelection(
    events,
    eventId,
    (e) => !existingKeys.has(dedupeKey(targetAssignee, e.startDate, e.endDate)),
  );

  // Per-row absence type is bespoke to this modal (not selection) — kept local,
  // with its own id-change reconcile so a fresh fetch re-seeds the defaults.
  const allIds = useMemo(() => events.map(eventId).join("|"), [events]);
  const defaultTypes = () =>
    Object.fromEntries(events.map((e) => [e.sourceId, "vacation" as AbsenceType]));
  const [prevTypeIds, setPrevTypeIds] = useState(allIds);
  const [types, setTypes] = useState<Record<string, AbsenceType>>(defaultTypes);
  if (prevTypeIds !== allIds) {
    setPrevTypeIds(allIds);
    setTypes(defaultTypes());
  }

  const setType = (id: string, type: AbsenceType) =>
    setTypes((prev) => ({ ...prev, [id]: type }));

  // §316 — a recurring meeting imports as many events under one subject, so the
  // per-row controls are named by subject AND dates, made row-unique in case
  // even those repeat.
  const rowTokens = useMemo(
    () =>
      buildRowTokens(
        events.map((e) => ({ id: e.sourceId, name: `${e.subject || t(lang, "outlookCalImportNoSubject")} ${dateRange(e)}` })),
      ),
    [events, lang],
  );

  return (
    <PickListImportModal
      open={open}
      onClose={onClose}
      ariaLabel={t(lang, "outlookCalImportTitle")}
      title={t(lang, "outlookCalImportTitle")}
      cancelLabel={t(lang, "outlookCalImportCancel")}
      confirmLabel={t(lang, "outlookCalImportConfirm", sel.selectedCount)}
      loading={loading}
      error={error}
      isEmpty={events.length === 0}
      loadingText={t(lang, "outlookCalImportLoading")}
      emptyText={t(lang, "outlookCalImportEmpty")}
      selectAllLabel={t(lang, "outlookCalImportSelectAll")}
      selectedText={t(lang, "outlookCalImportSelectedN", sel.selectedCount)}
      allChecked={sel.allChecked}
      onToggleAll={sel.toggleAll}
      selectedCount={sel.selectedCount}
      onConfirm={() =>
        onConfirm(
          sel.selected().map((e) => ({ event: e, type: types[e.sourceId] ?? "vacation" })),
        )
      }
      maxWidthClass="max-w-xl"
    >
      {events.map((e) => {
        const exists = existingKeys.has(dedupeKey(targetAssignee, e.startDate, e.endDate));
        const label = e.subject || t(lang, "outlookCalImportNoSubject");
        const token = rowTokens.get(e.sourceId) ?? `${label} ${dateRange(e)}`;
        return (
          <li key={e.sourceId} className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-surface-muted">
            <Checkbox
              aria-label={token}
              checked={sel.isChecked(e.sourceId)}
              onChange={() => sel.toggle(e.sourceId)}
            />
            <span className="min-w-0 flex-1 truncate font-medium text-foreground" title={label}>{label}</span>
            <span className="shrink-0 text-xs text-muted-foreground">{dateRange(e)}</span>
            <Select
              aria-label={`${t(lang, "outlookCalImportType")} ${token}`}
              value={types[e.sourceId] ?? "vacation"}
              onChange={(ev) => setType(e.sourceId, ev.target.value as AbsenceType)}
              size="xs" className="shrink-0"
            >
              {ABSENCE_TYPES.map((ty) => (
                <option key={ty} value={ty}>{t(lang, TYPE_LABEL_KEY[ty] as Parameters<typeof t>[1])}</option>
              ))}
            </Select>
            {exists && (
              <span className="shrink-0 text-xs italic text-ui-purple dark:text-ui-purple-strong">{t(lang, "outlookCalImportExisting")}</span>
            )}
          </li>
        );
      })}
    </PickListImportModal>
  );
}
