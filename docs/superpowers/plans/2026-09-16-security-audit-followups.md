# Security Audit Follow-ups (2026-09) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the reachable findings of the 2026-09 security audit re-run, land the audit as a dated snapshot, and record the rest in the register.

**Architecture:** The one structural change is extracting `html-extract.ts`'s linear cursor walk (`forEachTagPair` / `replaceTagPairs`) into a shared module, then porting the three OOXML extractors onto it. Everything else is local: a fetch option plus tests in two proxy helpers, a derived redaction list, a packaging flag, and documentation.

**Tech Stack:** Next.js app in `src/app` (CRLF, Edit tool only), Electron shell in `desktop/` (LF), docs and register (LF), vitest, eslint, tsc.

**Spec:** `scratchpad/scan/audit-2026-09-summary.md` (session scratchpad, not tracked — copy it into the repo in Task 8 before the scratchpad is lost). Area reports beside it: `audit-2026-09-proxies.md`, `-secrets.md`, `-input.md`, `-desktop.md`, plus `triage-audit-docs.md`, `triage-register.md`, `triage-html-sinks.md`.

## Global Constraints

- **Line endings:** `src/app/*.ts(x)` are CRLF — use the Edit tool, never a shell rewrite, never `sed -i`. `desktop/**` and every `docs/**` file are LF.
- **Never** edit `src/app/i18n.de.ts` with Edit or Write (not needed in this plan).
- **Gates per task:** the task's own vitest file(s) with `--maxWorkers=1 --reporter=dot`, then `npx tsc --noEmit`, then `npx eslint --max-warnings=0 src`. Never two vitest runs at once. Never read an exit code through a pipe — redirect, `echo "EXIT=$?"`, then grep the file.
- **No full suite** unless the user explicitly asks, and only at the end.
- **Commits:** `git commit --only <explicit paths> -F <msgfile>`. Never `git add -A`, never `--amend`, never a bare `git stash`. Refer to register entries as §N in commit messages; `Closes #NN` belongs only in the MR description. End every commit message with the session trailer.
- **Register numbering:** the highest section on `origin/main` is **§557**, so new entries start at **§558**. A number is reserved only once it is on `origin/main` — re-check immediately before pushing, because a peer branch may have taken it.
- **Register ⇄ GitLab is 1:1:** every new OPEN entry needs an issue (`**Work item:** #NN`, title `§NNN: …`, label `source::register`). Creating issues is outward-facing — ask the user before filing.
- **No push, no MR, no merge, no tag** without the user's explicit say.
- Never print a token, an auth header, or a remote URL. Never open any `.env*` file.

---

### Task 1: Extract the linear tag-pair walk into a shared module

The walk in `html-extract.ts` is the fix this whole slice ports. Move it, unchanged, so three more callers can use it.

**Files:**
- Create: `src/app/tag-pair-walk.ts`
- Modify: `src/app/html-extract.ts` (delete the moved code, import instead)
- Create: `src/app/tag-pair-walk.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `export type TagPairSpec = { openPattern: string; closeName: (m: RegExpExecArray) => string; hasAttributes?: boolean }`, `export type TagPair = { start: number; end: number; whole: string; inner: string; openMatch: RegExpExecArray }`, `export function forEachTagPair(html: string, spec: TagPairSpec, visit: (pair: TagPair) => boolean): void`, `export function replaceTagPairs(html: string, spec: TagPairSpec, render: (pair: TagPair) => string): string`. Tasks 2 and 3 import these.

- [ ] **Step 1: Read the source of truth**

Read `src/app/html-extract.ts` around lines 200-320: the `TagPairSpec` / `TagPair` types, the long docstring above `forEachTagPair` (it carries measured timings and two ★ notes about ordering), `forEachTagPair` itself, and `replaceTagPairs`.

- [ ] **Step 2: Write the failing test**

Create `src/app/tag-pair-walk.test.ts`. It must fail because the module does not exist yet.

```ts
import { describe, it, expect } from "vitest";
import { forEachTagPair, replaceTagPairs, type TagPairSpec } from "./tag-pair-walk";

