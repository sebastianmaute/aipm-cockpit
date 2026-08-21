# Machine Unblocking Slice 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the `unit-tests` CI job exiting 1 with every test passing, by guarding the caller-callback teardown race in `use-storage-backend.ts`; then run a bounded, evidence-first hunt on the two remaining flakes (§39, §51) and leave the register honest.

**Architecture:** One mounted ref plus four one-line emitter helpers in `use-storage-backend.ts` become the single choke point for every callback the hook fires back into the component. All 35 direct `args.*` callback invocations route through them. The flake hunt is investigative, ordered reachability → bounded amplification → instrumentation, with a hard attempt budget so it cannot consume the slice.

**Tech Stack:** TypeScript, React 19, Next.js 16, Vitest 4.1.8 + @testing-library/react (jsdom), ESLint flat config, GitLab CI.

**Spec:** `docs/superpowers/specs/2026-08-04-machine-unblocking-slice-2-design.md` (gitignored, local-only).

---

## Orientation for someone who has never seen this repo

Read this before Task 1. It is short and every line of it bites.

**The bug in one paragraph.** `src/app/use-storage-backend.ts` is a React hook that owns loading and saving the workspace. It reports results by calling functions its caller passed in — `onStorageOutcome`, `showToast`, `onRegistryChange`, `setStorageConfig` — and those functions call `setState` in `src/app/task-manager.tsx`. Some of those calls happen after an `await`, from a promise nobody waits for. If the component unmounted in the meantime, React 19 tries to schedule an update, reads `window`, and in a torn-down jsdom test environment `window` no longer exists. The unhandled rejection makes Vitest exit non-zero **even though every test passed**.

**What a green-but-failed CI job looks like.** Do not grep the trace for `FAIL` or `✗` — there is nothing to find, and people conclude the runner broke:

```
Test Files  778 passed (778)
     Tests  8792 passed (8792)
     Errors  1 error
ERROR: Job failed: exit code 1
```

Search for `Errors  N error` or `Unhandled Errors`.

**Repo rules that will fail your build if you ignore them:**

- ★★★ **Never read a gate's exit code through a pipe.** `npm run test:run | tail -8` exits 0 while tests fail — that is `tail`'s status. Redirect to a file, echo `$?` unpiped, then grep the file. Every command in this plan is already written that way; do not "tidy" them into pipes.
- CI runs `eslint --max-warnings=0`. An unused import or variable is **fatal**. Plain `npm run lint` does *not* reproduce the gate (no `--max-warnings` flag) — use `npx eslint --max-warnings=0 src/app`.
- `npx tsc --noEmit` is a separate gate. `next build` does not typecheck test files and Vitest never typechecks, so a test-only type error passes both and fails CI.
- The IDE's inline diagnostics are mid-edit snapshots and routinely show phantom errors after a multi-file edit. Trust `tsc`, not the squiggles.
- Do not run `npm run stop` — it is port-scoped to 3000 and the user may have a server running there. Nothing in this plan needs a dev server.
- The Edit tool has been observed turning a space into a NUL byte in this repo. After the mechanical sweep in Task 3 there is an explicit byte-check step. Do not skip it.

**Files you will touch:**

| Path | Responsibility | Action |
|---|---|---|
| `src/app/use-storage-backend.ts` | Storage backend hook — load/save effects, project ops, caller callbacks | Modify: add mounted ref + 4 emitters, route 35 call sites, fix 1 misleading comment |
| `src/app/use-storage-backend.test.tsx` | Its unit suite (1573 lines, existing harness) | Modify: add 2 tests to the "save effect" describe |
| `src/app/timelog-panel.test.tsx` | Holds the §39 flaky test at line 278 | Modify: split assertion, replace a now-disproved comment, add failure capture |
| `src/app/use-tasks-dedup.test.tsx` | Holds the §51 flaky test at line 101 | Modify: add failure capture |
| `docs/open-followups.md` | The cross-release register (tracked, the only durable output) | Modify: open §72, add 5 index rows, update §39/§51 |

**Files you must NOT touch:** `vitest.config.ts` (no `retry`, no timeout changes), `vitest.setup.ts` (no `asyncUtilTimeout` change), any `.tsx` component (nothing rendered changes, so no e2e run is owed — the moment you touch a component that stops being true).

---

## Task 1: Branch, and prove the teardown race with a failing test

**Files:**
- Test: `src/app/use-storage-backend.test.tsx` (add to the existing `describe("useStorageBackend — save effect")`, which begins at line 236)

Context you need for the test code below, all already present in that file:

- `mockBackend` (line 98) — the fake backend, with `save` / `load` / `isReady` / `describe` as `vi.fn()`s.
- `showToast` (line 106) — a shared `vi.fn()`.
- `makeArgs(overrides)` (line 110) — builds the hook args. `onStorageOutcome` is **not** in the defaults, so pass it as an override.
- `renderBackend(args)` (line 133) — `renderHook` wrapped in `TestProviders`; returns `{ result, unmount, ... }`.
- The describe's `beforeEach` already calls `vi.useFakeTimers()` and stubs `load`/`isReady`/`describe`.
- The save is debounced 500 ms, so tests advance by 600 ms.
- The initial load calls the outcome callback once with `null` — every test must clear the spy after setup.

- [ ] **Step 1: Create the branch**

```bash
git checkout -b fix/machine-unblocking-slice-2
git status --porcelain; echo "EXIT=$?"
```

Expected: no output from `git status --porcelain` (clean tree), `EXIT=0`.

- [ ] **Step 2: Write the failing regression test**

