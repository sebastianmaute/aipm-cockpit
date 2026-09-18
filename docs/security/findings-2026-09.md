# Security audit — 2026-09 snapshot (register §13)

> **This is a DATED SNAPSHOT, not a living document.**
>
> - **Audit date:** 2026-09-16.
> - **Verified against:** `origin/main` at `ed6ed8e4` (the merge of `chore/electron-44`). Every
>   statement below describes the tree at that commit and nowhere else.
> - **Follow-up slice:** the `fix/security-audit-followups` branch that carries the remediations
>   branched later, from `5c664157`. Where a finding was fixed in that slice, this file says so
>   inline — but the finding text itself is left describing `ed6ed8e4`, because that is what a
>   dated record is for.
> - **Series:** the second file in the same series as `findings-2026-07.md`. It **supersedes that
>   file's SCOPE** — the 2026-07 pass was ~90 releases old and predated the desktop app, `/api/stt`,
>   and the documents and attachment-ingest subsystems — but it **does not replace that record.**
>   The 2026-07 file stays as signed and dated as it was written, with corrections appended beside
>   the original text rather than written over it.
> - **Line numbers are deliberately absent.** Findings cite SYMBOLS and files. Three claims in the
>   source material for this report turned out to be wrong, and in every case the cause was a number
>   or a file name restated from an earlier document instead of re-derived. A line number rots on the
>   next insertion and cannot be re-checked at a glance; a symbol name can be grepped.

Four parallel area audits plus a dependency pass. Every finding below was re-verified by the
coordinator against the source, not taken from an agent's word. Two agent claims were judged wrong
by that pass, and one of those judgements was itself wrong — see HIGH-2, where the correction of a
correction is recorded rather than quietly dropped.

| Area | Verdict |
|---|---|
| Server routes and SSRF (9 routes, incl. `/api/stt`, never reviewed before) | 1 high, 1 medium |
| Secrets, settings, diagnostics | 1 medium, 2 low |
| Untrusted input: mail, archive, office, workspace, AI writes | 1 high (agent rated critical) |
| Electron desktop shell (never audited before) | 1 high contingent on publishing, 2 medium |
| Dependencies | production 0; dev 3 moderate (one advisory); desktop 0 |
| Raw-HTML sinks and CSP | 0 unsafe of 11 |

**No critical finding. Nothing here blocks publishing the repo; two items should be fixed before
shipping another release.**

---

## HIGH-1 — Jira and Timelog proxies follow upstream redirects with credentials

**Where:** `callJira` in `src/app/api/jira/_helpers.ts` · `callTimelog` in `src/app/api/timelog/_helpers.ts`

**Verified:** yes — neither `fetch` sets a redirect policy. `callStt` in `src/app/api/stt/_helpers.ts`
sets `redirect: "manual"` and rejects any 3xx, and is the only one of the three that does.

The host allowlist is applied to the initial URL only. An upstream answering 3xx is followed to a
host nobody validated, with the Authorization header still attached. Reaching it requires control
of, or a foothold in, the configured upstream — so this is not a drive-by — but the allowlist is
precisely the control that is supposed to survive that.

**Fix:** mirror the stt pattern in both helpers — `redirect: "manual"`, treat 3xx as 502. Neither
helper has redirect test coverage today; `stt/route.test.ts` shows the shape.

**Status:** fixed in the follow-up slice (register §559). `callJira` and `callTimelog` now set
`redirect: "manual"` and reject 3xx, so a sweep of `src/app/api/` for a redirect policy finds all
three helpers, not just stt. At `ed6ed8e4` only stt set one.

## HIGH-2 — Quadratic blowup in the OOXML extractors (client-side denial of service)

**Where:** `extractRuns` in `src/app/office-xml.ts` (the shared helper, and the one with the widest
blast radius) · `src/app/docx-extract.ts` · `src/app/xlsx-extract.ts` · `src/app/pptx-extract.ts`

Line numbers are dropped here even by the standards of the rest of this file: the remediation slice
rewrote all four of these files, so any number quoted would have been stale on the day it was
written. Reproduce with the sweep command below.

**Verified:** yes, measured on this machine.

Each used a lazy backtracking `[\s\S]*?` pair regex over the whole decompressed XML. With the
closing tag absent, cost is quadratic in input length:

| input chars | ms |
|---|---|
| 20,000 | 36 |
| 40,000 | 142 |
| 80,000 | 524 |
| 160,000 | 1,861 |

Eight times the input costs about 52 times the time. `unzip.ts` admits up to 100 MB per entry
(`MAX_INFLATED_BYTES`) and 256 MB in aggregate (`MAX_TOTAL_INFLATED_BYTES`) from a 20 MB compressed
input, and repetitive unclosed markup compresses at a very high ratio. So an ordinary-looking
`.docx`, `.xlsx` or `.pptx` — opened as a chat attachment, through the import wizard, or nested
inside a `.eml`/`.msg` — can lock the browser main thread for minutes. Nothing throws, so no `catch`
intervenes.

