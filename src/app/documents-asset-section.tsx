"use client";

// src/app/documents-asset-section.tsx — the asset-library surface mounted
// inside DocumentsPanel: the inline management library (Turso-gated) plus the
// three insertion entry points (picker, paste, drop). Split out of
// documents-panel.tsx, which has near-zero size headroom — see AGENTS.md.
//
// ★★★ GATED ON `tursoConfig !== null`, NEVER `storageConfig.kind === "turso"`
// alone — the kind can be set while the config is unset or quarantined.
// Documents THEMSELVES stay universal (the design explicitly rejected
// dropping Documents from axe A11Y_VIEWS); only THIS surface disables.
//
// ★★★ INSERTION WRITES A NEW PARAGRAPH BLOCK via `structural.insert`, never
// by typing into a live RichTextEditor. The shared editor's Tiptap schema has
// no image node and its `onUpdate` always runs the html through
// `sanitizeRichHtml` (whose allow-list has no `img`) — a live-edited
// paragraph can never hold one, which is exactly why
// document-block-editors.tsx renders any `<img>`-bearing paragraph
// READ-ONLY rather than editable. Going through `structural.insert` sidesteps
// both: the new block is never opened in the live editor, it just renders via
// that same read-only branch. `structural.insert`'s own normalizer
// (`sanitizeBlock`) only CAPS a paragraph's length, it does not run DOMPurify,
// so the html this file builds is run through `sanitizeDocumentHtml` itself
// (the one sanitizer that DOES allow `img` + `data-asset-id` + `alt`) before
// it is ever handed to `structural.insert` — this file calls that existing
// sanitizer as an ordinary consumer; it does not edit one.
//
// ★★ Appends at the END of the document's blocks. "At the cursor" was the
// original ask, but there is no live-cursor concept at the DOCUMENT level —
// only within a single block's own (image-blind) editor — so append is the
// only unambiguous target this architecture can express without a live
// editor to point at.

import {
  useCallback, useMemo, useState,
  type ClipboardEvent, type DragEvent, type Dispatch, type SetStateAction,
} from "react";
import { t, type Lang, type TranslationKey } from "./i18n";
import type { ProjectDocument } from "./document-model";
import type { BlockStructuralOps } from "./use-document-editor";
import type { TursoConfig } from "./turso-config";
import type { DocumentAsset } from "./document-asset";
import { useDocumentAssets, type UploadError } from "./use-document-assets";
import { AssetLibrary } from "./asset-library";
import { AssetLibraryModal } from "./asset-library-modal";
import { Button } from "./button";
import { EmptyState } from "./empty-state";
import { sanitizeDocumentHtml } from "./sanitize-html";
import { htmlEscape } from "./download";
import { isAllowedAssetMime, ASSET_MAX_PER_DOCUMENT } from "./document-asset-upload";
import { assetRefsInDocument, countAssetUsage } from "./document-asset-usage";
import { ASSET_PARTITION_FALLBACK } from "./document-assets-schema";
import { loadAssetData } from "./document-assets-store";
import type { AssetByteLoader } from "./document-asset-images";

/** ONE bag, house convention (AGENTS.md's `EntityCalendarProps` rule — "never
 *  five flat props") over the asset gate + byte-store scope + the live
 *  `documentAssets` slice. Threaded as PROPS, never read via `useWorkspace()`
 *  here: this section is mounted UNCONDITIONALLY by documents-panel.tsx, whose
 *  81 pre-existing tests render the panel WITHOUT a WorkspaceProvider (they
 *  pass `ws` in as an explicit prop instead) — a context read here throws in
 *  every one of them. */
export interface DocumentAssetPaneProps {
  /** null disables the feature — see the gating note above. */
  tursoConfig: TursoConfig | null;
  /** Scopes the asset byte store. */
  projectId: string;
  assets: readonly DocumentAsset[] | undefined;
  setAssets: Dispatch<SetStateAction<readonly DocumentAsset[] | undefined>>;
  /** Threaded straight through to `useDocumentAssets` — see its own docstring.
   *  It rides THIS bag rather than a sibling prop because the bag is what
   *  already carries `setAssets`, i.e. the write path the bypass protects. */
  allowDestructiveSave?: () => void;
}

