"use client";

import {
  type AlertCategory,
  type AlertableTask,
  summarizeAlerts,
} from "./due-dates";
import { type Lang, t } from "./i18n";
import { type RaidReviewItem, summarizeRaidReview } from "./raid-review";
import { SNOOZE_1H, SNOOZE_1D } from "./reminder-snooze";
import { Modal } from "./modal";
import { useResizable } from "./use-resizable";
import type { UpcomingBirthday } from "./birthdays";
import { resourceDisplayName } from "./resource-foundation";
import { formatExpiryDate } from "./date-format";
import type { JiraTokenAlert } from "./jira-token-status";

const categoryStyle: Record<AlertCategory, string> = {
  overdue: "bg-AIPM-pink text-white",
  today: "bg-AIPM-green text-white",
  soon: "bg-AIPM-green text-white",
};

function categoryLabel(category: AlertCategory, lang: Lang): string {
  if (category === "overdue") return t(lang, "alertCatOverdue");
  if (category === "today") return t(lang, "alertCatToday");
  return t(lang, "alertCatSoon");
}

function summarySentence(items: AlertableTask[], lang: Lang): string {
  const { overdue, today, soon } = summarizeAlerts(items);
  const parts: string[] = [];
  if (overdue > 0) parts.push(t(lang, "alertSummaryOverdue", overdue));
  if (today > 0) parts.push(t(lang, "alertSummaryToday", today));
  if (soon > 0) parts.push(t(lang, "alertSummarySoon", soon));
  return parts.join(" · ");
}

export function dueAlertsToastText(items: AlertableTask[], lang: Lang): string {
  return `${t(lang, "alertToastTitle")} — ${summarySentence(items, lang)}`;
}

function SnoozeMenu({ lang, onSnooze }: { lang: Lang; onSnooze: (ms: number) => void }) {
  return (
    <details className="relative">
      <summary className="cursor-pointer list-none rounded-md border border-AIPM-medium-grey/40 bg-surface px-3 py-1.5 text-xs font-medium text-foreground hover:bg-surface-muted dark:border-line">
        {t(lang, "reminderSnooze")} ▾
      </summary>
      <div className="absolute right-0 z-10 mt-1 flex flex-col rounded-md border border-line bg-surface py-1">
        <button type="button" onClick={() => onSnooze(SNOOZE_1H)}
          className="whitespace-nowrap px-3 py-1.5 text-left text-xs text-foreground hover:bg-surface-muted">
          {t(lang, "reminderSnooze1h")}
        </button>
        <button type="button" onClick={() => onSnooze(SNOOZE_1D)}
          className="whitespace-nowrap px-3 py-1.5 text-left text-xs text-foreground hover:bg-surface-muted">
          {t(lang, "reminderSnooze1d")}
        </button>
      </div>
    </details>
  );
}

export function DueBanner({
  items,
  lang,
  onOpenList,
  onDismiss,
  onSnooze,
}: {
  items: AlertableTask[];
  lang: Lang;
  onOpenList: () => void;
  onDismiss: () => void;
  onSnooze: (ms: number) => void;
}) {
  if (items.length === 0) return null;
  const summary = summarySentence(items, lang);
  return (
    <div
      role="region"
      aria-label={t(lang, "alertBannerAria")}
      className="mb-6 flex flex-wrap items-center gap-3 rounded-lg border border-AIPM-pink/40 bg-AIPM-pink/10 px-4 py-3 dark:border-AIPM-pink/60 dark:bg-AIPM-pink/15"
    >
      <span aria-hidden className="text-lg">
        ⚠
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey">
          {t(lang, "alertBannerTitle", items.length)}
        </p>
        <p className="text-xs text-muted-foreground">
          {summary}
        </p>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onOpenList}
          className="rounded-md bg-AIPM-dark-blue px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
        >
          {t(lang, "alertBannerOpen")}
        </button>
        <SnoozeMenu lang={lang} onSnooze={onSnooze} />
        <button
          type="button"
          onClick={onDismiss}
          aria-label={t(lang, "alertBannerDismiss")}
          className="rounded-md border border-AIPM-medium-grey/40 bg-surface px-3 py-1.5 text-xs font-medium text-foreground hover:bg-surface-muted"
        >
          {t(lang, "alertBannerDismiss")}
        </button>
      </div>
    </div>
  );
}

export function birthdayToastText(items: UpcomingBirthday[], lang: Lang): string {
  return t(lang, "birthdayToast", items.length);
}

