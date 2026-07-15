"use client";
import { useState, useRef, useCallback } from "react";
import { type Lang, t } from "./i18n";
import type { SuggestedAction } from "./next-actions/types";
import type { Milestone, Task } from "./types";
import { milestoneRebaselineDate, isValidIsoDate } from "./action-rebaseline";
import { PopoverPanel } from "./popover-panel";
import { popoverTriggerClass } from "./action-cta-styles";

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
  /** Hero surface renders the trigger as a prominent filled CTA. */
  prominent?: boolean;
}

const TODAY_ISO = () => new Date().toISOString().slice(0, 10);

export function RebaselinePopover({ lang, action, bundle, prominent }: RebaselinePopoverProps) {
  const isMilestone = action.source === "milestone";
  const btnRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState("");

  const id = action.cta.kind === "open" ? Number(action.cta.id) : -1;
  const milestone = isMilestone ? bundle.milestones.find((m) => m.id === id) : undefined;

  const close = useCallback(() => setOpen(false), []);

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
        ref={btnRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); toggleOpen(); }}
        className={popoverTriggerClass(prominent)}
      >
        {t(lang, "actionRebaseline")}
      </button>
      <PopoverPanel
        open={open && canRender}
        anchorRef={btnRef}
        onClose={close}
        role="dialog"
        ariaLabel={t(lang, "actionRebaselineTitle")}
        className="w-72 p-2"
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
                  className="cursor-pointer rounded-md border border-line px-3 py-1 text-xs font-medium text-AIPM-dark-blue transition-colors hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50 dark:text-AIPM-light-grey"
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
                  className="cursor-pointer rounded-md border border-line px-3 py-1 text-xs font-medium text-AIPM-dark-blue transition-colors hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-50 dark:text-AIPM-light-grey"
                >
                  {t(lang, "actionRebaselineConfirm")}
                </button>
              </div>
            </>
          )}
      </PopoverPanel>
    </span>
  );
}
