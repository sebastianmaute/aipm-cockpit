# Gate blind spots — design

**Date:** 2026-08-26
**Branch:** `chore/gate-blind-spots`
**Base:** `main` at 0.260.1 "Cho"
**Register entries:** §214 · §236 · §244 · §229 · §60

## Problem

Five register entries describe gaps in what CI can see. Four are actionable; one is already
discharged and needs only a closure edit.

- **§214** — CI's `lint:` job runs bare `npm run lint`, `package.json`'s `lint` script is bare
  `eslint`, and no `--max-warnings` flag exists anywhere. `@typescript-eslint/no-unused-vars`
  resolves to severity 1, and `tsconfig.json` sets neither `noUnusedLocals` nor
  `noUnusedParameters`. An unused import reaches `main` with every gate green.
- **§236** — `src/app/version.ts` is the source of truth for the version and codename, and six
  other places restate one or both. Nothing compares them: `grep -rn "APP_VERSION" scripts/
  .gitlab-ci.yml` returns no output. The satellites have drifted six and eleven releases behind
  before, silently.
- **§244** — `entity-id-mint.property.test.ts` failed a BLOCKING gate on the 0.259.0 release
  pipeline with `expected 0 to be greater than 0`, while the same tests passed in the sibling job.
  fast-check is unseeded, so `--sequence.seed` does not reach its generator and a green local run
  is evidence neither way. Measured at ~1 in 2,857 per suite run, and the suite runs in two
  blocking jobs per pipeline.
- **§229** — `use-chat-dispatcher.ts` and `use-storage-backend.ts` both measure 799 lines by the
  gate's arithmetic with no baseline entry. Headroom is one line, not zero: `LIMIT` is 800 and the
  check reads `if (n <= LIMIT) continue`, so the first added line passes at 800 and the second
  fails at 801 as a `NEW file over 800`.
- **§60** — the file-size ratchet ignores every file at or under 800 lines. Its one actionable
  residual, a stale `use-resource-planner.ts: 554` baseline line, is gone.

## Measurements taken during design

All figures below were run against this checkout on 2026-08-26, not carried from the register.

**§214 — what the flag actually promotes.** 25 rules sit at severity 1 and 61 at severity 2. The 25
are not only `no-unused-vars`: they include 7 `jsx-a11y` rules (`alt-text`, `aria-props`,
`aria-proptypes`, `aria-unsupported-elements`, `role-has-required-aria-props`,
`role-supports-aria-props`) and 13 `@next/next` rules, plus `react-hooks/exhaustive-deps`,
`react-hooks/incompatible-library`, `react-hooks/unsupported-syntax`,
`import/no-anonymous-default-export` and `@typescript-eslint/no-unused-expressions`.

Reproduce — redirect stderr separately, or `npm notice` output corrupts the JSON:

```bash
npx eslint --print-config src/app/icons.ts > /tmp/ec.json 2>/tmp/ec.err
node -e 'const r=require("/tmp/ec.json").rules,s=(v)=>Array.isArray(v)?v[0]:v;
  const w=Object.entries(r).filter(([,v])=>s(v)===1||s(v)==="warn");
  console.log("severity-1:",w.length,"severity-2:",Object.entries(r).filter(([,v])=>s(v)===2||s(v)==="error").length);
  console.log(w.map(([k])=>k).join("\n"));'
```

The codebase already annotates these rules inline — `@next/next/no-img-element` at
`app-header.tsx` and `branding-image-input.tsx`, `react-hooks/exhaustive-deps` at
`color-scheme-editor.tsx`, `dashboard-panel.tsx`, `global-search-box.tsx` and `jira-settings.tsx`.
The 0-warning measurement holds because the exceptions are already declared, so promoting them to
blocking codifies existing practice rather than imposing a new one.

**§236 — line endings straddle both families.** The writer touches files governed by
`.gitattributes` and files governed by `core.autocrlf`:

```bash
git ls-files --eol package.json package-lock.json README.md src/app/version.ts docs/CODEMAPS/architecture.md
```