/**
 * The export-time image loader for a pane, or `undefined` when the asset
 * feature is off.
 *
 * ★★★ IT LIVES HERE, NOT IN documents-panel.tsx, FOR SIZE — the same pressure
 * that split this whole file out of it. ★★ DO NOT RE-QUOTE A HEADROOM FIGURE
 * HERE. This said documents-panel.tsx "sits at EXACTLY the 800-line ratchet
 * cap"; it was 759 when a cold review checked, and any number written here
 * rots on the next commit to that file. Measure it instead —
 * `node -e "console.log(require('fs').readFileSync('src/app/documents-panel.tsx','utf8').split('\n').length)"`
 * is the gate's own arithmetic (`check-file-sizes.mjs`, i.e. `wc -l` + 1).
 * The panel folds this onto its existing import of this module and calls it
 * inline at both download sites, which costs zero net lines either way.
 *
 * ★★★ WITHOUT IT THE EXPORT SILENTLY LOSES EVERY IMAGE, and nothing in this
 * repo would say so. `downloadDocument`'s loader is its OPTIONAL fifth
 * argument, and there is no `no-floating-promises` rule configured here, so a
 * call site that omits it typechecks, lints and produces a file — one whose
 * images are dashed "missing asset" boxes, exactly as before this slice.
 * `documents-panel.test.tsx` pins BOTH of that pane's download sites
 * separately, because covering one leaves the other free to drop it.
 *
 * ★ `undefined` rather than a loader that throws is the DOCUMENTED "no assets
 * available" signal: `loadExportAssets` then discloses each image as missing
 * instead of failing the whole export. So both halves of the guard matter —
 * a loader built unconditionally would call the byte store with a null config
 * on every image of every file-mode export.
 *
 * ★ Called at CLICK time, not memoized in render: it reads the live pane bag,
 * and a fresh closure per click costs nothing (a download is one gesture).
 */
export function assetPaneLoader(pane: DocumentAssetPaneProps | undefined): AssetByteLoader | undefined {
  const config = pane?.tursoConfig ?? null;
  const projectId = pane?.projectId;
  if (!config || !projectId) return undefined;
  return (id: string) => loadAssetData(config, id, projectId);
}

export interface DocumentsAssetSectionProps {
  lang: Lang;
  /** Absent ⇒ the asset feature is disabled — mirrors what a null
   *  `tursoConfig` alone used to mean, so the pre-existing documents-panel
   *  call sites that predate this slice keep compiling with no asset prop. */
  assetPane?: DocumentAssetPaneProps;
  /** Every document, for the library's "used in N documents" column. */
  documents: readonly ProjectDocument[];
  /** The SAME instance documents-panel.tsx already built for the selected
   *  document — reused rather than a second `useDocumentEditor` call, which
   *  would hold its own (divergent) coalescing/version state for the same
   *  document. */
  structural: BlockStructuralOps;
  selected: ProjectDocument | null;
  /** Popout mirrors: every other Documents control goes inert here too. */
  isReadOnly?: boolean;
}

const EMPTY_ASSETS: readonly DocumentAsset[] = [];
const NOOP_SET_ASSETS: Dispatch<SetStateAction<readonly DocumentAsset[] | undefined>> = () => {};

const UPLOAD_ERROR_KEY: Record<UploadError, TranslationKey> = {
  format: "assetUploadErrorFormat",
  tooLargeRaw: "assetUploadErrorTooLargeRaw",
  tooLargeStored: "assetUploadErrorTooLargeStored",
  dimensions: "assetUploadErrorDimensions",
  empty: "assetUploadErrorEmpty",
  decode: "assetUploadErrorDecode",
  storageWrite: "assetUploadErrorStorageWrite",
};

