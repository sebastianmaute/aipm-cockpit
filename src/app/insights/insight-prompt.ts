// Pure, i18n-free, English-only. Renders the ACTIVE insight set — plus the
// recently ACTED-ON ones and what measurably happened — into a compact,
// terse fact block for the AI chat's system prompt (model-facing context, like
// the operating guides — English regardless of UI language). This is VOLATILE
// content: it MUST be appended AFTER the prompt-cache breakpoint in chat-api's
// buildSystemPrompt, never inside the cached prefix. Deterministic — no clock.
import { INSIGHT_SEVERITY_RANK, type Insight, type InsightOutcome } from "./insight";

/** Only these statuses represent an open, still-relevant insight. */
const SURFACED_STATUSES: ReadonlySet<Insight["status"]> = new Set(["active", "acknowledged"]);

/** Statuses whose insights have been acted on and may carry a measured outcome. */
const OUTCOME_STATUSES: ReadonlySet<Insight["status"]> = new Set(["acted", "resolved"]);

/** Top-N (by severity) surfaced to the model, so a noisy portfolio can't flood
 *  the prompt. */
export const MAX_PROMPT_INSIGHTS = 10;

/** Top-N recent outcomes surfaced to the model. Small on purpose — this rides
 *  every turn. */
export const MAX_PROMPT_OUTCOMES = 5;

function str(data: Insight["data"], key: string, fallback = "?"): string {
  const v = data[key];
  return v === undefined || v === null || v === "" ? fallback : String(v);
}
function num(data: Insight["data"], key: string): number {
  const v = data[key];
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}
function signed(n: number): string {
  return n >= 0 ? `+${n}` : String(n);
}

/** Compact English fact for one insight (terse — no UI title/detail prose). */
function factLine(insight: Insight): string {
  const d = insight.data;
  switch (insight.type) {
    case "milestoneSlip":
      return `Milestone "${str(d, "name")}" slipped, ${num(d, "daysOverdue")}d overdue`;
    case "overdueTrend":
      return `Overdue tasks rising: ${num(d, "current")} now (${signed(num(d, "delta"))} vs ${num(d, "prior")})`;
    case "stalledWork":
      return `${num(d, "count")} tasks stalled or blocked`;
    case "budgetVariance":
      return `Budget "${str(d, "name")}" variance ${num(d, "variancePct")}% over ${num(d, "buckets")} buckets`;
    case "raidAging":
      return `RAID "${str(d, "name")}" aging, ${num(d, "daysSinceUpdate")}d since update`;
  }
}

/** An insight whose outcome has actually been measured. `outcome` is only ever
 *  written against a `metricAtAction` baseline, which reconcile captures at the
 *  first transition to `acted` — so carrying one implies the user acted, whatever
 *  the status reads now. That is what licenses the "acted" wording below. */
type MeasuredInsight = Insight & { readonly outcome: InsightOutcome };

function isMeasured(insight: Insight): insight is MeasuredInsight {
  return OUTCOME_STATUSES.has(insight.status) && insight.outcome !== undefined;
}

/** Newest measurement first, ties broken by id. ★ The tiebreak is not cosmetic:
 *  a comparator that never returns 0 is not a strict weak ordering, and the
 *  engine may then order same-day outcomes arbitrarily — which would break this
 *  module's deterministic-output contract for the commonest input of all (a
 *  reconcile pass measuring several insights on one day). */
function byMeasuredAtDesc(a: MeasuredInsight, b: MeasuredInsight): number {
  if (a.outcome.measuredAt !== b.outcome.measuredAt) {
    return a.outcome.measuredAt < b.outcome.measuredAt ? 1 : -1;
  }
  return a.id - b.id;
}

/** ★ No clock and no window: sorting by `measuredAt` and capping gives "recent"
 *  while keeping this module deterministic and its signature one-argument. */
function outcomeLine(insight: MeasuredInsight): string {
  const o = insight.outcome;
  // ★ `current`/`delta` are ABSENT when the insight simply stopped firing — the
  //   detectors are threshold-gated, so the direction is known and the magnitude
  //   is not. Say nothing rather than imply a measured move.
  const move =
    typeof o.current === "number" && typeof o.delta === "number"
      ? ` (${o.baseline} → ${o.current}, ${signed(o.delta)})`
      : "";
  return `- ${factLine(insight)} → acted, ${o.direction}${move}`;
}

/**
 * A compact, deterministic English summary of the insight set for the AI chat's
 * system prompt, in up to two sections: the ACTIVE/acknowledged insights (sorted
 * by severity, capped at MAX_PROMPT_INSIGHTS) and the acted-on ones whose outcome
 * has been MEASURED (newest first, capped at MAX_PROMPT_OUTCOMES). The second
 * section is what stops the model re-recommending an action the user already took
 * — including one that changed nothing. Returns "" when both are empty (the
 * caller omits the block entirely).
 */
export function buildInsightsPromptBlock(insights: readonly Insight[]): string {
  const surfaced = insights
    .filter((i) => SURFACED_STATUSES.has(i.status))
    .sort((a, b) => INSIGHT_SEVERITY_RANK[a.severity] - INSIGHT_SEVERITY_RANK[b.severity])
    .slice(0, MAX_PROMPT_INSIGHTS);
  // ★ `filter` returns a fresh array, so the in-place `sort` never touches the
  //   caller's list. Keep the filter first for that reason alone.
  const outcomes = insights
    .filter(isMeasured)
    .sort(byMeasuredAtDesc)
    .slice(0, MAX_PROMPT_OUTCOMES);

  const sections: string[] = [];
  if (surfaced.length > 0) {
    sections.push(
      [
        "Current project insights (deterministic, advisory — surfaced from automated detectors):",
        ...surfaced.map((i) => `- [${i.severity}] ${factLine(i)}`),
      ].join("\n"),
    );
  }
  if (outcomes.length > 0) {
    sections.push(
      ["Recent outcomes (acted-on insights and what happened):", ...outcomes.map(outcomeLine)].join(
        "\n",
      ),
    );
  }
  return sections.join("\n\n");
}
