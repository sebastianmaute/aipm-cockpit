# Communication Templates SP4 — M365 Graph HTML Send Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send communication templates as real HTML email via M365 Graph — an Outlook-draft mode and an in-app-preview-then-send mode, switchable in settings, with `mailto` as the always-available fallback.

**Architecture:** A pure `graph-mail.ts` (Graph `POST /me/messages` + `/me/sendMail`, given a token) + a pure `comm-send.ts` fallback-chain orchestrator + a `comm-send-preview-modal.tsx` + a `use-comm-send.ts` hook (wires the existing `useMsAuth` + modal state). The two existing send sites (`onSendInquiry`, `handleDraftMessageFromAction`) delegate to the orchestrator instead of building `mailto:` inline; `mailto` becomes the terminal fallback branch. Graph modes send `sanitizeTemplateHtml(renderTemplate(...))` so rich formatting finally survives.

**Tech Stack:** TypeScript, React 19 (Next.js fork), MSAL (`useMsAuth`), Microsoft Graph, Vitest + RTL, i18n EN+DE.

**Spec:** `docs/superpowers/specs/2026-06-15-comm-templates-sp4-design.md`

---

## Grounding facts (verified)

- `useMsAuth(enabled): { account: AccountInfo|null, ready: boolean, signIn, signOut, acquireToken(scopes: readonly string[], opts?: {interactive?: boolean}): Promise<string|null> }`. task-manager already has `const msAuth = useMsAuth(m365Enabled)` (line ~781) with `m365Enabled = settings.integrations?.m365?.enabled ?? false`.
- `graph.microsoft.com` is already CSP-allowlisted (contacts/calendar call it). SP4 adds new SCOPES only (`Mail.ReadWrite`, `Mail.Send`) via incremental consent.
- `mailto.ts`: `buildMailtoUrl(email, subject, body)`, `resolveDraftRecipient(sh, resources, prompt, isValid, onInvalid?)`.
- `use-task-row-handlers.ts` `onSendInquiry`: resolves `email`, builds `subject` + `body` (template→`htmlToPlainText(renderTemplate(...))` else i18n `emailBodyTemplate`), then `window.location.href = buildMailtoUrl(email, subject, body)`, then bumps `inquiriesSent`. It already receives `resolveTemplateBody?` as an arg.
- `task-manager.tsx` `handleDraftMessageFromAction` stakeholder branch: `resolveDraftRecipient(...)` → `subject` → body (template or `commsEmailBodyTemplate`) → `buildMailtoUrl` → `window.location.href`. Has `showToast`, `lang`, `commSend`-able context.
- `Settings = {...}` at `settings-types.ts:308`; union-field pattern e.g. `layout: "modern" | "classic"`. `defaultSettings` at 335.
- SP2 `sanitizeTemplateHtml` (`./sanitize-html`); SP1 `renderTemplate`, `buildStatusInquiryVars`, `buildStakeholderUpdateVars`, `htmlToPlainText`.
- vitest-4: constructor/class mocks must be `class`/`function` (not arrow); mocks referenced in `vi.mock` need `vi.hoisted`.

## Conventions for every task
- Tests: `npx vitest run src/app/<file>`; typecheck `npx tsc --noEmit`; lint `npm run lint` (CI `--max-warnings=0`: an unused import/var or `_`-prefixed param is FATAL; re-check after extracts).
- New i18n strings → EN+DE identical keys; **DE via node CRLF write** (`i18n.de.ts` is `\r\n`); 0-based `{0}` interpolation; verify `i18n-encoding`.
- a11y: dialog + radios labelled, keyboard-operable. Palette: sanctioned tokens only.
- Commit after each task. No `Co-Authored-By`. No push.

## File Structure

