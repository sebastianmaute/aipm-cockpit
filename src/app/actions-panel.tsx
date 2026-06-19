// src/app/actions-panel.tsx
"use client";
import { useState } from "react";
import { type Lang, t, type TranslationKey } from "./i18n";
import { VIEW_PANE_RESIZABLE_CLASS } from "./view-styles";
import { useResizable } from "./use-resizable";
import { ResetSizeButton } from "./task-manager-ui";
import { ActionRow } from "./action-row";
import { AiActionRow } from "./ai-action-row";
import type { AiAction, ActionAnalysis } from "./action-ai";
import type { AssignOwnerBundle } from "./action-row";
import type { EscalateBundle } from "./escalate-popover";
import type { RebaselineBundle } from "./rebaseline-popover";
import type { SuggestedAction, ActionTier } from "./next-actions/types";

const TIERS: { tier: ActionTier; labelKey: TranslationKey }[] = [
  { tier: "now", labelKey: "actionTierNow" },
  { tier: "soon", labelKey: "actionTierSoon" },
  { tier: "monitor", labelKey: "actionTierMonitor" },
];

export interface AiAnalysisBundle {
  enabled: boolean;
  busy: boolean;
  error: string | null;
  result: ActionAnalysis | null;
  onAnalyze: () => void;
  onClear: () => void;
  onActAi: (action: AiAction) => void;
}

interface ActionsPanelProps {
  lang: Lang;
  actions: readonly SuggestedAction[];
  onOpen: (action: SuggestedAction) => void;
  onSnooze?: (action: SuggestedAction, durationMs: number) => void;
  onCreateTask?: (action: SuggestedAction) => void;
  assignOwner?: AssignOwnerBundle;
  onDraftMessage?: (action: SuggestedAction) => void;
  escalate?: EscalateBundle;
  rebaseline?: RebaselineBundle;
  learningEnabled?: boolean;
  expertMode?: boolean;
  onOpenLearningSettings?: () => void;
  aiAnalysis?: AiAnalysisBundle;
}

export function ActionsPanel({ lang, actions, onOpen, onSnooze, onCreateTask, assignOwner, onDraftMessage, escalate, rebaseline, learningEnabled, expertMode, onOpenLearningSettings, aiAnalysis }: ActionsPanelProps) {
  const [monitorOpen, setMonitorOpen] = useState(false);
  const { ref, reset } = useResizable("lop-app:actions-size");
  return (
    <div ref={ref} className={VIEW_PANE_RESIZABLE_CLASS}>
      <div className="mb-4 flex shrink-0 items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey">
            {t(lang, "actionCenterTitle")}
          </h2>
          <p className="text-sm text-muted-foreground">{t(lang, "actionCenterSubtitle")}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {expertMode && (
            <button
              type="button"
              onClick={onOpenLearningSettings}
              aria-label={t(lang, "actionLearningGoToSettings")}
              title={t(lang, "actionLearningTooltip")}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-line bg-surface px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-AIPM-dark-blue/40 hover:bg-surface-muted"
            >
              <span>{t(lang, "actionLearningPrefix")}</span>
              <span
                className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                  learningEnabled ? "bg-AIPM-green text-white" : "bg-surface-muted text-muted-foreground"
                }`}
              >
                {t(lang, learningEnabled ? "actionLearningOn" : "actionLearningOff")}
              </span>
            </button>
          )}
          {aiAnalysis?.enabled && (
            <button
              type="button"
              onClick={aiAnalysis.onAnalyze}
              disabled={aiAnalysis.busy}
              aria-label={t(lang, "actionAiAnalyze")}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-line bg-surface px-2 py-1 text-xs font-medium text-AIPM-dark-blue transition-colors hover:border-AIPM-dark-blue/40 hover:bg-surface-muted disabled:opacity-50 dark:text-AIPM-light-grey"
            >
              {t(lang, aiAnalysis.busy ? "actionAiAnalyzing" : "actionAiAnalyze")}
            </button>
          )}
          <ResetSizeButton onClick={reset} lang={lang} />
        </div>
      </div>
      {aiAnalysis?.error && (
        <p role="alert" className="mb-3 text-sm text-AIPM-pink-strong">
          {/^\d+$/.test(aiAnalysis.error)
            ? t(lang, "actionAiErrorStatus", aiAnalysis.error)
            : aiAnalysis.error === "network"
              ? t(lang, "actionAiErrorNetwork")
              : t(lang, "actionAiErrorGeneric")}
        </p>
      )}
      {aiAnalysis?.result && (
        <section
          className="mb-5 rounded-md border border-AIPM-dark-blue/30 bg-AIPM-dark-blue/5 p-3"
          aria-label={t(lang, "actionAiSectionTitle")}
        >
          <div className="mb-2 flex items-start justify-between gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-AIPM-dark-blue dark:text-AIPM-light-grey">
              {t(lang, "actionAiSectionTitle")}
            </h3>
            <button
              type="button"
              onClick={aiAnalysis.onClear}
              aria-label={t(lang, "actionAiDismiss")}
              className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
            >
              ✕
            </button>
          </div>
          <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
            {t(lang, "actionAiDisclaimer")}
          </p>
          {aiAnalysis.result.summary && (
            <p className="mb-3 text-sm text-foreground">
              <span className="font-medium">{t(lang, "actionAiSummaryLabel")}: </span>
              {aiAnalysis.result.summary}
            </p>
          )}
          <div className="flex flex-col gap-2">
            {aiAnalysis.result.actions.map((a, i) => (
              <AiActionRow key={`${a.title}:${i}`} lang={lang} action={a} onAct={aiAnalysis.onActAi} />
            ))}
          </div>
        </section>
      )}
      {actions.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t(lang, "actionsEmptyState")}</p>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-auto pr-2">
          {TIERS.map(({ tier, labelKey }) => {
            const rows = actions
              .filter((a) => a.tier === tier)
              .slice()
              .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
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
                      <ActionRow key={a.id} lang={lang} action={a} onOpen={onOpen} onSnooze={onSnooze} onCreateTask={onCreateTask} assignOwner={assignOwner} onDraftMessage={onDraftMessage} escalate={escalate} rebaseline={rebaseline} />
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
                    <ActionRow key={a.id} lang={lang} action={a} onOpen={onOpen} onSnooze={onSnooze} onCreateTask={onCreateTask} assignOwner={assignOwner} onDraftMessage={onDraftMessage} escalate={escalate} rebaseline={rebaseline} />
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
