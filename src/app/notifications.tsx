"use client";

import { useEffect } from "react";
import {
  type AlertCategory,
  type AlertableTask,
  summarizeAlerts,
} from "./due-dates";
import { type Lang, t } from "./i18n";
import { useResizable } from "./use-resizable";

const categoryStyle: Record<AlertCategory, string> = {
  overdue: "bg-AIPM-pink text-white",
  today: "bg-amber-500 text-white",
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

export function DueBanner({
  items,
  lang,
  onOpenList,
  onDismiss,
}: {
  items: AlertableTask[];
  lang: Lang;
  onOpenList: () => void;
  onDismiss: () => void;
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
        <p className="text-xs text-AIPM-dark-grey dark:text-AIPM-medium-grey">
          {summary}
        </p>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onOpenList}
          className="rounded-md bg-AIPM-dark-blue px-3 py-1.5 text-xs font-medium text-white shadow-sm hover:opacity-90"
        >
          {t(lang, "alertBannerOpen")}
        </button>
        <button
          type="button"
          onClick={onDismiss}
          aria-label={t(lang, "alertBannerDismiss")}
          className="rounded-md border border-AIPM-medium-grey/40 bg-white px-3 py-1.5 text-xs font-medium text-AIPM-dark-grey hover:bg-AIPM-light-grey dark:border-zinc-700 dark:bg-zinc-900 dark:text-AIPM-medium-grey"
        >
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
  // Esc closes modal
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const { ref: panelRef } = useResizable("lop-app:due-modal-size");

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t(lang, "alertModalTitle")}
      className="fixed inset-0 z-40 flex items-start justify-center bg-AIPM-dark-blue/40 p-4 sm:p-10"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        onClick={(e) => e.stopPropagation()}
        title={t(lang, "tableResizeHint")}
        className="relative h-[640px] max-h-[95vh] min-h-[300px] w-[640px] min-w-[320px] max-w-[95vw] resize overflow-y-auto rounded-xl border border-AIPM-light-grey bg-white shadow-2xl dark:border-zinc-800 dark:bg-zinc-950"
      >
        <header className="sticky top-0 flex items-center justify-between gap-4 border-b border-AIPM-light-grey bg-white px-6 py-4 dark:border-zinc-800 dark:bg-zinc-950">
          <div>
            <h2 className="text-lg font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey">
              {t(lang, "alertModalTitle")}
            </h2>
            <p className="mt-0.5 text-xs text-AIPM-dark-grey dark:text-AIPM-medium-grey">
              {summarySentence(items, lang)}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t(lang, "alertModalClose")}
            className="rounded-md p-2 text-AIPM-dark-grey hover:bg-AIPM-light-grey hover:text-AIPM-dark-blue dark:text-AIPM-medium-grey dark:hover:bg-zinc-800 dark:hover:text-AIPM-light-grey"
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
          <p className="p-6 text-sm text-AIPM-medium-grey">
            {t(lang, "alertModalNone")}
          </p>
        ) : (
          <ul className="divide-y divide-AIPM-light-grey dark:divide-zinc-800">
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
                      <span className="font-mono text-xs text-AIPM-medium-grey">
                        #{item.task.id}
                      </span>{" "}
                      {item.task.taskName}
                    </p>
                    <p className="text-xs text-AIPM-dark-grey dark:text-AIPM-medium-grey">
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
    </div>
  );
}
