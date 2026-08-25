"use client";

// Dedicated Insights view (#6B SP1, task 7) — the full insight log with a
// status filter, a type filter, and a resolved/dismissed history toggle. A
// surface (i18n-aware); the persisted Insight stays language-neutral and the
// detection/reconcile engines live in `insights/`.
//
// Data source mirrors the dashboard InsightsCard: `insights` arrives as a PROP
// (workspace-section reads `useWorkspace().insights` and threads it); lifecycle
// callbacks arrive via the same `InsightActions` bag task-manager threads.

import { useMemo, useState } from "react";
import { type Lang, t, type TranslationKey } from "./i18n";
import { Button } from "./button";
import { Select } from "./form-controls";
import { Checkbox } from "./form-controls";
import { EmptyState } from "./empty-state";
import { RagDot } from "./rag-dot";
import { PrintButton, ResetSizeButton } from "./task-manager-ui";
import { useResizable } from "./use-resizable";
import { VIEW_PANE_RESIZABLE_CLASS } from "./view-styles";
import { insightTitle, insightDetail, insightRowTitles } from "./insights/insight-text";
import { InsightOutcomeBadge } from "./insights/insight-outcome-badge";
import { InsightDigestCard } from "./insights/insight-digest-card";
import { computeInsightDigest } from "./insights/digest";
import {
  INSIGHT_SEVERITY_RANK,
  INSIGHT_STATUSES,
  INSIGHT_TYPES,
  type Insight,
  type InsightActions,
  type InsightEntityRef,
  type InsightSeverity,
  type InsightStatus,
  type InsightType,
} from "./insights/insight";
import { InsightRecommendationControls } from "./insight-recommendation-controls";
import type { Health } from "./health";

// Severity rides the DOT (non-text, AA-exempt) — never tinted small text.
const SEVERITY_HEALTH: Record<InsightSeverity, Health> = { high: "R", medium: "A", low: "G" };
const SEVERITY_LABEL_KEY: Record<InsightSeverity, TranslationKey> = {
  high: "insightSeverityHigh",
  medium: "insightSeverityMedium",
  low: "insightSeverityLow",
};
const STATUS_LABEL_KEY: Record<InsightStatus, TranslationKey> = {
  active: "insightStatusActive",
  acknowledged: "insightStatusAcknowledged",
  acted: "insightStatusActed",
  dismissed: "insightStatusDismissed",
  resolved: "insightStatusResolved",
};
const TYPE_LABEL_KEY: Record<InsightType, TranslationKey> = {
  milestoneSlip: "insightMilestoneSlipTitle",
  overdueTrend: "insightOverdueTrendTitle",
  stalledWork: "insightStalledWorkTitle",
  budgetVariance: "insightBudgetVarianceTitle",
  raidAging: "insightRaidAgingTitle",
};

type StatusFilter = "all" | InsightStatus;
type TypeFilter = "all" | InsightType;

const TERMINAL: ReadonlySet<InsightStatus> = new Set<InsightStatus>(["dismissed", "resolved"]);

export interface InsightsPanelProps {
  insights: readonly Insight[];
  lang: Lang;
  /** Today in the effective timezone. Passed in — a `new Date()` in a render
   *  body is a react-hooks purity violation (and would break test determinism). */
  today: string;
  /** Lifecycle callbacks; omit (or `isPopout`) for a read-only log. */
  actions?: InsightActions;
  /** Id of the insight whose AI recommendation is generating (#6B SP2) —
   *  PER-ROW: only that row's CTA shows Stop. */
  generatingId?: number | null;
  /** Aborts the in-flight recommendation generate. */
  onCancelGenerate?: () => void;
  aiEnabled?: boolean;
  /** Deep-link to the insight's entity (only rendered when `entityRef` is set). */
  onOpen?: (ref: InsightEntityRef) => void;
  isPopout?: boolean;
}