Add this as the **last** `it(...)` inside `describe("useStorageBackend — save effect")` in `src/app/use-storage-backend.test.tsx`:

```tsx
  // ── §72: the teardown race ──────────────────────────────────────────────────
  // The save effect fires `doSave()` fire-and-forget. Its .then/.catch call back
  // into the component. If the component unmounted while the save was in flight,
  // that callback runs `setState` on a dead tree — in CI's torn-down jsdom that
  // surfaces as `ReferenceError: window is not defined` from React's
  // resolveUpdatePriority, and Vitest exits 1 with every test passing.
  //
  // ★ This test pins the GUARD (no callback after unmount), not the crash. The
  //   crash needs environment teardown, which a unit test cannot stage — see
  //   docs/open-followups.md §72.
  it("does not report a save outcome after unmount (§72 teardown race)", async () => {
    const onStorageOutcome = vi.fn();
    let resolveSave!: () => void;
    const deferred = new Promise<void>((resolve) => { resolveSave = resolve; });

    const { result, unmount } = renderBackend(makeArgs({ onStorageOutcome }));

    // Burn the load + the suppressed first debounce cycle.
    await act(async () => { await Promise.resolve(); });
    await act(async () => { vi.advanceTimersByTime(600); });
    await act(async () => { await Promise.resolve(); });
    mockBackend.save.mockClear();
    onStorageOutcome.mockClear();

    // Next save hangs until we resolve it by hand.
    mockBackend.save.mockReturnValueOnce(deferred);
    await act(async () => {
      result.current.setTasks([{ id: 1, taskName: "T1" } as unknown as Task]);
    });
    await act(async () => { vi.advanceTimersByTime(600); });
    expect(mockBackend.save).toHaveBeenCalledTimes(1);

    // Component goes away while the save is still in flight.
    unmount();

    // Now the save lands. Nothing may call back into the dead tree.
    await act(async () => { resolveSave(); await Promise.resolve(); });

    expect(onStorageOutcome).not.toHaveBeenCalled();
  });
```

- [ ] **Step 3: Run it and verify it FAILS**

```bash
npx vitest run src/app/use-storage-backend.test.tsx -t "does not report a save outcome after unmount" --reporter=dot > /tmp/s2-red.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests |AssertionError|expected" /tmp/s2-red.log
```

Expected: `EXIT=1`, and an assertion failure of the shape *"expected \"spy\" to not be called at all, but actually been called 1 times"*. That single call is `emitOutcome`'s unguarded ancestor `args.onStorageOutcome?.(null)` firing after unmount — the bug, reproduced.

★ `--reporter=basic` does not exist in Vitest 4.1.8 and errors at startup, which reads like a broken run. Use `--reporter=dot`.

If it PASSES instead, stop and re-read: the deferred promise is probably not reaching `backend.save`, so the save never was in flight. Confirm `expect(mockBackend.save).toHaveBeenCalledTimes(1)` held.

- [ ] **Step 4: Commit the red test**

```bash
git add src/app/use-storage-backend.test.tsx
git commit -F - <<'EOF'
test: pin the storage-hook teardown race (red)

A save in flight at unmount calls onStorageOutcome on a dead tree. In CI's
torn-down jsdom that is `ReferenceError: window is not defined` out of React's
resolveUpdatePriority, and vitest exits 1 with every test passing.

Fails on purpose; the guard follows.

Claude-Session: https://[session link removed]
EOF
```

★ Use the Bash tool with this heredoc form. PowerShell `@'…'@` here-strings have corrupted commit messages in this repo.

---

## Task 2: The guard — mounted ref and four emitters

**Files:**
- Modify: `src/app/use-storage-backend.ts` (ref block ends at line 148 with `allowDestructiveRef`)

- [ ] **Step 1: Add the mounted ref and the four emitters**

Insert immediately after the `allowDestructiveRef` declaration (line 148) and before the load effect:

```ts
  // ── §72: caller-callback teardown guard ─────────────────────────────────────
  // Every callback this hook fires back into the component runs `setState` up
  // there. Several of them run after an `await`, from promises nobody waits for
  // (the debounced save is fire-and-forget by design). If the component has
  // unmounted by then, React 19 schedules an update, `resolveUpdatePriority`
  // reads `window`, and in a torn-down jsdom that throws — an unhandled
  // rejection that makes vitest exit 1 with the whole suite green
  // (docs/open-followups.md §72).
  //
  // ★★★ This is a MOUNTED ref, NOT the load effect's per-run `cancelled` flag,
  //     and the two are easy to confuse. The save effect's deps include the whole
  //     workspace, so it re-runs on every edit. A per-run flag would suppress the
  //     outcome of a save that was merely SUPERSEDED while still in flight, which
  //     silently swallows real save errors in production. The load effect keeps
  //     its `cancelled` — a superseded load genuinely is irrelevant, a superseded
  //     save is not. Pinned by the two §72 tests in use-storage-backend.test.tsx.
  const mountedRef = useRef(true);
  useEffect(() => {
    // Re-set on mount, not just cleared on unmount: React StrictMode mounts,
    // unmounts and remounts in development, and a cleanup-only guard would
    // leave every callback permanently suppressed after that first cycle.
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  function emitOutcome(err: unknown | null): void {
    if (!mountedRef.current) return;
    args.onStorageOutcome?.(err);
  }
  function emitToast(kind: "info" | "error" | "success", text: string): void {
    if (!mountedRef.current) return;
    args.showToast(kind, text);
  }
  function emitRegistryChange(registry: ProjectsRegistry): void {
    if (!mountedRef.current) return;
    args.onRegistryChange?.(registry);
  }
  function emitStorageConfig(config: StorageConfig): void {
    if (!mountedRef.current) return;
    args.setStorageConfig(config);
  }
```