const SPEC: TagPairSpec = {
  openPattern: "<(w:tbl)\\b",
  closeName: (m) => m[1],
  hasAttributes: true,
};

describe("forEachTagPair", () => {
  it("visits each pair with its inner text", () => {
    const pairs: string[] = [];
    forEachTagPair("<w:tbl>a</w:tbl><w:tbl>b</w:tbl>", SPEC, (p) => {
      pairs.push(p.inner);
      return true;
    });
    expect(pairs).toEqual(["a", "b"]);
  });

  it("stops when visit returns false", () => {
    const pairs: string[] = [];
    forEachTagPair("<w:tbl>a</w:tbl><w:tbl>b</w:tbl>", SPEC, (p) => {
      pairs.push(p.inner);
      return false;
    });
    expect(pairs).toEqual(["a"]);
  });

  it("leaves an unclosed open tag alone instead of consuming the rest", () => {
    const pairs: string[] = [];
    forEachTagPair("<w:tbl>unclosed", SPEC, (p) => {
      pairs.push(p.inner);
      return true;
    });
    expect(pairs).toEqual([]);
  });

  it("retires a close name that is missing, so cost stays linear", () => {
    // 20k unclosed opens: quadratic scanning would take seconds, linear is ms.
    const input = "<w:tbl ".repeat(20_000);
    const start = performance.now();
    forEachTagPair(input, SPEC, () => true);
    expect(performance.now() - start).toBeLessThan(250);
  });
});

describe("replaceTagPairs", () => {
  it("replaces each pair and keeps the text around it", () => {
    const out = replaceTagPairs("x<w:tbl>a</w:tbl>y", SPEC, (p) => "[" + p.inner + "]");
    expect(out).toBe("x[a]y");
  });
});
```

- [ ] **Step 3: Run it and confirm it fails**

```bash
npx vitest run --maxWorkers=1 --reporter=dot src/app/tag-pair-walk.test.ts > /tmp/t1.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests |Cannot find module" /tmp/t1.log
```
Expected: FAIL, "Cannot find module ./tag-pair-walk".

- [ ] **Step 4: Create the module by moving the code verbatim**

Create `src/app/tag-pair-walk.ts` (a NEW file, so line endings follow the repo default — write it with LF and let git's clean filter handle it; do not hand-convert). Move `TagPairSpec`, `TagPair`, `forEachTagPair` and `replaceTagPairs` across **unchanged**, and bring the full docstring with them. Export all four. Add a header comment saying the module is the shared linear alternative to a lazy `[\s\S]*?` pair regex, and that `html-extract.ts` is where it was measured.

Change nothing about the algorithm in this task. A behaviour change here would be invisible against `html-extract.test.ts` passing for the wrong reason.

- [ ] **Step 5: Point html-extract at the shared module**

In `src/app/html-extract.ts` (CRLF — Edit tool only), delete the moved declarations and add the import. Keep every other line, including the pointer comments around the call sites.

- [ ] **Step 6: Run both test files**

```bash
npx vitest run --maxWorkers=1 --reporter=dot src/app/tag-pair-walk.test.ts src/app/html-extract.test.ts > /tmp/t1.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t1.log
```
Expected: PASS, both files. `html-extract.test.ts` passing unchanged is the proof the move was behaviour-preserving.

- [ ] **Step 7: Typecheck and lint**

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src; echo "EXIT=$?"
```

- [ ] **Step 8: Commit**

```bash
git commit --only src/app/tag-pair-walk.ts src/app/tag-pair-walk.test.ts src/app/html-extract.ts -F <msgfile>
```
Message: `refactor: extract the linear tag-pair walk from html-extract for reuse`.

---

### Task 2: Port docx-extract onto the walk

