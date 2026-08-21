# Tiptap CSP Nonce Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close `docs/open-followups.md` §54 — in a production build every rich-text editor renders without ProseMirror's base stylesheet, because the prod CSP refuses the `<style>` element Tiptap injects at runtime.

**Architecture:** Pass the per-request CSP nonce into Tiptap's supported `injectNonce` editor option at the app's single `useEditor` call, so the injected `<style>` carries a nonce the existing policy already accepts. `src/proxy.ts` and the CSP are NOT modified. A new prod-smoke script plus CI job closes the structural blind spot that let this ship unseen — `npm run e2e:smoke` starts no server, so it is only ever pointed at a dev server, and the dev CSP is the permissive branch.

**Tech Stack:** Next.js `^16.2.11` · React `19.2.4` · `@tiptap/react` + `@tiptap/starter-kit` `^3.27.1` (`@tiptap/core` is transitive) · vitest 4.1.8 · Playwright · GitLab CI ( (GitLab)).

**Spec:** `docs/superpowers/specs/2026-08-09-tiptap-csp-nonce-design.md` (approved; gitignored, so it is not in the repo — this plan restates everything needed).

**Baseline:** `main` `66e44712`, 0.226.0 "Emshwiller", tree clean.

---

## Background an implementer needs

### What is actually broken

In a production build the browser refuses a `<style>` element and reports:

```
Applying inline style violates the following Content Security Policy directive
'style-src-elem 'self' 'nonce-…''. Either the 'unsafe-inline' keyword, a hash
('sha256-PlumsSlvJ7vvWzjqibGAYKq92O3y/4JTxWWsWJvyUYA='), or a nonce is required
```

Consequence, measured on the live prod editor: `white-space` computes `normal` instead of `break-spaces` and `position` computes `static` instead of `relative`. So consecutive spaces and newlines collapse while typing, and anything ProseMirror absolutely-positions against the editor box (cursor, gap-cursor, placeholder) loses its containing block. Blast radius is every rich-text surface: task description, note log, RAID description + mitigation, change description + impact description + resolution notes, milestone description.

### Where the `<style>` comes from

`@tiptap/core`'s own `Editor`, NOT the bundler:

```
node_modules/@tiptap/core/src/Editor.ts:255-257
  private injectCSS(): void {
    if (this.options.injectCSS && typeof document !== 'undefined') {
      this.css = createStyleTag(style, this.options.injectNonce)
```

`style` is a JavaScript string constant in `node_modules/@tiptap/core/src/style.ts`, measured at **1329 bytes** — a byte-exact match for the `<style>` element seen in the live prod DOM. `prosemirror-view` never injects (it only `console.warn`s), and `prosemirror.css` is a different file (1243 bytes) that nothing imports.

`createStyleTag` already supports the fix:

```
node_modules/@tiptap/core/src/utilities/createStyleTag.ts
  const tiptapStyleTag = document.querySelector(`style[data-tiptap-style…]`)
  if (tiptapStyleTag !== null) { return tiptapStyleTag }        // <-- DEDUPES
  const styleNode = document.createElement('style')
  if (nonce) { styleNode.setAttribute('nonce', nonce) }
  styleNode.setAttribute(`data-tiptap-style…`, '')
```

### Facts that shape the implementation

1. **One mount site.** `grep -rn "useEditor\|new Editor(" src/app --include="*.ts" --include="*.tsx" | grep -v "\.test\."` returns exactly one call: `src/app/rich-text-editor.tsx:126`. Every rich-text surface goes through that shared primitive.

2. **`createStyleTag` dedupes on `style[data-tiptap-style]`** and returns the existing tag. In the app that is harmless (one mount site). In tests it is a trap — see Task 3.

3. **The component SSRs.** Six of its eight call sites import it statically (`change-edit-modal.tsx:44`, `dashboard-sections/dashboard-narrative.tsx:9`, `milestone-edit-modal.tsx:11`, `note-log-panel.tsx:21`, `raid-edit-modal.tsx:50`, `task-form-fields.tsx:15`); only `meeting-report-panel.tsx:18` and `settings-sections/comm-templates-section.tsx:22` use `dynamic(..., { ssr: false })`. A `"use client"` component still renders on the server, and the `useEditor({...})` options object is built during render. So the nonce reader **runs server-side** and MUST guard `typeof document`.

4. **A nonced `<script>` always exists.** `src/proxy.ts:73-77` mints a nonce and sets it on the `x-nonce` request header; `src/app/layout.tsx:30-34` reads it for a hand-authored inline script; `src/proxy.ts:55` nonces `script-src` in **both** dev and prod.

5. **Two Tiptap injection points, one option.** `@tiptap/core/src/Editor.ts:257` and `@tiptap/extensions/src/selection/selection.ts:39` both read `editor.options.injectNonce`. `@tiptap/extensions` is not imported today, but the option covers it for free if a future StarterKit upgrade activates it.

### Repo landmines that WILL bite this work

- **Never read a gate's exit code through a pipe.** `npm run test:run | tail -8` exits 0 while tests fail — that is `tail`'s status. Redirect to a file, echo `$?` unpiped, then read the file.
- **`npm run lint` does not reproduce the CI gate** (it is bare `eslint` with no `--max-warnings`). Use `npx eslint --max-warnings=0 src/app`.
- **`next build` does not typecheck test files** and vitest never typechecks. Run `npx tsc --noEmit` after editing any test.
- **`src/app/i18n.de.ts` is CRLF and the Edit tool corrupts umlauts in it.** Patch it with a node utf8 write, and anchor on `\r\n`, not `\n`.
- **The file-size gate counts `wc -l` + 1.** Read a real number with `node -e "console.log(require('fs').readFileSync('<file>','utf8').split('\n').length)"`.
- **A new `.ts` file is coverage-gated.** `src/app/csp-nonce.ts` is deliberately NOT added to `vitest.config.ts` `coverage.exclude`: it holds logic, not UI glue, and Task 2's tests take it to 100%.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `src/app/csp-nonce.ts` | **create** | One export, `readCspNonce()`. Reads the per-request CSP nonce off a nonced `<script>`'s IDL property. Browser-only by contract; returns `undefined` under SSR. |
| `src/app/csp-nonce.test.ts` | **create** | Four cases: nonce present, no script, empty nonce, no `document`. |
| `src/app/rich-text-editor.tsx` | modify (`:126`) | Add `injectNonce: readCspNonce()` to the existing `useEditor` options. No other change. |
| `src/app/rich-text-editor.test.tsx` | modify | One new `describe` block asserting the injected style tag carries the nonce, with the `document.head` cleanup its correctness depends on. |
| `scripts/e2e-smoke-prod.mjs` | **create** | Spawn `next start`, wait for ready, run `scripts/e2e-smoke.mjs` against it, stop it on every exit path. |
| `package.json` | modify | `scripts["e2e:smoke:prod"]` + the matching `scriptsDescriptions` entry + version bump. |
| `.gitlab-ci.yml` | modify | New `prod-smoke` job in stage `e2e`. |
| `docs/open-followups.md` | modify (§54) | Rewrite the mechanism section; close the entry. |
| `AGENTS.md` | modify | New script in Commands; new gate in the CI bullet. |
| `CHANGELOG.md`, `src/app/version.ts`, `package-lock.json`, `README.md`, `docs/CODEMAPS/*.md`, `src/app/i18n.ts`, `src/app/i18n.de.ts` | modify | Release bookkeeping (Task 8). |

