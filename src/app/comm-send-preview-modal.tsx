"use client";
import { sanitizeRichHtml } from "./sanitize-html";
import type { CommSendRequest } from "./comm-send";
import { Button } from "./button";
import { Modal } from "./modal";

export interface CommSendPreviewLabels {
  title: string;
  to: string;
  subject: string;
  send: string;
  /** Send button label while a send is in flight (e.g. "Sending…"). */
  sending: string;
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

  // Dismissal is BLOCKED while a send is in flight. onCancel/Escape/backdrop do
  // NOT abort the send (there is no AbortController on the Graph sendMail path —
  // the request keeps running and still toasts its outcome), so allowing a
  // dismiss would falsely imply the email was cancelled when it was already on
  // its way out. Once busy, the modal is locked until the send settles.
  const dismiss = busy ? undefined : onCancel;

  // Shared Modal owns the backdrop (canonical AIPM dark-blue scrim), Escape,
  // focus-trap + restore, and backdrop-click-to-close — the panel is just content.
  return (
    <Modal
      open
      onClose={dismiss ?? (() => {})}
      ariaLabelledby="comm-send-preview-title"
      align="center"
      zIndex={50}
    >
      <div className="flex max-h-[80vh] w-full max-w-lg flex-col gap-3 overflow-auto rounded-lg border border-line bg-surface p-4">
        <h2
          id="comm-send-preview-title"
          className="text-base font-semibold text-ui-dark-blue dark:text-ui-light-grey"
        >
          {labels.title}
        </h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
          <dt className="font-medium text-muted-foreground">{labels.to}</dt>
          <dd className="text-foreground">{req.to}</dd>
          <dt className="font-medium text-muted-foreground">{labels.subject}</dt>
          <dd className="text-foreground">{req.subject}</dd>
        </dl>
        <div
          className="rounded-md border border-line bg-surface px-3 py-2 text-sm text-foreground"
          dangerouslySetInnerHTML={{ __html: sanitizeRichHtml(req.html) }}
        />
        <div className="flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onCancel} disabled={busy}>
            {labels.cancel}
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={onSend}
            disabled={busy}
            aria-busy={busy}
          >
            {busy ? labels.sending : labels.send}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
