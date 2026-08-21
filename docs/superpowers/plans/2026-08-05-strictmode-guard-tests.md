# StrictMode Guard Tests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pin the three shipped `mountedRef.current = true` mount re-sets with behavioural tests, add a standing assertion that StrictMode double-invokes under vitest, and retract the register entry that wrongly declared all of this untestable.

**Architecture:** No production code changes. Four new tests (one meta-test + three guards), each proved by a single-site mutation. Comment and register corrections follow the tests, so every corrected claim is written against a measurement that already exists in the tree.

**Tech Stack:** vitest 4.1.8 · @testing-library/react · React 19.2.4 · jsdom

**Spec:** `docs/superpowers/specs/2026-08-05-strictmode-guard-tests-design.md`

**Branch:** create `test/strictmode-guard-tests` off `main` (`aefddc88`). No version bump — test/docs class.

---

## Background the engineer needs

Three hooks re-set a `mountedRef` inside the effect body, not only in its cleanup:

```ts
const mountedRef = useRef(true);
useEffect(() => {
  mountedRef.current = true;          // ← THIS LINE is what every test below pins
  return () => { mountedRef.current = false; };
}, []);
```

React StrictMode mounts → unmounts → remounts in development. Without the re-set, the flag is
`false` forever after that first cycle, and every `if (mountedRef.current) setX(...)` behind it is
suppressed for the whole dev session.

The three sites and their real dev symptoms:

| File | Line | Symptom without the re-set |
|---|---|---|
| `src/app/use-scheduled-jobs.ts` | 70 | `setJobs` suppressed → `useScheduledJobRunner` sees an empty list → **no scheduled job fires in dev at all** |
| `src/app/use-operating-guides.ts` | 89 | `setGuides`/`setReady` suppressed → `ready` stays false → chat composer disabled whenever "ground in guides" is on |
| `src/app/use-storage-backend.ts` | 185 | `emitOutcome`/`emitToast`/`emitRegistryChange`/`emitStorageConfig` all return early |

**Why this was believed untestable:** a 2026-08-04 measurement recorded StrictMode invoking effects
once (`["mount"]`) under this suite. That measurement is refuted. Re-measured 2026-08-05 with a
module-scope probe:

```
render(<StrictMode><Probe/></StrictMode>)      → ["mount","cleanup","mount"]
renderHook(fn, { wrapper: StrictMode })        → ["mount","cleanup","mount"]
React 19.2.4, development build confirmed (the dev-only missing-`key` warning fires)
```

Task 1 puts that measurement back in the tree permanently.

---

## Gate discipline (applies to every task)

★★★ **Never read a gate's exit code through a pipe** — you get the pipe's status. Redirect, check
unpiped, then grep the file:

```bash
npm run test:run > /tmp/suite.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/suite.log
```

★★ **Run gates serially.** Two concurrent vitest processes is the machine-saturation condition
behind this repo's load-sensitive flakes.

★★ **Mutate one call site at a time.** A mutation touching all three sites proves only that *some*
assertion fired. Each task below mutates exactly one line, confirms red, then restores.

★ `npm run lint` is bare `eslint` with no `--max-warnings` and exits 0 on warnings. The CI gate is
`npx eslint --max-warnings=0 src/app`. An unused import is fatal there.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `src/app/strictmode.meta.test.tsx` | Create | Standing assertion that StrictMode double-invokes here. Tests the harness, not the app. |
| `src/app/use-scheduled-jobs.test.tsx` | Modify (append describe) | §76 guard for the scheduled-jobs re-set |
| `src/app/use-operating-guides.test.tsx` | Modify (append describe) | §76 guard for the operating-guides re-set |
| `src/app/use-storage-backend.test.tsx` | Modify (append describe + fix comment at 571-575) | §72 guard for the storage-backend re-set |
| `src/app/use-scheduled-jobs.ts` | Modify (comment only, 67-68) | drop the false untestability claim |
| `src/app/use-operating-guides.ts` | Modify (comment only, 87) | drop the false untestability claim |
| `docs/open-followups.md` | Modify | §85 retracted · §72 and §76 closed |

---

### Task 1: The standing StrictMode meta-test

**Files:**
- Create: `src/app/strictmode.meta.test.tsx`

