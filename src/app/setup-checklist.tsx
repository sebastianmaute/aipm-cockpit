"use client";
// The shared setup checklist (§730): the Budget view's checklist (§710) generalised, so the Gantt,
// RACI and Resources views (§736, §734, §731) show their setup order in the same shape. Steps are
// ticked by the CALLER from project data; nothing here is stored except what the caller's
// `onDismiss` persists. The row chrome reuses the `budgetSetup*` strings, which are not budget-specific.
import { useId, useState, type ReactNode } from "react";
import { CheckIcon, XMarkIcon } from "./icons";
import { type Lang, type TranslationKey, t } from "./i18n";
import { Button } from "./button";
import { ToggleButton } from "./toggle-button";
import type { AppView } from "./nav-config";
import { ALL_MODULE_IDS, FEATURE_MODULES, isViewEnabled, moduleForView, type FeatureModuleId } from "./feature-modules";

export interface SetupChecklistRow {
  step: number;
  done: boolean;
  label: string;
  optional?: boolean;
  action?: ReactNode;
}

export interface SetupChecklistProps {
  lang: Lang;
  /** The section's accessible name and, expanded, its heading. */
  title: string;
  intro: string;
  /** The collapsed line, e.g. "Budget setup: 2 of 4 ·". */
  summary: string;
  dismissLabel: string;
  rows: readonly SetupChecklistRow[];
  /** The step to highlight as next, or null when every shown step is done. */
  next: number | null;
  /** Collapsed = one summary line (steps hidden until "show"); otherwise the full checklist. */
  collapsed: boolean;
  /** Only the collapsed line offers a dismiss button. */
  onDismiss?: () => void;
  /** Extra links under the steps (a tour, the demo). */
  footer?: ReactNode;
}

function StepMarker({ lang, done, step }: { lang: Lang; done: boolean; step: number }) {
  return (
    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-line text-xs font-medium text-foreground">
      {done ? <CheckIcon aria-hidden="true" className="h-3.5 w-3.5" /> : <span aria-hidden="true">{step}</span>}
      <span className="sr-only">{t(lang, done ? "budgetSetupStepDone" : "budgetSetupStepTodo")}</span>
    </span>
  );
}

function StepList({ lang, rows, next }: Pick<SetupChecklistProps, "lang" | "rows" | "next">) {
  return (
    <ol className="flex flex-col gap-1.5">
      {rows.map((row) => {
        const isNext = next === row.step;
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
            <span className={`text-sm text-foreground ${isNext ? "font-semibold" : ""}`}>{row.label}</span>
            {row.optional && <span className="rounded border border-line px-1.5 text-xs text-muted-foreground">{t(lang, "budgetSetupOptional")}</span>}
            {isNext && <span className="text-xs font-semibold uppercase text-ui-dark-blue dark:text-ui-light-grey">{t(lang, "budgetSetupNext")}</span>}
            {row.action && <span className="ml-auto print:hidden">{row.action}</span>}
          </li>
        );
      })}
    </ol>
  );
}

export function SetupChecklist({ lang, title, intro, summary, dismissLabel, rows, next, collapsed, onDismiss, footer }: SetupChecklistProps) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const showList = !collapsed || open;

  return (
    <section aria-label={title} className="rounded-lg border border-line bg-surface p-3 print:hidden">
      {collapsed ? (
        <div className="flex flex-wrap items-center gap-2 text-sm text-foreground">
          <span>{summary}</span>
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
          {onDismiss && (
            <Button
              variant="ghost"
              size="xs"
              className="ml-auto"
              aria-label={dismissLabel}
              title={dismissLabel}
              onClick={onDismiss}
            >
              <XMarkIcon aria-hidden="true" className="h-4 w-4" />
            </Button>
          )}
        </div>
      ) : (
        <div className="mb-2">
          <h3 className="text-sm font-semibold text-ui-dark-blue dark:text-ui-light-grey">{title}</h3>
          <p className="text-xs text-muted-foreground">{intro}</p>
        </div>
      )}
      {/* Always mounted, `hidden`-toggled: the collapsed toggle's `aria-controls` must name an element
          that exists while the list is closed (the same pattern as the action row's reasons panel). */}
      <div id={listId} hidden={!showList} className={collapsed ? "mt-2" : undefined}>
        <StepList lang={lang} rows={rows} next={next} />
        {footer}
      </div>
    </section>
  );
}

// Complete by construction: `FEATURE_MODULES` is the registry `FeatureModuleId` describes, so a
// lookup cannot miss and needs no fallback label (same shape as functions-picker.tsx).
const MODULE_LABEL_KEY = Object.fromEntries(
  FEATURE_MODULES.map((m) => [m.id, m.labelKey]),
) as Record<FeatureModuleId, TranslationKey>;

export interface SetupGoOptions {
  lang: Lang;
  /** Undefined in a popout: no link. */
  onGo?: (view: AppView) => void;
  /** The project's enabled functions. Absent = nothing is gated (every link renders). */
  features?: readonly FeatureModuleId[];
  /** Undefined in a popout: the off-hint stays but offers no turn-on button. */
  onCommitFeatures?: (features: FeatureModuleId[]) => void;
}

/** A step's go-link to a real `AppView`. A view whose function is off for the project becomes
 *  "The X function is off" + a one-click turn-on instead, because `setActiveTab` on a disabled
 *  view is bounced to the Dashboard by `disabledViewRedirect`. The turn-on commits the union in
 *  registry order (as the Time bookings notice does). */
export function setupGoAction(
  { lang, onGo, features, onCommitFeatures }: SetupGoOptions,
  view: AppView,
  buttonKey: TranslationKey,
  rowLabel: string,
): ReactNode {
  if (!onGo) return undefined;
  const moduleId = moduleForView(view);
  if (features && moduleId && !isViewEnabled(view, features)) {
    const name = t(lang, MODULE_LABEL_KEY[moduleId]);
    const turnOn = () => {
      const nextSet = new Set<FeatureModuleId>([...features, moduleId]);
      onCommitFeatures?.(ALL_MODULE_IDS.filter((id) => nextSet.has(id)));
    };
    return (
      <span className="flex flex-wrap items-center justify-end gap-2 text-xs text-muted-foreground">
        <span>{t(lang, "budgetSetupModuleOff", name)}</span>
        {onCommitFeatures && (
          <Button variant="secondary" size="xs" aria-label={t(lang, "budgetSetupTurnOnAria", name, rowLabel)} onClick={turnOn}>
            {t(lang, "functionsUsesTurnOn")}
          </Button>
        )}
      </span>
    );
  }
  return <Button variant="secondary" size="xs" onClick={() => onGo(view)}>{t(lang, buttonKey)}</Button>;
}
