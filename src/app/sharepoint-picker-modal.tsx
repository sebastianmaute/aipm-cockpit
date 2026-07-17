"use client";

import { useState } from "react";
import { Modal } from "./modal";
import { ModalHeader } from "./modal-header";
import { useDraggable } from "./use-draggable";
import { useResizable } from "./use-resizable";
import { t, type Lang } from "./i18n";
import { useSharePointBrowser, type AcquireToken } from "./use-sharepoint-browser";
import { parseSharePointSiteUrl } from "./sharepoint-backend";
import type { KnowledgeLink } from "./document-link";
import type { SiteRef, DriveRef } from "./sharepoint-graph";

export interface SharePointPickerModalProps {
  mode: "location" | "link";
  lang: Lang;
  acquireToken: AcquireToken;
  onSelect: (link: KnowledgeLink) => void;
  onClose: () => void;
}

interface ResultRowProps {
  item: KnowledgeLink;
  mode: "location" | "link";
  lang: Lang;
  onSelect: (link: KnowledgeLink) => void;
  onClose: () => void;
  openFolder: (link: KnowledgeLink) => void;
}

function ResultRow({ item, mode, lang, onSelect, onClose, openFolder }: ResultRowProps) {
  const isFolder = item.kind === "folder";

  function handleSelect() {
    onSelect(item);
    onClose();
  }

  return (
    <div className="flex items-center justify-between gap-2 rounded-md px-3 py-2 hover:bg-surface-muted">
      <span className="flex-1 truncate text-sm text-foreground">{item.name}</span>
      <div className="flex shrink-0 gap-2">
        {isFolder && (
          <button
            type="button"
            onClick={() => openFolder(item)}
            className="rounded px-2 py-1 text-xs font-medium text-AIPM-dark-blue ring-1 ring-line hover:bg-surface-muted focus:outline-none focus:ring-AIPM-green dark:text-AIPM-light-grey"
          >
            {t(lang, "spPickerOpenFolder")}
          </button>
        )}
        {isFolder && mode === "link" && (
          <button
            type="button"
            onClick={handleSelect}
            className="rounded bg-AIPM-dark-blue px-2 py-1 text-xs font-medium text-white hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-AIPM-green"
          >
            {t(lang, "spPickerUse")}
          </button>
        )}
        {!isFolder && (
          <button
            type="button"
            onClick={handleSelect}
            className="rounded bg-AIPM-dark-blue px-2 py-1 text-xs font-medium text-white hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-AIPM-green"
          >
            {t(lang, "spPickerSelectFile")}
          </button>
        )}
      </div>
    </div>
  );
}

