// src/app/action-row.tsx
"use client";
import { type Lang, t, type TranslationKey } from "./i18n";
import type { SuggestedAction, ActionSource, ActionTier } from "./next-actions/types";

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
}

export function ActionRow({ lang, action, onOpen }: ActionRowProps) {
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
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onOpen(action); }}
        className="shrink-0 rounded-md border border-line px-3 py-1 text-xs font-medium text-AIPM-dark-blue hover:bg-surface-muted dark:text-AIPM-light-grey"
      >
        {t(lang, "actionOpen")}
      </button>
    </div>
  );
}
