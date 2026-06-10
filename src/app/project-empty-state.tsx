"use client";

// Empty-state modal shown on a fresh install when the portfolio registry has
// zero projects.  It is always open (mounted only when projects.length === 0,
// controlled by Task 18) and offers two primary choices:
//
//   • Create project  — reveals the shared ProjectForm with a format selector
//                       and calls onCreate(meta, format) on submit.
//   • Load from file  — calls onLoadFromFile immediately.
//
// Non-dismissability: the user MUST pick one of the two actions — there is no
// current project to fall back to.  The shared Modal requires an onClose prop
// (for Escape / backdrop click); we pass a no-op so those gestures do nothing.
// ModalHeader always renders an X button wired to onClose, so the X becomes a
// visual-only artifact — acceptable because the body copy makes clear the user
// must create or load.

import { useState } from "react";
import { type Contact } from "./contacts";
import { t, type Lang } from "./i18n";
import { Modal } from "./modal";
import { ModalHeader } from "./modal-header";
import { ProjectForm } from "./project-form";
import { type ProjectMeta } from "./types";

const CREATE_FORMATS = ["json", "csv", "md"] as const;
type CreateFormat = (typeof CREATE_FORMATS)[number];

const CREATE_FORMAT_LABEL: Record<CreateFormat, string> = {
  json: "JSON",
  csv: "CSV",
  md: "Markdown",
};

const PRIMARY_BUTTON_CLASS =
  "rounded-md bg-AIPM-dark-blue px-4 py-2 text-sm font-medium text-white hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-AIPM-dark-blue focus:ring-offset-2";

const SECONDARY_BUTTON_CLASS =
  "rounded-md border border-line bg-surface px-4 py-2 text-sm font-medium text-foreground hover:bg-surface-muted";

export interface ProjectEmptyStateProps {
  lang: Lang;
  stakeholderNames: string[];
  addressBook: Contact[];
  onCreate: (meta: ProjectMeta, format: "json" | "csv" | "md") => void;
  onLoadFromFile: () => void;
}

type View = "choices" | "create";

/** No-op passed to Modal.onClose so Escape/backdrop/X do nothing. */
const noop = () => undefined;

export function ProjectEmptyState({
  lang,
  stakeholderNames,
  addressBook,
  onCreate,
  onLoadFromFile,
}: ProjectEmptyStateProps) {
  const [view, setView] = useState<View>("choices");
  const [createFormat, setCreateFormat] = useState<CreateFormat>("json");

  const handleOpenCreate = () => {
    setCreateFormat("json");
    setView("create");
  };

  const handleSubmit = (meta: ProjectMeta) => {
    onCreate(meta, createFormat);
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
        data-modal-panel
        className="relative flex max-h-[90vh] w-[720px] min-w-[360px] max-w-[95vw] flex-col overflow-hidden rounded-xl border border-line bg-surface"
      >
        <ModalHeader
          lang={lang}
          title={t(lang, titleKey)}
          titleId={TITLE_ID}
          onClose={noop}
        />

        <div className="overflow-y-auto p-6">
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
                <button
                  type="button"
                  onClick={onLoadFromFile}
                  className={SECONDARY_BUTTON_CLASS}
                >
                  {t(lang, "projectsEmptyLoad")}
                </button>
              </div>
            </div>
          ) : (
            <>
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
              <ProjectForm
                stakeholderNames={stakeholderNames}
                addressBook={addressBook}
                lang={lang}
                onSubmit={handleSubmit}
                onCancel={handleBackToChoices}
              />
            </>
          )}
        </div>
      </div>
    </Modal>
  );
}