---

### Task 0: Branch

**Files:** none.

- [ ] **Step 1: Confirm the baseline and branch**

```bash
git fetch origin --prune
git status --short --branch
git log --oneline -1 origin/main
```

Expected: clean tree, `## main...origin/main`, and `origin/main` at `66e44712`. If `origin/main` has moved, STOP and re-read `docs/open-followups.md` §54 and §113 on the new tip before continuing — this plan cites section numbers that a merge can renumber.

- [ ] **Step 2: Create the branch**

```bash
git checkout -b fix/tiptap-csp-nonce
```

---

### Task 1: Baseline prod-smoke measurement — NO code changes

This task runs FIRST and changes nothing. It re-establishes §54's measurement (dated 2026-08-03, on `13b518db`) against the current baseline, and its issue list decides whether Task 6's CI job lands blocking or `allow_failure`. Running this check first is the step whose absence created this bug.

**Files:** none modified. Output is recorded in the commit message of Task 7.

- [ ] **Step 1: Build production**

```bash
npm ci
npm run build
```

Expected: exit 0. `.next/` exists.

- [ ] **Step 2: Start the production server**

In a separate terminal:

```bash
npx next start -p 3200
```

Wait until it prints that it is ready on `http://localhost:3200`.

- [ ] **Step 3: Run the smoke against the PRODUCTION server**

```bash
E2E_URL=http://localhost:3200/ node scripts/e2e-smoke.mjs > /tmp/smoke-baseline.log 2>&1; echo "EXIT=$?"
grep -n "=== ISSUES" -A 40 /tmp/smoke-baseline.log
```

Expected: `EXIT=1` and an `=== ISSUES (n) ===` block. §54 recorded `n = 1` — the CSP violation quoted in Background — but that is a dated measurement, not a property. **Record the real `n` and the full issue list verbatim; the next step branches on it.**

Note the deliberate absence of a pipe on the line that reports the exit code.

- [ ] **Step 4: Decide the CI job's blocking status**

- If the ONLY issue is the `style-src-elem` CSP violation -> Task 6 lands the job **blocking** (no `allow_failure`).
- If there are other issues -> Task 6 lands the job with `allow_failure: true`, and each additional issue is filed as its own new numbered entry in `docs/open-followups.md` in Task 7. **Do not fix them** — they are out of scope, and flipping the job to blocking becomes a follow-up.

Write the decision and the verbatim issue list into a scratch file; Task 7 copies it into §54 and Task 6 reads it.

- [ ] **Step 5: Stop the server**

```bash
PORT=3200 npm run stop
```

Expected: `Stopped dev server (pid NNNN) on port 3200.`

---

### Task 2: `csp-nonce.ts` — read the per-request nonce

**Files:**
- Create: `src/app/csp-nonce.ts`
- Test: `src/app/csp-nonce.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/app/csp-nonce.test.ts`:

```ts
import { describe, it, expect, afterEach, vi } from "vitest";
import { readCspNonce } from "./csp-nonce";

function addScript(nonce: string): HTMLScriptElement {
  const el = document.createElement("script");
  // Set the IDL property, not just the attribute: a real browser EMPTIES the
  // content attribute on insertion (nonce hiding) and keeps the value only on
  // the IDL property. Setting both here mirrors the browser as closely as jsdom
  // allows — see the caveat in the module's own docstring.
  el.setAttribute("nonce", nonce);
  el.nonce = nonce;
  document.head.appendChild(el);
  return el;
}

afterEach(() => {
  document.head.querySelectorAll("script[nonce]").forEach((el) => el.remove());
  vi.unstubAllGlobals();
});

describe("readCspNonce", () => {
  it("returns the nonce of a nonced script", () => {
    addScript("abc123");
    expect(readCspNonce()).toBe("abc123");
  });

  it("returns undefined when no script carries a nonce", () => {
    expect(readCspNonce()).toBeUndefined();
  });

  it("returns undefined — not an empty string — for an empty nonce", () => {
    addScript("");
    expect(readCspNonce()).toBeUndefined();
  });

  it("returns undefined under SSR, where there is no document", () => {
    vi.stubGlobal("document", undefined);
    expect(readCspNonce()).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/app/csp-nonce.test.ts --reporter=dot > /tmp/t.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t.log
```

Expected: `EXIT=1`, failing to resolve `./csp-nonce`.

Note: `--reporter=basic` does not exist in vitest 4.1.8 and errors at startup in a way that reads like a broken run. Use `--reporter=dot`.

- [ ] **Step 3: Write the implementation**

Create `src/app/csp-nonce.ts`:

```ts
// src/app/csp-nonce.ts — the per-request CSP nonce, for code that must hand it
// to a third-party library rather than let Next.js apply it.
//
// Today that is exactly one caller: rich-text-editor.tsx passes it to Tiptap's
// `injectNonce`, because @tiptap/core injects its ProseMirror base stylesheet at
// runtime with document.createElement("style") and the prod CSP is
// `style-src-elem 'self' 'nonce-…'` (src/proxy.ts). See open-followups §54.

/** The per-request CSP nonce, or `undefined` when there is none to read.
 *
 *  ★★★ READS THE IDL PROPERTY, NOT THE ATTRIBUTE VALUE, AND THAT IS THE WHOLE
 *  POINT. The HTML spec EMPTIES the `nonce` content attribute once the element
 *  is inserted ("nonce hiding") and moves the value to an internal slot exposed
 *  as the `.nonce` IDL property — specifically so a CSS or selector-based attack
 *  cannot exfiltrate it. The PRESENCE selector `[nonce]` still matches (the
 *  attribute is there, its value emptied); only the IDL property still carries
 *  the value. Never rewrite this as `getAttribute("nonce")`: it returns "" in a
 *  real browser while passing every jsdom test, because jsdom does not implement
 *  nonce hiding.
 *
 *  ★★ Corollary: a green unit test does NOT prove the browser path. The only
 *  check that can is a real-browser one — see `npm run e2e:smoke:prod` and the
 *  verification recorded in open-followups §54.
 *
 *  ★★ The `typeof document` guard is REQUIRED, not defensive padding. Six of the
 *  eight call sites of RichTextEditor import it STATICALLY, and a "use client"
 *  component still renders on the server, so the `useEditor({...})` options
 *  object — and therefore this function — is evaluated during SSR. Only
 *  meeting-report-panel.tsx and comm-templates-section.tsx use `ssr: false`.
 *
 *  ★ Deliberately NOT threaded down as a prop or React context from layout.tsx,
 *  which already reads the `x-nonce` header: that would put the real value back
 *  into readable DOM, which is strictly worse than reading it where the platform
 *  already keeps it.
 *
 *  ★ An empty value returns `undefined`, not "", so a caller can pass the result
 *  straight through to an option whose "absent" case is `undefined`. */
export function readCspNonce(): string | undefined {
  if (typeof document === "undefined") return undefined;
  const el = document.querySelector<HTMLScriptElement>("script[nonce]");
  return el?.nonce || undefined;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run src/app/csp-nonce.test.ts --reporter=dot > /tmp/t.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/t.log
```