export function DocumentsAssetSection({
  lang, assetPane, documents, structural, selected, isReadOnly,
}: DocumentsAssetSectionProps) {
  const tursoConfig = assetPane?.tursoConfig ?? null;
  // ★★★ `||`, NOT `??` — a BLANK id must normalise to the fallback too, not
  // open a second partition under "". `AssetDataRow.projectId`'s docstring
  // claimed "" was the single-tenant key for as long as this feature has
  // existed while no call site produced one; anything written by a caller
  // following that claim would have been invisible to every session that
  // resolves the key the way this line does. Normalising here is the seam that
  // makes the corrected docstring TRUE rather than merely descriptive.
  const projectId = assetPane?.projectId || ASSET_PARTITION_FALLBACK;
  const assets = assetPane?.assets ?? EMPTY_ASSETS;
  const { upload, remove, rename, danglingIds, busyId, error } = useDocumentAssets({
    config: tursoConfig,
    assets,
    setAssets: assetPane?.setAssets ?? NOOP_SET_ASSETS,
    projectId,
    allowDestructiveSave: assetPane?.allowDestructiveSave,
  });

  const usage = useMemo(() => countAssetUsage(documents), [documents]);
  const [modalOpen, setModalOpen] = useState(false);
  const [capMessage, setCapMessage] = useState<number | null>(null);
  const enabled = tursoConfig !== null && !isReadOnly;

  // ★★★ ONE BATCH, ONE RUNNING STATE — this is a BATCH function even for the
  // single-asset picker path, and collapsing it back to a per-asset one
  // reopens both defects below.
  //
  // ★★★ (1) THE CAP MUST HOLD ACROSS A BATCH. `assetRefsInDocument(selected)`
  // is read from the RENDER closure, and `selected` cannot change inside a
  // synchronous loop — so N per-asset calls all evaluate against the SAME
  // pre-batch id set. At 19 stored images a 5-file paste had all five pass the
  // `>= ASSET_MAX_PER_DOCUMENT` test and the document ended with 24. The
  // running `present` set below is what makes the cap hold WITHIN a batch;
  // holding it ACROSS batches is free, since the next batch re-reads the
  // (by then updated) document.
  //
  // ★★★ (2) THE INSERT INDEX MUST ADVANCE. `structural.insert` is
  // `splice(index, 0, block)` against LIVE state (document-ops.ts), while
  // `selected.blocks.length` is frozen for the whole loop — so N inserts at
  // one index put each new block BEFORE the previous one and a 3-image paste
  // landed in REVERSE order. The pre-existing "in the pasted order" test only
  // compared the order of the CALLS, which was right all along; nothing looked
  // at the index they carried.
  //
  // ★★ THE RUNNING STATE IS OPTIMISTIC — it does NOT consult the `DocResult`
  // `structural.insert` returns. Threading the returned document back in was
  // the other candidate design and it is worse here for a reason that is about
  // the failure mode, not about taste: `structuralOp` returns `undefined` the
  // moment the open document changed underneath (use-document-editor.ts), so a
  // result-driven set silently stops counting exactly when it is handed
  // nothing — and every test stub that returns a bare `undefined` (or an
  // `okResult([])`, as this file's own `fakeStructural` does) would disable the
  // cap while staying green. Counting locally cannot be switched off by a
  // caller, and it errs toward SKIPPING rather than overshooting, which is the
  // safe direction for a cap. A batch whose first insert was refused is
  // landing nowhere in any case.
  //
  // ★★ TAKES ASSETS, NOT IDS. The paste/drop path calls this with the rows
  // `upload` just resolved to, which by definition are NOT yet in this
  // render's `assets` closure — an id-keyed lookup here would find nothing and
  // drop the insert on the floor. `insertAssetById` below is the id-keyed
  // wrapper the picker (which only ever names an already-rendered row) uses.
  //
  // ★ Enforced HERE (at insert), not by truncating on load.
  const insertAssets = useCallback(
    (toInsert: readonly DocumentAsset[]) => {
      setCapMessage(null);
      if (!selected || toInsert.length === 0) return;
      // ★ ONE scan, two consumers: `all` is what the cap counts (tag-agnostic
      //   — a reference the sanitizer kept on a non-`img` element still spends
      //   a slot) and `undrawable` is what the message's reclaimable-room
      //   arithmetic subtracts. Reading them from one call is what stops the
      //   number shown from disagreeing with the set the cap was enforced
      //   against.
      const refs = assetRefsInDocument(selected);
      const present = new Set(refs.all);
      // ★★ TRACKED ACROSS THE BATCH, for the same reason `present` and `at` are:
      // `refs` describes the PRE-batch document and the loop below changes what
      // it describes. An id already present as a `<span data-asset-id>` is
      // undrawable AND exempt from the cap (it spends no new slot), so it is
      // inserted -- as an `<img>`, which makes it drawable. Reading the frozen
      // `refs.undrawable` afterwards counts it as still-undrawable, which under
      // the formula below understates `drawn` and so OVERSTATES the reclaimable
      // room by one. Contrived (it needs a batch that BOTH re-inserts such an
      // id and skips something else, which only the dedup path can produce),
      // but the correction is one `delete`.
      const undrawable = new Set(refs.undrawable);
      let at = selected.blocks.length;
      let skipped = 0;
      for (const asset of toInsert) {
        if (!present.has(asset.id) && present.size >= ASSET_MAX_PER_DOCUMENT) {
          skipped += 1;
          continue;
        }
        // ★★★ `htmlEscape` IS LOAD-BEARING AND THE SANITIZER DOES NOT REPLACE
        // IT. `asset.name` is `file.name` verbatim on upload, free text via
        // rename, and fully attacker-controlled in an imported workspace
        // (`sanitizeDocumentAsset` keeps it as-is). Interpolated raw, a name of
        // `x"><a href="https://evil.test">Click here</a><img alt="` CLOSES the
        // img and opens an anchor — and `sanitizeDocumentHtml` then PASSES it,
        // because `a` is allow-listed and an `https:` href satisfies the URI
        // regexp. The result persists into `block.html` and rides into the
        // standalone-HTML/DOCX/PPTX exports. A name holding a plain `"` also
        // just truncates the alt. Escape at the seam; never ask a sanitizer to
        // clean up a string that was already malformed when it was built.
        const html = sanitizeDocumentHtml(
          `<img data-asset-id="${htmlEscape(asset.id)}" alt="${htmlEscape(asset.name)}">`,
        );
        structural.insert(at, { type: "paragraph", html });
        present.add(asset.id);
        // ★ The html above is always an `<img>`, so any reference to this id
        //   that was drawable-by-nothing is drawable now.
        undrawable.delete(asset.id);
        at += 1;
      }
      // ★★ ONE DECISION FOR THE WHOLE BATCH, announced after it. A per-asset
      // `setCapMessage` let a later file that inserted fine CLEAR the message a
      // skipped earlier one had just set.
      // ★★ IT STILL DOES NOT NAME HOW MANY FILES WERE SKIPPED, deliberately:
      // by the time the message shows, the document is holding the cap, and the
      // number that helps is not "N refused" but how much room the user could
      // actually reclaim. A `<span data-asset-id>` spends a slot, contributes to
      // no export and lands in none of the export's `inlined`/`omitted`/`missing`
      // buckets — so a user at the cap saw a full document with nothing on
      // screen to account for it (open-followups §218).
      //
      // ★★★ REPORT RECLAIMABLE ROOM, NEVER `undrawable.size` — THAT WAS WRONG IN
      // BOTH DIRECTIONS, and each direction is pinned by a test.
      //   (a) IT COULD EXCEED THE CAP IT HAD JUST QUOTED. Nothing enforces the
      //       cap on LOAD, so `refs.all` is UNBOUNDED: a document holding 21
      //       `<span data-asset-id>` references announced "the maximum of 20
      //       images. 21 of these slots …" — 21 of 20.
      //   (b) IT WAS ACTIONABLE-SOUNDING AND INERT. At 20 `<img>` PLUS 3
      //       `<span>` it said 3, but the drawable images alone already hold the
      //       whole cap, so deleting all three spans frees NOTHING. The message
      //       sent the user to do work with no effect.
      // `drawn` is the references an export can actually draw, so
      // `cap - drawn` is what removing every undrawable reference would buy.
      // ★★ THE RANGE IS STRUCTURAL, not a coincidence of the fixtures:
      // `undrawable` is built as `all` MINUS `drawable` and the loop only ever
      // adds to `present` and deletes from `undrawable`, so `undrawable` stays a
      // subset of `present` and `drawn` is never negative — which bounds
      // `freeable` at or below the cap.
      // ★★ `Math.max` GUARDS THE OTHER END AND IS DELIBERATELY NOT PINNED,
      // because NO test could pin it: it only fires for a document imported
      // over the cap in DRAWABLE images (21 `<img>`, `drawn` 21), and there the
      // clamped 0 and the unclamped -1 render IDENTICALLY — the `capMessage > 0`
      // branch below rejects both, so the plain wording shows either way. It is
      // kept so the value never contradicts its own name, not because anything
      // observes it. Do not add a test asserting the plain wording at 21 images
      // and call it coverage for this line: it passes with the clamp deleted.
      // ★★ THE COUNT USES THE BATCH-LOCAL `undrawable`, NOT `refs.undrawable` --
      // see the set's declaration above: an id this batch just re-inserted as an
      // `<img>` is drawable by the time the message renders.
      // ★★ THE STATE CARRIES THE NUMBER, NOT A BOOLEAN, so the message cannot
      // report a value it did not compute; a legitimate 0 keeps the plain
      // `assetLibraryMaxPerDocument` wording, and BOTH branches are tested.
      // ★★★ AN EARLIER WORDING HERE NAMED A MUTATION THESE TESTS DO NOT MISS.
      // It said a test on the reclaimable-room wording alone "stays green with
      // the condition inverted". It does not — and a comment crediting a test
      // with catching something it never sees is the same shape as
      // open-followups §216, where this very slice's spec AND plan both claimed
      // the golden suite pinned bytes it does not touch. So: both mutants below
      // were PLANTED AND RUN, 2026-08-24, then reverted, with
      // `npx vitest run documents-asset-section.test.tsx --maxWorkers=1`
      // (36 tests in the file):
      //   `capMessage > 0` -> `capMessage <= 0`, a true INVERSION: 8 red, and
      //     the two reclaimable-room WORDING tests are among them ("says how
      //     much room …" and "never claims more … than the cap itself"). The
      //     old claim is refuted by the very tests it named.
      //   `capMessage > 0` -> `capMessage >= 0`, the guard weakened to
      //     ALWAYS-TRUE: 6 red, and BOTH wording tests stay GREEN. Same
      //     behaviour as collapsing this ternary to its Freeable arm, because
      //     `Math.max` above keeps the value at or above zero. Every user at a
      //     genuinely full document would then be told "… would make room for 0
      //     more".
      // So the always-true mutant is the one the plain branch is here for, and
      // its detectors are the SIX cases asserting the plain wording — only
      // three of them in the cap-message describe; the rest sit in "documents
      // asset insertion" and "per-document cap across a batch", so this branch
      // survives that describe block being deleted.
      const drawn = present.size - undrawable.size;
      const freeable = Math.max(0, ASSET_MAX_PER_DOCUMENT - drawn);
      if (skipped > 0) setCapMessage(freeable);
    },
    [selected, structural],
  );

  const insertAssetById = useCallback(
    (id: string) => {
      const asset = assets.find((a) => a.id === id);
      if (asset) insertAssets([asset]);
    },
    [assets, insertAssets],
  );

  // ★★★ INSERTS FROM THE AWAITED RESULT, NEVER FROM A STATE ROUND TRIP. The
  // previous shape armed a boolean ref before the await and reacted to a
  // `lastId` state change, which was broken three ways at once: (a) re-inserting
  // an ALREADY-STORED image was a silent no-op, because the dedup branch set
  // `lastId` to the value it already held and React bailed out of the
  // re-render, so the effect never ran; (b) every rejection path in `upload`
  // returns without touching `lastId`, so the arm was never cleared and the
  // NEXT ordinary Upload press — which arms nothing — appended that image to
  // the open document unbidden; (c) one boolean cannot carry N files, so a
  // multi-file paste inserted exactly one. Awaiting the result removes the
  // state machine entirely.
  //
  // ★ Uploads run CONCURRENTLY (`Promise.all`) but insert in the caller's file
  // order, so a 3-image paste is not three serial round trips.
  const uploadAndInsert = useCallback(
    async (files: readonly File[]) => {
      const uploaded = await Promise.all(files.map((f) => upload(f)));
      // ★ ONE call with every accepted row, never one call per row — the whole
      // point of `insertAssets` is that the cap and the insert index are
      // carried ACROSS the batch. Rejected uploads resolve to null and simply
      // do not take a slot.
      insertAssets(uploaded.filter((a): a is DocumentAsset => a !== null));
    },
    [upload, insertAssets],
  );

  function handlePaste(e: ClipboardEvent<HTMLDivElement>) {
    if (!enabled) return;
    // ★★ `preventDefault` is AFTER the filter here and BEFORE it in `handleDrop`,
    // deliberately: pasting ordinary TEXT must fall through to the default paste
    // handler. Do not harmonise the two.
    const files = Array.from(e.clipboardData?.files ?? []).filter((f) => isAllowedAssetMime(f.type));
    if (!files.length) return;
    e.preventDefault();
    void uploadAndInsert(files);
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    if (!enabled) return;
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files).filter((f) => isAllowedAssetMime(f.type));
    if (!files.length) return;
    void uploadAndInsert(files);
  }

  if (!enabled) {
    // ★★ TWO DIFFERENT REASONS, TWO DIFFERENT MESSAGES. `assetLibraryTursoOnly`
    // ("Images need a Turso project") is simply UNTRUE for a read-only popout
    // on a fully configured Turso project, and it sends the reader off to check
    // storage settings that are already correct.
    const reason = tursoConfig === null ? "assetLibraryTursoOnly" : "assetLibraryReadOnly";
    return <EmptyState compact title={t(lang, reason)} />;
  }

  return (
    <div className="flex flex-col gap-2">
      {/* ★★ Paste/drop are scoped to THIS row only, deliberately not wrapping
          `AssetLibrary` below — that component has its own `onDrop` (upload,
          no auto-insert). Events bubble, so wrapping it too would fire BOTH
          handlers on one drop and upload the same file twice. `tabIndex={0}`
          is what makes the native `paste` event reachable at all: a plain
          non-editable div never receives one unless it (or a descendant) has
          focus. */}
      {/* ★★ `role="group"` IS REQUIRED, not decoration. Without it this is a
          focusable div with the implicit `generic` role, and ARIA prohibits
          naming `generic` — the `aria-label` may simply not be exposed, leaving
          a tab stop that announces nothing at all. */}
      {/* ★ `data-asset-drop-zone` is a STRUCTURAL test handle (house convention —
          cf. `data-dangling-marker`, `data-block-row`). Its tests must not find
          this element by the role or label they exist to pin, or a mutation of
          either kills them at the LOOKUP and the assertion never runs. */}
      <div
        data-asset-drop-zone
        role="group"
        tabIndex={0}
        onPaste={handlePaste}
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
        aria-label={t(lang, "assetLibraryPasteDropZone")}
        className={`flex flex-wrap items-center gap-2 rounded-md focus:outline-none focus:ring-2 focus:ring-ui-green`}
      >
        <Button variant="secondary" size="sm" disabled={!selected} onClick={() => setModalOpen(true)}>
          {t(lang, "assetLibraryInsert")}
        </Button>
        {/* ★★★ ALWAYS MOUNTED, TEXT TOGGLED — never `{error && <span …>}`. A
            live region inserted into the DOM in the same commit as its text is
            not reliably announced: assistive tech has to be observing the
            region BEFORE the content changes. Conditionally mounted, not one of
            the seven upload-error strings nor the cap message ever reached a
            screen reader. Same always-mounted rule as `action-reasons`. */}
        <span role="status" className="text-xs text-ui-pink-strong">
          {error ? t(lang, UPLOAD_ERROR_KEY[error]) : ""}
        </span>
        <span role="status" className="text-xs text-ui-pink-strong">
          {capMessage === null
            ? ""
            : capMessage > 0
              ? t(
                  lang,
                  "assetLibraryMaxPerDocumentFreeable",
                  String(ASSET_MAX_PER_DOCUMENT),
                  String(capMessage),
                )
              : t(lang, "assetLibraryMaxPerDocument", String(ASSET_MAX_PER_DOCUMENT))}
        </span>
      </div>
      <AssetLibrary
        lang={lang}
        assets={assets}
        usage={usage}
        danglingIds={danglingIds}
        busyId={busyId}
        onRename={rename}
        onDelete={remove}
        onUpload={(f) => void upload(f)}
      />
      <AssetLibraryModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onInsert={insertAssetById}
        lang={lang}
        assets={assets}
        usage={usage}
        danglingIds={danglingIds}
        busyId={busyId}
        onRename={rename}
        onDelete={remove}
        onUpload={(f) => void upload(f)}
      />
    </div>
  );
}
