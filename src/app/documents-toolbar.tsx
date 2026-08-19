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

/** The pane's edit-mode controls, threaded as ONE object rather than three
 *  flat props (AGENTS.md's extraction convention — the same reason a
 *  calendar-capable entity threads one `EntityCalendarProps`). Built by
 *  `useDocumentEditMode`, so the panel does not have to keep three names in
 *  step. */
export interface DocumentsEditToolbarProps {
  /** Whether the block editor is showing (vs the read-only preview). ★ The
   *  label is PINNED to "Edit blocks" in both states — it does NOT flip to
   *  "Preview" — so `aria-pressed` tracks what the label names, mirroring the
   *  deleted-documents toggle. A flipped label would announce the WRONG mode
   *  as active (WCAG 4.1.2), which axe cannot catch (see AGENTS.md). */
  editing: boolean;
  onToggleEditing: () => void;
  /** False when nothing is selected. ★★ `DocumentEditModeBody` needs a
   *  non-null `doc` as well as `!isReadOnly`, so a toggle gated on isReadOnly
   *  ALONE pressed, reported aria-pressed="true", and did nothing — a lie the
   *  a11y gate passes because a name exists. Mirrors `canDownload`. */
  canEdit: boolean;
}

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
  editToolbar: DocumentsEditToolbarProps;
  /** Popout mirrors are read-only: the CREATE affordance goes inert. Download,
   *  print and the view controls stay live — they mutate nothing. */
  isReadOnly?: boolean;
}

// ★ Module-scope constants, not `useId`: this toolbar is rendered once per
//  pane and the ids are referenced from two places in the same subtree.
const EDIT_DISABLED_HINT_ID = "documents-edit-blocks-disabled-hint";
const NEW_DISABLED_HINT_ID = "documents-new-disabled-hint";

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
  editToolbar,
  isReadOnly,
}: DocumentsToolbarProps) {
  // ★ TWO reasons, different text. Read-only wins: in a popout mirror nothing
  //  is editable regardless of selection, so naming the selection would send
  //  the user to pick a row that changes nothing.
  const editDisabledReason = isReadOnly
    ? t(lang, "documentsReadOnlyMirror")
    : editToolbar.canEdit
      ? undefined
      : t(lang, "documentsEditBlocksNoDocument");
  return (
    <PaneToolbar>
      <AddButton
        onClick={onNew}
        disabled={isReadOnly}
        aria-describedby={isReadOnly ? NEW_DISABLED_HINT_ID : undefined}
      >
        {t(lang, "documentsNew")}
      </AddButton>
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
      {/* ★ Same reasoning as the deleted-documents toggle just above: the
          label is pinned to what pressed=true ENABLES ("Edit blocks" showing
          the block editor), never flipped to "Preview" — a flip would
          announce the wrong mode as active (WCAG 4.1.2), which axe cannot
          catch. Disabled whenever `editDisabledReason` is set — either a
          read-only popout mirror or no document selected, matching New
          document — a toggle that presses and does nothing is a false
          affordance (WCAG 4.1.2). */}
      <ToggleButton
        pressed={editToolbar.editing}
        onToggle={editToolbar.onToggleEditing}
        lang={lang}
        title={t(lang, "documentsEditBlocks")}
        disabled={editDisabledReason !== undefined}
        ariaDescribedBy={editDisabledReason !== undefined ? EDIT_DISABLED_HINT_ID : undefined}
      >
        {t(lang, "documentsEditBlocks")}
      </ToggleButton>
      {/* ★★ The description node for BOTH inert controls. `ToggleButton`
          suppresses its on/off tooltip suffix while disabled and a disabled
          control leaves the tab order, so without this the toggle announces a
          bare name and nothing about why it cannot be used. Rendered
          unconditionally so the id an `aria-describedby` points at always
          resolves — a dangling idref announces nothing and axe does not flag
          it. `sr-only`, because the reason is redundant beside a control a
          sighted user can see is greyed out. */}
      <span id={EDIT_DISABLED_HINT_ID} className="sr-only">
        {editDisabledReason ?? ""}
      </span>
      <span id={NEW_DISABLED_HINT_ID} className="sr-only">
        {isReadOnly ? t(lang, "documentsReadOnlyMirror") : ""}
      </span>
      <div className="ml-auto flex items-center gap-2">
        <PrintButton lang={lang} />
        <ResetColWidthsButton onClick={onResetColumns} lang={lang} />
        <ResetSizeButton onClick={onResetSize} lang={lang} />
      </div>
    </PaneToolbar>
  );
}
