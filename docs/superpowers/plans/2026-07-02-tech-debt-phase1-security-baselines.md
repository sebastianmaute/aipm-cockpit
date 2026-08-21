# Tech Debt Phase 1 — Security Verification & Baselines Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Independently verify the security posture, establish measurement baselines (duplication, dead code, file sizes), and land zero-risk quick wins — Phase 1 of `docs/tech-debt-remediation-roadmap.md`.

**Architecture:** No product-code behavior changes. This phase adds CI jobs (`.gitlab-ci.yml`), guard scripts (`scripts/`), documentation (`docs/security/`, `docs/baselines/`), guard tests, and deletes unambiguous dead code. Everything is additive or subtractive-with-CI-proof.

**Tech Stack:** GitLab CI ( (GitLab), stages install→quality→build→e2e), Semgrep, npm audit, jscpd, knip, ts-prune, OWASP ZAP baseline, vitest.

**Ground rules (from AGENTS.md — apply to every task):**
- CI lint is `--max-warnings=0`: any unused import/var is FATAL.
- Run `npx tsc --noEmit` after editing ANY test file.
- Do not touch golden fixtures, `i18n.de.ts` via Edit tool, or `eslint.config.mjs` (hook-blocked).
- Commit per task; no push/MR without explicit user trigger.

---

### Task 1: Threat model document

**Files:**
- Create: `docs/security/threat-model.md`

- [ ] **Step 1: Write the document**

Create `docs/security/threat-model.md` with this structure (fill each cell from code reading, not memory — file pointers given):

```markdown
# lop-app Threat Model (STRIDE)

Date: 2026-07-02 · Scope: v0.164 · Review cadence: re-run on every new trust boundary (new external host, new SecretId, new /api route).

## Assets
| Asset | Location at rest | Location in transit |
|---|---|---|
| Anthropic API key | `lop-app:secrets` (AES-256-GCM, device key in IndexedDB) | browser → api.anthropic.com |
| Turso authToken | same | browser → Turso host |
| Jira apiToken | same | browser → /api/jira → *.atlassian.net |
| Timelog apiToken | same | browser → /api/timelog → *.timelog.com |
| Workspace/project data | file / IndexedDB `lop-app` / Turso | per backend |
| M365 tokens | MSAL-owned cache (not app-managed) | browser → graph.microsoft.com |

## Trust boundaries (STRIDE per boundary)
### B1: Browser ↔ Anthropic (direct, `anthropic-dangerous-direct-browser-access`)
### B2: Browser ↔ MS Graph / MSAL
### B3: Browser ↔ Turso (libsql over HTTPS)
### B4: Browser ↔ /api/jira|confluence|timelog proxies (SSRF-guarded, `_helpers.ts`)
### B5: Local persistence (localStorage settings blob, IndexedDB secrets DB, FS-access handles)

For each boundary: table with S/T/R/I/D/E rows, columns = Threat | Existing mitigation (file:symbol) | Residual risk | Action.

## Existing mitigations inventory (verify each, cite file)
- Secrets at rest: `secrets.ts` (AES-256-GCM, non-extractable device key), `writeSettings` blanking
- SSRF: `api/jira/_helpers.ts` (host allowlist, private-IP block, `:`/`@`/`..`/CRLF/`#` rejection, path allowlist, timeout, rate-limit scopes)
- CSP: `src/proxy.ts` connect-src/frame-src/worker-src allowlists
- Input validation: `sanitize.ts` barrel at every entity boundary
- AI output validation: `parseAnalysis`/`groundEntity`/`parseWeightSuggestions`/`NEXT_ACTIONS_FIELD_COERCE`
- URL sinks: `isSafeHttpUrl`
- XSS: branding logo/favicon raster-only (SVG excluded), `sanitize-html.ts` for rich text

