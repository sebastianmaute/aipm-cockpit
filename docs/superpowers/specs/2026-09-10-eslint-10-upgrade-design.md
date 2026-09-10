# ESLint 10 upgrade — design

**Date:** 2026-09-10
**Status:** implemented and merged into `chore/eslint-10-upgrade`; corrected 2026-09-10 after two
cold reviews. ★★ Several claims below are marked ★★/★★★ where the original text was **false or
incomplete** — those markers are the record of what a review caught, not decoration. Every one was
prose; no shipped behaviour changed.
**Closes:** `docs/open-followups.md` §53 · the `eslint` ⛔ BLOCKED row in `docs/tech-debt-register.md`

## Goal

Move the repo from `eslint@9.39.4` to `eslint@10.10.0` without vendoring, forking or
patching any upstream package.

## The block, and why it is routable

`eslint-plugin-react@7.37.5` (published 2025-04-03, still the latest) crashes ESLint 10 during
rule **loading** — before a single file is linted, so the run exits 2 and writes no report at
all. §53 records the trace. It reproduces today:

```
TypeError: Error while loading rule 'react/display-name':
  contextOrFilename.getFilename is not a function
  at resolveBasedir (eslint-plugin-react/lib/util/version.js:31)
  at detectReactVersion (version.js:85)
  at getReactVersionFromContext (version.js:116)
  at testReactVersion (version.js:181)
  at usedPropTypesInstructions (usedPropTypes.js:307)
```

Read that stack from the bottom. `resolveBasedir` is reached **only** from `detectReactVersion`
and `detectFlowVersion`, and `getReactVersionFromContext` calls `detectReactVersion` on exactly
one condition — `settings.react.version === "detect"`. Nothing else in the plugin's enabled-rule
path touches a removed API unguarded.

`eslint-config-next` is what sets that value:

```bash
grep -n "detect" node_modules/eslint-config-next/dist/index.js   # → 143:  version: 'detect'
```

Our flat config spreads `...nextVitals` first, so a later `settings` entry wins. Pinning the
React version means `detectReactVersion` is never called, `resolveBasedir` is never reached, and
the removed API is never touched.

**Nothing else in the toolchain blocks v10.** Scanning every eslint-facing package for the APIs
ESLint 10 removed returns zero unguarded call sites outside `eslint-plugin-react`:

★★★ **THE FIRST VERSION OF THIS COMMAND COULD NOT READ THREE OF ITS NINE ROWS, AND REPORTED
THEM AS CLEAN.** It iterated `node_modules/$pkg`, but `eslint-plugin-jsx-a11y`,
`eslint-plugin-import` and `eslint-import-resolver-typescript` are **not hoisted** — they live
under `node_modules/eslint-config-next/node_modules/`. `grep -rl … <missing dir> | wc -l` prints
`0` because the path is absent, and those zeros were read as evidence. Compounding it, the
trailing `grep -v "/node_modules/"` stripped every nested hit even when the path *was* correct,
so no addressing could have rescued it. A scan that reads nothing passes everything.

★★ Two later replacements were **also** wrong, which is the reusable part: `require.resolve('<pkg>/package.json')`
fails with `ERR_PACKAGE_PATH_NOT_EXPORTED` for five of the ten (their `exports` maps don't expose
`./package.json`), and simply dropping the filter makes `eslint-config-next` report **9** — it
absorbs its nested child's hits. A replacement recipe inherits none of the verification of the
one it replaces. This is the third version, and the one that was run:

```bash
for pkg in eslint-config-next @next/eslint-plugin-next eslint-plugin-react-hooks \
           eslint-plugin-jsx-a11y eslint-plugin-import eslint-import-resolver-typescript \
           @typescript-eslint/eslint-plugin @typescript-eslint/parser @typescript-eslint/utils \
           eslint-plugin-react; do
  dir=$(npm ls --parseable "$pkg" 2>/dev/null | head -1)          # real location, hoisted or not
  [ -z "$dir" ] && { echo "$pkg: UNRESOLVED"; continue; }
  echo -n "$pkg: "
  grep -rlE "context\.(getFilename|getSourceCode|getScope|getAncestors|getDeclaredVariables|markVariableAsUsed|getCwd|getPhysicalFilename)\(|isSpaceBetweenTokens|getJSDocComment|CLIEngine" \
    "$dir" --include=*.js --include=*.cjs --include=*.mjs --exclude-dir=node_modules 2>/dev/null \
    | wc -l                                                        # prune each package's OWN deps
done
```

