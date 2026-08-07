"use client";

// src/app/documents-history-modal.tsx — the per-document version list.
//
// PURE presentational, like `documents-list.tsx`: versions arrive already
// sorted and every handler is a prop. It reads NO context — the one piece of
// state it owns is each row's Preview disclosure, which is local UI and has no
// meaning outside the open modal.
//
// ★★ IT DELIBERATELY DOES NOT `useWorkspace()` FOR THE PREVIEW. The renderer
// needs a Workspace to resolve `dataSection` blocks, and reaching for the
// context here would make the component untestable in isolation (its whole
// suite renders it with no provider) and would couple a read-only history list
// to the live workspace value. It takes `ws` as an OPTIONAL prop instead — see
// the prop's own note for what is still owed.
//
// ★★★ EVERY Restore BUTTON CARRIES A VERSION-UNIQUE ACCESSIBLE NAME, and this
// component is the ONLY thing that will ever check it. N identical "Restore"
// labels is a WCAG 2.4.6 failure, and the axe gate cannot reach it here even in
// principle: Documents is in `A11Y_VIEWS`, but the gate scans a statically
// seeded app and never opens this modal, so the collision does not exist at
// scan time. Do not read a green axe run as covering anything below.

import { useMemo, useState } from "react";
import { Modal } from "./modal";
import { ModalHeader } from "./modal-header";
import { Button } from "./button";
import { FOCUS_RING, TRANSITION } from "./interaction-styles";
import { type Lang, t, type TranslationKey } from "./i18n";
import type { ProjectDocument } from "./document-model";
import { RESTORED_MARKER_OP, type DocVersion, type DocVersionOp } from "./document-versions";
import { renderDocumentHtml } from "./doc-render-html";
import { emptyWorkspace, type Workspace } from "./workspace";

const HISTORY_TITLE_ID = "documents-history-title";

/** Op -> i18n label, mirroring `ACTION_SOURCE_LABEL`'s shape for the same
 *  reason: an EXHAUSTIVE `Record<DocVersionOp, TranslationKey>` makes a sixth
 *  op a COMPILE error here. A switch with a default, or a key built by
 *  template (`` `documentsVersionOp${cap(op)}` ``), would both compile and then
 *  render a raw enum value — or an empty string — in the user's face.
 *
 *  ★ `restored` is included for exhaustiveness ONLY. A restored marker is
 *  filtered out of `restorable` below, so this arm cannot be reached from this
 *  component today; leaving it out would still be a type error, and adding it
 *  costs nothing. There is deliberately NO test asserting it renders. */
const VERSION_OP_LABEL: Record<DocVersionOp, TranslationKey> = {
  update: "documentsVersionOpUpdate",
  rename: "documentsVersionOpRename",
  delete: "documentsVersionOpDelete",
  duplicate: "documentsVersionOpDuplicate",
  restored: "documentsVersionOpRestored",
};

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
   *  `DocumentsList.documents`. This component does not reorder. It DOES drop
   *  restored markers; see RESTORED_MARKER_OP below. */
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
  /** Live workspace, used ONLY to resolve a version's `dataSection` blocks in
   *  the Preview — exactly what `DocumentPreview` uses its own `ws` for.
   *
   *  ★★ OPTIONAL, AND CURRENTLY UNWIRED. `documents-panel.tsx` already holds a
   *  `ws` and passes it to `DocumentPreview`, but that file is owned by another
   *  change in flight and this one may not touch it, so the one-line
   *  `ws={ws}` on the `<DocumentsHistoryModal>` mount is OWED. Until it lands,
   *  the fallback below renders against an empty workspace, which makes a
   *  `dataSection` block resolve to nothing — the same output the renderer
   *  gives for an empty register, so it degrades to a missing section rather
   *  than to broken markup. Every other block type is unaffected. */
  ws?: Workspace;
}

interface HistoryRowProps {
  version: DocVersion;
  lang: Lang;
  onRestore: (versionId: number) => void;
  isReadOnly?: boolean;
  ws?: Workspace;
}

/** One version row: `title · savedAt · source · op · block count`, a Preview
 *  disclosure and Restore. Its own component ONLY because the disclosure needs
 *  a hook per row, and hooks cannot live inside a `.map` callback. */
