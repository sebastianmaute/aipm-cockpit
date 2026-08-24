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
// the prop's own note.
//
// ★★★ EVERY Restore BUTTON CARRIES A VERSION-UNIQUE ACCESSIBLE NAME, and this
// component is the ONLY thing that will ever check it. N identical "Restore"
// labels is a WCAG 2.4.6 failure, and the axe gate cannot reach it here even in
// principle: Documents is in `A11Y_VIEWS`, but the gate scans a statically
// seeded app and never opens this modal, so the collision does not exist at
// scan time. Do not read a green axe run as covering anything below.

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { Modal } from "./modal";
import { ModalHeader } from "./modal-header";
import { Button } from "./button";
import { FOCUS_RING, TRANSITION } from "./interaction-styles";
import { type Lang, t, type TranslationKey } from "./i18n";
import type { ProjectDocument } from "./document-model";
import type { DocumentAsset } from "./document-asset";
import type { TursoConfig } from "./turso-config";
import { RESTORED_MARKER_OP, type DocVersion, type DocVersionOp } from "./document-versions";
import { renderDocumentHtml } from "./doc-render-html";
import { attachAssetImages } from "./document-asset-images";
import { loadAssetData } from "./document-assets-store";
import {
  subscribeAssetRepairs, getAssetRepairGeneration, getServerAssetRepairGeneration,
} from "./document-asset-repairs";
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

/** Read-only asset access for resolving `<img data-asset-id>` in a version
 *  preview — the renderer emits those with no `src`, so without this a version
 *  holding an image previews it as a broken-image icon (open-followups §206).
 *
 *  ★★ A NEW, NARROWER TYPE RATHER THAN `DocumentAssetPaneProps`, which also
 *  carries `setAssets`. This surface is read-only over assets and must not be
 *  handed a setter: taking the wider type would leave a write capability the
 *  component merely happens not to use, which is how one gets used later
 *  without anyone deciding to. It is also the type the C10 note on the effect
 *  below is about — three separately-stable fields, deliberately not one
 *  object identity. */
export interface HistoryAssetAccess {
  /** null disables the feature — mirrors `DocumentAssetPaneProps.tursoConfig`. */
  tursoConfig: TursoConfig | null;
  /** Scopes the asset byte store's `(id, project_id)` rows. */
  projectId: string;
  /** Metadata rows, for the stored MIME. Absent (or a miss) is NOT an error —
   *  `attachAssetImages` falls back to a typeless Blob. */
  assets: readonly DocumentAsset[] | undefined;
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
   *  ★★ OPTIONAL SO THE COMPONENT CAN BE RENDERED BARE — its own suite does
   *  that throughout, and the one pair of cases that needs a workspace supplies
   *  one itself. In PRODUCTION it is wired: `documents-panel.tsx` passes
   *  `ws={ws}` on the `<DocumentsHistoryModal>` mount, the same value it hands
   *  `DocumentPreview`, and both `documents-panel.test.tsx` and this
   *  component's own suite pin that pair of claims from their two sides. When
   *  it IS omitted the fallback below renders against an empty workspace, which
   *  makes a `dataSection` block resolve to nothing — the same output the
   *  renderer gives for an empty register, so it degrades to a missing section
   *  rather than to broken markup. Every other block type is unaffected.
   *
   *  ★ It is the CURRENT workspace, and there is no historical one to give it:
   *  a version stores its own blocks, but a `dataSection` block stores only a
   *  key and resolves against whatever registers hold TODAY. So a preview
   *  stamped with a `savedAt` from three weeks ago lists this morning's
   *  milestones. Not a leak — same user, same workspace — but the historical
   *  timestamp sitting beside it makes that likelier to be misread here than in
   *  the live-document preview, where the data and the document are both
   *  current. */
  ws?: Workspace;
  /** OPTIONAL: absent degrades to the pre-§206 behaviour — blocks render,
   *  images do not resolve — never to broken markup. Document images are
   *  Turso-gated (S3c-1), so a file-mode reader legitimately has no bag. */
  assetAccess?: HistoryAssetAccess;
}

interface HistoryRowProps {
  version: DocVersion;
  lang: Lang;
  onRestore: (versionId: number) => void;
  isReadOnly?: boolean;
  ws?: Workspace;
  assetAccess?: HistoryAssetAccess;
}

