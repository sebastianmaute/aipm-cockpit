# Machine-unblocking slices — design

_Written 2026-08-03, against `main` `0d770283` (0.212.0 "Nayler"). Triage pass over
[`open-followups.md`](open-followups.md): 58 numbered items, ~35 open._

★ **This file is gitignored** (`docs/superpowers/` — `.gitignore:76`), so it exists only on this
machine and is invisible to any other checkout. That is the §44 failure mode by construction: S6's
spec and plan live here too, which is why a designed, planned slice went unseen by every tracked
document. Placement chosen deliberately; the mitigation is that
[`open-followups.md`](../../open-followups.md) is tracked and must carry anything that has to
survive — do not let this file become the only record of a decision.

## Driver

Chosen: **unblock the machine first.** Nothing user-facing in these two slices. The reasoning is
that §2 is a hard block on anyone touching resources, §58 makes every future a11y claim mean
something, and both flakes already have a working operational answer. User-visible defects are
deferred *by driver choice*, not by rank — see "Slice 3" below.

## Slice 1 — bounded: ratchet + gates

Every piece is decided or mechanical. Ships with high confidence. Explicitly does **not** attempt
§39/§51 root cause.

### §2 — split `use-resource-planner.ts` (1037 → ≈620)

**1037 lines against a 1038 baseline** (`docs/baselines/file-sizes.json`), so the next line added
to that file fails the build. `LIMIT` is 800 in `scripts/check-file-sizes.mjs`.

Two extractions, per the entry's own arithmetic — one is not enough (1037 − 228 = 809, plus
wiring ≈ 819, still over):

| cluster | lines | size |
|---|---|---|
| reference data (roles · disciplines · grades) | 644–871 | ~228 |
| resource directory CRUD / bulk / import | 447–643 | ~197 |

Both follow the Phase-3 deps-object convention (`use-storage-file-ops.ts` is the pattern): a typed
`deps` object of live render-scope values, named `use*`, called unconditionally before the single
return, returning **non-memoized** handlers.

★★ The non-memoized part is load-bearing and must survive the split. Those same handlers are why
`ResourcesPanel`'s `memo()` never bails (§1). A split must not tempt anyone into memoizing on the
way past — that is a separate, open, forked decision.

★ Neither new file goes in `vitest.config.ts` `coverage.exclude`. `use-resource-planner.ts` is
coverage-gated today, so the extraction is coverage-neutral **only if** the new files stay gated.

★ **Re-baseline after the split.** Shrinking passes the ratchet, but `file-sizes.json` still
records 1038, leaving the file free to grow back to 1038 unnoticed. Re-record at the new size to
lock the win.

### §58 — make the axe gate self-verifying

`playwright.config.ts` sets `reuseExistingServer: !process.env.CI`, so a local
`npx playwright test e2e/a11y.spec.ts` attaches to whatever answers on the target port. With a dev
server left running from another worktree — the normal state in this repo — an 85/85 pass can be
evidence about code that is not on your branch.

Fix: `e2e/a11y.spec.ts` reads the served page's `APP_VERSION`, compares it against
`src/app/version.ts`, fails the suite on mismatch.

- **Necessary, not sufficient.** Two worktrees on the same version still agree. This *pairs with*
  the fresh-port convention (`PORT=3100 npm run dev`), it does not replace it.
- **Risk to ground before writing:** whether `APP_VERSION` is reachable from the served DOM at
  all, and by what handle. Unverified as of this writing.
- **The guard needs proof it fires.** Run it against a deliberately stale server and watch it
  fail. A scanning guard that has never failed is not known to scan.

### §51 — matcher hardening only

`use-tasks-dedup.test.tsx` → "on confirm, removes the duplicate and records ONE undo entry".

Change the gate `await waitFor(() => expect(screen.getByText(/dup/i)).toBeTruthy())` to a
modal-specific `findByRole("button", { name: /merge selected/i })`.

`/dup/i` is a substring of the trigger's own accessible name ("**Dedup**licate & unify tasks"), so
the gate can be satisfied by something that does not imply the modal opened. This makes the wait
and the assumption the same condition.

★ **Filed as fragility, not diagnosis.** The trigger renders no text child, so it is not proven
that it is what matched. This is correct independently of root cause and does not claim to fix the
flake.

### Verification

`npx eslint --max-warnings=0 src/app` · `npx tsc --noEmit` · `npm run test:run` ·
`npm run size:check`

★★★ Each redirected to a file, exit code read **unpiped**. `npm run test:run | tail -8` exits 0
while tests fail — that is `tail`'s status — and discards the diagnostic. Same trap inverted with
`grep`. Both directions have been hit here.

## Slice 2 — the flake hunt (§39 + §51)

