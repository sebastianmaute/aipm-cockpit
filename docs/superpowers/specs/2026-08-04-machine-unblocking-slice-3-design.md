# Machine-unblocking slice 3 — test isolation, guard symmetry, and a doc landmine — design

_Written 2026-08-04, against `fix/mountedref-strictmode-siblings` `fb33f755` (main `4a81420a` +
the §76 fix). Continues [`2026-08-03-machine-unblocking-design.md`](2026-08-03-machine-unblocking-design.md)._

★ **This file is gitignored** (`docs/superpowers/` — `.gitignore:76`), so it exists only on this
machine and is invisible to any other checkout. It therefore cannot be committed, and it must not
become the only record of anything decided here. [`open-followups.md`](../../open-followups.md) is
the tracked artifact; every closure and every correction below lands there.

## What this slice is, and what it is not

The 2026-08-03 design closed with a **recommendation, not a commitment**: slice 3 = §54 + §50, a
deliberate pivot away from the machine-unblocking driver toward user-visible defects.

**That pivot is deferred, not cancelled.** Slice 2 generated four new register entries of its own
(§73–§76), three of which are machine-facing and none of which were planned. This slice keeps the
original driver and clears them, because they are small, they share one theme, and one of them
(§75) has something the entire §39/§51 flake hunt never obtained: **a deterministic reproduction.**

