// src/app/use-calendar-integrations.ts
//
// All Outlook calendar WRITE-BACK wiring (push / pull / background auto-sync)
// for milestones, the steering committee, and the four two-way entities
// (task / raid / change / absence), extracted from task-manager as a hook
// factory. Follows the use-storage-file-ops pattern: `useCalendarIntegrations`
// is called UNCONDITIONALLY before task-manager's single return with the live
// closure values via a typed `deps` object; the returned handlers are NOT
// memoized (the inline `useCallback`/`useMemo` below preserve the exact
// memoization the code had inline). Move-only: the body is the former inline
// block verbatim, deps read via the destructured locals below.
import { type Dispatch, type SetStateAction, useCallback, useMemo } from "react";
import { type Lang, t } from "./i18n";
import type { Settings } from "./settings-types";
import type { Task, RaidItem, ChangeItem, Milestone, Absence, ProjectMeta, SteeringCommittee } from "./types";
import type { ActivityKind } from "./activity-log";
import { isTaskFinished } from "./task-status";
import { isRaidActiveForReview } from "./raid-review";
import { useOutlookCalendarPush } from "./use-outlook-calendar-push";
import { useMilestoneCalendarPull } from "./use-milestone-calendar-pull";
import { useEntityCalendarPush } from "./use-entity-calendar-push";
import { useEntityCalendarPull } from "./use-entity-calendar-pull";
import { useCalendarAutoPull } from "./use-calendar-auto-pull";
import { useCalendarAutoSync } from "./use-calendar-auto-sync";
import { calendarSyncFor } from "./calendar-sync-config";
import { useCommitteeOutlookPush } from "./use-committee-outlook-push";
import { taskToGraphEvent, raidToGraphEvent, changeToGraphEvent, absenceToGraphEvent } from "./outlook-calendar-write";

/**
 * Per-entity stagger step for the four auto-sync push instances. They all
 * become active together on load with the same base debounce, so without an
 * offset they'd fire their Graph pushes in one simultaneous burst.
 */
const AUTO_SYNC_STAGGER_STEP_MS = 750;

/** Live render-scope values the calendar write-back block reads each render. */
export interface CalendarIntegrationDeps {
  isPopout: boolean;
  settings: Settings;
  m365Enabled: boolean;
  portfolioCurrentId: string | null;
  project: ProjectMeta | undefined;
  lang: Lang;
  today: string;
  logActivity: (kind: ActivityKind, ...args: (string | number)[]) => void;
  setSettings: Dispatch<SetStateAction<Settings>>;
  milestones: readonly Milestone[];
  setMilestones: Dispatch<SetStateAction<readonly Milestone[]>>;
  steeringCommittee: SteeringCommittee | undefined;
  setSteeringCommittee: Dispatch<SetStateAction<SteeringCommittee | undefined>>;
  tasks: readonly Task[];
  setTasks: Dispatch<SetStateAction<readonly Task[]>>;
  raid: readonly RaidItem[];
  setRaid: Dispatch<SetStateAction<readonly RaidItem[]>>;
  changes: readonly ChangeItem[];
  setChanges: Dispatch<SetStateAction<readonly ChangeItem[]>>;
  absences: readonly Absence[];
  setAbsences: Dispatch<SetStateAction<readonly Absence[]>>;
}

