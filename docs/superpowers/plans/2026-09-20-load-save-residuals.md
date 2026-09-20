# Load/save residuals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close §588, §589, §590 and the AI tool-loop scope gap, so no write lands in the wrong project, no gate silently stalls, and no debounced edit is dropped by a backend rebuild.

**Architecture:** §588 and §589 share one new mechanism — a `backendRef` assigned during render, giving any post-await caller a live "which backend is current" pointer that `use-storage-backend.ts` does not have today. §590 mirrors the commit-on-accept split follow-up §287 already established for `onOpenStorageFile`: pick, read, and bind only if the user accepts. The tool loop gets both halves of its guard — an unmount cleanup that cancels the orphaned closure, and the existing `scope-epoch.ts` reader threaded in and folded into `stale()`.

**Tech Stack:** React 19 hooks, TypeScript, vitest + `@testing-library/react` (`renderHook`), Next.js 16.

**Spec:** `docs/superpowers/specs/2026-09-20-load-save-residuals-design.md`

## Global Constraints

- Branch off `main` at or after the 1.12.4 merge. Branch name: `fix/load-save-residuals`.
- `src/app/*.ts(x)` is CRLF — use the Edit tool, **never** `sed -i` (it re-lines the whole file invisibly). Docs are LF.
- `i18n.ts` (EN) and `i18n.de.ts` (DE) key sets must be identical; tsc enforces. **`i18n.de.ts` may only be edited by a node utf8 write script anchored on `\r\n`** — the Edit tool corrupts umlauts and curls quotes there. DE must use real umlauts, never `ue`/`ae` substitutions.
- Never `git add -A` or `git add .`; stage explicit paths only. No `--amend`, no `git stash`. `git checkout --` / `git restore` are deny-blocked.
- Commit messages cite `§N`, never `#N` followed by digits (that auto-closes the wrong GitLab issue). `Closes #NN` belongs in the MR description only, one per line.
- Every commit ends with the trailer `Claude-Session: https://[session link removed]`.
- **Never run two vitest processes at once.** The runner slot is shared with a peer session.
- Never read a gate's exit code through a pipe — redirect to a file, `echo "EXIT=$?"` unpiped, then grep the file.
- Lint with `npx eslint --max-warnings=0 src` (bare `eslint` exits 0 over warnings CI rejects).
- Run `npx tsc --noEmit` after editing ANY test file — vitest never typechecks, and `next build` skips `*.test.tsx`.
- File-size ratchet LIMIT is 1600, counted as `split("\n").length` (one MORE than `wc -l`).
- Register entries are one-to-one with GitLab issues: each new `§NNN` heading needs an index row, a `**Work item:** #NN` line, a `§NNN:` issue title and the `source::register` label.
- Register numbers **§596–§599** are reserved for this slice (peer session holds §595). A § is only reserved once it is on `origin/main` — re-verify immediately before push, not merely before filing.

## Review Focus

1. **A rebuild that happens between the flush decision and the flush itself** — §589's cleanup flushes to the old backend; if the old instance's gate closed in between, the write must not happen. Pinned in Task 4.
2. **A pick cancelled at the OS dialog** — `pickSaveFile` rejects or returns nothing; the app must be exactly as it was, with no handle bound and no toast. Pinned in Task 5.
3. **A picked file that exists but is empty or unparseable** — the "already holds a project" check must treat a zero-record parse and a throw as "not a project", and proceed with the normal write rather than offering to load nothing. Pinned in Task 5.
4. **StrictMode's mount→unmount→mount on the chat panel** — the new unmount cleanup sets `cancelledRef`, and a double-invoked mount must not leave a fresh panel permanently cancelled. Pinned in Task 6.
5. **A tool call that is slow while the project is swapped mid-batch** — the per-tool loop has no staleness check today, so a multi-tool turn can write several entities after the swap. Pinned in Task 7.

---

### Task 1: `backendRef` — the live-backend pointer (lint probe first)

**Files:**
- Modify: `src/app/use-storage-backend.ts` (after the `backend` useMemo, currently lines 90-103)
- Test: `src/app/use-storage-backend.backend-ref.test.tsx` (create)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `backendRef: React.MutableRefObject<ReturnType<typeof createBackend> | null>`, a module-private ref inside `useStorageBackend`, holding the backend of the most recent render. Tasks 3, 4 and 5 read `backendRef.current`.

**Why a render-phase write:** React runs every effect cleanup before any effect body. A ref mirrored in an effect would still hold the OLD backend at the moment Task 4's cleanup reads it — which is the only moment that matters. It must be written in the render body. **No render-phase ref write exists anywhere in `src/app` today**, and lint is `--max-warnings=0` including a `react-hooks` purity rule, so this is probed before anything is built on it.

- [ ] **Step 1: Probe that lint accepts a render-phase ref write**

Add these three lines to `src/app/use-storage-backend.ts` immediately after the `backend` useMemo's closing `}, [...]);` (currently line 103):

```ts
  // §588/§589 — the backend of the CURRENT render, readable by any caller that
  // resumes after an await. Assigned during render ON PURPOSE: React runs every
  // effect cleanup before any effect body, so a ref mirrored in an effect still
  // holds the OLD backend at the one moment the save effect's cleanup reads it.
  const backendRef = useRef<ReturnType<typeof createBackend> | null>(null);
  backendRef.current = backend;
```

- [ ] **Step 2: Run lint and typecheck, unpiped, and read the exit codes**

```bash
npx eslint --max-warnings=0 src/app/use-storage-backend.ts; echo "EXIT=$?"
npx tsc --noEmit; echo "EXIT=$?"
```

Expected: both `EXIT=0`.

**If eslint rejects it** (a purity or `react-hooks` error naming the render-body assignment): STOP and use the fallback instead — a generation counter minted inside the existing `backend` useMemo, which is already a render-phase computation:

```ts
  const backendGenRef = useRef(0);
  const backend = useMemo(() => {
    backendGenRef.current += 1;
    // ...existing body unchanged...
  }, [/* existing deps unchanged */]);
```

Re-run both commands on the fallback. Record in the report which form was used and paste the exact eslint output that decided it. Every later task then compares generations (`backendGenRef.current`) instead of instances; the comparisons are otherwise identical. Do not proceed until one form is lint-clean and tsc-clean.

- [ ] **Step 3: Write the failing test**

Create `src/app/use-storage-backend.backend-ref.test.tsx`. Match the existing idiom in `use-storage-backend.test.tsx`: it mocks `./storage` with `vi.mock`, uses `renderHook` from `@testing-library/react`, and wraps in `TestProviders`. Read the first 60 lines of `use-storage-backend.test.tsx` and copy its mock block and harness verbatim rather than inventing one.

The test asserts the ref tracks the live backend across a rebuild. Because `backendRef` is module-private, assert it through observable behaviour rather than reaching inside: after a `storageConfig` change produces a new backend instance, a reload started before the change must not open the new backend's gate (that is Task 3's behaviour). So in THIS task, pin only the mechanism's precondition:

