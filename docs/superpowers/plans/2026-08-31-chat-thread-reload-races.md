# Chat-thread reload races — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the three live races around `retryLoad` in `use-chat-threads.ts` (§313, §317, and §311 if it still reproduces), and pin the single-flight assumption §312 records (`chat-panel.tsx`).

**Architecture:** `retryLoad` settles a `loadThreads()` promise and decides between an ADOPT branch (take `loaded[0]`) and a STALE branch (keep what is on screen). That decision is a boolean `preserveLive`, computed identically in the `.then` and the `.catch`. Every fix here adds a disjunct to that boolean or an early bail before it — no new mechanism runs beside it. Two pure helpers move to a new module first, purely to buy line-ratchet headroom.

**Tech Stack:** TypeScript, React 19 hooks, vitest + @testing-library/react `renderHook`, Turso (mocked at `./chat-threads-store`).

**Branch:** `fix/chat-thread-reload-races`, currently at `e90bbea3`, off `a5f51aa1` (0.270.0 "Tchaikovsky").

**Spec:** `docs/superpowers/specs/2026-08-31-chat-thread-reload-races-design.md`

---

## Measured facts — verified on this branch, do not re-derive

Everything here was checked with a command before this plan was written. Where the register entry and the tree disagree, the tree wins.

- **`sendSeqRef` already exists.** Declared in `useChatThreads`, bumped inside `ensureThreadForSend` (before the file-mode bail, so it counts sends and not just Turso sends), and already read at BOTH `retryLoad` settle paths as part of `preserveLive`.
- **`persistSeqRef` already exists too**, declared beside `latestSeqRef`, and `runPersist` bumps it on entry: `const seq = (persistSeqRef.current += 1);`. It exists for the per-key supersede check. **This means §317's OCCURRENCE signal is already in the tree and only needs reading.** The spec assumed it had to be built; it does not.
- **`runPersist` is the single funnel for every Turso write** — four call sites (two `saveThread` on send paths, one on rename/edit, one `deleteThread`).
- **Both `runPersist` settle handlers begin with `if (!owns()) return;`** — a superseded write still settles and still runs its handler.
- `mergeThreadsAfterLoad` and `resetThreadsAfterFailedLoad` are pure module-level functions declared above `useChatThreads`, together with the `LoadSettleResult` and `FailedLoadSettleResult` interfaces.
- `controller` is in scope at `submitPrompt`'s `finally` in `chat-panel.tsx` (bound near the top of the same function as `const controller = new AbortController();`).
- The test harness `renderChatThreads(overrides)` in `src/app/use-chat-threads.test.tsx` renders the hook with a mutable deps object; `loadThreads` / `saveThread` / `deleteThread` are `vi.fn()` mocks exported as `loadThreadsMock` / `saveThreadMock` / `deleteThreadMock`. The file has 60 tests.

**Line budget** — read with the node one-liner, NEVER `wc -l` (`check-file-sizes.mjs` counts `split("\n").length`, which is `wc -l` PLUS ONE):

```bash
node -e "console.log(require('fs').readFileSync('src/app/use-chat-threads.ts','utf8').split('\n').length)"   # 784
node -e "console.log(require('fs').readFileSync('src/app/chat-panel.tsx','utf8').split('\n').length)"        # 996
node -e "console.log(require('./docs/baselines/file-sizes.json')['src/app/chat-panel.tsx'])"                 # 996
```

| file | live | baseline | headroom |
|---|---|---|---|
| `src/app/use-chat-threads.ts` | 784 | not baselined | 16 (limit 800; **800 passes, 801 fails**) |
| `src/app/chat-panel.tsx` | 996 | **996** | **zero — any growth fails** |

---

## Standing rules for every task

- **Every `src/app/*.ts(x)` is CRLF.** Use `Edit` on existing source files. **NEVER the `Write` tool on an existing source file** — it re-lines to LF invisibly to `git diff`. A NEW file is fine either way. Verify with `git ls-files --eol <file>`; `i/lf  w/crlf` is healthy.
- **Never read a gate's exit code through a pipe.** Redirect, check unpiped, then read the file:
  ```bash
  npx vitest run src/app/use-chat-threads.test.tsx > "$SCRATCH/vitest.log" 2>&1; echo "EXIT=$?"
  grep -E "Test Files|Tests " "$SCRATCH/vitest.log"
  ```
  where `$SCRATCH` is the session scratchpad directory. **Never `/tmp`** — it is shared across sessions and a peer's log will overwrite yours.
- **Never run two vitest processes at once.** A red carrying `Failed to start forks worker` is machine contention, not evidence — retry, do not debug.
- `npx tsc --noEmit` exits **2** on diagnostics, not 1.
- **One behaviour per `it()` block.** Vitest aborts a block at its first failing hard assertion, so a second behaviour in the same block is unproved by any mutant that kills the first.
- **Every mutation proof must name which mutant backs which block.** If one mutant kills several blocks, write that down — it then proves none of them in isolation.
- **Revert every mutant before moving on**, with an inverse anchored edit, then prove `git diff --stat` is empty. `git checkout -- <file>` is deny-blocked in this environment.

---

## File structure

| File | Responsibility | Change |
|---|---|---|
| `src/app/chat-thread-load.ts` | Pure load-settle decisions: given the thread ids, project and `preserveLive`, return the `threads` updater plus `stale`/`next`. No React, no I/O. | **CREATE** (Task 1) |
| `src/app/chat-thread-load.test.ts` | Direct unit coverage for the above. | **CREATE** (Task 1) |
| `src/app/use-chat-threads.ts` | The hook. Gains a live-project ref, a persist-settled counter, and three new `preserveLive` disjuncts. Loses the two extracted helpers. | MODIFY (Tasks 1, 3, 4) |
| `src/app/use-chat-threads.test.tsx` | Hook tests. Gains the §311 probe and the §313/§317 regression blocks. | MODIFY (Tasks 2, 3, 4) |
| `src/app/chat-panel.tsx` | Gains the identity clear at `submitPrompt`'s `finally`. **Net zero lines.** | MODIFY (Task 5) |
| `src/app/chat-panel.test.tsx` | Gains the same-tick double-dispatch block. | MODIFY (Task 5) |
| `docs/open-followups.md`, `CHANGELOG.md`, `src/app/version.ts` | Register closures, changelog entry, bump. | MODIFY (Task 6, HELD) |