This test exists so that a future React / vitest / RTL / config change that silences the double
invoke fails loudly, instead of silently making Tasks 2-4 vacuous while they stay green. That exact
failure mode is what produced §85.

- [ ] **Step 1: Write the test**

Create `src/app/strictmode.meta.test.tsx`:

```tsx
// src/app/strictmode.meta.test.tsx
//
// ★★★ A META-TEST: it asserts a property of the TEST HARNESS, not of the app.
//
// React StrictMode mounts → unmounts → remounts in development. Three hooks in
// this repo re-set a `mountedRef` in their mount-effect BODY specifically to
// survive that cycle (use-scheduled-jobs, use-operating-guides,
// use-storage-backend), and each is pinned by a guard test that renders under
// StrictMode.
//
// Every one of those guards is only meaningful while StrictMode actually
// double-invokes HERE. open-followups §85 records what happens when it stops
// being: a single mis-taken measurement convinced three separate comments that
// the behaviour was unpinnable, and the three shipped guards went untested for
// two releases. If this file goes red, those guard tests have become vacuous —
// fix this before trusting them.
//
// The logs are MODULE-SCOPE on purpose. A log held in per-instance state or in
// a ref created inside the component is handed back fresh by StrictMode's
// remount, so it reads ["mount"] whether or not the double invoke happened —
// which is the leading theory for how the original measurement went wrong.
import { StrictMode, useEffect } from "react";
import { render, renderHook } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import React from "react";

const componentLog: string[] = [];
const hookLog: string[] = [];

function Probe() {
  useEffect(() => {
    componentLog.push("mount");
    return () => {
      componentLog.push("cleanup");
    };
  }, []);
  return <div>probe</div>;
}

function useProbeHook() {
  useEffect(() => {
    hookLog.push("mount");
    return () => {
      hookLog.push("cleanup");
    };
  }, []);
}

describe("StrictMode double-invocation (meta — guards depend on this)", () => {
  it("double-invokes a component's mount effect", () => {
    render(
      <StrictMode>
        <Probe />
      </StrictMode>,
    );
    expect(componentLog).toEqual(["mount", "cleanup", "mount"]);
  });

  it("double-invokes a hook's mount effect via renderHook's wrapper", () => {
    renderHook(() => useProbeHook(), { wrapper: StrictMode });
    expect(hookLog).toEqual(["mount", "cleanup", "mount"]);
  });

  it("resolves the DEVELOPMENT React build", () => {
    // The dev-only missing-`key` warning does not exist in the production
    // build. If this stops firing, React is resolving production here and the
    // double invoke above would be the next thing to disappear.
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <div>
        {[1, 2].map((n) => (
          // eslint-disable-next-line react/jsx-key
          <span>{n}</span>
        ))}
      </div>,
    );
    const messages = spy.mock.calls.map((c) => String(c[0]));
    spy.mockRestore();
    expect(React.version.startsWith("19.")).toBe(true);
    expect(messages.some((m) => m.includes("key"))).toBe(true);
  });
});
```

- [ ] **Step 2: Run it — expect PASS**

```bash
npx vitest run src/app/strictmode.meta.test.tsx --reporter=dot > /tmp/meta.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/meta.log
```

Expected: `EXIT=0`, `Tests  3 passed (3)`.

This is a measurement, not a red-green cycle — the behaviour it asserts already exists. Step 3 is
what proves the test is not vacuous.

- [ ] **Step 3: Mutation — prove it can fail**

In `strictmode.meta.test.tsx`, temporarily change the first test's wrapper to render `<Probe />`
without `<StrictMode>`:

```tsx
    render(<Probe />);
```

Run the same command. Expected: **FAIL** — received `["mount"]`, expected
`["mount","cleanup","mount"]`.

Then restore the `<StrictMode>` wrapper and re-run. Expected: `EXIT=0`.

- [ ] **Step 4: Typecheck and lint**

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app/strictmode.meta.test.tsx; echo "EXIT=$?"
```

Both must be `EXIT=0`.

- [ ] **Step 5: Commit**

```bash
git add src/app/strictmode.meta.test.tsx
git commit -F - <<'EOF'
test: assert StrictMode double-invokes effects under vitest

