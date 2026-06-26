"use client";

// Stepped Backend Setup Wizard — guides the user through configuring
// storage + integrations. Reuses existing section components as step bodies.
//
//   Step 1 — Storage & connections  (IntegrationsSection, not skippable)
//   Step 2 — AI assistant           (AiSection,           skippable)
//   Step 3 — Jira                   (JiraSettingsSection, skippable)
//   Step 4 — Timelog                (TimelogSettings,     skippable)
//   Step 5 — Review                 (summary list,        not skippable)
//
// Launch points:
//   • Settings → Integrations section (isPopout-gated)
//   • Create-project wizard (always available)

import { useRef, useState } from "react";
import { t, type Lang } from "./i18n";
import { Modal } from "./modal";
import { ModalHeader } from "./modal-header";
import {
  BACKEND_SETUP_STEPS,
  clampStep,
  summarizeBackendSetup,
} from "./backend-setup-steps";
import { IntegrationsSection } from "./settings-sections/integrations-section";
import { AiSection } from "./settings-sections/ai-section";
import { JiraSettingsSection } from "./jira-settings";
import { TimelogSettings } from "./timelog-settings";
import { defaultTimelogConfig } from "./timelog-types";
import { type Settings } from "./settings-types";
import { INTERACTIVE } from "./interaction-styles";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TITLE_ID = "backend-setup-wizard-title";
const TOTAL = BACKEND_SETUP_STEPS.length;

const SECONDARY_BTN =
  `rounded-md border border-line bg-surface px-4 py-2 text-sm font-medium text-foreground hover:bg-surface-muted ${INTERACTIVE}`;
const PRIMARY_BTN =
  `rounded-md bg-AIPM-dark-blue px-4 py-2 text-sm font-medium text-white hover:bg-AIPM-dark-blue/90 disabled:opacity-50 ${INTERACTIVE}`;

// ---------------------------------------------------------------------------
// StepIndicator
// ---------------------------------------------------------------------------

function StepIndicator({ lang, step }: { lang: Lang; step: number }) {
  return (
    <ol
      className="mb-5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm"
      aria-label={t(lang, "wizardStepsLabel")}
    >
      {BACKEND_SETUP_STEPS.map(({ key, titleKey }, i) => (
        <li key={key} aria-current={step === i ? "step" : undefined} className="flex items-center gap-2">
          <span
            className={
              step === i
                ? "rounded-full bg-AIPM-green/15 px-3 py-1 font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey"
                : "px-3 py-1 text-muted-foreground"
            }
          >
            {i + 1}. {t(lang, titleKey)}
          </span>
          {i < TOTAL - 1 && (
            <span aria-hidden className="text-muted-foreground">
              ›
            </span>
          )}
        </li>
      ))}
    </ol>
  );
}

// ---------------------------------------------------------------------------
// ReviewStep
// ---------------------------------------------------------------------------

