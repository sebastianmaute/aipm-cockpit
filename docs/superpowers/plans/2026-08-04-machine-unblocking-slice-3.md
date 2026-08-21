# Machine-unblocking Slice 3 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close §75 (two order-dependent test files) with two new CI jobs that keep it closed, §74 (TimeLog handlers enforce a weaker contract than their buttons), and §73 (an undocumented test-authoring trap).

**Architecture:** Three unrelated fixes sharing one theme — something claims to be checked and is not. §75 fixes two *proven* state leaks in test files (a leaked `window.matchMedia` stub; an undrained `mockReturnValueOnce` queue) and then adds a pinned-seed blocking CI job plus a weekly random-seed job. §74 extracts the two TimeLog action guards into a pure module consumed by both the handler and the button, so the asymmetry becomes unrepresentable. §73 is one AGENTS.md paragraph.

**Tech Stack:** TypeScript · React 19 · vitest 4.1.8 · Testing Library · GitLab CI (`node:24-bookworm-slim`)

**Spec:** `docs/superpowers/specs/2026-08-04-machine-unblocking-slice-3-design.md`

---

## Read this before Task 1

**Never read a gate's exit code through a pipe.** `npm run test:run | tail -8` exits **0 while tests are failing** — that is `tail`'s status — and the pipe discards the diagnostic. The inverse (`… | grep -v x` reporting 1 when the command passed) has also been hit here. Always:

```bash
<command> > /tmp/out.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/out.log
```

**Never run two vitest processes at once.** It manufactures the machine-saturation condition that makes unrelated tests (§39, §51) fail, and you will debug the machine instead of the code.

**`--reporter=basic` does not exist in vitest 4.1.8.** It fails to load a reporter module and errors at startup, which reads like a broken test run. Use `--reporter=dot` or `--reporter=verbose`.

**Both §75 leaks are already diagnosed and proven** (measured 2026-08-04 at `fb33f755`, `--sequence.seed=1`, each file run alone). You are implementing a known fix, not investigating. Do not "simplify" either fix into something that pins test order — a shuffled-suite gate passing over order-pinned tests is a defeated gate, and this plan adds exactly that gate.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `src/app/modern-shell.test.tsx` | Modify | Stop leaking a `window.matchMedia` stub out of the mobile-drawer describe |
| `src/app/use-storage-backend.test.tsx` | Modify | Drain the `createBackend` once-queue between tests in the switch describe |
| `.gitlab-ci.yml` | Modify | Add `unit-tests-shuffled` (blocking) + `unit-tests-shuffled-random` (weekly) |
| `src/app/timelog-guards.ts` | **Create** | Pure predicates `canFetchBookings` / `canRefreshBookings` — one contract per action |
| `src/app/timelog-guards.test.ts` | **Create** | Unit tests for the predicates (coverage-gated file) |
| `src/app/timelog-panel.tsx` | Modify | Handlers consume the predicates instead of hand-rolled early returns |
| `src/app/timelog-panel-toolbar.tsx` | Modify | Button `disabled` consumes the same predicates |
| `AGENTS.md` | Modify | One `onTestFailed` landmine paragraph in the `test:run` block |
| `docs/open-followups.md` | Modify | Close §73, §74, §75; fix §75's stale count |

---

## Task 1: Fix the `modern-shell.test.tsx` matchMedia leak (§75)

**Files:**
- Modify: `src/app/modern-shell.test.tsx:136-148` (the `stubViewport` helper inside `describe("ModernShell mobile drawer (#25)")`)

**The proven mechanism.** `stubViewport()` assigns `window.matchMedia = vi.fn()…` directly. That is a plain property assignment, not a spy, so `vi.clearAllMocks()` and `vi.restoreAllMocks()` cannot undo it and nothing in `vitest.setup.ts` touches it. jsdom ships **no** `matchMedia`, so the unstubbed default is `undefined`, and `useMediaQuery` (`src/app/use-media-query.ts:26`) returns `false` for that — i.e. desktop. Once any mobile-drawer test runs, `matchMedia` exists and reports `matches: true` forever, so `ModernShell` (`modern-shell.tsx:85`, `useMediaQuery(SIDEBAR_NARROW_QUERY)`) renders the mobile drawer and the in-flow sidebar's buttons no longer exist. At seed 1 the mobile-drawer describe runs **first**.

- [ ] **Step 1: Reproduce the failure and read the evidence**

Run:
```bash
npx vitest run src/app/modern-shell.test.tsx --sequence.shuffle --sequence.seed=1 --reporter=verbose > /tmp/shell-before.log 2>&1; echo "EXIT=$?"; grep -E "^ [✓×]" /tmp/shell-before.log
```

Expected: `EXIT=1`, `3 failed | 17 passed`. The five `ModernShell mobile drawer (#25)` tests run first and pass; `calls onToggleCollapsed when the sidebar collapse button is clicked`, `navigates when a sidebar item is clicked` and `forwards collapsed to the sidebar …` fail with `Unable to find an accessible element with the role "button" and name "Collapse sidebar" / "RAID" / "Expand sidebar"`.

Confirm the mechanism in the dump: the roles listing for the first failure contains a button named **`Open navigation menu`** (the mobile hamburger). That is the leaked narrow viewport, not a missing label.

- [ ] **Step 2: Replace the raw assignment with a restorable stub**

In `src/app/modern-shell.test.tsx`, change the import on line 2 to add `afterEach`:

```tsx
import { afterEach, describe, expect, it, vi } from "vitest";
```

Then replace the `stubViewport` helper and add an `afterEach` immediately after it, inside `describe("ModernShell mobile drawer (#25)")`:

```tsx
  // ★★★ MUST be restorable. This used to be a bare `window.matchMedia = vi.fn()`
  //     assignment, which no mock-lifecycle call can undo: `clearAllMocks` and
  //     `restoreAllMocks` do nothing to a plain property write, and jsdom ships
  //     no `matchMedia` for anything to restore it to. So after the first test
  //     here ran, EVERY later test in the file saw a narrow viewport, ModernShell
  //     rendered the mobile drawer instead of the in-flow sidebar, and the
  //     sidebar's buttons ("RAID", "Collapse sidebar", "Expand sidebar") were
  //     simply absent. ★ It stayed invisible in DECLARATION order only by
  //     coincidence: this describe's LAST test stubs `matches: false`, which is
  //     the wide-viewport value the two describes after it ("settings slot",
  //     "banners slot") happen to need. Adding a test here, or reordering these,
  //     would have broken them with no shuffle involved. Reproduced by
  //     `--sequence.shuffle --sequence.seed=1`, which runs this describe first.
  //     See open-followups §75.
  function stubViewport(matches: boolean) {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation((query: string) => ({
        matches,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    );
  }

  // Restores `matchMedia` to its pre-stub state (absent, under jsdom), so the
  // viewport cannot leak into another test. Do NOT replace this with a manual
  // re-assignment — `window.matchMedia = undefined` is a type error and leaves
  // the property defined-but-undefined rather than absent.
  afterEach(() => {
    vi.unstubAllGlobals();
  });
```