A standing meta-test. Three hooks carry a mount-effect `mountedRef` re-set
that only matters because StrictMode mounts, unmounts and remounts; their
guard tests are only meaningful while that holds in this suite.

open-followups §85 recorded the opposite as fact from a single mis-taken
measurement whose instrument was then deleted, and three comments repeated
it. This commits the instrument.

The logs are module-scope: a per-instance log is handed back fresh by the
remount and reads ["mount"] either way.
EOF
```

---

### Task 2: Guard the `useOperatingGuides` re-set (§76)

**Files:**
- Test: `src/app/use-operating-guides.test.tsx` (append a new `describe` at end of file)
- Mutation target: `src/app/use-operating-guides.ts:89`

Simplest of the three: a fresh load seeds the built-in guides, so no fixture setup is needed. The
existing suite already renders this hook with `config: null` (localStorage backend, no mocks).

- [ ] **Step 1: Write the failing test**

Append to `src/app/use-operating-guides.test.tsx`:

```tsx
describe("useOperatingGuides — StrictMode mount re-set (§76)", () => {
  beforeEach(() => localStorage.clear());

  it("still applies the loaded guides after StrictMode's remount", async () => {
    // StrictMode mounts → unmounts → remounts. The mount effect's
    // `mountedRef.current = true` is what makes the flag true again by the time
    // `refresh()`'s promise resolves; with only the cleanup, every setGuides /
    // setReady below it is suppressed for good.
    //
    // Delete `mountedRef.current = true` from use-operating-guides.ts and this
    // test fails: `guides` stays [] and `ready` stays false.
    const { result } = renderHook(() => useOperatingGuides({ config: null }), {
      wrapper: StrictMode,
    });

    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.guides.length).toBe(SEED_COUNT);
  });
});
```

Add `StrictMode` to the React import at the top of the file (there is currently no `react` import —
add one):

```tsx
import { StrictMode } from "react";
```

- [ ] **Step 2: Run it — expect PASS**

```bash
npx vitest run src/app/use-operating-guides.test.tsx --reporter=dot > /tmp/guides.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/guides.log
```

Expected: `EXIT=0`, all tests pass.

- [ ] **Step 3: Mutation — delete ONLY this site's re-set**

In `src/app/use-operating-guides.ts`, line 89, delete the single line `mountedRef.current = true;`
so the effect becomes:

```ts
  useEffect(() => {
    return () => { mountedRef.current = false; };
  }, []);
```

Run the same command. Expected: **FAIL** — `waitFor` times out on `result.current.ready` (it stays
`false`). The failure takes ~5s; that is `asyncUtilTimeout`, not a hang.

★ If it PASSES, stop. The test is vacuous — most likely the assertion is landing during the first
mount pass. Do not proceed to Step 4 until the mutation is red.

- [ ] **Step 4: Restore and re-run**

```bash
git checkout src/app/use-operating-guides.ts
npx vitest run src/app/use-operating-guides.test.tsx --reporter=dot > /tmp/guides.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/guides.log
```

Expected: `EXIT=0`.

★ `git checkout <file>` is safe here only because the mutation is the ONLY change to that file in
this task. Once Task 5 edits its comments, never revert a mutation this way again — use an Edit that
restores exactly the deleted line.

- [ ] **Step 5: Commit**

```bash
git add src/app/use-operating-guides.test.tsx
git commit -F - <<'EOF'
test: pin the useOperatingGuides StrictMode mount re-set (§76)

