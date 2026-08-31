# Recoverable destructive-save refusal — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the destructive-save guard's refusal recoverable, then close the undo/redo path and the one-shot-lifetime leak that turn a missed authorisation into lost work.

**Architecture:** Extract the destructive lockout into `use-destructive-save-guard.ts` as the peer of the existing `use-load-truncation.ts`, model a refusal as state carrying its counts, and give it an exit through the same saving-paused banner the truncation lockout already owns. Then make the one-shot bypass structural (read-and-cleared once at the top of the save effect) and have each undo runner arm itself in the direction that removes rows.

**Tech Stack:** Next.js 16 / React, TypeScript, vitest + @testing-library/react, Playwright + axe.

**Spec:** `docs/superpowers/specs/2026-08-30-recoverable-destructive-refusal-design.md`

**Closes:** `docs/open-followups.md` §293, §294, §295

---

## Before you start

Read the spec. It records why §293's own proposed fix (a `DELETE_ROUTES` registry) is deliberately **not** built, and a reviewer who has not read that will ask for it.

Repo landmines that apply throughout:

- **Never read a gate's exit code through a pipe.** Redirect to a file, `echo "EXIT=$?"` unpiped, then read the file. `npm run test:run | tail -8` reports `tail`'s status and discards the failure text.
- **All `src/app/*.ts(x)` are CRLF.** The `Write` tool re-lines a CRLF file to LF; `Edit` preserves it. Never `sed -i` on a source file.
- **`src/app/i18n.de.ts`:** the `Edit` tool corrupts umlauts and curls double quotes there. Patch it with a node UTF-8 write anchored on `\r\n`.
- **`npx tsc --noEmit` exits 2** on diagnostics, not 1.
- **Never run two vitest processes at once.** A red run carrying `Failed to start forks worker` is machine contention, not evidence.
- `npm run lint` exits 1 from gitignored leftovers — use `npx eslint src`.

---

## File structure

| File | Responsibility |
|---|---|
| `src/app/save-guard.ts` | pure verdict; gains `refusedBy` so a surface can pick a confirm tier |
| `src/app/use-destructive-save-guard.ts` | **new** — owns the arm, the baselines, the refusal state and the recourse. Peer of `use-load-truncation.ts` |
| `src/app/use-storage-backend.ts` | consumes the hook; the save effect reads the arm exactly once |
| `src/app/notifications.tsx` | `TruncatedLoadBanner` → `SavingPausedBanner`, discriminated on a cause |
| `src/app/sidebar-footer.tsx` | the paused indicator becomes cause-agnostic (doc only) |
| `src/app/task-manager.tsx` | mounts the banner for either cause; fires the reveal toast |
| `src/app/undo/use-undo-stack.ts` | each runner arms itself in the removing direction |
| `src/app/i18n.ts`, `src/app/i18n.de.ts` | new keys; `storageRefusedWipe` reworded |

---

## Task 1: `refusedBy` on the save-guard verdict

The surface needs to know *which* invariant refused, because the confirm tier depends on it. Pure function, no React.

**Files:**
- Modify: `src/app/save-guard.ts`
- Test: `src/app/save-guard.test.ts`

- [ ] **Step 1: Write the failing tests**

Append inside the existing `describe("evaluateSaveGuard", …)` block in `src/app/save-guard.test.ts`:

```ts
  it("names a full wipe as the refusing invariant", () => {
    const v = evaluateSaveGuard({ prevCollections: 3, prevRecords: 90, curCollections: 0, curRecords: 0, allowDestructive: false });
    expect(v.refuse).toBe(true);
    expect(v.refusedBy).toBe("full-wipe");
  });

  it("names a mass deletion as the refusing invariant", () => {
    const v = evaluateSaveGuard({ prevCollections: 3, prevRecords: 90, curCollections: 3, curRecords: 2, allowDestructive: false });
    expect(v.refuse).toBe(true);
    expect(v.refusedBy).toBe("mass-delete");
  });

  // ★ A full wipe of a multi-collection project is ALSO a mass deletion, so both
  // predicates hold. "full-wipe" must win: it is the larger loss and it selects
  // the heavier confirm tier, so reporting "mass-delete" here would silently
  // downgrade the friction on the one case that most needs it.
  it("reports full-wipe, not mass-delete, when both invariants hold", () => {
    const v = evaluateSaveGuard({ prevCollections: 4, prevRecords: 200, curCollections: 0, curRecords: 0, allowDestructive: false });
    expect(v.refusedBy).toBe("full-wipe");
  });

  it("reports no refusing invariant when the save is allowed", () => {
    const v = evaluateSaveGuard({ prevCollections: 3, prevRecords: 90, curCollections: 3, curRecords: 88, allowDestructive: false });
    expect(v.refuse).toBe(false);
    expect(v.refusedBy).toBeNull();
  });

  it("reports no refusing invariant when an armed bypass lets a wipe through", () => {
    const v = evaluateSaveGuard({ prevCollections: 3, prevRecords: 90, curCollections: 0, curRecords: 0, allowDestructive: true });
    expect(v.refuse).toBe(false);
    expect(v.refusedBy).toBeNull();
  });
```

- [ ] **Step 2: Run them to verify they fail**

```bash
npx vitest run src/app/save-guard.test.ts --reporter=dot > /tmp/t1.log 2>&1; echo "EXIT=$?"; grep -E "Tests |FAIL" /tmp/t1.log
```

Expected: FAIL — `refusedBy` does not exist on the verdict, so tsc-level absence surfaces as `undefined` and every new assertion fails.

- [ ] **Step 3: Add the field**

In `src/app/save-guard.ts`, extend the verdict interface (keep the existing doc comments on `refuse` and `forensic`):

```ts
export interface SaveGuardVerdict {
  /** Withhold the save and tell the user. */
  refuse: boolean;
  /** Let the save through, but leave a forensic record — a single-collection
   *  project emptying itself is legitimate often enough that refusing it would
   *  cost more than it saves. */
  forensic: boolean;
  /** WHICH invariant refused, so the recourse surface can pick its confirm
   *  tier. `null` whenever `refuse` is false.
   *
   *  ★ `"full-wipe"` wins when BOTH hold, which is the common case — emptying a
   *  multi-collection project is a mass deletion too. It is the larger loss and
   *  it selects the heavier type-to-confirm tier, so reporting `"mass-delete"`
   *  here would silently downgrade friction on the case that most needs it. */
  refusedBy: "full-wipe" | "mass-delete" | null;
}
```

and rewrite the function body:

```ts
export function evaluateSaveGuard(input: SaveGuardInput): SaveGuardVerdict {
  const { prevCollections, prevRecords, curCollections, curRecords, allowDestructive } = input;
  const fullWipe = curCollections === 0 && prevCollections >= 2;
  const massDelete = isMassDeletion(prevRecords, curRecords);
  if ((fullWipe || massDelete) && !allowDestructive) {
    return { refuse: true, forensic: false, refusedBy: fullWipe ? "full-wipe" : "mass-delete" };
  }
  return { refuse: false, forensic: curCollections === 0 && prevCollections === 1, refusedBy: null };
}
```

- [ ] **Step 4: Run the tests and typecheck**

```bash
npx vitest run src/app/save-guard.test.ts --reporter=dot > /tmp/t1.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/t1.log
npx tsc --noEmit; echo "EXIT=$?"
```

Expected: all tests pass; tsc EXIT=0.

- [ ] **Step 5: Mutation-check the tie-break**

Temporarily change `refusedBy: fullWipe ? "full-wipe" : "mass-delete"` to `refusedBy: massDelete ? "mass-delete" : "full-wipe"` and re-run. Expected: the "reports full-wipe, not mass-delete, when both invariants hold" test FAILS. Revert with an anchored inverse edit, then confirm `git diff --stat src/app/save-guard.ts` shows only the intended change.

- [ ] **Step 6: Commit**

```bash
git add src/app/save-guard.ts src/app/save-guard.test.ts
git commit --only src/app/save-guard.ts src/app/save-guard.test.ts -m "feat(save-guard): name the refusing invariant on the verdict"
```

---

## Task 2: Extract `use-destructive-save-guard.ts`

Behaviour-preserving move. `use-storage-backend.ts` measures **exactly 800 lines** by the ratchet's own counting method with no baseline entry, so one added line fails `file-size-ratchet`. The file already carries a comment saying so (search it for `800-line ratchet`).

**Files:**
- Create: `src/app/use-destructive-save-guard.ts`
- Create: `src/app/use-destructive-save-guard.test.ts`
- Modify: `src/app/use-storage-backend.ts`

- [ ] **Step 1: Record the starting size**

```bash
node -e "console.log(require('fs').readFileSync('src/app/use-storage-backend.ts','utf8').split('\n').length)"
```

Expected: `800`. Write the number down — Step 6 compares against it. **Do not use `wc -l`**, which reports one fewer.

- [ ] **Step 2: Write the failing test**