Notes for the implementer:

- `emitToast`'s `kind` parameter mirrors the inline union at `use-storage-backend.ts:55`. A `ToastKind` alias exists at `use-toast.ts:9` but is **not** imported into this file — do not reference it without adding the import.
- `ProjectsRegistry` and `StorageConfig` are already imported (lines 22 and 8 respectively). `useRef` and `useEffect` are already imported (line 2). **Add no imports.** An unused one is a fatal lint error.
- These are `function` declarations, matching the file's existing `commitRegistry` / `backendFor` / `reportProjectError` style, and they hoist — so call sites earlier in the body are fine.

- [ ] **Step 2: Route the 8 outcome call sites**

In `src/app/use-storage-backend.ts`, replace **all** occurrences of `args.onStorageOutcome?.(` with `emitOutcome(`. There are 8, at approximately lines 230, 237, 240, 312, 314, 641, 650, 657 — re-grep rather than trusting those numbers, they move.

Verify:

```bash
grep -c 'args.onStorageOutcome?.(' src/app/use-storage-backend.ts; echo "EXIT=$?"
grep -c 'emitOutcome(' src/app/use-storage-backend.ts
```

Expected: first count **0** (grep exits 1 when a count is 0 — that is correct here, not an error); second count **9** (8 call sites + 1 declaration).

- [ ] **Step 3: Route the 23 toast call sites**

Replace all occurrences of `args.showToast(` with `emitToast(`.

★ The two **pass-throughs** into the sub-hooks are spelled `showToast: args.showToast,` with no `(`, so this replacement does not touch them. They are handled in the next step.

Verify:

```bash
grep -c 'args.showToast(' src/app/use-storage-backend.ts
grep -c 'emitToast(' src/app/use-storage-backend.ts
```

Expected: **0**, then **24** (23 call sites + 1 declaration).

- [ ] **Step 4: Route the two sub-hook pass-throughs, the registry callback and the config setter**

Four single-line edits.

`useTursoProjectOps` (~line 584) and `useFileProjectOps` (~line 606) each receive `showToast: args.showToast,`. Change both to:

```ts
    showToast: emitToast,
```

★ This extends the guard into both sub-hooks for free — they hold the same callback and have the same exposure. Zero new call sites.

`useFileProjectOps` also receives `setStorageConfig: args.setStorageConfig,` (~line 606). Change to:

```ts
    setStorageConfig: emitStorageConfig,
```

In `commitRegistry` (~line 524), change `args.onRegistryChange?.(next);` to:

```ts
    emitRegistryChange(next);
```

And in the convert flow (~line 481), change `args.setStorageConfig(newConfig);` to:

```ts
      emitStorageConfig(newConfig);
```

Verify the whole callback surface is now routed:

```bash
grep -n 'args\.showToast\|args\.onStorageOutcome\|args\.onRegistryChange\|args\.setStorageConfig' src/app/use-storage-backend.ts
```

Expected: exactly **two** lines remain — the interface declarations inside `UseStorageBackendArgs` (around lines 55 and 57–58) and any comment mentioning them. No executable `args.` callback invocation may remain. If line 451's comment ("*to args.setStorageConfig and args.showToast, which are also read from the…*") still names them, that is fine — it is prose about the args object, still accurate.

★ **Deliberately NOT routed:** `args.setActivityLog` (line 380) is handed to `useBroadcastSync`, which owns its own listener lifecycle and cleanup. Guarding it needs a different design. Record it in §72 as surveyed-and-left, fix nothing.

- [ ] **Step 5: Run the red test and verify it now PASSES**

```bash
npx vitest run src/app/use-storage-backend.test.tsx -t "does not report a save outcome after unmount" --reporter=dot > /tmp/s2-green.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " /tmp/s2-green.log
```

Expected: `EXIT=0`, `Tests  1 passed`.

- [ ] **Step 6: Run the whole hook suite — nothing else may break**

```bash
npx vitest run src/app/use-storage-backend.test.tsx --reporter=dot > /tmp/s2-hook.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests |Errors" /tmp/s2-hook.log
```

Expected: `EXIT=0`, all tests passed, no `Errors` line.

If a *toast* assertion broke, the likely cause is a call site routed to `emitToast` that fires during a phase where `mountedRef` is false — investigate rather than reverting the routing.

- [ ] **Step 7: Commit**

```bash
git add src/app/use-storage-backend.ts
git commit -F - <<'EOF'
fix: guard every caller callback in use-storage-backend against unmount

The debounced save is fire-and-forget by design, so its .then/.catch could call
onStorageOutcome (and showToast) after the component unmounted. React 19 then
schedules an update, resolveUpdatePriority reads `window`, and in a torn-down
jsdom that is an unhandled rejection -> vitest exits 1 with every test passing.

A mounted ref plus four emitters (emitOutcome / emitToast / emitRegistryChange /
emitStorageConfig) become the single choke point; all 35 direct callback
invocations route through them, including the two sub-hook pass-throughs, which
extends the guard into use-storage-turso-ops and use-storage-file-ops for free.

It must be a MOUNTED ref, not the load effect's per-run `cancelled` flag: the
save effect re-runs on every workspace edit, so a per-run flag would swallow the
outcome of a merely superseded in-flight save. The load effect keeps `cancelled`.

Near-zero user impact -- task-manager is the root orchestrator and effectively
never unmounts in production. The value is a CI job that stops exiting 1 with
8792/8792 green.

Claude-Session: https://[session link removed]
EOF
```

