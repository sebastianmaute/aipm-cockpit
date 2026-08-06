"use client";

// src/app/document-preview.tsx — read-only render of the selected document.
//
// ★★ PREVIEW MODE RENDERS NO TITLE. `renderDocumentHtml(..., "preview")` returns
// a FRAGMENT by design — the standalone mode used for print carries the title,
// the fragment does not. So this chrome renders `doc.title` itself; without it
// the pane shows an untitled body and reads as broken. That is the
// fragment/standalone split working as intended, not a renderer bug to patch.
//
// ★★ NO SECOND SANITIZE PASS HERE. The renderer's paragraph sink already runs
// sanitizeTemplateHtml on the one unescaped path (doc-render-html.ts:84-86,
// verified — not taken on trust). Adding another pass here would imply the sink
// is optional; removing the sink's would be a stored-XSS hole. Leave both alone.

import { type Lang } from "./i18n";
import type { ProjectDocument } from "./document-model";
import type { Workspace } from "./workspace";
import { renderDocumentHtml } from "./doc-render-html";

export interface DocumentPreviewProps {
  lang: Lang;
  /** Null only when the workspace holds no documents at all — the list shows
   *  its own empty state in that case, so this renders nothing rather than
   *  competing with it. */
  doc: ProjectDocument | null;
  ws: Workspace;
}

export function DocumentPreview({ lang, doc, ws }: DocumentPreviewProps) {
  if (!doc) return null;

  const titleId = `document-preview-title-${doc.id}`;

  return (
    // ★★ tabIndex={0} IS AN ACCESSIBILITY FIX, NOT A STYLE CHOICE. This element
    // scrolls (`overflow-auto`) and its content is rendered document HTML, which
    // contains nothing focusable — so a keyboard-only user could not scroll it at
    // all. axe's scrollable-region-focusable flagged it `serious` on all five
    // scheme combos the moment the e2e seed started delivering real documents;
    // before that the pane had nothing to scroll and the gate saw nothing.
    // ★★ The name rides `aria-labelledby` on the heading THIS PANE ALREADY
    // RENDERS, so a focusable region is announced as the document it shows
    // ("Steering update") rather than a generic "Document preview" — and it needs
    // NO new i18n key, which also keeps it correct in DE for free. A named
    // <section> is implicitly `role="region"`, so an explicit role would be
    // redundant. Do not swap this for an aria-label literal: that is both a
    // hardcoded English string and a less specific name.
    <section
      tabIndex={0}
      aria-labelledby={titleId}
      className="overflow-auto rounded-md border border-line bg-surface p-4"
    >
      <h2 id={titleId} className="mb-3 text-base font-semibold text-foreground">
        {doc.title}
      </h2>
      <div
        data-document-preview-body
        className="text-sm text-foreground"
        dangerouslySetInnerHTML={{ __html: renderDocumentHtml(doc, ws, lang, "preview") }}
      />
    </section>
  );
}