**Files:**
- Modify: `src/app/docx-extract.ts` (lines 8-51; the lazy regexes are at 14, 18, 57)
- Modify: `src/app/docx-extract.test.ts`

**Interfaces:**
- Consumes: `forEachTagPair` / `replaceTagPairs` / `TagPairSpec` from Task 1.
- Produces: `extractDocx(entries: Map<string, Uint8Array>): string` — signature unchanged.

- [ ] **Step 1: Write the failing performance test**

Add to `src/app/docx-extract.test.ts`. Keep every existing test; they pin the output format and must stay green.

```ts
it("does not blow up on repetitive unclosed markup", async () => {
  // 40k unclosed table opens. With a lazy [\s\S]*? pair regex this is
  // quadratic (measured 142ms at 40k chars, 1861ms at 160k); the cursor
  // walk is linear. The ceiling is deliberately loose - it fails on the
  // pattern class, not on a machine's speed.
  const xml =
    '<?xml version="1.0"?><w:document><w:body>' +
    "<w:tbl ".repeat(40_000) +
    "</w:body></w:document>";
  const entries = new Map([["word/document.xml", new TextEncoder().encode(xml)]]);
  const start = performance.now();
  extractDocx(entries);
  expect(performance.now() - start).toBeLessThan(1000);
});
```

- [ ] **Step 2: Run it against the current code and confirm it fails**

```bash
npx vitest run --maxWorkers=1 --reporter=dot src/app/docx-extract.test.ts > /tmp/t2.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests |blow up" /tmp/t2.log
```
Expected: FAIL on the new test (slow), every other test PASS. If it passes, stop: the input is not reaching the regex you think it is — find the real path before changing anything.

- [ ] **Step 3: Replace the three lazy pair regexes**

In `src/app/docx-extract.ts` (CRLF — Edit tool only), rewrite `cellText`, `renderTable`, `renderParagraph` and the `extractDocx` body to use `replaceTagPairs` / `forEachTagPair` with a `TagPairSpec` per tag (`w:tc`, `w:tbl`, `w:p`, `w:t`). Follow `renderTables` / `renderOneTable` in `html-extract.ts` as the worked example. Preserve the output byte-for-byte: the existing tests are the contract.

- [ ] **Step 4: Run the file again**

```bash
npx vitest run --maxWorkers=1 --reporter=dot src/app/docx-extract.test.ts > /tmp/t2.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t2.log
```
Expected: PASS, all tests.

- [ ] **Step 5: Mutation-check the new test**

Temporarily restore ONE lazy pair regex, re-run, and confirm the performance test goes red. Then revert. A performance test that passes against the unfixed code proves nothing, and this is the only way to know.

