"use client";
import { sanitizeTemplateHtml } from "./sanitize-html";
import type { CommSendRequest } from "./comm-send";
import { Button } from "./button";
import { Modal } from "./modal";

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
  if (!open || !req) return null;

  // Shared Modal owns the backdrop (canonical AIPM dark-blue scrim), Escape,
  // focus-trap + restore, and backdrop-click-to-close — the panel is just content.
  return (
    <Modal open onClose={onCancel} ariaLabel={labels.title} align="center" zIndex={50}>
      <div className="flex max-h-[80vh] w-full max-w-lg flex-col gap-3 overflow-auto rounded-lg border border-line bg-surface p-4">
        <h2 className="text-base font-semibold text-ui-dark-blue dark:text-ui-light-grey">{labels.title}</h2>
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
          <Button variant="secondary" size="sm" onClick={onCancel}>
            {labels.cancel}
          </Button>
          <Button variant="primary" size="sm" onClick={onSend} disabled={busy}>
            {labels.send}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
