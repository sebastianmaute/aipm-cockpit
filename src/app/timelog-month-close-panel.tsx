"use client";
import { useId, useMemo, useState } from "react";
import { t, type Lang, type TranslationKey } from "./i18n";
import { Button } from "./button";
import { Select } from "./form-controls";
import { localeFor } from "./date-format";
import { loadActualsCache } from "./timelog-actuals-store";
import { timelogProjectLabel, type TimelogProjectRef } from "./timelog-match";
import {
  acceptMonth,
  closeNextMonth,
  monthToClose,
  previousMonth,
  reopenLastMonth,
  type MonthCloseCache,
  type MonthCloseRefusal,
  type MonthCloseResult,
} from "./timelog-month-close";
import type { TimelogLinks } from "./timelog-types";

/** How many fully ended months the first-month select offers at least. */
const FIRST_MONTH_CHOICES = 12;

/** How many months back the first-month select reaches at most, whatever the
 *  cached window says: its dates are shape-checked, not sense-checked. */
const MAX_MONTH_CHOICES = 60;

const REFUSAL_KEY: Record<MonthCloseRefusal, TranslationKey> = {
  "no-roll": "timelogCloseRefuseNoRoll",
  "not-ended": "timelogCloseRefuseNotEnded",
  "window-start": "timelogCloseRefuseWindowStart",
  "window-end": "timelogCloseRefuseWindowEnd",
  partial: "timelogCloseRefusePartial",
  "no-projects": "timelogCloseRefuseNoProjects",
  "projects-changed": "timelogCloseRefuseProjectsChanged",
  "not-closed": "timelogCloseRefuseNotClosed",
};

