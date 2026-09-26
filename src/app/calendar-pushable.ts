// src/app/calendar-pushable.ts — which items each Outlook push reconciles (pure, no i18n).
//
// A push lists every event carrying the entity's category and DELETES any the
// planner does not keep, so "not in this list" means "its event is removed".
// That is right for a synced item leaving the calendar (a finished task, a
// closed RAID item), and wrong for one the user opted out (§486): its event is
// to be left in Outlook exactly as it is. So an opted-out item that still holds
// a link stays in the list, where `planEntityReconcile` keeps its event id and
// neither creates nor updates it. The pulls drop opted-out items themselves.
import { isRaidActiveForReview } from "./raid-review";
import { isTaskFinished } from "./task-status";
import type { Absence, ChangeItem, RaidItem, Task } from "./types";

/** §486 — opted out, with an Outlook event still linked: keep it in the push input. */
function keepsOptedOutEvent(x: { calendarOptOut?: boolean; outlookEventId?: string }): boolean {
  return x.calendarOptOut === true && !!x.outlookEventId;
}

export function isPushableTask(t: Task): boolean {
  return (!isTaskFinished(t) && !!t.dueDate) || keepsOptedOutEvent(t);
}

export function isPushableRaid(r: RaidItem): boolean {
  return (isRaidActiveForReview(r) && !!r.targetDate) || keepsOptedOutEvent(r);
}

export function isPushableChange(c: ChangeItem): boolean {
  return !!c.decisionDate || keepsOptedOutEvent(c);
}

export function isPushableAbsence(a: Absence, today: string): boolean {
  return (a.type !== "sick" && !!a.startDate && !!a.endDate && a.endDate >= today) || keepsOptedOutEvent(a);
}
