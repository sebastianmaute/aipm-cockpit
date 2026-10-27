# aipm-cockpit Threat Model (STRIDE)

> **Scope banner, added 2026-09-13.** This STRIDE pass was done against v0.164 "Cixin" (2026-07-02);
> the pass has not been re-run since. The fifth `SecretId`, `sttApiKey`, and the
> `/api/stt` proxy route (browser → same-origin `/api/stt` → a user-configured OpenAI-compatible host)
> were added after it and are **unreviewed** here — the review-cadence trigger below has fired for both.
> Line-number citations and counts below are as of the date on each, not current.
> **Added 2026-10-27:** the optional AI gateway relay (`/api/ai/*`, B6 below) and the `ai` deployment switch.
> B6 records the boundary as built; it is not a re-run of the whole pass.

**Date:** 2026-07-02 · **Scope:** v0.164 "Cixin" · **Author role:** Senior software architect
**Review cadence:** re-run this STRIDE pass on every new trust boundary — a new external host in the CSP `connect-src`/`frame-src` allowlist (`src/proxy.ts`), a new `SecretId` (`src/app/secrets.ts:8`), or a new `/api/*` route. Owner: security-lead; enforced in MR review via the CSP + SecretId lockstep lists.

> Method: STRIDE (Spoofing, Tampering, Repudiation, Information disclosure, Denial of service, Elevation of privilege) over each trust boundary. Every mitigation cites its source, verified against the tree at the date on the citation. ★★ Prefer a SYMBOL or a grep over a `file:line` — an edit that inserts lines silently repoints every citation below it, and that is not hypothetical here: a 10-line comment rewrite in `src/proxy.ts` on 2026-08-09 broke all four `proxy.ts:NN` cites in this file at once, each of which had been exact. They now cite the CSP directive by name. Where a line number remains it has not been re-verified since the date above. This is a **client-heavy** app: the browser calls Anthropic / MS Graph / Turso directly; only Jira, Confluence, Timelog, and ECB FX go through thin same-origin Next.js proxy routes.

---

## Assets

| Asset | At rest | In transit | Notes |
|---|---|---|---|
| Anthropic API key | `aipm-cockpit:secrets` — AES-256-GCM, non-extractable device key in IndexedDB `aipm-cockpit-secrets` (`secrets.ts:47-49,113-117`) | browser → `api.anthropic.com` (CSP `connect-src` in `proxy.ts`); on a gateway deployment browser → same-origin `/api/ai/*` → the configured AI gateway (B6) | `SecretId="anthropicApiKey"` |
| AI gateway token | server environment `AIPM_AI_GATEWAY_TOKEN` only, read by `readAiGatewayConfig` (`ai-gateway-config.ts`, which a test keeps out of every client module) | server → AI gateway as `cf-aig-authorization: Bearer` (B6) | optional; the only server-side secret; never in a page, a status answer or a log |
| Turso authToken | same | browser → `*.turso.io` (CSP `connect-src` in `proxy.ts`) | `SecretId="tursoAuthToken"` |
| Jira apiToken | same | browser → `/api/jira/*` → `*.atlassian.net` (Basic auth built server-side, `jira/_helpers.ts:140-142`) | `SecretId="jiraApiToken"`; per-request in body, never persisted server-side (`jira/_helpers.ts:1-4`) |
| Timelog apiToken | same | browser → `/api/timelog/*` → `*.timelog.com` (Bearer, `timelog/_helpers.ts:173`) | `SecretId="timelogApiToken"` |
| Workspace / project data | file (JSON/CSV/MD) · IndexedDB `aipm-cockpit` · Turso | per backend | not a secret; user's own data |
| M365 tokens | MSAL-owned cache (NOT app-managed) | browser → `graph.microsoft.com` / `login.microsoftonline.com` | app stores only public clientId/tenantId |

**Optional passphrase wrap:** the `secrets.ts` API accepts a PBKDF2 passphrase wrap for any `SecretId`, but only `anthropicApiKey` and `tursoAuthToken` have a passphrase UI (`git grep -n "setSecretPassphrase(" -- src ':!*.test.*'`); the Jira, Timelog and STT tokens are device-wrapped only (corrected 2026-09-13: this line said "any `SecretId` may be PBKDF2-wrapped") — **600,000 iterations, SHA-256** (`PBKDF2_ITERS`: `grep -n "const PBKDF2_ITERS" src/app/secrets.ts`), meets OWASP ASVS 2023 (≥ 600k for PBKDF2-HMAC-SHA256). Device wrap is the default; passphrase-wrapped secrets stay `""` in memory until unlock.