This is the same pattern class `html-extract.ts` had already fixed for itself; that file was the
only one of the family using an `indexOf` cursor walk.

**Corrections, and two of them are corrections of this report's own earlier corrections.**

1. **`office-xml.ts` DOES carry a lazy pair regex, in `extractRuns`.** An earlier revision of this
   report said it did not, overruling the area agent that first reported it. The agent was right.
   The regex was built dynamically, through a `new RegExp` over an interpolated tag name, so its
   source text carries the DOUBLE-escaped character-class spelling and is invisible to any grep
   written for the regex-literal form. Every sweep run against this file used the literal form and
   returned zero. The zero was the pattern's blind spot, not the file's state.

   It mattered more than the three extractors it sits under: `xlsx-extract.ts` called it for shared
   strings and for inline strings, and `pptx-extract.ts` for text runs, so it was the live quadratic
   path for two of the three formats.

2. **`html-extract.ts` does NOT still contain lazy patterns.** An earlier revision listed seven
   sites in that file. All seven are prose inside `*` comment lines describing the pattern class —
   that file documents the hazard it fixed. Re-checked line by line against `ed6ed8e4`: seven of
   seven are comment text. There was never anything to judge.

3. The `xlsx-extract.ts` line numbers quoted by the area agent were wrong, and the coordinator's
   correction of them stands. Both sets are omitted here for the reason given above.

**The sweep that sees both spellings** — the single-backslash form alone is what produced two of the
three errors above:

```bash
grep -rnE '\[\\s\\S\]\*\?|\[\\\\s\\\\S\]\*\?' src/app --include=*.ts | grep -vE ': *\*'
```

The trailing filter drops block-comment lines, which are most of the remaining hits. It does not
drop `//` lines, so read the survivors rather than counting them.

**Severity note:** the area agent rated this CRITICAL. It is recorded as HIGH: the impact is
availability of the user's own tab, with no data disclosure, no persistence, and no path off the
client. It was the most urgent thing on this list regardless of the label.

The fix shipped in the follow-up slice ports all four files onto one shared linear cursor walk
(`src/app/tag-pair-walk.ts`), extracted from `html-extract.ts`, which had already solved this for
itself. Each ported file carries a performance test that was mutation-proved — the lazy regex was
restored, the test was watched going red, and the mutant reverted — because a performance test that
passes against the unfixed code proves nothing.

**Status:** fixed in the follow-up slice. `extractRuns` now calls `forEachTagPair`.

## HIGH-3 (contingent) — the installer is unsigned

**Where:** `desktop/electron-builder.yml`, the `signExecutable` key, set false

Acceptable while distribution is internal. If the repo goes public and the installer sits on a
public releases page, the signature is the only supply-chain control a downloader has. A
code-signing certificate would be needed at, or before, public launch.

**Status:** open by design, contingent on a distribution decision.

## MEDIUM-1 — the rate limiter is trivially bypassable

**Where:** `getClientIp` in `src/app/api/jira/_rate-limit.ts`

**Verified:** yes — it keys off `x-forwarded-for`, then `x-real-ip`.

No trusted-proxy configuration, and the app is documented as self-hosted, so a caller can present a
fresh header value per request and sidestep the `MAX_REQUESTS` limit shared by Jira, Timelog, ECB
and Confluence. The store is also a bare in-memory `Map` (the pre-existing PX-9 accepted risk), so
it bounds nothing across restarts or replicas.

## MEDIUM-2 — the config-export backstop redacts 3 of 5 secrets

**Where:** `redactSettings` in `src/app/recovery-config.ts`

**Verified:** yes — it redacts `integrations.turso.authToken`, `jira.apiToken` and `ai.apiKey`, and
never `timelog.apiToken` or `dictation.sttApiKey`.

Masked today, because `writeSettings` blanks all five before the blob is readable. But this function
exists precisely as the backstop for a `writeSettings` regression, and it has the same
hardcoded-list rot the six-edit `SecretId` invariant is designed to prevent. Its own comment says so
for `ai.apiKey`.

**Fix:** derive the redaction from the `SecretId` list and its field mapping rather than restating
it.

**Status:** fixed in the follow-up slice (register §560). `redactSettings` now names no field at
all — it walks `SECRET_IDS` and redacts each id's path from `SECRET_SETTINGS_PATHS`, so the list
cannot rot out of step with the `SecretId` union again. At `ed6ed8e4` it named three.

## MEDIUM-3 — no Electron fuses configured

**Where:** `desktop/electron-builder.yml` — no `electronFuses` key at `ed6ed8e4`.

`RunAsNode` stayed enabled on the packaged binary, so a local actor could run arbitrary Node through
the shipped exe. Local-only impact, cheap fix.

