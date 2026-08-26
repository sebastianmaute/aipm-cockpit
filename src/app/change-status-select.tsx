"use client";
// src/app/change-status-select.tsx — shared inline change-status <select>.
// Mirrors task-status-select.tsx: the row-UNIQUE accessible name lives in one
// place, because the Changes view is axe-scanned and the gate cannot see N
// identical "Status" labels (WCAG 2.4.6). The label mapping lives here too, so
// the panel and any future consumer cannot drift.
import { type Lang, type TranslationKey, t } from "./i18n";
import { CHANGE_STATUSES, type ChangeItem, type ChangeStatus } from "./types";
import { FOCUS_RING, TRANSITION } from "./interaction-styles";
import { rowLabel } from "./row-tokens";

/** Status → i18n key. MOVED here verbatim from change-panel.tsx so the row
 *  select, the filter dropdown and any future consumer share one mapping. */
export const CHANGE_STATUS_KEY: Record<ChangeStatus, TranslationKey> = {
  Proposed: "changeStatusProposed",
  "Under Review": "changeStatusUnderReview",
  Approved: "changeStatusApproved",
  Rejected: "changeStatusRejected",
  Implemented: "changeStatusImplemented",
  Deferred: "changeStatusDeferred",
};

export function changeStatusLabel(s: ChangeStatus, lang: Lang): string {
  return t(lang, CHANGE_STATUS_KEY[s]);
}

interface ChangeStatusSelectProps {
  lang: Lang;
  item: Pick<ChangeItem, "id" | "title" | "status">;
  /** ★★ REQUIRED, deliberately. An optional prop defaulting to `item.title`
   *  inside this component would compile at a caller that forgot it and ship
   *  the collision silently; required means tsc enumerates the misses. The
   *  fallback lives at the LIST owner, where the map lookup happens. */
  rowToken: string;
  onStatusChange: (id: number, next: ChangeStatus) => void;
}

export function ChangeStatusSelect({ lang, item, rowToken, onStatusChange }: ChangeStatusSelectProps) {
  return (
    <select
      aria-label={rowLabel(t(lang, "changeFieldStatus"), rowToken)}
      value={item.status}
      onChange={(e) => onStatusChange(item.id, e.target.value as ChangeStatus)}
      className={`rounded border border-line px-1.5 py-0.5 text-xs font-medium hover:border-ui-dark-blue ${FOCUS_RING} ${TRANSITION}`}
    >
      {CHANGE_STATUSES.map((s) => (
        <option key={s} value={s}>{changeStatusLabel(s, lang)}</option>
      ))}
    </select>
  );
}
