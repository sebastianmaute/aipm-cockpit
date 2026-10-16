// §715 E — the demo project's Next-actions rows, computed the way the app computes them.
//
// Mirrors `use-next-actions.ts` (workload alerts → `buildActionInput` → `computeNextActions` →
// `groupNextActions`) with `defaultSettings`, the Dashboard model of `use-trend-snapshots.ts`
// (trends off) and the comms reminders of `use-stakeholder-comms.ts`. The forecast simulation stays
// off, as it does by default, so `mergeSimActions` never runs. When the hook's inputs change, change
// this file with it: the pinned demo-week tests are only as true as this mirror.
import { buildDemoWorkspace } from "../app/demo-workspace";
import { buildLiveDashboardInput, computeDashboard } from "../app/dashboard";
import { isModuleEnabled } from "../app/feature-modules";
import { computeNextActions } from "../app/next-actions";
import { groupNextActions, type ActionGroup } from "../app/next-actions/group";
import { buildActionInput } from "../app/next-actions-input";
import { buildWorkloadAlerts } from "../app/next-actions-workload";
import { defaultNextActionsConfig, defaultSettings } from "../app/settings-types";
import { getStakeholderCommsItems } from "../app/stakeholder-comms";

const WORKDAY_HOURS = 8;

export function demoActionGroups(raw: unknown, today: string): ActionGroup[] {
  const ws = buildDemoWorkspace(raw, today);
  const { features, notifications } = defaultSettings;
  const nextActions = defaultSettings.nextActions ?? defaultNextActionsConfig;
  const holidaySet = new Set<string>();
  const milestones = ws.milestones ?? [];
  const changes = ws.changes ?? [];
  const stakeholders = ws.stakeholders ?? [];

  const dashboard = computeDashboard(
    buildLiveDashboardInput(
      {
        tasks: ws.tasks, raid: ws.raid, budgets: ws.budgets ?? [], plan: ws.plan, roles: ws.roles,
        resources: ws.resources, absences: ws.absences, fxRates: ws.fxRates ?? null, milestones, changes,
        budgetHistory: ws.budgetHistory ?? [], baselineHistory: ws.baselineHistory ?? [],
      },
      { workdayHours: WORKDAY_HOURS, holidaySet, status: ws.status ?? {}, activity: ws.activityLog ?? [], today },
      { active: false, snapshots: [] },
    ),
  );

  const flags = {
    stakeholdersEnabled: isModuleEnabled("stakeholders", features),
    milestonesEnabled: isModuleEnabled("milestones", features),
    raidEnabled: isModuleEnabled("raid", features),
    changesEnabled: isModuleEnabled("changes", features),
  };
  const commsReminders = flags.stakeholdersEnabled && notifications.stakeholderComms.enabled
    ? getStakeholderCommsItems({
      stakeholders, milestones, raid: ws.raid, changes, today, flags,
      leadDaysByQuadrant: notifications.stakeholderCommsLeadDays,
    })
    : [];

  const workloadAlerts = buildWorkloadAlerts({
    resources: ws.resources, tasks: ws.tasks, absences: ws.absences, shifts: ws.shifts ?? [], raid: ws.raid,
    plan: ws.plan, today, workdayHours: WORKDAY_HOURS, holidaySet,
    overdueThreshold: nextActions.workloadOverdueThreshold,
    overAllocatedPct: nextActions.workloadAllocatedPct,
  });

  const actions = computeNextActions(
    buildActionInput({
      tasks: ws.tasks, raid: ws.raid, changes, milestones, stakeholders,
      steeringCommittee: ws.steeringCommittee, dashboard, commsReminders, features,
      projectName: ws.project?.name ?? "", projectId: undefined, projectMeta: ws.project,
      today, now: new Date(`${today}T08:30:00Z`),
      reminderLeadDays: notifications.reminderLeadDays,
      dueSoonWorkdays: notifications.dueSoonWorkdays,
      raidReviewIntervalDays: notifications.raidReviewIntervalDays,
      scopePendingRed: nextActions.scopePendingRed,
      scheduleSpiWarn: nextActions.scheduleSpiWarn,
      scheduleSpiCritical: nextActions.scheduleSpiCritical,
      workloadAllocatedCritical: nextActions.workloadAllocatedCritical,
      workloadOverdueUrgent: nextActions.workloadOverdueUrgent,
      clarityBonus: nextActions.clarityBonus,
      semiClarityBonus: nextActions.semiClarityBonus,
      staticPenalty: nextActions.staticPenalty,
      raidReviewEnabled: notifications.raidReview.enabled,
      workloadAlerts,
    }),
  );
  return groupNextActions(actions);
}

/** `<tier> <source> <key>`, then ` +` and the sorted ids of the row's extra reasons, if any. */
export function rowSignature(g: ActionGroup): string {
  const head = `${g.tier} ${g.primary.source} ${g.key}`;
  if (g.extra.length === 0) return head;
  return `${head} +${g.extra.map((a) => a.id).sort().join(",")}`;
}
