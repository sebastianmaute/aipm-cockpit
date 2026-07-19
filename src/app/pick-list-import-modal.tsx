"use client";

// Presentational shell for the Outlook pick-list import modals (contacts /
// calendar). Owns the identical Modal chrome the two shared verbatim: sticky
// header + close IconButton, the loading/error/empty body states, the select-all
// row, and the Cancel/Confirm footer. The caller passes pre-translated strings
// (i18n keys differ per modal) and renders the per-row `<li>` list as `children`,
// since row content genuinely diverges (contact name+email vs event+date+type).

import { type ReactNode } from "react";
import { XMarkIcon } from "@heroicons/react/24/outline";
import { Banner } from "./banner";
import { Button } from "./button";
import { Modal } from "./modal";
import { IconButton } from "./icon-button";
import { Checkbox } from "./form-controls";

export function PickListImportModal({
  open,
  onClose,
  ariaLabel,
  title,
  cancelLabel,
  confirmLabel,
  loading,
  error,
  isEmpty,
  loadingText,
  emptyText,
  selectAllLabel,
  selectedText,
  allChecked,
  onToggleAll,
  selectedCount,
  onConfirm,
  maxWidthClass = "max-w-lg",
  children,
}: {
  open: boolean;
  onClose: () => void;
  ariaLabel: string;
  title: string;
  cancelLabel: string;
  confirmLabel: string;
  loading: boolean;
  error: string | null;
  isEmpty: boolean;
  loadingText: string;
  emptyText: string;
  selectAllLabel: string;
  selectedText: string;
  allChecked: boolean;
  onToggleAll: () => void;
  selectedCount: number;
  onConfirm: () => void;
  /** Tailwind max-width for the panel (contacts "max-w-lg", calendar "max-w-xl"). */
  maxWidthClass?: string;
  /** The `<li>` rows for the pick list. */
  children: ReactNode;
}) {
  return (
    <Modal open={open} onClose={onClose} ariaLabel={ariaLabel} align="center" zIndex={50}>
      <div className={`flex max-h-[80vh] w-full ${maxWidthClass} flex-col overflow-hidden rounded-xl border border-line bg-surface`}>
        <header className="sticky top-0 z-10 flex shrink-0 items-center justify-between gap-4 border-b border-line bg-surface px-6 py-4">
          <h2 className="text-lg font-semibold text-ui-dark-blue dark:text-ui-light-grey">{title}</h2>
          <IconButton size="md" onClick={onClose} label={cancelLabel}>
            <XMarkIcon aria-hidden="true" className="h-4 w-4" />
          </IconButton>
        </header>

        <div className="min-h-0 flex-1 overflow-auto p-4">
          {loading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">{loadingText}</p>
          ) : error ? (
            <Banner severity="error">{error}</Banner>
          ) : isEmpty ? (
            <p className="py-8 text-center text-sm text-muted-foreground">{emptyText}</p>
          ) : (
            <>
              <label className="mb-2 flex items-center gap-2 border-b border-line pb-2 text-sm font-medium text-foreground">
                <Checkbox checked={allChecked} onChange={onToggleAll} aria-label={selectAllLabel} />
                <span>{selectAllLabel}</span>
                <span className="ml-auto text-xs text-muted-foreground">{selectedText}</span>
              </label>
              <ul className="space-y-1">{children}</ul>
            </>
          )}
        </div>

        <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-line px-6 py-3">
          <Button variant="secondary" size="sm" onClick={onClose}>
            {cancelLabel}
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={onConfirm}
            disabled={selectedCount === 0 || loading || !!error}
          >
            {confirmLabel}
          </Button>
        </footer>
      </div>
    </Modal>
  );
}
