# Machine unblocking — slice 2: the CI flake hunt, plus the one flake that has a mechanism

_Design, 2026-08-04. Successor to `2026-08-03-machine-unblocking-design.md` (slice 1, `!342`)._
_Base: `main` at `234f708b`, app version 0.214.0 "Lostetter"._

★ This document lives under `docs/superpowers/`, which is **gitignored**. It exists only on this
machine. Everything another contributor needs must land in `docs/open-followups.md`, not here — that
is the same failure mode `open-followups.md` §44 records for the S6 calendar plan.

## Why this slice

Slice 1 scoped its own successor: "§39/§51 root cause is **Slice 2** (3-step stop rule; **no timeout
raises** — 5s→15s already bought nothing)."

Since that scoping, a **third** flake signature was captured from pipeline **5446** (main `6dcee7eb`,
2026-08-04) — and unlike §39 and §51, it comes with a mechanism and a known fix shape. It is not yet
in the register. This slice ships that fix and then runs the hunt, in that order, so the slice cannot
finish empty-handed.

### The three signatures are distinct — do not assume one diagnosis covers them

| sig | shape | evidence | mechanism |
|---|---|---|---|
| **§39** timelog partial-failure toast | timeout budget fully consumed: 15,093 / 15,098 / 15,117 ms, spread **24 ms** at a 15,000 ms ceiling | the toast never arrives on those runs | **none** |
| **§51** `use-tasks-dedup` "on confirm" | immediate miss, **38 ms**; trigger still `disabled=""`, so the mocked `runDedupProposal` had not resolved | modal absent from the DOM | **none** |
| **NEW (5446)** | **exit 1 with 778/778 files and 8792/8792 tests PASSING**, `Errors 1 error` | `ReferenceError: window is not defined` ← `resolveUpdatePriority` ← `dispatchSetState` ← `onStorageOutcome` (`task-manager.tsx:415`) ← `use-storage-backend.ts:314` | **captured** |

★★ The new signature is the one that makes "unit-tests failed" unreadable: anyone grepping the trace
for `FAIL` or `✗` finds nothing and concludes the runner broke. Search for `Errors  N error` /
`Unhandled Errors`. Removing this signature also makes the §39/§51 hunt cheaper, because a job that
exits 1 with everything green is noise the hunt otherwise has to filter out on every occurrence.

★ A tempting unifying hypothesis — "§39's toast never arrives and §51's mocked promise never settles,
so all three are one never-settling-async problem" — is **recorded as a hypothesis only**. §39's
signature (budget fully consumed) and §51's (immediate miss) are different shapes. Do not write a fix
against it.

## Scope

Three deliverables. One is certain; two are conditional by construction.

1. **§72 — guard the teardown race.** A real code fix in `use-storage-backend.ts`.
2. **The §39/§51 hunt** — reachability, then bounded amplification, then instrumentation.
3. **Register hygiene** — open §72, repair the index table, update §39/§51 with what is actually
   established (including "still unknown", if that is the truth).

**Out of scope:** §40, §50, §54 (those are slice 3). Any app-wide sweep for sibling fire-and-forget
`setState` hooks — surveyed and recorded in §72 if cheap, **fixed nowhere in this slice**. This slice
already carries one unbounded hunt; it must carry exactly one bounded fix, not two.

**No version bump.** Same posture as slice 1. Nothing user-visible changes (see the honesty note in
part 1). §72 is the durable record; a CHANGELOG line would overstate it.

---

## Part 1 — §72, the teardown-race guard

### What is actually broken

`use-storage-backend.ts` calls back into the component from three async regions. **Two of the three
are unguarded**, and the pattern that fixes them already exists in the file:

| region | lines (2026-08-04 base; re-grep, do not trust these) | guard today |
|---|---|---|
| load effect | ~218–248 | ✅ `let cancelled` + `if (cancelled) return;` after every `await`; cleanup sets it |
| **save effect** (debounced 500 ms) | ~307–331 | ❌ **none** — `doSave()` is fire-and-forget; cleanup clears the timer and removes the flush listeners, but an in-flight save keeps running and its `.then`/`.catch` `setState` |
| `reloadCurrentProject` | ~628–662 | ❌ none — user-gesture async, identical shape, lower odds |

`task-manager.tsx:415`'s `onStorageOutcome` is a `useCallback` with `[]` deps, so the closure outlives
the component. After teardown, `setStorageError(...)` → React 19 asks for update priority →
`resolveUpdatePriority` touches `window` → unhandled rejection → vitest exit 1.

★ The save effect's own comment claims the `.catch` means "neither the timer nor the flush-on-hide
below can produce an unhandled rejection". **The handler itself is what rejects**, after teardown. Fix
that comment along with the code — a comment asserting the absent property is worse than none.

### Mechanism

One mounted ref plus four choke-point helpers inside the hook (two shown here; `emitRegistryChange`
and `emitStorageConfig` follow the same three-line shape — see the widening note below):

