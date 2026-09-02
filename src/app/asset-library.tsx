"use client";

// src/app/asset-library.tsx — the shared document-image library.
//
// PURE presentational (the gantt/documents-list split): takes assets, usage
// counts, a dangling-id set and callbacks, and owns no storage. Mounted twice
// (an inline management section, and inside the block editor's insert modal)
// — the two mounting orchestrators own persistence; this component owns only
// its own transient UI state (sort order, the in-place rename draft).
//
// ★★ Delete is confirm-gated INSIDE this component, not by the mounting
// caller — the confirm message needs the usage count, and this is the one
// place that already holds both `assets` and `usage` together. Confirm marks
// the metadata + byte rows for removal; it does NOT rewrite any document's
// blocks. An asset delete is not a document mutation: `applyDocMutation`
// never fires, no version before-image is captured, and a cascade that
// stripped blocks referencing this id would be unrecoverable. The mounting
// caller's `onDelete` is expected to do exactly that — remove the asset and
// nothing else — and leave any resulting broken image for the document
// editor to surface.

import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { ExclamationTriangleIcon, EyeSlashIcon } from "./icons";
import { t, localeFor, type Lang } from "./i18n";
import type { DocumentAsset } from "./document-asset";
import { ASSET_MIME_ALLOWED, isBlockedAssetMime } from "./document-asset-upload";
import { DataTable } from "./data-table";
import { AddFirstItemButton } from "./add-first-item-button";
import { useFilePicker } from "./use-file-picker";
import { Button } from "./button";
import { Input } from "./form-controls";
import { FilePickerButton } from "./file-picker-button";
import { type SortDir, SortResizeTh, useSortHeaderProps, compareStrOrNum, nextSortDir } from "./report-table";
import { useConfirm } from "./confirm-dialog";
import { buildRowTokens, rowLabel } from "./row-tokens";
import { AssetPreviewModal } from "./asset-preview-modal";
import type { AssetByteLoader } from "./document-asset-images";

export interface AssetLibraryProps {
  lang: Lang;
  assets: readonly DocumentAsset[];
  /** id → number of documents whose blocks reference it. */
  usage: Readonly<Record<string, number>>;
  /** Ids whose metadata exists but whose bytes do not — the dangling case. */
  danglingIds: ReadonlySet<string>;
  /** Id currently mid-write; that row's controls disable, others stay live. */
  busyId: string | null;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  /** Absent in the management mounting — no insert control renders then. */
  onInsert?: (id: string) => void;
  onUpload: (file: File) => void;
  /** Injected byte loader (`documents-asset-section.tsx` builds it from the
   *  pane's own already-normalised Turso config + project id). Absent → no
   *  preview control renders — there would be nothing for it to show, and
   *  Turso gating is INHERITED from the call site rather than re-checked
   *  here. */
  loadImage?: AssetByteLoader;
}

type AssetSortKey = "name" | "size";

/** Disclosure only — there is no per-workspace cap to check against.
 *
 *  ★★ LOCALE-FORMATTED, and it has to be: `toFixed(1)` hard-codes a `.`, so
 *  German rendered "3.0 KB" where "3,0 KB" is correct. `Intl.NumberFormat`
 *  owns the separator — never hand-swap it, and never reach for `toFixed`
 *  here again. Both branches go through Intl so the grouping separator is
 *  localised too (de "1.023 B", en "1,023 B"). */
function formatBytes(bytes: number, lang: Lang): string {
  const locale = localeFor(lang);
  if (bytes < 1024) return `${new Intl.NumberFormat(locale).format(bytes)} B`;
  const kb = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(bytes / 1024);
  return `${kb} KB`;
}