export function BirthdayBanner({
  items, lang, onDismiss, onSnooze,
}: { items: UpcomingBirthday[]; lang: Lang; onDismiss: () => void; onSnooze: (ms: number) => void }) {
  if (items.length === 0) return null;
  const summary = items
    .map((b) => `${resourceDisplayName(b.resource)} (${b.daysUntil === 0 ? t(lang, "birthdayToday") : t(lang, "birthdayInDays", b.daysUntil)})`)
    .join(", ");
  return (
    <div role="region" aria-label={t(lang, "birthdayBannerAria")}
      className="mb-6 flex flex-wrap items-center gap-3 rounded-lg border border-AIPM-pink/40 bg-AIPM-pink/10 px-4 py-3 dark:border-AIPM-pink/60 dark:bg-AIPM-pink/15">
      <span aria-hidden className="text-lg">🎂</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey">{t(lang, "birthdayBannerTitle", items.length)}</p>
        <p className="text-xs text-muted-foreground">{summary}</p>
      </div>
      <div className="flex gap-2">
        <SnoozeMenu lang={lang} onSnooze={onSnooze} />
        <button type="button" onClick={onDismiss} aria-label={t(lang, "alertBannerDismiss")}
          className="rounded-md border border-AIPM-medium-grey/40 bg-surface px-3 py-1.5 text-xs font-medium text-foreground hover:bg-surface-muted">
          {t(lang, "alertBannerDismiss")}
        </button>
      </div>
    </div>
  );
}

export function JiraTokenBanner({
  alert, lang, onSnooze, onDismiss,
}: { alert: NonNullable<JiraTokenAlert>; lang: Lang; onSnooze: (ms: number) => void; onDismiss: () => void }) {
  const msg =
    alert.state === "invalid" ? t(lang, "jiraTokenInvalidBanner")
    : alert.state === "expired" ? t(lang, "jiraTokenExpiredBanner", formatExpiryDate(alert.date, lang))
    : t(lang, "jiraTokenExpiringBanner", alert.daysLeft, formatExpiryDate(alert.date, lang));
  return (
    <div role="region" aria-label={t(lang, "jiraTokenBannerAria")}
      className="mb-6 flex flex-wrap items-center gap-3 rounded-lg border border-AIPM-pink/40 bg-AIPM-pink/10 px-4 py-3 dark:border-AIPM-pink/60 dark:bg-AIPM-pink/15">
      <span aria-hidden className="text-lg">⚠</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey">{msg}</p>
      </div>
      <div className="flex gap-2">
        <SnoozeMenu lang={lang} onSnooze={onSnooze} />
        <button type="button" onClick={onDismiss} aria-label={t(lang, "alertBannerDismiss")}
          className="rounded-md border border-AIPM-medium-grey/40 bg-surface px-3 py-1.5 text-xs font-medium text-foreground hover:bg-surface-muted">
          {t(lang, "alertBannerDismiss")}
        </button>
      </div>
    </div>
  );
}

