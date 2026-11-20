"use client";
// The Gantt, RACI and Resources setup checklists (§736, §734, §731), drawn by the shared
// `SetupChecklist` (§730). The step logic is pure and lives in `view-setup.ts`.
// ★ A row offers a link only where the view has no control of its own for that step: the Gantt
// toolbar already has Add task and Add milestone, and the directory already has Add resource, so
// a second button there would repeat an accessible name for the same action.
import { type Lang, t } from "./i18n";
import type { AppView } from "./nav-config";
import type { FeatureModuleId } from "./feature-modules";
import { SetupChecklist, setupGoAction, type SetupChecklistRow, type SetupGoOptions } from "./setup-checklist";
import type { GanttSetupSteps, RaciSetupSteps, ResourcesSetupSteps } from "./view-setup";

interface GoProps {
  /** Undefined in a popout: no links. */
  onGo?: (view: AppView) => void;
  features?: readonly FeatureModuleId[];
  onCommitFeatures?: (features: FeatureModuleId[]) => void;
}

function doneCount(rows: readonly SetupChecklistRow[]): number {
  return rows.filter((row) => row.done).length;
}

export function GanttSetupChecklist({ lang, steps, collapsed, onDismiss }: {
  lang: Lang;
  steps: GanttSetupSteps;
  collapsed: boolean;
  onDismiss?: () => void;
}) {
  const allRows: SetupChecklistRow[] = [
    { step: 1, done: steps.datedDone, label: t(lang, "ganttSetupDated") },
    { step: 2, done: steps.depsDone, label: t(lang, "ganttSetupDeps") },
    { step: 3, done: steps.milestonesDone, label: t(lang, "ganttSetupMilestones") },
  ];
  const rows = allRows.filter((row) => row.step !== 3 || steps.milestonesApplicable);
  return (
    <SetupChecklist
      lang={lang}
      title={t(lang, "ganttSetupTitle")}
      intro={t(lang, "ganttSetupIntro")}
      summary={t(lang, "ganttSetupCollapsed", doneCount(rows), rows.length)}
      dismissLabel={t(lang, "ganttSetupDismiss")}
      rows={rows}
      next={steps.next}
      collapsed={collapsed}
      onDismiss={onDismiss}
    />
  );
}

export function RaciSetupChecklist({ lang, steps, ...goProps }: { lang: Lang; steps: RaciSetupSteps } & GoProps) {
  const go: SetupGoOptions = { lang, ...goProps };
  const milestonesLabel = t(lang, "raciSetupMilestones");
  const stakeholdersLabel = t(lang, "raciSetupStakeholders");
  const rows: SetupChecklistRow[] = [
    { step: 1, done: steps.milestonesDone, label: milestonesLabel, action: steps.milestonesDone ? undefined : setupGoAction(go, "milestones", "raciSetupGoMilestones", milestonesLabel) },
    { step: 2, done: steps.stakeholdersDone, label: stakeholdersLabel, action: steps.stakeholdersDone ? undefined : setupGoAction(go, "stakeholders", "raciSetupGoStakeholders", stakeholdersLabel) },
    { step: 3, done: steps.assignedDone, label: t(lang, "raciSetupAssign") },
  ];
  return (
    <SetupChecklist
      lang={lang}
      title={t(lang, "raciSetupTitle")}
      intro={t(lang, "raciSetupIntro")}
      summary=""
      dismissLabel=""
      rows={rows}
      next={steps.next}
      collapsed={false}
    />
  );
}

export function ResourcesSetupChecklist({ lang, steps, peopleLink, ...goProps }: {
  lang: Lang;
  steps: ResourcesSetupSteps;
  /** False in the directory, whose own toolbar adds a person. */
  peopleLink: boolean;
} & GoProps) {
  const go: SetupGoOptions = { lang, ...goProps };
  const ratesLabel = t(lang, "budgetSetupRates");
  const structureLabel = t(lang, "resourcesSetupStructure");
  const peopleLabel = t(lang, "budgetSetupPeople");
  const rows: SetupChecklistRow[] = [
    { step: 1, done: steps.ratesDone, label: ratesLabel, action: steps.ratesDone ? undefined : setupGoAction(go, "manage-roles", "budgetSetupGoRoles", ratesLabel) },
    // Disciplines and grades are managed on the same Roles page as the rates.
    { step: 2, done: steps.structureDone, label: structureLabel, action: steps.structureDone || !steps.ratesDone ? undefined : setupGoAction(go, "manage-roles", "budgetSetupGoRoles", structureLabel) },
    { step: 3, done: steps.peopleDone, label: peopleLabel, action: steps.peopleDone || !peopleLink ? undefined : setupGoAction(go, "directory", "budgetSetupGoPeople", peopleLabel) },
  ];
  return (
    <SetupChecklist
      lang={lang}
      title={t(lang, "resourcesSetupTitle")}
      intro={t(lang, "resourcesSetupIntro")}
      summary=""
      dismissLabel=""
      rows={rows}
      next={steps.next}
      collapsed={false}
    />
  );
}
