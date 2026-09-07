// src/app/next-actions/providers/committee-info.ts
import { scoreAction, bandTier, ACTION_WEIGHTS } from "../score";
import { dueInfoReminders } from "../../steering-reminders";
import type { ActionInput, ActionProvider, SuggestedAction } from "../types";

const W = ACTION_WEIGHTS;

/** Core (always-on) provider: surfaces steering-committee info-pack reminders that
 *  are due now or soon. The pure `dueInfoReminders` engine does the date math;
 *  this layer only scores + translates (i18n-free — keys only). */
export const committeeInfoProvider: ActionProvider = {
  provide(input: ActionInput): SuggestedAction[] {
    const out: SuggestedAction[] = [];
    for (const r of dueInfoReminders(input.steeringCommittee, input.today)) {
      if (r.tier !== "now" && r.tier !== "soon") continue; // skip "upcoming" — not actionable yet
      const urgency = r.tier === "now" ? W.urgencyToday : W.urgencySoon;
      const score = scoreAction({ urgency, risk: W.riskHigh, clarity: input.clarityBonus ?? W.clarityBonus });
      out.push({
        id: `committee:${r.meetingId}:${r.scheduleId}`,
        source: "committee",
        title: { key: "actionCommitteeInfoTitle" as const, params: [r.label, r.meetingTitle] },
        // This engine is i18n-free (no Lang in scope — see `I18nText`'s
        // docstring in ../types), so it cannot call `tPlural`; it picks the
        // plural/singular KEY directly instead, for the surface's later
        // `t(lang, key, ...params)` to render. `count === 1` matches
        // `tPlural`'s own category selection for en-US/en-GB/de today (see its
        // docstring) — this is the same equivalence, applied where no `Lang`
        // is available to call it directly. The count is `r.daysLeft`, which
        // fills `{2}` — the singular key keeps `{0}`/`{1}` and hardcodes only
        // the day count, same as `actionCommitteeInfoWhyOne`'s dictionary value.
        why: { key: r.daysLeft === 1 ? "actionCommitteeInfoWhyOne" as const : "actionCommitteeInfoWhy" as const, params: [r.dueDate, r.meetingTitle, r.daysLeft] },
        score,
        tier: bandTier(score),
        cta: { kind: "open", view: "steering-committee", id: r.meetingId },
      });
    }
    return out;
  },
};