---

## Trust boundaries

### B1 — Browser ↔ Anthropic (direct, `anthropic-dangerous-direct-browser-access`)

| STRIDE | Threat | Existing mitigation | Residual | Action |
|---|---|---|---|---|
| I | API key exposed in browser memory / network tab | Inherent to direct-browser calls; key is the user's own, entered by them; encrypted at rest (`secrets.ts`), blanked on disk by `writeSettings` | User with devtools sees their own key (accepted — it's theirs) | none |
| T | Malicious model output drives a write tool | AI tool outputs re-validated: `parseAnalysis`/`groundEntity` (`action-ai.ts`), per-entity `sanitizeX`, `parseWeightSuggestions`→`NEXT_ACTIONS_FIELD_COERCE` | model can't reach a raw state setter | keep validators mandatory (Phase 2 Task 9) |
| D | Runaway agentic loop bills the user | The chat is a tool loop, capped by `clampMaxChatTurns` (`settings-types.ts`, 1–50, default 12); the background runners (scheduled jobs, automatic insight recommendations, scheduled digest narrative) need the separate background consent and scheduled jobs fail once per slot; action-analysis / weight-suggest are single forced-tool calls (no loop) | — | none |

### B2 — Browser ↔ MS Graph / MSAL

| STRIDE | Threat | Existing mitigation | Residual | Action |
|---|---|---|---|---|
| S/E | Token theft / over-broad scope | MSAL owns token cache (app stores no M365 secret); incremental consent — background probes silent, new scope pops interactive dialog | — | none |
| I | Exfil to a spoofed Graph host | CSP `connect-src graph.microsoft.com` + `frame-src login.microsoftonline.com` (the `connect-src` and `frame-src` entries in `proxy.ts`) | `connect-src` also allows `*.sharepoint.com` and `*.files.1drv.com` for the SharePoint backend's pre-authenticated download URL (no Graph token is sent there) | acceptable; both are Microsoft-operated |

### B3 — Browser ↔ Turso (libSQL HTTP `/v2/pipeline`)

| STRIDE | Threat | Existing mitigation | Residual | Action |
|---|---|---|---|---|
| I | authToken exfil | encrypted at rest; CSP restricts `connect-src` to `*.turso.io` + loopback (CSP `connect-src` in `proxy.ts`) | loopback plaintext http allowed for self-hosted tursodb (documented, `turso-config.ts toHttpUrl`) | acceptable for local dev; note in findings |
| T | Non-workspace tables wiped by save | `TABLE_NAMES` guard test keeps snapshot/version/template tables out of the per-table DELETE | — | none |

### B4 — Browser ↔ `/api/jira|confluence|timelog|ecb` proxies (SSRF-guarded)

The strongest surface — this is where the server makes outbound calls on the user's behalf. Full guard chain verified:

| STRIDE | Threat | Existing mitigation (verified) | Residual | Action |
|---|---|---|---|---|
| I/E | **SSRF to internal host** | **Host allowlist**: jira `=== "atlassian.net" \|\| endsWith(".atlassian.net")` (`jira/_helpers.ts:115-121`); timelog `=== "timelog.com" \|\| endsWith(".timelog.com")` (`timelog/_helpers.ts:81-84`). Leading-dot rejects `evil-atlassian.net` / `atlassian.net.attacker.com`. | DNS-rebind to an allowed name resolving internal is blocked by the allowlist sidestepping resolution entirely (documented `jira/_helpers.ts:109-114`) | none |
| I/E | SSRF via IP literal / metadata endpoint | `isPrivateHost` fail-closed: loopback, RFC1918, 169.254/16 (cloud metadata), IPv6 ULA/link-local, NAT64 `64:ff9b::/96`, IPv4-mapped IPv6 recovered + re-checked (`isPrivateHost` in `api/_shared/proxy-ssrf.ts`, shared by the proxies; corrected 2026-09-13 — it was cited in `jira/_helpers.ts`, "mirrored timelog") | — | none |
| T | Credential-injection / port smuggling in host | timelog rejects `@` and `:` in host up front (`timelog/_helpers.ts:90`); jira normalizes via `new URL` + origin-only (`jira/_helpers.ts:123-138`) | — | none |
| T | **Path traversal / request smuggling** | timelog rejects `..`, `\r`, `\n`, `#` and enforces `^/v1/` prefix (`timelog/_helpers.ts:135-145`); confluence validates `pageId` `^\d+$` server-side (`confluence/page/route.ts:12-15`); tenant `encodeURIComponent`'d (`timelog/_helpers.ts:168`) | — | none |
| T | Field injection on Jira write | `sanitizeIssueFields` allowlists summary/priority/labels/description/duedate, strips all else (`jira/_helpers.ts:200-267`) | — | none |
| S | Plaintext credential interception | jira rejects non-`https:` (`jira/_helpers.ts:128`); timelog forces `https://` (`timelog/_helpers.ts:168`) | — | none |
| D | Proxy resource exhaustion | per-IP sliding-window rate limit, 60/min, scoped per route so jira/timelog/ecb don't drain each other (`jira/_rate-limit.ts:6-7,42-43`); 10s upstream timeout via `AbortSignal.timeout` (`jira/_helpers.ts:148,174`; `timelog/_helpers.ts:99,179`) | in-memory Map → single-process only (documented `_rate-limit.ts:1-4`); multi-instance needs shared store | note as LOW (deployment-topology dependent) |
| R/I | Secret leaked to server logs | Each proxy has exactly ONE `console.error`, and none takes a credential: jira and ecb log the caught `err` only; timelog logs a derived failure class, an elapsed ms and the request PATH — never a header, body or token (`grep -n "console.error" src/app/api/jira/_helpers.ts src/app/api/timelog/_helpers.ts src/app/api/ecb/route.ts`) | — | re-verified 2026-08-09 |

### B5 — Local persistence (localStorage settings blob, IndexedDB, FS-access handles)

| STRIDE | Threat | Existing mitigation | Residual | Action |
|---|---|---|---|---|
| I | Decrypted secret written to disk | `writeSettings` is the SOLE writer of `aipm-cockpit:settings` and BLANKS every `SecretId` field before write (AGENTS.md secrets lockstep; guarded by Phase 1 Task 7 test) | a raw `setItem` bypass would leak — prevented by convention + test | Phase 1 Task 7 pins it |
| I | Secret exported / synced to Turso | `aipm-cockpit:secrets` ciphertext excluded from exports, Turso, and recovery `CONFIG_KEYS` (`recovery-config.ts`) | — | Phase 1 Task 7 pins it |
| T | Tampered ciphertext | AES-GCM auth tag → `SecretUnlockError` on tamper (`secrets.ts:137-148`); `isSealedSecret` validates shape from untrusted storage (`secrets.ts:23-36`) | — | none |
| I | XSS reads localStorage | Every raw-HTML sink either sanitizes or renders an app-authored constant — **11 sinks: 8 `dangerouslySetInnerHTML` + 3 `document.write(`**, of which 2 are static literals (see "Raw-HTML sinks" below for the reproduce commands and the breakdown); branding logo/favicon raster-only, SVG excluded; rich text via `sanitize-html.ts`; strict nonce-based CSP, no `unsafe-inline` script (corrected 2026-08-09: this cell previously read "No `dangerouslySetInnerHTML` anywhere", which was false, and cited a `proxy.ts` comment that said the same. Corrected again 2026-09-18: it then read "6 sites", also false — re-derived, not restated) | `style-src-attr 'unsafe-inline'` required for React inline styles (documented low-risk, `proxy.ts`) | none |

### B6 — Browser ↔ `/api/ai/*` relay ↔ the organisation's AI gateway (optional, `AIPM_AI_GATEWAY_URL`)

Only on a deployment that sets `AIPM_AI_GATEWAY_URL`; otherwise the relay answers 404 and B1 applies. A **new server-side trust boundary**: the app server now sees every prompt, answer and Anthropic key in transit. The host is the operator's, never the user's, so there is no SSRF surface. Code: `relay` (`src/app/api/ai/_relay.ts`), `readAiGatewayConfig` (`src/app/ai-gateway-config.ts`), `confirmAiDeployment` (`src/app/ai-transport.ts`). Operating notes: `docs/RUNBOOK.md` "Routing AI through a gateway".

