"use client";

// Projects management view — a presentational portfolio panel.
//
// Lists every registered project and exposes per-project actions:
//   • non-current row → Switch (loads that project; wired in Task 18).
//   • current row     → Edit (opens the shared ProjectForm prefilled),
//                       Export (a small menu of the real export formats),
//                       Delete (de-registers; the underlying file is kept).
//
// Edit/Export are offered ONLY on the current project because only its
// workspace is in memory in Phase 1 — non-current rows get Switch instead.
// This is intentional; see the task spec.
//
// This component is purely presentational: every side-effect (switch, create,
// update, delete, export, load-from-file) is delegated to a callback prop. The
// create/edit ProjectForm is hosted internally in a shared Modal; the only
// local state is which modal is open and (in create mode) the chosen file
// format for the new project.

import { useState } from "react";
import { type Contact } from "./contacts";
import { CreateProjectWizard } from "./create-project-wizard";
import { type ExportFormat } from "./export";
import { type NewProjectOpts } from "./new-project-workspace";
import { t, type Lang } from "./i18n";
import { Modal } from "./modal";
import { ModalHeader } from "./modal-header";
import { ProjectForm } from "./project-form";
import { type ProjectRegistryEntry } from "./projects-registry";
import { type Settings } from "./settings-types";
import { getTursoConfig } from "./turso-config";
import { ResetSizeButton } from "./task-manager-ui";
import { TypeToConfirmDialog } from "./type-to-confirm-dialog";
import { useConfirm } from "./confirm-dialog";
import { useResizable } from "./use-resizable";
import { CENTERED_HALF_PANE_CLASS } from "./view-styles";
import { EmptyState } from "./empty-state";
import { INTERACTIVE, TRANSITION, PRESS, FOCUS_RING } from "./interaction-styles";
import { type ProjectMeta, type Resource } from "./types";

/** File formats a brand-new project's workspace can be created in.
 *  The create flow is delegated to CreateProjectForm which owns this list. */
type CreateFormat = "json" | "csv" | "md";

/** Real export formats offered for the current project (export.ts ExportFormat). */
const EXPORT_FORMATS: ExportFormat[] = ["csv", "md", "pdf", "docx", "xlsx", "pptx"];

const EXPORT_FORMAT_LABEL: Record<ExportFormat, string> = {
  csv: "CSV",
  md: "Markdown",
  pdf: "PDF",
  docx: "Word (.docx)",
  xlsx: "Excel (.xlsx)",
  pptx: "PowerPoint (.pptx)",
};

const PRIMARY_BUTTON_CLASS =
  `rounded-md bg-AIPM-dark-blue px-4 py-2 text-sm font-medium text-white hover:opacity-90 ${FOCUS_RING} ${TRANSITION} ${PRESS}`;

const SECONDARY_BUTTON_CLASS =
  `rounded-md border border-line bg-surface px-3 py-1.5 text-sm font-medium text-foreground hover:bg-surface-muted ${INTERACTIVE}`;

/** Destructive (pink) action button — delete / archive / permanent-delete. */
const DESTRUCTIVE_BUTTON_CLASS =
  `rounded-md border border-AIPM-pink/40 bg-surface px-3 py-1.5 text-sm font-medium text-AIPM-pink-strong hover:bg-AIPM-pink/10 dark:border-AIPM-pink/50 ${INTERACTIVE}`;

