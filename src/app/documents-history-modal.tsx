"use client";

// src/app/documents-history-modal.tsx — the per-document version list.
//
// PURE presentational, like `documents-list.tsx`: versions arrive already
// sorted and every handler is a prop. It owns no state and reads no context.
//
// ★★★ EVERY Restore BUTTON CARRIES A VERSION-UNIQUE ACCESSIBLE NAME, and this
// component is the ONLY thing that will ever check it. N identical "Restore"
// labels is a WCAG 2.4.6 failure, and the axe gate cannot reach it here even in
// principle: Documents is in `A11Y_VIEWS`, but the gate scans a statically
// seeded app and never opens this modal, so the collision does not exist at
// scan time. Do not read a green axe run as covering anything below.

import { Modal } from "./modal";
import { ModalHeader } from "./modal-header";
import { Button } from "./button";
import { type Lang, t } from "./i18n";
import type { ProjectDocument } from "./document-model";
import type { DocVersion } from "./document-versions";

const HISTORY_TITLE_ID = "documents-history-title";

/** ISO prefix, trimmed to the minute — locale-free and deterministic, the same
 *  reason `documents-list.tsx` renders `updatedAt.slice(0, 10)` raw. A version
 *  list needs the TIME as well as the day (several versions land per day), so
 *  this keeps 16 characters rather than 10. `toLocaleString` was the sketch's
 *  choice and is deliberately not used: it varies with the host ICU build, so
 *  it cannot be asserted stably and would read differently in the DE build for
 *  no gain the user asked for. */
function stamp(savedAt: string): string {
  return savedAt.slice(0, 16).replace("T", " ");
}

export interface DocumentsHistoryModalProps {
  open: boolean;
  /** ★ Named `doc`, not `document`, matching its sibling `DocumentPreview`.
   *  A prop called `document` shadows the global `document` for the whole
   *  component body, so any later DOM access inside it would silently resolve
   *  to a ProjectDocument. */
  doc: ProjectDocument | null;
  /** Already sorted newest-first by the orchestrator — same contract as
   *  `DocumentsList.documents`. This component does not reorder. */
  versions: readonly DocVersion[];
  onClose: () => void;
  onRestore: (versionId: number) => void;
  lang: Lang;
  /** ★★ Popout mirrors are read-only, and READING history is safe there — only
   *  Restore mutates. So the modal still opens and still lists everything; the
   *  Restore buttons go inert. Leaving them live would hand a popout a write
   *  path around the guard every other control in this pane honours, and it
   *  would be the most destructive one available (a restore replaces the whole
   *  document). Kept as a real `disabled` attribute rather than an
   *  `aria-disabled` lookalike: the lookalike still fires `onClick`. */
  isReadOnly?: boolean;
}

export function DocumentsHistoryModal({
  open,
  doc,
  versions,
  onClose,
  onRestore,
  lang,
  isReadOnly,
}: DocumentsHistoryModalProps) {
  if (!open || !doc) return null;

  return (
    // `Modal` owns dismissal: it registers with the shared `dismissal-stack`
    // and carries a real Tab trap, so Escape/backdrop/focus-restore all come
    // for free. There is no `kind` to pick here — the primitive exposes none —
    // and hand-rolling any of it is what `docs/AGENTS/ui-shell.md` forbids.
    // `ariaLabelledby` over `ariaLabel` so the dialog's accessible name IS the
    // heading a sighted user reads, and the two cannot drift.
    <Modal open onClose={onClose} ariaLabelledby={HISTORY_TITLE_ID} align="center">
      <div
        data-modal-panel
        className="relative flex w-[560px] max-w-[95vw] flex-col overflow-hidden rounded-xl border border-line bg-surface"
      >
        <ModalHeader
          lang={lang}
          title={t(lang, "documentsHistoryFor", doc.title)}
          titleId={HISTORY_TITLE_ID}
          onClose={onClose}
        />
        <div className="flex max-h-[60vh] flex-col gap-3 overflow-auto p-6">
          {versions.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t(lang, "documentsNoVersions")}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {versions.map((v) => (
                <li
                  key={v.id}
                  className="flex items-center justify-between gap-3 rounded-md border border-line px-3 py-2"
                >
                  <span className="min-w-0 text-sm text-foreground">
                    <span className="font-medium">{v.title}</span>
                    {" · "}
                    <span className="tabular-nums text-muted-foreground">{stamp(v.savedAt)}</span>
                    {" · "}
                    <span className="text-muted-foreground">
                      {t(lang, v.source === "ai" ? "documentsVersionSourceAi" : "documentsVersionSourceUser")}
                    </span>
                  </span>
                  <Button
                    variant="secondary"
                    size="xs"
                    onClick={() => onRestore(v.id)}
                    disabled={isReadOnly}
                    // ★★★ UNIQUE BY CONSTRUCTION, which title+timestamp alone
                    // is NOT. Two mutations landing in the same tick produce two
                    // versions with an IDENTICAL `savedAt` — `mutateDocuments`
                    // stamps one `new Date()` per call and React has not
                    // re-rendered between them (pinned by workspace-context's
                    // same-tick test) — and two successive `ops` writes leave
                    // the title unchanged too, so both collide. The version id
                    // is the only field that cannot. It is language-neutral, so
                    // it needs no i18n key of its own.
                    aria-label={`${t(lang, "documentsRestore")} – ${v.title} · ${stamp(v.savedAt)} · #${v.id}`}
                  >
                    {t(lang, "documentsRestore")}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </Modal>
  );
}