function HistoryRow({ version: v, lang, onRestore, isReadOnly, ws }: HistoryRowProps) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const previewId = `documents-history-preview-${v.id}`;

  // ★★★ RENDERED THROUGH `doc-render-html`'s PREVIEW MODE, WHICH IS WHERE THE
  // SINK SANITIZE LIVES — `renderBlock`'s `paragraph` case runs
  // sanitizeTemplateHtml on the ONE unescaped path, and every other block type
  // is escaped by the same module. So there is NO second pass here, for the
  // reason `document-preview.tsx` states at length: a second pass would imply
  // the sink is optional. Do not hand-roll a renderer beside this one either —
  // a version's blocks are the same `DocBlock[]` a live document holds, and two
  // renderers is how one of them stops sanitizing.
  //
  // ★ A DocVersion is not a ProjectDocument (no createdAt/updatedAt), and the
  // renderer's preview mode reads NEITHER — nor the id or title, which only the
  // standalone header uses. The adapter below therefore feeds it savedAt for
  // both stamps rather than inventing values: nothing consumes them, and a
  // wrong-but-plausible date would be worse than a redundant true one.
  //
  // ★★ COMPUTED ONLY WHILE OPEN. The panel element stays mounted (see below),
  // but its CONTENT is not: `renderDocumentHtml` runs DOMPurify once per
  // paragraph block, and a document holds up to MAX_VERSIONS_PER_DOC versions
  // of up to MAX_BLOCKS_PER_DOC blocks — rendering all of them at modal-open,
  // for previews nobody asked to see, is work with no user on the other end.
  const html = useMemo(
    () =>
      previewOpen
        ? renderDocumentHtml(
            {
              id: v.documentId,
              title: v.title,
              blocks: v.blocks,
              createdAt: v.savedAt,
              updatedAt: v.savedAt,
            },
            // ★ Constructed INSIDE the memo, never at module scope: `workspace`
            // sits in the settings-types ⇄ workspace ⇄ document-model import
            // cycle, and module-eval reads across that cycle are exactly what
            // open-followups §92 records.
            ws ?? emptyWorkspace(),
            lang,
            "preview",
          )
        : "",
    [previewOpen, v, ws, lang],
  );

  const blockCount =
    v.blocks.length === 1
      ? t(lang, "documentsVersionBlocksOne")
      : t(lang, "documentsVersionBlocks", String(v.blocks.length));

  // ★★★ ROW-UNIQUE BY CONSTRUCTION, the same construction the Restore button
  // below uses and for the same measured reason: two mutations landing in one
  // tick share a `savedAt`, and two successive `ops` writes share a title, so
  // title+timestamp collides on real data. Only the version id cannot. N
  // identical "Preview" names is a WCAG 2.4.6 failure, and no gate here can
  // catch it — this modal is never open at axe scan time.
  const rowSuffix = `${v.title} · ${stamp(v.savedAt)} · #${v.id}`;

  return (
    <li className="flex flex-col gap-1 rounded-md border border-line px-3 py-2">
      <div className="flex items-center justify-between gap-3">
        <span className="min-w-0 text-sm text-foreground">
          <span className="font-medium">{v.title}</span>
          {" · "}
          <span className="tabular-nums text-muted-foreground">{stamp(v.savedAt)}</span>
          {" · "}
          <span className="text-muted-foreground">
            {t(lang, v.source === "ai" ? "documentsVersionSourceAi" : "documentsVersionSourceUser")}
          </span>
          {" · "}
          <span className="text-muted-foreground">{t(lang, VERSION_OP_LABEL[v.op])}</span>
          {" · "}
          <span className="text-muted-foreground">{blockCount}</span>
        </span>
        <span className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            aria-expanded={previewOpen}
            aria-controls={previewId}
            aria-label={`${t(lang, "documentsPreview")} – ${rowSuffix}`}
            onClick={() => setPreviewOpen((o) => !o)}
            className={`flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground ${FOCUS_RING} ${TRANSITION}`}
          >
            <span aria-hidden>{previewOpen ? "▾" : "▸"}</span>
            {t(lang, "documentsPreview")}
          </button>
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
            aria-label={`${t(lang, "documentsRestore")} – ${rowSuffix}`}
          >
            {t(lang, "documentsRestore")}
          </Button>
        </span>
      </div>
      {/* ★★ ALWAYS MOUNTED, `hidden`-toggled — the repo's expander convention
          (`action-reasons.tsx`). Conditionally rendering it would leave
          `aria-controls` pointing at an id that is absent from the DOM in the
          collapsed state, which is the state a screen reader meets first.
          ★ `tabIndex` because it scrolls and rendered document HTML contains
          nothing focusable, so a keyboard-only user could not scroll it —
          axe's scrollable-region-focusable, the same fix `document-preview.tsx`
          carries. `hidden` keeps it out of the tab order while collapsed. */}
      <div
        id={previewId}
        hidden={!previewOpen}
        tabIndex={0}
        data-documents-history-preview
        className="max-h-64 overflow-auto rounded-md border border-line bg-surface-muted p-2 text-xs text-foreground"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </li>
  );
}

export function DocumentsHistoryModal({
  open,
  doc,
  versions,
  onClose,
  onRestore,
  lang,
  isReadOnly,
  ws,
}: DocumentsHistoryModalProps) {
  if (!open || !doc) return null;

  // ★★★ A RESTORED MARKER IS NEVER A RESTORABLE ROW. It is not a before-image
  // at all — it is the bookkeeping entry that closes a tombstone, carrying a
  // DEAD document id (see document-versions.ts's RESTORED_MARKER_OP). Restoring
  // one mints ANOTHER copy of an already-restored document and writes a SECOND
  // marker; measured directly against the engine, not inferred.
  //
  // ★★ TODAY THIS FILTER CANNOT FIRE, and it is here anyway. A marker's
  // `documentId` is the id the document had before it was deleted, and this
  // modal only ever opens for a LIVE document, so the orchestrator's
  // `documentId === historyFor` filter already excludes every marker. The
  // filter exists because that reasoning is a property of the CALLER, not of
  // this component: a deleted-documents surface listing a dead id's group
  // would hand us `[tombstone, marker]`, and the marker would render a Restore
  // button that duplicates. Guarding at the surface that draws the button is
  // the only placement that cannot be bypassed by a new caller.
  // ★ An engine-side rejection is landing separately. This is not a duplicate
  // of it: that one stops the mutation, this one stops OFFERING it, and a
  // button whose only outcome is an error is a defect on its own.
  const restorable = versions.filter((v) => v.op !== RESTORED_MARKER_OP);

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
          {restorable.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t(lang, "documentsNoVersions")}</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {restorable.map((v) => (
                <HistoryRow
                  key={v.id}
                  version={v}
                  lang={lang}
                  onRestore={onRestore}
                  isReadOnly={isReadOnly}
                  ws={ws}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    </Modal>
  );
}
