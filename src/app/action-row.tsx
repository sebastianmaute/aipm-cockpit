// src/app/action-row.tsx
"use client";
import { useState } from "react";
import { type Lang, t, type TranslationKey } from "./i18n";
import type { SuggestedAction, ActionSource, ActionTier } from "./next-actions/types";
import { SNOOZE_1H, SNOOZE_1D } from "./reminder-snooze";

const SOURCE_LABEL: Record<ActionSource, TranslationKey> = {
  "task-due": "actionSourceTask",
  raid: "actionSourceRaid",
  "change-pending": "actionSourceChange",
  milestone: "actionSourceMilestone",
  budget: "actionSourceBudget",
  "stakeholder-comms": "actionSourceComms",
};
const TIER_DOT: Record<ActionTier, string> = {
  now: "bg-AIPM-pink",
  soon: "bg-AIPM-purple",
  monitor: "bg-AIPM-medium-grey",
};

interface ActionRowProps {
  lang: Lang;
  action: SuggestedAction;
  onOpen: (action: SuggestedAction) => void;
  onSnooze?: (action: SuggestedAction, durationMs: number) => void;
}

export function ActionRow({ lang, action, onOpen, onSnooze }: ActionRowProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const title = t(lang, action.title.key, ...(action.title.params ?? []));
  const why = t(lang, action.why.key, ...(action.why.params ?? []));
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
          <span className="rounded bg-surface-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {t(lang, SOURCE_LABEL[action.source])}
          </span>
          <span className="truncate text-sm font-medium text-foreground">{title}</span>
        </span>
        <span className="mt-0.5 block truncate text-xs text-muted-foreground">{why}</span>
      </span>
      <div className="flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onOpen(action); }}
          className="rounded-md border border-line px-3 py-1 text-xs font-medium text-AIPM-dark-blue hover:bg-surface-muted dark:text-AIPM-light-grey"
        >
          {t(lang, "actionOpen")}
        </button>
        {onSnooze && (
          <span className="relative">
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={(e) => { e.stopPropagation(); setMenuOpen((o) => !o); }}
              className="rounded-md border border-line px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-surface-muted"
            >
              {t(lang, "actionSnooze")} ▾
            </button>
            {menuOpen && (
              <span
                role="menu"
                className="absolute right-0 top-full z-20 mt-1 flex w-max flex-col rounded-md border border-line bg-surface py-1 shadow-md"
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
