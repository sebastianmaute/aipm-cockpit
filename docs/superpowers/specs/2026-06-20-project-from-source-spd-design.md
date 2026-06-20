# SP-D - Create a Project from a File / SharePoint / Confluence - Design

**Date:** 2026-06-20
**Status:** Approved (design); spec pending user review
**Target release:** v0.110.0 "Reynolds"

> Fourth slice of the 6-part roadmap ([[task-status-kanban-roadmap]]). Extends the SP3
> "Use AI" project-creation fast-path (`ai-project-proposal.ts` / `use-project-proposal.ts` /
> `create-project-wizard.tsx`) with new ingestion sources. Reuses the SP2 multimodal
> attachment path (`chat-attachments.ts`) and the existing M365 Graph + Atlassian/Jira plumbing.

## Goal

Let a user create a project by ingesting a file (PDF/image/text), a SharePoint document, or a
Confluence page URL. The ingested content feeds the existing SP3 `propose_project` forced-tool
call, which pre-fills the create wizard. Browser-only app, so external content is reached either
natively (file bytes via multimodal) or through existing/new same-origin server proxies.

## Non-goals (SP-D)

- SP-E (steering committee), SP-F (tour) - later slices.
- No agentic loop (one forced-tool call). No new persisted Workspace field.
- The AI never auto-creates the project - it pre-fills the wizard; the user reviews + confirms.
- SharePoint: ingest ONE selected document, not an aggregated crawl of the library (YAGNI).
- No client-side PDF/Office parsing library - Claude reads PDF/image bytes natively (the SP2 rule).

## Decisions (locked during brainstorming)

1. **Three sources:** file upload + SharePoint (via M365 Graph) + Confluence page URL (via a new
   server proxy reusing the Atlassian/Jira creds; assumes Confluence is on the same Atlassian Cloud
   site as the configured Jira).
2. **Multimodal:** `useProjectProposal().generate` is extended to accept `string | ContentBlock[]`
   (the SP2 attachment blocks) - so PDF/image files are read natively.
3. All sources funnel into the SAME `generate(...)` -> `propose_project` -> wizard pre-fill flow.

## Architecture

### A. Multimodal proposal call (core change)
`use-project-proposal.ts` `generate(input: string | ContentBlock[])`: send `messages: [{ role:
"user", content: input }]` (Anthropic accepts a string OR a content-block array). Everything else
(forced `tool_choice: propose_project`, `parseProposal`, the never-log-key/body error discipline)
unchanged. `ContentBlock` is the SP2 type from `chat-attachments.ts`. No change to
`ai-project-proposal.ts`'s tool/parse contract.

### B. File upload
Reuse `chat-attachments.ts`: `classifyAttachment(mime, ext)` + the block builder (PDF/image ->
base64 `source`; text -> `{type:"text"}`), 20 MB cap. The `FileReader` (readAsDataURL for binary,
readAsText for text) lives in the wizard component (keeps `chat-attachments`/`project-ingest` pure).
Result: a `ContentBlock[]` (a short intro text block + the attachment block) passed to `generate`.

### C. SharePoint ingestion
Reuse the existing SharePoint picker (`m365-sharepoint.ts`, used today for document links) to select
ONE file, then fetch its bytes via Graph. New helper in `m365-sharepoint.ts`:
`fetchSharePointFileContent(driveItemRef, acquireToken): Promise<{ mime: string; name: string;
bytes: ArrayBuffer }>` - calls Graph `/drives/{driveId}/items/{itemId}/content` with a
`Files.Read`-scoped token from `useMsAuth().acquireToken`. The wizard converts bytes ->
base64/text -> `ContentBlock[]` via the same `chat-attachments` classification. Gated on
`isSharePointEnabled` (M365). If the picker already returns a download URL, use it; otherwise the
drive/item ids.

### D. Confluence ingestion (new same-origin server proxy)
- Pure helper in `project-ingest.ts`: `parseConfluencePageId(url: string): string | null` - extracts
  the numeric page id from the common Confluence URL shapes:
  `/wiki/spaces/<KEY>/pages/<id>/<slug>`, `/pages/<id>`, `?pageId=<id>`, and the short
  `/wiki/x/<...>` tiny-link is NOT supported (return null -> clear error). Returns null on anything
  without an extractable id.
- New Next.js route `src/app/api/confluence/page/route.ts` (mirrors the existing `/api/jira/*`
  proxy). Body: `{ pageId, siteUrl, email, apiToken }` (the Atlassian creds from `settings.jira`,
  posted by the client). The route calls
  `GET {siteUrl}/wiki/rest/api/content/{pageId}?expand=body.view` with HTTP Basic auth
  (`email:apiToken`, base64) SERVER-SIDE - the token never reaches the browser response. Returns
  `{ title, html }` on 200; on non-OK returns `{ error: <status> }` (status only, never the
  Atlassian body/token). Server-side fetch is NOT CSP-bound; confirm the Atlassian host is reachable.
