// src/app/use-next-actions.ts
//
// The suggested next-actions wiring task-manager feeds to the Action Center,
// the Dashboard and the notifications: the pre-computed workload alerts, the
// engine run (`buildActionInput` → `computeNextActions`), the grouping, the
// "now" count, the stakeholder ids with a pending comms action, the
// jump-to-comms deep link and the group-aware snooze, plus the snooze store
// they read (`useActionSnooze`). Extracted from task-manager.tsx (§491);
// move-only.
//
// ★ It keeps the inline `useMemo`/`useCallback` memoization on purpose, against
// Extraction convention 1 (non-memoized handlers): `nextActions` is the input
// of several memos and effects downstream (the notifications hook among them),
// and dropping the memo would re-run the engine and re-fire those on every
// render. The dependency arrays are the inline ones, with one exception:
// `snoozeAction` depends on the store's stable `snooze` function rather than on
// the store object, which `useActionSnooze` rebuilds every render — inline, the
// callback therefore got a new identity on every render.
"use client";
import { useCallback, useMemo } from "react";
import type { AppView } from "./nav-config";
import type { Settings } from "./settings-types";
import type { Task, RaidItem, ChangeItem, Milestone, Stakeholder, SteeringCommittee, ProjectMeta, Resource, Absence, Shift, ResourcePlan } from "./types";
import type { DashboardModel } from "./dashboard";
import type { StakeholderCommsReminder } from "./stakeholder-comms";
import type { ActionTrends } from "./next-actions/trends";
import type { FeatureModuleId } from "./feature-modules";
import { computeNextActions, type SuggestedAction } from "./next-actions";
import { groupNextActions } from "./next-actions/group";
import { buildActionInput } from "./next-actions-input";
import { buildWorkloadAlerts } from "./next-actions-workload";
import { useActionSnooze } from "./use-action-snooze";
import { snoozeGroupIds } from "./action-snooze";
import type { useActionLearning } from "./use-action-learning";

type ActionLearning = ReturnType<typeof useActionLearning>;

export interface NextActionsDeps {
  isPopout: boolean;
  tasks: readonly Task[];
  raid: readonly RaidItem[];
  changes: readonly ChangeItem[];
  milestones: readonly Milestone[];
  stakeholders: readonly Stakeholder[];
  steeringCommittee: SteeringCommittee | undefined;
  resources: readonly Resource[];
  absences: readonly Absence[];
  shifts: readonly Shift[];
  plan: ResourcePlan;
  dashboardModel: DashboardModel;
  commsReminders: readonly StakeholderCommsReminder[];
  features: readonly FeatureModuleId[];
  project: ProjectMeta | undefined;
  portfolioCurrentId: string | null;
  today: string;
  workdayHours: number;
  holidaySet: ReadonlySet<string>;
  effectiveNotifications: Settings["notifications"];
  effectiveNextActions: Settings["nextActions"];
  actionTrends: ActionTrends | undefined;
  learnedBias: ActionLearning["bias"];
  recordLearning: ActionLearning["record"];
  requestOpen: (view: AppView, id: number) => void;
}

