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
import { ToggleButton } from "./toggle-button";
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
  /** Whether the deleted-documents section is shown. */
  showDeleted: boolean;
  onShowDeletedChange: (next: boolean) => void;
  /** ★ Rendered as a language-neutral number beside the label. It is the ONLY
   *  signal the user gets that the derivation has handed the pane something
   *  implausible — a corrupted `documents` blob beside a valid versions blob
   *  makes EVERY version read as a deleted document, and a count of 200 next
   *  to an empty pane says that far better than the list itself does. A
   *  worded warning would be better and needs an i18n key this task was told
   *  not to add; see the report. */
  deletedCount: number;
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
  showDeleted,
  onShowDeletedChange,
  deletedCount,
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
      {/* ★★ `ToggleButton`, never a hand-rolled `aria-pressed` button: the
          primitive carries the trailing non-colour `data-pressed-marker` that
          keeps the pressed state distinguishable in the three DARK schemes,
          where the pressed-vs-unpressed border sits at 1.03–1.22:1. axe has no
          rule for colour-as-sole-cue on a control, so the primitive's own unit
          test is the only coverage that exists for it.
          ★★ The label is PINNED to what pressed=true ENABLES, so "Deleted
          documents, pressed" means they ARE shown. A label that flipped to the
          opposite action would announce the wrong mode (WCAG 4.1.2) and axe
          would pass it, because a name exists either way.
          ★ `variant="toggle"` (aria-pressed), not `"disclosure"`
          (aria-expanded). Both readings are defensible — this does reveal a
          region — but it is a persistent VIEW OPTION, the same shape as
          Gantt's show-dependencies / show-holidays / show-milestones toggles,
          and matching the closest in-repo precedent beats inventing a second
          convention for the same kind of control. Recorded rather than
          defaulted into.
          ★ It sits BEFORE the trailing group and after the pane actions: it is
          neither a primary action nor a member of Print · reset-columns ·
          reset-size, and a control drifting BETWEEN two of those is the drift
          the convention has been broken by more than once. */}
      <ToggleButton
        pressed={showDeleted}
        onToggle={() => onShowDeletedChange(!showDeleted)}
        lang={lang}
        title={t(lang, "documentsShowDeleted")}
      >
        {`${t(lang, "documentsShowDeleted")} (${deletedCount})`}
      </ToggleButton>
      <div className="ml-auto flex items-center gap-2">
        <PrintButton lang={lang} />
        <ResetColWidthsButton onClick={onResetColumns} lang={lang} />
        <ResetSizeButton onClick={onResetSize} lang={lang} />
      </div>
    </PaneToolbar>
  );
}
