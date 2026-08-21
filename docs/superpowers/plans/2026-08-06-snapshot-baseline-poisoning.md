# Snapshot Baseline Poisoning — Implementation Plan (§78 + §77)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the Trends auto-capture from writing a snapshot that permanently claims a cadence bucket with the wrong project's data (§77) or with no data at all, flagged as the baseline (§78).

**Architecture:** Two independent gates, one per entry, both on the auto-capture path only.
§78 gains a **content gate** — a pure predicate in `snapshot.ts` that the auto-capture effect consults before writing, so a project with nothing in it is not captured at all.
§77 replaces `use-storage-backend`'s boolean **latch** (`workspaceLoaded`, set true and never reset) with an **identity** comparison: the hook records *which backend* the applied workspace came from, and derives the published boolean during render as `loadedBackend === backend`. Staleness becomes an inequality instead of a flag somebody must remember to clear — and because it is derived in render, no `setState` lands in an effect body (`react-hooks/set-state-in-effect` is a fatal lint error in this repo).

**Tech Stack:** TypeScript · React 19 · vitest 4 + @testing-library/react · Turso (libSQL) storage backend.

---

## Grounding — what was verified against the code before writing this plan

Do not re-derive these; do re-check any you are about to depend on.

| Claim | Where | Verified |
|---|---|---|
| Auto-capture takes `isFirstEver = history.length === 0` and writes it as `isBaseline` | `use-snapshots.ts:164-166` | yes |
| `workspaceLoaded` is set `true` at `use-storage-backend.ts:278` and **never** set `false` anywhere | `grep -n setWorkspaceLoaded src/app/use-storage-backend.ts` → one hit | yes |
| The load effect keys on `[backend, args.hydrated]` | `use-storage-backend.ts:370` | yes |
| `backend` is a `useMemo` whose deps include `args.settings.storageConfig` **and `tursoProjectId`** | `use-storage-backend.ts:112-128` | yes |
| The sole consumer is `task-manager.tsx:512`, passing it as `workspaceReady` | `grep -rn workspaceReady src/app` | yes |
| `pickBaseline` falls back to the **earliest** snapshot when none is flagged | `use-snapshots.ts:100-105` | yes |

### ★★★ The in-code prescription is insufficient, and this plan deliberately departs from it

`use-snapshots.ts:56-63` already records §78 as a KNOWN EXCEPTION and prescribes: *"Gate `isFirstEver` on content if it needs closing — do not overload this flag."*

**Un-flagging the empty row does not close §78.** `pickBaseline` returns the earliest snapshot when no row carries `isBaseline`, so the empty capture is still selected as the baseline — and `hasCurrent` still sees it and claims the bucket, so the real values are never captured for that period either. Gating the *flag* fixes neither half.

This plan gates the **capture**, not the flag. The comment's second clause still holds and is obeyed: `workspaceReady` is not overloaded — it keeps answering "has a load landed", and the new predicate answers "is there anything worth capturing" separately. Task 4 corrects that comment so the next reader is not sent down the insufficient path.

### ★★ The two fixes compose — verify this, do not assume it

`createTursoProject` (`use-storage-turso-ops.ts:119-122`) calls `applyWorkspace(ws)` and `setTursoProjectId(id)` in one batch. Because `tursoProjectId` is a dep of the `backend` memo, the next render has a **new** `backend` while `loadedBackend` still holds the old one — so the §77 gate is CLOSED across the project switch. The load effect then fires for the new backend, applies the (empty, just-created) workspace, and opens the gate; the §78 content gate then declines to capture. Both are needed: §77's gate alone still lets the empty project through once its own load lands, and §78's gate alone does nothing about the wrong-project capture.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `src/app/snapshot.ts` | Pure, i18n-free snapshot assembly | **Modify** — add `hasCapturableContent`, exported beside `buildSnapshot` |
| `src/app/snapshot.test.ts` | Unit tests for the pure module | **Modify** — predicate tests |
| `src/app/use-snapshots.ts` | Capture lifecycle + history | **Modify** — build the context once, gate auto-capture on it; correct the `workspaceReady` doc comment |
| `src/app/use-snapshots.test.tsx` | Hook tests | **Modify** — give the fixture content; add gate tests |
| `src/app/use-storage-backend.ts` | Backend facade + load lifecycle | **Modify** — `loadedBackend` identity replaces the `workspaceLoaded` latch |
| `src/app/use-storage-backend.test.tsx` | Hook tests | **Modify** — add the mid-session switch test |
| `docs/open-followups.md` | The register | **Modify** — close §77 and §78 |