---

## Task 1: Extract the pure load-settle helpers

Buys the headroom Tasks 3 and 4 need. Do it FIRST and alone, so the guard commits read as guard commits rather than as a diff dominated by a move.

**Files:**
- Create: `src/app/chat-thread-load.ts`
- Create: `src/app/chat-thread-load.test.ts`
- Modify: `src/app/use-chat-threads.ts`

- [ ] **Step 1: Confirm no `.tsx` sibling exists**

```bash
ls src/app/chat-thread-load.* 2>/dev/null; echo "EXIT=$?"
```

Expected: `EXIT=2` (no such file). ★ A bare `./chat-thread-load` import resolves `.ts` AHEAD of `.tsx`, so a new pure module would silently hijack a component import of the same name. If anything is listed, STOP and pick another name.

- [ ] **Step 2: Read the exact block to move**

```bash
grep -n "interface LoadSettleResult\|^function mergeThreadsAfterLoad\|^interface FailedLoadSettleResult\|^function resetThreadsAfterFailedLoad\|^export function useChatThreads" src/app/use-chat-threads.ts
```

Move the two interfaces and the two functions **together with their full doc comments** (the comment above `mergeThreadsAfterLoad` starts several lines earlier — take all of it; it explains why the ownership test is exact rather than heuristic, and that reasoning is the only record of it).

- [ ] **Step 3: Create the new module**

Create `src/app/chat-thread-load.ts` containing, in order: a file header comment, the moved `LoadSettleResult` interface, the moved doc comment + `mergeThreadsAfterLoad`, the moved `FailedLoadSettleResult` interface, the moved doc comment + `resetThreadsAfterFailedLoad`. Export all four. The function bodies are moved VERBATIM — this task changes no behaviour.

Header to use:

```ts
// src/app/chat-thread-load.ts — the pure settle decisions for a chat-thread
// LOAD, extracted from use-chat-threads.ts. Given the thread ids, the project
// and whether something live must be preserved, each returns the `threads`
// updater plus the flags the caller acts on. No React, no I/O, no clock —
// every input is a value, so both are directly testable.
//
// Extracted to keep use-chat-threads.ts under the 800-line ratchet while the
// retryLoad guards grew. Behaviour is byte-identical to the in-hook version.
```

The two type shapes, for reference (copy the real ones — these must match exactly):

```ts
export interface LoadSettleResult {
  updateThreads: (prev: ChatThread[]) => ChatThread[];
  stale: boolean;
  next: ChatThread | null;
}

export interface FailedLoadSettleResult {
  updateThreads: (prev: ChatThread[]) => ChatThread[];
  stale: boolean;
}
```

`chat-thread-load.ts` needs `import type { ChatThread } from "./chat-threads";`.

- [ ] **Step 4: Delete the moved block from the hook and import it**

In `src/app/use-chat-threads.ts`, delete the two interfaces and two functions, and add to the existing import block:

```ts
import {
  mergeThreadsAfterLoad,
  resetThreadsAfterFailedLoad,
} from "./chat-thread-load";
```

- [ ] **Step 5: Typecheck**

```bash
npx tsc --noEmit; echo "EXIT=$?"
```

Expected: `EXIT=0`. (Exit **2** means diagnostics — read them; exit 1 is not the diagnostics code here.)

- [ ] **Step 6: Write tests for the new module**

Create `src/app/chat-thread-load.test.ts`. A NEW `.ts` under `src/app` is coverage-GATED the moment it lands, so it must ship with real tests or it drags the global floors.

```ts
import { describe, it, expect } from "vitest";
import { mergeThreadsAfterLoad, resetThreadsAfterFailedLoad } from "./chat-thread-load";
import type { ChatThread } from "./chat-threads";

function thread(id: string, projectId = "p1"): ChatThread {
  return {
    id,
    projectId,
    name: `Thread ${id}`,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    history: [],
    display: [],
  };
}

describe("mergeThreadsAfterLoad", () => {
  it("adopts the first loaded thread when nothing live needs preserving", () => {
    const loaded = [thread("a"), thread("b")];
    const r = mergeThreadsAfterLoad(null, null, "p1", loaded, false);
    expect(r.stale).toBe(false);
    expect(r.next?.id).toBe("a");
    expect(r.updateThreads([thread("old")])).toEqual(loaded);
  });

  it("keeps the live conversation and merges when preserveLive is set", () => {
    const loaded = [thread("a")];
    const r = mergeThreadsAfterLoad("live", "live", "p1", loaded, true);
    expect(r.stale).toBe(true);
    expect(r.next).toBeNull();
  });

  it("keeps rows of this project that the load did not return", () => {
    const r = mergeThreadsAfterLoad("live", "live", "p1", [thread("a")], true);
    const merged = r.updateThreads([thread("minted"), thread("a")]);
    expect(merged.map((t) => t.id).sort()).toEqual(["a", "minted"]);
  });

  it("drops rows belonging to another project", () => {
    const r = mergeThreadsAfterLoad("live", "live", "p1", [thread("a")], true);
    const merged = r.updateThreads([thread("other", "p2")]);
    expect(merged.map((t) => t.id)).toEqual(["a"]);
  });

  it("treats a moved thread id as stale even when preserveLive is false", () => {
    const r = mergeThreadsAfterLoad("before", "after", "p1", [thread("a")], false);
    expect(r.stale).toBe(true);
  });
});

describe("resetThreadsAfterFailedLoad", () => {
  it("clears the list when nothing live needs preserving", () => {
    const r = resetThreadsAfterFailedLoad(null, null, "p1", false);
    expect(r.stale).toBe(false);
    expect(r.updateThreads([thread("a")])).toEqual([]);
  });

  it("keeps this project's rows when preserveLive is set", () => {
    const r = resetThreadsAfterFailedLoad("live", "live", "p1", true);
    expect(r.stale).toBe(true);
    expect(r.updateThreads([thread("a"), thread("other", "p2")]).map((t) => t.id)).toEqual(["a"]);
  });
});
```

