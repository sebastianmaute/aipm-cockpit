// src/app/use-comm-send.ts — wires the pure comm-send orchestration to MSAL token
// acquisition + the preview-modal state. The C-path (preview → sendMail) lives here
// because its sendMail fires after the user confirms in the modal.
"use client";
import { useCallback, useState } from "react";
import { t, type Lang } from "./i18n";
import { buildMailtoUrl } from "./mailto";
import { buildGraphMessage, sendMail, MAIL_SEND_SCOPE } from "./graph-mail";
import { sendCommTemplate, type CommSendRequest, type CommTemplateSendMode } from "./comm-send";
import type { UseMsAuthResult } from "./use-ms-auth";

export interface UseCommSendArgs {
  mode: CommTemplateSendMode;
  msAuth: UseMsAuthResult;
  lang: Lang;
  showToast: (kind: "info" | "error", text: string) => void;
}

export interface CommSendPreviewState {
  open: boolean;
  req: CommSendRequest | null;
  busy: boolean;
  onSend: () => Promise<void>;
  onCancel: () => void;
}

export interface UseCommSendResult {
  send: (req: CommSendRequest) => void;
  previewModal: CommSendPreviewState;
}

export function useCommSend(args: UseCommSendArgs): UseCommSendResult {
  const { mode, msAuth, lang, showToast } = args;
  const [preview, setPreview] = useState<{ open: boolean; req: CommSendRequest | null }>({ open: false, req: null });
  const [busy, setBusy] = useState(false);

  const sendMailtoFallback = useCallback((to: string, subject: string, plain: string) => {
    window.location.href = buildMailtoUrl(to, subject, plain);
  }, []);

  const send = useCallback((req: CommSendRequest) => {
    void sendCommTemplate(req, {
      mode,
      m365Available: msAuth.ready && msAuth.account !== null,
      acquireToken: msAuth.acquireToken,
      openDraft: (webLink) => { if (webLink) window.open(webLink, "_blank", "noopener"); },
      openPreview: (r) => setPreview({ open: true, req: r }),
      sendMailto: sendMailtoFallback,
      onError: () => showToast("error", t(lang, "commSendDraftError")),
    });
  }, [mode, msAuth, lang, showToast, sendMailtoFallback]);

  const onSend = useCallback(async () => {
    const req = preview.req;
    if (!req) return;
    setBusy(true);
    try {
      const token = await msAuth.acquireToken(MAIL_SEND_SCOPE, { interactive: true });
      if (!token) throw new Error("no token");
      await sendMail(token, buildGraphMessage(req.to, req.subject, req.html));
      showToast("info", t(lang, "commSendSent"));
    } catch {
      sendMailtoFallback(req.to, req.subject, req.plain);
      showToast("info", t(lang, "commSendFellBackToMailto"));
    } finally {
      setBusy(false);
      setPreview({ open: false, req: null });
    }
  }, [preview.req, msAuth, lang, showToast, sendMailtoFallback]);

  const onCancel = useCallback(() => setPreview({ open: false, req: null }), []);

  return { send, previewModal: { open: preview.open, req: preview.req, busy, onSend, onCancel } };
}