- Client helper `confluence-api.ts`: `fetchConfluencePage(pageId, jiraCreds): Promise<{ title,
  html }>` POSTs to `/api/confluence/page` (same-origin -> no CSP/CORS). The wizard then strips the
  HTML to text via the existing `htmlToPlainText` and passes a string to `generate`.
- Gated on Jira being configured (`settings.jira.enabled && siteUrl && apiToken`).

### E. Wizard Step 0 (source picker)
Today Step 0 is a "Describe" free-text. SP-D turns it into "Start your project" with input methods,
each gated on its prerequisite, all producing content for the SAME `generate`:
- **Describe** (existing free text) - unchanged.
- **Upload a file** (always) - file input (PDF/image/text, 20 MB).
- **From SharePoint** (gated on M365) - picker -> one file -> Graph fetch.
- **From Confluence URL** (gated on Jira config) - a URL input -> proxy -> text.
On success: pre-fill via `proposalToDraftPatch`/`proposalToSeed` (existing) and advance; on failure
a sanitized inline error (map "no-key"/"parse"/status/"network" -> friendly i18n; never show
key/body). Busy spinner while generating.

## Error handling
- File: size/type validated before read; unsupported -> clear error; FileReader failure -> error.
- SharePoint: `acquireToken` may pop incremental consent; denied -> caught -> error toast/message.
  Graph non-OK -> status-only error.
- Confluence: `parseConfluencePageId` returns null -> "couldn't read that Confluence URL" message;
  proxy non-OK -> status-only; the route never leaks the Atlassian token/body.
- Proposal: existing never-log discipline; sanitized error mapping.
- Content size: cap the extracted Confluence/SharePoint text + enforce the 20 MB file cap before the
  Anthropic call.

## Testing (TDD)
Pure first:
- `parseConfluencePageId` - the 3 supported URL shapes + tiny-link/garbage -> null.
- content caps / classification reuse (a `chat-attachments` round-trip for a sample file).
Then:
- `use-project-proposal` multimodal - `generate(ContentBlock[])` sends `content` as the array;
  key-gated; error discipline unchanged (mock fetch).
- `confluence-api.ts` + the route handler - posts pageId/creds; maps a 200 to `{title,html}` and a
  non-OK to a status-only error; never returns the token. (Test the route handler function directly
  or via a fetch mock.)
- `m365-sharepoint.fetchSharePointFileContent` - builds the right Graph URL + uses the token (mock).
- wizard - each source path produces content + calls generate + pre-fills; SharePoint method hidden
  without M365; Confluence method hidden without Jira config; sanitized error rendering.
- `npx tsc --noEmit` (EN/DE parity) after editing tests; axe gate IF the create wizard is in
  `A11Y_VIEWS` (it likely is NOT - verify; if not, eye-verify the new controls' labels).
- EN+DE i18n (DE via node UTF-8 write, real umlauts).

## i18n / release
- New EN+DE keys: source-method labels (Describe / Upload file / From SharePoint / From Confluence),
  the Confluence URL input + placeholder, per-source error strings, busy label, and
  `versionHighlightProjectImport`.
- CSP: confirm `src/proxy.ts` connect-src already allows the Atlassian (Jira) host for the
  browser->/api/confluence is same-origin (no entry needed) AND that Graph host is allowed (already
  is). The server route's outbound Atlassian fetch is not CSP-bound.
- Bump `version.ts` (0.110.0 "Reynolds"), append the highlight key to `APP_HIGHLIGHT_KEYS`,
  add a `CHANGELOG.md` entry.

## File map
- `use-project-proposal.ts` - `generate` accepts `string | ContentBlock[]`.
- `project-ingest.ts` (NEW pure) - `parseConfluencePageId`, content caps, source orchestration helpers.
- `confluence-api.ts` (NEW) - client call to the proxy.
- `src/app/api/confluence/page/route.ts` (NEW server route) - Atlassian proxy (Basic auth, status-only errors).
- `m365-sharepoint.ts` - `fetchSharePointFileContent`.
- `create-project-wizard.tsx` - Step-0 source picker + FileReader + wiring.
- `chat-attachments.ts` - reused (classification + block builders); export anything the wizard needs.
- `i18n.ts` / `i18n.de.ts`, `version.ts`, `CHANGELOG.md`, `src/proxy.ts` (verify only).