---

## Task 3: The trap test — prove the guard is mounted-scoped, not per-run

The whole point of Task 2's `★★★` comment is that a future contributor may "simplify" the mounted ref into the load effect's `cancelled` pattern. That refactor is silent data-suppression in production. This task builds the test that catches it.

★ This test **passes both before and after Task 2** — it is a mutation guard, not a red-green cycle. That is why Step 2 proves it non-vacuous against the wrong implementation instead of against the unfixed one.

**Files:**
- Test: `src/app/use-storage-backend.test.tsx`
- Temporarily modify then revert: `src/app/use-storage-backend.ts`

- [ ] **Step 1: Write the trap test**

Add directly beneath the §72 test from Task 1:

```tsx
  // ★★★ The guard above must be MOUNTED-scoped. If someone re-implements it with
  //     the load effect's per-run `cancelled` flag, THIS test fails: the save
  //     effect re-runs on every workspace edit, so an in-flight save whose effect
  //     run was superseded would stop reporting — and a genuine save FAILURE
  //     would be swallowed in production with no banner and no toast.
  it("still reports the outcome of a save superseded while in flight (§72: mounted-scoped, not per-run)", async () => {
    const onStorageOutcome = vi.fn();
    let resolveSave!: () => void;
    const deferred = new Promise<void>((resolve) => { resolveSave = resolve; });

    const { result } = renderBackend(makeArgs({ onStorageOutcome }));

    await act(async () => { await Promise.resolve(); });
    await act(async () => { vi.advanceTimersByTime(600); });
    await act(async () => { await Promise.resolve(); });
    mockBackend.save.mockClear();
    onStorageOutcome.mockClear();

    mockBackend.save.mockReturnValueOnce(deferred);
    await act(async () => {
      result.current.setTasks([{ id: 1, taskName: "T1" } as unknown as Task]);
    });
    await act(async () => { vi.advanceTimersByTime(600); });
    expect(mockBackend.save).toHaveBeenCalledTimes(1);

    // A second edit supersedes the effect run that started the in-flight save.
    // The component is still mounted, so its outcome must still be reported.
    await act(async () => {
      result.current.setTasks([{ id: 1, taskName: "T1 edited" } as unknown as Task]);
    });

    await act(async () => { resolveSave(); await Promise.resolve(); });

    expect(onStorageOutcome).toHaveBeenCalledWith(null);
  });
```

- [ ] **Step 2: Verify it passes with the correct implementation**

```bash
npx vitest run src/app/use-storage-backend.test.tsx -t "superseded while in flight" --reporter=dot > /tmp/s2-trap.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " /tmp/s2-trap.log
```

Expected: `EXIT=0`, `Tests  1 passed`.

- [ ] **Step 3: Prove it is non-vacuous — temporarily implement the WRONG guard**

In `src/app/use-storage-backend.ts`, temporarily replace the body of `emitOutcome` with a per-run-style suppression to simulate the bad refactor:

```ts
  function emitOutcome(err: unknown | null): void {
    if (!mountedRef.current || suppressNextSaveRef.current) return; // TEMPORARY — WRONG ON PURPOSE
    args.onStorageOutcome?.(err);
  }
```

That is not a literal per-run flag, so also run the more faithful simulation: keep `emitOutcome` correct and instead make the **save effect's cleanup** clear a local flag the handlers check. Either shape must break the trap test. Run:

```bash
npx vitest run src/app/use-storage-backend.test.tsx -t "superseded while in flight" --reporter=dot > /tmp/s2-mutant.log 2>&1; echo "EXIT=$?"
grep -E "Tests |AssertionError" /tmp/s2-mutant.log
```

Expected: `EXIT=1` — the trap fires.

★★ If it still passes, the test is vacuous and must be strengthened before continuing. Do not proceed with a green mutant.

- [ ] **Step 4: Revert the mutation by hand**

```bash
git diff src/app/use-storage-backend.ts
```

Edit the file back to the Task 2 state. ★★★ **Do NOT use `git checkout src/app/use-storage-backend.ts`** — Task 2's changes are committed, so a checkout would work here, but this repo has a recorded incident of reverting a mutation check with `git checkout` and losing uncommitted work. Revert by editing, then confirm:

```bash
git diff --stat src/app/use-storage-backend.ts; echo "EXIT=$?"
```

Expected: no diff output.

- [ ] **Step 5: Re-run the hook suite clean**

```bash
npx vitest run src/app/use-storage-backend.test.tsx --reporter=dot > /tmp/s2-hook2.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests |Errors" /tmp/s2-hook2.log
```

Expected: `EXIT=0`, all passed, no `Errors`.

- [ ] **Step 6: Commit**

```bash
git add src/app/use-storage-backend.test.tsx
git commit -F - <<'EOF'
test: pin the §72 guard as mounted-scoped rather than per-run

A superseded-but-still-in-flight save must still report its outcome. Without
this, re-implementing the guard with the load effect's per-run `cancelled` flag
looks correct and silently swallows real save failures in production.

Proved non-vacuous against a deliberately wrong implementation.

Claude-Session: https://[session link removed]
EOF
```

---

## Task 4: Repair the comment that asserts the absent property, then gate

**Files:**
- Modify: `src/app/use-storage-backend.ts` (~line 307)

- [ ] **Step 1: Fix the save effect's comment**

The comment above `doSave` currently reads:

```ts
    // Fire-and-forget save with the effect's full error handling — the .catch
    // routes every rejection to the storage-outcome/toast path, so neither the
    // timer nor the flush-on-hide below can produce an unhandled rejection.
```

