import type { AppView } from "./nav-config";
import { descriptionText } from "./rich-text-projection";
import type {
  BudgetBucket,
  ChangeItem,
  Milestone,
  RaidItem,
  Resource,
  Stakeholder,
  Task,
} from "./types";

export type SearchResultType =
  | "task"
  | "raid"
  | "change"
  | "milestone"
  | "stakeholder"
  | "budget"
  | "resource";

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
  budgets: readonly BudgetBucket[];
  resources: readonly Resource[];
}

/** Rank tiers (lower = better). 0 = id-exact, 1 = title contains, 2 = body only. */
const TIER_ID = 0;
const TIER_TITLE = 1;
const TIER_BODY = 2;

interface Ranked {
  result: SearchResult;
  tier: number;
}

/**
 * A single row with its display fields plus their lowercased forms precomputed
 * ONCE at index-build time, so a query pass never re-lowercases the workspace.
 */
interface IndexedRow {
  result: SearchResult;
  titleLower: string;
  bodyLower: readonly string[];
}

/**
 * Query-INDEPENDENT precomputed index. Building it scans + lowercases the whole
 * workspace once; a subsequent per-keystroke query only walks these strings.
 */
export interface SearchIndex {
  tasks: readonly IndexedRow[];
  raid: readonly IndexedRow[];
  changes: readonly IndexedRow[];
  milestones: readonly IndexedRow[];
  stakeholders: readonly IndexedRow[];
  budgets: readonly IndexedRow[];
  resources: readonly IndexedRow[];
}

function coerce(value: string | undefined): string {
  return value ?? "";
}

function joinLabels(labels: readonly string[] | undefined): string {
  return labels ? labels.join(" ") : "";
}

function indexRow(
  type: SearchResultType,
  view: AppView,
  id: number,
  title: string,
  subtitle: string,
  bodyFields: readonly string[],
): IndexedRow {
  return {
    result: { type, id, view, title, subtitle },
    titleLower: title.toLowerCase(),
    bodyLower: bodyFields.map((f) => f.toLowerCase()),
  };
}

/**
 * Precompute the lowercased searchable index for a workspace. PURE and
 * query-independent — memoize this on the workspace slices and reuse it across
 * every keystroke (see `searchIndex`).
 */
export function buildSearchIndex(ws: SearchableWorkspace): SearchIndex {
  return {
    tasks: ws.tasks.map((t) =>
      indexRow("task", "open-points", t.id, t.taskName, coerce(t.assignee), [
        coerce(t.assignee),
        coerce(t.assigneeEmail),
        coerce(descriptionText(t.description)),
        coerce(t.blockers),
        coerce(t.group),
        joinLabels(t.labels),
        coerce(t.jiraKey),
      ]),
    ),
    raid: ws.raid.map((item) =>
      indexRow("raid", "raid", item.id, item.title, coerce(item.owner), [
        coerce(descriptionText(item.description)),
        coerce(descriptionText(item.mitigation)),
        coerce(item.owner),
        coerce(item.ownerEmail),
        coerce(item.category),
      ]),
    ),
    changes: ws.changes.map((c) =>
      indexRow("change", "changes", c.id, c.title, coerce(c.requestedBy), [
        coerce(descriptionText(c.description)),
        coerce(c.requestedBy),
        coerce(c.type),
      ]),
    ),
    milestones: ws.milestones.map((m) =>
      indexRow("milestone", "milestones", m.id, m.name, coerce(descriptionText(m.description)), [
        coerce(descriptionText(m.description)),
      ]),
    ),
    stakeholders: ws.stakeholders.map((s) =>
      indexRow("stakeholder", "stakeholders", s.id, s.name, coerce(s.organization), [
        coerce(s.organization),
        coerce(s.title),
        coerce(s.email),
        coerce(s.category),
      ]),
    ),
    budgets: ws.budgets.map((b) =>
      indexRow("budget", "budget", b.id, b.name, coerce(b.poNumber), [
        coerce(b.poNumber),
        coerce(b.type),
        coerce(b.currency),
        coerce(b.status),
      ]),
    ),
    resources: ws.resources.map((r) =>
      indexRow(
        "resource",
        "resources",
        r.id,
        resourceName(r),
        coerce(r.title) || coerce(r.department),
        [
          coerce(r.firstName),
          coerce(r.lastName),
          coerce(r.title),
          coerce(r.email),
          coerce(r.department),
          coerce(r.company),
          coerce(r.location),
          coerce(r.notes),
        ],
      ),
    ),
  };
}