```ts
const mountedRef = useRef(true);
useEffect(() => {
  // ★★ Re-set on mount, not merely cleared on unmount. React StrictMode mounts,
  // unmounts and remounts in development; a cleanup-only guard would leave every
  // callback permanently suppressed after that first cycle.
  mountedRef.current = true;
  return () => { mountedRef.current = false; };
}, []);

const emitOutcome = (err: unknown | null) => {
  if (!mountedRef.current) return;
  args.onStorageOutcome?.(err);
};
// ★ The hook's own arg type spells the union inline (`use-storage-backend.ts:55`:
// `showToast: (kind: "info" | "error" | "success", text: string) => void`). A
// `ToastKind` alias DOES exist (`use-toast.ts:9`) but is not imported here — either
// mirror the inline union or add the import; do not assume the alias is in scope.
const emitToast = (kind: "info" | "error" | "success", msg: string) => {
  if (!mountedRef.current) return;
  args.showToast(kind, msg);
};
```

★ **Widened during planning — two more caller callbacks have the identical exposure.** The first
draft of this section scoped the sweep at `onStorageOutcome` + `showToast`. Reading the whole file
for the plan turned up `onRegistryChange` (1 site, in `commitRegistry`, reached from the async
project flows) and `setStorageConfig` (1 call in the convert flow + 1 pass-through). Both `setState`
in `task-manager`; both are in. So the guard is **four** emitters, not two — `emitOutcome`,
`emitToast`, `emitRegistryChange`, `emitStorageConfig`.

★★ The two **sub-hook pass-throughs** (`showToast: args.showToast` into `useTursoProjectOps` and
`useFileProjectOps`) become `showToast: emitToast`, which extends the guard into both of those hooks
for **zero extra call sites**. `setStorageConfig: args.setStorageConfig` into `useFileProjectOps`
likewise.

★ **`args.setActivityLog` is deliberately excluded.** It is handed to `useBroadcastSync`, which owns
its own listener lifecycle and cleanup; guarding it needs a different design. Survey it in §72 and
fix nothing.

Full sweep: every direct `args.onStorageOutcome?.(…)` (**8** sites), every `args.showToast(…)`
(**23**), the single `args.onRegistryChange?.(…)`, the single `args.setStorageConfig(…)` call, and
the three pass-throughs — **35 call sites in total**. Reproduce the two large counts:

```bash
grep -c "args.onStorageOutcome?.(" src/app/use-storage-backend.ts
grep -c "args.showToast(" src/app/use-storage-backend.ts
```

★★★ **It MUST be a mounted ref, not the load effect's `cancelled` flag, and the two look identical.**
The save effect's deps include the whole workspace, so it re-runs on **every edit**. A per-run
`cancelled` would suppress the outcome of a save that was merely *superseded while still in flight* —
silently swallowing real save errors in production. The load effect can use per-run because a
superseded load genuinely is irrelevant; a superseded save is not. **The load effect keeps its
`cancelled`.** The two guards answer different questions and both stay.

### Why all 23 toasts and not the 8 post-await ones

Only 8 of the 23 `showToast` calls are reachable after an `await` (`228`, `253`, `256` load · `324`,
`327`, `329` save · `653`, `658` reload; `297` is in the synchronous effect body). Routing only those
would halve the diff.

**Rejected.** It leaves two spellings of the same call in one file, and "is this one after an await?"
is a judgement a future edit can silently invalidate — which is exactly how the save effect ended up
without the guard its sibling has. The 15 synchronous calls are no-ops through the helper (`mounted`
is true). Uniformity is the point of a choke point.

### Honesty note — this is not a user-facing fix

In production `task-manager` is the root orchestrator and effectively never unmounts, so the guard
almost never fires. The value is a CI job that stops exiting 1 with 8792/8792 green. Say that plainly
in §72 and in the commit message. Do not sell it as a user fix.

### Tests

Two cases in the existing `src/app/use-storage-backend.test.tsx`. **Both must fail before the fix** —
run them against unmodified source and record that they did.

1. **The regression.** Deferred `backend.save`, advance past the 500 ms debounce, **unmount**, then
   resolve the deferred → `onStorageOutcome` is not called and no unhandled rejection escapes.
2. **The trap.** Still mounted, save superseded by a workspace change while in flight → the outcome
   **is** reported. This is what pins the guard as mounted-scoped rather than per-run; without it, a
   future "simplification" to `cancelled` passes.

★ `use-storage-backend.ts` is **not** in `vitest.config.ts` `coverage.exclude` — it is gated. The new
helpers and their guard branches must be covered by the two cases above or the unit job's function/
branch floors move.

---

## Part 2 — the §39/§51 hunt

Slice 1's stop rule was *reproduce → reachability → instrument*. **The first two are swapped here.**

Reason: step 1 as written gambles the slice's whole budget on reproducing a rare flake, while step 2
is deterministic and cheap — and §51's recorded contradiction *is* a reachability question. If a
branch turns out to be unreachable under those mocks, there is nothing to reproduce and the
amplification work is wasted. §39's 24 ms-spread evidence already reframed it from timing to
logic/race, which points the same way.

### Step B — reachability, in isolation (first, deterministic)