★ `vi.stubGlobal` writes to `globalThis`, which **is** `window` under the jsdom environment, so `useMediaQuery`'s `window.matchMedia` reads see it. `vi.unstubAllGlobals()` deletes a property that did not previously exist, which is exactly the pre-test state.

- [ ] **Step 3: Verify the seed now passes**

Run:
```bash
npx vitest run src/app/modern-shell.test.tsx --sequence.shuffle --sequence.seed=1 --reporter=dot > /tmp/shell-after.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/shell-after.log
```

Expected: `EXIT=0`, `Tests  20 passed (20)`.

- [ ] **Step 4: Verify the unshuffled control still passes, and three more seeds**

Run each separately (never concurrently):
```bash
npx vitest run src/app/modern-shell.test.tsx --reporter=dot > /tmp/shell-ctl.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/shell-ctl.log
for S in 2 3 7; do npx vitest run src/app/modern-shell.test.tsx --sequence.shuffle --sequence.seed=$S --reporter=dot > /tmp/shell-$S.log 2>&1; echo "SEED=$S EXIT=$?"; grep -E "Tests " /tmp/shell-$S.log; done
```

Expected: all four `EXIT=0`, `20 passed (20)` each.

★ If a seed fails with a *different* symptom, that is a second leak in the same file. Diagnose it the same way (verbose reporter, read the order, name the shared state) and fix it here rather than deferring — but do not pin order.

- [ ] **Step 5: Commit**

```bash
git add src/app/modern-shell.test.tsx
git commit -F - <<'EOF'
test(shell): stop leaking the matchMedia viewport stub out of the drawer tests (§75)

`stubViewport` assigned `window.matchMedia` directly. A plain property write is
invisible to `vi.clearAllMocks()` and `vi.restoreAllMocks()`, and jsdom ships no
`matchMedia` for anything to restore it to — so the first mobile-drawer test
pinned the whole file to a narrow viewport for the rest of the run. ModernShell
then rendered the off-canvas drawer instead of the in-flow sidebar, and the
sidebar's buttons ("RAID", "Collapse sidebar", "Expand sidebar") were absent.

It stayed invisible in declaration order only by coincidence: the drawer
describe's last test stubs `matches: false`, the wide-viewport value the two
describes after it happen to need. Under `--sequence.shuffle --sequence.seed=1`
the drawer describe runs FIRST and three later tests fail.
Now stubbed via `vi.stubGlobal` and restored by a describe-scoped
`vi.unstubAllGlobals()`, which deletes the property rather than setting it to
undefined.

Verified: seed 1 goes 3 failed/17 passed -> 20 passed; seeds 2, 3, 7 and the
unshuffled control all pass. open-followups §75.
EOF
```

---

## Task 2: Drain the `createBackend` once-queue in `use-storage-backend.test.tsx` (§75)

**Files:**
- Modify: `src/app/use-storage-backend.test.tsx:757-768` (the `beforeEach` of `describe("useStorageBackend — onRequestStorageSwitch")`)

**The proven mechanism.** `vi.clearAllMocks()` calls `mockClear()` on every mock: it wipes `mock.calls`, `mock.instances` and `mock.results`, and **does not drain a `mockReturnValueOnce` queue** — only `mockReset()` does. The test `confirm=false → no save, no config change` (`:866`) queues two values on the shared module-level `createBackend` mock (`:880-881`) and, precisely because confirm is false and `onRequestStorageSwitch` returns early, consumes only the first. The leftover `targetBackend` survives `clearAllMocks` into the next test, which queues two more. The queue is then `[targetBackend(leftover), mockBackend, targetBackend]`, so the hook's first `createBackend()` gets the leftover as its *main* backend and the second gets `mockBackend` as the *switch target*. `targetSave` therefore belongs to nothing the code calls — `expected "vi.fn()" to be called 1 times, but got 0 times`.

At seed 1, `confirm=false → no save, no config change` runs immediately before the failing test. In declaration order it runs after, which is why this is invisible normally.

- [ ] **Step 1: Reproduce the failure and confirm the ordering**

Run:
```bash
npx vitest run src/app/use-storage-backend.test.tsx --sequence.shuffle --sequence.seed=1 --reporter=verbose > /tmp/storage-before.log 2>&1; echo "EXIT=$?"; grep -nE "^ [✓×]" /tmp/storage-before.log | grep -B2 "×"
```

Expected: `EXIT=1`, `1 failed | 63 passed (64)`. The line immediately above the `×` is `useStorageBackend — onRequestStorageSwitch > confirm=false → no save, no config change`, and the failure is `expected "vi.fn()" to be called 1 times, but got 0 times`.

- [ ] **Step 2: Drain the queue in the describe's `beforeEach`**

In `src/app/use-storage-backend.test.tsx`, replace the body of the `beforeEach` at line 757:

```tsx
  beforeEach(() => {
    vi.clearAllMocks();
    // ★★★ `clearAllMocks` does NOT drain a `mockReturnValueOnce` queue — it is
    //     `mockClear`, which only wipes calls/instances/results. `createBackend`
    //     is a MODULE-LEVEL mock shared by every test in this file, and
    //     "confirm=false → no save, no config change" queues two values while
    //     deliberately consuming one (the early return is the thing it asserts).
    //     Under `--sequence.shuffle --sequence.seed=1` that leftover became the
    //     next test's FIRST createBackend() result, shifting the whole queue by
    //     one: the switch target came back as the main backend and `targetSave`
    //     was never called. `mockReset` drains the queue; the mockReturnValue
    //     below re-establishes the default. See open-followups §75.
    createBackendMock.mockReset();
    vi.useFakeTimers();
    setStorageConfig = vi.fn<(config: StorageConfig) => void>();
    // Default main backend (kind="browser")
    mockBackend.load.mockResolvedValue(emptyWorkspace());
    mockBackend.isReady.mockResolvedValue(true);
    mockBackend.describe.mockResolvedValue("Browser");
    createBackendMock.mockReturnValue(mockBackend);
    // pickFileForBackend returns null (non-local backends in these tests)
    (storageMod.pickFileForBackend as ReturnType<typeof vi.fn>).mockReturnValue(null);
  });
```