function ReviewStep({ lang, settings }: { lang: Lang; settings: Settings }) {
  const items = summarizeBackendSetup(settings);
  return (
    <div>
      <p className="mb-4 text-sm text-muted-foreground">
        {t(lang, "setupWizardReviewIntro")}
      </p>
      <ul className="flex flex-col gap-3">
        {items.map(({ key, labelKey, configured, detailText }) => (
          <li
            key={key}
            className="flex items-center justify-between gap-4 rounded-lg border border-line p-3 text-sm"
          >
            <span className="font-medium text-foreground">{t(lang, labelKey)}</span>
            <span className="flex items-center gap-2">
              {detailText && (
                <span className="text-xs text-muted-foreground">{detailText}</span>
              )}
              <span
                className={
                  configured
                    ? "text-[var(--rag-green-text,var(--rag-green))]"
                    : "text-[var(--rag-red-text,var(--rag-red))]"
                }
              >
                {configured
                  ? t(lang, "setupWizardConfigured")
                  : t(lang, "setupWizardNotConfigured")}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// BackendSetupWizard
// ---------------------------------------------------------------------------

export interface BackendSetupWizardProps {
  lang: Lang;
  open: boolean;
  settings: Settings;
  onChangeSettings: (s: Settings) => void;
  onClose: () => void;
  /** Triggers a local→Turso workspace migration; threaded into the storage
   *  step's IntegrationsSection so "Move to Turso" is offered where available
   *  (Settings launch). Absent from the create-project launch (no existing
   *  workspace to migrate). */
  onMigrateToTurso?: () => void;
}

export function BackendSetupWizard({
  lang,
  open,
  settings,
  onChangeSettings,
  onClose,
  onMigrateToTurso,
}: BackendSetupWizardProps) {
  const [step, setStep] = useState(0);
  // Primary (Next/Finish) button is always present; focus it after a Skip so
  // focus isn't dropped to <body> when the conditional Skip button unmounts.
  const nextButtonRef = useRef<HTMLButtonElement>(null);

  const currentStep = BACKEND_SETUP_STEPS[step];
  const isFirst = step === 0;
  const isLast = step === TOTAL - 1;

  function handleClose() {
    setStep(0);
    onClose();
  }

  function handleBack() {
    setStep((s) => clampStep(s - 1, TOTAL));
  }

  function handleNext() {
    setStep((s) => clampStep(s + 1, TOTAL));
    nextButtonRef.current?.focus();
  }

  // Jira onChange adapter
  function handleJiraChange(next: Settings["jira"]) {
    onChangeSettings({ ...settings, jira: next });
  }

  // Timelog onChange adapter
  function handleTimelogChange(next: NonNullable<Settings["timelog"]>) {
    onChangeSettings({ ...settings, timelog: next });
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      ariaLabelledby={TITLE_ID}
      align="center"
      backdropClassName="bg-AIPM-dark-blue/40"
      zIndex={60}
    >
      <div
        data-modal-panel
        className="relative flex max-h-[90vh] w-[720px] min-w-[360px] max-w-[95vw] flex-col overflow-hidden rounded-xl border border-line bg-surface"
      >
        {/* Header */}
        <ModalHeader
          lang={lang}
          title={t(lang, "setupWizardTitle")}
          titleId={TITLE_ID}
          onClose={handleClose}
        />

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          <StepIndicator lang={lang} step={step} />

          {currentStep.key === "storage" && (
            <IntegrationsSection
              lang={lang}
              settings={settings}
              onChange={onChangeSettings}
              onMigrateToTurso={onMigrateToTurso}
            />
          )}

          {currentStep.key === "ai" && (
            <AiSection
              lang={lang}
              settings={settings}
              onChange={onChangeSettings}
              hideUsage
            />
          )}

          {currentStep.key === "jira" && (
            <JiraSettingsSection
              lang={lang}
              config={settings.jira}
              onChange={handleJiraChange}
              alwaysOpen
            />
          )}

          {currentStep.key === "timelog" && (
            <TimelogSettings
              lang={lang}
              config={settings.timelog ?? defaultTimelogConfig}
              onChange={handleTimelogChange}
            />
          )}

          {currentStep.key === "review" && (
            <ReviewStep lang={lang} settings={settings} />
          )}
        </div>

        {/* Footer */}
        <div className="flex shrink-0 items-center justify-between border-t border-line p-4">
          {/* Back */}
          <button
            type="button"
            onClick={handleBack}
            disabled={isFirst}
            className={SECONDARY_BTN}
          >
            {t(lang, "wizardBack")}
          </button>

          {/* Right cluster: Skip (integration steps) + Next / Finish */}
          <div className="flex items-center gap-2">
            {currentStep.skippable && (
              <button
                type="button"
                onClick={handleNext}
                className={SECONDARY_BTN}
              >
                {t(lang, "setupWizardSkip")}
              </button>
            )}

            {/* ONE persistent primary button across all steps (label + handler
                swap on the last step) — a stable element so focusing it after a
                Skip survives the re-render. */}
            <button
              ref={nextButtonRef}
              type="button"
              onClick={isLast ? handleClose : handleNext}
              className={PRIMARY_BTN}
            >
              {t(lang, isLast ? "setupWizardFinish" : "wizardNext")}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