| File | Responsibility |
|---|---|
| `graph-mail.ts` | **new** pure Graph calls: `buildGraphMessage`, `createDraft`, `sendMail`, `GraphMailError`, scopes |
| `comm-send.ts` | **new** `CommTemplateSendMode`, `CommSendRequest`, `CommSendDeps`, `sendCommTemplate` chain |
| `comm-send-preview-modal.tsx` | **new** dialog: sanitized HTML preview + To/Subject + Send/Cancel |
| `use-comm-send.ts` | **new** hook: wires msAuth + preview modal + the C-path sendMail |
| `settings-types.ts` | **modify** add `commTemplateSendMode?` |
| `settings-sections/comm-templates-section.tsx` | **modify** send-mode radios + i18n |
| `use-task-row-handlers.ts`, `task-manager.tsx` | **modify** delegate sends to the orchestrator + render the modal |
| `i18n.ts` / `i18n.de.ts` | **modify** mode/modal/toast strings + release highlight |
| `version.ts` / `CHANGELOG.md` | **modify** release 0.91.0 "Stross" |

---

### Task 1: Graph mail layer (`graph-mail.ts`)

**Files:** Create `src/app/graph-mail.ts`, `src/app/graph-mail.test.ts`.

- [ ] **Step 1: Write the failing test** — `src/app/graph-mail.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildGraphMessage, createDraft, sendMail, GraphMailError, MAIL_READWRITE_SCOPE, MAIL_SEND_SCOPE } from "./graph-mail";

describe("buildGraphMessage", () => {
  it("builds an HTML Graph message", () => {
    expect(buildGraphMessage("a@b.com", "Hi", "<p>x</p>")).toEqual({
      subject: "Hi",
      body: { contentType: "HTML", content: "<p>x</p>" },
      toRecipients: [{ emailAddress: { address: "a@b.com" } }],
    });
  });
});

describe("graph mail calls", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => { fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("createDraft POSTs to /me/messages with bearer and returns webLink", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 201, json: async () => ({ webLink: "https://outlook/draft/1" }) });
    const link = await createDraft("tok", buildGraphMessage("a@b.com", "S", "<p>b</p>"));
    expect(link).toBe("https://outlook/draft/1");
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("https://graph.microsoft.com/v1.0/me/messages");
    expect(opts.method).toBe("POST");
    expect(opts.headers.Authorization).toBe("Bearer tok");
    expect(JSON.parse(opts.body).body.contentType).toBe("HTML");
  });

  it("sendMail POSTs to /me/sendMail with saveToSentItems", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 202, json: async () => ({}) });
    await sendMail("tok", buildGraphMessage("a@b.com", "S", "<p>b</p>"));
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("https://graph.microsoft.com/v1.0/me/sendMail");
    expect(JSON.parse(opts.body).saveToSentItems).toBe(true);
    expect(JSON.parse(opts.body).message.toRecipients[0].emailAddress.address).toBe("a@b.com");
  });

  it("throws GraphMailError on non-2xx", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 403, json: async () => ({}) });
    await expect(sendMail("tok", buildGraphMessage("a@b.com", "S", "<p>b</p>"))).rejects.toBeInstanceOf(GraphMailError);
  });

  it("exposes the least-privilege scopes", () => {
    expect(MAIL_READWRITE_SCOPE).toEqual(["Mail.ReadWrite"]);
    expect(MAIL_SEND_SCOPE).toEqual(["Mail.Send"]);
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** — `src/app/graph-mail.ts`:

```ts
// src/app/graph-mail.ts — Microsoft Graph mail send (HTML). Pure given an access
// token: no MSAL, no React. graph.microsoft.com is already CSP-allowlisted by the
// contacts/calendar integrations; SP4 only adds the Mail.* scopes.
const GRAPH = "https://graph.microsoft.com/v1.0";

export const MAIL_READWRITE_SCOPE = ["Mail.ReadWrite"] as const;
export const MAIL_SEND_SCOPE = ["Mail.Send"] as const;

export interface GraphMessage {
  subject: string;
  body: { contentType: "HTML"; content: string };
  toRecipients: { emailAddress: { address: string } }[];
}

export class GraphMailError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "GraphMailError";
  }
}

export function buildGraphMessage(to: string, subject: string, htmlBody: string): GraphMessage {
  return {
    subject,
    body: { contentType: "HTML", content: htmlBody },
    toRecipients: [{ emailAddress: { address: to } }],
  };
}