No new files. `snapshot.ts` is the right home for the predicate: it is already the pure module holding `BuildSnapshotInput`, it is DOM-free, and it has no i18n dependency — matching the repo's engine convention.

---

## Task 1: The `hasCapturableContent` predicate

**Files:**
- Modify: `src/app/snapshot.ts` (add after `buildSnapshot`, which ends at `:226`)
- Test: `src/app/snapshot.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/app/snapshot.test.ts` (add `hasCapturableContent` to the existing `./snapshot` import at the top of the file):

```ts
describe("hasCapturableContent", () => {
  const empty = {
    tasks: [] as readonly Task[],
    milestones: [] as readonly Milestone[],
    model: { burndown: null } as unknown as DashboardModel,
  };

  it("is false for a project with no tasks, no milestones and no burndown", () => {
    expect(hasCapturableContent(empty)).toBe(false);
  });

  it("is true when the project has at least one task", () => {
    const task = { id: 1, taskName: "T1" } as unknown as Task;
    expect(hasCapturableContent({ ...empty, tasks: [task] })).toBe(true);
  });

  it("is true when the project has at least one milestone", () => {
    const ms = { id: 1, name: "M1", date: "2026-07-31" } as unknown as Milestone;
    expect(hasCapturableContent({ ...empty, milestones: [ms] })).toBe(true);
  });

  it("is true when a burndown exists even with no tasks or milestones", () => {
    const model = { burndown: { periods: [] } } as unknown as DashboardModel;
    expect(hasCapturableContent({ ...empty, model })).toBe(true);
  });
});
```

If `Task`, `Milestone` or `DashboardModel` are not already imported in this file, add:

```ts
import type { Task, Milestone } from "./types";
import type { DashboardModel } from "./dashboard";
```

★ Confirm `DashboardModel`'s module path first — run `grep -rn "export interface DashboardModel\|export type DashboardModel" src/app` and use whatever it returns. Do not guess it.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
npx vitest run src/app/snapshot.test.ts -t "hasCapturableContent"
```

Expected: FAIL — `hasCapturableContent is not a function` (or a TS/import resolution error naming it).

- [ ] **Step 3: Write the implementation**

Add to `src/app/snapshot.ts`, immediately after `buildSnapshot` ends:

```ts
/** Is there anything in this project worth recording a snapshot of?
 *
 *  ★★★ THIS GUARDS A PERMANENT WRITE. The auto-capture effect claims a cadence
 *  bucket by writing to it, and `hasCurrent` never revisits a claimed bucket —
 *  so a capture taken over an empty project is not merely useless, it costs
 *  that period its real numbers forever. Worse, being the first ever row it is
 *  also flagged `isBaseline`, and every later variance row then compares
 *  against nulls. (open-followups §78.)
 *
 *  ★★ Do NOT "simplify" this to a check on the built record's KPIs. All four
 *  are legitimately null for a real project that has scope but no budget
 *  bucket yet — `model.burndown` needs one — so an output-shaped test would
 *  refuse to snapshot a project that genuinely should be snapshotted.
 *  Scope is the question, so ask it of the INPUT.
 */