Create `src/app/use-destructive-save-guard.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useDestructiveSaveGuard } from "./use-destructive-save-guard";

describe("useDestructiveSaveGuard", () => {
  it("starts unarmed with no standing refusal", () => {
    const { result } = renderHook(() => useDestructiveSaveGuard());
    expect(result.current.refusal).toBeNull();
    expect(result.current.consumeArm()).toBe(false);
  });

  it("arms a one-shot that the first consume spends", () => {
    const { result } = renderHook(() => useDestructiveSaveGuard());
    act(() => { result.current.allowDestructiveSave(); });
    expect(result.current.consumeArm()).toBe(true);
    // ★ The SECOND consume is the assertion that matters — "one-shot" is the
    // whole contract, and a consume that merely READ the ref would pass the
    // line above and fail here.
    expect(result.current.consumeArm()).toBe(false);
  });

  it("refuses a mass deletion against synced baselines and records the counts", () => {
    const { result } = renderHook(() => useDestructiveSaveGuard());
    act(() => { result.current.syncBaselines(3, 90); });
    let verdict!: ReturnType<typeof result.current.evaluate>;
    act(() => { verdict = result.current.evaluate(3, 2, false); });
    expect(verdict.refuse).toBe(true);
    expect(result.current.refusal).toEqual({
      prevCollections: 3, prevRecords: 90, curCollections: 3, curRecords: 2, fullWipe: false,
    });
  });

  it("flags a full wipe on the refusal so the surface can pick the heavier tier", () => {
    const { result } = renderHook(() => useDestructiveSaveGuard());
    act(() => { result.current.syncBaselines(3, 90); });
    act(() => { result.current.evaluate(0, 0, false); });
    expect(result.current.refusal?.fullWipe).toBe(true);
  });

  it("records no refusal when an armed bypass lets the deletion through", () => {
    const { result } = renderHook(() => useDestructiveSaveGuard());
    act(() => { result.current.syncBaselines(3, 90); });
    let verdict!: ReturnType<typeof result.current.evaluate>;
    act(() => { verdict = result.current.evaluate(3, 2, true); });
    expect(verdict.refuse).toBe(false);
    expect(result.current.refusal).toBeNull();
  });

  it("re-arms and clears the refusal when the user saves anyway", () => {
    const { result } = renderHook(() => useDestructiveSaveGuard());
    act(() => { result.current.syncBaselines(3, 90); });
    act(() => { result.current.evaluate(3, 2, false); });
    expect(result.current.refusal).not.toBeNull();
    act(() => { result.current.allowDestructiveSaveAnyway(); });
    expect(result.current.refusal).toBeNull();
    expect(result.current.consumeArm()).toBe(true);
  });

  it("keeps allowDestructiveSave identity-stable across renders", () => {
    // ★ NOT cosmetic: `use-register-tools.ts` lists this callback in an
    // exhaustive `useMemo` deps array that assumes every member is stable. A
    // fresh identity each render rebuilds the AI tool table on every render.
    const { result, rerender } = renderHook(() => useDestructiveSaveGuard());
    const first = result.current.allowDestructiveSave;
    rerender();
    expect(result.current.allowDestructiveSave).toBe(first);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

```bash
npx vitest run src/app/use-destructive-save-guard.test.ts --reporter=dot > /tmp/t2.log 2>&1; echo "EXIT=$?"; grep -E "Tests |Error" /tmp/t2.log
```

Expected: FAIL — `Failed to resolve import "./use-destructive-save-guard"`.

- [ ] **Step 4: Create the hook**

Create `src/app/use-destructive-save-guard.ts`:

```ts
"use client";

// The DESTRUCTIVE save lockout — the peer of `use-load-truncation.ts`, which
// owns the truncation lockout. Both pause saving, both report an ongoing
// blocking state, and both hand the user one explicit way out; keeping them the
// same shape is what lets ONE banner render either cause.
//
// ★★★ THE TWO LOCKOUTS CANNOT BE ACTIVE AT ONCE, and that is a property of the
// save effect's control flow, not a convention: `use-storage-backend.ts` calls
// `mayCommitAfterIncompleteLoad()` and returns EARLY above `evaluate` below, so
// a destructive verdict is unreachable while a truncation lockout stands.
//
// ★★ `evaluate` SETS STATE, and that is why it lives here rather than inline in
// the save effect. `react-hooks/set-state-in-effect` is fatal under
// `--max-warnings=0`, and a bare `setRefusal(...)` written into the effect body
// would trip it. Calling through this module is the same indirection
// `emitToast` already relies on at the very same site. Do NOT inline it back.

import { useCallback, useRef, useState } from "react";
import { evaluateSaveGuard, type SaveGuardVerdict } from "./save-guard";

/** A refusal standing right now: saving is paused until the user authorises the
 *  deletion or reloads.
 *
 *  ★ The COUNTS are the state, not a boolean. The surface has to name a
 *  magnitude ("847 of 900 records"), and a separate boolean beside them would be
 *  a second source of truth that can drift — `use-load-truncation.ts` stores its
 *  counts rather than a flag for exactly this reason. */
export interface DestructiveRefusal {
  prevCollections: number;
  prevRecords: number;
  curCollections: number;
  curRecords: number;
  /** Selects the confirm TIER on the recourse: a full wipe takes
   *  `TypeToConfirmDialog`, a mass deletion the lighter `ConfirmDialog`. */
  fullWipe: boolean;
}

export interface DestructiveSaveGuard {
  /** Arm a one-shot bypass so the NEXT save may destroy data (a confirmed
   *  clear-all / bulk delete). Without this an unexplained mass deletion is
   *  refused by the persistence guard.
   *
   *  ★★★ ARM IN THE SAME SYNCHRONOUS BLOCK AS THE MUTATION. A site that arms,
   *  AWAITS, then mutates loses its permission and its deletion is refused —
   *  every consumer of the workspace counts commits with the mutation, so the
   *  arm must too. Enumerate the sites before adding one:
   *    grep -rn "allowDestructiveSave" src/app --include=*.ts --include=*.tsx */
  allowDestructiveSave: () => void;
  /** The user's exit from a standing refusal: arm the bypass AND clear the
   *  refusal state. Clearing is what re-runs the save effect (the state is one
   *  of its deps), so the authorised save actually WRITES rather than waiting
   *  for an unrelated edit — the same mechanism `allowIncompleteSave` uses. */
  allowDestructiveSaveAnyway: () => void;
  /** The standing refusal, or null. */
  refusal: DestructiveRefusal | null;
  /** Read the one-shot arm and clear it, in one call.
   *
   *  ★★★ THE SAVE EFFECT CALLS THIS ONCE, AT ITS VERY TOP. That is the whole
   *  point: every path below then spends the arm BY CONSTRUCTION, so a new
   *  early return cannot leak a bypass into the next unrelated save. Spending
   *  it used to be a per-early-return obligation written out by hand at each
   *  one, which is open-followups §294. */
  consumeArm: () => boolean;
  /** Run the guard against the stored baselines and record a refusal if it
   *  refuses. Returns the verdict. */
  evaluate: (curCollections: number, curRecords: number, armed: boolean) => SaveGuardVerdict;
  /** Adopt the given counts as the new baselines — a committed save, or a
   *  load/apply the suppress branch is folding in. */
  syncBaselines: (curCollections: number, curRecords: number) => void;
  /** The baselines, for the forensic record a refusal writes. */
  readBaselines: () => { collections: number; records: number };
  /** Drop a standing refusal without arming anything — a save committed. */
  clearRefusal: () => void;
}

export function useDestructiveSaveGuard(): DestructiveSaveGuard {
  // Non-empty-collection count of the last observed workspace — drives the
  // Layer-3 persistence guard against a multi-collection simultaneous wipe.
  const prevCollectionCountRef = useRef(0);
  // Total record count of the last observed workspace — drives the Layer-B
  // mass-deletion guard.
  const prevRecordCountRef = useRef(0);
  // One-shot bypass for the L3/B guards, set by an explicit user bulk-op
  // (clear-all / bulk delete) and consumed by the next save.
  const allowDestructiveRef = useRef(false);
  const [refusal, setRefusal] = useState<DestructiveRefusal | null>(null);

  // ★ useCallback with EMPTY deps: it only writes a ref, so it closes over
  // nothing that can go stale — and `use-register-tools.ts` lists it in an
  // exhaustive useMemo deps array that assumes every member is identity-stable.
  const allowDestructiveSave = useCallback(() => { allowDestructiveRef.current = true; }, []);

  const allowDestructiveSaveAnyway = useCallback(() => {
    allowDestructiveRef.current = true;
    setRefusal(null);
  }, []);

  const clearRefusal = useCallback(() => { setRefusal(null); }, []);

  const consumeArm = (): boolean => {
    const armed = allowDestructiveRef.current;
    allowDestructiveRef.current = false;
    return armed;
  };

  const syncBaselines = (curCollections: number, curRecords: number): void => {
    prevCollectionCountRef.current = curCollections;
    prevRecordCountRef.current = curRecords;
  };

  const readBaselines = () => ({
    collections: prevCollectionCountRef.current,
    records: prevRecordCountRef.current,
  });

  const evaluate = (curCollections: number, curRecords: number, armed: boolean): SaveGuardVerdict => {
    const prevCollections = prevCollectionCountRef.current;
    const prevRecords = prevRecordCountRef.current;
    const verdict = evaluateSaveGuard({ prevCollections, prevRecords, curCollections, curRecords, allowDestructive: armed });
    if (verdict.refuse) {
      setRefusal({ prevCollections, prevRecords, curCollections, curRecords, fullWipe: verdict.refusedBy === "full-wipe" });
    }
    return verdict;
  };

  return {
    allowDestructiveSave, allowDestructiveSaveAnyway, refusal,
    consumeArm, evaluate, syncBaselines, readBaselines, clearRefusal,
  };
}
```

- [ ] **Step 5: Run the new test**

```bash
npx vitest run src/app/use-destructive-save-guard.test.ts --reporter=dot > /tmp/t2.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/t2.log
```

Expected: 7 passed.

- [ ] **Step 6: Rewire `use-storage-backend.ts`, deleting the moved code**

Delete these lines from `src/app/use-storage-backend.ts` (they are now in the hook) — the two baseline refs with their comments, the arm ref with its comment, and `allowDestructiveSave`:

```ts
  // Non-empty-collection count of the last observed workspace — drives the
  // Layer-3 persistence guard against a multi-collection simultaneous wipe.
  const prevCollectionCountRef = useRef(0);
  // Total record count of the last observed workspace — drives the Layer-B
  // mass-deletion guard.
  const prevRecordCountRef = useRef(0);
  // One-shot bypass for the L3/B guards, set by an explicit user bulk-op
  // (clear-all / bulk delete) via allowDestructiveSave() and consumed by the
  // next save.
  const allowDestructiveRef = useRef(false);
  /** Arm a one-shot bypass so the NEXT save may destroy data (a confirmed
   *  clear-all / bulk delete). Without this an unexplained mass deletion is
   *  refused by the persistence guard. */
  const allowDestructiveSave = useCallback(() => { allowDestructiveRef.current = true; }, []); // ★ useCallback with EMPTY deps: it only writes a ref, so it closes over nothing that can go stale — and use-register-tools.ts lists it in an exhaustive useMemo deps array that assumes every member is identity-stable.