- [ ] **Step 7: Run both test files**

```bash
npx vitest run src/app/chat-thread-load.test.ts src/app/use-chat-threads.test.tsx > "$SCRATCH/t1.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " "$SCRATCH/t1.log"
```

Expected: `EXIT=0`, and the `use-chat-threads` count unchanged at 60 — this task changed no behaviour, so any change there is a real regression.

- [ ] **Step 8: Check the size ratchet and the line budget**

```bash
node -e "console.log(require('fs').readFileSync('src/app/use-chat-threads.ts','utf8').split('\n').length)"
node scripts/check-file-sizes.mjs; echo "EXIT=$?"
```

Expected: the hook is now roughly 735-740 lines, `EXIT=0`. **NEVER run `check-file-sizes.mjs --update`.**

- [ ] **Step 9: Verify line endings survived**

```bash
git ls-files --eol src/app/use-chat-threads.ts src/app/chat-thread-load.ts
```

Expected: `i/lf  w/crlf` for `use-chat-threads.ts`. If it reads `i/lf  w/lf`, the file was re-lined — the `Write` tool was used on it. Fix before committing.

- [ ] **Step 10: Commit**

```bash
git add src/app/chat-thread-load.ts src/app/chat-thread-load.test.ts src/app/use-chat-threads.ts
git commit --only src/app/chat-thread-load.ts src/app/chat-thread-load.test.ts src/app/use-chat-threads.ts -F - <<'MSG'
refactor: extract the pure chat-thread load-settle helpers

mergeThreadsAfterLoad and resetThreadsAfterFailedLoad move verbatim, with
their doc comments and result interfaces, into a new pure module. No
behaviour change - the move buys headroom under the 800-line ratchet for the
retryLoad guards that follow, and gives the two functions direct tests
instead of reaching them only through the hook.
MSG
```

---

## Task 2: Probe §311 — is it live, or is the entry stale?

§311 says a send starting after the Retry click and finishing before the settle, into an EXISTING thread, is invisible to every guard. The file's own comment enumerates that as ordering **(c)** and states it is caught ONLY by `sendSeqRef.current !== seqAtClick` — a test that is present at both settle paths today. So the entry looks stale.

★★★ It is `never machine-verified`. It does NOT close on a grep. Stage the ordering and let the test decide.

**Files:**
- Modify: `src/app/use-chat-threads.test.tsx`

- [ ] **Step 1: Add a deferred-promise helper if the file lacks one**

```bash
grep -n "function deferred\|let resolveLoad\|new Promise" src/app/use-chat-threads.test.tsx | head
```

If there is no reusable deferred helper, add this near the other helpers at the top of the file:

```ts
/** A promise plus its resolvers, so a test can hold a fetch unsettled across
 *  several acts and settle it at an exact point in the ordering. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}
```

- [ ] **Step 2: Write the probe**

Add to `src/app/use-chat-threads.test.tsx`, inside the `retryLoad` describe block:

```ts
  // §311 PROBE. The register entry describes ordering (c) from the ★★★
  // enumeration in use-chat-threads.ts: a send that BEGINS after the Retry
  // click and FINISHES before the reload settles, into the ALREADY-ACTIVE
  // thread so nothing is minted and threadIdRef never moves. The entry asserts
  // no guard sees it. sendSeqRef does. This test exists to decide that, since
  // the entry was never machine-verified.
  //
  // MUTANT: delete the `sendSeqRef.current !== seqAtClick` disjunct from BOTH
  // preserveLive expressions in retryLoad. This block MUST go red. If it
  // survives, the block is not staging the ordering it claims and nothing may
  // be concluded from it.
  it("preserves the live conversation when a send begins and ends inside the reload window", async () => {
    const load = deferred<ChatThread[]>();
    loadThreadsMock.mockReturnValueOnce(load.promise);
    const live = thread("live", { history: [{ role: "user", content: "mine" } as ApiMessage] });
    const h = renderChatThreads({ tursoConfig: {} as never });

    // Arrive with `live` active, exactly as a prior load would have left it.
    await act(async () => {
      h.result.current.selectThread(live.id);
    });

    // Click Retry. The reload is now unsettled.
    act(() => {
      h.result.current.retryLoad();
    });

    // A whole send begins and completes INSIDE the window, into the active
    // thread: ensureThreadForSend bumps sendSeqRef and returns the existing id
    // without minting, and abortRef is back to null by the time we settle.
    act(() => {
      h.result.current.ensureThreadForSend([], []);
    });

    // The server answers with a DIFFERENT thread first.
    await act(async () => {
      load.resolve([thread("server-first"), live]);
    });

    // The adopt branch must NOT have run: the user stays in their conversation.
    expect(h.result.current.activeThreadId).toBe("live");
  });
```

★ Adapt the property names (`selectThread`, `ensureThreadForSend`, `activeThreadId`) to whatever the hook actually returns — read its return object first with `grep -n "return {" -A 30 src/app/use-chat-threads.ts`. Do not invent a member.

- [ ] **Step 3: Run it**

```bash
npx vitest run src/app/use-chat-threads.test.tsx -t "begins and ends inside the reload window" > "$SCRATCH/t2.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " "$SCRATCH/t2.log"
```

- [ ] **Step 4: Branch on the result — BOTH outcomes are valid**

**GREEN** → §311 is already fixed by the existing `sendSeqRef` disjunct. The entry is STALE. Proceed to Step 5 (mutation proof), then commit; §311 closes in Task 6 with wording that says the entry was stale, **not** that this branch fixed it. Those are different claims.

