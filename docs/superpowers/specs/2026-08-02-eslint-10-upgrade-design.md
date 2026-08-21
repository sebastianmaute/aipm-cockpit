# ESLint 9 → 10 upgrade

Date: 2026-08-02
Status: approved (design)
Scope: tooling. No product behaviour change. Ships as its own MR, separate from the UX slice.

## Goal

Move the repo from `eslint@^9` (currently resolving 9.39.4) to `eslint@^10` (latest 10.8.0)
without weakening the blocking CI lint gate.

## Current state

- `eslint: ^9`, `eslint-config-next: 16.2.6`, `typescript: ^6.0.3`, `next: ^16.2.11`.
- `eslint.config.mjs` is 22 lines: flat config, `defineConfig([...nextVitals, ...nextTs, globalIgnores([...])])`.
- No custom plugins, no custom rules, no `FlatCompat`, no `.eslintrc`.
- CI quality job image: `node:20-bookworm-slim`. Local: Node v24.18.1.
- The gate is `npx eslint --max-warnings=0 src/app` in CI. `npm run lint` is bare `eslint`
  with no `--max-warnings`, so it **exits 0 with warnings present** and does not reproduce
  the gate.

## Breaking-change audit (measured, not assumed)

Each row was probed against this repo, not inferred from the migration guide alone.

| v10 breaking change | Applies here? | Evidence |
|---|---|---|
| Node < 20.19 / 21 / 23 unsupported | **Verify** | local v24 ✓; CI is the floating tag `node:20-bookworm-slim` |
| `eslint:recommended` gains 3 rules | **Yes, 6 violations** | ran all three under eslint 9: `no-useless-assignment` **6** across 6 files; `no-unassigned-vars` 0; `preserve-caught-error` 0 |
| New config-file lookup (from file dir upward) | No action | single root `eslint.config.mjs`; no `v10_config_lookup_from_file` flag in use |
| Old `.eslintrc` format removed | No | flat config already; `ESLINT_USE_FLAT_CONFIG` unused |
| `FlatESLint` / `LegacyESLint` APIs removed | No | not used |
| JSX references now tracked | **Unknown — the spike** | see below |
| `eslint-env` comments now errors | No | `grep -rn "eslint-env" src scripts e2e` → **0** |
| jiti < 2.2.0 unsupported | No | config is `.mjs`, not TypeScript |
| POSIX character classes in globs | No | no bracket expressions in `globalIgnores` or CLI globs |
| `stylish` formatter chalk → `styleText` | Cosmetic | colour-detection env vars only |
| plugin/`RuleTester`/`SourceCode`/`context` API removals | No | 0 custom plugins or rules in-repo |
| `nodeType` dropped from `LintMessage` | No | no ESLint Node API integration in-repo |

`npm install eslint@10 --dry-run` resolves cleanly — **no ERESOLVE peer conflict**.
`eslint-config-next@16.2.6` declares `peerDependencies: { eslint: ">=9.0.0" }`, which v10
satisfies. The install removes `@eslint/eslintrc` and `@eslint/js` and bumps
`@eslint/core`, `@eslint/config-array`, `@eslint/plugin-kit`, `acorn`.

### The one real unknown: JSX reference tracking

v10 treats `<Card />` as a reference to the in-scope `Card` binding. Previously it did not,
which plugins worked around. Consequences that can land in a `.tsx`-heavy repo:

- Reports that **disappear** (a component imported and only used in JSX no longer reads as
  unused) — harmless.
- Reports that **appear** (`no-undef` on a JSX identifier with no import) — these become
  fatal under `--max-warnings=0`.
- `eslint-config-next` may still ship a `jsx-uses-vars`-style workaround rule; if so it is
  now redundant, and whether it becomes noisy or merely inert is unverified.

This cannot be probed under eslint 9. It is the go/no-go spike.

## Plan

1. **Pre-work, independent of the upgrade.** Fix the 6 `no-useless-assignment` violations
   under eslint 9 (`npx eslint --rule '{"no-useless-assignment":"error"}' src scripts e2e`).
   Landing these first means the upgrade commit contains only upgrade fallout, and the fix
   is verifiable on the current toolchain.
2. **Confirm the CI Node floor.** Resolve what `node:20-bookworm-slim` actually pulls today.
   If it is ≥ 20.19.0 the gate passes, but the tag floats and a future rebuild could drop
   below the floor. Recommend pinning the quality job to `node:22-bookworm-slim` in the same
   MR. The Playwright job (`mcr.microsoft.com/playwright:v1.61.1-jammy`) does not lint and
   is untouched.
3. **Spike.** `npm i -D eslint@^10`, then run the gate **unpiped** and read the exit code
   directly:
   ```bash
   npx eslint --max-warnings=0 src/app; echo "EXIT=$?"
   npx eslint --max-warnings=0 . > /tmp/lint-all.log 2>&1; echo "EXIT=$?"
   ```
   Classify every new report as (a) genuine JSX-tracking finding, (b) config-next plugin
   incompatibility, (c) rule-default change.
4. **Resolve fallout.** Fix real findings in source. Do not disable a rule to get green
   without recording why.
5. **Codemod, only if the spike shows it is needed.** `npx codemod @eslint/v9-to-v10`. Its
   four sub-codemods target legacy flags, custom rules, `RuleTester`, and the Linter/ESLint
   API — all of which this repo either lacks or does not use, so expect it to be a no-op.
   Review its diff rather than trusting it.
6. **Full gate run.** `npx tsc --noEmit`, `npm run test:run` (redirect, unpiped exit code),
   `npm run build`, and `e2e:smoke`.

## Constraints

★ **`eslint.config.mjs` edits are hook-blocked** by the config-protection hook. If the spike
requires a config change — or the codemod wants to touch that file — the edit has to be
applied by the user. Plan for a hand-off point there rather than discovering it mid-run.

★ **Never read a gate's exit code through a pipe.** `npx eslint … | grep -v notice` reports
grep's status: a pass reads as a failure when grep matches nothing, and `npm run test:run |
tail` reports 0 while tests fail. Redirect to a file, echo `$?` unpiped, then read the file.

★ `npm run lint` does not reproduce the CI gate (no `--max-warnings`). Every green claim in
this work must come from `npx eslint --max-warnings=0 …`.

## Rollback

If `eslint-config-next@16.2.6`'s bundled plugins misbehave under v10 in a way that cannot be
resolved without loosening the gate, revert `eslint` to `^9` and revisit once Next ships a
v10-tested config. The upgrade is a single dependency bump plus source fixes; the source
fixes (step 1) are keepers either way.

## Definition of done

- `eslint@^10` in `package.json`, lockfile updated.
- `npx eslint --max-warnings=0 src/app` → EXIT=0, verified without a pipe.
- Zero rules disabled or downgraded to make the gate pass, or each one recorded with a
  reason and a follow-up entry in `docs/open-followups.md`.
- CI quality job's Node version confirmed at or above the v10 floor.
- `docs/RUNBOOK.md` / `CONTRIBUTING.md` checked for a stated ESLint version and corrected
  if one exists.