Renders under StrictMode and asserts the loaded guides and `ready` land
after the remount. Proved by deleting that one `mountedRef.current = true`
line: `ready` never becomes true.
EOF
```

---

### Task 3: Guard the `useScheduledJobs` re-set (§76)

**Files:**
- Test: `src/app/use-scheduled-jobs.test.tsx` (append a new `describe` at end of file)
- Mutation target: `src/app/use-scheduled-jobs.ts:70`

This hook loads an empty list on a fresh store, so the test seeds one job through the public API
first (the pattern the existing "preserves a built-in's disabled toggle across reloads" test uses in
the guides suite). Asserting on a populated list — not just `ready` — is what makes this test mirror
the real dev symptom: `setJobs` suppressed means `useScheduledJobRunner` never fires a job.

- [ ] **Step 1: Write the failing test**

Append to `src/app/use-scheduled-jobs.test.tsx`:

```tsx
describe("useScheduledJobs — StrictMode mount re-set (§76)", () => {
  beforeEach(() => localStorage.clear());

  it("still applies the loaded jobs after StrictMode's remount", async () => {
    // Seed one job through the public API so the second render has something
    // to load. localStorage persists between the two renderHook calls.
    const seed = renderHook(() => useScheduledJobs({ config: null }));
    await waitFor(() => expect(seed.result.current.ready).toBe(true));
    await act(async () => {
      await seed.result.current.createJob({
        name: "Daily", cadence: dailyCadence, enabled: true,
      });
    });
    seed.unmount();

    // StrictMode mounts → unmounts → remounts. `refresh()`'s promise resolves
    // AFTER that cycle, so `mountedRef.current = true` in the mount effect body
    // is what lets setJobs/setReady land at all.
    //
    // Delete that line from use-scheduled-jobs.ts and this fails: `jobs` stays
    // [] — which in dev means useScheduledJobRunner sees an empty list and no
    // scheduled job ever fires.
    const { result } = renderHook(() => useScheduledJobs({ config: null }), {
      wrapper: StrictMode,
    });

    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.jobs).toHaveLength(1);
    expect(result.current.jobs[0].name).toBe("Daily");
  });
});
```

Add `StrictMode` to the imports at the top of the file:

```tsx
import { StrictMode } from "react";
```

- [ ] **Step 2: Run it — expect PASS**

```bash
npx vitest run src/app/use-scheduled-jobs.test.tsx --reporter=dot > /tmp/jobs.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/jobs.log
```

Expected: `EXIT=0`.

- [ ] **Step 3: Mutation — delete ONLY this site's re-set**

In `src/app/use-scheduled-jobs.ts`, line 70, delete the single line `mountedRef.current = true;`:

```ts
  useEffect(() => {
    return () => { mountedRef.current = false; };
  }, []);
```

Run the same command. Expected: **FAIL** — `waitFor` times out on `ready`, and `jobs` is `[]`.

★ If it passes, stop and diagnose before continuing.

- [ ] **Step 4: Restore and re-run**

```bash
git checkout src/app/use-scheduled-jobs.ts
npx vitest run src/app/use-scheduled-jobs.test.tsx --reporter=dot > /tmp/jobs.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/jobs.log
```

Expected: `EXIT=0`.

- [ ] **Step 5: Commit**

```bash
git add src/app/use-scheduled-jobs.test.tsx
git commit -F - <<'EOF'
test: pin the useScheduledJobs StrictMode mount re-set (§76)

Seeds a job, then renders under StrictMode and asserts the loaded list
lands after the remount. Asserting on the populated list rather than only
`ready` mirrors the real dev symptom: suppressed setJobs means
useScheduledJobRunner sees an empty list and nothing ever fires.