/** Compose a resource's display name (no single `name` field on Resource). */
function resourceName(r: Resource): string {
  return `${r.firstName} ${r.lastName}`.trim();
}

/** Match a precomputed row against a lowercased query, or null. PURE. */
function matchRow(row: IndexedRow, q: string, isIdQuery: boolean, idNum: number): Ranked | null {
  if (isIdQuery && row.result.id === idNum) {
    return { result: row.result, tier: TIER_ID };
  }
  if (row.titleLower.includes(q)) {
    return { result: row.result, tier: TIER_TITLE };
  }
  for (const field of row.bodyLower) {
    if (field.includes(q)) {
      return { result: row.result, tier: TIER_BODY };
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

function rankBucket(rows: readonly IndexedRow[], q: string, isIdQuery: boolean, idNum: number): Ranked[] {
  const out: Ranked[] = [];
  for (const row of rows) {
    const r = matchRow(row, q, isIdQuery, idNum);
    if (r) out.push(r);
  }
  return out;
}

/**
 * Run a query over a PRECOMPUTED index. Returns a ranked, capped result list.
 * No clock/random/i18n — only the index + query. Cheap enough to run per
 * keystroke because the workspace was already scanned + lowercased at build.
 */
export function searchIndex(index: SearchIndex, query: string): SearchResult[] {
  const trimmed = query.trim();
  const isIdQuery = /^\d+$/.test(trimmed);
  // A pure-numeric id lookup is exempt from the min-length guard (a 1-digit id
  // is a legitimate query); free-text needs >= SEARCH_MIN_QUERY chars.
  if (!isIdQuery && trimmed.length < SEARCH_MIN_QUERY) return [];

  const q = trimmed.toLowerCase();
  const idNum = Number(trimmed);

  // Per-type rank + cap first (protects diversity against a flooding type).
  const perType: Ranked[][] = [
    rankSortCap(rankBucket(index.tasks, q, isIdQuery, idNum), SEARCH_MAX_PER_TYPE),
    rankSortCap(rankBucket(index.raid, q, isIdQuery, idNum), SEARCH_MAX_PER_TYPE),
    rankSortCap(rankBucket(index.changes, q, isIdQuery, idNum), SEARCH_MAX_PER_TYPE),
    rankSortCap(rankBucket(index.milestones, q, isIdQuery, idNum), SEARCH_MAX_PER_TYPE),
    rankSortCap(rankBucket(index.stakeholders, q, isIdQuery, idNum), SEARCH_MAX_PER_TYPE),
    rankSortCap(rankBucket(index.budgets, q, isIdQuery, idNum), SEARCH_MAX_PER_TYPE),
    rankSortCap(rankBucket(index.resources, q, isIdQuery, idNum), SEARCH_MAX_PER_TYPE),
  ];

  // Merge keeping the global tier ordering, but ROUND-ROBIN across types
  // within each tier so a single flooding type can't crowd others out of the
  // merged cap (diversity protection).
  const merged = mergeRoundRobin(perType);
  return merged.slice(0, SEARCH_MAX_RESULTS).map((r) => r.result);
}

/**
 * Pure cross-entity substring search. Convenience wrapper that builds a
 * throwaway index then queries it — use `buildSearchIndex` + `searchIndex`
 * directly in React so the index is memoized across keystrokes.
 */
export function searchWorkspace(
  ws: SearchableWorkspace,
  query: string,
): SearchResult[] {
  return searchIndex(buildSearchIndex(ws), query);
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
