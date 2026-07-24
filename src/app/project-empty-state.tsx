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
// screen offers a "Backend setup" section: a "Configure database / M365" button
// (opens the shared BackendConfigModal, which wraps IntegrationsSection —
// storage/Turso/M365/Timelog) and a "Run setup wizard" button (the guided
// BackendSetupWizard) before the user creates or loads a project.

import { useState } from "react";
import { BackendConfigModal } from "./backend-config-modal";
import { BackendSetupWizard } from "./backend-setup-wizard";
import { AiSection } from "./settings-sections/ai-section";
import { type Contact } from "./contacts";
import { CreateProjectWizard } from "./create-project-wizard";
import { Button } from "./button";
import { TypeToConfirmDialog } from "./type-to-confirm-dialog";
import { t, type Lang } from "./i18n";
import { Modal } from "./modal";
import { ModalHeader } from "./modal-header";
import { type NewProjectOpts } from "./new-project-workspace";
import { type Settings } from "./settings-types";
import { ResetSizeButton } from "./task-manager-ui";
import { useResizable } from "./use-resizable";
import { type ProjectMeta, type Resource } from "./types";

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
  /** Load a project from a local file. In Turso mode this switches the portfolio
   *  to file mode (the host reloads); in file mode it just opens the picker. */
  onLoadFromFile: () => void;
  /** Load the bundled demo project (guided-tour entry point). When omitted, the
   *  "Explore a demo project" CTA is not rendered. */
  onLoadDemo?: () => void;
  /** Turso mode: hide the file-format selector in the create view. Defaults to
   *  "file". "Load from file" is offered in BOTH modes (Turso → switches mode). */
  mode?: "file" | "turso";
  /** Turso mode only: archived projects offered for one-click restore (the user
   *  may have archived their last active project and landed here). */
  archivedProjects?: readonly { id: string; name: string }[];
  /** Restore an archived Turso project by id (host reloads into it). */
  onRestore?: (id: string) => void;
  /** Permanently delete an archived Turso project by id (type-to-confirm gated). */
  onDeleteArchived?: (id: string) => void;
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
  onLoadDemo,
  mode = "file",
  archivedProjects = [],
  onRestore,
  onDeleteArchived,
}: ProjectEmptyStateProps) {
  const [view, setView] = useState<View>("choices");
  const [configOpen, setConfigOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [aiConfigOpen, setAiConfigOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);
  const { ref: sizeRef, reset: resetSize } = useResizable("aipm-cockpit:create-modal-size");

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
  const brandLogo = settings.branding?.logo;

  return (
    <Modal
      open
      onClose={noop}
      ariaLabelledby={TITLE_ID}
      align="center"
      backdropClassName="bg-ui-dark-blue/60"
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
          // The create (wizard) view can be closed via the ✕ — it returns to the
          // choices screen. The choices screen itself has no project to fall back
          // to, so it stays non-dismissable (no ✕) and shows the brand logo.
          onClose={view === "create" ? handleBackToChoices : noop}
          hideClose={view === "choices"}
          headerExtra={<ResetSizeButton onClick={resetSize} lang={lang} />}
          logo={
            view === "choices" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={brandLogo || "/AIPM-logo.svg"}
                alt={brandLogo ? (settings.branding?.slogan ?? t(lang, "appTitle")) : "Acme"}
                className={brandLogo ? "max-h-10 max-w-[200px] w-auto object-contain" : "h-7 w-auto"}
              />
            ) : undefined
          }
        />

        <div className="min-h-0 flex-1 overflow-y-auto p-6">
          {view === "choices" ? (
            <div className="flex flex-col gap-6">
              <p className="text-sm text-muted-foreground">
                {t(lang, "projectsEmptyTitle")}
              </p>
              <div className="flex flex-wrap gap-3">
                <Button variant="primary" onClick={handleOpenCreate}>
                  {t(lang, "projectsEmptyCreate")}
                </Button>
                {/* Load from file is offered in BOTH modes. In Turso mode the host
                    handler switches the portfolio to file mode and reloads. */}
                <Button variant="secondary" onClick={onLoadFromFile}>
                  {t(lang, "projectsEmptyLoad")}
                </Button>
                {/* Explore a demo project — guided-tour entry point. Rendered
                    only when a demo-load handler is wired (empty-state only). */}
                {onLoadDemo && (
                  <Button variant="secondary" onClick={onLoadDemo}>
                    {t(lang, "tourLoadDemo")}
                  </Button>
                )}
              </div>

              {/* Restore an archived project — Turso mode only, when archived
                  projects exist (e.g. the user just archived their last active
                  one and would otherwise be stuck on this screen). */}
              {mode === "turso" && onRestore && archivedProjects.length > 0 && (
                <div className="border-t border-line pt-4">
                  <h3 className="mb-2 text-sm font-semibold text-foreground">
                    {t(lang, "projectsArchived")}
                  </h3>
                  <ul className="flex flex-col gap-2">
                    {archivedProjects.map((p) => (
                      <li
                        key={p.id}
                        className="flex items-center justify-between gap-3 rounded-md border border-line bg-surface px-3 py-2 text-sm"
                      >
                        <span className="min-w-0 truncate text-foreground">{p.name}</span>
                        <span className="flex shrink-0 items-center gap-2">
                          <Button
                            variant="secondary"
                            onClick={() => onRestore(p.id)}
                            aria-label={`${t(lang, "projectsRestore")} – ${p.name}`}
                          >
                            {t(lang, "projectsRestore")}
                          </Button>
                          {onDeleteArchived && (
                            <Button
                              variant="destructive"
                              onClick={() => setDeleteTarget({ id: p.id, name: p.name })}
                              aria-label={`${t(lang, "projectsDeletePermanently")} – ${p.name}`}
                            >
                              {t(lang, "delete")}
                            </Button>
                          )}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Backend setup — configure storage / integrations before there
                  is any project to fall back to. */}
              <div className="border-t border-line pt-4">
                <h3 className="mb-2 text-sm font-semibold text-foreground">
                  {t(lang, "backendSetup")}
                </h3>
                <div className="flex flex-wrap gap-3">
                  <Button
                    variant="secondary"
                    onClick={() => setConfigOpen(true)}
                    title={t(lang, "emptyStateConfigDbM365Tip")}
                  >
                    {t(lang, "emptyStateConfigDbM365")}
                  </Button>
                  <Button variant="secondary" onClick={() => setWizardOpen(true)}>
                    {t(lang, "setupWizardRun")}
                  </Button>
                  <Button variant="secondary" onClick={() => setAiConfigOpen(true)}>
                    {t(lang, "emptyStateConfigAi")}
                  </Button>
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

      </div>

      {configOpen && (
        <BackendConfigModal
          lang={lang}
          title={t(lang, "emptyStateConfigDbM365")}
          settings={settings}
          onChangeSettings={onChangeSettings}
          onClose={() => setConfigOpen(false)}
          hidePortfolioSwitch
        />
      )}

      {aiConfigOpen && (
        <BackendConfigModal
          lang={lang}
          title={t(lang, "emptyStateConfigAi")}
          settings={settings}
          onChangeSettings={onChangeSettings}
          onClose={() => setAiConfigOpen(false)}
        >
          <AiSection lang={lang} settings={settings} onChange={onChangeSettings} hideUsage />
        </BackendConfigModal>
      )}

      {wizardOpen && (
        <BackendSetupWizard
          lang={lang}
          open
          settings={settings}
          onChangeSettings={onChangeSettings}
          onClose={() => setWizardOpen(false)}
        />
      )}

      {deleteTarget && onDeleteArchived && (
        <TypeToConfirmDialog
          lang={lang}
          title={t(lang, "projectsHardDeleteTitle")}
          message={t(lang, "projectsHardDeleteMessage")}
          confirmValue={deleteTarget.name}
          confirmLabel={t(lang, "projectsDeletePermanently")}
          onConfirm={() => {
            onDeleteArchived(deleteTarget.id);
            setDeleteTarget(null);
          }}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </Modal>
  );
}
