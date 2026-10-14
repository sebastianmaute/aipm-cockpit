"use client";
import { useId, useMemo, useState } from "react";
import { t, type Lang, type TranslationKey } from "./i18n";
import { Button } from "./button";
import { Select } from "./form-controls";
import { localeFor } from "./date-format";
import { loadActualsCache } from "./timelog-actuals-store";
import {
  closeNextMonth,
  monthToClose,
  previousMonth,
  reopenLastMonth,
  type MonthCloseCache,
  type MonthCloseRefusal,
} from "./timelog-month-close";
import type { TimelogLinks } from "./timelog-types";

/** How many fully ended months the first-month select offers. */
const FIRST_MONTH_CHOICES = 12;

const REFUSAL_KEY: Record<MonthCloseRefusal, TranslationKey> = {
  "no-roll": "timelogCloseRefuseNoRoll",
  "not-ended": "timelogCloseRefuseNotEnded",
  "window-start": "timelogCloseRefuseWindowStart",
  "window-end": "timelogCloseRefuseWindowEnd",
  partial: "timelogCloseRefusePartial",
  "no-projects": "timelogCloseRefuseNoProjects",
  "projects-changed": "timelogCloseRefuseProjectsChanged",
};

function monthLabel(month: string, lang: Lang): string {
  return new Date(`${month}-01T00:00:00Z`).toLocaleDateString(localeFor(lang), {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** The fully ended months before `today`, newest first. */
function endedMonths(today: string): string[] {
  const months: string[] = [];
  let month = previousMonth(today.slice(0, 7));
  for (let i = 0; i < FIRST_MONTH_CHOICES; i += 1) {
    months.push(month);
    month = previousMonth(month);
  }
  return months;
}

/** Reads the cached roll fresh and asks the close rule whether the next month may close. */
function attemptClose(
  close: TimelogLinks["close"],
  firstMonth: string,
  cacheProjectId: string,
  linkedUserIds: readonly number[],
  today: string,
) {
  const entry = loadActualsCache(cacheProjectId);
  const cache: MonthCloseCache = {
    daily: entry?.daily,
    dailyWindow: entry?.dailyWindow,
    partial: entry?.partial,
    dailyProjects: entry?.dailyProjects,
  };
  return closeNextMonth({ close, firstMonth, cache, linkedUserIds, today });
}

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
  const close = links.close;
  const choices = useMemo(() => endedMonths(today), [today]);
  const [firstMonth, setFirstMonth] = useState(choices[0]);
  const [confirming, setConfirming] = useState(false);
  const linkedUserIds = useMemo(
    () => [...new Set(links.userLinks.map((l) => l.timelogUserId))],
    [links.userLinks],
  );

  const verdict = useMemo(
    () => attemptClose(close, firstMonth, cacheProjectId, linkedUserIds, today),
    [close, firstMonth, cacheProjectId, linkedUserIds, today],
  );
  const target = monthToClose(close, firstMonth);
  const targetLabel = monthLabel(target, lang);

  const doClose = () => {
    const result = attemptClose(close, firstMonth, cacheProjectId, linkedUserIds, today);
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
    setConfirming(false);
  };

  const names = useMemo(() => {
    const byId = new Map<number, string>();
    for (const u of loadActualsCache(cacheProjectId)?.users ?? []) {
      const name = `${u.firstName} ${u.lastName}`.trim();
      if (name) byId.set(u.userId, name);
    }
    return byId;
  }, [cacheProjectId]);
  // A linked person missing from ANY saved month has no saved copy there, so
  // every booking of theirs in that month is flagged (§699).
  const linkedLater = close
    ? linkedUserIds.filter((id) => Object.values(close.saved).some((m) => m[String(id)] === undefined))
    : [];

  return (
    <div className="mt-4 border-t border-line pt-3">
      <h3 className="mb-1 text-sm font-medium text-foreground">{t(lang, "timelogCloseTitle")}</h3>
      <p className="mb-2 text-xs text-muted-foreground">{t(lang, "timelogCloseHelp")}</p>
      <p className="mb-2 text-sm text-foreground">
        {close
          ? t(lang, "timelogCloseThrough", monthLabel(close.through, lang))
          : t(lang, "timelogCloseNone")}
      </p>
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
      {!verdict.ok && (
        <p role="status" className="mb-2 text-xs text-muted-foreground">
          {t(lang, REFUSAL_KEY[verdict.reason], monthLabel(verdict.month, lang))}
        </p>
      )}
      {linkedLater.length > 0 && (
        <p role="status" className="mb-2 text-xs text-foreground">
          {t(
            lang,
            "timelogCloseLinkedLater",
            linkedLater.map((id) => names.get(id) ?? String(id)).join(", "),
          )}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" onClick={doClose} disabled={!verdict.ok}>
          {t(lang, "timelogCloseButton", targetLabel)}
        </Button>
        {close && !confirming && (
          <Button variant="secondary" size="sm" onClick={() => setConfirming(true)}>
            {t(lang, "timelogReopenButton", monthLabel(close.through, lang))}
          </Button>
        )}
      </div>
      {close && confirming && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="text-xs text-foreground">
            {t(lang, "timelogReopenConfirm", monthLabel(close.through, lang))}
          </span>
          <Button variant="secondary" size="sm" onClick={doReopen}>
            {t(lang, "timelogReopenConfirmYes")}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setConfirming(false)}>
            {t(lang, "cancel")}
          </Button>
        </div>
      )}
    </div>
  );
}
