// src/app/action-row.tsx
"use client";
import { useState, useRef, useEffect } from "react";
import { type Lang, t } from "./i18n";
import type { SuggestedAction, ActionTier } from "./next-actions/types";
import type { Resource } from "./types";
import { SNOOZE_1H, SNOOZE_1D } from "./reminder-snooze";
import { ACTION_SOURCE_LABEL } from "./action-source-label";
import { ACTION_SOURCE_ICON } from "./action-source-icon";
import { InfoTooltip } from "./info-tooltip";
import { ResourcePicker } from "./resource-picker";
import { EscalatePopover, type EscalateBundle } from "./escalate-popover";
import { RebaselinePopover, type RebaselineBundle } from "./rebaseline-popover";

const TIER_DOT: Record<ActionTier, string> = {
  now: "bg-AIPM-pink",
  soon: "bg-AIPM-purple",
  monitor: "bg-AIPM-medium-grey",
};

export interface AssignOwnerBundle {
  resources: readonly Resource[];
  onCreateResource: (name: string, email: string) => number;
  onAssign: (action: SuggestedAction, value: { name: string; email: string; resourceId: number | null }) => void;
}

interface ActionRowProps {
  lang: Lang;
  action: SuggestedAction;
  onOpen: (action: SuggestedAction) => void;
  onSnooze?: (action: SuggestedAction, durationMs: number) => void;
  onCreateTask?: (action: SuggestedAction) => void;
  assignOwner?: AssignOwnerBundle;
  onDraftMessage?: (action: SuggestedAction) => void;
  escalate?: EscalateBundle;
  rebaseline?: RebaselineBundle;
}