★★ **`eslint-plugin-react-hooks` returning 2 is the positive control** — it is what distinguishes
"the pattern found nothing" from "the pattern cannot match". Nine zeros with no non-zero row would
be worthless. Read that row first; if it is 0, the scan is broken, not the toolchain clean.

★★ **The regex does not cover `getComments`**, which ESLint 10 also removed
(`SourceCode.prototype.getComments` is `undefined` under 10). `eslint-plugin-react` references it
15 times across 6 files. None is on an enabled-rule path today — see the forward hazards below —
but the scan cannot see that class at all.

`eslint-plugin-react-hooks@7.1.1` is the only non-zero row (2 files) and every one of its call
sites is guarded — ★★ by a `typeof` ternary, **not** the `??` this spec claimed for four
revisions: `typeof context.getSourceCode === 'function' ? () => context.getSourceCode() : () => context.sourceCode`.
Note it prefers the *old* API where present, the opposite order from the invented quote. The
conclusion (guarded, therefore safe) was right; the quoted code never existed in the package. Its peer range already
names `^10.0.0`, as do `typescript-eslint@8.59.2` and `@typescript-eslint/parser@8.59.2`.
`eslint-config-next@16.2.6` peers `eslint: ">=9.0.0"`.

## Why not PR #4022

The request that opened this work was to adapt and bundle
[jsx-eslint/eslint-plugin-react#4022](https://github.com/jsx-eslint/eslint-plugin-react/pull/4022).
Measured, that is both larger than it looks and unnecessary here.

**Larger.** Upstream `master` is **38 commits / 152 files** ahead of the published `v7.37.5` and
still self-reports version `7.37.5`. The `getFilename` migration this crash needs already sits on
master, unpublished. So "bundle the PR" means bundling an unreleased upstream snapshot *plus* a
32-file PR on top, and owning it until upstream publishes.

```bash
curl -s https://api.github.com/repos/jsx-eslint/eslint-plugin-react/compare/v7.37.5...master \
  | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);console.log(j.ahead_by,j.total_commits,j.files.length)})"
```

**Unnecessary.** PR 4022's runtime changes land in 14 `lib/` files. Cross-referenced against the
rules this repo actually enables, none of its rule-level work applies:

| PR 4022 touches | enabled here? |
|---|---|
| `jsx-curly-spacing`, `jsx-equals-spacing`, `jsx-tag-spacing`, `jsx-space-before-closing`, `jsx-one-expression-per-line`, `jsx-props-no-spreading`, `boolean-prop-naming`, `no-arrow-function-lifecycle` | no — none is in our 17 |
| `lib/util/version.js` (an `ENOENT` hunk) | the file is on our path, but the hunk is a Windows virtual-path fix, not the crash |
| `lib/util/componentUtil.js` (`getJSDocComment` fallback) | on our path — see *Accepted cost* |

Enumerate today's set with `npx eslint --print-config src/app/task-manager.tsx` and filter for
`react/` entries at a non-zero severity.

## The change

Three files, plus one new test. ★ The line counts below were `+8` / "ten lines" when written and
were already wrong at commit time (`git diff --numstat` reported 10/0); the comment block has since
grown again in the 2026-09-10 correction round. **Derive it, don't read it here:**
`git diff --numstat $(git merge-base origin/main HEAD)...HEAD -- eslint.config.mjs`.

```
eslint.config.mjs    +8       # stale — see above
package.json         +1 / -1     "eslint": "^9"  →  "^10"
package-lock.json    +569 / -408
```

`eslint.config.mjs`:

```js
import { createRequire } from "node:module";
import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const reactVersion = createRequire(import.meta.url)("react/package.json").version;

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // eslint-config-next sets settings.react.version = "detect"; that detect path is the
  // ONLY route into eslint-plugin-react 7.37.5's removed context.getFilename() call, which
  // aborts rule loading under ESLint 10. Pinning the version skips it. Derived, not
  // restated, so it cannot drift from the react dependency.
  { settings: { react: { version: reactVersion } } },
  // ... existing globalIgnores and rules unchanged
]);
```

**The version is derived, not written down.** `createRequire` reads it from the installed
package, which is exactly what `detect` computed — measured: with the pin in place,
`--print-config` reports `{"version":"19.2.4"}`, matching the `react` pin.

★★★ **THE REASON IS THE ABSENCE OF A GATE, NOT THE PRESENCE OF ONE — and this paragraph argued
the opposite for four revisions.** It said a literal `"19.2.4"` would be caught because "this repo
runs a blocking `version-sync-check` job precisely because restated versions rot here". That job
never looks at React: `SATELLITES` in `scripts/version-sync-lib.mjs` is `package.json` /
`package-lock.json` / `README.md` / `docs/CODEMAPS/*.md`, and it compares `APP_VERSION` and the
codename only (`grep -in react scripts/check-version-sync.mjs` returns nothing). A hardcoded React
version would have been **equally out of scope**. So the derivation is load-bearing for the
opposite reason to the one given: **nothing in this repo would ever catch a stale one.** A false
justification is worse than none — it tells the next reader a guard exists.

**No `overrides` entry.** ★★ "A warning under both `npm install` and `npm ci`, never an error" is
**false as stated**: `npm install --dry-run --strict-peer-deps` exits **1** with `ERESOLVE`, and
it fails first on a package this spec never named — `eslint-plugin-import@2.32.0`. **Three**
packages carry a conflicting `eslint` peer, not one (`eslint-plugin-import@2.32.0`,
`eslint-plugin-jsx-a11y@6.10.2`, `eslint-plugin-react@7.37.5`). The decision still holds *for this
repo*, and that is the claim to make: there is no `.npmrc`, `npm config get strict-peer-deps` is
`false`, and every CI install site is a plain `npm ci` with no strict-peer flag — verify with
`grep -n "npm ci" .gitlab-ci.yml` (three sites today) rather than trusting a count here. Proved
by mutation, not assumed — see below. Note `package.json` *does* carry an `overrides` block (four
entries); what it has no key for is `eslint-plugin-react`.

`eslint.config.mjs` and `package.json` are both `i/lf w/crlf` (`git ls-files --eol`). Edit them
with the Edit tool or a `\r\n`-anchored script; a `\n`-anchored node replace silently no-ops and
`sed -i` re-lines the whole file.

## Evidence

Everything below was measured in a throwaway lab, never in a worktree:
`git archive HEAD | tar -x -C <scratchpad>/eslint10-lab2`, then a fresh `npm install`. The working
tree was verified untouched afterwards (`eslint 9.39.4`, spec `^9`, `git status --porcelain`
empty).

| check | command | result |
|---|---|---|
| baseline | eslint 9.39.4, `eslint --max-warnings=0 -f json -o A.json .` | exit 0, 2122 files, 0 findings |
| pin is inert under 9 | same, with the pin | exit 0, 2122 files, 0 findings; rule set byte-identical |
| **candidate** | eslint 10.10.0 + pin | **exit 0, 2122 files, 0 findings** |
| rule set preserved | diff `--print-config` enabled rules, 9 vs 10 | 86 vs 86 · `LOST: (none)` · `GAINED: (none)` · `SEVERITY CHANGED: (none)` · all 17 `react/*` present |
| files scanned | same file set both arms | 2122 vs 2122, `scanned only by 9: 0`, `scanned only by 10: 0` |
| `npm ci` | `rm -rf node_modules && npm ci --ignore-scripts` | exit 0, 0 `npm error`, 578 packages, `eslint` resolves 10.10.0 |
| lock idempotent | second `npm install` | `up to date in 2s`, no further churn |
| `npm audit` | `npm audit --audit-level=moderate` | 3 moderate, dev-only, **identical to baseline**; the CI gate is `--omit=dev --audit-level=high` |
| `docs:claims:check` | `npm run docs:claims:check` | exit 0 — 490 citations, none added |

★★ **THIS TABLE IS A DATED MEASUREMENT, NOT A LIVE PROPERTY — read `2122` as "what that run saw",
never as a number to match.** Post-merge with `origin/main` (0.301.0) the same whole-repo run
reports **2125 files**, still 0 errors / 0 warnings at exit 0. The delta is the merge bringing in
main's files, not a regression. The number is nonetheless quoted as a property in three places
(here, the plan, and the new tech-debt row), so anyone following the plan after a merge sees a
mismatch and may read it as breakage. Re-derive rather than compare:
`npx eslint --max-warnings=0 -f json . | node -e "…"` — or simply trust the exit code, which is
what actually gates.

★★ **The differential rows are the ones nobody has re-run**, and they are what the safety argument
rests on: "byte-identical", "same file set", `LOST/GAINED/SEVERITY (none)`. Re-deriving them needs
eslint 9 installed, which this worktree cannot do without `npm ci`. A cold review corroborated the
*rule-set* half by borrowing a real `eslint@9.39.4` read-only from a sibling worktree and driving
it against this config — identical `86`/`17` and `82`/`17` — but the file-count half of the
before/after has not been replayed. Treat the carry-forward as an argument, not a measurement.

**A green run over zero findings is the vacuous shape this repo has been bitten by, so the
result is only worth its controls.**

*Positive control.* A probe file planting seven violations was linted under both arms. The
finding sets are byte-identical — same rule ids, same lines:

```
@typescript-eslint/no-unused-vars@4   import/no-anonymous-default-export@22
no-restricted-imports@1               react-hooks/rules-of-hooks@8
react/display-name@22                 react/jsx-key@14
react/no-unescaped-entities@16
IDENTICAL: true
```

`react/display-name` is the load-bearing row: it is the exact rule named in §53's crash trace, so
its firing proves the plugin's rules both load and run under v10.

*Mutant 1 — the pin.* Removed the `settings` entry, kept eslint 10. **Killed**: exit 2, no
findings file written, and §53's trace reproduced verbatim. The pin is load-bearing and is the
single thing standing between this repo and ESLint 10.

*Mutant 2 — the peer override.* Deleted `overrides["eslint-plugin-react"]`, deleted the lockfile,
reinstalled from scratch. **Survived**: install exit 0, zero `npm error`, `eslint 10.10.0`
resolved. So the override is not required and is deliberately absent from this design — shipping
it would mean shipping a guard that cannot be shown to fire.

## Forward hazards — safe today, fatal the day someone enables one

★★★ **NOT A LIVE DEFECT, AND NOT DERIVABLE FROM ANYTHING ABOVE.** Found by cold review after this
design was written, by running all 103 `react/*` rules one at a time under both engines.

**Six rules throw under v10 and not under v9**, none of them among our enabled 17:
`forward-ref-uses-ref`, `jsx-curly-spacing`, `jsx-equals-spacing`, `jsx-filename-extension`,
`jsx-one-expression-per-line`, `jsx-tag-spacing`. Enabling any of them **hard-crashes lint** —
a loud failure, not a silent one, so it cannot ship unnoticed; but it will read as "my new rule is
broken" rather than "this plugin predates ESLint 10".

★★ **Treat six as a FLOOR, not an enumeration.** One snippet cannot reach every removed-API path.
Separately, `SourceCode.prototype.getComments` is `undefined` under ESLint 10 and
`eslint-plugin-react` references it 15 times across 6 files (`jsx-curly-brace-presence`,
`jsx-curly-spacing`, `jsx-props-no-multi-spaces`, `jsx-sort-props`, `no-arrow-function-lifecycle`,
`util/propTypesSort.js`). None of those, and none of `propTypesSort`'s four consumers
(`jsx-sort-default-props`, `jsx-sort-props`, `sort-default-props`, `sort-prop-types`), is enabled
here. The toolchain scan's regex does not look for `getComments` at all.

★ **Why the seven scanned rules are safe is stronger than "off".** They are **ABSENT** from the
resolved config — `--print-config` has no key for them, so they never load. That is a different
state from present-but-off: 22 `react/*` keys *are* present, of which 5 are explicitly `off`
(`jsx-no-target-blank`, `no-unknown-property`, `no-unsafe`, `prop-types`, `react-in-jsx-scope`).

**So the nine hits in `eslint-plugin-react` decompose cleanly**, which is better evidence for the
"exactly one degradation" claim than this design originally carried:

| Hits | Status |
|---|---|
| 7 rules | **absent** from the resolved config; never load |
| `lib/util/eslint.js` (4 matches) | feature-detected compat shim (`sourceCode.X ? … : context.X(…)`); the removed branch is dead under v10 |
| `lib/util/componentUtil.js:72` | **the one live hit** — the accepted cost below |

## Accepted cost

`componentUtil.js:72` calls `sourceCode.getJSDocComment(node)`, removed in ESLint 10. It sits
inside a pre-existing `try/catch` that swallows the resulting `TypeError` and sets
`comment = null`, so `isExplicitComponent` returns `false`. **A class declared a React component
only by an `@extends React.Component` JSDoc tag stops being recognised as one.**

This is a silent degradation, not a crash, and it is the one thing PR 4022 would fix for us.

Its blast radius here is empty today:

```bash
grep -rn "@extends\|@augments" src e2e e2e-crossengine scripts   # → 1 hit, see below
grep -rn "extends React.Component\|extends Component" src --include=*.tsx --include=*.ts
                                                   # → 3 hits, see below
```

★★ **BOTH ANNOTATIONS WERE BROKEN BY TASK 4 OF THIS SAME DESIGN, and read as "→ no matches" and
"→ 1 hit" until 0.301.x.** The guard test added in that task is itself matched by both commands:
its docstring names the tags it scans for, and two of its lines carry `extends Component`.
Neither is a real offender — the scan excludes itself by basename, so the tags in its own
docstring cannot make it red — but the recipe as published now contradicts the sentence it
supports. This is the self-referential-grep trap: a command quoted in a file it scans matches
itself the moment it lands. Re-run it **after** the edit, never before.

★★★ **AND THE CORRECTION ABOVE WAS ITSELF RE-STALED INSIDE ITS OWN COMMIT RANGE — third instance
of this class here.** It was written as "2 hits … its `extends Component` assertion matches the
second", against the tree as it stood *before* the guard-test commit three commits earlier in the
same range. That commit replaced the `toContain("extends Component")` assertion the sentence
names with a regex and added two *new* self-matching lines, so the count was 3 and the named
mechanism no longer existed. A correction inherits none of the verification of the thing it
corrects: re-run the command against the tree at the END of the round, not at the moment the
replacement sentence is typed.

The one class component is detected by `isES6Component`, not the JSDoc path. Nothing would detect
a future JSDoc-declared one, which is why Task 4 below adds a cheap guard.

## Tasks

1. **The upgrade.** Edit `eslint.config.mjs` (CRLF-anchored) and `package.json`, run
   `npm install`, commit all three files including the lockfile.
2. **Verify at CI's SCOPE, not just CI's strictness.** `npm run lint` is
   `eslint --max-warnings=0` with **no path argument** — the whole repo, not `src`. A
   `npx eslint --max-warnings=0 src` matches the strictness and not the scope, and every
   measurement behind this design used the whole-repo scope (2122 files), so the verification
   must too. Read the exit code unpiped, never through a pipe. Confirm `--print-config` still
   reports 86 enabled rules and 17 `react/*`. ★ If the whole-repo run reds on gitignored
   `.worktrees/` or `.demo-tmp/` leftovers, that is the pre-existing cause `AGENTS.md` records —
   not the upgrade. Clear them and re-run rather than narrowing the scope to hide it.
3. **Close the records.** Mark §53 closed in `docs/open-followups.md` with a dated `**Status:**`
   line citing a real command; flip the `eslint` row in `docs/tech-debt-register.md` from
   ⛔ BLOCKED to resolved and move it to the Resolved table; correct TD-1's cross-reference,
   which currently tells a reader to "check against the ESLint 10 block". Line numbers are
   forbidden in these entries — cite the symbol plus a reproduce grep, or `docs:claims:check`
   goes red on the new citations.
4. **Guard the accepted cost.** Add a unit test asserting zero `@extends` / `@augments` JSDoc
   tags across `src`. Small, and it is the only thing that would ever notice the
   `getJSDocComment` degradation. Mutation-prove it by planting a tag and confirming red.
5. **Keep the pin permanently.** When upstream eventually publishes v10 support, do not remove
   it — an explicit version is faster (no filesystem probe per rule load) and deterministic.
   Say so in the comment, which Task 1 already does.

## Gates

`npm run lint` is the gate this touches. Also run `docs:claims:check`,
`followups:status:check` and `followups:index:check` because Task 3 edits the register — filing a
register entry has reddened a branch on the claims ratchet before.

Not required: the browser gates. Nothing about rendering, CSP or the DOM changes.

## Release

Not refactor-only, so this takes a version bump and a `CHANGELOG.md` entry; the exact number is a
release-time call. `version.ts` is the source of truth — propagate with `npm run version:sync`,
never by hand.