```tsx
it("mints a new backend instance when storageConfig changes", () => {
  const first = makeBackendStub();
  const second = makeBackendStub();
  vi.mocked(createBackend).mockReturnValueOnce(first).mockReturnValueOnce(second);

  const { result, rerender } = renderHook(
    (props: { config: StorageConfig }) => useStorageBackend(makeArgs(props.config)),
    { wrapper: TestProviders, initialProps: { config: fileConfig } },
  );
  const before = result.current;
  rerender({ config: tursoConfig });

  expect(createBackend).toHaveBeenCalledTimes(2);
  expect(result.current).not.toBe(before);
});
```

`makeBackendStub` / `makeArgs` / `fileConfig` / `tursoConfig`: build these from the equivalents already in `use-storage-backend.test.tsx` — do not invent new shapes.

- [ ] **Step 4: Run the test**

```bash
npx vitest run src/app/use-storage-backend.backend-ref.test.tsx > /tmp/t1.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " /tmp/t1.log
```

Expected: PASS, `Test Files 1 passed`. Assert the file count — a mistyped path mixed with a real one is dropped silently at exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/app/use-storage-backend.ts src/app/use-storage-backend.backend-ref.test.tsx
git commit -m "feat(storage): §588 — a live backend pointer readable after an await

The render-phase assignment is deliberate: React runs every effect cleanup
before any effect body, so an effect-mirrored ref still holds the previous
backend at the moment the save effect's cleanup reads it.

Claude-Session: https://[session link removed]"
```

---

### Task 2: §588 probe — prove the gate stalls

**Files:**
- Test: `src/app/use-storage-backend.superseded-gate.test.tsx` (create)

**Interfaces:**
- Consumes: `backendRef` from Task 1 (not read directly; the test drives the hook).
- Produces: a failing test named `"a reload that resolves after a rebuild does not open the new backend's gate"`, which Task 3 turns green.

**Why a probe first:** §588 is filed as read-from-code and has never been reproduced. A fix without a failing probe is a fix for a theory.

- [ ] **Step 1: Write the probe**

```tsx
it("a reload that resolves after a rebuild does not open the new backend's gate", async () => {
  let releaseLoad: (ws: Workspace) => void = () => {};
  const first = makeBackendStub({
    load: () => new Promise<Workspace>((res) => { releaseLoad = res; }),
  });
  const second = makeBackendStub();
  vi.mocked(createBackend).mockReturnValueOnce(first).mockReturnValueOnce(second);

  const { result, rerender } = renderHook(
    (props: { config: StorageConfig }) => useStorageBackend(makeArgs(props.config)),
    { wrapper: TestProviders, initialProps: { config: fileConfig } },
  );

  // Start a reload against the FIRST backend, then rebuild onto the second
  // while that load is still awaiting.
  let reload!: Promise<void>;
  act(() => { reload = result.current.reloadCurrentProject(); });
  rerender({ config: tursoConfig });

  await act(async () => { releaseLoad(populatedWorkspace()); await reload; });

  // `second` is live and ITS OWN load effect has landed, so `allowSavesTo(second)`
  // ran and its gate is OPEN. A load is not a save, so nothing is persisted yet.
  expect(second.save).not.toHaveBeenCalled();

  await act(async () => { result.current.setTasks([{ ...aTask, title: "edited" }]); });
  await act(async () => { await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS + 50); });

  // ★ RED TODAY, AND THIS IS THE ASSERTION THE PROBE EXISTS FOR. The superseded
  // reload resolved against `first` and ran `allowSavesTo(first)`
  // (`use-storage-backend.ts:421`, via `applyWorkspaceFromLoad`), moving the gate
  // OFF the live backend. The edit above is then silently never persisted —
  // §588's stall, with no banner and no toast, because `loadPause` is published
  // only for an instance whose own load failed or was refused.
  expect(second.save).toHaveBeenCalled();
});
```

Note: this file needs `vi.useFakeTimers()` in a `beforeEach` and `vi.useRealTimers()` in `afterEach` to drive `SAVE_DEBOUNCE_MS`. Import `SAVE_DEBOUNCE_MS` from `./debounced-save`.

- [ ] **Step 2: Run it and confirm it FAILS for the right reason**

```bash
npx vitest run src/app/use-storage-backend.superseded-gate.test.tsx > /tmp/t2.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests |AssertionError" /tmp/t2.log
```

Expected: FAIL, on the `expect(second.save).toHaveBeenCalled()` line — "number of calls: 0".
The superseded reload calls `allowSavesTo(first)`, moving the gate away from `second`.

★★ A failure anywhere ELSE is a broken test, not a reproduced defect. In particular, if the
run fails because `second`'s own load never landed, the gate was never open for it in the
first place and the probe proves nothing — fix the fixture so `second` reaches
`allowSavesTo(second)` before the superseded reload resolves, and re-run. The whole probe
turns on `second`'s gate being OPEN at the moment the stale caller shuts it.

**If it PASSES**, the defect as filed does not reproduce. Do not "fix" anything. Stop, write what you observed into the report, and say so plainly — the entry may be wrong, and that is a finding worth more than a fix.

- [ ] **Step 3: Commit the probe alone**

```bash
git add src/app/use-storage-backend.superseded-gate.test.tsx
git commit -m "test(storage): §588 — probe: a superseded reload shuts the new backend's gate

Red on purpose. The fix follows in the next commit.

Claude-Session: https://[session link removed]"
```

---

### Task 3: §588 fix — drop a superseded caller's result

**Files:**
- Modify: `src/app/use-storage-backend.ts` — `reloadCurrentProject` (lines 954-996)
- Modify: `src/app/use-storage-file-ops.ts` — `onPickStorageFile` (lines 409-422)
- Modify: `src/app/use-storage-backend.ts` — the `useStorageFilePickerOps({...})` call site (lines 923-947)
- Test: `src/app/use-storage-backend.superseded-gate.test.tsx` (from Task 2)

**Interfaces:**
- Consumes: `backendRef` (Task 1), the red probe (Task 2).
- Produces: a new `StorageFilePickerDeps` member `isBackendCurrent: () => boolean`, passed as `() => backendRef.current === backend`.

- [ ] **Step 1: Guard `reloadCurrentProject` after its await**

In `src/app/use-storage-backend.ts`, immediately after `const workspace = await backend.load();` (line 958), insert:

```ts
      // §588 — a settings-driven rebuild may have replaced the backend while we
      // awaited. Applying now would stamp THIS (superseded) instance and move
      // the save gate away from the live one, which then stays shut in silence:
      // `loadPause` is published only for an instance whose load failed or was
      // refused, so no banner and no toast would appear.
      if (backendRef.current !== backend) {
        logDiag("warn", "storage.supersededLoadDropped", { writer: "reloadCurrentProject" });
        return;
      }
