# aipm-cockpit Threat Model (STRIDE)

**Date:** 2026-07-02 · **Scope:** v0.164 "Cixin" · **Author role:** Senior software architect
**Review cadence:** re-run this STRIDE pass on every new trust boundary — a new external host in the CSP `connect-src`/`frame-src` allowlist (`src/proxy.ts`), a new `SecretId` (`src/app/secrets.ts:8`), or a new `/api/*` route. Owner: security-lead; enforced in MR review via the CSP + SecretId lockstep lists.

> Method: STRIDE (Spoofing, Tampering, Repudiation, Information disclosure, Denial of service, Elevation of privilege) over each trust boundary. Every mitigation cites its source, verified against the tree at the date on the citation. ★★ Prefer a SYMBOL or a grep over a `file:line` — an edit that inserts lines silently repoints every citation below it, and that is not hypothetical here: a 10-line comment rewrite in `src/proxy.ts` on 2026-08-09 broke all four `proxy.ts:NN` cites in this file at once, each of which had been exact. They now cite the CSP directive by name. Where a line number remains it has not been re-verified since the date above. This is a **client-heavy** app: the browser calls Anthropic / MS Graph / Turso directly; only Jira, Confluence, Timelog, and ECB FX go through thin same-origin Next.js proxy routes.

---

## Assets

| Asset | At rest | In transit | Notes |
|---|---|---|---|
| Anthropic API key | `aipm-cockpit:secrets` — AES-256-GCM, non-extractable device key in IndexedDB `aipm-cockpit-secrets` (`secrets.ts:47-49,113-117`) | browser → `api.anthropic.com` (CSP `connect-src` in `proxy.ts`) | `SecretId="anthropicApiKey"` |
| Turso authToken | same | browser → `*.turso.io` (CSP `connect-src` in `proxy.ts`) | `SecretId="tursoAuthToken"` |
| Jira apiToken | same | browser → `/api/jira/*` → `*.atlassian.net` (Basic auth built server-side, `jira/_helpers.ts:140-142`) | `SecretId="jiraApiToken"`; per-request in body, never persisted server-side (`jira/_helpers.ts:1-4`) |
| Timelog apiToken | same | browser → `/api/timelog/*` → `*.timelog.com` (Bearer, `timelog/_helpers.ts:173`) | `SecretId="timelogApiToken"` |
| Workspace / project data | file (JSON/CSV/MD) · IndexedDB `aipm-cockpit` · Turso | per backend | not a secret; user's own data |
| M365 tokens | MSAL-owned cache (NOT app-managed) | browser → `graph.microsoft.com` / `login.microsoftonline.com` | app stores only public clientId/tenantId |

**Optional passphrase wrap:** any `SecretId` may be PBKDF2-wrapped (`secrets.ts:170-187`) — **600,000 iterations, SHA-256** (`secrets.ts:46`), meets OWASP ASVS 2023 (≥ 600k for PBKDF2-HMAC-SHA256). Device wrap is the default; passphrase-wrapped secrets stay `""` in memory until unlock.

---

## Trust boundaries

### B1 — Browser ↔ Anthropic (direct, `anthropic-dangerous-direct-browser-access`)

| STRIDE | Threat | Existing mitigation | Residual | Action |
|---|---|---|---|---|
| I | API key exposed in browser memory / network tab | Inherent to direct-browser calls; key is the user's own, entered by them; encrypted at rest (`secrets.ts`), blanked on disk by `writeSettings` | User with devtools sees their own key (accepted — it's theirs) | none |
| T | Malicious model output drives a write tool | AI tool outputs re-validated: `parseAnalysis`/`groundEntity` (`action-ai.ts`), per-entity `sanitizeX`, `parseWeightSuggestions`→`NEXT_ACTIONS_FIELD_COERCE` | model can't reach a raw state setter | keep validators mandatory (Phase 2 Task 9) |
| D | Runaway agentic loop bills the user | Action-analysis / scheduled-jobs / weight-suggest are single forced-tool calls (no loop); scheduled jobs fail-once-per-slot | — | none |

### B2 — Browser ↔ MS Graph / MSAL

| STRIDE | Threat | Existing mitigation | Residual | Action |
|---|---|---|---|---|
| S/E | Token theft / over-broad scope | MSAL owns token cache (app stores no M365 secret); incremental consent — background probes silent, new scope pops interactive dialog | — | none |
| I | Exfil to a spoofed Graph host | CSP `connect-src graph.microsoft.com` + `frame-src login.microsoftonline.com` only (the `connect-src` and `frame-src` entries in `proxy.ts`) | — | none |

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
| I/E | SSRF via IP literal / metadata endpoint | `isPrivateHost` fail-closed: loopback, RFC1918, 169.254/16 (cloud metadata), IPv6 ULA/link-local, NAT64 `64:ff9b::/96`, IPv4-mapped IPv6 recovered + re-checked (`jira/_helpers.ts:69-107`, mirrored timelog) | — | none |
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
| I | XSS reads localStorage | Every `dangerouslySetInnerHTML` sink sanitizes or renders an app-authored constant — 6 sites, see the `style-src-attr` note in `proxy.ts` (corrected 2026-08-09: this cell previously read "No `dangerouslySetInnerHTML` anywhere", which was false, and cited a `proxy.ts` comment that said the same); branding logo/favicon raster-only, SVG excluded; rich text via `sanitize-html.ts`; strict nonce-based CSP, no `unsafe-inline` script | `style-src-attr 'unsafe-inline'` required for React inline styles (documented low-risk, `proxy.ts`) | none |

---

## Existing mitigations inventory (verified)

- **Secrets at rest:** `secrets.ts` — AES-256-GCM, non-extractable device key (`generateKey(..., false, ...)` at `:113-116`), PBKDF2 600k iters (`:46`), singleton device-key promise prevents concurrent-tab key overwrite (`:99-125`).
- **SSRF:** `jira/_helpers.ts` + `timelog/_helpers.ts` — host allowlist (leading-dot), `isPrivateHost` fail-closed (RFC1918/loopback/metadata/IPv6-ULA/NAT64/mapped-IPv4), https-only, `@`/`:`/`..`/CRLF/`#` rejection, path prefix allowlist, `encodeURIComponent` tenant.
- **CSP:** `proxy.ts` — per-request nonce, `script-src 'nonce' 'strict-dynamic'` (no `unsafe-inline`), `worker-src 'self'`, `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, tight `connect-src` allowlist.
- **Rate limiting:** `jira/_rate-limit.ts` — 60/min/IP sliding window, per-route scope, amortized eviction.
- **Input validation:** `sanitize.ts` barrel at every entity boundary; `sanitizeIssueFields` server-side field allowlist for Jira writes.
- **AI output validation:** `parseAnalysis` / `groundEntity` / `parseWeightSuggestions` / `NEXT_ACTIONS_FIELD_COERCE` re-validate untrusted model output before any state write or deep-link.
- **URL sinks:** `isSafeHttpUrl` (`document-link.ts`, `ai-project-proposal.ts`, `sanitize-html.ts`).
- **Dependency posture:** `npm audit` = 0 vulns across 719 deps (verified 2026-07-02); Phase 1 adds a blocking CI audit gate.

---

## Findings

Detailed severity-tagged findings (proxy review, secrets review, URL-sink review, SAST, DAST) live in `docs/security/findings-2026-07.md`. Headline going in: **no CRITICAL or HIGH identified in the manual pass**; residual items are LOW and deployment-topology dependent (in-memory rate-limit store; loopback-plaintext Turso for self-host).

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
