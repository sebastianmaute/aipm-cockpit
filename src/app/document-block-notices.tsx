"use client";

// The block editors' two inline notices, split out of document-block-editors.tsx
// to keep that file under the 800-line ratchet. Presentational leaves: no state,
// no draft logic, no knowledge of why they are being rendered.

import { sanitizeDocumentHtml } from "./sanitize-html";
import { t, type Lang } from "./i18n";

/**
 * Read-only notice for a block this editor cannot safely edit in place (used
 * today by the paragraph editor's image guard; any future per-kind editor
 * with its own read-only case can reuse it).
 *
 * ★★★ CRITICAL — re-sanitizes `html` AT THE SINK with `sanitizeDocumentHtml`
 *  (DOCUMENT_ALLOWED_TAGS = RICH_ALLOWED_TAGS + img) before the
 *  `dangerouslySetInnerHTML`. NEVER `sanitizeRichHtml` here — it drops `<img>`
 *  outright, which would blank the very image this component exists to keep
 *  visible. Mirrors the repo's documented defense-in-depth pattern
 *  (`rich-text-view.tsx`, `document-preview.tsx`'s header comment): every
 *  render path that reaches an unescaped sink re-sanitizes there even if an
 *  earlier layer (load path, a future data-driven html source) regresses.
 */
export function BlockReadOnlyNotice({ html, reason }: { html: string; reason: string }) {
  return (
    <div className="rounded-md border border-line bg-surface-muted p-3">
      <div
        className="prose-sm max-w-none text-foreground"
        dangerouslySetInnerHTML={{ __html: sanitizeDocumentHtml(html) }}
      />
      <p className="mt-2 text-xs text-muted-foreground">{reason}</p>
    </div>
  );
}

/** Shown when a commit was refused because the block would not survive a load
 *  (`normalizeBlockForStorage` returned null). ★ Never silent: a refusal with no
 *  reason reads exactly like a broken editor — the same principle as the image
 *  guard. */
export function BlockDroppedNotice({ lang }: { lang: Lang }) {
  return <p className="text-xs text-ui-pink">{t(lang, "documentsBlockEmptyNotSaved")}</p>;
}