```

`logDiag` is already imported in this file; confirm with `grep -n "logDiag" src/app/use-storage-backend.ts` before adding an import.

- [ ] **Step 2: Add the dep and guard `onPickStorageFile`**

In `src/app/use-storage-file-ops.ts`, add to `StorageFilePickerDeps` (after `loadSucceeded`, line ~397):

```ts
  /** §588 — is the backend this deps object was built for still the live one?
   *  False after a settings-driven rebuild landed during an await. */
  isBackendCurrent: () => boolean;
```

In `onPickStorageFile`, immediately after `await promise;` (line 413):

```ts
    if (!deps.isBackendCurrent()) return; // §588 — a rebuild landed while the picker was open; this write and its gate belong to a backend nobody is using.
```

In `src/app/use-storage-backend.ts`, add to the `useStorageFilePickerOps({...})` call (after `loadSucceeded`, line ~939):

```ts
      isBackendCurrent: () => backendRef.current === backend,
```

- [ ] **Step 3: Run the probe — it must now PASS**

```bash
npx vitest run src/app/use-storage-backend.superseded-gate.test.tsx > /tmp/t3.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " /tmp/t3.log
```

Expected: PASS, `Test Files 1 passed`.

- [ ] **Step 4: Mutation-prove the guard**

Change `backendRef.current !== backend` to `false` in `reloadCurrentProject`. Re-run Step 3: the probe must go RED. Revert the mutant. Record the mutant and the test it killed in the report by name — an unnamed mutation claim is uncheckable.

- [ ] **Step 5: Run the neighbouring suites**

```bash
npx vitest run src/app/use-storage-backend.test.tsx src/app/use-storage-backend.load-gate.test.tsx src/app/use-storage-backend.hold-ops.test.tsx src/app/use-storage-backend.load-pending.test.tsx src/app/use-storage-backend.target-key.test.tsx > /tmp/t3b.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " /tmp/t3b.log
```

Expected: all pass, `Test Files 5 passed`.

- [ ] **Step 6: tsc, then commit**

```bash
npx tsc --noEmit; echo "EXIT=$?"
git add src/app/use-storage-backend.ts src/app/use-storage-file-ops.ts
git commit -m "fix(storage): §588 — a superseded reload or pick no longer shuts the live backend's gate

Both callers capture the render-scope backend and reach allowSavesTo after an
await. When a settings-driven rebuild replaced the backend in between, they
opened the gate for the dead instance and the live one stayed shut with no
banner and no toast, because loadPause is published only for an instance whose
load failed or was refused.

Claude-Session: https://[session link removed]"
```

---

### Task 4: §589 — flush a pending edit to the old backend on rebuild

**Files:**
- Modify: `src/app/debounced-save.ts` (the whole file is 57 lines)
- Modify: `src/app/use-storage-backend.ts` — the save effect's `return scheduleDebouncedSave(...)` (line 776)
- Test: `src/app/use-storage-backend.rebuild-flush.test.tsx` (create)
- Test: `src/app/debounced-save.test.ts` (extend if it exists; `ls src/app/debounced-save*` first)

**Interfaces:**
- Consumes: `backendRef` (Task 1).
- Produces: `scheduleDebouncedSave(save, delayMs, shouldFlushOnCleanup?)` — a third, optional parameter. Absent, behaviour is byte-identical to today.

**Why the gate needs no extra check:** the §586 gate lives inside the `doSave` the effect passes, and `doSave` closes over the `savesAllowed` computed for THAT render — i.e. for the OLD backend. So a cleanup flush routed through the same `save` argument automatically respects the old instance's gate. Do not add a second gate check; it would be a different question asked in the same words.

- [ ] **Step 1: Write the failing probe**

Create `src/app/use-storage-backend.rebuild-flush.test.tsx`:

```tsx
it("flushes an edit made inside the debounce to the OLD backend when the backend is rebuilt", async () => {
  const first = makeBackendStub();
  const second = makeBackendStub();
  vi.mocked(createBackend).mockReturnValueOnce(first).mockReturnValueOnce(second);

  const { result, rerender } = renderHook(
    (props: { config: StorageConfig }) => useStorageBackend(makeArgs(props.config)),
    { wrapper: TestProviders, initialProps: { config: fileConfig } },
  );
  await act(async () => { await settleInitialLoad(first); }); // opens the gate for `first`

  // Edit, then rebuild INSIDE the 500 ms debounce window.
  act(() => { result.current.setTasks([{ ...aTask, title: "edited" }]); });
  await act(async () => { await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS - 100); });
  rerender({ config: tursoConfig });
  await act(async () => { await vi.advanceTimersByTimeAsync(200); });

  const saved = vi.mocked(first.save).mock.calls.at(-1)?.[0];
  expect(saved?.tasks?.[0]?.title).toBe("edited");
  expect(second.save).not.toHaveBeenCalled();
});
```

`settleInitialLoad` resolves the first backend's initial `load()` so the §586 gate opens — copy the equivalent helper from `use-storage-backend.load-gate.test.tsx`.

- [ ] **Step 2: Run it and confirm it FAILS**

```bash
npx vitest run src/app/use-storage-backend.rebuild-flush.test.tsx > /tmp/t4.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests |AssertionError" /tmp/t4.log
```

Expected: FAIL — `first.save` was never called, because the cleanup clears the timer without flushing.

- [ ] **Step 3: Add the optional flush predicate to `debounced-save.ts`**

Change the signature and the returned cleanup:

```ts
export function scheduleDebouncedSave(
  save: () => void,
  delayMs: number,
  shouldFlushOnCleanup?: () => boolean,
): () => void {
  let fired = false;
  const timer = setTimeout(() => { fired = true; save(); }, delayMs);
  const flush = () => {
    if (fired) return;
    fired = true;
    clearTimeout(timer);
    save();
  };
  const onVisibilityChange = () => {
    if (document.visibilityState === "hidden") flush();
  };
  document.addEventListener("visibilitychange", onVisibilityChange);
  window.addEventListener("pagehide", flush);
  return () => {
    // ★★ §589 — a THIRD exit, and it reaches the caller's save through the same
    // single `save` argument as the other two, so the §586 gate inside `doSave`
    // still covers it. The predicate exists because a cleanup cannot otherwise
    // know WHY it is running: React passes no reason, and this closure holds
    // only the timer, the flush and the two listeners. The caller answers the
    // one question that matters — "did the BACKEND change?" — because only a
    // backend change makes the pending edit unreachable: the new target's load
    // replaces scope and the edit leaves memory unwritten.
    if (shouldFlushOnCleanup?.() === true) flush();
    clearTimeout(timer);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    window.removeEventListener("pagehide", flush);
  };
}
```

`flush()` before `clearTimeout` is safe: `flush` clears the timer itself and sets `fired`.

- [ ] **Step 4: Pass the predicate from the save effect**

In `src/app/use-storage-backend.ts`, replace line 776:

```ts
      return scheduleDebouncedSave(doSave, SAVE_DEBOUNCE_MS, () => backendRef.current !== backend);