export function DueDatesModal({
  items,
  lang,
  onClose,
  onSelectTask,
}: {
  items: AlertableTask[];
  lang: Lang;
  onClose: () => void;
  onSelectTask?: (taskId: number) => void;
}) {
  // Escape and backdrop-click are owned by <Modal>.

  const { ref: panelRef } = useResizable("lop-app:due-modal-size");

  return (
    <Modal open onClose={onClose} ariaLabel={t(lang, "alertModalTitle")}>
      <div
        ref={panelRef}
        className="relative h-[640px] max-h-[95vh] min-h-[300px] w-[640px] min-w-[320px] max-w-[95vw] resize overflow-y-auto rounded-xl border border-line bg-surface"
      >
        <header className="sticky top-0 z-10 flex shrink-0 items-center justify-between gap-4 border-b border-line bg-surface px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey">
              {t(lang, "alertModalTitle")}
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {summarySentence(items, lang)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t(lang, "alertModalClose")}
            className="rounded-md p-2 text-foreground hover:bg-surface-muted hover:text-AIPM-dark-blue"
          >
            <svg
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
              className="h-4 w-4"
            >
              <path
                fillRule="evenodd"
                d="M4.28 4.28a.75.75 0 011.06 0L10 8.94l4.66-4.66a.75.75 0 111.06 1.06L11.06 10l4.66 4.66a.75.75 0 11-1.06 1.06L10 11.06l-4.66 4.66a.75.75 0 01-1.06-1.06L8.94 10 4.28 5.34a.75.75 0 010-1.06z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        </header>

        {items.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">
            {t(lang, "alertModalNone")}
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {items.map((item) => (
              <li key={item.task.id} className="px-6 py-3">
                <div className="flex items-start gap-3">
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${categoryStyle[item.category]}`}
                  >
                    {categoryLabel(item.category, lang)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-AIPM-dark-blue dark:text-AIPM-light-grey">
                      <span className="font-mono text-xs text-muted-foreground">
                        #{item.task.id}
                      </span>{" "}
                      {item.task.taskName}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {t(lang, "assignee")}: {item.task.assignee} ·{" "}
                      {t(lang, "due")}: {item.task.dueDate}
                      {item.category === "soon" && (
                        <>
                          {" · "}
                          {t(
                            lang,
                            item.workDaysLeft === 1
                              ? "workDayLeft"
                              : "workDaysLeft",
                            item.workDaysLeft,
                          )}
                        </>
                      )}
                    </p>
                  </div>
                  {onSelectTask && (
                    <button
                      type="button"
                      onClick={() => onSelectTask(item.task.id)}
                      className="shrink-0 text-xs font-medium text-AIPM-dark-blue underline-offset-2 hover:underline dark:text-AIPM-blue"
                    >
                      {t(lang, "edit")}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}

function raidReviewSummary(items: RaidReviewItem[], lang: Lang): string {
  const { overdue, stale } = summarizeRaidReview(items);
  const parts: string[] = [];
  if (overdue > 0) parts.push(t(lang, "raidReviewSummaryOverdue", overdue));
  if (stale > 0) parts.push(t(lang, "raidReviewSummaryStale", stale));
  return parts.join(" · ");
}

export function raidReviewToastText(items: RaidReviewItem[], lang: Lang): string {
  return `${t(lang, "raidReviewToastTitle")} — ${raidReviewSummary(items, lang)}`;
}

export function RaidReviewBanner({
  items,
  lang,
  onOpenList,
  onDismiss,
  onSnooze,
}: {
  items: RaidReviewItem[];
  lang: Lang;
  onOpenList: () => void;
  onDismiss: () => void;
  onSnooze: (ms: number) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div
      role="region"
      aria-label={t(lang, "raidReviewBannerAria")}
      className="mb-6 flex flex-wrap items-center gap-3 rounded-lg border border-AIPM-purple/40 bg-AIPM-purple/10 px-4 py-3 dark:border-AIPM-purple/60 dark:bg-AIPM-purple/15"
    >
      <span aria-hidden className="text-lg">
        ⚠
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey">
          {t(lang, "raidReviewBannerTitle", items.length)}
        </p>
        <p className="text-xs text-muted-foreground">
          {raidReviewSummary(items, lang)}
        </p>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onOpenList}
          className="rounded-md bg-AIPM-dark-blue px-3 py-1.5 text-xs font-medium text-white hover:opacity-90"
        >
          {t(lang, "alertBannerOpen")}
        </button>
        <SnoozeMenu lang={lang} onSnooze={onSnooze} />
        <button
          type="button"
          onClick={onDismiss}
          aria-label={t(lang, "alertBannerDismiss")}
          className="rounded-md border border-AIPM-medium-grey/40 bg-surface px-3 py-1.5 text-xs font-medium text-foreground hover:bg-surface-muted"
        >
          {t(lang, "alertBannerDismiss")}
        </button>
      </div>
    </div>
  );
}

export function RaidReviewModal({
  items,
  lang,
  onClose,
  onSelectRaid,
}: {
  items: RaidReviewItem[];
  lang: Lang;
  onClose: () => void;
  onSelectRaid?: (id: number) => void;
}) {
  const { ref: panelRef } = useResizable("lop-app:raid-review-modal-size");
  return (
    <Modal open onClose={onClose} ariaLabel={t(lang, "raidReviewModalTitle")}>
      <div
        ref={panelRef}
        className="relative h-[640px] max-h-[95vh] min-h-[300px] w-[640px] min-w-[320px] max-w-[95vw] resize overflow-y-auto rounded-xl border border-line bg-surface"
      >
        <header className="sticky top-0 z-10 flex shrink-0 items-center justify-between gap-4 border-b border-line bg-surface px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey">
              {t(lang, "raidReviewModalTitle")}
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {raidReviewSummary(items, lang)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t(lang, "alertModalClose")}
            className="rounded-md p-2 text-foreground hover:bg-surface-muted hover:text-AIPM-dark-blue"
          >
            <svg
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
              className="h-4 w-4"
            >
              <path
                fillRule="evenodd"
                d="M4.28 4.28a.75.75 0 011.06 0L10 8.94l4.66-4.66a.75.75 0 111.06 1.06L11.06 10l4.66 4.66a.75.75 0 11-1.06 1.06L10 11.06l-4.66 4.66a.75.75 0 01-1.06-1.06L8.94 10 4.28 5.34a.75.75 0 010-1.06z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        </header>

        {items.length === 0 ? (
          <p className="p-6 text-sm text-muted-foreground">
            {t(lang, "raidReviewModalNone")}
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {items.map(({ item, reason, daysSinceReview }) => (
              <li key={item.id} className="px-6 py-3">
                <div className="flex items-start gap-3">
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${reason === "overdue" ? "bg-AIPM-pink text-white" : "bg-AIPM-purple text-white"}`}
                  >
                    {t(lang, reason === "overdue" ? "raidReviewReasonOverdue" : "raidReviewReasonStale")}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-AIPM-dark-blue dark:text-AIPM-light-grey">
                      <span className="font-mono text-xs text-muted-foreground">#{item.id}</span> {item.title}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {item.owner ? `${item.owner} · ` : ""}
                      {item.targetDate ? `${t(lang, "raidTargetDate")}: ${item.targetDate} · ` : ""}
                      {t(lang, "raidReviewLastTouched")}: {daysSinceReview}d
                    </p>
                  </div>
                  {onSelectRaid && (
                    <button
                      type="button"
                      onClick={() => onSelectRaid(item.id)}
                      className="shrink-0 text-xs font-medium text-AIPM-dark-blue underline-offset-2 hover:underline dark:text-AIPM-blue"
                    >
                      {t(lang, "edit")}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  );
}
