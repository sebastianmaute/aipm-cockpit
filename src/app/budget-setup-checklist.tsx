"use client";
import { type Lang, type TranslationKey, t } from "./i18n";
import { Button } from "./button";
import { budgetSetupDoneCount, budgetSetupStepCount, type BudgetSetupSteps } from "./budget-setup";
import type { AppView } from "./nav-config";
import type { FeatureModuleId } from "./feature-modules";
import { SetupChecklist, setupGoAction, type SetupChecklistRow } from "./setup-checklist";

/** The views a setup step can send the user to. These are the REAL `AppView`
 *  ids (`nav-config.ts`), so `onGo` feeds `setActiveTab` directly. */
export type BudgetSetupView = Extract<AppView, "manage-roles" | "directory" | "timelog">;

/** Tour id registered in `app-tour.ts` (`TOURS`). */
const BUDGET_TOUR_ID = "budget-changes";

export interface BudgetSetupChecklistProps {
  lang: Lang;
  steps: BudgetSetupSteps;
  /** Collapsed = one summary line (steps hidden until "show"); otherwise the full checklist. */
  collapsed: boolean;
  onAddBucket: () => void;
  /** Undefined in a popout: the go-links are hidden. */
  onGo?: (view: BudgetSetupView) => void;
  /** Undefined in a popout: the tour link is hidden. */
  onStartTour?: (id: string) => void;
  /** Undefined in a popout: the demo link is hidden. */
  onLoadDemo?: () => void;
  onDismiss: () => void;
  /** The project's enabled functions. Absent = nothing is gated (every link renders). A go-link
   *  whose view belongs to a function that is off becomes a hint instead: `setActiveTab` on a
   *  disabled view is bounced to the Dashboard by `disabledViewRedirect`. */
  features?: readonly FeatureModuleId[];
  /** Undefined in a popout: the hint stays but offers no turn-on button. */
  onCommitFeatures?: (features: FeatureModuleId[]) => void;
}

/** The Budget view's checklist (§710), drawn by the shared `SetupChecklist` (§730). */
export function BudgetSetupChecklist(props: BudgetSetupChecklistProps) {
  const { lang, steps, collapsed, onAddBucket, onGo, onStartTour, onLoadDemo, onDismiss } = props;
  // `onGo` only ever receives one of the three views named in `BudgetSetupView`.
  const go = { lang, onGo: onGo as ((view: AppView) => void) | undefined, features: props.features, onCommitFeatures: props.onCommitFeatures };
  const label = (key: TranslationKey) => t(lang, key);
  const allRows: SetupChecklistRow[] = [
    { step: 1, done: steps.ratesDone, label: label("budgetSetupRates"), action: setupGoAction(go, "manage-roles", "budgetSetupGoRoles", label("budgetSetupRates")) },
    { step: 2, done: steps.peopleDone, label: label("budgetSetupPeople"), action: setupGoAction(go, "directory", "budgetSetupGoPeople", label("budgetSetupPeople")) },
    {
      step: 3, done: steps.bucketDone, label: label("budgetSetupBucket"),
      // Once a bucket exists the panel's own header button covers adding more.
      action: steps.bucketDone ? undefined : (
        <Button variant="secondary" size="xs" onClick={onAddBucket}>{`+ ${t(lang, "budgetAddBucket")}…`}</Button>
      ),
    },
    { step: 4, done: steps.bookingsDone, label: label("budgetSetupBookings"), optional: true, action: setupGoAction(go, "timelog", "budgetSetupGoBookings", label("budgetSetupBookings")) },
  ];
  // §762 — no bookings step without TimeLog.
  const rows = allRows.filter((row) => row.step !== 4 || steps.bookingsApplicable !== false);
  const footer = onStartTour || onLoadDemo ? (
    <div className="mt-2 flex flex-wrap items-center gap-2 px-3 print:hidden">
      {onStartTour && (
        <Button variant="ghost" size="xs" onClick={() => onStartTour(BUDGET_TOUR_ID)}>{t(lang, "budgetSetupTour")}</Button>
      )}
      {onLoadDemo && (
        <Button variant="ghost" size="xs" onClick={onLoadDemo}>{t(lang, "budgetSetupDemo")}</Button>
      )}
    </div>
  ) : undefined;
  return (
    <SetupChecklist
      lang={lang}
      title={t(lang, "budgetSetupTitle")}
      intro={t(lang, "budgetSetupIntro")}
      summary={t(lang, "budgetSetupCollapsed", budgetSetupDoneCount(steps), budgetSetupStepCount(steps))}
      dismissLabel={t(lang, "budgetSetupDismiss")}
      rows={rows}
      next={steps.next}
      collapsed={collapsed}
      onDismiss={onDismiss}
      footer={footer}
    />
  );
}
