// src/app/action-row.tsx
"use client";
import { useState } from "react";
import { type Lang, t } from "./i18n";
import type { SuggestedAction, ActionTier } from "./next-actions/types";
import type { Resource } from "./types";
import { SNOOZE_1H, SNOOZE_1D } from "./reminder-snooze";
import { ACTION_SOURCE_LABEL } from "./action-source-label";
import { resourceDisplayName } from "./resource-foundation";

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
}

/** Minimal inline owner-picker rendered inside the assign-owner popover.
 *  Uses a plain <input type="text"> (implicit role="textbox") so RTL
 *  getByRole("textbox") finds it, and drops a filtered resource list below. */
function OwnerInput({
  lang,
  resources,
  onCreateResource,
  onAssign,
}: {
  lang: Lang;
  resources: readonly Resource[];
  onCreateResource: (name: string, email: string) => number;
  onAssign: (value: { name: string; email: string; resourceId: number | null }) => void;
}) {
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const matches = resources.filter(
    (r) => !q || resourceDisplayName(r).toLowerCase().includes(q) || (r.email ?? "").toLowerCase().includes(q),
  );
  return (
    <div className="flex flex-col gap-1">
      <input
        type="text"
        aria-label={t(lang, "actionAssignOwner")}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={t(lang, "actionAssignOwner")}
        className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-AIPM-green"
      />
      {matches.length > 0 && (
        <ul className="flex flex-col">
          {matches.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => onAssign({ name: resourceDisplayName(r), email: r.email ?? "", resourceId: r.id })}
                className="w-full px-3 py-1 text-left text-xs text-foreground hover:bg-surface-muted"
              >
                {resourceDisplayName(r)}
              </button>
            </li>
          ))}
        </ul>
      )}
      {query && !matches.find((r) => resourceDisplayName(r).toLowerCase() === q) && (
        <button
          type="button"
          onClick={() => {
            const id = onCreateResource(query, "");
            onAssign({ name: query, email: "", resourceId: id });
          }}
          className="px-3 py-1 text-left text-xs text-foreground hover:bg-surface-muted"
        >
          + {query}
        </button>
      )}
    </div>
  );
}

export function ActionRow({ lang, action, onOpen, onSnooze, onCreateTask, assignOwner }: ActionRowProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const title = t(lang, action.title.key, ...(action.title.params ?? []));
  const why = t(lang, action.why.key, ...(action.why.params ?? []));
  const canAssign =
    assignOwner != null &&
    action.source === "raid" &&
    action.why.key === "actionRaidWhyNoOwner" &&
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
          <span className="rounded bg-surface-muted px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {t(lang, ACTION_SOURCE_LABEL[action.source])}
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
        {onCreateTask && action.source !== "task-due" && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onCreateTask(action); }}
            className="rounded-md border border-line px-2 py-1 text-xs font-medium text-AIPM-dark-blue hover:bg-surface-muted dark:text-AIPM-light-grey"
          >
            {t(lang, "actionCreateTask")}
          </button>
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
                role="dialog"
                aria-label={t(lang, "actionAssignOwner")}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => { if (e.key === "Escape") setAssignOpen(false); }}
                className="absolute right-0 top-full z-20 mt-1 w-64 rounded-md border border-line bg-surface p-2 shadow-sm"
              >
                <OwnerInput
                  lang={lang}
                  resources={assignOwner.resources}
                  onCreateResource={assignOwner.onCreateResource}
                  onAssign={(next) => { assignOwner.onAssign(action, next); setAssignOpen(false); }}
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
                className="absolute right-0 top-full z-20 mt-1 flex w-max flex-col rounded-md border border-line bg-surface py-1 shadow-sm"
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
