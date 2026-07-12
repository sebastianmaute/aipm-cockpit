// src/app/actions-panel.tsx
"use client";
import { useMemo, useState } from "react";
import { type Lang, t, type TranslationKey } from "./i18n";
import { VIEW_PANE_RESIZABLE_CLASS } from "./view-styles";
import { useResizable } from "./use-resizable";
import { ResetSizeButton, PrintButton } from "./task-manager-ui";
import { Modal } from "./modal";
import { ActionRow } from "./action-row";
import { ActionHeroCard } from "./action-hero-card";
import { AiActionRow } from "./ai-action-row";
import type { AiAction, ActionAnalysis } from "./action-ai";
import type { AssignOwnerBundle } from "./action-row";
import type { EscalateBundle } from "./escalate-popover";
import type { RebaselineBundle } from "./rebaseline-popover";
import type { RescheduleBundle } from "./reschedule-popover";
import type { SuggestedAction, ActionTier } from "./next-actions/types";
import { groupNextActions, type ActionGroup } from "./next-actions/group";
import { TIER_RAG } from "./next-actions/action-cta";

const TIERS: { tier: ActionTier; labelKey: TranslationKey }[] = [
  { tier: "now", labelKey: "actionTierNow" },
  { tier: "soon", labelKey: "actionTierSoon" },
  { tier: "monitor", labelKey: "actionTierMonitor" },
];

const MAX_VISIBLE_PER_TIER = 5;

export interface AiAnalysisBundle {
  enabled: boolean;
  busy: boolean;
  error: string | null;
  result: ActionAnalysis | null;
  onAnalyze: () => void;
  onCancel: () => void;
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
  reschedule?: RescheduleBundle;
  onMarkDone?: (action: SuggestedAction) => void;
  onClearBlocker?: (action: SuggestedAction) => void;
  learningEnabled?: boolean;
  expertMode?: boolean;
  onOpenLearningSettings?: () => void;
  aiAnalysis?: AiAnalysisBundle;
}