export function useCalendarIntegrations(deps: CalendarIntegrationDeps) {
  const {
    isPopout,
    settings,
    m365Enabled,
    portfolioCurrentId,
    project,
    lang,
    today,
    logActivity,
    setSettings,
    milestones,
    setMilestones,
    steeringCommittee,
    setSteeringCommittee,
    tasks,
    setTasks,
    raid,
    setRaid,
    changes,
    setChanges,
    absences,
    setAbsences,
  } = deps;

  // Push milestones to the Outlook calendar (write-back). Gated on M365 being
  // enabled AND the explicit calendar-push setting, and never in a popout.
  const calendarPushEnabled =
    !isPopout &&
    (settings.integrations?.m365?.enabled ?? false) &&
    (settings.integrations?.m365?.outlookCalendarPush ?? false);
  // The Outlook event category "AIPM:<projectId>" depends on a STABLE id so events
  // are not orphaned when the (display) name changes: registry/turso current id
  // → ProjectMeta.code → the literal "default". `portfolioCurrentId` is the stable
  // registry/tenant id. LIMITATION: the `project?.code` fallback (single-project
  // file mode) is user-editable — renaming the project code after a push orphans
  // existing Outlook events (they keep the old category). Acceptable for v1.
  const calendarProjectId = portfolioCurrentId || project?.code || "default";
  // The workspace setter is Dispatch<SetStateAction<readonly Milestone[]>>; the
  // hook wants (updater: (prev: Milestone[]) => Milestone[]) => void — bridge it.
  const setMilestonesForPush = useCallback(
    (updater: (prev: Milestone[]) => Milestone[]) =>
      setMilestones((prev) => updater([...prev])),
    [setMilestones],
  );
  const calendarPush = useOutlookCalendarPush({
    milestones,
    projectId: calendarProjectId,
    setMilestones: setMilestonesForPush,
    isPopout,
    lang,
    enabled: calendarPushEnabled,
  });
  const calendarPushToOutlook = calendarPush.pushToOutlook;
  const calendarPushBusy = calendarPush.busy;
  const calendarPull = useMilestoneCalendarPull({
    milestones,
    projectId: calendarProjectId,
    setMilestones: setMilestonesForPush,
    isPopout,
    lang,
    enabled: calendarPushEnabled,
  });

  // Push the steering committee's meetings + info-pack reminders to Outlook.
  // Reuses the SAME M365 enablement gate and stable project id as milestones.
  const committeePush = useCommitteeOutlookPush({
    committee: steeringCommittee,
    committeeName: steeringCommittee?.name ?? "",
    projectId: calendarProjectId,
    today,
    setSteeringCommittee,
    isPopout,
    lang,
    enabled: calendarPushEnabled,
  });

  // Background AUTO calendar-sync for tasks (opt-in enable + auto). When the
  // pushable task set changes it silently reconciles Outlook (debounced 4s),
  // without the manual Push button. Popout/M365-gated + non-interactive token
  // (no consent popup, no error toast on a missing session). Fail-once-per-change.
  const taskSync = calendarSyncFor(settings, "task");
  const taskAutoSyncActive = taskSync.auto && m365Enabled && !isPopout;
  const pushableTasks = useMemo(
    () => tasks.filter((x) => !isTaskFinished(x) && !!x.dueDate),
    [tasks],
  );
  // NOTE: deliberately EXCLUDES outlookEventId — that is an OUTPUT the push
  // writes back, not an input. Including it would re-fire the debounce one extra
  // time after every create (a redundant no-op reconcile round).
  const taskAutoSyncKey = useMemo(
    () => pushableTasks
      .map((t) => `${t.id}|${t.dueDate}|${t.taskName}|${t.status}`)
      .join(";"),
    [pushableTasks],
  );
  // Bridge the workspace setter to the hook's (prev: Task[]) => Task[] shape.
  const setTasksForAuto = useCallback(
    (updater: (prev: Task[]) => Task[]) => setTasks((prev) => updater([...prev])),
    [setTasks],
  );
  const { pushToOutlook: autoPushTasks } = useEntityCalendarPush<Task>({
    items: pushableTasks,
    entityType: "task",
    projectId: calendarProjectId,
    toGraphEvent: taskToGraphEvent,
    setItems: setTasksForAuto,
    isPopout,
    lang,
    enabled: taskAutoSyncActive,
    interactive: false,
  });
  useCalendarAutoSync({ active: taskAutoSyncActive, contentKey: taskAutoSyncKey, push: autoPushTasks, staggerMs: 0 });

  // --- RAID review-date calendar write-back (SP2) — mirrors the task block ---
  const raidSync = calendarSyncFor(settings, "raid");
  const calendarRaidEnabled = raidSync.enabled && m365Enabled && !isPopout;
  const raidAutoSyncActive = raidSync.auto && m365Enabled && !isPopout;
  const pushableRaid = useMemo(
    () => raid.filter((r) => isRaidActiveForReview(r) && !!r.targetDate),
    [raid],
  );
  // EXCLUDES outlookEventId — an OUTPUT the push writes back (see task block).
  const raidAutoSyncKey = useMemo(
    () => pushableRaid.map((r) => `${r.id}|${r.targetDate}|${r.title}|${r.status}`).join(";"),
    [pushableRaid],
  );
  const setRaidForCalendar = useCallback(
    (updater: (prev: RaidItem[]) => RaidItem[]) => setRaid((prev) => updater([...prev])),
    [setRaid],
  );
  const { pushToOutlook: pushRaidToOutlook, busy: calendarRaidPushBusy } = useEntityCalendarPush<RaidItem>({
    items: pushableRaid, entityType: "raid", projectId: calendarProjectId,
    toGraphEvent: raidToGraphEvent, setItems: setRaidForCalendar,
    isPopout, lang, enabled: calendarRaidEnabled,
  });
  const { pushToOutlook: autoPushRaid } = useEntityCalendarPush<RaidItem>({
    items: pushableRaid, entityType: "raid", projectId: calendarProjectId,
    toGraphEvent: raidToGraphEvent, setItems: setRaidForCalendar,
    isPopout, lang, enabled: raidAutoSyncActive, interactive: false,
  });
  useCalendarAutoSync({ active: raidAutoSyncActive, contentKey: raidAutoSyncKey, push: autoPushRaid, staggerMs: AUTO_SYNC_STAGGER_STEP_MS });
  const onToggleCalendarRaid = useCallback(
    (enabled: boolean) => setSettings((s) => ({
      ...s,
      outlookCalendar: {
        ...s.outlookCalendar,
        raid: { enabled, auto: enabled ? (s.outlookCalendar?.raid?.auto ?? false) : false },
      },
    })),
    [setSettings],
  );
  // Manual "Pull from Outlook" for RAID (two-way SP3) — mirrors milestone pull.
  const raidPull = useEntityCalendarPull<RaidItem>({
    items: pushableRaid,
    entityType: "raid",
    projectId: calendarProjectId,
    getDate: (r) => r.targetDate,
    withDate: (r, date) => ({ ...r, targetDate: date }),
    toGraphEvent: raidToGraphEvent,
    setItems: setRaidForCalendar,
    isPopout,
    lang,
    enabled: calendarRaidEnabled,
  });

  // --- Change decision-date calendar write-back (SP3) — mirrors the RAID block ---
  const changeSync = calendarSyncFor(settings, "change");
  const calendarChangeEnabled = changeSync.enabled && m365Enabled && !isPopout;
  const changeAutoSyncActive = changeSync.auto && m365Enabled && !isPopout;
  const pushableChanges = useMemo(() => changes.filter((c) => !!c.decisionDate), [changes]);
  // EXCLUDES outlookEventId — an OUTPUT the push writes back.
  const changeAutoSyncKey = useMemo(
    () => pushableChanges.map((c) => `${c.id}|${c.decisionDate}|${c.title}|${c.status}`).join(";"),
    [pushableChanges],
  );
  const setChangeForCalendar = useCallback(
    (updater: (prev: ChangeItem[]) => ChangeItem[]) => setChanges((prev) => updater([...prev])),
    [setChanges],
  );
  const { pushToOutlook: pushChangeToOutlook, busy: calendarChangePushBusy } = useEntityCalendarPush<ChangeItem>({
    items: pushableChanges, entityType: "change", projectId: calendarProjectId,
    toGraphEvent: changeToGraphEvent, setItems: setChangeForCalendar,
    isPopout, lang, enabled: calendarChangeEnabled,
  });
  const { pushToOutlook: autoPushChange } = useEntityCalendarPush<ChangeItem>({
    items: pushableChanges, entityType: "change", projectId: calendarProjectId,
    toGraphEvent: changeToGraphEvent, setItems: setChangeForCalendar,
    isPopout, lang, enabled: changeAutoSyncActive, interactive: false,
  });
  useCalendarAutoSync({ active: changeAutoSyncActive, contentKey: changeAutoSyncKey, push: autoPushChange, staggerMs: AUTO_SYNC_STAGGER_STEP_MS * 2 });
  const onToggleCalendarChange = useCallback(
    (enabled: boolean) => setSettings((s) => ({
      ...s,
      outlookCalendar: {
        ...s.outlookCalendar,
        change: { enabled, auto: enabled ? (s.outlookCalendar?.change?.auto ?? false) : false },
      },
    })),
    [setSettings],
  );
  // Manual "Pull from Outlook" for Change (two-way SP3) — mirrors RAID pull.
  const changePull = useEntityCalendarPull<ChangeItem>({
    items: pushableChanges,
    entityType: "change",
    projectId: calendarProjectId,
    getDate: (c) => c.decisionDate,
    withDate: (c, date) => ({ ...c, decisionDate: date }),
    toGraphEvent: changeToGraphEvent,
    setItems: setChangeForCalendar,
    isPopout,
    lang,
    enabled: calendarChangeEnabled,
  });

  // --- Absence calendar write-back (SP4) — mirrors the Change block ---
  const absenceSync = calendarSyncFor(settings, "absence");
  const calendarAbsenceEnabled = absenceSync.enabled && m365Enabled && !isPopout;
  const absenceAutoSyncActive = absenceSync.auto && m365Enabled && !isPopout;
  const pushableAbsences = useMemo(
    () => absences.filter((a) => a.type !== "sick" && !!a.startDate && !!a.endDate && a.endDate >= today),
    [absences, today],
  );
  // EXCLUDES outlookEventId — an OUTPUT the push writes back. Includes `note`
  // so a note-only edit re-pushes the event body (it appears in the Graph body).
  const absenceAutoSyncKey = useMemo(
    () => pushableAbsences.map((a) => `${a.id}|${a.startDate}|${a.endDate}|${a.type}|${a.assignee}|${a.note ?? ""}`).join(";"),
    [pushableAbsences],
  );
  const setAbsenceForCalendar = useCallback(
    (updater: (prev: Absence[]) => Absence[]) => setAbsences((prev) => updater([...prev])),
    [setAbsences],
  );
  const { pushToOutlook: pushAbsenceToOutlook, busy: calendarAbsencePushBusy } = useEntityCalendarPush<Absence>({
    items: pushableAbsences, entityType: "absence", projectId: calendarProjectId,
    toGraphEvent: absenceToGraphEvent, setItems: setAbsenceForCalendar,
    isPopout, lang, enabled: calendarAbsenceEnabled,
  });
  const { pushToOutlook: autoPushAbsence } = useEntityCalendarPush<Absence>({
    items: pushableAbsences, entityType: "absence", projectId: calendarProjectId,
    toGraphEvent: absenceToGraphEvent, setItems: setAbsenceForCalendar,
    isPopout, lang, enabled: absenceAutoSyncActive, interactive: false,
  });
  useCalendarAutoSync({ active: absenceAutoSyncActive, contentKey: absenceAutoSyncKey, push: autoPushAbsence, staggerMs: AUTO_SYNC_STAGGER_STEP_MS * 3 });
  const onToggleCalendarAbsence = useCallback(
    (enabled: boolean) => setSettings((s) => ({
      ...s,
      outlookCalendar: {
        ...s.outlookCalendar,
        absence: { enabled, auto: enabled ? (s.outlookCalendar?.absence?.auto ?? false) : false },
      },
    })),
    [setSettings],
  );
  // Manual "Pull from Outlook" for Absence (two-way SP4) — the only multi-day entity (start+end range).
  const absencePull = useEntityCalendarPull<Absence>({
    items: pushableAbsences,
    entityType: "absence",
    projectId: calendarProjectId,
    getDate: (a) => a.startDate,
    getEndDate: (a) => a.endDate,
    withDate: (a, start, end) => ({ ...a, startDate: start, endDate: end ?? a.endDate }),
    toGraphEvent: absenceToGraphEvent,
    setItems: setAbsenceForCalendar,
    isPopout,
    lang,
    enabled: calendarAbsenceEnabled,
  });

  // --- Background auto-pull (two-way SP5) — periodic reverse-sync for the four
  // entities carrying a per-entity `.auto` flag. Each background pull self-gates
  // on its own `<entity>AutoSyncActive` (`.auto && m365Enabled && !isPopout`) and
  // is inert otherwise; the runner below owns only the cadence. Milestone is
  // excluded (different sync model, no `.auto` flag).
  const { pull: autoPullTasks } = useEntityCalendarPull<Task>({
    items: pushableTasks, entityType: "task", projectId: calendarProjectId,
    getDate: (x) => x.dueDate, withDate: (x, date) => ({ ...x, dueDate: date }),
    toGraphEvent: taskToGraphEvent, setItems: setTasksForAuto,
    isPullable: (x) => !x.jiraKey, isPopout, lang, enabled: taskAutoSyncActive, background: true,
    onBackgroundApply: (n) => logActivity("calendar.autoPulled", n, t(lang, "calendarSyncEntityTask")),
  });
  const { pull: autoPullRaid } = useEntityCalendarPull<RaidItem>({
    items: pushableRaid, entityType: "raid", projectId: calendarProjectId,
    getDate: (r) => r.targetDate, withDate: (r, date) => ({ ...r, targetDate: date }),
    toGraphEvent: raidToGraphEvent, setItems: setRaidForCalendar,
    isPopout, lang, enabled: raidAutoSyncActive, background: true,
    onBackgroundApply: (n) => logActivity("calendar.autoPulled", n, t(lang, "calendarSyncEntityRaid")),
  });
  const { pull: autoPullChange } = useEntityCalendarPull<ChangeItem>({
    items: pushableChanges, entityType: "change", projectId: calendarProjectId,
    getDate: (c) => c.decisionDate, withDate: (c, date) => ({ ...c, decisionDate: date }),
    toGraphEvent: changeToGraphEvent, setItems: setChangeForCalendar,
    isPopout, lang, enabled: changeAutoSyncActive, background: true,
    onBackgroundApply: (n) => logActivity("calendar.autoPulled", n, t(lang, "calendarSyncEntityChange")),
  });
  const { pull: autoPullAbsence } = useEntityCalendarPull<Absence>({
    items: pushableAbsences, entityType: "absence", projectId: calendarProjectId,
    getDate: (a) => a.startDate, getEndDate: (a) => a.endDate,
    withDate: (a, start, end) => ({ ...a, startDate: start, endDate: end ?? a.endDate }),
    toGraphEvent: absenceToGraphEvent, setItems: setAbsenceForCalendar,
    isPopout, lang, enabled: absenceAutoSyncActive, background: true,
    onBackgroundApply: (n) => logActivity("calendar.autoPulled", n, t(lang, "calendarSyncEntityAbsence")),
  });
  useCalendarAutoPull({
    enabled: m365Enabled && !isPopout,
    pulls: [autoPullTasks, autoPullRaid, autoPullChange, autoPullAbsence],
  });

  return {
    // milestone (manual push + pull) + shared project id
    calendarProjectId,
    calendarPushEnabled,
    calendarPushToOutlook,
    calendarPushBusy,
    calendarPull,
    committeePush,
    // pushable sets consumed by the pull-summary modal name lookups
    pushableRaid,
    pushableChanges,
    pushableAbsences,
    // raid
    calendarRaidEnabled,
    onToggleCalendarRaid,
    pushRaidToOutlook,
    calendarRaidPushBusy,
    raidPull,
    // change
    calendarChangeEnabled,
    onToggleCalendarChange,
    pushChangeToOutlook,
    calendarChangePushBusy,
    changePull,
    // absence
    calendarAbsenceEnabled,
    onToggleCalendarAbsence,
    pushAbsenceToOutlook,
    calendarAbsencePushBusy,
    absencePull,
  };
}
