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
import { ExclamationTriangleIcon } from "./icons";
import { t, localeFor, type Lang } from "./i18n";
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

/** ★★★ ROW-UNIQUE accessible names (WCAG 2.4.6). The asset NAME alone is NOT
 *  unique and cannot be made so: upload takes `file.name` verbatim and Chrome
 *  names EVERY pasted clipboard image `image.png`; `findDuplicate` is
 *  hash-only, so two DIFFERENT images sharing a filename both get rows; and
 *  rename accepts a string already in use. Two rows reading "Delete –
 *  image.png" is a WCAG 2.4.6 failure that **axe cannot detect in any view at
 *  any seed size** (measured — see AGENTS.md), so `asset-library.test.tsx` is
 *  the only detector that will ever exist.
 *
 *  This returns id → the display TOKEN used in every one of that row's
 *  labels: a name unique in the rendered list is used BARE, and only rows
 *  actually sharing a name get a 1-based occurrence index.
 *
 *  ★★ THE DISAMBIGUATOR IS DELIBERATELY NOT THE ID. Ids are `crypto.randomUUID()`,
 *  so "Delete – image.png (3f2a…-…)" reads 36 characters of character-salad
 *  aloud on every control — trading a 2.4.6 failure for a usability regression
 *  hitting exactly the users 2.4.6 protects. It is also NOT a whole-list
 *  positional ordinal, which shifts under sorting. An occurrence index ranges
 *  only over the rows sharing one name and tells the user there are several
 *  and which one they are on. ★ Cross-MOUNT uniqueness is not required: the
 *  insert modal sets `aria-modal`, which hides the background copy from AT, and
 *  2.4.6 is about distinguishability within one context.
 *
 *  ★ ALL colliding rows are numbered, including the first — hearing a bare
 *  "image.png" would otherwise leave a user unable to tell "the only one" from
 *  "the first of several".
 *
 *  ★★ THE ESCALATION LOOP IS LOAD-BEARING, not defensive padding. Rename
 *  accepts ANY string, so a user can name a row literally "image.png (1)"; with
 *  two other rows called "image.png" the GENERATED token for the pair's first
 *  row would then collide with that row's BARE one — a disambiguator that
 *  re-creates the exact defect it exists to close. Bumping until the token set
 *  is free makes uniqueness hold BY CONSTRUCTION rather than by assumption. */
function buildRowTokens(rows: readonly DocumentAsset[]): Map<string, string> {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.name, (counts.get(row.name) ?? 0) + 1);

  const seen = new Map<string, number>();
  const used = new Set<string>();
  const tokens = new Map<string, string>();
  for (const row of rows) {
    let token = row.name;
    if ((counts.get(row.name) ?? 0) > 1) {
      const occurrence = (seen.get(row.name) ?? 0) + 1;
      seen.set(row.name, occurrence);
      token = `${row.name} (${occurrence})`;
    }
    if (used.has(token)) {
      let bump = 2;
      while (used.has(`${row.name} (${bump})`)) bump += 1;
      token = `${row.name} (${bump})`;
    }
    used.add(token);
    tokens.set(row.id, token);
  }
  return tokens;
}

/** ★ `verb` stays at the FRONT so the accessible name still CONTAINS each
 *  control's visible text (WCAG 2.5.3 — containment, case-insensitive, NOT
 *  prefix). axe's `label-content-name-mismatch` is `experimental` and excluded
 *  by the gate's default tagExclude, so that is unit-tested too. */
function rowLabel(verb: string, token: string): string {
  return `${verb} – ${token}`;
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
          {t(lang, "assetLibraryTotalSize", formatBytes(totalBytes, lang))}
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
              const token = rowTokens.get(asset.id) ?? asset.name;
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
                                hover-only chrome: a non-interactive,
                                non-focusable <span> with no text content
                                exposes no accessible name, so AT never
                                announces it and keyboard/touch can never reach
                                it. This sr-only text is the ONLY thing that
                                tells a screen-reader user the bytes are gone.
                                Deleting it makes a broken asset and a healthy
                                one indistinguishable to AT again. */}
                            <span className="sr-only">{t(lang, "assetLibraryDangling")}</span>
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
    </div>
  );
}
