"use client";

import { t, type Lang } from "./i18n";
import { RagBadge } from "./rag-badge";
import type { MilestoneHorizon, MilestoneHorizonBuckets, HorizonEntry } from "./milestones";

interface MilestoneHorizonStripProps {
  lang: Lang;
  buckets: MilestoneHorizonBuckets;
  onOpenMilestone?: () => void;
}

const ORDER: readonly MilestoneHorizon[] = ["overdue", "thisWeek", "next2Weeks", "later"];
const LABEL_KEY: Record<MilestoneHorizon, Parameters<typeof t>[1]> = {
  overdue: "milestoneHorizonOverdue",
  thisWeek: "milestoneHorizonThisWeek",
  next2Weeks: "milestoneHorizonNext2Weeks",
  later: "milestoneHorizonLater",
};

function entryAlert(e: HorizonEntry): boolean {
  return e.status === "overdue" || e.status === "at-risk";
}

export function MilestoneHorizonStrip({ lang, buckets, onOpenMilestone }: MilestoneHorizonStripProps) {
  const total = ORDER.reduce((n, k) => n + buckets[k].length, 0);
  if (total === 0) {
    return <p className="text-sm text-muted-foreground">{t(lang, "milestoneHorizonEmpty")}</p>;
  }
  return (
    <div className="space-y-3">
      {ORDER.filter((k) => buckets[k].length > 0).map((k) => (
        <div key={k}>
          <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
            {t(lang, "milestoneHorizonCount", t(lang, LABEL_KEY[k]), String(buckets[k].length))}
          </p>
          <ul className="flex flex-wrap gap-2">
            {buckets[k].map((e) => {
              const alert = entryAlert(e);
              const label = `${alert ? "⚠ " : ""}${e.milestone.name} · ${e.milestone.date}`;
              return (
                <li key={e.milestone.id}>
                  {onOpenMilestone ? (
                    <button
                      type="button"
                      onClick={() => onOpenMilestone()}
                      className="inline-flex items-center gap-1 rounded-full border border-line bg-surface px-2.5 py-0.5 text-xs text-foreground hover:bg-surface-muted hover:border-AIPM-dark-blue"
                    >
                      {alert && <RagBadge value={e.status === "overdue" ? "R" : "A"} lang={lang} />}
                      {label}
                    </button>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full border border-line px-2.5 py-0.5 text-xs text-muted-foreground">
                      {alert && <RagBadge value={e.status === "overdue" ? "R" : "A"} lang={lang} />}
                      {label}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