Proved by deleting that one `mountedRef.current = true` line.
EOF
```

---

### Task 4: Guard the `useStorageBackend` re-set (§72)

**Files:**
- Test: `src/app/use-storage-backend.test.tsx` (append a new `describe` at end of file)
- Mutation target: `src/app/use-storage-backend.ts:185`

This file's harness is heavier: `renderBackend` wraps `TestProviders`, and the save path runs on a
500ms debounce under fake timers. The guard test composes StrictMode *around* `TestProviders` with
its own wrapper rather than changing `renderBackend`, so no existing test is affected.

The observable is `onStorageOutcome`: `emitOutcome` returns early when the flag is false.

- [ ] **Step 1: Write the failing test**

Append to `src/app/use-storage-backend.test.tsx`:

```tsx
describe("useStorageBackend — StrictMode mount re-set (§72)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    (storageMod.createBackend as ReturnType<typeof vi.fn>).mockReturnValue(mockBackend);
    mockBackend.load.mockResolvedValue({ tasks: [], raid: [], absences: [], shifts: [] });
    mockBackend.isReady.mockResolvedValue(true);
    mockBackend.describe.mockResolvedValue(null);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("still emits a save outcome after StrictMode's remount", async () => {
    // StrictMode mounts → unmounts → remounts. Without
    // `mountedRef.current = true` in the mount effect BODY, the flag is false
    // for the rest of the session and emitOutcome / emitToast /
    // emitRegistryChange / emitStorageConfig all return early — the §72 guard's
    // dev-only total-suppression failure mode.
    //
    // Delete that line from use-storage-backend.ts and this fails:
    // onStorageOutcome is never called.
    const onStorageOutcome = vi.fn();
    const { result } = renderHook(makeProbe(makeArgs({ onStorageOutcome })), {
      wrapper: ({ children }) => (
        <StrictMode>
          <TestProviders>{children}</TestProviders>
        </StrictMode>
      ),
    });

    // Let the load settle, then burn the first debounce cycle (the load sets
    // suppressNextSaveRef, which that cycle clears).
    await act(async () => { await Promise.resolve(); });
    await act(async () => { vi.advanceTimersByTime(600); });
    await act(async () => { await Promise.resolve(); });
    onStorageOutcome.mockClear();

    await act(async () => {
      result.current.setTasks([{ id: 1, taskName: "T1" } as unknown as Task]);
    });
    await act(async () => { vi.advanceTimersByTime(600); });
    await act(async () => { await Promise.resolve(); });

    expect(onStorageOutcome).toHaveBeenCalledWith(null);
  });
});
```

Add `StrictMode` to the imports at the top of the file:

```tsx
import { StrictMode } from "react";
```

- [ ] **Step 2: Run it — expect PASS**

```bash
npx vitest run src/app/use-storage-backend.test.tsx --reporter=dot > /tmp/backend.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/backend.log
```

Expected: `EXIT=0`.

★ If the new test fails on `onStorageOutcome` never being called *before* any mutation, the debounce
bookkeeping differs under the doubled mount — add one more
`await act(async () => { vi.advanceTimersByTime(600); });` cycle before `mockClear()`, matching the
existing "calls backend.save after workspace changes" test at `use-storage-backend.test.tsx:261`.
Do NOT weaken the assertion to `toHaveBeenCalled()` — the `null` argument is what says the save
succeeded rather than reported an error.

- [ ] **Step 3: Mutation — delete ONLY this site's re-set**

In `src/app/use-storage-backend.ts`, line 185, delete the single line `mountedRef.current = true;`
(leave the surrounding comment). Run the same command.

Expected: **FAIL** — `onStorageOutcome` was not called with `null`.

★ Note what this does NOT cover: the `refreshBackendStatus` guards documented at
`use-storage-backend.test.tsx:540-549` remain unpinned, and this test does not change that. Do not
let the register claim otherwise in Task 6.

- [ ] **Step 4: Restore and re-run**

```bash
git checkout src/app/use-storage-backend.ts
npx vitest run src/app/use-storage-backend.test.tsx --reporter=dot > /tmp/backend.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/backend.log
```

Expected: `EXIT=0`.

- [ ] **Step 5: Commit**

```bash
git add src/app/use-storage-backend.test.tsx
git commit -F - <<'EOF'
test: pin the useStorageBackend StrictMode mount re-set (§72)

Composes StrictMode around TestProviders in the test's own wrapper, so
renderBackend and every existing test are untouched. Asserts a save
outcome still reaches onStorageOutcome after the remount.

Proved by deleting that one `mountedRef.current = true` line. Does NOT
cover the refreshBackendStatus guards, which stay unpinned.
EOF
```

---

### Task 5: Correct the three false untestability comments

**Files:**
- Modify: `src/app/use-scheduled-jobs.ts:67-68`
- Modify: `src/app/use-operating-guides.ts:87`
- Modify: `src/app/use-storage-backend.test.tsx:571-575`

Each comment states as fact something Tasks 1-4 disproved. Leaving them invites the next contributor
to re-derive the same wrong conclusion — which is how §85 came to exist.

- [ ] **Step 1: `use-scheduled-jobs.ts`**

Replace these two lines (currently 67-68):

```ts
  //    ★ No test can pin this: StrictMode invokes effects ONCE under this suite
  //    (measured — see §76), so a StrictMode-wrapped test would be vacuous.
