// src/app/actions-panel.tsx
"use client";
import { useMemo, useState } from "react";
import { SparklesIcon, XMarkIcon } from "./icons";
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
import { buildRowTokens } from "./row-tokens";
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

  // ★★ ONE map over the hero AND every tier's rows, because they are all
  //    rendered in one list at one time and are therefore ONE naming population
  //    (§324).
  // ★★★ THE REASON IS NOT "TWO MAPS WOULD EACH NUMBER FROM 1" — an earlier
  //    revision of this comment said exactly that and it is FALSE, measured by
  //    mutant: `buildRowTokens` numbers only when a name REPEATS inside the map
  //    it was given, so a map with one member emits a BARE token, never "(1)".
  //    That is what makes splitting dangerous rather than merely redundant. Split
  //    the map on ANY axis and two members sharing a title can each land alone in
  //    their own map, so BOTH come out bare and collide:
  //      · hero-vs-rows — a hero and a single row sharing a title;
  //      · per-tier — a `now` row and a `soon` row sharing a title.
  //    Pinned by "keeps the hero and a cross-tier row in one naming population"
  //    in `actions-panel.test.tsx`, whose fixture is built to kill both.
  // ★★ Built over `groups` — the STABLE FULL population, not the currently
  //    VISIBLE one. Every group is rendered AT MOST once — as the hero, or by a
  //    tier list that filters `g.key !== heroKey`, and a capped-out or collapsed
  //    group not at all — so tokenising `groups` cannot double-count. (Not
  //    "exactly once": the visibility cap is precisely why some appear zero
  //    times, which is the whole point of tokenising the full population.)
  //    Tokenising the visible slice instead would make a row's
  //    accessible name CHANGE when an unrelated tier is expanded past
  //    `MAX_VISIBLE_PER_TIER` or the monitor group is toggled — a name that
  //    mutates under interaction is worse than the bug being fixed. The cost is
  //    that a row can show "(2)" while its "(1)" is currently capped out, which
  //    is acceptable and strictly better.
  // ★ An action title is FREE TEXT (`title.key` + params), so it can repeat; the
  //   rule is that free text always needs a token, and a plain qualifier is only
  //   enough for a value that cannot repeat in one rendered list.
  const actionTokens = useMemo(
    () => buildRowTokens(groups.map((g) => ({
      id: g.key,
      name: t(lang, g.primary.title.key, ...(g.primary.title.params ?? [])),
    }))),
    [groups, lang],
  );

  // §324 — the AI list is its OWN naming population, tokenised separately from
  // `actionTokens` above. An `AiAction` carries no stable id, so the INDEX is
  // the id, matching the list key this section already uses.
  // ★★ SEPARATE ON PURPOSE, and the section segment in `AiActionRow` is what
  //    makes that safe: keeping the populations apart means an analysis
  //    appearing or disappearing cannot perturb a group row's name at all.
  // ★★★ NOT because a merge "would renumber every group row" — an earlier
  //    revision said that and it is false. `buildRowTokens` numbers a row only
  //    when its collapsed name repeats INSIDE the map it was handed, so a merge
  //    would move only the group rows an AI action actually shares a title with.
  // ★ Hoisted to a local const because `react-hooks/exhaustive-deps` rejects an
  //   `obj.member` dependency, and every lint warning is fatal here.
  const aiActions = aiAnalysis?.result?.actions;
  const aiActionTokens = useMemo(
    () => buildRowTokens((aiActions ?? []).map((a, i) => ({ id: i, name: a.title }))),
    [aiActions],
  );

  // Shared handler/config props threaded identically to ActionRow and ActionHeroCard.
  // ★ `rowToken` is deliberately NOT folded in here — `rowProps` is by definition
  //   the props identical for every row, and this one is per-instance.
  // ★★ Both render sites therefore write `{...rowProps}` FIRST and `rowToken`
  //    AFTER. JSX spread wins on duplicate keys and tsc does not object, so with
  //    the opposite order a future edit folding `rowToken` into `rowProps` — the
  //    very thing this comment forbids — would silently override every
  //    per-instance token with one shared value and no compiler signal. The
  //    ordering makes the guard structural instead of merely advisory.
  const rowProps = {
    lang, expertMode, onOpen, onSnooze, onCreateTask, assignOwner,
    onDraftMessage, escalate, rebaseline, reschedule, onMarkDone, onClearBlocker,
  };
  // ★ `?? ""` cannot actually fire: the map is keyed by `g.key` over the same
  //   `groups` array every render site draws from.
  const renderRow = (g: ActionGroup) => (
    <ActionRow key={g.key} action={g.primary} extraReasons={g.extra} {...rowProps} rowToken={actionTokens.get(g.key) ?? ""} />
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
            // ★ variant/size are PASSED, not defaulted: this is the pane's
            //   primary action and leads the control row (AGENTS.md's toolbar
            //   convention). Letting it fall back to the component's
            //   secondary/xs default would restyle a primary CTA by accident.
            <AiTriggerButton
              lang={lang}
              busy={aiAnalysis.busy}
              onRun={aiAnalysis.onAnalyze}
              onCancel={aiAnalysis.onCancel}
              idleLabelKey="actionAiAnalyze"
              idleIcon={<SparklesIcon aria-hidden="true" className="h-4 w-4" />}
              variant="primary"
              size="sm"
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
              <AiActionRow key={`${a.title}:${i}`} lang={lang} action={a} rowToken={aiActionTokens.get(i) ?? a.title} onAct={aiAnalysis.onActAi} />
            ))}
          </div>
        </section>
      )}
      {groups.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t(lang, "actionsEmptyState")}</p>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-auto pr-2">
          {hero && <ActionHeroCard group={hero} {...rowProps} rowToken={actionTokens.get(hero.key) ?? ""} />}
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
