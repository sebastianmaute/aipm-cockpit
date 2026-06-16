# Communication Templates SP4 — HTML Email Send via M365 Graph (design)

**Status:** approved (design) — 2026-06-15
**Builds on:** SP1 (0.88.0) · SP2 (0.89.0 rich editor) · SP3 (0.90.0 versions)
**Slice:** 4 of 4 — the final, optional slice (the SP1–SP3 specs/CHANGELOG label this "SP5"; renamed SP4 to close a numbering gap — there was never a separate SP4).

## Goal

Send communication templates as **real HTML email via M365 Graph** instead of (or alongside) the plain-text `mailto:`. The rich HTML body authored in SP2 (Tiptap + DOMPurify) finally renders as an actual email. Two Graph modes — **Outlook draft** and **in-app preview → send** — switchable in settings, with `mailto` as the always-available fallback.

## Decisions (locked in brainstorming)

1. **Two Graph modes + mailto fallback**, selected by a new setting `commTemplateSendMode`:
   - `"mailto"` (**default**) — today's plain-text behavior; no M365 needed.
   - `"outlook-draft"` (**A**) — `POST /me/messages` creates a rich-HTML draft; open its `webLink` so the user reviews + sends in Outlook. Scope `Mail.ReadWrite`. Faithful HTML analog of mailto (human-in-the-loop, no accidental sends).
   - `"in-app-preview"` (**C**) — show an in-app preview modal (rendered HTML + To/Subject), then `POST /me/sendMail`. Scope `Mail.Send`.
2. **Fallback chain** (graceful degradation, never a silent drop):
   - `outlook-draft` → try A; on missing consent / API failure → try C; on C failure or no M365 → `mailto`.
   - `in-app-preview` → try C; on failure / no M365 → `mailto`.
   - `mailto` → the existing path.
3. **Graph modes send the HTML body** (`sanitizeTemplateHtml(renderTemplate(body, vars))`, `contentType: "HTML"`); `mailto` keeps `htmlToPlainText`. Formatting (bold/lists/links) finally survives.

## Existing infrastructure (verified)

- `useMsAuth(enabled): { account, ready, signIn, signOut, acquireToken(scopes, {interactive}) }` — `acquireToken` returns a Graph access token or null (silent, falls back to interactive when `{interactive:true}`).
- Contacts/calendar already call `graph.microsoft.com` directly from the client, so the host is **already CSP-allowlisted** (`src/proxy.ts`); SP4 adds new SCOPES (`Mail.ReadWrite` / `Mail.Send`) via incremental consent, not a new host.
- Send sites: `onSendInquiry` (`use-task-row-handlers.ts`) and `handleDraftMessageFromAction`'s branches (`task-manager.tsx`) — both currently build `mailto:` via `buildMailtoUrl` (`mailto.ts`) and resolve recipients via `resolveDraftRecipient`.
- SP2 `sanitizeTemplateHtml` (`sanitize-html.ts`) + SP1 `renderTemplate` / `htmlToPlainText`.
- `Settings` type (`settings-types.ts`) — add `commTemplateSendMode?: CommTemplateSendMode` (optional → defaults to `"mailto"`; settings are NOT a persisted `Workspace` field, so the six-write-paths rule does not apply).

## Architecture (new units)

### `src/app/graph-mail.ts` (pure given a token)
- `type GraphRecipient = { emailAddress: { address: string } }`.
- `buildGraphMessage(to: string, subject: string, htmlBody: string): GraphMessage` — `{ subject, body: { contentType: "HTML", content: htmlBody }, toRecipients: [{ emailAddress: { address: to } }] }`.
- `createDraft(token: string, msg: GraphMessage): Promise<{ webLink: string }>` — `POST https://graph.microsoft.com/v1.0/me/messages`, `Authorization: Bearer`, returns the created message's `webLink`. Throws `GraphMailError` on non-2xx.
- `sendMail(token: string, msg: GraphMessage): Promise<void>` — `POST .../me/sendMail` with `{ message: msg, saveToSentItems: true }`. Throws on non-2xx.
- `MAIL_READWRITE_SCOPE = ["Mail.ReadWrite"]`, `MAIL_SEND_SCOPE = ["Mail.Send"]`.
- Unit-testable with a mocked `fetch` (no MSAL).

