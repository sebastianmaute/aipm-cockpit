import { type ActivityKind, activityMessageKey } from "./activity-log";
import { type Lang, type PluralBaseKey, t, tPlural } from "./i18n";

/**
 * The count-bearing activity kinds, and the `args` slot the count sits in.
 *
 * ★★★ WHY THIS TABLE HAS TO EXIST AT ALL. Every other mechanism guarding
 * plural agreement in this repo reasons over the KEY SET: `PluralBaseKey` makes
 * a missing `…One` sibling a type error, and the source scan in
 * `i18n-plural.test.ts` finds a singular with no base. Neither can see whether
 * a call site ever ASKS for the singular — and both of these keys are reached
 * through `ACTIVITY_KIND_TO_KEY`, a Record handed to a generic renderer, so
 * there is no key literal at the call site for any scan to reason about. The
 * activity log rendered "AI planned 1 allocation cells" while both singulars
 * sat authored and translated in both dictionaries (`docs/open-followups.md`
 * §415 exception B).
 *
 * ★★ `base` is typed `PluralBaseKey`, so a kind listed here whose key has no
 * `…One` sibling is a tsc error rather than a silent fall-through to the
 * plural. That is the half a Record of slot numbers alone could not give.
 *
 * ★ The `base` restates what `ACTIVITY_KIND_TO_KEY` already says, which is a
 * drift risk and is pinned as one: `activity-message.test.ts` asserts the two
 * agree for every member. Deriving `base` from the Record instead would need a
 * cast to `PluralBaseKey` and would throw away the compile-time proof above —
 * the duplication buys the check, so do not "simplify" it away.
 *
 * ★★ THE SLOT IS NOT ALWAYS `{0}` IN THIS CLASS GENERALLY — `tPlural` takes
 * `count` as a SELECTOR and never injects it, precisely because two converted
 * keys elsewhere carry their count at `{2}` and `{1}`. Both members here happen
 * to use `{0}`; a third that does not is why this is a slot and not a flag.
 */
const ACTIVITY_PLURAL: Partial<Record<ActivityKind, { base: PluralBaseKey; slot: number }>> = {
  "ai.allocationPlan": { base: "activityAiAllocationPlan", slot: 0 },
  "ai.raciSuggest": { base: "activityAiRaciSuggest", slot: 0 },
};

/** Exposed for the drift test only — not part of the rendering contract. */
export const ACTIVITY_PLURAL_KINDS = Object.keys(ACTIVITY_PLURAL) as ActivityKind[];

export function activityPluralBase(kind: ActivityKind): PluralBaseKey | undefined {
  return ACTIVITY_PLURAL[kind]?.base;
}

/**
 * The single rendering path for an activity entry's message, shared by the
 * user-visible panel and the AI-prompt renderer.
 *
 * ★★ IT SELECTS FROM THE SAME ARG LIST IT RENDERS, and that is only safe while
 * nothing between the stored value and this call FORMATS the count. Today
 * nothing does: the panel's `changeText` is `String(n)` for a number, so a
 * count arrives here as `1` or `"1"` and `Number` recovers it either way, and
 * `activity-prompt.ts` passes `entry.args` untouched. ★ A thousands separator
 * introduced at either call site would make `Number("1,000")` NaN and silently
 * fall through to the plural — so a formatter added there has to pass the
 * unformatted list in as well, not merely be added.
 *
 * ★ An unknown kind keeps the `activityUnknownKind` fallback rather than
 * throwing: an entry written by a newer release must still render on an older
 * client, which is the same forward-compat trade `sanitizeActivityEntry` makes.
 */
export function activityMessage(lang: Lang, kind: string, args: (string | number)[]): string {
  const key = activityMessageKey(kind);
  if (!key) return t(lang, "activityUnknownKind", kind);

  const plural = ACTIVITY_PLURAL[kind as ActivityKind];
  if (plural) {
    const raw = args[plural.slot];
    const count = typeof raw === "number" ? raw : Number(raw);
    // ★ A non-numeric count falls through to the plural rather than rendering
    //   `NaN`-selected text. `Number("")` is 0 and `Number(undefined)` is NaN,
    //   so the guard has to be `isFinite`, not a truthiness test — 0 is a real
    //   count and takes the plural in both supported languages.
    if (Number.isFinite(count)) return tPlural(lang, plural.base, count, ...args);
  }

  return t(lang, key, ...args);
}
