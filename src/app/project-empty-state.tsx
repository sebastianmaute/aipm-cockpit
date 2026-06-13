"use client";

// Empty-state modal shown on a fresh install when the portfolio registry has
// zero projects.  It is always open (mounted only when projects.length === 0,
// controlled by Task 18) and offers two primary choices:
//
//   • Create project  — reveals the 3-step CreateProjectWizard and calls
//                       onCreate(meta, format, opts) when the wizard finishes.
//   • Load from file  — calls onLoadFromFile immediately.
//
// Non-dismissability: the user MUST pick one of the two actions — there is no
// current project to fall back to.  The shared Modal requires an onClose prop
// (for Escape / backdrop click); we pass a no-op so those gestures do nothing.
// The header is rendered with `hideClose` so there is no dead ✕ control (it
// would be a no-op here and read as a broken affordance).
//
// On a fresh install there is also no Settings UI reachable yet, so the choices
// screen offers a "Backend setup" section: buttons to configure the Turso
// backend and the M365 integration (both open the shared BackendConfigModal,
// which wraps IntegrationsSection) before the user creates or loads a project.

import { useState } from "react";
import { BackendConfigModal } from "./backend-config-modal";
import { type Contact } from "./contacts";
import { CreateProjectWizard } from "./create-project-wizard";
import { t, type Lang } from "./i18n";
import { Modal } from "./modal";
import { ModalHeader } from "./modal-header";
import { type NewProjectOpts } from "./new-project-workspace";
import { type Settings } from "./settings-types";
import { ResetSizeButton, ResizeCornerHint } from "./task-manager-ui";
import { useResizable } from "./use-resizable";
import { type ProjectMeta, type Resource } from "./types";

const PRIMARY_BUTTON_CLASS =
  "rounded-md bg-AIPM-dark-blue px-4 py-2 text-sm font-medium text-white hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-AIPM-dark-blue focus:ring-offset-2";

const SECONDARY_BUTTON_CLASS =
  "rounded-md border border-line bg-surface px-4 py-2 text-sm font-medium text-foreground hover:bg-surface-muted";

export interface ProjectEmptyStateProps {
  lang: Lang;
  stakeholderNames: string[];
  addressBook: Contact[];
  resources: readonly Resource[];
  /** Current settings (for the backend-config modal opened from the selector). */
  settings: Settings;
  /** Persist edited settings (IntegrationsSection emits a full next value). */
  onChangeSettings: (s: Settings) => void;
  onCreate: (
    meta: ProjectMeta,
    format: "json" | "csv" | "md",
    opts?: NewProjectOpts,
  ) => void;
  onLoadFromFile: () => void;
  /** Turso mode: hide the "Load from file" choice and hide the file-format
   *  selector in the create view. Defaults to "file". */
  mode?: "file" | "turso";
}

type View = "choices" | "create";

/** No-op passed to Modal.onClose so Escape/backdrop/X do nothing. */
const noop = () => undefined;

export function ProjectEmptyState({
  lang,
  stakeholderNames,
  addressBook,
  resources,
  settings,
  onChangeSettings,
  onCreate,
  onLoadFromFile,
  mode = "file",
}: ProjectEmptyStateProps) {
  const [view, setView] = useState<View>("choices");
  const [configModal, setConfigModal] = useState<null | "turso" | "m365">(null);
  const { ref: sizeRef, reset: resetSize } = useResizable("lop-app:create-modal-size");

  const handleOpenCreate = () => setView("create");

  const handleCreate = (
    meta: ProjectMeta,
    format: "json" | "csv" | "md",
    opts: NewProjectOpts,
  ) => {
    onCreate(meta, format, opts);
  };

  const handleBackToChoices = () => setView("choices");

  const titleKey = view === "create" ? "projectsNew" : "projectsEmptyTitle";
  const TITLE_ID = "project-empty-state-title";

  return (
    <Modal
      open
      onClose={noop}
      ariaLabelledby={TITLE_ID}
      align="center"
      backdropClassName="bg-AIPM-dark-blue/60"
      zIndex={50}
    >
      <div
        ref={sizeRef}
        data-modal-panel
        className="relative flex max-h-[90vh] min-h-[420px] w-[960px] min-w-[360px] max-w-[95vw] resize flex-col overflow-hidden rounded-xl border border-line bg-surface"
      >
        <ModalHeader
          lang={lang}
          title={t(lang, titleKey)}
          titleId={TITLE_ID}
          onClose={noop}
          hideClose
          headerExtra={<ResetSizeButton onClick={resetSize} lang={lang} />}
        />

        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          {view === "choices" ? (
            <div className="flex flex-col gap-6">
              <p className="text-sm text-muted-foreground">
                {t(lang, "projectsEmptyTitle")}
              </p>
              <div className="flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={handleOpenCreate}
                  className={PRIMARY_BUTTON_CLASS}
                >
                  {t(lang, "projectsEmptyCreate")}
                </button>
                {mode === "file" && (
                  <button
                    type="button"
                    onClick={onLoadFromFile}
                    className={SECONDARY_BUTTON_CLASS}
                  >
                    {t(lang, "projectsEmptyLoad")}
                  </button>
                )}
              </div>

              {/* Backend setup — configure storage / integrations before there
                  is any project to fall back to. */}
              <div className="border-t border-line pt-4">
                <h3 className="mb-2 text-sm font-semibold text-foreground">
                  {t(lang, "backendSetup")}
                </h3>
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={() => setConfigModal("turso")}
                    title={t(lang, "emptyStateConfigTursoTip")}
                    className={SECONDARY_BUTTON_CLASS}
                  >
                    {t(lang, "storageOptionConfigure")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfigModal("m365")}
                    title={t(lang, "emptyStateConfigM365Tip")}
                    className={SECONDARY_BUTTON_CLASS}
                  >
                    {t(lang, "emptyStateConfigM365")}
                  </button>
                </div>
              </div>
            </div>
          ) : (
            <CreateProjectWizard
              lang={lang}
              stakeholderNames={stakeholderNames}
              addressBook={addressBook}
              resources={resources}
              settings={settings}
              onChangeSettings={onChangeSettings}
              onCreate={handleCreate}
              onCancel={handleBackToChoices}
              hideFormat={mode === "turso"}
            />
          )}
        </div>

        <ResizeCornerHint lang={lang} />
      </div>

      {configModal !== null && (
        <BackendConfigModal
          lang={lang}
          title={t(
            lang,
            configModal === "turso"
              ? "storageOptionConfigure"
              : "emptyStateConfigM365",
          )}
          settings={settings}
          onChangeSettings={onChangeSettings}
          onClose={() => setConfigModal(null)}
        />
      )}
    </Modal>
  );
}
