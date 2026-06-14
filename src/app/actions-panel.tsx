// src/app/actions-panel.tsx
"use client";
import { type Lang, t, type TranslationKey } from "./i18n";
import { VIEW_PANE_FILL_CLASS } from "./view-styles";
import { ActionRow } from "./action-row";
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
}

export function ActionsPanel({ lang, actions, onOpen, onSnooze }: ActionsPanelProps) {
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
            return (
              <section key={tier}>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t(lang, labelKey)} ({rows.length})
                </h3>
                <div className="flex flex-col gap-2">
                  {rows.map((a) => (
                    <ActionRow key={a.id} lang={lang} action={a} onOpen={onOpen} onSnooze={onSnooze} />
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