**RED** → §311 is live. Something about the ordering differs from the comment's account. Do NOT patch the test to go green. Record the actual observed behaviour in the test comment, then add the missing disjunct to both `preserveLive` expressions in `retryLoad` and re-run. The test becomes the regression pin.

- [ ] **Step 5: Mutation proof**

Remove `|| sendSeqRef.current !== seqAtClick` from BOTH `preserveLive` expressions in `retryLoad`:

```bash
npx vitest run src/app/use-chat-threads.test.tsx > "$SCRATCH/t2-mutant.log" 2>&1; echo "MUTANT_EXIT=$?"
grep -E "Tests " "$SCRATCH/t2-mutant.log"
```

Expected: RED, and this block among the failures. Record the tally as `N failed / M passed` in the test comment; **N + M must equal the file's runtime test count**, otherwise the mutant did not land where you think.

Then revert with an inverse anchored edit (restore the exact disjunct in both places) and prove the tree is clean:

```bash
git diff --stat; echo "EXIT=$?"
```

Expected: only the test file listed. **If `use-chat-threads.ts` still appears, the mutant is still live — fix that before anything else.**

- [ ] **Step 6: Commit**

```bash
git add src/app/use-chat-threads.test.tsx
git commit --only src/app/use-chat-threads.test.tsx -F - <<'MSG'
test: stage the send-inside-the-reload-window ordering (§311)

The register entry describes ordering (c) - a send that begins and finishes
between retryLoad's two liveness samples, into the already-active thread - and
asserts no guard sees it. The sendSeqRef occurrence test does, and has since
the counter landed, so the entry reads as stale rather than live. It was never
machine-verified, so this stages the ordering rather than closing it on a grep.

Mutation-proved: deleting the sendSeqRef disjunct from both preserveLive
expressions turns this block red.
MSG
```

---

## Task 3: §313 — guard both settle paths against a project switch

`retryLoad` guards neither settle path. Click Retry on p1, switch to p2 before it settles: p1's `.then` runs holding p1's closure, `mergeThreadsAfterLoad` filters `prev` down to p1's rows (dropping what p2's own fetch put there), and `setLoadedProjectId` stamps p1. The sidebar reads `threads` off this hook directly, so it lists p1's conversations under p2. The `.catch` has the identical hole.

**Files:**
- Modify: `src/app/use-chat-threads.ts`
- Modify: `src/app/use-chat-threads.test.tsx`

- [ ] **Step 1: Write the two failing tests plus the positive control**

Three separate `it()` blocks. They are three behaviours; one block asserting all three leaves two unproved.

```ts
  // §313. retryLoad's settle paths carry no project guard, so a project switch
  // mid-reload writes the OLD project's rows under the NEW one.
  //
  // MUTANT for both negative blocks: delete the `issuedFor !== projectIdRef.current`
  // bail from the .then (first block) and from the .catch (second block). Each
  // mutant kills exactly one block — they are independent guards on independent
  // paths, so neither block rests on the other's proof.
  it("does not write the previous project's threads after a switch mid-reload", async () => {
    const load = deferred<ChatThread[]>();
    loadThreadsMock.mockReturnValueOnce(load.promise);
    const h = renderChatThreads({ tursoConfig: {} as never, projectId: "p1" });

    act(() => {
      h.result.current.retryLoad();
    });

    // Arrive at p2 while p1's reload is still unsettled.
    h.rerender({ ...h.props, projectId: "p2" });

    await act(async () => {
      load.resolve([thread("p1-row", { projectId: "p1" })]);
    });

    expect(h.result.current.threads.map((t) => t.id)).not.toContain("p1-row");
  });

  it("does not clear the new project's threads when the previous project's reload FAILS", async () => {
    const load = deferred<ChatThread[]>();
    loadThreadsMock.mockReturnValueOnce(load.promise);
    const h = renderChatThreads({ tursoConfig: {} as never, projectId: "p1" });

    act(() => {
      h.result.current.retryLoad();
    });
    h.rerender({ ...h.props, projectId: "p2" });

    await act(async () => {
      load.reject(new Error("network"));
    });

    // The failed p1 reload must not have raised p2's load-failure banner.
    expect(h.result.current.loadFailed).toBe(false);
  });

  // POSITIVE CONTROL. Without this, a guard that bails unconditionally passes
  // both blocks above and the suite reports a fix that broke retryLoad.
  it("still applies a reload that settles under the SAME project", async () => {
    const load = deferred<ChatThread[]>();
    loadThreadsMock.mockReturnValueOnce(load.promise);
    const h = renderChatThreads({ tursoConfig: {} as never, projectId: "p1" });

    act(() => {
      h.result.current.retryLoad();
    });

    await act(async () => {
      load.resolve([thread("p1-row", { projectId: "p1" })]);
    });

    expect(h.result.current.threads.map((t) => t.id)).toContain("p1-row");
  });
```

★ `h.props` / `h.rerender` must match the harness's actual shape — read `renderChatThreads`'s return before writing these. If it does not expose a rerender path, extend the harness rather than working around it.

- [ ] **Step 2: Run them — expect two red, one green**

```bash
npx vitest run src/app/use-chat-threads.test.tsx -t "project" > "$SCRATCH/t3-red.log" 2>&1; echo "EXIT=$?"
grep -E "Tests " "$SCRATCH/t3-red.log"
```

Expected: the two negative blocks FAIL, the positive control PASSES. A positive control that fails here means the harness is wrong, not the hook.

- [ ] **Step 3: Add a live-project ref**

The `.then` closure captures the render's `projectId`, so comparing `projectId` to itself proves nothing. A ref is required. Add beside the other refs in `useChatThreads`:

```ts
  // The LIVE project, for async settles that must not write under a project
  // the user has since left. retryLoad's `.then`/`.catch` close over the
  // `projectId` of the render that produced the clicked instance, so comparing
  // that local against itself is a tautology — this ref is the only way to ask
  // "am I still on the project this reload was issued for?".
  //
  // ★ It must NOT be the mount effect's `cancelled` local: retryLoad is called
  // from an event handler outside that effect's closure.
  const projectIdRef = useRef(projectId);
  useEffect(() => {
    projectIdRef.current = projectId;
  }, [projectId]);
```

