// Pure, i18n-free. Compact per-insight digest for the recommendation call + the
// stable cacheable system prompt. The digest is volatile (sent as the user
// message, never the cached prefix). Mirrors action-ai's cap discipline. Kept
// i18n-free — the context is model-facing English built from raw type/data.

/** Stable, cacheable system prompt. Senior-PM framing consistent with SP0/SP1. */
export function buildRecommendSystemPrompt(): string {
  return [
    "You are a senior project manager assisting with a project tracker.",
    "You are given ONE project insight and a compact slice of the project.",
    "Call the propose_insight_actions tool exactly once with concrete, minimal actions that resolve the insight.",
    "Use only the tools offered. Reference an entity only by a numeric id shown in the digest. Prefer editing an existing item over creating a new one. Keep the summary to one line.",
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
}

const RELATED_TASKS_CAP = 30;

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
  return [
    `Project: ${input.projectName}. Today: ${input.today}.`,
    `Insight: ${input.insightType} (severity ${input.severity}).`,
    "## Insight data",
    dataLines,
    "## Linked entity",
    entity,
    "## Related open tasks (reference by id)",
    tasks,
  ].join("\n");
}
