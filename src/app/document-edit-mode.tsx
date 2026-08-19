"use client";

// src/app/document-edit-mode.tsx — the Documents pane's edit-mode glue.
//
// `documents-panel.tsx` sits within a line or two of the 800-line size-gate
// cap, so the toggle state, the narrow-pane measurement, the commit wiring and
// the preview/editor swap live here instead of inline in the panel.
// ★★★ DO NOT QUOTE THE NUMBER HERE — an earlier revision said "796 … four
//  lines of headroom" when the gate's own method (`readFileSync().split("\n")
//  .length`, check-file-sizes.mjs) reported 799, i.e. ONE. A stale number in
//  the optimistic direction spends headroom that does not exist, and the file
//  is NOT in docs/baselines/file-sizes.json, so 801 fails outright as a NEW
//  file over the limit. Measure it instead:
//    node -e "console.log(require('fs').readFileSync('src/app/documents-panel.tsx','utf8').split('\n').length)"
// A `.tsx` file is dropped
// WHOLESALE by `vitest.config.ts` `coverage.exclude` (the same class as every
// other React UI component), so — unlike a new `.ts` hook — this needs no new
// exclude entry (`use-document-editor.ts` already carries one, for contrast).
import { useCallback, useState } from "react";
import type { Lang } from "./i18n";
import type { DocBlock, ProjectDocument } from "./document-model";
import type { Workspace } from "./workspace";
import { DocumentEditor, NARROW_PANE_QUERY } from "./document-editor";
import { DocumentPreview } from "./document-preview";
import { useDocumentEditor, type UseDocumentEditorDeps } from "./use-document-editor";
import { useMediaQuery } from "./use-media-query";

export type UseDocumentEditModeDeps = Omit<UseDocumentEditorDeps, "now">;

/** Bundles the pane's toggle state, the narrow-pane match and the commit
 *  wiring into one call, so the panel needs a single hook call rather than
 *  three separate ones. */
export function useDocumentEditMode(deps: UseDocumentEditModeDeps) {
  const [editing, setEditing] = useState(false);
  const toggleEditing = useCallback(() => setEditing((v) => !v), []);
  // ★ The swap hinges on a media query, never a measured width: jsdom has no
  //  layout, so a width-driven branch would be untestable. `DocumentEditor`
  //  takes the RESULT as a prop, which is what makes ITS OWN test injectable.
  const narrowPane = useMediaQuery(NARROW_PANE_QUERY);
  const { commitBlock } = useDocumentEditor(deps);
  return { editing, toggleEditing, narrowPane, commitBlock };
}

export interface DocumentEditModeBodyProps {
  lang: Lang;
  doc: ProjectDocument | null;
  ws: Workspace;
  editing: boolean;
  narrow: boolean;
  isReadOnly?: boolean;
  onCommitBlock: (index: number, block: DocBlock) => void;
}

/** Preview by default; the block editor once toggled on. Popout mirrors stay
 *  read-only, and a null selection (no documents yet) always renders the
 *  (empty) preview — `DocumentEditor` requires a real document. */
export function DocumentEditModeBody({
  lang,
  doc,
  ws,
  editing,
  narrow,
  isReadOnly,
  onCommitBlock,
}: DocumentEditModeBodyProps) {
  if (editing && !isReadOnly && doc) {
    return <DocumentEditor lang={lang} doc={doc} onCommitBlock={onCommitBlock} narrow={narrow} />;
  }
  return <DocumentPreview lang={lang} doc={doc} ws={ws} />;
}