export function hasCapturableContent(
  input: Pick<BuildSnapshotInput, "tasks" | "milestones" | "model">,
): boolean {
  return (
    input.tasks.length > 0 ||
    input.milestones.length > 0 ||
    input.model.burndown !== null
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx vitest run src/app/snapshot.test.ts -t "hasCapturableContent"
```

Expected: PASS, 4 tests.

- [ ] **Step 5: Mutation-check the predicate**

Temporarily change `input.tasks.length > 0` to `false` and re-run. Expected: the "at least one task" test FAILS. Restore it. A predicate whose clauses are not individually pinned is the vacuous-test shape this repo keeps re-learning.

- [ ] **Step 6: Commit**

```bash
git add src/app/snapshot.ts src/app/snapshot.test.ts
git commit -F - <<'EOF'
feat: add hasCapturableContent, a scope predicate for snapshot capture

Answers "is there anything worth snapshotting" from the capture INPUT
(tasks / milestones / burndown), not from the built record's KPIs — all
four KPIs are legitimately null for a real project with scope but no
budget bucket.

Unused until the next commit wires it into the auto-capture gate.
EOF
```

---

## Task 2: Gate auto-capture on content (§78)

**Files:**
- Modify: `src/app/use-snapshots.ts:136-188`
- Test: `src/app/use-snapshots.test.tsx`

★★ **Read this before writing the test.** `baseArgs.buildContext` (`use-snapshots.test.tsx:23-30`) returns `tasks: []`, `milestones: []` and `burndown: null` — a context this task's gate is about to classify as empty. Several existing tests rely on that fixture auto-capturing. **They will fail, and that is the gate working.** Give the shared fixture content and add a content-free fixture for the new tests, rather than special-casing each failure.

- [ ] **Step 1: Give the shared fixture real content**

In `src/app/use-snapshots.test.tsx`, replace the `buildContext` value inside `baseArgs` (lines 23-30) with one that has scope:

```ts
  buildContext: () => ({
    model: { progress: { percent: 0 }, overall: { effective: "G" }, schedule: { effective: "G" },
      budget: { effective: null }, scope: { effective: null }, burndown: null,
      evm: { spi: null, cpi: null } },
    tasks: [taskWith(1, "To Do")], milestones: [], planEndDate: "2026-07-31", currency: "EUR",
  }) as unknown as ReturnType<NonNullable<Parameters<typeof useSnapshots>[0]["buildContext"]>>,
```

★ `taskWith` is declared *below* `baseArgs` in this file (at `:36`). That is fine — it is a hoisted `function` declaration and `buildContext` is a closure that is not called until render. Do not reorder the file to "fix" this.

- [ ] **Step 2: Add an empty-context fixture and the gate tests**

Add below `baseArgs`:

```ts
const emptyContextArgs = {
  ...baseArgs,
  buildContext: () => ({
    model: { progress: { percent: 0 }, overall: { effective: "G" }, schedule: { effective: "G" },
      budget: { effective: null }, scope: { effective: null }, burndown: null,
      evm: { spi: null, cpi: null } },
    tasks: [], milestones: [], planEndDate: "2026-07-31", currency: "EUR",
  }) as unknown as ReturnType<NonNullable<Parameters<typeof useSnapshots>[0]["buildContext"]>>,
};
```

Add inside the `describe("useSnapshots", …)` block:

```ts
  // ★★★ open-followups §78: `createTursoProject` applies an EMPTY workspace and
  // changes projectId in one batch, so `workspaceReady` is legitimately true
  // with nothing to capture. Without this gate the effect wrote a null-KPI row
  // that — being the first ever — was also the BASELINE, so every later
  // variance row compared against nulls forever.
  it("does not auto-capture a project with no tasks, milestones or burndown", async () => {
    vi.spyOn(store, "loadSnapshots").mockResolvedValue([]);
    const append = vi.spyOn(store, "appendSnapshot").mockResolvedValue();
    const { result } = renderHook(() => useSnapshots(emptyContextArgs));
    // POSITIVE observable first: prove the effect RAN and reached its decision,
    // so this cannot pass because the hook did nothing at all.
    await waitFor(() => expect(store.loadSnapshots).toHaveBeenCalledTimes(1));
    expect(append).not.toHaveBeenCalled();
    expect(result.current.snapshots).toEqual([]);
  });

  it("still auto-captures once the project has scope", async () => {
    vi.spyOn(store, "loadSnapshots").mockResolvedValue([]);
    const append = vi.spyOn(store, "appendSnapshot").mockResolvedValue();
    renderHook(() => useSnapshots(baseArgs));
    await waitFor(() => expect(append).toHaveBeenCalledTimes(1));
    expect(append.mock.calls[0][1].isBaseline).toBe(true);
  });
```

★★ The first test asserts a **negative** (nothing was appended), which is vacuous unless something proves the setup ran — hence the `loadSnapshots` assertion first. This repo has a recorded lesson on exactly this shape.

- [ ] **Step 3: Run the file to verify the new tests fail and see which old ones moved**

```bash
npx vitest run src/app/use-snapshots.test.tsx > /tmp/snap.log 2>&1; echo "EXIT=$?"; grep -E "Tests |✕|×" /tmp/snap.log
```

Expected: the "does not auto-capture" test FAILS (`append` was called). Note any other failures — after Step 1 gave the fixture content, previously-passing tests should still pass; if one does not, read it before changing it.

★ Never pipe a gate's exit code. Redirect, echo `$?`, then grep the file.

- [ ] **Step 4: Implement the gate**

In `src/app/use-snapshots.ts`, change `makeRecord` to take the context rather than fetching it, so the effect can inspect it once:

```ts
  const makeRecord = useCallback(
    (
      trigger: SnapshotTrigger,
      isBaseline: boolean,
      bucket: string,
      ctx: ReturnType<UseSnapshotsArgs["buildContext"]> = ctxRef.current(),
    ): SnapshotRecord => {
      const capturedAt = new Date().toISOString();
      return { ...buildSnapshot({ ...ctx, capturedAt, cadence, trigger }), bucket, isBaseline };
    },
    [cadence],
  );
```

★ The default parameter keeps `captureNow` / `rebaselineNow` unchanged — they stay three-argument calls and stay **ungated**, deliberately: a manual capture is an explicit user act, and §78 is scoped to auto-capture.

Then in the auto-capture effect, replace the `if (!hasCurrent) { … }` block (`:163-171`) with:

```ts
        const hasCurrent = history.some((s) => s.bucket === currentBucket);
        if (!hasCurrent) {
          const ctx = ctxRef.current();
          // ★★★ open-followups §78. A capture CLAIMS this bucket permanently
          // (`hasCurrent` never revisits it), so an empty project must not be
          // captured at all — un-flagging `isBaseline` would NOT be enough,
          // because `pickBaseline` falls back to the earliest row when none is
          // flagged, and the bucket would still be claimed.
          if (!hasCapturableContent(ctx)) {
            setSnapshots(history);
            return;
          }
          const isFirstEver = history.length === 0;
          const rec = makeRecord("auto", isFirstEver, currentBucket, ctx);
          await storeAppend(cfgRef.current, rec, pidRef.current);
          if (stale()) return;
          setSnapshots([...history, rec]);
        } else {
          setSnapshots(history);
        }
```

Add `hasCapturableContent` to the existing `./snapshot` import.

★ The effect re-runs on `[active, workspaceReady, cadence, currentBucket, args.projectId]`, so once the project gains scope the bucket is captured on the next such change — deferred, not skipped forever, matching the `workspaceReady` gate's own trade.

- [ ] **Step 5: Run the file to verify it passes**

```bash
npx vitest run src/app/use-snapshots.test.tsx > /tmp/snap.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/snap.log
```

Expected: `EXIT=0`, all tests pass.

- [ ] **Step 6: Mutation-check the gate**

Temporarily change `if (!hasCapturableContent(ctx))` to `if (false)` and re-run the file. Expected: "does not auto-capture a project with no tasks, milestones or burndown" FAILS. Restore. If it still passes, the fixture is not actually empty — fix the fixture, not the assertion.

- [ ] **Step 7: Commit**

```bash
git add src/app/use-snapshots.ts src/app/use-snapshots.test.tsx
git commit -F - <<'EOF'
fix: never auto-capture a snapshot of an empty project (open-followups §78)

createTursoProject applies an empty workspace and changes projectId in
one batch, so workspaceReady is legitimately true with nothing to
capture. The effect wrote a null-KPI row which, being the first ever,
was also flagged isBaseline — so every later variance row compared
against nulls, permanently.

Gating isBaseline alone would not have closed it: pickBaseline falls
back to the earliest row when none is flagged, and hasCurrent would
still have claimed the bucket. So the gate is on the CAPTURE.

Manual capture stays ungated — an explicit user act.
EOF
```

---

## Task 3: Replace the `workspaceLoaded` latch with backend identity (§77)

**Files:**
- Modify: `src/app/use-storage-backend.ts:137`, `:262-278`
- Test: `src/app/use-storage-backend.test.tsx`

- [ ] **Step 1: Write the failing test**

Add to `src/app/use-storage-backend.test.tsx`, following whatever render/harness helper that file already uses for the load effect — **read the file's existing load tests first and match their setup rather than inventing one**. The behaviour to pin:

```ts
  // ★★★ open-followups §77: workspaceLoaded was a one-way latch — set true at
  // the end of applyWorkspace and never set false. Pointing Settings at a
  // different backend mid-session re-ran the load with the flag still true from
  // the PREVIOUS project, so snapshot auto-capture could fire against the new
  // projectId while render scope still held the old project's data.
  it("closes the workspaceLoaded gate when the backend changes, until the new load lands", async () => {
    const { result, rerender } = renderWithBackend({ storageConfig: configA });
    await waitFor(() => expect(result.current.workspaceLoaded).toBe(true));

    // Swap to a backend whose load has not resolved yet.
    const pending = deferredLoad();
    rerender({ storageConfig: configB, load: pending.promise });
    expect(result.current.workspaceLoaded).toBe(false);

    await act(async () => { pending.resolve(workspaceWithOneTask); });
    await waitFor(() => expect(result.current.workspaceLoaded).toBe(true));
  });
```

★ `renderWithBackend`, `configA`/`configB`, `deferredLoad` and `workspaceWithOneTask` are **placeholders for whatever this file already provides**. Substitute the real helpers; if the file has no deferred-load helper, write one in the test file rather than reaching into the hook.

- [ ] **Step 2: Run it to verify it fails**

```bash
npx vitest run src/app/use-storage-backend.test.tsx -t "closes the workspaceLoaded gate" > /tmp/sb.log 2>&1; echo "EXIT=$?"; grep -E "Tests |✕|×" /tmp/sb.log
```

Expected: FAIL at `expect(result.current.workspaceLoaded).toBe(false)` — it is still `true` from the previous backend. **That assertion failing is the bug reproducing.** If it passes, stop and re-derive: something else already resets the flag and this entry is stale.

- [ ] **Step 3: Implement the identity gate**

Replace `use-storage-backend.ts:137`:

```ts
  const [workspaceLoaded, setWorkspaceLoaded] = useState(false);
```

with:

```ts
  // ★★★ IDENTITY, NOT A LATCH (open-followups §77). This holds the BACKEND the
  // applied workspace came from, and the published boolean is derived from it
  // below. A boolean flag had to be RESET by whoever started the next load, and
  // nobody did — so a mid-session backend switch re-ran the load with the gate
  // still open over the PREVIOUS project's data, and snapshot capture could
  // write it into the new project's bucket. An inequality cannot be forgotten.
  // ★ Derived in RENDER, not an effect: `react-hooks/set-state-in-effect` is a
  // fatal lint error in this repo, and there is nothing to store anyway.
  const [loadedBackend, setLoadedBackend] = useState<unknown>(null);
```

Add, immediately after the `backend` memo (after `use-storage-backend.ts:128`):

```ts
  // "A workspace from THIS backend has been applied to render scope." Note the
  // `backend` memo's deps include `tursoProjectId`, so this also closes across a
  // project switch — which is the same hazard seen from the other side.
  const workspaceLoaded = loadedBackend !== null && loadedBackend === backend;
```

Replace `use-storage-backend.ts:278` (`setWorkspaceLoaded(true);`) with:

```ts
    setLoadedBackend(backend);
```

Leave the entire `:262-277` comment block above it in place — its reasoning about setting this LAST is unchanged and still load-bearing — but update its first sentence in Task 4.

★ The returned key at `:780` stays `workspaceLoaded`, so `task-manager.tsx:512` and every other consumer are untouched. Confirm with `grep -rn "workspaceLoaded" src/app | grep -v "\.test\."` — expect exactly the hook's own uses plus `task-manager.tsx:455` and `:512`.

- [ ] **Step 4: Run the test to verify it passes**

```bash
npx vitest run src/app/use-storage-backend.test.tsx > /tmp/sb.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/sb.log
```

Expected: `EXIT=0`. ★ This file also holds the pinned "a FAILED load leaves the flag false for the session" test — it must still pass, because a failed load never reaches `applyWorkspace` and so never sets `loadedBackend`.

- [ ] **Step 5: Typecheck**

```bash
npx tsc --noEmit; echo "EXIT=$?"
```

Expected: `EXIT=0`. ★ The IDE's inline diagnostics are mid-edit snapshots — trust `tsc`, not the squiggles.

- [ ] **Step 6: Commit**

```bash
git add src/app/use-storage-backend.ts src/app/use-storage-backend.test.tsx
git commit -F - <<'EOF'
fix: express workspace-loaded as backend identity, not a latch (§77)

workspaceLoaded was set true at the end of applyWorkspace and never set
back to false. The load effect keys on [backend, hydrated], so pointing
Settings at a different backend mid-session re-ran the load with the
gate still open from the previous project — and if the switch also made
tursoConfig non-null, snapshot auto-capture fired and wrote the OLD
project's tasks and budgets into the NEW project's bucket, which
hasCurrent then claimed permanently.

The hook now records WHICH backend the applied workspace came from and
derives the published boolean in render as loadedBackend === backend.
Staleness is an inequality nobody has to remember to clear. The returned
key is unchanged, so no consumer moves.

Because the backend memo depends on tursoProjectId, this also closes the
gate across a project switch.
EOF
```

---

## Task 4: Correct the comments that document these as open

The two entries are described in-code as known-open, and one prescribes a fix this plan deliberately did not take. Leaving them is how this repo's prose outlives its code.

**Files:**
- Modify: `src/app/use-snapshots.ts:56-63`
- Modify: `src/app/use-storage-backend.ts:262-264`

- [ ] **Step 1: Replace the KNOWN EXCEPTION block**

In `src/app/use-snapshots.ts`, replace lines 56-63 (the `★★ KNOWN EXCEPTION — a brand-new project.` paragraph, through `do not overload this flag.`) with:

```
   * ★★ CLOSED, and NOT by this flag — a brand-new project used to slip through
   * here. `createTursoProject` applies an empty workspace and changes
   * `projectId` in one batch, so this flag is legitimately true (data WAS
   * applied — there just isn't any). The capture effect now asks a SEPARATE
   * question first, `hasCapturableContent` (`snapshot.ts`), and declines. This
   * flag still answers only "has a load landed"; it was never overloaded.
   * ★★★ An earlier revision of this comment prescribed gating `isFirstEver` on
   * content instead. That would NOT have closed it: `pickBaseline` below falls
   * back to the EARLIEST row when none is flagged, so the empty capture would
   * still have been the baseline — and `hasCurrent` would still have claimed
   * the bucket. The gate has to be on the CAPTURE. (open-followups §78.)
```

- [ ] **Step 2: Correct the `use-storage-backend` comment's first sentence**

In `src/app/use-storage-backend.ts`, replace lines 262-264 — from `// Publishes "render scope now holds real project data".` through `// (see useSnapshots \`workspaceReady\`).` — with:

```
    // Records WHICH backend this workspace came from; the published
    // `workspaceLoaded` above is derived from it. Snapshot capture gates on
    // that: it is the ONLY thing separating a KPI capture from the boot race
    // against this very load (see useSnapshots `workspaceReady`).
```

Leave everything from `// ★★ Set LAST.` onward untouched.

- [ ] **Step 3: Verify no stale references survive**

```bash
grep -rn "setWorkspaceLoaded\|KNOWN EXCEPTION" src/app; echo "EXIT=$?"
```

Expected: no hits (`EXIT=1` from grep finding nothing is the pass here — read the output, not the code).

- [ ] **Step 4: Run the symbol gate**

```bash
npm run docs:symbols:check > /tmp/sym.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/sym.log
```

Expected: `EXIT=0`.

- [ ] **Step 5: Commit**

```bash
git add src/app/use-snapshots.ts src/app/use-storage-backend.ts
git commit -F - <<'EOF'
docs: correct the two in-code comments that described §77/§78 as open

use-snapshots' KNOWN EXCEPTION block prescribed gating isFirstEver on
content. That would not have closed §78 — pickBaseline falls back to the
earliest row when none is flagged. Records what was actually done and
why the prescribed fix was insufficient.
EOF
```

---

## Task 5: Close §77 and §78 in the register

**Files:**
- Modify: `docs/open-followups.md` — §77 (`:3798`), §78 (`:3830`), the index table, the provenance section

- [ ] **Step 1: Strike both headings**

Change `## 77. The snapshot capture gate is a one-way latch, … — open` to `## 77. ~~The snapshot capture gate is a one-way latch, so a mid-session storage switch can still capture the wrong project~~ — CLOSED`, and the same for §78. Follow the exact formatting of an already-closed entry (e.g. §80 or §81) — heading strike, and the body reduced to what a future reader needs rather than deleted.

- [ ] **Step 2: Record what actually shipped, including the departure**

In each closed body, state the fix in one or two sentences, and for §78 record explicitly that **gating `isFirstEver` would not have sufficed** and why (`pickBaseline`'s earliest-row fallback + `hasCurrent`'s bucket claim). That is the durable finding; without it the next reader re-derives the insufficient fix from the old comment.

- [ ] **Step 3: Update the index table and the provenance section**

Add a provenance row matching the existing format. ★ Whoever merges SECOND renumbers — this repo's recorded convention; git flags the conflict.

- [ ] **Step 4: Commit**

```bash
git add docs/open-followups.md
git commit -F - <<'EOF'
docs: close open-followups §77 and §78

Both halves of the snapshot capture gate. Records why the in-code
prescription for §78 (gate isFirstEver on content) would not have
closed it.
EOF
```

---

## Task 6: Full gates, once

★ Everything before this point ran targeted files only. This is the single full pass. Run these **serially** — never two vitest processes at once; machine saturation is the load condition behind the §39/§51 flakes.

- [ ] **Step 1: Lint at the CI gate, unpiped**

```bash
npx eslint --max-warnings=0 src/app; echo "EXIT=$?"
```

Expected: `EXIT=0`. ★ `npm run lint` is bare `eslint` with no `--max-warnings` and exits 0 with warnings present — it does not reproduce the gate.

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit; echo "EXIT=$?"
```

- [ ] **Step 3: Full unit suite**

```bash
npm run test:run > /tmp/suite.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests |Errors" /tmp/suite.log
```

Expected: `EXIT=0`. ★ Grep for `Errors  N error` too, not just failures — this repo has a recorded mode where the job exits 1 with every test passing.

- [ ] **Step 4: Shuffled suite — only if tests were added or reordered**

This slice adds tests, so run it:

```bash
npm run test:shuffle > /tmp/shuf.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/shuf.log
```

- [ ] **Step 5: Coverage floors**

```bash
npm run test:coverage > /tmp/cov.log 2>&1; echo "EXIT=$?"; grep -E "ERROR|Coverage|All files" /tmp/cov.log
```

Expected: `EXIT=0`. `snapshot.ts` gained an exported function — it is coverage-gated and the new tests cover it, but confirm rather than assume.

- [ ] **Step 6: Skip the axe gate, deliberately**

No JSX, no CSS, no token changes in this slice — nothing axe can see. Do not spend the ~16s. Record the skip in the MR description so it is a decision rather than an omission.

- [ ] **Step 7: Report**

Report the actual exit codes and the `Tests` line from each log. If any gate is red, say so with its output — do not summarise a red run as "mostly green".

---

## Self-review notes

- **Spec coverage:** slice 1 of the triage spec is §78 + §77; Tasks 1-2 close §78, Task 3 closes §77, Tasks 4-5 discharge the register and comment debt the spec's "Register discipline" section requires.
- **Not in scope, deliberately:** manual `captureNow` / `rebaselineNow` stay ungated (§78 is about auto-capture); §67's NUL byte belongs to slice 2; the `use-snapshots.ts` hook is not split (it is under the size ratchet).
- **Type consistency:** `hasCapturableContent` takes `Pick<BuildSnapshotInput, "tasks" | "milestones" | "model">` in Task 1 and is called with the `buildContext()` return in Task 2 — that return is typed `Omit<BuildSnapshotInput, "capturedAt" | "cadence" | "trigger">`, which structurally satisfies the `Pick`. Verify at Task 2 Step 5 via `tsc`, not by eye.
- **Known soft spot:** Task 3 Step 1's test helpers are named generically because `use-storage-backend.test.tsx`'s harness was not read while writing this plan. **Read that file's existing load tests first and match them.** This is the one place the plan hands you a shape rather than the code.
