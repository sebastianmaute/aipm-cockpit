// src/app/outlook-import-modal.tsx
"use client";

import { type Lang, t } from "./i18n";
import { Checkbox } from "./form-controls";
import type { OutlookContact } from "./outlook-contacts";
import { useImportSelection } from "./use-import-selection";
import { PickListImportModal } from "./pick-list-import-modal";

export interface OutlookImportModalProps {
  lang: Lang;
  open: boolean;
  loading: boolean;
  /** Pre-translated error message; null when none. */
  error: string | null;
  contacts: OutlookContact[];
  /** Normalized (lower-case) emails already present in the directory. */
  existingEmails: ReadonlySet<string>;
  onConfirm: (selected: OutlookContact[]) => void;
  onClose: () => void;
}

const contactId = (c: OutlookContact) => c.sourceId;

export function OutlookImportModal({
  lang,
  open,
  loading,
  error,
  contacts,
  existingEmails,
  onConfirm,
  onClose,
}: OutlookImportModalProps) {
  const sel = useImportSelection(contacts, contactId);

  return (
    <PickListImportModal
      open={open}
      onClose={onClose}
      ariaLabel={t(lang, "outlookImportTitle")}
      title={t(lang, "outlookImportTitle")}
      cancelLabel={t(lang, "outlookImportCancel")}
      confirmLabel={t(lang, "outlookImportConfirm", sel.selectedCount)}
      loading={loading}
      error={error}
      isEmpty={contacts.length === 0}
      loadingText={t(lang, "outlookImportLoading")}
      emptyText={t(lang, "outlookImportEmpty")}
      selectAllLabel={t(lang, "outlookImportSelectAll")}
      selectedText={t(lang, "outlookImportSelectedN", sel.selectedCount)}
      allChecked={sel.allChecked}
      onToggleAll={sel.toggleAll}
      selectedCount={sel.selectedCount}
      onConfirm={() => onConfirm(sel.selected())}
      maxWidthClass="max-w-lg"
    >
      {contacts.map((c) => {
        const exists = c.email !== "" && existingEmails.has(c.email);
        const label = c.displayName || c.email || c.sourceId;
        return (
          <li key={c.sourceId}>
            <label className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-surface-muted">
              <Checkbox
                aria-label={label}
                checked={sel.isChecked(c.sourceId)}
                onChange={() => sel.toggle(c.sourceId)}
              />
              <span className="font-medium text-foreground">{label}</span>
              {c.email && <span className="text-xs text-muted-foreground">{c.email}</span>}
              {exists && (
                <span className="ml-auto text-xs italic text-ui-purple">
                  {t(lang, "outlookImportExisting")}
                </span>
              )}
            </label>
          </li>
        );
      })}
    </PickListImportModal>
  );
}
