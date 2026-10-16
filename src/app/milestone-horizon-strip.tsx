"use client";

import type { ReactNode } from "react";
import { t, type Lang } from "./i18n";
import { chanceText } from "./chance-text";
import { SimBadge, SimPlaceholder, SIM_OUTLINE_CLASS } from "./sim-value";
import { RagBadge } from "./rag-badge";
import { buildRowTokens, rowLabel } from "./row-tokens";
import type { MilestoneHorizon, MilestoneHorizonBuckets, HorizonEntry } from "./milestones";
import type { MilestoneChance } from "./forecast/app-forecast";
import { Button } from "./button";

interface MilestoneHorizonStripProps {
  lang: Lang;
  buckets: MilestoneHorizonBuckets;
  onOpenMilestone?: (id: number) => void;
  /** Simulated chance on time per milestone id (§502); only `state: "chance"` entries. Absent → no chips. */
  chances?: ReadonlyMap<number, number>;
  /** Switch on, holidays still loading: a placeholder stands where each chip will be. */
  simPending?: boolean;
  /** The tile's one "About these chances" explainer, above the buckets. */
  explainer?: ReactNode;
}

const ORDER: readonly MilestoneHorizon[] = ["overdue", "thisWeek", "next2Weeks", "later"];
const LABEL_KEY: Record<MilestoneHorizon, Parameters<typeof t>[1]> = {
  overdue: "milestoneHorizonOverdue",
  thisWeek: "milestoneHorizonThisWeek",
  next2Weeks: "milestoneHorizonNext2Weeks",
  later: "milestoneHorizonLater",
};

function entryLabel(e: HorizonEntry): string {
  return `${entryAlert(e) ? "⚠ " : ""}${e.milestone.name} · ${e.milestone.date}`;
}

function entryAlert(e: HorizonEntry): boolean {
  return e.status === "overdue" || e.status === "at-risk";
}

/** Per-bucket chip cap so a large portfolio's "Later" bucket can't flood the
 *  dashboard. The header still shows the bucket's TRUE total; overflow collapses
 *  into a "+N more" affordance. */
const MAX_PER_BUCKET = 5;

/** The visible chip: percent plus the "sim" badge, both decorative. The accessible name lives on the
 *  chip's host (the Button's aria-label, or the sr-only span beside it). */
function ChanceChip({ lang, chance }: { lang: Lang; chance: number }) {
  return (
    <span aria-hidden="true" data-sim-chip="true" className={`inline-flex items-center gap-1 ${SIM_OUTLINE_CLASS}`}>
      <span className="text-xs font-medium text-foreground">{chanceText(lang, chance)}</span>
      <SimBadge lang={lang} />
    </span>
  );
}

/** id -> chance for the milestones the engine gave a chance (overdue and no-linked-task ones get none). */
export function chancesById(rows: readonly MilestoneChance[]): ReadonlyMap<number, number> {
  const out = new Map<number, number>();
  for (const r of rows) if (r.state === "chance") out.set(r.id, r.chance);
  return out;
}

/** How many chance chips DRAW: only the entries inside each bucket's cap count, so a chance on a
 *  "+N more" milestone leaves no chip and therefore no explainer. */
export function visibleChipCount(buckets: MilestoneHorizonBuckets, chances: ReadonlyMap<number, number> | undefined): number {
  if (!chances) return 0;
  return ORDER.reduce((n, k) => n + buckets[k].slice(0, MAX_PER_BUCKET).filter((e) => chances.has(e.milestone.id)).length, 0);
}

export function MilestoneHorizonStrip({ lang, buckets, onOpenMilestone, chances, simPending, explainer }: MilestoneHorizonStripProps) {
  const total = ORDER.reduce((n, k) => n + buckets[k].length, 0);
  // §669 — two milestones can share a name and a date. Bare, not memoised: at
  // most MAX_PER_BUCKET chips per bucket, and the rows are already in hand.
  const tokens = buildRowTokens(
    ORDER.flatMap((k) => buckets[k].slice(0, MAX_PER_BUCKET)).map((e) => ({ id: e.milestone.id, name: entryLabel(e) })),
  );
  if (total === 0) {
    return <p className="text-sm text-muted-foreground">{t(lang, "milestoneHorizonEmpty")}</p>;
  }
  const hasChip = visibleChipCount(buckets, chances) > 0;
  return (
    <div className="space-y-3">
      {hasChip && explainer}
      {ORDER.filter((k) => buckets[k].length > 0).map((k) => (
        <div key={k}>
          <p className="mb-1 text-xs font-semibold uppercase text-muted-foreground">
            {t(lang, "milestoneHorizonCount", t(lang, LABEL_KEY[k]), String(buckets[k].length))}
          </p>
          <ul className="flex flex-wrap gap-2">
            {buckets[k].slice(0, MAX_PER_BUCKET).map((e) => {
              const alert = entryAlert(e);
              const label = entryLabel(e);
              const chance = chances?.get(e.milestone.id);
              const chanceSr = chance === undefined ? undefined : t(lang, "milestoneChanceChipSr", chanceText(lang, chance));
              const chip = chance !== undefined
                ? <ChanceChip lang={lang} chance={chance} />
                : simPending && e.status !== "overdue" && (e.milestone.linkedTaskIds?.length ?? 0) > 0
                  ? <SimPlaceholder />
                  : null;
              return (
                <li key={e.milestone.id}>
                  {onOpenMilestone ? (
                    <Button
                      onClick={() => onOpenMilestone(e.milestone.id)}
                      aria-label={chanceSr ? `${tokens.get(e.milestone.id) ?? label}, ${chanceSr}` : (tokens.get(e.milestone.id) ?? label)}
                      variant="secondary" size="xs" className="inline-flex items-center gap-1"
                    >
                      {alert && (
                        <span aria-hidden="true">
                          <RagBadge value={e.status === "overdue" ? "R" : "A"} lang={lang} />
                        </span>
                      )}
                      {label}
                      {chip}
                    </Button>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-md border border-line px-2.5 py-1.5 text-xs text-muted-foreground">
                      {alert && (
                        <span aria-hidden="true">
                          <RagBadge value={e.status === "overdue" ? "R" : "A"} lang={lang} />
                        </span>
                      )}
                      {label}
                      {chip}
                      {chanceSr && <span className="sr-only">{chanceSr}</span>}
                    </span>
                  )}
                </li>
              );
            })}
            {buckets[k].length > MAX_PER_BUCKET && (
              <li>
                {onOpenMilestone ? (
                  <Button
                    onClick={() => onOpenMilestone(-1)}
                    // Two buckets with the same overflow read alike, so the bucket is in the name.
                    aria-label={rowLabel(t(lang, "milestoneHorizonMore", String(buckets[k].length - MAX_PER_BUCKET)), t(lang, LABEL_KEY[k]))}
                    variant="secondary" size="xs"
                  >
                    {t(lang, "milestoneHorizonMore", String(buckets[k].length - MAX_PER_BUCKET))}
                  </Button>
                ) : (
                  <span className="rounded-md border border-line px-2.5 py-1.5 text-xs text-muted-foreground">
                    {t(lang, "milestoneHorizonMore", String(buckets[k].length - MAX_PER_BUCKET))}
                  </span>
                )}
              </li>
            )}
          </ul>
        </div>
      ))}
    </div>
  );
}
