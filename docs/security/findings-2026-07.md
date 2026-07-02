# Security Findings — 2026-07 (Phase 1 manual triage)

**Date:** 2026-07-02 · **Scope:** v0.164 "Cixin" · **Reviewer role:** Senior software architect
**Method:** manual read of the SSRF proxy chain, secrets-at-rest module, and every URL sink, against the boundaries in `threat-model.md`. SAST (Semgrep) + DAST (ZAP) results appended in their own sections once the CI/scan runs land.

**Severity key:** CRITICAL = exploitable secret leak / SSRF bypass / stored XSS (blocks merge). HIGH = bug or significant gap. MEDIUM = maintainability/defense-in-depth. LOW = minor / deployment-topology dependent.

## Headline

**0 CRITICAL, 0 HIGH.** The posture is strong: the four secrets are AES-256-GCM encrypted with a non-extractable device key (PBKDF2 fallback at 600k iters, meeting OWASP ASVS 2023), the two SSRF proxies fail closed with a domain allowlist plus private-IP/metadata blocking, and every dynamic URL sink is guarded. Residual items are LOW and depend on deployment topology.

---

## Proxy review (B4) — `jira/_helpers.ts`, `timelog/_helpers.ts`, `confluence/page/route.ts`, `ecb/route.ts`

| ID | Sev | Check | Verdict | Evidence |
|---|---|---|---|---|
| PX-1 | — | Host allowlist exact-suffix (no `evil-atlassian.net` bypass) | ✅ PASS | leading-dot suffix match `jira/_helpers.ts:115-121`, `timelog/_helpers.ts:81-84` |
| PX-2 | — | Private-IP / loopback / cloud-metadata block | ✅ PASS | `isPrivateHost` fail-closed incl. 169.254/16, IPv6 ULA/link-local, NAT64, mapped-IPv4 `jira/_helpers.ts:69-107` |
| PX-3 | — | `@`/`:` in host rejected (cred-injection / port smuggle) | ✅ PASS | `timelog/_helpers.ts:90`; jira origin-only via `new URL` `jira/_helpers.ts:123-138` |
| PX-4 | — | `..` / CRLF / `#` in path rejected; path prefix allowlisted | ✅ PASS | `timelog/_helpers.ts:135-145`; confluence `pageId` `^\d+$` `route.ts:12-15`; tenant `encodeURIComponent` `timelog/_helpers.ts:168` |
| PX-5 | — | HTTPS enforced (no plaintext cred send) | ✅ PASS | `jira/_helpers.ts:128`, `timelog/_helpers.ts:168` |
| PX-6 | — | Upstream timeout + per-route-scoped rate limit | ✅ PASS | 10s `AbortSignal.timeout` `jira/_helpers.ts:148,174`; 60/min/IP scoped `_rate-limit.ts:6-7,42-43` |
| PX-7 | — | No secret in server logs | ✅ PASS | `console.error` logs only `err`/status `jira/_helpers.ts:181`, `timelog/_helpers.ts:185`, `ecb/route.ts:40`; explicit "never the token" comment `timelog/_helpers.ts:184` |
| PX-8 | — | Write-path field injection blocked | ✅ PASS | `sanitizeIssueFields` allowlist `jira/_helpers.ts:200-267` |
| PX-9 | **LOW** | Rate-limit store is in-memory `Map` → single-process only | Open (accepted) | `_rate-limit.ts:1-4,10` — multi-instance deploy needs a shared store (Redis). Documented in-code. Register as TD if the app moves to multi-instance. |

## Secrets review (B5) — `secrets.ts`, `use-secrets.ts`, `recovery-config.ts`

| ID | Sev | Check | Verdict | Evidence |
|---|---|---|---|---|
| SEC-1 | — | Non-extractable device key | ✅ PASS | `generateKey({AES-GCM,256}, false, …)` `secrets.ts:113-116` |
| SEC-2 | — | PBKDF2 iterations ≥ OWASP 2023 (600k) | ✅ PASS | `PBKDF2_ITERS = 600_000` `secrets.ts:46` |
| SEC-3 | — | Tamper detection on ciphertext | ✅ PASS | AES-GCM auth tag → `SecretUnlockError` `secrets.ts:137-148` |
| SEC-4 | — | Untrusted-storage shape validation | ✅ PASS | `isSealedSecret` `secrets.ts:23-36` |
| SEC-5 | — | All four `SecretId`s in the id allowlist | ✅ PASS | union `secrets.ts:8`; allowlist `secrets.ts:28` |
| SEC-6 | — | Concurrent-tab key overwrite guarded | ✅ PASS | singleton `deviceKeyPromise` `secrets.ts:103-125` |
| SEC-7 | — | Secrets excluded from recovery/export/Turso | ✅ PASS (pinned by test) | `recovery-config.ts CONFIG_KEYS`; Phase 1 Task 7 guard test |

## URL-sink review — every `href=`/`window.open`/`location` in `src/app/**/*.tsx`

| ID | Sev | Sink | Verdict | Evidence |
|---|---|---|---|---|
| URL-1 | — | user-supplied document link | ✅ guarded | `isSafeHttpUrl(link.url)` wrap `document-links-field.tsx:42`, `documents-panel.tsx:314` |
| URL-2 | — | rendered markdown link | ✅ guarded | scheme allowlist `^(https?:\|mailto:)` else text `markdown.tsx:208` |
| URL-3 | — | Jira issue link | ✅ guarded | `safeJiraIssueHref` `task-row.tsx:227` |
| URL-4 | — | scheme/branding export download | ✅ safe | local `URL.createObjectURL(blob)` + `download` attr, not a navigation `color-scheme-editor.tsx:82-88`, `recovery-panel.tsx:48` |
| URL-5 | — | static/internal (`APP_LICENSE_URL`, `/recovery`, `/`, hardcoded https) | ✅ safe | constants + same-origin routes; no user/model input |

**No unguarded dynamic URL sink found.** `target="_blank"` sinks all carry `rel="noopener noreferrer"`.

---

## SAST (Semgrep) — pending first CI run

Semgrep runs warn-only in CI (`.gitlab-ci.yml semgrep` job, `p/typescript` + `p/react` + `p/owasp-top-ten`). No Docker on the dev box, so the first authoritative run is the MR pipeline. Triage rule: real findings land here severity-tagged; baseline file committed so only NEW findings ever block after the grace period.

_Status: awaiting first pipeline run._

## DAST (ZAP baseline) — pending

No Docker locally → deferred. When run: `npm run build && npm run start`, then `zap-baseline.py -t http://localhost:3000 -I`. Server surface is only `/api/{jira,confluence,timelog,ecb}` + static assets (client-heavy app), so expected findings are header/CSP nits — CSP already hardened in `proxy.ts`.

_Status: not yet run; low expected yield given the small server surface._

---

## CRITICAL gate

CRITICAL findings requiring pre-merge fix: **0.** Phase gate satisfied.