★ `mockReset()` must come **before** the `mockReturnValue(mockBackend)` on the line below, or it wipes the default it is meant to preserve. `mockReset` on a `vi.fn()` created by a `vi.mock` factory leaves it implementation-less, which is exactly what the existing `mockReturnValue` then fills in.

★ Do **not** reach for `vi.resetAllMocks()` here. It would also strip the implementations that the other nine describes' `beforeEach` blocks establish on `mockBackend.*`, and this file's describes do not all re-establish the same set. ★★ **Put that rationale in the CODE COMMENT, not only in the commit message** — §75 does not mention `resetAllMocks`, so a contributor reading just the file has nothing to stop them "simplifying" it.

★★★ **A `beforeEach` drain alone is NOT sufficient — the same `mockReset()` must also go in the describe's existing `afterEach`.** Draining on entry makes ordering safe *within* the describe, but `--sequence.shuffle` reorders tests inside a suite, so a seed that schedules a leftover-producing test LAST carries its unconsumed once-value into whichever describe runs next. A sibling describe's `beforeEach` establishes its default with `.mockReturnValue(...)`, and a plain default does **not** out-rank a queued once-value — vitest's dispatcher shifts the once-queue first (`@vitest/spy`: `config.onceMockImplementations.shift() || config.mockImplementation`). ★ **THREE** tests in this describe have the queue-two-consume-one shape, not just the one the comment names: `confirm=false → no save, no config change`, `warns (recording stops) and aborts when leaving Turso and the user cancels`, and `uses the generic convert-confirm for a non-Turso source switch`. Caught by code-quality review after the first version of this task shipped the one-directional fix — an earlier revision of this plan specified only the `beforeEach` drain.

- [ ] **Step 3: Verify the seed now passes**

Run:
```bash
npx vitest run src/app/use-storage-backend.test.tsx --sequence.shuffle --sequence.seed=1 --reporter=dot > /tmp/storage-after.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/storage-after.log
```

Expected: `EXIT=0`, `Tests  64 passed (64)`.

- [ ] **Step 4: Verify the unshuffled control still passes, and three more seeds**

```bash
npx vitest run src/app/use-storage-backend.test.tsx --reporter=dot > /tmp/storage-ctl.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/storage-ctl.log
for S in 2 3 7; do npx vitest run src/app/use-storage-backend.test.tsx --sequence.shuffle --sequence.seed=$S --reporter=dot > /tmp/storage-$S.log 2>&1; echo "SEED=$S EXIT=$?"; grep -E "Tests " /tmp/storage-$S.log; done
```

Expected: all four `EXIT=0`, `64 passed (64)` each.

★ If another seed fails on a *different* describe with the same "expected 1 times, got 0" shape, it is the same class on a different shared mock. Apply the same `mockReset()` treatment in that describe's `beforeEach`, with the same comment pointing at §75.

★★ **MEASURED OUTCOME — seed 7 fails, on a THIRD order dependence that is NOT this class.**
`useStorageBackend — Layer 3 wipe guard (persistence choke point) > refuses to persist a MULTI-collection simultaneous wipe (bug signature)` fails at seed 7 with `expected "vi.fn()" to be called with arguments: ['info', StringContaining{…}] — Number of calls: 0`. Verified pre-existing **twice**: once by the implementer (stash the fix, re-run) and once independently by the controller (`git checkout 2d7db4e3 -- src/app/use-storage-backend.test.tsx`, re-run seed 7 → identical failure, then restore). That describe never uses `mockReturnValueOnce` on `createBackend` and resets it explicitly per test, so there is no queue to drain and the `mockReset()` treatment does not apply. Its toast fires synchronously from a `useEffect` (`use-storage-backend.ts:361`), not off a timer. **Root cause unknown — do not guess at one.**

**It is deliberately NOT fixed in this slice**, for two reasons that must both hold: the blocking CI job pins seed 1, which is green, so no gate ships red; and §75's scope is the seed-1 reproduction it documents, while this is a different mechanism and therefore a different entry. Task 8 files it as a new numbered entry. Do not close §75 in a way that implies this file is now order-independent — it is not.

