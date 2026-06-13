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
import { IntegrationsSection } from "./settings-sections/integrations-section";
import { type Settings } from "./settings-types";

export interface BackendConfigModalProps {
  lang: Lang;
  title: string;
  settings: Settings;
  onChangeSettings: (s: Settings) => void;
  onClose: () => void;
}

const SECONDARY_BUTTON_CLASS =
  "rounded-md border border-line bg-surface px-4 py-2 text-sm font-medium text-foreground hover:bg-surface-muted";

export function BackendConfigModal({
  lang,
  title,
  settings,
  onChangeSettings,
  onClose,
}: BackendConfigModalProps) {
  const TITLE_ID = "backend-config-modal-title";
  return (
    <Modal
      open
      onClose={onClose}
      ariaLabelledby={TITLE_ID}
      align="center"
      backdropClassName="bg-AIPM-dark-blue/40"
      zIndex={60}
    >
      <div
        data-modal-panel
        className="relative flex max-h-[90vh] w-[680px] min-w-[360px] max-w-[95vw] flex-col overflow-hidden rounded-xl border border-line bg-surface"
      >
        <ModalHeader lang={lang} title={title} titleId={TITLE_ID} onClose={onClose} />
        <div className="overflow-y-auto p-6">
          <IntegrationsSection lang={lang} settings={settings} onChange={onChangeSettings} />
        </div>
        <div className="flex shrink-0 justify-end border-t border-line p-4">
          <button type="button" onClick={onClose} className={SECONDARY_BUTTON_CLASS}>
            {t(lang, "alertModalClose")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
