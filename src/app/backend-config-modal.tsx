"use client";

// Reusable backend-configuration modal. Wraps the existing IntegrationsSection
// (the single source for the M365 sign-in block AND the Turso DB-URL / auth-token
// inputs + the portfolio storage-mode selector) in the shared Modal shell so it
// can be opened from the create-project surfaces:
//   • the Storage dropdown in CreateProjectForm (pick "Turso" → configure), and
//   • the empty-state "Backend setup" buttons (Task 7).
//
// It is intentionally generic: it just renders the section and a Close button.
// All persistence happens through onChangeSettings (IntegrationsSection emits a
// full next Settings value).

import { t, type Lang } from "./i18n";
import { Modal } from "./modal";
import { ModalHeader } from "./modal-header";
import { type HelpEntryId } from "./help-content";
import { IntegrationsSection } from "./settings-sections/integrations-section";
import { type Settings } from "./settings-types";
import { IntegrationDisclaimerProvider } from "./integration-disclaimer";
import { Button } from "./button";

export interface BackendConfigModalProps {
  lang: Lang;
  title: string;
  settings: Settings;
  onChangeSettings: (s: Settings) => void;
  onClose: () => void;
  /** Forwarded to IntegrationsSection: hide the portfolio storage-mode switch.
   *  Set on the empty-state config surface, where there is no current project to
   *  migrate — switching the portfolio can only reload into a different (empty)
   *  portfolio, so the switch is a footgun there. */
  hidePortfolioSwitch?: boolean;
  /** Forwarded to IntegrationsSection: use the "Switch portfolio" label. Set
   *  on pre-project surfaces (empty state, create-project flow). */
  noCurrentProject?: boolean;
  /** Body override. When provided, render this instead of IntegrationsSection
   *  (e.g. the AI-assistant config surface renders AiSection here). */
  children?: React.ReactNode;
  /** Which Help entry the header's icon opens. REQUIRED, and required rather
   *  than optional-with-a-default on purpose: tsc then catches a consumer that
   *  forgets it, which a default never would.
   *
   *  ★★ IT IS A PROP BECAUSE `children` REPLACES THE BODY. This modal used to
   *  hardcode `MODAL_HELP.backendConfig` (Storage: IndexedDB, JSON/CSV files,
   *  SharePoint), which is right for its default `IntegrationsSection` body —
   *  but the empty-state AI instance renders `AiSection` under it, so the icon
   *  opened the Storage entry over a dialog about the Anthropic API key. That
   *  was closed by a `hideHelp` suppression flag (REMOVED — it no longer
   *  exists on this component or on `ModalHeader`) justified by "no Help entry
   *  describes the AI settings", which was FALSE: scanning all 66 entries'
   *  titles and bodies for /anthropic|api key/i returns TWO — `feature-ai` and
   *  `feature-ai-advanced` — and `feature-ai`'s body opens "Add an Anthropic
   *  API key in Settings → AI, …", exactly the dialog's subject. So the AI
   *  instance now passes `MODAL_HELP.aiSettings` and the flag is gone.
   *
   *  ★ PASS A LITERAL `MODAL_HELP.<key>`, never a computed id:
   *  `help-content.test.ts` scans the sources for that exact spelling, and a
   *  ternary or a variable reads to it as an unwired key. */
  helpConceptId: HelpEntryId;
}

export function BackendConfigModal({
  lang,
  title,
  settings,
  onChangeSettings,
  onClose,
  hidePortfolioSwitch,
  noCurrentProject,
  children,
  helpConceptId,
}: BackendConfigModalProps) {
  const TITLE_ID = "backend-config-modal-title";
  return (
    <IntegrationDisclaimerProvider
      lang={lang}
      seen={settings.integrationDisclaimerSeen === true}
      onAcknowledge={() => onChangeSettings({ ...settings, integrationDisclaimerSeen: true })}
    >
    <Modal
      open
      onClose={onClose}
      ariaLabelledby={TITLE_ID}
      align="center"
      backdropClassName="bg-ui-dark-blue/40"
      zIndex={60}
    >
      <div
        data-modal-panel
        className="relative flex max-h-[90vh] w-[680px] min-w-[360px] max-w-[95vw] flex-col overflow-hidden rounded-xl border border-line bg-surface"
      >
        <ModalHeader
          lang={lang}
          title={title}
          helpConceptId={helpConceptId}
          titleId={TITLE_ID}
          onClose={onClose}
        />
        <div className="overflow-y-auto p-6">
          {children ?? (
            <IntegrationsSection
              lang={lang}
              settings={settings}
              onChange={onChangeSettings}
              hidePortfolioSwitch={hidePortfolioSwitch}
              noCurrentProject={noCurrentProject}
            />
          )}
        </div>
        <div className="flex shrink-0 justify-end border-t border-line p-4">
          <Button variant="secondary" onClick={onClose}>
            {t(lang, "alertModalClose")}
          </Button>
        </div>
      </div>
    </Modal>
    </IntegrationDisclaimerProvider>
  );
}