/** Full insight log with filters + lifecycle controls. */
export function InsightsPanel({
  insights,
  lang,
  today,
  actions,
  generatingId,
  onCancelGenerate,
  aiEnabled,
  onOpen,
  isPopout,
}: InsightsPanelProps) {
  const { ref: paneRef, reset: resetSize } = useResizable("aipm-cockpit:insights-size");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("all");
  const [showHistory, setShowHistory] = useState(false);

  const rows = useMemo(() => {
    return insights
      .filter((i) => {
        if (typeFilter !== "all" && i.type !== typeFilter) return false;
        if (statusFilter !== "all") return i.status === statusFilter;
        // status = all: hide resolved/dismissed unless the history toggle is on.
        if (!showHistory && TERMINAL.has(i.status)) return false;
        return true;
      })
      .slice()
      .sort(
        (a, b) =>
          INSIGHT_SEVERITY_RANK[a.severity] - INSIGHT_SEVERITY_RANK[b.severity] ||
          b.lastSeenAt.localeCompare(a.lastSeenAt),
      );
  }, [insights, statusFilter, typeFilter, showHistory]);

  // ★★ Row-unique names (WCAG 2.4.6) — `insightTitle` is type-driven and
  // nothing else, so two insights of one type (the ORDINARY case: detect.ts
  // mints one milestoneSlip per overdue milestone) render byte-identical
  // control names without this. Derived from `rows` — the filtered/sorted
  // array actually mapped below — not from `insights`, so the occurrence
  // index follows what is on screen.
  const rowTitles = useMemo(() => insightRowTitles(rows, lang), [rows, lang]);

  const digest = useMemo(() => computeInsightDigest(insights, today), [insights, today]);

  const canWrite = !isPopout && !!actions;

  return (
    <div ref={paneRef} className={`print-root ${VIEW_PANE_RESIZABLE_CLASS}`}>
      <div className="mb-2 flex shrink-0 flex-wrap items-center gap-2">
        <h2 className="text-lg font-medium text-foreground">{t(lang, "insightsCardTitle")}</h2>
        <Select
          size="xs"
          aria-label={t(lang, "insightsFilterStatus")}
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
          className="print:hidden"
        >
          <option value="all">{t(lang, "insightStatusAll")}</option>
          {INSIGHT_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(lang, STATUS_LABEL_KEY[s])}
            </option>
          ))}
        </Select>
        <Select
          size="xs"
          aria-label={t(lang, "insightsFilterType")}
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}
          className="print:hidden"
        >
          <option value="all">{t(lang, "insightTypeAll")}</option>
          {INSIGHT_TYPES.map((ty) => (
            <option key={ty} value={ty}>
              {t(lang, TYPE_LABEL_KEY[ty])}
            </option>
          ))}
        </Select>
        <label className="flex items-center gap-1.5 text-sm text-foreground print:hidden">
          <Checkbox
            checked={showHistory}
            onChange={(e) => setShowHistory(e.target.checked)}
          />
          {t(lang, "insightsShowHistory")}
        </label>
        <div className="ml-auto flex items-center gap-2 print:hidden">
          <PrintButton lang={lang} />
          <ResetSizeButton onClick={resetSize} lang={lang} />
        </div>
      </div>

      <div className="min-h-[240px] flex-1 overflow-auto pr-2">
        {/* Inside the scroller (not above it) so the digest scrolls with the
            content instead of squeezing the row list, and so it prints — the
            pane is `print-root`. Deep-links reuse the EXISTING `onOpen`
            channel; the card itself only ever offers a button on a row that
            HAS an entityRef, and the adapter re-checks so `onOpen` can never
            be called with undefined. */}
        <InsightDigestCard
          digest={digest}
          lang={lang}
          onOpenInsight={
            onOpen
              ? (insight) => {
                  const ref = insight.entityRef;
                  if (ref) onOpen(ref);
                }
              : undefined
          }
        />
        {insights.length === 0 ? (
          <EmptyState title={t(lang, "insightsViewEmpty")} />
        ) : rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{t(lang, "insightsNoMatches")}</p>
        ) : (
          <ul className="flex flex-col gap-2 p-1">
            {rows.map((insight) => {
              const title = rowTitles.get(insight.id) ?? insightTitle(insight, lang);
              const detail = insightDetail(insight, lang);
              const showAck = insight.status === "active";
              const showAct = insight.status === "active" || insight.status === "acknowledged";
              const showDismiss = !TERMINAL.has(insight.status);
              return (
                <li
                  key={insight.id}
                  className="flex items-start gap-2 rounded-md border border-line bg-surface px-3 py-2"
                >
                  <RagDot
                    level={SEVERITY_HEALTH[insight.severity]}
                    size="md"
                    className="mt-1"
                    label={t(lang, SEVERITY_LABEL_KEY[insight.severity])}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground">{title}</p>
                    <p className="text-xs text-muted-foreground">{detail}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {t(lang, STATUS_LABEL_KEY[insight.status])}
                      {" · "}
                      {`${insight.occurrences}×`}
                      {" · "}
                      {t(lang, "insightLastSeen", insight.lastSeenAt.slice(0, 10))}
                      {insight.outcome ? (
                        <>
                          {" · "}
                          <InsightOutcomeBadge outcome={insight.outcome} lang={lang} />
                        </>
                      ) : null}
                    </p>
                    <div className="mt-1 flex flex-wrap items-center gap-1 print:hidden">
                      {insight.entityRef && onOpen ? (
                        <Button
                          variant="secondary"
                          size="xs"
                          aria-label={`${t(lang, "insightOpen")} – ${title}`}
                          onClick={() => onOpen(insight.entityRef!)}
                        >
                          {t(lang, "insightOpen")}
                        </Button>
                      ) : null}
                      {canWrite ? (
                        <>
                          {showAck ? (
                            <Button
                              variant="secondary"
                              size="xs"
                              aria-label={`${t(lang, "insightAcknowledge")} – ${title}`}
                              title={t(lang, "insightAcknowledgeHint")}
                              onClick={() => actions!.onAcknowledge(insight.id)}
                            >
                              {t(lang, "insightAcknowledge")}
                            </Button>
                          ) : null}
                          {showAct ? (
                            <Button
                              variant="secondary"
                              size="xs"
                              aria-label={`${t(lang, "insightAct")} – ${title}`}
                              title={t(lang, "insightActHint")}
                              onClick={() => actions!.onAct(insight.id)}
                            >
                              {t(lang, "insightAct")}
                            </Button>
                          ) : null}
                          {showDismiss ? (
                            <Button
                              variant="secondary"
                              size="xs"
                              aria-label={`${t(lang, "insightDismiss")} – ${title}`}
                              onClick={() => actions!.onDismiss(insight.id)}
                            >
                              {t(lang, "insightDismiss")}
                            </Button>
                          ) : null}
                          <InsightRecommendationControls
                            insight={insight}
                            title={title}
                            lang={lang}
                            actions={actions!}
                            generatingId={generatingId}
                            onCancelGenerate={onCancelGenerate}
                            aiEnabled={aiEnabled}
                          />
                        </>
                      ) : null}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