```

with:

```ts
  //    ★ Pinned by "still applies the loaded jobs after StrictMode's remount"
  //    in use-scheduled-jobs.test.tsx. An earlier comment here claimed no test
  //    could pin it because StrictMode invoked effects ONCE under this suite;
  //    that measurement was wrong — see strictmode.meta.test.tsx, which asserts
  //    the double invoke so these guards cannot go vacuous unnoticed.
```

- [ ] **Step 2: `use-operating-guides.ts`**

Replace this line (currently 87):

```ts
  //    Untestable here (StrictMode single-invokes effects in this suite) — §76.
```

with:

```ts
  //    Pinned by "still applies the loaded guides after StrictMode's remount"
  //    in use-operating-guides.test.tsx. This line previously read "Untestable
  //    here (StrictMode single-invokes effects in this suite)" — that was a
  //    mis-taken measurement; see strictmode.meta.test.tsx.
```

- [ ] **Step 3: `use-storage-backend.test.tsx`**

Replace the comment block at 571-575:

```tsx
  // ★★★ `mountedRef.current = true` in the effect BODY (not just the cleanup) is
  //     load-bearing in dev and CANNOT be pinned here. A StrictMode-wrapped
  //     renderHook was tried and is VACUOUS: measured 2026-08-04, StrictMode in
  //     this suite invokes the effect ONCE (["mount"], no cleanup+remount), so
  //     deleting the re-set keeps all 63 tests green. See open-followups.md §72.
```

with:

```tsx
  // ★★ `mountedRef.current = true` in the effect BODY (not just the cleanup) is
  //    load-bearing in dev, and it IS pinned — see the "StrictMode mount re-set
  //    (§72)" describe at the end of this file.
  //    ★★★ This comment previously said the opposite, citing a 2026-08-04
  //    measurement of ["mount"] (no cleanup+remount) under a StrictMode-wrapped
  //    renderHook. That measurement is refuted: re-taken 2026-08-05 with a
  //    module-scope log, both render() and renderHook({wrapper: StrictMode})
  //    give ["mount","cleanup","mount"]. The instrument now lives in
  //    strictmode.meta.test.tsx instead of in prose. See open-followups §85.
```

- [ ] **Step 4: Sweep for any other instance of the claim**

```bash
grep -rn "StrictMode" src/app --include="*.ts" --include="*.tsx" | grep -iE "vacuous|untestable|cannot be pinned|single-invoke|invokes effects ONCE"; echo "EXIT=$?"
```

Expected: no output (`EXIT=1` from grep finding nothing — that is the pass condition here). Correct
anything it finds the same way.

- [ ] **Step 5: Verify the files still pass**

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx vitest run src/app/use-scheduled-jobs.test.tsx src/app/use-operating-guides.test.tsx src/app/use-storage-backend.test.tsx --reporter=dot > /tmp/three.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/three.log
```

Both `EXIT=0`.

- [ ] **Step 6: Commit**

```bash
git add src/app/use-scheduled-jobs.ts src/app/use-operating-guides.ts src/app/use-storage-backend.test.tsx
git commit -F - <<'EOF'
docs: retract the "StrictMode is untestable here" comments

Three comments stated as fact that a StrictMode-wrapped test would be
vacuous, all resting on one 2026-08-04 measurement of ["mount"]. Re-taken
with a module-scope log, both render() and renderHook({wrapper: StrictMode})
give ["mount","cleanup","mount"].

Each now names the guard test that pins its line.
EOF
```

---

### Task 6: Update the register — retract §85, close §72 and §76

**Files:**
- Modify: `docs/open-followups.md` — §72 (line ~3132), §76 (line ~3718), §85 (line ~4069), plus the
  provenance section at the end

★★ Write every factual claim in this task against the tree as it now stands. Four of four correction
commits in the previous branch introduced a NEW false claim. Do not paste numbers or line references
from this plan — re-check them.

- [ ] **Step 1: Retract §85**

Replace the whole §85 body with a retraction. It must state:
- The premise is FALSE. StrictMode double-invokes under vitest — quote the measured
  `["mount","cleanup","mount"]` for both shapes, React 19.2.4, dev build confirmed.
- It was NOT the per-instance-log artefact hypothesis either; a per-instance probe also observed the
  full cycle. The original `["mount"]` came from something specific to that day's edit of
  `renderBackend` (which wraps `TestProviders`, not `StrictMode`) and was not reconstructed.
