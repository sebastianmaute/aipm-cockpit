# Open-follow-ups cross-check and mandatory `**Status:**` convention — design

**Date:** 2026-08-28 · **Branch base:** `main` at `30b0a841` (0.263.0 "Okorafor")

## Goal

Every OPEN entry in `docs/open-followups.md` carries a `**Status:**` line saying what it is, when it
was last verified, and by what EXECUTED command. Entries a command proves dead are closed. A new
blocking CI job keeps the convention from decaying the way the last one did.

No `src/` behaviour changes. This slice touches the register, `scripts/`, `.gitlab-ci.yml`,
`package.json` and `AGENTS.md`.

## Measurements

★★ Every number below was measured on 2026-08-28 at `30b0a841` against a clean tree. **Numbers in
this register rot** — each is paired with the command that reproduces it. Re-run before relying on
one; do not carry these figures into the register itself.

### Entry counts

```bash
grep -cE "^## [0-9]+." docs/open-followups.md
grep -E "^## [0-9]+." docs/open-followups.md | grep -c "— CLOSED"
grep -E "^## [0-9]+." docs/open-followups.md | grep -cv "— CLOSED"
npm run followups:check
```

275 numbered · 100 closed · **175 open**. All four independent witnesses agree, including
`isClosed` in `scripts/followup-claims-lib.mjs`, which tests for the bare word rather than the
`— CLOSED` marker. The 11 partially-fixed entries all correctly avoid the word CLOSED.

### The gap this slice closes

| set | n |
|---|---|
| open entries with **no** `**Status:**` line | **118** |
| open entries stale or undated (last ISO date < 2026-08-20, or none) | 99 |
| union — open entries needing work | **142** |
| open entries needing nothing | 33 |
| *of the union:* no Status **and** stale | 75 |
| *of the union:* stale, has Status | 24 |
| *of the union:* no Status, **fresh** (≤ 8 days) — no probe needed | 43 |

Closed entries are unaffected by the new rule; 43 of the 100 already carry a Status line anyway.

### `--run-repro` covers 29% and does not say so

Run at `30b0a841`, tree clean before and after (`git rev-parse --short HEAD` and
`git status --porcelain` captured on both sides — the overlapping-writer guard):

```bash
node scripts/check-followup-claims.mjs --run-repro
```

Result: 5 `REPRO_UNRUNNABLE`, **zero drift**, verdict buckets unchanged
(`CLEAN=165 PATH_MISSING=1 NO_MACHINE_CLAIM=1 SYMBOL_THIRD_PARTY=2 SYMBOL_MISSING=4
PATH_THIRD_PARTY=1 SYMBOL_SELF_EXCLUDED=1`).

That green is worth 29%:

| | |
|---|---|
| command lines inside bash fences, open entries | 297 |
| commands `reproEntriesIn` extracts | 85 (29%) |
| open entries with at least one runnable command | 49 / 175 (28%) |

Two independently-derived measures, same ratio. The report's closing line — *"Every entry above
still needs a probe"* — is true but says nothing about the 126 entries whose reproduce blocks were
silently skipped. **This is the AGENTS.md "a defeated gate reports success" shape**: a green that
reads as coverage it does not have.

### `node -e ` is dead in `RUNNABLE_RE`

In `scripts/followup-claims-lib.mjs`:

```bash
grep -n "RUNNABLE_RE = " scripts/followup-claims-lib.mjs
grep -n "SHELL_META = " scripts/followup-claims-lib.mjs
```

`RUNNABLE_RE` admits a `node -e ` prefix; `SHELL_META` rejects any command containing a pipe,
semicolon, ampersand, redirect, backtick, dollar, parenthesis or brace. No useful JavaScript
one-liner avoids all of those, so the alternative is unreachable. Measured — both quoting styles
rejected.

This matters out of proportion to its size: `node -e` is **this repo's house idiom for
measurement** (AGENTS.md prescribes it for line counts; the register uses it throughout), so the
commonest measurement form in the register is structurally unrunnable. It is most of the 71% gap.

★ `RUNNABLE_RE` is a PREFIX test, so `node scripts/probes/followup-NNN.mjs` matches via its
`node scripts/` alternative and IS runnable. Verified, not assumed — that alternative's character
class excludes the path separator, which suggested otherwise until it was measured.

### The checker's flags are nearly all false

`§204 deleteAllChatThreadsForProject` · `§204 deleteAllCommitteeReportVersionsForProject` ·
`§213 wroteBytesRef` · `§215 resource_group` · `§58 MutationObserver` all return **zero hits**
because they are names a fix would CREATE, not names a claim depends on:

```bash
grep -rn "wroteBytesRef" src scripts e2e
```

`§7`'s `form-field.tsx` is the same shape and is documented as such inside
`scripts/followup-claims-lib.mjs` itself, and still flags. Real stale-symbol count: plausibly zero.
Each such name needs an absence marker so the flag list becomes worth reading again.

## The Status contract

An OPEN entry's Status line MUST:

1. begin with the literal `**Status:**`;
2. state open-ness in the register's existing vocabulary (`open`, `open — PARTLY FIXED …`,
   `open — a TEST-COVERAGE gap, not a defect`) and MUST NOT contain the word CLOSED — the heading
   owns closure, and a body line that claims it breaks every count;
