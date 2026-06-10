"use client";

// Shared create-project body: a file-format selector above the shared
// ProjectForm (create mode, no `initial`).
//
// Used by:
//   • projects-panel.tsx  — hosted inside a Modal; passes onCancel to close it.
//   • project-empty-state.tsx — hosted inline; passes onCancel to go back to the
//                               choices screen.
//
// The format selector is intentionally scoped to this component so neither
// consumer needs to manage that state.

import { useState } from "react";
import { type Contact } from "./contacts";
import { t, type Lang } from "./i18n";
import { ProjectForm } from "./project-form";
import { type ProjectMeta } from "./types";

const CREATE_FORMATS = ["json", "csv", "md"] as const;
type CreateFormat = (typeof CREATE_FORMATS)[number];

const CREATE_FORMAT_LABEL: Record<CreateFormat, string> = {
  json: "JSON",
  csv: "CSV",
  md: "Markdown",
};

export interface CreateProjectFormProps {
  lang: Lang;
  stakeholderNames: string[];
  addressBook: Contact[];
  onCreate: (meta: ProjectMeta, format: "json" | "csv" | "md") => void;
  /** Optional — empty-state has no cancel; panel modal may provide one. */
  onCancel?: () => void;
  /** Turso mode: hide the file-format selector and fix the format to "json"
   *  (the Turso create path ignores it). Defaults to false (file mode). */
  hideFormat?: boolean;
}

export function CreateProjectForm({
  lang,
  stakeholderNames,
  addressBook,
  onCreate,
  onCancel,
  hideFormat = false,
}: CreateProjectFormProps) {
  const [format, setFormat] = useState<CreateFormat>("json");

  const handleSubmit = (meta: ProjectMeta) => {
    onCreate(meta, format);
  };

  const handleCancel = onCancel ?? (() => undefined);

  return (
    <>
      {!hideFormat && (
        <label className="mb-4 flex flex-col gap-1 text-sm">
          <span className="font-medium text-foreground">
            {t(lang, "projectFileFormat")}
          </span>
          <select
            aria-label={t(lang, "projectFileFormat")}
            value={format}
            onChange={(e) => setFormat(e.target.value as CreateFormat)}
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
        stakeholderNames={stakeholderNames}
        addressBook={addressBook}
        lang={lang}
        onSubmit={handleSubmit}
        onCancel={handleCancel}
      />
    </>
  );
}