## Findings → docs/security/findings-2026-07.md
```

Populate B1–B5 STRIDE tables by reading: `src/app/secrets.ts`, `src/app/api/jira/_helpers.ts`, `src/app/api/timelog/_helpers.ts`, `src/app/api/confluence/page/route.ts`, `src/proxy.ts`, `src/app/chat-api.ts`, `src/app/use-settings.ts`.

- [ ] **Step 2: Verify every cited symbol exists**

Run: `grep -n "writeSettings\|isSafeHttpUrl\|hydrateSecretsInto" src/app/*.ts | head -20`
Expected: hits for each symbol cited in the doc. Fix any stale citation.

- [ ] **Step 3: Commit**

```bash
git add docs/security/threat-model.md
git commit -m "docs(security): STRIDE threat model over the five trust boundaries"
```

---

### Task 2: Semgrep SAST job in CI (warn-only)

**Files:**
- Modify: `.gitlab-ci.yml` (quality stage)
- Create: `.semgrepignore`

- [ ] **Step 1: Add `.semgrepignore`**

```
node_modules/
.next/
coverage/
playwright-report/
__fixtures__/
*.test.ts
*.test.tsx
*.property.test.ts
```

- [ ] **Step 2: Add the CI job**

Append to `.gitlab-ci.yml` after the `typecheck` job:

```yaml
semgrep:
  stage: quality
  needs: []
  image: semgrep/semgrep:latest
  allow_failure: true          # warn-only for 2 weeks; Phase 4 flips this
  script:
    - semgrep scan --config p/typescript --config p/react --config p/owasp-top-ten
        --error --json --output semgrep.json .
  artifacts:
    when: always
    paths: [semgrep.json]
    expire_in: 1 week
```

Note: `needs: []` — semgrep needs no `node_modules`, runs immediately.

- [ ] **Step 3: Validate YAML locally**

Run: `npx --yes yaml-lint .gitlab-ci.yml || node -e "const y=require('js-yaml');y.load(require('fs').readFileSync('.gitlab-ci.yml','utf8'));console.log('yaml ok')"`
Expected: `yaml ok` (js-yaml is available transitively; if not, visually verify indentation matches sibling jobs).

- [ ] **Step 4: Run Semgrep locally, triage top findings**

Run: `docker run --rm -v "$PWD:/src" semgrep/semgrep semgrep scan --config p/typescript --config p/react --config p/owasp-top-ten /src 2>&1 | tail -40`
(If no Docker: skip; CI run on the MR is the triage input.)
Timebox triage to 2 days per roadmap. Real findings → `docs/security/findings-2026-07.md` (Task 4).

- [ ] **Step 5: Commit**

```bash
git add .gitlab-ci.yml .semgrepignore
git commit -m "ci: add warn-only Semgrep SAST job (typescript/react/owasp rulesets)"
```

---

### Task 3: npm audit gate + scheduled weekly full audit

**Files:**
- Modify: `.gitlab-ci.yml`

- [ ] **Step 1: Add blocking audit job (quality stage)**

```yaml
dependency-audit:
  stage: quality
  needs: [install]
  script:
    - npm audit --omit=dev --audit-level=high
```

Blocking by design: currently 0 vulns at every level (measured 2026-07-02), so this cannot break existing MRs.

- [ ] **Step 2: Add scheduled full-audit job**

```yaml
dependency-audit-full:
  stage: quality
  needs: [install]
  rules:
    - if: $CI_PIPELINE_SOURCE == "schedule"
  script:
    - npm audit --audit-level=low
  allow_failure: true
```

Also extend the top-level `workflow.rules` with `- if: $CI_PIPELINE_SOURCE == "schedule"` (currently only MR/default-branch/tag — a schedule would otherwise never create a pipeline).

- [ ] **Step 3: Verify baseline passes locally**

Run: `npm audit --omit=dev --audit-level=high; echo "exit=$?"`
Expected: `exit=0`.

- [ ] **Step 4: Commit**

```bash
git add .gitlab-ci.yml
git commit -m "ci: blocking prod-dependency audit + scheduled weekly full audit"
```

- [ ] **Step 5: Manual follow-up (user/owner action — cannot be done from repo)**

Create the weekly pipeline schedule in GitLab UI: CI/CD → Schedules → weekly, target `main`. Record in the MR description.

---

### Task 4: Manual security findings triage doc

**Files:**
- Create: `docs/security/findings-2026-07.md`
- Read-only review of: `src/app/api/jira/_helpers.ts`, `src/app/api/timelog/_helpers.ts`, `src/app/api/confluence/page/route.ts`, `src/app/secrets.ts`, all `isSafeHttpUrl` call sites

- [ ] **Step 1: Review checklist — proxies**

For each of the three proxy modules verify and record (file:line evidence per row):
1. Host allowlist exact-suffix match (no `evil-atlassian.net` bypass).
2. Private-IP / localhost block present.
3. `:`/`@` in host rejected; `..`, CRLF, `#` in path rejected.
4. Path allowlist (`/v1/`, `/wiki/rest/api/content/` + `/^\d+$/` pageId) enforced server-side.
5. Timeout + per-scope rate limit present.
6. No secret ever logged (grep `console.` in each file — expect zero secret-adjacent logs).

- [ ] **Step 2: Review checklist — secrets**

In `secrets.ts` + `use-secrets.ts`: non-extractable device key; PBKDF2 params for passphrase path (iterations ≥ 600k per OWASP 2023 — record actual value as finding if lower); all four `SecretId`s covered in the 6-edit lockstep sites.

- [ ] **Step 3: Review checklist — URL sinks**

Run: `grep -rn "href\s*=\|window.open\|location.href" src/app --include="*.tsx" | grep -v "isSafeHttpUrl\|mailto\|#" | head -30`
Any model-supplied or user-supplied URL reaching a sink without `isSafeHttpUrl` = finding.

- [ ] **Step 4: Write findings doc**

Format: `| ID | Severity (CRITICAL/HIGH/MEDIUM/LOW) | Boundary | Finding | Evidence (file:line) | Fix owner | Target phase |`. Include "no finding" rows for each checklist item verified clean (audit evidence, not just absence).

- [ ] **Step 5: Fix any CRITICAL immediately (phase gate)**

CRITICAL = exploitable secret leak, SSRF bypass, or XSS. Fix in its own commit before this task closes. Expected count: 0 (posture verified strong), but the gate is explicit.

- [ ] **Step 6: Commit**

```bash
git add docs/security/findings-2026-07.md
git commit -m "docs(security): manual findings triage — proxies, secrets, URL sinks"
```

---

### Task 5: One-time DAST smoke (ZAP baseline)

**Files:**
- Modify: `docs/security/findings-2026-07.md` (append ZAP section)

- [ ] **Step 1: Build + start production server**

```bash
npm run build && npm run start &
```
Wait for `Ready` on :3000.

- [ ] **Step 2: Run ZAP baseline**

```bash
docker run --rm -t --network host zaproxy/zap-stable zap-baseline.py -t http://localhost:3000 -I
```
`-I` = don't fail on warn; this is inventory, not a gate. (No Docker → use `npx observatory-cli` header check as the reduced-scope fallback and note the substitution.)

- [ ] **Step 3: Triage into findings doc**

Expected findings class: header nits (CSP already exists via `src/proxy.ts`; note anything ZAP flags about it). Server surface is only `/api/jira|confluence|timelog` + static — scope note per roadmap A4.

- [ ] **Step 4: Kill server, commit**

```bash
git add docs/security/findings-2026-07.md
git commit -m "docs(security): ZAP baseline scan results appended to findings"
```

---

### Task 6: Secure-defaults sweep

**Files:**
- Create: `src/app/secure-defaults.test.ts`

- [ ] **Step 1: Write the guard test**

```ts
import { describe, expect, test } from "vitest";
import { defaultSettings } from "./settings-types";

describe("secure defaults — every integration ships disabled", () => {
  test("AI master switch default off", () => {
    expect(defaultSettings.ai.enabled).toBe(false);
  });
  test("Jira default off", () => {
    expect(defaultSettings.jira?.enabled ?? false).toBe(false);
  });
  test("Timelog default off", () => {
    expect(defaultSettings.timelog?.enabled ?? false).toBe(false);
  });
  test("AI scheduled jobs default off (opt-in)", () => {
    expect(defaultSettings.ai.scheduledJobs ?? false).toBe(false);
  });
  test("calendar auto-sync default off for every entity", () => {
    const cal = defaultSettings.outlookCalendar ?? {};
    for (const cfg of Object.values(cal)) {
      expect(cfg?.auto ?? false).toBe(false);
    }
  });
});
```

Adjust import path/names after checking: `grep -n "defaultSettings\|export const default" src/app/settings-types.ts | head`. If defaults live elsewhere (e.g. `use-settings.ts`), import from there — do NOT duplicate the object.

- [ ] **Step 2: Run test**

Run: `npx vitest run src/app/secure-defaults.test.ts`
Expected: PASS (defaults are believed off). Any FAIL = real finding → fix the default in its own commit + add to findings doc.

- [ ] **Step 3: Typecheck (test-only type errors slip vitest)**

Run: `npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 4: Commit**

```bash
git add src/app/secure-defaults.test.ts
git commit -m "test(security): guard test pinning integration-disabled defaults"
```

---

### Task 7: Secrets-never-exported guard test

**Files:**
- Create: `src/app/secrets-exclusion.test.ts`

- [ ] **Step 1: Locate the contract symbols**

Run: `grep -rn "CONFIG_KEYS" src/app --include="*.ts" -l` and `grep -n "lop-app:secrets" src/app/*.ts | head`
Record: the recovery `CONFIG_KEYS` list location and the secrets storage key const.

- [ ] **Step 2: Write the failing-capable test**

```ts
import { describe, expect, test } from "vitest";
import { CONFIG_KEYS } from "./recovery-keys"; // ← real path from Step 1

describe("secrets stay out of export/recovery surfaces", () => {
  test("recovery CONFIG_KEYS excludes the secrets store", () => {
    expect(CONFIG_KEYS).not.toContain("lop-app:secrets");
  });
  test("writeSettings blanks every SecretId field on disk", async () => {
    // Import writeSettings + a settings object with all four secrets set,
    // spy on localStorage.setItem, parse the written JSON, assert
    // ai.apiKey === "" && turso token === "" && jira.apiToken === "" &&
    // timelog token === "". Mirror the existing writeSettings test file's
    // setup (grep: "writeSettings" in src/app/*.test.ts) — extend, don't fork.
  });
});
```

Check for an existing test covering this first: `grep -rln "writeSettings" src/app --include="*.test.ts"`. If one exists, EXTEND it with the four-secrets assertion instead of a new file (DRY), and delete this new file from the plan.

- [ ] **Step 3: Run + typecheck**

Run: `npx vitest run src/app/secrets-exclusion.test.ts && npx tsc --noEmit`
Expected: PASS, exit 0.

- [ ] **Step 4: Commit**

```bash
git add -A src/app
git commit -m "test(security): guard secrets out of recovery CONFIG_KEYS and settings-at-rest"
```

---

### Task 8: Rate-limit 429 behavior tests for proxy routes

**Files:**
- Modify/Create: test files beside each route (check existing: `ls src/app/api/jira src/app/api/timelog src/app/api/confluence/page`)

- [ ] **Step 1: Inventory existing route tests**

Run: `find src/app/api -name "*.test.ts"`
For each route WITHOUT a rate-limit test, add one.

- [ ] **Step 2: Write test (pattern — adapt per route)**

```ts
test("returns 429 once the per-scope rate limit is exhausted", async () => {
  // Call the route handler in a loop past the limit with a fixed client key;
  // read the actual limit const from _helpers.ts (do not hardcode a guess).
  // Assert final response.status === 429.
});
```

Read the real limiter API first: `grep -n "rate" src/app/api/jira/_helpers.ts`. If the limiter is time-window based, use `vi.useFakeTimers()`.

- [ ] **Step 3: Run + typecheck + commit**

```bash
npx vitest run src/app/api && npx tsc --noEmit
git add src/app/api
git commit -m "test(security): 429 rate-limit behavior pinned for jira/confluence/timelog proxies"
```

---

### Task 9: jscpd duplication baseline

**Files:**
- Create: `docs/baselines/jscpd-2026-07.json`
- Modify: `package.json` (devDependency + script)

- [ ] **Step 1: Install + run**

```bash
npm i -D jscpd
npx jscpd src --min-tokens 50 --ignore "**/*.test.*,**/*.property.test.*,**/__fixtures__/**,**/i18n*.ts" --reporters json,console --output docs/baselines/
```

- [ ] **Step 2: Rename report + record headline number**

```bash
mv docs/baselines/jscpd-report.json docs/baselines/jscpd-2026-07.json
```
Record the `statistics.total.percentage` value — this is the Phase 3 target input (exit ≤ 50% of it).

- [ ] **Step 3: Add npm script**

In `package.json` scripts: `"dup:check": "jscpd src --min-tokens 50 --ignore \"**/*.test.*,**/*.property.test.*,**/__fixtures__/**,**/i18n*.ts\" --reporters console"`.
Then run `npm run docs:scripts:check` — if it fails (script-docs sync gate), run `npm run docs:scripts` to regenerate.

- [ ] **Step 4: Commit**

```bash
git add docs/baselines/jscpd-2026-07.json package.json package-lock.json
git commit -m "chore(baseline): jscpd duplication baseline + dup:check script"
```

---

### Task 10: Dead-code baseline + unambiguous deletions

**Files:**
- Create: `docs/baselines/deadcode-2026-07.md`, `knip.json`
- Delete: unambiguous dead files/exports only

- [ ] **Step 1: Configure knip for the lazy/dynamic landmines**

`knip.json`:

```json
{
  "entry": ["src/app/**/page.tsx", "src/app/layout.tsx", "src/proxy.ts", "scripts/*.mjs", "e2e/**/*.ts"],
  "project": ["src/**/*.{ts,tsx}"],
  "ignore": ["src/app/workspace-panels.tsx", "src/app/export-ooxml.ts", "**/__fixtures__/**"],
  "ignoreDependencies": []
}
```

(`workspace-panels.tsx` lazy registry + `export-ooxml` barrel are do-not-touch per roadmap Phase 1 risk note.)

- [ ] **Step 2: Run both tools, commit raw reports**

```bash
npx --yes knip > docs/baselines/knip-raw.txt 2>&1 || true
npx --yes ts-prune >> docs/baselines/deadcode-2026-07.md 2>&1 || true
```
Summarize both into `docs/baselines/deadcode-2026-07.md` with three buckets: UNAMBIGUOUS (unexported+unreferenced), AMBIGUOUS (Phase 2), FALSE-POSITIVE (dynamic import / test-only / barrel).

- [ ] **Step 3: Delete UNAMBIGUOUS bucket only**

One deletion per logical cluster. After EACH cluster: `npm run lint && npx tsc --noEmit`.

- [ ] **Step 4: Full verification**

```bash
npm run test:run && npm run build && npx playwright test --list
```
Expected: all green. (`--list` catches the e2e module-top-level ENOENT class without browsers.)

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: delete unambiguous dead code (knip/ts-prune baseline pass 1)"
```