export function ActionRow({ lang, action, onOpen, onSnooze, onCreateTask, assignOwner, onDraftMessage, escalate, rebaseline }: ActionRowProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const assignPopRef = useRef<HTMLSpanElement>(null);

  // Focus first focusable element when popover opens (a11y: dialog focus management).
  useEffect(() => {
    if (assignOpen) assignPopRef.current?.querySelector<HTMLElement>("input,button,[tabindex]")?.focus();
  }, [assignOpen]);

  // Close on Escape regardless of which element inside the dialog has focus.
  // Document-level listener is robust even when ResourcePicker's own Escape handler
  // fires e.preventDefault() without bubbling (e.g. when its listbox is open).
  useEffect(() => {
    if (!assignOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setAssignOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [assignOpen]);
  const title = t(lang, action.title.key, ...(action.title.params ?? []));
  const why = t(lang, action.why.key, ...(action.why.params ?? []));
  const canAssign =
    assignOwner != null &&
    action.source === "raid" &&
    action.why.key === "actionRaidWhyNoOwner" &&
    action.cta.kind === "open";
  const canDraft =
    onDraftMessage != null &&
    (action.source === "task-due" || action.source === "stakeholder-comms") &&
    action.cta.kind === "open";
  const canEscalate =
    escalate != null &&
    action.source === "raid" &&
    action.why.key === "actionRaidWhySeverity" &&
    action.cta.kind === "open";
  const canRebaselineMilestone =
    rebaseline != null &&
    action.source === "milestone" &&
    (action.why.key === "actionMilestoneWhyAtRisk" ||
     action.why.key === "actionMilestoneWhyOverdue") &&
    action.cta.kind === "open";
  const canRebaselineSnapshot =
    rebaseline != null &&
    rebaseline.snapshotActive &&
    ((action.source === "schedule" && action.why.key === "actionScheduleWhySlipping") ||
     (action.source === "budget" && action.why.key === "actionBudgetWhyWorsening")) &&
    action.cta.kind === "open";
  return (
    // Mouse convenience only — NOT role="button"/tabIndex: nesting an interactive
    // control (the Open button) inside a role=button is a WCAG nested-interactive
    // violation. Keyboard/AT users use the inner Open button (the real affordance).
    // Mirrors the RAID-row pattern (a plain onClick row + a focusable inner button).
    <div
      onClick={() => onOpen(action)}
      className="flex cursor-pointer items-center gap-3 rounded-md border border-line bg-surface px-3 py-2 hover:bg-surface-muted"
    >
      <span aria-hidden className={`h-2 w-2 shrink-0 rounded-full ${TIER_DOT[action.tier]}`} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span aria-hidden data-action-source-icon className="shrink-0 text-muted-foreground">
            {ACTION_SOURCE_ICON[action.source]}
          </span>
          {/* InfoTooltip renders its own focusable trigger; it carries the numeric
              score as the accessible hint (the icon stays decorative). */}
          <span onClick={(e) => e.stopPropagation()} className="shrink-0">
            <InfoTooltip text={t(lang, "actionScoreTooltip", action.score)} />
          </span>
          <span className="rounded bg-surface-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {t(lang, ACTION_SOURCE_LABEL[action.source])}
          </span>
          <span className="truncate text-sm font-medium text-foreground">{title}</span>
        </span>
        <span className="mt-0.5 block truncate text-xs text-muted-foreground">{why}</span>
        {action.learning?.moved && (
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
            {action.learning.moved === "up"
              ? t(lang, "learningSurfacedHint")
              : t(lang, "learningDemotedHint")}
          </span>
        )}
      </span>
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onOpen(action); }}
          className="rounded-md border border-line px-3 py-1 text-xs font-medium text-AIPM-dark-blue transition-colors hover:border-AIPM-dark-blue/40 hover:bg-surface-muted dark:text-AIPM-light-grey"
        >
          {t(lang, "actionOpen")}
        </button>
        {canDraft && onDraftMessage && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onDraftMessage(action); }}
            className="rounded-md border border-line px-2 py-1 text-xs font-medium text-AIPM-dark-blue transition-colors hover:border-AIPM-dark-blue/40 hover:bg-surface-muted dark:text-AIPM-light-grey"
          >
            {t(lang, "actionDraftMessage")}
          </button>
        )}
        {onCreateTask && action.source !== "task-due" && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onCreateTask(action); }}
            className="rounded-md border border-line px-2 py-1 text-xs font-medium text-AIPM-dark-blue transition-colors hover:border-AIPM-dark-blue/40 hover:bg-surface-muted dark:text-AIPM-light-grey"
          >
            {t(lang, "actionCreateTask")}
          </button>
        )}
        {canEscalate && escalate && (
          <EscalatePopover lang={lang} action={action} bundle={escalate} />
        )}
        {(canRebaselineMilestone || canRebaselineSnapshot) && rebaseline && (
          <RebaselinePopover lang={lang} action={action} bundle={rebaseline} />
        )}
        {canAssign && assignOwner && (
          <span className="relative">
            <button
              type="button"
              aria-haspopup="dialog"
              aria-expanded={assignOpen}
              onClick={(e) => { e.stopPropagation(); setAssignOpen((o) => !o); }}
              className="rounded-md border border-line px-2 py-1 text-xs font-medium text-AIPM-dark-blue hover:bg-surface-muted dark:text-AIPM-light-grey"
            >
              {t(lang, "actionAssignOwner")}
            </button>
            {assignOpen && (
              <span
                ref={assignPopRef}
                role="dialog"
                aria-label={t(lang, "actionAssignOwner")}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => { if (e.key === "Escape") setAssignOpen(false); }}
                className="absolute right-0 top-full z-20 mt-1 w-64 rounded-md border border-line bg-surface p-2"
              >
                <ResourcePicker
                  lang={lang}
                  value={{ name: "", email: "", resourceId: null }}
                  resources={assignOwner.resources}
                  contacts={[]}
                  onCreateResource={assignOwner.onCreateResource}
                  onChange={(next) => { assignOwner.onAssign(action, next); setAssignOpen(false); }}
                />
              </span>
            )}
          </span>
        )}
        {onSnooze && (
          <span className="relative">
            <button
              type="button"
              aria-haspopup="true"
              aria-expanded={menuOpen}
              onClick={(e) => { e.stopPropagation(); setMenuOpen((o) => !o); }}
              className="rounded-md border border-line px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-surface-muted"
            >
              {t(lang, "actionSnooze")} ▾
            </button>
            {menuOpen && (
              <span
                className="absolute right-0 top-full z-20 mt-1 flex w-max flex-col rounded-md border border-line bg-surface py-1"
              >
                <button type="button"
                  onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onSnooze(action, SNOOZE_1H); }}
                  className="px-3 py-1 text-left text-xs text-foreground hover:bg-surface-muted">
                  {t(lang, "actionSnooze1h")}
                </button>
                <button type="button"
                  onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onSnooze(action, SNOOZE_1D); }}
                  className="px-3 py-1 text-left text-xs text-foreground hover:bg-surface-muted">
                  {t(lang, "actionSnooze1d")}
                </button>
              </span>
            )}
          </span>
        )}
      </div>
    </div>
  );
}
