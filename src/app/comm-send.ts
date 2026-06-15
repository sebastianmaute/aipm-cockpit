// src/app/comm-send.ts — pure send orchestration for communication templates.
// Runs the fallback chain per mode; all effects (token, draft, preview, mailto,
// error) are injected so this is fully unit-testable without MSAL/React/DOM.
import { buildGraphMessage, createDraft, MAIL_READWRITE_SCOPE } from "./graph-mail";

export type CommTemplateSendMode = "mailto" | "outlook-draft" | "in-app-preview";

export interface CommSendRequest {
  to: string;
  subject: string;
  html: string;   // sanitized rendered HTML (Graph body)
  plain: string;  // plain-text (mailto body / preview fallback)
}

export interface CommSendDeps {
  mode: CommTemplateSendMode;
  m365Available: boolean;
  acquireToken: (scopes: readonly string[], opts?: { interactive?: boolean }) => Promise<string | null>;
  openDraft: (webLink: string) => void;
  openPreview: (req: CommSendRequest) => void;
  sendMailto: (to: string, subject: string, plain: string) => void;
  onError: (kind: "draft") => void;
}

export async function sendCommTemplate(req: CommSendRequest, deps: CommSendDeps): Promise<void> {
  if (deps.mode === "mailto" || !deps.m365Available) {
    deps.sendMailto(req.to, req.subject, req.plain);
    return;
  }
  if (deps.mode === "in-app-preview") {
    deps.openPreview(req);
    return;
  }
  // outlook-draft: create a reviewable HTML draft; fall to the preview on any failure.
  try {
    const token = await deps.acquireToken(MAIL_READWRITE_SCOPE, { interactive: true });
    if (!token) { deps.openPreview(req); return; }
    const webLink = await createDraft(token, buildGraphMessage(req.to, req.subject, req.html));
    deps.openDraft(webLink);
  } catch {
    deps.onError("draft");
    deps.openPreview(req);
  }
}
