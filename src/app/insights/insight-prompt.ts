// Pure, i18n-free, English-only. Renders the ACTIVE insight set into a compact,
// terse fact block for the AI chat's system prompt (model-facing context, like
// the operating guides — English regardless of UI language). This is VOLATILE
// content: it MUST be appended AFTER the prompt-cache breakpoint in chat-api's
// buildSystemPrompt, never inside the cached prefix. Deterministic — no clock.
import { INSIGHT_SEVERITY_RANK, type Insight } from "./insight";

/** Only these statuses represent an open, still-relevant insight. */
const SURFACED_STATUSES: ReadonlySet<Insight["status"]> = new Set(["active", "acknowledged"]);

/** Top-N (by severity) surfaced to the model, so a noisy portfolio can't flood
 *  the prompt. */
export const MAX_PROMPT_INSIGHTS = 10;

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

/**
 * A compact, deterministic English summary of the ACTIVE/acknowledged insights
 * for the AI chat's system prompt. Returns "" when nothing is active (the caller
 * omits the block entirely). Excludes dismissed/resolved/acted insights; sorts
 * by severity; caps at MAX_PROMPT_INSIGHTS.
 */
export function buildInsightsPromptBlock(insights: readonly Insight[]): string {
  const surfaced = insights
    .filter((i) => SURFACED_STATUSES.has(i.status))
    .sort((a, b) => INSIGHT_SEVERITY_RANK[a.severity] - INSIGHT_SEVERITY_RANK[b.severity])
    .slice(0, MAX_PROMPT_INSIGHTS);
  if (surfaced.length === 0) return "";
  const lines = surfaced.map((i) => `- [${i.severity}] ${factLine(i)}`);
  return [
    "Current project insights (deterministic, advisory — surfaced from automated detectors):",
    ...lines,
  ].join("\n");
}
