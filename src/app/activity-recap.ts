// MODEL-FACING RECAP of the activity log — one sentence, paid every turn.
//
// ★★ ITS OWN MODULE, NOT PART OF `activity-prompt.ts`, and the reason is a
//    RUNTIME CYCLE rather than tidiness. `history-search.ts` imports the VALUE
//    `renderActivityEntry` from `activity-prompt.ts`; this renderer needs the
//    VALUE `RECAP_WINDOW_DAYS` from `history-search.ts`. Putting it in
//    `activity-prompt.ts` would close that loop with values on both arcs (a
//    type-only import is erased and would have been harmless — the constant is
//    not). A third module importing from both has no cycle, needs no constant
//    relocated, and leaves `activity-prompt.ts` doing one thing.
//
// ★ i18n-free on purpose — see ACTOR_PHRASE.
import { type ActivitySummary, RECAP_WINDOW_DAYS } from "./history-search";
import { dayInZone } from "./timezone";

/** Bucket → the English noun phrase the model reads. ★ Plain literals, NOT
 *  i18n keys: unlike `renderActivityEntry` this line has no UI counterpart to
 *  stay in step with, so routing it through `t` would add dictionary entries
 *  that exist only to be read by a machine. */
const ACTOR_PHRASE: Record<keyof ActivitySummary["byActor"], string> = {
  user: "by the user",
  ai: "by the AI assistant",
  integration: "by an integration",
  unknown: "of unknown origin",
};

/**
 * One sentence telling the model that history exists and is searchable.
 *
 * ★★ A COUNT, not a recap. It sits in the prompt's VOLATILE suffix and is paid
 *    on every turn of every conversation, so it buys tool discoverability at
 *    roughly twenty tokens rather than paying for content the model may not
 *    need — `search_history` fetches the content when it does.
 *
 * ★ The actor split is load-bearing, not decoration: it is what stops the
 *   model reading its OWN edits back as new user information and acting on
 *   them twice.
 *
 * ★ `latestAt` is rendered in the PROJECT zone, matching every other instant
 *   the model is handed (`searchHistory`'s `at`, the `Today is …` line). A raw
 *   UTC slice would quote a day the user's Activity panel disagrees with.
 */
export function buildActivityRecapBlock(
  summary: ActivitySummary | null,
  tz: string,
): string {
  if (!summary) return "";

  const parts = (Object.keys(ACTOR_PHRASE) as Array<keyof typeof ACTOR_PHRASE>)
    .filter((k) => summary.byActor[k] > 0)
    .map((k) => `${summary.byActor[k]} ${ACTOR_PHRASE[k]}`);

  // ★ One non-zero bucket means the breakdown would restate the total.
  const breakdown = parts.length > 1 ? `${parts.join(", ")}; ` : "";
  // ★ `dayInZone` is null for an unparseable stamp; the raw value is then more
  //   honest than dropping the clause, and the sentence still names the tool.
  const latestDay = dayInZone(summary.latestAt, tz) ?? summary.latestAt;

  return [
    `Recent project activity: ${summary.total} changes in the last ${RECAP_WINDOW_DAYS} days`,
    `(${breakdown}latest ${latestDay}).`,
    "Use search_history to read them.",
  ].join(" ");
}
