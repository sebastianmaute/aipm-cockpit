# SP-D - Create a Project from a File / SharePoint / Confluence - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Let a user create a project by ingesting a file (PDF/image/text), a SharePoint document, or a Confluence page URL - the content feeds the existing SP3 `propose_project` call which pre-fills the create wizard.

**Architecture:** Extend `useProjectProposal().generate` to accept `string | ContentBlock[]` (multimodal, reusing SP2 `chat-attachments`). File bytes go to Claude natively. SharePoint via M365 Graph. Confluence via a NEW same-origin `/api/confluence/page` route that REUSES the hardened `api/jira/_helpers` (SSRF-guarded, Basic auth, status-only errors) - Confluence is the same Atlassian host, just the `/wiki/rest/api/...` path.

**Tech Stack:** Forked Next.js 16 / React 19 / TS; vitest; Anthropic forced-tool; M365 Graph; Atlassian Cloud REST; i18n EN+DE (tsc parity); Tailwind AIPM tokens.

Spec: `docs/superpowers/specs/2026-06-20-project-from-source-spd-design.md`. Extends SP3.

---

## Conventions (read first)
- After editing ANY test run `npx tsc --noEmit`. `getByRole` string `name` is already exact - no `{exact}`.
- `npm run lint` `--max-warnings=0`: unused import/var FATAL.
- i18n EN/DE key sets identical (tsc enforces). DE CRLF; add DE keys via node UTF-8 write (anchor `\r\n`, REAL umlauts), delete script. Tests use `lang="en-US"`; DE via `loadI18n("de")` in `beforeAll`.
- AIPM palette tokens only.
- **SECURITY:** the proposal call + the Confluence proxy NEVER log/echo the apiKey, Atlassian token, or response body; errors carry only status / a controlled token. Confluence route reuses `callJira`/`forwardJsonResponse` (already status-only). Validate the Confluence `pageId` server-side (`^\d+$`) before building the path.
- No client-side PDF/Office parser - Claude reads PDF/image bytes natively (SP2 rule).
- `npm run test:run` green before each commit; commit per task.

---

## File Map
- `src/app/use-project-proposal.ts` - `generate` accepts `string | ContentBlock[]`.
- `src/app/project-ingest.ts` (NEW pure) - `parseConfluencePageId`, `confluenceJsonToText`, `MAX_INGEST_TEXT`.
- `src/app/confluence-api.ts` (NEW) - client call to the proxy + types.
- `src/app/api/confluence/page/route.ts` (NEW server route) - reuses `api/jira/_helpers`.
- `src/app/m365-sharepoint.ts` - `fetchSharePointFileContent`.
- `src/app/create-project-wizard.tsx` - Step-0 source picker + FileReader + wiring.
- `src/app/i18n.ts` / `i18n.de.ts`, `src/app/version.ts`, `CHANGELOG.md`.

---

## Task 1: Multimodal proposal call

**Files:** Modify `src/app/use-project-proposal.ts`. Test: `src/app/use-project-proposal.test.tsx` (find/extend; SP3 likely has one).

Context: `generate(description: string)` sends `messages: [{ role: "user", content: description }]`. We widen `content` to accept a content-block array (Anthropic accepts a string OR a block array). `ContentBlock` is the SP2 union `{ type: "text"; text: string } | AttachmentBlock` (AttachmentBlock from `chat-attachments.ts`).