```

- [ ] **Step 5: Run the probe — it must now PASS**

```bash
npx vitest run src/app/use-storage-backend.rebuild-flush.test.tsx > /tmp/t4b.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " /tmp/t4b.log
```

Expected: PASS.

- [ ] **Step 6: Pin Review Focus item 1 — a shut old gate must not flush**

Add to the same file:

```tsx
it("does not flush to the old backend when its own save gate never opened", async () => {
  const first = makeBackendStub();
  const second = makeBackendStub();
  vi.mocked(createBackend).mockReturnValueOnce(first).mockReturnValueOnce(second);

  const { result, rerender } = renderHook(
    (props: { config: StorageConfig }) => useStorageBackend(makeArgs(props.config)),
    { wrapper: TestProviders, initialProps: { config: fileConfig } },
  );
  // NOTE: no settleInitialLoad — `first`'s gate is never opened.
  act(() => { result.current.setTasks([{ ...aTask, title: "edited" }]); });
  await act(async () => { await vi.advanceTimersByTimeAsync(SAVE_DEBOUNCE_MS - 100); });
  rerender({ config: tursoConfig });
  await act(async () => { await vi.advanceTimersByTimeAsync(200); });

  expect(first.save).not.toHaveBeenCalled();
  expect(second.save).not.toHaveBeenCalled();
});
```

Run the file again; both tests must pass.

- [ ] **Step 7: Mutation-prove both**

Mutant A: change the predicate to `() => true`. The Step 6 test must go RED (it would flush through a shut gate only if `doSave`'s gate check were also broken — if it stays green, that is itself the finding: report it, because it means the §586 gate and not the predicate is doing the work).
Mutant B: change the predicate to `() => false`. The Step 5 test must go RED.
Revert both. Name each mutant and the test it killed in the report.

- [ ] **Step 8: Run the debounce unit suite and neighbours, then tsc and commit**

```bash
ls src/app/debounced-save*
npx vitest run src/app/debounced-save.test.ts src/app/use-storage-backend.rebuild-flush.test.tsx src/app/use-storage-backend.test.tsx > /tmp/t4c.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " /tmp/t4c.log
npx tsc --noEmit; echo "EXIT=$?"
```

If `debounced-save.test.ts` does not exist, drop it from the command and say so in the report.

```bash
git add src/app/debounced-save.ts src/app/use-storage-backend.ts src/app/use-storage-backend.rebuild-flush.test.tsx
git commit -m "fix(storage): §589 — an edit inside the debounce survives a backend rebuild

The save effect lists backend as a dependency, so a rebuild ran the previous
run's cleanup, which cleared the timer without flushing. A switch op's own
flushCurrent covers the nine op paths; a bare settings rebuild had none, so the
edit was never written and left memory when the new target's load applied.

Claude-Session: https://[session link removed]"
```

---

### Task 5: §590 — pick, read, and bind only if accepted

**Files:**
- Modify: `src/app/local-file-backend.ts` — `pickFile()` (lines 95-99)
- Modify: `src/app/storage.ts` — add `pickFileHandleForBackend` beside `loadFromHandleForBackend` (lines 94-105)
- Modify: `src/app/use-storage-file-ops.ts` — `onPickStorageFile` (lines 409-422)
- Modify: `src/app/i18n.ts` and `src/app/i18n.de.ts` — four new keys
- Test: `src/app/use-storage-backend.pick-file.test.tsx` (create)

**Interfaces:**
- Consumes: `isBackendCurrent` (Task 3).
- Produces: `LocalFileBackend.pickFileHandle(): Promise<FsHandle>` (picks without binding) and `pickFileHandleForBackend(backend): Promise<FsHandle> | null` in `storage.ts`. Binding stays `setBackendFileHandle(backend, handle)`, which already exists.

**The model to copy:** `onOpenStorageFile` (`use-storage-file-ops.ts:436-480`) already does exactly this under §287 — `openFileForBackend` returns the handle without binding, `loadFromHandleForBackend` reads it, and `await setBackendFileHandle(deps.backend, picked)` commits **only inside the accept branch**, with the comment "commit the pick ONLY now (§287) — before this line the backend still points at the previous file, so a decline leaves nothing to undo." Read that function before writing this one.

- [ ] **Step 1: Enumerate every caller of the old pick contract**

```bash
grep -rn "pickFileForBackend\|\.pickFile(" src scripts e2e --include=*.ts --include=*.tsx
```

Every hit must be handled in this task or explicitly listed in the report as untouched with the reason. Do not leave a second pick idiom behind.

- [ ] **Step 2: Add the non-binding pick**

In `src/app/local-file-backend.ts`, replace `pickFile()`:

```ts
  /** Pick a save target WITHOUT binding it (§590, mirroring §287's open split).
   *  The caller reads the handle, decides, and binds via `setBackendFileHandle`
   *  — so a decline leaves the backend on the previous file with nothing to undo. */
  async pickFileHandle(): Promise<FsHandle> {
    // showSaveFilePicker grants readwrite implicitly when the user picks a file.
    return pickSaveFile(this.format);
  }
```

Update the `StorageBackend` interface member in `src/app/workspace.ts` to match (the extractor confirmed `StorageBackend` lives there, re-exported through `storage.ts`). In `src/app/storage.ts`, beside `loadFromHandleForBackend`:

```ts
/**
 * Pick a save target from a file-based backend WITHOUT binding it — the pick
 * half of the commit-on-accept split (§590), so a caller can read what the
 * chosen file already contains before committing to overwrite it.
 */
export function pickFileHandleForBackend(backend: StorageBackend): Promise<FsHandle> | null {
  if (backend instanceof LocalFileBackend) return backend.pickFileHandle();
  return null;
}
```

- [ ] **Step 3: Add the four i18n keys (EN)**

In `src/app/i18n.ts`, beside the other `storage*` keys:

```ts
  storagePickFileHasProjectTitle: "That file already holds a project",
  storagePickFileHasProjectBody: "\"{0}\" already contains a project with {1} records. The open project is empty because its last load did not succeed, so saving into this file would replace it.\n\nLoad the existing project from this file instead?",
  storagePickFileLoadInstead: "Load this project",
  storagePickFileCancel: "Cancel",
```

- [ ] **Step 4: Add the DE keys via a node utf8 script — never the Edit tool**

`i18n.de.ts` is CRLF and the Edit tool corrupts its umlauts and curls its quotes. Write and run this script (adjust the anchor to a key that really precedes the insertion point — verify with `grep -n "storageSwitchedToast" src/app/i18n.de.ts` first):

```js
// scratchpad/add-de-keys.mjs
import { readFileSync, writeFileSync } from "node:fs";
const p = "src/app/i18n.de.ts";
const s = readFileSync(p, "utf8");
const anchor = "  storageSwitchedToast:";
if (!s.includes(anchor)) throw new Error("anchor not found — do not guess, re-grep");
const add =
  '  storagePickFileHasProjectTitle: "Diese Datei enthält bereits ein Projekt",\r\n' +
  '  storagePickFileHasProjectBody: "\\"{0}\\" enthält bereits ein Projekt mit {1} Datensätzen. Das geöffnete Projekt ist leer, weil das letzte Laden fehlgeschlagen ist — ein Speichern in diese Datei würde sie ersetzen.\\n\\nStattdessen das vorhandene Projekt aus dieser Datei laden?",\r\n' +
  '  storagePickFileLoadInstead: "Dieses Projekt laden",\r\n' +
  '  storagePickFileCancel: "Abbrechen",\r\n';
