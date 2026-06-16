"use client";
import { useState, useRef, useEffect } from "react";
import { type Lang, t } from "./i18n";
import type { SuggestedAction } from "./next-actions/types";
import type { Milestone, Task } from "./types";
import { milestoneRebaselineDate, isValidIsoDate } from "./action-rebaseline";

export interface RebaselineBundle {
  // Milestone (B) path — all backends:
  milestones: readonly Milestone[];
  tasks: readonly Task[];
  onRebaselineMilestone: (action: SuggestedAction, id: number, newDate: string) => void;
  // Schedule/budget (A) path — Turso-gated:
  snapshotActive: boolean;
  onRebaselineSnapshot: (action: SuggestedAction) => void;
  busy: boolean;
}

interface RebaselinePopoverProps {
  lang: Lang;
  action: SuggestedAction;
  bundle: RebaselineBundle;
}

const TODAY_ISO = () => new Date().toISOString().slice(0, 10);

export function RebaselinePopover({ lang, action, bundle }: RebaselinePopoverProps) {
  const isMilestone = action.source === "milestone";
  const popRef = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState("");

  const id = action.cta.kind === "open" ? Number(action.cta.id) : -1;
  const milestone = isMilestone ? bundle.milestones.find((m) => m.id === id) : undefined;

  useEffect(() => {
    if (open) popRef.current?.querySelector<HTMLElement>("input,button,[tabindex]")?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const toggleOpen = () => {
    if (!open && milestone) {
      setDate(milestoneRebaselineDate(milestone, bundle.tasks, TODAY_ISO()));
    }
    setOpen((o) => !o);
  };

  const confirmMilestone = () => {
    if (!milestone) return;
    bundle.onRebaselineMilestone(action, milestone.id, date);
    setOpen(false);
  };

  const confirmSnapshot = () => {
    bundle.onRebaselineSnapshot(action);
    setOpen(false);
  };

  // Milestone variant needs a found milestone; snapshot variant always renders.
  const canRender = isMilestone ? milestone != null : true;

  return (
    <span className="relative">
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); toggleOpen(); }}
        className="rounded-md border border-line px-2 py-1 text-xs font-medium text-AIPM-dark-blue hover:bg-surface-muted dark:text-AIPM-light-grey"
      >
        {t(lang, "actionRebaseline")}
      </button>
      {open && canRender && (
        <span
          ref={popRef}
          role="dialog"
          aria-label={t(lang, "actionRebaselineTitle")}
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => { if (e.key === "Escape") setOpen(false); }}
          className="absolute right-0 top-full z-20 mt-1 w-72 rounded-md border border-line bg-surface p-2"
        >
          {isMilestone && milestone ? (
            <>
              <p className="mb-2 text-xs text-foreground">
                {t(lang, "actionRebaselineMilestoneDesc", milestone.name)}
              </p>
              <p className="mb-2 text-xs text-muted-foreground">
                {t(lang, "actionRebaselineForecastHint", milestoneRebaselineDate(milestone, bundle.tasks, TODAY_ISO()))}
              </p>
              <label className="flex flex-col gap-1 text-xs text-foreground">
                <span className="font-medium">{t(lang, "actionRebaselineNewDate")}</span>
                <input
                  type="date"
                  aria-label={t(lang, "actionRebaselineNewDate")}
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="rounded-md border border-line bg-surface px-3 py-1.5 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-AIPM-green"
                />
              </label>
              <div className="mt-2 flex justify-end">
                <button
                  type="button"
                  disabled={!isValidIsoDate(date)}
                  onClick={(e) => { e.stopPropagation(); confirmMilestone(); }}
                  className="rounded-md border border-line px-3 py-1 text-xs font-medium text-AIPM-dark-blue hover:bg-surface-muted disabled:opacity-50 dark:text-AIPM-light-grey"
                >
                  {t(lang, "actionRebaselineConfirm")}
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="mb-2 text-xs text-foreground">{t(lang, "actionRebaselineSnapshotDesc")}</p>
              <div className="mt-2 flex justify-end">
                <button
                  type="button"
                  disabled={bundle.busy}
                  onClick={(e) => { e.stopPropagation(); confirmSnapshot(); }}
                  className="rounded-md border border-line px-3 py-1 text-xs font-medium text-AIPM-dark-blue hover:bg-surface-muted disabled:opacity-50 dark:text-AIPM-light-grey"
                >
                  {t(lang, "actionRebaselineConfirm")}
                </button>
              </div>
            </>
          )}
        </span>
      )}
    </span>
  );
}