async function graphPost(token: string, path: string, payload: unknown): Promise<Response> {
  const res = await fetch(`${GRAPH}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new GraphMailError(res.status, `Graph ${path} failed (${res.status})`);
  return res;
}

/** Create an HTML draft in the user's mailbox; returns its Outlook webLink. */
export async function createDraft(token: string, msg: GraphMessage): Promise<string> {
  const res = await graphPost(token, "/me/messages", msg);
  const json = (await res.json()) as { webLink?: string };
  return json.webLink ?? "";
}

/** Send the HTML message immediately (saved to Sent Items). */
export async function sendMail(token: string, msg: GraphMessage): Promise<void> {
  await graphPost(token, "/me/sendMail", { message: msg, saveToSentItems: true });
}
```

- [ ] **Step 4: Run → PASS** + `npx tsc --noEmit`.
- [ ] **Step 5: Commit** — `git add src/app/graph-mail.ts src/app/graph-mail.test.ts && git commit -m "feat: Graph HTML mail layer (createDraft + sendMail)"`

---

### Task 2: Send orchestration (`comm-send.ts`) + Settings field

**Files:** Create `src/app/comm-send.ts`, `src/app/comm-send.test.ts`; modify `src/app/settings-types.ts`.

- [ ] **Step 1: Write the failing test** — `src/app/comm-send.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const createDraft = vi.hoisted(() => vi.fn());
vi.mock("./graph-mail", async (orig) => ({ ...(await orig()), createDraft }));
import { sendCommTemplate, type CommSendDeps, type CommSendRequest } from "./comm-send";

const req: CommSendRequest = { to: "a@b.com", subject: "S", html: "<p>h</p>", plain: "h" };

function deps(over: Partial<CommSendDeps> = {}): CommSendDeps {
  return {
    mode: "mailto",
    m365Available: true,
    acquireToken: vi.fn(async () => "tok"),
    openDraft: vi.fn(),
    openPreview: vi.fn(),
    sendMailto: vi.fn(),
    onError: vi.fn(),
    ...over,
  };
}

beforeEach(() => { createDraft.mockReset(); createDraft.mockResolvedValue("https://outlook/d/1"); });

describe("sendCommTemplate", () => {
  it("mailto mode → sendMailto", async () => {
    const d = deps({ mode: "mailto" });
    await sendCommTemplate(req, d);
    expect(d.sendMailto).toHaveBeenCalledWith("a@b.com", "S", "h");
  });
  it("no M365 → mailto regardless of mode", async () => {
    const d = deps({ mode: "outlook-draft", m365Available: false });
    await sendCommTemplate(req, d);
    expect(d.sendMailto).toHaveBeenCalled();
  });
  it("in-app-preview → openPreview", async () => {
    const d = deps({ mode: "in-app-preview" });
    await sendCommTemplate(req, d);
    expect(d.openPreview).toHaveBeenCalledWith(req);
  });
  it("outlook-draft happy path → createDraft + openDraft", async () => {
    const d = deps({ mode: "outlook-draft" });
    await sendCommTemplate(req, d);
    expect(createDraft).toHaveBeenCalled();
    expect(d.openDraft).toHaveBeenCalledWith("https://outlook/d/1");
  });
  it("outlook-draft with no token → falls to openPreview", async () => {
    const d = deps({ mode: "outlook-draft", acquireToken: vi.fn(async () => null) });
    await sendCommTemplate(req, d);
    expect(d.openPreview).toHaveBeenCalledWith(req);
    expect(d.openDraft).not.toHaveBeenCalled();
  });
  it("outlook-draft API error → onError + openPreview", async () => {
    createDraft.mockRejectedValue(new Error("boom"));
    const d = deps({ mode: "outlook-draft" });
    await sendCommTemplate(req, d);
    expect(d.onError).toHaveBeenCalledWith("draft");
    expect(d.openPreview).toHaveBeenCalledWith(req);
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** — `src/app/comm-send.ts`:

```ts
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
  // outlook-draft: create a reviewable HTML draft; fall to the preview (C) on any failure.
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
```

- [ ] **Step 4: Modify `settings-types.ts`** — add the import + field. Near the top imports add:
```ts
import type { CommTemplateSendMode } from "./comm-send";
```
Inside the `Settings` type (around line 308+), add a field (mirroring the optional fields there):
```ts
  commTemplateSendMode?: CommTemplateSendMode;
```
(Leave `defaultSettings` as-is — `undefined` is treated as `"mailto"` by every reader via `?? "mailto"`. Do NOT add it to `defaultSettings` unless tsc complains about a required field; it is optional.)

- [ ] **Step 5: Run → PASS** (`npx vitest run src/app/comm-send.test.ts`) + `npx tsc --noEmit` + `npm run lint`.
- [ ] **Step 6: Commit** — `git add src/app/comm-send.ts src/app/comm-send.test.ts src/app/settings-types.ts && git commit -m "feat: comm-send orchestration (Graph draft → preview → mailto chain)"`

---

### Task 3: Preview modal (`comm-send-preview-modal.tsx`)

**Files:** Create `src/app/comm-send-preview-modal.tsx`, `src/app/comm-send-preview-modal.test.tsx`.

i18n-free (labels via props). Renders the sanitized HTML (defense-in-depth re-sanitize at render).

- [ ] **Step 1: Write the failing test** — `src/app/comm-send-preview-modal.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CommSendPreviewModal, type CommSendPreviewLabels } from "./comm-send-preview-modal";

const labels: CommSendPreviewLabels = { title: "Send email", to: "To", subject: "Subject", send: "Send", cancel: "Cancel" };
const req = { to: "a@b.com", subject: "Status", html: "<p>Hello</p><script>alert(1)</script>", plain: "Hello" };

describe("CommSendPreviewModal", () => {
  it("renders sanitized HTML (script stripped) + recipient/subject", () => {
    render(<CommSendPreviewModal open req={req} labels={labels} busy={false} onSend={vi.fn()} onCancel={vi.fn()} />);
    const dialog = screen.getByRole("dialog", { name: "Send email" });
    expect(dialog).toBeTruthy();
    expect(dialog.innerHTML).not.toContain("<script>");
    expect(screen.getByText("Hello")).toBeTruthy();
    expect(screen.getByText("a@b.com")).toBeTruthy();
  });
  it("Send + Cancel invoke their handlers", () => {
    const onSend = vi.fn(); const onCancel = vi.fn();
    render(<CommSendPreviewModal open req={req} labels={labels} busy={false} onSend={onSend} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(onSend).toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalled();
  });
  it("renders nothing when closed", () => {
    const { container } = render(<CommSendPreviewModal open={false} req={req} labels={labels} busy={false} onSend={vi.fn()} onCancel={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** — `src/app/comm-send-preview-modal.tsx`:

```tsx
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-AIPM-dark-blue/30 p-4">
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
```
(Note: `bg-AIPM-dark-blue/30` overlay — `AIPM-dark-blue` is sanctioned; the `/30` alpha is allowed (the codebase uses token/NN alpha). If the palette-chrome test flags the bare overlay, switch to `bg-surface-muted/70`.)

- [ ] **Step 4: Run → PASS** + `npx tsc --noEmit` + `npm run lint`.
- [ ] **Step 5: Commit** — `git add src/app/comm-send-preview-modal.tsx src/app/comm-send-preview-modal.test.tsx && git commit -m "feat: comm-send preview modal (sanitized HTML, dialog a11y)"`

---

### Task 4: Send hook (`use-comm-send.ts`)

**Files:** Create `src/app/use-comm-send.ts`, `src/app/use-comm-send.test.tsx`.

- [ ] **Step 1: Write the failing test** — `src/app/use-comm-send.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";

const sendMail = vi.hoisted(() => vi.fn(async () => {}));
const createDraft = vi.hoisted(() => vi.fn(async () => "https://outlook/d/1"));
vi.mock("./graph-mail", async (orig) => ({ ...(await orig()), sendMail, createDraft }));

import { useCommSend } from "./use-comm-send";

const req = { to: "a@b.com", subject: "S", html: "<p>h</p>", plain: "h" };
function msAuth(token: string | null = "tok") {
  return { account: { username: "u" }, ready: true, signIn: vi.fn(), signOut: vi.fn(), acquireToken: vi.fn(async () => token) } as never;
}
let hrefValue = "";
beforeEach(() => {
  sendMail.mockClear(); createDraft.mockClear(); hrefValue = "";
  Object.defineProperty(window, "location", { configurable: true, value: { get href() { return hrefValue; }, set href(v: string) { hrefValue = v; } } });
});

describe("useCommSend", () => {
  it("in-app-preview send acquires Mail.Send + calls sendMail", async () => {
    const showToast = vi.fn();
    const { result } = renderHook(() => useCommSend({ mode: "in-app-preview", msAuth: msAuth(), lang: "en-US", showToast }));
    act(() => result.current.send(req));
    expect(result.current.previewModal.open).toBe(true);
    await act(async () => { await result.current.previewModal.onSend(); });
    expect(sendMail).toHaveBeenCalledTimes(1);
    expect(result.current.previewModal.open).toBe(false);
  });
  it("preview send failure falls back to mailto", async () => {
    sendMail.mockRejectedValueOnce(new Error("boom"));
    const { result } = renderHook(() => useCommSend({ mode: "in-app-preview", msAuth: msAuth(), lang: "en-US", showToast: vi.fn() }));
    act(() => result.current.send(req));
    await act(async () => { await result.current.previewModal.onSend(); });
    expect(hrefValue.startsWith("mailto:")).toBe(true);
  });
});
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** — `src/app/use-comm-send.ts`:

```ts
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
```

- [ ] **Step 4: Run → PASS** + `npx tsc --noEmit` + `npm run lint`. (i18n keys `commSendDraftError`/`commSendSent`/`commSendFellBackToMailto` are added in Task 5; until then tsc will error on the `t(lang, ...)` calls — **do Task 5's i18n step BEFORE Task 4 Step 4, or** add the three keys now. To keep this task green, add the three EN+DE keys here per Task 5 Step 1/2's block for them, then finish Task 5's remaining keys in Task 5. Simplest: add ALL Task-5 i18n keys now as part of Step 3.)

  **Adjustment:** before running Step 4, add the full SP4 i18n key set (EN via Edit in `i18n.ts` after `commTplDiffSummary`, DE via node CRLF write after the DE `commTplDiffSummary`) — the exact keys + strings are in Task 5 Step 1/2. Then `npx tsc --noEmit` proves parity. This avoids a red typecheck across Tasks 4–5.

- [ ] **Step 5: Commit** — `git add src/app/use-comm-send.ts src/app/use-comm-send.test.tsx src/app/i18n.ts src/app/i18n.de.ts && git commit -m "feat: useCommSend hook (preview send + mailto fallback) + i18n"`

---

### Task 5: Settings mode selector (the i18n was added in Task 4)

**Files:** Modify `src/app/settings-sections/comm-templates-section.tsx`, its test. (i18n keys below — add in Task 4 Step 3 as noted.)

**i18n keys (EN in `i18n.ts` after `commTplDiffSummary`):**
```
  commSendMode: "Sending",
  commSendModeMailto: "Email app (plain text)",
  commSendModeDraft: "Outlook draft (HTML)",
  commSendModePreview: "Preview then send (HTML)",
  commSendModeHint: "Outlook modes require Microsoft 365 connected; otherwise your email app is used.",
  commSendPreviewTitle: "Send email",
  commSendPreviewTo: "To",
  commSendPreviewSubject: "Subject",
  commSendPreviewSend: "Send",
  commSendPreviewCancel: "Cancel",
  commSendDraftError: "Couldn't create the Outlook draft — opening a preview instead.",
  commSendSent: "Email sent.",
  commSendFellBackToMailto: "Sending via Outlook failed — opening your email app instead.",
```
**DE (node CRLF write, anchor the DE `commTplDiffSummary` line):**
```
  commSendMode: "Versand",
  commSendModeMailto: "E-Mail-App (Nur-Text)",
  commSendModeDraft: "Outlook-Entwurf (HTML)",
  commSendModePreview: "Vorschau, dann senden (HTML)",
  commSendModeHint: "Outlook-Modi erfordern eine Microsoft-365-Verbindung; sonst wird Ihre E-Mail-App verwendet.",
  commSendPreviewTitle: "E-Mail senden",
  commSendPreviewTo: "An",
  commSendPreviewSubject: "Betreff",
  commSendPreviewSend: "Senden",
  commSendPreviewCancel: "Abbrechen",
  commSendDraftError: "Outlook-Entwurf konnte nicht erstellt werden — Vorschau wird geöffnet.",
  commSendSent: "E-Mail gesendet.",
  commSendFellBackToMailto: "Senden über Outlook fehlgeschlagen — Ihre E-Mail-App wird geöffnet.",
```

- [ ] **Step 1: Add the failing test** — append to `comm-templates-section.test.tsx`:
```tsx
  it("changes the send mode via the radio group", () => {
    const onChange = vi.fn();
    // setup must pass settings + onChange; see note below
    setupWithSettings({ onChange });
    fireEvent.click(screen.getByRole("radio", { name: "Outlook draft (HTML)" }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ commTemplateSendMode: "outlook-draft" }));
  });
```
The section currently takes no `settings`/`onChange`. Add `settings: Settings` + `onChange: (s: Settings) => void` to `CommTemplatesSectionProps` (the surrounding SettingsView already has `settings`/`onChange`). Update the test's `setup` to pass `settings={defaultSettings}` and `onChange={vi.fn()}`; add a `setupWithSettings` helper or extend `setup`. (Import `defaultSettings` from `../settings-types`.)

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement** — in `comm-templates-section.tsx`:
  (a) `import type { Settings } from "../settings-types";` and `import type { CommTemplateSendMode } from "../comm-send";`.
  (b) Add `settings: Settings;` and `onChange: (s: Settings) => void;` to `CommTemplatesSectionProps`.
  (c) Add a radio group near the top of the pane (after the intro `<p>`):
```tsx
      <fieldset className="flex flex-col gap-1 text-sm text-foreground">
        <legend className="font-medium">{t(lang, "commSendMode")}</legend>
        {([
          ["mailto", "commSendModeMailto"],
          ["outlook-draft", "commSendModeDraft"],
          ["in-app-preview", "commSendModePreview"],
        ] as [CommTemplateSendMode, TranslationKey][]).map(([value, key]) => (
          <label key={value} className="flex items-center gap-2">
            <input
              type="radio"
              name="commSendMode"
              checked={(props.settings.commTemplateSendMode ?? "mailto") === value}
              onChange={() => props.onChange({ ...props.settings, commTemplateSendMode: value })}
              className="h-4 w-4 cursor-pointer border-line text-AIPM-dark-blue focus:ring-AIPM-green"
            />
            <span>{t(lang, key)}</span>
          </label>
        ))}
        <span className="text-xs text-muted-foreground">{t(lang, "commSendModeHint")}</span>
      </fieldset>
```
  (d) In `settings-view.tsx`, the `<CommTemplatesSection ... />` render: add `settings={settings}` and `onChange={onChange}` (both already in scope in SettingsView).

- [ ] **Step 4: Run → PASS** (`npx vitest run src/app/settings-sections/comm-templates-section.test.tsx src/app/i18n-encoding.test.ts`) + `npx tsc --noEmit` + `npm run lint`.
- [ ] **Step 5: Commit** — `git add src/app/settings-sections/comm-templates-section.tsx src/app/settings-sections/comm-templates-section.test.tsx src/app/settings-view.tsx && git commit -m "feat: comm-template send-mode selector in settings"`

---

### Task 6: Wire the send sites to the orchestrator + render the modal

**Files:** Modify `src/app/use-task-row-handlers.ts`, `src/app/task-manager.tsx`; extend `use-task-row-handlers.test.ts`.

- [ ] **Step 1: Add the failing test** — in `use-task-row-handlers.test.ts`, add a case asserting that when a `sendCommTemplate` arg is provided, `onSendInquiry` calls it (instead of setting `window.location.href`):
```tsx
  it("delegates to sendCommTemplate when provided", () => {
    const sendCommTemplate = vi.fn();
    const setTasks = vi.fn();
    const task = makeTask({ id: 1, assigneeEmail: "alice@example.com", taskName: "Ship" });
    const { result } = renderHook(() => useTaskRowHandlers(makeArgs({ setTasks, sendCommTemplate })));
    act(() => result.current.onSendInquiry(task));
    expect(sendCommTemplate).toHaveBeenCalledWith(expect.objectContaining({ to: "alice@example.com" }));
    expect(hrefValue).toBe(""); // did NOT use mailto directly
  });
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Implement.**
  - `use-task-row-handlers.ts`:
    - Add imports: `import { sanitizeTemplateHtml } from "./sanitize-html";` and `import type { CommSendRequest } from "./comm-send";`.
    - Add to `UseTaskRowHandlersArgs`: `sendCommTemplate?: (req: CommSendRequest) => void;` and destructure it.
    - In `onSendInquiry`, after `email`/`subject`/`body` (the existing plain `body`) are computed, build the HTML + delegate:
    ```ts
    const tplBody = resolveTemplateBody?.("status-inquiry") ?? null;
    const html = tplBody != null
      ? sanitizeTemplateHtml(renderTemplate(tplBody, "status-inquiry", buildStatusInquiryVars(task)))
      : `<p>${body.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\n/g, "<br>")}</p>`;
    if (sendCommTemplate) {
      sendCommTemplate({ to: email, subject, html, plain: body });
    } else {
      window.location.href = buildMailtoUrl(email, subject, body);
    }
    ```
    Keep the `inquiriesSent` bump exactly as-is (after the send dispatch). Add `sendCommTemplate` to the `onSendInquiry` dep array.
  - `task-manager.tsx`:
    - Add `import { useCommSend } from "./use-comm-send";` and `import { CommSendPreviewModal } from "./comm-send-preview-modal";` and `import { sanitizeTemplateHtml } from "./sanitize-html";`.
    - After `msAuth` is defined, add:
      ```ts
      const commSend = useCommSend({ mode: settings.commTemplateSendMode ?? "mailto", msAuth, lang, showToast });
      ```
    - Pass `sendCommTemplate: commSend.send` into the `useTaskRowHandlers({...})` args.
    - In `handleDraftMessageFromAction`'s stakeholder branch, replace the `window.location.href = buildMailtoUrl(email, subject, body)` line with:
      ```ts
      const html = tplBody != null
        ? sanitizeTemplateHtml(renderTemplate(tplBody, "stakeholder-update", buildStakeholderUpdateVars(sh, project?.name ?? "")))
        : `<p>${body.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\n/g, "<br>")}</p>`;
      commSend.send({ to: email, subject, html, plain: body });
      ```
      (`tplBody` and `body` are already computed in that branch from Task 6/SP3 wiring; reuse them. Add `commSend.send` to the callback's dep array.)
    - Render the modal once (near the other modals in the returned tree, NOT gated by `isPopout` differently than the pane — but popouts don't send, so gating with the existing chrome is fine):
      ```tsx
      <CommSendPreviewModal
        open={commSend.previewModal.open}
        req={commSend.previewModal.req}
        busy={commSend.previewModal.busy}
        onSend={commSend.previewModal.onSend}
        onCancel={commSend.previewModal.onCancel}
        labels={{
          title: t(lang, "commSendPreviewTitle"),
          to: t(lang, "commSendPreviewTo"),
          subject: t(lang, "commSendPreviewSubject"),
          send: t(lang, "commSendPreviewSend"),
          cancel: t(lang, "commSendPreviewCancel"),
        }}
      />
      ```

- [ ] **Step 4: Run → PASS** — `npx vitest run src/app/use-task-row-handlers.test.ts` + the full `npx tsc --noEmit` + `npm run lint`. (Existing mailto-path tests still pass because they pass no `sendCommTemplate`.)
- [ ] **Step 5: Commit** — `git add src/app/use-task-row-handlers.ts src/app/use-task-row-handlers.test.ts src/app/task-manager.tsx && git commit -m "feat: send flows delegate to Graph send (mailto fallback) + preview modal"`

---

### Task 7: Release — 0.91.0 "Stross"

**Files:** `version.ts`, `CHANGELOG.md`, `i18n.ts`, `i18n.de.ts`.

- [ ] **Step 1:** Full suite + build green: `npx vitest run && npx tsc --noEmit && npm run lint && npm run build`. STOP on failure. (Confirm no Graph code is pulled into a non-lazy path that breaks SSR — graph-mail uses `fetch` only inside functions, safe.)
- [ ] **Step 2:** `version.ts`: `APP_VERSION="0.91.0"`; `APP_BUILD_DATE` comment → `// 0.91.0 comm templates SP4 graph send`; `APP_MILESTONE="Stross"` (Charles Stross) + JSDoc (`0.91.x line is "Stross"`). Append `"versionHighlightCommTemplatesSend"` to `APP_HIGHLIGHT_KEYS`.
- [ ] **Step 3:** EN (Edit) after `  versionHighlightCommTemplatesVersions: "...",`:
```
  versionHighlightCommTemplatesSend: "Send communication templates as real HTML email via Microsoft 365 — as an Outlook draft to review, or preview-and-send in the app (plain-text email app remains the fallback).",
```
DE (node CRLF write; anchor the DE `versionHighlightCommTemplatesVersions` line) after it:
```
  versionHighlightCommTemplatesSend: "Kommunikationsvorlagen als echte HTML-E-Mail über Microsoft 365 senden — als Outlook-Entwurf zum Prüfen oder mit Vorschau direkt aus der App (die Nur-Text-E-Mail-App bleibt als Rückfall).",
```
Verify bytes; `npx vitest run src/app/i18n-encoding.test.ts`.
- [ ] **Step 4:** `CHANGELOG.md` above `## [0.90.0]`:
```
## [0.91.0] - 2026-06-15 "Stross"

### Added / Changed
- **Communication templates HTML send (SP4)**: send templates as real HTML email
  via Microsoft 365 Graph — an Outlook-draft mode (creates a reviewable HTML draft)
  or an in-app preview-then-send mode, switchable in settings. The plain-text email
  app (mailto) remains the default and the fallback when M365 is unavailable. This
  completes the editable communication-templates roadmap.
```
- [ ] **Step 5:** Verify + `git add src/app/version.ts src/app/i18n.ts src/app/i18n.de.ts CHANGELOG.md && git commit -m "chore: release 0.91.0 comm templates SP4 graph send"`.

---

## Final verification (before finishing)
```bash
npx vitest run && npx tsc --noEmit && npm run lint && npm run build
```
Then **superpowers:finishing-a-development-branch**. e2e axe gate runs in CI — the preview dialog + settings radios must be labelled + keyboard-operable.

## Self-Review

**Spec coverage:** Graph layer createDraft/sendMail/buildGraphMessage + scopes (T1) ✓; orchestration fallback chain + `commTemplateSendMode` setting (T2) ✓; preview modal with re-sanitized HTML + dialog a11y (T3) ✓; hook wiring msAuth + preview send + mailto fallback (T4) ✓; settings radios + i18n (T5, i18n added in T4) ✓; both send sites delegate + modal rendered (T6) ✓; release (T7) ✓.

**Placeholder scan:** none — all steps have concrete code. The i18n-ordering note in T4 Step 4 is an explicit sequencing instruction (add all SP4 keys during T4 Step 3 so tsc parity holds across T4–T5), not a placeholder.

**Type consistency:** `CommSendRequest {to,subject,html,plain}` defined T2, used T3/T4/T6; `CommSendDeps` T2 used T4; `CommTemplateSendMode` T2 used in settings-types/T5/T4; `GraphMessage`/`createDraft`/`sendMail`/`buildGraphMessage`/`MAIL_*_SCOPE` T1 used T2/T4; `CommSendPreviewLabels` T3 used T6; `UseMsAuthResult` (existing) used T4. `sendCommTemplate(req, deps)` signature consistent.

**Resolved sequencing:** the three send-error i18n keys are referenced in T4's hook; the plan adds ALL SP4 i18n keys during T4 Step 3 (before T4's typecheck), and T5 only consumes them — so tsc parity never breaks mid-branch. T5's commit covers the section/settings-view; T4's commit covers the i18n files + hook.

**Adapt-to-existing (not placeholders):** the DE i18n anchors (`commTplDiffSummary`, `versionHighlightCommTemplatesVersions`) — grep exact bytes; `t()` interpolation 0-based `{0}`; `handleDraftMessageFromAction`'s existing `tplBody`/`body` locals to reuse; `settings`/`onChange` already in SettingsView scope.
