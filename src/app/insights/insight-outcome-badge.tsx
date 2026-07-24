"use client";
// Presentational SP3 outcome badge. Props-only (no context) so BOTH the
// dashboard card and the Insights view can render it. The direction rides the
// DOT (non-text, AA-exempt); the wording is muted text and carries the meaning
// on its own, so the badge is never colour-only.
import { t, type Lang } from "../i18n";
import { Dot } from "../dot";
import type { InsightOutcome } from "./insight";

// Deliberately NOT `RagDot`: its `level` is `Health` ("R"|"A"|"G"), which cannot
// express the neutral "unchanged" state — mapping neutral to amber would read as
// "at risk". This local token map stays here (the established pattern for every
// non-Health dot: TIER_RAG in actions-panel/action-chips, the resource-picker
// linked marker, tour step dots) and feeds the shared size+shape `Dot` atom's
// `color` prop. Please don't "fix" this into RagDot.
const DIRECTION_DOT: Record<InsightOutcome["direction"], string> = {
  improved: "bg-[var(--rag-green)]",
  unchanged: "bg-ui-medium-grey",
  worsened: "bg-[var(--rag-red)]",
};

export interface InsightOutcomeBadgeProps {
  readonly outcome: InsightOutcome;
  readonly lang: Lang;
}

export function InsightOutcomeBadge({ outcome, lang }: InsightOutcomeBadgeProps) {
  // `delta` is baseline − current, so a worsened outcome carries a NEGATIVE
  // delta — display the magnitude, the wording already states the direction.
  // `delta` is absent when the condition merely CLEARED a threshold — we know the
  // problem went away but not by how much, so state that instead of inventing a
  // magnitude (see InsightOutcome.current).
  const magnitude = outcome.delta === undefined ? null : String(Math.abs(outcome.delta));
  const text =
    magnitude === null
      ? t(lang, "insightOutcomeResolved")
      : outcome.direction === "improved"
        ? t(lang, "insightOutcomeImproved", magnitude)
        : outcome.direction === "worsened"
          ? t(lang, "insightOutcomeWorsened", magnitude)
          : t(lang, "insightOutcomeUnchanged");
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <Dot color={DIRECTION_DOT[outcome.direction]} size="sm" />
      {text}
    </span>
  );
}
