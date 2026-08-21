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
import { ASSET_MIME_ALLOWED, ASSET_MAX_PER_DOCUMENT } from "./document-asset-upload";
import { assetIdsInDocument, countAssetUsage } from "./document-asset-usage";

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
  const projectId = assetPane?.projectId ?? "default";
  const assets = assetPane?.assets ?? EMPTY_ASSETS;
  const { upload, remove, rename, danglingIds, busyId, error } = useDocumentAssets({
    config: tursoConfig,
    assets,
    setAssets: assetPane?.setAssets ?? NOOP_SET_ASSETS,
    projectId,
  });

  const usage = useMemo(() => countAssetUsage(documents), [documents]);
  const [modalOpen, setModalOpen] = useState(false);
  const [capMessage, setCapMessage] = useState(false);
  const enabled = tursoConfig !== null && !isReadOnly;

  // ★ Enforced HERE (at insert), not by truncating on load — see the module
  // header's "never drop an over-cap image on load" rule.
  //
  // ★★ TAKES THE ASSET, NOT ITS ID. The paste/drop path calls this with the row
  // `upload` just resolved to, which by definition is NOT yet in this render's
  // `assets` closure — an id-keyed lookup here would find nothing and drop the
  // insert on the floor. `insertAssetById` below is the id-keyed wrapper the
  // picker (which only ever names an already-rendered row) uses.
  const insertAsset = useCallback(
    (asset: DocumentAsset) => {
      setCapMessage(false);
      if (!selected) return;
      const existing = assetIdsInDocument(selected);
      if (!existing.has(asset.id) && existing.size >= ASSET_MAX_PER_DOCUMENT) {
        setCapMessage(true);
        return;
      }
      // ★★★ `htmlEscape` IS LOAD-BEARING AND THE SANITIZER DOES NOT REPLACE IT.
      // `asset.name` is `file.name` verbatim on upload, free text via rename,
      // and fully attacker-controlled in an imported workspace
      // (`sanitizeDocumentAsset` keeps it as-is). Interpolated raw, a name of
      // `x"><a href="https://evil.test">Click here</a><img alt="` CLOSES the
      // img and opens an anchor — and `sanitizeDocumentHtml` then PASSES it,
      // because `a` is allow-listed and an `https:` href satisfies the URI
      // regexp. The result persists into `block.html` and rides into the
      // standalone-HTML/DOCX/PPTX exports. A name holding a plain `"` also just
      // truncates the alt. Escape at the seam; never ask a sanitizer to clean
      // up a string that was already malformed when it was built.
      const html = sanitizeDocumentHtml(
        `<img data-asset-id="${htmlEscape(asset.id)}" alt="${htmlEscape(asset.name)}">`,
      );
      structural.insert(selected.blocks.length, { type: "paragraph", html });
    },
    [selected, structural],
  );

  const insertAssetById = useCallback(
    (id: string) => {
      const asset = assets.find((a) => a.id === id);
      if (asset) insertAsset(asset);
    },
    [assets, insertAsset],
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
      for (const asset of uploaded) {
        if (asset) insertAsset(asset);
      }
    },
    [upload, insertAsset],
  );

  function handlePaste(e: ClipboardEvent<HTMLDivElement>) {
    if (!enabled) return;
    const files = Array.from(e.clipboardData?.files ?? []).filter((f) =>
      (ASSET_MIME_ALLOWED as readonly string[]).includes(f.type));
    if (!files.length) return;
    e.preventDefault();
    void uploadAndInsert(files);
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    if (!enabled) return;
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files).filter((f) =>
      (ASSET_MIME_ALLOWED as readonly string[]).includes(f.type));
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
        <span role="status" className="text-xs text-ui-pink">
          {error ? t(lang, UPLOAD_ERROR_KEY[error]) : ""}
        </span>
        <span role="status" className="text-xs text-ui-pink">
          {capMessage ? t(lang, "assetLibraryMaxPerDocument", String(ASSET_MAX_PER_DOCUMENT)) : ""}
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
