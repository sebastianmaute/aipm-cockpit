"use client";

// Stepped Backend Setup Wizard — guides the user through configuring
// storage + integrations. Reuses existing section components as step bodies.
//
//   Step 1 — Storage & connections  (IntegrationsSection, not skippable)
//   Step 2 — AI assistant           (AiSection,           skippable)
//   Step 3 — Jira                   (JiraSettingsSection, skippable)
//   Step 4 — Review                 (summary list,        not skippable)
//
// There is NO dedicated Timelog (or M365) step: IntegrationsSection already
// renders both on the Storage step, so a separate step would duplicate the
// same form. The Review summary still reports Timelog + M365 status.
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
import { type Settings } from "./settings-types";
import { Button } from "./button";
import { WizardStepIndicator } from "./wizard-step-indicator";
import { IntegrationDisclaimerProvider } from "./integration-disclaimer";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TITLE_ID = "backend-setup-wizard-title";
const TOTAL = BACKEND_SETUP_STEPS.length;

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
        {items.map(({ key, labelKey, configured, detailKey }) => (
          <li
            key={key}
            className="flex items-center justify-between gap-4 rounded-lg border border-line p-3 text-sm"
          >
            <span className="font-medium text-foreground">{t(lang, labelKey)}</span>
            <span className="flex items-center gap-2">
              {detailKey && (
                <span className="text-xs text-muted-foreground">{t(lang, detailKey)}</span>
              )}
              <span
                className={
                  configured
                    ? "text-[var(--rag-green-text)]"
                    : "text-[var(--rag-red-text)]"
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

  return (
    <IntegrationDisclaimerProvider
      lang={lang}
      seen={settings.integrationDisclaimerSeen === true}
      onAcknowledge={() => onChangeSettings({ ...settings, integrationDisclaimerSeen: true })}
    >
    <Modal
      open={open}
      onClose={handleClose}
      ariaLabelledby={TITLE_ID}
      align="center"
      backdropClassName="bg-ui-dark-blue/40"
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
          <WizardStepIndicator lang={lang} current={step} steps={BACKEND_SETUP_STEPS} />

          {currentStep.key === "storage" && (
            <IntegrationsSection
              lang={lang}
              settings={settings}
              onChange={onChangeSettings}
              onMigrateToTurso={onMigrateToTurso}
              hidePortfolioSwitch
              hideJira
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

          {currentStep.key === "review" && (
            <ReviewStep lang={lang} settings={settings} />
          )}
        </div>

        {/* Footer */}
        <div className="flex shrink-0 items-center justify-between border-t border-line p-4">
          {/* Back */}
          <Button variant="secondary" onClick={handleBack} disabled={isFirst}>
            {t(lang, "wizardBack")}
          </Button>

          {/* Right cluster: Skip (integration steps) + Next / Finish */}
          <div className="flex items-center gap-2">
            {currentStep.skippable && (
              <Button variant="secondary" onClick={handleNext}>
                {t(lang, "setupWizardSkip")}
              </Button>
            )}

            {/* ONE persistent primary button across all steps (label + handler
                swap on the last step) — a stable element so focusing it after a
                Skip survives the re-render. */}
            <Button
              ref={nextButtonRef}
              variant="primary"
              onClick={isLast ? handleClose : handleNext}
            >
              {t(lang, isLast ? "setupWizardFinish" : "wizardNext")}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
    </IntegrationDisclaimerProvider>
  );
}
