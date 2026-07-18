"use client";

import { t, type Lang } from "./i18n";
import { Card } from "./card";
import { RagBadge } from "./rag-badge";
import { INTERACTIVE } from "./interaction-styles";
import { healthColorName } from "./health";
import type { DeltaResult, GreetingTimeKey, RagScope } from "./dashboard-delta";

interface GreetingResult {
  greetingKey: GreetingTimeKey;
  summary: { needsYou: number; milestonesSoon: number };
}

interface DashboardDeltaStripProps {
  lang: Lang;
  delta: DeltaResult;
  greeting: GreetingResult;
  onOpenTask?: () => void;
  onOpenRaid?: () => void;
  onOpenMilestone?: () => void;
  onOpenChange?: () => void;
}

const SCOPE_LABEL_KEY: Record<RagScope, Parameters<typeof t>[1]> = {
  overall: "dashboardOverall",
  schedule: "dashboardSubSchedule",
  budget: "dashboardSubBudget",
  scope: "dashboardSubScope",
};

interface Chip {
  key: string;
  label: string;
  onClick?: () => void;
}

function buildChips(lang: Lang, delta: DeltaResult, handlers: Pick<DashboardDeltaStripProps, "onOpenTask" | "onOpenRaid" | "onOpenMilestone" | "onOpenChange">): Chip[] {
  const chips: Chip[] = [];
  const c = delta.counts;
  if (c.tasks.created > 0) chips.push({ key: "t-c", label: t(lang, "dashboardDeltaTasksCreated", String(c.tasks.created)), onClick: handlers.onOpenTask });
  if (c.tasks.updated + c.tasks.statusChanged > 0) chips.push({ key: "t-u", label: t(lang, "dashboardDeltaTasksUpdated", String(c.tasks.updated + c.tasks.statusChanged)), onClick: handlers.onOpenTask });
  if (c.tasks.completed > 0) chips.push({ key: "t-d", label: t(lang, "dashboardDeltaTasksCompleted", String(c.tasks.completed)), onClick: handlers.onOpenTask });
  const raidN = c.raid.created + c.raid.updated + c.raid.statusChanged + c.raid.completed;
  if (raidN > 0) chips.push({ key: "r", label: t(lang, "dashboardDeltaRaidChanged", String(raidN)), onClick: handlers.onOpenRaid });
  const msN = c.milestone.created + c.milestone.updated + c.milestone.statusChanged + c.milestone.completed;
  if (msN > 0) chips.push({ key: "m", label: t(lang, "dashboardDeltaMilestoneChanged", String(msN)), onClick: handlers.onOpenMilestone });
  const chN = c.change.created + c.change.updated + c.change.statusChanged + c.change.completed;
  if (chN > 0) chips.push({ key: "c", label: t(lang, "dashboardDeltaChangeChanged", String(chN)), onClick: handlers.onOpenChange });
  if (delta.newOverdue.length > 0) chips.push({ key: "od", label: t(lang, "dashboardDeltaNewOverdue", String(delta.newOverdue.length)), onClick: handlers.onOpenTask });
  return chips;
}

export function DashboardDeltaStrip({ lang, delta, greeting, onOpenTask, onOpenRaid, onOpenMilestone, onOpenChange }: DashboardDeltaStripProps) {
  const chips = buildChips(lang, delta, { onOpenTask, onOpenRaid, onOpenMilestone, onOpenChange });
  const sinceDate = delta.since ? delta.since.slice(0, 10) : "";

  return (
    <Card boxed padded>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-lg font-semibold text-ui-dark-blue dark:text-ui-light-grey">
          {t(lang, greeting.greetingKey)}
        </span>
        {(greeting.summary.needsYou > 0 || greeting.summary.milestonesSoon > 0) && (
          <span className="text-sm text-muted-foreground">
            {t(lang, "dashboardGreetingSummary", String(greeting.summary.needsYou), String(greeting.summary.milestonesSoon))}
          </span>
        )}
      </div>

      <div className="mt-2">
        {delta.isFirstVisit ? (
          <p className="text-sm text-muted-foreground">{t(lang, "dashboardDeltaWelcome")}</p>
        ) : delta.total === 0 ? (
          <p className="text-sm text-muted-foreground">{t(lang, "dashboardDeltaAllCaught", sinceDate)}</p>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold uppercase text-muted-foreground">{t(lang, "dashboardDeltaSinceTitle")}</span>
            {chips.map((chip) =>
              chip.onClick ? (
                <button
                  key={chip.key}
                  type="button"
                  onClick={chip.onClick}
                  className={`rounded-full border border-line bg-surface px-2.5 py-0.5 text-xs text-foreground hover:bg-surface-muted hover:border-ui-dark-blue ${INTERACTIVE}`}
                >
                  {chip.label}
                </button>
              ) : (
                <span key={chip.key} className="rounded-full border border-line px-2.5 py-0.5 text-xs text-muted-foreground">{chip.label}</span>
              ),
            )}
            {delta.ragFlips.map((flip) => (
              <span key={`flip-${flip.scope}`} className="inline-flex items-center gap-1 rounded-full border border-line px-2.5 py-0.5 text-xs text-muted-foreground">
                <RagBadge value={flip.to} lang={lang} />
                {t(lang, "dashboardDeltaFlip", t(lang, SCOPE_LABEL_KEY[flip.scope]), flip.from ? healthColorName(flip.from, lang) : "—", flip.to ? healthColorName(flip.to, lang) : "—")}
              </span>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}