export function AssetLibrary({
  lang,
  assets,
  usage,
  danglingIds,
  busyId,
  onRename,
  onDelete,
  onInsert,
  onUpload,
  loadImage,
}: AssetLibraryProps) {
  const confirm = useConfirm();
  // Index into `sorted` of the asset currently open in the preview lightbox;
  // `null` means closed. Kept as an index rather than an id so "next"/"prev"
  // inside AssetPreviewModal walk the SAME order these rows render in.
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  // ★★ ONE derivation, TWO pickers. This pane mounts two independent file
  // dialogs — the toolbar `FilePickerButton` and, on the empty branch, the
  // dashed box's own hidden input — and they must agree on what they accept
  // and when they are inert. Both sites below read THESE bindings; keep it
  // that way.
  const pickerAccept = ASSET_MIME_ALLOWED.join(",");
  // ★★ UNREACHABLE TODAY, AND DELIBERATELY KEPT. `useDocumentAssets` commits
  // the metadata row BEFORE it sets `busyId` (see its "METADATA FIRST" note),
  // and React batches the pair — so `assets` is never empty while `busyId` is
  // set, and the empty branch holding the box is already unmounted. The
  // argument is defence against that ordering being reversed. ★★★ IF IT EVER
  // IS, THIS IS NOT ENOUGH: `AddFirstItemButton` has no `disabled` prop, so
  // the box would render fully live while its input is disabled and the click
  // would be a silent no-op. Give the box a disabled state before relying on
  // this flag reaching it.
  const pickerDisabled = busyId !== null;
  // ★ The empty-state box's OWN picker, distinct from the toolbar
  // FilePickerButton's.
  const boxPicker = useFilePicker(onUpload, pickerAccept, pickerDisabled);
  const [sort, setSort] = useState<{ key: AssetSortKey; dir: SortDir }>({ key: "name", dir: "off" });
  // In-place rename draft. `onRename` takes the new name directly — there is
  // no separate rename modal, so the edit state lives here.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");

  // ★★ WCAG 2.4.3 (focus order). Leaving rename mode UNMOUNTS the Confirm or
  // Cancel button the user is standing on, and an unmounted focus owner drops
  // focus to <body> — a keyboard or screen-reader user is thrown to the top of
  // the document after every rename. `autoFocus` on the Input covers entering
  // the mode; nothing covered leaving it. Both exits record the row here and
  // the effect below hands focus back to the Rename button that opened the
  // mode, the same "focus moves with the element" rule the block editor's drag
  // handle follows.
  const renameButtons = useRef(new Map<string, HTMLButtonElement>());
  const restoreFocusId = useRef<string | null>(null);

  useEffect(() => {
    if (editingId !== null) return;
    const id = restoreFocusId.current;
    if (id === null) return;
    restoreFocusId.current = null;
    // Refs attach during commit, before passive effects — so the freshly
    // remounted Rename button is already in the map by the time we read it.
    renameButtons.current.get(id)?.focus();
  }, [editingId]);

  const totalBytes = useMemo(() => assets.reduce((sum, a) => sum + a.size, 0), [assets]);

  const sorted = useMemo(() => {
    if (sort.dir === "off") return assets;
    const cmp = (a: DocumentAsset, b: DocumentAsset) =>
      sort.key === "name" ? compareStrOrNum(a.name, b.name) : compareStrOrNum(a.size, b.size);
    const out = [...assets].sort((a, b) => (sort.dir === "desc" ? -cmp(a, b) : cmp(a, b)));
    return out;
  }, [assets, sort]);

  // ★★★ ROW-UNIQUE accessible names (WCAG 2.4.6) — see row-tokens.ts for the
  // disambiguation algorithm's own rationale. The asset NAME alone is NOT
  // unique here and cannot be made so: upload takes `file.name` verbatim and
  // Chrome names EVERY pasted clipboard image `image.png`; `findDuplicate` is
  // hash-only, so two DIFFERENT images sharing a filename both get rows; and
  // rename accepts a string already in use. Two rows reading "Delete –
  // image.png" is a WCAG 2.4.6 failure that axe cannot detect in any view at
  // any seed size (measured — see AGENTS.md), so `asset-library.test.tsx` is
  // the only detector that will ever exist for this surface.
  //
  // Derived from `sorted`, not `assets` — the occurrence index has to follow
  // the order the user is actually navigating.
  const rowTokens = useMemo(() => buildRowTokens(sorted), [sorted]);

  function onSort(key: AssetSortKey) {
    setSort((prev) => (prev.key === key ? { key, dir: nextSortDir(prev.dir) } : { key, dir: "asc" }));
  }

  function startRename(asset: DocumentAsset) {
    setEditingId(asset.id);
    setDraftName(asset.name);
  }

  function commitRename(asset: DocumentAsset) {
    const trimmed = draftName.trim();
    if (trimmed && trimmed !== asset.name) onRename(asset.id, trimmed);
    restoreFocusId.current = asset.id;
    setEditingId(null);
  }

  function cancelRename(asset: DocumentAsset) {
    restoreFocusId.current = asset.id;
    setEditingId(null);
  }

  async function handleDelete(asset: DocumentAsset) {
    const count = usage[asset.id] ?? 0;
    const message =
      count > 0
        ? t(lang, "assetLibraryDeleteConfirmUsed", asset.name, count)
        : t(lang, "assetLibraryDeleteConfirm", asset.name);
    if (await confirm({ message })) onDelete(asset.id);
  }

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    Array.from(e.dataTransfer.files).forEach((file) => onUpload(file));
  }

  const th = useSortHeaderProps(sort.key, sort.dir, onSort);

  return (
    <div
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
      className="flex flex-col gap-2"
    >
      <div className="flex flex-wrap items-center gap-2">
        <FilePickerButton
          label={t(lang, "upload")}
          accept={pickerAccept}
          onFile={onUpload}
          disabled={pickerDisabled}
        />
        {/* Disclosure only — no per-workspace cap is enforced. */}
        <span className="text-xs text-muted-foreground">
          {t(lang, "assetLibraryTotalSize", formatBytes(totalBytes, lang))}
        </span>
      </div>

      {assets.length === 0 ? (
        <>
          <AddFirstItemButton
            onAdd={boxPicker.open}
            text={t(lang, "assetLibraryEmpty")}
            addLabel={`+ ${t(lang, "assetLibraryUploadFirst")}…`}
            ariaLabel={t(lang, "assetLibraryUploadFirst")}
            rounded="xl"
          />
          <input {...boxPicker.inputProps} />
        </>
      ) : (
        <div className="overflow-auto rounded-md border border-line">
          <DataTable
            tbodyClassName="divide-y divide-line"
            head={
              <tr>
                {/* No `onResize` — this component stores no column widths. */}
                <SortResizeTh
                  {...th}
                  label={t(lang, "name")}
                  sortCol="name"
                />
                <SortResizeTh
                  {...th}
                  label={t(lang, "assetLibrarySize")}
                  sortCol="size"
                  align="right"
                />
                <th className="px-3 py-2 font-medium">{t(lang, "assetLibraryUsage")}</th>
                <th className="px-3 py-2 font-medium">
                  <span className="sr-only">{t(lang, "assetLibraryActions")}</span>
                </th>
              </tr>
            }
          >
            {sorted.map((asset, index) => {
              const token = rowTokens.get(asset.id) ?? asset.name;
              const isDangling = danglingIds.has(asset.id);
              // §230 — a refused mime is NOT dangling: the byte row exists, so
              // the diff that builds `danglingIds` will never flag it. Derived
              // from metadata here because that is the only place the mime is
              // visible. Dangling takes precedence: missing bytes is the more
              // actionable of the two, and a row cannot usefully say both.
              const isBlocked = !isDangling && isBlockedAssetMime(asset.mime);
              const isBusy = busyId === asset.id;
              const isEditing = editingId === asset.id;
              return (
                <tr key={asset.id}>
                  <td className="px-3 py-2 font-medium text-foreground">
                    <div className="flex items-center gap-1">
                      {/* Fixed-width gutter holding whichever of the two
                          markers applies — dangling bytes, or a stored mime
                          the upload policy no longer accepts. At most one is
                          ever in the DOM, and the gutter's FIXED width is
                          what stops a marked row from shifting its own
                          controls relative to an unmarked row above or below
                          it. */}
                      <span
                        title={
                          isDangling
                            ? t(lang, "assetLibraryDangling")
                            : isBlocked
                              ? t(lang, "assetLibraryBlocked")
                              : undefined
                        }
                        className="inline-block w-4 shrink-0"
                      >
                        {isDangling && (
                          <>
                            <span
                              data-dangling-marker
                              aria-hidden="true"
                              className="text-ui-pink-strong"
                            >
                              <ExclamationTriangleIcon className="h-3.5 w-3.5" />
                            </span>
                            {/* ★★ WCAG 1.4.1 — the glyph is the non-colour cue
                                for SIGHTED users, and the `title` above is
                                hover-only chrome: it is unreachable by
                                keyboard and by touch, so it can never be the
                                sole carrier of a state. This sr-only text is
                                what tells a screen-reader user the bytes are
                                gone. Deleting it makes a broken asset and a
                                healthy one indistinguishable to AT again.
                                ★★ DO NOT RESTORE THE OLD JUSTIFICATION, which
                                said this was "a non-focusable <span> with no
                                text content" that "exposes no accessible
                                name". That is false about the element it
                                describes: the `title` sits on the OUTER gutter
                                span, and this sr-only span is its CHILD, so
                                that span is not contentless. The premise was
                                wrong; the conclusion — keep the sr-only text —
                                is right for the reason above. */}
                            <span className="sr-only">{t(lang, "assetLibraryDangling")}</span>
                          </>
                        )}
                        {isBlocked && (
                          <>
                            <span
                              data-blocked-marker
                              aria-hidden="true"
                              className="text-ui-pink-strong"
                            >
                              {/* ★★ A DIFFERENT GLYPH FROM THE DANGLING ONE, AND
                                  THAT IS THE POINT. Both states share a colour,
                                  so the SHAPE is the only channel telling a
                                  sighted user which of the two this row is —
                                  give them the same triangle and the library
                                  reproduces, one pane over, the very
                                  can't-tell-these-apart defect §230 was filed
                                  for. Colour is deliberately NOT the
                                  discriminator (WCAG 1.4.1); an eye-slash reads
                                  as "cannot be shown", which is exactly this
                                  state — the bytes are intact, the format is
                                  not one we will render. */}
                              <EyeSlashIcon className="h-3.5 w-3.5" />
                            </span>
                            {/* ★★ Same rule as the dangling text above, for the
                                same reason: the glyph is the non-colour cue for
                                SIGHTED users and the `title` is hover-only
                                chrome that AT never announces and keyboard or
                                touch can never reach, so this sr-only text is
                                the ONLY thing telling a screen-reader user the
                                stored format is no longer supported. §230 —
                                deliberately DISCLOSURE ONLY: no re-upload
                                affordance, because a healthy duplicate matched
                                by content hash returns early without a metadata
                                write, so the stale mime would never be
                                corrected and the button would silently do
                                nothing. */}
                            <span className="sr-only">{t(lang, "assetLibraryBlocked")}</span>
                          </>
                        )}
                      </span>
                      {isEditing ? (
                        <Input
                          value={draftName}
                          onChange={(e) => setDraftName(e.target.value)}
                          aria-label={rowLabel(t(lang, "rename"), token)}
                          autoFocus
                        />
                      ) : (
                        <span>{asset.name}</span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                    {formatBytes(asset.size, lang)}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-muted-foreground">
                    {usage[asset.id] ?? 0}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap items-center gap-1">
                      {/* ★ Read-only: never gated on `isBusy` (a rename/delete
                          in flight on this row) or on the caller's own
                          read-only state — it mutates nothing, so it stays
                          available in a read-only popout and while this row
                          is mid-write. */}
                      {loadImage && (
                        <Button
                          variant="secondary"
                          size="xs"
                          onClick={() => setPreviewIndex(index)}
                          // ★★★ THE ACCESSIBLE NAME IS COMPOSED FROM THE
                          // VISIBLE-TEXT KEY, AND THAT IS THE WHOLE POINT. This
                          // read `t(lang, "assetPreviewOpen", token)` — an
                          // independently authored key — and that SHIPPED A
                          // WCAG 2.5.3 (label in name) FAILURE IN GERMAN: the
                          // visible label is `documentsPreview` = "Vorschau"
                          // while `assetPreviewOpen` = "Bild anzeigen – {0}",
                          // which contains no such word, so a German speech-
                          // input user saying the label they can see could not
                          // activate this control. EN passed only by
                          // coincidence ("Preview" ⊂ "Preview image – …").
                          // Composing the name from the same key that renders
                          // the text makes containment STRUCTURAL — true in
                          // every language, and not defeatable by a future
                          // translation of either string. `SortResizeTh` builds
                          // its header names from `label` for exactly this
                          // reason, and `documents-history-modal.tsx` spells
                          // this same pair one file over.
                          // ★★ No gate in this repo can see a regression here:
                          // axe's `label-content-name-mismatch` is tagged
                          // `experimental` and axe's default tagExclude drops
                          // it, and this surface is Turso-gated so the a11y
                          // gate never renders it at all. The DE containment
                          // test in `asset-library.test.tsx` is the only
                          // detector that will ever exist — an EN-only test
                          // passes against the broken code.
                          aria-label={`${t(lang, "documentsPreview")} – ${token}`}
                        >
                          {t(lang, "documentsPreview")}
                        </Button>
                      )}
                      {onInsert && (
                        <Button
                          variant="secondary"
                          size="xs"
                          disabled={isBusy}
                          onClick={() => onInsert(asset.id)}
                          aria-label={rowLabel(t(lang, "insert"), token)}
                        >
                          {t(lang, "insert")}
                        </Button>
                      )}
                      {isEditing ? (
                        <>
                          <Button
                            variant="secondary"
                            size="xs"
                            onClick={() => commitRename(asset)}
                            aria-label={rowLabel(t(lang, "confirm"), token)}
                          >
                            {t(lang, "confirm")}
                          </Button>
                          <Button
                            variant="secondary"
                            size="xs"
                            onClick={() => cancelRename(asset)}
                            aria-label={rowLabel(t(lang, "cancel"), token)}
                          >
                            {t(lang, "cancel")}
                          </Button>
                        </>
                      ) : (
                        <Button
                          variant="secondary"
                          size="xs"
                          disabled={isBusy}
                          onClick={() => startRename(asset)}
                          aria-label={rowLabel(t(lang, "rename"), token)}
                          ref={(el) => {
                            const map = renameButtons.current;
                            if (el) map.set(asset.id, el);
                            else map.delete(asset.id);
                          }}
                        >
                          {t(lang, "rename")}
                        </Button>
                      )}
                      <Button
                        variant="destructive"
                        size="xs"
                        disabled={isBusy}
                        onClick={() => handleDelete(asset)}
                        aria-label={rowLabel(t(lang, "delete"), token)}
                      >
                        {t(lang, "delete")}
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </DataTable>
        </div>
      )}
      {/* Always mounted while `loadImage` is supplied, never conditionally on
          `previewIndex` — `Modal` itself returns null while `open` is false,
          and `AssetPreviewModal`'s own re-seed-on-reopen logic depends on
          staying mounted across opens. No loader ⇒ nothing to show. */}
      {loadImage && (
        <AssetPreviewModal
          lang={lang}
          open={previewIndex !== null}
          onClose={() => setPreviewIndex(null)}
          assets={sorted}
          startIndex={previewIndex ?? 0}
          loadImage={loadImage}
        />
      )}
    </div>
  );
}