★ Assign it in an effect, not in the render body — a render-phase ref write is the shape the repo's react-hooks purity rules are hostile to, and `react-hooks/set-state-in-effect` does not apply to a ref assignment.

- [ ] **Step 4: Bail in both settle paths**

In `retryLoad`, capture the issuing project immediately before the fetch:

```ts
    const issuedFor = projectId;
```

Then make it the FIRST statement of each settle handler — before `setThreadsError`, before `setLoadFailed`, before anything:

```ts
      .then((loaded) => {
        // §313. A project switch while this was in flight means every setState
        // below would write p1's data under p2 — including setLoadedProjectId,
        // which would then claim ownership of rows p2's own fetch put there.
        if (issuedFor !== projectIdRef.current) return;
        setThreadsError(false);
```

and identically in the `.catch`:

```ts
      .catch(() => {
        if (issuedFor !== projectIdRef.current) return;
        setThreadsError(true);
```

- [ ] **Step 5: Run the three blocks — all green**

```bash
npx vitest run src/app/use-chat-threads.test.tsx > "$SCRATCH/t3-green.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " "$SCRATCH/t3-green.log"
```

Expected: `EXIT=0`, count = 60 + Task 2's block + these 3.

- [ ] **Step 6: Mutation-prove each block separately**

Delete the bail from the `.then` ONLY, run, record which blocks fail (expect: the first, and NOT the second). Restore. Delete the bail from the `.catch` ONLY, run, record (expect: the second, and NOT the first). Restore. Write both tallies into the test comment as `N failed / M passed`.

★ If ONE mutant kills BOTH blocks, they are not independent — say so in the comment rather than claiming two proofs.

Prove the tree is clean before continuing:

```bash
git diff --stat
```

- [ ] **Step 7: Gates and commit**

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app/use-chat-threads.ts src/app/use-chat-threads.test.tsx; echo "EXIT=$?"
node scripts/check-file-sizes.mjs; echo "EXIT=$?"
```

All three must be `EXIT=0` (tsc gives 2 on diagnostics).

```bash
git add src/app/use-chat-threads.ts src/app/use-chat-threads.test.tsx
git commit --only src/app/use-chat-threads.ts src/app/use-chat-threads.test.tsx -F - <<'MSG'
fix: guard retryLoad's settle paths against a project switch (§313)

Both settle paths wrote unconditionally, so clicking Retry on one project and
switching before the reload settled listed the previous project's threads
under the new one - and stamped loadedProjectId with the old id, claiming
ownership of rows the new project's own fetch had put there. The failure path
had the same hole via resetThreadsAfterFailedLoad.

The mount effect's cancelled flag cannot be reused: retryLoad is called from an
event handler outside that effect's closure. A ref holding the live project is
the smaller change and composes with the preserveLive sampling already there.

Three blocks, two mutants: dropping either bail turns exactly one negative
block red, and a positive control pins that a same-project reload still
applies - without which an unconditional bail would pass both negatives.
MSG
```

---

## Task 4: §317 — make an unsettled persist visible to the settle

A send finishes, the busy-persist effect fires `saveThread` with the full turn, the user clicks Retry while that write is unsettled, `loadThreads` returns the row as `ensureThreadForSend` first wrote it (the user message ONLY), every guard passes, the adopt branch runs, and `setHistory`/`setDisplay` replace the transcript with a snapshot predating the reply.

**The occurrence half already exists.** `runPersist` bumps `persistSeqRef` on entry. What is missing is LIVENESS: "is a write outstanding right now?". §317's own ordering is a write in flight BEFORE the click, which no counter captured AT the click can see — the file's comment already states this for sends ("The counter does NOT subsume this disjunct").

**Files:**
- Modify: `src/app/use-chat-threads.ts`
- Modify: `src/app/use-chat-threads.test.tsx`

- [ ] **Step 1: Write the two failing tests**

Two blocks, two orderings, proved by two DIFFERENT mutants.

```ts
  // §317. An unsettled persist is in NEITHER of pendingRetryRef's states -
  // runPersist records a key only in its .catch and deletes it in its .then -
  // so retryLoad's pre-reload gate reads clean and the adopt branch replaces
  // the transcript with a row that predates the reply.
  //
  // TWO orderings, TWO mutants:
  //   block 1 (in flight AT the click)      -> killed by deleting the
  //                                            persistInFlightAtClick disjunct
  //   block 2 (begins inside the window)    -> killed by deleting the
  //                                            persistSeqRef occurrence disjunct
  // Neither mutant kills both, so each block is proved in isolation.
  it("preserves the live transcript when a persist is already in flight at the Retry click", async () => {
    const save = deferred<void>();
    saveThreadMock.mockReturnValueOnce(save.promise);
    const load = deferred<ChatThread[]>();
    loadThreadsMock.mockReturnValueOnce(load.promise);
    const h = renderChatThreads({ tursoConfig: {} as never });

    // A turn completes and its persist starts, but does not settle.
    await act(async () => {
      h.result.current.ensureThreadForSend([], []);
    });

    act(() => {
      h.result.current.retryLoad();
    });

    // The server still has only the pre-reply row.
    await act(async () => {
      load.resolve([thread("t1", { history: [] })]);
    });

    // The stale branch must have run: setHistory must NOT have been called
    // with the server's shorter transcript.
    expect(h.setHistory).not.toHaveBeenCalledWith([]);

    await act(async () => {
      save.resolve();
    });
  });

  it("preserves the live transcript when a persist begins inside the reload window", async () => {
    const load = deferred<ChatThread[]>();
    loadThreadsMock.mockReturnValueOnce(load.promise);
    const save = deferred<void>();
    saveThreadMock.mockReturnValueOnce(save.promise);
    const h = renderChatThreads({ tursoConfig: {} as never });

    act(() => {
      h.result.current.retryLoad();
    });

    // The persist starts AND settles strictly inside the window.
    await act(async () => {
      h.result.current.ensureThreadForSend([], []);
      save.resolve();
    });

    await act(async () => {
      load.resolve([thread("t1", { history: [] })]);
    });

    expect(h.setHistory).not.toHaveBeenCalledWith([]);
  });
