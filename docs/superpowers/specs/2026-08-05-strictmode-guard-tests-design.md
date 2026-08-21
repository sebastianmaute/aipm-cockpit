# StrictMode guard tests — retract §85, close §72 and §76

**Date:** 2026-08-05
**Register items:** §85 (retract), §72 (close), §76 (close)
**Class:** tests + docs. **No version bump** (same class as MR !348).
**Base:** `main` @ `aefddc88`, 0.215.0 "Friedman".

## Problem

Three shipped guards can be deleted today with every gate green.

`use-storage-backend.ts:182`, `use-scheduled-jobs.ts:52` and `use-operating-guides.ts:77` each
re-set a `mountedRef` in the effect BODY, not only in its cleanup. That re-set is load-bearing in
development: React StrictMode mounts, unmounts and remounts, so a cleanup-only guard is permanently
false afterwards and every setter behind it is suppressed for the rest of the dev session. For
`useScheduledJobs` the consequence is that `useScheduledJobRunner` sees an empty job list and **no
scheduled job fires in dev at all**.

None of the three is pinned by a test. All three say the same thing in a comment: a StrictMode test
would be vacuous, because StrictMode was measured invoking effects once (`["mount"]`, no
cleanup+remount) under this suite. §85 generalised that measurement to the whole suite and concluded
no StrictMode-dependent behaviour is testable here.

## The measurement that changes this

Taken 2026-08-05 with a module-scope probe (the shape §85's top-ranked hypothesis says the original
may have got wrong), run under `npx vitest run`:

```
PROBE-A componentLog: ["mount","cleanup","mount"]     render(<StrictMode><Probe/></StrictMode>)
PROBE-B hookLog:      ["mount","cleanup","mount"]     renderHook(fn, { wrapper: StrictMode })
PROBE-C perInstance:  ["instance-saw:mount","instance-saw:mount+cleanup+mount"]
PROBE-D react 19.2.4, dev build confirmed (the dev-only missing-`key` warning fires)
PROBE-E control:      ["mount","cleanup"]             non-StrictMode sanity
```

**StrictMode double-invokes effects under this vitest/jsdom setup.** The premise of §85 is false, and
so is the "vacuous / cannot be pinned" claim in all four comments that rest on it.

It is also not the artefact hypothesis: probe C's per-instance log observed the full cycle too. The
recorded `["mount"]` was specific to whatever was done to `renderBackend` on 2026-08-04 — that helper
wraps `TestProviders`, not `StrictMode`, so the original instrument is not recoverable and is not
worth reconstructing. The reproducible fact stands on its own.

## Deliverables

### 1. `strictmode.meta.test.tsx` — the standing assertion

A permanent test asserting the double-invocation itself: module-scope logs, both the `render` and the
`renderHook({ wrapper: StrictMode })` shapes, plus the dev-build check.

Its purpose is not to test the app. It is to fail loudly if a future React / vitest / RTL / config
change silences the double invoke — which would otherwise make every guard test below silently
vacuous while staying green. That exact failure mode is what produced §85.

The probe is committed rather than described, so the next reader can re-take the measurement instead
of trusting prose (§85's own complaint about its predecessor).

### 2. Three behavioural guard tests

One per site, in that hook's existing test file. Each renders the hook wrapped in `StrictMode`, lets
the mount→unmount→remount cycle and the pending async settle, then asserts the setter the flag
protects actually lands.

Behavioural, not ref-inspecting — the assertion is on observable output, so it fails for the reason
the defect would.

| Site | Assertion | With the re-set deleted |
|---|---|---|
| `use-scheduled-jobs.ts:52` | `result.current.jobs` holds the loaded list | stays `[]` — the dev defect, directly |
| `use-storage-backend.ts:182` | the emit fires (`showToast` / `onStorageOutcome` mocks already in that harness) | never fires |
| `use-operating-guides.ts:76` | `result.current.guides` holds the loaded list and `ready` is `true` | both stay empty/false — and `ready` is consumed, so the AI chat composer stays disabled whenever "ground in guides" is on |

Ordering note that makes these work: in each hook the mount effect is declared BEFORE the refresh
effect, so on the StrictMode remount the flag is restored before the refresh effect re-runs, and it
is `true` again when the async resolves.

### 3. Prose corrections

- `use-scheduled-jobs.ts:67-68` — drop "No test can pin this"; name the guard test.
- `use-operating-guides.ts:87` — same.
- `use-storage-backend.test.tsx:571-575` — replace the recorded `["mount"]` measurement; it is
  refuted, and leaving it invites the next contributor to re-derive the same wrong conclusion.
- `docs/open-followups.md` — §85 retracted with the measurement quoted; §72 and §76 closed, each
  naming its guard test.
- Grep for any other "StrictMode … untestable / vacuous" claim and correct what the sweep finds.

## Verification

**Per-site mutation, one call site at a time.** Delete a single `mountedRef.current = true`, run that
file, require red; restore, require green. A three-site mutation proves only that *some* assertion
fired — the trap this repo has hit before.

The meta-test gets its own check: it must fail if StrictMode is removed from the wrapper.

Gates before push: `npx tsc --noEmit`, `npx eslint --max-warnings=0 src/app`, `npm run test:run`,
`npm run test:shuffle` (new tests → the shuffled gate is the one that catches order coupling). Run
them **serially** — concurrent vitest processes are the machine-saturation condition behind the
load-sensitive flakes. Read every exit code unpiped.

## Out of scope

- **Wrapping the repo's hook helpers in StrictMode by default.** It would surface unrelated failures
  and blow the slice open. `renderBackend` is left as-is; each guard test brings its own wrapper.
- Reconstructing the 2026-08-04 instrument. The current measurement supersedes it.
- §50, §54, §40 — the other slice candidates, untouched.

## Risks

**A guard test that passes for the wrong reason** — e.g. the assertion lands during the first mount
pass, before the cycle completes, so it would pass against the deleted re-set too. The per-site
mutation is the only thing that distinguishes a real pin from a vacuous one, which is why it is a
requirement and not a nicety.

**Prose drift in the corrections themselves.** Four of four correction commits in the last branch
introduced a new false claim. Every factual claim written here gets re-measured at the time it is
written, not pasted from this document.
