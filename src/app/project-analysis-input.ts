// src/app/project-analysis-input.ts
//
// Assembles, from ONE loaded workspace and the device settings, everything a scheduled
// report needs to ask the model about that project (§772): the digest input, the
// grounding index its reply is validated against, and the effective settings. It mirrors
// what the live app derives (`use-next-actions.ts`, `use-portfolio-health.ts`) but without
// React or any live context, so a runner can analyse a project that is not the open one.
// All model-facing text is translated HERE; `project-digest.ts` stays i18n-free.
import { buildGroundingIndex, type GroundingIndex } from "./action-ai";
import { actionText } from "./action-text";
import { buildDashboardInput, computeDashboard } from "./dashboard";
import { ALL_MODULE_IDS, deriveMode, isModuleEnabled } from "./feature-modules";
import { isPaceAvailable } from "./budget-forecast";
import type { Lang } from "./i18n";
import { computeNextActions } from "./next-actions";
import { buildActionInput } from "./next-actions-input";
import { buildWorkloadAlerts } from "./next-actions-workload";
import type { ProjectDigestInput } from "./project-digest";
import { resolveEffectiveSettings } from "./settings-effective";
import { resolveNextActionsConfig, type Settings } from "./settings-types";
import { getStakeholderCommsItems } from "./stakeholder-comms";
import { resolveTimezone, todayInZone } from "./timezone";
import type { Workspace } from "./workspace";

export interface ProjectAnalysisInput {
  digestInput: ProjectDigestInput;
  grounding: GroundingIndex;
  effectiveSettings: Settings;
}

/** No holiday calendar is fetched for a background run, so working-day maths treats every weekday as a workday. */
const NO_HOLIDAYS: ReadonlySet<string> = new Set<string>();

export function buildProjectAnalysisInput(args: {
  workspace: Workspace;
  deviceSettings: Settings;
  lang: Lang;
  now: Date;
  /** A queue the caller already has (the live Action Center one): the next-actions pass is then skipped, and the
   *  dashboard is computed only when a budget line needs it. */
  queue?: ProjectDigestInput["queue"];
}): ProjectAnalysisInput {
  const { workspace: ws, deviceSettings, lang, now, queue } = args;
  // `settings.features` mirrors the OPEN project (use-features-sync), so it is never a fallback here: a legacy
  // project without its own list gets every module, exactly as the live sync does.
  const features = ws.features ?? ALL_MODULE_IDS;
  const effectiveSettings: Settings = {
    ...resolveEffectiveSettings(deviceSettings, ws.settingsOverrides, undefined),
    features: [...features],
  };
  const tz = resolveTimezone(effectiveSettings.timezone, ws.project?.operatingTimezone);
  const today = todayInZone(now, tz);
  const workdayHours = effectiveSettings.resources.workdayHours;
  const naCfg = resolveNextActionsConfig(effectiveSettings.nextActions);
  const notifications = effectiveSettings.notifications;

  const milestones = ws.milestones ?? [];
  const changes = ws.changes ?? [];
  const stakeholders = ws.stakeholders ?? [];
  const budgets = ws.budgets ?? [];

  const dashboard = queue === undefined || budgets.length > 0 ? computeDashboard(
    buildDashboardInput(
      {
        tasks: ws.tasks, raid: ws.raid, budgets, plan: ws.plan, roles: ws.roles, resources: ws.resources,
        absences: ws.absences, fxRates: ws.fxRates ?? null, milestones, changes,
        disciplines: ws.disciplines, grades: ws.grades,
      },
      { workdayHours, holidaySet: NO_HOLIDAYS, status: ws.status ?? {}, activity: [], today },
    ),
  ) : null;

  const deriveQueue = (dash: NonNullable<typeof dashboard>): ProjectDigestInput["queue"] => {
    const commsReminders = notifications.stakeholderComms.enabled
      ? getStakeholderCommsItems({
          stakeholders, milestones, raid: ws.raid, changes, today,
          flags: {
            stakeholdersEnabled: isModuleEnabled("stakeholders", features),
            milestonesEnabled: isModuleEnabled("milestones", features),
            raidEnabled: isModuleEnabled("raid", features),
            changesEnabled: isModuleEnabled("changes", features),
          },
          leadDaysByQuadrant: notifications.stakeholderCommsLeadDays,
        })
      : [];

    const workloadAlerts = buildWorkloadAlerts({
      resources: ws.resources, tasks: ws.tasks, absences: ws.absences, shifts: ws.shifts, raid: ws.raid,
      plan: ws.plan, today, workdayHours, holidaySet: NO_HOLIDAYS,
      overdueThreshold: naCfg.workloadOverdueThreshold, overAllocatedPct: naCfg.workloadAllocatedPct,
    });

    // No `dismissed`, `learnedBias` or `trends`: a scheduled run has no per-device snooze or learning state.
    const actions = computeNextActions(
      buildActionInput({
        tasks: ws.tasks, raid: ws.raid, changes, milestones, stakeholders,
        steeringCommittee: ws.steeringCommittee, dashboard: dash, commsReminders, features,
        projectName: ws.project?.name ?? "", projectMeta: ws.project, today, now,
        reminderLeadDays: notifications.reminderLeadDays,
        dueSoonWorkdays: notifications.dueSoonWorkdays,
        raidReviewIntervalDays: notifications.raidReviewIntervalDays,
        scopePendingRed: naCfg.scopePendingRed,
        scheduleSpiWarn: naCfg.scheduleSpiWarn,
        scheduleSpiCritical: naCfg.scheduleSpiCritical,
        workloadAllocatedCritical: naCfg.workloadAllocatedCritical,
        workloadOverdueUrgent: naCfg.workloadOverdueUrgent,
        clarityBonus: naCfg.clarityBonus,
        semiClarityBonus: naCfg.semiClarityBonus,
        staticPenalty: naCfg.staticPenalty,
        raidReviewEnabled: notifications.raidReview.enabled,
        workloadAlerts,
      }),
    );
    return actions.map((a) => ({ title: actionText(lang, a.title), why: actionText(lang, a.why), tier: a.tier }));
  };

  const bundle = dashboard?.forecastBundle;
  const budget =
    budgets.length > 0 && bundle
      ? {
          currency: dashboard?.currency ?? "",
          planned: bundle.eur.facts.bac,
          actual: bundle.eur.facts.ac,
          ...(isPaceAvailable(bundle.eur.pace) ? { forecast: bundle.eur.pace.eac } : {}),
        }
      : undefined;

  return {
    digestInput: {
      projectName: ws.project?.name ?? "",
      today,
      mode: deriveMode(features),
      enabledModules: features,
      tasks: ws.tasks, raid: ws.raid, milestones, changes, stakeholders,
      absences: ws.absences, resources: ws.resources,
      ...(budget ? { budget } : {}),
      queue: queue ?? (dashboard ? deriveQueue(dashboard) : []),
    },
    grounding: buildGroundingIndex({ tasks: ws.tasks, raid: ws.raid, milestones, changes, stakeholders }),
    effectiveSettings,
  };
}