- [ ] **Step 6: Typecheck, lint, commit**

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src; echo "EXIT=$?"
git commit --only src/app/docx-extract.ts src/app/docx-extract.test.ts -F <msgfile>
```
Message: `fix(security): §558 — docx extraction was quadratic on repetitive unclosed markup`.

---

### Task 3: Port xlsx-extract and pptx-extract

Same shape as Task 2, batched: two files, the same edit, one review surface.

**Files:**
- Modify: `src/app/xlsx-extract.ts` (lazy regexes at 12, 95, 108, 112)
- Modify: `src/app/pptx-extract.ts` (lazy regex at 21)
- Modify: `src/app/xlsx-extract.test.ts`, `src/app/pptx-extract.test.ts`

**Interfaces:**
- Consumes: Task 1's exports; the spec-shape convention Task 2 established.
- Produces: `extractXlsx` and `extractPptx` — signatures unchanged.

- [ ] **Step 1: Write both failing performance tests**

Mirror Task 2's test in each file, with that format's own markup: `<c ` repeated inside a `<sheetData>` for xlsx, `<a:p ` inside a slide for pptx. Same 40,000 repetitions, same 1000 ms ceiling, same comment explaining what it pins.

- [ ] **Step 2: Run both and confirm both fail**

```bash
npx vitest run --maxWorkers=1 --reporter=dot src/app/xlsx-extract.test.ts src/app/pptx-extract.test.ts > /tmp/t3.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t3.log
```

- [ ] **Step 3: Port both files**

Edit tool only (CRLF). Replace every lazy pair regex with the shared walk. Keep output identical — the existing tests are the contract.

- [ ] **Step 4: Run both, then mutation-check one**

Re-run the two files; expect PASS. Then restore one lazy regex in `xlsx-extract.ts`, confirm red, revert.

- [ ] **Step 5: Typecheck, lint, commit**

```bash
git commit --only src/app/xlsx-extract.ts src/app/xlsx-extract.test.ts src/app/pptx-extract.ts src/app/pptx-extract.test.ts -F <msgfile>
```
Message: `fix(security): §558 — xlsx and pptx extraction were quadratic on repetitive unclosed markup`.

---

### Task 4: Prove no live lazy pair regex remains in html-extract

**This task's original premise was wrong and was corrected in the pre-flight scan.** The plan
claimed `html-extract.ts` still carried lazy `[\s\S]*?` patterns at lines 88, 144, 153, 215,
218, 386 and 387. All seven are **prose inside `*` comment lines** describing the pattern class —
none is a live regex. The claim came from the source audit summary, which is wrong on this point.

So this is a verification step, not a code change. Run it after Task 1 has moved the docstrings
out (which relocates four of the seven mentions into `tag-pair-walk.ts`).

**Files:** none, unless the grep below finds something the pre-flight missed.

- [ ] **Step 1: Prove it**

```bash
grep -nE '\[\\s\\S\]\*\?' src/app/html-extract.ts | grep -vE '^[0-9]+: *\*'; echo "EXIT=$?"
```

Expected: no output (grep exits 1 when it matches nothing). Every remaining mention is a comment.

- [ ] **Step 2: If — and only if — that grep prints a line**

A live lazy pair regex survived. Treat it as Task 2 does: failing performance test first, port to
the shared walk, mutation-check, commit. Otherwise there is **no commit for this task** — record
the grep output in the report and move on.

- [ ] **Step 3: Carry the correction into Task 8**

`docs/security/findings-2026-09.md` must not repeat the false claim. Task 8 owns that edit; this
task's report is its evidence.

### Task 5: Stop the Jira and Timelog proxies following upstream redirects

**Files:**
- Modify: `src/app/api/jira/_helpers.ts` (the `fetch` at :100)
- Modify: `src/app/api/timelog/_helpers.ts` (the `fetch` at :135)
- Modify: `src/app/api/jira/_helpers.test.ts` and `src/app/api/timelog/_helpers.test.ts` (both already exist; `src/app/api/stt/route.test.ts` is the redirect-test reference)

**Interfaces:**
- Consumes: the pattern at `src/app/api/stt/_helpers.ts:92-101`.
- Produces: `callJira` and `callTimelog` — signatures unchanged; a 3xx upstream now yields a 502 instead of a followed redirect.

- [ ] **Step 1: Read the reference implementation**

`src/app/api/stt/_helpers.ts` lines 55-105: the comment explaining why (`a 302 to an internal host … would bypass it if we followed`), `redirect: "manual"`, and the `res.status >= 300 && res.status < 400` rejection.

- [ ] **Step 2: Write the failing test for each helper**

Mock `fetch` to resolve with a 302 whose `location` points at a host outside the allowlist. Assert the helper returns the 502-shaped error and that `fetch` was called exactly once — the second assertion is what proves the redirect was not followed.

- [ ] **Step 3: Run both and confirm both fail**

```bash
npx vitest run --maxWorkers=1 --reporter=dot src/app/api/jira src/app/api/timelog > /tmp/t5.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t5.log
```

- [ ] **Step 4: Add the option and the rejection to both helpers**

Edit tool only. Add `redirect: "manual"` to each `fetch`, and reject 3xx as 502 immediately after. Copy the *reasoning* comment from the stt helper in your own words at each site — a bare option with no comment is what rots next.

- [ ] **Step 5: Run, typecheck, lint, commit**

```bash
git commit --only src/app/api/jira/_helpers.ts src/app/api/jira/_helpers.test.ts src/app/api/timelog/_helpers.ts src/app/api/timelog/_helpers.test.ts -F <msgfile>
```
Message: `fix(security): §559 — reject upstream redirects in the Jira and Timelog proxies`.

---

### Task 6: Derive the config-export redaction from the SecretId list

`redactSettings` in `recovery-config.ts` redacts `integrations.turso.authToken`, `jira.apiToken` and `ai.apiKey`, and silently misses `timelog.apiToken` and `dictation.sttApiKey`. It is the backstop for a `writeSettings` regression, so a hardcoded list is exactly the wrong shape.

**Files:**
- Modify: `src/app/recovery-config.ts`
- Modify: `src/app/recovery-config.test.ts` (it already exists)

**Interfaces:**
- Consumes: the `SecretId` union from `secrets.ts`. **There is no id→settings-path mapping today** — `secrets.ts` exports the union and the seal/unseal functions only, and each call site restates the path. Create the mapping in `secrets.ts`, export it, and have `redactSettings` walk it; a second copy of this mapping is the defect being fixed.
- Produces: `redactSettings` — behaviour unchanged for the three it already covered, plus the two it missed.

- [ ] **Step 1: Write the failing test**

Feed `redactSettings` a settings blob carrying all five secret fields populated, and assert all five come back redacted. It must fail today on `timelog.apiToken` and `dictation.sttApiKey`.

- [ ] **Step 2: Run it and confirm it fails on exactly those two**

- [ ] **Step 3: Rewrite the function to walk the id→path mapping**

One loop over the mapping, not five branches. Keep the `try`/`catch` returning the raw string on a parse failure.

- [ ] **Step 4: Prove it cannot rot again**

Add a test asserting that every member of the `SecretId` union has an entry in the mapping. This is the test that makes a sixth secret fail loudly instead of silently leaking through the backstop.

- [ ] **Step 5: Run, typecheck, lint, commit**

Message: `fix(security): §560 — redact every sealed secret in the config export, not three of five`.

---

### Task 7: Set the Electron fuses

**Files:**
- Modify: `desktop/electron-builder.yml` (LF)

- [ ] **Step 1: Read the current config**

Confirm there is no `electronFuses` key and note the surrounding comments about `signExecutable`.

- [ ] **Step 2: Add the fuses block**

```yaml
electronFuses:
  runAsNode: false
  enableNodeCliInspectArguments: false
  enableNodeOptionsEnvironmentVariable: false
  onlyLoadAppFromAsar: true