**Sequencing pays off.** Slice 1's matcher fix removes one of §51's two candidate explanations.
Today a recurrence cannot distinguish "something other than the modal satisfied `/dup/i`" from
"the preview opened and closed between the two lines". After slice 1, a recurrence answers that
by itself.

**Two investigations, not one.** A shared environmental trigger is plausible, but the signatures
diverge — assume one diagnosis covers both and the evidence gets fitted to the wrong shape.

### §39 — establish reachability, not timing

`timelog-panel.test.tsx` → "surfaces a partial-failure toast when Refresh drops some projects".
Eight CI failures; twice left `main` red.

Three failures under the 15 s budget consumed **15,093 / 15,098 / 15,117 ms** — a 24 ms spread at a
15,000 ms ceiling. That is the timeout expiring on a toast that is never coming, not a toast
arriving slowly. Stop treating it as a performance problem.

The question is whether `showToast("error", …)` is reachable on that path at all under CI
conditions. Candidates named in the entry:

1. an unresolved promise in the mocked `useTimelogSync`
2. a lost `act()` flush
3. a partial-failure branch that only fires when a timer wins a race it usually loses

★ (3) is testable in isolation — if the branch is race-conditional, an isolated test proves the
race without reproducing CI.

### §51 — reproduce before fixing

Failed on post-merge `main` pipeline #5418, same `unit-tests` job as §39's 8th. Error:
`Unable to find … role "button" and name /merge selected/i` — modal absent. Trigger carried
`disabled=""` (hook still busy, mocked `runDedupProposal` unresolved). Duration **38 ms** — not a
timeout; `getByRole` fails immediately.

The unreconciled pair: the line before is a `waitFor` that must have **succeeded** for that error
to surface, yet the modal was absent and the trigger still busy. Do not write a fix on either
guess.

### Two hard prohibitions, both already paid for

- **No timeout raises.** 5 s → 15 s moved the failure point and bought nothing; three subsequent
  failures then ate the 15 s budget to within 24 ms. 30 s costs another 15 s of CI wall-clock per
  failure and buys the same.
- **No editing on a red-CI reflex.** §51 is confirmed flaky *by retry, not by argument* — job
  20222, same commit `351eb05f`, no code change, passed in 389 s and #5418 went green. Both tests
  passed on that retry. Environmental, proven.

### Stop rule

This is the unbounded slice, so it needs one. Three attempts in order; stop at the first that
lands:

1. Reproduce locally under full-suite parallel load on constrained CPU.
2. Prove or disprove branch reachability in isolation.
3. Failing both — ship **instrumentation**: failure-time state capture in both tests, and stop.

★ Outcome 3 is a legitimate finish. Eight occurrences have produced only frequency data;
converting the next recurrence into evidence is worth more than a ninth guess.

**Operational answer meanwhile: retry the job.**

## Register hygiene

Two defects in `open-followups.md` itself, found during this triage and fixed as part of the work.

### Index table is stale

The summary table (lines 52–89) stops at **§51**. §52–58 have full sections and no row.

Fix: add seven rows. **Rows only — no renumbering.** The file's own rule is that numbers are
stable identifiers and closed ones are never reused; they are cited from outside the file
(`rich-text-plain.ts:96` → §24, AGENTS.md → §22 and §28, `docs/CODEMAPS/*` → §4, §7 B4, §8–§10,
§13). Renumbering silently redirects every one of those.

### New §59 — 0.212.0 eye-verification owed

Settings → Integrations changed shape in 0.212.0 (two stacked toggles plus a disabled state that
had never rendered anywhere) and shipped unverified. Filed as its own entry per release, matching
§21 (0.209.0) and §41 (0.211.0).

★ Recorded inside §59 rather than as its own number: **three consecutive releases now carry owed
eye-verification and none has been discharged.** That is one process finding, not three items —
the eye-verify step is not happening.

## Deferred, with reasons

- **§53 (ESLint 10)** — blocked upstream at `eslint-plugin-react`, which calls the removed
  `context.getFilename` and crashes at rule-load. Nothing to do until that ships. No action.
- **User-visible defects** — §54 (unstyled rich-text editors in production), §50 (bulk-undo data
  loss), §40 (40 sites at ~1.1:1 in the dark schemes). Out of scope **because the driver was
  machine-unblocking**, not because they rank below it.
- **Rich-text cluster** (§22 · §24 · §28 · §31 · §32 · §35 · §36 · §37 · §38), **a11y-unguarded**
  (§8 · §9 · §42 · §55 · §56), **parked-large** (§4 · §5 · §12 · §16), **owed work** (§3 · §44) —
  unchanged by this pass.

## Slice 3 — recommendation, not commitment

**§54 + §50.** §54 is a defect live in production that no gate can see (dev uses the permissive
CSP branch, and `e2e:smoke` starts no server). §50 loses data. Both topped the list under a
different driver and should not drift merely because this pass optimized for something else.
