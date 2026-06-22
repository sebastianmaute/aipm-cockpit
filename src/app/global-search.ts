import type { AppView } from "./nav-config";
import type {
  ChangeItem,
  Milestone,
  RaidItem,
  Stakeholder,
  Task,
} from "./types";

export type SearchResultType =
  | "task"
  | "raid"
  | "change"
  | "milestone"
  | "stakeholder";

export interface SearchResult {
  type: SearchResultType;
  id: number;
  view: AppView;
  title: string;
  subtitle: string;
}

export const SEARCH_MIN_QUERY = 2;
export const SEARCH_MAX_RESULTS = 20;
export const SEARCH_MAX_PER_TYPE = 8;

export interface SearchableWorkspace {
  tasks: readonly Task[];
  raid: readonly RaidItem[];
  changes: readonly ChangeItem[];
  milestones: readonly Milestone[];
  stakeholders: readonly Stakeholder[];
}

/** Rank tiers (lower = better). 0 = id-exact, 1 = title contains, 2 = body only. */
const TIER_ID = 0;
const TIER_TITLE = 1;
const TIER_BODY = 2;

interface Ranked {
  result: SearchResult;
  tier: number;
}

function coerce(value: string | undefined): string {
  return value ?? "";
}

function joinLabels(labels: readonly string[] | undefined): string {
  return labels ? labels.join(" ") : "";
}

/** Build a ranked result if the row matches, else null. PURE. */
function rank(
  type: SearchResultType,
  view: AppView,
  id: number,
  title: string,
  subtitle: string,
  bodyFields: readonly string[],
  q: string,
  isIdQuery: boolean,
  idNum: number,
): Ranked | null {
  const result: SearchResult = { type, id, view, title, subtitle };

  if (isIdQuery && id === idNum) {
    return { result, tier: TIER_ID };
  }
  if (title.toLowerCase().includes(q)) {
    return { result, tier: TIER_TITLE };
  }
  for (const field of bodyFields) {
    if (field.toLowerCase().includes(q)) {
      return { result, tier: TIER_BODY };
    }
  }
  return null;
}

/** Stable-sort by tier (iteration order preserved within a tier), then cap. */
function rankSortCap(ranked: readonly Ranked[], cap: number): Ranked[] {
  const sorted = ranked
    .map((r, index) => ({ r, index }))
    .sort((a, b) => (a.r.tier - b.r.tier) || (a.index - b.index))
    .map((x) => x.r);
  return sorted.slice(0, cap);
}

function rankTasks(tasks: readonly Task[], q: string, isIdQuery: boolean, idNum: number): Ranked[] {
  const out: Ranked[] = [];
  for (const t of tasks) {
    const body = [
      coerce(t.assignee),
      coerce(t.assigneeEmail),
      coerce(t.notes),
      coerce(t.blockers),
      coerce(t.group),
      joinLabels(t.labels),
      coerce(t.jiraKey),
    ];
    const r = rank("task", "open-points", t.id, t.taskName, coerce(t.assignee), body, q, isIdQuery, idNum);
    if (r) out.push(r);
  }
  return out;
}

function rankRaid(raid: readonly RaidItem[], q: string, isIdQuery: boolean, idNum: number): Ranked[] {
  const out: Ranked[] = [];
  for (const item of raid) {
    const body = [
      coerce(item.description),
      coerce(item.mitigation),
      coerce(item.owner),
      coerce(item.ownerEmail),
      coerce(item.category),
    ];
    const r = rank("raid", "raid", item.id, item.title, coerce(item.owner), body, q, isIdQuery, idNum);
    if (r) out.push(r);
  }
  return out;
}

function rankChanges(changes: readonly ChangeItem[], q: string, isIdQuery: boolean, idNum: number): Ranked[] {
  const out: Ranked[] = [];
  for (const c of changes) {
    const body = [coerce(c.description), coerce(c.requestedBy), coerce(c.type)];
    const r = rank("change", "changes", c.id, c.title, coerce(c.requestedBy), body, q, isIdQuery, idNum);
    if (r) out.push(r);
  }
  return out;
}

