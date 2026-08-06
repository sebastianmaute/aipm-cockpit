"use client";

// src/app/documents-toolbar.tsx — presentational toolbar for the Documents pane.
//
// Pure: every value and handler arrives as a prop, no context reads (the gantt
// split pattern). Control ORDER is load-bearing and pinned by
// documents-toolbar.test.tsx:
//
//   New document (PRIMARY, leads)  →  Download  →  [ Print · reset-columns · reset-size ]
//
// The trailing group must stay CONTIGUOUS — a control drifting between two of
// its members is the drift the convention has been broken by more than once
// (Outlook once sat between the two resets in Resources; Open Points had the
// two resets in the wrong relative order). Download is a pane action, not a
// member of the group, so it goes BEFORE it.

import { type Lang, t } from "./i18n";
import { PrintButton, ResetColWidthsButton, ResetSizeButton } from "./task-manager-ui";
import { PaneToolbar, AddButton } from "./pane-toolbar";
import { Button } from "./button";
import { Select } from "./form-controls";
import type { DocFormat } from "./document-download";

/** Every format `downloadDocument` supports. The user's original ask was
 *  ".pptx, .docx, .pdf, or html" — all four, so all four are reachable here.
 *  ★ The labels are FILE EXTENSIONS, not prose: they are identical in every
 *  language and deliberately carry no i18n key. Only the control's accessible
 *  name is translated. */
export const DOC_FORMATS: readonly { value: DocFormat; label: string }[] = [
  { value: "docx", label: "DOCX" },
  { value: "pptx", label: "PPTX" },
  { value: "pdf", label: "PDF" },
  { value: "html", label: "HTML" },
];

export interface DocumentsToolbarProps {
  lang: Lang;
  /** Create a new empty document. */
  onNew: () => void;
  /** Download the selected document. */
  onDownload: () => void;
  /** False when nothing is selected — the button renders DISABLED, never absent. */
  canDownload: boolean;
  format: DocFormat;
  onFormatChange: (format: DocFormat) => void;
  onResetColumns: () => void;
  onResetSize: () => void;
  /** Popout mirrors are read-only: the CREATE affordance goes inert. Download,
   *  print and the view controls stay live — they mutate nothing. */
  isReadOnly?: boolean;
}

export function DocumentsToolbar({
  lang,
  onNew,
  onDownload,
  canDownload,
  format,
  onFormatChange,
  onResetColumns,
  onResetSize,
  isReadOnly,
}: DocumentsToolbarProps) {
  return (
    <PaneToolbar>
      <AddButton onClick={onNew} disabled={isReadOnly}>{t(lang, "documentsNew")}</AddButton>
      {/* ★ Its OWN accessible name, not "Download": two adjacent controls both
          named "Download" is a WCAG 2.4.6 failure that axe will NOT flag,
          because they are different roles and each has *a* name. And a visible
          <span> beside a bare <select> is not a label — an unlabelled form
          control is an axe-CRITICAL failure, and this view is in the gate. */}
      <Select
        size="xs"
        aria-label={t(lang, "documentsFormat")}
        value={format}
        onChange={(e) => onFormatChange(e.target.value as DocFormat)}
      >
        {DOC_FORMATS.map((f) => (
          <option key={f.value} value={f.value}>{f.label}</option>
        ))}
      </Select>
      {/* ★ Rendered in BOTH states and merely `disabled` when nothing is
          selected, so the toolbar keeps ONE stable set of controls. Removing it
          conditionally would shift every trailing control sideways the moment a
          row is selected — the same reasoning as ToggleButton's always-present
          pressed marker. A real `disabled` attribute, not `aria-disabled`: the
          lookalike still fires onClick. */}
      <Button
        variant="secondary"
        size="xs"
        onClick={onDownload}
        disabled={!canDownload}
      >
        {t(lang, "documentsDownload")}
      </Button>
      <div className="ml-auto flex items-center gap-2">
        <PrintButton lang={lang} />
        <ResetColWidthsButton onClick={onResetColumns} lang={lang} />
        <ResetSizeButton onClick={onResetSize} lang={lang} />
      </div>
    </PaneToolbar>
  );
}