---

### Task 11: File-size ratchet script + CI job (warn-only)

**Files:**
- Create: `scripts/check-file-sizes.mjs`, `docs/baselines/file-sizes.json`
- Modify: `.gitlab-ci.yml`, `package.json`

- [ ] **Step 1: Write the script**

`scripts/check-file-sizes.mjs`:

```js
// Ratchet: fails when a NEW file exceeds LIMIT, or an already-oversized file GROWS.
// Regenerate baseline: node scripts/check-file-sizes.mjs --update
import { readFileSync, writeFileSync } from "node:fs";
import { execSync } from "node:child_process";

const LIMIT = 800;
const BASELINE = "docs/baselines/file-sizes.json";
const EXEMPT = [/src\/app\/i18n(\.de)?\.ts$/];

const files = execSync("git ls-files src -- '*.ts' '*.tsx'", { encoding: "utf8" })
  .split("\n").filter(Boolean)
  .filter((f) => !/\.test\.|\.property\./.test(f))
  .filter((f) => !EXEMPT.some((re) => re.test(f)));

const sizes = Object.fromEntries(
  files.map((f) => [f, readFileSync(f, "utf8").split("\n").length]),
);

if (process.argv.includes("--update")) {
  const oversized = Object.fromEntries(
    Object.entries(sizes).filter(([, n]) => n > LIMIT).sort(),
  );
  writeFileSync(BASELINE, JSON.stringify(oversized, null, 2) + "\n");
  console.log(`baseline written: ${Object.keys(oversized).length} oversized files`);
  process.exit(0);
}

const baseline = JSON.parse(readFileSync(BASELINE, "utf8"));
const violations = [];
for (const [f, n] of Object.entries(sizes)) {
  if (n <= LIMIT) continue;
  const prev = baseline[f];
  if (prev === undefined) violations.push(`${f}: ${n} lines (new file over ${LIMIT})`);
  else if (n > prev) violations.push(`${f}: ${n} lines (grew from baselined ${prev})`);
}
if (violations.length) {
  console.error("file-size ratchet violations:\n" + violations.join("\n"));
  process.exit(1);
}
console.log("file-size ratchet ok");
```

