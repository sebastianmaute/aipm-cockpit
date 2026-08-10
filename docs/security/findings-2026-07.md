# Security Findings — 2026-07 (Phase 1 manual triage)

**Date:** 2026-07-02 · **Scope:** v0.164 "Cixin" · **Reviewer role:** Senior software architect
**Method:** manual read of the SSRF proxy chain, secrets-at-rest module, and every URL sink, against the boundaries in `threat-model.md`. SAST (Semgrep) + DAST (ZAP) results appended in their own sections once the CI/scan runs land.

**Severity key:** CRITICAL = exploitable secret leak / SSRF bypass / stored XSS (blocks merge). HIGH = bug or significant gap. MEDIUM = maintainability/defense-in-depth. LOW = minor / deployment-topology dependent.

> ★★ **This is a DATED SNAPSHOT of v0.164, not a live document.** Its `path:LINE` citations
> described the tree at 2026-07-02 and several no longer resolve — `document-links-field.tsx` has
> since been deleted, and TWO `timelog/_helpers.ts` cites now run past EOF (one by a line, one by
> two — that file has 183 citable lines today). All THREE are
> recorded in `docs/baselines/doc-line-cites.json` and are deliberately NOT renumbered: rewriting an
> audit record to match today's tree destroys the only thing it is good for, which is saying what was
> true when it was signed. Re-verify any finding here against HEAD before acting on it; if a claim
> still matters, restate it in a live doc rather than editing this one.

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

## SAST (Semgrep) — CI job live, awaiting first run

Semgrep runs warn-only in CI (`.gitlab-ci.yml semgrep` job, `p/typescript` + `p/react` + `p/owasp-top-ten`), emitting **GitLab-native SAST format** (`gl-sast-report.json` under `artifacts:reports:sast`).

**Where findings appear:**
- **Security tab / MR security widget / Vulnerability Report** — populated from the SAST report (these UI surfaces need GitLab **Ultimate**; on lower tiers the report is still a downloadable artifact).
- **`semgrep` job log** — Semgrep prints the findings table.
- **`gl-sast-report.json` artifact** — downloadable for 1 week.

No Docker on the dev box → the first authoritative run is the MR pipeline. Triage rule: real findings land here severity-tagged.

_Status: awaiting first pipeline run._

## DAST (OWASP ZAP baseline) — CI job added (manual + scheduled), unvalidated

A `dast-zap` CI job (`.gitlab-ci.yml`, `e2e` stage) builds the app from `Dockerfile.dast`, runs it, and baseline-scans it from a sibling ZAP container on a shared docker network. Runs on the **weekly schedule** and on **manual trigger** only (DAST is slow/infra-heavy), `allow_failure`.

**Where findings appear:**
- **`zap-report.html` + `zap-report.json` artifacts** on the `dast-zap` job (plain artifacts — raw ZAP JSON is NOT GitLab's `gl-dast-report.json` schema, so it does **not** feed the Security-tab DAST widget; that would need the GitLab DAST analyzer pointed at a deployed review-app, which this pipeline has no deploy stage for yet).

The `dast-zap` job is **validated** — it ran successfully on the project's dind runner (MR !171 pipeline, 2026-07-02), scanned 33 URLs, and uploaded `zap-report.html`/`zap-report.json`.

### First scan results — 2026-07-02

**FAIL-NEW: 0 · WARN-NEW: 4 · PASS: 63.** No failures. ZAP PASSed the load-bearing checks against the live app: CSP header set [10038], anti-clickjacking [10020], X-Content-Type-Options [10021], HSTS [10035], no debug-error/source-code disclosure, private IP not leaked — confirming the `proxy.ts` + `next.config.ts` header hardening holds under a live scan.

| ID | Sev | Alert | Verdict | Action |
|---|---|---|---|---|
| DAST-1 | **LOW** | Server leaks `X-Powered-By: Next.js` [10037] ×3 | Real — tech-stack disclosure, no functional value | **FIXED** — `poweredByHeader: false` in `next.config.ts` |
| DAST-2 | **LOW** | Cross-Origin-Embedder-Policy header missing [90004] ×7 | Defense-in-depth; COEP only needed for cross-origin isolation / SharedArrayBuffer, which the app doesn't use. Adding `require-corp` risks breaking cross-origin resource loads. | Not applied — accepted; revisit only if COOP/COEP isolation becomes needed |
| DAST-3 | — | Non-Storable Content [10049] ×10 | Informational (cache-control note on dynamic responses), not a vulnerability | none |
| DAST-4 | — | Modern Web Application [10109] ×3 | Informational (ZAP noting the SPA shape) | none |

_Status: run + triaged. 0 fail; the one real LOW (X-Powered-By) fixed. Re-run on the weekly schedule._

---

## CRITICAL gate

CRITICAL findings requiring pre-merge fix: **0.** Phase gate satisfied.

---

## Phase 2 audit delta (2026-07-02)

- **HIGH findings burn-down (Phase 2 Task 8):** Phase 1 identified **0 HIGH** findings, so there is nothing to fix. Closed.
- **Input-validation audit (Phase 2 Task 9):** re-verified every untrusted-input path.
  - **AI write tools** (`use-chat-dispatcher.ts`): 45 `sanitize*` calls + 20 `isReadOnly` guards. Every entity write tool builds its object through the entity's `sanitizeX` (`sanitizeTaskName`/`sanitizeRaidItem`/`sanitizeChangeItem`/`sanitizeMilestone`/`sanitizeStakeholder` + field sanitizers) and throws `readOnlyError()` in popouts before mutating. No raw model value reaches a state setter.
  - **AI advisory paths:** `parseAnalysis`/`groundEntity` (action-ai) and `parseWeightSuggestions` → `NEXT_ACTIONS_FIELD_COERCE` still re-validate model output before any deep-link or settings write (unchanged since Phase 1).
  - **`/api/*` routes:** validated in Phase 1 (PX-1..PX-9) — host allowlist, path allowlist, `pageId` `^\d+$`, `sanitizeIssueFields` field allowlist. No new routes added since.
  - **Verdict:** no validation gaps. Nothing to fix.
