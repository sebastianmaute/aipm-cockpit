// Pure, i18n-free. Compact per-insight digest for the recommendation call + the
// stable cacheable system prompt. The digest is volatile (sent as the user
// message, never the cached prefix). Mirrors action-ai's cap discipline. Kept
// i18n-free — the context is model-facing English built from raw type/data.
import { AWAY_WINDOW_DAYS, buildAwaySummary } from "../absence-clash";
import { isoAddDays } from "../due-dates";
import type { Absence, Resource } from "../types";

/** Stable, cacheable system prompt. Senior-PM framing consistent with SP0/SP1. */
export function buildRecommendSystemPrompt(): string {
  return [
    "You are a senior project manager assisting with a project tracker.",
    "You are given ONE project insight and a compact slice of the project.",
    "Call the propose_insight_actions tool exactly once with concrete, minimal actions that resolve the insight.",
    "Use only the tools offered. Reference an entity only by a numeric id shown in the digest. Prefer editing an existing item over creating a new one. Keep the summary to one line.",
    "Give every required argument of each tool you call, and assign a person only by a name listed under People. If People lists no one, do not propose create_task.",
  ].join(" ");
}

export interface RecommendContextInput {
  readonly projectName: string;
  readonly today: string;
  readonly insightType: string;
  readonly severity: string;
  readonly data: Readonly<Record<string, string | number>>;
  readonly entity?: { readonly view: string; readonly id: number; readonly title: string; readonly fields: string };
  readonly relatedTasks: readonly { readonly id: number; readonly title: string }[];
  /** §782 — the people a create may name as its assignee or owner (`recommendPeople`). */
  readonly people?: readonly string[];
  /** §773 — who is away today..today+28 is summarised from these (type and reason never shown). */
  readonly absences: readonly Absence[];
  readonly resources: readonly Resource[];
}

/** §782 — who a create may name: the active resources' names, then the
 *  project's task assignees (free text, so a project with no resource
 *  directory still has people). Each name once: trimmed, inner whitespace
 *  collapsed to one space, compared case-insensitively, the first spelling
 *  kept with its whitespace collapsed (the form listed); blanks dropped. Resources come first because the digest caps the list
 *  (`PEOPLE_CAP`). A name in `excluded` (an archived resource) is never listed
 *  as an assignee, compared the same way.
 *  ★ Advisory only: a name written differently ("Ortiz, Dana") is a different
 *   string here, so the same person can appear twice. */
export function recommendPeople(
  resourceNames: readonly string[],
  assignees: readonly string[],
  excluded: readonly string[] = [],
): string[] {
  // ★ The exclusion applies to assignees only: an active resource who shares an
  //  archived one's name is still listed.
  const barred = new Set(excluded.map((name) => normalName(name).toLowerCase()));
  const seen = new Set<string>();
  const out: string[] = [];
  const candidates = [...resourceNames.map((n) => [n, false] as const), ...assignees.map((n) => [n, true] as const)];
  for (const [raw, isAssignee] of candidates) {
    const name = normalName(raw);
    const key = name.toLowerCase();
    if (name === "" || seen.has(key) || (isAssignee && barred.has(key))) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}

/** A person's name as `recommendPeople` compares and lists it. */
function normalName(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

/** §782 round 3 — a bare "(none)" beside "assign only by a name listed under
 *  People" forbade every assignee; this says no one is known instead. */
const NO_PEOPLE_LINE = "(none known: do not propose create_task; prefer editing an existing item)";

const RELATED_TASKS_CAP = 30;
const PEOPLE_CAP = 30;

/** Compact, token-bounded per-insight digest. Volatile — sent as the user
 *  message, never in the cached system block. */
export function buildRecommendContext(input: RecommendContextInput): string {
  const dataLines = Object.entries(input.data).map(([k, v]) => `- ${k}: ${v}`).join("\n") || "(none)";
  const entity = input.entity
    ? `Linked ${input.entity.view}#${input.entity.id}: ${input.entity.title}\n${input.entity.fields}`
    : "(no linked entity)";
  const tasks = input.relatedTasks.length
    ? input.relatedTasks
        .slice(0, RELATED_TASKS_CAP)
        .map((t) => `- open-points#${t.id}: ${t.title.slice(0, 120)}`)
        .join("\n")
    : "(none)";
  const people = input.people?.length
    ? input.people.slice(0, PEOPLE_CAP).map((name) => `- ${name.slice(0, 120)}`).join("\n")
    : NO_PEOPLE_LINE;
  const away = buildAwaySummary({
    absences: input.absences, resources: input.resources,
    from: input.today, to: isoAddDays(input.today, AWAY_WINDOW_DAYS),
  });
  return [
    `Project: ${input.projectName}. Today: ${input.today}.`,
    `Insight: ${input.insightType} (severity ${input.severity}).`,
    "## Insight data",
    dataLines,
    "## Linked entity",
    entity,
    "## Related open tasks (reference by id)",
    tasks,
    "## People (assign by name)",
    people,
    ...away,
  ].join("\n");
}