```

Add a comment saying what each buys: `runAsNode: false` stops `ELECTRON_RUN_AS_NODE=1` turning the shipped exe into a Node interpreter; `onlyLoadAppFromAsar` stops a swapped-in directory being loaded ahead of the archive.

- [ ] **Step 3: Note what cannot be verified locally**

Fuses only take effect in a packaged build, and `desktop-package` is a manual CI job. Write that into the commit message and the register entry. Do not claim the fuses are verified.

- [ ] **Step 4: Commit**

Message: `chore(desktop): §561 — disable RunAsNode and the Node env fuses in packaged builds`.

---

### Task 8: Land the audit as a dated snapshot and fix the stale claims

**Files:**
- Create: `docs/security/findings-2026-09.md` (LF)
- Modify: `docs/security/findings-2026-07.md` (a dated correction note — never a rewrite; it is a signed record)
- Modify: `docs/security/threat-model.md` (the sink count)
- Modify: `src/proxy.ts` (the CSP comment enumerating six sinks)

- [ ] **Step 1: Copy the audit summary into the repo**

Copy `scratchpad/scan/audit-2026-09-summary.md` to `docs/security/findings-2026-09.md`. Add a banner at the top: the date, the tree it was verified against (`ed6ed8e4`), that it is a dated snapshot in the same series as the 2026-07 file, and that it supersedes that file's *scope* without replacing the record. Strip anything that names the session scratchpad path.

- [ ] **Step 2: Add the correction note to the 2026-07 file**

Beside the URL-1 finding, a dated note: `document-links-field.tsx` was not deleted; it was rewritten as an entity cross-reference picker with no URL rendering, and the `isSafeHttpUrl` guard now lives in `knowledge-links-field.tsx` / `knowledge-panel.tsx`, where it is still enforced. Leave the original text in place.

- [ ] **Step 3: Fix the two stale sink counts**

- `docs/security/threat-model.md`: "6 `dangerouslySetInnerHTML` sites" → the real figure is 8 JSX sinks, or 11 counting the three `document.write` sites. Put the reproduce command next to the number.
- `src/proxy.ts` (CRLF — Edit tool): the comment enumerating "the SIX real JSX sinks" omits `document-block-notices.tsx` and `document-editor.tsx`. Correct the list and the count. Both omitted sinks are sanitized, so the rationale stands — only the enumeration was wrong.

- [ ] **Step 4: Verify the count you just wrote**

```bash
grep -rn "dangerouslySetInnerHTML={" src --include=*.tsx | wc -l
grep -rn "document.write" src --include=*.ts --include=*.tsx | wc -l
```
Write what the commands print, not what this plan says.

- [ ] **Step 5: Lint, typecheck, commit**

```bash
npx eslint --max-warnings=0 src; echo "EXIT=$?"
npx tsc --noEmit; echo "EXIT=$?"
git commit --only docs/security/findings-2026-09.md docs/security/findings-2026-07.md docs/security/threat-model.md src/proxy.ts -F <msgfile>
```
Message: `docs(security): file the 2026-09 audit and correct three stale claims`.

---

### Task 9: Update the register

**Files:**
- Modify: `docs/open-followups.md` (LF)

Numbering starts at §558. Tasks 2, 3, 5, 6 and 7 cite §558-§561 in their commit messages, so those entries must exist with those numbers — write them first if you are executing out of order.

- [ ] **Step 1: Add an entry per finding**

Fixed in this slice, filed as CLOSED with the fixing commit named:
- **§558** OOXML extractors were quadratic on repetitive unclosed markup (Tasks 2-3)
- **§559** Jira and Timelog proxies followed upstream redirects with credentials (Task 5)
- **§560** the config-export backstop redacted 3 of 5 secrets (Task 6)
- **§561** no Electron fuses; `RunAsNode` enabled in packaged builds (Task 7) — open until a packaged build confirms it

Filed as OPEN, not fixed here:
- **§562** the shared rate limiter keys off a client-supplied forwarding header, so it is bypassable, and its store is a bare in-memory `Map` (the pre-existing PX-9 accepted risk). Record the self-hosted deployment assumption explicitly — the decision may be "accept", but it should be a written decision.
- **§563** the installer is unsigned (`electron-builder.yml:121`). Note it becomes a real supply-chain gap only if distribution goes public.
- **§564** `diagnostics-redact.ts` uses a fixed pattern list with no catch-all for an opaque Timelog or STT token in free text. No live leak found.
- **§565** `jira-settings.tsx:189` and `timelog-settings.tsx:57` clear a token by resealing an empty string rather than calling `removeSealed`, unlike the other three sections.
- **§566** `api/jira/_helpers.ts:117` logs the raw fetch-rejection object; `err.message` would be more robust.

Each entry: the heading in the register's house style, a `**Status:**` line, what was verified and how, and a reproduce command where one exists.

- [ ] **Step 2: Close §13**

§13 says the audit is scope-stale. This run closes it. Mark it `— CLOSED 2026-09-17` and point at `docs/security/findings-2026-09.md`, noting that the re-run covered `/api/stt` and `desktop/`, neither of which any prior audit had touched.

- [ ] **Step 3: Rebuild the index**

Run the rebuild recipe embedded in `docs/open-followups.md` (the fenced `REBUILD` block above the `INDEX:BEGIN` marker), from the repo root.

- [ ] **Step 4: Run the register gates**

```bash
npm run followups:index:check; echo "EXIT=$?"
npm run followups:check > /tmp/t9.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/t9.log
```
`followups:index:check` exit 1 means drift, exit 2 means it could not scan — the second is worse and demands the opposite response. `followups:check` is a report, not a gate.

- [ ] **Step 5: Commit**

Message: `docs: file §558-§566 from the 2026-09 security audit, close §13`.

---

### Task 10: Bump vitest to 4.1.11

Clears the three moderate dev-dependency advisories and the two open GitHub Dependabot alerts.

**Files:**
- Modify: `package.json`, `package-lock.json`

- [ ] **Step 1: Install the exact version**

```bash
npm install --save-dev vitest@4.1.11 @vitest/coverage-v8@4.1.11
```
Never `npm ci` — it destroys the worktree's `node_modules`.

- [ ] **Step 2: Confirm the advisories are gone**

```bash
# NOT /tmp: node resolves /tmp/x as C:\tmp\x while the bash redirect writes Git Bash's /tmp,
# so the read silently misses the file it just wrote. Use one absolute path for both.
OUT="$CLAUDE_SCRATCHPAD/audit.json"
npm audit --json > "$OUT" 2>/dev/null
node -e "const v=JSON.parse(require('fs').readFileSync(process.env.OUT,'utf8')).metadata.vulnerabilities;console.log(JSON.stringify(v))"
```

Set `OUT` to the absolute scratchpad path your dispatch gives you, and export it before the
`node` call so `process.env.OUT` resolves.
Expected: all zero.

- [ ] **Step 3: Run the tests this plan touched**

```bash
npx vitest run --maxWorkers=1 --reporter=dot src/app/tag-pair-walk.test.ts src/app/html-extract.test.ts src/app/docx-extract.test.ts src/app/xlsx-extract.test.ts src/app/pptx-extract.test.ts > /tmp/t10.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/t10.log
```
A vitest minor bump can change reporter or mock behaviour, so confirm the new files still pass before trusting the bump.

- [ ] **Step 4: Commit**

Message: `chore(deps): bump vitest to 4.1.11 (GHSA-82fw-gwwq-j7x9)`.

---

### Task 11: Final review and hand-off

- [ ] **Step 1: Request a whole-branch review**

Dispatch a code reviewer over `origin/main..HEAD` on the most capable model. Point it at this plan and at `docs/security/findings-2026-09.md`. The security-sensitive files (the two proxy helpers, `recovery-config.ts`, the four extractors) get the most attention.

- [ ] **Step 2: Fix Critical and Important findings, then re-review the fix diff only**

- [ ] **Step 3: Ask the user before anything outward-facing**

Three things need their explicit say, and none may be assumed from approval of this plan:
- running the full suite;
- filing the GitLab issues for §562-§566 (register ⇄ GitLab 1:1);
- pushing, opening an MR, merging, or tagging.

- [ ] **Step 4: Re-check the register numbering before any push**

A § is reserved only once it is on `origin/main`. Re-run the max-section check against a freshly fetched `origin/main`; if a peer took §558+, renumber ours — entries, index, commit messages in the MR description, and the issue titles.

---

## Notes for the executor

- **The OOXML task is the only user-reachable finding.** If the slice has to be cut short, Tasks 1-3 are the part that matters.
- **Do not trust this plan's line numbers.** They were correct on `ed6ed8e4`; every edit shifts them. Grep for the symbol.
- **Two claims in the source audit reports are wrong** and were corrected after checking: `office-xml.ts` has no lazy pair regex (the `extractRuns` claim), and the `xlsx-extract.ts` lines are 12, 95, 108, 112, not 65. If you find a third, fix the report in the same commit as the code.