export function useNextActions(deps: NextActionsDeps) {
  const {
    isPopout, tasks, raid, changes, milestones, stakeholders, steeringCommittee,
    resources, absences, shifts, plan, dashboardModel, commsReminders, features,
    project, portfolioCurrentId, today, workdayHours, holidaySet,
    effectiveNotifications, effectiveNextActions, actionTrends, learnedBias,
    recordLearning, requestOpen,
  } = deps;

  const actionSnooze = useActionSnooze();
  const snoozeFn = actionSnooze.snooze;

  // Pre-computed workload alerts (over-allocated / overload) for the `workload`
  // next-actions provider; computed once on the surface and fed into the engine.
  const workloadAlerts = useMemo(
    () => buildWorkloadAlerts({
      resources, tasks, absences, shifts, raid, plan, today,
      workdayHours, holidaySet,
      overdueThreshold: effectiveNextActions?.workloadOverdueThreshold,
      overAllocatedPct: effectiveNextActions?.workloadAllocatedPct,
    }),
    [resources, tasks, absences, shifts, raid, plan, today, workdayHours, holidaySet, effectiveNextActions],
  );

  // Suggested next-actions engine. Reuses the comms reminders task-manager
  // already computed so getStakeholderCommsItems does not run a second time.
  const nextActions = useMemo(
    () =>
      computeNextActions(
        buildActionInput({
          tasks,
          raid,
          changes,
          milestones,
          stakeholders,
          steeringCommittee,
          dashboard: dashboardModel,
          commsReminders,
          features,
          projectName: project?.name ?? "",
          projectId: portfolioCurrentId ?? undefined,
          projectMeta: project,
          today,
          now: new Date(),
          reminderLeadDays: effectiveNotifications.reminderLeadDays,
          dueSoonWorkdays: effectiveNotifications.dueSoonWorkdays,
          raidReviewIntervalDays: effectiveNotifications.raidReviewIntervalDays,
          scopePendingRed: effectiveNextActions?.scopePendingRed,
          scheduleSpiWarn: effectiveNextActions?.scheduleSpiWarn,
          scheduleSpiCritical: effectiveNextActions?.scheduleSpiCritical,
          workloadAllocatedCritical: effectiveNextActions?.workloadAllocatedCritical,
          workloadOverdueUrgent: effectiveNextActions?.workloadOverdueUrgent,
          trends: actionTrends,
          clarityBonus: effectiveNextActions?.clarityBonus,
          semiClarityBonus: effectiveNextActions?.semiClarityBonus,
          staticPenalty: effectiveNextActions?.staticPenalty,
          // Due actions stay always-on (core). The RAID review toggle below
          // defaults true and is a safe gate.
          raidReviewEnabled: effectiveNotifications.raidReview.enabled,
          workloadAlerts,
          dismissed: actionSnooze.dismissed,
          learnedBias,
        }),
      ),
    [tasks, raid, changes, milestones, stakeholders, steeringCommittee, dashboardModel, commsReminders, features, effectiveNotifications, effectiveNextActions, project, portfolioCurrentId, today, workloadAlerts, actionSnooze.dismissed, actionTrends, learnedBias],
  );
  // ★ Spec C decision 4: grouping runs ONCE, here, beside `computeNextActions`.
  // Both the Next-actions page and the Dashboard (its hero and Top actions tile)
  // read this array, so the two surfaces cannot pick different heroes. The flat
  // list keeps flowing to everything that wants it (notifications, chips, AI).
  const nextActionGroups = useMemo(() => groupNextActions(nextActions), [nextActions]);
  const nowCount = nextActions.filter((a) => a.tier === "now").length;
  // Stakeholder ids with a pending stakeholder-comms next-action. Feeds the
  // influence/interest matrix's "needs communication" jump-to-Action-Center icon.
  const commsPendingStakeholderIds = useMemo(() => {
    const ids = new Set<number>();
    for (const a of nextActions) {
      if (a.source === "stakeholder-comms" && a.cta.kind === "open") {
        ids.add(Number(a.cta.id));
      }
    }
    return ids;
  }, [nextActions]);
  // Deep-link to the Action Center for this stakeholder (uses the shared
  // requestOpen primitive: switches to the actions view + sets #actions/<id>).
  const jumpToComms = useCallback(
    (stakeholderId: number) => requestOpen("actions", stakeholderId),
    [requestOpen],
  );
  const onJumpToComms = isPopout ? undefined : jumpToComms;

  // `extraIds` are the OTHER ids in the row's ActionGroup (action-row.tsx /
  // action-hero-card.tsx thread them from `ActionGroup.extra`). Snoozing a
  // grouped row must snooze every signal in the group — else the row
  // reappears immediately with the next signal promoted to primary. Learned
  // bias stays keyed on the primary's kind only: extras are snoozed directly
  // against the store (`snoozeGroupIds`), bypassing recordLearning.
  const snoozeAction = useCallback(
    (a: SuggestedAction, ms: number, extraIds?: readonly string[]) => {
      void recordLearning(a, "snoozed");
      snoozeGroupIds(snoozeFn, a.id, ms, extraIds);
    },
    [snoozeFn, recordLearning],
  );

  return { nextActions, nextActionGroups, nowCount, commsPendingStakeholderIds, onJumpToComms, snoozeAction };
}
