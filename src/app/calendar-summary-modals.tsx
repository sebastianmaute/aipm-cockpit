// src/app/calendar-summary-modals.tsx
//
// The four two-way calendar pull-summary modals (milestone / raid / change /
// absence), extracted from task-manager's modalsBlock. Props-only, renders in
// the shared non-popout modalsBlock position (shows in BOTH classic + modern).
// Move-only: the four IIFE blocks are verbatim; the pull objects + name-lookup
// lists come from useCalendarIntegrations, threaded as props.
import type { Lang } from "./i18n";
import type { RaidItem, ChangeItem, Milestone, Absence } from "./types";
import type { useMilestoneCalendarPull } from "./use-milestone-calendar-pull";
import type { useEntityCalendarPull } from "./use-entity-calendar-pull";
import { CalendarPullSummaryModal } from "./calendar-pull-summary-modal";

export interface CalendarSummaryModalsProps {
  lang: Lang;
  milestones: readonly Milestone[];
  pushableRaid: readonly RaidItem[];
  pushableChanges: readonly ChangeItem[];
  pushableAbsences: readonly Absence[];
  calendarPull: ReturnType<typeof useMilestoneCalendarPull>;
  raidPull: ReturnType<typeof useEntityCalendarPull<RaidItem>>;
  changePull: ReturnType<typeof useEntityCalendarPull<ChangeItem>>;
  absencePull: ReturnType<typeof useEntityCalendarPull<Absence>>;
}

export function CalendarSummaryModals({
  lang,
  milestones,
  pushableRaid,
  pushableChanges,
  pushableAbsences,
  calendarPull,
  raidPull,
  changePull,
  absencePull,
}: CalendarSummaryModalsProps) {
  return (
    <>
      {(() => {
        const plan = calendarPull.result?.plan;
        if (!plan) return null;
        const nameOf = (id: number) => milestones.find((m) => m.id === id)?.name ?? String(id);
        return (
          <CalendarPullSummaryModal
            lang={lang}
            open={!!calendarPull.result}
            onClose={calendarPull.clearResult}
            applied={plan.applies.map((a) => ({ id: a.id, name: nameOf(a.id), newDate: a.newDate }))}
            conflicts={plan.conflicts.map((c) => ({ id: c.id, eventId: c.eventId, name: nameOf(c.id), appDate: c.appDate, outlookDate: c.outlookDate }))}
            deletions={plan.deletions.map((d) => ({ id: d.id, name: nameOf(d.id) }))}
            onKeepApp={calendarPull.keepApp}
            onTakeOutlook={(c) => calendarPull.applyMove(c.id, c.eventId, c.outlookDate)}
          />
        );
      })()}
      {(() => {
        const plan = raidPull.result?.plan;
        if (!plan) return null;
        const nameOf = (id: number) => pushableRaid.find((x) => x.id === id)?.title ?? String(id);
        return (
          <CalendarPullSummaryModal
            lang={lang}
            open={!!raidPull.result}
            onClose={raidPull.clearResult}
            applied={plan.applies.map((a) => ({ id: a.id, name: nameOf(a.id), newDate: a.newDate }))}
            conflicts={plan.conflicts.map((c) => ({ id: c.id, eventId: c.eventId, name: nameOf(c.id), appDate: c.appDate, outlookDate: c.outlookDate }))}
            deletions={plan.deletions.map((d) => ({ id: d.id, name: nameOf(d.id) }))}
            onKeepApp={raidPull.keepApp}
            onTakeOutlook={(c) => raidPull.applyMove(c.id, c.eventId, c.outlookDate)}
          />
        );
      })()}
      {(() => {
        const plan = changePull.result?.plan;
        if (!plan) return null;
        const nameOf = (id: number) => pushableChanges.find((x) => x.id === id)?.title ?? String(id);
        return (
          <CalendarPullSummaryModal
            lang={lang}
            open={!!changePull.result}
            onClose={changePull.clearResult}
            applied={plan.applies.map((a) => ({ id: a.id, name: nameOf(a.id), newDate: a.newDate }))}
            conflicts={plan.conflicts.map((c) => ({ id: c.id, eventId: c.eventId, name: nameOf(c.id), appDate: c.appDate, outlookDate: c.outlookDate }))}
            deletions={plan.deletions.map((d) => ({ id: d.id, name: nameOf(d.id) }))}
            onKeepApp={changePull.keepApp}
            onTakeOutlook={(c) => changePull.applyMove(c.id, c.eventId, c.outlookDate)}
          />
        );
      })()}
      {(() => {
        const plan = absencePull.result?.plan;
        if (!plan) return null;
        const nameOf = (id: number) => {
          const a = pushableAbsences.find((x) => x.id === id);
          // Include startDate so two same-type absences for the same person get
          // a row-UNIQUE accessible name in the conflict list (WCAG 2.4.6).
          return a ? `${a.assignee} (${a.type}) – ${a.startDate}` : String(id);
        };
        return (
          <CalendarPullSummaryModal
            lang={lang}
            open={!!absencePull.result}
            onClose={absencePull.clearResult}
            applied={plan.applies.map((a) => ({ id: a.id, name: nameOf(a.id), newDate: a.newDate, newEndDate: a.newEndDate }))}
            conflicts={plan.conflicts.map((c) => ({ id: c.id, eventId: c.eventId, name: nameOf(c.id), appDate: c.appDate, outlookDate: c.outlookDate, appEndDate: c.appEndDate, outlookEndDate: c.outlookEndDate }))}
            deletions={plan.deletions.map((d) => ({ id: d.id, name: nameOf(d.id) }))}
            onKeepApp={absencePull.keepApp}
            onTakeOutlook={(c) => absencePull.applyMove(c.id, c.eventId, c.outlookDate, c.outlookEndDate)}
          />
        );
      })()}
    </>
  );
}