**Status:** fixed (register §561). `desktop/electron-builder.yml` now carries an `electronFuses`
block; at `ed6ed8e4` it carried none. Disabling `RunAsNode` also broke the desktop server launch,
which relied on `ELECTRON_RUN_AS_NODE`; `desktop/src/server-child.ts` now uses
`utilityProcess.fork` instead (see §561).

## MEDIUM-4 (by design) — MSAL auth-flow trusts any https host once entered

**Where:** `desktop/src/lib/window-open-policy.ts`

Entry is narrowly gated (an opener-initiated navigation from a genuine blank popup to an exact
Microsoft identity host), and the flow ends at the app origin or on failure. Recorded for awareness,
and worth revisiting if the tenant's federation configuration changes. Related: register §547 notes
this state machine has no unit harness.

## LOW / INFO

- **Two settings sections clear a token by resealing an empty string** (`jira-settings.tsx`,
  `timelog-settings.tsx`) rather than calling `removeSealed`, unlike the AI, Turso and dictation
  sections. Inconsistent mechanism, not an exposure.
- **`diagnostics-redact.ts` uses a fixed pattern list** with no catch-all for an opaque
  `timelogApiToken` or `sttApiKey` landing in free text. No live leak found; same rot risk in
  structure.
- **`src/app/api/jira/_helpers.ts`** logs the raw fetch-rejection object server-side. No
  Authorization header is reachable through an undici fetch error today; logging the error's
  `message` alone would be more robust.
- **`/api/stt`'s private-host check** does not cover DNS rebinding on the user-supplied endpoint.
  Documented in source as an accepted residual; it matters only if this becomes a hosted
  multi-tenant deployment.
- **Dev dependencies:** 3 moderate, all one advisory (vitest path traversal, fixed in 4.1.11).
  Production and desktop are clean.

---

## What came back clean

- **Secrets:** the six-edit lockstep holds for all five `SecretId`s across all seven sites.
  AES-256-GCM with a fresh IV per seal, a non-extractable device key, PBKDF2 at 600k iterations with
  a per-seal salt. The degraded fallback fails closed and never persists plaintext. `writeSettings`
  is still the only writer of the settings key. `clearAppConfig` still respects the
  config-vs-workspace boundary. `Workspace.settingsOverrides` is type-restricted and structurally
  cannot carry a secret.
- **Parsers:** `attachment-ingest`, `cfbf`, `lzfu`, `mime-parse`, `msg-extract`, `eml-extract`,
  `html-extract`, `unzip`, the asset upload gate, and the workspace JSON/CSV/Markdown decode all
  clean, with no prototype-pollution surface.
- **AI write boundary:** `sanitizeAiRichText` and `AI_RICH_FIELDS` cover the model-write paths.
- **Desktop:** one window, `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`; **no
  preload and no IPC anywhere**, so there is no Node surface to escape into. Exact origin
  comparisons, `file:`/`javascript:`/custom schemes denied, all four `executeJavaScript` sites
  guarded, loopback-only binding, no custom protocol or argv handling.
- **Routes:** input validation, field allowlisting, path-traversal and CRLF guards, body-size caps
  and timeouts across all nine routes.
- **Raw-HTML sinks:** 11 total, 2 of them static app-authored literals, 0 unsafe. Production CSP is
  nonce-only `script-src` with `strict-dynamic` and no `unsafe-inline`. The count and its breakdown,
  with the commands that derive them, live in `threat-model.md`; re-run those rather than quoting
  this line.

## Recommended order

1. **HIGH-2** the OOXML cursor walk — the only finding reachable by an ordinary user opening an
   ordinary-looking file.
2. **HIGH-1** `redirect: "manual"` in both proxy helpers, with tests.
3. **MEDIUM-2** derive `redactSettings` from the `SecretId` list.
4. **MEDIUM-3** electron fuses; **MEDIUM-1** rate-limit keying (or record it as accepted for a
   self-hosted app).
5. **HIGH-3** code-signing certificate — only if publishing.
6. Bump vitest to 4.1.11, which also clears the GitHub Dependabot alerts.

## Register and documentation follow-ups

- **Register §13 can be closed by this run**, now that the report sits in `docs/security/` as a
  dated snapshot beside the 2026-07 one, not replacing it.
- New register entries are needed for each finding above that is not fixed in the same slice.
- All three stale claims found during triage are now corrected. Two were fixed in the commit that
  created this file: the `threat-model.md` sink count, and the `findings-2026-07.md` URL-1 note
  claiming `document-links-field.tsx` was deleted. The third — the `src/proxy.ts` comment
  enumerating six JSX sinks — was a source change, deferred out of that documentation commit and
  **corrected shortly after in `962d51dc`**; that comment now enumerates all eight JSX sinks, names
  the three `document.write` sites, and carries both sweep commands.
