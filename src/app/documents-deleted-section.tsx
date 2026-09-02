"use client";

// The deleted-documents list, extracted from documents-panel.tsx to buy back
// file-size headroom (open-followups §220 — that file sat at EXACTLY the
// 800-line cap with no baseline entry, so any net line failed the gate).
//
// PURE PRESENTATIONAL: data and handlers in as props, no state of its own.
//
// ★★ The `restoreRejected` notice deliberately did NOT come with it. It lives
// OUTSIDE the `showDeleted` block in the orchestrator because the history modal
// is an independent restore surface whose refusals must render with the toggle
// off. `documents-panel.test.tsx` mutation-proves that placement.
import { type Lang, t } from "./i18n";
import type { DocVersion } from "./document-versions";
import { Button } from "./button";

export interface DocumentsDeletedSectionProps {
  lang: Lang;
  /** Tombstone versions of deleted documents, newest first. */
  deleted: readonly DocVersion[];
  /** Count of ORPHANED non-tombstone versions (`orphanedDocumentVersions` in
   *  document-versions.ts) — drives the implausibility caution only, and is
   *  independent of `deleted.length`: a document can be genuinely deleted
   *  (and appear in `deleted`) without ever being orphaned, and vice versa. */
  orphanedCount: number;
  isReadOnly?: boolean;
  onRestore: (versionId: number) => void;
}

export function DocumentsDeletedSection({
  lang, deleted, orphanedCount, isReadOnly, onRestore,
}: DocumentsDeletedSectionProps) {
  return (
    <section aria-label={t(lang, "documentsShowDeleted")} className="rounded-md border border-line p-3">
      {/* ★★★ THE IMPLAUSIBILITY GUARD, pointed at ORPHANS, not at a
          deleted-vs-live count comparison. `documents` and
          `documentVersions` are parsed with INDEPENDENT try/catch on every
          backend, so a `documents` blob that fails to parse beside a valid
          versions blob — or a truncation artifact, or a partial import —
          leaves a document id absent from `documents` whose newest version
          is an ORDINARY edit (update/rename/duplicate), never a delete.
          `orphanedCount` (`orphanedDocumentVersions`, document-versions.ts)
          counts exactly that, and excludes restore markers too (see that
          function's docstring for why).
          ★★ IT USED TO BE `deleted.length > documentCount` — comparing the
          tombstone count to the LIVE document count. That fired on deleting
          your ONLY document (0 live, 1 tombstone: 1 > 0), the single most
          ordinary shape a delete can take, while `deletedDocumentVersions`'s
          own `op === "delete"` narrowing had already made the load-failure
          shape it was meant to catch impossible to produce through this
          list. It kept its false positives and had lost its true ones.
          ★ It CAUTIONS, it does not hide or disable anything, because a
          user who really did delete most of their documents must still be
          able to restore them.
          ★ Not a row cap: capping the list without saying why is the
          false-affordance trap this pane avoids elsewhere. */}
      {orphanedCount > 0 && (
        <p role="status" className="mb-2 text-sm text-ui-pink-strong">
          {t(lang, "documentsDeletedImplausible")}
        </p>
      )}
      {deleted.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t(lang, "documentsNoVersions")}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {deleted.map((v) => (
            <li key={v.id} className="flex items-center justify-between gap-3 text-sm">
              <span className="min-w-0 text-foreground">
                <span className="font-medium">{v.title}</span>
                {" · "}
                <span className="tabular-nums text-muted-foreground">
                  {v.savedAt.slice(0, 16).replace("T", " ")}
                </span>
              </span>
              {/* ★★ ROW-UNIQUE accessible name. Title alone is not
                  enough — nothing uniquifies titles outside this pane's
                  own create/duplicate handlers, so two tombstones can
                  share one; the version id is unique by construction and
                  is language-neutral. Same reasoning as the history
                  modal's Restore labels. */}
              <Button
                variant="secondary"
                size="xs"
                onClick={() => onRestore(v.id)}
                disabled={isReadOnly}
                aria-label={`${t(lang, "documentsRestore")} – ${v.title} · #${v.id}`}
              >
                {t(lang, "documentsRestore")}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