That last clause is false, and it is false in exactly the way that hid this bug: **the handler itself is what rejected**, after teardown. Replace with:

```ts
    // Fire-and-forget save with the effect's full error handling — the .catch
    // routes every rejection to the storage-outcome/toast path, so a REJECTED
    // save never escapes unhandled.
    // ★★ That is not the same as "this chain cannot produce an unhandled
    //    rejection", which an earlier revision of this comment claimed. The
    //    HANDLERS themselves throw if they run after the component unmounted
    //    (setState -> resolveUpdatePriority -> `window`), which is precisely the
    //    §72 failure. They are routed through emitOutcome/emitToast for that
    //    reason; do not call args.* directly here.
```

- [ ] **Step 2: Byte-check the edited file**

The Edit tool has been observed writing a NUL byte into source in this repo, and a NUL makes the whole file invisible to content greps (open-followups §67 is exactly that, in another file).

```bash
node -e "const b=require('fs').readFileSync('src/app/use-storage-backend.ts');const i=b.indexOf(0);console.log(i===-1?'CLEAN':'NUL at byte '+i)"
```

Expected: `CLEAN`.

- [ ] **Step 3: Run the three gates, exit codes unpiped**

```bash
npx tsc --noEmit; echo "EXIT=$?"
```

Expected: `EXIT=0`, no output.

```bash
npx eslint --max-warnings=0 src/app; echo "EXIT=$?"
```

Expected: `EXIT=0`, no output. ★ Never pipe this into `grep` — a grep that matches nothing reports 1 and a pass reads as a failure.

```bash
npm run test:run > /tmp/s2-suite.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests |Errors" /tmp/s2-suite.log
```

Expected: `EXIT=0`, all files and tests passed, **and no `Errors  N error` line**. That last check is the point of the whole task.

- [ ] **Step 4: Check the coverage gate**

`use-storage-backend.ts` is **not** in `vitest.config.ts` `coverage.exclude`, so it is gated, and this task added four functions and four branches.

```bash
npm run test:coverage > /tmp/s2-cov.log 2>&1; echo "EXIT=$?"
grep -E "ERROR|threshold|All files" /tmp/s2-cov.log
```

Expected: `EXIT=0` and no threshold error. Global floors are lines 92 / functions 91 / branches 80 / statements 89.

If functions or branches dipped below the floor, the missing coverage is one of `emitRegistryChange` / `emitStorageConfig` — add a test that unmounts mid-`switchToProject` rather than lowering a floor. **Never lower a floor to make a run pass.**

- [ ] **Step 5: Commit**

```bash
git add src/app/use-storage-backend.ts
git commit -F - <<'EOF'
docs: correct the save-effect comment that asserted the absent property

The old text claimed the .catch meant this chain "cannot produce an unhandled
rejection". The handlers themselves are what throw, after unmount -- which is
the §72 bug the comment sat directly above.

Claude-Session: https://[session link removed]
EOF
```

---

## Task 5: Hunt step B1 — is §39's toast reachable at all?

§39 is `src/app/timelog-panel.test.tsx:278`, *"surfaces a partial-failure toast when Refresh drops some projects"*. It has failed CI **eight** times, always this one assertion, never locally. Three of those failures ran under a 15,000 ms budget and consumed **15,093 / 15,098 / 15,117 ms** — a 24 ms spread. That is a toast that never arrives, not a slow one.

**The reachability question is now concrete.** The toast comes from `handleRefreshBookings` (`src/app/timelog-panel.tsx:389`):

```ts
  async function handleRefreshBookings() {
    if (isPopout || sync.busy || confirming || !canRefresh) return;
    const { start, end } = fetchWindow();
    const result = await sync.fetchBookingsForProjects([...refreshProjectIds], start, end);
    if (result && result.failedProjects > 0) {
      logDiag("warn", "timelog.partialProjectFetch", { failedProjects: result.failedProjects });
      showToast("error", t(lang, "guardTimelogPartialProjectFetch", result.failedProjects));
    }
  }
```

**Four early-return guards** can silently no-op the whole handler, producing exactly §39's signature. `canRefresh` is `links.customerId !== undefined && links.projectIds.length > 0`, and those links are seeded by a **sibling component's mount effect** (`SeedWorkspace`, `timelog-panel.test.tsx:122`), not by the panel itself.

**Files:**
- Read: `src/app/timelog-panel.tsx`, `src/app/timelog-panel.test.tsx`
- Modify: `src/app/timelog-panel.test.tsx`

- [ ] **Step 1: Determine each guard's value at click time**

Run the test in isolation with a temporary `console.log` of all four guard values at the top of `handleRefreshBookings`:

```bash
npx vitest run src/app/timelog-panel.test.tsx -t "surfaces a partial-failure toast" --reporter=dot > /tmp/s2-b1.log 2>&1; echo "EXIT=$?"
grep -E "Tests |isPopout|busy|confirming|canRefresh" /tmp/s2-b1.log
```

Record what each guard reads on a passing local run. Then remove the `console.log` — it must not be committed.

- [ ] **Step 2: Split the single assertion into two distinguishable ones**

The test currently asserts only the toast, so a failure cannot distinguish *"the handler never ran"* from *"the handler ran and the toast did not fire"*. Add the intermediate assertion. Replace the `waitFor` block at `timelog-panel.test.tsx:302-304` with:

```tsx
      // ★ Two assertions, not one, so a CI failure says WHICH half broke.
      // `handleRefreshBookings` early-returns on isPopout || sync.busy ||
      // confirming || !canRefresh, and `canRefresh` depends on workspace links
      // seeded by a SIBLING component's mount effect. A silent early return and
      // a genuinely missing toast were indistinguishable in all eight CI
      // failures (open-followups §39).
      await waitFor(() => expect(fetchBookingsForProjects).toHaveBeenCalled(), { timeout: 15000 });
      await waitFor(() => expect(showToast).toHaveBeenCalledWith("error", expect.any(String)), {
        timeout: 15000,
      });
```

★★ This is **not** a timeout raise — the 15000 was already there and stays exactly as it was. Do not change it in either direction.

- [ ] **Step 3: Replace the in-test comment, which the evidence has disproved**

The comment at `timelog-panel.test.tsx:291-301` reasons from *"always at ~5.1s … a hair over the limit"* to *"worker starvation under full parallel load, not a race"*. The register has since disproved that: the mitigation it justified was applied and the failure recurred at 15,093 ms. Replace the whole comment block with:

```tsx
      // ★★★ This assertion has failed in CI eight times and NEVER locally. The
      // recorded diagnosis in this comment used to be worker starvation; that is
      // DISPROVED. Three failures ran under this 15s budget and consumed
      // 15,093 / 15,098 / 15,117 ms — a 24 ms spread at the ceiling, i.e. the
      // toast never arrives on those runs. Raising the budget again buys nothing;
      // 5s -> 15s already bought nothing. See docs/open-followups.md §39.
```

- [ ] **Step 4: Verify the test still passes**

```bash
npx vitest run src/app/timelog-panel.test.tsx --reporter=dot > /tmp/s2-b1b.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests |Errors" /tmp/s2-b1b.log
```

Expected: `EXIT=0`, all passed.

- [ ] **Step 5: Record the finding, then commit**

Write down, for Task 9's register update: which guard (if any) can be false at click time, and whether `fetchBookingsForProjects` is provably reached. **If a guard is provably reachable-false, that is the diagnosis and §39 can close** — say so plainly and skip Task 7 for §39. If all four are provably true, record that as a negative result; it is the first one this problem has produced.

```bash
git add src/app/timelog-panel.test.tsx
git commit -F - <<'EOF'
test: split §39's single assertion so a CI failure says which half broke

handleRefreshBookings early-returns on four guards, one of which depends on
workspace links seeded by a sibling component's mount effect. All eight CI
failures asserted only the toast, so "the handler never ran" and "the handler ran
and no toast fired" were indistinguishable.

Also replaces the in-test diagnosis comment: the worker-starvation reading is
disproved -- the mitigation it justified was applied and the failure recurred at
15,093 ms. Timeouts unchanged in both directions.

Claude-Session: https://[session link removed]
EOF
```

---

## Task 6: Hunt step B2 — what can still go wrong in §51?

§51 is `src/app/use-tasks-dedup.test.tsx:101`, *"on confirm, removes the duplicate and records ONE undo entry"*. It failed on post-merge main pipeline #5418 with `Unable to find … role "button" and name /merge selected/i`, in **38 ms** — not a timeout. The trigger carried `disabled=""`, meaning the mocked `runDedupProposal` had not resolved.

**Files:**
- Read: `src/app/use-tasks-dedup.test.tsx`

- [ ] **Step 1: Confirm the recorded contradiction can no longer occur**

The register's open question was that `await waitFor(() => screen.getByText(/dup/i))` appeared to succeed while the modal was absent — `/dup/i` being a substring of the trigger's own name, *"Dedu**p**licate & unify tasks"*. Read lines 101-120 and confirm the post-0.212.0 fix is in place: the gate is now `await screen.findByRole("button", { name: /merge selected/i })`, so the wait and the assertion are one condition.

Record the conclusion: **the failure mode as recorded cannot recur**, because the ambiguous gate is gone. A future failure here will be a clean `findByRole` timeout against the 5000 ms `asyncUtilTimeout` (`vitest.setup.ts:23`) — a different and trustworthy signature.

★★ Do **not** read that as a root cause. The matcher fix removed a way the test could mislead, not the reason it failed.

- [ ] **Step 2: Decide whether §51 needs anything beyond instrumentation**

Given step 1, the honest position is that §51 has no reproducible symptom left to chase — it needs Task 8's failure capture and nothing else. Record that decision for Task 9. **No code change and no commit in this task** unless step 1 disproves the premise.

---

## Task 7: Hunt step A — bounded amplification

★★ **Hard budget: two hypotheses, three full-suite runs each, then stop and go to Task 8 regardless of outcome.** This step is the one that can eat the slice; the budget is the reason it cannot.

Skip this task entirely for §39 if Task 5 produced a diagnosis.

`vitest.config.ts` sets no `pool`, `isolate`, `fileParallelism` or `maxWorkers`, so all defaults are in play.

- [ ] **Step 1: Hypothesis A1 — cross-file async leakage**

If files sharing a worker leak async work into each other, removing isolation should raise the failure rate. Three runs:

```bash
for i in 1 2 3; do npx vitest run --no-isolate --reporter=dot > /tmp/s2-noiso-$i.log 2>&1; echo "RUN=$i EXIT=$?"; grep -E "Test Files|Tests |Errors" /tmp/s2-noiso-$i.log; done
```

Decision rule: **any** failure of `timelog-panel` or `use-tasks-dedup` across the three runs implicates leakage — pursue it. Three clean runs is a negative result; record it and move on.

- [ ] **Step 2: Hypothesis A2 — file-neighbour ordering**