Expected: `EXIT=0`, 4 passed.

- [ ] **Step 5: Typecheck**

```bash
npx tsc --noEmit; echo "EXIT=$?"
```

Expected: `EXIT=0`.

- [ ] **Step 6: Commit**

```bash
git add src/app/csp-nonce.ts src/app/csp-nonce.test.ts
git commit -F - <<'EOF'
feat: read the per-request CSP nonce off a nonced script's IDL property

@tiptap/core injects its ProseMirror base stylesheet at runtime via
document.createElement("style"), and the prod CSP is
style-src-elem 'self' 'nonce-...', so the tag is refused and every
rich-text editor renders unstyled in a production build.

This adds the reader; the next commit wires it into the editor.

Reads .nonce (the IDL property) rather than getAttribute("nonce"),
because a real browser empties the content attribute on insertion and
keeps the value only on the IDL property. jsdom does not implement that,
so the attribute spelling would pass every unit test and return "" in
production.

Guards typeof document: six of the eight RichTextEditor call sites import
it statically, and a "use client" component still renders on the server,
so this runs during SSR.

Refs open-followups.md §54.
EOF
```

---

### Task 3: Wire `injectNonce` into the editor

**Files:**
- Modify: `src/app/rich-text-editor.tsx` (import, and the options object at `:126`)
- Test: `src/app/rich-text-editor.test.tsx` (append one `describe` block)

**★★★ Read this before writing the test.** `createStyleTag` appends to `document.head` and returns the EXISTING tag when it finds `style[data-tiptap-style]`. RTL's `cleanup()` unmounts the render container and does **not** touch `document.head`. So the first editor mounted anywhere in the file wins, and every later assertion in the file reads the *first* mount's tag — a test written the obvious way passes with `injectNonce` deleted. The `beforeEach` below is what makes the assertion mean anything, and Step 5 proves it.

- [ ] **Step 1: Write the failing test**

Append to `src/app/rich-text-editor.test.tsx` (the file already has a `beforeAll` installing jsdom polyfills the editor needs; leave it alone):

```tsx
describe("RichTextEditor — CSP nonce on the injected Tiptap stylesheet", () => {
  // ★★★ createStyleTag DEDUPES on style[data-tiptap-style] and appends to
  // document.head, which RTL cleanup() does not touch. Without this reset the
  // FIRST editor mounted anywhere in this file wins and every assertion below
  // reads that tag — the test then passes with `injectNonce` deleted. Mutation
  // -proved: removing the option must turn this red.
  beforeEach(() => {
    document.head.querySelectorAll("style[data-tiptap-style]").forEach((el) => el.remove());
    document.head.querySelectorAll("script[nonce]").forEach((el) => el.remove());
  });

  it("puts the page's nonce on the style tag Tiptap injects", async () => {
    const script = document.createElement("script");
    script.setAttribute("nonce", "test-nonce");
    script.nonce = "test-nonce";
    document.head.appendChild(script);

    render(<RichTextEditor value="" onChange={() => {}} label="Notes" labels={labels} />);

    await waitFor(() => {
      expect(document.head.querySelector("style[data-tiptap-style]")).not.toBeNull();
    });
    expect(
      document.head.querySelector("style[data-tiptap-style]")!.getAttribute("nonce"),
    ).toBe("test-nonce");
  });

  it("injects an un-nonced tag when the page has no nonce, rather than failing to mount", async () => {
    render(<RichTextEditor value="" onChange={() => {}} label="Notes" labels={labels} />);

    await waitFor(() => {
      expect(document.head.querySelector("style[data-tiptap-style]")).not.toBeNull();
    });
    expect(
      document.head.querySelector("style[data-tiptap-style]")!.hasAttribute("nonce"),
    ).toBe(false);
  });
});
```