| STRIDE | Threat | Existing mitigation | Residual | Action |
|---|---|---|---|---|
| I | Prompts, answers and keys disclosed by the server | The relay logs nothing — not the key, the token, the URL or the body (`_relay.ts` header); forwards only `x-api-key`, `anthropic-version`, `anthropic-beta`, `content-type` (`FORWARDED_HEADERS`), so cookies stay on the server; the consent dialog and Help say the data passes through this app's server and the gateway (`AI_DESTINATION_KEYS`, `ai-disclosure.ts`), and a consent records its route (`isConsentCurrent`, `ai-consent.ts`) | the operator's host and the gateway's own logging see the traffic; disclosed to the user, configured by the organisation | none |
| I | Gateway token leaks to a browser | Read only in server modules; the client gets `{ off, route, invalid }` (`aiDeploymentStateFrom`) and nothing else, in the page and from `/api/ai/status` | — | none |
| S/E | Another site, or a caller with no key, spends through the gateway | Same-origin check (`isSameOrigin`: `Sec-Fetch-Site`, else `Origin`); a call without its own `x-api-key` is refused with 400 `missing-api-key` before anything is sent | a non-browser client that sends neither header passes the same-origin check and can use the gateway with **its own** Anthropic key (billed to that key, and always forwarded, so it cannot trigger a stored provider key) | none |
| E | Gateway token used to spend stored provider keys | The token is server-only (see the token row above); the relay never sends a request without the caller's own key | Cloudflare documents an "AI Gateway Run" token as valid for EVERY gateway in the account, and a gateway substitutes a stored (BYOK) key whenever the provider key header is absent: whoever obtains the token (server compromise, leaked environment) can spend any stored keys in that account | no gateway in the account holds stored provider keys, or a dedicated Cloudflare account for this app (RUNBOOK "Routing AI through a gateway", step 3) |
| T | Misconfigured URL sends requests somewhere unintended, or silently falls back to a direct call | `https` only; no credentials, `@`, whitespace, query or fragment; no `/v1`, `/v1/messages` or `/v1/models` suffix (any case); an invalid value **fails closed** (AI off for the deployment, 503 `ai-gateway-invalid`), never a fallback to `api.anthropic.com`; `https.request` follows no redirect | — | none |
| D | Large or slow requests tie up the server, including its memory | 32 MB body cap (Anthropic's own Messages limit, answered as an Anthropic-shaped 413); 15-minute idle timeout (`RELAY_TIMEOUT_MS`); no per-IP limit by design | rate limiting belongs to the gateway; the relay buffers each request body in the app server's memory before sending it (`readCappedBody`), up to 32 MB per relayed request, with no cap on concurrent requests: many large calls at once can exhaust the server's memory (the same pattern as `/api/stt` at 25 MB); a front proxy with a smaller body limit or a shorter read timeout refuses large or long calls before the relay sees them | configure it on the gateway; restrict network access to the app to the people who use it, which is the control on concurrent load; the front proxy allows at least 32 MB bodies and 15-minute reads on `/api/ai/messages` (RUNBOOK "Routing AI through a gateway", step 5) |
| I | Client's direct-call allowance outlives the route | CSP `connect-src` drops `api.anthropic.com` when AI is switched off, invalid or relayed (`proxy.ts`); the client asks `/api/ai/status` before every send and stops on a changed route (`confirmAiDeployment`) | a tab loaded from a release before the relay has no status check and keeps the CSP it loaded with, which allows `api.anthropic.com`: on the first deploy that sets the gateway or the `ai` switch, it goes on calling Anthropic directly from the browser, under its old consent, until it is reloaded | tell users to reload every open tab when the gateway or the `ai` switch is first set (RUNBOOK "Routing AI through a gateway", "What to know when running it") |

---

## Existing mitigations inventory (verified)

- **Secrets at rest:** `secrets.ts` — AES-256-GCM, non-extractable device key (`generateKey(..., false, ...)` at `:113-116`), PBKDF2 600k iters (`:46`), singleton device-key promise prevents concurrent-tab key overwrite (`:99-125`).
- **SSRF:** `jira/_helpers.ts` + `timelog/_helpers.ts` — host allowlist (leading-dot), `isPrivateHost` (now shared from `api/_shared/proxy-ssrf.ts`) fail-closed (RFC1918/loopback/metadata/IPv6-ULA/NAT64/mapped-IPv4), https-only, `@`/`:`/`..`/CRLF/`#` rejection, path prefix allowlist, `encodeURIComponent` tenant.
- **CSP:** `proxy.ts` — per-request nonce, `script-src 'nonce' 'strict-dynamic'` (no `unsafe-inline`), `worker-src 'self'`, `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, tight `connect-src` allowlist.
- **Rate limiting:** `jira/_rate-limit.ts` — 60/min/IP sliding window, per-route scope, amortized eviction.
- **Input validation:** `sanitize.ts` barrel at every entity boundary; `sanitizeIssueFields` server-side field allowlist for Jira writes.
- **AI output validation:** `parseAnalysis` / `groundEntity` / `parseWeightSuggestions` / `NEXT_ACTIONS_FIELD_COERCE` re-validate untrusted model output before any state write or deep-link.
- **URL sinks:** `isSafeHttpUrl` (`document-link.ts`); the guard for AI project proposals is `judgeProjectField` (`project-ai-fields.ts`), which calls it.
- **Raw-HTML sinks — 11, re-derived 2026-09-18.** Do not quote this number; re-run the commands.

  ```bash
  grep -rn "dangerouslySetInnerHTML={" src --include=*.tsx | wc -l          # 8
  grep -rnE 'document\.write\(' src --include=*.ts --include=*.tsx | wc -l  # 3
  ```

  ★★ The second command's dot is ESCAPED on purpose. The unescaped spelling
  `grep -rn "document.write" ...` printed **19** on the same tree, because `.` matches a space and
  the phrase "document write" appears in sixteen comments and test names. That is where a count
  goes wrong without anyone noticing.

  **Breakdown (each site opened, 2026-09-18).** 2 are static app-authored literals — the
  `NO_FLASH_THEME_SCRIPT` constant rendered by `layout.tsx`, and `PREPARING_HTML` in
  `document-download.ts`. The other 9 all carry a sanitizer, but not all at the sink: 5 call
  `sanitizeRichHtml` or `sanitizeDocumentHtml` inline in the JSX, while `document-preview.tsx`,
  `documents-history-modal.tsx` and the two dynamic `document.write` sites render output of the
  document renderer, which sanitizes on its unescaped paths (`doc-render-html.ts`; both preview
  files carry a header comment saying there is deliberately no second pass). **Count and risk are
  different questions** — this bullet answers the count, and the per-sink judgement is the audit's,
  in `findings-2026-09.md`.

  ★ The enumeration in the `src/proxy.ts` CSP comment used to name six JSX sinks, omitting
  `document-block-notices.tsx` and `document-editor.tsx`. Both omitted sinks sanitize, so the
  comment's rationale always held and only its list was wrong. **Corrected 2026-09-18 in
  `src/proxy.ts`**, which now enumerates all eight and carries both sweep commands.
- **Dependency posture:** `npm audit` = 0 vulns across 719 deps (verified 2026-07-02); Phase 1 adds a blocking CI audit gate.

---

## Findings

Detailed severity-tagged findings (proxy review, secrets review, URL-sink review, SAST, DAST) live in `docs/security/findings-2026-07.md`. Headline going in: **no CRITICAL or HIGH identified in the manual pass**; residual items are LOW and deployment-topology dependent (in-memory rate-limit store; loopback-plaintext Turso for self-host).

**Added 2026-09-18:** `docs/security/findings-2026-09.md` is the current snapshot in that series and
**supersedes the 2026-07 file's SCOPE** — it covers the desktop shell, `/api/stt`, and the documents
and attachment-ingest subsystems, none of which existed in 2026-07. It records 3 high and 4 medium
findings and no critical. Read it first; the 2026-07 file remains as the dated record it is, with
corrections appended beside its original text rather than written over it.

---

## Review cadence (Phase 4)

Re-run the STRIDE pass on **every new trust boundary**, not on a fixed calendar:
- A new external host in the CSP allowlist (`src/proxy.ts` `connect-src`/`frame-src`).
- A new `SecretId` (the six-edit lockstep in `secrets.ts` / `writeSettings` / `readStore`).
- A new `/api/*` proxy route (SSRF guard chain — reuse `api/_shared/proxy-ssrf.ts`; see AGENTS.md).

Owner: security-lead. Enforced in MR review via the CSP/SecretId lockstep lists in
AGENTS.md (a reviewer checks the new boundary was STRIDE-assessed before merge). The
shared SSRF classifier (`proxy-ssrf.ts`) means the IP/allowlist guard is reviewed once
and reused — only each route's normalize/auth/URL is new-boundary surface.