writeFileSync(p, s.replace(anchor, add + anchor), "utf8");
```

```bash
node scratchpad/add-de-keys.mjs
grep -c "storagePickFileHasProjectTitle" src/app/i18n.de.ts   # expect 1
node -e "const s=require('fs').readFileSync('src/app/i18n.de.ts','utf8');console.log((s.match(/(?<!\r)\n/g)||[]).length)"   # expect 0 — CRLF intact
grep -n "enthält\|Datensätzen\|geöffnete" src/app/i18n.de.ts | head   # real umlauts, not ue/ae
npx tsc --noEmit; echo "EXIT=$?"   # EN/DE key parity is tsc-enforced
```

- [ ] **Step 5: Rewrite `onPickStorageFile`**

```ts
  async function onPickStorageFile() {
    if (deps.truncationOps.wouldRefuseWrite()) { deps.truncationOps.refuseWrite(); return; } // ★★★ §103: refuse BEFORE the picker. See `refuseWrite` (use-load-truncation.ts).
    const promise = pickFileHandleForBackend(deps.backend);
    if (!promise) return;
    const picked = await promise;
    if (!deps.isBackendCurrent()) return; // §588 — a rebuild landed while the picker was open.
    try {
      // §590 — read BEFORE binding (the §287 split, applied to pick). After a
      // failed load the live workspace is the empty boot one, so writing it
      // into a file that already holds a project destroys that project. The
      // handle is deliberately NOT bound yet: a decline must leave nothing to undo.
      const existing = await readPickedProject(deps.backend, picked);
      if (existing !== null && existing.records > 0 && deps.truncationOps.wouldRefuseWrite() === false && isWorkspaceEmpty(deps.currentWorkspace())) {
        const loadInstead = await deps.confirm({
          title: t(deps.langRef.current, "storagePickFileHasProjectTitle"),
          message: t(deps.langRef.current, "storagePickFileHasProjectBody", picked.name ?? "", existing.records),
          confirmLabel: t(deps.langRef.current, "storagePickFileLoadInstead"),
          cancelLabel: t(deps.langRef.current, "storagePickFileCancel"),
          tone: "default",
        });
        if (!loadInstead) return; // nothing bound, nothing written
        await setBackendFileHandle(deps.backend, picked);
        deps.suppressNextSaveRef.current = true;
        deps.bumpScopeEpoch(); // §548 — another project's data is about to enter scope.
        deps.applyPickedWorkspace(existing.workspace);
        deps.allowSavesToActiveBackend();
        await deps.refreshBackendStatus();
        deps.emitToast("info", t(deps.langRef.current, "storageOpenedToast", existing.workspace.tasks.length));
        return;
      }
      await setBackendFileHandle(deps.backend, picked);
      if (!(await deps.truncationOps.guardedWrite(deps.backend, deps.currentWorkspace()))) return; // ★ Backstop: a truncating load landing between the pre-check and here must still not commit.
      deps.allowSavesToActiveBackend(); // ★★ §586
      await deps.refreshBackendStatus();
      deps.emitToast("info", t(deps.langRef.current, "storageSwitchedToast"));
    } catch (err) {
      deps.emitToast("error", t(deps.langRef.current, "storageSaveFailed", String(err)));
    }
  }
```

Add this helper in the same file, above `onPickStorageFile` — it makes Review Focus item 3 explicit:

```ts
  /** Read a picked handle's project, or null when it holds none. A brand-new
   *  or empty file and an unparseable one are both "no project": the normal
   *  write must proceed, not an offer to load nothing. */
  async function readPickedProject(
    backend: StorageBackend,
    handle: FsHandle,
  ): Promise<{ workspace: Workspace; records: number } | null> {
    const load = loadFromHandleForBackend(backend, handle);
    if (!load) return null;
    try {
      const workspace = await load;
      return { workspace, records: workspaceRecordCount(workspace) };
    } catch {
      return null;
    }
  }
```

Add to `StorageFilePickerDeps`:

```ts
  /** §590 — the branded confirm (`useConfirm`), so the pick can offer to load a
   *  file that already holds a project instead of overwriting it. */
  confirm: ConfirmFn;
  /** §590 — apply a workspace read from the picked file, when the user chose to
   *  load it rather than overwrite it. */
  applyPickedWorkspace: (ws: Workspace) => void;
```

Wire both at the `useStorageFilePickerOps({...})` call site in `use-storage-backend.ts`: `confirm` from `useConfirm()` called at the top of the hook, and `applyPickedWorkspace: (ws) => applyWorkspaceFromLoad(ws, "reset", "replace")` — "replace", because this is another project's file and merging would carry the previous project's activity log into it (§591).

- [ ] **Step 6: Tests — the offer, the decline, the cancel, and the empty file**

Create `src/app/use-storage-backend.pick-file.test.tsx`. The last two tests are Review Focus items 2 and 3. Mock `useConfirm` through `TestProviders` if it supplies the context; otherwise pass a stub `confirm` into `makeArgs`.

```tsx
const POPULATED = { ...populatedWorkspace(), tasks: [aTask, { ...aTask, id: 2 }] };

it("offers to load instead of overwriting when the picked file already holds a project", async () => {
  const confirm = vi.fn().mockResolvedValue(true);
  const backend = makeBackendStub({ loadFrom: vi.fn().mockResolvedValue(POPULATED) });
  vi.mocked(createBackend).mockReturnValue(backend);
  vi.mocked(pickSaveFile).mockResolvedValue({ name: "project.json" } as FsHandle);

  const { result } = renderHook(() => useStorageBackend(makeArgs(fileConfig, { confirm })), { wrapper: TestProviders });
  await act(async () => { await failInitialLoad(backend); }); // live workspace is the empty boot one
  await act(async () => { await result.current.onPickStorageFile(); });

  expect(confirm).toHaveBeenCalledTimes(1);
  expect(backend.save).not.toHaveBeenCalled();
  expect(vi.mocked(idbSet)).toHaveBeenCalled(); // bound only after the accept
});