export interface ProjectsPanelProps {
  projects: ProjectRegistryEntry[];
  currentProjectId: string | null;
  /** The active project's metadata (for edit prefill + richer display). */
  currentProject?: ProjectMeta;
  /** Suggestions for the ProjectForm key-stakeholder inputs. */
  stakeholderNames: string[];
  /** Address book for the ProjectForm contact picker. */
  addressBook: Contact[];
  /** Registry resources for the link-only contact-person picker. */
  resources: readonly Resource[];
  /** Current settings (for the backend-config modal opened from the selector). */
  settings: Settings;
  /** Persist edited settings (IntegrationsSection emits a full next value). */
  onChangeSettings: (s: Settings) => void;
  lang: Lang;
  onSwitch: (id: string) => void;
  onCreate: (meta: ProjectMeta, format: CreateFormat, opts?: NewProjectOpts) => void;
  /** Save edited metadata back to the current project. */
  onUpdateCurrent: (meta: ProjectMeta) => void;
  /** De-register a project (the confirm dialog is handled here). */
  onDelete: (id: string) => void;
  /** Export the CURRENT project's workspace in the given format. */
  onExportCurrent: (format: string) => void;
  onLoadFromFile: () => void;
  /** File mode + Turso configured: copy the current project into a new Turso
   *  project and switch the portfolio to Turso. */
  onMigrateToTurso: () => void;
  /** Storage backend kind. In "turso" mode the destructive per-row action is
   *  Archive (soft-delete) and an "Archived projects" subsection becomes
   *  available; in "file" mode the panel behaves exactly as in Phase 1. */
  mode: "file" | "turso";
  /** Turso-mode only: archived projects to reveal under "Show archived". */
  archivedProjects?: ProjectRegistryEntry[];
  onArchive?: (id: string) => void;
  onRestore?: (id: string) => void;
  onHardDelete?: (id: string) => void;
}

type ModalState =
  | { mode: "closed" }
  | { mode: "create" }
  | { mode: "edit" };