`README.md` and `docs/CODEMAPS/*.md` report `i/lf w/lf attr/text eol=lf`; `package.json`,
`package-lock.json` and `src/app/version.ts` report `i/lf w/crlf attr/` with no attribute.

**§236 — currently in sync.** All six restatements read `0.260.1`, codename `Cho`. This is a hazard,
not a live defect.

**§244 — the register's "19 of 31" conflates two different things.** A depth scan classifying each
`toBeGreaterThan` / `toBeGreaterThanOrEqual` by whether it sits inside an `fc.property` callback
returns 43 outside and 24 inside. The 43 over-counts. Verified by reading:
`document-model.property.test.ts` lines 269, 273, 278 and 298 sit inside the `assertBlockInvariants`
and `assertDocInvariants` helpers; `export-sections.rich.property.test.ts` 182 and 183 sit inside
the `cellFor` helper; `export-sections.rich.property.test.ts:365` (`RICH_TARGETS.length`) and
`gantt-engine.property.test.ts:236` (`LEFT_GUTTER_PX` against `GANTT_NAME_COL_MIN`) compare static
constants. All eight are deterministic per-run invariants, not run-counters.

**Honest surface: 35 anti-vacuity floors across 7 files.**

| file | floors |
|---|---|
| `codec-roundtrip.property.test.ts` | 12 |
| `entity-id-mint.property.test.ts` | 8 |
| `rich-text-plain.property.test.ts` | 5 |
| `document-model.property.test.ts` | 3 |
| `export-sections.rich.property.test.ts` | 3 |
| `sanitize-core.property.test.ts` | 3 |
| `document-mutations.property.test.ts` | 1 |

Not all 35 are defective. `sanitize-core.property.test.ts:102` already reads "Floor at half the
(constructed, seed-independent) 30/30 count" — construction-backed and correct as written. The
audit's job is to sort the 35, not to rewrite them.

**§229 — both files measure 799, with zero baseline entries.**

```bash
node -e "console.log(require('fs').readFileSync('src/app/use-chat-dispatcher.ts','utf8').split('\n').length)"
node -e "console.log(require('fs').readFileSync('src/app/use-storage-backend.ts','utf8').split('\n').length)"
grep -c "use-chat-dispatcher\|use-storage-backend" docs/baselines/file-sizes.json
```

The first two print 799; the third prints 0 and exits 1, which is the answer.

**§60 — residual discharged.** `grep -c use-resource-planner docs/baselines/file-sizes.json` prints 0.

## Scope and order

| # | entry | shape |
|---|---|---|
| 1 | §214 | `--max-warnings=0` in `package.json` `lint`, plus the doc ripple |
| 2 | §236 | `check-version-sync.mjs` checker, `--update` writer, blocking CI job |
| 3 | §60 | closure edit only |
| 4 | §244 | measurement harness, audit of 35 floors, fixes for the probabilistic ones |
| 5 | §229 | survey both 799-line files, extract where a cohesive surface exists |

**Why this order.** §214 lands first so the unused-import gate is live while §229 moves code —
extraction is the operation most likely to strand an import, and AGENTS.md records that
`_`-prefixed params are not exempt, so a manual re-check is required after every extract. §244
precedes §229 so a flaky property suite cannot be mistaken for extraction fallout.

## §214 — the lint gate

Change `package.json`'s `scripts.lint` from `eslint` to `eslint --max-warnings=0`.

The flag goes in the script, **not** in the `.gitlab-ci.yml` `lint:` job. Putting it in the job
re-creates the exact divergence that caused the confusion — `npm run lint` passing locally while CI
enforces something stricter. One script line keeps local and CI identical.

**Why the wide route rather than promoting the single rule.** Setting
`"@typescript-eslint/no-unused-vars": "error"` in `eslint.config.mjs` is narrower, but that file is
hook-protected and cannot be edited by an agent. The flag also brings the 7 `jsx-a11y` rules along,
which matters in a codebase where the axe gate is measurably blind to whole classes of a11y defect.

