"use client";
import { useId, useState, type ReactNode } from "react";
import { CheckIcon, XMarkIcon } from "./icons";
import { type Lang, type TranslationKey, t } from "./i18n";
import { Button } from "./button";
import { ToggleButton } from "./toggle-button";
import { budgetSetupDoneCount, budgetSetupStepCount, type BudgetSetupStep, type BudgetSetupSteps } from "./budget-setup";
import type { AppView } from "./nav-config";
import { ALL_MODULE_IDS, FEATURE_MODULES, isViewEnabled, moduleForView, type FeatureModuleId } from "./feature-modules";

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

interface RowSpec {
  step: BudgetSetupStep;
  done: boolean;
  labelKey: TranslationKey;
  optional?: boolean;
  action?: ReactNode;
}

function StepMarker({ lang, done, step }: { lang: Lang; done: boolean; step: BudgetSetupStep }) {
  return (
    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-line text-xs font-medium text-foreground">
      {done ? <CheckIcon aria-hidden="true" className="h-3.5 w-3.5" /> : <span aria-hidden="true">{step}</span>}
      <span className="sr-only">{t(lang, done ? "budgetSetupStepDone" : "budgetSetupStepTodo")}</span>
    </span>
  );
}

// Complete by construction: `FEATURE_MODULES` is the registry `FeatureModuleId` describes, so a
// lookup cannot miss and needs no fallback label (same shape as functions-picker.tsx).
const MODULE_LABEL_KEY = Object.fromEntries(
  FEATURE_MODULES.map((m) => [m.id, m.labelKey]),
) as Record<FeatureModuleId, TranslationKey>;

type StepListProps = Pick<BudgetSetupChecklistProps, "lang" | "steps" | "onAddBucket" | "onGo" | "features" | "onCommitFeatures">;

function StepList({ lang, steps, onAddBucket, onGo, features, onCommitFeatures }: StepListProps) {
  /** "The Resources function is off" + a one-click turn-on, where a go-link would land on a
   *  disabled view. The turn-on commits the union in registry order (as the Time bookings notice). */
  const offHint = (moduleId: FeatureModuleId, rowLabelKey: TranslationKey) => {
    const name = t(lang, MODULE_LABEL_KEY[moduleId]);
    const turnOn = () => {
      const next = new Set<FeatureModuleId>([...(features ?? []), moduleId]);
      onCommitFeatures?.(ALL_MODULE_IDS.filter((id) => next.has(id)));
    };
    return (
      <span className="flex flex-wrap items-center justify-end gap-2 text-xs text-muted-foreground">
        <span>{t(lang, "budgetSetupModuleOff", name)}</span>
        {onCommitFeatures && (
          <Button
            variant="secondary"
            size="xs"
            aria-label={t(lang, "budgetSetupTurnOnAria", name, t(lang, rowLabelKey))}
            onClick={turnOn}
          >
            {t(lang, "functionsUsesTurnOn")}
          </Button>
        )}
      </span>
    );
  };
  const goButton = (view: BudgetSetupView, key: TranslationKey, rowLabelKey: TranslationKey) => {
    if (!onGo) return undefined;
    const moduleId = moduleForView(view);
    if (features && moduleId && !isViewEnabled(view, features)) return offHint(moduleId, rowLabelKey);
    return <Button variant="secondary" size="xs" onClick={() => onGo(view)}>{t(lang, key)}</Button>;
  };
  const allRows: RowSpec[] = [
    { step: 1, done: steps.ratesDone, labelKey: "budgetSetupRates", action: goButton("manage-roles", "budgetSetupGoRoles", "budgetSetupRates") },
    { step: 2, done: steps.peopleDone, labelKey: "budgetSetupPeople", action: goButton("directory", "budgetSetupGoPeople", "budgetSetupPeople") },
    {
      step: 3, done: steps.bucketDone, labelKey: "budgetSetupBucket",
      // Once a bucket exists the panel's own header button covers adding more.
      action: steps.bucketDone ? undefined : (
        <Button variant="secondary" size="xs" onClick={onAddBucket}>{`+ ${t(lang, "budgetAddBucket")}…`}</Button>
      ),
    },
    { step: 4, done: steps.bookingsDone, labelKey: "budgetSetupBookings", optional: true, action: goButton("timelog", "budgetSetupGoBookings", "budgetSetupBookings") },
  ];
  // §762 — no bookings step without TimeLog.
  const rows = allRows.filter((row) => row.step !== 4 || steps.bookingsApplicable !== false);
  return (
    <ol className="flex flex-col gap-1.5">
      {rows.map((row) => {
        const isNext = steps.next === row.step;
        // The "next" cue is the border weight, the semibold label AND the word
        // "next" — never colour alone (WCAG 1.4.1).
        return (
          <li
            key={row.step}
            data-next={isNext ? "true" : "false"}
            className={`flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border-l-4 px-3 py-1.5 ${
              isNext ? "border-ui-dark-blue bg-surface-muted" : "border-transparent"
            }`}
          >
            <StepMarker lang={lang} done={row.done} step={row.step} />
            <span className={`text-sm text-foreground ${isNext ? "font-semibold" : ""}`}>{t(lang, row.labelKey)}</span>
            {row.optional && <span className="rounded border border-line px-1.5 text-xs text-muted-foreground">{t(lang, "budgetSetupOptional")}</span>}
            {isNext && <span className="text-xs font-semibold uppercase text-ui-dark-blue dark:text-ui-light-grey">{t(lang, "budgetSetupNext")}</span>}
            {row.action && <span className="ml-auto print:hidden">{row.action}</span>}
          </li>
        );
      })}
    </ol>
  );
}