```bash
for s in 1 2 3; do npx vitest run --sequence.shuffle --sequence.seed=$s --reporter=dot > /tmp/s2-shuf-$s.log 2>&1; echo "SEED=$s EXIT=$?"; grep -E "Test Files|Tests |Errors" /tmp/s2-shuf-$s.log; done
```

Decision rule as above. **Record the seeds** — a reproducing seed is the single most valuable artifact this hunt can produce.

- [ ] **Step 3: Record the outcome and stop**

Write down every configuration run and its result, including the negatives. Six configurations that did not reproduce is itself the first negative evidence this problem has after eight occurrences. Then go to Task 8 regardless.

★ No commit — this task produces findings, not code.

---

## Task 8: Hunt step C — failure-time instrumentation

The stop rule's legitimate finish: convert occurrence #9 into evidence instead of a ninth frequency data point.

`onTestFailed` ships with Vitest 4.1.8 and is currently **unused anywhere in this repo** — verify with `grep -rn "onTestFailed" src e2e`.

★★ **Read-only, failure-path only.** Nothing that `await`s, flushes, or adds a `waitFor`. Anything that changes scheduling perturbs the race it exists to observe, and §39's whole history is mitigations that moved the failure instead of explaining it.

**Files:**
- Modify: `src/app/timelog-panel.test.tsx`
- Modify: `src/app/use-tasks-dedup.test.tsx`

- [ ] **Step 1: Instrument §39**

Add `onTestFailed` to the vitest import in `src/app/timelog-panel.test.tsx`, then inside the `it(...)` at line 278, immediately after `render(...)` and before the click:

```tsx
      // §39 failure capture — read-only, failure path only. Eight CI failures
      // have produced only frequency data; this makes the ninth readable.
      onTestFailed(() => {
        console.error("[§39 capture]", JSON.stringify({
          fetchCalls: fetchBookingsForProjects.mock.calls.length,
          toastCalls: showToast.mock.calls.map((c) => c[0]),
          refreshButtonPresent: !!screen.queryByRole("button", { name: t("en-US", "timelogRefresh") }),
          refreshButtonDisabled:
            screen.queryByRole("button", { name: t("en-US", "timelogRefresh") })?.hasAttribute("disabled") ?? null,
        }));
      });
```

This answers directly: did the handler run, did any toast fire and of what kind, and was the control even live.

- [ ] **Step 2: Instrument §51**

Add `onTestFailed` to the vitest import in `src/app/use-tasks-dedup.test.tsx`, then inside the `it(...)` at line 101, immediately after `renderHarness({ captureSpy });`:

```tsx
    // §51 failure capture — read-only, failure path only.
    onTestFailed(() => {
      console.error("[§51 capture]", JSON.stringify({
        proposalCalls: vi.mocked(call.runDedupProposal).mock.calls.length,
        triggerDisabled:
          screen.queryByRole("button", { name: /deduplicate & unify tasks/i })?.hasAttribute("disabled") ?? null,
        mergeButtonPresent: !!screen.queryByRole("button", { name: /merge selected/i }),
        ids: screen.queryByTestId("ids")?.textContent ?? null,
      }));
    });
```

- [ ] **Step 3: Verify both files still pass and the capture does not fire on success**

```bash
npx vitest run src/app/timelog-panel.test.tsx src/app/use-tasks-dedup.test.tsx --reporter=dot > /tmp/s2-instr.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests |Errors|capture" /tmp/s2-instr.log
```

Expected: `EXIT=0`, all passed, and **no `[§39 capture]` or `[§51 capture]` line** — the hooks must be silent on success.

- [ ] **Step 4: Typecheck — this is the gate that catches test-only errors**

```bash
npx tsc --noEmit; echo "EXIT=$?"
```

Expected: `EXIT=0`. `next build` does not typecheck test files and Vitest never typechecks, so this is the only thing standing between a test-only type error and a red CI job.

- [ ] **Step 5: Commit**

```bash
git add src/app/timelog-panel.test.tsx src/app/use-tasks-dedup.test.tsx
git commit -F - <<'EOF'
test: capture failure-time state for the two known CI flakes

onTestFailed hooks in the §39 and §51 tests record whether the handler ran, what
toasts fired, and whether the controls were live. Read-only and failure-path
only -- nothing that awaits or flushes, which would perturb the race.

Eight occurrences of §39 have produced only frequency data. This makes the ninth
readable.

Claude-Session: https://[session link removed]
EOF
```

---

## Task 9: Register hygiene

`docs/open-followups.md` is **tracked**, and it is the only durable output of this slice — the spec and this plan live under a gitignored path and exist on one machine.

**Files:**
- Modify: `docs/open-followups.md`

- [ ] **Step 1: Add the five missing index rows**

The summary table (lines 52-111) stops at **§67**. §68, §69, §70 and §71 have full bodies and no row. Add four rows matching the existing column format (`| # | Item | Origin | Size | State |`), plus a fifth for §72:

```markdown
| 68 | Allocation rows' `border-t` sits on the `<tr>`, where it has never painted | 0.214.0 branch | S–M | open — **VISUAL change, needs sign-off**; 8 sites in 6 files |
| 69 | `BrandingConfig`'s "is this blob empty?" is answered in TWO places | 0.214.0 branch | S | open — bit on the first addition; one gate pinned, the lists still diverge |
| 70 | A budget bucket's Total column and total row follow the role filter | 0.214.0 branch | S | open — product decision, untested either way |
| 71 | A budget bucket evaluates `cellBudget` three times per (row, period) | 0.214.0 branch | S–M | open — unmeasured; the prize is structural, not speed |
| 72 | Caller callbacks fire after unmount — CI exits 1 with every test passing | pipeline 5446 | S | **CLOSED in this slice** — mounted ref + 4 emitters, 35 sites |
```