**Proving the gate is live.** A green run cannot distinguish a wired flag from an unwired one. Add
an unused import to a scratch source file, confirm the run exits 1, then revert by anchored write
with a uniqueness assertion — `git checkout` against a path is deny-blocked in this environment —
and prove `git diff --stat` is empty afterwards.

**Doc ripple.** Scoped to the three files that assert the gate is absent:

```bash
grep -rn -- "--max-warnings" AGENTS.md CONTRIBUTING.md docs/CODEMAPS/architecture.md
```

7 lines today, of which exactly 4 assert absence and go false: `AGENTS.md` twice (the "there is NO
`--max-warnings` gate" line and the "STRICTER than CI" line), `CONTRIBUTING.md` once,
`docs/CODEMAPS/architecture.md` once. The other 3 use the flag in example commands and survive.
The "STRICTER than CI" sentence must be **rewritten**, not deleted — the relationship it describes
inverts rather than disappearing.

Do not add `docs/open-followups.md` to that command: it is self-matching, because §214, §45 and §53
all quote the flag, so the number moves every time the entry is edited.

## §236 — version-sync checker and writer

`scripts/check-version-sync.mjs` reads `APP_VERSION` and `APP_MILESTONE` from `src/app/version.ts`
as the source of truth and compares:

1. `package.json` `version`
2. `package-lock.json` root `version`
3. `package-lock.json` `packages[""].version`
4. `README.md` shields badge — version **and** codename
5. `docs/CODEMAPS/*.md` generated headers — version **and** codename, every file

It prints every reading before its verdict, so a green result is falsifiable rather than asserted,
and it **throws** if a shape it depends on has moved rather than reporting IN SYNC on a regex that
stopped matching.

`--update` propagates version.ts's values to all six. Two constraints on the writer:

- **Preserve each file's working-tree line endings.** `README.md` and the codemaps are LF-pinned by
  `.gitattributes`; `package.json` and `package-lock.json` are CRLF in the working tree under
  `core.autocrlf`. A re-lined file commits to a byte-identical blob but survives locally with
  `git status` reporting clean, and git's warning goes to stderr where a redirect swallows it.
- **Never JSON round-trip.** Parsing and re-stringifying `package-lock.json` would reformat the
  entire file. Targeted text replacement only.

**Wiring.** `version:check` and `version:sync` scripts in `package.json`, each with a
`scriptsDescriptions` entry — omitting one fails `docs:scripts:check`. A new blocking
`version-sync-check` job in the `quality` stage.

**Tests.** `scripts/check-version-sync.test.mjs`. `vitest.config.ts` `include` already covers
`scripts/**/*.{test,spec}.mjs`, and `coverage.include` stays `src/**`, so a script test raises no
coverage floor. Cases: in-sync passes; each of the six drifted independently fails and names the
file; a moved badge or header shape throws rather than passing; `--update` round-trips without
changing line endings or reformatting.

**Proving it live.** Drift one satellite, prove the gate goes red; restore, prove it goes green. A
gate that has only ever been observed green is indistinguishable from one that cannot fail.

**Doc ripple.** AGENTS.md's "FIVE MORE PLACES CARRY THE VERSION AND NO GATE CHECKS ANY OF THEM"
bullet goes false on landing and must be rewritten to describe the gate.

## §60 — closure edit

The entry's residual is discharged and verified. Mark the `##` heading `— CLOSED` per the register's
one-status convention, keeping the entry in place. Do not move it, and do not add a `**Status:**`
line as the only marker — a status that lives only in a body line is invisible to every count.

## §244 — floor audit

**Build `scripts/measure-property-floor.mjs` once.** It runs a property's counters N times and
reports the probability that a counter lands below its floor. Two things it must get right, both
recorded as traps:

- Replace any mock minter with a plain closure before measuring. The counters derive from the
  returned result, never from the mock, and 20,000 × 50 accumulated mock call records terminate the
  vitest worker with `ERR_WORKER_OUT_OF_MEMORY` — which reads like a broken harness rather than a
  measurement error.
- Report a probability, not a sample minimum. Raising `numRuns` at an unchanged absolute floor makes
  the guard weaker, not the run safer.

**Sort all 35 floors** into construction-backed and probabilistic. **Fix only the probabilistic
ones**, by making the interesting case hold by construction — the cure already applied to
`sanitize-core`'s `midPairCutArb` — so the floor becomes a fact about the generator rather than a
bet on it. Record each floor's measured probability in a comment beside it.

Each generator fix changes what the property covers, so each needs a before/after measurement. A
green run is not evidence that the fix preserved coverage.

**Explicitly forbidden**, all three recorded in the entry:

- Raising `numRuns` at the same floor.
- Skipping the test. An intermittently-red property gets skipped by whoever draws the unlucky seed,
  which costs the guard entirely.
- Global fast-check seeding. It buys determinism by making every property see one input set forever,
  which is most of why a property test exists.

**Register correction.** §244's "Measured 2026-08-25: 19 of 31 `*.property.test.ts` files carry a
numeric floor" is true as stated but conflates per-run invariants with run-counters, and a reader
sizing the work from it over-scopes by more than half. Replace it with the 35-across-7 measurement
and the classification method, keeping the original figure visible as what it actually counted.

## §229 — survey

Measure with the gate's own arithmetic — `readFileSync().split("\n").length`, which for a
newline-terminated file is one more than `wc -l`. Never budget from `wc -l`: it overstates headroom
by exactly one line and has already cost a build on `use-storage-backend.ts`.

Survey both files for extraction seams. §220's precedent is the reason to survey before concluding:
it asserted its subject file's one cheap seam "was spent and cannot be spent again", and three were
found in one afternoon — a deleted-documents section, a rename modal and a block editor, each a
whole cohesive surface rather than a relocated helper.

Extract wherever a cohesive surface exists. Where one genuinely does not, record the survey in the
entry — what was considered and why it was rejected — rather than forcing an extraction that
relocates helpers without buying cohesion. In that case §229 stays open, better-informed, which is
strictly better than today's open-and-unsurveyed.

**Not closable by adding a baseline entry.** Baselining a file to admit growth is the "re-baseline
to make the pipeline pass" failure the gate exists to prevent, and it converts a hard cap into an
open-ended ratchet.

If an extraction creates a new `.ts` file, check `vitest.config.ts` `coverage.exclude`: an extracted
`use*` hook becomes coverage-gated. Exclude pure UI glue; test real logic.

## Non-goals

- **No version bump.** Tooling and refactor only, no user-visible behaviour change.
- **No `eslint.config.mjs` edit.** Hook-protected, and the flag covers the rule.
- **No global fast-check seed.**
- **No baseline entry for §229.**
- **No sweep of the 24 in-property invariants.** They are deterministic and correct.

## Risks

**The §236 writer is the sharpest edge.** A bad rewrite of the README badge markup or a codemap
header is a new failure mode the checker cannot catch, because the checker reads the same shape the
writer produced. Round-trip tests are load-bearing, not optional.

**§214's flag makes 25 rules blocking at once.** Measured green on this checkout, but a branch in
flight elsewhere could go red on a rule that was previously advisory. The failure is legible and the
fix is local, but it is a cost paid by whoever is mid-branch.

**§244's generator fixes change coverage.** Fixing a floor by construction narrows or shifts the
input distribution. Each fix needs its own before/after measurement.

**§229 may find no cheap seam.** Accepted by design — the survey is the deliverable.

## Verification

Every gate, run unpiped with the exit code read directly:

`npm run lint` with the new flag · `npx tsc --noEmit` · `npm run test:run` · `npm run test:shuffle` ·
`npm run size:check` · `npm run dup:check` · `npm run docs:symbols:check` ·
`npm run docs:claims:check` · `npm run version:check` (new) · `npx playwright test e2e/a11y.spec.ts
--workers=1` if any UI moves.

Never read a gate's exit code through a pipe — that reports the pipe's status and discards the
failure diagnostic.

Each new gate additionally needs a mutation proof: break the thing it checks, confirm red, restore,
confirm green.