it("binds nothing and writes nothing when the user declines the offer", async () => {
  const confirm = vi.fn().mockResolvedValue(false);
  const backend = makeBackendStub({ loadFrom: vi.fn().mockResolvedValue(POPULATED) });
  vi.mocked(createBackend).mockReturnValue(backend);
  vi.mocked(pickSaveFile).mockResolvedValue({ name: "project.json" } as FsHandle);

  const { result } = renderHook(() => useStorageBackend(makeArgs(fileConfig, { confirm })), { wrapper: TestProviders });
  await act(async () => { await failInitialLoad(backend); });
  await act(async () => { await result.current.onPickStorageFile(); });

  expect(backend.save).not.toHaveBeenCalled();
  expect(vi.mocked(idbSet)).not.toHaveBeenCalled();
});

it("does nothing at all when the picker is cancelled", async () => {
  const confirm = vi.fn();
  const backend = makeBackendStub();
  vi.mocked(createBackend).mockReturnValue(backend);
  vi.mocked(pickSaveFile).mockRejectedValue(new DOMException("aborted", "AbortError"));

  const { result } = renderHook(() => useStorageBackend(makeArgs(fileConfig, { confirm })), { wrapper: TestProviders });
  await act(async () => { await failInitialLoad(backend); });
  await act(async () => { await result.current.onPickStorageFile(); });

  expect(confirm).not.toHaveBeenCalled();
  expect(backend.save).not.toHaveBeenCalled();
  expect(vi.mocked(idbSet)).not.toHaveBeenCalled();
});

it("writes normally when the picked file is empty or unparseable", async () => {
  const confirm = vi.fn();
  const backend = makeBackendStub({ loadFrom: vi.fn().mockRejectedValue(new Error("bad json")) });
  vi.mocked(createBackend).mockReturnValue(backend);
  vi.mocked(pickSaveFile).mockResolvedValue({ name: "new.json" } as FsHandle);

  const { result } = renderHook(() => useStorageBackend(makeArgs(fileConfig, { confirm })), { wrapper: TestProviders });
  await act(async () => { await failInitialLoad(backend); });
  await act(async () => { await result.current.onPickStorageFile(); });

  expect(confirm).not.toHaveBeenCalled();
  expect(backend.save).toHaveBeenCalledTimes(1);
});
```

`failInitialLoad` rejects the backend's initial `load()` so the live workspace stays the empty boot one and the §586 gate stays shut — copy it from `use-storage-backend.load-gate.test.tsx`, which already drives that state. `pickSaveFile` and `idbSet` need `vi.mock("./fs-access")` and `vi.mock("./idb")`; check the exact module paths with `grep -n "from \"./" src/app/local-file-backend.ts` before writing the mocks.

- [ ] **Step 7: Run, mutate, typecheck**

```bash
npx vitest run src/app/use-storage-backend.pick-file.test.tsx src/app/use-storage-backend.test.tsx > /tmp/t5.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " /tmp/t5.log
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src; echo "EXIT=$?"
```

Mutant: change `existing.records > 0` to `existing.records >= 0`. The "empty or unparseable" test must go RED. Revert; name it in the report.

- [ ] **Step 8: Commit**

```bash
git add src/app/local-file-backend.ts src/app/storage.ts src/app/workspace.ts src/app/use-storage-file-ops.ts src/app/use-storage-backend.ts src/app/i18n.ts src/app/i18n.de.ts src/app/use-storage-backend.pick-file.test.tsx
git commit -m "fix(storage): §590 — Pick storage file reads the chosen file before overwriting it

After a failed load the live workspace is the empty boot one, and Pick wrote it
into whatever file the user chose — replacing a real project when they picked
their own. The pick now follows §287's commit-on-accept split: pick, read, and
bind only if the user goes ahead, offering to load the existing project instead.
Pick stays ungated, because it is the only way a first-time local-file user can
create a file at all.

Claude-Session: https://[session link removed]"
```

---

### Task 6: Tool loop half 1 — cancel on unmount

**Files:**
- Modify: `src/app/chat-panel.tsx` (near the existing Escape effect, lines 432-448)
- Test: `src/app/chat-panel.scope.test.tsx` (create — do NOT grow the 3022-line `chat-panel.test.tsx`)

**Interfaces:**
- Consumes: nothing.
- Produces: nothing consumed later; Task 7 edits the same file.

**The defect:** `chat-panel.tsx` has exactly one effect cleanup and it only removes a keydown listener. Nothing sets `cancelledRef` or aborts on unmount. Under the §548 load hold the panel is swapped for `PanelSkeleton` without a `projectId` prop change, so the dying instance's `projectIdRef` is never bumped and its `stale()` reads not-stale forever — while the setters stay live, because `useStorageBackend` sits in `TaskManager`, which does not unmount.

- [ ] **Step 1: Write the failing test**

```tsx
it("cancels an in-flight send when the panel unmounts", async () => {
  let releaseFetch: (r: unknown) => void = () => {};
  const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
    () => new Promise((res) => { releaseFetch = res as (r: unknown) => void; }),
  );
  const setTasks = vi.fn();
  const { unmount } = renderChat({ dispatcher: dispatcherWith({ setTasks }) });

  await userEvent.type(screen.getByRole("textbox", { name: /message/i }), "add a task");
  await userEvent.click(screen.getByRole("button", { name: /send/i }));

  unmount();
  await act(async () => { releaseFetch(toolUseResponse("create_task")); });

  expect(setTasks).not.toHaveBeenCalled();
});
```

Match `chat-panel.test.tsx`'s idiom: it mocks at the network boundary with `vi.spyOn(globalThis, "fetch")` rather than stubbing `callClaude`, and uses **no fake timers**. Copy `renderChat` / `dispatcherWith` equivalents from that file rather than inventing them; if it has no such helper, lift the smallest render block it uses.

- [ ] **Step 2: Run and confirm it FAILS**

```bash
npx vitest run src/app/chat-panel.scope.test.tsx > /tmp/t6.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests |AssertionError" /tmp/t6.log
```

Expected: FAIL — the orphaned closure runs the tool and calls `setTasks`.

- [ ] **Step 3: Add the unmount cleanup**

In `src/app/chat-panel.tsx`, immediately after the Escape effect (line 448):

```tsx
  // ★★★ Cancel an in-flight send when this panel goes away. Nothing else does:
  // the Escape effect's cleanup only detaches its listener, and the projectId
  // effect fires only on an actual prop change. Under the §548 load hold the
  // whole panel is swapped for PanelSkeleton WITHOUT a projectId change, so the
  // dying instance's projectIdRef is never bumped, its `stale()` reads
  // not-stale forever, and its setters are still live (useStorageBackend lives
  // in TaskManager, which does not unmount) — so a turn in flight across a
  // project swap wrote into the project the user swapped TO.
  // ★ Safe under StrictMode's mount→unmount→mount: submitPrompt resets
  // `cancelledRef` to false at its own start, so a cancelled flag left by a
  // discarded first mount cannot outlive the next send.
  useEffect(() => () => {
    cancelledRef.current = true;
    abortRef.current?.abort();
  }, []);