★ Verify the `Origin` values against §68-§71's own bodies before writing them; do not invent a provenance. Each body states where it came from.

- [ ] **Step 2: Write §72**

Insert after §71 and before the `## Decided — do not re-litigate` heading (~line 3013). It must carry: the three-signature table distinguishing §39 / §51 / this one; the trace; the three-region table for `use-storage-backend.ts`; the mounted-vs-`cancelled` distinction and why; the `setActivityLog`/`useBroadcastSync` exclusion as surveyed-and-left; and the honesty note that production impact is near-zero because `task-manager` never unmounts.

Include the reproduce commands rather than line numbers:

```bash
grep -c 'args.showToast(' src/app/use-storage-backend.ts        # 0 after the fix
grep -c 'emitToast(' src/app/use-storage-backend.ts             # 24 = 23 sites + 1 decl
```

★★★ **Cite symbols, not `file:line`.** A line number can be invalidated by the very commit that writes it — §68's first revision named two that its own commit had already moved.

- [ ] **Step 3: Update §39 and §51 with what was actually established**

Write the findings from Tasks 5, 6 and 7 — including the negatives. If the honest answer is *"reachability narrowed to these guards, mechanism still unknown, six amplification configurations did not reproduce"*, write exactly that. Both entries stay **open** unless a root cause is genuinely established. For §51, record that its recorded failure mode can no longer recur because the ambiguous `/dup/i` gate is gone, and that this is not a root cause.

★★ **Correcting a claim is when you are most likely to write a new one.** Two reviewers on slice 1's branch found four falsehoods in prose, **two of them inside corrections of earlier falsehoods**. Re-measure every replacement claim, and grep for every pointer into a paragraph you rewrite — the index row and the body can disagree after a single edit.

- [ ] **Step 4: Verify no line-ending or encoding damage**

```bash
node -e "const b=require('fs').readFileSync('docs/open-followups.md');console.log(b.indexOf(0)===-1?'CLEAN':'NUL at '+b.indexOf(0))"
```

Expected: `CLEAN`.

- [ ] **Step 5: Commit**

```bash
git add docs/open-followups.md
git commit -F - <<'EOF'
docs: open §72, repair the index table, record what the flake hunt established

§72 covers the caller-callback teardown race fixed in this branch -- the third
distinct signature on the unit-tests job, and the only one with a captured
mechanism.

The index table had stopped at §67 while §68-§71 carried full bodies; five rows
added.

§39 and §51 updated with the hunt's findings, negatives included. Both stay open
unless a root cause was genuinely established.

Claude-Session: https://[session link removed]
EOF
```

---

## Task 10: Final verification

- [ ] **Step 1: Run all three gates, exit codes unpiped**

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app; echo "EXIT=$?"
npm run test:run > /tmp/s2-final.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests |Errors" /tmp/s2-final.log
```

Expected: three `EXIT=0`, all files and tests passed, **no `Errors  N error` line**.

- [ ] **Step 2: Coverage**

```bash
npm run test:coverage > /tmp/s2-final-cov.log 2>&1; echo "EXIT=$?"
grep -E "ERROR|threshold" /tmp/s2-final-cov.log
```

Expected: `EXIT=0`, no threshold error.

- [ ] **Step 3: Confirm no forbidden change slipped in**

```bash
git diff main --stat
git diff main -- vitest.config.ts vitest.setup.ts; echo "EXIT=$?"
```

Expected: the stat lists only the five files from the table at the top of this plan. The second diff must be **empty** — no `retry`, no timeout change, in either file.

- [ ] **Step 4: Confirm no version bump was made**

```bash
git diff main -- src/app/version.ts CHANGELOG.md package.json
```

Expected: empty. This slice is CI-facing and deliberately unversioned, matching slice 1 (`!342`).

- [ ] **Step 5: Report and stop**

Summarise: the guard shipped and what it closes; what the hunt established for §39 and §51, negatives included; what §72 records.

★★★ **Do not push, do not open an MR, do not merge.** Those happen only on an explicit instruction from the user, and a merge only after a green pipeline. Never `--auto-merge`.

---

## Self-review notes

**Spec coverage** — every spec section maps to a task: part 1's guard → Tasks 1-4; the toast fork (all 23, uniform) → Task 2 step 3; the mounted-vs-`cancelled` trap → Tasks 2 and 3; part 2 step B → Tasks 5 and 6; step A with its budget → Task 7; step C → Task 8; part 3's register hygiene → Task 9; the landing gates → Tasks 4 and 10.

**One deliberate extension beyond the spec.** The spec scoped the sweep at "8 `onStorageOutcome` + 23 `showToast`". Planning found two more caller callbacks with the identical exposure — `onRegistryChange` (1 site) and `setStorageConfig` (1 call + 1 pass-through) — plus the two sub-hook `showToast` pass-throughs, which extend the guard into `use-storage-turso-ops` and `use-storage-file-ops` at zero extra cost. Included, because the spec's own stated principle is that uniformity is the point of a choke point and two spellings in one file is how the next one gets missed. `setActivityLog` is excluded with a reason and recorded rather than fixed. **Update the spec's part 1 counts to match this plan** so the two documents do not drift.

**Known limit, stated rather than papered over:** the Task 1 test pins the guard (no callback after unmount), not the crash (`window is not defined` needs environment teardown, which a unit test cannot stage). Task 4 step 3's `grep -E "Errors"` on the full-suite log is the closest available check on the real symptom, and it is only ever a sample — the failure is intermittent.
