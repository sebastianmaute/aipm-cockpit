// src/app/actions-panel.tsx
"use client";
import { useMemo, useState } from "react";
import { SparklesIcon, XMarkIcon } from "@heroicons/react/24/outline";
import { type Lang, t, type TranslationKey } from "./i18n";
import { FieldError } from "./field-feedback";
import { AiTriggerButton } from "./ai-trigger-button";
import { TextButton } from "./text-button";
import { Spinner } from "./spinner";
import { Card } from "./card";
import { Badge } from "./badge";
import { IconButton } from "./icon-button";
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
import { Dot } from "./dot";

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
            <h2 className="text-lg font-semibold text-ui-dark-blue dark:text-ui-light-grey">
              {t(lang, "actionCenterTitle")}
            </h2>
            <p className="text-sm text-muted-foreground">{t(lang, "actionCenterSubtitle")}</p>
          </div>
          {aiAnalysis?.enabled && (
            <AiTriggerButton
              lang={lang}
              busy={aiAnalysis.busy}
              onRun={aiAnalysis.onAnalyze}
              onCancel={aiAnalysis.onCancel}
              idleLabelKey="actionAiAnalyze"
              idleIcon={<SparklesIcon aria-hidden="true" className="h-4 w-4" />}
              className="shrink-0 print:hidden"
            />
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2 print:hidden">
          {expertMode && (
            <button
              type="button"
              onClick={onOpenLearningSettings}
              aria-label={t(lang, "actionLearningGoToSettings")}
              title={t(lang, "actionLearningTooltip")}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-line bg-surface px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-ui-dark-blue/40 hover:bg-surface-muted"
            >
              <span>{t(lang, "actionLearningPrefix")}</span>
              <Badge
                size="sm"
                className={`font-semibold uppercase tracking-wide ${
                  learningEnabled ? "bg-ui-green text-white" : "bg-surface-muted text-muted-foreground"
                }`}
              >
                {t(lang, learningEnabled ? "actionLearningOn" : "actionLearningOff")}
              </Badge>
            </button>
          )}
          <PrintButton lang={lang} />
          <ResetSizeButton onClick={reset} lang={lang} />
        </div>
      </div>
      {aiAnalysis?.error && (
        <FieldError>
          {aiAnalysis.error === "limit"
            ? t(lang, "aiUsageLimitReached")
            : /^\d+$/.test(aiAnalysis.error)
              ? t(lang, "actionAiErrorStatus", aiAnalysis.error)
              : aiAnalysis.error === "network"
                ? t(lang, "actionAiErrorNetwork")
                : t(lang, "actionAiErrorGeneric")}
        </FieldError>
      )}
      {aiAnalysis?.result && (
        <section
          className="mb-5 rounded-md border border-ui-dark-blue/30 bg-ui-dark-blue/5 p-3"
          aria-label={t(lang, "actionAiSectionTitle")}
        >
          <div className="mb-2 flex items-start justify-between gap-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-ui-dark-blue dark:text-ui-light-grey">
              {t(lang, "actionAiSectionTitle")}
            </h3>
            <IconButton
              onClick={aiAnalysis.onClear}
              label={t(lang, "actionAiDismiss")}
              title={t(lang, "actionAiDismiss")}
              className="shrink-0"
            >
              <XMarkIcon aria-hidden="true" className="h-4 w-4" />
            </IconButton>
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
                    <Dot color={TIER_RAG.monitor.dot} size="xs" />
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
                  <Dot color={TIER_RAG[tier].dot} size="xs" />
                  {t(lang, labelKey)} ({rows.length})
                </h3>
                <div id={`action-${tier}-list`} className="flex flex-col gap-2">{visible.map(renderRow)}</div>
                {rows.length > MAX_VISIBLE_PER_TIER && (
                  <TextButton
                    aria-expanded={open}
                    aria-controls={`action-${tier}-list`}
                    aria-label={`${t(lang, labelKey)} – ${open ? t(lang, "actionShowLess") : t(lang, "actionShowMore", hiddenCount)}`}
                    onClick={() => setExpanded((e) => ({ ...e, [tier]: !open }))}
                    className="mt-2 text-xs"
                  >
                    {open ? t(lang, "actionShowLess") : t(lang, "actionShowMore", hiddenCount)}
                  </TextButton>
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
          <Card
            role="status"
            aria-live="polite"
            className="flex flex-col items-center gap-4 px-8 py-6 text-foreground"
          >
            <Spinner />
            <span className="text-sm font-medium">{t(lang, "actionAiAnalyzing")}</span>
            <button
              type="button"
              onClick={aiAnalysis.onCancel}
              className="rounded-md border border-line bg-surface px-3 py-1.5 text-sm font-medium text-muted-foreground hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ui-green"
            >
              {t(lang, "cancel")}
            </button>
          </Card>
        </Modal>
      )}
    </div>
  );
}