```

★ Adapt to the harness: `setHistory` is one of the `vi.fn()`s `renderChatThreads` creates — expose it from the harness if it is not already returned. ★ Each block needs a POSITIVE CONTROL somewhere in the file proving `setHistory` IS called with the loaded history when nothing is live; Task 3's positive control does not cover this, so add one if the file lacks it.

- [ ] **Step 2: Run — expect both red**

```bash
npx vitest run src/app/use-chat-threads.test.tsx -t "persist" > "$SCRATCH/t4-red.log" 2>&1; echo "EXIT=$?"
grep -E "Tests " "$SCRATCH/t4-red.log"
```

- [ ] **Step 3: Add the settled counter**

Beside `persistSeqRef`:

```ts
  // How many runPersist calls have SETTLED. `persistSeqRef` counts writes
  // STARTED, so `persistSeqRef.current > persistSettledRef.current` is exactly
  // "a write is outstanding right now" — the LIVENESS question, which a
  // counter sampled at one instant cannot answer on its own. retryLoad needs
  // both: the occurrence test catches a write that BEGINS inside its window,
  // and this one catches a write already in flight when Retry was clicked.
  //
  // ★★★ BUMPED BEFORE THE `owns()` BAIL, DELIBERATELY. A superseded write
  // still settles and still runs its handler; bumping after the bail would
  // leak the count upward forever, leaving `started > settled` permanently
  // true, `preserveLive` permanently set, and the reload branch unable to
  // adopt anything ever again.
  const persistSettledRef = useRef(0);
```

- [ ] **Step 4: Bump it in both handlers, before the `owns()` bail**

```ts
    action()
      .then(() => {
        persistSettledRef.current += 1;
        if (!owns()) return;
        pendingRetryRef.current.delete(key);
        setThreadsError(pendingRetryRef.current.size > 0);
      })
      .catch(() => {
        persistSettledRef.current += 1;
        if (!owns()) return;
        pendingRetryRef.current.set(key, () => runPersist(key, action));
        setThreadsError(true);
      });
```

- [ ] **Step 5: Read both signals in `retryLoad`**

Beside the existing click-time samples:

```ts
    const persistInFlightAtClick = persistSeqRef.current > persistSettledRef.current;
    const persistSeqAtClick = persistSeqRef.current;
```

and extend BOTH `preserveLive` expressions with the same two disjuncts:

```ts
        const preserveLive =
          sendInFlightAtClick ||
          abortRef.current !== null ||
          sendSeqRef.current !== seqAtClick ||
          persistInFlightAtClick ||
          persistSeqRef.current !== persistSeqAtClick;
```

★ Only TWO new disjuncts, not three. A settle-time liveness re-read would be redundant: a write that started after the click is already caught by the occurrence test, and one that started before it by `persistInFlightAtClick`. Adding it anyway would be an unprovable disjunct — no mutant could kill it alone.

★★ Do NOT touch `pendingRetryRef` or the `pendingRetryRef.current.size > 0` pre-reload gate. That is a FAILED-write registry answering a different question, and `retryLoad`'s own ★★★ comment records why the guard must gate the SETTLE and not the FETCH: gating the fetch would let a write that never settles pin the reload branch closed forever and leave the sidebar permanently stale.

- [ ] **Step 6: Run — both green**

```bash
npx vitest run src/app/use-chat-threads.test.tsx > "$SCRATCH/t4-green.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " "$SCRATCH/t4-green.log"
```

- [ ] **Step 7: Mutation-prove each block, and prove the `owns()` ordering**

Three mutants, each reverted before the next:

1. Delete `|| persistInFlightAtClick` → expect block 1 red, block 2 green.
2. Delete `|| persistSeqRef.current !== persistSeqAtClick` → expect block 2 red, block 1 green.
3. **Move `persistSettledRef.current += 1;` to AFTER the `if (!owns()) return;` in both handlers.** This is the leak. If no test goes red, the ordering is unpinned — add a block that issues two writes to the SAME key (so the first is superseded), settles both, and asserts a subsequent `retryLoad` still adopts. Record the outcome either way.

Record each tally as `N failed / M passed`, summing to the file's runtime test count. Then:

```bash
git diff --stat
```

Expected: only the two intended files.

- [ ] **Step 8: Gates and commit**

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src/app/use-chat-threads.ts src/app/use-chat-threads.test.tsx; echo "EXIT=$?"
node scripts/check-file-sizes.mjs; echo "EXIT=$?"
```

```bash
git add src/app/use-chat-threads.ts src/app/use-chat-threads.test.tsx
git commit --only src/app/use-chat-threads.ts src/app/use-chat-threads.test.tsx -F - <<'MSG'
fix: make an unsettled chat persist visible to retryLoad's settle (§317)

pendingRetryRef is a FAILED-write registry - runPersist records a key only in
its .catch and deletes it in its .then - so a write that has not settled is in
neither state and retryLoad's gate read it as clean. A Retry inside that window
adopted the row as ensureThreadForSend first wrote it, carrying the user
message without the reply, and replaced the transcript on screen. The write
itself completes, so nothing was lost server-side.

The entry prescribes "something monotonic", which is not sufficient: its own
ordering is a write in flight BEFORE the click, and the file's comment already
records that a counter cannot see that disjunct. Persists therefore get both
signals, exactly as sends have both. persistSeqRef already counted writes
started; only the settled counter was missing.

That counter is bumped BEFORE runPersist's owns() bail, because a superseded
write still settles - bumping after it would leak the count upward forever and
leave preserveLive permanently true, so the reload could never adopt again.

Two blocks, two mutants, neither killing both. A third mutant moves the bump
after the bail to pin that ordering.
MSG
```

