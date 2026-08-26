# Gate blind spots — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close four gaps in what CI can see — no `--max-warnings` gate, no version-sync gate, probabilistic anti-vacuity floors in the property suites, and two source files one line from a surprise ratchet failure — and close a fifth register entry whose residual is already discharged.

**Architecture:** Four independent changes plus one doc edit. Two add enforcement (an eslint flag in `package.json`; a new `scripts/check-version-sync.mjs` gate following the repo's existing lib + CLI + test split). One is a test-quality audit driven by a new measurement harness. One is a refactor survey that may or may not produce an extraction. Nothing touches product behaviour, so there is no version bump and no `CHANGELOG.md` entry.

**Tech Stack:** Node 24 ESM (`.mjs` scripts, no TypeScript in `scripts/`), eslint 9 flat config, vitest 4.1.8, fast-check, GitLab CI.

**Spec:** `docs/superpowers/specs/2026-08-26-gate-blind-spots-design.md`

**Branch:** `chore/gate-blind-spots`, already created from `origin/main` at `0.260.1 "Cho"`.

**One deliberate departure from the spec.** The spec puts the version gate's tests in
`scripts/check-version-sync.test.mjs`, beside the checker. This plan uses the repo's
established three-file split instead — `version-sync-lib.mjs` (pure) + `check-version-sync.mjs`
(CLI) + `version-sync-lib.test.mjs` — matching `agents-symbols-lib` and `doc-claims-lib`. Same
coverage, same gate, and it keeps the tested surface free of `process.exit`.

---

## Domain primer — read this before Task 1

You are working in a project-management web app. This slice touches **no product code except in Task 13/14**; everything else is repo tooling.

### The five register entries

`docs/open-followups.md` is a numbered register of known-open defects. Entries are cited as `§NNN`. This plan addresses §214, §236, §244, §229 and §60. Read each entry before its task — `sed -n '/^## 214[.]/,/^## 215[.]/p' docs/open-followups.md` and so on.

### Rules that will bite you if you skip them

1. **Never read a gate's exit code through a pipe.** `npm run test:run | tail -8` exits 0 while tests fail, because that is `tail`'s status. Always: `cmd > /path/log 2>&1; echo "EXIT=$?"` then read the log. This plan writes every verification that way.

2. **`git checkout -- <file>` is deny-blocked** in this environment. To revert a deliberate mutation, write the inverse edit with an anchored replacement, assert the anchor matched exactly once, then prove `git diff --stat` is empty.

3. **Never `git commit --amend`.** The worktree is shared; amend has twice swallowed another session's commit. Make new commits. Use `git commit --only <paths>` to scope a commit — `git add` alone does not scope it.

4. **Never bare `git stash` / `git stash pop`.** The stash stack is shared across worktrees.

5. **`npm run lint` exits 1 from gitignored leftovers** (`.worktrees/`, `.demo-tmp/`) if any are present. For a clean measurement use `npx eslint src`. This is orthogonal to the flag this plan adds.

6. **`npx tsc --noEmit` exits 2 on diagnostics**, not 1. Test for non-zero, not for 1.

7. **Never run two vitest processes at once.** A vitest failure carrying `Failed to start forks worker` is machine contention, not a real failure.

8. **Line endings are split.** `*.md` is pinned LF by `.gitattributes`. `package.json`, `package-lock.json` and everything under `src/` are LF in the index and **CRLF in the working tree** under `core.autocrlf=true`. A tool that rewrites one of those files with LF re-lines it invisibly to `git diff`. Check with `git ls-files --eol <file>`: `i/lf w/crlf` is healthy for those, `i/lf w/lf` means it was re-lined.

9. **Do not use `sed -i`** on any file under `src/`, `package.json` or `package-lock.json` — under Git Bash it re-lines the whole file to LF.

9b. ★★★ **THE `Write` TOOL RE-LINES A CRLF FILE TO LF. THE `Edit` TOOL DOES NOT.** Measured 2026-08-26 by two controlled probes against the same CRLF fixture, not reasoned:

| tool | fixture in | file out |
|---|---|---|
| `Edit` (insert a new first line) | 3 CRLF, 0 bare LF | **4 CRLF, 0 bare LF** — preserved, inserted line got `\r\n` |
| `Write` (overwrite whole file) | 2 CRLF, 0 bare LF | **0 CRLF, 3 bare LF** — whole file re-lined |

   So: **use `Edit` on any existing CRLF file. Reserve `Write` for genuinely new files, and re-line them afterwards if their siblings are CRLF.** Under `core.autocrlf=true` everything outside `*.md` is `i/lf w/crlf` — that includes `src/**`, `scripts/**`, `package.json` and `package-lock.json` (`git check-attr -a` prints nothing for them, so autocrlf alone governs).

   **It is invisible to `git diff`.** The clean filter normalises both forms to the same blob, so a re-lined file shows no diff, commits to the byte-identical blob, and `git status` can report it clean. The damage is LOCAL, not to the repository — but it breaks the next `\r\n`-anchored edit, which is how it surfaces.

   Two instances hit this slice. `src/app/icons.ts` came out of Task 2's mutant-injection step at LF, so the revert anchor ending in `\r\n` matched **0 times** and the first revert did nothing. Task 4's two new `scripts/*.mjs` landed `w/lf` while **every** existing script in that directory is `w/crlf`. Both were repaired content-preserving (`s.replace(/(?<!\r)\n/g, "\r\n")`) and verified by `git hash-object` matching the HEAD blob exactly.

   ★★ **Detect it, do not assume it.** `git ls-files --eol <file>` reports index and working tree separately, which is the distinction this turns on: `i/lf w/crlf` is healthy for these paths, `i/lf w/lf` means it was re-lined. Run it after ANY write into such a file and BEFORE relying on a `\r\n` anchor.

   ★ An earlier revision of this rule said the cause was unestablished and named `Edit` as the acquitted suspect. `Edit` is still acquitted; the culprit was found by noticing that Task 4's new files carried the same signature, and probing the other tool.

10. **Escape bytes corrupt through tool boundaries.** Writing prose containing a backslash-b through a heredoc can deliver a literal U+0008, which renders as nothing and is invisible to review. After writing any file containing regex escapes, scan it:

```bash
node -e 'const s=require("fs").readFileSync(process.argv[1],"utf8");
  const bad=/[\x00-\x08\x0b\x0c\x0e-\x1f]/;let n=0;
  s.split("\n").forEach((l,i)=>{if(bad.test(l)){n++;console.log("CONTROL CHAR line",i+1,JSON.stringify(l));}});
  console.log("control-char hits:",n);' <file>
```

### The gate-script idiom

A testable gate in this repo is **three files**:

- `scripts/<name>-lib.mjs` — pure logic, exported functions, no `process.exit`
- `scripts/check-<name>.mjs` — thin CLI that imports the lib, prints, and exits
- `scripts/<name>-lib.test.mjs` — vitest tests over the lib

`vitest.config.ts` `include` already covers `scripts/**/*.{test,spec}.mjs`, and `coverage.include` is `src/**/*.{ts,tsx}` only, so a script test raises no coverage floor. Model to copy: `scripts/agents-symbols-lib.mjs` + `scripts/check-agents-symbols.mjs` + `scripts/agents-symbols-lib.test.mjs`.

### Adding a script to package.json

Every visible script needs a `scriptsDescriptions` entry, and `README.md` + `CONTRIBUTING.md` carry AUTO-GENERATED tables built from it. After adding a script run `npm run docs:scripts` to regenerate, or `npm run docs:scripts:check` (which runs in `prebuild`) fails.

---

## File structure

**Created:**

| File | Responsibility |
|---|---|
| `scripts/version-sync-lib.mjs` | Pure: read `APP_VERSION`/`APP_MILESTONE`, describe the six satellites, read and rewrite each. No I/O policy, no exit codes. |
| `scripts/check-version-sync.mjs` | CLI over the lib: prints every reading, exits 1 on drift, `--update` propagates. |
| `scripts/version-sync-lib.test.mjs` | Tests over the lib, using fixture strings — never the real repo files. |
| `scripts/measure-property-floor.mjs` | Runs a counting closure N times, reports P(counter below floor). |

**Modified:**

| File | Change |
|---|---|
| `package.json` | `lint` gains `--max-warnings=0`; two new scripts + two `scriptsDescriptions` entries |
| `.gitlab-ci.yml` | new blocking `version-sync-check` job in the `quality` stage |
| `README.md`, `CONTRIBUTING.md` | regenerated AUTO-GENERATED script tables |
| `AGENTS.md` | three claims rewritten (two for §214, one for §236) |
| `CONTRIBUTING.md` | one §214 claim rewritten |
| `docs/CODEMAPS/architecture.md` | one §214 claim rewritten |
| `docs/open-followups.md` | §214, §236, §244, §229, §60 status edits + the §244 measurement correction |
| `src/app/entity-id-mint.property.test.ts` | constructed branch arbitrary |
| Further `*.property.test.ts` files | determined by the Task 9 audit |
| `src/app/use-chat-dispatcher.ts`, `src/app/use-storage-backend.ts` | determined by the Task 13 survey |

---

## Task 1: §214 — measure the baseline before changing anything

**Files:** none modified.

- [ ] **Step 1: Confirm the tree is clean and on the right branch**

```bash
git branch --show-current; git status --porcelain
```

Expected: `chore/gate-blind-spots` and no output from the second command. If there is output, stop and ask — do not stash.

- [ ] **Step 2: Measure the current warning count**

A run that exits 0 does not prove there are no warnings; it proves nothing failed. Get a per-file report instead. Note `-o` writes the file, so stderr must go somewhere else or `npm notice` lines corrupt the JSON.

```bash
npx eslint --max-warnings=0 -f json -o /tmp/lint-baseline.json > /tmp/lint-baseline.log 2>&1; echo "EXIT=$?"
node -e 'const r=require("/tmp/lint-baseline.json");
  console.log(r.length,"files",
    r.reduce((a,f)=>a+f.warningCount,0),"warnings",
    r.reduce((a,f)=>a+f.errorCount,0),"errors");'
```

Expected: `1800 files 0 warnings 0 errors` (the file count may differ slightly; the two zeros are what matter).

**If the zeros are not zero, stop and report.** The whole plan for §214 assumes no cleanup pass is needed. A non-zero count means the codebase changed since the design measurement and the task needs re-scoping.

- [ ] **Step 3: Record what the flag will promote**

```bash
npx eslint --print-config src/app/icons.ts > /tmp/ec.json 2>/tmp/ec.err; echo "EXIT=$?"
node -e 'const r=require("/tmp/ec.json").rules,s=(v)=>Array.isArray(v)?v[0]:v;
  const w=Object.entries(r).filter(([,v])=>s(v)===1||s(v)==="warn").map(([k])=>k);
  console.log("severity-1:",w.length);console.log(w.join("\n"));'
```

Expected: `severity-1: 25`, listing `react-hooks/exhaustive-deps`, three `react-hooks/*`, 13 `@next/next/*`, 7 `jsx-a11y/*`, `import/no-anonymous-default-export`, `@typescript-eslint/no-unused-expressions` and `@typescript-eslint/no-unused-vars`.

No commit — this task only establishes the baseline.

---

## Task 2: §214 — add the flag and prove it is live

**Files:**
- Modify: `package.json` (the `scripts.lint` value)

- [ ] **Step 1: Change the script**

Change the `lint` script from `eslint` to `eslint --max-warnings=0`. The `scripts` block currently reads:

```json
    "lint": "eslint",
```

It must read:

```json
    "lint": "eslint --max-warnings=0",
```

Use the Edit tool, not `sed -i` — `package.json` is CRLF in the working tree.

**The flag goes here, not in `.gitlab-ci.yml`.** Putting it in the CI job re-creates the divergence that caused this entry: `npm run lint` green locally while CI enforces something stricter.

- [ ] **Step 2: Verify line endings survived the edit**

```bash
git ls-files --eol package.json
```

Expected: `i/lf    w/crlf`. If it reports `w/lf`, the file was re-lined — restore it and use a different editing method.

- [ ] **Step 3: Verify the gate still passes**

```bash
npx eslint src > /tmp/lint-after.log 2>&1; echo "EXIT=$?"
```

Expected: `EXIT=0`.

(`npx eslint src` rather than `npm run lint` here: `npm run lint` also walks gitignored leftover directories if any exist locally, which is unrelated noise.)

- [ ] **Step 4: Prove the gate can actually fail**

A green run cannot distinguish a wired flag from an unwired one. Introduce a real violation. `src/app/icons.ts` is a barrel with no side effects, so an unused import there is inert at runtime.

Add this as the first line of `src/app/icons.ts`:

```ts
import { useState } from "react";
```

Then run:

```bash
npm run lint -- src/app/icons.ts > /tmp/lint-mutant.log 2>&1; echo "EXIT=$?"
grep -c "no-unused-vars" /tmp/lint-mutant.log
```

Expected: `EXIT=1` and a count of at least 1. **If `EXIT=0`, the flag is not wired — stop and diagnose.**

★★★ **THE PROOF MUST GO THROUGH `npm run lint`, AND THE FIRST VERSION OF THIS STEP DID NOT.** It
said `npx eslint src/app/icons.ts`, which invokes eslint directly and therefore never sees a flag
that lives only in the npm script — so it exits **0** on a genuinely mutated file. Measured
2026-08-26 during execution: on the mutated `icons.ts`, `npx eslint src/app/icons.ts` gave `EXIT=0`
while `npm run lint -- src/app/icons.ts` gave `EXIT=1` with one `no-unused-vars`. A mutation proof
that cannot fail is worse than none — it reports the gate as unwired when it is wired, and would
report it as wired if the step were ever reused with the expectation inverted. `npx eslint
--max-warnings=0 src/app/icons.ts` also goes red, but it proves only that eslint's own flag works,
**not** that `package.json` carries it; only the `npm run lint` form tests what CI runs.

★ Steps 3 and 6 use bare `npx eslint src` and that is fine — they expect zero warnings, which passes
with or without the flag, so nothing there turns on the distinction.

- [ ] **Step 5: Revert the mutant and prove the tree is clean**

`git checkout --` is deny-blocked. Remove the line with an anchored write that asserts it matched exactly once:

```bash
node -e '
const fs=require("fs"),p="src/app/icons.ts";
const anchor="import { useState } from \"react\";\r\n";
let s=fs.readFileSync(p,"utf8");
const n=s.split(anchor).length-1;
if(n!==1){console.error("anchor matched "+n+" times, expected 1 — NOT writing");process.exit(1);}
fs.writeFileSync(p,s.replace(anchor,""));
console.log("mutant removed");'
git diff --stat
```

Expected: `mutant removed`, and `git diff --stat` showing **only** `package.json`. If `icons.ts` still appears, the revert failed.

Note the `\r\n` in the anchor — `src/**` is CRLF in the working tree, and an anchor ending in a bare `\n` silently matches nothing.

- [ ] **Step 6: Re-run the gate clean**

```bash
npx eslint src > /tmp/lint-clean.log 2>&1; echo "EXIT=$?"
```

Expected: `EXIT=0`.

- [ ] **Step 7: Commit**

```bash
git commit --only package.json -m "ci: make eslint warnings fatal

CI's lint job runs bare `npm run lint` and that script was bare `eslint`,
so `@typescript-eslint/no-unused-vars` at severity 1 could not fail it and
`tsconfig.json` sets no `noUnusedLocals` — an unused import shipped green.

The flag goes in the script rather than the CI job so local and CI stay
identical; putting it in the job is what made the gap confusing.

It promotes all 25 severity-1 rules, not just unused-vars: 7 jsx-a11y and
13 @next/next rules come along. Measured green first (1800 files, 0
warnings, 0 errors) because the exception sites already carry inline
eslint-disable comments, so this codifies existing practice.

Closes §214 (code half; the doc ripple follows)."
```

---

## Task 3: §214 — the doc ripple

**Files:**
- Modify: `AGENTS.md` (two claims), `CONTRIBUTING.md` (one), `docs/CODEMAPS/architecture.md` (one)

Four sentences assert the gate is absent and are now false. Three further hits merely use the flag in example commands and must be left alone.

- [ ] **Step 1: List the hits**

```bash
grep -rn -- "--max-warnings" AGENTS.md CONTRIBUTING.md docs/CODEMAPS/architecture.md
```

Expected: 7 lines — `AGENTS.md:101`, `AGENTS.md:115`, `AGENTS.md:344`, `AGENTS.md:351`, `CONTRIBUTING.md:453`, `CONTRIBUTING.md:455`, `docs/CODEMAPS/architecture.md:70`. Line numbers may have shifted; match on content.

Do **not** add `docs/open-followups.md` to that command. It is self-matching — §214, §45 and §53 all quote the flag — so the count moves every time the entry is edited.

- [ ] **Step 2: Rewrite the AGENTS.md commands-block claim**

In `AGENTS.md`, the `npm run lint` block currently opens:

```
npm run lint                # eslint — ★★★ there is NO `--max-warnings` gate: CI's `lint:` job runs bare
                            # `npm run lint`, `@typescript-eslint/no-unused-vars` is severity 1, and
                            # `noUnusedLocals` does not exist in tsconfig.json — so an unused import/var
                            # SHIPS GREEN. Keep them out by hand; `_`-prefixed params are NOT exempt
                            # (no argsIgnorePattern), so re-check after every extract. Verify severity:
```

Replace those five lines with:

```
npm run lint                # eslint --max-warnings=0 — ★★★ EVERY warning is now FATAL, and that is 25
                            # rules, not one: `@typescript-eslint/no-unused-vars` is still severity 1 and
                            # `noUnusedLocals` still does not exist in tsconfig.json, but the flag makes
                            # both moot. `_`-prefixed params are NOT exempt (no argsIgnorePattern), so an
                            # unused param from an extract now FAILS rather than warning. Verify severity:
```

Keep the `npx eslint --print-config src/app/icons.ts   (read .rules)` line that follows, and the `react-hooks/exhaustive-deps` line after it — but that line says `(severity 1, so NOT fatal)`, which is now false. Change it from:

```
                            # react-hooks/exhaustive-deps (severity 1, so NOT fatal) rejects an `obj.member` dep (e.g.
```

to:

```
                            # react-hooks/exhaustive-deps (severity 1 — FATAL since --max-warnings=0) rejects an `obj.member` dep (e.g.
```

- [ ] **Step 3: Rewrite the "STRICTER than CI" claim**

The relationship inverts rather than disappearing, so this is a rewrite, not a deletion. Change:

```
                            # ★ `npx eslint --max-warnings=0 src/app` is STRICTER than CI, not a
                            # reproduction of it.
```

to:

```
                            # ★ `npx eslint --max-warnings=0 src/app` now matches CI's STRICTNESS but not
                            # its SCOPE — CI lints the whole repo, this lints one directory.
```

- [ ] **Step 4: Leave AGENTS.md:344 and :351 alone**

Both sit inside the "never read a gate's exit code through a pipe" section and use the flag as an example command. They remain correct.

- [ ] **Step 5: Rewrite the CONTRIBUTING.md claim**

Change:

```
  `eslint` with no `--max-warnings`, so it exits 0 on warnings and only ERRORS
  fail the job — check a stricter posture locally with
  `npx eslint --max-warnings=0 src/app`.
```

to:

```
  `eslint --max-warnings=0`, so a WARNING fails the job exactly as an error
  does — all 25 severity-1 rules included, among them
  `react-hooks/exhaustive-deps` and seven `jsx-a11y` rules.
```

Also fix the two lines above it, which introduce that sentence with `★★ But`:

```
  corrected 2026-08-09 against `.gitlab-ci.yml`.) ★★ But `npm run lint` is bare
```

becomes:

```
  corrected 2026-08-09 against `.gitlab-ci.yml`.) ★★ And `npm run lint` is
```

- [ ] **Step 6: Rewrite the architecture codemap claim**

Change:

```
`install → quality → build → e2e`. Quality is blocking: lint (bare `eslint` — there is NO `--max-warnings` flag, so warnings do not
fail it; only errors do), `tsc --noEmit`,
```

to:

```
`install → quality → build → e2e`. Quality is blocking: lint (`eslint --max-warnings=0` — a warning fails
the job exactly as an error does), `tsc --noEmit`,
```

- [ ] **Step 7: Re-run the enumeration and confirm no absence claim survives**

```bash
grep -rn -- "--max-warnings" AGENTS.md CONTRIBUTING.md docs/CODEMAPS/architecture.md
```

Expected: still 7 lines (the four rewritten ones still mention the flag), and **none** of them asserting the gate is absent. Read each one to confirm.

- [ ] **Step 8: Mark §214 closed in the register**

The register's convention is that closure lives in the `##` heading, after an em-dash, as the literal marker `— CLOSED`. Change the heading from:

```
## 214. There is no `--max-warnings` gate anywhere, so an unused import ships green through CI
```

to:

```
## 214. There is no `--max-warnings` gate anywhere, so an unused import ships green through CI — CLOSED 2026-08-26
```

Then add this paragraph immediately below the entry's `**Status:**` line:

```
★★ CLOSED 2026-08-26 on `chore/gate-blind-spots`. `package.json`'s `lint` script is now
`eslint --max-warnings=0`, the wide route this entry recommends. The four doc sentences that
asserted the gate was absent were rewritten in the same commit; the three that merely USE the flag
in an example command were left alone. The narrow route (promoting the single rule in
`eslint.config.mjs`) was NOT taken and remains unavailable to an agent — that file is hook-protected.
```

- [ ] **Step 9: Verify the doc gates still pass**

```bash
npm run docs:symbols:check > /tmp/symbols.log 2>&1; echo "EXIT=$?"
npm run docs:claims:check > /tmp/claims.log 2>&1; echo "EXIT=$?"
tail -3 /tmp/symbols.log /tmp/claims.log
```

Expected: both `EXIT=0`.

- [ ] **Step 10: Commit**

```bash
git commit --only AGENTS.md CONTRIBUTING.md docs/CODEMAPS/architecture.md docs/open-followups.md -m "docs: correct the four claims that the lint gate falsified

Four sentences asserted there is no --max-warnings gate. All four are now
false and are rewritten rather than deleted — the 'STRICTER than CI' one
especially, since that relationship inverts rather than disappearing: the
flag now matches CI's strictness and differs only in scope.

The three remaining hits use the flag in example commands and stay.
open-followups.md is deliberately excluded from the enumeration command —
it is self-matching, so its count moves whenever the entry is edited.

Closes §214."
```

---

## Task 4: §236 — the version-sync lib, test-first

**Files:**
- Create: `scripts/version-sync-lib.test.mjs`
- Create: `scripts/version-sync-lib.mjs`

Read §236 first: `sed -n '/^## 236[.]/,/^## 237[.]/p' docs/open-followups.md`.

**The design constraint that shapes everything here:** one regex per satellite, with three capture groups — prefix, value, suffix. The reader takes group 2; the writer replaces group 2 and re-emits groups 1 and 3 verbatim. Reader and writer therefore cannot drift, and a shape change breaks both at once rather than silently breaking one.

**`package-lock.json` holds 681 `"version":` keys.** Both targets must be anchored on the `"name": "aipm-cockpit",` line immediately above them, or the writer rewrites every dependency pin.

- [ ] **Step 1: Write the failing test**

Create `scripts/version-sync-lib.test.mjs`:

```js
// Tests for the version-sync gate's shared layer.
//
// ★★ Every case here runs against FIXTURE STRINGS, never the real repo files.
// A test that reads package.json passes or fails depending on whether someone
// happens to be mid-release, which makes it a clock rather than a test.
import { describe, expect, it } from "vitest";

import { SATELLITES, applyValue, readSourceFrom, readValue } from "./version-sync-lib.mjs";

const sat = (file) => {
  const s = SATELLITES.find((x) => x.file === file);
  if (!s) throw new Error(`no satellite descriptor for ${file}`);
  return s;
};

const PKG = '{\r\n  "name": "aipm-cockpit",\r\n  "version": "0.260.1",\r\n  "private": true\r\n}\r\n';
const LOCK_ROOT = '{\r\n  "name": "aipm-cockpit",\r\n  "version": "0.260.1",\r\n  "lockfileVersion": 3,\r\n';
const LOCK_PKGS =
  '  "packages": {\r\n    "": {\r\n      "name": "aipm-cockpit",\r\n      "version": "0.260.1",\r\n' +
  '      "dependencies": {\r\n        "left-pad": {\r\n          "version": "1.1.1"\r\n';
const LOCK = LOCK_ROOT + LOCK_PKGS;
const BADGE =
  "[![version](https://img.shields.io/badge/version-v0.260.1_%22Cho%22-2e7d32)](./CHANGELOG.md)\n";
const CODEMAP = '<!-- Generated: 2026-07-30 | App 0.260.1 "Cho" | Files scanned: 1808 -->\n';

describe("readSourceFrom", () => {
  it("reads the version and the codename", () => {
    const src = 'export const APP_VERSION = "1.2.3";\nexport const APP_MILESTONE = "Zelazny";\n';
    expect(readSourceFrom(src)).toEqual({ version: "1.2.3", milestone: "Zelazny" });
  });

  it("throws rather than returning a partial reading when a declaration is gone", () => {
    // A probe that silently reports IN SYNC because its regex stopped matching
    // is the failure mode this register keeps recording.
    expect(() => readSourceFrom('export const APP_MILESTONE = "Zelazny";\n')).toThrow(/APP_VERSION/);
    expect(() => readSourceFrom('export const APP_VERSION = "1.2.3";\n')).toThrow(/APP_MILESTONE/);
  });
});

describe("readValue", () => {
  it("reads package.json's version", () => {
    expect(readValue(sat("package.json"), PKG)).toEqual({ version: "0.260.1" });
  });

  it("reads BOTH of package-lock.json's versions", () => {
    expect(readValue(sat("package-lock.json"), LOCK)).toEqual({
      version: "0.260.1",
      version2: "0.260.1",
    });
  });

  it("reads the README badge's version AND codename", () => {
    expect(readValue(sat("README.md"), BADGE)).toEqual({ version: "0.260.1", milestone: "Cho" });
  });

  it("reads a codemap header's version AND codename", () => {
    expect(readValue(sat("docs/CODEMAPS/*.md"), CODEMAP)).toEqual({
      version: "0.260.1",
      milestone: "Cho",
    });
  });

  it("throws when the shape it depends on has moved", () => {
    expect(() => readValue(sat("README.md"), "[![version](no-badge-here)]\n")).toThrow(/README\.md/);
  });
});

describe("applyValue", () => {
  it("rewrites package.json's version and nothing else", () => {
    const out = applyValue(sat("package.json"), PKG, "9.9.9", "Zelazny");
    expect(out).toContain('"version": "9.9.9"');
    expect(out).toContain('"private": true');
    expect(readValue(sat("package.json"), out)).toEqual({ version: "9.9.9" });
  });

  it("rewrites BOTH lock versions and leaves dependency pins untouched", () => {
    // The whole reason both regexes anchor on the "name" line above them:
    // package-lock.json carries 681 "version" keys in the real repo.
    const out = applyValue(sat("package-lock.json"), LOCK, "9.9.9", "Zelazny");
    expect(readValue(sat("package-lock.json"), out)).toEqual({
      version: "9.9.9",
      version2: "9.9.9",
    });
    expect(out).toContain('"version": "9.9.9"');
    // The dependency pin is a DIFFERENT version on purpose: if it shared the
    // target version, a writer that rewrote every "version" key would still
    // satisfy this assertion.
    expect(out).toContain('"left-pad": {\r\n          "version": "1.1.1"');
  });

  it("rewrites the README badge's version and codename together", () => {
    const out = applyValue(sat("README.md"), BADGE, "9.9.9", "Zelazny");
    expect(readValue(sat("README.md"), out)).toEqual({ version: "9.9.9", milestone: "Zelazny" });
    expect(out).toContain("-2e7d32)](./CHANGELOG.md)");
  });

  it("rewrites a codemap header and leaves the rest of the comment alone", () => {
    const out = applyValue(sat("docs/CODEMAPS/*.md"), CODEMAP, "9.9.9", "Zelazny");
    expect(readValue(sat("docs/CODEMAPS/*.md"), out)).toEqual({
      version: "9.9.9",
      milestone: "Zelazny",
    });
    expect(out).toContain("Files scanned: 1808");
    expect(out).toContain("Generated: 2026-07-30");
  });

  it("preserves CRLF in a CRLF fixture and LF in an LF fixture", () => {
    // package.json and package-lock.json are CRLF in the working tree under
    // core.autocrlf; *.md is pinned LF by .gitattributes. A writer that
    // normalises either one re-lines the file invisibly to `git diff`.
    const crlf = applyValue(sat("package.json"), PKG, "9.9.9", "Zelazny");
    expect(crlf.includes("\r\n")).toBe(true);
    expect(/(?<!\r)\n/.test(crlf)).toBe(false);

    const lf = applyValue(sat("README.md"), BADGE, "9.9.9", "Zelazny");
    expect(lf.includes("\r")).toBe(false);
  });

  it("is a no-op when the value already matches", () => {
    expect(applyValue(sat("package.json"), PKG, "0.260.1", "Cho")).toBe(PKG);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run scripts/version-sync-lib.test.mjs > /tmp/vs-red.log 2>&1; echo "EXIT=$?"
tail -20 /tmp/vs-red.log
```

Expected: non-zero exit, failing to resolve `./version-sync-lib.mjs`.

- [ ] **Step 3: Write the lib**

Create `scripts/version-sync-lib.mjs`:

```js
// scripts/version-sync-lib.mjs — shared layer for the version-sync gate.
//
// WHY: src/app/version.ts is the source of truth for the app version and
// codename, and six other places restate one or both. Nothing compared them
// until this gate: `grep -rn "APP_VERSION" scripts/ .gitlab-ci.yml` returned
// nothing. They have drifted before and silently — package.json six releases
// behind, package-lock.json eleven, while version.ts and CHANGELOG.md were
// correct.
//
// ★★★ ONE REGEX PER SATELLITE, THREE CAPTURE GROUPS: prefix, value, suffix.
// The reader takes the value group; the writer replaces it and re-emits the
// other two verbatim. Reader and writer therefore cannot drift, and a shape
// change breaks BOTH at once rather than silently breaking one — which is the
// failure this register keeps recording, a probe reporting IN SYNC because its
// regex stopped matching.
//
// ★★★ package-lock.json carries 681 `"version":` keys. Both of its targets are
// anchored on the `"name": "aipm-cockpit",` line directly above them. An
// unanchored replace would rewrite every dependency pin in the lockfile.
//
// ★★ NEVER JSON.parse -> JSON.stringify these files. It reformats the whole
// document and normalises line endings; package.json and package-lock.json are
// CRLF in the working tree under core.autocrlf while *.md is pinned LF by
// .gitattributes. Targeted text replacement only.

export const SOURCE_FILE = "src/app/version.ts";

/** Read APP_VERSION and APP_MILESTONE out of version.ts source text. */
export function readSourceFrom(text) {
  const v = /export const APP_VERSION = "([^"]+)"/.exec(text);
  if (!v) throw new Error(`${SOURCE_FILE}: APP_VERSION declaration not found — shape moved`);
  const m = /export const APP_MILESTONE = "([^"]+)"/.exec(text);
  if (!m) throw new Error(`${SOURCE_FILE}: APP_MILESTONE declaration not found — shape moved`);
  return { version: v[1], milestone: m[1] };
}

// Each descriptor carries one or two patterns. `kind` says which source value a
// pattern is compared against: "version" or "milestone".
export const SATELLITES = [
  {
    file: "package.json",
    label: "package.json version",
    patterns: [
      { key: "version", kind: "version", re: /("name": "[^"]+",\r?\n  "version": ")([^"]+)(")/ },
    ],
  },
  {
    file: "package-lock.json",
    label: "package-lock.json root + packages[''] version",
    patterns: [
      { key: "version", kind: "version", re: /(^\{\r?\n  "name": "[^"]+",\r?\n  "version": ")([^"]+)(")/ },
      {
        key: "version2",
        kind: "version",
        re: /(    "": \{\r?\n      "name": "[^"]+",\r?\n      "version": ")([^"]+)(")/,
      },
    ],
  },
  {
    file: "README.md",
    label: "README shields badge",
    patterns: [
      { key: "version", kind: "version", re: /(badge\/version-v)([^_]+)(_%22)/ },
      { key: "milestone", kind: "milestone", re: /(badge\/version-v[^_]+_%22)([^%]+)(%22)/ },
    ],
  },
  {
    // Glob, not a path: every file under docs/CODEMAPS carries the header.
    file: "docs/CODEMAPS/*.md",
    label: "codemap generated header",
    patterns: [
      { key: "version", kind: "version", re: /(\| App )([^ ]+)( ")/ },
      { key: "milestone", kind: "milestone", re: /(\| App [^ ]+ ")([^"]+)(")/ },
    ],
  },
];

/** Read every pattern's value out of one file's text. Throws if a shape moved. */
export function readValue(satellite, text) {
  const out = {};
  for (const p of satellite.patterns) {
    const m = p.re.exec(text);
    if (!m) {
      throw new Error(
        `${satellite.file}: the ${p.key} pattern did not match — the shape moved. ` +
          `Refusing to report a reading rather than reporting a wrong one.`,
      );
    }
    out[p.key] = m[2];
  }
  return out;
}

/** Rewrite every pattern's value in one file's text. Throws if a shape moved. */
export function applyValue(satellite, text, version, milestone) {
  let out = text;
  for (const p of satellite.patterns) {
    if (!p.re.test(out)) {
      throw new Error(`${satellite.file}: the ${p.key} pattern did not match — the shape moved.`);
    }
    const value = p.kind === "version" ? version : milestone;
    out = out.replace(p.re, (_m, a, _v, z) => a + value + z);
  }
  return out;
}

/** Compare one file's readings against the source. Returns an array of messages. */
export function diffSatellite(satellite, readings, version, milestone) {
  const problems = [];
  for (const p of satellite.patterns) {
    const want = p.kind === "version" ? version : milestone;
    const got = readings[p.key];
    if (got !== want) problems.push(`${satellite.file} ${p.key}: ${got} (expected ${want})`);
  }
  return problems;
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run scripts/version-sync-lib.test.mjs > /tmp/vs-green.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " /tmp/vs-green.log
```

Expected: `EXIT=0`, all tests passing.

- [ ] **Step 5: Scan the new files for corrupted escape bytes**

Both files carry regex escapes, which is exactly where a lost backslash level hides.

```bash
for f in scripts/version-sync-lib.mjs scripts/version-sync-lib.test.mjs; do
  node -e 'const s=require("fs").readFileSync(process.argv[1],"utf8");
    const bad=/[\x00-\x08\x0b\x0c\x0e-\x1f]/;let n=0;
    s.split("\n").forEach((l,i)=>{if(bad.test(l)){n++;console.log(process.argv[1]+":"+(i+1),JSON.stringify(l));}});
    console.log(process.argv[1],"control-char hits:",n);' "$f"
done
```

Expected: `control-char hits: 0` for both.

- [ ] **Step 6: Commit**

```bash
git add scripts/version-sync-lib.mjs scripts/version-sync-lib.test.mjs
git commit --only scripts/version-sync-lib.mjs scripts/version-sync-lib.test.mjs -m "test: pin the version-sync reader and writer against fixtures

One regex per satellite with prefix/value/suffix groups, so the reader and
the writer share a pattern and cannot drift — a shape change breaks both at
once instead of silently breaking one.

Both package-lock.json targets anchor on the 'name' line above them. The
real lockfile carries 681 version keys, so an unanchored replace would
rewrite every dependency pin; the test pins that with a fixture carrying a
dependency at the same version.

Fixtures rather than the real files throughout: a test that reads
package.json passes or fails depending on whether someone is mid-release."
```

---

## Task 5: §236 — the CLI and the writer

**Files:**
- Create: `scripts/check-version-sync.mjs`

- [ ] **Step 1: Write the CLI**

Create `scripts/check-version-sync.mjs`:

```js
#!/usr/bin/env node
// scripts/check-version-sync.mjs — fail when a version restatement has drifted
// from src/app/version.ts.
//
// Pass --update to propagate version.ts's values to every satellite.
//
// ★ It PRINTS EVERY READING before its verdict, so a green result is
// falsifiable rather than asserted. A gate whose output is one word cannot be
// distinguished from a gate that scanned nothing.
//
// ★★ It THROWS if a shape it depends on has moved, rather than reporting IN
// SYNC on a regex that stopped matching. That is deliberate: a probe that
// silently passes because it stopped looking is the failure mode this exists
// to prevent.

import fs from "node:fs";
import path from "node:path";

import {
  SATELLITES,
  SOURCE_FILE,
  applyValue,
  diffSatellite,
  readSourceFrom,
  readValue,
} from "./version-sync-lib.mjs";

const CODEMAP_DIR = "docs/CODEMAPS";

/** Expand the codemap glob; every other descriptor names one real file. */
function filesFor(satellite) {
  if (satellite.file !== `${CODEMAP_DIR}/*.md`) return [satellite.file];
  const found = fs
    .readdirSync(CODEMAP_DIR)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((f) => path.posix.join(CODEMAP_DIR, f));
  // A gate that scans nothing passes everything.
  if (found.length === 0) {
    console.error(`no ${CODEMAP_DIR}/*.md found — refusing to report a pass.`);
    process.exit(2);
  }
  return found;
}

function main() {
  if (!fs.existsSync(SOURCE_FILE)) {
    console.error(`${SOURCE_FILE} not found — run from the repo root.`);
    process.exit(2);
  }
  const { version, milestone } = readSourceFrom(fs.readFileSync(SOURCE_FILE, "utf8"));
  const update = process.argv.includes("--update");

  console.log(`${SOURCE_FILE}: ${version} "${milestone}"`);

  const problems = [];
  let written = 0;

  for (const satellite of SATELLITES) {
    for (const file of filesFor(satellite)) {
      const text = fs.readFileSync(file, "utf8");
      if (update) {
        const out = applyValue(satellite, text, version, milestone);
        if (out !== text) {
          fs.writeFileSync(file, out);
          written++;
          console.log(`  updated ${file}`);
        } else {
          console.log(`  unchanged ${file}`);
        }
        continue;
      }
      const readings = readValue(satellite, text);
      const shown = Object.entries(readings)
        .map(([k, v]) => `${k}=${v}`)
        .join(" ");
      console.log(`  ${file}: ${shown}`);
      problems.push(...diffSatellite(satellite, readings, version, milestone));
    }
  }

  if (update) {
    console.log(`version-sync: ${written} file(s) updated to ${version} "${milestone}"`);
    return;
  }

  if (problems.length) {
    console.error(`\nversion drift against ${SOURCE_FILE} (${version} "${milestone}"):`);
    for (const p of problems) console.error(`  ${p}`);
    console.error(`\nPropagate with: node scripts/check-version-sync.mjs --update`);
    process.exit(1);
  }
  console.log(`version-sync ok — every restatement matches ${version} "${milestone}"`);
}

main();
```

- [ ] **Step 2: Run it against the real repo**

```bash
node scripts/check-version-sync.mjs > /tmp/vsync.log 2>&1; echo "EXIT=$?"
cat /tmp/vsync.log
```

Expected: `EXIT=0`, and output listing `src/app/version.ts: 0.260.1 "Cho"` followed by **eight file lines** — package.json, package-lock.json, README.md and the five codemaps — carrying **fifteen values** between them (package.json 1, lockfile 2, README 2, each codemap 2), ending `version-sync ok`.

★ An earlier revision said "nine readings" while enumerating eight files, so the sentence refuted itself. Count the FILES and the VALUES separately — they are 8 and 15, and neither is 9.

**If any reading is missing or the script throws, stop.** A throw means a shape moved between the design measurement and now, and the pattern needs correcting — not the file.

- [ ] **Step 3: Prove the gate can fail — drift one satellite**

```bash
node -e '
const fs=require("fs"),p="package.json";
const a="\"version\": \"0.260.1\",";
let s=fs.readFileSync(p,"utf8");
const n=s.split(a).length-1;
if(n!==1){console.error("anchor matched "+n+" times, expected 1 — NOT writing");process.exit(1);}
fs.writeFileSync(p,s.replace(a,"\"version\": \"0.1.0\","));
console.log("drifted package.json to 0.1.0");'
node scripts/check-version-sync.mjs > /tmp/vsync-red.log 2>&1; echo "EXIT=$?"
grep "package.json version" /tmp/vsync-red.log
```

Expected: `EXIT=1` and a line reading `package.json version: 0.1.0 (expected 0.260.1)`.

- [ ] **Step 4: Prove the writer repairs it**

```bash
node scripts/check-version-sync.mjs --update > /tmp/vsync-fix.log 2>&1; echo "EXIT=$?"
cat /tmp/vsync-fix.log
node scripts/check-version-sync.mjs > /tmp/vsync-green.log 2>&1; echo "EXIT=$?"
tail -1 /tmp/vsync-green.log
```

Expected: the update run reports `updated package.json` and `unchanged` for the rest; the check run then exits 0.

- [ ] **Step 5: Prove the writer did not re-line or reformat anything**

This is the step that catches the sharpest edge in the whole slice.

```bash
git diff --stat
git ls-files --eol package.json package-lock.json README.md docs/CODEMAPS/architecture.md
```

Expected: `git diff --stat` shows **no modified files at all** (the drift was written and then repaired to the identical bytes), and the eol report shows `i/lf w/crlf` for `package.json` and `package-lock.json`, `i/lf w/lf` for the two markdown files.

**If `git diff --stat` shows `package.json` as modified, the writer changed something it should not have.** Inspect with `git diff package.json` before proceeding.

- [ ] **Step 6: Scan for corrupted escape bytes**

```bash
node -e 'const s=require("fs").readFileSync("scripts/check-version-sync.mjs","utf8");
  const bad=/[\x00-\x08\x0b\x0c\x0e-\x1f]/;let n=0;
  s.split("\n").forEach((l,i)=>{if(bad.test(l)){n++;console.log("line",i+1,JSON.stringify(l));}});
  console.log("control-char hits:",n);'
```

Expected: `control-char hits: 0`.

- [ ] **Step 7: Commit**

```bash
git add scripts/check-version-sync.mjs
git commit --only scripts/check-version-sync.mjs -m "feat: add a version-sync gate over the six restatements

src/app/version.ts is the source of truth; package.json, both
package-lock.json entries, the README badge and five codemap headers
restate the version, and the badge and headers restate the codename too.
Nothing compared them.

The checker prints every reading before its verdict, so a green result is
falsifiable rather than asserted, and it throws if a shape it depends on
has moved rather than reporting IN SYNC on a regex that stopped matching.

--update propagates. Verified by drifting package.json to 0.1.0 (gate goes
red and names the file), repairing with --update, and confirming git diff
--stat is empty afterwards — so the writer preserved both the CRLF working
tree and the exact formatting."
```

---

## Task 6: §236 — wire it into npm and CI

**Files:**
- Modify: `package.json` (two scripts + two descriptions)
- Modify: `README.md`, `CONTRIBUTING.md` (regenerated tables)
- Modify: `.gitlab-ci.yml` (new job)

- [ ] **Step 1: Add the two scripts**

In `package.json`'s `scripts` block, beside the other check scripts, add:

```json
    "version:check": "node scripts/check-version-sync.mjs",
    "version:sync": "node scripts/check-version-sync.mjs --update",
```

- [ ] **Step 2: Add the two descriptions**

In `package.json`'s `scriptsDescriptions` block, add:

```json
    "version:check": "Fail if a version restatement (package.json, lockfile, README badge, codemap headers) has drifted from src/app/version.ts",
    "version:sync": "Propagate src/app/version.ts's version and codename to every restatement",
```

`sync-script-docs.mjs` only WARNS on a missing description — it does not fail — so a missing one is invisible until someone reads the table. Add both.

- [ ] **Step 3: Regenerate the AUTO-GENERATED tables**

```bash
npm run docs:scripts > /tmp/docs-scripts.log 2>&1; echo "EXIT=$?"
npm run docs:scripts:check > /tmp/docs-scripts-check.log 2>&1; echo "EXIT=$?"
git diff --stat README.md CONTRIBUTING.md
```

Expected: both `EXIT=0`, and the diff shows two added rows in each file.

- [ ] **Step 4: Add the CI job**

In `.gitlab-ci.yml`, immediately after the `agents-symbol-check:` job, add:

```yaml
# Version-sync gate — BLOCKING. src/app/version.ts is the source of truth for
# the app version and codename; package.json, both package-lock.json entries,
# the README shields badge and every docs/CODEMAPS header restate one or both,
# and nothing compared them until this job. They have drifted silently before —
# package.json six releases behind, package-lock.json eleven, while version.ts
# and CHANGELOG.md were correct.
# Propagate rather than hand-editing six places: npm run version:sync
version-sync-check:
  stage: quality
  needs: []
  script:
    - npm run version:check
```

`needs: []` matches `agents-symbol-check` — the script needs only node, not installed dependencies.

- [ ] **Step 5: Verify the YAML parses and the job is where you think**

```bash
node -e 'const s=require("fs").readFileSync(".gitlab-ci.yml","utf8");
  const m=[...s.matchAll(/^([a-z][a-zA-Z0-9_-]*):$/gm)].map((x)=>x[1]);
  console.log("jobs:",m.length);console.log(m.join(" "));'
grep -n -A5 "^version-sync-check:" .gitlab-ci.yml
```

Expected: `version-sync-check` appears in the job list, and the grep shows `stage: quality`.

- [ ] **Step 6: Run the gate through npm the way CI will**

```bash
npm run version:check > /tmp/vcheck.log 2>&1; echo "EXIT=$?"
tail -2 /tmp/vcheck.log
```

Expected: `EXIT=0`.

- [ ] **Step 7: Commit**

```bash
git commit --only package.json README.md CONTRIBUTING.md .gitlab-ci.yml -m "ci: run the version-sync gate in the quality stage

version:check and version:sync, both with scriptsDescriptions entries, and
the AUTO-GENERATED tables in README.md and CONTRIBUTING.md regenerated.

needs: [] matching agents-symbol-check — the script needs node, not
installed dependencies."
```

---

## Task 7: §236 and §60 — the register and the AGENTS.md bullet

**Files:**
- Modify: `AGENTS.md` (the version-places bullet)
- Modify: `docs/open-followups.md` (§236 closure, §60 closure)

- [ ] **Step 1: Rewrite the AGENTS.md bullet**

Find it with `grep -n "FIVE MORE PLACES" AGENTS.md`. It currently reads:

```
  strings). ★★ FIVE MORE PLACES CARRY THE VERSION AND **NO GATE CHECKS ANY OF THEM**:
```

Change that line to:

```
  strings). ★★ FIVE MORE PLACES CARRY THE VERSION, AND `npm run version:check` NOW GATES THEM:
```

Then find the sentence in the same bullet beginning `Bump them in the SAME commit as` and replace it with:

```
  Propagate them with `npm run version:sync` rather than editing six places by hand — the
  `version-sync-check` CI job is BLOCKING, so drift now fails the pipeline instead of accumulating.
```

Leave the "Verified 2026-07-30" measurement sentence in place — it is a dated record of how far the drift got, and it stays true.

- [ ] **Step 2: Close §236 in the register**

Change the heading from:

```
## 236. Five version-carrying places are ungated, and the release checklist is the only thing holding them
```

to:

```
## 236. Five version-carrying places are ungated, and the release checklist is the only thing holding them — CLOSED 2026-08-26
```

Add below its `**Status:**` line:

```
★★ CLOSED 2026-08-26 on `chore/gate-blind-spots`. `scripts/check-version-sync.mjs` compares every
restatement against `src/app/version.ts` and runs as the BLOCKING `version-sync-check` job;
`npm run version:sync` propagates. The probe this entry shipped is superseded by the gate, which
prints the same readings — run `npm run version:check` rather than pasting the node one-liner.
★ The gate throws rather than passing when a shape moves, which is this entry's own requirement.
★★ It does NOT cover `CHANGELOG.md` or `APP_BUILD_DATE`: neither restates the version in a form a
regex can anchor on without guessing at prose, and a gate that guesses is one that gets switched off.
```

- [ ] **Step 3: Close §60 in the register**

§60's residual was verified discharged during design. Confirm once more, then close:

```bash
grep -c use-resource-planner docs/baselines/file-sizes.json; echo "EXIT=$?"
node -e 'console.log(Object.keys(require("./docs/baselines/file-sizes.json")).join(" "))'
```

Expected: `0` with `EXIT=1`, and four filenames, none of them `use-resource-planner.ts`.

Change the §60 heading from:

```
## 60. The file-size ratchet ignores every file at or under 800 lines, so a sub-limit baseline entry is inert — open
```

to:

```
## 60. The file-size ratchet ignores every file at or under 800 lines, so a sub-limit baseline entry is inert — CLOSED 2026-08-26
```

Add immediately below the heading:

```
★★ CLOSED 2026-08-26. Nothing here was ever a defect — the sub-limit blindness is the ratchet's
design, and the entry's own 2026-08-03 correction established that a sub-limit baseline entry is
behaviourally identical to no entry. Its one actionable residual, a stale `use-resource-planner.ts`
line in the baseline, was verified gone on 2026-08-25 and again on 2026-08-26. Kept in place as the
record of why `--update` dropping a sub-limit entry is a no-op rather than a regression.
★ The live hazard this entry is adjacent to is §229 (two files at 799 with no baseline), which is
where the near-cap work belongs.
```

- [ ] **Step 4: Verify the register's counts still agree**

The register has three independent spellings of "how many are open", plus a fourth in the claims script. They agree by construction while the one-status convention holds; a divergence is the alarm.

```bash
echo "total: $(grep -cE '^## [0-9]+.' docs/open-followups.md)"
echo "closed: $(grep -E '^## [0-9]+.' docs/open-followups.md | grep -c -- '— CLOSED')"
echo "open: $(grep -E '^## [0-9]+.' docs/open-followups.md | grep -cv -- '— CLOSED')"
grep -E "^## [0-9]+." docs/open-followups.md | grep -vE "— CLOSED" | grep -E "FIXED|CLOSED"
```

Expected: total 245, closed 77 (was 74; §214, §236 and §60 are now closed), open 168. The partials list must be unchanged at 9 entries — none of them should have gained the word CLOSED.

- [ ] **Step 5: Run the doc gates**

```bash
npm run docs:symbols:check > /tmp/sym2.log 2>&1; echo "EXIT=$?"
npm run docs:claims:check > /tmp/claims2.log 2>&1; echo "EXIT=$?"
tail -2 /tmp/sym2.log /tmp/claims2.log
```

Expected: both `EXIT=0`.

- [ ] **Step 6: Commit**

```bash
git commit --only AGENTS.md docs/open-followups.md -m "docs: record the version gate and close §236 and §60

AGENTS.md's 'NO GATE CHECKS ANY OF THEM' bullet is now false and says so.
The bullet also now points at version:sync rather than telling the reader
to bump six places in the same commit.

§236 closed, with what the gate deliberately does NOT cover recorded:
CHANGELOG.md and APP_BUILD_DATE have no anchorable shape.

§60 closed. Nothing there was ever a defect — sub-limit blindness is the
ratchet's design — and its one residual was verified gone twice. Kept in
place as the record of why --update dropping a sub-limit entry is a no-op."
```

---

## Task 8: §244 — the measurement harness

**Files:**
- Create: `scripts/measure-property-floor.mjs`

Read §244 first: `sed -n '/^## 244[.]/,/^## 245[.]/p' docs/open-followups.md`.

**The problem in one sentence:** an anti-vacuity floor asserts that a property's generator actually reached an interesting branch some minimum number of times, but fast-check is unseeded, so whether it does is a coin flip that CI tosses twice per pipeline.

- [ ] **Step 1: Write the harness**

Create `scripts/measure-property-floor.mjs`:

```js
#!/usr/bin/env node
// scripts/measure-property-floor.mjs — measure how often an anti-vacuity floor
// would fail.
//
// An anti-vacuity floor asserts a property's generator reached an interesting
// branch at least N times in `numRuns` draws. fast-check is UNSEEDED, so that
// count is a random variable and the floor is a bet. This measures the bet.
//
// USAGE: import it from a throwaway script that reproduces the property's
// generator and counting, then call:
//
//   measureFloor({ trials: 20000, run: () => ({ contended, uncontended }) })
//
// where `run` performs ONE full numRuns-sized sample and returns the counters.
//
// ★★★ REPLACE ANY vi.fn() MINTER WITH A PLAIN CLOSURE BEFORE MEASURING. The
// counters derive from the returned result, never from the mock, and 20,000
// x 50 accumulated mock call records terminate the vitest worker with
// ERR_WORKER_OUT_OF_MEMORY — which reads like a broken harness rather than a
// measurement error, and costs an afternoon.
//
// ★★ REPORT A PROBABILITY, NEVER A SAMPLE MINIMUM. Raising numRuns at an
// unchanged absolute floor makes the guard WEAKER, not the run safer: more
// samples against the same threshold is a lower bar. The number that belongs
// beside a floor is P(counter < floor), which is comparable across files.

/**
 * @param {object} opts
 * @param {number} opts.trials how many independent samples to draw
 * @param {() => Record<string, number>} opts.run one full sample; returns counters
 * @param {Record<string, number>} [opts.floors] floor per counter, for P(below)
 * @returns {Array<{counter: string, mean: number, min: number, zero: number, below: number, p: number}>}
 */
export function measureFloor({ trials, run, floors = {} }) {
  const sums = {};
  const mins = {};
  const zeros = {};
  const belows = {};

  for (let i = 0; i < trials; i++) {
    const counters = run();
    for (const [k, v] of Object.entries(counters)) {
      sums[k] = (sums[k] ?? 0) + v;
      mins[k] = Math.min(mins[k] ?? Infinity, v);
      if (v === 0) zeros[k] = (zeros[k] ?? 0) + 1;
      const floor = floors[k];
      if (floor !== undefined && v <= floor) belows[k] = (belows[k] ?? 0) + 1;
    }
  }

  return Object.keys(sums)
    .sort()
    .map((counter) => {
      const below = belows[counter] ?? 0;
      return {
        counter,
        mean: sums[counter] / trials,
        min: mins[counter],
        zero: zeros[counter] ?? 0,
        below,
        p: below / trials,
      };
    });
}

/** Format a measurement table for pasting into a comment or the register. */
export function formatMeasurement(rows, trials) {
  const lines = [`| counter | mean | min | P(at or below floor) over ${trials} trials |`, `|---|---|---|---|`];
  for (const r of rows) {
    const pct = r.p === 0 ? `0 (0/${trials})` : `${(r.p * 100).toFixed(4)}% (${r.below}/${trials})`;
    lines.push(`| \`${r.counter}\` | ${r.mean.toFixed(2)} | ${r.min} | ${pct} |`);
  }
  return lines.join("\n");
}
```

- [ ] **Step 2: Prove the harness reports a known answer**

The harness must be validated against a distribution whose answer is computable, or it is just another unverified number. A Bernoulli(1/3) counter over 50 draws is Binomial(50, 1/3), and `P(X = 0) = (2/3)^50 = 1.57e-9`, `P(X <= 3) = 4.36e-6`.

Write this to `harness-check.mjs` in the session scratchpad (never `/tmp` — it is shared across concurrent sessions):

```js
import { pathToFileURL } from "node:url";
import path from "node:path";

// ★★ ABSOLUTE file URL, not a relative specifier. An ESM relative import
// resolves against the IMPORTING FILE's location, not the working directory,
// so a script living outside the repo cannot reach the harness with
// "./scripts/...". The first version of this step got that wrong and could
// not resolve at all.
const { formatMeasurement, measureFloor } = await import(
  pathToFileURL(path.resolve("C:/Projects/aipm-wt-a/scripts/measure-property-floor.mjs")).href
);

// ★★★ `Math.imul`, NOT a plain multiply. The obvious LCG
// `seed = (seed * 1103515245 + 12345) % 2147483648` is BROKEN in JS: seed
// reaches 2147483648, so the product reaches 2.37e18 — 263x past
// Number.MAX_SAFE_INTEGER (9.007e15) — and the multiply silently loses
// precision, biasing the stream. Measured over 10,000,000 draws:
// P(rand() < 1/3) is 0.3401 with the plain multiply and 0.3332 with imul,
// which moves the control's mean to 17.01 against an expected 16.67.
//
// ★★★ THAT IS THE WHOLE POINT OF THIS STEP AND IT NEARLY DEFEATED IT. This
// control exists to pin the harness to a COMPUTABLE answer. Fed a biased
// stream it reports 17.01, and a reader then either "fixes" a harness that
// was counting correctly, or shrugs at 17.01-vs-16.67 as close enough and
// validates nothing. A control that disagrees for the wrong reason is worse
// than no control.
let seed = 12345;
const rand = () => {
  seed = (Math.imul(seed, 1103515245) + 12345) | 0;
  return (seed >>> 0) / 4294967296;
};

const TRIALS = 200000;
const rows = measureFloor({
  trials: TRIALS,
  floors: { third: 3 },
  run: () => {
    let third = 0;
    for (let i = 0; i < 50; i++) if (rand() < 1 / 3) third++;
    return { third };
  },
});
console.log(formatMeasurement(rows, TRIALS));
console.log("expected mean ~16.67, expected P(X <= 3) ~4.36e-6 i.e. ~0.0004%");
```

★ Read the two figures differently. The **mean** is the assertion: 200,000 trials put the standard
error near 0.0075, so anything not within a few hundredths of 16.67 means the harness is counting
wrong. The **tail** is not: `P(X <= 3) = 4.36e-6` predicts about 0.87 hits in 200,000, so observing
0, 1, 2 or 3 hits is all ordinary Poisson noise (three hits has probability ~5.9%). Do not treat a
tail count as a failed validation, and do not tune anything to reproduce a particular one.

Run it:

```bash
node /tmp/harness-check.mjs > /tmp/harness-check.log 2>&1; echo "EXIT=$?"
cat /tmp/harness-check.log
```

Expected: mean close to `16.67`, and `P(at or below floor)` on the order of `0.0004%` (a handful of hits in 200,000, or zero — both are consistent with 4.36e-6).

**If the mean is not near 16.67, the harness is counting wrong.** Fix it before using it on anything real.

- [ ] **Step 3: Register the script**

Add to `package.json` — no `scripts` entry, because this is a library imported by throwaway measurement scripts rather than a command. Confirm nothing needs registering:

```bash
npm run docs:scripts:check > /tmp/ds.log 2>&1; echo "EXIT=$?"
```

Expected: `EXIT=0`. (Only `package.json` `scripts` entries appear in the generated tables, and this adds none.)

- [ ] **Step 4: Commit**

```bash
git add scripts/measure-property-floor.mjs
git commit --only scripts/measure-property-floor.mjs -m "test: add a harness for measuring anti-vacuity floors

An anti-vacuity floor asserts a generator reached an interesting branch N
times in numRuns draws. fast-check is unseeded, so that count is a random
variable and the floor is a bet — one that took the 0.259.0 release
pipeline red at a measured 1 in 2,857 per suite run.

The harness reports P(counter at or below floor), which is comparable
across files, rather than a sample minimum, which is not: raising numRuns
at an unchanged absolute floor makes the guard weaker, not safer.

Validated against Binomial(50, 1/3), whose mean (16.67) and P(X <= 3)
(4.36e-6) are computable, so the counting itself is pinned to a known
answer rather than to its own output."
```

---

## Task 9: §244 — audit and classify the 35 floors

**Files:**
- Modify: `docs/open-followups.md` (§244 gains the classification table)

This task produces a **classification**, not fixes. The fixes are Tasks 10 and 11, and which files they touch is determined here.

- [ ] **Step 1: Regenerate the floor list**

```bash
node -e '
const fs=require("fs");
const files=fs.readdirSync("src/app").filter((f)=>f.endsWith(".property.test.ts"));
const byFile={};
for(const f of files){
  const src=fs.readFileSync("src/app/"+f,"utf8").split(/\r?\n/);
  let depth=0,inAssert=false;
  src.forEach((line,i)=>{
    if(/fc\.assert\(/.test(line)){inAssert=true;depth=0;}
    if(inAssert){for(const ch of line){if(ch==="(")depth++;else if(ch===")")depth--;}}
    if(/toBeGreaterThan(OrEqual)?\(/.test(line) && !(inAssert&&depth>0)){
      (byFile[f]??=[]).push((i+1)+": "+line.trim().slice(0,100));
    }
    if(inAssert&&depth<=0&&/\)/.test(line))inAssert=false;
  });
}
let n=0;for(const [f,ls] of Object.entries(byFile)){console.log("\n"+f);ls.forEach((l)=>{n++;console.log("   "+l);});}
console.log("\ncandidates:",n,"in",Object.keys(byFile).length,"files");' > /tmp/floors.txt 2>&1
cat /tmp/floors.txt
```

Expected: 43 candidates across 8 files.

- [ ] **Step 2: Discard the eight deterministic candidates by reading them**

The scan flags anything outside an `fc.property` callback, which sweeps in deterministic helpers and static constant comparisons. Eight of the 43 are not floors at all. **Read each one** — do not take this list on trust, since the whole point of this task is that a plausible-looking number was wrong:

| candidate | why it is not a floor |
|---|---|
| `document-model.property.test.ts:269,273,278,298` | inside the `assertBlockInvariants` / `assertDocInvariants` helpers — per-item invariants |
| `export-sections.rich.property.test.ts:182,183` | inside the `cellFor` helper — deterministic |
| `export-sections.rich.property.test.ts:365` | `RICH_TARGETS.length` — a static config assertion |
| `gantt-engine.property.test.ts:236` | `LEFT_GUTTER_PX` against `GANTT_NAME_COL_MIN` — two constants |

Confirm each by opening the file at that line and checking it is not counting runs.

That leaves **35 anti-vacuity floors across 7 files**: `codec-roundtrip` 12, `entity-id-mint` 8, `rich-text-plain` 5, `document-model` 3, `export-sections.rich` 3, `sanitize-core` 3, `document-mutations` 1.

- [ ] **Step 3: Classify each of the 35**

For each floor, read the surrounding code and decide:

- **CONSTRUCTION-BACKED** — the generator guarantees the branch on a known fraction of draws, so the count's distribution is a fact about the arbitrary. Example: `sanitize-core.property.test.ts:102`, whose comment reads "Floor at half the (constructed, seed-independent) 30/30 count". These need **no change**.
- **PROBABILISTIC** — the branch is reached only when random draws happen to line up. These need a fix in Task 11.

Record the verdict per floor. The deciding question is: *if I read only the arbitrary, can I state the probability the branch is hit on one draw?* If yes, construction-backed. If it depends on values colliding by chance, probabilistic.

- [ ] **Step 4: Measure every PROBABILISTIC floor**

For each, write a throwaway script under `/tmp/` that copies the file's arbitraries verbatim, replaces any `vi.fn()` with a plain closure, and calls `measureFloor` with the real `numRuns` and the real floor. Use 20,000 trials.

Record `P(at or below floor)` for each. This is the number that goes in the register and beside the floor.

- [ ] **Step 5: Write the classification into §244**

Replace §244's "Scope is wider than one file and is NOT audited here" paragraph — the one containing "Measured 2026-08-25: **19 of 31**" — with the audit result. Keep the original figure visible as what it actually counted, because deleting it makes the correction unverifiable:

```
★★★ **AUDITED 2026-08-26, AND THE "19 of 31" ABOVE COUNTS THE WRONG THING.** That figure is a
`grep` for `toBeGreaterThan` across `*.property.test.ts`, which sweeps in every PER-RUN INVARIANT
asserted INSIDE an `fc.property` callback — `expect(r.total).toBeGreaterThanOrEqual(0)` is the
property being tested, not a guard against the generator never producing an interesting case. A
reader sizing the work from it over-scopes by more than half. Classifying by whether the assertion
sits inside the callback gives 43 outside and 24 inside, and EIGHT of the 43 are still not floors:
`document-model.property.test.ts` 269/273/278/298 sit inside `assertBlockInvariants` and
`assertDocInvariants`, `export-sections.rich.property.test.ts` 182/183 inside `cellFor`, and
`export-sections.rich.property.test.ts:365` plus `gantt-engine.property.test.ts:236` compare static
constants. ★★ The eight were caught by READING, not by the scan — the scan cannot tell "outside the
callback" from "counts runs", so re-running it does not reproduce this filter.

**The real surface is 35 anti-vacuity floors across 7 files**, and they are not all defective.
```

Follow it with the per-file classification table you built in Step 3, in this shape:

```
| file | floors | construction-backed | probabilistic |
|---|---|---|---|
| `codec-roundtrip.property.test.ts` | 12 | (count) | (count) |
| `entity-id-mint.property.test.ts` | 8 | (count) | (count) |
| `rich-text-plain.property.test.ts` | 5 | (count) | (count) |
| `document-model.property.test.ts` | 3 | (count) | (count) |
| `export-sections.rich.property.test.ts` | 3 | (count) | (count) |
| `sanitize-core.property.test.ts` | 3 | (count) | (count) |
| `document-mutations.property.test.ts` | 1 | (count) | (count) |
```

Fill the last two columns from the Step 3 verdicts, and add the measured probability for each probabilistic one underneath.

Then add the reproduce command:

````
Reproduce the candidate list (43 across 8 files) — the eight non-floors must still be filtered by
reading, so this command over-reports by design:

```bash
node -e '
const fs=require("fs");
for(const f of fs.readdirSync("src/app").filter((x)=>x.endsWith(".property.test.ts"))){
  const src=fs.readFileSync("src/app/"+f,"utf8").split(/\r?\n/);
  let depth=0,inAssert=false;
  src.forEach((line,i)=>{
    if(/fc\.assert\(/.test(line)){inAssert=true;depth=0;}
    if(inAssert){for(const ch of line){if(ch==="(")depth++;else if(ch===")")depth--;}}
    if(/toBeGreaterThan(OrEqual)?\(/.test(line)&&!(inAssert&&depth>0))console.log(f+":"+(i+1));
    if(inAssert&&depth<=0&&/\)/.test(line))inAssert=false;
  });}'
```
````

- [ ] **Step 6: Commit the classification**

```bash
git commit --only docs/open-followups.md -m "docs: audit §244's floors and correct what the count measured

'19 of 31 files carry a numeric floor' greps for toBeGreaterThan, which
sweeps in every per-run invariant asserted inside an fc.property callback.
Those are the property, not a guard against a vacuous generator, so a
reader sizing the work from that figure over-scopes by more than half.

Classifying by paren depth gives 43 outside the callback and 24 inside;
eight of the 43 are still not floors and were caught by reading rather
than by the scan, which cannot tell 'outside the callback' from 'counts
runs'. Real surface: 35 floors across 7 files, with the construction-backed
ones separated from the probabilistic ones and each of the latter measured.

The original figure is kept visible as what it actually counted — deleting
it would make the correction unverifiable."
```

---

## Task 10: §244 — fix `entity-id-mint`, the worked example

**Files:**
- Modify: `src/app/entity-id-mint.property.test.ts`

This is the floor that took the 0.259.0 pipeline red. Fix it first, in full, as the pattern the remaining fixes follow.

★★★ **SCOPE WIDENED 2026-08-26 BY MEASUREMENT — THIS FILE HAS THREE THIN FLOORS, NOT ONE.** The
audit measured every floor in `entity-id-mint.property.test.ts` over 20,000 trials at the file's real
generators and `numRuns`:

| floor | line | mean | min | P(at or below floor) |
|---|---|---|---|---|
| `uncontended > 0` | 205 | 7.05 | 0 | **7.5e-4** |
| `free > 5` | 130 | 15.70 | 3 | **3.0e-4** |
| `free > 5` | 158 | 15.70 | 3 | **3.0e-4** (same generator, second test) |
| `taken > 10` | 129, 157 | 34.30 | 19 | 0 / 20000 |
| `contended > 20` | 93 | 39.36 | 26 | 0 / 20000 |
| `contended > 0` | 204 | 13.14 | 3 | 0 / 20000 |
| `updates > 0` | 206 | 29.81 | 16 | 0 / 20000 |

So Task 10 fixes **three** floors — 205, 130 and 158 — with the same branch-tag construction. The two
`free > 5` floors sit in `anyCase` tests (`caseArb(0)`), fire once each per suite run, and bring the
file's aggregate to roughly **1.35e-3 per suite run** across two blocking jobs per pipeline.

★★ **AN ESTIMATE READ OFF THE ARBITRARY WAS WRONG BY AN ORDER OF MAGNITUDE, IN THE UNSAFE
DIRECTION — WHICH IS WHY STEP 1 MEASURES RATHER THAN REASONS.** The audit estimated `free > 5` at
1e-3…1e-2 and concluded it was "plausibly an order of magnitude *worse*" than `uncontended`, which
would have made it, not the three-branch test, the file's worst floor and the natural worked example.
Measurement puts it at 3.0e-4 — **2.5× better** than `uncontended`, not worse. The estimate could not
be settled by reading because it turns on `P(empty)` for `fc.uniqueArray({minLength: 0, maxLength: 8})`,
a fast-check size-bias question rather than a property of this file, and the audit flagged itself
UNSURE on exactly that. It was right to. **Never scope a fix from an estimated probability.**

★ The measured `uncontended` figure is also about 2× the 3.9e-4 the file's own comment derives from
p ≈ 0.145. Use the measured 7.5e-4 in the new comment, not the analytic one.

**Why it flakes.** The three-branch test counts `contended`, `uncontended` and `updates` over 50 runs. `uncontended` requires a *free* `itemId` **and** `isNew` in `{true, undefined}`. The generator is collision-biased 3:1 toward taken ids, so p ≈ 0.145, mean ≈ 7.06, and `P(uncontended === 0)` measured at 0.035% — about 1 in 2,857 per suite run, across two blocking jobs per pipeline.

**The fix.** Draw the branch first, then construct a case that satisfies it. Each branch then has p = 1/3 by construction, and `P(count === 0)` over 50 runs is `(2/3)^50 = 1.6e-9` — five orders of magnitude better, and a fact about the arbitrary rather than a bet.

- [ ] **Step 1: Measure the current behaviour**

Write `/tmp/measure-mint-before.mjs` reproducing the file's arbitraries with a plain-closure minter, and measure. Confirm you reproduce roughly `uncontended` mean ~7 and `P(=== 0)` ~0.03%. If you cannot reproduce it, stop — the fix's justification is that measurement.

- [ ] **Step 2: Add the constructed arbitrary**

In `src/app/entity-id-mint.property.test.ts`, after the `isNewArb` declaration, add:

```ts
// ★★★ BRANCH-TAGGED, AND THAT IS WHAT MAKES THE FLOORS BELOW SAFE. The
// three-branch test used to rely on `caseArb`'s collision bias to visit all
// three branches by luck: `uncontended` needs a FREE id AND `isNew` in
// {true, undefined}, p ≈ 0.145, mean ≈ 7 over 50 runs, and it drew ZERO in
// 0.035% of suite runs — measured over 20,000 trials, and it took the 0.259.0
// release pipeline red on a BLOCKING gate.
//
// Drawing the branch FIRST and constructing a case to match makes each branch
// p = 1/3 by construction, so P(a branch is never visited in 50 runs) is
// (2/3)^50 = 1.6e-9. The floor is then a fact about this arbitrary rather than
// a bet on the generator, which is the cure sanitize-core's midPairCutArb
// already applies.
//
// ★ The rows and ids inside each branch are still drawn randomly, so this
// NARROWS nothing: it fixes which branch a draw lands in, not what the branch
// contains. The uncontended branch is in fact WIDER than before — it now
// always gets a genuinely free id, which the old generator reached only by
// chance.
const FREE_ID_CEILING = 31; // idArb tops out at 30, so 31 is always free

const branchArb = fc.constantFrom("contended", "uncontended", "update");

const taggedCase = rowsArb(1).chain((rows) => {
  const taken = new Set(rows.map((r) => r.id));
  const free: number[] = [];
  for (let id = 1; id <= FREE_ID_CEILING; id++) if (!taken.has(id)) free.push(id);
  // rowsArb caps at 8 rows drawn from 1..30, so `free` always has members.
  return branchArb.chain((branch) =>
    fc.record({
      rows: fc.constant(rows),
      branch: fc.constant(branch),
      itemId:
        branch === "uncontended"
          ? fc.constantFrom(...free)
          : fc.constantFrom(...rows.map((r) => r.id)),
      // "update" is the isNew === false branch and takes any id; the other two
      // need an intent that means CREATE.
      isNew:
        branch === "update"
          ? fc.constant<boolean | undefined>(false)
          : fc.constantFrom<boolean | undefined>(true, undefined),
    }),
  );
});
```

★★★ **THE ARBITRARY ABOVE IS DEFECTIVE — DO NOT COPY IT. It is kept here only as the record of what
went wrong.** The `contended` branch draws `isNew ∈ {true, undefined}` against a **taken** id, but
`resolveEntitySave` falls back to `isNew ?? !taken`, so `undefined` at a taken id computes
`create = false` — an **update**. Half of every contended draw therefore lands in `updates`, giving
`p(contended) = 1/6`, not 1/3, and `P(contended === 0 in 50 runs) = (5/6)^50 = 1.1e-4`.

That is **worse than the floor it replaces**: `contended > 0` measured 0 occurrences in 20,000 trials
on the ORIGINAL generator. So this arbitrary would have introduced a live flake into a floor that was
already safe, sitting underneath a comment asserting 1.6e-9 for all three branches — a fabricated
number, and precisely the failure Step 7's ★★ tells you to look for. Measured as written:
`contended` mean **8.32** (≈ 50/6), min 0, zero-draws in **3/20000**.

★★ **The plan contradicted itself and that is what should have caught it earlier:** Step 7 below
expects "mean near 16.7" for all three counters, which this arbitrary cannot produce — its means are
8.33 / 16.67 / 25. When a plan's code and its stated expectation disagree, the expectation is usually
the honest half; measure before believing either.

★ **The fix, and what shipped:** pin the contended branch to `isNew: true` — the only intent that
reaches a contended create — and move the taken-plus-`undefined` case into the `update` branch, where
it belongs. All six (existence × intent) combinations the old `contendedCase × isNewArb` pair produced
remain reachable, so nothing is lost. **The authoritative version is the one in
`src/app/entity-id-mint.property.test.ts`** (`taggedCase`, and `existenceCase` beside it); read that,
not this block. Shipped and independently re-measured at 16.66 / 16.69 / 16.65, zero at-floor draws in
20,000 trials.

- [ ] **Step 3: Rewrite the three-branch test to use it**

Replace the body of the test that currently ends in the three `> 0` floors. The `fc.property` call becomes:

```ts
    fc.assert(
      fc.property(taggedCase, ({ rows, itemId, isNew }) => {
        const mint = makeMinter(rows);
        const result = resolveEntitySave(rows, itemId, isNew, mint);
        const wasTaken = isTaken(rows, itemId);

        if (result.create && wasTaken) {
          expect(mint).toHaveBeenCalledTimes(1);
          contended++;
        } else {
          expect(mint).not.toHaveBeenCalled();
          if (result.create) uncontended++;
          else updates++;
        }
        return true;
      }),
      { numRuns: 50 },
    );
```

Note the destructure now takes `isNew` from the record rather than from a second arbitrary, so the second `fc.property` argument (`isNewArb`) is gone.

- [ ] **Step 4: Replace the floor comment with the measured fact**

Replace the entire `★★★ THE FLOORS ARE > 0 ON PURPOSE` comment block above the three assertions with:

```ts
    // All three branches must actually be visited or the "never otherwise" half
    // of this property is asserted over nothing.
    //
    // ★★ THE FLOORS ARE `> 0` AND THAT IS NOW A CONSTRUCTED FACT, NOT A BET.
    // `taggedCase` draws the branch first, so each has p = 1/3 and
    // P(a branch is never visited in 50 runs) = (2/3)^50 = 1.6e-9. Before the
    // branch tag the same floors rode the generator's collision bias:
    // `uncontended` had p ≈ 0.145 and drew zero in 0.035% of suite runs
    // (measured, 20,000 trials), which is what took a release pipeline red.
    //
    // ★ Do NOT "tighten" these to a larger number and do NOT raise numRuns —
    // a bigger sample against an unchanged absolute floor is a WEAKER guard,
    // not a safer run. Their job is to prove each branch was REACHED, and at
    // 1.6e-9 they do that.
    expect(contended).toBeGreaterThan(0);
    expect(uncontended).toBeGreaterThan(0);
    expect(updates).toBeGreaterThan(0);
```

- [ ] **Step 5: Check whether `isNewArb` is now unused**

If no other test in the file uses `isNewArb`, it is now an unused variable — and as of Task 2 that **fails the lint gate** rather than warning.

```bash
grep -n "isNewArb" src/app/entity-id-mint.property.test.ts
npx eslint src/app/entity-id-mint.property.test.ts > /tmp/mint-lint.log 2>&1; echo "EXIT=$?"
```

If `EXIT=1` with an unused-vars finding, delete the `isNewArb` declaration. If other tests still use it, leave it.

- [ ] **Step 6: Run the test**

```bash
npx vitest run src/app/entity-id-mint.property.test.ts > /tmp/mint.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " /tmp/mint.log
```

Expected: `EXIT=0`, all tests passing.

- [ ] **Step 7: Measure the fixed version and confirm the improvement**

Write `/tmp/measure-mint-after.mjs` reproducing the **new** `taggedCase` and measure over 20,000 trials.

Expected: each of the three counters has mean near 16.7 and zero occurrences of a zero count. **If any counter has a materially different mean, the branch construction is not doing what it claims** — for instance if `resolveEntitySave` routes the "update" branch somewhere unexpected — and the comment's probability would be a fabricated number.

- [ ] **Step 8: Typecheck**

```bash
npx tsc --noEmit > /tmp/tsc-mint.log 2>&1; echo "EXIT=$?"
tail -5 /tmp/tsc-mint.log
```

Expected: `EXIT=0`. (`tsc` exits 2 on diagnostics, not 1.)

- [ ] **Step 9: Commit**

```bash
git commit --only src/app/entity-id-mint.property.test.ts -m "test: make the id-mint branch floors a constructed fact

The three-branch property relied on the generator's collision bias to
visit all three branches by luck. `uncontended` needs a free id AND an
intent meaning create, p ≈ 0.145, and drew zero in 0.035% of suite runs —
about 1 in 2,857, across two blocking jobs per pipeline. That is what took
the 0.259.0 release pipeline red on a tree that could not have caused it.

Drawing the branch first and constructing a case to match gives each
branch p = 1/3, so P(a branch is never visited in 50 runs) is 1.6e-9.

This narrows nothing: rows and ids are still drawn randomly within each
branch, and the uncontended branch is wider than before because it now
always gets a genuinely free id rather than reaching one by chance.
Measured before and after over 20,000 trials each."
```

---

## Task 11: §244 — fix the remaining probabilistic floors

**Files:**
- Modify: whichever `*.property.test.ts` files Task 9 classified PROBABILISTIC

Task 9 produced the list. Task 10 established the pattern. Work through the remaining files **one file per commit**.

For each file:

- [ ] **Step 1: Measure the current floor** with a throwaway script under `/tmp/` copying the arbitraries verbatim, plain closures instead of mocks, 20,000 trials. Record `P(at or below floor)`.

- [ ] **Step 2: Decide the construction.** The question is always the same: what does the interesting branch require, and can the arbitrary guarantee it on a known fraction of draws instead of hoping? The three shapes seen so far:
  - **Branch tag** (Task 10) — draw which branch, then construct a case satisfying it.
  - **Constructed hazard** (`sanitize-core`'s `midPairCutArb`) — build the hazardous input directly rather than filtering for it.
  - **Guaranteed-member pool** — when a branch needs a value with a property, compute the qualifying set and draw from it, rather than drawing broadly and filtering.

- [ ] **Step 3: Apply the construction** and replace the floor's comment with the measured probability, in the shape Task 10 uses: what the floor is, what its probability is now, what it was before, and an explicit "do not tighten this or raise numRuns" note.

- [ ] **Step 4: Run that file's tests**

```bash
npx vitest run src/app/<file>.property.test.ts > /tmp/prop.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " /tmp/prop.log
```

Expected: `EXIT=0`.

- [ ] **Step 5: Measure the fixed version** over 20,000 trials and confirm the counter means match what the construction predicts. A mean that disagrees with the construction means the construction is not doing what the comment claims.

- [ ] **Step 6: Lint and typecheck** — a construction change often strands the old arbitrary, which now fails the gate rather than warning.

```bash
npx eslint src/app/<file>.property.test.ts > /tmp/prop-lint.log 2>&1; echo "EXIT=$?"
npx tsc --noEmit > /tmp/prop-tsc.log 2>&1; echo "EXIT=$?"
```

Expected: both `EXIT=0`.

- [ ] **Step 7: Commit that file**, with a message stating the before and after probabilities and what the construction guarantees.

**Do not**, in any of these:

- Raise `numRuns` at an unchanged floor. More samples against the same absolute threshold is a lower bar.
- `.skip` the test. An intermittently-red property gets skipped by whoever draws the unlucky seed, costing the guard entirely.
- Seed fast-check globally. It buys determinism by making the property see one input set forever, which is most of why it exists.
- Lower a floor to make a run green. That is the defeated-gate failure this whole slice exists to prevent.

---

## Task 12: §244 — close the entry

**Files:**
- Modify: `docs/open-followups.md`

- [ ] **Step 1: Run the full suite twice to check for new flakes**

Two runs, sequentially — never two vitest processes at once.

```bash
npm run test:run > /tmp/suite1.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " /tmp/suite1.log
npm run test:shuffle > /tmp/suite2.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " /tmp/suite2.log
```

Expected: both `EXIT=0`. `test:shuffle` is the only local reproduction of the `unit-tests-shuffled` gate, and this slice edits tests, so it is not optional.

A red run carrying `Failed to start forks worker` is machine contention, not evidence — re-run with `--maxWorkers=4`.

- [ ] **Step 2: Update the §244 heading**

If every probabilistic floor found in Task 9 was fixed, change the heading to add `— CLOSED 2026-08-26`. If any were deliberately left (for instance a floor whose construction would materially narrow the property), the entry stays **open** and the heading says what landed without using the word CLOSED — the register's rule is that a partially closed entry is open, and writing CLOSED on one breaks every count.

- [ ] **Step 3: Record what was done**

Add below the entry's `**Status:**` line a paragraph naming: the harness, how many floors were construction-backed already, how many were fixed, and the before/after probability for each fixed one.

Add explicitly what is **not** covered, so the next reader does not over-trust it:

```
★★ WHAT THIS DOES NOT COVER. The audit classified assertions that sit OUTSIDE an `fc.property`
callback in `src/app/*.property.test.ts`. It says nothing about: floors in `e2e/`, counters asserted
by a helper the scan cannot see through, or a NEW property landing with a probabilistic floor —
nothing gates that, and the classification will be stale the moment one does.
```

- [ ] **Step 4: Verify the register counts**

```bash
echo "total: $(grep -cE '^## [0-9]+.' docs/open-followups.md)"
echo "closed: $(grep -E '^## [0-9]+.' docs/open-followups.md | grep -c -- '— CLOSED')"
echo "open: $(grep -E '^## [0-9]+.' docs/open-followups.md | grep -cv -- '— CLOSED')"
```

Expected: total 245; closed and open reflecting whether §244 closed.

- [ ] **Step 5: Commit**

```bash
git commit --only docs/open-followups.md -m "docs: record the floor audit outcome in §244"
```

---

## Task 13: §229 — survey both files

**Files:** none modified. This task produces a survey.

Read §229 first: `sed -n '/^## 229[.]/,/^## 230[.]/p' docs/open-followups.md`.

- [ ] **Step 1: Measure both files with the gate's arithmetic**

```bash
for f in src/app/use-chat-dispatcher.ts src/app/use-storage-backend.ts; do
  echo "$f $(node -e "console.log(require('fs').readFileSync('$f','utf8').split('\n').length)")"
done
node -e 'console.log(Object.keys(require("./docs/baselines/file-sizes.json")).join(" "))'
```

Expected: both 799, and a baseline naming four other files.

`wc -l` reports 798 for these. **Never budget from `wc -l`** — the gate counts `split("\n").length`, which for a newline-terminated file is one more, and budgeting from `wc -l` has already cost a build on `use-storage-backend.ts`.

- [ ] **Step 2: Read each file and identify candidate seams**

For each file, look for a **whole cohesive surface** that could move out — not a relocated helper. §220's precedent is why this step is not optional: that entry asserted its subject file's one cheap seam "was spent and cannot be spent again", and three were found in one afternoon (a deleted-documents section, a rename modal, a block editor).

For each candidate record: what it is, how many lines it would move, what its interface with the remainder would be, and whether anything else would import it.

- [ ] **Step 3: Check the coverage consequence of each candidate**

```bash
grep -n -A30 "exclude:" vitest.config.ts | head -40
```

An extracted `use*` hook in a new `.ts` file becomes **coverage-gated** unless it is added to `coverage.exclude`. The rule from AGENTS.md: exclude pure UI glue, test real logic. A candidate that is glue needs an exclude entry; one that is logic needs tests. Note which for each candidate.

- [ ] **Step 4: Decide per file**

- If a cohesive seam exists → Task 14 extracts it.
- If none does → record the survey in §229 and stop. That is a legitimate outcome, and it is the deliverable.

**Not an option:** adding a baseline entry for either file. Baselining a file to admit growth is the "re-baseline to make the pipeline pass" failure the gate exists to prevent, and it converts a hard cap into an open-ended ratchet.

- [ ] **Step 5: Write the survey into §229**

Add below the entry's `**Status:**` line a paragraph per file naming every candidate considered, its size, and the verdict with a reason. For a rejected candidate, say *why* it was rejected — "would relocate three helpers without buying cohesion" is a reason; "nothing obvious" is not, and is exactly the pessimistic conclusion §220 recorded as false.

- [ ] **Step 6: Commit the survey**

```bash
git commit --only docs/open-followups.md -m "docs: survey both 799-line files for an extraction seam

§220's precedent is why this was worth doing before concluding anything:
it asserted its subject file had no cheap seam left and three were found in
one afternoon. Records every candidate considered and the reason for each
verdict, so the next person starts from the survey rather than from
scratch."
```

---

## Task 14: §229 — extract, if the survey found a seam

**Files:** determined by Task 13. Skip this task entirely if the survey found no cohesive seam in either file.

Do **one file per commit**.

- [ ] **Step 1: Create the new module** with the extracted surface, taking what it needs as explicit parameters or props rather than reaching back into the caller.

- [ ] **Step 2: Update the original file** to import and use it.

- [ ] **Step 3: Check for stranded imports**

Extraction is the operation most likely to strand an import, and as of Task 2 that fails the gate rather than warning. `_`-prefixed parameters are **not** exempt — there is no `argsIgnorePattern`.

```bash
npx eslint src > /tmp/extract-lint.log 2>&1; echo "EXIT=$?"
```

Expected: `EXIT=0`.

- [ ] **Step 4: Typecheck**

```bash
npx tsc --noEmit > /tmp/extract-tsc.log 2>&1; echo "EXIT=$?"
```

Expected: `EXIT=0`.

- [ ] **Step 5: Run the affected tests**

```bash
npx vitest run src/app/<original-file-basename> > /tmp/extract-test.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " /tmp/extract-test.log
```

Expected: `EXIT=0`.

- [ ] **Step 6: Handle the new file's coverage status**

If the extracted module is pure UI glue, add it to `vitest.config.ts` `coverage.exclude` with a comment saying why. If it holds real logic, write tests for it instead — the repo's own guidance is to exclude glue, not logic, and `use-view-digest.ts` is the precedent for a deps-object hook that is deliberately gated and tested.

- [ ] **Step 7: Confirm the ratchet is satisfied and headroom is real**

```bash
npm run size:check > /tmp/size.log 2>&1; echo "EXIT=$?"
tail -2 /tmp/size.log
for f in src/app/use-chat-dispatcher.ts src/app/use-storage-backend.ts; do
  echo "$f $(node -e "console.log(require('fs').readFileSync('$f','utf8').split('\n').length)")"
done
```

Expected: `EXIT=0`, and the extracted file meaningfully under 799.

- [ ] **Step 8: Commit**

```bash
git commit --only <the changed paths> -m "refactor: extract <surface> from <file>

<file> sat at 799 by the gate's arithmetic with no baseline entry, so two
added lines would have failed the ratchet as a NEW file over 800 — a red
pipeline for whoever next touched it, for a reason unrelated to their
change.

<surface> is a whole cohesive surface, not a relocated helper: <what it is
and what its interface is>. Now at <N> lines."
```

- [ ] **Step 9: Update §229**

If both files now have real headroom, close the entry. If only one was extractable, the entry stays **open** with the remaining file named — do not write CLOSED on a half-done entry.

---

## Task 15: Full gate sweep and branch review

**Files:** possibly `docs/open-followups.md` for any correction the sweep turns up.

- [ ] **Step 1: Run every gate, unpiped, reading each exit code**

```bash
S=/tmp/gates; mkdir -p $S
npx eslint src            > $S/lint.log 2>&1; echo "lint EXIT=$?"
npx tsc --noEmit          > $S/tsc.log 2>&1; echo "tsc EXIT=$?"
npm run test:run          > $S/test.log 2>&1; echo "test EXIT=$?"
npm run test:shuffle      > $S/shuffle.log 2>&1; echo "shuffle EXIT=$?"
npm run size:check        > $S/size.log 2>&1; echo "size EXIT=$?"
npm run dup:check         > $S/dup.log 2>&1; echo "dup EXIT=$?"
npm run docs:symbols:check > $S/symbols.log 2>&1; echo "symbols EXIT=$?"
npm run docs:claims:check  > $S/claims.log 2>&1; echo "claims EXIT=$?"
npm run docs:scripts:check > $S/scripts.log 2>&1; echo "scripts EXIT=$?"
npm run version:check      > $S/version.log 2>&1; echo "version EXIT=$?"
```

Expected: every one `EXIT=0`. Read the log for any that is not — the summary line alone does not distinguish a real failure from contention.

- [ ] **Step 2: Confirm no file was silently re-lined**

```bash
git diff --name-only origin/main...HEAD | while read -r f; do
  [ -f "$f" ] && git ls-files --eol "$f"
done
```

Expected: every `src/**`, `package.json` and `package-lock.json` entry reads `w/crlf`; every `*.md` reads `w/lf`. A `src` file reading `w/lf` was re-lined and must be repaired.

- [ ] **Step 3: Sweep for live mutants**

Tasks 2 and 5 both wrote deliberate breakage and reverted it. Confirm nothing survived:

```bash
git diff --stat
grep -rn "useState } from \"react\"" src/app/icons.ts; echo "EXIT=$?"
npm run version:check > /tmp/final-version.log 2>&1; echo "EXIT=$?"
```

Expected: clean tree, the grep exiting 1 with no match, and the version gate green.

- [ ] **Step 4: Confirm the register is internally consistent**

```bash
echo "total: $(grep -cE '^## [0-9]+.' docs/open-followups.md)"
echo "closed: $(grep -E '^## [0-9]+.' docs/open-followups.md | grep -c -- '— CLOSED')"
echo "open: $(grep -E '^## [0-9]+.' docs/open-followups.md | grep -cv -- '— CLOSED')"
grep -E "^## [0-9]+." docs/open-followups.md | grep -vE "— CLOSED" | grep -E "FIXED|CLOSED"
npm run followups:check > /tmp/fu.log 2>&1; echo "EXIT=$?"; tail -3 /tmp/fu.log
```

The first three must sum correctly, and the partials list must contain no entry that gained the word CLOSED. `followups:check` is a report, not a gate — it exits 0 regardless — so read its output rather than its status.

- [ ] **Step 5: Review the whole branch**

Per the standing rule, always run a code review before a release. Review the complete diff, not the individual commits — a per-task review is blind to the seams between tasks.

```bash
git log --oneline origin/main..HEAD
git diff origin/main...HEAD --stat
```

- [ ] **Step 6: Report, and do not push**

Summarise: which entries closed, which stayed open and why, what each new gate was proved to catch by mutation, and any claim corrected along the way.

**Do not push, open an MR, or merge.** Those require an explicit instruction. "Release" means push → MR → poll the pipeline → merge on green, and merging never uses auto-merge.

---

## Notes for whoever executes this

**No version bump.** This slice changes tooling, tests and possibly one refactor — nothing user-visible. `src/app/version.ts` is untouched, and there is no `CHANGELOG.md` entry. The new version gate will confirm the six restatements still agree with the unchanged `version.ts`.

**Commit messages** use a Bash heredoc, never a PowerShell here-string.

**Every new gate needs a mutation proof.** A gate observed only green is indistinguishable from one that cannot fail. Tasks 2 and 5 both include one; keep that standard for anything added along the way.

**When a measurement contradicts this plan, the measurement wins.** Several numbers here (25 severity-1 rules, 799 lines, 35 floors, 681 lockfile version keys) were measured on 2026-08-26 and can move. Re-run the command, and correct the plan's claim in the same commit that acts on the new number.
