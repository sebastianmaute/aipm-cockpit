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
  useCallback, useEffect, useMemo, useRef, useState,
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
  const { upload, remove, rename, danglingIds, busyId, error, lastId } = useDocumentAssets({
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
  const insertAsset = useCallback(
    (id: string) => {
      setCapMessage(false);
      if (!selected) return;
      const existing = assetIdsInDocument(selected);
      if (!existing.has(id) && existing.size >= ASSET_MAX_PER_DOCUMENT) {
        setCapMessage(true);
        return;
      }
      const asset = assets.find((a) => a.id === id);
      if (!asset) return;
      const html = sanitizeDocumentHtml(`<img data-asset-id="${id}" alt="${asset.name}">`);
      structural.insert(selected.blocks.length, { type: "paragraph", html });
    },
    [selected, assets, structural],
  );

  // ★★★ ARMED BY A PASTE/DROP-TRIGGERED UPLOAD so the resulting id — which
  // surfaces asynchronously via `lastId`, NOT via the `upload` promise (see
  // use-document-assets.ts's own note: "lets the modal mounting insert the
  // right asset without a second round trip") — is inserted the moment it
  // lands. `lastInsertedRef` stops a re-render from re-inserting the same id.
  const pendingInsertRef = useRef(false);
  const lastInsertedRef = useRef<string | null>(null);

  const uploadAndArm = useCallback(
    async (file: File) => {
      pendingInsertRef.current = true;
      await upload(file);
    },
    [upload],
  );

  // React to `lastId` landing after an armed paste/drop upload. Calling
  // `insertAsset` here is an ACTION (it calls through to documents-panel.tsx's
  // `mutate`), not a sync of this component's OWN state to a prop — the shape
  // `set-state-in-effect` bans — and is precedented by `useDocumentAssets`'s
  // own dangling-diff effect, which also calls a local setState from inside a
  // `useEffect`. A plain PICKER insert (`AssetLibraryModal`'s `onInsert`) goes
  // straight to `insertAsset` with no ref involved — this path exists only
  // because paste/drop's resulting id is not available until `upload`
  // resolves AND `lastId` re-renders this component.
  useEffect(() => {
    if (!pendingInsertRef.current || !lastId || lastId === lastInsertedRef.current) return;
    pendingInsertRef.current = false;
    lastInsertedRef.current = lastId;
    insertAsset(lastId);
  }, [lastId, insertAsset]);

  function handlePaste(e: ClipboardEvent<HTMLDivElement>) {
    if (!enabled) return;
    const files = Array.from(e.clipboardData?.files ?? []).filter((f) =>
      (ASSET_MIME_ALLOWED as readonly string[]).includes(f.type));
    if (!files.length) return;
    e.preventDefault();
    files.forEach((f) => void uploadAndArm(f));
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    if (!enabled) return;
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files).filter((f) =>
      (ASSET_MIME_ALLOWED as readonly string[]).includes(f.type));
    files.forEach((f) => void uploadAndArm(f));
  }

  if (!enabled) {
    return <EmptyState compact title={t(lang, "assetLibraryTursoOnly")} />;
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
      <div
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
        {error && (
          <span role="status" className="text-xs text-ui-pink">
            {t(lang, UPLOAD_ERROR_KEY[error])}
          </span>
        )}
        {capMessage && (
          <span role="status" className="text-xs text-ui-pink">
            {t(lang, "assetLibraryMaxPerDocument", String(ASSET_MAX_PER_DOCUMENT))}
          </span>
        )}
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
        onInsert={insertAsset}
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
