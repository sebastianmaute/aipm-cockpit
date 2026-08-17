// MODEL-FACING RECAP of the activity log — one sentence, paid every turn.
//
// ★★ ITS OWN MODULE, NOT PART OF `activity-prompt.ts`, and the reason is a
//    RUNTIME CYCLE rather than tidiness. `history-search.ts` imports the VALUE
//    `renderActivityEntry` from `activity-prompt.ts`; this module needs the
//    VALUE `summarizeRecentActivity` from `history-search.ts`. Putting it in
//    `activity-prompt.ts` would close that loop with values on both arcs (a
//    type-only import is erased and would have been harmless — the function is
//    not). A third module importing from both has no cycle, needs nothing
//    relocated, and leaves `activity-prompt.ts` doing one thing.
//
// ★ i18n-free on purpose — see ACTOR_PHRASE.
import type { ActivityEntry } from "./activity-log";
import { type ActivitySummary, summarizeRecentActivity } from "./history-search";
import type { AiConfig } from "./settings-types";
import { dayInZone, type TimeZone, type ProjectClock } from "./timezone";

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

/** ★ "1 changes" reads as sloppy to a human and is noise to the model. The
 *  WINDOW needs it too now that the summary carries its own `days`: a one-day
 *  window is legal and would otherwise render "in the last 1 days". */
const plural = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? "" : "s"}`;

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
 *
 * ★★★ `offeredTools` IS THE SET THE WIRE WILL ACTUALLY SEND (`toolsFor`), and
 *     the closing "Use search_history to read them." is emitted ONLY when it
 *     holds that name. The two toggles are INDEPENDENT: `activityRecap` decides
 *     whether this sentence exists at all (upstream, in `summarizeForRecap`),
 *     `historySearch` decides whether the tool exists — so recap-on +
 *     history-off is a REACHABLE combination, and it was the one that shipped a
 *     prompt naming a tool the request did not carry, on every turn of every
 *     conversation. The COUNTS survive it: "12 changes, 9 by the user" still
 *     orients the model even when it cannot go read them.
 *
 * ★★ Same set the view-scope block filters against, for the same reason — one
 *    source of truth means a change to `toolsFor` moves every advertisement
 *    with it. Deliberately a plain `ReadonlySet`, not an import from
 *    `chat-api.ts`: that module imports THIS one, and a value import back would
 *    close a runtime cycle (see the header note).
 */
export function buildActivityRecapBlock(
  summary: ActivitySummary | null,
  tz: TimeZone,
  offeredTools: ReadonlySet<string>,
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
    // ★★ THE WINDOW COMES FROM THE SUMMARY, never from `RECAP_WINDOW_DAYS`.
    //    `summarizeRecentActivity` takes an overridable `days`, so restating
    //    the constant here would misstate the window to the model.
    `Recent project activity: ${plural(summary.total, "change")} in the last ${plural(summary.days, "day")}`,
    `(${breakdown}latest ${latestDay}).`,
    // ★ Conditional SUPPRESSION, not removal — with the tool offered (the
    //   default) this clause is what makes the counts actionable.
    ...(offeredTools.has("search_history") ? ["Use search_history to read them."] : []),
  ].join(" ");
}

/**
 * The dispatcher's entry point: the recap toggle plus the scan behind it.
 *
 * ★ Gate and scan live together so a switched-off recap SKIPS the work rather
 *   than hiding its result — the feature costs nothing for a user who does not
 *   want it. Keeping it here rather than inline in `use-chat-dispatcher.ts`
 *   also makes it testable: that hook is coverage-excluded UI glue.
 *
 * ★★ The read is DEFAULT-ON (`!== false`), and it has to be: `sanitizeAiConfig`
 *    stores only an explicit `false` and leaves every other value `undefined`,
 *    so a truthiness test here would switch the recap off for every user who
 *    never touched the setting.
 *
 * ★★ `actionSuggestions` is the shape-mate — optional on `AiConfig`, read
 *    `!== false` at its call sites. `groundInGuides` is NOT: it is a REQUIRED
 *    boolean that `sanitizeAiConfig` always fills, so it is never `undefined`
 *    and every read site is a plain truthy read. Do not cite it as precedent
 *    for this shape. ★★ `sanitizeAiConfig` DOES store `actionSuggestions` — but it
 *    did NOT until §159, so every explicit `false` was dropped on LOAD (not on
 *    write) and the toggle reverted to ON at the next reload. Any default-ON-by-
 *    absence flag must appear in that return literal; nothing gates it, and a
 *    dropped key and a default read identically, so the only test that can catch
 *    it is a round-trip.
 *
 * ★ Returns `undefined`, never `null`: the snapshot field is optional, and a
 *   literal `null` would read as "computed, and the answer is nothing" rather
 *   than "absent".
 */
export function summarizeForRecap(
  ai: AiConfig,
  entries: readonly ActivityEntry[],
  clock: ProjectClock,
): ActivitySummary | undefined {
  if (ai.activityRecap === false) return undefined;
  // ★★★ THE ONE PLACE THE PAIR IS UNPACKED (§153). Everything upstream of here
  //   carries the clock as a single unforgeable value, so an inconsistent
  //   `today`/`tz` cannot be constructed by any caller. The engine below keeps
  //   its two-string signature deliberately: it is pure and clock-free (its own
  //   `★ NO CLOCK` note), and rewriting it would churn ~20 test call sites to
  //   move a guarantee that is already established here. The residual risk is
  //   therefore bounded to THIS LINE — where both values come off one object
  //   and cannot disagree — rather than spread across every caller.
  return summarizeRecentActivity(entries, clock.today, clock.tz) ?? undefined;
}