- **§39:** determine whether `showToast("error", …)` is reachable **at all** on the timelog
  partial-failure path under that file's mocks. Candidate causes named in the register: an unresolved
  promise in the mocked `useTimelogSync`, a lost `act()` flush, a partial-failure branch that only
  fires when a timer wins a race it usually loses.
- **§51:** resolve the contradiction the CI trace cannot. The line before the failure was
  `await waitFor(() => expect(screen.getByText(/dup/i)).toBeTruthy())` — for the reported error to be
  the one that surfaced, that `waitFor` must have succeeded, yet the modal was absent and the trigger
  still `disabled`. Either something other than the modal satisfied `/dup/i`, or the preview opened
  and closed between the two lines. ★ The `/dup/i` matcher was already replaced post-0.212.0 with
  `findByRole("button", { name: /merge selected/i })`; that removed a way the test could mislead, it
  did **not** remove the reason it failed. Do not read the matcher fix as a root cause.

### Step A — amplify and bisect (bounded)

Deliberately make the environment worse to raise the failure rate, then bisect what amplifies it.
Two hypotheses, **3 amplified full-suite runs each**, then fall through to step C regardless.

1. **Cross-file async leakage.** `--no-isolate` as a discriminator: if the failure rate jumps,
   leakage between files sharing a worker is implicated. `vitest.config.ts` sets no `pool`,
   `isolate`, `fileParallelism` or `maxWorkers`, so all defaults are in play.
2. **File-neighbour ordering.** `--sequence.shuffle` with recorded seeds, plus oversubscribed workers
   on constrained CPU.

★ Record the runs and their outcomes even when they find nothing. Eight occurrences have produced
only frequency data; "we ran these six configurations and none reproduced" is itself the first
negative result this problem has.

### Step C — instrumentation (a legitimate finish)

`onTestFailed` (vitest 4.1.8; currently unused anywhere in the repo) in **the two tests only**.

- **§39:** was `showToast` called at all, and with what arguments? Did the mocked `useTimelogSync`
  promise settle?
- **§51:** what node matched the gate, was the modal ever mounted, did `runDedupProposal` settle?

★★ **Read-only, failure-path only.** Nothing that `await`s, flushes, or adds a `waitFor` — that
perturbs the race it exists to observe, and §39's history is a case study in mitigations that moved
the failure instead of explaining it.

**Rejected in advance, both directions:**

- **No timeout raises.** 5 s → 15 s moved the failure point and bought nothing; three later failures
  then consumed the 15 s budget to within 24 ms. §51 is not even timeout-shaped (38 ms).
- **No `retry`** in `vitest.config.ts`. It is currently unset. Setting it hides the signal this slice
  exists to capture.
- **Operational answer meanwhile stays: retry the job.** Confirmed flaky by retry, not by argument —
  job 20222 was a plain retry of `unit-tests` on the same commit `351eb05f` with no code change, and
  it passed.

---

## Part 3 — register hygiene

All of it in `docs/open-followups.md`, in the same commit as the code it describes.

1. **Open §72** for the captured teardown-race mechanism: the trace, the three-region table, the
   mounted-vs-`cancelled` distinction, the honesty note, and the outcome. If a sibling survey is run,
   record its counts here with the reproduce command; fix nothing.
2. **Repair the index table.** It stops at **§67** — §68, §69, §70 and §71 have bodies but no row.
   Add four rows, plus §72's.
3. **Update §39 and §51** with what step B/A/C actually established. If the honest answer is
   "reachability proved, mechanism still unknown", write that. Both entries stay **open** unless a
   root cause is genuinely established.

★★ Slice 1's own lesson applies directly here: **correcting a claim is when you are most likely to
write a new one.** Two reviewers found four falsehoods in that branch's prose, two of them *inside
corrections of earlier falsehoods*. Re-measure every replacement claim, and grep every pointer into a
paragraph that gets rewritten.

★ Cite symbols, not `file:line`. A line number can be invalidated by the very commit that writes it —
§68's first revision cited two line numbers its own commit had already moved.

---

## Landing

Branch from `main`. Gates, exit codes read **unpiped** (never through `| tail` or `| grep` — that
reports the pipe's status and has produced both a false green and a false red in this repo):

```bash
npm run test:run > /tmp/suite.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests |Errors" /tmp/suite.log
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app; echo "EXIT=$?"
```

★ Grep the suite log for `Errors` as well as the test counts — this slice exists because a green
count can sit above a non-zero exit.

**No e2e run needed:** nothing rendered changes. (The standing "run full `npm run e2e` before pushing
any rendered-surface change" rule from 0.214.0 does not bind here — but it binds the moment any
part of this slice touches a component.)

Push, MR, and merge only on an explicit instruction, and merge only on a green pipeline.

## Success criteria

- **Certain:** §72's guard shipped, both regression tests fail-before / pass-after, all gates green,
  §72 opened and the index table repaired.
- **Conditional:** §39/§51 either diagnosed, or instrumented such that occurrence #9 produces
  evidence instead of a ninth frequency data point.
- **Failure mode to avoid:** any timeout raised, any `retry` added, or either entry closed on an
  argument rather than evidence.
