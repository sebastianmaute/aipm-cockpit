"use client";
import { useEffect, useRef } from "react";
import { sanitizeTemplateHtml } from "./sanitize-html";
import type { CommSendRequest } from "./comm-send";

export interface CommSendPreviewLabels {
  title: string;
  to: string;
  subject: string;
  send: string;
  cancel: string;
}

export interface CommSendPreviewModalProps {
  open: boolean;
  req: CommSendRequest | null;
  labels: CommSendPreviewLabels;
  busy: boolean;
  onSend: () => void;
  onCancel: () => void;
}

export function CommSendPreviewModal(props: CommSendPreviewModalProps) {
  const { open, req, labels, busy, onSend, onCancel } = props;
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    dialogRef.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open || !req) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface-muted/70 p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label={labels.title}
        tabIndex={-1}
        className="flex max-h-[80vh] w-full max-w-lg flex-col gap-3 overflow-auto rounded-lg border border-line bg-surface p-4 focus:outline-none"
      >
        <h2 className="text-base font-semibold text-AIPM-dark-blue dark:text-AIPM-light-grey">{labels.title}</h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="font-medium text-muted-foreground">{labels.to}</dt>
          <dd className="text-foreground">{req.to}</dd>
          <dt className="font-medium text-muted-foreground">{labels.subject}</dt>
          <dd className="text-foreground">{req.subject}</dd>
        </dl>
        <div
          className="rounded-md border border-line bg-surface px-3 py-2 text-sm text-foreground"
          dangerouslySetInnerHTML={{ __html: sanitizeTemplateHtml(req.html) }}
        />
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="rounded-md border border-line px-3 py-1.5 text-sm hover:bg-surface-muted">
            {labels.cancel}
          </button>
          <button
            type="button"
            onClick={onSend}
            disabled={busy}
            className="rounded-md border border-line bg-AIPM-dark-blue px-3 py-1.5 text-sm text-white hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {labels.send}
          </button>
        </div>
      </div>
    </div>
  );
}
