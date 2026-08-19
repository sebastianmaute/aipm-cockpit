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

/** Why `useBlockDraft` refused the last commit. `null` = it did not.
 *
 * ★★ TWO REASONS, ONE STATE. They are mutually exclusive by construction —
 *  `tryCommit` returns on the first one that fires — so a single nullable field
 *  cannot report a contradiction the way two independent booleans could. */
export type BlockRefusal = "empty" | "conflict";

/**
 * Shown when a commit was REFUSED, with the reason.
 *
 * ★★★ NEVER SILENT, and `"conflict"` is why this component stopped being
 *  `BlockDroppedNotice`. The empty-content refusal always had a notice; the
 *  concurrent-write ABANDON did not, so a user whose block was rewritten by an
 *  AI edit, a restore or a second window watched their typing get replaced on
 *  screen (the render-time reconcile adopts the external write once the draft
 *  goes undirty) with no statement that anything had happened — which reads as
 *  the editor eating input. Same principle as the image guard: a refusal with
 *  no reason is indistinguishable from a broken control.
 *
 * ★ It cannot be rendered on the UNMOUNT flush path, which abandons for the
 *  same reason — the component is going away and there is nothing left to
 *  render into. Refusing to write is the whole fix there; do not fake a notice.
 *
 * ★★★ `role="status"` IS LOAD-BEARING, and its absence made the docstring above
 *  false for exactly the users it was written for. This element mounts AFTER a
 *  blur has already moved focus elsewhere, so a screen-reader user gets no
 *  announcement from the mount alone: the "silent refusal" this component
 *  exists to prevent stayed silent for them, in both states. `status` carries
 *  an implicit `aria-live="polite"`, so the reason is announced without
 *  interrupting whatever the user is now typing.
 *  ★★ NOT `role="alert"` (assertive): it would cut across the user's next
 *   keystrokes to report a refusal they can act on at their leisure. Nothing
 *   here is time-critical — the draft text is still on screen and still theirs.
 *  ★★ NO axe RULE COVERS THIS, at any seed size: a missing live region is not
 *   a violation, it is an absence. `document-block-editors.test.tsx` pins the
 *   role in both states, and that unit test is the only detector there will be.
 *   The identical problem is solved the identical way one file over, in
 *   `documents-panel.tsx`'s rejection banner.
 */
export function BlockRefusalNotice({ lang, refusal }: { lang: Lang; refusal: BlockRefusal }) {
  const key = refusal === "empty" ? "documentsBlockEmptyNotSaved" : "documentsBlockConflictNotSaved";
  return (
    <p role="status" className="text-xs text-ui-pink">
      {t(lang, key)}
    </p>
  );
}
