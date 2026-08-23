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
  /** Count of LIVE documents — drives the implausibility heuristic only. */
  documentCount: number;
  isReadOnly?: boolean;
  onRestore: (versionId: number) => void;
}

export function DocumentsDeletedSection({
  lang, deleted, documentCount, isReadOnly, onRestore,
}: DocumentsDeletedSectionProps) {
  return (
    <section aria-label={t(lang, "documentsShowDeleted")} className="rounded-md border border-line p-3">
      {/* ★★★ THE IMPLAUSIBILITY GUARD. `documents` and `documentVersions`
          are parsed with INDEPENDENT try/catch on every backend, so a
          corrupted `documents` blob beside a valid versions blob makes
          EVERY version read as a deleted document — the pane then shows
          "all N of your documents are deleted", which is a load failure
          wearing the costume of an ordinary list. Truncation artifacts
          (a file of `MAX_DOCUMENTS + 5` documents capped to
          `MAX_DOCUMENTS` while ALL its versions survive) produce a milder
          version of the same thing.
          ★★ `deleted.length > documents.length` is the test because it is
          the shape a genuine workflow does not have: deleting more
          documents than you currently hold is normal over a long
          project, but not while the surviving set is SMALLER than the
          deleted one in the same load. It is a heuristic and deliberately
          a soft one — it CAUTIONS, it does not hide or disable anything,
          because a user who really did delete most of their documents
          must still be able to restore them.
          ★ Not a row cap: capping the list without saying why is the
          false-affordance trap this pane avoids elsewhere. */}
      {deleted.length > documentCount && (
        <p role="status" className="mb-2 text-sm text-ui-pink">
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
