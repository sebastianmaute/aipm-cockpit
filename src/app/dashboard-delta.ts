// Pure, i18n-free engine behind the Dashboard landing "since you last looked"
// strip. No React, no I/O — diffs the activity log + a prior RAG snapshot
// against the current state. The single testable unit; dashboard-delta-strip.tsx
// only renders its result.

import type { ActivityEntry, ActivityKind } from "./activity-log";
import type { Health } from "./health";
import type { Task } from "./types";

export type RagScope = "overall" | "schedule" | "budget" | "scope";
export type DeltaGroup = "tasks" | "raid" | "milestone" | "change";
export type DeltaVerb = "created" | "updated" | "completed" | "statusChanged";

export type LandingState = {
  /** ISO timestamp of the prior visit; undefined ⇒ first visit. */
  lastVisitAt?: string;
  /** RAG snapshot captured at the prior visit. */
  rag?: Partial<Record<RagScope, Health>>;
};

export type DeltaCounts = Record<DeltaGroup, Record<DeltaVerb, number>>;

export type RagFlip = {
  scope: RagScope;
  from: Health | null;
  to: Health | null;
  worsened: boolean;
};

export type DeltaResult = {
  isFirstVisit: boolean;
  since?: string;
  counts: DeltaCounts;
  newOverdue: Task[];
  ragFlips: RagFlip[];
  total: number;
};

export type GreetingTimeKey =
  | "dashboardGreetingMorning"
  | "dashboardGreetingAfternoon"
  | "dashboardGreetingEvening";

const RAG_SCOPES: readonly RagScope[] = ["overall", "schedule", "budget", "scope"];
const HEALTH_RANK: Record<Health, number> = { R: 3, A: 2, G: 1 };
const rank = (h: Health | null): number => (h ? HEALTH_RANK[h] : 0);

function emptyCounts(): DeltaCounts {
  const z = (): Record<DeltaVerb, number> => ({ created: 0, updated: 0, completed: 0, statusChanged: 0 });
  return { tasks: z(), raid: z(), milestone: z(), change: z() };
}

/** Map an activity kind to a (group, verb) the strip cares about, or null to
 *  ignore (deletes, settings, jira.sync, docs, history, bulk, etc.). */
function classify(kind: ActivityKind): { group: DeltaGroup; verb: DeltaVerb } | null {
  const dot = kind.indexOf(".");
  const prefix = kind.slice(0, dot);
  const suffix = kind.slice(dot + 1);
  let group: DeltaGroup;
  if (prefix === "task") group = "tasks";
  else if (prefix === "raid") group = "raid";
  else if (prefix === "milestone") group = "milestone";
  else if (prefix === "change") group = "change";
  else return null;

  if (suffix === "created" || suffix === "autoIssue") return { group, verb: "created" };
  if (suffix === "updated" || suffix === "reopened") return { group, verb: "updated" };
  if (suffix === "completed") return { group, verb: "completed" };
  if (suffix === "statusChanged") return { group, verb: "statusChanged" };
  return null;
}

export function computeDelta(args: {
  prior: LandingState;
  activity: readonly ActivityEntry[];
  currentRag: Record<RagScope, Health | null>;
  overdue: readonly Task[];
  today: string;
}): DeltaResult {
  const { prior, activity, currentRag, overdue, today } = args;
  const since = prior.lastVisitAt;
  const isFirstVisit = since === undefined;

  const counts = emptyCounts();
  if (!isFirstVisit) {
    for (const e of activity) {
      if (e.timestamp <= since!) continue;
      const c = classify(e.kind);
      if (!c) continue;
      counts[c.group][c.verb] += 1;
    }
  }

  // Newly overdue = became overdue SINCE the last visit. A task due on the
  // last-visit date wasn't overdue then (due end-of-day) but is now, so the
  // lower bound is inclusive (`>= sinceDate`). The `< today` guard keeps the
  // engine self-defensive: it never reports a not-yet-due task as overdue even
  // if the caller passes an unfiltered list.
  const sinceDate = since ? since.slice(0, 10) : "";
  const newOverdue = isFirstVisit ? [] : overdue.filter((t) => t.dueDate >= sinceDate && t.dueDate < today);

  const ragFlips: RagFlip[] = [];
  if (!isFirstVisit) {
    for (const scope of RAG_SCOPES) {
      const from = prior.rag?.[scope] ?? null;
      const to = currentRag[scope];
      if (from !== to) ragFlips.push({ scope, from, to, worsened: rank(to) > rank(from) });
    }
  }

  const activityTotal = (Object.keys(counts) as DeltaGroup[]).reduce(
    (sum, g) => sum + counts[g].created + counts[g].updated + counts[g].completed + counts[g].statusChanged,
    0,
  );
  const total = activityTotal + newOverdue.length + ragFlips.length;

  return { isFirstVisit, since, counts, newOverdue, ragFlips, total };
}

export function buildGreeting(
  hour: number,
  summary: { needsYou: number; milestonesSoon: number },
): { greetingKey: GreetingTimeKey; summary: { needsYou: number; milestonesSoon: number } } {
  const greetingKey: GreetingTimeKey =
    hour < 12 ? "dashboardGreetingMorning" : hour < 18 ? "dashboardGreetingAfternoon" : "dashboardGreetingEvening";
  return { greetingKey, summary };
}