```

- [ ] **Step 4: Run — it must PASS**

```bash
npx vitest run src/app/chat-panel.scope.test.tsx > /tmp/t6b.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " /tmp/t6b.log
```

- [ ] **Step 5: Pin Review Focus item 4 — StrictMode must not wedge a fresh panel**

```tsx
it("still sends after a StrictMode double-invoked mount", async () => {
  const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(textResponse("hello"));
  renderChat({}, { reactStrictMode: true });   // ★ RTL option, NOT a composed wrapper
  await userEvent.type(screen.getByRole("textbox", { name: /message/i }), "hi");
  await userEvent.click(screen.getByRole("button", { name: /send/i }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalled());
});
```

★★★ Use RTL's `reactStrictMode: true` or `wrapper: StrictMode` — **never** a composed `({children}) => <StrictMode>{children}</StrictMode>`, which makes the test vacuous (it passes with the line it claims to pin deleted). See `src/app/strictmode.meta.test.tsx` before writing this.

- [ ] **Step 6: Mutation-prove, run the big suite, tsc, commit**

Mutant: delete `cancelledRef.current = true;` from the new cleanup. The Step 1 test must go RED. Revert; name it.

```bash
npx vitest run src/app/chat-panel.scope.test.tsx src/app/chat-panel.test.tsx > /tmp/t6c.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " /tmp/t6c.log
npx tsc --noEmit; echo "EXIT=$?"
git add src/app/chat-panel.tsx src/app/chat-panel.scope.test.tsx
git commit -m "fix(ai): §596 — an unmounted chat panel no longer finishes its turn into the next project

Nothing cancelled an in-flight send on unmount: the file's only effect cleanup
detaches a keydown listener, and the projectId effect fires only on an actual
prop change. The §548 load hold swaps the panel for PanelSkeleton without such a
change, so the dying instance's stale() read not-stale forever while its setters
stayed live in TaskManager.

Claude-Session: https://[session link removed]"
```

---

### Task 7: Tool loop half 2 — the scope epoch

**Files:**
- Modify: `src/app/chat-panel.tsx` — props, `stale()` (line 544-545), the per-tool loop (lines 688-715)
- Modify: `src/app/workspace-section.tsx` — the `<ChatPanel …>` JSX (lines 375-398)
- Modify: `src/app/workspace-section-types.ts` — thread `getScopeEpoch` down
- Modify: `src/app/task-manager.tsx` — pass `getScopeEpoch` to `WorkspaceSection`
- Test: `src/app/chat-panel.scope.test.tsx` (from Task 6)

**Interfaces:**
- Consumes: `ScopeEpochReader`, `isScopeStale`, `dropStaleScopeWrite` from `./scope-epoch`.
- Produces: `ChatPanel` prop `getScopeEpoch: ScopeEpochReader` — **REQUIRED, not optional.**

**Why required:** `scope-epoch.ts`'s own header says every pane/deps boundary handing the reader down declares it REQUIRED, because that "is the only thing that can make a missing thread a tsc error instead of silence" — and cites `tasks-section.tsx`'s manual push/pull going unguarded for a whole release precisely because a missing optional prop failed silently. Follow the rule; accept the test churn.

- [ ] **Step 1: Count the render sites the required prop will break**

```bash
grep -n "<ChatPanel" src/app/*.tsx | grep -v "workspace-section"
grep -c "<ChatPanel" src/app/chat-panel.test.tsx
```

Report the counts. Every one needs the prop; in tests pass `() => 0`.

- [ ] **Step 2: Write the failing test**

```tsx
it("drops a tool write when the storage target changed but the project id did not", async () => {
  let epoch = 1;
  let releaseFetch: (r: unknown) => void = () => {};
  vi.spyOn(globalThis, "fetch").mockImplementation(
    () => new Promise((res) => { releaseFetch = res as (r: unknown) => void; }),
  );
  const setTasks = vi.fn();
  renderChat({ getScopeEpoch: () => epoch, dispatcher: dispatcherWith({ setTasks }) });

  await userEvent.type(screen.getByRole("textbox", { name: /message/i }), "add a task");
  await userEvent.click(screen.getByRole("button", { name: /send/i }));

  // A Turso URL change / SharePoint target swap / same-project reload: the
  // epoch moves, the projectId does NOT — the case stale() structurally cannot see.
  epoch = 2;
  await act(async () => { releaseFetch(toolUseResponse("create_task")); });

  expect(setTasks).not.toHaveBeenCalled();
});
```

Run it; expect FAIL (the write lands, because `projectIdRef.current === sendProjectId` stays true).

- [ ] **Step 3: Thread the prop**

Add to `ChatPanelImpl`'s inline prop type (after `tursoConfig`, line 202) and to `ChatPanelInner`'s repeated list:

```ts
  /** §548/§596 — the scope epoch reader. REQUIRED at this pane boundary on
   *  purpose: an optional one fails silently, which is exactly how
   *  tasks-section.tsx went unguarded for a release (see scope-epoch.ts). */
  getScopeEpoch: ScopeEpochReader;
```

In `workspace-section.tsx`'s `<ChatPanel>` JSX add `getScopeEpoch={getScopeEpoch}`; add `getScopeEpoch: ScopeEpochReader` to `WorkspaceSectionProps` in `workspace-section-types.ts`; pass it from `task-manager.tsx` as the bare shorthand `getScopeEpoch`, matching `useInsightRecommendations` (`:2101`) and `useCalendarIntegrations` (`:2367`).

- [ ] **Step 4: Capture the epoch at send and fold it into `stale()`**

After `const sendProjectId = projectId;` (line 505):

```ts
    // §596 — the scope half of this send's binding. `sendProjectId` cannot see a
    // storage-target change that keeps the project id (a Turso URL/token change,
    // a SharePoint target swap, a same-project reload); the epoch can.
    const sendEpoch = getScopeEpoch();
```

Extend `stale()` (line 544-545):

```ts
    const stale = () =>
      cancelledRef.current || projectIdRef.current !== sendProjectId || chatThreads.threadIdRef.current !== sendThreadId || isScopeStale(getScopeEpoch, sendEpoch);
```

That one change covers all three existing check sites (`:577`, `:587`, `:616`).

- [ ] **Step 5: Guard between individual tool calls**

The per-tool `for` loop (lines 688-715) has no staleness check, so a multi-tool turn can write several entities after a swap. Insert as the first statement inside the loop, after the `tool_use` filter (line 689):

```ts
            // §596 — re-check per TOOL, not just per turn: a turn can carry
            // several tool_use blocks and each `runTool` can be slow, so a swap
            // landing mid-batch would otherwise let the remaining tools write
            // into the next project.
            if (dropStaleScopeWrite(getScopeEpoch, sendEpoch, "chat-panel.toolLoop", { tool: block.name })) break;
```

Add the import: `import { dropStaleScopeWrite, isScopeStale, type ScopeEpochReader } from "./scope-epoch";`

- [ ] **Step 6: Run both tests and pin Review Focus item 5**

A multi-tool turn must stop after the first tool when the epoch moves between them:

```tsx
it("stops a multi-tool turn at the tool where the project changed", async () => {
  let epoch = 1;
  const setTasks = vi.fn(() => { epoch = 2; });   // the swap lands DURING the first tool
  const setRaid = vi.fn();
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    twoToolResponse("create_task", "create_raid_item"),
  );

  renderChat({ getScopeEpoch: () => epoch, dispatcher: dispatcherWith({ setTasks, setRaid }) });
  await userEvent.type(screen.getByRole("textbox", { name: /message/i }), "add a task and a risk");
  await userEvent.click(screen.getByRole("button", { name: /send/i }));

  await waitFor(() => expect(setTasks).toHaveBeenCalledTimes(1));
  expect(setRaid).not.toHaveBeenCalled();   // the second tool is dropped, not run
});
```

`twoToolResponse` builds one API response whose `content` carries two `tool_use` blocks — model it on whatever single-tool response helper `chat-panel.test.tsx` already uses, adding a second block with its own `id`.

★ This test is only meaningful because `setTasks` moves the epoch itself. A fixture that moves the epoch before the send starts would be caught by the loop-top check instead and would pass with the per-tool guard deleted — the vacuous shape. Verify by deleting the guard (Step 7, mutant B) and watching it go red.

```bash
npx vitest run src/app/chat-panel.scope.test.tsx src/app/chat-panel.test.tsx > /tmp/t7.log 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " /tmp/t7.log
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src; echo "EXIT=$?"
```

- [ ] **Step 7: Mutation-prove**

Mutant A: drop `|| isScopeStale(getScopeEpoch, sendEpoch)` from `stale()`. The Step 2 test ("drops a tool write when the storage target changed but the project id did not") must go RED.
Mutant B: delete the whole per-tool `dropStaleScopeWrite(...)` line from the loop. The Step 6 test ("stops a multi-tool turn at the tool where the project changed") must go RED — this is what proves the per-tool guard is load-bearing and not shadowed by the loop-top check.

Revert both. Name each mutant and the test it killed in the report; an unnamed mutation claim is uncheckable. If mutant B leaves the suite green, the per-tool test is vacuous — say so rather than claiming the coverage.

- [ ] **Step 8: Commit**

```bash
git add src/app/chat-panel.tsx src/app/workspace-section.tsx src/app/workspace-section-types.ts src/app/task-manager.tsx src/app/chat-panel.scope.test.tsx
git commit -m "fix(ai): §596 — the AI tool loop drops a write whose project is no longer in scope

