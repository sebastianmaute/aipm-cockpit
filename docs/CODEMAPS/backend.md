<!-- Generated: 2026-07-30 · counts re-verified 2026-11-17 at ed6435dd1 | App 1.21.1 "French" | Files scanned: src/proxy.ts + 15 route.ts + api/_shared + 4 client storage backends | Token estimate: ~900 -->

# Backend

No application backend in the traditional sense — no database of its own, no auth middleware, no business logic
on the server. Four server-side concerns only:

1. **CSP nonce middleware** (`src/proxy.ts`) — per-request nonce; owns the `connect-src`/`frame-src`
   allowlist. ★ Host allowlisting lives HERE, not in `next.config`. A missing host fails only at
   runtime (unit tests mock `fetch`, `next build` passes), so it slips CI silently.
2. **15 routes** — 12 CORS/SSRF/auth shims for calls the browser cannot make directly, plus the three
   AI relay routes under `api/ai/` (`find src/app/api -name route.ts | wc -l`).
3. **The saved-chat sweep** — `src/instrumentation.ts` starts `startChatSweepSchedule`
   (`api/ai/_chat-sweep.ts`) once per Node server: at start and every 24 hours it deletes the chats
   past the retention period in the database named by `AIPM_CHAT_SWEEP_TURSO_URL` (or the public Turso
   pair). See `docs/RUNBOOK.md` "Saved AI chats".
4. **Static asset serving.**

Persistence is entirely client-side (see `data.md`).

## Routes — `src/app/api/**/route.ts`

| Route | Upstream | Auth | Guard notes |
|---|---|---|---|
| `jira/test` `search` `projects` `issue-types` `users` `create-issue` `update-issue` `transition-issue` | `*.atlassian.net` | Basic (email + apiToken) | full-URL normalize via `new URL`, origin-only |
| `confluence/page` | same Atlassian host | Basic | `pageId` validated `^\d+$` server-side before path build |
| `timelog` | `*.timelog.com` | Bearer | host+tenant normalize; `/v1/`+`/v2/` path allowlist; own rate-limit scope |
| `stt` | **user-supplied BYO host** | Bearer | no vendor apex to pin — see below |
| `ecb` | ECB FX endpoint | none | no secret involved |
| `ai/messages` `ai/models` | the AI gateway (`AIPM_AI_GATEWAY_URL`), else `api.anthropic.com` when keys are restricted (`AIPM_AI_ORGANIZATION_ID`) | the user's own `x-api-key`, passed on, never stored or logged; plus the gateway token | `api/ai/_relay.ts`: same-origin callers only, a header allowlist, no redirects followed; a direct deployment with no restriction answers 404 and the browser calls Anthropic itself. With a restriction, `_key-check.ts` checks the key's organisation and workspace first (403 refused, 503 could not check) |
| `ai/status` | none | none | what the browser may know about the AI route (switched off, direct or gateway, invalid setting, people protection forced); never a URL or token; always 200 |

### Shared guard core — `api/_shared/proxy-ssrf.ts`

`isPrivateHost` (fail-closed: RFC1918, loopback, 0.0.0.0/8, 100.64/10 shared address space, 169.254/16
metadata, IPv6 ULA/link-local, NAT64, mapped- and compatible-IPv4) + `mappedIpv4ToDotted` + `isAllowedHostSuffix(host, apex)` (leading-dot suffix match, so
`evil-atlassian.net` cannot pass). Imported by the jira, timelog and stt helpers; **provider-specific
normalize/auth/URL stays per-route by design** — do not parameterize divergent security guards into
one factory.

Also enforced per route: HTTPS only, `..`/CRLF/`#` rejected in path, `@`/`:` rejected in host, 10s
`AbortSignal.timeout`, a per-caller fixed one-minute window scoped per route (`jira/_rate-limit.ts`: 60 by
default; the AI relay 120 and dictation 60, each changeable by the operator through
`api/_shared/request-limit-config.ts`), and
`console.error` that logs status/error only — never a token or body (an upstream fetch failure goes
through `describeUpstreamError`, `api/_shared/upstream-error.ts`).

### Deployment switch — `api/_shared/integration-switch.ts` (§762)

