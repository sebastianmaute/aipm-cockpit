"use client";

// src/app/asset-library-modal.tsx — the INSERT mounting of AssetLibrary.
//
// ★ The library itself is unchanged between mountings; this file adds only the
// Modal chrome and the close-on-insert wrapper. Two mountings of one component
// is the whole point — a separate "picker" would drift from the manager on
// usage counts, rename and the dangling marker. Mirrors
// `documents-history-modal.tsx`'s shape (a plain `Modal` + `data-modal-panel`
// + `ModalHeader`, non-draggable, non-resizable) — no primitive is hand-rolled.

import { Modal } from "./modal";
import { ModalHeader } from "./modal-header";
import { AssetLibrary, type AssetLibraryProps } from "./asset-library";
import { t } from "./i18n";

const ASSET_LIBRARY_TITLE_ID = "asset-library-modal-title";

export interface AssetLibraryModalProps extends AssetLibraryProps {
  open: boolean;
  onClose: () => void;
  onInsert: (id: string) => void;
}

export function AssetLibraryModal({ open, onClose, onInsert, ...rest }: AssetLibraryModalProps) {
  if (!open) return null;

  return (
    // `Modal` owns dismissal (Escape/backdrop/focus-trap via the shared
    // dismissal-stack) — see docs/AGENTS/ui-shell.md before touching any of
    // that. `ariaLabelledby` over `ariaLabel` so the dialog's accessible name
    // IS the heading a sighted user reads, and the two cannot drift.
    <Modal open onClose={onClose} ariaLabelledby={ASSET_LIBRARY_TITLE_ID} align="center">
      <div
        data-modal-panel
        className="relative flex max-h-[85vh] w-[720px] max-w-[95vw] flex-col overflow-hidden rounded-xl border border-line bg-surface"
      >
        <ModalHeader
          lang={rest.lang}
          title={t(rest.lang, "assetLibraryTitle")}
          titleId={ASSET_LIBRARY_TITLE_ID}
          onClose={onClose}
        />
        <div className="min-h-0 flex-1 overflow-auto p-6">
          <AssetLibrary
            {...rest}
            onInsert={(id) => {
              // ★★ Insert must CLOSE the modal — leaving it open puts the
              // dialog over the paragraph the user just changed, so they
              // cannot see the result of their own action.
              onInsert(id);
              onClose();
            }}
          />
        </div>
      </div>
    </Modal>
  );
}