function monthLabel(month: string, lang: Lang): string {
  return new Date(`${month}-01T00:00:00Z`).toLocaleDateString(localeFor(lang), {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** The fully ended months before `today`, newest first: at least
 *  `FIRST_MONTH_CHOICES`, and back to `oldest` (the month the cached window
 *  starts in) when that is older (§699 M9). */
function endedMonths(today: string, oldest: string | undefined): string[] {
  const months: string[] = [];
  let month = previousMonth(today.slice(0, 7));
  while (
    months.length < FIRST_MONTH_CHOICES ||
    (months.length < MAX_MONTH_CHOICES && oldest !== undefined && month >= oldest)
  ) {
    months.push(month);
    month = previousMonth(month);
  }
  return months;
}

/** The cached roll, read fresh, as the close rule takes it. */
function readCache(cacheProjectId: string): MonthCloseCache {
  const entry = loadActualsCache(cacheProjectId);
  return {
    daily: entry?.daily,
    dailyWindow: entry?.dailyWindow,
    partial: entry?.partial,
    dailyProjects: entry?.dailyProjects,
  };
}

/** A cached project ref with a usable name. The cache checks only that
 *  `projectRefs` is an array, so each entry is checked here. */
function isNamedRef(v: unknown): v is TimelogProjectRef {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Partial<TimelogProjectRef>;
  return typeof r.id === "number" && typeof r.name === "string" && r.name.trim() !== "" && typeof r.no === "string";
}

/** The close's TimeLog projects by name from the cached refs, else by id (§699 M5). */
function projectNames(projectIds: readonly number[], refs: readonly unknown[]): string {
  return projectIds
    .map((id) => {
      const ref = refs.find((r): r is TimelogProjectRef => isNamedRef(r) && r.id === id);
      return ref ? timelogProjectLabel(ref) : String(id);
    })
    .join(", ");
}

type Confirming = null | "reopen" | "accept";

export function TimelogMonthClosePanel({
  lang,
  links,
  onLinksChange,
  cacheProjectId,
  today,
}: {
  lang: Lang;
  links: TimelogLinks;
  onLinksChange: (next: TimelogLinks) => void;
  cacheProjectId: string;
  today: string;
}) {
  const selectId = useId();
  const acceptId = useId();
  const close = links.close;
  // Read once per cache key, like the verdicts below.
  const cached = useMemo(() => loadActualsCache(cacheProjectId), [cacheProjectId]);
  const windowStart = cached?.dailyWindow?.from.slice(0, 7);
  const choices = useMemo(() => endedMonths(today, windowStart), [today, windowStart]);
  const [firstMonth, setFirstMonth] = useState(choices[0]);
  const [confirming, setConfirming] = useState<Confirming>(null);
  const closedMonths = useMemo(
    () => (close ? Object.keys(close.saved).filter((m) => m <= close.through).sort().reverse() : []),
    [close],
  );
  const [acceptPick, setAcceptPick] = useState<string | undefined>(undefined);
  // A pick that is no longer closed (reopened) falls back to the newest month.
  const acceptTarget = acceptPick !== undefined && closedMonths.includes(acceptPick) ? acceptPick : closedMonths[0];

  const verdict = useMemo(
    () => closeNextMonth({ close, firstMonth, cache: readCache(cacheProjectId), today }),
    [close, firstMonth, cacheProjectId, today],
  );
  const acceptVerdict: MonthCloseResult | null = useMemo(
    () =>
      close && acceptTarget !== undefined
        ? acceptMonth({ close, month: acceptTarget, cache: readCache(cacheProjectId), today })
        : null,
    [close, acceptTarget, cacheProjectId, today],
  );
  const target = monthToClose(close, firstMonth);
  const targetLabel = monthLabel(target, lang);
  const refusalText = (r: MonthCloseResult | null): string | null =>
    r && !r.ok ? t(lang, REFUSAL_KEY[r.reason], monthLabel(r.month, lang)) : null;
  const closeRefusal = refusalText(verdict);
  const acceptRefusal = refusalText(acceptVerdict);

  const doClose = () => {
    const result = closeNextMonth({ close, firstMonth, cache: readCache(cacheProjectId), today });
    if (result.ok) onLinksChange({ ...links, close: result.close });
  };
  const doReopen = () => {
    if (!close) return;
    const reopened = reopenLastMonth(close);
    if (reopened) onLinksChange({ ...links, close: reopened });
    else {
      const { close: _dropped, ...rest } = links;
      void _dropped;
      onLinksChange(rest);
    }
    setConfirming(null);
  };
  const doAccept = () => {
    if (close && acceptTarget !== undefined) {
      const result = acceptMonth({ close, month: acceptTarget, cache: readCache(cacheProjectId), today });
      if (result.ok) onLinksChange({ ...links, close: result.close });
    }
    setConfirming(null);
  };

  return (
    <div className="mt-4 border-t border-line pt-3">
      <h3 className="mb-1 text-sm font-medium text-foreground">{t(lang, "timelogCloseTitle")}</h3>
      <p className="mb-2 text-xs text-muted-foreground">{t(lang, "timelogCloseHelp")}</p>
      <p className="mb-2 text-sm text-foreground">
        {close
          ? t(lang, "timelogCloseThrough", monthLabel(close.through, lang))
          : t(lang, "timelogCloseNone")}
      </p>
      {close && (
        <p className="mb-2 text-xs text-muted-foreground">
          {t(lang, "timelogCloseProjects", projectNames(close.projectIds, cached?.projectRefs ?? []))}
        </p>
      )}
      {!close && (
        <div className="mb-2 flex items-center gap-2">
          <label htmlFor={selectId} className="text-xs text-muted-foreground">
            {t(lang, "timelogCloseFirstMonth")}
          </label>
          <Select id={selectId} value={firstMonth} onChange={(e) => setFirstMonth(e.target.value)}>
            {choices.map((m) => (
              <option key={m} value={m}>
                {monthLabel(m, lang)}
              </option>
            ))}
          </Select>
        </div>
      )}
      {closeRefusal !== null && (
        <p role="status" className="mb-2 text-xs text-muted-foreground">
          {closeRefusal}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" onClick={doClose} disabled={!verdict.ok}>
          {t(lang, "timelogCloseButton", targetLabel)}
        </Button>
        {close && confirming === null && (
          <Button variant="secondary" size="sm" onClick={() => setConfirming("reopen")}>
            {t(lang, "timelogReopenButton", monthLabel(close.through, lang))}
          </Button>
        )}
      </div>
      {close && confirming === "reopen" && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-xs text-foreground">
            {t(lang, "timelogReopenConfirm", monthLabel(close.through, lang))}
          </span>
          <Button variant="secondary" size="sm" onClick={doReopen}>
            {t(lang, "timelogReopenConfirmYes")}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setConfirming(null)}>
            {t(lang, "cancel")}
          </Button>
        </div>
      )}
      {close && acceptTarget !== undefined && (
        <AcceptMonthControls
          lang={lang}
          selectId={acceptId}
          months={closedMonths}
          target={acceptTarget}
          onPick={setAcceptPick}
          canAccept={acceptVerdict?.ok === true}
          // Stated once when the close shows the same text (§699 I4).
          refusal={acceptRefusal !== closeRefusal ? acceptRefusal : null}
          confirming={confirming}
          onAsk={() => setConfirming("accept")}
          onConfirm={doAccept}
          onCancel={() => setConfirming(null)}
        />
      )}
    </div>
  );
}

/** §699 I4 — choose a closed month and accept its current hours, behind an
 *  in-page confirmation. Only one confirmation row is open at a time. */
function AcceptMonthControls({
  lang,
  selectId,
  months,
  target,
  onPick,
  canAccept,
  refusal,
  confirming,
  onAsk,
  onConfirm,
  onCancel,
}: {
  lang: Lang;
  selectId: string;
  months: readonly string[];
  target: string;
  onPick: (month: string) => void;
  canAccept: boolean;
  refusal: string | null;
  confirming: Confirming;
  onAsk: () => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const label = monthLabel(target, lang);
  return (
    <div className="mt-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <label htmlFor={selectId} className="text-xs text-muted-foreground">
          {t(lang, "timelogAcceptMonth")}
        </label>
        <Select id={selectId} value={target} onChange={(e) => onPick(e.target.value)}>
          {months.map((m) => (
            <option key={m} value={m}>
              {monthLabel(m, lang)}
            </option>
          ))}
        </Select>
        {confirming === null && (
          <Button variant="secondary" size="sm" onClick={onAsk} disabled={!canAccept}>
            {t(lang, "timelogAcceptButton", label)}
          </Button>
        )}
      </div>
      {refusal !== null && (
        <p role="status" className="mb-2 text-xs text-muted-foreground">
          {refusal}
        </p>
      )}
      {confirming === "accept" && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-foreground">{t(lang, "timelogAcceptConfirm", label)}</span>
          <Button variant="secondary" size="sm" onClick={onConfirm}>
            {t(lang, "timelogAcceptConfirmYes")}
          </Button>
          <Button variant="secondary" size="sm" onClick={onCancel}>
            {t(lang, "cancel")}
          </Button>
        </div>
      )}
    </div>
  );
}