export function SharePointPickerModal({
  mode,
  lang,
  acquireToken,
  onSelect,
  onClose,
}: SharePointPickerModalProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [pasteUrl, setPasteUrl] = useState("");
  const { offset, reset: dragReset, handleProps } = useDraggable(true, "aipm-cockpit:modal-pos:sharepoint");
  const { ref: sizeRef, reset: sizeReset } = useResizable("aipm-cockpit:modal-size:sharepoint");

  const {
    loading,
    error,
    searchForbidden,
    sites,
    drives,
    items,
    breadcrumb,
    searchSites,
    openSite,
    openDrive,
    openFolder,
    openSiteByPath,
  } = useSharePointBrowser(acquireToken);

  const title = t(lang, "spPickerTitle");

  function handleSearch() {
    if (searchQuery.trim()) {
      void searchSites(searchQuery.trim());
    }
  }

  function handleSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") handleSearch();
  }

  function handlePaste() {
    const loc = parseSharePointSiteUrl(pasteUrl.trim());
    if (!loc) return;
    void openSiteByPath(loc.hostname, loc.sitePath);
    setPasteUrl("");
  }

  function handlePasteKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") handlePaste();
  }

  const hasSites = sites.length > 0;
  const hasDrives = drives.length > 0;
  const hasItems = items.length > 0;
  const inDrive = breadcrumb.length > 0;
  const searchedButEmpty = !loading && !error && hasSites === false && hasDrives === false && !inDrive && searchQuery.trim() !== "";

  return (
    <Modal
      open
      onClose={onClose}
      ariaLabel={title}
      backdropClassName="bg-AIPM-dark-blue/40"
      zIndex={60}
    >
      <div
        ref={sizeRef}
        data-modal-panel
        className="flex w-[640px] min-w-[360px] max-w-[95vw] resize flex-col overflow-hidden rounded-lg border border-line bg-surface shadow-[var(--shadow-card)]"
        style={{ maxHeight: "80vh", transform: `translate(${offset.x}px, ${offset.y}px)` }}
      >
        <ModalHeader
          lang={lang}
          title={title}
          onClose={onClose}
          dragHandleProps={handleProps}
          onResetLayout={() => {
            dragReset();
            sizeReset();
          }}
        />

        <div className="flex flex-col gap-3 overflow-y-auto p-4">
          {/* Search row */}
          <div className="flex gap-2">
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder={t(lang, "spPickerSearchPlaceholder")}
              className="flex-1 rounded-md border border-line bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-AIPM-green"
            />
            <button
              type="button"
              onClick={handleSearch}
              className="rounded-md bg-AIPM-dark-blue px-4 py-2 text-sm font-medium text-white hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-AIPM-green"
            >
              {t(lang, "spPickerSearchButton")}
            </button>
          </div>

          {/* Paste URL row */}
          <div className="flex gap-2">
            <input
              type="text"
              value={pasteUrl}
              onChange={(e) => setPasteUrl(e.target.value)}
              onKeyDown={handlePasteKeyDown}
              placeholder={t(lang, "spPickerPasteUrl")}
              className="flex-1 rounded-md border border-line bg-surface px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-AIPM-green"
            />
            <button
              type="button"
              onClick={handlePaste}
              disabled={!pasteUrl.trim()}
              className="rounded-md border border-line px-3 py-2 text-sm text-AIPM-dark-blue hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-AIPM-green disabled:opacity-40 dark:text-AIPM-light-grey"
            >
              {t(lang, "spPickerOpenFolder")}
            </button>
          </div>

          {/* Results area */}
          <div className="min-h-[120px]">
            {searchForbidden && (
              <p className="mb-2 rounded-md bg-surface-muted px-3 py-2 text-sm text-AIPM-pink-strong">
                {t(lang, "spPickerSearchForbidden")}
              </p>
            )}

            {error && (
              <p className="py-4 text-center text-sm text-AIPM-pink-strong">{t(lang, error as Parameters<typeof t>[1])}</p>
            )}

            {loading && !error && (
              <p className="py-4 text-center text-sm text-muted-foreground">…</p>
            )}

            {!loading && !error && (
              <>
                {/* Breadcrumb */}
                {inDrive && (
                  <div className="mb-2 flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
                    {breadcrumb.map((crumb, i) => (
                      <span key={`${crumb.driveId}-${i}`} className="flex items-center gap-1">
                        {i > 0 && <span aria-hidden>/</span>}
                        <span>{crumb.name}</span>
                      </span>
                    ))}
                  </div>
                )}

                {/* Site list */}
                {hasSites && !hasDrives && !inDrive && (
                  <div className="flex flex-col gap-1">
                    {sites.map((site: SiteRef) => (
                      <button
                        key={site.id}
                        type="button"
                        onClick={() => void openSite(site)}
                        className="w-full rounded-md px-3 py-2 text-left text-sm text-foreground hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-AIPM-green"
                      >
                        {site.name}
                      </button>
                    ))}
                  </div>
                )}

                {/* Drive list */}
                {hasDrives && !inDrive && (
                  <div className="flex flex-col gap-1">
                    {drives.map((drive: DriveRef) => (
                      <button
                        key={drive.id}
                        type="button"
                        onClick={() => void openDrive(drive)}
                        className="w-full rounded-md px-3 py-2 text-left text-sm text-foreground hover:bg-surface-muted focus:outline-none focus:ring-2 focus:ring-AIPM-green"
                      >
                        {drive.name}
                      </button>
                    ))}
                  </div>
                )}

                {/* Items (folder contents) */}
                {inDrive && hasItems && (
                  <div className="flex flex-col gap-1">
                    {items.map((item: KnowledgeLink) => (
                      <ResultRow
                        key={item.id}
                        item={item}
                        mode={mode}
                        lang={lang}
                        onSelect={onSelect}
                        onClose={onClose}
                        openFolder={openFolder}
                      />
                    ))}
                  </div>
                )}

                {/* Empty states */}
                {inDrive && !hasItems && (
                  <p className="py-4 text-center text-sm text-muted-foreground">
                    {t(lang, "spPickerEmptyFolder")}
                  </p>
                )}

                {searchedButEmpty && (
                  <p className="py-4 text-center text-sm text-muted-foreground">
                    {t(lang, "spPickerEmptySites")}
                  </p>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </Modal>
  );
}