export function BudgetSetupChecklist(props: BudgetSetupChecklistProps) {
  const { lang, steps, collapsed, onStartTour, onLoadDemo, onDismiss } = props;
  const [open, setOpen] = useState(false);
  const listId = useId();
  const showList = !collapsed || open;

  return (
    <section aria-label={t(lang, "budgetSetupTitle")} className="rounded-lg border border-line bg-surface p-3 print:hidden">
      {collapsed ? (
        <div className="flex flex-wrap items-center gap-2 text-sm text-foreground">
          <span>{t(lang, "budgetSetupCollapsed", budgetSetupDoneCount(steps), budgetSetupStepCount(steps))}</span>
          <ToggleButton
            variant="disclosure"
            lang={lang}
            pressed={open}
            onToggle={() => setOpen((v) => !v)}
            ariaControls={listId}
            ariaLabel={t(lang, open ? "budgetSetupHideAria" : "budgetSetupShowAria")}
          >
            {t(lang, open ? "budgetSetupHide" : "budgetSetupShow")}
          </ToggleButton>
          <Button
            variant="ghost"
            size="xs"
            className="ml-auto"
            aria-label={t(lang, "budgetSetupDismiss")}
            title={t(lang, "budgetSetupDismiss")}
            onClick={onDismiss}
          >
            <XMarkIcon aria-hidden="true" className="h-4 w-4" />
          </Button>
        </div>
      ) : (
        <div className="mb-2">
          <h3 className="text-sm font-semibold text-ui-dark-blue dark:text-ui-light-grey">{t(lang, "budgetSetupTitle")}</h3>
          <p className="text-xs text-muted-foreground">{t(lang, "budgetSetupIntro")}</p>
        </div>
      )}
      {/* Always mounted, `hidden`-toggled: the collapsed toggle's `aria-controls` must name an element
          that exists while the list is closed (the same pattern as the action row's reasons panel). */}
      <div id={listId} hidden={!showList} className={collapsed ? "mt-2" : undefined}>
        <StepList lang={lang} steps={steps} onAddBucket={props.onAddBucket} onGo={props.onGo} features={props.features} onCommitFeatures={props.onCommitFeatures} />
        {(onStartTour || onLoadDemo) && (
          <div className="mt-2 flex flex-wrap items-center gap-2 px-3 print:hidden">
            {onStartTour && (
              <Button variant="ghost" size="xs" onClick={() => onStartTour(BUDGET_TOUR_ID)}>{t(lang, "budgetSetupTour")}</Button>
            )}
            {onLoadDemo && (
              <Button variant="ghost" size="xs" onClick={onLoadDemo}>{t(lang, "budgetSetupDemo")}</Button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}