### `src/app/comm-send.ts` (pure orchestration helper)
- `type CommTemplateSendMode = "mailto" | "outlook-draft" | "in-app-preview"`.
- `interface CommSendRequest { to: string; subject: string; html: string; plain: string }`.
- `interface CommSendDeps { mode: CommTemplateSendMode; acquireToken: (scopes: readonly string[], opts?: {interactive?: boolean}) => Promise<string | null>; m365Available: boolean; openDraft: (webLink: string) => void; openPreview: (req: CommSendRequest) => void; sendMailto: (to: string, subject: string, plain: string) => void; onError: (kind: "draft" | "send") => void }`.
- `async sendCommTemplate(req: CommSendRequest, deps: CommSendDeps): Promise<void>` — implements the fallback chain. Pure logic + injected effects → fully unit-testable (no React, no MSAL, no DOM). `in-app-preview` resolves by calling `deps.openPreview(req)` (the modal then calls back into `sendMail`); the actual `sendMail` for the preview's Send button is a separate injected effect (see hook).

### `src/app/comm-send-preview-modal.tsx`
- Props `{ open, req: CommSendRequest | null, labels, onSend, onCancel, busy }` (i18n-free — labels via props). Renders the recipient + subject (read-only) and the body via `dangerouslySetInnerHTML={{ __html: sanitizeTemplateHtml(req.html) }}` (double-sanitized — the stored body was already sanitized on save, re-sanitized at render as defense-in-depth). `role="dialog"`, focus-trapped, Escape closes; Send/Cancel labelled.

### `src/app/use-comm-send.ts` (hook wiring auth + modal state)
- `useCommSend({ mode, msAuth, lang, showToast }): { send(req), previewModal: { open, req, onSend, onCancel, busy } }`.
- `send(req)` calls `sendCommTemplate` with deps wired to: `acquireToken` from `msAuth`, `m365Available = msAuth.ready && msAuth.account !== null`, `openDraft = (webLink) => window.open(webLink, "_blank", "noopener")`, `openPreview = (r) => setPreview({open:true, req:r})`, `sendMailto`, `onError → showToast`.
- Preview `onSend`: acquire `Mail.Send` (interactive on 401) → `sendMail(token, buildGraphMessage(...))` → toast success / on failure → `mailto` fallback + toast; close modal.
- Draft path inside `sendCommTemplate`: acquire `Mail.ReadWrite` → `createDraft` → `openDraft(webLink)`; on null token / `GraphMailError` → fall through to the preview (C) path.

## Data flow (status-inquiry example)
1. User clicks "Send inquiry". The site builds `{ to, subject, html: sanitize(render(body)), plain: htmlToPlainText(render(body)) }`.
2. `send(req)` runs the chain per `mode`:
   - `outlook-draft`: token(Mail.ReadWrite) → createDraft → open webLink. (fail → preview)
   - `in-app-preview`: open preview modal → Send → token(Mail.Send) → sendMail. (fail → mailto)
   - `mailto`: `buildMailtoUrl` → `window.location.href`.
3. `inquiriesSent` bump + activity log happen once the send path is chosen (as today), regardless of mode.

## Settings
- New `commTemplateSendMode` selector (3 radios) in the **comm-templates settings pane** (Turso-gated already), with a hint: the Graph modes require M365 connected; otherwise the app behaves as `mailto`. Default `"mailto"` (no behavior change until opted in).
- `Settings` is broadcast-synced (existing `useSettings` registry) — no new persistence wiring.