- The instrument now lives in `src/app/strictmode.meta.test.tsx` rather than in prose.
- Mark the heading `~~...~~ — CLOSED, FALSE PREMISE`, matching how §84 was retracted.

- [ ] **Step 2: Close §76**

Mark the heading struck-through and CLOSED. Name both guard tests by their `it` titles and files. Do
not claim more than they cover: they pin the mount re-set in `use-scheduled-jobs.ts` and
`use-operating-guides.ts`, nothing else.

- [ ] **Step 3: Close §72's remaining half — carefully**

★★★ §72's entry is already marked CLOSED for the unhandled-rejection fix. What Task 4 adds is a pin
on the mount re-set only. The `refreshBackendStatus` guards described at
`use-storage-backend.test.tsx:540-549` are **still unpinned** — deleting those three
`if (!mountedRef.current) return;` lines still leaves the suite green. Say exactly that. Do not write
"§72 is now fully guarded".

- [ ] **Step 4: Update the index rows and the provenance section**

Every entry must have exactly one index row and one section. Check §72, §76 and §85 each appear once
in each place:

```bash
grep -cn "^## 85\." docs/open-followups.md; grep -cn "^## 76\." docs/open-followups.md; grep -cn "^## 72\." docs/open-followups.md
```

Each must print `1`.

- [ ] **Step 5: Commit**

```bash
git add docs/open-followups.md
git commit -F - <<'EOF'
docs: retract §85, close §76, pin §72's mount re-set

§85's premise is refuted by measurement: StrictMode double-invokes under
vitest for both render() and renderHook({wrapper: StrictMode}).

§76's two mount re-sets are now pinned. §72's mount re-set is pinned; its
refreshBackendStatus guards remain unpinned and the entry says so.
EOF
```

---

### Task 7: Full gate run

**Files:** none — verification only.

- [ ] **Step 1: Typecheck**

```bash
npx tsc --noEmit; echo "EXIT=$?"
```

Expected `EXIT=0`. ★ IDE squiggles after a multi-file edit are mid-edit snapshots and routinely show
phantom errors; trust tsc.

- [ ] **Step 2: Lint at the CI gate's strictness**

```bash
npx eslint --max-warnings=0 src/app; echo "EXIT=$?"
```

Expected `EXIT=0`. No pipe — a `| grep` here reports grep's status, not eslint's.

- [ ] **Step 3: Full unit suite**

```bash
npm run test:run > /tmp/suite.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests |Errors" /tmp/suite.log
```

Expected `EXIT=0`. ★ Also grep for `Errors  N error` — this suite can exit 1 with every test passing
when an async callback setStates after jsdom teardown.

- [ ] **Step 4: Shuffled suite — the gate this task most needs**

```bash
npm run test:shuffle > /tmp/shuffle.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/shuffle.log
```

Expected `EXIT=0`. This is the only local reproduction of CI's blocking `unit-tests-shuffled` job,
and this branch adds four tests — including two that write localStorage in a seeding step, exactly
the shape that causes intra-file order dependence.

★ Run Steps 3 and 4 **one after the other**, never concurrently.

- [ ] **Step 5: Coverage floors**

```bash
npm run test:coverage > /tmp/cov.log 2>&1; echo "EXIT=$?"; grep -E "ERROR|threshold" /tmp/cov.log
```

Expected `EXIT=0`. No new non-test `.ts` file is added by this branch, so the floors should be
unaffected — confirm rather than assume.

- [ ] **Step 6: Report**

Summarise: every gate's exit code, the three mutation results (which line was deleted, which test
went red), and what remains unpinned (`refreshBackendStatus`). Do not report green without the exit
codes behind it.

---

## What this branch deliberately does NOT do

- **Wrap the repo's hook helpers in StrictMode by default.** It would surface unrelated failures
  across the suite and blow the slice open. `renderBackend` is untouched; each guard brings its own
  wrapper.
- **Reconstruct the 2026-08-04 instrument.** The current measurement supersedes it.
- **Pin `refreshBackendStatus`'s three guards.** Still open, still deletable with every gate green.
- **Touch §50, §54 or §40** — the other slice candidates.
- **Bump the version.** Test/docs class, same as MR !348.