```

Replace with a single call, immediately above the existing `useLoadTruncation` call so the two lockouts read as the pair they are:

```ts
  // ★★ The DESTRUCTIVE lockout. Its peer is `useLoadTruncation` directly below;
  // the two cannot be active at once (see that hook's header for why).
  const destructive = useDestructiveSaveGuard();
  const allowDestructiveSave = destructive.allowDestructiveSave;
```

Add the import beside the other local hook imports:

```ts
import { useDestructiveSaveGuard } from "./use-destructive-save-guard";
```

Now update the three sites inside the save effect that used the moved refs. Replace:

```ts
      prevCollectionCountRef.current = curCollections; // sync baselines on a load/apply
      prevRecordCountRef.current = curRecords;
```

with:

```ts
      destructive.syncBaselines(curCollections, curRecords); // sync baselines on a load/apply
```

Replace:

```ts
    if (!mayCommitAfterIncompleteLoad()) { allowDestructiveRef.current = false; return; }
```

with (keeping the existing `// ★★★ SPEND the bypass here too` trailing comment):

```ts
    if (!mayCommitAfterIncompleteLoad()) { destructive.consumeArm(); return; }
```

Replace the verdict block:

```ts
    const verdict = evaluateSaveGuard({ prevCollections: prevCollectionCountRef.current, prevRecords: prevRecordCountRef.current, curCollections, curRecords, allowDestructive: allowDestructiveRef.current });
    if (verdict.refuse) {
      recordDataLossEvent({ path: "save-effect", prevCollections: prevCollectionCountRef.current, nextCollections: curCollections, refused: true });
```

with:

```ts
    const verdict = destructive.evaluate(curCollections, curRecords, destructive.consumeArm());
    if (verdict.refuse) {
      recordDataLossEvent({ path: "save-effect", prevCollections: destructive.readBaselines().collections, nextCollections: curCollections, refused: true });
```

Replace the consume-and-commit trio:

```ts
    allowDestructiveRef.current = false; // consume the one-shot bypass
    prevCollectionCountRef.current = curCollections;
    prevRecordCountRef.current = curRecords;
```

with:

```ts
    destructive.syncBaselines(curCollections, curRecords);
```

Finally, remove `evaluateSaveGuard` from this file's imports if nothing else uses it:

```bash
grep -n "evaluateSaveGuard" src/app/use-storage-backend.ts
```

If the only remaining hit is the import line, delete it. `useCallback` may also now be unused — check with the same method; `--max-warnings=0` makes an unused import fatal.

- [ ] **Step 7: Verify the extraction is behaviour-preserving and the ratchet has headroom**

```bash
npx vitest run src/app/use-storage-backend.test.tsx src/app/use-storage-backend.steering.test.tsx --reporter=dot > /tmp/t2b.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/t2b.log
npx tsc --noEmit; echo "EXIT=$?"
npx eslint src; echo "EXIT=$?"
node -e "console.log('use-storage-backend.ts:', require('fs').readFileSync('src/app/use-storage-backend.ts','utf8').split('\n').length)"
npm run size:check > /tmp/size.log 2>&1; echo "EXIT=$?"; tail -3 /tmp/size.log
```

Expected: all existing storage tests pass unchanged, tsc EXIT=0, eslint EXIT=0, `size:check` EXIT=0.

**Gate:** the printed line count must leave at least **20 lines** of headroom below 800. If it does not, stop and do the fallback extraction below before continuing — Tasks 3 and 4 both add lines to this file.