- [ ] **Step 2: Generate baseline + verify pass**

```bash
node scripts/check-file-sizes.mjs --update
node scripts/check-file-sizes.mjs
```
Expected baseline content: `task-manager.tsx` (2840) + `workspace-section.tsx` (1009) + any panel > 800. Expected second run: `file-size ratchet ok`.

- [ ] **Step 3: Wire into package.json + CI**

Script: `"size:check": "node scripts/check-file-sizes.mjs"`. Run `npm run docs:scripts` if the sync gate demands it.

CI job:

```yaml
file-size-ratchet:
  stage: quality
  needs: [install]
  allow_failure: true          # warn-only; Phase 4 flips
  script:
    - npm run size:check
```

- [ ] **Step 4: Commit**

```bash
git add scripts/check-file-sizes.mjs docs/baselines/file-sizes.json package.json .gitlab-ci.yml
git commit -m "ci: file-size ratchet (warn-only) — freezes oversized files at current size"
```

---

### Task 12: Patch/minor dependency bumps

**Files:**
- Modify: `package.json`, `package-lock.json`

- [ ] **Step 1: Inventory**

Run: `npm outdated || true`
Split output: patch/minor (this task) vs major (record list into `docs/tech-debt-register-inputs.md` for Phase 4 Task on majors).

- [ ] **Step 2: Bump patch/minor only**

```bash
npm update
git diff package.json   # verify no major jumped (semver ranges guard this, verify anyway)
```
EXCEPTION: do NOT bump `next` (forked, pinned — roadmap A7) or `@playwright/test` past the CI image tag `v1.60.0-jammy` without also updating the image tag in `.gitlab-ci.yml` (documented lockstep).

- [ ] **Step 3: Full verification**

```bash
npm run lint && npx tsc --noEmit && npm run test:run && npm run build
```
Expected: all green. Any failure → revert the specific package, note in register.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore(deps): patch/minor dependency bumps (majors deferred to phase 4)"
```

---

## Phase exit checklist
- [ ] Threat model + findings docs merged; CRITICAL findings = 0; HIGH all ticketed with owner.
- [ ] CI has: semgrep (warn), dependency-audit (blocking), file-size-ratchet (warn); schedule created in GitLab UI.
- [ ] Baselines committed: jscpd %, dead-code report, file-sizes.json.
- [ ] Quick wins landed: dead-code deletion, dep bumps, guard tests.
