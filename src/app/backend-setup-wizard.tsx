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

import { useCallback, useRef, useState } from "react";
import { t, type Lang } from "./i18n";
import { Modal } from "./modal";
import { ModalHeader } from "./modal-header";
import { MODAL_HELP } from "./help-content";
import {
  BACKEND_SETUP_STEPS,
  clampStep,
  summarizeBackendSetup,
} from "./backend-setup-steps";
import { commitPortfolioModeSwitch, IntegrationsSection } from "./settings-sections/integrations-section";
import { loadPortfolioMode, type PortfolioMode } from "./portfolio-mode";
import { getTursoConfig } from "./turso-config";
import { AiSection } from "./settings-sections/ai-section";
import { JiraSettingsSection } from "./jira-settings";
import { type Settings } from "./settings-types";
import { Button } from "./button";
import { Banner } from "./banner";
import { useConfirm } from "./confirm-dialog";
import { WizardStepIndicator } from "./wizard-step-indicator";
import { IntegrationDisclaimerProvider } from "./integration-disclaimer";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TITLE_ID = "backend-setup-wizard-title";
const TOTAL = BACKEND_SETUP_STEPS.length;
const STORAGE_STEP = BACKEND_SETUP_STEPS.findIndex((s) => s.key === "storage");

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
  /** Hide the "Portfolio storage mode" switch inside the Storage step. Set this
   *  when a real project is already open elsewhere in the app (Settings) — a
   *  blind mode switch does not migrate that project, it just points the app at
   *  a different (possibly empty) portfolio and reloads, abandoning the open
   *  one. Leave it unset on a pre-project surface (nothing to abandon), so the
   *  switch is reachable to load a project that already exists in a configured
   *  Turso database. */
  hidePortfolioSwitch?: boolean;
  /** Forwarded to IntegrationsSection: use the "Switch portfolio" label. Set
   *  on pre-project surfaces (empty state, create-project flow). */
  noCurrentProject?: boolean;
  /** The step index the wizard opens at (default 0). Read it from `BACKEND_SETUP_STEPS` by key,
   *  never as a literal. Seeds state at mount only: the hosts mount the wizard per open. */
  initialStep?: number;
}

export function BackendSetupWizard({
  lang,
  open,
  settings,
  onChangeSettings,
  onClose,
  onMigrateToTurso,
  hidePortfolioSwitch,
  noCurrentProject,
  initialStep = 0,
}: BackendSetupWizardProps) {
  const [step, setStep] = useState(() => clampStep(initialStep, TOTAL));
  // Primary (Next/Finish) button is always present; focus it after a Skip so
  // focus isn't dropped to <body> when the conditional Skip button unmounts.
  const nextButtonRef = useRef<HTMLButtonElement>(null);

  const currentStep = BACKEND_SETUP_STEPS[step];
  const isFirst = step === 0;
  const isLast = step === TOTAL - 1;

  function handleClose() {
    setStep(clampStep(initialStep, TOTAL));
    onClose();
  }

  // §715 D2 — the storage step's "Portfolio storage" choice is held here: the step unmounts its
  // section on Next, which used to drop a picked-but-unswitched portfolio. Finish commits it (and the
  // commit reloads the app onto it); with nothing picked, Finish just closes.
  const [pendingPortfolioMode, setPendingPortfolioMode] = useState<PortfolioMode>(() => loadPortfolioMode());
  // The commit waits on token seals before it reloads, so a second Finish click would commit twice.
  const finishingRef = useRef(false);
  // The section's own button refuses Turso without a working config ("can't land in a dead
  // portfolio"); Finish is not a way around it. The step's drafts are gone by now, so the SAVED
  // credentials decide. ONE predicate for Finish and the review step's banner, so the banner never
  // promises a reload Finish will not do.
  const switchPending = pendingPortfolioMode !== loadPortfolioMode();
  const savedTurso = settings.integrations?.turso;
  const switchBlocked =
    switchPending && pendingPortfolioMode === "turso" && !getTursoConfig(savedTurso?.databaseUrl, savedTurso?.authToken);
  async function handleFinish() {
    if (finishingRef.current) return;
    if (switchPending) {
      if (switchBlocked) {
        setStep(STORAGE_STEP);
        return;
      }
      finishingRef.current = true;
      await commitPortfolioModeSwitch(settings, pendingPortfolioMode);
      return;
    }
    handleClose();
  }

  function handleBack() {
    setStep((s) => clampStep(s - 1, TOTAL));
  }

  // On Turso storage the step's URL/token are drafts until Apply, and the section discards them when
  // Next unmounts it. The section reports them here so leaving with unapplied drafts asks first — and
  // a Finish that switches portfolio then never lands on credentials the user meant to replace.
  const tursoDraftsDirtyRef = useRef(false);
  // Stable, so the section's report effect does not re-run on every wizard render.
  const reportTursoDraftsDirty = useCallback((dirty: boolean) => { tursoDraftsDirtyRef.current = dirty; }, []);
  const confirm = useConfirm();
  // ★ Only an unapplied draft waits on the dialog: a clean step is left synchronously, as before.
  const storageDraftsPending = () => currentStep.key === "storage" && tursoDraftsDirtyRef.current;
  /** Asks to discard the storage step's unapplied drafts; true when the user chose to. */
  async function confirmDiscardDrafts(): Promise<boolean> {
    const discard = await confirm({
      message: t(lang, "setupWizardTursoDraftsDiscard", t(lang, "cancel"), t(lang, "integrationsTursoApply")),
      confirmLabel: t(lang, "setupWizardTursoDraftsDiscardConfirm"),
    });
    if (discard) tursoDraftsDirtyRef.current = false;
    return discard;
  }
  function advance() {
    setStep((s) => clampStep(s + 1, TOTAL));
    nextButtonRef.current?.focus();
  }
  async function handleNext() {
    if (storageDraftsPending()) {
      if (await confirmDiscardDrafts()) advance();
      return;
    }
    advance();
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
          helpConceptId={MODAL_HELP.backendSetupWizard}
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
              hidePortfolioSwitch={hidePortfolioSwitch}
              noCurrentProject={noCurrentProject}
              pendingPortfolioMode={pendingPortfolioMode}
              onPendingPortfolioModeChange={setPendingPortfolioMode}
              onTursoDraftsDirtyChange={reportTursoDraftsDirty}
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
            <>
              <ReviewStep lang={lang} settings={settings} />
              {/* The storage step's own reload note unmounted with it; Finish is what reloads now. */}
              {switchBlocked ? (
                <Banner severity="error" className="mt-3">{t(lang, "setupWizardTursoNeedsConfig")}</Banner>
              ) : switchPending && (
                <Banner severity="warn" className="mt-3">{t(lang, "portfolioModeSwitchNote")}</Banner>
              )}
            </>
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
              <Button variant="secondary" onClick={() => void handleNext()}>
                {t(lang, "setupWizardSkip")}
              </Button>
            )}

            {/* ONE persistent primary button across all steps (label + handler
                swap on the last step) — a stable element so focusing it after a
                Skip survives the re-render. */}
            <Button
              ref={nextButtonRef}
              variant="primary"
              onClick={isLast ? () => void handleFinish() : () => void handleNext()}
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