export function ActionsPanel({ lang, actions, onOpen, onSnooze, onCreateTask, assignOwner, onDraftMessage, escalate, rebaseline, reschedule, onMarkDone, onClearBlocker, learningEnabled, expertMode, onOpenLearningSettings, aiAnalysis }: ActionsPanelProps) {
  const [monitorOpen, setMonitorOpen] = useState(false);
  const { ref, reset } = useResizable("aipm-cockpit:actions-size");
  const groups = useMemo(() => groupNextActions(actions), [actions]);
  const [expanded, setExpanded] = useState<Record<"now" | "soon", boolean>>({ now: false, soon: false });
  // Shared handler/config props threaded identically to ActionRow and ActionHeroCard.
  const rowProps = {
    lang, expertMode, onOpen, onSnooze, onCreateTask, assignOwner,
    onDraftMessage, escalate, rebaseline, reschedule, onMarkDone, onClearBlocker,
  };
  const renderRow = (g: ActionGroup) => (
    <ActionRow key={g.key} action={g.primary} extraReasons={g.extra} {...rowProps} />
  );

  // Hero = the single top-ranked group, but only when it carries real urgency
  // (tier !== monitor — never promote a low/monitor item to "Do this first").
  const hero = groups[0] && groups[0].tier !== "monitor" ? groups[0] : null;
  const heroKey = hero?.key;
  return (
    <div ref={ref} className={`${VIEW_PANE_RESIZABLE_CLASS} print-root`}>
      <div className="mb-4 flex shrink-0 items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div>
            <h2 className="text-lg font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey">
              {t(lang, "actionCenterTitle")}
            </h2>
            <p className="text-sm text-muted-foreground">{t(lang, "actionCenterSubtitle")}</p>
          </div>
          {aiAnalysis?.enabled && (
            <button
              type="button"
              onClick={aiAnalysis.onAnalyze}
              disabled={aiAnalysis.busy}
              aria-busy={aiAnalysis.busy}
              aria-label={t(lang, "actionAiAnalyze")}
              title={t(lang, "actionAiAnalyze")}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-AIPM-dark-blue px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-AIPM-dark-blue focus:ring-offset-2 disabled:opacity-50 print:hidden"
            >
              <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="h-4 w-4">
                <path d="M10 1.5l1.6 4.3 4.3 1.6-4.3 1.6L10 13.3 8.4 9 4.1 7.4l4.3-1.6L10 1.5zM15.5 12l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8.8-2.2z" />
              </svg>
              <span>{t(lang, "actionAiAnalyze")}</span>
            </button>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2 print:hidden">
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
          <PrintButton lang={lang} />
          <ResetSizeButton onClick={reset} lang={lang} />
        </div>
      </div>
      {aiAnalysis?.error && (
        <p role="alert" className="mb-3 text-sm text-AIPM-pink-strong">
          {aiAnalysis.error === "limit"
            ? t(lang, "aiUsageLimitReached")
            : /^\d+$/.test(aiAnalysis.error)
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
      {groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t(lang, "actionsEmptyState")}</p>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-auto pr-2">
          {hero && <ActionHeroCard group={hero} {...rowProps} />}
          {TIERS.map(({ tier, labelKey }) => {
            const rows = groups.filter((g) => g.tier === tier && g.key !== heroKey);
            if (rows.length === 0) return null;
            if (tier === "monitor") {
              return (
                <section key={tier}>
                  <button
                    type="button"
                    aria-expanded={monitorOpen}
                    aria-controls="action-monitor-list"
                    onClick={() => setMonitorOpen((o) => !o)}
                    className="mb-2 inline-flex w-full items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground"
                  >
                    <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${TIER_RAG.monitor.dot}`} />
                    <span aria-hidden>{monitorOpen ? "▾" : "▸"}</span>
                    {t(lang, "actionMonitoredCount", rows.length)}
                  </button>
                  <div id="action-monitor-list" className="flex flex-col gap-2" hidden={!monitorOpen}>
                    {rows.map(renderRow)}
                  </div>
                </section>
              );
            }
            const open = expanded[tier as "now" | "soon"];
            const visible = open ? rows : rows.slice(0, MAX_VISIBLE_PER_TIER);
            const hiddenCount = rows.length - visible.length;
            return (
              <section key={tier}>
                <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${TIER_RAG[tier].dot}`} />
                  {t(lang, labelKey)} ({rows.length})
                </h3>
                <div id={`action-${tier}-list`} className="flex flex-col gap-2">{visible.map(renderRow)}</div>
                {rows.length > MAX_VISIBLE_PER_TIER && (
                  <button
                    type="button"
                    aria-expanded={open}
                    aria-controls={`action-${tier}-list`}
                    aria-label={`${t(lang, labelKey)} – ${open ? t(lang, "actionShowLess") : t(lang, "actionShowMore", hiddenCount)}`}
                    onClick={() => setExpanded((e) => ({ ...e, [tier]: !open }))}
                    className="mt-2 text-xs font-medium text-AIPM-dark-blue hover:underline dark:text-AIPM-light-grey"
                  >
                    {open ? t(lang, "actionShowLess") : t(lang, "actionShowMore", hiddenCount)}
                  </button>
                )}
              </section>
            );
          })}
        </div>
      )}
      {/* Blocking loading modal while the AI analysis call is in flight (mirrors the
          Timelog fetch modal). Not dismissible by backdrop; Cancel aborts the call. */}
      {aiAnalysis?.busy && (
        <Modal open onClose={aiAnalysis.onCancel} ariaLabel={t(lang, "actionAiAnalyzing")} align="center" zIndex={70}>
          <div
            role="status"
            aria-live="polite"
            className="flex flex-col items-center gap-4 rounded-lg border border-line bg-surface px-8 py-6 text-foreground"
          >
            <span
              aria-hidden="true"
              className="h-7 w-7 animate-spin rounded-full border-2 border-AIPM-dark-blue border-t-transparent"
            />
            <span className="text-sm font-medium">{t(lang, "actionAiAnalyzing")}</span>
            <button
              type="button"
              onClick={aiAnalysis.onCancel}
              className="rounded-md border border-line bg-surface px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground focus:outline-none focus:ring-2 focus:ring-AIPM-green"
            >
              {t(lang, "cancel")}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