- [ ] **Step 8 (only if Step 7's headroom gate failed): fallback extraction**

Move the four file-picker actions — `onPickStorageFile`, `onGrantWriteAccess`, `onOpenStorageFile`, `onRequestStorageSwitch` — out of `use-storage-backend.ts` into `src/app/use-storage-file-ops.ts`, which already holds `useFileProjectOps` and is the established sibling for exactly this. Thread whatever each needs as parameters rather than widening the hook's dep object. Commit this separately from Step 9 so the diff stays readable. Re-run Step 7 and confirm the headroom gate now passes.

- [ ] **Step 9: Commit**

```bash
git add src/app/use-destructive-save-guard.ts src/app/use-destructive-save-guard.test.ts src/app/use-storage-backend.ts
git commit --only src/app/use-destructive-save-guard.ts src/app/use-destructive-save-guard.test.ts src/app/use-storage-backend.ts -m "refactor(storage): extract the destructive save lockout as use-load-truncation's peer"
```

- [ ] **Step 10: Re-check the doc-claims ratchet**

An extraction invalidates every `path:LINE` citation below the moved code, including ones written in the same commit.

```bash
npm run docs:claims:check > /tmp/claims.log 2>&1; echo "EXIT=$?"; tail -2 /tmp/claims.log
```

Expected: EXIT=0. If it fails, fix the citation by converting it to a symbol plus a grep — do **not** re-baseline.

---

## Task 3: The one-shot becomes structural (§294)

Hoist the arm read to the top of the save effect so every path below spends it by construction.

**★★★ THIS TASK CHANGES NO BEHAVIOUR ON ANY REACHABLE PATH, AND HAS NO NEW TEST. READ THIS BEFORE
LOOKING FOR ONE.** Walk the five early returns: truncation and suppress-after-load already spend
the arm explicitly, so the hoist only relocates their spend; `verdict.refuse` has nothing to spend,
because `evaluateSaveGuard` refuses only when `!allowDestructive` and so reaching that branch
already implies the arm was false; nothing arms before hydration; and a popout returns before the
guard is consulted. The value is entirely prospective — a NEW early return added below the hoist
cannot leak the one-shot, because there is no longer a ref for it to leak.

A test claiming to pin this hoist would be measuring nothing. Writing one anyway would be worse
than having none: it would read as protection and stop the next audit. The safety net here is the
four existing leak/control tests, tsc, and reading the five returns.

**Files:**
- Modify: `src/app/use-storage-backend.ts`

- [ ] **Step 1: Read the four existing tests you must not break**

```bash
grep -n "destructive bypass" src/app/use-storage-backend.test.tsx
```

Expected: four tests — a leak test and a control for each of the truncation return and the
suppress-after-load return. **The controls are load-bearing.** A cold review once mutated
`save-guard.ts` to refuse every mass deletion regardless of the arm and both *leak* tests still
passed while all four controls failed. Read all four before editing; they are the only thing that
will catch a hoist that is subtly wrong.

- [ ] **Step 2: Hoist the consume**

In `src/app/use-storage-backend.ts`, make this the very first statement of the save effect body —
**above** `if (!args.hydrated) return;`:

```ts
  // Save workspace to backend on change (debounced 500ms)
  useEffect(() => {
    // ★★★ §294 — READ THE ONE-SHOT ONCE, HERE, AND CLEAR IT. Every path below
    // therefore spends the arm BY CONSTRUCTION, and the reader's question at a
    // new early return becomes "does this path USE `armed`", which cannot be
    // skipped. Spending it used to be decided by hand at each return: two
    // returns decided it and three left it by accident, and nothing checked
    // either.
    // ★★★ THIS IS A REFACTOR, NOT A FIX — it changes no behaviour on any
    // currently reachable path, and no test can tell the two arrangements
    // apart. The truncation and suppress returns already spent the arm; the
    // refusal branch has nothing to spend (`evaluateSaveGuard` refuses only
    // when `!allowDestructive`, so reaching it implies the arm was false);
    // nothing arms before hydration; a popout returns above the guard. The
    // value is prospective: a return added below this line cannot leak.
    // ★★ TOPMOST IS THE ONLY PLACEMENT WORTH HAVING. `allowDestructiveRef` is
    // read by nothing outside `use-destructive-save-guard.ts` — the other save
    // paths (`guardedWrite`, `flushCurrent` in use-load-truncation.ts) never
    // consult it — so an arm can only ever be consumed HERE. Anywhere lower
    // leaves the returns above it as exactly the hand-decided cases §294 is
    // about.
    const armed = destructive.consumeArm();
    if (!args.hydrated) return;
```

Delete the now-redundant consume at the truncation return, keeping the rest of the line and its
§103 comment intact:

```ts
    if (!mayCommitAfterIncompleteLoad()) { return; }
```

Change the verdict line to use the local:

```ts
    const verdict = destructive.evaluate(curCollections, curRecords, armed);
```

In the suppress-after-load branch, delete the `destructive.consumeArm();` Task 2 left there.
**Keep the whole comment block above it** — its baseline-resync rationale and its
arm-and-mutate-atomically warning are both still true and are cited from elsewhere. Add one line
recording where the spend went:

```ts
      // ★ The spend that used to sit here is now at the TOP of this effect, so
      // this branch spends by construction like every other. The resync
      // rationale below is unchanged and still the reason it is SAFE to spend.
```

- [ ] **Step 3: Verify nothing changed**

```bash
npx vitest run src/app/use-storage-backend.test.tsx src/app/use-storage-backend.steering.test.tsx --reporter=dot > /tmp/t3.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/t3.log
npx tsc --noEmit; echo "EXIT=$?"
npx eslint src; echo "EXIT=$?"
```

Expected: every test passes, including the four bypass tests, **unmodified**. If one needed
editing, the hoist changed behaviour and that is a bug in this task, not a test to update.

- [ ] **Step 4: Prove the four controls still discriminate**

The refactor is invisible to the suite, so confirm the suite can still see a real break. Mutate
`src/app/save-guard.ts` to refuse regardless of the arm:

```ts
  if (fullWipe || massDelete) return { refuse: true, forensic: false, refusedBy: fullWipe ? "full-wipe" : "mass-delete" };
```

Run the storage suite. Expected: **the two control tests fail** ("still honours a bypass armed
AFTER the truncation is resolved" and its suppress-branch twin) while the two leak tests still
pass — the same asymmetry the original cold review measured. Revert with an anchored inverse
edit and confirm `git diff --stat src/app/save-guard.ts` is empty.

- [ ] **Step 5: Commit**

```bash
git add src/app/use-storage-backend.ts
git commit --only src/app/use-storage-backend.ts -m "refactor(storage): spend the destructive one-shot by construction, not per early return"
```

---

## Task 4: The refusal becomes state, and the save outage gets pinned

No UI yet. This task wires the refusal state through the effect's deps so the recourse re-triggers a save, and pins the outage claim the spec flags as reasoned-but-unmeasured.

**Files:**
- Modify: `src/app/use-storage-backend.ts`
- Test: `src/app/use-storage-backend.test.tsx`

- [ ] **Step 1: Write the failing tests**

Add these to `src/app/use-storage-backend.test.tsx` beside the four bypass tests. They reuse that
file's existing `useReloadableBackend` fixture and `manyTasks` (20 rows), so deleting down to one
row is a 19-of-20 mass deletion.

```tsx
  // ── a refusal is a standing OUTAGE, not one lost save ─────────────────────
  // ★★★ The refusal keeps the baselines ("so a later change re-evaluates"), so
  // `prevRecords` stays at 20 while `curRecords` stays at 1 — `isMassDeletion`
  // keeps answering true and EVERY later save re-refuses. Saving is paused
  // until the user authorises the deletion or reloads, which is why the
  // recourse needs a persistent surface and not only a 7-second toast.
  it("keeps refusing every later save while a refusal stands", async () => {
    const backend = useReloadableBackend();
    const { result } = renderBackend();
    await act(async () => { await Promise.resolve(); });
    await act(async () => { vi.advanceTimersByTime(600); });
    await act(async () => { await Promise.resolve(); });
    backend.save.mockClear();

    // An UNARMED 19-of-20 deletion: refused.
    await act(async () => { result.current.setTasks([{ id: 1, taskName: "T" }] as unknown as Task[]); });
    await act(async () => { vi.advanceTimersByTime(600); });
    await act(async () => { await Promise.resolve(); });
    expect(backend.save).not.toHaveBeenCalled();
    expect(result.current.destructiveRefusal).not.toBeNull();

    // An unrelated, entirely harmless edit afterwards. The baselines still say
    // 20, so this save is judged as the same mass deletion and refused again.
    await act(async () => { result.current.setTasks([{ id: 1, taskName: "renamed" }] as unknown as Task[]); });
    await act(async () => { vi.advanceTimersByTime(600); });
    await act(async () => { await Promise.resolve(); });
    expect(backend.save).not.toHaveBeenCalled();
    expect(result.current.destructiveRefusal).not.toBeNull();
  });

  it("commits the pending deletion when the user saves anyway", async () => {
    // ★ The SAVE is the assertion, not the cleared state. Clearing alone would
    // pass against a version that armed nothing — the point is that clearing
    // RE-RUNS the effect, so the authorised write happens without waiting for
    // an unrelated edit. With saving paused there may never be one.
    const backend = useReloadableBackend();
    const { result } = renderBackend();
    await act(async () => { await Promise.resolve(); });
    await act(async () => { vi.advanceTimersByTime(600); });
    await act(async () => { await Promise.resolve(); });
    backend.save.mockClear();

    await act(async () => { result.current.setTasks([{ id: 1, taskName: "T" }] as unknown as Task[]); });
    await act(async () => { vi.advanceTimersByTime(600); });
    await act(async () => { await Promise.resolve(); });
    expect(backend.save).not.toHaveBeenCalled();

    await act(async () => { result.current.allowDestructiveSaveAnyway(); });
    await act(async () => { vi.advanceTimersByTime(600); });
    await act(async () => { await Promise.resolve(); });

    expect(backend.save).toHaveBeenCalledWith(
      expect.objectContaining({ tasks: [expect.objectContaining({ id: 1, taskName: "T" })] }),
    );
    expect(result.current.destructiveRefusal).toBeNull();
  });

  it("clears a standing refusal once a save commits", async () => {
    const backend = useReloadableBackend();
    const { result } = renderBackend();
    await act(async () => { await Promise.resolve(); });
    await act(async () => { vi.advanceTimersByTime(600); });
    await act(async () => { await Promise.resolve(); });
    backend.save.mockClear();

    await act(async () => { result.current.setTasks([{ id: 1, taskName: "T" }] as unknown as Task[]); });
    await act(async () => { vi.advanceTimersByTime(600); });
    await act(async () => { await Promise.resolve(); });
    await act(async () => { result.current.allowDestructiveSaveAnyway(); });
    await act(async () => { vi.advanceTimersByTime(600); });
    await act(async () => { await Promise.resolve(); });
    expect(result.current.destructiveRefusal).toBeNull();

    // And an ordinary edit afterwards neither refuses nor re-raises it: the
    // baselines were adopted by the commit, so 1 -> 1 is no deletion at all.
    backend.save.mockClear();
    await act(async () => { result.current.setTasks([{ id: 1, taskName: "later" }] as unknown as Task[]); });
    await act(async () => { vi.advanceTimersByTime(600); });
    await act(async () => { await Promise.resolve(); });
    expect(backend.save).toHaveBeenCalled();
    expect(result.current.destructiveRefusal).toBeNull();
  });
```

- [ ] **Step 2: Run to verify they fail**

```bash
npx vitest run src/app/use-storage-backend.test.tsx --reporter=dot > /tmp/t4.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/t4.log
```

Expected: the three new tests fail — nothing exposes `destructiveRefusal` or `allowDestructiveSaveAnyway` yet.

- [ ] **Step 3: Expose the refusal and the recourse**

In `src/app/use-storage-backend.ts`, clear a standing refusal when a save commits. Immediately after the `syncBaselines` call on the commit path:

```ts
    destructive.syncBaselines(curCollections, curRecords);
    destructive.clearRefusal(); // a committed save resolves any standing refusal
```

Add `destructive.refusal` to the save effect's dep array, beside `loadWasIncomplete`, and extend the comment directly above it — **keep the eslint-disable directive immediately above the deps line; a comment between them silently voids it**:

```ts
    // ★ `loadWasIncomplete` is a dep so LOWERING it (the user's "save anyway") re-runs this effect
    // and the escape actually WRITES — otherwise it no-ops until the next unrelated edit. ★★ Keep
    // the disable directive DIRECTLY below: a comment between it and the deps line silently voids it.
    // ★ `destructive.refusal` is a dep for the SAME reason: clearing it is what
    // `allowDestructiveSaveAnyway` does, and without the dep the authorised save
    // would wait for an unrelated edit — with saving paused, there may not be one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [/* every existing dep, in its existing order, unchanged */ args.hydrated, args.isPopout, backend, loadWasIncomplete, destructive.refusal]);
```

Add both members to the hook's return object, beside `allowDestructiveSave`:

```ts
    allowDestructiveSave,
    allowDestructiveSaveAnyway: destructive.allowDestructiveSaveAnyway,
    destructiveRefusal: destructive.refusal,
```

- [ ] **Step 4: Run the tests**

```bash
npx vitest run src/app/use-storage-backend.test.tsx --reporter=dot > /tmp/t4.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/t4.log
npx tsc --noEmit; echo "EXIT=$?"
```

Expected: all pass.

- [ ] **Step 5: Mutation-check the outage test**

Temporarily add `destructive.syncBaselines(curCollections, curRecords);` to the refusal branch (which is what "resync on refusal" would mean) and re-run. Expected: **"keeps refusing every later save while a refusal stands" FAILS** — that is the mutant which proves the test measures the outage rather than the single refusal. Revert with an anchored inverse edit; confirm `git diff --stat` is clean of it.

- [ ] **Step 6: Commit**

```bash
git add src/app/use-storage-backend.ts src/app/use-storage-backend.test.tsx
git commit --only src/app/use-storage-backend.ts src/app/use-storage-backend.test.tsx -m "feat(storage): model a destructive refusal as state with an explicit recourse"
```

---

## Task 5: i18n keys

**Files:**
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts`

- [ ] **Step 1: Add the EN keys**

In `src/app/i18n.ts`, beside `storageRefusedWipe`:

```ts
  storageDestructiveBanner: "Saving is paused. A large deletion was withheld to protect your project.",
  storageDestructiveBannerAria: "Saving paused - a large deletion was withheld",
  storageDestructiveCount: "{0} of {1} records would be removed.",
  storageDestructiveWipeCount: "Every record in this project would be removed.",
  storageDestructiveSaveAnyway: "Save this deletion",
  storageDestructiveConfirmTitle: "Save this deletion?",
  storageDestructiveConfirmBody: "If you did not do this, reload the page instead - your saved data is intact.",
  storageDestructiveWipeConfirmTitle: "Save this wipe?",
  storageDestructiveWipeConfirmBody: "This removes every record in the project. If you did not do this, reload the page instead - your saved data is intact.",
  storageDestructiveWipeConfirmValue: "yes, save this wipe",
```

and reword the existing key in place — it is the toast, its only non-test call site is the save effect, and it currently advises the one gesture that discards the work:

```ts
  storageRefusedWipe: "Saving is paused - a large deletion was withheld. Review it in the banner above, or reload the page to restore your saved data.",
```

- [ ] **Step 2: Add the DE keys**

**Do not use the Edit tool on `i18n.de.ts`** — it corrupts umlauts and curls double quotes there. The file is CRLF, so a `\n`-anchored node replace silently no-ops; anchor on `\r\n`. Write with a node UTF-8 script:

```bash
node -e '
const fs = require("fs");
const p = "src/app/i18n.de.ts";
let s = fs.readFileSync(p, "utf8");
const anchor = "  storageRefusedWipe:";
if (!s.includes(anchor)) throw new Error("anchor not found");
const added = [
  "  storageDestructiveBanner: \"Das Speichern ist pausiert. Eine große Löschung wurde zurückgehalten, um Ihr Projekt zu schützen.\",",
  "  storageDestructiveBannerAria: \"Speichern pausiert - eine große Löschung wurde zurückgehalten\",",
  "  storageDestructiveCount: \"{0} von {1} Datensätzen würden entfernt.\",",
  "  storageDestructiveWipeCount: \"Alle Datensätze in diesem Projekt würden entfernt.\",",
  "  storageDestructiveSaveAnyway: \"Diese Löschung speichern\",",
  "  storageDestructiveConfirmTitle: \"Diese Löschung speichern?\",",
  "  storageDestructiveConfirmBody: \"Falls Sie das nicht ausgelöst haben, laden Sie die Seite neu - Ihre gespeicherten Daten sind intakt.\",",
  "  storageDestructiveWipeConfirmTitle: \"Diese vollständige Löschung speichern?\",",
  "  storageDestructiveWipeConfirmBody: \"Damit werden alle Datensätze des Projekts entfernt. Falls Sie das nicht ausgelöst haben, laden Sie die Seite neu - Ihre gespeicherten Daten sind intakt.\",",
  "  storageDestructiveWipeConfirmValue: \"ja, diese löschung speichern\",",
].join("\r\n") + "\r\n";
s = s.replace(anchor, added + anchor);
fs.writeFileSync(p, s, "utf8");
console.log("inserted");
'
```

Then reword the DE toast the same way, again by node write, replacing the whole `storageRefusedWipe:` line with:

```
  storageRefusedWipe: "Das Speichern ist pausiert - eine große Löschung wurde zurückgehalten. Prüfen Sie sie im Hinweis oben, oder laden Sie die Seite neu, um Ihre gespeicherten Daten wiederherzustellen.",
```

- [ ] **Step 3: Verify encoding, parity and line endings**

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx vitest run src/app/i18n-encoding.test.ts --reporter=dot > /tmp/t5.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/t5.log
git ls-files --eol src/app/i18n.de.ts
grep -c "ö\|ü\|ä\|ß" src/app/i18n.de.ts
```

Expected: tsc EXIT=0 (it enforces EN/DE key parity); the encoding test passes (it bans ASCII substitutions like `fuer`/`gross` **and** `\u00XX` escapes); `git ls-files --eol` reports `i/lf w/crlf`, which is healthy here — `i/lf w/lf` means the file was re-lined and must be restored.

- [ ] **Step 4: Commit**

```bash
git add src/app/i18n.ts src/app/i18n.de.ts
git commit --only src/app/i18n.ts src/app/i18n.de.ts -m "feat(i18n): strings for the recoverable destructive-save refusal"
```

---

## Task 6: Generalise the banner to a cause

`TruncatedLoadBanner` becomes `SavingPausedBanner`, discriminated on a cause. The truncation branch must be **behaviourally unchanged** — this task adds no destructive branch.

**Files:**
- Modify: `src/app/notifications.tsx`
- Modify: `src/app/task-manager.tsx` (the one mount + import)
- Test: `src/app/notifications.test.tsx`

- [ ] **Step 1: Find every reference before renaming**

```bash
grep -rn "TruncatedLoadBanner" src e2e
```

Every hit must be updated in this task; a stale one is a compile error, which is the good case, but an `e2e` string match would fail only in CI.

- [ ] **Step 2: Write the failing test**

Add to `src/app/notifications.test.tsx` (create it if absent, mirroring a sibling component test's setup):

```tsx
  it("renders the truncation cause with its own headline and counts", () => {
    render(
      <SavingPausedBanner
        lang="en-US"
        cause={{ kind: "truncation", truncation: { entries: 3, blocks: 0 }, decodeFailureCount: 0, malformedQuoteCount: 0 }}
        dismissed={false}
        hasFooterIndicator
        onSaveAnyway={() => {}}
        onDismiss={() => {}}
        onReopen={() => {}}
      />,
    );
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("en-US", "documentsTruncatedSaveAnyway") })).toBeInTheDocument();
  });
```

- [ ] **Step 3: Introduce the cause type and rename**

In `src/app/notifications.tsx`, add above the component:

```tsx
/** WHY saving is paused. The two causes cannot be active at once — the save
 *  effect returns on the truncation lockout ABOVE the destructive guard — so one
 *  banner renders whichever holds, and they can never stack with contradictory
 *  advice. See `use-destructive-save-guard.ts`'s header. */
export type SavingPausedCause =
  | {
      kind: "truncation";
      truncation: { entries: number; blocks: number } | null;
      decodeFailureCount: number;
      malformedQuoteCount: number;
    }
  | {
      kind: "destructive";
      prevRecords: number;
      curRecords: number;
      fullWipe: boolean;
    };
```

Rename the component to `SavingPausedBanner` and replace its three truncation-specific props with `cause: SavingPausedCause`. **Preserve every existing docstring** on the component and on the moved props — each records a real defect — and re-attach the three prop docstrings (`truncation`, `decodeFailureCount`, `malformedQuoteCount`) to the corresponding members of the truncation arm of the union.

Move the existing count/headline derivation into a helper that takes the truncation arm, so the component body reads as a cause switch:

```tsx
function truncationCopy(lang: Lang, c: Extract<SavingPausedCause, { kind: "truncation" }>) {
  // …the existing truncationCount / countParts / countText / bannerKey /
  // bannerAriaKey derivation, verbatim, returning
  // { countText, bannerKey, bannerAriaKey }
}
```

The `askThenSave` confirm, the dismissed-chip branch, `role="alert"` and the actions row all stay exactly as they are for this cause.

Update the mount in `src/app/task-manager.tsx`:

```tsx
      {!isPopout && loadWasIncomplete && (
        <SavingPausedBanner lang={lang} cause={{ kind: "truncation", truncation, decodeFailureCount, malformedQuoteCount }} dismissed={truncationBannerDismissed} hasFooterIndicator={settings.layout !== "classic"} onSaveAnyway={allowIncompleteSave} onDismiss={() => setTruncationBannerDismissed(true)} onReopen={() => setTruncationBannerDismissed(false)} />
      )}
```

and its import.

- [ ] **Step 4: Run the tests**

```bash
npx vitest run src/app/notifications.test.tsx --reporter=dot > /tmp/t6.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/t6.log
npx tsc --noEmit; echo "EXIT=$?"
npx eslint src; echo "EXIT=$?"
```

Expected: all pass. Any pre-existing truncation-banner test must still pass **unmodified** — if one needs editing, the rename changed behaviour and that is a bug in this task.

- [ ] **Step 5: Commit**

```bash
git add src/app/notifications.tsx src/app/notifications.test.tsx src/app/task-manager.tsx
git commit --only src/app/notifications.tsx src/app/notifications.test.tsx src/app/task-manager.tsx -m "refactor(notifications): discriminate the saving-paused banner on its cause"
```

---

## Task 7: The destructive branch of the banner

**Files:**
- Modify: `src/app/notifications.tsx`
- Test: `src/app/notifications.test.tsx`

- [ ] **Step 1: Write the failing tests**

```tsx
  it("names the magnitude for a mass deletion", () => {
    render(<SavingPausedBanner lang="en-US" cause={{ kind: "destructive", prevRecords: 900, curRecords: 53, fullWipe: false }}
      dismissed={false} hasFooterIndicator onSaveAnyway={() => {}} onDismiss={() => {}} onReopen={() => {}} />);
    expect(screen.getByText(t("en-US", "storageDestructiveCount", 847, 900))).toBeInTheDocument();
  });

  it("names a full wipe without arithmetic", () => {
    render(<SavingPausedBanner lang="en-US" cause={{ kind: "destructive", prevRecords: 900, curRecords: 0, fullWipe: true }}
      dismissed={false} hasFooterIndicator onSaveAnyway={() => {}} onDismiss={() => {}} onReopen={() => {}} />);
    expect(screen.getByText(t("en-US", "storageDestructiveWipeCount"))).toBeInTheDocument();
  });

  // One helper for every destructive case below, so a render never elides its
  // own props. `ConfirmProvider` is what makes the ambient `useConfirm()` in
  // the banner resolve to a real dialog rather than the safe no-op default.
  function renderDestructive(over: { fullWipe?: boolean; dismissed?: boolean; hasFooterIndicator?: boolean; onSaveAnyway?: () => void } = {}) {
    return render(
      <ConfirmProvider lang="en-US">
        <SavingPausedBanner
          lang="en-US"
          cause={{ kind: "destructive", prevRecords: 900, curRecords: over.fullWipe === true ? 0 : 53, fullWipe: over.fullWipe ?? false }}
          dismissed={over.dismissed ?? false}
          hasFooterIndicator={over.hasFooterIndicator ?? true}
          onSaveAnyway={over.onSaveAnyway ?? (() => {})}
          onDismiss={() => {}}
          onReopen={() => {}}
        />
      </ConfirmProvider>,
    );
  }

  it("routes a mass deletion through the lighter confirm tier", async () => {
    const onSaveAnyway = vi.fn();
    renderDestructive({ fullWipe: false, onSaveAnyway });
    await userEvent.click(screen.getByRole("button", { name: t("en-US", "storageDestructiveSaveAnyway") }));
    // The ConfirmDialog provider is ambient; assert its title is on screen and
    // that no type-to-confirm input rendered.
    expect(screen.getByText(t("en-US", "storageDestructiveConfirmTitle"))).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(onSaveAnyway).not.toHaveBeenCalled(); // not until confirmed
  });

  it("routes a full wipe through the type-to-confirm tier", async () => {
    const onSaveAnyway = vi.fn();
    renderDestructive({ fullWipe: true, onSaveAnyway });
    await userEvent.click(screen.getByRole("button", { name: t("en-US", "storageDestructiveSaveAnyway") }));
    const input = screen.getByRole("textbox");
    await userEvent.type(input, t("en-US", "storageDestructiveWipeConfirmValue"));
    await userEvent.click(screen.getByRole("button", { name: t("en-US", "storageDestructiveSaveAnyway") }));
    expect(onSaveAnyway).toHaveBeenCalledTimes(1);
  });

  it("leaves the refusal standing when the confirm is cancelled", async () => {
    const onSaveAnyway = vi.fn();
    renderDestructive({ fullWipe: true, onSaveAnyway });
    await userEvent.click(screen.getByRole("button", { name: t("en-US", "storageDestructiveSaveAnyway") }));
    await userEvent.keyboard("{Escape}");
    expect(onSaveAnyway).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("offers the re-open chip for the destructive cause in the classic layout", () => {
    renderDestructive({ dismissed: true, hasFooterIndicator: false });
    expect(screen.getByRole("button", { name: t("en-US", "storageSavingPausedAction") })).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run to verify they fail**

```bash
npx vitest run src/app/notifications.test.tsx --reporter=dot > /tmp/t7.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/t7.log
```

- [ ] **Step 3: Implement the destructive branch**

Add beside `truncationCopy`:

```tsx
function destructiveCopy(lang: Lang, c: Extract<SavingPausedCause, { kind: "destructive" }>) {
  return {
    countText: c.fullWipe
      ? t(lang, "storageDestructiveWipeCount")
      : t(lang, "storageDestructiveCount", c.prevRecords - c.curRecords, c.prevRecords),
    bannerKey: "storageDestructiveBanner" as const,
    bannerAriaKey: "storageDestructiveBannerAria" as const,
  };
}
```

In the component, hold the wipe dialog's own state and render it beside the banner:

```tsx
  const [wipeConfirmOpen, setWipeConfirmOpen] = useState(false);
```

The destructive action button:

```tsx
        <Button variant="destructive" size="xs" onClick={() => {
          if (cause.kind === "destructive" && cause.fullWipe) { setWipeConfirmOpen(true); return; }
          void askThenSave();
        }}>
```

and, wrapping the returned banner in a fragment:

```tsx
      {wipeConfirmOpen && (
        <TypeToConfirmDialog
          lang={lang}
          title={t(lang, "storageDestructiveWipeConfirmTitle")}
          message={t(lang, "storageDestructiveWipeConfirmBody")}
          confirmValue={t(lang, "storageDestructiveWipeConfirmValue")}
          confirmLabel={t(lang, "storageDestructiveSaveAnyway")}
          onConfirm={() => { setWipeConfirmOpen(false); onSaveAnyway(); }}
          onCancel={() => setWipeConfirmOpen(false)}
        />
      )}
```

`askThenSave` gains a destructive arm using the lighter tier:

```tsx
  const askThenSave = async () => {
    if (cause.kind === "destructive") {
      const ok = await confirm({
        title: t(lang, "storageDestructiveConfirmTitle"),
        message: `${countText}\n\n${t(lang, "storageDestructiveConfirmBody")}`,
        confirmLabel: t(lang, "storageDestructiveSaveAnyway"),
      });
      if (ok) onSaveAnyway();
      return;
    }
    // …the existing truncation body, unchanged…
  };
```

Add this docstring above the component, recording why the tiers differ from the truncation precedent:

```tsx
/** ★★★ THE TIERS DIFFER BY CAUSE, AND THE LIGHTER ONE IS THE DOCUMENTED
 *  DEFAULT. The truncation arm deliberately uses `ConfirmDialog`, not
 *  `TypeToConfirmDialog`: type-a-phrase friction on a user's only exit from a
 *  lockout is punitive, and there the user did not choose to be here.
 *  ★★ The destructive FULL-WIPE arm takes the heavier tier anyway, and the
 *  reason the objection lapses is the dismiss ✕ and the re-open chip below:
 *  "Save anyway" is NOT the only exit, so the friction is not coercive. If a
 *  future change makes this banner non-dismissible, drop the heavy tier with it
 *  — the two are a pair.
 *  ★ `TypeToConfirmDialog` holds `TITLE_ID` as a MODULE constant, so only one
 *  may be open at a time. That is why the recourse lives here and not also on
 *  the toast: two triggers would need two instances. */
```

- [ ] **Step 4: Run the tests**

```bash
npx vitest run src/app/notifications.test.tsx --reporter=dot > /tmp/t7.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/t7.log
npx tsc --noEmit; echo "EXIT=$?"
```

- [ ] **Step 5: Mutation-check the tier split**

Temporarily change the action handler's condition to `if (false)` so a full wipe takes the light tier. Expected: **"routes a full wipe through the type-to-confirm tier" FAILS**. Revert with an anchored inverse edit; confirm `git diff --stat`.

- [ ] **Step 6: Commit**

```bash
git add src/app/notifications.tsx src/app/notifications.test.tsx
git commit --only src/app/notifications.tsx src/app/notifications.test.tsx -m "feat(notifications): a recoverable destructive-refusal branch on the saving-paused banner"
```

---

## Task 8: Wire it into the shell

**Files:**
- Modify: `src/app/task-manager.tsx`
- Modify: `src/app/sidebar-footer.tsx` (docs only)
- Test: `src/app/task-manager.characterization.test.tsx`

- [ ] **Step 1: Mount the banner for the destructive cause**

Beside the existing truncation mount:

```tsx
      {!isPopout && destructiveRefusal !== null && (
        <SavingPausedBanner
          lang={lang}
          cause={{ kind: "destructive", prevRecords: destructiveRefusal.prevRecords, curRecords: destructiveRefusal.curRecords, fullWipe: destructiveRefusal.fullWipe }}
          dismissed={destructiveBannerDismissed}
          hasFooterIndicator={settings.layout !== "classic"}
          onSaveAnyway={allowDestructiveSaveAnyway}
          onDismiss={() => setDestructiveBannerDismissed(true)}
          onReopen={() => setDestructiveBannerDismissed(false)}
        />
      )}
```

with `const [destructiveBannerDismissed, setDestructiveBannerDismissed] = useState(false);` beside `truncationBannerDismissed`, and both `destructiveRefusal` / `allowDestructiveSaveAnyway` added to the `useStorageBackend` destructure.

- [ ] **Step 2: Widen the footer indicator to either cause**

```tsx
            storageReady={storageOk && !loadWasIncomplete && destructiveRefusal === null}
            savingPaused={!isPopout && (loadWasIncomplete || destructiveRefusal !== null)}
            onRestoreSavingNotice={() => { setTruncationBannerDismissed(false); setDestructiveBannerDismissed(false); }}
```

In `src/app/sidebar-footer.tsx`, update the `savingPaused` prop docstring — it currently names only the truncation cause:

```ts
  /** Saving is paused by a lockout — a truncated load
   *  (`use-load-truncation.ts`) or a withheld mass deletion
   *  (`use-destructive-save-guard.ts`). The two cannot hold at once. */
  savingPaused?: boolean;
  /** Re-show whichever saving-paused banner is standing; it carries the only
   *  "save anyway" for that cause. */
  onRestoreSavingNotice?: () => void;
```

- [ ] **Step 3: Fire the reveal toast on a new refusal**

In `src/app/use-storage-backend.ts`, the refusal branch already toasts. Convert it to an action toast that **reveals the banner rather than saving**:

```ts
      emitToastAction("info", t(langRef.current, "storageRefusedWipe"), {
        labelKey: "storageSavingPausedAction",
        run: () => args.onRevealSavingPaused?.(),
      });
```

★ The toast action deliberately does **not** carry the destructive action. A toast auto-dismisses and is single-slot, so it is a bad host for an irreversible button; and `TypeToConfirmDialog`'s module-level `TITLE_ID` means only one instance may exist, so a second trigger would need a second dialog. The toast points at the persistent surface, which is what `storageSavingPausedAction` already says.

Three things have to be threaded, not one — `args.showToastAction` does not exist on this hook yet:

1. Add `showToastAction: ShowToastAction` to `UseStorageBackendArgs` beside the existing
   `showToast`, importing the type from `./toast-context`. `task-manager.tsx` already holds
   `showToastAction` from `useToast()`, so passing it is a one-word change at the call site.
2. Add `onRevealSavingPaused?: () => void` to the same args interface, passed from
   `task-manager.tsx` as `() => setDestructiveBannerDismissed(false)`.
3. Add an `emitToastAction` helper beside `emitToast`, mirroring it exactly — a hoisted function
   declaration guarded by `mountedRef` the same way. **Keep it a helper rather than calling
   `args.showToastAction` inline:** `react-hooks/set-state-in-effect` is fatal, and the
   indirection is what keeps a setState-bearing call legal inside this effect. That is the same
   reason `emitToast` exists at this very site.

Verify the guard afterwards, since this is the one place the rule can bite:

```bash
npx eslint src/app/use-storage-backend.ts; echo "EXIT=$?"
```

- [ ] **Step 4: Verify**

```bash
npx vitest run src/app/task-manager.characterization.test.tsx src/app/use-storage-backend.test.tsx --reporter=dot > /tmp/t8.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/t8.log
npx tsc --noEmit; echo "EXIT=$?"
npx eslint src; echo "EXIT=$?"
node -e "console.log('task-manager.tsx:', require('fs').readFileSync('src/app/task-manager.tsx','utf8').split('\n').length)"
npm run size:check > /tmp/size.log 2>&1; echo "EXIT=$?"; tail -3 /tmp/size.log
```

Expected: all pass; `task-manager.tsx` stays under its baseline of **3020**.

- [ ] **Step 5: Commit**

```bash
git add src/app/task-manager.tsx src/app/sidebar-footer.tsx src/app/use-storage-backend.ts
git commit --only src/app/task-manager.tsx src/app/sidebar-footer.tsx src/app/use-storage-backend.ts -m "feat(shell): surface a destructive refusal on the saving-paused banner and footer"
```

---

## Task 9: Undo and redo arm themselves (§295)

**Files:**
- Modify: `src/app/undo/use-undo-stack.ts`
- Modify: `src/app/task-manager.tsx`
- Test: `src/app/undo/use-undo-stack.test.tsx`

- [ ] **Step 1: Write the failing tests**

Add to `src/app/undo/use-undo-stack.test.tsx`, using that file's existing `makeDeps` and `Row`
helpers. The live-`arr` setter pattern below is the one its other tests use.

```tsx
  // ── §295: a redo re-applies a deletion, so it must arm the storage bypass ──
  it("arms the destructive bypass when a redo re-removes rows", () => {
    const allowDestructiveSave = vi.fn();
    const deps = makeDeps({ allowDestructiveSave });
    const { result } = renderHook(() => useUndoStack(deps));
    let arr: readonly Row[] = [{ id: 1, name: "a" }];
    const setter = (u: SetStateAction<readonly Row[]>) => { arr = typeof u === "function" ? u(arr) : u; };

    act(() => {
      result.current.capture({ setter, kind: "task.deleted", removed: [{ id: 2, name: "b" }, { id: 3, name: "c" }], fromArray: [{ id: 1, name: "a" }, { id: 2, name: "b" }, { id: 3, name: "c" }] });
    });
    act(() => { result.current.undo(); });
    expect(allowDestructiveSave).not.toHaveBeenCalled(); // undo RESTORES — nothing to authorise
    act(() => { result.current.redo(); });
    expect(allowDestructiveSave).toHaveBeenCalledTimes(1);
  });

  it("does not arm when a redo only re-applies an edit", () => {
    // ★ The leak class §294 is about: arming on EVERY redo would hand a
    // one-shot destructive bypass to an ordinary bulk-edit redo, and the next
    // unrelated save would spend it.
    const allowDestructiveSave = vi.fn();
    const deps = makeDeps({ allowDestructiveSave });
    const { result } = renderHook(() => useUndoStack(deps));
    let arr: readonly Row[] = [{ id: 1, name: "after" }];
    const setter = (u: SetStateAction<readonly Row[]>) => { arr = typeof u === "function" ? u(arr) : u; };

    act(() => {
      result.current.capture({ setter, kind: "task.updated", edited: [{ id: 1, name: "before" }], fromArray: [{ id: 1, name: "before" }] });
    });
    act(() => { result.current.undo(); });
    act(() => { result.current.redo(); });
    expect(allowDestructiveSave).not.toHaveBeenCalled();
  });

  it("arms when any fragment of a composite redo removes rows", () => {
    const allowDestructiveSave = vi.fn();
    const deps = makeDeps({ allowDestructiveSave });
    const { result } = renderHook(() => useUndoStack(deps));
    let rows: readonly Row[] = [{ id: 1, name: "kept" }];
    let refs: readonly Ref[] = [{ id: 9, roleId: 1 }];
    const rowSetter = (u: SetStateAction<readonly Row[]>) => { rows = typeof u === "function" ? u(rows) : u; };
    const refSetter = (u: SetStateAction<readonly Ref[]>) => { refs = typeof u === "function" ? u(refs) : u; };

    act(() => {
      const editPart = capturePart<Ref>({ setter: refSetter, edited: [{ id: 9, roleId: 2 }], fromArray: [{ id: 9, roleId: 2 }] });
      const deletePart = capturePart<Row>({ setter: rowSetter, removed: [{ id: 2, name: "gone" }], fromArray: [{ id: 1, name: "kept" }, { id: 2, name: "gone" }], isPrimary: true });
      result.current.captureComposite({ kind: "task.deleted", primaryCount: 1, parts: [editPart, deletePart] });
    });
    act(() => { result.current.undo(); });
    expect(allowDestructiveSave).not.toHaveBeenCalled();
    act(() => { result.current.redo(); });
    // ★ Composites arm because a FRAGMENT arms — `compositeUndoRunner` composes
    // the fragment redos and needs no check of its own. Do not add one.
    expect(allowDestructiveSave).toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run to verify they fail**

```bash
npx vitest run src/app/undo/use-undo-stack.test.tsx --reporter=dot > /tmp/t9.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/t9.log
```

- [ ] **Step 3: Implement the arming**

Add to `UseUndoStackDeps`:

```ts
  /** Arm the storage destructive-save bypass. Called by a runner whose applied
   *  direction REMOVES rows — a redo of a captured deletion.
   *
   *  ★★★ WITHOUT THIS, A REDO IS REFUSED. The runner drives the same workspace
   *  setters the save effect watches, so a redo of a clear-all re-removes every
   *  row with no bypass armed; the guard then refuses and the redo is never
   *  persisted (open-followups §295).
   *  ★★ ARMED IN THE SAME SYNCHRONOUS BLOCK AS THE SETTER, deliberately — a
   *  site that arms, awaits, then mutates loses its permission. */
  allowDestructiveSave?: () => void;
```

Add the predicate beside the runner builders:

```ts
/** Does applying these images REMOVE rows?
 *
 *  ★★ OVER-APPROXIMATES ON PURPOSE. `applyUndoForward` carries an identity
 *  guard and skips a delete-image whose live row no longer matches, so this can
 *  answer true where nothing is actually removed. That is harmless — the arm is
 *  a one-shot spent by the very save this mutation triggers. Under-arming is
 *  the direction that reproduces §295, so a cleverer predicate is a regression
 *  risk, not an improvement.
 *
 *  ★ The UNDO direction never removes: `UndoOp` is "delete" | "edit" and, as
 *  `use-budget-buckets.ts` puts it, "created rows are excluded entirely — there
 *  is no before-image for a row that did not exist, and no entity in the app
 *  captures a create". So only forward/redo images are ever tested here.
 *  ★ A `kind: "budget.created"` exists and is NOT a counter-example —
 *  `ActivityKind` and `UndoOp` are different vocabularies. */
function imagesRemoveRows<T extends { id: number }>(images: readonly BeforeImage<T>[]): boolean {
  return images.some((i) => i.op === "delete");
}
```

In `fragmentUndoRunner`, inside `runRedo`, before the setter:

```ts
    const runRedo: Runner = () => {
      if (imagesRemoveRows(forward)) depsRef.current.allowDestructiveSave?.();
      setter((prev) => applyUndoForward(prev, forward, WRITE_THROUGH_FIELDS));
      return runUndo;
    };
```

Apply the same guard in `capturePart`'s forward closure. `compositeUndoRunner` composes fragment redos, so a composite arms automatically when any fragment does — add no separate check there, and say so in a comment so a later reader does not add a redundant one.

`fieldRowsRunner` drives a `captureFieldPart`, which is edits only and removes nothing — leave it unarmed and comment why.

- [ ] **Step 4: Wire `allowDestructiveSave` into the hook**

`task-manager.tsx` calls `useUndoStack` before `useStorageBackend` produces `allowDestructiveSave`. Confirm the ordering:

```bash
grep -n "useUndoStack(\|useStorageBackend(" src/app/task-manager.tsx
```

Forward through a ref rather than moving the hook call — moving it would also move `useUndoHotkey`'s listener registration relative to the other hotkey hooks. Above the `useUndoStack` call:

```tsx
  // ★ `allowDestructiveSave` is produced by `useStorageBackend` further down, so
  // it does not exist at this call site. Forward it through a ref filled by the
  // effect below — the same pattern `use-bulk-operations.ts`,
  // `use-document-assets.ts` and `use-reference-data.ts` use. Moving the
  // `useUndoStack` call down instead would also move `useUndoHotkey`'s listener
  // registration relative to the other hotkey hooks.
  const allowDestructiveSaveRef = useRef<(() => void) | undefined>(undefined);
  const armDestructiveForUndo = useCallback(() => { allowDestructiveSaveRef.current?.(); }, []);
  const undoApi = useUndoStack({ lang, logActivity: logActivityUser, showToast, showToastAction, allowDestructiveSave: armDestructiveForUndo });
```

and, after the `useStorageBackend` destructure:

```tsx
  useEffect(() => { allowDestructiveSaveRef.current = allowDestructiveSave; }, [allowDestructiveSave]);
```

- [ ] **Step 5: Run the tests**

```bash
npx vitest run src/app/undo --reporter=dot > /tmp/t9.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/t9.log
npx tsc --noEmit; echo "EXIT=$?"
npx eslint src; echo "EXIT=$?"
```

- [ ] **Step 6: Mutation-check the direction**

Temporarily move the `imagesRemoveRows` guard from `runRedo` into `runUndo`. Expected: **"arms the destructive bypass when a redo re-removes rows" FAILS and "does not arm when the same entry is undone" FAILS** — two mutants killed by two different tests, which is what proves the direction is pinned rather than merely the call. Revert with an anchored inverse edit; confirm `git diff --stat`.

- [ ] **Step 7: Commit**

```bash
git add src/app/undo/use-undo-stack.ts src/app/undo/use-undo-stack.test.tsx src/app/task-manager.tsx
git commit --only src/app/undo/use-undo-stack.ts src/app/undo/use-undo-stack.test.tsx src/app/task-manager.tsx -m "fix(undo): arm the destructive bypass when a redo re-removes rows"
```

---

## Task 10: The seam — clear-all, undo, redo

§295 says its own verification "needs a test driving clear-all → undo → redo against `evaluateSaveGuard`". Tasks 4 and 9 each test one side; this pins the join, which per-task tests structurally cannot.

**Files:**
- Test: `src/app/use-storage-backend.test.tsx` (or a new `src/app/destructive-redo-seam.test.tsx` if the harness does not compose)

- [ ] **Step 1: Write the test**

This one needs the real undo stack driving the real storage hook, so `renderBackend` alone will
not do. Build `renderBackendWithUndo` beside it: a `renderHook` over a function that calls
`useUndoStack` and `useStorageBackend` in the same component, threads the storage hook's
`allowDestructiveSave` into the undo deps through the ref-forward from Task 9, and returns
`{ clearAllTasks, undo, redo, destructiveRefusal }`. Reuse `useReloadableBackend` for the backend
mock and the same `vi.advanceTimersByTime(600)` / `await Promise.resolve()` pairs every other test
in that file uses.

★ `clearAllTasks` must go through the real `use-bulk-operations.ts` path, not a bare
`setTasks([])` — the arming on the ORIGINAL clear-all is what makes the first save commit, and a
shortcut here would make the test pass for the wrong reason.

```tsx
  // §295's owed verification: "a test driving clear-all -> undo -> redo against
  // evaluateSaveGuard". Task 4 pins the storage half and Task 9 the undo half;
  // per-task checks miss the SEAM between them, which is where this bug lived.
  it("persists a redo of a clear-all instead of refusing it", async () => {
    const backend = useReloadableBackend();          // 20 seeded tasks
    const { result } = renderBackendWithUndo();      // storage hook + real undo stack
    await act(async () => { await Promise.resolve(); });
    await act(async () => { vi.advanceTimersByTime(600); });
    await act(async () => { await Promise.resolve(); });
    backend.save.mockClear();

    // Clear-all: captured for undo AND armed, so this save commits.
    await act(async () => { result.current.clearAllTasks(); });
    await act(async () => { vi.advanceTimersByTime(600); });
    await act(async () => { await Promise.resolve(); });
    expect(backend.save).toHaveBeenCalledWith(expect.objectContaining({ tasks: [] }));

    // Undo restores all 20. Not a deletion, so no arming is needed.
    backend.save.mockClear();
    await act(async () => { result.current.undo(); });
    await act(async () => { vi.advanceTimersByTime(600); });
    await act(async () => { await Promise.resolve(); });
    expect(backend.save).toHaveBeenCalledWith(
      expect.objectContaining({ tasks: expect.arrayContaining([expect.objectContaining({ id: 1 })]) }),
    );

    // Redo re-removes all 20 through the undo runner. Before this slice the
    // runner armed nothing, the guard refused, and the redo was never written.
    backend.save.mockClear();
    await act(async () => { result.current.redo(); });
    await act(async () => { vi.advanceTimersByTime(600); });
    await act(async () => { await Promise.resolve(); });

    // ★ Assert on the SAVE, not on the in-memory task list. The bug was that
    // the rows vanished on screen and were never persisted, so an assertion on
    // state alone passes against the broken tree — which is exactly how this
    // shipped.
    expect(backend.save).toHaveBeenCalledWith(expect.objectContaining({ tasks: [] }));
    expect(result.current.destructiveRefusal).toBeNull();
  });
```

- [ ] **Step 2: Prove it is red against the pre-fix behaviour**

Temporarily revert Task 9's arming (comment out the `allowDestructiveSave?.()` call in `runRedo`) and run:

```bash
npx vitest run src/app/use-storage-backend.test.tsx --reporter=dot > /tmp/t10.log 2>&1; echo "EXIT=$?"; grep -E "Tests " /tmp/t10.log
```

Expected: **FAIL.** A seam test that passes with the fix removed is measuring nothing. Restore the call and re-run; expected PASS.

- [ ] **Step 3: Commit**

```bash
git add src/app/use-storage-backend.test.tsx
git commit --only src/app/use-storage-backend.test.tsx -m "test(storage): pin the clear-all/undo/redo seam open-followups 295 owed"
```

---

## Task 11: Register, changelog, release

**Files:**
- Modify: `docs/open-followups.md`, `CHANGELOG.md`, `src/app/version.ts`

- [ ] **Step 1: Close the three entries**

An open-followups heading edit is a **four-place** edit: the `##` heading, the index table's status cell, the index table's anchor, and the `isClosed` witness. Mark §294 and §295 `— CLOSED 2026-08-30`.

§293 closes **with its fix shape rejected**. Its closing note must say so explicitly, or a future reader resurrects the registry from a closed heading:

> **CLOSED 2026-08-30 — the recourse was built; the registry was not.** A
> `DELETE_ROUTES` registry restates knowledge the `allowDestructiveSave` call
> already carries, written by the same author in the same commit, so whoever
> forgets one forgets the other; and nothing can force a new handler to join it,
> which this entry half-concedes. What shipped instead makes a refusal
> recoverable, so a missed arming site degrades from lost work to one extra
> confirmation — for every route, including unenumerated and future ones. **The
> gap this entry names is still real:** there is still no census over UI delete
> routes. What changed is that hitting it is no longer a data-loss event.

- [ ] **Step 2: Verify the register gates**

```bash
npm run followups:status:check > /tmp/fu.log 2>&1; echo "EXIT=$?"; tail -3 /tmp/fu.log
npm run docs:claims:check > /tmp/claims.log 2>&1; echo "EXIT=$?"; tail -2 /tmp/claims.log
grep -E "^## [0-9]+." docs/open-followups.md | grep -vE "— CLOSED" | grep -E "FIXED|CLOSED"
```

Expected: both gates EXIT=0. The third command lists partials; none of §293/§294/§295 may appear — a partially-closed entry is OPEN and must not carry `— CLOSED`. **Exit code 2 from either gate means the gate could not scan, not drift** — the two demand opposite responses.

- [ ] **Step 3: Bump the version and write the changelog**

`src/app/version.ts` is the source of truth: bump `APP_VERSION` and `APP_BUILD_DATE`, set a new `APP_MILESTONE` codename. Then propagate rather than hand-editing the five satellites:

```bash
npm run version:sync
npm run version:check > /tmp/ver.log 2>&1; echo "EXIT=$?"; tail -3 /tmp/ver.log
```

Expected EXIT=0. Exit **1 is drift** (re-run `version:sync`); exit **2 means the gate could not do its job**.

Add a `CHANGELOG.md` entry. **No `[session link removed]...` URL in the changelog.**

- [ ] **Step 4: Full local gate run**

Never through a pipe, and never two vitest processes at once:

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx eslint src; echo "EXIT=$?"
npm run test:run > /tmp/suite.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/suite.log
npm run test:shuffle > /tmp/shuffle.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/shuffle.log
npm run test:coverage > /tmp/cov.log 2>&1; echo "EXIT=$?"; grep -E "All files|ERROR" /tmp/cov.log
npm run size:check > /tmp/size.log 2>&1; echo "EXIT=$?"; tail -3 /tmp/size.log
npm run dup:check > /tmp/dup.log 2>&1; echo "EXIT=$?"; tail -3 /tmp/dup.log
npm run docs:symbols:check > /tmp/sym.log 2>&1; echo "EXIT=$?"; tail -2 /tmp/sym.log
```

`use-destructive-save-guard.ts` is a new coverage-gated `.ts` file. It holds real logic, not render glue, so it must carry its own tests and stay above the floors — do **not** add it to `vitest.config.ts`'s `coverage.exclude`.

- [ ] **Step 5: Axe**

The banner is top-level chrome, so it enters every scanned view. Warm the route first and pass `--workers=1` — the config leaves workers at CPU count locally while CI runs serially, and over-subscription produces `Test timeout` failures that name no rule and are not violations.

```bash
curl -o /dev/null -s -w "%{time_total}\n" http://localhost:3000/
npx playwright test e2e/a11y.spec.ts --project=chromium --workers=1 -g "Dashboard" > /tmp/axe.log 2>&1; echo "EXIT=$?"; tail -5 /tmp/axe.log
```

- [ ] **Step 6: Commit**

```bash
git add docs/open-followups.md CHANGELOG.md src/app/version.ts package.json package-lock.json README.md docs/CODEMAPS
git commit -m "chore(release): recoverable destructive-save refusal"
```

---

## Verification the plan does not cover

**Eye-verify before release.** jsdom has no layout, so nothing above renders the banner for real. Check in a browser, on a seeded project:

1. Trigger a mass deletion whose route does not arm, and confirm the banner appears with a correct magnitude line rather than arithmetic that reads wrong ("847 of 900").
2. Confirm the banner and the truncation banner never appear together.
3. Dismiss it and confirm the sidebar-footer chip brings it back; repeat in the **classic** layout, which has no footer and must show the inline re-open chip instead.
4. Confirm the toast's action reveals the banner rather than saving.

Record the result. An owed eye-verify is a gate, not a nicety.
