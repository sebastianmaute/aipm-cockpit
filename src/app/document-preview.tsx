"use client";

// src/app/document-preview.tsx — read-only render of the selected document.
//
// ★★ PREVIEW MODE RENDERS NO TITLE. `renderDocumentHtml(..., "preview")` returns
// a FRAGMENT by design — the standalone mode used for print carries the title,
// the fragment does not. So this chrome renders `doc.title` itself; without it
// the pane shows an untitled body and reads as broken. That is the
// fragment/standalone split working as intended, not a renderer bug to patch.
//
// ★★ NO SECOND SANITIZE PASS HERE. The renderer sanitizes at every unescaped
// sink it has, and there are TWO — `renderBlock`'s `paragraph` case runs
// sanitizeDocumentHtml (doc-render-html.ts), and `tableHtml` reaches
// `exportCellHtml`, whose rich branch runs sanitizeRichHtml (download.ts).
// Adding another pass here would imply those are optional; removing either
// would be a stored-XSS hole in THIS pane, which renders the result with
// dangerouslySetInnerHTML. Leave all of it alone.
// ★★ An earlier revision of this note named ONE sink and quoted the renderer's
// own "the ONE unescaped path" comment as its warrant. That comment was stale:
// the rich table cell is a second sink, guarded by a different sanitizer in a
// different file. The safety argument here now rests on both, and both are
// named, because a warrant that under-counts its sinks is how a new one gets
// added with nobody checking it.
// ★ It was the since-retired sanitizeTemplateHtml until S3a gave documents their
// own, wider allow-list; naming the old one as if it were current would send a
// reader to a list that no longer exists, let alone governs this pane.
// ★★★ CITE THE SYMBOL, NOT A LINE RANGE. This said "doc-render-html.ts:84-86,
// verified — not taken on trust", and 84-86 is `tableHtml`'s ESCAPING, a
// different guard on a different path. A reader following it lands on table
// escaping, finds no sanitize call for paragraphs, and can only conclude the
// paragraph path is unguarded — worse than an uncited claim, because the note
// advertises itself as checked. Line numbers rot on the next edit above them.

import { useEffect, useMemo, useRef } from "react";
import { type Lang } from "./i18n";
import type { ProjectDocument } from "./document-model";
import type { Workspace } from "./workspace";
import type { TursoConfig } from "./turso-config";
import { renderDocumentHtml } from "./doc-render-html";
import { attachAssetImages } from "./document-asset-images";
import { loadAssetData } from "./document-assets-store";

export interface DocumentPreviewProps {
  lang: Lang;
  /** Null only when the workspace holds no documents at all — the list shows
   *  its own empty state in that case, so this renders nothing rather than
   *  competing with it. */
  doc: ProjectDocument | null;
  ws: Workspace;
  // Same asset-library gate `documents-panel.tsx` threads to
  // `DocumentsAssetSection` (null disables). Resolves `<img data-asset-id>`
  // references left in the rendered HTML to real bytes — see the effect
  // below. Optional: missing here correctly means "no images resolve" (every
  // referenced image renders its missing-asset marker), not broken, since
  // document images are Turso-gated (S3c-1).
  tursoConfig?: TursoConfig | null;
  projectId?: string;
}

export function DocumentPreview({
  lang, doc, ws, tursoConfig = null, projectId = "default",
}: DocumentPreviewProps) {
  // ★★ MEMOIZED, and the cost it avoids is not theoretical. `renderDocumentHtml`
  // runs DOMPurify once PER PARAGRAPH block and `resolveDataSection` once per
  // dataSection block — and that one projects the WHOLE workspace through
  // buildExportSections. Called inline, it re-ran on every parent render, so
  // each keystroke in the rename modal (which re-renders the panel) re-projected
  // the entire workspace to produce byte-identical HTML.
  // ★★★ IT MUST SIT ABOVE THE `!doc` EARLY RETURN. A hook after a conditional
  // return is a rules-of-hooks violation and `npm run lint` is `--max-warnings=0`
  // in CI, so the guard moves INTO the memo body rather than the hook moving
  // below the guard.
  const html = useMemo(
    () => (doc ? renderDocumentHtml(doc, ws, lang, "preview") : ""),
    [doc, ws, lang],
  );

  // `ws.documentAssets` is an obj-member dep — react-hooks/exhaustive-deps
  // rejects that shape directly in a dependency array, so it is hoisted to a
  // local first (AGENTS.md's `snapshots.rebaselineNow` note carries the same
  // rule).
  const documentAssets = ws.documentAssets;

  const bodyRef = useRef<HTMLDivElement | null>(null);

  // ★★★ IMPERATIVE, NOT REACT STATE — see document-asset-images.ts's own doc
  // comment for why: the body below is one dangerouslySetInnerHTML string, so
  // there is no React element to hand a `src`, and this needs no state at all
  // (react-hooks/set-state-in-effect is banned and fatal regardless).
  // ★★ MUST SIT ABOVE THE `!doc` EARLY RETURN, same reason as the memo above.
  // A null `doc` means no preview body mounts this render, so `bodyRef.current`
  // is null and the effect below is a no-op — it still has to be CALLED,
  // unconditionally, every render.
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    let cancelled = false;
    let detach: (() => void) | null = null;
    const mimeFor = (id: string) => documentAssets?.find((a) => a.id === id)?.mime;
    attachAssetImages(el, (id) => loadAssetData(tursoConfig, id, projectId), mimeFor).then((d) => {
      // The subtree may have been replaced (a new `html` landed) or this
      // component may have unmounted before the byte loads resolved — either
      // way, revoke rather than leave the blob URLs it minted dangling.
      if (cancelled) { d(); return; }
      detach = d;
    });
    return () => {
      cancelled = true;
      detach?.();
    };
  }, [html, documentAssets, tursoConfig, projectId]);

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
        ref={bodyRef}
        data-document-preview-body
        className="text-sm text-foreground"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </section>
  );
}