3. carry at least one ISO `YYYY-MM-DD` date;
4. name the last EXECUTED verification, **or** say explicitly that none has been run.

Clause 4 is the substance. `**Status:** open — never machine-verified.` is honest and greppable.
Silence is neither, and silence is what 118 entries have today.

★★ Status lines MUST cite SYMBOLS, never a path-and-line-number pair. `docs/open-followups.md` is
inside `doc-claims-check`'s scan set, which is a RATCHET: a new line citation fails the pipeline.
(`docs/superpowers/` — this spec included — is excluded, which is why the spec may cite freely.)

## Tooling

### T1 — `check-followup-claims.mjs` discloses its own coverage

Its summary gains a line reporting: command lines seen inside fences, commands extracted, commands
rejected split by cause (a `RUNNABLE_RE` miss versus a `SHELL_META` hit), and the count of open
entries the runner could say nothing about. Under `--run-repro` it additionally reports how many
entries had a reproduce block that was skipped entirely.

The existing verdict vocabulary and exit code are unchanged; this is disclosure, not enforcement.

### T2 — drop the dead `node -e ` alternative

Remove it from `RUNNABLE_RE`, with a comment recording that it was measured unreachable and that
enabling it would mean executing arbitrary JavaScript lifted verbatim from a markdown file.
Deliberately NOT reintroduced — computation moves to T3 instead.

### T3 — probe convention

An entry needing computation to falsify gets a committed probe at `scripts/probes/followup-NNN.mjs`,
and its Status line cites `node scripts/probes/followup-NNN.mjs`. Probes are ordinary repo files:
lint, review and `git log` see them, which markdown one-liners never did. A probe prints its finding
and exits 0 on a successful scan; a probe that cannot scan exits 2.

### T4 — the gate

New `scripts/check-followup-status.mjs`, npm script `followups:status:check`, and a blocking
`followups-status-check` job in the quality stage.

Exit codes follow the `version-sync-check` precedent, which AGENTS.md singles out as the right shape
because the two demand opposite responses:

- **0** — every open entry satisfies the contract.
- **1** — DRIFT: at least one open entry violates it. The report names each entry and which clause.
- **2** — the gate could not do its job: the register is unreadable, or **zero entries were parsed**.
  A scanner that reads nothing passes everything, so this vacuity guard is mandatory.

It reuses `parseEntries` and `isClosed` from `scripts/followup-claims-lib.mjs` rather than
re-implementing heading parsing — a second, differently-spelled parser is a second thing to drift.

Unit test at `scripts/check-followup-status.test.mjs`. `vitest.config.ts` `include` already covers
`scripts/**/*.{test,spec}.mjs`, and coverage `include` stays `src/**`, so no floor moves. The test
must run the checker against the REAL register as well as fixtures: every defect this family of
gates has shipped was a regex defect, and both were found by running against the real docs rather
than by reading the code.

## Execution order

The gate is blocking, so it cannot land while 118 entries violate it. Order is forced:

1. **Vintage recovery** for the 62 undated entries (`git blame` and `git log -S` on the heading).
   Its own task, and it must FAIL LOUDLY rather than guess — a mis-dated entry is worse than an
   undated one, because a date reads as verification.
2. **T1–T3** tooling, each an independently-green commit.
3. **The 43 fresh no-Status entries** — Status line only, derived from what the body already says.
   No probe.
4. **The 99 stale/undated** — probe, then Status line; close only on executed proof.
5. **T4** the gate, plus `AGENTS.md` (its CI bullet says "New CI gate → also update this line") and
   a `scriptsDescriptions` entry, without which `docs:scripts:check` fails the build.

## Triage protocol

Read-only subagents work disjoint batches of entries and REPORT; they never write. 142 entries in
one 21,138-line file with parallel writers is a guaranteed conflict, and overlapping writers are
recorded in this project's history as fabricating findings in both directions.

Every returned verdict carries the command **and its actual output**. The controller re-verifies
before writing — a subagent claim is a lead, not a fact.

Verdicts: `LIVE` (reproduced today) · `DEAD` (a command contradicts the claim, so close it) ·
`UNPROVABLE` (no in-grammar probe exists yet, and the Status line records exactly that).

## Non-goals

- **No compression.** Rule 6 (transitive keep) and the 2026-08-05 `docs/prune-open-followups`
  measurement — 4490 to 4433 lines for eight commits — settle this.
- **No fixing** the defects the entries describe. Triage judges claims; it does not pay debts.
- **No closing on reasoning.** Executed proof only. A wrongly-closed entry reads as protection and
  stops the audit, which is the failure mode this register has already been bitten by.
- **No version bump.** Nothing in `src/` changes behaviour.

## Risks

| risk | mitigation |
|---|---|
| `git blame` points at reformatting commits, not authorship, and entries get mis-dated | vintage recovery fails loudly; an unrecoverable entry gets "never machine-verified" rather than a guessed date |
| a wrongly-closed entry | executed proof only; controller re-verifies every subagent verdict against the command's real output |
| the new gate is defeated by a vacuous scan | exit 2 on zero entries parsed, pinned by a unit test |
| adding 118 Status lines introduces a line citation and reddens `doc-claims-check` | contract clause: symbols only; run `npm run docs:claims:check` before the gate task |
| the register grows | accepted — the file is a record, and `size:check` walks `src`, not docs |