If `RichTextEditor`'s required props differ from `value` / `onChange` / `label` / `labels`, copy the prop set from an existing `render(<RichTextEditor …/>)` call already in this file rather than inventing one.

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run src/app/rich-text-editor.test.tsx --reporter=dot > /tmp/t.log 2>&1; echo "EXIT=$?"; grep -E "Tests |nonce" /tmp/t.log | head -20
```

Expected: `EXIT=1`. The first new case fails (`expected null to be "test-nonce"`); the second already passes.

- [ ] **Step 3: Write the implementation**

In `src/app/rich-text-editor.tsx`, add the import beside the existing local imports (the file already imports from `./sanitize-html`, `./document-link`, `./button`, `./i18n`):

```tsx
import { readCspNonce } from "./csp-nonce";
```

Then add one line to the existing options object at `:126`, immediately after `immediatelyRender: false`:

```tsx
  const editor = useEditor({
    extensions: isLean ? LEAN_EXTENSIONS : FULL_EXTENSIONS,
    content: value,
    immediatelyRender: false,
    // @tiptap/core injects its ProseMirror base stylesheet with
    // document.createElement("style"); prod CSP is style-src-elem 'self'
    // 'nonce-...' (src/proxy.ts), so without this the tag is refused and every
    // rich-text surface renders unstyled in a production build — invisible in
    // dev, whose CSP is the permissive branch. open-followups.md §54.
    // This is the app's ONLY useEditor call, and createStyleTag dedupes on
    // style[data-tiptap-style], so one un-nonced mount anywhere would poison
    // every later one. Keep it that way.
    injectNonce: readCspNonce(),
    editorProps: {
```

Leave everything from `editorProps:` onward exactly as it is.

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run src/app/rich-text-editor.test.tsx --reporter=dot > /tmp/t.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/t.log
```

Expected: `EXIT=0`, all tests in the file passing.

- [ ] **Step 5: Mutation-test the guard — REQUIRED, not optional**

Delete the `injectNonce: readCspNonce(),` line, re-run, confirm RED, then restore it and confirm GREEN:

```bash
npx vitest run src/app/rich-text-editor.test.tsx --reporter=dot > /tmp/t.log 2>&1; echo "EXIT=$?"
```

Expected: `EXIT=1` with the line removed, `EXIT=0` with it restored. A test that stays green under this mutation is not testing this fix — if that happens, the `beforeEach` reset is not working and must be fixed before proceeding.

- [ ] **Step 6: Typecheck and lint**

```bash
npx tsc --noEmit; echo "TSC=$?"
npx eslint --max-warnings=0 src/app; echo "LINT=$?"
```

Expected: both `0`. If `injectNonce` is not a known option on `useEditor`'s type, `tsc` says so here — in that case check `node_modules/@tiptap/core/src/types.ts:313` and how `@tiptap/react` re-exports `EditorOptions`, and report back rather than casting it away.

- [ ] **Step 7: Commit**

```bash
git add src/app/rich-text-editor.tsx src/app/rich-text-editor.test.tsx
git commit -F - <<'EOF'
fix: nonce the stylesheet Tiptap injects, so prod renders the editor styled

In a production build the CSP refused @tiptap/core's runtime-injected
ProseMirror base stylesheet, so white-space computed `normal` instead of
`break-spaces` and position computed `static` instead of `relative` — on
every rich-text surface. Dev was unaffected because its CSP is the
permissive branch, which is why this went unnoticed.

Passes the per-request nonce through Tiptap's supported injectNonce
option. The CSP itself is unchanged; src/proxy.ts is untouched.

The test's beforeEach removing style[data-tiptap-style] is load bearing:
createStyleTag dedupes on that selector and appends to document.head,
which RTL cleanup() does not touch, so without the reset the first editor
mounted in the file wins and the assertion passes with injectNonce
deleted. Mutation-proved both ways.

Refs open-followups.md §54.
EOF
```

---

### Task 4: `e2e:smoke:prod` — a repeatable prod-CSP check

`npm run e2e:smoke` starts no server; its own header says *"Requires the dev/prod server to be already running at the target URL."* In practice it is only ever pointed at a dev server somebody already had running, and the dev CSP is the permissive branch — which is the structural reason a prod-only defect of this size stayed invisible.

**Files:**
- Create: `scripts/e2e-smoke-prod.mjs`
- Modify: `package.json` (`scripts` + `scriptsDescriptions`)

- [ ] **Step 1: Write the script**

Create `scripts/e2e-smoke-prod.mjs`:

```js
#!/usr/bin/env node
// scripts/e2e-smoke-prod.mjs — run the smoke against a real PRODUCTION server.
//
// Why this exists: `npm run e2e:smoke` starts no server, so it is only ever
// pointed at a dev server somebody already had running — and the dev CSP is the
// permissive branch (src/proxy.ts: dev gets 'unsafe-inline' on style-src-elem,
// prod gets nonce-only). A prod-only defect was therefore structurally invisible
// to the suite most likely to catch it. See open-followups.md §54.
//
// Usage:
//   npm run build          # required first; this script does NOT build
//   npm run e2e:smoke:prod # PORT overridable, default 3200
//
// Exit code is the smoke's exit code, unmodified.

import { spawn, spawnSync, execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";

const require = createRequire(import.meta.url);
const port = Number(process.env.PORT) || 3200;
const url = `http://localhost:${port}/`;
const READY_TIMEOUT_MS = 120_000;
const POLL_INTERVAL_MS = 500;

if (!fs.existsSync(".next")) {
  console.error("No .next/ directory found. Run `npm run build` first — this script does not build.");
  process.exit(1);
}

// Spawn `next start` through node directly rather than via a shell: `npx` needs
// shell:true on win32, and a shell child is not the process that ends up bound
// to the port, which breaks the port-scoped stop below.
const nextBin = require.resolve("next/dist/bin/next");
const server = spawn(process.execPath, [nextBin, "start", "-p", String(port)], {
  stdio: "inherit",
});

let stopped = false;
function stopServer() {
  if (stopped) return;
  stopped = true;
  try {
    // Port-scoped kill (netstat+taskkill on win32, lsof+kill elsewhere). NEVER a
    // blanket `taskkill /IM node.exe` — that would take down unrelated tooling.
    execFileSync(process.execPath, ["scripts/stop-dev.mjs"], {
      env: { ...process.env, PORT: String(port) },
      stdio: "inherit",
    });
  } catch {
    // stop-dev.mjs already exits 0 when nothing is listening; ignore the rest.
  }
  try {
    server.kill();
  } catch {
    // already gone
  }
}

process.on("SIGINT", () => { stopServer(); process.exit(130); });
process.on("SIGTERM", () => { stopServer(); process.exit(143); });

async function waitForReady() {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url, { redirect: "manual" });
      if (res.status > 0) return true;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  return false;
}

const ready = await waitForReady();
if (!ready) {
  console.error(`next start did not answer on ${url} within ${READY_TIMEOUT_MS / 1000}s.`);
  stopServer();
  process.exit(1);
}

console.log(`• production server ready at ${url} — running smoke`);

const smoke = spawnSync(process.execPath, ["scripts/e2e-smoke.mjs"], {
  env: { ...process.env, E2E_URL: url },
  stdio: "inherit",
});

stopServer();
process.exit(smoke.status ?? 1);
```

- [ ] **Step 2: Add the npm script and its description**

In `package.json`, add to `scripts` immediately after the existing `"e2e:smoke"` entry:

```json
    "e2e:smoke:prod": "node scripts/e2e-smoke-prod.mjs",
```

And to `scriptsDescriptions`, immediately after the existing `"e2e:smoke"` entry:

```json
    "e2e:smoke:prod": "Build-then-smoke against a real production server (scripts/e2e-smoke-prod.mjs): starts `next start`, runs the smoke, stops it. The ONLY local reproduction of the prod CSP — `e2e:smoke` alone only ever meets the permissive dev policy. Needs `npm run build` first",
```

A new script without a `scriptsDescriptions` entry fails the prebuild `docs:scripts:check`.

- [ ] **Step 3: Verify the docs-sync gate passes**

```bash
node scripts/sync-script-docs.mjs --check; echo "EXIT=$?"
```

Expected: `EXIT=0`.

- [ ] **Step 4: Run the new script end to end**

```bash
npm run build > /tmp/build.log 2>&1; echo "BUILD=$?"
npm run e2e:smoke:prod > /tmp/smoke-fixed.log 2>&1; echo "SMOKE=$?"
grep -n "=== ISSUES" -A 40 /tmp/smoke-fixed.log
```

Expected: `BUILD=0`. `SMOKE=0` if Task 1 found the CSP violation was the only issue — that is the fix working. If Task 1 found other issues, `SMOKE=1` with the CSP violation **absent** and only those other issues remaining. Either way, **the `style-src-elem` violation must be gone**; if it is not, stop and diagnose before continuing.

Also confirm the server was actually stopped:

```bash
PORT=3200 npm run stop
```

Expected: `No dev server listening on port 3200.` — proving the script's own cleanup ran.

- [ ] **Step 5: Commit**

```bash
git add scripts/e2e-smoke-prod.mjs package.json
git commit -F - <<'EOF'
test: add e2e:smoke:prod, the only local reproduction of the prod CSP

npm run e2e:smoke starts no server, so in practice it is only ever
pointed at a dev server somebody already had running — and the dev CSP
grants 'unsafe-inline' on style-src-elem while prod is nonce-only. That
is the structural reason a prod-only defect stayed invisible to the suite
most likely to catch it, not a footnote to it.

This spawns `next start` on a dedicated port, runs the existing smoke
against it, and stops it on every exit path via the port-scoped
stop-dev.mjs. Exit code is the smoke's, unmodified.

Spawns next through node directly rather than npx: npx needs shell:true
on win32, and the shell child is not the process bound to the port, which
would defeat the port-scoped stop.

Refs open-followups.md §54.
EOF
```

---

### Task 5: Confirm the nonce in a REAL browser

**★★★ Why this task exists.** Task 3's unit test cannot distinguish a correct IDL read from an attribute read, because jsdom does not implement nonce hiding. And Task 4's green smoke proves only that the violation is gone — a violation can also disappear for the wrong reason (for example if no editor mounted during the walk at all). This task closes both gaps by measuring the actual values in Chromium.

**Files:** one throwaway script under the scratchpad — NOT committed.

- [ ] **Step 1: Write the probe**

Create `probe-nonce.mjs` in your scratchpad directory (not in the repo):

```js
import { chromium } from "playwright";

const url = process.env.E2E_URL || "http://localhost:3200/";
const browser = await chromium.launch();
const page = await browser.newPage();

const violations = [];
page.on("console", (m) => {
  if (/Content Security Policy/i.test(m.text())) violations.push(m.text().slice(0, 200));
});

// Same seeding the smoke uses, so the app boots into the main UI instead of the
// File System Access save-picker headless Chromium cannot satisfy.
await page.addInitScript(() => {
  localStorage.setItem(
    "aipm-cockpit:projects",
    JSON.stringify({
      projects: [{ id: "e2e-1", name: "E2E Project", code: "E2E-001", storageConfig: { kind: "browser" } }],
      currentProjectId: "e2e-1",
    }),
  );
});

await page.goto(url, { waitUntil: "networkidle" });

const result = await page.evaluate(() => {
  const script = document.querySelector("script[nonce]");
  const style = document.querySelector("style[data-tiptap-style]");
  return {
    scriptSelectorMatched: script !== null,
    scriptAttrValue: script ? script.getAttribute("nonce") : null,
    scriptIdlValue: script ? script.nonce : null,
    styleTagPresent: style !== null,
    styleNonce: style ? style.nonce : null,
  };
});

console.log(JSON.stringify(result, null, 2));
console.log("CSP violations seen:", violations.length, violations);
await browser.close();
```

- [ ] **Step 2: Run it against a production server**

```bash
npm run build > /tmp/build.log 2>&1; echo "BUILD=$?"
npx next start -p 3200 &
sleep 8
node <scratchpad>/probe-nonce.mjs
PORT=3200 npm run stop
```

- [ ] **Step 3: Check the four things that matter**

| Field | Required | Meaning if wrong |
|---|---|---|
| `scriptSelectorMatched` | `true` | The presence selector does not match in a real browser — `readCspNonce` can never work as written. See Step 4. |
| `scriptAttrValue` | `""` | Confirms nonce hiding is real and `getAttribute` would have been the wrong spelling. A non-empty value here means this browser does not hide nonces; the IDL read is still correct, just not load-bearing on it. |
| `scriptIdlValue` | non-empty | The value `readCspNonce()` returns. **This is the assertion the spec requires.** |
| `violations` | `0` | The fix worked. |

`styleTagPresent` will be `false` if no editor mounted on the landing view — that is not a failure of the fix. If it is `true`, `styleNonce` must equal `scriptIdlValue`.

- [ ] **Step 4: If `scriptSelectorMatched` is false**

The `injectNonce` decision still stands; only the delivery changes. Fall back to having `src/app/layout.tsx` — which already reads the `x-nonce` header at `:30-34` — render the nonce somewhere the client can read without a selector, and update `readCspNonce` to read that instead. Record the DOM-exposure trade-off in the §54 rewrite (Task 7). Do not switch to option B or C without checking back.

- [ ] **Step 5: Record the numbers**

Copy the probe's JSON output into your scratch notes. Task 7 pastes it into §54 as the measurement that closes the entry. Delete the probe script — it is not committed.

---

### Task 6: The `prod-smoke` CI job

**Files:**
- Modify: `.gitlab-ci.yml`

- [ ] **Step 1: Add the job**

Insert after the existing `e2e:` job block (which ends with its `artifacts:` stanza, before the `# DAST — OWASP ZAP baseline scan` comment):

```yaml
# Prod-CSP smoke — the gate that would have caught open-followups §54.
#
# ★★ The unit suite CANNOT see this class and neither can `e2e`. The dev CSP
# grants 'unsafe-inline' on style-src-elem while prod is nonce-only
# (src/proxy.ts), and `npm run e2e:smoke` starts no server — so in practice it
# only ever met the permissive dev policy. A prod-only defect that made every
# rich-text editor render unstyled shipped unnoticed for months behind exactly
# that gap.
#
# Takes the .next/ artifact `build` publishes. The `e2e` job's `dependencies: []`
# precaution does not apply here: that exists to avoid reusing glibc-mismatched
# node_modules, and `build` publishes only .next/, which is not node_modules.
prod-smoke:
  stage: e2e
  image: mcr.microsoft.com/playwright:v1.61.1-jammy
  needs: [build]
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
    - if: $CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH
  script:
    - npm ci
    - npx playwright install chromium
    - npm run e2e:smoke:prod
```

**If Task 1 Step 4 decided `allow_failure`,** add `allow_failure: true` immediately after the `needs:` line, plus a comment naming the register entries filed for the other issues and stating that flipping this to blocking is the follow-up.

- [ ] **Step 2: Validate the YAML parses**

```bash
node -e "const fs=require('fs');const s=fs.readFileSync('.gitlab-ci.yml','utf8');if(!/^prod-smoke:$/m.test(s))throw new Error('job heading not found');console.log('ok')"
grep -nE "^[a-z][a-zA-Z0-9_-]*:" .gitlab-ci.yml
```

Expected: `ok`, and `prod-smoke:` appearing in the job list between `e2e:` and `dast-zap:`.

- [ ] **Step 3: Commit**

```bash
git add .gitlab-ci.yml
git commit -F - <<'EOF'
ci: add prod-smoke, so a prod-only CSP regression fails a pipeline

Neither the unit suite nor the e2e job can see this class: the dev CSP
grants 'unsafe-inline' on style-src-elem while prod is nonce-only, and
e2e:smoke starts no server so it only ever met the dev policy. That gap
is why open-followups §54 shipped unnoticed.

Runs in stage e2e on merge requests and the default branch, consuming the
.next/ artifact the build job already publishes.

Refs open-followups.md §54.
EOF
```

---

### Task 7: Documentation

**Files:**
- Modify: `docs/open-followups.md` (§54, currently starting at line 2344)
- Modify: `AGENTS.md` (the Commands block and the CI bullet)

- [ ] **Step 1: Rewrite §54**

§54's "What is established" section attributes the injection to Turbopack shipping a lazily-loaded CSS chunk. That is an inference and it is wrong. **Rewrite the section — do not append a correction below it**, or the false mechanism stays readable as current.

Replace the paragraph beginning *"**It is dependency behaviour, not app code.**"* with:

```markdown
**The injector is `@tiptap/core` itself, measured 2026-08-09.** Not Turbopack, not
prosemirror-view:

```
node_modules/@tiptap/core/src/Editor.ts:255-257
  private injectCSS(): void {
    if (this.options.injectCSS && typeof document !== 'undefined') {
      this.css = createStyleTag(style, this.options.injectNonce)
```

`style` is a JavaScript STRING CONSTANT (`@tiptap/core/src/style.ts`), measured at
**1329 bytes** — a byte-exact match for the `<style>` element hashed in the live prod DOM
above. Reproduce:

```bash
node -e 'const s=require("fs").readFileSync("node_modules/@tiptap/core/src/style.ts","utf8");const m=s.match(/^export const style = `([\s\S]*)`\s*$/);console.log(Buffer.byteLength(m[1],"utf8"));'
```

★★★ **THE ORIGINAL `grep` EVIDENCE POINTED THE OPPOSITE WAY FROM HOW IT WAS READ.** This
entry cited `grep -rn "prosemirror.css" src/` returning nothing as SUPPORT for the
bundler theory. Nothing imports that file because the CSS never travels as CSS at all —
it is a JS string. `prosemirror.css` is a different file (1243 bytes, so not the one
hashed) and `grep -rn "prosemirror.css\|style/prosemirror" node_modules/@tiptap` returns
no matches either. prosemirror-view never injects; it only warns
(`checkCSS`, `dist/index.js`, recommending you load its stylesheet yourself).

★ The entry also said "The editor loads via `next/dynamic`". True of only 2 of its 8 call
sites — `meeting-report-panel.tsx` and `settings-sections/comm-templates-section.tsx`.
The other six import `RichTextEditor` statically, so it SSRs, which is why the nonce
reader must guard `typeof document`.
```

Then replace the "**Fix options — recorded, neither chosen**" section with the decision:

```markdown
### Fix — option A chosen and shipped

`injectNonce`, a first-class `@tiptap/core` option this entry did not know about
(`types.ts:313`, beside `injectCSS: boolean`). `src/app/csp-nonce.ts` reads the
per-request nonce and `rich-text-editor.tsx` passes it to the app's single `useEditor`.
**`src/proxy.ts` is untouched and the CSP is unchanged.**

★★ It covers BOTH Tiptap injection points — `Editor.ts:257` and
`@tiptap/extensions/src/selection/selection.ts:39` both read `editor.options.injectNonce`
— which the previously-recorded option 1 shape would not have.

The two options recorded earlier were rejected: **`injectCSS: false` + owning the CSS**
copies a dependency stylesheet (drift), gates only `Editor.injectCSS()` and not the
selection extension's tag, and would import `border-top: 1px solid black`, an off-palette
literal the palette-sweep scans for. **`'unsafe-inline'` in prod `style-src-elem`** would
widen the single documented residual in `docs/security/threat-model.md:71` from style
attributes to style elements.

★★★ **THE UNIT TEST CANNOT PROVE THIS AND MUST NOT BE READ AS PROVING IT.** `readCspNonce`
reads the `.nonce` IDL property, because a real browser EMPTIES the `nonce` content
attribute on insertion and keeps the value only on the IDL slot. jsdom does not implement
nonce hiding, so `getAttribute("nonce")` would pass every unit test and return `""` in
production. Confirmed in Chromium against a real `next start`:
```

Paste the probe JSON from Task 5 Step 5 here, then add the closing line and change the
heading's `— open, PRE-EXISTING, user-visible` to `— CLOSED <date>`.

If Task 1 found issues beyond the CSP violation, file each as a NEW numbered entry at the
end of the register (next free number — check `grep -nE '^## [0-9]+\.' docs/open-followups.md | tail -3`,
which was §128 at the time of writing) and cross-reference them from §54.

- [ ] **Step 2: Update AGENTS.md — Commands**

Add after the `npm run e2e:smoke` line in the Commands code block:

```
npm run e2e:smoke:prod      # smoke against a REAL production server (build first).
                            # ★★★ THE ONLY LOCAL REPRODUCTION OF THE PROD CSP. `e2e:smoke`
                            # starts no server, so it is only ever pointed at a dev server —
                            # and dev grants 'unsafe-inline' on style-src-elem while prod is
                            # nonce-only (src/proxy.ts). A prod-only defect that rendered
                            # EVERY rich-text editor unstyled shipped unnoticed behind exactly
                            # that gap (open-followups §54). Run it before shipping anything
                            # touching CSP, layout.tsx, or a dependency that injects a <style>.
```

- [ ] **Step 3: Update AGENTS.md — the CI bullet**

In the `**CI is GitLab**` bullet, the stage list currently ends `→ build → e2e`. Extend the
e2e description so the new gate is named — the bullet's own closing line says "New CI gate
→ also update this line". Add to the sentence describing the e2e stage:

```
The e2e stage also carries **prod-smoke** (`npm run e2e:smoke:prod` — `next start` + the
smoke driver), the only gate that sees the PROD CSP; neither the unit suite nor `e2e`
can, which is how open-followups §54 stayed invisible.
```

If Task 6 landed the job `allow_failure: true`, say so here rather than letting it read as
blocking.

- [ ] **Step 4: File the dynamic-import follow-up**

Append a new numbered entry to `docs/open-followups.md`. Take the next free number AFTER any
entries filed from Task 1's baseline issues — check first:

```bash
grep -nE '^## [0-9]+\.' docs/open-followups.md | tail -3
```

At the time of writing the last entry was §128, so this is §129 unless Task 1 filed
something. Use that number in place of `NNN` below.

```markdown
## NNN. Six of the eight `RichTextEditor` call sites import it statically, so Tiptap SSRs and ships in the initial bundle — open, a decision, measured

**Where:** `src/app/rich-text-editor.tsx`'s consumers.

| Import style | Sites |
|---|---|
| STATIC (SSRs) | `change-edit-modal.tsx:44` · `dashboard-sections/dashboard-narrative.tsx:9` · `milestone-edit-modal.tsx:11` · `note-log-panel.tsx:21` · `raid-edit-modal.tsx:50` · `task-form-fields.tsx:15` |
| `dynamic(..., { ssr: false })` | `meeting-report-panel.tsx:18` · `settings-sections/comm-templates-section.tsx:22` |

Raised while fixing §54, and deliberately NOT folded into it.

★★★ **CONVERTING THE SIX WOULD NOT HAVE FIXED §54, AND READING IT AS AN ALTERNATIVE FIX IS
THE TRAP.** `useEditor` is called with `immediatelyRender: false`, which defers Editor
construction — and therefore `injectCSS()` — to mount. So the un-nonced `<style>` is
injected client-side under BOTH import styles and the CSP violation is byte-identical.
`ssr: false` changes where the component renders, not where Tiptap injects.

★★ Nor does it let the `typeof document` guard in `csp-nonce.ts` go away. Even with every
site converted the guard stays: it costs one line, it makes the function total, and a
future static import would silently reintroduce the SSR call. So there is no simplification
on offer either — the two questions are independent.

★ Static + `immediatelyRender: false` is a SUPPORTED Tiptap configuration, not an
oversight. That flag exists precisely so the editor can be SSR'd safely. The two dynamic
sites are a settings panel and a report panel, where lazy-loading a rarely-opened surface
is its own justification — they are not evidence the other six are wrong.

**The real question is bundle weight, and it is UNMEASURED.** `@tiptap/react` +
`@tiptap/starter-kit` + the prosemirror tree is large, and six static imports put it in the
initial bundle. Nobody has measured the delta. **Measure before deciding** — a conversion
argued from "Tiptap is big" rather than from a number is the same class of reasoning that
put the wrong mechanism in §54.

**Costs if it is done.** Mount timing changes in six surfaces that all carry test suites;
each needs a `loading:` fallback or a modal shows a blank flash while the chunk loads; and
each affected test goes from a synchronous `render` to `await waitFor`. That is a real
behavioural surface, which is why it is its own slice rather than a rider.
```

- [ ] **Step 5: Verify the docs gate**

```bash
npm run docs:symbols:check > /tmp/sym.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/sym.log
```

Expected: `EXIT=0`. This gate proves a backticked mixed-case NAME exists in the codebase —
`readCspNonce`, `injectNonce`, `createStyleTag` are the new ones. It proves nothing about
whether the claims around them are true.

- [ ] **Step 6: Commit**

```bash
git add docs/open-followups.md AGENTS.md
git commit -F - <<'EOF'
docs: correct §54's mechanism, record the fix, name the new gate

§54 attributed the injected stylesheet to Turbopack shipping a lazily
loaded CSS chunk. Measured: it is @tiptap/core's own Editor.injectCSS()
over a JS string constant, byte-exact at 1329. The entry's own grep
evidence pointed the opposite way from how it was read — nothing imports
prosemirror.css because the CSS never travels as CSS.

Rewritten rather than appended, so the false mechanism does not stay
readable as current.

Also names prod-smoke in the CI bullet and e2e:smoke:prod in Commands,
including why neither the unit suite nor the e2e job can see this class.

Files the dynamic-import question raised during the fix: six of eight
RichTextEditor call sites import statically. Recorded with the reason it
is NOT an alternative fix for §54 — immediatelyRender: false already
defers Editor construction, so the un-nonced style tag is injected
client-side either way.
EOF
```

---

### Task 8: Release — 0.227.0 "Bolander"

This is a user-visible fix, so it bumps. **Eight places carry the version and only two are
gated** — `package.json` sat six releases stale and `package-lock.json` eleven, because
nothing checks them.

**Codename check already done:** "Bolander" (Brooke Bolander) returns 0 hits in
`CHANGELOG.md`, `src/app/version.ts` and `README.md`. 235 names are taken. Re-verify before
committing, since `origin/main` may have moved:

```bash
for n in Bolander; do echo "$n: CHANGELOG=$(grep -ci "$n" CHANGELOG.md) version=$(grep -ci "$n" src/app/version.ts)"; done
```

Match the NAME, not the dash: older CHANGELOG entries use an em-dash (`## [0.35.0] — … "Muir"`)
and newer ones a hyphen (`## [0.75.0] - … "Nagata"`), so a dash-anchored pattern reports
used names as free.

**Files:** `src/app/version.ts` · `package.json` · `package-lock.json` (2 occurrences) ·
`README.md` · `docs/CODEMAPS/*.md` (5 headers) · `CHANGELOG.md` · `src/app/i18n.ts` ·
`src/app/i18n.de.ts`

- [ ] **Step 1: `src/app/version.ts`**

```ts
export const APP_VERSION = "0.227.0";
export const APP_BUILD_DATE = "2026-08-09"; // 0.227.0: the text editor renders styled in production again (Bolander)
```

Replace the `APP_MILESTONE` docstring's 0.226-specific paragraphs with a 0.227 one, keeping
the `★ Fetch before bumping` paragraph, and set:

```ts
export const APP_MILESTONE = "Bolander";
```

Append to `APP_HIGHLIGHT_KEYS` after `"versionHighlight0226"`:

```ts
  "versionHighlight0227",
```

- [ ] **Step 2: EN string in `src/app/i18n.ts`**

Add after the `versionHighlight0226` entry:

```ts
  versionHighlight0227: "Typing in any rich text box behaves correctly again in the released app. Descriptions, notes, and the other formatted fields were missing part of the editor's styling, so repeated spaces and line breaks collapsed as you typed and the cursor could sit in the wrong place. This only ever affected the released build, never a development one, which is why it went unnoticed for so long.",
```

- [ ] **Step 3: DE string in `src/app/i18n.de.ts` — via a node script, NOT the Edit tool**

The file is CRLF and the Edit tool corrupts umlauts in it (and curls double quotes), so this
must go through a node utf8 write. Two things make the write safe: the anchor matches
`\r\n`, and a **match-count guard** turns a miss into an error instead of a silent no-op.

Do NOT inline the German text into a `node -e` shell string — put it in a script file. A
double-quoted `node -e "…"` treats backticks as command substitution, and the umlauts are
one more thing for the shell to mangle.

Write `scratch-de.mjs` in your scratchpad directory:

```js
import fs from "node:fs";

const p = "src/app/i18n.de.ts";
const s = fs.readFileSync(p, "utf8");

const anchor = /^(  versionHighlight0226: ".*?",\r\n)/m;
const hits = s.match(new RegExp(anchor.source, "gm"));
if (!hits || hits.length !== 1) {
  throw new Error(`expected exactly 1 anchor, found ${hits ? hits.length : 0}`);
}

const de =
  "Das Schreiben in Textfeldern mit Formatierung funktioniert in der veröffentlichten " +
  "App wieder richtig. Beschreibungen, Notizen und die übrigen formatierten Felder hatten " +
  "einen Teil der Editor-Gestaltung verloren, sodass mehrfache Leerzeichen und " +
  "Zeilenumbrüche beim Tippen zusammenfielen und der Cursor an der falschen Stelle stehen " +
  "konnte. Betroffen war ausschließlich die veröffentlichte Fassung, nie eine " +
  "Entwicklungsfassung - deshalb blieb es so lange unbemerkt.";

const out = s.replace(anchor, `$1  versionHighlight0227: "${de}",\r\n`);
if (out === s) throw new Error("replacement was a no-op");

fs.writeFileSync(p, out, "utf8");
console.log("inserted versionHighlight0227");
```

Run it:

```bash
node <scratchpad>/scratch-de.mjs
```

Expected: `inserted versionHighlight0227`. Any throw means the anchor drifted — read the
file and fix the anchor rather than loosening the guard.

★ The German text uses a plain hyphen, not an em-dash, matching the surrounding entries.
★ `de` is built by concatenation so no line runs long; it contains no `$` or backtick, which
would be special in the template literal's replacement position.

Then verify the umlauts survived the round-trip:

```bash
node -e 'const s=require("fs").readFileSync("src/app/i18n.de.ts","utf8");const m=s.match(/versionHighlight0227: "([^"]*)"/);console.log(m[1].slice(0,80));console.log("has umlauts:", /[äöüßÄÖÜ]/.test(m[1]));'
```

Expected: `has umlauts: true`. The `i18n-encoding` test bans ASCII substitutions like
`veroeffentlicht`.

- [ ] **Step 4: The five ungated places**

```bash
# package.json + package-lock.json (TWO occurrences: root "version" and packages[""])
node -e '
const fs=require("fs");
for (const f of ["package.json","package-lock.json"]) {
  let s=fs.readFileSync(f,"utf8");
  const before=(s.match(/"version": "0\.226\.0"/g)||[]).length;
  s=s.replace(/"version": "0\.226\.0"/g, "\"version\": \"0.227.0\"");
  fs.writeFileSync(f,s,"utf8");
  console.log(f, "replaced", before);
}'
```

Expected: `package.json replaced 1`, `package-lock.json replaced 2`. Any other count means
the file drifted — stop and look.

README badge (version AND codename):

```
[![version](https://img.shields.io/badge/version-v0.227.0_%22Bolander%22-2e7d32)](./CHANGELOG.md)
```

The five codemap headers — each line 1 of `docs/CODEMAPS/*.md` reads
`<!-- Generated: 2026-07-30 | App 0.226.0 "Emshwiller" | … -->`; change only the
`App <version> "<codename>"` portion, leaving the generated date and scan counts alone.

- [ ] **Step 5: `CHANGELOG.md`**

Add at the top of the entries:

```markdown
## [0.227.0] - 2026-08-09 "Bolander"

### Fixed

- **Rich-text editors render styled in a production build again.** The prod
  Content-Security-Policy refused the stylesheet `@tiptap/core` injects at runtime, so on
  every formatted field — task description, note log, RAID description and mitigation,
  change description, impact description and resolution notes, milestone description —
  `white-space` computed `normal` instead of `break-spaces` and `position` computed
  `static` instead of `relative`. Consecutive spaces and newlines collapsed while typing,
  and the cursor lost its containing block. Only the released build was affected; a
  development build never was, because its CSP is the permissive branch — which is why
  this went unnoticed. The editor now receives the per-request nonce through Tiptap's own
  `injectNonce` option; the policy itself is unchanged.

### Added

- **`npm run e2e:smoke:prod`** and a matching **`prod-smoke` CI job** — the smoke run
  against a real production server. The existing smoke starts no server of its own, so it
  was only ever pointed at a development one, and a prod-only defect of this size was
  structurally invisible to the suite most likely to catch it.
```

- [ ] **Step 6: Verify every version-bearing place agrees**

```bash
grep -rn "0\.226\.0" package.json package-lock.json README.md docs/CODEMAPS/*.md src/app/version.ts; echo "STALE_HITS_EXIT=$?"
```

Expected: no output and `STALE_HITS_EXIT=1` (grep found nothing). Any hit is a missed place.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -F - <<'EOF'
release: 0.227.0 "Bolander"

Fixes the prod-only CSP block that left every rich-text editor unstyled
in a released build, and adds the prod-smoke gate that would have caught
it.

Bumps all eight version-bearing places; only version.ts and CHANGELOG.md
are conventionally remembered and neither of the others is gated.
EOF
```

---

### Task 9: Full gate run before handing back

**Files:** none.

- [ ] **Step 1: Run every gate, serially, unpiped**

Run these one at a time — two vitest processes at once is the machine-saturation condition
behind this repo's load-sensitive flakes.

```bash
npx tsc --noEmit; echo "TSC=$?"
npx eslint --max-warnings=0 src/app; echo "LINT=$?"
npm run test:run > /tmp/suite.log 2>&1; echo "SUITE=$?"; grep -E "Test Files|Tests " /tmp/suite.log
npm run test:coverage > /tmp/cov.log 2>&1; echo "COV=$?"; grep -E "ERROR|threshold" /tmp/cov.log | head
npm run test:shuffle > /tmp/shuf.log 2>&1; echo "SHUF=$?"; grep -E "Test Files|Tests " /tmp/shuf.log
npm run size:check; echo "SIZE=$?"
npm run dup:check > /tmp/dup.log 2>&1; echo "DUP=$?"
npm run docs:symbols:check; echo "SYMBOLS=$?"
node scripts/sync-script-docs.mjs --check; echo "DOCSCRIPTS=$?"
npm run build > /tmp/build.log 2>&1; echo "BUILD=$?"
```

Expected: every variable `0`. `test:shuffle` is the only local reproduction of the blocking
`unit-tests-shuffled` job and matters here because Task 3 adds tests to an existing file —
intra-file order dependence is exactly what it catches.

- [ ] **Step 2: Re-run the prod smoke on the final tree**

```bash
npm run e2e:smoke:prod > /tmp/smoke-final.log 2>&1; echo "SMOKE=$?"
grep -n "=== ISSUES" -A 20 /tmp/smoke-final.log
```

Expected: matches Task 4 Step 4 — the `style-src-elem` violation absent.

- [ ] **Step 3: Skip the axe gate, and say so**

`npm run e2e` / the axe a11y gate is NOT required for this slice: no view, no control and no
styling token changed, so it can observe nothing. State that explicitly in the handback
rather than letting it read as a skipped step.

- [ ] **Step 4: Report and stop**

Report the gate results, the Task 1 baseline issue list, the Task 5 probe JSON, and whether
`prod-smoke` landed blocking or `allow_failure`.

**Do not push, do not open a merge request, do not merge.** Those happen only on an explicit
instruction from the user.

---

## Out of scope

- **The `HTML_START` classifier split** (§107 / §114 / §118). Its own spec. One finding
  worth carrying into it: §107 describes `HTML_START` as having two consumers; measured, it
  serves five sink groups (`sanitizeNoteHtml` via `narrativeToHtml`; `sanitizeNoteHtml`
  again via `note-log.ts:157`, which §107 never mentions; `sanitizeTemplateHtml`;
  `sanitizeDocumentHtml`; and the two `rich-text-projection.ts` projections, which have no
  sink to derive from at all, feeding 16 consumer files). `sanitizeRichText` is itself
  multi-sink, so parameterising `descriptionHtml` alone does not reach it.
- **Any other prod-only console issue** the Task 1 baseline surfaces. File it as a numbered
  register entry; do not fix it here.
- **Whether some other lazily-loaded dependency injects an un-nonced `<style>`** on a route
  the smoke does not reach. §54 lists this as not established and it stays that way; the
  `prod-smoke` job narrows it over time rather than settling it now.