§54 (production CSP blocks ProseMirror's stylesheet) and §50 (bulk-undo eats write-through fields)
remain the highest-ranked user-visible defects and should be the next slice after this one.

### The theme

Two of the three items are the same failure in two places: **a thing that claims to be checked is
not.** The suite claims test isolation it does not have (§75). `timelog-panel.tsx` claims a guard
contract its handlers do not enforce (§74). §73 is the meta-case — a debugging hook that claims to
report failure-time state and reports post-teardown state instead.

## Scope

| item | what | ships |
|---|---|---|
| §75 | Two test files hold intra-file order-dependent tests; 4 failures at a known seed | test fixes + two new CI jobs |
| §74 | `handleRefreshBookings` / `handleFetchBookings` omit `isMisconfigured`, which their buttons carry | a pure guard module both sides consume |
| §73 | `onTestFailed` reports post-teardown state — repo-wide test-authoring trap, recorded nowhere but the register | one AGENTS.md line |

**No version bump.** Test fixes, CI configuration, a latent-guard fix with no behaviour change
today, and documentation. Nothing user-facing. (`release-merge-on-green`: refactor-only = no bump.)

**Order:** §75 first — it gates the CI jobs, and the jobs must not be added before the suite passes
under them. Then §74, then §73, then the register.

---

## §75 — fix the leaks, not the order

### Established, re-measured 2026-08-04 on `fb33f755`

```bash
npx vitest run src/app/use-storage-backend.test.tsx --sequence.shuffle --sequence.seed=1 --reporter=dot
#   1 failed | 63 passed (64)
#   FAIL  useStorageBackend — onRequestStorageSwitch > confirm=true writes current workspace to
#         new backend + commits config + shows info toast
#   AssertionError: expected "vi.fn()" to be called 1 times, but got 0 times

npx vitest run src/app/modern-shell.test.tsx --sequence.shuffle --sequence.seed=1 --reporter=dot
#   3 failed | 17 passed (20)
#   FAIL  ModernShell > navigates when a sidebar item is clicked
#   FAIL  ModernShell > forwards collapsed to the sidebar (brand subtitle hidden, expand button shown)
#   FAIL  ModernShell > calls onToggleCollapsed when the sidebar collapse button is clicked
#   TestingLibraryElementError: Unable to find an accessible element with the role "button"
#     and name "RAID" / "Expand sidebar" / "Collapse sidebar"
```

1 + 3 = the same 4 the full-suite run produces, with no other file present. §75's conclusion holds:
**intra-file ordering, not cross-file contamination.**

★ §75 records `1 failed / 62 passed` for the storage file. It is now `63 passed` — the §72 test
landed on `main` since the entry was written. Correct the entry; do not read the drift as a change
in behaviour.

### Two independent causes

They are diagnosed separately and must not be assumed to share a mechanism — the §39/§51 lesson
restated (`assume one diagnosis covers both and the evidence gets fitted to the wrong shape`).

- **`modern-shell.test.tsx`** — all three losses are *sidebar buttons missing from the DOM*, and
  the third is specifically about the collapsed state. Hypothesis to test first: leaked
  collapsed/nav state (module-level, persisted, or a prop default some earlier test mutates).
- **`use-storage-backend.test.tsx`** — `targetSave` is never called, which is upstream of every
  emitter, so the switch path itself did not run. Hypothesis to test first: a module-level
  singleton (a write chain / lock) or a mock left settled by an earlier test.

Both are hypotheses. Neither is a finding until measured.

### ★★★ Banned fixes

Anything that **pins order** rather than removing the leak: `describe.sequential`, reordering the
test bodies, a `beforeAll` that re-seeds what a sibling dirtied, or `--sequence.shuffle.tests=false`.

The reason this needs saying here rather than being obvious: **this slice adds a gate that would
then certify the pinned version as isolated.** A shuffled-suite job passing over order-pinned tests
is a defeated gate, and a defeated gate reports success — worse than the gate not existing.

### Acceptance

Per file, all four required:

1. Passes at `--sequence.seed=1`.
2. The **unshuffled** control still passes (`npx vitest run <file>`).
3. Passes at three further seeds, run **per-file in isolation**. ★ Not full-suite: §75 records that
   full-suite seeds 2 and 3 left 16 of 784 files never executing from worker-startup timeouts under
   saturation. A per-file run at those seeds is clean and answers the question asked.
4. The named leak is written down — which state, set by which test, read by which. "It passes now"
   is not a diagnosis, and without the mechanism there is nothing to check the fix against.

---

## §75 gating — both jobs, and the two details that carry them

User chose **2 + 3**: a pinned-seed blocking job *and* a random-seed weekly job. They answer
different questions — the pinned one proves the fixed ordering stays fixed, the weekly one samples
the class instead of pinning one point of it.

### ★★★ Sequencing prerequisite

**A full-suite shuffled run at seed 1 must pass locally BEFORE either job is added.**

File-level shuffle changes which file runs first, so the full suite can surface order-dependent
tests that the two isolated files do not. Adding a blocking gate before that is known means its
first pipeline is red, on the MR that introduced it.

If the full-suite run surfaces more than the known 4: fix them if they are the same shape, or
descope the blocking job to `allow_failure: true` for this slice and file a follow-up. Do **not**
ship a blocking gate that is known-red.

### The jobs

```yaml
# Blocking. Deterministic seed — proves the fixed ordering stays fixed.
unit-tests-shuffled:
  stage: quality
  needs: [install, unit-tests]
  script:
    - npm run test:run -- --sequence.shuffle --sequence.seed=1 --reporter=dot

# Weekly schedule. Samples the class instead of pinning one point of it.
# Warn-only: informational, not a merge gate — matches dependency-audit-full.
unit-tests-shuffled-random:
  stage: quality
  needs: [install]
  rules:
    - if: $CI_PIPELINE_SOURCE == "schedule"
  allow_failure: true
  script:
    - echo "shuffle seed=$CI_PIPELINE_ID  (reproduce: npx vitest run --sequence.shuffle --sequence.seed=$CI_PIPELINE_ID)"
    - npm run test:run -- --sequence.shuffle --sequence.seed=$CI_PIPELINE_ID --reporter=dot
```

### ★★ `needs: [install, unit-tests]`, not `[install]`

Every other `quality` job needs only `install`, so GitLab runs them concurrently. Two full vitest
runs on one runner is **machine saturation — the exact condition §39 and §51 need to fail.** Eight
recorded §39 failures and one §51 failure, all environmental, all under `unit-tests`. A new gate
that raises the flake rate of the blocking gate beside it is a net loss even when the new gate is
correct.

Serialising behind `unit-tests` costs pipeline wall-clock (roughly one extra unit-suite duration)
and buys determinism. Take the wall-clock.

★ This is reasoned from the recorded failure conditions, not measured. If pipeline duration becomes
the binding constraint, the measurement to take first is whether the runner has the cores to absorb
a concurrent second run — not whether the flakes "seem" to have stopped.

### ★★ The weekly job's seed is `$CI_PIPELINE_ID`, echoed with its reproduce command

Letting vitest pick a seed produces a failure nobody can reproduce. That is §73's lesson applied to
CI: **evidence you cannot act on is worse than no evidence**, because it still consumes the
attention of whoever reads the red job.

`$CI_PIPELINE_ID` is monotonic, unique per pipeline, always present, and needs no shell features —
so the seed varies every week, is recorded by construction, and the job log carries the exact
local command that reproduces it.

★★ **`SEED=$RANDOM` was the first draft and is rejected.** `$RANDOM` is a **bash** builtin, and the
runner shell on `node:24-bookworm-slim` is not guaranteed to be bash. Under `sh` it expands to the
empty string, producing `--sequence.seed=` — a malformed flag on the one job whose entire value is
a recorded, reproducible seed. It would most likely still *run*, silently, at whatever vitest makes
of an empty seed, which is the worst of the available outcomes.

★ `$CI_PIPELINE_ID` is a large integer rather than a small one. Vitest hashes the seed, so the
magnitude carries no meaning and large values are fine; do not "tidy" it with a modulo, which only
adds a way for two pipelines to collide.

### Smaller constraints

- `--reporter=dot`, never `--reporter=basic` — that reporter does not exist in vitest 4.1.8; it
  fails to load a reporter module and errors at startup, which reads like a broken test run.
- **No coverage on either job.** `unit-tests` owns the floors (`test:coverage`); duplicating the
  instrumentation doubles the cost of the exact runs we just argued must not saturate the runner.
- `npm run test:run -- <flags>` — `test:run` is bare `vitest run`, so flags pass through.
- Both jobs go in the `quality` stage beside the gates they belong with, and
  `unit-tests-shuffled` gets a comment block explaining the seed and the `needs`, matching the
  house style of `file-size-ratchet` and `dependency-audit-full`.

### What these jobs do NOT establish

- The pinned job proves **seed 1** stays green. A new order-dependent test that only fails at some
  other seed slips past it. That is inherent to option 2 and is why option 3 ships alongside.
- Neither job says anything about §39 or §51. Those are load-sensitive, not order-sensitive, and
  neither of the two affected files failed under any of the six amplification configurations.
- Nothing here claims CI shuffles today. §75 is a latent test-isolation defect, not a live CI
  failure, and the entry should keep saying so.

---

## §74 — remove the asymmetry structurally

### The defect

`timelog-panel.tsx` `handleRefreshBookings` (`:389`) and `handleFetchBookings` (`:405`) each open
with an early return. Neither includes `isMisconfigured` (`:437`, `!cfg.enabled || !cfg.host ||
!cfg.apiToken`). Both corresponding buttons in `timelog-panel-toolbar.tsx` (`:82`, `:98`) do.

So the button enforces a **stricter contract than the handler**, and any non-button caller — a
voice command, a keyboard shortcut, a future Action-Center CTA — would act against an unconfigured
TimeLog. Latent today: the button is the only caller of each.

★ **This asymmetry is what made §39 possible.** The test compensated for the product code's split
instead of the product code resolving it — the fix there waits for the button to become enabled,
which works precisely because the button carries a guard the handler does not. §39 is "test fixed",
not "cause removed."

### The fix, and why it is not the one the register records

§74 records the cheap fix: lift `isMisconfigured` into both handler guards. That leaves **two
copies of one contract**, which is the same shape that produced the defect and can drift again.

Instead: extract both predicates into a pure, i18n-free `timelog-guards.ts` —
`canFetchBookings(...)` and `canRefreshBookings(...)` — consumed by **both** the handler's early
return and the toolbar's `disabled`. One expression per action, so the asymmetry becomes
unrepresentable rather than merely currently-absent.

This is what §74's own closing sentence asks for, done structurally: *"making the button's
`disabled` a presentation of the handler's contract rather than a second, stricter contract."*

### ★★ Testability is the deciding argument, not elegance

The new guard is **unreachable through the UI, because the button is disabled** — the very
condition it guards is the condition that prevents a click. So the cheap fix ships untestable by
construction: §76's wall, one week later, in a second file. A pure predicate is directly
unit-testable, and the two call sites are then verifiable by inspection.

★ A test that renders the toolbar with `disabled` stubbed away would be testing the stub. Do not
write it.

### Constraints

- ★ New pure `.ts` files are **coverage-gated** (`vitest.config.ts` `coverage.exclude` covers
  `.tsx` and UI-glue hooks, not pure engines). `timelog-guards.ts` is pure logic with no branches
  worth missing, so full coverage is cheap — this is a benefit of the approach, not a cost of it.
- ★ `isMisconfigured` is computed at `:437`, **below** the handlers at `:389`/`:405`. The
  extraction moves the computation above them rather than relying on a closure over a
  later-declared `const` (which works at call time but reads as a hazard and may trip lint).
- The toolbar keeps its existing props; it imports the predicate rather than receiving a
  pre-computed boolean, so the panel and toolbar cannot disagree about how the pieces combine.
- Check the existing `timelog-panel.test.tsx` suite for any test that drives a handler while
  misconfigured and expects it to proceed. If one exists, it encoded the defect and must change —
  but establish that it exists before assuming it does.

---

## §73 — one AGENTS.md line

Vitest runs `onTestFailed` **after** all `afterEach` hooks, and `afterEach` runs LIFO, so the setup
file's RTL `cleanup()` always wins: any capture reads zeroed mocks and an empty `document.body`.
Measured — a capture written the obvious way printed `{"fetchCalls":0,"toastCalls":[],…}` on a run
where the fetch had fired and the toast had rendered, **falsely confirming the already-suspected
§39 hypothesis with fabricated evidence.**

The register is currently the only record. It goes in AGENTS.md, under the `npm run test:run`
command block beside the other test-authoring landmines, naming the working replacement: a
describe-scoped `afterEach` guarded on `ctx.task.result?.state === "fail"`, holding a closure the
test body assigns — registered last, so it runs first, while mocks and DOM are still live.

★ `agents-symbol-check` requires every backticked name to exist in `src`/`scripts`/`e2e`.
`onTestFailed` does — in three warning comments (`timelog-panel.test.tsx:257,260`,
`use-tasks-dedup.test.tsx:87`), not in any call. **That is a real dependency on comments staying
put**, and it should be noted in §73 so a future comment cleanup does not silently break the gate.
`onTestFinished` has no occurrence at all, so mention it in prose without backticks or not at all.

---

## Verification

Every command's exit code read **unpiped**; redirect to a file, echo `$?`, then grep the file.
`npm run test:run | tail -8` exits 0 while tests fail — that is `tail`'s status — and discards the
diagnostic. The inverse trap with `grep` has also been hit here.

```bash
npx eslint --max-warnings=0 src/app          # CI gate; `npm run lint` does NOT reproduce it
npx tsc --noEmit                             # incl. i18n key parity; run after ANY test edit
npm run test:run                             # unshuffled control — must stay green
npm run test:coverage                        # floors are blocking; timelog-guards.ts is newly gated
npm run size:check
npm run docs:symbols:check                   # gates the new AGENTS.md line
npx vitest run --sequence.shuffle --sequence.seed=1 --reporter=dot   # PREREQUISITE for the jobs
npx vitest run <file> --sequence.shuffle --sequence.seed=N           # per-file, N ∈ {1, +3 others}
npx vitest run <file>                                                # per-file unshuffled control
```

★ Never run two vitest processes concurrently — it manufactures the saturation condition §39/§51
need and produces failures that are about the machine, not the code.

★ The CI YAML has no local validation. Both jobs are reviewed by eye against the existing
`dependency-audit-full` and `file-size-ratchet` blocks, and the first pipeline is the first real
evidence. Expect to iterate on it there.

### What cannot be verified locally

- That `unit-tests-shuffled` actually serialises behind `unit-tests` — only a real pipeline shows
  the job graph.
- That the weekly job runs at all. It fires on `$CI_PIPELINE_SOURCE == "schedule"`, so it is
  unexercised until the next scheduled pipeline. **Confirm it on the first schedule run rather
  than assuming**; a scheduled job that silently never runs is precisely the "gate in name only"
  failure this repo already has three releases of evidence for.

---

## Register updates (`open-followups.md` — the tracked record)

- **§75 → CLOSED.** Record both named leaks, the fix per file, the acceptance seeds, and the two
  new CI jobs. Correct `1 failed / 62 passed` → `63 passed`. Keep the "not a live CI failure"
  scoping — the new job changes that going forward, and the entry should say from which commit.
- **§74 → CLOSED.** Record that the fix went **structural** (a shared pure predicate) rather than
  the cheap two-copy lift the entry recommends, and why: the cheap fix is untestable by
  construction. Keep the §39 provenance sentence — "test fixed, not cause removed" stays true of
  §39's own history.
- **§73 → CLOSED.** Record the AGENTS.md placement and the comment-dependency of the symbol gate.
- **Index rows** for all three, and the summary table's status column.
- ★ **Merge-second renumbering:** if another branch lands first, whoever merges second renumbers
  against the merged file. Do not chase a live branch's numbering; git flags the conflict.

## Risks

| risk | mitigation |
|---|---|
| Full-suite shuffle surfaces more than the known 4 | Run it **before** adding the jobs; fix same-shape ones, descope the blocking job to `allow_failure` and file a follow-up otherwise |
| The blocking job doubles unit CI load and worsens §39/§51 | `needs: [install, unit-tests]` serialises it; reasoned, not measured — re-check on the first pipelines |
| A "fix" that pins order passes every gate in this slice | Named leak is a required acceptance criterion, not just a green run |
| §74's new pure module drops coverage below a floor | It is branch-light pure logic; `test:coverage` runs before push |
| The weekly job never fires and nobody notices | Explicitly confirm on the first scheduled pipeline; recorded as a verification step, not an assumption |
| The AGENTS.md line breaks `agents-symbol-check` later | §73 records that `onTestFailed` exists only in comments |
