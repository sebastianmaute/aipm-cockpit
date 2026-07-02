"use client";

// Presentational summary of a milestone "Pull from Outlook" run. The caller
// (the milestone pane) computes the three row buckets — dates auto-applied,
// two-sided conflicts the user resolves per row, and events removed in Outlook —
// and wires the per-conflict callbacks. This component owns NO state and reaches
// into NO context; it just renders the buckets. Milestone names are resolved by
// the caller before being passed in.

import { type Lang, t } from "./i18n";
import { Modal } from "./modal";
import { INTERACTIVE } from "./interaction-styles";

interface AppliedRow {
  id: number;
  name: string;
  newDate: string;
}

interface ConflictRow {
  id: number;
  eventId: string;
  name: string;
  appDate: string;
  outlookDate: string;
}

interface DeletionRow {
  id: number;
  name: string;
}

interface CalendarPullSummaryModalProps {
  lang: Lang;
  open: boolean;
  onClose: () => void;
  applied: AppliedRow[];
  conflicts: ConflictRow[];
  deletions: DeletionRow[];
  onKeepApp: (c: { id: number; eventId: string; appDate: string }) => void;
  onTakeOutlook: (c: {
    id: number;
    eventId: string;
    outlookDate: string;
  }) => void;
}

const BUTTON_CLASS =
  "rounded-md border border-line bg-surface px-3 py-1.5 text-sm font-medium text-foreground hover:bg-surface-muted";

export function CalendarPullSummaryModal({
  lang,
  open,
  onClose,
  applied,
  conflicts,
  deletions,
  onKeepApp,
  onTakeOutlook,
}: CalendarPullSummaryModalProps) {
  const title = t(lang, "calendarPullSummaryTitle");

  return (
    <Modal open={open} onClose={onClose} ariaLabel={title}>
      <div
        data-modal-panel
        className="relative max-h-[90vh] w-[560px] max-w-[95vw] overflow-y-auto rounded-xl border border-line bg-surface"
      >
        <div className="flex items-center justify-between border-b border-line px-6 py-4">
          <h2 className="text-base font-semibold text-foreground">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className={`${BUTTON_CLASS} ${INTERACTIVE}`}
          >
            {t(lang, "alertModalClose")}
          </button>
        </div>

        <div className="space-y-6 px-6 py-4">
          {applied.length > 0 && (
            <section>
              <h3 className="mb-2 text-sm font-semibold text-foreground">
                {t(lang, "calendarPullApplied")}
              </h3>
              <ul className="space-y-1 text-sm text-foreground">
                {applied.map((a) => (
                  <li key={a.id}>
                    {a.name} → {a.newDate}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {conflicts.length > 0 && (
            <section>
              <h3 className="mb-2 text-sm font-semibold text-foreground">
                {t(lang, "calendarPullConflicts")}
              </h3>
              <ul className="space-y-3">
                {conflicts.map((c) => (
                  <li
                    key={c.id}
                    className="rounded-md border border-line bg-surface-muted px-3 py-2"
                  >
                    <div className="text-sm font-medium text-foreground">
                      {c.name}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {t(lang, "calendarFrom")}: {c.appDate} · Outlook:{" "}
                      {c.outlookDate}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        aria-label={`${t(lang, "calendarPullKeepApp")} – ${c.name}`}
                        onClick={() =>
                          onKeepApp({
                            id: c.id,
                            eventId: c.eventId,
                            appDate: c.appDate,
                          })
                        }
                        className={`${BUTTON_CLASS} ${INTERACTIVE}`}
                      >
                        {t(lang, "calendarPullKeepApp")}
                      </button>
                      <button
                        type="button"
                        aria-label={`${t(lang, "calendarPullTakeOutlook")} – ${c.name}`}
                        onClick={() =>
                          onTakeOutlook({
                            id: c.id,
                            eventId: c.eventId,
                            outlookDate: c.outlookDate,
                          })
                        }
                        className={`${BUTTON_CLASS} ${INTERACTIVE}`}
                      >
                        {t(lang, "calendarPullTakeOutlook")}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {deletions.length > 0 && (
            <section>
              <h3 className="mb-2 text-sm font-semibold text-foreground">
                {t(lang, "calendarPullDeletions")}
              </h3>
              <ul className="space-y-1 text-sm text-muted-foreground">
                {deletions.map((d) => (
                  <li key={d.id}>
                    {d.name} — {t(lang, "calendarPullEventRemoved")}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </Modal>
  );
}
