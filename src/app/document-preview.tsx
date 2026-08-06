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

  return (
    <section className="overflow-auto rounded-md border border-line bg-surface p-4">
      <h2 className="mb-3 text-base font-semibold text-foreground">{doc.title}</h2>
      <div
        data-document-preview-body
        className="text-sm text-foreground"
        dangerouslySetInnerHTML={{ __html: renderDocumentHtml(doc, ws, lang, "preview") }}
      />
    </section>
  );
}
