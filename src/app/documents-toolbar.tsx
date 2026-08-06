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

export interface DocumentsToolbarProps {
  lang: Lang;
  /** Create a new empty document. */
  onNew: () => void;
  /** Download the selected document. */
  onDownload: () => void;
  /** False when nothing is selected — the button renders DISABLED, never absent. */
  canDownload: boolean;
  onResetColumns: () => void;
  onResetSize: () => void;
}

export function DocumentsToolbar({
  lang,
  onNew,
  onDownload,
  canDownload,
  onResetColumns,
  onResetSize,
}: DocumentsToolbarProps) {
  return (
    <PaneToolbar>
      <AddButton onClick={onNew}>{t(lang, "documentsNew")}</AddButton>
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
