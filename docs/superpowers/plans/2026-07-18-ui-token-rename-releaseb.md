# Release B — `AIPM-*` → `ui-*` Token Rename Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or
> superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Rename the 12 base palette tokens `AIPM-<color>` → `ui-<color>` across the whole repo
(Tailwind classes, CSS vars, `@theme` map, scheme registries, shipped theme JSON, palette guards,
tests, docs). Pure rename, zero visual/behavioral change.

**Architecture:** One anchored codemod moves every form atomically (a partial rename fails a gate:
code-without-tests fails vitest, guards-without-code fail palette). Then drive all gates green,
add the release, review, merge.

**Tech Stack:** Next.js 16 (forked) / React 19 / Tailwind v4 / TypeScript. Node codemod over
`git ls-files`. GitLab CI  (GitLab).

**Decisions (from spec `docs/superpowers/specs/2026-07-18-ui-token-rename-releaseb-design.md`):**
prefix `ui-`; exhaustive docs; no key migration; shipped `public/themes/*.json` rewritten to `--ui-*`;
protected = `AIPM` / `Acme` / `AIPM-consult` / `AIPM.json` / theme id `"AIPM"` / `AIPM-logo` / `AIPM-icon`.

**Branch:** `feat/ui-token-rename-releaseb` (already created).

---

## File Structure

- Create: `scripts/rename-AIPM-to-ui.mjs` (codemod; deleted before the release commit — a throwaway tool).
- Modify: ~235 source/test files, `src/app/globals.css`, `public/themes/AIPM.json`,
  `public/themes/mockup.json`, `src/app/scheme-tokens.ts`, `src/app/color-schemes.ts`,
  `src/app/scheme-apply.ts`, `src/app/boot-theme-script.ts`, the palette-guard test files, `AGENTS.md`,
  `CHANGELOG.md`, `README*`.
- Modify (release): `src/app/version.ts`, `src/app/i18n.ts`, `src/app/i18n.de.ts`.

---

## Task 1: Codemod — atomic rename

**Files:**
- Create: `scripts/rename-AIPM-to-ui.mjs`

- [ ] **Step 1: Write the codemod script**

```js
// scripts/rename-AIPM-to-ui.mjs
// One-shot: AIPM-<color> -> ui-<color>, anchored to the 12 palette suffixes so
// AIPM / Acme / AIPM-logo / AIPM-icon / AIPM.json can never match.
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

// Longest-first so green-strong is not half-matched into ui-green + -strong.
const SUFFIXES = [
  "dark-blue", "green-strong", "green", "pink-strong", "pink",
  "purple-strong", "purple", "blue", "white",
  "dark-grey", "light-grey", "medium-grey",
];
const RE = new RegExp(`AIPM-(${SUFFIXES.join("|")})\\b`, "g");

// Tracked text files only; skip binaries, lockfiles, jscpd baselines, this script.
const SKIP = /(^|\/)(package-lock\.json|docs\/baselines\/|scripts\/rename-AIPM-to-ui\.mjs$)/;
const TEXT = /\.(tsx?|css|json|md|mjs|cjs|js|webmanifest)$/;

const files = execSync("git ls-files", { encoding: "utf8" })
  .split("\n").map((s) => s.trim()).filter(Boolean)
  .filter((f) => TEXT.test(f) && !SKIP.test(f));

let changed = 0, hits = 0;
for (const f of files) {
  const src = readFileSync(f, "utf8");
  let n = 0;
  const out = src.replace(RE, (_, s) => { n++; return `ui-${s}`; });
  if (n > 0) { writeFileSync(f, out); changed++; hits += n; console.log(`  ${f}: ${n}`); }
}
console.log(`\nFiles changed: ${changed}  Replacements: ${hits}`);
```

- [ ] **Step 2: Run the codemod**

Run: `node scripts/rename-AIPM-to-ui.mjs`
Expected: several hundred replacements across ~235 files (a summary of `<file>: <n>` lines).

- [ ] **Step 3: Residual grep — confirm only protected `AIPM-` remains**

Run: `grep -rInoE -- "AIPM-[a-z-]+" src public AGENTS.md CHANGELOG.md | grep -vE "AIPM-(logo|icon)" | grep -viE "AIPM\.json|Acme|AIPM-consult"`
Expected: NO lines (empty). Any hit is either a missed token (fix the suffix list) or a new
protected string to add to the grep filter — inspect each.

- [ ] **Step 4: Confirm the AIPM identity strings survived**

Run: `grep -rIn -- '"AIPM"' src/app/theme-gallery.tsx && ls public/themes/AIPM.json && grep -rIn -- "AIPM" src/app/theme-gallery.tsx`
Expected: theme id `"AIPM"`, the `AIPM.json` file, and display name `"AIPM"` all still present.

- [ ] **Step 5: NUL byte scan**

Run: `python -c "import subprocess; [print('NUL',f) for f in subprocess.check_output(['git','ls-files']).decode().split() if b'\x00' in open(f,'rb').read()]"`
Expected: no `NUL` lines.

- [ ] **Step 6: Delete the codemod script**

Run: `rm scripts/rename-AIPM-to-ui.mjs`
(One-shot tool; not shipped. `docs:scripts:check` only guards `package.json` scripts, so an ad-hoc
`.mjs` needs no descriptor — but remove it to keep the tree clean.)

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -F - <<'EOF'
refactor(palette): rename AIPM-* palette tokens to ui-*