export function ProjectsPanel({
  projects,
  currentProjectId,
  currentProject,
  stakeholderNames,
  addressBook,
  resources,
  settings,
  onChangeSettings,
  lang,
  onSwitch,
  onCreate,
  onUpdateCurrent,
  onDelete,
  onExportCurrent,
  onLoadFromFile,
  onMigrateToTurso,
  mode,
  archivedProjects,
  onArchive,
  onRestore,
  onHardDelete,
}: ProjectsPanelProps) {
  const [modal, setModal] = useState<ModalState>({ mode: "closed" });
  const confirm = useConfirm();
  const tursoConfigured = !!getTursoConfig(
    settings.integrations?.turso?.databaseUrl,
    settings.integrations?.turso?.authToken,
  );
  const { ref: paneSizeRef, reset: resetPaneSize } = useResizable("aipm-cockpit:projects-pane-size");
  const { ref: sizeRef, reset: resetSize } = useResizable("aipm-cockpit:create-modal-size");
  const [exportMenuId, setExportMenuId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [hardDeleteTarget, setHardDeleteTarget] =
    useState<ProjectRegistryEntry | null>(null);

  const isTurso = mode === "turso";

  const closeModal = () => setModal({ mode: "closed" });

  const openCreate = () => setModal({ mode: "create" });

  const handleDelete = async (id: string) => {
    if (await confirm({ message: t(lang, "projectsDeleteConfirm") })) onDelete(id);
  };

  const handleArchive = async (id: string) => {
    if (await confirm({ message: t(lang, "projectsArchiveConfirm") })) onArchive?.(id);
  };

  const handleCreate = (
    meta: ProjectMeta,
    format: CreateFormat,
    opts: NewProjectOpts,
  ) => {
    onCreate(meta, format, opts);
    closeModal();
  };

  const handleEditSubmit = (meta: ProjectMeta) => {
    onUpdateCurrent(meta);
    closeModal();
  };

  const handleExport = (format: ExportFormat) => {
    setExportMenuId(null);
    onExportCurrent(format);
  };

  return (
    <div ref={paneSizeRef} className={`${CENTERED_HALF_PANE_CLASS} text-foreground`}>
      {/* Header --------------------------------------------------------- */}
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
        <h2 className="text-lg font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey">
          {t(lang, "projectsTitle")}
        </h2>
        <div className="flex items-center gap-2">
          {isTurso && (
            <button
              type="button"
              onClick={() => setShowArchived((v) => !v)}
              aria-pressed={showArchived}
              className={SECONDARY_BUTTON_CLASS}
            >
              {t(lang, showArchived ? "projectsHideArchived" : "projectsShowArchived")}
            </button>
          )}
          {!isTurso && (
            <button type="button" onClick={onLoadFromFile} className={SECONDARY_BUTTON_CLASS}>
              {t(lang, "projectSwitcherLoadFile")}
            </button>
          )}
          {!isTurso && tursoConfigured && currentProject && (
            <button
              type="button"
              onClick={onMigrateToTurso}
              title={t(lang, "projectMigrateToTursoHint")}
              className={SECONDARY_BUTTON_CLASS}
            >
              {t(lang, "projectMigrateToTurso")}
            </button>
          )}
          <button type="button" onClick={openCreate} className={PRIMARY_BUTTON_CLASS}>
            + {t(lang, "projectsNew")}
          </button>
          <ResetSizeButton onClick={resetPaneSize} lang={lang} />
        </div>
      </header>

      {/* List ----------------------------------------------------------- */}
      <div className="min-h-0 flex-1 overflow-auto pr-2 pt-4">
        {projects.length === 0 ? (
          <EmptyState compact title={t(lang, "projectsEmptyTitle")} />
        ) : (
          <ul className="flex flex-col gap-2">
            {projects.map((p) => {
              const isCurrent = p.id === currentProjectId;
              return (
                <li
                  key={p.id}
                  className={`flex flex-col gap-2 rounded-lg border p-3 ${
                    isCurrent
                      ? "border-AIPM-dark-blue bg-AIPM-dark-blue/5"
                      : "border-line bg-surface"
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-foreground">{p.name}</span>
                        <span className="font-mono text-xs text-muted-foreground">
                          {p.code}
                        </span>
                        {isCurrent && (
                          <span className="rounded bg-AIPM-dark-blue px-2 py-0.5 text-xs font-medium text-white">
                            {t(lang, "projectCurrentLabel")}
                          </span>
                        )}
                      </div>
                      {isCurrent && currentProject && (
                        <dl className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted-foreground">
                          {currentProject.customer && (
                            <div className="flex gap-1">
                              <dt className="font-medium">{t(lang, "projectCustomer")}:</dt>
                              <dd>{currentProject.customer}</dd>
                            </div>
                          )}
                          {currentProject.startDate && currentProject.endDate && (
                            <div className="flex gap-1">
                              <dd>
                                {currentProject.startDate} – {currentProject.endDate}
                              </dd>
                            </div>
                          )}
                        </dl>
                      )}
                    </div>

                    {/* Per-row actions ----------------------------------- */}
                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      {isCurrent ? (
                        <>
                          <button
                            type="button"
                            onClick={() => setModal({ mode: "edit" })}
                            className={SECONDARY_BUTTON_CLASS}
                          >
                            {t(lang, "projectsEdit")}
                          </button>

                          <div className="relative">
                            <button
                              type="button"
                              onClick={() =>
                                setExportMenuId((cur) => (cur === p.id ? null : p.id))
                              }
                              aria-haspopup="menu"
                              aria-expanded={exportMenuId === p.id}
                              className={SECONDARY_BUTTON_CLASS}
                            >
                              {t(lang, "projectsExport")}
                            </button>
                            {exportMenuId === p.id && (
                              <ul
                                role="menu"
                                className="absolute right-0 z-20 mt-1 w-40 overflow-hidden rounded-md border border-line bg-surface shadow-md"
                              >
                                {EXPORT_FORMATS.map((fmt) => (
                                  <li key={fmt} role="none">
                                    <button
                                      type="button"
                                      role="menuitem"
                                      onClick={() => handleExport(fmt)}
                                      className={`block w-full px-3 py-1.5 text-left text-sm hover:bg-surface-muted ${INTERACTIVE}`}
                                    >
                                      {EXPORT_FORMAT_LABEL[fmt]}
                                    </button>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>

                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            onClick={() => onSwitch(p.id)}
                            aria-label={`${t(lang, "projectsSwitch")} – ${p.name}`}
                            className={SECONDARY_BUTTON_CLASS}
                          >
                            {t(lang, "projectsSwitch")}
                          </button>
                          {/* Destructive actions live on NON-current rows only: the
                              active/non-archived project you are in must not be
                              archivable/deletable from under you (switch away first). */}
                          {isTurso ? (
                            <button
                              type="button"
                              onClick={() => handleArchive(p.id)}
                              aria-label={`${t(lang, "projectsArchive")} – ${p.name}`}
                              title={t(lang, "projectsArchiveHint")}
                              className={DESTRUCTIVE_BUTTON_CLASS}
                            >
                              {t(lang, "projectsArchive")}
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleDelete(p.id)}
                              aria-label={`${t(lang, "projectsDelete")} – ${p.name}`}
                              className={DESTRUCTIVE_BUTTON_CLASS}
                            >
                              {t(lang, "projectsDelete")}
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        {/* Archived projects (turso mode only) ----------------------- */}
        {isTurso && showArchived && (
          <div className="mt-6 border-t border-line pt-4">
            <h3 className="mb-2 text-sm font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey">
              {t(lang, "projectsArchived")}
            </h3>
            {(archivedProjects ?? []).length === 0 ? (
              <EmptyState compact title={t(lang, "projectsEmptyTitle")} />
            ) : (
              <ul className="flex flex-col gap-2">
                {(archivedProjects ?? []).map((p) => (
                  <li
                    key={p.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-surface p-3"
                  >
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <span className="font-medium text-foreground">{p.name}</span>
                      <span className="font-mono text-xs text-muted-foreground">
                        {p.code}
                      </span>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onRestore?.(p.id)}
                        className={SECONDARY_BUTTON_CLASS}
                      >
                        {t(lang, "projectsRestore")}
                      </button>
                      <button
                        type="button"
                        onClick={() => setHardDeleteTarget(p)}
                        className={DESTRUCTIVE_BUTTON_CLASS}
                      >
                        {t(lang, "projectsDeletePermanently")}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* Permanent (hard) delete confirmation -------------------------- */}
      {hardDeleteTarget && (
        <TypeToConfirmDialog
          lang={lang}
          title={t(lang, "projectsHardDeleteTitle")}
          message={t(lang, "projectsHardDeleteMessage")}
          confirmValue={hardDeleteTarget.name}
          confirmLabel={t(lang, "projectsDeletePermanently")}
          onConfirm={() => {
            onHardDelete?.(hardDeleteTarget.id);
            setHardDeleteTarget(null);
          }}
          onCancel={() => setHardDeleteTarget(null)}
        />
      )}

      {/* Create / edit modal ------------------------------------------- */}
      {modal.mode !== "closed" && (
        <Modal
          open
          onClose={closeModal}
          ariaLabel={t(lang, modal.mode === "create" ? "projectsNew" : "projectsEdit")}
          align="center"
          backdropClassName="bg-AIPM-dark-blue/40"
          zIndex={50}
        >
          <div
            ref={sizeRef}
            data-modal-panel
            className="relative flex max-h-[90vh] min-h-[420px] w-[960px] min-w-[360px] max-w-[95vw] resize flex-col overflow-hidden rounded-xl border border-line bg-surface"
          >
            <ModalHeader
              lang={lang}
              title={t(lang, modal.mode === "create" ? "projectsNew" : "projectsEdit")}
              onClose={closeModal}
              headerExtra={<ResetSizeButton onClick={resetSize} lang={lang} />}
            />
            <div className="min-h-0 flex-1 overflow-y-auto p-6">
              {modal.mode === "create" ? (
                <CreateProjectWizard
                  lang={lang}
                  stakeholderNames={stakeholderNames}
                  addressBook={addressBook}
                  resources={resources}
                  settings={settings}
                  onChangeSettings={onChangeSettings}
                  onCreate={handleCreate}
                  onCancel={closeModal}
                  hideFormat={isTurso}
                />
              ) : (
                <ProjectForm
                  initial={currentProject}
                  stakeholderNames={stakeholderNames}
                  addressBook={addressBook}
                  resources={resources}
                  lang={lang}
                  onSubmit={handleEditSubmit}
                  onCancel={closeModal}
                />
              )}
            </div>

          </div>
        </Modal>
      )}
    </div>
  );
}