`refuseIfDisabled(id)` reads `AIPM_DISABLED_INTEGRATIONS` on every request and answers **503**
`integration-disabled` before rate-limiting, parsing or any upstream call. Every route asks it: the Jira
and Confluence routes through `parseJiraRequest` (`jira/_helpers.ts`), timelog and stt through their
`_helpers.ts` (stt refuses on `ai` too), `ecb` directly, and the AI relay (`api/ai/_relay.ts`) for `ai`;
`api/ai/status` alone always answers, since it reports the switch. ★★ 503, never 401/403 — the Jira and TimeLog clients read 401/403 as a
rejected token and would store `tokenInvalidAt`. The client half is `integration-switches.ts`; see
`docs/AGENTS/platform.md`.

★ **`/api/stt` is the weakest by design.** The base URL is user-configured (BYO OpenAI-compatible
endpoint), so there is no fixed apex to allowlist. It compensates with `isPrivateHost` + https-only +
`redirect: "manual"` (a followed 3xx would escape the host check, so 3xx → 502) + a 25 MB cap. It has
never been security-audited — see `open-followups.md` §13.

★ `jira/_helpers.ts` `sanitizeIssueFields` is an allowlist — the write-path field-injection guard.
`parseIssueFields` is shared by create/update; the SSRF/auth/URL chain is not.

★ What a Jira route returns is checked on the CLIENT, not here: `jira-api.ts` parses every response
against the zod schemas in `jira-schemas.ts` (open-followups §7 B4). A malformed envelope throws
"Malformed Jira response"; a malformed item in a list is dropped and counted in the diagnostics ring
(`jira.malformedItems`). See [dependencies.md](dependencies.md) for why `zod` stays out of the
startup chunk.

## Client storage backends — `storage.ts` facade

| Backend | Medium | Notes |
|---|---|---|
| `local-file-backend` | File System Access API | JSON · CSV · Markdown; byte-stable serializers |
| `browser-backend` | IndexedDB `aipm-cockpit` | object stores + KV slots |
| `sharepoint-backend` | Graph-hosted file | reuses the local codecs |
| `turso-backend` | libSQL HTTP `/v2/pipeline` | single-DB and multi-tenant (composite `(id, project_id)` PK) |

★ `turso-backend` is the only backend holding a cross-tab **Web Locks** save lock
(`navigator.locks` in `turso-backend.ts`). File/IDB have none — the two-tab clobber gap (`open-followups.md` §4).
★ Its `load()` embeds `CREATE TABLE IF NOT EXISTS` DDL *outside* the write lock, so parallel loads
contend (`SQLITE_BUSY`) — portfolio rollup must load sequentially.
★ `turso-migrate.ts` self-heals an older DB (PRAGMA-diff → `ALTER ADD COLUMN`) inside the write lock
before save, because save INSERTs named columns.

## Turso stores outside the workspace schema

`TABLE_NAMES` = the `ENTITY_SPECS` tables + `plan` + `fx_rates` + `meta`. Workspace save issues a
per-table DELETE, so **any non-workspace table must stay out of that list** (guard test enforces):
`snapshot` + `snapshot_series`, `project_versions`, `comm_templates` + `comm_template_versions`,
`committee_report_versions`, `action_learning`, `operating_guides`, `scheduled_jobs_v2` (and the
pre-§772 `scheduled_jobs`, read once by a migration), `scheduled_reports`, `chat_threads`,
`document_asset_data`, `color_schemes`, `chat_keys` (passphrase-wrapped chat keys) and `person_links` (the
cross-project same / not-the-same person answers, §785). Enumerate with
`grep -roE "CREATE TABLE IF NOT EXISTS [a-z_0-9]+" src/app --include=*.ts --exclude=*.test.ts | sed 's/.*EXISTS //' | sort -u` (that lists every created table, workspace ones and the legacy `workspace` blob included; the side tables are those absent from `TABLE_NAMES`)
plus the `${...}` templated ones (`grep -rn 'CREATE TABLE IF NOT EXISTS ${' src/app`).
★ The project-keyed ones are listed in `PROJECT_SCOPED_SIDE_TABLES` (`project-side-tables.ts`), which
a tenant project's hard delete sweeps in a separate pipeline; `turso-side-tables.guard.test.ts` fails
on a project-keyed table missing from it.
