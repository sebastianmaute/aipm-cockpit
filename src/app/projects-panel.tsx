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
import { type ExportFormat } from "./export";
import { t, type Lang } from "./i18n";
import { Modal } from "./modal";
import { ModalHeader } from "./modal-header";
import { ProjectForm } from "./project-form";
import { type ProjectRegistryEntry } from "./projects-registry";
import { CENTERED_HALF_PANE_CLASS } from "./view-styles";
import { type ProjectMeta } from "./types";

/** File formats a brand-new project's workspace can be created in. The export
 *  menu offers the full ExportFormat union (from export.ts); the create flow is
 *  limited to the three formats a project file can be persisted as. */
const CREATE_FORMATS = ["json", "csv", "md"] as const;
type CreateFormat = (typeof CREATE_FORMATS)[number];

const CREATE_FORMAT_LABEL: Record<CreateFormat, string> = {
  json: "JSON",
  csv: "CSV",
  md: "Markdown",
};

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
  "rounded-md bg-AIPM-dark-blue px-4 py-2 text-sm font-medium text-white hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-AIPM-dark-blue focus:ring-offset-2";

const SECONDARY_BUTTON_CLASS =
  "rounded-md border border-line bg-surface px-3 py-1.5 text-sm font-medium text-foreground hover:bg-surface-muted";

export interface ProjectsPanelProps {
  projects: ProjectRegistryEntry[];
  currentProjectId: string | null;
  /** The active project's metadata (for edit prefill + richer display). */
  currentProject?: ProjectMeta;
  /** Suggestions for the ProjectForm key-stakeholder inputs. */
  stakeholderNames: string[];
  /** Address book for the ProjectForm contact picker. */
  addressBook: Contact[];
  lang: Lang;
  onSwitch: (id: string) => void;
  onCreate: (meta: ProjectMeta, format: CreateFormat) => void;
  /** Save edited metadata back to the current project. */
  onUpdateCurrent: (meta: ProjectMeta) => void;
  /** De-register a project (the confirm dialog is handled here). */
  onDelete: (id: string) => void;
  /** Export the CURRENT project's workspace in the given format. */
  onExportCurrent: (format: string) => void;
  onLoadFromFile: () => void;
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
  lang,
  onSwitch,
  onCreate,
  onUpdateCurrent,
  onDelete,
  onExportCurrent,
  onLoadFromFile,
}: ProjectsPanelProps) {
  const [modal, setModal] = useState<ModalState>({ mode: "closed" });
  const [createFormat, setCreateFormat] = useState<CreateFormat>("json");
  const [exportMenuId, setExportMenuId] = useState<string | null>(null);

  const closeModal = () => setModal({ mode: "closed" });

  const openCreate = () => {
    setCreateFormat("json");
    setModal({ mode: "create" });
  };

  const handleDelete = (id: string) => {
    if (window.confirm(t(lang, "projectsDeleteConfirm"))) onDelete(id);
  };

  const handleSubmit = (meta: ProjectMeta) => {
    if (modal.mode === "create") {
      onCreate(meta, createFormat);
    } else if (modal.mode === "edit") {
      onUpdateCurrent(meta);
    }
    closeModal();
  };

  const handleExport = (format: ExportFormat) => {
    setExportMenuId(null);
    onExportCurrent(format);
  };

  return (
    <section className={`${CENTERED_HALF_PANE_CLASS} text-foreground`}>
      {/* Header --------------------------------------------------------- */}
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-line pb-4">
        <h2 className="text-lg font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey">
          {t(lang, "projectsTitle")}
        </h2>
        <div className="flex items-center gap-2">
          <button type="button" onClick={onLoadFromFile} className={SECONDARY_BUTTON_CLASS}>
            {t(lang, "projectSwitcherLoadFile")}
          </button>
          <button type="button" onClick={openCreate} className={PRIMARY_BUTTON_CLASS}>
            + {t(lang, "projectsNew")}
          </button>
        </div>
      </header>

      {/* List ----------------------------------------------------------- */}
      <div className="min-h-0 flex-1 overflow-auto pt-4">
        {projects.length === 0 ? (
          <p className="text-sm italic text-muted-foreground">
            {t(lang, "projectsEmptyTitle")}
          </p>
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
                                      className="block w-full px-3 py-1.5 text-left text-sm hover:bg-surface-muted"
                                    >
                                      {EXPORT_FORMAT_LABEL[fmt]}
                                    </button>
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>

                          <button
                            type="button"
                            onClick={() => handleDelete(p.id)}
                            className="rounded-md border border-AIPM-pink/40 bg-surface px-3 py-1.5 text-sm font-medium text-AIPM-pink hover:bg-AIPM-pink/10 dark:border-AIPM-pink/50"
                          >
                            {t(lang, "projectsDelete")}
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => onSwitch(p.id)}
                          className={SECONDARY_BUTTON_CLASS}
                        >
                          {t(lang, "projectsSwitch")}
                        </button>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

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
            data-modal-panel
            className="relative flex max-h-[90vh] w-[720px] min-w-[460px] max-w-[95vw] flex-col overflow-hidden rounded-xl border border-line bg-surface"
          >
            <ModalHeader
              lang={lang}
              title={t(lang, modal.mode === "create" ? "projectsNew" : "projectsEdit")}
              onClose={closeModal}
            />
            <div className="overflow-y-auto p-6">
              {modal.mode === "create" && (
                <label className="mb-4 flex flex-col gap-1 text-sm">
                  <span className="font-medium text-foreground">
                    {t(lang, "projectsExport")}
                  </span>
                  <select
                    aria-label={t(lang, "projectsExport")}
                    value={createFormat}
                    onChange={(e) => setCreateFormat(e.target.value as CreateFormat)}
                    className="rounded-md border border-line bg-surface px-3 py-2 text-sm"
                  >
                    {CREATE_FORMATS.map((fmt) => (
                      <option key={fmt} value={fmt}>
                        {CREATE_FORMAT_LABEL[fmt]}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <ProjectForm
                initial={modal.mode === "edit" ? currentProject : undefined}
                stakeholderNames={stakeholderNames}
                addressBook={addressBook}
                lang={lang}
                onSubmit={handleSubmit}
                onCancel={closeModal}
              />
            </div>
          </div>
        </Modal>
      )}
    </section>
  );
}