- [ ] **Step 1: failing test** - extend `use-project-proposal.test.tsx` (mock `fetch`):
```ts
it("sends a content-block array verbatim as the user message content", async () => {
  const fetchMock = vi.spyOn(global, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ content: [{ type: "tool_use", name: "propose_project", input: { name: "P", summary: "s", features: [] } }] }), { status: 200 }),
  );
  const { result } = renderHook(() => useProjectProposal({ apiKey: "k", model: "m" }));
  const blocks = [{ type: "text", text: "Create a project from this doc:" }, { type: "document", source: { type: "base64", media_type: "application/pdf", data: "QUJD" } }];
  await act(async () => { await result.current.generate(blocks as never); });
  const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
  expect(body.messages[0].content).toEqual(blocks); // array passed through, not stringified
  fetchMock.mockRestore();
});
```
(Keep the existing string test; this adds the array case. Adjust the proposal-tool-result mock to whatever the file's existing test uses so `parseProposal` returns non-null.)

- [ ] **Step 2:** `npm run test:run -- use-project-proposal` -> FAIL (TS: array not assignable to string param).

- [ ] **Step 3: widen the type.** In `use-project-proposal.ts`:
- Add an import of the block types. Define a local content type:
  ```ts
  import { type AttachmentBlock } from "./chat-attachments";
  export type ProposalContent = string | Array<{ type: "text"; text: string } | AttachmentBlock>;
  ```
- Change the callback signature: `async (input: ProposalContent): Promise<ProjectProposal | null> => { ... }`.
- In the fetch body, change `content: description` to `content: input`. Everything else (key gate, forced tool, parse, never-log error discipline) unchanged.

- [ ] **Step 4:** `npm run test:run -- use-project-proposal` -> PASS (string + array cases). `npx tsc --noEmit` -> 0. `npm run lint`.

- [ ] **Step 5: commit**
```bash
git add src/app/use-project-proposal.ts src/app/use-project-proposal.test.tsx
git commit -m "feat(sp-d): useProjectProposal.generate accepts multimodal content blocks"
```

---

## Task 2: Pure ingest helpers (Confluence URL parse + html-to-text + caps)

**Files:** Create `src/app/project-ingest.ts`, `src/app/project-ingest.test.ts`.

- [ ] **Step 1: failing test** - `src/app/project-ingest.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { parseConfluencePageId, confluenceJsonToText, MAX_INGEST_TEXT } from "./project-ingest";

describe("parseConfluencePageId", () => {
  it("extracts the id from the common URL shapes", () => {
    expect(parseConfluencePageId("https://x.atlassian.net/wiki/spaces/ENG/pages/123456789/My+Page")).toBe("123456789");
    expect(parseConfluencePageId("https://x.atlassian.net/wiki/spaces/ENG/pages/42")).toBe("42");
    expect(parseConfluencePageId("https://x.atlassian.net/pages/viewpage.action?pageId=987")).toBe("987");
  });
  it("returns null for tiny-links and garbage", () => {
    expect(parseConfluencePageId("https://x.atlassian.net/wiki/x/AbCdE")).toBeNull();
    expect(parseConfluencePageId("not a url")).toBeNull();
    expect(parseConfluencePageId("https://x.atlassian.net/wiki/spaces/ENG/overview")).toBeNull();
  });
});

describe("confluenceJsonToText", () => {
  it("pulls title + plain text from a Confluence content payload and caps length", () => {
    const payload = { title: "Charter", body: { view: { value: "<p>Hello <b>world</b></p>" } } };
    const out = confluenceJsonToText(payload);
    expect(out).toMatch(/Charter/);
    expect(out).toMatch(/Hello world/);
    expect(out.length).toBeLessThanOrEqual(MAX_INGEST_TEXT + 64);
  });
  it("returns empty string on a malformed payload (never throws)", () => {
    expect(confluenceJsonToText(null)).toBe("");
    expect(confluenceJsonToText({ body: {} })).toBe("");
  });
});
```

- [ ] **Step 2:** `npm run test:run -- project-ingest` -> FAIL.

- [ ] **Step 3: implement `src/app/project-ingest.ts`:**
```ts
// src/app/project-ingest.ts - pure, i18n-free ingestion helpers for SP-D.
import { htmlToPlainText } from "./html-to-text";

export const MAX_INGEST_TEXT = 60_000; // cap text sent to the proposal call (token-bounding)

/** Extract a numeric Confluence page id from the common Cloud URL shapes.
 *  Supported: /wiki/spaces/<KEY>/pages/<id>/..., /pages/<id>, ?pageId=<id>.
 *  Tiny-links (/wiki/x/...) and anything without an extractable id -> null. */
export function parseConfluencePageId(url: string): string | null {
  let parsed: URL;
  try { parsed = new URL(url); } catch { return null; }
  const byQuery = parsed.searchParams.get("pageId");
  if (byQuery && /^\d+$/.test(byQuery)) return byQuery;
  const m = parsed.pathname.match(/\/pages\/(\d+)(?:\/|$)/);
  return m ? m[1] : null;
}

interface ConfluencePayload { title?: unknown; body?: { view?: { value?: unknown } } }

/** Turn a Confluence content REST payload (expand=body.view) into capped plain text.
 *  Never throws; malformed -> "". */
export function confluenceJsonToText(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const p = payload as ConfluencePayload;
  const title = typeof p.title === "string" ? p.title : "";
  const html = typeof p.body?.view?.value === "string" ? p.body.view.value : "";
  if (!title && !html) return "";
  const body = html ? htmlToPlainText(html) : "";
  return `${title ? `# ${title}\n\n` : ""}${body}`.slice(0, MAX_INGEST_TEXT).trim();
}
```
(Confirm `htmlToPlainText` is the real export name in `html-to-text.ts`; adjust if different. If it lives elsewhere - `rg "export function htmlToPlainText" src/app` - import from there.)

- [ ] **Step 4:** `npm run test:run -- project-ingest` -> PASS. `npx tsc --noEmit` -> 0. `npm run lint`.

- [ ] **Step 5: commit**
```bash
git add src/app/project-ingest.ts src/app/project-ingest.test.ts
git commit -m "feat(sp-d): pure Confluence URL parse + content-to-text helpers"
```

---

## Task 3: Confluence proxy route + client

**Files:** Create `src/app/api/confluence/page/route.ts`, `src/app/confluence-api.ts`, `src/app/confluence-api.test.ts`. (Reuses `src/app/api/jira/_helpers.ts`.)

Context: `api/jira/_helpers.ts` exports `parseJiraRequest(request)` (rate-limit + parse body + creds), `callJira(creds, path, init?)` (SSRF-guarded to `*.atlassian.net`, Basic auth, 10s timeout, status-only error envelope), `forwardJsonResponse(upstream)` (forwards status + JSON). Confluence is the SAME Atlassian host - just the `/wiki/rest/api/...` path - so the route reuses all of it.

- [ ] **Step 1: failing test** - `src/app/confluence-api.test.ts` (test the client; mock fetch):
```ts
import { describe, expect, it, vi } from "vitest";
import { fetchConfluencePage } from "./confluence-api";

describe("fetchConfluencePage", () => {
  it("POSTs pageId + creds to the proxy and returns the page text", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ title: "Charter", body: { view: { value: "<p>Hi</p>" } } }), { status: 200 }),
    );
    const out = await fetchConfluencePage("https://x.atlassian.net/wiki/spaces/E/pages/42/T", { siteUrl: "https://x.atlassian.net", email: "a@b.c", apiToken: "tok" });
    expect(fetchMock.mock.calls[0][0]).toBe("/api/confluence/page");
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.pageId).toBe("42");
    expect(out.text).toMatch(/Charter/);
    expect(out.text).toMatch(/Hi/);
    fetchMock.mockRestore();
  });
  it("throws a status-only error on a non-OK proxy response (never the token/body)", async () => {
    const fetchMock = vi.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify({ error: 404 }), { status: 404 }));
    await expect(fetchConfluencePage("https://x.atlassian.net/wiki/spaces/E/pages/42/T", { siteUrl: "https://x.atlassian.net", email: "a@b.c", apiToken: "tok" })).rejects.toThrow(/404/);
    fetchMock.mockRestore();
  });
  it("rejects a URL with no extractable page id before calling fetch", async () => {
    const fetchMock = vi.spyOn(global, "fetch");
    await expect(fetchConfluencePage("https://x.atlassian.net/wiki/x/AbC", { siteUrl: "https://x.atlassian.net", email: "a@b.c", apiToken: "tok" })).rejects.toThrow(/page-id/);
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockRestore();
  });
});
```

- [ ] **Step 2:** `npm run test:run -- confluence-api` -> FAIL.

- [ ] **Step 3: implement `src/app/confluence-api.ts`:**
```ts
// src/app/confluence-api.ts - browser client for the same-origin Confluence proxy.
import { parseConfluencePageId, confluenceJsonToText } from "./project-ingest";

export interface AtlassianCreds { siteUrl: string; email: string; apiToken: string; }

/** Resolve a Confluence page URL to its capped plain text via the /api/confluence/page proxy.
 *  Throws Error(<status>) on a non-OK proxy response and Error("page-id") on an unparseable URL.
 *  The apiToken is sent to the SAME-ORIGIN proxy only; it is never logged here. */
export async function fetchConfluencePage(url: string, creds: AtlassianCreds): Promise<{ title: string; text: string }> {
  const pageId = parseConfluencePageId(url);
  if (!pageId) throw new Error("page-id");
  const res = await fetch("/api/confluence/page", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ pageId, ...creds }),
  });
  if (!res.ok) throw new Error(String(res.status));
  const json = (await res.json()) as { title?: string };
  const text = confluenceJsonToText(json);
  if (!text) throw new Error("parse");
  return { title: typeof json.title === "string" ? json.title : "", text };
}
```

- [ ] **Step 4: implement the route `src/app/api/confluence/page/route.ts`:**
```ts
// Same-origin proxy for fetching a Confluence Cloud page. Reuses the hardened
// /api/jira helpers (SSRF allowlist to *.atlassian.net, Basic auth, 10s timeout,
// status-only error envelope). Credentials are sent per-request and never persisted.
import { parseJiraRequest, callJira, forwardJsonResponse } from "../../jira/_helpers";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const parsed = await parseJiraRequest(request);
  if ("error" in parsed) return parsed.error;
  const { creds, body } = parsed;
  const pageId = typeof body.pageId === "string" ? body.pageId : "";
  if (!/^\d+$/.test(pageId)) {
    return Response.json({ error: "invalid-page-id" }, { status: 400 });
  }
  const upstream = await callJira(creds, `/wiki/rest/api/content/${pageId}?expand=body.view`);
  return forwardJsonResponse(upstream);
}
```
(Import path: confirm the relative depth from `api/confluence/page/route.ts` to `api/jira/_helpers.ts` is `../../jira/_helpers` - it is: page -> confluence -> api, then into jira.)

- [ ] **Step 5:** `npm run test:run -- confluence-api` -> PASS. `npx tsc --noEmit` -> 0. `npm run lint`.
  Optional: if there's an existing API-route test harness (`rg "api/jira" src/app/*.test.*`), add a route-handler test calling `POST(new Request(...))` with a mocked `callJira`; otherwise the client test + the reused-helper coverage suffices - note which you did.

- [ ] **Step 6: commit**
```bash
git add src/app/confluence-api.ts src/app/api/confluence/page/route.ts src/app/confluence-api.test.ts
git commit -m "feat(sp-d): Confluence page proxy route + client (reuses hardened jira helpers)"
```

---

## Task 4: SharePoint file content fetch

**Files:** Modify `src/app/m365-sharepoint.ts`. Test: `src/app/m365-sharepoint.test.ts` (extend).

Context: `m365-sharepoint.ts` already drives the SharePoint picker (used for document links) and uses `useMsAuth().acquireToken(scopes, opts)`. We add a helper to fetch a selected file's bytes via Graph. Read the file to learn the picker's selected-item shape (drive id + item id, or a webUrl/download URL).

- [ ] **Step 1: failing test** - extend `m365-sharepoint.test.ts`:
```ts
it("fetchSharePointFileContent builds the Graph content URL and uses the token", async () => {
  const fetchMock = vi.spyOn(global, "fetch").mockResolvedValue(new Response(new ArrayBuffer(3), { status: 200, headers: { "content-type": "application/pdf" } }));
  const acquire = vi.fn().mockResolvedValue("graph-token");
  const out = await fetchSharePointFileContent({ driveId: "D1", itemId: "I1", name: "charter.pdf" }, acquire);
  expect(acquire).toHaveBeenCalled(); // a Files.Read-style scope
  expect(String(fetchMock.mock.calls[0][0])).toContain("/drives/D1/items/I1/content");
  const init = fetchMock.mock.calls[0][1] as RequestInit;
  expect((init.headers as Record<string, string>).Authorization).toBe("Bearer graph-token");
  expect(out.name).toBe("charter.pdf");
  expect(out.mime).toBe("application/pdf");
  expect(out.bytes.byteLength).toBe(3);
  fetchMock.mockRestore();
});
```
Adjust the item shape (`{driveId, itemId, name}`) to MATCH what the existing picker returns - read the picker's selection type and reuse it; if it returns a different shape, take that type and derive driveId/itemId from it.

- [ ] **Step 2:** `npm run test:run -- m365-sharepoint` -> FAIL.

- [ ] **Step 3: implement** in `m365-sharepoint.ts`:
```ts
const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

export interface SharePointFileRef { driveId: string; itemId: string; name: string; }

/** Fetch a selected SharePoint file's bytes via Graph. The caller (wizard) converts
 *  the bytes -> a chat-attachments block. `acquireToken` is useMsAuth().acquireToken. */
export async function fetchSharePointFileContent(
  ref: SharePointFileRef,
  acquireToken: (scopes: string[], opts?: { interactive?: boolean }) => Promise<string>,
): Promise<{ name: string; mime: string; bytes: ArrayBuffer }> {
  const token = await acquireToken(["Files.Read.All"], { interactive: true });
  const res = await fetch(`${GRAPH_BASE}/drives/${ref.driveId}/items/${ref.itemId}/content`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(String(res.status)); // status only - never echo body/token
  const mime = res.headers.get("content-type")?.split(";")[0] ?? "application/octet-stream";
  const bytes = await res.arrayBuffer();
  return { name: ref.name, mime, bytes };
}
```
Use the SAME Graph scope convention the file already uses for SharePoint (`rg "acquireToken" src/app/m365-sharepoint.ts` - match its scope list; `Files.Read.All` or `Sites.Read.All`). `graph.microsoft.com` is already in the CSP allowlist.

- [ ] **Step 4:** `npm run test:run -- m365-sharepoint` -> PASS. `npx tsc --noEmit` -> 0. `npm run lint`.

- [ ] **Step 5: commit**
```bash
git add src/app/m365-sharepoint.ts src/app/m365-sharepoint.test.ts
git commit -m "feat(sp-d): fetchSharePointFileContent via Graph"
```

---

## Task 5: Wizard Step-0 source picker + wiring

**Files:** Modify `src/app/create-project-wizard.tsx`, `src/app/i18n.ts`, `src/app/i18n.de.ts`. Test: `src/app/create-project-wizard.test.tsx` (extend).

Context: Step 0 today is a "Describe" textarea + a generate button calling `handleGenerate` -> `generate(description)` -> `proposalToDraftPatch`/`proposalToSeed` pre-fill. We add source METHODS, each producing content for the SAME `generate`. Read the current Step-0 JSX (~lines 124-220) to match layout/classes.

- [ ] **Step 1: failing test** - extend `create-project-wizard.test.tsx`:
```ts
it("ingests an uploaded file and runs the proposal", async () => {
  // render the wizard with a configured AI key (Step 0). Mock useProjectProposal.generate.
  // Switch to the "Upload file" method; fire a file change with a small text File;
  // assert generate was called with a content-block ARRAY (text intro + attachment block).
});
it("hides SharePoint when M365 is off and Confluence when Jira is unconfigured", () => {
  // render with M365 disabled + no jira config -> the SharePoint + Confluence method buttons are absent.
});
```
(Follow the file's existing wizard render/stub harness; mock `useProjectProposal`, and the source helpers where needed.)

- [ ] **Step 2:** run -> FAIL.

- [ ] **Step 3: wire the UI.** In `create-project-wizard.tsx` Step 0:
- Add a method state: `const [method, setMethod] = useState<"describe" | "file" | "sharepoint" | "confluence">("describe")` and a small segmented control / button row to pick it (labels via new i18n keys; each gated):
  - "describe": always. "file": always. "sharepoint": only when SharePoint is enabled (`isSharePointEnabled(settings)` - the same gate Documents uses; `rg "isSharePointEnabled" src/app`). "confluence": only when Jira configured (`settings.jira?.enabled && settings.jira?.siteUrl && settings.jira?.apiToken`).
- **Describe:** the existing textarea + generate(description). Unchanged.
- **File:** an `<input type="file" aria-label={t(lang,"wizardImportFileLabel")}>`; on change, read the first file: validate `checkAttachmentSize(file.size)` and `classifyAttachment(file.type, ext)` (from `chat-attachments`); FileReader (readAsDataURL for pdf/image, readAsText for text); build the block via `buildAttachmentBlock`; then `runIngest([{ type: "text", text: t(lang,"wizardImportFilePrompt") }, block])`. On unsupported/too-large -> set a sanitized error.
- **SharePoint:** a button that opens the existing SharePoint picker; on a selected file -> `fetchSharePointFileContent(ref, acquireToken)` -> classify the bytes -> base64 (for pdf/image) or decode text -> block -> `runIngest([...])`. Use `useMsAuth().acquireToken`. Catch consent-denied/Graph errors -> sanitized message.
- **Confluence:** a URL `<input>` + a "Fetch" button; on submit -> `fetchConfluencePage(url, jiraCreds)` (jiraCreds from `settings.jira`) -> `runIngest(`${t(lang,"wizardImportConfluencePrompt")}\n\n${title}\n\n${text}`)` (a STRING). Catch "page-id"/status errors -> sanitized message.
- **`runIngest(content)` helper:** wraps `handleGenerate` but takes the content (string | blocks): `const p = await generate(content); if (!p) return; setMeta(null); setDraftPatch(proposalToDraftPatch(p)); ...` (mirror the existing `handleGenerate` body exactly - factor `handleGenerate` to call `runIngest(description)` so both share the post-proposal pre-fill logic). Busy spinner while `aiBusy`; error via `aiError` + a local ingest-error state for the source-specific failures.
- Keep `Skip` / manual Step-1 path intact.

- [ ] **Step 4: i18n.** EN (`i18n.ts`):
```ts
  wizardImportMethodDescribe: "Describe",
  wizardImportMethodFile: "Upload a file",
  wizardImportMethodSharePoint: "From SharePoint",
  wizardImportMethodConfluence: "From Confluence",
  wizardImportFileLabel: "Choose a file (PDF, image, or text)",
  wizardImportFilePrompt: "Create a project from this document:",
  wizardImportConfluencePrompt: "Create a project from this Confluence page:",
  wizardImportConfluenceUrl: "Confluence page URL",
  wizardImportFetch: "Fetch",
  wizardImportErrorUnsupported: "That file type is not supported.",
  wizardImportErrorTooLarge: "That file is too large (max 20 MB).",
  wizardImportErrorConfluenceUrl: "Could not read that Confluence URL.",
  wizardImportErrorSource: "Could not import from that source.",
```
DE (`i18n.de.ts`) via node UTF-8 write (REAL umlauts; delete script): German equivalents - e.g. `wizardImportMethodFile: "Datei hochladen"`, `wizardImportMethodSharePoint: "Aus SharePoint"`, `wizardImportMethodConfluence: "Aus Confluence"`, `wizardImportFileLabel: "Datei wählen (PDF, Bild oder Text)"`, `wizardImportFetch: "Abrufen"`, `wizardImportErrorTooLarge: "Diese Datei ist zu groß (max. 20 MB)."`, `wizardImportErrorConfluenceUrl: "Diese Confluence-URL konnte nicht gelesen werden."`, etc. ALL umlauts real (ä/ö/ü/ß) via the node script. Confirm EN/DE parity (tsc).

- [ ] **Step 5:** `npm run test:run -- create-project-wizard i18n` -> PASS. `npm run test:run` (full) -> green. `npx tsc --noEmit` -> 0. `npm run lint`. Delete the temp DE script.

- [ ] **Step 6: commit**
```bash
git add -A
git commit -m "feat(sp-d): wizard Step-0 file/SharePoint/Confluence import + i18n"
```

---

## Task 6: CSP verify + release

**Files:** verify `src/proxy.ts`; modify `src/app/version.ts`, `src/app/i18n.ts` / `i18n.de.ts`, `CHANGELOG.md`.

- [ ] **Step 1: CSP check.** `rg "graph.microsoft|atlassian|connect-src" src/proxy.ts`. Confirm `graph.microsoft.com` is in `connect-src` (it is, for M365). The Confluence call is browser -> `/api/confluence/page` (same-origin -> always allowed) and the server -> Atlassian (NOT CSP-bound). So NO new CSP host is needed. If `graph.microsoft.com` is somehow absent, add it. (CSP edits need a dev-server restart - note it.)

- [ ] **Step 2: version.ts** - `APP_VERSION = "0.110.0"`, `APP_MILESTONE = "Reynolds"` (Alastair Reynolds); update the build-date comment + milestone JSDoc; append `"versionHighlightProjectImport"` as the LAST `APP_HIGHLIGHT_KEYS` entry.

- [ ] **Step 3: EN highlight** (`i18n.ts`):
```ts
  versionHighlightProjectImport: "Create a project by importing a file, a SharePoint document, or a Confluence page - the AI reads it and pre-fills the new-project wizard.",
```

- [ ] **Step 4: DE highlight** (`i18n.de.ts`) via node UTF-8 write (real umlauts; delete script):
`"Erstellen Sie ein Projekt, indem Sie eine Datei, ein SharePoint-Dokument oder eine Confluence-Seite importieren - die KI liest es und füllt den Assistenten für neue Projekte vor."`
(real ü in "füllt", "für"). Confirm parity + the i18n-encoding test.

- [ ] **Step 5: CHANGELOG.md** - new top entry, mirror the existing format (`## [0.110.0] - 2026-06-20 "Reynolds"`):
```markdown
### Added
- Create a project from a source: in the new-project wizard you can now upload a file (PDF, image, or text), pick a SharePoint document, or paste a Confluence page URL - the AI reads the content and pre-fills the project details. Confluence is fetched through a same-origin proxy reusing your Atlassian (Jira) credentials; SharePoint via Microsoft Graph.
```

- [ ] **Step 6: build + suites** - `npm run build` -> PASS. `npm run test:run` -> green. `npx tsc --noEmit` -> 0. `npm run lint` -> clean.

- [ ] **Step 7: a11y.** The create wizard is likely NOT in the axe `A11Y_VIEWS` (it's a modal/flow, not one of the 12 named views) - confirm via `rg "A11Y_VIEWS" e2e/a11y.spec.ts`. If it's not scanned, eye-verify the new controls have accessible names (file input `aria-label`, method buttons labeled, URL input labeled). If the relevant view IS scanned, run `npx playwright test e2e/a11y.spec.ts -g "<View>"`.

- [ ] **Step 8: commit**
```bash
git add src/app/version.ts src/app/i18n.ts src/app/i18n.de.ts CHANGELOG.md src/proxy.ts
git commit -m "chore(sp-d): release v0.110.0 Reynolds (create project from file/SharePoint/Confluence)"
```

---

## Final review
After all tasks, review `git diff main...HEAD`:
- The Confluence proxy reuses the hardened `callJira` (SSRF allowlist, Basic auth, status-only errors); the route validates `pageId` (`^\d+$`) server-side; the Atlassian token + body never reach the browser response.
- The proposal call + SharePoint fetch never log/echo the apiKey, Graph token, or response body; errors carry only status / a controlled token.
- File ingestion enforces the 20 MB cap + type classification (reuses chat-attachments); Confluence/SharePoint text capped at MAX_INGEST_TEXT.
- Each source method is correctly gated (file always; SharePoint on M365; Confluence on Jira config; proposal on AI key); the multimodal `generate` passes blocks through unstringified.
- No new persisted Workspace field; no new CSP host; i18n EN/DE parity + real umlauts; tsc clean incl tests.

Then use **superpowers:finishing-a-development-branch**.
