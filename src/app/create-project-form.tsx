"use client";

// Shared create-project body: a storage selector above the shared ProjectForm
// (create mode, no `initial`).
//
// Used by:
//   • projects-panel.tsx  — hosted inside a Modal; passes onCancel to close it.
//   • project-empty-state.tsx — hosted inline; passes onCancel to go back to the
//                               choices screen.
//
// The storage selector lists the file formats (JSON/CSV/Markdown) plus Turso.
// Picking Turso opens the BackendConfigModal (so the user can enter the Turso
// URL/token and/or switch the portfolio storage mode) and tags the new project
// with a `storage: "turso"` discriminator so the host routes it to the Turso
// backend. The selection state is scoped here so neither consumer manages it.

import { useState } from "react";
import { BackendConfigModal } from "./backend-config-modal";
import { type Contact } from "./contacts";
import { t, type Lang } from "./i18n";
import { ProjectForm } from "./project-form";
import { Select } from "./form-controls";
import { type Settings } from "./settings-types";
import { type ProjectMeta, type Resource } from "./types";

type CreateFormat = "json" | "csv" | "md";
/** Selector value: the file formats plus the Turso backend. */
type StorageSelection = CreateFormat | "turso";

const FILE_FORMATS: readonly CreateFormat[] = ["json", "csv", "md"] as const;

const CREATE_FORMAT_LABEL: Record<CreateFormat, string> = {
  json: "JSON",
  csv: "CSV",
  md: "Markdown",
};

export interface CreateProjectFormProps {
  lang: Lang;
  stakeholderNames: string[];
  addressBook: Contact[];
  resources: readonly Resource[];
  /** Current settings (for the backend-config modal). */
  settings: Settings;
  /** Persist edited settings (IntegrationsSection emits a full next value). */
  onChangeSettings: (s: Settings) => void;
  onCreate: (
    meta: ProjectMeta,
    format: CreateFormat,
    storage: "file" | "turso",
  ) => void;
  /** Optional — empty-state has no cancel; panel modal may provide one. */
  onCancel?: () => void;
  /** Turso mode: hide the storage selector and fix the format to "json"
   *  (the Turso create path ignores it). Defaults to false (file mode). */
  hideFormat?: boolean;
  /** Override the submit button label. Defaults to "New project". */
  submitLabel?: string;
  /** Prefill the field group (e.g. the wizard restoring captured details on
   *  Back). Forwarded to ProjectForm's `initial`. Defaults undefined → blank. */
  initialMeta?: ProjectMeta;
  /** Create-mode prefill forwarded to ProjectForm (AI fast-path). */
  initialDraftPatch?: Partial<import("./project-form-fields").ProjectFormDraft>;
  /** Prefill the selector. Defaults to "json". */
  initialFormat?: CreateFormat;
  /** Footer bottom-left slot, forwarded to ProjectForm. */
  footerLeft?: React.ReactNode;
}

export function CreateProjectForm({
  lang,
  stakeholderNames,
  addressBook,
  resources,
  settings,
  onChangeSettings,
  onCreate,
  onCancel,
  hideFormat = false,
  submitLabel,
  initialMeta,
  initialDraftPatch,
  initialFormat,
  footerLeft,
}: CreateProjectFormProps) {
  const [selection, setSelection] = useState<StorageSelection>(
    initialFormat ?? "json",
  );
  const [configOpen, setConfigOpen] = useState(false);

  const storage: "file" | "turso" = selection === "turso" ? "turso" : "file";
  const format: CreateFormat = selection === "turso" ? "json" : selection;

  const handleSelectionChange = (next: StorageSelection) => {
    setSelection(next);
    // Picking Turso surfaces the backend config (URL/token + portfolio mode).
    if (next === "turso") setConfigOpen(true);
  };

  const handleSubmit = (meta: ProjectMeta) => {
    onCreate(meta, format, storage);
  };

  const handleCancel = onCancel ?? (() => undefined);

  return (
    <>
      {!hideFormat && (
        <label className="mb-4 flex flex-col gap-1 text-sm">
          <span className="font-medium text-foreground">
            {t(lang, "projectStorage")}
          </span>
          <Select
            aria-label={t(lang, "projectStorage")}
            value={selection}
            onChange={(e) =>
              handleSelectionChange(e.target.value as StorageSelection)
            }
          >
            {FILE_FORMATS.map((fmt) => (
              <option key={fmt} value={fmt}>
                {CREATE_FORMAT_LABEL[fmt]}
              </option>
            ))}
            <option value="turso" title={t(lang, "storageOptionConfigure")}>
              {t(lang, "storageTurso")}
            </option>
          </Select>
          <p className="text-xs text-muted-foreground">
            {t(lang, "wizardStorageTursoRecommended")}
          </p>
        </label>
      )}
      <ProjectForm
        initial={initialMeta}
        initialDraftPatch={initialDraftPatch}
        stakeholderNames={stakeholderNames}
        addressBook={addressBook}
        resources={resources}
        lang={lang}
        onSubmit={handleSubmit}
        onCancel={handleCancel}
        submitLabel={submitLabel}
        footerLeft={footerLeft}
      />

      {configOpen && (
        <BackendConfigModal
          lang={lang}
          title={t(lang, "storageOptionConfigure")}
          settings={settings}
          onChangeSettings={onChangeSettings}
          onClose={() => setConfigOpen(false)}
          noCurrentProject
        />
      )}
    </>
  );
}
