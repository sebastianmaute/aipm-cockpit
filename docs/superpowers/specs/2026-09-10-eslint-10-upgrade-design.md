# ESLint 10 upgrade — design

**Date:** 2026-09-10
**Status:** design approved, not implemented
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

```bash
for pkg in eslint-config-next @next/eslint-plugin-next eslint-plugin-react-hooks \
           eslint-plugin-jsx-a11y eslint-plugin-import eslint-import-resolver-typescript \
           @typescript-eslint/eslint-plugin @typescript-eslint/parser @typescript-eslint/utils; do
  echo -n "$pkg: "
  grep -rlE "context\.(getFilename|getSourceCode|getScope|getAncestors|getDeclaredVariables|markVariableAsUsed|getCwd|getPhysicalFilename)\(|isSpaceBetweenTokens|getJSDocComment|CLIEngine" \
    "node_modules/$pkg" --include=*.js --include=*.cjs --include=*.mjs 2>/dev/null \
    | grep -v "/node_modules/" | wc -l
done
```

`eslint-plugin-react-hooks@7.1.1` is the only non-zero row (2 files) and every one of its call
sites is `??`-guarded (`context.sourceCode ?? context.getSourceCode()`); its peer range already
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

Three files. Ten lines of source.

```
eslint.config.mjs    +8
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

**The version is derived, not written down.** A literal `"19.2.4"` would be a fourth place the
React version lives, and this repo runs a blocking `version-sync-check` job precisely because
restated versions rot here. `createRequire` reads it from the installed package, which is exactly
what `detect` computed — measured: with the pin in place, `--print-config` reports
`{"version":"19.2.4"}`, matching the `react` pin.

**No `overrides` entry.** The peer conflict (`eslint-plugin-react` peers `^9.7`) is a warning
under both `npm install` and `npm ci`, never an error. This was proved by mutation, not assumed —
see below.

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

## Accepted cost

`componentUtil.js:72` calls `sourceCode.getJSDocComment(node)`, removed in ESLint 10. It sits
inside a pre-existing `try/catch` that swallows the resulting `TypeError` and sets
`comment = null`, so `isExplicitComponent` returns `false`. **A class declared a React component
only by an `@extends React.Component` JSDoc tag stops being recognised as one.**

This is a silent degradation, not a crash, and it is the one thing PR 4022 would fix for us.

Its blast radius here is empty today:

```bash
grep -rn "@extends\|@augments" src e2e scripts     # → no matches
grep -rn "extends React.Component\|extends Component" src --include=*.tsx --include=*.ts
                                                   # → 1 hit, error-boundary.tsx:19, syntactic
```

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
