# Electron Desktop Bundling Implementation Plan

> **Status (2026-09-13 audit):** PARTIAL — a manual "check for updates" link shipped; true auto-update (silent background download/install via electron-updater) is out of scope, and Spike 1 (UNC vs HTTPS update feed) stays open in the paired design's Open Questions; both are tracked in §480. Kept as a historical record; do not execute as written.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce an installable Windows desktop app that a non-technical colleague can double-click to run — no terminal, no Node install, no `npm` on their laptop.

**Architecture:** Electron main process spawns the Next **standalone** server on Electron's own Node (`ELECTRON_RUN_AS_NODE=1`), waits for it to answer on the fixed origin `http://127.0.0.1:17300`, then loads that URL in a window. Pure launch logic (readiness polling, port-owner classification, log paths) lives in Electron-free modules so it is unit-testable under the existing vitest.

**Tech Stack:** Electron, electron-builder (NSIS), Next 16 `output: "standalone"`, vitest (existing), Playwright `_electron` (existing Playwright install).

**Source spec:** `docs/superpowers/specs/2026-09-10-electron-app-bundling-design.md` (commit `8c140928`).

**Scope:** spec Sections 1–6 and 8. **Section 7 (auto-update) is deliberately NOT in this plan** — spike 1 below decides its shape, and it gets its own plan afterwards. Do not add updater wiring here.

---

## Ground rules for every task

Read these once. They are repo constraints, and violating them produces green-looking failures.

- **Never read a gate's exit code through a pipe.** `npm run x | tail -5` reports `tail`'s status. Redirect, echo `$?` unpiped, then read the file.
- **Never run two vitest processes at once.** `Failed to start forks worker` is contention, not a result.
- When a vitest run is supposed to cover N files, **assert `Test Files N`** against your own list length. A missing path mixed with a real one is dropped silently at exit 0.
- **Line endings:** `src/app/**.ts(x)` and `src/test/**.ts` are CRLF — use the Edit tool, never `sed -i`. `docs/**` is LF. **New `desktop/**` files are LF**, pinned by a `.gitattributes` entry in Task 3 so the choice cannot drift.
- **Never** `git add -A` or `git add .`. Stage explicit paths. **Never** stage `sample-workspace-huge.json` or `not-in-use.env.local.bak`.
- `git checkout -- <file>` and `git restore` are deny-blocked. `git stash` must never be run in this worktree. Never `--amend`.
- Every commit ends with the trailer:
  `Claude-Session: https://[session link removed]`
- **No version bump, no CHANGELOG entry, no push, no MR.** Those are separate explicit instructions from the user.

### The four origin rules (spec Section 4) — do not "improve" these

1. **Port is `17300`, fixed.** Not configurable, not user-settable, not read from env at runtime.
2. **Host is `127.0.0.1`, never `localhost`.** They are different origins.
3. **Bind loopback only.** A `0.0.0.0` bind publishes the user's workspace to the corporate LAN.
4. **Single-instance lock**, and if the port is busy with something that is not our server, **fail loudly**. Never rebind to a free port.

Rules 1 and 2 are half the browser origin. Changing either silently swaps every user's IndexedDB store — their workspace, their sealed secrets, their file handles. This is why they are hard-coded in one module and asserted by a test.

---

## File structure

**New — `desktop/` subtree (all LF):**

| File | Responsibility |
|---|---|
| `desktop/package.json` | Electron app manifest. Carries the version — a **new `version:sync` satellite**. |
| `desktop/tsconfig.json` | Compiles `desktop/src/**` to CommonJS in `desktop/dist/`. |
| `desktop/src/lib/constants.ts` | `APP_HOST`, `APP_PORT`, `APP_ORIGIN`. The single place the origin exists. |
| `desktop/src/lib/port-owner.ts` | Pure: classify a probe result as `ours` / `foreign` / `free`. |
| `desktop/src/lib/readiness.ts` | Pure: poll a probe until ready or hard timeout. |
| `desktop/src/lib/log-paths.ts` | Pure: resolve the log directory from the environment. |
| `desktop/src/lib/*.test.ts` | Unit tests for the three pure modules. |
| `desktop/src/server-child.ts` | Spawn / kill the Next standalone server. Electron-aware. |
| `desktop/src/main.ts` | Electron main: single-instance lock, window, splash, lifecycle. |
| `desktop/splash.html` | Local splash shown while the server boots. |
| `desktop/scripts/copy-static.mjs` | Copies `.next/static` + `public/` into the standalone tree. |
| `desktop/electron-builder.yml` | NSIS target, `perMachine: false`. |

**New — elsewhere:**

| File | Responsibility |
|---|---|
| `e2e/desktop-smoke.spec.ts` | Playwright `_electron` smoke against the built app. |
| `docs/superpowers/specs/_probes/2026-09-10-electron-updater-unc.md` | Spike 1 finding. |
| `docs/superpowers/specs/_probes/2026-09-10-smartscreen-update.md` | Spike 2 finding. |

**Modified:**

| File | Change |
|---|---|
| `.gitattributes` | `desktop/** text eol=lf` |
| `next.config.ts` | Env-gated `output: "standalone"` |
| `vitest.config.ts` | `include` reaches `desktop/**`; coverage `include` unchanged |
| `eslint.config.mjs` | A config block for `desktop/**` (Node/Electron context) |
| `scripts/version-sync-lib.mjs` | New satellite descriptor |
| `scripts/version-sync-lib.test.mjs` | Test for that descriptor |
| `package.json` | `desktop:*` scripts |
| `.gitlab-ci.yml` | Manual `desktop-package` job |

---

## Task 1: Spike — does `electron-updater`'s generic provider work against a UNC share?

**This task produces a written finding and nothing else.** It gates the *second* plan (auto-update), not this one. Do not add any updater code to `desktop/`.

**Files:**
- Create: `docs/superpowers/specs/_probes/2026-09-10-electron-updater-unc.md`

**What is being measured:** whether `electron-updater`'s `generic` provider can read a `latest.yml` manifest from a UNC path (`\\server\share\...`) or a `file://` URL, or whether it requires HTTP(S).

**Why it matters:** the spec's chosen update model is "self-updates from a share". If the generic provider is HTTP-first only, the update feed must move to an internal HTTPS location (GitLab's generic package registry is the named candidate, and it supports a custom auth header). That changes the *shape* of Section 7, not merely its detail — which is why the auto-update plan is not written yet.

- [ ] **Step 1: Read the provider's own source for the supported URL schemes**

```bash
npm view electron-updater version > /tmp/eu-version.txt 2>&1; echo "EXIT=$?"
cat /tmp/eu-version.txt
```

Then fetch the package without adding it to the project, and read how `generic` builds its request:

```bash
mkdir -p .probe-eu && cd .probe-eu && npm pack electron-updater --silent > tarball.txt 2>&1; echo "EXIT=$?"
tar -xzf "$(cat tarball.txt)" && grep -rn "protocol\|http\|file:" package/out/providerFactory.js | head -30
```

- [ ] **Step 2: Record what the code shows**

Write the finding file with this exact structure, filling the Result and Conclusion from what you actually read — quote the lines you relied on:

```markdown
# Spike: electron-updater generic provider against a UNC / file:// share

**Date:** 2026-09-10
**Question:** Can the `generic` provider read `latest.yml` from a UNC path or `file://` URL, or is HTTP(S) required?
**Method:** read the published `electron-updater` package's provider factory and its URL handling (version recorded below). No app code was added.

## Version measured

electron-updater <version from Step 1>

## Result

<what the code does with a non-http URL — quote the lines>

## Conclusion

<one of:>
- UNC/file:// IS supported → the share model in spec Section 7 stands as designed.
- UNC/file:// is NOT supported → the update feed must be HTTPS. Candidate: GitLab generic package registry (supports a custom auth header). Spec Section 7 needs reshaping before its plan is written.

## What this does NOT establish

This is a code read, not an end-to-end test against a real share. A positive result still needs one live run before the update path is committed to.
```

- [ ] **Step 3: Clean up the probe directory**

```bash
cd .. && rm -rf .probe-eu 2>/dev/null || powershell -NoProfile -Command "Remove-Item -Recurse -Force .probe-eu"
git status --porcelain
```

Expected: `.probe-eu` gone; only the new `_probes` file listed as untracked.

- [ ] **Step 4: Commit**

```bash
git add docs/superpowers/specs/_probes/2026-09-10-electron-updater-unc.md
git commit --only docs/superpowers/specs/_probes/2026-09-10-electron-updater-unc.md -F - <<'EOF'
docs(spike): whether electron-updater reads a UNC/file:// update feed

Records a code-level finding only. Gates the auto-update plan (spec
Section 7), not the packaging work.

Claude-Session: https://[session link removed]
EOF
echo "EXIT=$?"
```

---

## Task 2: Spike — does SmartScreen prompt on updater-installed packages?

**Written finding only.** No code.

**Files:**
- Create: `docs/superpowers/specs/_probes/2026-09-10-smartscreen-update.md`

**What is being measured:** whether an unsigned NSIS package **downloaded by the app itself** triggers a SmartScreen prompt, as one downloaded by a browser does.

**Why it matters:** the app ships unsigned (spec Section 7). A browser-downloaded file carries Mark-of-the-Web (MOTW) and prompts. If the updater's download also carries MOTW, then **every update** needs a click from a non-technical user — which materially changes how good the product feels and strengthens the case for the self-signed hedge.

- [ ] **Step 1: Establish the mechanism from Microsoft's own documentation**

MOTW is an NTFS alternate data stream (`Zone.Identifier`) applied by the downloading application via the `IAttachmentExecute` / `IZoneIdentifier` APIs — it is **not** automatic for every file written to disk. The question is therefore whether Electron's `net`/`autoUpdater` download path applies it.

```bash
npm view electron-updater version > /tmp/eu2.txt 2>&1; echo "EXIT=$?"; cat /tmp/eu2.txt
```

- [ ] **Step 2: Write the finding**

```markdown
# Spike: SmartScreen on updater-installed packages