function rankMilestones(milestones: readonly Milestone[], q: string, isIdQuery: boolean, idNum: number): Ranked[] {
  const out: Ranked[] = [];
  for (const m of milestones) {
    const body = [coerce(m.description)];
    const r = rank("milestone", "milestones", m.id, m.name, coerce(m.description), body, q, isIdQuery, idNum);
    if (r) out.push(r);
  }
  return out;
}

function rankStakeholders(stakeholders: readonly Stakeholder[], q: string, isIdQuery: boolean, idNum: number): Ranked[] {
  const out: Ranked[] = [];
  for (const s of stakeholders) {
    const body = [
      coerce(s.organization),
      coerce(s.title),
      coerce(s.email),
      coerce(s.category),
    ];
    const r = rank("stakeholder", "stakeholders", s.id, s.name, coerce(s.organization), body, q, isIdQuery, idNum);
    if (r) out.push(r);
  }
  return out;
}

/**
 * Pure cross-entity substring search. Returns a ranked, capped result list.
 * No clock/random/i18n — only the workspace slices + query.
 */
export function searchWorkspace(
  ws: SearchableWorkspace,
  query: string,
): SearchResult[] {
  const trimmed = query.trim();
  const isIdQuery = /^\d+$/.test(trimmed);
  // A pure-numeric id lookup is exempt from the min-length guard (a 1-digit id
  // is a legitimate query); free-text needs >= SEARCH_MIN_QUERY chars.
  if (!isIdQuery && trimmed.length < SEARCH_MIN_QUERY) return [];

  const q = trimmed.toLowerCase();
  const idNum = Number(trimmed);

  // Per-type rank + cap first (protects diversity against a flooding type).
  const perType: Ranked[][] = [
    rankSortCap(rankTasks(ws.tasks, q, isIdQuery, idNum), SEARCH_MAX_PER_TYPE),
    rankSortCap(rankRaid(ws.raid, q, isIdQuery, idNum), SEARCH_MAX_PER_TYPE),
    rankSortCap(rankChanges(ws.changes, q, isIdQuery, idNum), SEARCH_MAX_PER_TYPE),
    rankSortCap(rankMilestones(ws.milestones, q, isIdQuery, idNum), SEARCH_MAX_PER_TYPE),
    rankSortCap(rankStakeholders(ws.stakeholders, q, isIdQuery, idNum), SEARCH_MAX_PER_TYPE),
  ];

  // Merge keeping the global tier ordering, but ROUND-ROBIN across types
  // within each tier so a single flooding type can't crowd others out of the
  // merged cap (diversity protection).
  const merged = mergeRoundRobin(perType);
  return merged.slice(0, SEARCH_MAX_RESULTS).map((r) => r.result);
}

/**
 * Merge the per-type ranked buckets preserving global tier order, interleaving
 * types within a tier. Each bucket is already tier-sorted (stable). We sweep
 * tier by tier; within a tier we take one result from each type in turn until
 * that tier is exhausted, so no type monopolises the head of the list.
 */
function mergeRoundRobin(buckets: readonly Ranked[][]): Ranked[] {
  const out: Ranked[] = [];
  const cursors = buckets.map(() => 0);
  const maxTier = TIER_BODY;

  for (let tier = TIER_ID; tier <= maxTier; tier++) {
    let advanced = true;
    while (advanced) {
      advanced = false;
      for (let b = 0; b < buckets.length; b++) {
        const bucket = buckets[b];
        const cursor = cursors[b];
        if (cursor < bucket.length && bucket[cursor].tier === tier) {
          out.push(bucket[cursor]);
          cursors[b] = cursor + 1;
          advanced = true;
        }
      }
    }
  }
  return out;
}