Neutral-prefix swap across Tailwind classes, CSS vars, @theme map, scheme
registries, shipped theme JSON keys, palette guards, tests. Pure rename,
no visual change. AIPM/Acme/AIPM.json/AIPM-logo preserved.
EOF
```

---

## Task 2: Drive gates green (repair misses)

A missed class pair renders wrong/blank and is invisible to tsc — the axe full run is the backstop.
Fix any failure by extending the suffix list or hand-patching the site, then re-run that gate.

**Files:** any surfaced by a failing gate.

- [ ] **Step 1: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0. (Ignore the known phantom 71007 RSC + pre-existing 6385 FormEvent-deprecated only.)

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: 0 warnings/errors.

- [ ] **Step 3: Unit/integration tests**

Run: `npx vitest run`
Expected: all green. Color-assertion suites to watch: `color-schemes`, `scheme-tokens`, `scheme-apply`,
`form-controls`, `absence-style`, `color-scheme-editor`, `layout-boot-script`, `shipped-themes`.

- [ ] **Step 4: Palette guard**

Run: `npx vitest run palette`
Expected: green (guards now enforce `ui-*`; the allowed-palette literals were renamed by the codemod).

- [ ] **Step 5: Size + duplication ratchets**

Run: `npm run size:check && npm run dup:check`
Expected: both pass (rename is length-neutral-ish; no new/grown files).

- [ ] **Step 6: Production build (globals.css must compile)**

Run: `npm run build`
Expected: success. A stray undefined `var(--AIPM-*)` yields a broken value, not an error — so also run
the axe gate next.

- [ ] **Step 7: Full axe / a11y gate — the real safety net**

Run: `npx playwright test e2e/a11y.spec.ts --project=chromium`
Expected: **80/80** across the 5 scheme/theme combos. A missed color class surfaces as a contrast fail
or blank. (Auto-retry the documented `timelog-panel` partial-toast flake once if it appears.)

- [ ] **Step 8: Eye-check one screen per scheme (manual backstop)**

Load the dev app, switch Harbor/Meridian/Umber (+ import AIPM + Dashboard from the gallery), glance at the
Dashboard + Open Points. No blank/wrong colors.

- [ ] **Step 9: Commit any repairs**

```bash
git add -A
git commit -F - <<'EOF'
fix(palette): patch AIPM->ui rename misses surfaced by gates
EOF
```
(Skip if Task 1 passed every gate with no repair.)

---

## Task 3: AGENTS.md supersede note + release finalization

**Files:**
- Modify: `AGENTS.md` (add supersede note; token strings already renamed by the codemod)
- Modify: `src/app/version.ts`, `CHANGELOG.md`, `src/app/i18n.ts`, `src/app/i18n.de.ts`

- [ ] **Step 1: Add the supersede note to AGENTS.md**

In the Phase-2 scheme bullet (near the "RELEASE A ... SUPERSEDES" note), add one line:

```
★★ RELEASE B (0.190.23): the palette token NAMES were renamed AIPM-*→ui-* (bg-AIPM-green→bg-ui-green,
--AIPM-green→--ui-green, @theme --color-AIPM-*→--color-ui-*). AIPM is now ONLY a theme display name /
importable /themes/AIPM.json — no token carries the brand word. The var NAMES + @theme MECHANISM are
unchanged, only the prefix.
```

- [ ] **Step 2: Verify AGENTS.md still compiles Tailwind (no bracket damage)**

Run: `grep -nE "\[[^]]*AIPM[^]]*\]" AGENTS.md`
Expected: no Tailwind arbitrary-value bracket contains a stray `AIPM`/invalid char (the note uses none).

- [ ] **Step 3: Bump version**

In `src/app/version.ts`: `APP_VERSION = "0.190.23"`, milestone stays `"Pinsker"`, update the build-date
comment, and append `versionHighlightUiTokenRename` to `APP_HIGHLIGHT_KEYS`.

- [ ] **Step 4: CHANGELOG entry**

Add `## [0.190.23] - "Pinsker"` with a "Palette token rename (`AIPM-*` → `ui-*`, no visual change)" line.

- [ ] **Step 5: i18n highlight key (EN)**

Add `versionHighlightUiTokenRename` to `src/app/i18n.ts` EN dict.

- [ ] **Step 6: i18n highlight key (DE) — node utf8 write, match `\r\n`, no `\uXXXX`**

Add the same key to `src/app/i18n.de.ts` via a node script that reads utf8, inserts after the matching
`\r\n` anchor, writes utf8. Real German umlauts, no ASCII subs, no `\u00XX` escapes.

- [ ] **Step 7: Verify i18n parity + DE encoding**

Run: `npx tsc --noEmit && npx vitest run i18n-encoding`
Expected: EN/DE key parity holds; encoding test passes.

- [ ] **Step 8: NUL scan + commit**

Run the NUL scan (Task 1 Step 5), then:

```bash
git add -A
git commit -F - <<'EOF'
chore(release): 0.190.23 "Pinsker" — palette token rename AIPM-*→ui-*
EOF
```

---

## Task 4: Review + release

- [ ] **Step 1: Superpowers code review** of the full branch diff (base = `main` merge `006c0906`).
  Fix CRITICAL/HIGH/MEDIUM; note minors.
- [ ] **Step 2: Re-run the full gate set** if review triggered any code change (tsc/lint/vitest/palette/
  size/dup/build/axe).
- [ ] **Step 3: Push** `git push https://gitlab.example.com/<group>/<subgroup>/aipm-cockpit.git feat/ui-token-rename-releaseb`
- [ ] **Step 4: Open MR** via `glab api projects/<PROJECT_ID>/merge_requests -X POST` (target `main`).
- [ ] **Step 5: Merge on green** — poll `head_pipeline`; on success `glab api "projects/<PROJECT_ID>/merge_requests/{iid}/merge" -X PUT`. Retry the timelog flake once if it fails.
- [ ] **Step 6: Sync main + update memory** — mark task 39 (Release B) shipped in
  `ds-sprawl-audit-p3-backlog.md`; the whole task-38 program is then complete.