## Error handling
- `acquireToken` returns null (no account / consent denied) → fall through the chain (→ preview → mailto).
- `GraphMailError` (non-2xx, network) → toast (EN/DE) + fall through.
- 401 specifically → one `acquireToken(..., {interactive:true})` retry before falling through.
- Never throw to the UI; the chain always ends at `mailto`, which cannot fail (opens the client).

## Testing
- **`graph-mail.test.ts`** (pure, mocked fetch): `buildGraphMessage` shape; `createDraft` POSTs to `/me/messages` with Bearer + returns `webLink`; `sendMail` POSTs `/me/sendMail` with `saveToSentItems`; non-2xx → throws `GraphMailError`.
- **`comm-send.test.ts`** (pure): `outlook-draft` happy path calls `openDraft`; token-null → falls to `openPreview`; `in-app-preview` → `openPreview`; `mailto` → `sendMailto`; draft API throw → `openPreview`.
- **`comm-send-preview-modal.test.tsx`**: renders sanitized HTML (a `<script>` in the body is stripped), shows To/subject, Send calls `onSend`, Escape calls `onCancel`, dialog a11y (role, label, focus).
- **`use-comm-send.test.tsx`**: preview Send acquires Mail.Send + calls sendMail; sendMail throw → mailto fallback + toast.
- Send-site integration: with `mode="mailto"` the existing assertions hold (no regression); with `mode="outlook-draft"` + mocked auth, `createDraft` is called.
- e2e axe: the preview modal + settings radios labelled, keyboard-operable.

## a11y / palette / i18n
- Preview modal: `role="dialog"`, `aria-label`, focus-trap, Escape, labelled Send/Cancel. Settings radios labelled + grouped (`role="radiogroup"` or fieldset/legend). Sanctioned tokens only.
- i18n EN+DE (DE node CRLF write; 0-based `{0}` interpolation): mode labels (`commSendModeMailto/Draft/Preview`), the M365 hint, preview modal strings (title, send, cancel, "to"/"subject"), and send error toasts (`commSendDraftError`, `commSendSendError`, `commSendFellBackToMailto`).

## Security
- HTML rendered in the preview is `sanitizeTemplateHtml`-cleaned at render time (defense-in-depth over the save-time sanitize). The Graph HTML body is likewise the sanitized render.
- Scopes are least-privilege per mode (`Mail.ReadWrite` for draft, `Mail.Send` for send), requested via incremental consent only when the user actually triggers a Graph send.
- `to` is a validated email (existing `resolveDraftRecipient` / `isValidEmail`); it is placed in a JSON Graph payload (not a URL), so no header-injection surface.
- No secrets in code; tokens are acquired at call time and never persisted.

## Release
- Minor bump **0.91.0** (new codename, picked in the plan). CHANGELOG + `versionHighlightCommTemplatesSend` (EN/DE) appended to `APP_HIGHLIGHT_KEYS`. **Completes the editable-templates roadmap.**

## Out of scope
- Attachments, CC/BCC, send scheduling, read receipts.
- Non-template ad-hoc email composition.
- Shared-mailbox / send-on-behalf-of (would need `Mail.Send.Shared` + a from-address picker).
- Server-side proxy for Graph (the app calls Graph client-side today; keep that pattern).

## Risks
- **Incremental consent friction** — first Graph send pops a consent dialog; handled by `acquireToken({interactive:true})` and a clear toast on denial (→ falls back).
- **Tenant policy may block `Mail.Send`** — the draft mode (A, `Mail.ReadWrite`) is the safer default to recommend; the fallback chain ends at `mailto` regardless.
- **Popup blockers on `window.open(webLink)`** — open synchronously in the click handler path; if blocked, toast with the link.
- **HTML email rendering differences** (Outlook vs the editor) — out of our control; the sanitizer keeps the body to a simple, well-supported tag set (p/strong/em/u/h1-2/ul/ol/li/a).