★★★ **EVERYTHING IN THE PARAGRAPH ABOVE WAS WRONG, AND THE WAY IT WAS WRONG IS THE LESSON.** Measured afterwards, three ways: seed 7 FAILS at `2d7db4e3` (no drain), FAILS at `55143042` (`beforeEach` drain only, 2/2), and PASSES at `e0064815` and later (both drains, 3/3 plus a reviewer's 4/4). The seed-7 failure was never a separate defect — it was §75's own once-queue leak **escaping the describe boundary**, and the `afterEach` drain fixed it. ★★ Both observers who called it "pre-existing" were careful and both verified it against a baseline; they were still wrong, because the baseline they checked had NO fix while the failure was being kept alive by an INCOMPLETE one. **Re-measure against the CURRENT head before filing a new entry, not only against the baseline.** ★ It was caught only because the Task 8 agent tried to reproduce a claim it was about to write into the tracked register — against an instruction of mine telling it not to run tests. That instruction was wrong. ★ Also note the direction of discovery: the cross-describe leak was predicted by code review from reading the code alone, before anyone connected it to a failing seed.

- [ ] **Step 5: Commit**

```bash
git add src/app/use-storage-backend.test.tsx
git commit -F - <<'EOF'
test(storage): drain the createBackend once-queue between switch tests (§75)

`vi.clearAllMocks()` is `mockClear` — it wipes calls/instances/results and does
NOT drain a `mockReturnValueOnce` queue. `createBackend` is a module-level mock
shared by the whole file, and "confirm=false -> no save, no config change"
queues two values while consuming one, because the early return is precisely
what it asserts.

That leftover survived into the next test, shifting its queue by one: the
switch target was handed back as the main backend, the main backend as the
switch target, and `targetSave` was never called — "expected 1 times, got 0".
Invisible in declaration order; under `--sequence.shuffle --sequence.seed=1`
the two tests swap and it fails deterministically.

`mockReset()` in the describe's beforeEach drains the queue, before the
existing `mockReturnValue(mockBackend)` re-establishes the default. Scoped to
this describe deliberately: `vi.resetAllMocks()` would strip implementations
the file's other nine describes rely on.

Verified: seed 1 goes 1 failed/63 passed -> 64 passed; seeds 2, 3, 7 and the
unshuffled control all pass. open-followups §75.
EOF
```

---

## Task 3: Prove the FULL suite passes shuffled before adding any gate

**Files:** none — this is a gate on Task 4.

★★★ **This task exists because file-level shuffle changes which file runs first, so the full suite can hold order-dependent tests that neither isolated file shows.** Adding a blocking CI job before this is known would make its first pipeline red, on the very MR that introduces it.

- [ ] **Step 1: Run the full suite shuffled at seed 1**

```bash
npx vitest run --sequence.shuffle --sequence.seed=1 --reporter=dot > /tmp/full-seed1.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/full-seed1.log
```

Expected: `EXIT=0`, `Test Files  784 passed (784)`, `Tests  8959 passed (8959)` (counts as of `fb33f755`; they rise if you added tests).

- [ ] **Step 2: Check the file count actually executed**

Read the `Test Files` line. If it reports fewer than 784 files, **the run did not complete** — worker-startup timeouts under machine saturation silently skip files (16 of 784 were lost this way on seeds 2 and 3). A short file count is not a pass. Close other work and re-run.

- [ ] **Step 3: Decide, and record the decision**

- All green → continue to Task 4 as written.
- New failures of the *same class* (a leaked global, an undrained mock queue) → fix them here with the Task 1 / Task 2 pattern, then re-run this task.
- New failures you cannot fix within this slice → **do not ship a known-red blocking gate.** Add `allow_failure: true` to `unit-tests-shuffled` in Task 4, say so in its comment block, and open a new `open-followups.md` entry for the remainder. Note it in Task 8's register update.

- [ ] **Step 4: No commit** (nothing changed). Record the result in the Task 8 register text.

---

## Task 4: Add the two shuffled CI jobs (§75)

**Files:**
- Modify: `.gitlab-ci.yml` (insert after the `unit-tests` job, which ends at line 123 with `expire_in: 1 week`)

- [ ] **Step 1: Add both jobs**

Insert immediately after the `unit-tests` job block and before the `# File-size ratchet` comment:

```yaml
# Order-dependence gate. Runs the unit suite with vitest's shuffle at a PINNED
# seed, so the result is deterministic: it can only go red on a real regression,
# never on the seed of the day. Seed 1 is the seed that reproduced the two
# leaks closed in open-followups §75 (a leaked `window.matchMedia` stub, an
# undrained `mockReturnValueOnce` queue).
#
# ★★ `needs` includes `unit-tests` ON PURPOSE. Every other quality job needs only
# `install`, so GitLab runs them concurrently — and two full vitest runs on one
# runner is machine saturation, which is the documented trigger for the §39/§51
# load-sensitive flakes in the BLOCKING `unit-tests` job beside it. Serialising
# costs pipeline wall-clock and buys back determinism.
#
# ★ No coverage here: `unit-tests` owns the floors, and instrumenting a second
# full run doubles the cost of the runs we just argued must not saturate.
# ★ `--reporter=basic` does NOT exist in vitest 4.1.8 (errors at startup).
unit-tests-shuffled:
  stage: quality
  needs: [install, unit-tests]
  script:
    - npm run test:run -- --sequence.shuffle --sequence.seed=1 --reporter=dot

# Weekly random-seed sweep via a GitLab pipeline schedule. The pinned job above
# proves seed 1 stays green; this one samples the class instead of pinning one
# point of it. Warn-only: informational, not a merge gate.
#
# ★★ The seed is `$CI_PIPELINE_ID` and is echoed with its reproduce command. A
# random-seed failure whose seed was not recorded is unreproducible, which costs
# the reader's attention and returns nothing. `$RANDOM` was the obvious choice
# and is WRONG: it is a bash builtin, the runner shell on node:24-bookworm-slim
# is not guaranteed to be bash, and under sh it expands to empty — yielding a
# malformed `--sequence.seed=` on the one job whose entire value is a recorded
# seed. `$CI_PIPELINE_ID` is always present, needs no shell features, and is
# unique per pipeline.
unit-tests-shuffled-random:
  stage: quality
  needs: [install]
  rules:
    - if: $CI_PIPELINE_SOURCE == "schedule"
  allow_failure: true
  script:
    - 'echo "shuffle seed=$CI_PIPELINE_ID  (reproduce: npx vitest run --sequence.shuffle --sequence.seed=$CI_PIPELINE_ID)"'
    - npm run test:run -- --sequence.shuffle --sequence.seed=$CI_PIPELINE_ID --reporter=dot
```

★★★ **THE SINGLE QUOTES AROUND THE `echo` LINE ARE LOAD-BEARING — without them this job fails at GitLab's config-parse step.** The string contains a mid-string `: ` (in `reproduce: npx …`), and an unquoted YAML scalar containing `: ` parses as an implicit MAPPING, not a string. GitLab requires every `script` item to be a string, so the job would never run at all. An earlier revision of this plan shipped it unquoted; caught only because the implementer printed the parsed `script` array rather than just `needs`. ★ Verify by parsing, not by reading: `node -e "const y=require('js-yaml'),fs=require('fs');const d=y.load(fs.readFileSync('.gitlab-ci.yml','utf8'));console.log(d['unit-tests-shuffled-random'].script.map(s=>typeof s));"` must print `[ 'string', 'string' ]`. `typeof === "object"` on any entry means the mapping bug is present.

★ If Task 3 Step 3 sent you down the `allow_failure` path, add `allow_failure: true` to `unit-tests-shuffled` and extend its comment block with one sentence naming the follow-up entry number.

- [ ] **Step 2: Verify the YAML parses**

Run:
```bash
node -e "const s=require('fs').readFileSync('.gitlab-ci.yml','utf8'); const n=(s.match(/^unit-tests-shuffled:/m)?1:0)+(s.match(/^unit-tests-shuffled-random:/m)?1:0); console.log('jobs found:', n);" ; echo "EXIT=$?"
```

Expected: `jobs found: 2`, `EXIT=0`.

★ There is no local GitLab YAML validator in this repo. Both jobs are modelled on the existing `dependency-audit-full` (rules + `allow_failure`) and `unit-tests` (script shape) blocks; the first pipeline is the first real evidence, and iterating there is expected.

- [ ] **Step 3: Commit**

```bash
git add .gitlab-ci.yml
git commit -F - <<'EOF'
ci: add a pinned-seed order-dependence gate and a weekly random-seed sweep (§75)

Nothing in CI shuffled, so intra-file test-order dependence was invisible by
construction — the same shape as a prod-only defect that only the dev server
ever sees. Two jobs, answering different questions.

`unit-tests-shuffled` (blocking) runs the unit suite at a PINNED seed 1, the
seed that reproduced both §75 leaks. Deterministic, so it can only go red on a
real regression. It `needs: [install, unit-tests]` deliberately: every other
quality job needs only `install` and therefore runs concurrently, and two full
vitest runs on one runner is the machine saturation that triggers the §39/§51
load-sensitive flakes in the blocking job beside it. Wall-clock for
determinism is the right trade.

`unit-tests-shuffled-random` (weekly schedule, warn-only) samples the class
instead of pinning one point of it. Its seed is `$CI_PIPELINE_ID`, echoed with
the local command that reproduces it — `$RANDOM` is a bash builtin, the runner
shell is not guaranteed to be bash, and under sh it would silently produce a
malformed `--sequence.seed=`.

Neither job runs coverage; `unit-tests` owns the floors.
EOF
```

---

## Task 5: Create the pure TimeLog guard module (§74)

**Files:**
- Create: `src/app/timelog-guards.ts`
- Create: `src/app/timelog-guards.test.ts`

**Why a module and not the register's one-line fix.** §74 records the cheap fix: add `isMisconfigured` to both handler guards. That leaves two copies of one contract, which is the shape that produced the defect. It is also **untestable by construction** — the new guard's only trigger is the state in which the button is disabled, so no UI test can reach it. A pure predicate consumed by both sides makes the asymmetry unrepresentable *and* directly testable.

- [ ] **Step 1: Write the failing test**

Create `src/app/timelog-guards.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { canFetchBookings, canRefreshBookings } from "./timelog-guards";

const refreshOk = {
  isPopout: false,
  syncBusy: false,
  confirming: false,
  isMisconfigured: false,
  canRefresh: true,
};

const fetchOk = {
  isPopout: false,
  syncBusy: false,
  confirming: false,
  isMisconfigured: false,
  projectCustomerId: "42",
  selectedCount: 3,
};

describe("canRefreshBookings", () => {
  it("allows the refresh when nothing blocks it", () => {
    expect(canRefreshBookings(refreshOk)).toBe(true);
  });

  // ★ isMisconfigured is the whole point of §74: the button carried it and the
  //   handler did not, so any non-button caller would have acted against an
  //   unconfigured TimeLog.
  it("blocks the refresh when TimeLog is misconfigured", () => {
    expect(canRefreshBookings({ ...refreshOk, isMisconfigured: true })).toBe(false);
  });

  it("blocks the refresh in a popout, while busy, while confirming, and with nothing to refresh", () => {
    expect(canRefreshBookings({ ...refreshOk, isPopout: true })).toBe(false);
    expect(canRefreshBookings({ ...refreshOk, syncBusy: true })).toBe(false);
    expect(canRefreshBookings({ ...refreshOk, confirming: true })).toBe(false);
    expect(canRefreshBookings({ ...refreshOk, canRefresh: false })).toBe(false);
  });
});

describe("canFetchBookings", () => {
  it("allows the fetch when a customer and at least one project are picked", () => {
    expect(canFetchBookings(fetchOk)).toBe(true);
  });

  it("blocks the fetch when TimeLog is misconfigured", () => {
    expect(canFetchBookings({ ...fetchOk, isMisconfigured: true })).toBe(false);
  });

  it("blocks the fetch in a popout, while busy, and while confirming", () => {
    expect(canFetchBookings({ ...fetchOk, isPopout: true })).toBe(false);
    expect(canFetchBookings({ ...fetchOk, syncBusy: true })).toBe(false);
    expect(canFetchBookings({ ...fetchOk, confirming: true })).toBe(false);
  });

  it("blocks the fetch with no customer or no selected projects", () => {
    expect(canFetchBookings({ ...fetchOk, projectCustomerId: "" })).toBe(false);
    expect(canFetchBookings({ ...fetchOk, selectedCount: 0 })).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run:
```bash
npx vitest run src/app/timelog-guards.test.ts --reporter=dot > /tmp/guards1.log 2>&1; echo "EXIT=$?"; grep -E "Failed to load|Cannot find|Tests " /tmp/guards1.log
```

Expected: `EXIT=1`, with a module-resolution error naming `./timelog-guards`.

- [ ] **Step 3: Write the implementation**

Create `src/app/timelog-guards.ts`:

```ts
/**
 * TimeLog action guards — ONE contract per action, shared by the handler and
 * the button.
 *
 * ★★★ These exist because `handleRefreshBookings` / `handleFetchBookings` used
 * to hand-roll their own early-return guards while `TimelogToolbar` hand-rolled
 * a STRICTER `disabled` expression: the buttons included `isMisconfigured` and
 * the handlers did not. So any non-button caller — a voice command, a keyboard
 * shortcut, a future Action-Center CTA — would have acted against an
 * unconfigured TimeLog. Latent, because the button was the only caller.
 *
 * ★★ That asymmetry is what made open-followups §39 possible: the test
 * compensated for the product code's split (it waits for the button to become
 * enabled) instead of the product code resolving it. Read §39 as "test fixed",
 * not "cause removed".
 *
 * Pure and i18n-free by design — the point is that both call sites evaluate the
 * SAME expression, so they cannot drift again. See open-followups §74.
 */

/** Blockers shared by every TimeLog action. */
export interface TimelogActionState {
  /** Popout windows are read-only for sync actions. */
  isPopout: boolean;
  /** A sync is already in flight. */
  syncBusy: boolean;
  /** A destructive confirmation is open. */
  confirming: boolean;
  /** `!cfg.enabled || !cfg.host || !cfg.apiToken` — no usable TimeLog config. */
  isMisconfigured: boolean;
}

export interface TimelogFetchState extends TimelogActionState {
  /** The picker's customer id; `""` means none chosen. */
  projectCustomerId: string;
  /** How many projects are ticked in the picker. */
  selectedCount: number;
}

export interface TimelogRefreshState extends TimelogActionState {
  /** A previously-fetched scope exists to re-fetch. */
  canRefresh: boolean;
}

function isBlocked(state: TimelogActionState): boolean {
  return state.isPopout || state.syncBusy || state.confirming || state.isMisconfigured;
}

/** Fetch pulls the CURRENT picker selection, so it needs a customer + ≥1 project. */
export function canFetchBookings(state: TimelogFetchState): boolean {
  return !isBlocked(state) && state.projectCustomerId !== "" && state.selectedCount > 0;
}

/** Refresh re-fetches the LAST-FETCHED persisted scope, so it needs one to exist. */
export function canRefreshBookings(state: TimelogRefreshState): boolean {
  return !isBlocked(state) && state.canRefresh;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run:
```bash
npx vitest run src/app/timelog-guards.test.ts --reporter=dot > /tmp/guards2.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/guards2.log
```

Expected: `EXIT=0`, `Tests  7 passed (7)`.

- [ ] **Step 5: Commit**

```bash
git add src/app/timelog-guards.ts src/app/timelog-guards.test.ts
git commit -F - <<'EOF'
feat(timelog): add pure canFetchBookings/canRefreshBookings guards (§74)

One contract per action, to be shared by the handler and the button. The
register's recorded fix was to lift `isMisconfigured` into both handler guards,
which leaves two copies of one contract — the shape that produced the defect —
and is untestable by construction, since the new guard's only trigger is the
state in which the button is disabled. A pure predicate is directly testable
and makes the asymmetry unrepresentable.

Module only; wiring follows.
EOF
```

---

## Task 6: Wire both call sites to the shared guards (§74)

**Files:**
- Modify: `src/app/timelog-panel.tsx:385-424` (move `isMisconfigured` above the handlers; both early returns)
- Modify: `src/app/timelog-panel.tsx:437` (remove the now-duplicated declaration)
- Modify: `src/app/timelog-panel-toolbar.tsx:82,98` (both `disabled` expressions)

- [ ] **Step 1: Move `isMisconfigured` above the handlers and use the guard in `timelog-panel.tsx`**

Add the import beside the other local imports at the top of `src/app/timelog-panel.tsx`:

```tsx
import { canFetchBookings, canRefreshBookings } from "./timelog-guards";
```

Delete line 437 entirely:

```tsx
  const isMisconfigured = !cfg.enabled || !cfg.host || !cfg.apiToken;
```

and re-declare it above the handlers, immediately after the `canRefresh` block at line 387-388, so the handlers close over a value declared before them rather than after:

```tsx
  const canRefresh =
    refreshCustomerId !== undefined && refreshProjectIds.length > 0;
  // ★ Declared ABOVE the handlers on purpose: they read it through the shared
  //   guards below, and a `const` declared later in the same body works only
  //   because calls happen after render. Keep the declaration before its readers.
  const isMisconfigured = !cfg.enabled || !cfg.host || !cfg.apiToken;
  async function handleRefreshBookings() {
    // ★★ SAME predicate the Refresh button's `disabled` evaluates — see
    //    timelog-guards.ts. Previously this guard omitted `isMisconfigured`
    //    while the button included it (open-followups §74).
    if (!canRefreshBookings({ isPopout, syncBusy: sync.busy, confirming, isMisconfigured, canRefresh })) return;
```

and in `handleFetchBookings`, replace its early return:

```tsx
  async function handleFetchBookings() {
    // ★★ SAME predicate the Fetch button's `disabled` evaluates.
    if (
      !canFetchBookings({
        isPopout,
        syncBusy: sync.busy,
        confirming,
        isMisconfigured,
        projectCustomerId,
        selectedCount: selectedProjectIds.size,
      })
    )
      return;
```

- [ ] **Step 2: Use the same guards for the buttons in `timelog-panel-toolbar.tsx`**

Add the import at the top:

```tsx
import { canFetchBookings, canRefreshBookings } from "./timelog-guards";
```

Replace the Fetch button's `disabled` (line 82):

```tsx
          disabled={!canFetchBookings({ isPopout, syncBusy, confirming, isMisconfigured, projectCustomerId, selectedCount })}
```

Replace the Refresh button's `disabled` (line 98):

```tsx
            disabled={!canRefreshBookings({ isPopout, syncBusy, confirming, isMisconfigured, canRefresh })}
```

★ Every field named above is already a prop of `TimelogToolbar` (`isPopout`, `syncBusy`, `confirming`, `isMisconfigured`, `projectCustomerId`, `selectedCount`, `canRefresh`) — no prop-contract change.

- [ ] **Step 3: Typecheck and lint**

```bash
npx tsc --noEmit > /tmp/tsc.log 2>&1; echo "TSC_EXIT=$?"; tail -20 /tmp/tsc.log
npx eslint --max-warnings=0 src/app > /tmp/lint.log 2>&1; echo "LINT_EXIT=$?"; tail -20 /tmp/lint.log
```

Expected: both `EXIT=0`. An unused import or an unused variable is **fatal** under `--max-warnings=0`; if you left the old `isMisconfigured` declaration in place as well as the new one, tsc reports a duplicate-identifier error.

- [ ] **Step 4: Run the TimeLog test suites**

```bash
npx vitest run src/app/timelog-panel.test.tsx src/app/timelog-guards.test.ts --reporter=dot > /tmp/timelog.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/timelog.log
```

Expected: `EXIT=0`.

★ If a `timelog-panel.test.tsx` test now fails because a handler no longer proceeds while misconfigured, read it before changing it: such a test encoded the defect, and the fix is to give the fixture a configured TimeLog, not to weaken the guard. Verify that is actually what happened rather than assuming it.

- [ ] **Step 5: Commit**

```bash
git add src/app/timelog-panel.tsx src/app/timelog-panel-toolbar.tsx
git commit -F - <<'EOF'
fix(timelog): route both refresh/fetch guards through the shared predicates (§74)

`handleRefreshBookings` and `handleFetchBookings` each hand-rolled an early
return that omitted `isMisconfigured`, while the matching buttons hand-rolled a
`disabled` expression that included it. The button enforced a stricter contract
than the handler, so any non-button caller — a voice command, a keyboard
shortcut, a future Action-Center CTA — would have acted against an unconfigured
TimeLog. Latent only because the button was the sole caller.

Both sides now evaluate `canFetchBookings` / `canRefreshBookings`, so they
cannot disagree. `isMisconfigured` moves above the handlers rather than being
read through a closure over a later-declared const.

★ Read open-followups §39 as "test fixed", not "cause removed": that test
compensated for this split by waiting for the button to become enabled, which
worked precisely because the button carried a guard the handler did not.
EOF
```

---

## Task 7: Record the `onTestFailed` trap in AGENTS.md (§73)

**Files:**
- Modify: `AGENTS.md` (the `npm run test:run` block inside the ```bash Commands fence)

- [ ] **Step 1: Add the landmine paragraph**

In the `## Commands` fenced block, inside the `npm run test:run` comment run, append after the existing `--reporter=basic` sentence:

```
                            # ★★★ `onTestFailed` CANNOT INSPECT DOM OR MOCK STATE HERE — vitest runs
                            # it AFTER every `afterEach`, and `afterEach` is LIFO, so `vitest.setup.ts`'s
                            # RTL `cleanup()` and the file's own `vi.clearAllMocks()` have both already
                            # run: the capture reads zeroed mocks and an empty `document.body`. Measured,
                            # not theorised — a capture written the obvious way printed
                            # `{"fetchCalls":0,"toastCalls":[],…}` on a run where the fetch HAD fired and
                            # the toast HAD rendered, falsely CONFIRMING the suspected hypothesis with
                            # fabricated evidence. That is worse than no capture: one that agrees with
                            # your prior is the one you stop checking. Use a describe-scoped `afterEach`
                            # holding a closure the test body assigns, guarded on
                            # `ctx.task.result?.state === "fail"` — registered last ⇒ runs FIRST ⇒ mocks
                            # and DOM are still live (`timelog-panel.test.tsx`, `use-tasks-dedup.test.tsx`
                            # carry the pattern and a warning comment).
```

- [ ] **Step 1b: Record the two new CI gates in AGENTS.md's CI bullet**

AGENTS.md's hard-constraints section carries a **CI is GitLab** bullet enumerating the pipeline's jobs, and it ends with the standing rule *"New CI gate → also update this line."* Task 4 added two, so add them to that enumeration: **`unit-tests-shuffled`** (BLOCKING — full unit suite at `--sequence.shuffle --sequence.seed=1`; `needs: [install, unit-tests]` so it cannot run concurrently with `unit-tests`) and **`unit-tests-shuffled-random`** (weekly `schedule` only, warn-only, seed `$CI_PIPELINE_ID`), the latter beside the existing `dependency-audit-full` + `dast-zap` schedule mention.

★ This is a separate edit from the `onTestFailed` paragraph below, in a different section of the same file. Do both in this task; they share a commit.

- [ ] **Step 2: Verify the symbol gate still passes**

Run:
```bash
npm run docs:symbols:check > /tmp/symbols.log 2>&1; echo "EXIT=$?"; tail -20 /tmp/symbols.log
```

Expected: `EXIT=0`.

★ The gate requires every backticked name to exist somewhere in `src`/`scripts`/`e2e`. `onTestFailed` exists **only in three warning comments** (`timelog-panel.test.tsx:257,260`, `use-tasks-dedup.test.tsx:87`) — there is no call site in the repo. That is a real dependency on those comments staying put, and Task 8 records it in §73. `afterEach` and `cleanup` are used widely and are safe.

★ `onTestFinished` has **no** occurrence anywhere, so it must not appear in backticks. The paragraph above deliberately does not mention it.

- [ ] **Step 3: Commit**

```bash
git add AGENTS.md
git commit -F - <<'EOF'
docs: record that onTestFailed reports post-teardown state (§73)

Vitest runs `onTestFailed` after every `afterEach`, and `afterEach` is LIFO, so
the setup file's RTL `cleanup()` and the file's own `vi.clearAllMocks()` have
both already run by then. A failure capture written the obvious way therefore
reads zeroed mocks and an empty document.

Measured while instrumenting §39: it printed `{"fetchCalls":0,"toastCalls":[]}`
on a run where the fetch had fired and the toast had rendered, which would have
falsely CONFIRMED the already-suspected hypothesis with fabricated evidence.
A capture that agrees with your prior is the one you stop checking.

The working pattern — a describe-scoped `afterEach` guarded on the task result,
holding a closure the test body assigns — was previously recorded only in
open-followups §73, which is not loaded into any session.
EOF
```

---

## Task 8: Close §73, §74 and §75 in the register

**Files:**
- Modify: `docs/open-followups.md` (index rows near lines 84-118; sections at 3344, 3386, 3411)

- [ ] **Step 1: Update the three index rows**

Follow the strikethrough + **CLOSED** convention already used by the §76 row (line 118). Rows only — **never renumber**; the numbers are stable identifiers cited from `AGENTS.md`, `docs/CODEMAPS/*` and source comments, and renumbering silently redirects every one of them.

```
| 73 | ~~`onTestFailed` reports post-teardown state, so any capture it makes is a false witness~~ | found post-0.214.0 | S | **CLOSED** — recorded in AGENTS.md's `test:run` block; ★ the symbol gate's only anchor for the name is three warning COMMENTS |
| 74 | ~~The TimeLog refresh handlers omit a guard their button carries~~ | pre-existing, found post-0.214.0 | S | **CLOSED** — fixed STRUCTURALLY (shared pure predicates in `timelog-guards.ts`), not by the recorded two-copy lift |
| 75 | ~~Two test files contain ORDER-DEPENDENT tests (intra-file, NOT cross-file leakage)~~ | pre-existing, found post-0.214.0 | S–M | **CLOSED** — both leaks NAMED and fixed; ★★ a pinned-seed CI job now blocks regressions and a weekly random-seed job samples the class |
```

- [ ] **Step 2: Rewrite §75's section**

Retitle to `## 75. ~~Two test files contain ORDER-DEPENDENT tests — and there is a REPRODUCING SEED~~ — CLOSED`, keep the existing analysis (the intra-file correction and the `--sequence.shuffle` mechanics are still the transferable part), and add:

- **Both mechanisms, named.** `modern-shell.test.tsx`: `stubViewport` assigned `window.matchMedia` directly — a plain property write no mock-lifecycle call can undo, with no jsdom original to restore to — pinning the file to a narrow viewport after the first mobile-drawer test. ★★ It survived because of a COINCIDENCE, not because the drawer describe is last (it is third of five): that describe's final test stubs `matches: false`, which is the wide-viewport value the two describes after it happen to need. Adding or reordering a test inside it would have broken them with no shuffle involved. An earlier revision of this plan, its first commit message, and the code comment all claimed "the drawer describe is last" — false, caught by code-quality review. `use-storage-backend.test.tsx`: `vi.clearAllMocks()` is `mockClear` and does not drain a `mockReturnValueOnce` queue, so the leftover from `confirm=false → no save` shifted the next test's queue by one.
- **Correct the stale count**: the entry says `1 failed / 62 passed` for the storage file; it is `63 passed` — the §72 test landed on `main` after the entry was written. Not a behaviour change.
- **The gate**: `unit-tests-shuffled` (blocking, seed 1) and `unit-tests-shuffled-random` (weekly, `$CI_PIPELINE_ID`), with the `needs: [install, unit-tests]` reasoning and the rejected `$RANDOM`.
- **Scope, still honestly**: this was never a live CI failure. From this commit forward it is gated at seed 1 only — a new order-dependent test failing at some other seed still reaches `main` and is caught, at best, by the weekly job.
- ★★ **Do NOT let the closure imply either file is now order-independent.** `use-storage-backend.test.tsx` still fails at seed 7 on a third, different-mechanism dependence, filed separately in Step 2b. §75 closes because the two defects it documents are fixed, not because the class is gone from these files. Cross-link the new entry.
- Whatever Task 3 found beyond the known 4, including "nothing".

- [ ] **Step 2b: File the NEW entry found during Task 2**

Add the next free number (expected **§77** — check the file; numbers are stable and never reused) with an index row and a section:

> **Title:** A THIRD order-dependent test in `use-storage-backend.test.tsx` — different mechanism from §75 — open
>
> `useStorageBackend — Layer 3 wipe guard (persistence choke point) > refuses to persist a MULTI-collection simultaneous wipe (bug signature)` fails under `npx vitest run src/app/use-storage-backend.test.tsx --sequence.shuffle --sequence.seed=7` with `expected "vi.fn()" to be called with arguments: ['info', StringContaining{…}] — Number of calls: 0`.
>
> ★★ **Pre-existing, verified TWICE and independently** — by the §75 implementer (stash the fix, re-run) and by the controller (`git checkout 2d7db4e3 -- src/app/use-storage-backend.test.tsx`, re-run, restore). Both saw the identical failure. It is not caused by §75's `mockReset()` fix.
>
> ★★ **NOT §75's class.** That describe never calls `mockReturnValueOnce` on `createBackend` and resets it explicitly per test, so there is no once-queue to drain; the assertion's toast fires synchronously from a `useEffect` (`use-storage-backend.ts:361`), not off a debounced timer. **Root cause unknown.** Do not assume a shared diagnosis with §75 — that is the §39/§51 mistake.
>
> ★ **Not a live CI failure and not caught by the new gate.** `unit-tests-shuffled` pins seed 1, which is green. `unit-tests-shuffled-random` will hit this class eventually, which is the argument for that job existing.
>
> ★ Reproduce: the command above. It reproduces with the file run ALONE.

- [ ] **Step 3: Rewrite §74's and §73's sections**

§74 → `CLOSED`. Record that the fix went **structural** rather than the cheap two-copy lift the entry recommends, and why: the cheap fix is untestable by construction, because the guard's only trigger is the state that disables the button. Keep the §39 provenance sentence — "test fixed, not cause removed" stays true of §39's own history.

§73 → `CLOSED`. Record the AGENTS.md placement, and that `agents-symbol-check`'s only anchor for `onTestFailed` is three warning comments, so a future comment cleanup would break the gate.

- [ ] **Step 4: Verify the docs gates**

```bash
npm run docs:symbols:check > /tmp/symbols2.log 2>&1; echo "EXIT=$?"; tail -10 /tmp/symbols2.log
```

Expected: `EXIT=0`.

- [ ] **Step 5: Commit**

```bash
git add docs/open-followups.md
git commit -F - <<'EOF'
docs: close §73, §74 and §75 with their named mechanisms

§75: both leaks named rather than merely fixed — a leaked `window.matchMedia`
stub (a plain property write, invisible to every mock-lifecycle call, with no
jsdom original to restore to) and an undrained `mockReturnValueOnce` queue
(`clearAllMocks` is `mockClear`, which does not touch the once-queue). Records
the two new CI jobs, the `needs: [install, unit-tests]` reasoning, and why
`$RANDOM` was rejected for the weekly seed. Corrects the entry's `62 passed` to
`63` — the §72 test landed on main after it was written. Scope stays honest:
gated at seed 1 only.

§74: closed structurally (shared pure predicates) rather than by the two-copy
lift the entry recorded, because that version is untestable by construction.

§73: closed into AGENTS.md, noting that the symbol gate's only anchor for
`onTestFailed` is three warning comments.

Rows only — no renumbering. The numbers are stable identifiers cited from
AGENTS.md, docs/CODEMAPS/* and source comments.
EOF
```

---

## Task 9: Full verification

**Files:** none.

- [ ] **Step 1: Run every gate, exit codes unpiped**

```bash
npx eslint --max-warnings=0 src/app > /tmp/v-lint.log 2>&1; echo "LINT=$?"
npx tsc --noEmit                    > /tmp/v-tsc.log  2>&1; echo "TSC=$?"
npm run test:run                    > /tmp/v-test.log 2>&1; echo "TEST=$?"; grep -E "Test Files|Tests " /tmp/v-test.log
npm run test:coverage               > /tmp/v-cov.log  2>&1; echo "COV=$?";  grep -E "ERROR|threshold|All files" /tmp/v-cov.log | head
npm run size:check                  > /tmp/v-size.log 2>&1; echo "SIZE=$?"
npm run docs:symbols:check          > /tmp/v-sym.log  2>&1; echo "SYM=$?"
npm run dup:check                   > /tmp/v-dup.log  2>&1; echo "DUP=$?"
```

Expected: every variable `=0`. `Test Files 784 passed`, `Tests 8959 passed` (or higher — this slice adds 7 tests, so expect `8966`).

★ `npm run lint` is bare `eslint` with no `--max-warnings` and **exits 0 with warnings present** — it does not reproduce the CI gate. Use the `npx` form above.

★ Coverage floors are blocking in CI and `test:run` does not enforce them. `timelog-guards.ts` is a new **coverage-gated** file (it is a pure `.ts`, not covered by `vitest.config.ts` `coverage.exclude`); the Task 5 tests cover every branch, but confirm `COV=0` rather than assuming.

- [ ] **Step 2: Re-run the full shuffled suite one final time**

```bash
npx vitest run --sequence.shuffle --sequence.seed=1 --reporter=dot > /tmp/v-shuffle.log 2>&1; echo "SHUFFLE=$?"; grep -E "Test Files|Tests " /tmp/v-shuffle.log
```

Expected: `SHUFFLE=0`, and the `Test Files` count is the full 784 — a short count means workers died, not that the suite passed.

- [ ] **Step 3: Confirm the branch state**

```bash
git status --short; echo "---"; git log --oneline main..HEAD
```

Expected: a clean tree and **seven** commits — one each from Tasks 1, 2, 4, 5, 6, 7 and 8. Task 3 is a verification gate and adds none.

★ **No version bump.** Test fixes, CI configuration, a latent-guard fix with no behaviour change today, and docs. Nothing user-facing, so `src/app/version.ts`, `CHANGELOG.md`, `package.json`, `package-lock.json`, the README badge and the codemap headers all stay untouched.

★ **Do not push, open an MR, or merge** without an explicit instruction. Report the gate results and stop.

---

## What this slice does NOT establish

Record these in the MR description; they are the honest limits, not caveats to bury.

- **The blocking job proves seed 1 stays green, nothing more.** A new order-dependent test that only fails at another seed slips past it until the weekly job happens to draw a seed that catches it.
- **The weekly job is unexercised until the next scheduled pipeline.** A scheduled job that silently never runs is a gate in name only — confirm it fired, rather than assuming, on the first schedule after merge.
- **`needs: [install, unit-tests]` is reasoned from the recorded §39/§51 failure conditions, not measured.** If pipeline duration becomes the binding constraint, the measurement to take is whether the runner can absorb a concurrent second vitest run — not whether the flakes "seem" to have stopped.
- **§74's fix is unreachable today.** The button is still the only caller, so nothing user-facing changes; the value is that the next caller cannot reintroduce the gap.
- **Neither §75 nor §74 explains §39 or §51.** Those are load-sensitive, not order-sensitive, and neither affected file failed under any of the six amplification configurations.
