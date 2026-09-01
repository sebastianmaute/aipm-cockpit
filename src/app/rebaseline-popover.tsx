"use client";
import { useState, useRef, useCallback } from "react";
import { type Lang, t } from "./i18n";
import type { SuggestedAction } from "./next-actions/types";
import type { Milestone, Task } from "./types";
import { milestoneRebaselineDate, isValidIsoDate } from "./action-rebaseline";
import { POPOVER_CONFIRM_BTN } from "./action-cta-styles";
import { ActionPopoverTrigger } from "./action-popover-trigger";
import { Input } from "./form-controls";

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
  /** Occurrence-qualified row name, threaded from the list owner. REQUIRED —
   *  see `ActionPopoverTrigger` (§324). */
  rowToken: string;
  /** Hero surface renders the trigger as a prominent filled CTA. */
  prominent?: boolean;
}

const TODAY_ISO = () => new Date().toISOString().slice(0, 10);

export function RebaselinePopover({ lang, action, bundle, rowToken, prominent }: RebaselinePopoverProps) {
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
    <ActionPopoverTrigger
      label={t(lang, "actionRebaseline")}
      ariaLabel={t(lang, "actionRebaselineTitle")}
      rowToken={rowToken}
      open={open}
      panelOpen={open && canRender}
      onToggle={toggleOpen}
      onClose={close}
      btnRef={btnRef}
      prominent={prominent}
      panelClassName="w-72 p-2"
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
                <Input
                  type="date"
                  aria-label={t(lang, "actionRebaselineNewDate")}
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </label>
              <div className="mt-2 flex justify-end">
                <button
                  type="button"
                  disabled={!isValidIsoDate(date)}
                  onClick={(e) => { e.stopPropagation(); confirmMilestone(); }}
                  className={POPOVER_CONFIRM_BTN}
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
                  className={POPOVER_CONFIRM_BTN}
                >
                  {t(lang, "actionRebaselineConfirm")}
                </button>
              </div>
            </>
          )}
    </ActionPopoverTrigger>
  );
}
