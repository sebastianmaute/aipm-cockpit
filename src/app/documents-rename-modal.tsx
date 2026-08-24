"use client";

// src/app/documents-rename-modal.tsx — the rename-document floating modal.
//
// Pure presentational: draft/commit/cancel are threaded from documents-panel,
// which owns `renaming`, `setRenaming` and `commitRename`. Extracted from
// documents-panel.tsx to keep it clear of the 800-line file-size ratchet
// (open-followups §220).

import { type Lang, t } from "./i18n";
import { Modal } from "./modal";
import { ModalHeader } from "./modal-header";
import { Button } from "./button";
import { Input } from "./form-controls";

const RENAME_TITLE_ID = "documents-rename-title";

export interface DocumentsRenameModalProps {
  lang: Lang;
  /** The in-flight title text. */
  draft: string;
  onDraftChange: (next: string) => void;
  onCancel: () => void;
  onCommit: () => void;
}

export function DocumentsRenameModal({
  lang,
  draft,
  onDraftChange,
  onCancel,
  onCommit,
}: DocumentsRenameModalProps) {
  return (
    <Modal open onClose={onCancel} ariaLabelledby={RENAME_TITLE_ID} align="center">
      <div
        data-modal-panel
        className="relative flex w-[420px] max-w-[95vw] flex-col overflow-hidden rounded-xl border border-line bg-surface"
      >
        <ModalHeader
          lang={lang}
          title={t(lang, "documentsRename")}
          titleId={RENAME_TITLE_ID}
          onClose={onCancel}
        />
        <div className="flex flex-col gap-4 p-6">
          <label className="flex flex-col gap-1 text-sm text-foreground">
            {/* A visible <label> IS the accessible name — a placeholder is
                not, and a placeholder-only input fails the axe gate even
                though it looks labeled. */}
            {t(lang, "documentsTitleLabel")}
            <Input
              autoFocus
              value={draft}
              onChange={(e) => onDraftChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.nativeEvent.isComposing) onCommit();
              }}
            />
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={onCancel}>
              {t(lang, "cancel")}
            </Button>
            <Button variant="primary" size="sm" onClick={onCommit}>
              {t(lang, "documentsRename")}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
