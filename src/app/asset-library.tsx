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

import { useMemo, useState, type DragEvent } from "react";
import { ExclamationTriangleIcon } from "@heroicons/react/24/outline";
import { t, type Lang } from "./i18n";
import type { DocumentAsset } from "./document-asset";
import { ASSET_MIME_ALLOWED } from "./document-asset-upload";
import { DataTable } from "./data-table";
import { EmptyState } from "./empty-state";
import { Button } from "./button";
import { Input } from "./form-controls";
import { FilePickerButton } from "./file-picker-button";
import { type SortDir, SortResizeTh, compareStrOrNum, nextSortDir } from "./report-table";
import { useConfirm } from "./confirm-dialog";

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
}

type AssetSortKey = "name" | "size";

/** Disclosure only — there is no per-workspace cap to check against. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
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
}: AssetLibraryProps) {
  const confirm = useConfirm();
  const [sort, setSort] = useState<{ key: AssetSortKey; dir: SortDir }>({ key: "name", dir: "off" });
  // In-place rename draft. `onRename` takes the new name directly — there is
  // no separate rename modal, so the edit state lives here.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState("");

  const totalBytes = useMemo(() => assets.reduce((sum, a) => sum + a.size, 0), [assets]);

  const sorted = useMemo(() => {
    if (sort.dir === "off") return assets;
    const cmp = (a: DocumentAsset, b: DocumentAsset) =>
      sort.key === "name" ? compareStrOrNum(a.name, b.name) : compareStrOrNum(a.size, b.size);
    const out = [...assets].sort((a, b) => (sort.dir === "desc" ? -cmp(a, b) : cmp(a, b)));
    return out;
  }, [assets, sort]);

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

  return (
    <div
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
      className="flex flex-col gap-2"
    >
      <div className="flex flex-wrap items-center gap-2">
        <FilePickerButton
          label={t(lang, "upload")}
          accept={ASSET_MIME_ALLOWED.join(",")}
          onFile={onUpload}
          disabled={busyId !== null}
        />
        {/* Disclosure only — no per-workspace cap is enforced. */}
        <span className="text-xs text-muted-foreground">
          {t(lang, "assetLibraryTotalSize", formatBytes(totalBytes))}
        </span>
      </div>

      {assets.length === 0 ? (
        <EmptyState title={t(lang, "assetLibraryEmpty")} />
      ) : (
        <div className="overflow-auto rounded-md border border-line">
          <DataTable
            tbodyClassName="divide-y divide-line"
            head={
              <tr>
                {/* No `onResize` — this component stores no column widths. */}
                <SortResizeTh
                  label={t(lang, "name")}
                  sortCol="name"
                  sortKey={sort.key}
                  sortDir={sort.dir}
                  onSort={onSort}
                />
                <SortResizeTh
                  label={t(lang, "assetLibrarySize")}
                  sortCol="size"
                  sortKey={sort.key}
                  sortDir={sort.dir}
                  onSort={onSort}
                  align="right"
                />
                <th className="px-3 py-2 font-medium">{t(lang, "assetLibraryUsage")}</th>
                <th className="px-3 py-2 font-medium">
                  <span className="sr-only">{t(lang, "assetLibraryActions")}</span>
                </th>
              </tr>
            }
          >
            {sorted.map((asset) => {
              const isDangling = danglingIds.has(asset.id);
              const isBusy = busyId === asset.id;
              const isEditing = editingId === asset.id;
              return (
                <tr key={asset.id}>
                  <td className="px-3 py-2 font-medium text-foreground">
                    <div className="flex items-center gap-1">
                      {/* Fixed-width gutter so a dangling row's marker never
                          shifts this row's controls relative to a healthy
                          one above/below it — the marker itself is only IN
                          the DOM when this asset is dangling. */}
                      <span
                        title={isDangling ? t(lang, "assetLibraryDangling") : undefined}
                        className="inline-block w-4 shrink-0"
                      >
                        {isDangling && (
                          <span
                            data-dangling-marker
                            aria-hidden="true"
                            className="text-ui-pink-strong"
                          >
                            <ExclamationTriangleIcon className="h-3.5 w-3.5" />
                          </span>
                        )}
                      </span>
                      {isEditing ? (
                        <Input
                          value={draftName}
                          onChange={(e) => setDraftName(e.target.value)}
                          aria-label={`${t(lang, "rename")} – ${asset.name}`}
                          autoFocus
                        />
                      ) : (
                        <span>{asset.name}</span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                    {formatBytes(asset.size)}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-muted-foreground">
                    {usage[asset.id] ?? 0}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap items-center gap-1">
                      {onInsert && (
                        <Button
                          variant="secondary"
                          size="xs"
                          disabled={isBusy}
                          onClick={() => onInsert(asset.id)}
                          aria-label={`${t(lang, "insert")} – ${asset.name}`}
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
                            aria-label={`${t(lang, "confirm")} – ${asset.name}`}
                          >
                            {t(lang, "confirm")}
                          </Button>
                          <Button
                            variant="secondary"
                            size="xs"
                            onClick={() => setEditingId(null)}
                            aria-label={`${t(lang, "cancel")} – ${asset.name}`}
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
                          aria-label={`${t(lang, "rename")} – ${asset.name}`}
                        >
                          {t(lang, "rename")}
                        </Button>
                      )}
                      <Button
                        variant="destructive"
                        size="xs"
                        disabled={isBusy}
                        onClick={() => handleDelete(asset)}
                        aria-label={`${t(lang, "delete")} – ${asset.name}`}
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
    </div>
  );
}