---

## Task 5: §312 — spend the tripwire in `chat-panel.tsx`

`retryLoad`'s `abortRef.current !== null` guard means "a send is in flight" only while `submitPrompt` is single-flight — true EFFECTIVELY (every call site is a separate DOM event) but not STRUCTURALLY (its bail reads `busy` from the render closure, so two dispatches in one tick would both pass). The `finally` clears `abortRef.current` unconditionally, so the first send's `finally` would empty a slot the second still owns and `retryLoad` would read "idle" over a live send.

**Files:**
- Modify: `src/app/chat-panel.tsx`
- Modify: `src/app/chat-panel.test.tsx`

- [ ] **Step 1: Confirm the zero-headroom constraint still holds**

```bash
node -e "console.log(require('fs').readFileSync('src/app/chat-panel.tsx','utf8').split('\n').length)"
node -e "console.log(require('./docs/baselines/file-sizes.json')['src/app/chat-panel.tsx'])"
```

Both must read 996. If they differ, STOP and re-plan the budget — do NOT re-baseline.

- [ ] **Step 2: Write the failing test**

```ts
  // §312. retryLoad reads abortRef as a liveness signal, which is only
  // equivalent to "a send is in flight" while submitPrompt is single-flight.
  // Nothing pinned that. A same-tick double dispatch would have the FIRST
  // send's finally clear a slot the SECOND still owns, and retryLoad would
  // then read idle over a live send - the exact data loss the guard exists to
  // prevent.
  //
  // MUTANT: revert the finally to the unconditional `abortRef.current = null;`.
  // This block must go red.
  it("leaves the second send's controller in abortRef when two dispatches land in one tick", async () => {
    // ...render ChatPanel with a stubbed streaming API whose first call
    // resolves immediately and whose second stays pending, dispatch submit
    // twice inside a single act(), then assert abortRef.current is the SECOND
    // controller and not null.
  });
```

★★★ **This step is where the task can legitimately fail.** If a same-tick double dispatch cannot be reached from outside the component — every call site being a separate DOM event is precisely what makes it unreachable — then say so explicitly, leave §312 **OPEN**, and record the finding in the register. Do NOT close §312 on an untestable claim: the entry is *about* a guard nothing pins, and shipping a fix that nothing pins reproduces the defect one level up.

If the test cannot be written, still apply Step 3 (the fix is correct and free) and commit it as a hardening with the register entry left open, saying why.

- [ ] **Step 3: Apply the net-zero identity clear**

In `submitPrompt`'s `finally`:

```
-      abortRef.current = null;
+      if (abortRef.current === controller) abortRef.current = null;
```

★★★ ONE LINE IN, ONE LINE OUT. No added comment in this file — `chat-panel.tsx` is baselined at 996 with zero headroom, and the previous attempt at this fix grew it to 1004 and was declined rather than re-baseline a shared file unasked. The explanation lives in the test and in the register closure, where it costs nothing.

- [ ] **Step 4: Prove the file did not grow**

```bash
node -e "console.log(require('fs').readFileSync('src/app/chat-panel.tsx','utf8').split('\n').length)"
node scripts/check-file-sizes.mjs; echo "EXIT=$?"
```

Expected: still 996, `EXIT=0`.

- [ ] **Step 5: Run the chat-panel suite**

```bash
npx vitest run src/app/chat-panel.test.tsx > "$SCRATCH/t5.log" 2>&1; echo "EXIT=$?"
grep -E "Test Files|Tests " "$SCRATCH/t5.log"
```

- [ ] **Step 6: Commit**

```bash
git add src/app/chat-panel.tsx src/app/chat-panel.test.tsx
git commit --only src/app/chat-panel.tsx src/app/chat-panel.test.tsx -F - <<'MSG'
fix: clear abortRef only when this send still owns it (§312)

submitPrompt's finally cleared abortRef unconditionally, so a same-tick double
dispatch would have the first send's finally empty a slot the second still
owned - and retryLoad, which reads that ref as its liveness signal, would then
read idle over a live send. No path reaches it that way today; the guard was
held by call-site inspection alone and nothing kept it true.

Net zero lines: chat-panel.tsx is baselined at 996 with no headroom, and the
earlier attempt at this fix grew it to 1004 and was declined. The reasoning
lives in the test rather than in a comment here.
MSG
```

---

## Task 6: Register closures, CHANGELOG, version bump

★★★ **HELD.** Do not start this task until the peer session's slice has landed on `origin/main`. Both sessions edit `docs/open-followups.md` and `CHANGELOG.md`, and this round the peer lands first. Confirm with `git fetch origin && git log --oneline -3 origin/main` before touching any of the three files, then merge `origin/main` into this branch and write on top of it.

**Files:**
- Modify: `docs/open-followups.md`
- Modify: `CHANGELOG.md`
- Modify: `src/app/version.ts`

- [ ] **Step 1: Merge the peer's work and check what it did to your side**

```bash
git fetch origin
git merge origin/main
git diff HEAD@{1} HEAD -- docs/open-followups.md | grep '^-[^-]' | head -40
```

★★★ `git diff-tree --cc` is a census of INVENTED content and is BLIND to a resolution that took one side wholesale. The two-dot diff above is what shows edits silently dropped from YOUR side. Adjudicate per row; do not restore your side wholesale.

- [ ] **Step 2: Close each § as a FOUR-place edit**

