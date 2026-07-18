// src/app/outlook-import-modal.tsx
"use client";

import { useMemo, useState } from "react";
import { type Lang, t } from "./i18n";
import { Banner } from "./banner";
import { Button } from "./button";
import { Modal } from "./modal";
import type { OutlookContact } from "./outlook-contacts";

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
  const allIds = useMemo(() => contacts.map((c) => c.sourceId).join("|"), [contacts]);
  const [prevIds, setPrevIds] = useState(allIds);
  const [checked, setChecked] = useState<Set<string>>(
    () => new Set(contacts.map((c) => c.sourceId)),
  );
  if (prevIds !== allIds) {
    setPrevIds(allIds);
    setChecked(new Set(contacts.map((c) => c.sourceId)));
  }

  const selectedCount = checked.size;
  const allChecked = contacts.length > 0 && contacts.every((c) => checked.has(c.sourceId));

  function toggle(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setChecked(() =>
      allChecked ? new Set() : new Set(contacts.map((c) => c.sourceId)),
    );
  }

  function confirm() {
    onConfirm(contacts.filter((c) => checked.has(c.sourceId)));
  }

  return (
    <Modal open={open} onClose={onClose} ariaLabel={t(lang, "outlookImportTitle")} align="center" zIndex={50}>
      <div className="flex max-h-[80vh] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-line bg-surface">
        <header className="sticky top-0 z-10 flex shrink-0 items-center justify-between gap-4 border-b border-line bg-surface px-6 py-4">
          <h2 className="text-lg font-semibold text-ui-dark-blue dark:text-ui-light-grey">
            {t(lang, "outlookImportTitle")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t(lang, "outlookImportCancel")}
            className="rounded-md p-2 text-muted-foreground hover:bg-surface-muted hover:text-ui-dark-blue"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="h-4 w-4">
              <path
                fillRule="evenodd"
                d="M4.28 4.28a.75.75 0 011.06 0L10 8.94l4.66-4.66a.75.75 0 111.06 1.06L11.06 10l4.66 4.66a.75.75 0 11-1.06 1.06L10 11.06l-4.66 4.66a.75.75 0 01-1.06-1.06L8.94 10 4.28 5.34a.75.75 0 010-1.06z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-auto p-4">
          {loading ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {t(lang, "outlookImportLoading")}
            </p>
          ) : error ? (
            <Banner severity="error">{error}</Banner>
          ) : contacts.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {t(lang, "outlookImportEmpty")}
            </p>
          ) : (
            <>
              <label className="mb-2 flex items-center gap-2 border-b border-line pb-2 text-sm font-medium text-foreground">
                <input type="checkbox" checked={allChecked} onChange={toggleAll} className="h-4 w-4" aria-label={t(lang, "outlookImportSelectAll")} />
                <span>{t(lang, "outlookImportSelectAll")}</span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {t(lang, "outlookImportSelectedN", selectedCount)}
                </span>
              </label>
              <ul className="space-y-1">
                {contacts.map((c) => {
                  const exists = c.email !== "" && existingEmails.has(c.email);
                  const label = c.displayName || c.email || c.sourceId;
                  return (
                    <li key={c.sourceId}>
                      <label className="flex items-center gap-2 rounded px-2 py-1 text-sm hover:bg-surface-muted">
                        <input
                          type="checkbox"
                          aria-label={label}
                          checked={checked.has(c.sourceId)}
                          onChange={() => toggle(c.sourceId)}
                          className="h-4 w-4"
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
              </ul>
            </>
          )}
        </div>

        <footer className="flex shrink-0 items-center justify-end gap-2 border-t border-line px-6 py-3">
          <Button variant="secondary" size="sm" onClick={onClose}>
            {t(lang, "outlookImportCancel")}
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={confirm}
            disabled={selectedCount === 0 || loading || !!error}
          >
            {t(lang, "outlookImportConfirm", selectedCount)}
          </Button>
        </footer>
      </div>
    </Modal>
  );
}