stale() compares a project id, which cannot see a storage-target change that
keeps it: a Turso URL or token change, a SharePoint target swap, a same-project
reload. The epoch can, and the per-tool re-check closes a multi-tool turn whose
swap lands mid-batch. The prop is required at the pane boundary on purpose.

Claude-Session: https://[session link removed]"
```

---

### Task 8: Register entries and the prose corrections

**Files:**
- Modify: `docs/open-followups.md` (LF, not CRLF) — four new entries and four index rows
- Modify: `docs/AGENTS/platform.md` — the softened tool-loop residual
- Modify: `AGENTS.md` — only if it repeats the soft claim (grep first)

**Interfaces:**
- Consumes: nothing.
- Produces: §596 (closed by Tasks 6-7), §597, §598, §599.

- [ ] **Step 1: Re-verify the numbers are still free on `origin/main`**

```bash
git fetch origin main -q
git show origin/main:docs/open-followups.md | grep -oE "^## [0-9]+\." | grep -oE "[0-9]+" | sort -n | tail -3
```

If §596 is taken, shift the whole block and say so in the report. A § is reserved only once it is on `origin/main`.

- [ ] **Step 2: Write the four entries**

- **§596 — CLOSED by this branch.** The AI tool loop writes into a project swapped mid-call. State all three mechanisms (no unmount cancel; `projectIdRef` frozen because the load hold swaps the panel without a prop change; setters live in `TaskManager`), and that it is unconditional on unmount rather than a race.
- **§597 — OPEN.** `sample-workspace-big.json` and `sample-workspace-huge.json` still carry the stale pre-§577 curated insight. Only the generator reads them. Note that `-huge.json` must never be staged.
- **§598 — OPEN.** The §577 closure note omits that a detector change moves curated sample data — the omission that made pipeline 7271 fail, because no repo-wide sweep was run for tests the detector change invalidated.
- **§599 — OPEN.** The curated insight's `severity` is pinned by nothing; no test compares it, so it can drift from the detector exactly as `variancePct` did.

Each entry needs: a `## NNN. <title> — OPEN|CLOSED <date>` heading, a `**Status:**` line, a `**Work item:** #NN` line, and a matching index row inside the `<!-- INDEX:BEGIN -->` / `<!-- INDEX:END -->` markers. ★★ The markers appear FOUR times in the file — twice inside a fenced sample and twice for real, hundreds of lines below. Edit the REAL ones (the later pair).

- [ ] **Step 3: Create the four GitLab issues and back-fill the numbers**

Each needs a `§NNN:` title prefix and the `source::register` label, per the one-to-one rule. Put the returned `#NN` into each entry's `**Work item:**` line.

- [ ] **Step 4: Correct the softened prose**

```bash
grep -rn "tool loop" docs/AGENTS/platform.md AGENTS.md docs/AGENTS/ai-assistant.md
```

Replace any "can still write into a project swapped mid-call" phrasing with the measured statement: it *will*, on every unmount, and `stale()` cannot see it — now closed by §596. Do not leave a corrected claim next to an uncorrected restatement.

- [ ] **Step 5: Run the register gates**

```bash
npm run followups:index:check; echo "EXIT=$?"
npm run followups:check; echo "EXIT=$?"
npm run docs:symbols:check; echo "EXIT=$?"
npm run docs:claims:check; echo "EXIT=$?"
```

`followups:index:check` exit 1 = drift, exit 2 = could not scan — the two demand opposite responses. Exit 2 means the markers are wrong; fix the markers, do not touch the rows.

- [ ] **Step 6: Commit**

```bash
git add docs/open-followups.md docs/AGENTS/platform.md
git commit -m "docs: §596–§599 — the tool-loop gap, the stale scaled samples, and two §577 closure omissions

§596 records what the 1.12.4 MR called an accepted residual in terms that
understated it: the write is unconditional on unmount, not a race, and the
existing stale() guard structurally cannot see it. Closed by this branch.

Claude-Session: https://[session link removed]"
```

---

## Final gates before the MR

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src e2e scripts; echo "EXIT=$?"
npm run size:check; echo "EXIT=$?"
npm run dup:check; echo "EXIT=$?"
npm run version:check; echo "EXIT=$?"
```

Do NOT run the full vitest suite or the shuffle locally — CI owns both, and the runner slot is shared with a peer session. Run the axe spec only if a surface changed: the §590 confirm is a new dialog, so `npx playwright test e2e/a11y.spec.ts --project=chromium -g "Settings" --workers=1`.
