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
 * `count` as a SELECTOR and never injects it, precisely because THREE converted
 * keys elsewhere carry their count outside `{0}`: `chatAttachmentSummary` and
 * `chatAttachmentSummarySkipped` at `{1}`, `actionCommitteeInfoWhy` at `{2}`.
 * Both members here happen to use `{0}`; a third MEMBER that does not is why
 * this is a slot and not a flag.
 * ★★ NO REPRODUCE GREP IS QUOTED HERE, DELIBERATELY. A first cut of this
 * paragraph prescribed one, and the comment then MATCHED ITSELF — it pushed
 * the enumeration it was prescribing from 40 hits to 41 the moment it was
 * written. The canonical statement lives in `tPlural`'s own docstring in
 * `i18n.ts`; the slot is fixed by argument order at the call site, so read each
 * call and compare its 3rd argument against its 4th. ★ That recipe does NOT
 * cover THIS call site: `activityMessage` passes a table-driven base and slot,
 * so its 3rd argument is a variable and reading it tells you nothing — the
 * answer for these two kinds is the `slot` field below.
 *
 * ★★ THE BARE INDEX BELOW IS SAFE DERIVATIVELY, NOT LOCALLY, and no second
 * guard is added here on purpose. `activityMessage` returns early unless
 * `activityMessageKey(kind)` resolved, and THAT carries the `hasOwnProperty`
 * check — so `ACTIVITY_PLURAL[kind]` is only ever reached with a genuine own
 * key of `ACTIVITY_KIND_TO_KEY`, none of which is an `Object.prototype`
 * member. A local `hasOwnProperty` here would be unreachable, i.e. exactly the
 * inert-but-load-bearing-looking guard this file deleted one commit ago. If a
 * future `ActivityKind` is ever named `toString`, the early return is the line
 * that stops it, and `activity-message.test.ts`'s prototype-member test is
 * what pins that.
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
    // ★★ NO FINITENESS GUARD HERE, DELIBERATELY, AND AN EARLIER CUT HAD ONE.
    //    `Intl.PluralRules.select` maps NaN and ±Infinity to `other` in all
    //    three supported locales, `other` resolves to the BASE key, and the
    //    drift pin guarantees that base is the same key the fall-through below
    //    would render — so `if (Number.isFinite(count))` was behaviourally
    //    identical to `true` at every input, while its comment claimed it was
    //    load-bearing and the test named for it stayed green with it deleted.
    //    Reproduce: node -e "console.log([NaN,Infinity,0,-0].map(v=>new
    //    Intl.PluralRules('de').select(v)).join(' '))" → other other other other
    // ★★ `Number(raw)` UNCONDITIONALLY, and an earlier cut wrote
    //    `typeof raw === "number" ? raw : Number(raw)`. That ternary was the
    //    same shape as the guard above — inert but reading as deliberate —
    //    because `Number(n)` is `n` for EVERY number, `-0` and `NaN` included.
    //    Reproduce: node -e "console.log([0,-0,NaN,1e21].every(n=>Object.is(Number(n),n)))" → true
    // ★ `Number` THROWS on a Symbol, where the `String(a)` interpolation this
    //   replaced did not. Unreachable: `sanitizeActivityEntry` coerces every
    //   non-string/non-number `args` element to `""` at the load boundary, so
    //   a Symbol cannot reach a stored entry. A caller that bypasses that
    //   boundary and hands this a Symbol in the count slot gets a TypeError.
    return tPlural(lang, plural.base, Number(raw), ...args);
  }

  return t(lang, key, ...args);
}
