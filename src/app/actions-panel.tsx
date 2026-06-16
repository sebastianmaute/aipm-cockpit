// src/app/actions-panel.tsx
"use client";
import { useState } from "react";
import { type Lang, t, type TranslationKey } from "./i18n";
import { VIEW_PANE_FILL_CLASS } from "./view-styles";
import { ActionRow } from "./action-row";
import type { AssignOwnerBundle } from "./action-row";
import type { EscalateBundle } from "./escalate-popover";
import type { SuggestedAction, ActionTier } from "./next-actions/types";

const TIERS: { tier: ActionTier; labelKey: TranslationKey }[] = [
  { tier: "now", labelKey: "actionTierNow" },
  { tier: "soon", labelKey: "actionTierSoon" },
  { tier: "monitor", labelKey: "actionTierMonitor" },
];

interface ActionsPanelProps {
  lang: Lang;
  actions: readonly SuggestedAction[];
  onOpen: (action: SuggestedAction) => void;
  onSnooze?: (action: SuggestedAction, durationMs: number) => void;
  onCreateTask?: (action: SuggestedAction) => void;
  assignOwner?: AssignOwnerBundle;
  onDraftMessage?: (action: SuggestedAction) => void;
  escalate?: EscalateBundle;
}

export function ActionsPanel({ lang, actions, onOpen, onSnooze, onCreateTask, assignOwner, onDraftMessage, escalate }: ActionsPanelProps) {
  const [monitorOpen, setMonitorOpen] = useState(false);
  return (
    <div className={VIEW_PANE_FILL_CLASS}>
      <div className="mb-4 shrink-0">
        <h2 className="text-lg font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey">
          {t(lang, "actionCenterTitle")}
        </h2>
        <p className="text-sm text-muted-foreground">{t(lang, "actionCenterSubtitle")}</p>
      </div>
      {actions.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t(lang, "actionsEmptyState")}</p>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-auto">
          {TIERS.map(({ tier, labelKey }) => {
            const rows = actions.filter((a) => a.tier === tier);
            if (rows.length === 0) return null;
            if (tier === "monitor") {
              return (
                <section key={tier}>
                  <button
                    type="button"
                    aria-expanded={monitorOpen}
                    aria-controls="action-monitor-list"
                    onClick={() => setMonitorOpen((o) => !o)}
                    className="mb-2 flex w-full items-center gap-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground"
                  >
                    <span aria-hidden>{monitorOpen ? "▾" : "▸"}</span>
                    {t(lang, "actionMonitoredCount", rows.length)}
                  </button>
                  <div id="action-monitor-list" className="flex flex-col gap-2" hidden={!monitorOpen}>
                    {rows.map((a) => (
                      <ActionRow key={a.id} lang={lang} action={a} onOpen={onOpen} onSnooze={onSnooze} onCreateTask={onCreateTask} assignOwner={assignOwner} onDraftMessage={onDraftMessage} escalate={escalate} />
                    ))}
                  </div>
                </section>
              );
            }
            return (
              <section key={tier}>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t(lang, labelKey)} ({rows.length})
                </h3>
                <div className="flex flex-col gap-2">
                  {rows.map((a) => (
                    <ActionRow key={a.id} lang={lang} action={a} onOpen={onOpen} onSnooze={onSnooze} onCreateTask={onCreateTask} assignOwner={assignOwner} onDraftMessage={onDraftMessage} escalate={escalate} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
