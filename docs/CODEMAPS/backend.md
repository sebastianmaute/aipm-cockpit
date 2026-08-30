<!-- Generated: 2026-07-30 · counts re-verified 2026-08-19 at 6046dcd2 | App 0.265.0 "VanderMeer" | Files scanned: src/proxy.ts + 12 route.ts + api/_shared + 4 client storage backends | Token estimate: ~900 -->

# Backend

No application backend in the traditional sense — no database, no auth middleware, no business logic
on the server. Three server-side concerns only:

1. **CSP nonce middleware** (`src/proxy.ts`) — per-request nonce; owns the `connect-src`/`frame-src`
   allowlist. ★ Host allowlisting lives HERE, not in `next.config`. A missing host fails only at
   runtime (unit tests mock `fetch`, `next build` passes), so it slips CI silently.
2. **12 proxy routes** — CORS/SSRF/auth shims for calls the browser cannot make directly.
3. **Static asset serving.**

Persistence is entirely client-side (see `data.md`).

## Routes — `src/app/api/**/route.ts`

| Route | Upstream | Auth | Guard notes |
|---|---|---|---|
| `jira/test` `search` `projects` `issue-types` `users` `create-issue` `update-issue` `transition-issue` | `*.atlassian.net` | Basic (email + apiToken) | full-URL normalize via `new URL`, origin-only |
| `confluence/page` | same Atlassian host | Basic | `pageId` validated `^\d+$` server-side before path build |
| `timelog` | `*.timelog.com` | Bearer | host+tenant normalize; `/v1/`+`/v2/` path allowlist; own rate-limit scope |
| `stt` | **user-supplied BYO host** | Bearer | no vendor apex to pin — see below |
| `ecb` | ECB FX endpoint | none | no secret involved |

### Shared guard core — `api/_shared/proxy-ssrf.ts`

`isPrivateHost` (fail-closed: RFC1918, loopback, 169.254/16 metadata, IPv6 ULA/link-local, NAT64,
mapped-IPv4) + `mappedIpv4ToDotted` + `isAllowedHostSuffix(host, apex)` (leading-dot suffix match, so
`evil-atlassian.net` cannot pass). Imported by jira and timelog helpers; **provider-specific
normalize/auth/URL stays per-route by design** — do not parameterize divergent security guards into
one factory.

Also enforced per route: HTTPS only, `..`/CRLF/`#` rejected in path, `@`/`:` rejected in host, 10s
`AbortSignal.timeout`, 60/min/IP sliding window scoped per route (`jira/_rate-limit.ts`), and
`console.error` that logs status/error only — never a token or body.

★ **`/api/stt` is the weakest by design.** The base URL is user-configured (BYO OpenAI-compatible
endpoint), so there is no fixed apex to allowlist. It compensates with `isPrivateHost` + https-only +
`redirect: "manual"` (a followed 3xx would escape the host check, so 3xx → 502) + a 25 MB cap. It has
never been security-audited — see `open-followups.md` §13.

★ `jira/_helpers.ts` `sanitizeIssueFields` is an allowlist — the write-path field-injection guard.
`parseIssueFields` is shared by create/update; the SSRF/auth/URL chain is not.

## Client storage backends — `storage.ts` facade

| Backend | Medium | Notes |
|---|---|---|
| `local-file-backend` | File System Access API | JSON · CSV · Markdown; byte-stable serializers |
| `browser-backend` | IndexedDB `aipm-cockpit` | object stores + KV slots |
| `sharepoint-backend` | Graph-hosted file | reuses the local codecs |
| `turso-backend` | libSQL HTTP `/v2/pipeline` | single-DB and multi-tenant (composite `(id, project_id)` PK) |

★ `turso-backend` is the only backend holding a cross-tab **Web Locks** save lock
(`turso-backend.ts:177`). File/IDB have none — the two-tab clobber gap (`open-followups.md` §4).
★ Its `load()` embeds `CREATE TABLE IF NOT EXISTS` DDL *outside* the write lock, so parallel loads
contend (`SQLITE_BUSY`) — portfolio rollup must load sequentially.
★ `turso-migrate.ts` self-heals an older DB (PRAGMA-diff → `ALTER ADD COLUMN`) inside the write lock
before save, because save INSERTs named columns.

## Turso stores outside the workspace schema

`TABLE_NAMES` = the 13 `ENTITY_SPECS` tables + `plan` + `fx_rates` + `meta`. Workspace save issues a
per-table DELETE, so **any non-workspace table must stay out of that list** (guard test enforces):
snapshots, version history, comm templates, committee/comm report versions, learning, operating
guides, scheduled jobs, color schemes.