For each of §313, §317, and (per Task 2's outcome) §311 and/or §312:

1. the `##` heading gains `— CLOSED 2026-08-31, 0.272.0`;
2. the summary table's STATUS cell for that row;
3. the summary table's ANCHOR for that row (the heading text changed, so the link target did too);
4. the `**Status:**` witness line in the body.

★★★ A body line must NEVER contain the word CLOSED — the heading owns closure, and a body line claiming it breaks every count in the register.

★ §311's wording depends on Task 2: if the probe was green, say the entry was **stale** (the `sendSeqRef` disjunct already covered it) and name the test that now pins it. Do not write that this branch fixed it.

★ §312 closes ONLY if Task 5's test was writable. If it was not, leave §312 open and update its `**Status:**` line with what was found and the date.

- [ ] **Step 3: Fix the two U+0008 control bytes**

Two lost backslashes turned `\b` into a literal backspace inside a `grep -rln` reproduce command, so that command cannot answer its own claim. Locate by code-point scan, never by a quoted line number (it shifts on every register edit and has already been quoted wrong twice):

```bash
node -e "const s=require('fs').readFileSync('docs/open-followups.md','utf8');const bad=[];for(let i=0;i<s.length;i++){const c=s.codePointAt(i);if(c<9||(c>10&&c<32)||c===127)bad.push([s.slice(0,i).split('\n').length,c.toString(16)]);}console.log(bad);"
```

Repair by writing the two-character escape `\b` back, then re-run the scan and expect `[]`.

- [ ] **Step 4: Run the register gates**

```bash
npm run docs:claims:check > "$SCRATCH/claims.log" 2>&1; echo "EXIT=$?"
npm run followups:status:check > "$SCRATCH/status.log" 2>&1; echo "EXIT=$?"
npm run docs:symbols:check > "$SCRATCH/symbols.log" 2>&1; echo "EXIT=$?"
```

All `EXIT=0`. ★ For the status gate, **1 is drift** (write the Status line) and **2 is the gate unable to scan**. They demand opposite responses.

★★★ Do NOT run the register's own index-rebuild recipe. It claims idempotence and is not — it derives the State cell from the heading alone and silently destroys hand-written parentheticals. That is filed as §319.

- [ ] **Step 5: CHANGELOG and version**

Add a `## [0.272.0] - 2026-08-31 "<codename>"` block at the top of `CHANGELOG.md`, above the peer's entry. ★ No `[session link removed]...` URL in `CHANGELOG.md` or in any MR description.

Then edit `src/app/version.ts`: **both** `APP_VERSION` and `APP_MILESTONE`, plus `APP_BUILD_DATE`. ★★ `version:sync` reads the codename from `APP_MILESTONE` via regex, NOT from the docstring above it — editing only the docstring propagates the OLD codename to all eight satellites and the gate stays green. Then:

```bash
npm run version:sync; echo "EXIT=$?"
npm run version:check; echo "EXIT=$?"
```

★ **1 is drift, 2 is the gate unable to scan.**

- [ ] **Step 6: Commit**

```bash
git add docs/open-followups.md CHANGELOG.md src/app/version.ts package.json package-lock.json README.md docs/CODEMAPS
git commit -F - <<'MSG'
docs: close the retryLoad race follow-ups and release 0.272.0

Closes the entries this branch fixed, four-place each. Also repairs two U+0008
bytes in the register - two lost backslashes that turned \b into a literal
backspace inside a grep reproduce command, so the command could not answer its
own claim.
MSG
```

---

## Task 7: Release — GATED

★★★ **DO NOT EXECUTE THIS TASK UNTIL THE USER SAYS "release".** Nothing in this plan authorises a push, an MR, or a merge. Finishing Task 6 means the branch is ready, not that it ships.

- [ ] **Step 1: Full local verification**

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src; echo "EXIT=$?"
node scripts/check-file-sizes.mjs; echo "EXIT=$?"
npm run dup:check > "$SCRATCH/dup.log" 2>&1; echo "EXIT=$?"
```

- [ ] **Step 2: Push and open the MR**

```bash
git push -u origin fix/chat-thread-reload-races
```

Open the MR with `glab`. ★ No session URL in the description.

- [ ] **Step 3: Poll to green, then merge**

```bash
glab ci list --per-page 3
```

★★★ Merge ONLY after the pipeline is green, and pass `--auto-merge=false` explicitly — `glab mr merge` DEFAULTS it to true, so omitting it is not opting out:

```bash
glab mr merge <NN> --auto-merge=false --yes
```

- [ ] **Step 4: Verify it landed**

```bash
git fetch origin && git log --oneline -3 origin/main
git log --oneline origin/main..HEAD | wc -l   # must be 0
```

- [ ] **Step 5: Tell the peer**

Message the peer session that 0.272.0 is on `origin/main`, so it can release its hold and merge.

---

## Self-review

**Spec coverage.** Unit 0 → Task 2. Unit 1 (§313) → Task 3. Unit 2 (§317) → Task 4. Unit 3 (§312) → Task 5. Unit 4 (headroom) → Task 1, promoted to first because Tasks 3 and 4 need the lines. Register/release → Tasks 6 and 7. The spec's "correction to §317's prescription" is implemented in Task 4 Steps 3-5 and stated in its commit message. No spec section is unimplemented.

**One change from the spec, recorded deliberately.** The spec said §317 needed two NEW monotonic counters. Reading `runPersist` showed `persistSeqRef` already exists for the supersede check, so only `persistSettledRef` is new. This also surfaced the `owns()` ordering trap — a settled counter bumped after the bail leaks upward forever and would freeze `preserveLive` true, which the spec could not have predicted. Task 4 Step 7 mutant 3 pins it.

**Placeholder scan.** Task 5 Step 2's test body is prose rather than code. That is deliberate and flagged: whether the test is writable at all is the open question that task exists to answer, and writing a fake body would prejudge it. Every other code step carries real code.

**Type consistency.** `LoadSettleResult` / `FailedLoadSettleResult` (Task 1) are the names the hook already uses. `projectIdRef` (Task 3), `persistSettledRef` and `persistSeqAtClick` / `persistInFlightAtClick` (Task 4) are used consistently in the code, comments and commit messages. `issuedFor` is Task 3's only new local and appears in both settle paths.

**Known soft spot.** Tasks 2-4 assume the harness exposes `rerender` with props and returns `setHistory`. Each of those steps carries a ★ telling the implementer to read the harness first and extend it rather than work around it. If the harness cannot drive a project switch, Task 3 Step 1 is where that surfaces — extend `renderChatThreads`, and treat that extension as part of Task 3.