/** One version row: `title · savedAt · source · op · block count`, a Preview
 *  disclosure and Restore. Its own component ONLY because the disclosure needs
 *  a hook per row, and hooks cannot live inside a `.map` callback. */
function HistoryRow({ version: v, lang, onRestore, isReadOnly, ws, assetAccess }: HistoryRowProps) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const previewId = `documents-history-preview-${v.id}`;

  // ★★★ RENDERED THROUGH `doc-render-html`'s PREVIEW MODE, WHICH IS WHERE THE
  // SINK SANITIZE LIVES — `renderBlock`'s `paragraph` case runs
  // sanitizeDocumentHtml on the ONE unescaped path, and every other block type
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
  //
  // ★★ "WHILE OPEN" IS NOT "ONCE", AND THAT IS THE HALF THIS MEMO DOES NOT BUY.
  // `ws` is a dep, and the value the pane passes is the WHOLE `useWorkspace()`
  // context (`workspace-panels.tsx` passes it deliberately, so a new slice is
  // carried for free) — one provider `useMemo` over every workspace slice, so
  // its identity changes on ANY workspace write: a task edit, a background
  // Outlook pull, an insight write, a scheduled AI job. Each of those re-runs
  // this render for every EXPANDED preview. Measured, not reasoned, with a spy
  // on `renderDocumentHtml`: a structurally identical `ws` with a fresh
  // identity re-ran it; an unrelated prop change with a stable `ws` did not.
  //
  // ★ Deliberately NOT narrowed. `resolveDataSection` reads across the whole
  // export registry, so any dep list short of `ws` would have to be maintained
  // against it — and a section resolving against the CURRENT workspace (see the
  // `ws` prop's note) means recomputing on fresh data is the right answer, not
  // a cost to dodge. The bound that matters is still held: the work is one
  // expanded version, never all MAX_VERSIONS_PER_DOC of them.
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

  // ★★★ MEMOIZED FOR ITS IDENTITY, NOT TO SAVE AN ALLOCATION — and `html`
  // being memoized above buys none of this. React 19 diffs host props by
  // `Object.is` and gives `dangerouslySetInnerHTML` no special treatment, so an
  // inline `{{ __html: html }}` literal is a NEW object on every render and
  // React re-assigns `domElement.innerHTML` — tearing down and rebuilding this
  // whole panel — on EVERY re-render of this row, byte-identical `html` or not.
  // `document-preview.tsx` carries the measured account and the precedent fix;
  // this mirrors it.
  //
  // ★★ The damage is INERT here only for as long as nothing attaches anything
  // to this subtree. The moment an effect stamps a node inside it — resolving
  // an asset image's `src`, say — that effect does NOT re-run to repair the
  // rebuild (its deps are unchanged), so every node it wrote is gone for good
  // and any parent render at all blanks the panel permanently. That is the
  // shipped defect `document-preview.tsx` records, and fixing it here BEFORE
  // anything depends on it is the whole point of this memo.
  //
  // Pinned by "does not rebuild the preview subtree on an unrelated re-render",
  // which asserts NODE IDENTITY — markup assertions pass under the defect.
  const previewHtml = useMemo(() => ({ __html: html }), [html]);

  const bodyRef = useRef<HTMLDivElement | null>(null);

  // ★★★ C10 — THE BAG'S THREE FIELDS ARE HOISTED, AND THE EFFECT DEPENDS ON
  // THESE, NEVER ON `assetAccess`. `workspace-panels.tsx` builds the pane's
  // asset bag as an INLINE literal at the `DocumentsPanelLazy` mount, so the
  // object reaching this component has a NEW identity on every render of the
  // Documents tabpanel while its members stay reference-stable. Listing the bag
  // would re-run the effect — an UNCACHED Turso round trip per image — on every
  // unrelated re-render: the same `Object.is` identity failure `previewHtml`
  // above exists to fix, one level up.
  // ★ Hoisting is required regardless of where the bag is built:
  // `react-hooks/exhaustive-deps` rejects an `obj.member` dep outright, so
  // `[assetAccess.projectId]` is not an available spelling.
  // Pinned by "does not re-fetch the bytes when the caller hands it a fresh bag
  // object", which counts loader calls across an unrelated re-render.
  const assetTursoConfig = assetAccess?.tursoConfig ?? null;
  const assetProjectId = assetAccess?.projectId;
  const assetList = assetAccess?.assets;

  // ★★★ THE ONE SIGNAL NO PROP CARRIES, exactly as in `document-preview.tsx`: a
  // §212 repair rewrites an asset's BYTES over its existing id and writes NO
  // metadata, so `assetList` keeps its identity and `previewHtml` is unchanged.
  // Without this the picture in an OPEN version preview stays missing while the
  // library row beside it goes healthy.
  const assetRepairGeneration = useSyncExternalStore(
    subscribeAssetRepairs, getAssetRepairGeneration, getServerAssetRepairGeneration,
  );

  // ★★★ IMPERATIVE, NOT REACT STATE — the body below is one
  // dangerouslySetInnerHTML string, so there is no React element to hand a
  // `src` (and `react-hooks/set-state-in-effect` is banned and fatal anyway).
  // See `document-asset-images.ts`'s own header; this mirrors the live preview.
  //
  // ★★ THE PER-REOPEN REFETCH IS ACCEPTED, DELIBERATELY. `html` above collapses
  // to `""` while the disclosure is closed, so close → reopen recomputes it,
  // changes `previewHtml`, and re-runs this effect — re-fetching the bytes. It
  // is neither a leak nor a correctness bug: the prior open's teardown revokes
  // its blob URLs first, and on the CLOSE transition the subtree is empty, so
  // `attachAssetImages` finds no `img[data-asset-id]` and exits through its own
  // no-op early return. A cache is NOT the answer here — it carries its own
  // invalidation question (a §212 repair rewrites bytes under a stable id) and
  // an unreviewed one buried in a wiring change is worse than a known repeated
  // cost. This comment exists so the next reader finds a decision rather than
  // an oversight.
  //
  // ★ Guarded on `assetProjectId === undefined` rather than on `assetAccess`:
  // `projectId` is required on the bag, so undefined means no bag — and naming
  // `assetAccess` in the body would drag the unstable object back into the deps.
  useEffect(() => {
    const el = bodyRef.current;
    if (!el || assetProjectId === undefined) return;
    // ★★★ A NULL CONFIG MEANS ASSET STORAGE IS OFF, NOT THAT THE IMAGES ARE
    // MISSING. `loadAssetData(null, …)` throws `StorageNotReadyError` at once,
    // `attachAssetImages` swallows it per id, and EVERY `<img data-asset-id>`
    // would be stamped `data-asset-missing` — the dashed red frame that tells
    // the reader this image is gone. In file mode and in Safe Mode
    // (`workspace-panels.tsx` nulls the config but still mounts this panel)
    // that is a lie about the user's data, and the asset LIBRARY one pane away
    // gets the same state right with an explicit `assetLibraryTursoOnly`
    // reason. Bailing leaves the image with NO `src` attribute at all, which is
    // not a failed load — the browser renders its alt text (or nothing), never
    // the broken-image glyph an earlier revision of this note claimed. That is
    // what this modal showed before §206 wired the resolver up at all.
    if (assetTursoConfig === null) return;
    let cancelled = false;
    let detach: (() => void) | null = null;
    const mimeFor = (id: string) => assetList?.find((a) => a.id === id)?.mime;
    attachAssetImages(el, (id) => loadAssetData(assetTursoConfig, id, assetProjectId), mimeFor,
      () => !cancelled)
      .then((d) => {
        // The subtree may have been replaced (the disclosure closed, a new
        // version landed) or the row may have unmounted before the byte loads
        // resolved — revoke rather than leave the blob URLs it minted dangling.
        if (cancelled) { d(); return; }
        detach = d;
      });
    return () => {
      cancelled = true;
      detach?.();
    };
  }, [previewHtml, assetTursoConfig, assetProjectId, assetList, assetRepairGeneration]);

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
        ref={bodyRef}
        id={previewId}
        hidden={!previewOpen}
        tabIndex={0}
        data-documents-history-preview
        className="max-h-64 overflow-auto rounded-md border border-line bg-surface-muted p-2 text-xs text-foreground"
        dangerouslySetInnerHTML={previewHtml}
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
  assetAccess,
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
                  assetAccess={assetAccess}
                />
              ))}
            </ul>
          )}
        </div>
      </div>
    </Modal>
  );
}