**Date:** 2026-09-10
**Question:** Does an unsigned NSIS package downloaded by electron-updater trigger SmartScreen, as a browser-downloaded one does?
**Status:** NOT resolved by desk research — requires a clean Windows machine.

## Mechanism

Mark-of-the-Web is an NTFS `Zone.Identifier` alternate data stream applied by the *downloading application*. It is not applied automatically to every written file. So the answer depends on whether the updater's download path sets it.

## What must be measured, and how

On a clean Windows box (not a developer machine — SmartScreen reputation and
developer-mode settings both distort the result):

1. Install version A from the share by double-clicking (expect: SmartScreen prompt — this is the control, and without it the test is vacuous).
2. Publish version B; let the app update itself.
3. Before the install runs, inspect the downloaded file for the stream:
   `Get-Item <downloaded>.exe -Stream Zone.Identifier`
   Stream present → MOTW applied → expect a prompt.
   `ObjectNotFound` → no MOTW → no prompt.
4. Observe whether a prompt actually appears.

## Why step 1 is not optional

If the control does not prompt, the machine is not representative (SmartScreen
disabled by policy, or the publisher already has reputation) and a "no prompt on
update" result means nothing.

## Consequence of each outcome

- **Prompts:** every update costs a click from a non-technical user. Adopt the self-signed certificate hedge (restores the updater's publisher-match check and removes this prompt for updates), and put the prompt in the rollout instructions.
- **Does not prompt:** only the first install prompts. Unsigned + a firmly-ACL'd share is acceptable as designed.
```

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/specs/_probes/2026-09-10-smartscreen-update.md
git commit --only docs/superpowers/specs/_probes/2026-09-10-smartscreen-update.md -F - <<'EOF'
docs(spike): SmartScreen on updater-installed packages

Records the mechanism (Mark-of-the-Web is applied by the downloading
application, not automatically) and the measurement procedure, including
the control step without which a "no prompt" result is vacuous. Not
resolved by desk research; needs a clean Windows box.

Claude-Session: https://[session link removed]
EOF
echo "EXIT=$?"
```

---

## Task 3: `desktop/` skeleton, LF pinning, and the version satellite

**Files:**
- Modify: `.gitattributes`
- Create: `desktop/package.json`
- Create: `desktop/tsconfig.json`
- Modify: `scripts/version-sync-lib.mjs`
- Test: `scripts/version-sync-lib.test.mjs`

⚠️ `desktop/package.json`'s version is **never hand-edited**. It becomes a satellite of `src/app/version.ts` and is written by `npm run version:sync`. The `version-sync-check` CI job is **blocking**: exit 1 means drift, exit **2** means the gate could not scan at all — and a gate that scans nothing passes everything, so 2 demands the opposite response to 1.

- [ ] **Step 1: Pin `desktop/**` to LF**

Add to `.gitattributes` (this file is LF):

```
desktop/** text eol=lf
```

- [ ] **Step 2: Create `desktop/package.json`**

The `"name"` then `"version"` key order with two-space indent is **load-bearing** — the satellite regex in Step 4 matches that exact shape.

```json
{
  "name": "aipm-cockpit-desktop",
  "version": "0.301.0",
  "private": true,
  "description": "Desktop shell for aipm-cockpit",
  "main": "dist/main.js",
  "scripts": {
    "build": "tsc -p tsconfig.json"
  }
}
```

- [ ] **Step 3: Create `desktop/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "CommonJS",
    "moduleResolution": "node",
    "outDir": "dist",
    "rootDir": "src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["src/**/*.ts"],
  "exclude": ["src/**/*.test.ts"]
}
```

- [ ] **Step 4: Write the failing satellite test**

Add to `scripts/version-sync-lib.test.mjs` (this file is LF; match the existing test style in it):

```js
test("desktop/package.json is a registered version satellite", () => {
  const s = SATELLITES.find((x) => x.file === "desktop/package.json");
  assert.ok(s, "desktop/package.json must be a satellite or its version silently drifts");
  assert.equal(s.patterns.length, 1);
  assert.equal(s.patterns[0].kind, "version");
});

test("the desktop satellite pattern matches the file's real shape", () => {
  const text = readFileSync("desktop/package.json", "utf8");
  const s = SATELLITES.find((x) => x.file === "desktop/package.json");
  const m = text.match(s.patterns[0].re);
  assert.ok(m, "pattern did not match desktop/package.json — the file's key order or indent moved");
  assert.match(m[2], /^\d+\.\d+\.\d+$/);
});
```

If `readFileSync` is not already imported in that file, add `import { readFileSync } from "node:fs";` at the top.

- [ ] **Step 5: Run the test to verify it fails**

```bash
npx vitest run scripts/version-sync-lib.test.mjs > /tmp/vs1.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests |FAIL" /tmp/vs1.log
```

Expected: FAIL — `desktop/package.json must be a satellite...`. `Test Files 1 failed (1)`.

- [ ] **Step 6: Register the satellite**

In `scripts/version-sync-lib.mjs`, add this entry to the `SATELLITES` array, immediately after the `package.json` entry:

```js
  {
    file: "desktop/package.json",
    label: "desktop/package.json version",
    patterns: [
      { key: "version", kind: "version", re: /("name": "[^"]+",\r?\n  "version": ")([^"]+)(")/ },
    ],
  },
```

- [ ] **Step 7: Run the test to verify it passes**

```bash
npx vitest run scripts/version-sync-lib.test.mjs > /tmp/vs2.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " /tmp/vs2.log
```

Expected: EXIT=0, all tests pass.

- [ ] **Step 8: Verify the real gate agrees, and that it is not vacuous**

```bash
npm run version:check > /tmp/vc.log 2>&1; echo "EXIT=$?"
cat /tmp/vc.log
```

Expected: EXIT=0 and the output names `desktop/package.json` among the satellites checked. **If the output does not mention it, the gate is not reading it** — do not proceed on a bare exit 0.

Now prove the gate can actually fail on this file (a check that cannot fail is not a check):

```bash
node -e "const fs=require('fs');const p='desktop/package.json';const s=fs.readFileSync(p,'utf8');fs.writeFileSync(p,s.replace('\"version\": \"0.301.0\"','\"version\": \"0.0.1\"'),'utf8')"
npm run version:check > /tmp/vc-drift.log 2>&1; echo "DRIFT_EXIT=$?"
grep -i "desktop" /tmp/vc-drift.log
npm run version:sync > /tmp/vc-fix.log 2>&1; echo "SYNC_EXIT=$?"
npm run version:check > /tmp/vc-ok.log 2>&1; echo "OK_EXIT=$?"
git diff --stat -- desktop/package.json
```

Expected: `DRIFT_EXIT=1` with `desktop/package.json` named, `SYNC_EXIT=0`, `OK_EXIT=0`, and an **empty** `git diff --stat` (sync restored the original bytes).

- [ ] **Step 9: Commit**

```bash
git add .gitattributes desktop/package.json desktop/tsconfig.json scripts/version-sync-lib.mjs scripts/version-sync-lib.test.mjs
git commit --only .gitattributes desktop/package.json desktop/tsconfig.json scripts/version-sync-lib.mjs scripts/version-sync-lib.test.mjs -F - <<'EOF'
feat(desktop): add the desktop skeleton and register its version satellite

desktop/package.json carries the version, so it is a version:sync satellite
rather than a hand-edited file. Proved the gate is not vacuous by driving it
red with a deliberate drift and green again through version:sync, ending on
an empty diff.

desktop/** is pinned to LF in .gitattributes so the new subtree does not
inherit the CRLF working-tree convention that governs src/**.

Claude-Session: https://[session link removed]
EOF
echo "EXIT=$?"
```

---

## Task 4: Env-gated `output: "standalone"`

**Files:**
- Modify: `next.config.ts`

⚠️ **Env-gated, never default-on.** CI's `build` job produces the `.next/` artifact that `prod-smoke` then runs `next start` against. Changing the default build shape for every job is a pipeline-wide change nobody asked for.

- [ ] **Step 1: Add the gated option**

In `next.config.ts`, change the `nextConfig` declaration to:

```ts
const nextConfig: NextConfig = {
  // Suppress the `X-Powered-By: Next.js` response header — it discloses the
  // tech stack for no functional benefit (ZAP baseline alert 10037).
  poweredByHeader: false,
  // ★★ ENV-GATED, deliberately. The desktop build needs `standalone` (a
  // traced, self-contained server under .next/standalone), but CI's `build`
  // job feeds `.next/` to prod-smoke's `next start`. Making this the default
  // would change the artifact shape for every job in the pipeline to serve
  // one manual job. Set NEXT_STANDALONE=1 only for desktop packaging.
  ...(process.env.NEXT_STANDALONE === "1" ? { output: "standalone" as const } : {}),
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};
```

- [ ] **Step 2: Verify the default build is unchanged**

```bash
npx tsc --noEmit > /tmp/tsc1.log 2>&1; echo "EXIT=$?"
grep -c "error TS" /tmp/tsc1.log
```

Expected: EXIT=0, `0` errors. (Read the `src` error count, not the exit code alone — `tsc`'s exit code is not a stable signal in this repo.)

- [ ] **Step 3: Verify the gated build emits standalone**

```bash
NEXT_STANDALONE=1 npm run build > /tmp/build-sa.log 2>&1; echo "EXIT=$?"
ls -d .next/standalone && ls .next/standalone/server.js
```

Expected: EXIT=0, `.next/standalone/server.js` exists.

- [ ] **Step 4: Confirm the footgun is real, so Task 5 has a reason to exist**

```bash
ls .next/standalone/.next/static 2>&1 | head -2
ls .next/standalone/public 2>&1 | head -2
```

Expected: **both missing.** This is the documented Next behaviour that Task 5 fixes. If they are present, Next's behaviour changed — stop and re-read Task 5's premise before writing it.

- [ ] **Step 5: Commit**

```bash
git add next.config.ts
git commit --only next.config.ts -F - <<'EOF'
feat(build): env-gated standalone output for desktop packaging

NEXT_STANDALONE=1 switches next build to `output: "standalone"`. Gated so
CI's build artifact and prod-smoke's `next start` are untouched.

Verified that the gated build emits .next/standalone/server.js and that it
does NOT copy .next/static or public/ — the runtime failure the packaging
step has to prevent.

Claude-Session: https://[session link removed]
EOF
echo "EXIT=$?"
```

---

## Task 5: The static-asset copy step

**Files:**
- Create: `desktop/scripts/copy-static.mjs`
- Modify: `package.json` (add `desktop:copy-static`)

⚠️ This is the single highest-value step in the plan. Without it the app **boots, serves, and renders completely unstyled** — a runtime failure that no build step reports.

- [ ] **Step 1: Write the copy script**

Create `desktop/scripts/copy-static.mjs` (LF):

```js
// Copy the two directories `next build --output standalone` does NOT copy.
//
// ★★★ Omitting this produces an app that starts, serves HTML and renders with
// NO CSS and NO images. It fails at RUNTIME and nothing at build time reports
// it, which is why this script asserts its own result rather than trusting the
// copy, and why the packaged smoke test asserts a computed style.
import { cpSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const STANDALONE = join(ROOT, ".next", "standalone");

if (!existsSync(STANDALONE)) {
  console.error("No .next/standalone — run: NEXT_STANDALONE=1 npm run build");
  process.exit(1);
}

const copies = [
  { from: join(ROOT, ".next", "static"), to: join(STANDALONE, ".next", "static") },
  { from: join(ROOT, "public"), to: join(STANDALONE, "public") },
];

for (const { from, to } of copies) {
  if (!existsSync(from)) {
    console.error(`Source missing: ${from}`);
    process.exit(1);
  }
  cpSync(from, to, { recursive: true });
}

// Assert the result. A silent no-op copy is the failure mode this guards.
for (const { to } of copies) {
  if (!existsSync(to) || readdirSync(to).length === 0) {
    console.error(`Copy produced nothing at ${to}`);
    process.exit(1);
  }
}

// The CSS bundle is the specific artifact whose absence renders the app
// unstyled, so name it rather than trusting a non-empty directory.
const cssDir = join(STANDALONE, ".next", "static", "css");
if (!existsSync(cssDir) || readdirSync(cssDir).filter((f) => f.endsWith(".css")).length === 0) {
  console.error(`No CSS bundle under ${cssDir} — the packaged app would render unstyled.`);
  process.exit(1);
}

console.log("Copied .next/static and public/ into .next/standalone, and verified a CSS bundle is present.");
```

- [ ] **Step 2: Add the script entry**

In `package.json` `scripts`, add:

```json
    "desktop:copy-static": "node desktop/scripts/copy-static.mjs",
```

⚠️ Adding a script means `scriptsDescriptions` must also gain an entry or the `prebuild` docs-sync check fails. Add a matching description there in the same edit, then run `npm run docs:scripts` to regenerate `CONTRIBUTING.md` and `README.md`.

- [ ] **Step 3: Run it and verify it succeeds against the Task 4 build**

```bash
npm run desktop:copy-static > /tmp/cp.log 2>&1; echo "EXIT=$?"
cat /tmp/cp.log
ls .next/standalone/.next/static/css/*.css | head -2
```

Expected: EXIT=0, the success line, and at least one `.css` file listed.

- [ ] **Step 4: Prove the guard fires (a check that cannot fail is not a check)**

⚠️ Deleting the *destination* proves nothing — the script simply re-copies it and passes. The guard has to be tested against a missing **source**, so hide that instead:

```bash
powershell -NoProfile -Command "Rename-Item .next/static/css css-hidden"
npm run desktop:copy-static > /tmp/cp3.log 2>&1; echo "GUARD_EXIT=$?"
grep "render unstyled" /tmp/cp3.log
powershell -NoProfile -Command "Rename-Item .next/static/css-hidden css"
npm run desktop:copy-static > /tmp/cp4.log 2>&1; echo "RESTORE_EXIT=$?"
```

Expected: `GUARD_EXIT=1` with the "render unstyled" message, then `RESTORE_EXIT=0`.

- [ ] **Step 5: Commit**

```bash
git add desktop/scripts/copy-static.mjs package.json CONTRIBUTING.md README.md
git commit --only desktop/scripts/copy-static.mjs package.json CONTRIBUTING.md README.md -F - <<'EOF'
feat(desktop): copy static assets into the standalone tree, and assert it

next build --output standalone does not copy .next/static or public/.
Omitting them yields an app that boots and renders completely unstyled --
a runtime failure no build step reports.

The script asserts its own result and names the CSS bundle specifically,
rather than trusting a non-empty directory. Proved the guard fires by
hiding the CSS source and observing exit 1.

Claude-Session: https://[session link removed]
EOF
echo "EXIT=$?"
```

---

## Task 6: Extend vitest to reach `desktop/**`

**Files:**
- Modify: `vitest.config.ts`

- [ ] **Step 1: Extend `include`**

Change the `include` array to:

```ts
    include: [
      "src/**/*.{test,spec}.{ts,tsx}",
      "scripts/**/*.{test,spec}.mjs",
      "scripts/**/*.{test,spec}.ts",
      // ★ desktop/ holds the Electron shell's PURE launch logic (readiness
      // polling, port-owner classification, log paths). Coverage `include`
      // below deliberately stays src/** ONLY, so these tests raise NO floor —
      // they are opt-in quality, not gate-enforced. Do not read the coverage
      // gate as covering this directory.
      "desktop/**/*.{test,spec}.ts",
    ],
```

- [ ] **Step 2: Confirm coverage `include` is untouched**

```bash
grep -n 'include: \["src/\*\*' vitest.config.ts
```

Expected: the coverage `include` line still reads `["src/**/*.{ts,tsx}"]`. **No floor moves.**

- [ ] **Step 3: Confirm the suite still runs and the file count did not drop**

```bash
npx vitest run --reporter=dot > /tmp/vt-all.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " /tmp/vt-all.log
```

Expected: EXIT=0. Record the `Test Files` count — later tasks add to it, and a *drop* means a path stopped matching.

- [ ] **Step 4: Commit**

```bash
git add vitest.config.ts
git commit --only vitest.config.ts -F - <<'EOF'
test(desktop): let vitest reach desktop/** unit tests

Coverage include stays src/** only, so desktop/ raises no floor. Stated in
the config comment so a reader does not assume the coverage gate covers it.

Claude-Session: https://[session link removed]
EOF
echo "EXIT=$?"
```

---

## Task 7: `constants.ts` and the origin test

**Files:**
- Create: `desktop/src/lib/constants.ts`
- Test: `desktop/src/lib/constants.test.ts`

- [ ] **Step 1: Write the failing test**

Create `desktop/src/lib/constants.test.ts` (LF):

```ts
// @vitest-environment node
import { describe, expect, it } from "vitest";
import { APP_HOST, APP_ORIGIN, APP_PORT } from "./constants";

describe("desktop origin", () => {
  // ★★★ These two values are HALF THE BROWSER ORIGIN. IndexedDB is scoped to
  // scheme+host+port, so changing either silently swaps every user's data
  // store — workspace, sealed secrets and file handles all become invisible
  // at once, presenting as "the app wiped my data". This test exists to make
  // that change loud. Do not "update it to match" a new value without
  // deciding, deliberately, to strand every existing install.
  it("pins the port to 17300", () => {
    expect(APP_PORT).toBe(17300);
  });

  it("pins the host to 127.0.0.1, NOT localhost", () => {
    // `localhost` and `127.0.0.1` are DIFFERENT origins. This is not a style
    // preference.
    expect(APP_HOST).toBe("127.0.0.1");
  });

  it("composes an origin from exactly those two values", () => {
    expect(APP_ORIGIN).toBe("http://127.0.0.1:17300");
  });

  it("avoids every port the repo's own tooling owns", () => {
    // 3000 dev server, 3100 isolated axe runs, 3200 e2e:smoke:prod.
    expect([3000, 3100, 3200]).not.toContain(APP_PORT);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run desktop/src/lib/constants.test.ts > /tmp/c1.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests |Cannot find" /tmp/c1.log
```

Expected: FAIL — cannot resolve `./constants`.

- [ ] **Step 3: Write the module**

Create `desktop/src/lib/constants.ts` (LF):

```ts
// The desktop app's origin. Both values are FIXED and deliberately not
// configurable: they compose the browser origin, and IndexedDB is scoped to
// scheme+host+port. A configurable port would let a user (or a future
// "helpful" fallback) silently swap their own data store.
//
// 17300 avoids 3000 (dev server), 3100 (isolated axe runs) and 3200
// (e2e:smoke:prod), and sits below the Windows ephemeral range (49152+) so
// the OS will not hand it to an unrelated process as a temporary port.
export const APP_HOST = "127.0.0.1";
export const APP_PORT = 17300;
export const APP_ORIGIN = `http://${APP_HOST}:${APP_PORT}`;
```

- [ ] **Step 4: Run it to verify it passes**

```bash
npx vitest run desktop/src/lib/constants.test.ts > /tmp/c2.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " /tmp/c2.log
```

Expected: EXIT=0, `Test Files 1 passed (1)`, `Tests 4 passed (4)`.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/lib/constants.ts desktop/src/lib/constants.test.ts
git commit --only desktop/src/lib/constants.ts desktop/src/lib/constants.test.ts -F - <<'EOF'
feat(desktop): pin the app origin to 127.0.0.1:17300

Both values compose the browser origin, and IndexedDB is scoped to
scheme+host+port -- so changing either strands every existing install's
workspace, sealed secrets and file handles at once. The test exists to make
such a change loud rather than silent.

Claude-Session: https://[session link removed]
EOF
echo "EXIT=$?"
```

---

## Task 8: Port-owner classification

**Files:**
- Create: `desktop/src/lib/port-owner.ts`
- Test: `desktop/src/lib/port-owner.test.ts`

The rule: if the pinned port is free, start our server. If it is held by **our own** app, adopt it (load the URL). If it is held by **anything else**, fail loudly with a message naming the port. Never rebind.

Identification: our server serves HTML whose root element carries `data-app-version` (set in `src/app/layout.tsx`).

- [ ] **Step 1: Write the failing test**

Create `desktop/src/lib/port-owner.test.ts` (LF):

```ts
// @vitest-environment node
import { describe, expect, it } from "vitest";
import { classifyPortOwner, type PortProbe } from "./port-owner";

const OURS: PortProbe = {
  reachable: true,
  status: 200,
  body: '<!DOCTYPE html><html lang="en" data-app-version="0.301.0"><body></body></html>',
};

describe("classifyPortOwner", () => {
  it("reports free when nothing is listening", () => {
    expect(classifyPortOwner({ reachable: false })).toBe("free");
  });

  it("reports ours when the response carries data-app-version", () => {
    expect(classifyPortOwner(OURS)).toBe("ours");
  });

  it("reports ours regardless of which version answered", () => {
    // An older build of the same app still owns this origin's data.
    expect(
      classifyPortOwner({ ...OURS, body: '<html data-app-version="0.1.0"></html>' }),
    ).toBe("ours");
  });

  it("reports foreign for an unrelated server on the port", () => {
    expect(
      classifyPortOwner({ reachable: true, status: 200, body: "<html><body>Grafana</body></html>" }),
    ).toBe("foreign");
  });

  it("reports foreign for a reachable non-200 with no marker", () => {
    expect(classifyPortOwner({ reachable: true, status: 403, body: "forbidden" })).toBe("foreign");
  });

  it("does not mistake the attribute NAME appearing in prose for our app", () => {
    // A page that merely mentions the string is not our server.
    expect(
      classifyPortOwner({
        reachable: true,
        status: 200,
        body: "<html><body>docs about data-app-version</body></html>",
      }),
    ).toBe("foreign");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run desktop/src/lib/port-owner.test.ts > /tmp/p1.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Cannot find" /tmp/p1.log
```

Expected: FAIL — cannot resolve `./port-owner`.

- [ ] **Step 3: Write the module**

Create `desktop/src/lib/port-owner.ts` (LF):

```ts
// Who holds the pinned port?
//
// ★★★ The answer must never be "someone else, so I'll use a different port".
// The port is half the origin; rebinding silently swaps the user's IndexedDB
// store. A foreign holder is a LOUD failure, not a fallback.
export type PortProbe =
  | { reachable: false }
  | { reachable: true; status: number; body: string };

export type PortOwner = "free" | "ours" | "foreign";

// Our server is Next serving src/app/layout.tsx, whose root element carries
// data-app-version. Matched as a real ATTRIBUTE (name, `=`, quote) so a page
// that merely mentions the string in prose is not mistaken for our app.
const OURS_MARKER = /data-app-version\s*=\s*["']/;

export function classifyPortOwner(probe: PortProbe): PortOwner {
  if (!probe.reachable) return "free";
  return OURS_MARKER.test(probe.body) ? "ours" : "foreign";
}
```

- [ ] **Step 4: Run it to verify it passes**

```bash
npx vitest run desktop/src/lib/port-owner.test.ts > /tmp/p2.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " /tmp/p2.log
```

Expected: EXIT=0, `Tests 6 passed (6)`.

- [ ] **Step 5: Mutation-check the attribute matcher**

A substring match (`body.includes("data-app-version")`) passes five of the six tests. Prove the sixth is what pins it:

```bash
node -e "const fs=require('fs');const p='desktop/src/lib/port-owner.ts';const s=fs.readFileSync(p,'utf8');const n=s.replace('const OURS_MARKER = /data-app-version\\\\s*=\\\\s*[\"\\']/;','const OURS_MARKER = /data-app-version/;');if(n===s)throw new Error('mutant did not apply');fs.writeFileSync(p,n,'utf8')"
npx vitest run desktop/src/lib/port-owner.test.ts > /tmp/p3.log 2>&1; echo "MUTANT_EXIT=$?"
grep -E "Tests " /tmp/p3.log
```

Expected: `MUTANT_EXIT=1`, `Tests 1 failed | 5 passed (6)` — the sum equals the file's 6 runtime tests.

Revert by inverse edit and prove the tree is clean:

```bash
node -e "const fs=require('fs');const p='desktop/src/lib/port-owner.ts';const s=fs.readFileSync(p,'utf8');const n=s.replace('const OURS_MARKER = /data-app-version/;','const OURS_MARKER = /data-app-version\\\\s*=\\\\s*[\"\\']/;');if(n===s)throw new Error('inverse did not apply');fs.writeFileSync(p,n,'utf8')"
git diff --stat -- desktop/src/lib/port-owner.ts
```

Expected: **empty** diff.

- [ ] **Step 6: Commit**

```bash
git add desktop/src/lib/port-owner.ts desktop/src/lib/port-owner.test.ts
git commit --only desktop/src/lib/port-owner.ts desktop/src/lib/port-owner.test.ts -F - <<'EOF'
feat(desktop): classify who holds the pinned port

free / ours / foreign. A foreign holder is a loud failure, never a reason to
rebind: the port is half the origin, so rebinding silently swaps the user's
IndexedDB store.

The marker is matched as a real attribute rather than a substring, so a page
merely mentioning the string is not read as our server. Mutation-proved:
relaxing it to a substring gives 1 failed / 5 passed of 6.

Claude-Session: https://[session link removed]
EOF
echo "EXIT=$?"
```

---

## Task 9: Readiness polling

**Files:**
- Create: `desktop/src/lib/readiness.ts`
- Test: `desktop/src/lib/readiness.test.ts`

⚠️ A fixed `sleep` is forbidden: on a slow laptop it is either a hang or a race. Poll a condition with a hard timeout.

- [ ] **Step 1: Write the failing test**

Create `desktop/src/lib/readiness.test.ts` (LF):

```ts
// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { waitForReady } from "./readiness";

function fakeClock() {
  let t = 0;
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
    },
  };
}

describe("waitForReady", () => {
  it("returns ready as soon as the probe succeeds", async () => {
    const clock = fakeClock();
    const probe = vi.fn().mockResolvedValue(true);
    const r = await waitForReady({ probe, timeoutMs: 30000, intervalMs: 250, ...clock });
    expect(r).toEqual({ ready: true });
    expect(probe).toHaveBeenCalledTimes(1);
  });

  it("keeps polling until the probe turns true", async () => {
    const clock = fakeClock();
    const probe = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(false).mockResolvedValue(true);
    const r = await waitForReady({ probe, timeoutMs: 30000, intervalMs: 250, ...clock });
    expect(r).toEqual({ ready: true });
    expect(probe).toHaveBeenCalledTimes(3);
  });

  it("gives up at the hard timeout and says so", async () => {
    const clock = fakeClock();
    const probe = vi.fn().mockResolvedValue(false);
    const r = await waitForReady({ probe, timeoutMs: 1000, intervalMs: 250, ...clock });
    expect(r).toEqual({ ready: false, reason: "timeout" });
  });

  it("does not poll forever when the probe always throws", async () => {
    const clock = fakeClock();
    const probe = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const r = await waitForReady({ probe, timeoutMs: 1000, intervalMs: 250, ...clock });
    // A refused connection is the NORMAL state while the server boots, so it
    // must be treated as "not yet", not as a fatal error — but it must still
    // hit the timeout rather than spinning.
    expect(r).toEqual({ ready: false, reason: "timeout" });
    expect(probe.mock.calls.length).toBeGreaterThan(1);
  });

  it("bounds its own polling — a zero interval cannot spin without end", async () => {
    const clock = fakeClock();
    const probe = vi.fn().mockResolvedValue(false);
    const r = await waitForReady({ probe, timeoutMs: 100, intervalMs: 0, ...clock });
    expect(r.ready).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run desktop/src/lib/readiness.test.ts > /tmp/r1.log 2>&1; echo "EXIT=$?"
grep -E "Cannot find|Test Files" /tmp/r1.log
```

Expected: FAIL — cannot resolve `./readiness`.

- [ ] **Step 3: Write the module**

Create `desktop/src/lib/readiness.ts` (LF):

```ts
// Wait until the server answers, or give up loudly.
//
// ★★ Deliberately NOT a fixed sleep. On a slow laptop a sleep is either a hang
// (too long) or a race (too short); both present as "the app didn't open".
// Clock and sleep are injected so this is testable without real time.
export type ReadyResult = { ready: true } | { ready: false; reason: "timeout" };

export interface WaitForReadyOptions {
  probe: () => Promise<boolean>;
  timeoutMs: number;
  intervalMs: number;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
}

export async function waitForReady(opts: WaitForReadyOptions): Promise<ReadyResult> {
  const { probe, timeoutMs, intervalMs, now, sleep } = opts;
  const deadline = now() + timeoutMs;

  for (;;) {
    try {
      if (await probe()) return { ready: true };
    } catch {
      // A refused connection is the normal state while the server boots.
      // Treat it as "not yet" and let the deadline decide.
    }
    if (now() >= deadline) return { ready: false, reason: "timeout" };
    // A zero interval must still advance the clock, or a fake clock (and a
    // real busy loop) would spin without end.
    await sleep(Math.max(intervalMs, 1));
  }
}
```

- [ ] **Step 4: Run it to verify it passes**

```bash
npx vitest run desktop/src/lib/readiness.test.ts > /tmp/r2.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " /tmp/r2.log
```

Expected: EXIT=0, `Tests 5 passed (5)`.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/lib/readiness.ts desktop/src/lib/readiness.test.ts
git commit --only desktop/src/lib/readiness.ts desktop/src/lib/readiness.test.ts -F - <<'EOF'
feat(desktop): poll for server readiness with a hard timeout

Not a fixed sleep: on a slow laptop that is either a hang or a race, and
both present to the user as "the app didn't open". Clock and sleep are
injected so the timeout is testable without real time.

A refused connection is the normal state while the server boots, so it
counts as "not yet" rather than fatal -- but it still hits the deadline
instead of spinning, which is pinned by its own test.

Claude-Session: https://[session link removed]
EOF
echo "EXIT=$?"
```

---

## Task 10: Log path resolution

**Files:**
- Create: `desktop/src/lib/log-paths.ts`
- Test: `desktop/src/lib/log-paths.test.ts`

- [ ] **Step 1: Write the failing test**

Create `desktop/src/lib/log-paths.test.ts` (LF):

```ts
// @vitest-environment node
import { describe, expect, it } from "vitest";
import { resolveLogDir } from "./log-paths";

describe("resolveLogDir", () => {
  it("uses LOCALAPPDATA when present", () => {
    expect(resolveLogDir({ LOCALAPPDATA: "C:\\Users\\x\\AppData\\Local" })).toBe(
      "C:\\Users\\x\\AppData\\Local\\aipm-cockpit\\logs",
    );
  });

  it("falls back to a temp path when LOCALAPPDATA is absent", () => {
    // Never return an empty string or throw: losing the log is how a remote
    // "it doesn't open" becomes unsupportable.
    const dir = resolveLogDir({ TEMP: "C:\\Temp" });
    expect(dir).toBe("C:\\Temp\\aipm-cockpit\\logs");
  });

  it("never returns an empty path even with an empty environment", () => {
    const dir = resolveLogDir({});
    expect(dir.length).toBeGreaterThan(0);
    expect(dir).toContain("aipm-cockpit");
  });

  it("ignores an empty-string LOCALAPPDATA rather than building a rooted path", () => {
    const dir = resolveLogDir({ LOCALAPPDATA: "", TEMP: "C:\\Temp" });
    expect(dir).toBe("C:\\Temp\\aipm-cockpit\\logs");
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run desktop/src/lib/log-paths.test.ts > /tmp/l1.log 2>&1; echo "EXIT=$?"
grep -E "Cannot find|Test Files" /tmp/l1.log
```

Expected: FAIL — cannot resolve `./log-paths`.

- [ ] **Step 3: Write the module**

Create `desktop/src/lib/log-paths.ts` (LF):

```ts
// Where the launch log goes.
//
// ★ "It doesn't open" with no artifact is unsupportable at a distance, so this
// must never throw and never return "". An empty-string env var is treated as
// absent — otherwise the path would be rooted at the filesystem root.
const APP_DIR = "aipm-cockpit";

export function resolveLogDir(env: Record<string, string | undefined>): string {
  const base = firstNonEmpty([env.LOCALAPPDATA, env.TEMP, env.TMP]) ?? ".";
  return `${base}\\${APP_DIR}\\logs`;
}

function firstNonEmpty(values: Array<string | undefined>): string | undefined {
  for (const v of values) {
    if (typeof v === "string" && v.length > 0) return v;
  }
  return undefined;
}
```

- [ ] **Step 4: Run it to verify it passes**

```bash
npx vitest run desktop/src/lib/log-paths.test.ts > /tmp/l2.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " /tmp/l2.log
```

Expected: EXIT=0, `Tests 4 passed (4)`.

- [ ] **Step 5: Commit**

```bash
git add desktop/src/lib/log-paths.ts desktop/src/lib/log-paths.test.ts
git commit --only desktop/src/lib/log-paths.ts desktop/src/lib/log-paths.test.ts -F - <<'EOF'
feat(desktop): resolve the launch-log directory

Never throws and never returns an empty path: losing the log is what turns a
remote "it doesn't open" into an unsupportable report. An empty-string env
var counts as absent rather than producing a filesystem-root path.

Claude-Session: https://[session link removed]
EOF
echo "EXIT=$?"
```

---

## Task 11: Server child — spawn and port-scoped kill

**Files:**
- Create: `desktop/src/server-child.ts`
- Modify: `desktop/package.json` (add `electron` devDependency)

⚠️ The kill is **port/PID-scoped**, mirroring `scripts/stop-dev.mjs`. Never `taskkill /IM node.exe` — on a user's laptop that kills their editor.

⚠️ An orphaned server holds the pinned port, so the *next* launch correctly refuses to start and the app looks permanently broken. The child must die with the parent.

- [ ] **Step 1: Add Electron as a devDependency of `desktop/`**

Electron is installed into `desktop/`, not the repo root — it is the shell's dependency, and the root install feeds every CI job that has no use for a 200 MB browser.

```bash
cd desktop && npm install --save-dev electron@^33 > /tmp/eleci.log 2>&1; echo "EXIT=$?"; cd ..
tail -3 /tmp/eleci.log
ls desktop/node_modules/electron/package.json
```

Expected: EXIT=0 and the file listed.

⚠️ `npm ci` **destroys** worktree `node_modules` and can EPERM on Windows. Use `npm install`; if anything breaks, repair with `npm install` — never `npm ci` in this worktree.

- [ ] **Step 2: Write the module**

Create `desktop/src/server-child.ts` (LF):

```ts
import { spawn, type ChildProcess } from "node:child_process";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { APP_HOST, APP_PORT } from "./lib/constants";

// Spawn the Next standalone server on ELECTRON'S OWN NODE.
//
// ★★★ process.execPath + ELECTRON_RUN_AS_NODE=1 is what makes a second Node
// runtime unnecessary. Electron already contains one; bundling another would
// add ~50MB for nothing.
//
// ★★★ HOSTNAME is 127.0.0.1, NOT 0.0.0.0. A 0.0.0.0 bind publishes the app --
// and the user's entire workspace -- to the corporate LAN. There is an
// automated test for this in e2e/desktop-smoke.spec.ts; do not "fix" a
// networking problem by widening it.
export function spawnServer(resourcesPath: string): ChildProcess {
  const serverJs = join(resourcesPath, "standalone", "server.js");
  return spawn(process.execPath, [serverJs], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      NODE_ENV: "production",
      PORT: String(APP_PORT),
      HOSTNAME: APP_HOST,
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
}

// Kill the server, PID-scoped.
//
// ★★★ NEVER a blanket `taskkill /IM node.exe`. This runs on a user's laptop:
// that command would kill their editor, their other Electron apps, and any
// other Node process they own. This mirrors the discipline in
// scripts/stop-dev.mjs, which is port-scoped for the same reason.
export function killServer(child: ChildProcess | null): void {
  if (!child || child.exitCode !== null || child.pid === undefined) return;
  try {
    if (process.platform === "win32") {
      // /T kills the process TREE, so a server that spawned workers does not
      // orphan them onto the pinned port.
      execFileSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    } else {
      child.kill("SIGTERM");
    }
  } catch {
    // Already gone, or taskkill unavailable. Nothing to do — the next launch's
    // port-owner check is the backstop.
  }
}
```

- [ ] **Step 3: Typecheck**

```bash
cd desktop && npx tsc -p tsconfig.json --noEmit > /tmp/dtsc.log 2>&1; echo "EXIT=$?"; cd ..
grep -c "error TS" /tmp/dtsc.log
```

Expected: EXIT=0, `0` errors.

- [ ] **Step 4: Commit**

```bash
git add desktop/src/server-child.ts desktop/package.json desktop/package-lock.json
git commit --only desktop/src/server-child.ts desktop/package.json desktop/package-lock.json -F - <<'EOF'
feat(desktop): spawn the Next standalone server on Electron's own Node

process.execPath + ELECTRON_RUN_AS_NODE=1, so no second Node runtime ships.
HOSTNAME is pinned to 127.0.0.1: a 0.0.0.0 bind would publish the user's
workspace to the corporate LAN.

The kill is PID-scoped with a tree kill, mirroring scripts/stop-dev.mjs.
A blanket taskkill /IM node.exe would kill the user's editor.

Claude-Session: https://[session link removed]
EOF
echo "EXIT=$?"
```

---

## Task 12: Electron main — lock, splash, lifecycle, loud failures

**Files:**
- Create: `desktop/src/main.ts`
- Create: `desktop/splash.html`

- [ ] **Step 1: Write the splash**

Create `desktop/splash.html` (LF):

```html
<!doctype html>
<meta charset="utf-8" />
<title>aipm-cockpit</title>
<style>
  body { font: 14px system-ui, sans-serif; display: grid; place-items: center; height: 100vh; margin: 0; color: #333; }
  .msg { text-align: center; }
</style>
<div class="msg"><p>Starting aipm-cockpit…</p></div>
```

- [ ] **Step 2: Write the main process**

Create `desktop/src/main.ts` (LF):

```ts
import { app, BrowserWindow, dialog } from "electron";
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { ChildProcess } from "node:child_process";
import { APP_ORIGIN, APP_PORT } from "./lib/constants";
import { classifyPortOwner, type PortProbe } from "./lib/port-owner";
import { resolveLogDir } from "./lib/log-paths";
import { waitForReady } from "./lib/readiness";
import { killServer, spawnServer } from "./server-child";

let serverChild: ChildProcess | null = null;
let win: BrowserWindow | null = null;

const logDir = resolveLogDir(process.env);
function log(line: string): void {
  try {
    mkdirSync(logDir, { recursive: true });
    appendFileSync(join(logDir, "launch.log"), `${new Date().toISOString()} ${line}\n`, "utf8");
  } catch {
    // Logging must never take the app down.
  }
}

async function probePort(): Promise<PortProbe> {
  try {
    const res = await fetch(APP_ORIGIN, { redirect: "manual" });
    return { reachable: true, status: res.status, body: await res.text() };
  } catch {
    return { reachable: false };
  }
}

function fail(title: string, message: string): void {
  log(`FAIL ${title}: ${message}`);
  dialog.showErrorBox(title, `${message}\n\nDetails: ${join(logDir, "launch.log")}`);
  app.quit();
}

async function start(): Promise<void> {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    show: true,
    webPreferences: {
      // The renderer loads an HTTP origin: remote content, trusted no more
      // than a browser tab would be.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  await win.loadFile(join(__dirname, "..", "splash.html"));

  const owner = classifyPortOwner(await probePort());

  if (owner === "foreign") {
    // ★★★ NEVER rebind to a free port. The port is half the origin, so a
    // different port is a different IndexedDB store — the user's workspace
    // would silently vanish. Fail loudly instead.
    fail(
      "Port in use",
      `Another program is already using port ${APP_PORT} on this computer. ` +
        `aipm-cockpit cannot start until that program is closed. ` +
        `It will not use a different port, because its saved data belongs to this one.`,
    );
    return;
  }

  if (owner === "free") {
    serverChild = spawnServer(process.resourcesPath);
    serverChild.stderr?.on("data", (d: Buffer) => log(`server: ${d.toString().trimEnd()}`));
    serverChild.on("exit", (code) => {
      log(`server exited with code ${code}`);
      if (win && !win.isDestroyed()) {
        dialog.showErrorBox(
          "aipm-cockpit stopped",
          `The application's background service stopped unexpectedly (code ${code}). ` +
            `Please close and reopen aipm-cockpit.\n\nDetails: ${join(logDir, "launch.log")}`,
        );
      }
    });

    const ready = await waitForReady({
      probe: async () => (await probePort()).reachable,
      timeoutMs: 60000,
      intervalMs: 250,
      now: () => Date.now(),
      sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
    });

    if (!ready.ready) {
      fail(
        "aipm-cockpit did not start",
        "The application's background service did not finish starting in time.",
      );
      return;
    }
  }

  await win.loadURL(APP_ORIGIN);
}

// One instance. A second launch focuses the window that already exists.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(start);

  // Closing the window quits: the window IS the app. No tray icon.
  app.on("window-all-closed", () => app.quit());

  // ★★★ The child MUST die with the parent. An orphan holds the pinned port,
  // so the next launch correctly refuses to start and the app appears
  // permanently broken.
  app.on("before-quit", () => killServer(serverChild));
  process.on("exit", () => killServer(serverChild));
}
```

- [ ] **Step 3: Typecheck and build**

```bash
cd desktop && npx tsc -p tsconfig.json > /tmp/dtsc2.log 2>&1; echo "EXIT=$?"; cd ..
grep -c "error TS" /tmp/dtsc2.log
ls desktop/dist/main.js
```

Expected: EXIT=0, `0` errors, `desktop/dist/main.js` exists.

- [ ] **Step 4: Commit**

```bash
git add desktop/src/main.ts desktop/splash.html
git commit --only desktop/src/main.ts desktop/splash.html -F - <<'EOF'
feat(desktop): Electron main -- lock, splash, lifecycle, loud failures

Single-instance lock; a splash is shown immediately so a booting server does
not present as a white window or a connection error.

A foreign holder of port 17300 is a loud, explained failure rather than a
rebind: a different port is a different IndexedDB store, so rebinding would
silently hide the user's workspace.

The server child dies with the parent on both before-quit and process exit.
An orphan holds the pinned port, which makes the NEXT launch refuse to start.

Renderer is treated as remote content: contextIsolation on, nodeIntegration
off, sandbox on, no Node surface exposed.

Claude-Session: https://[session link removed]
EOF
echo "EXIT=$?"
```

---

## Task 13: eslint for `desktop/**`

**Files:**
- Modify: `eslint.config.mjs`

⚠️ CI runs `eslint --max-warnings=0` over the **whole repo**, so `desktop/**` has been in scope since Task 3. It currently passes only by accident of having few files; the Node/Electron globals and CommonJS `__dirname` need a config block.

⚠️ `eslint.config.mjs` has been protected by a config-protection hook in this environment. If the edit is intercepted, **stop and ask the user to approve it** — do not work around the hook.

- [ ] **Step 1: Confirm the current state**

```bash
npx eslint --max-warnings=0 desktop > /tmp/es1.log 2>&1; echo "EXIT=$?"
head -20 /tmp/es1.log
```

Record the result. If it already exits 0, the block below is still required — `__dirname` and Node globals are only unflagged because no rule has reached them yet.

- [ ] **Step 2: Add the config block**

In `eslint.config.mjs`, add this object to the `defineConfig([...])` array, after the `globalIgnores(...)` entry:

```js
  {
    // The Electron shell is a Node/CommonJS main process, not a Next page.
    // Without this block the whole-repo lint applies browser/React
    // expectations to it, and `__dirname` reads as undefined.
    files: ["desktop/**/*.ts", "desktop/**/*.mjs"],
    languageOptions: {
      globals: {
        __dirname: "readonly",
        process: "readonly",
        console: "readonly",
        Buffer: "readonly",
      },
    },
  },
```

- [ ] **Step 3: Verify**

```bash
npx eslint --max-warnings=0 desktop > /tmp/es2.log 2>&1; echo "EXIT=$?"
cat /tmp/es2.log
```

Expected: EXIT=0 with no output.

⚠️ Prove the linter is actually reaching these files before trusting a 0 — a config that matches nothing also exits 0:

```bash
printf 'const unused = 1;\nexport const x = 2;\n' > desktop/src/__probe.ts
npx eslint --max-warnings=0 desktop > /tmp/es3.log 2>&1; echo "PROBE_EXIT=$?"
grep -c "unused" /tmp/es3.log
powershell -NoProfile -Command "Remove-Item desktop/src/__probe.ts"
```

Expected: `PROBE_EXIT=1` and the unused variable reported. If it exits 0, the config is not matching `desktop/**` and the whole task is inert.

- [ ] **Step 4: Verify the whole-repo lint**

```bash
npx eslint --max-warnings=0 src desktop scripts > /tmp/es4.log 2>&1; echo "EXIT=$?"
tail -5 /tmp/es4.log
```

Expected: EXIT=0.

- [ ] **Step 5: Commit**

```bash
git add eslint.config.mjs
git commit --only eslint.config.mjs -F - <<'EOF'
chore(lint): give desktop/** its Node/Electron lint context

CI lints the whole repo at --max-warnings=0, so desktop/** has been in scope
since it was created. Proved the config actually matches those files by
introducing an unused variable and observing exit 1 -- a config matching
nothing also exits 0.

Claude-Session: https://[session link removed]
EOF
echo "EXIT=$?"
```

---

## Task 14: electron-builder config and a local installer

**Files:**
- Create: `desktop/electron-builder.yml`
- Modify: `package.json` (add `desktop:build`, `desktop:package`)

- [ ] **Step 1: Add electron-builder**

```bash
cd desktop && npm install --save-dev electron-builder@^25 2>&1 | tail -3; cd ..
```

- [ ] **Step 2: Write the builder config**

Create `desktop/electron-builder.yml` (LF):

```yaml
appId: io.github.sebastianmaute.aipm-cockpit
productName: aipm-cockpit
directories:
  output: release
files:
  - dist/**
  - splash.html
  - package.json
# The built Next standalone server ships as an unpacked resource, so
# process.resourcesPath/standalone/server.js resolves at runtime.
extraResources:
  - from: ../.next/standalone
    to: standalone
win:
  target: nsis
  # Unsigned: no certificate is available. See the spec's Section 7 security
  # note -- this means SmartScreen prompts on install, and (once the updater
  # lands) that the share ACL is the only integrity control on updates.
  signAndEditExecutable: false
nsis:
  # Per-user install: corporate laptops routinely deny admin rights, and a
  # machine-wide installer turns "double-click to run" back into a ticket.
  perMachine: false
  oneClick: false
  allowToChangeInstallationDirectory: true
```

- [ ] **Step 3: Add the scripts**

In `package.json` `scripts`:

```json
    "desktop:build": "cross-env NEXT_STANDALONE=1 npm run build && npm run desktop:copy-static && npm --prefix desktop run build",
    "desktop:package": "npm --prefix desktop exec electron-builder -- --config desktop/electron-builder.yml --project desktop",
```

If `cross-env` is not a dependency, use the platform-neutral form instead:

```json
    "desktop:build": "node -e \"process.env.NEXT_STANDALONE='1';require('child_process').execSync('npm run build',{stdio:'inherit',env:process.env})\" && npm run desktop:copy-static && npm --prefix desktop run build",
```

⚠️ Add matching `scriptsDescriptions` entries for both, then run `npm run docs:scripts`, or the `prebuild` docs-sync check fails.

- [ ] **Step 4: Build and package locally**

```bash
npm run desktop:build > /tmp/db.log 2>&1; echo "BUILD_EXIT=$?"
tail -5 /tmp/db.log
npm run desktop:package > /tmp/dp.log 2>&1; echo "PACK_EXIT=$?"
ls desktop/release/*.exe
```

Expected: both EXIT=0, and an `.exe` installer listed.

- [ ] **Step 5: Manually verify the installer** (this step is a human action, and it is the point of the whole plan)

1. Run the `.exe`. Expect a SmartScreen prompt (unsigned, as designed) — dismiss via *More info → Run anyway*.
   ★★★ **A LOCALLY BUILT INSTALLER DOES NOT PROMPT, AND THAT IS NOT A DEFECT.** Reported by the
   user on 2026-09-10 as a discrepancy against this line, and then measured: the built
   `.exe` is genuinely `NotSigned` (`Get-AuthenticodeSignature` → `Status: NotSigned`,
   `SignerCertificate` NONE — note electron-builder still logs `signing with signtool.exe`, which
   is a STEP NAME and not evidence a signature was applied), **and** it carries no
   Mark-of-the-Web: `Get-Item -Stream *` returns `:$DATA` alone, with no `Zone.Identifier`.
   SmartScreen's App Reputation check keys off that stream, which a BROWSER writes on download.
   So this step cannot be performed on the machine that built the artifact — copy it through the
   path a colleague will actually use, or read the step as unverified.
   ★★ **This is a third way Task 2's control can fail to prompt**, alongside the two that step
   already names, and it is the one that looks like a passing test: whether a file opened from a
   UNC share acquires a `Zone.Identifier` at all is precisely what that spike has to establish, so
   do NOT treat a silent install from the share as evidence either way until it does.
2. Confirm it installs **without** an admin/UAC elevation prompt.
3. Launch from the Start menu. Expect the splash, then the app.
4. **Confirm the app is styled.** An unstyled app means Task 5's copy did not reach the package.
5. Close the window. In Task Manager, confirm no orphaned process remains.
6. Launch twice; confirm the second launch focuses the first window rather than opening a second.

- [ ] **Step 6: Commit**

```bash
git add desktop/electron-builder.yml desktop/package.json desktop/package-lock.json package.json CONTRIBUTING.md README.md
git commit --only desktop/electron-builder.yml desktop/package.json desktop/package-lock.json package.json CONTRIBUTING.md README.md -F - <<'EOF'
feat(desktop): electron-builder NSIS config and packaging scripts

Per-user install (perMachine: false), so no admin rights are needed --
a machine-wide installer would turn "double-click to run" back into a ticket.

Unsigned, deliberately: no certificate is available. SmartScreen will prompt
on install.

The Next standalone tree ships as an unpacked extraResource so
process.resourcesPath/standalone/server.js resolves at runtime.

Claude-Session: https://[session link removed]
EOF
echo "EXIT=$?"
```

---

## Task 15: Packaged-app smoke test

**Status: DONE 2026-09-10** — `e2e/desktop-smoke.spec.ts`, commit `902066af`. The text below is
the CORRECTED task; the version originally planned here carried six defects, four of which made it
unrunnable and two of which made it **vacuous while green**. They are recorded at the end because
every one of them is the class of mistake this task exists to catch.

**Files:**
- Create: `e2e/desktop-smoke.spec.ts`
- Modify: `playwright.config.ts` (project + `testIgnore` + env-gated `webServer`)
- Modify: `package.json` (`e2e:desktop` script **and** its `scriptsDescriptions` entry)
- Regenerate: `CONTRIBUTING.md` via `npm run docs:scripts`

⚠️ **The obvious smoke test is vacuous three separate ways.** "Window opens, title matches" passes
against an app serving the missing-`.next/static` failure — booted, functional, entirely unstyled.
So does a styling assertion made on a window Chromium is serving from its **persistent HTTP cache**.
So does any assertion at all if it runs against the **splash** page rather than the app.

**Precondition:** a fresh package. `npm --prefix desktop run build` then `npm run desktop:package`.
Do **not** run `npm run desktop:build` if `.next/` must not be rebuilt — `desktop:package` consumes
the existing `.next/standalone` plus `desktop/dist` and `desktop/splash.html`.

- [ ] **Step 1: Write the test**

Create `e2e/desktop-smoke.spec.ts` with the Write tool (never `sed`). Read the committed file for
the full text; the load-bearing decisions are:

1. **Launch the PACKAGED executable**, `desktop/release/win-unpacked/AI PM Cockpit.exe`, via
   `_electron.launch({ executablePath })`. `test.skip` with the path and `npm run desktop:package`
   when it is absent, so a fresh clone does not go red.
2. **A throwaway `--user-data-dir` per launch** (`mkdtempSync`). Non-negotiable — see defect 5.
3. **Poll `app.windows()` for a window whose `url()` starts with `APP_ORIGIN`**, 90s budget. The app
   reuses ONE window (`loadFile(splash.html)` then `loadURL(APP_ORIGIN)`), so `firstWindow()`
   resolves against the splash.
4. **Assertion order: styling first, `toBeVisible()` after.** See defect 6.
5. Assert `getComputedStyle(document.body).backgroundColor` is neither `""` nor `rgba(0, 0, 0, 0)`,
   AND that the document carries stylesheet **rules** (`document.styleSheets` → summed
   `cssRules.length`). Two independent witnesses; each failure message contains the literal
   `CSS bundle did not load`, which Step 4 greps for.
6. Assert `documentElement.getAttribute("data-app-version") === APP_VERSION` — the
   `e2e/a11y.spec.ts` guard (open-followups §58) extended to the package.
7. Second test: loopback **control first** (must be 200 — a server that is down refuses everywhere),
   then assert a non-internal IPv4 address REFUSES, `AbortSignal.timeout(3000)`.
8. `test.describe.serial` + wait for port 17300 to be **released** after each `app.close()` — poll
   the condition, never sleep a guessed interval.

- [ ] **Step 2: Keep it out of CI, and off the dev server**

`playwright.config.ts`: add `desktop-smoke\.spec\.ts` to the `chromium` project's `testIgnore`
(which ignores only `visual.spec.ts` otherwise, so the spec would land in the **blocking** e2e job
where no package exists); add a `desktop` project with `testMatch`, `timeout: 240_000` and
`workers: 1` (`testProject.workers` exists — verified in `node_modules/playwright/types/test.d.ts`);
and gate `webServer` on `PLAYWRIGHT_NO_WEBSERVER`, since it is global and unconditional and would
otherwise boot a Turbopack dev server this spec never touches.

`package.json`: an `e2e:desktop` script setting that env var (the `node -e` form `desktop:build`
already uses), plus its `scriptsDescriptions` entry — a new script without one fails
`docs:scripts:check`. Then `npm run docs:scripts` to regenerate `CONTRIBUTING.md`.

- [ ] **Step 3: Typecheck and run**

```bash
npx tsc --noEmit > "$SP/t15-tsc.log" 2>&1; echo "EXIT=$?"; grep -c "error TS" "$SP/t15-tsc.log"
npm run e2e:desktop > "$SP/ds.log" 2>&1; echo "EXIT=$?"; tail -20 "$SP/ds.log"
```

Measured: tsc EXIT=0 / 0 errors; `2 passed (8.8s)`. `playwright.config.ts` IS inside the tsconfig
`include` (`**/*.ts`, excluding only `node_modules` and `scripts`), so tsc really does cover it.

- [ ] **Step 4: Prove the styling assertion is not vacuous**

Rename the packaged static directory aside — **`desktop/release/win-unpacked/resources/standalone/.next/static`**, NOT anything under `.next/standalone`, which the packaged app never reads:

```bash
powershell -NoProfile -Command "Rename-Item 'desktop/release/win-unpacked/resources/standalone/.next/static' static-hidden"
npm run e2e:desktop > "$SP/ds2.log" 2>&1; echo "MUTANT_EXIT=$?"
grep -c "CSS bundle did not load" "$SP/ds2.log"
powershell -NoProfile -Command "Rename-Item 'desktop/release/win-unpacked/resources/standalone/.next/static-hidden' static"
npm run e2e:desktop > "$SP/ds3.log" 2>&1; echo "RESTORE_EXIT=$?"
```

Measured: `MUTANT_EXIT=1`, **2** matches, failing on the transparent-background assertion; test 2
`did not run` (serial). `RESTORE_EXIT=0`, 2 passed. **If the mutant passes, the assertion is
vacuous** — that is the entire failure this test exists to catch, and it happened (defect 5).

- [ ] **Step 5: Commit** — `e2e/desktop-smoke.spec.ts playwright.config.ts package.json CONTRIBUTING.md`

### The six defects this task shipped with, all measured

The first four made it unrunnable; **5 and 6 are the expensive ones**, because each produced a
green-or-misleading run rather than an obvious error.

1. **It launched `desktop/dist/main.js`.** Unpackaged, `process.resourcesPath` is
   `desktop/node_modules/electron/dist/resources`, which holds no `standalone/`, so
   `spawnServer(process.resourcesPath)` points at a `server.js` that does not exist and the app can
   only die in its own start-up dialog.
2. **Its mutation step renamed `.next/standalone/.next/static`** — a path the packaged app never
   reads, so the mutant would have changed nothing and "proved" the assertion by passing.
3. **It left the spec in the blocking CI e2e job.** `chromium`'s `testIgnore` was `visual.spec.ts`
   alone.
4. **It ignored the global `webServer`**, which would boot `npm run dev` on :3000 as a pure side
   effect (measured: :3000 was not listening at all when the task was run).
5. **★★★ Chromium's persistent HTTP cache made the styling assertion unfalsifiable.** With the
   static directory renamed aside, the first mutation run **passed** — `2 passed (9.0s)`. Probed on
   the app's real user-data dir at that exact state: `document.styleSheets[0].cssRules.length` was
   **97** and body background `rgb(255, 255, 255)`, while a Node-side `fetch` of that same
   stylesheet URL returned **404**. The bundle was coming from the disk cache an earlier styled run
   had written. Same probe with a fresh `mkdtemp` profile: background `rgba(0, 0, 0, 0)`, **0**
   rules. **The vacuity was in the LAUNCH, not the expectation** — and the obvious strengthening
   would ALSO have been vacuous, because `--surface`/`--background`/`--foreground` resolve to real
   values (`#ffffff`, `#646461`) on an unstyled page, set inline by the SSR scheme apply. The rule
   count is the witness an inline style cannot fake.
6. **★★ The planned assertion order misattributes the failure.** With a valid mutant,
   `await expect(body).toBeVisible()` fires first, and an unstyled body has a zero-size box — so
   Playwright reports `Received: hidden` with **0** occurrences of `CSS bundle did not load`. A red
   run that reads like a broken selector. Styling assertions must precede it.

★ Two smaller measurements worth keeping: the app creates **one** `BrowserWindow` and navigates it
(so URL polling is right for a reason the plan got wrong — navigation, not window ordering), and
`app.close()` **does** release port 17300 promptly (the release poll returned on its first iteration
in every run), so the wait is a cheap guard rather than a workaround.

---

## Task 16: Manual CI packaging job

**Files:**
- Modify: `.gitlab-ci.yml`

⚠️ **The runners are Linux** (`node:24-bookworm-slim`). Building a Windows NSIS installer there requires wine — hence the `electronuserland/builder:wine` image. If that image is unreachable from this GitLab instance, the fallback is local packaging on Windows (Task 14), and this job should not be added at all rather than left broken.

⚠️ The job **consumes** `build`'s artifact and must not rebuild the app — except that `build` produces a non-standalone `.next/`. The job therefore rebuilds with `NEXT_STANDALONE=1`. State this honestly: it is the one place the plan's "never rebuild" rule does not hold, because the artifact is the wrong shape.

- [ ] **Step 1: Add the job**

Append to `.gitlab-ci.yml`:

```yaml
# Windows desktop installer. MANUAL: the build is slow and the artifact is
# large, so running it per-MR would dominate pipeline time and storage for no
# signal.
#
# ★ The runners are Linux, so a Windows NSIS target needs wine — that is what
# this image provides.
#
# ★★ This rebuilds the app with NEXT_STANDALONE=1 rather than consuming
# build's artifact, because build produces a NON-standalone .next/. Consuming
# it directly is not possible; the shapes differ.
desktop-package:
  stage: e2e
  image: electronuserland/builder:wine
  needs: [install]
  rules:
    - when: manual
      allow_failure: true
  script:
    - NEXT_STANDALONE=1 npm run build
    - npm run desktop:copy-static
    - npm --prefix desktop ci || npm --prefix desktop install
    - npm --prefix desktop run build
    - npm run desktop:package
  artifacts:
    paths: [desktop/release/]
    expire_in: 1 week
```

⚠️ `allow_failure: true` is indented under the `- when: manual` rule **only**, mirroring `dast-zap`. A `rules:` entry that omits it defaults to `false`, so this job would be **blocking** on any pipeline where a different rule matched. There is only one rule here, so the job is manual-and-non-blocking on every pipeline — but do not add a second rule without re-reading this.

- [ ] **Step 2: Validate the CI file parses**

```bash
glab ci lint > /tmp/cilint.log 2>&1; echo "EXIT=$?"
cat /tmp/cilint.log
```

Expected: EXIT=0, valid.

- [ ] **Step 3: Confirm no existing job changed**

```bash
git diff .gitlab-ci.yml | grep -E "^-" | grep -v "^---"
```

Expected: **no output** — the change is purely additive. Any removed line means an existing job was disturbed.

- [ ] **Step 4: Commit**

```bash
git add .gitlab-ci.yml
git commit --only .gitlab-ci.yml -F - <<'EOF'
ci(desktop): manual Windows packaging job

Manual: the build is slow and the artifact large, so per-MR runs would
dominate pipeline time for no signal. allow_failure sits under the manual
rule, mirroring dast-zap.

Uses the wine builder image because the runners are Linux and the target is
a Windows NSIS installer. Rebuilds with NEXT_STANDALONE=1 rather than
consuming build's artifact -- build produces a non-standalone .next/, so the
shapes differ and the artifact cannot be reused as-is.

Claude-Session: https://[session link removed]
EOF
echo "EXIT=$?"
```

---

## Task 17: Rollout note for the first install

**Files:**
- Create: `docs/desktop-rollout.md`

⚠️ Without this, the **first launch reads as broken**. The packaged app gets a fresh Chromium profile, so the user's sealed secrets are not there — the app opens with no API key, no Turso token, and (in file mode) no project file. That is correct behaviour and looks exactly like data loss.

- [ ] **Step 1: Write the note**

Create `docs/desktop-rollout.md` (LF — `docs/**` is LF-only):

```markdown
# Installing aipm-cockpit on your laptop

## Installing

1. Run the installer from the share.
2. Windows will show a blue **"Windows protected your PC"** box. This is expected: the app is not code-signed. Click **More info**, then **Run anyway**.
3. The app installs for your user only — you do **not** need admin rights.

## The first time you open it

The desktop app keeps its data separately from your web browser, so **it starts empty even if you used the app in your browser before.** Nothing has been lost; the browser version still has its own copy.

You will need to enter these once:

- Your AI (Anthropic) API key
- Your Turso database URL and auth token, if you use Turso storage
- Your Jira and Timelog tokens, if you use those integrations
- Your speech-to-text key, if you use dictation

If you work from a **project file**, open it once via the usual file picker; the app will remember it from then on.

If you use **Turso storage**, your projects appear as soon as the token is entered — that data lives on the server, not on your laptop.

## Everyday use

- Closing the window closes the app completely.
- Opening it again while it is already running just brings the existing window to the front.

## If it does not start

If you see **"Another program is already using port 17300"**, some other software on your machine has taken the port this app needs. Close that program and try again. The app deliberately will not move to a different port, because its saved data is tied to this one.

For anything else, there is a log at:

`%LOCALAPPDATA%\aipm-cockpit\logs\launch.log`

Send that file with your report.
```

- [ ] **Step 2: Verify line endings and that the docs gates accept it**

```bash
node -e "const s=require('fs').readFileSync('docs/desktop-rollout.md','utf8');console.log('CR:',(s.match(/\r/g)||[]).length)"
npm run docs:claims:check > /tmp/rn-claims.log 2>&1; echo "CLAIMS_EXIT=$?"
tail -2 /tmp/rn-claims.log
```

Expected: `CR: 0`, `CLAIMS_EXIT=0`, and the ratchet reporting **none added** (this note cites no `path:LINE`).

- [ ] **Step 3: Commit**

```bash
git add docs/desktop-rollout.md
git commit --only docs/desktop-rollout.md -F - <<'EOF'
docs(desktop): rollout note for the first install

The packaged app gets a fresh Chromium profile, so the five sealed secrets
are not carried over and the app opens empty. That is correct and looks
exactly like data loss -- so it is stated plainly, along with the expected
SmartScreen prompt and the port-17300 message.

Written for a non-technical reader: no jargon, and it says what to send when
reporting a problem.

Claude-Session: https://[session link removed]
EOF
echo "EXIT=$?"
```

---

## Task 18: Full local gate chain

**Files:** none — this task only runs gates and fixes what they report.

⚠️ Never read a gate's exit code through a pipe. Never run two vitest processes at once.

- [ ] **Step 1: Typecheck**

```bash
npx tsc --noEmit > /tmp/g-tsc.log 2>&1; echo "EXIT=$?"
grep -c "error TS" /tmp/g-tsc.log
```

Expected: `0` errors. Read the count, not the exit code.

- [ ] **Step 2: Lint**

```bash
npx eslint --max-warnings=0 src desktop scripts e2e > /tmp/g-lint.log 2>&1; echo "EXIT=$?"
tail -5 /tmp/g-lint.log
```

Expected: EXIT=0. Use this form, not `npm run lint` — the latter exits 1 on gitignored `.worktrees/` leftovers.

- [ ] **Step 3: Unit suite**

```bash
npm run test:run > /tmp/g-unit.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " /tmp/g-unit.log
```

Expected: EXIT=0. The `Test Files` count must be **higher** than the number recorded in Task 6 Step 3, by exactly the four new `desktop/src/lib/*.test.ts` files.

- [ ] **Step 4: Shuffled suite**

```bash
npm run test:shuffle > /tmp/g-shuf.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " /tmp/g-shuf.log
```

Expected: EXIT=0. This is the only local reproduction of CI's `unit-tests-shuffled`.

- [ ] **Step 5: Version and docs gates**

```bash
npm run version:check > /tmp/g-ver.log 2>&1; echo "VERSION_EXIT=$?"
npm run docs:claims:check > /tmp/g-claims.log 2>&1; echo "CLAIMS_EXIT=$?"
npm run docs:symbols:check > /tmp/g-sym.log 2>&1; echo "SYMBOLS_EXIT=$?"
npm run followups:index:check > /tmp/g-fi.log 2>&1; echo "FI_EXIT=$?"
npm run followups:status:check > /tmp/g-fs.log 2>&1; echo "FS_EXIT=$?"
```

Expected: all EXIT=0. For `version:check`, confirm the output **names** `desktop/package.json` — a bare 0 does not prove it was read.

- [ ] **Step 6: File-size ratchet and duplication**

```bash
npm run size:check > /tmp/g-size.log 2>&1; echo "SIZE_EXIT=$?"
npm run dup:check > /tmp/g-dup.log 2>&1; echo "DUP_EXIT=$?"
```

Expected: both EXIT=0. Budget any file you touched with the node one-liner, not `wc -l` — the ratchet counts `split("\n").length`, which is `wc -l` **plus one**.

- [ ] **Step 7: Axe on affected views**

The desktop shell changes no app view, so this is a regression check only:

```bash
npx playwright test e2e/a11y.spec.ts --project=chromium --workers=1 > /tmp/g-axe.log 2>&1; echo "EXIT=$?"
tail -5 /tmp/g-axe.log
```

Expected: EXIT=0. `--workers=1` is mandatory: local runs default to CPU-count while CI runs axe serially, and over-subscribed tests die on a 60s timeout that prints as a failure with no violation text.

- [ ] **Step 8: Confirm the tree is clean**

```bash
git status --porcelain
```

Expected: **empty**. Any leftover file means a mutant or probe from an earlier task was not reverted.

---

## Definition of done

- [ ] Both spikes are committed as findings under `docs/superpowers/specs/_probes/`.
- [ ] `npm run desktop:build && npm run desktop:package` produces an `.exe` in `desktop/release/`.
- [ ] The installer installs **without** admin rights, and the installed app launches, is **styled**, and reports this checkout's version.
- [ ] Closing the window leaves **no** orphaned process.
- [ ] A second launch focuses the first window.
- [x] The smoke test's styling assertion is mutation-proved (Task 15 Step 4) — 2026-09-10:
      `MUTANT_EXIT=1` with 2 matches on the named message, `RESTORE_EXIT=0`, 2 passed. ★ It took
      TWO fixes to get there, both recorded in Task 15: the first mutant PASSED (Chromium's disk
      cache), and the second failed on the wrong assertion.
- [ ] The version satellite is mutation-proved (Task 3 Step 8).
- [ ] The rollout note exists, so the first-launch empty state is explained before a colleague meets it.
- [ ] The full gate chain in Task 18 is green, and `git status --porcelain` is empty.

**Not in this plan, by decision:** auto-update (spec Section 7 — needs spike 1's answer first), any version bump, any CHANGELOG entry, any push, any MR.
