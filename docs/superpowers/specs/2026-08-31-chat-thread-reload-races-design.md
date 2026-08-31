# Chat-thread reload races — design

**Slice:** §311 · §313 · §317 · §312. Branch `fix/chat-thread-reload-races` off `a5f51aa1`
(0.270.0 "Tchaikovsky").

**Goal.** Close the three remaining live races around `retryLoad` in `use-chat-threads.ts`, and pin
the one assumption that holds today only by call-site inspection.

**Scope.** Turso-gated chat threads only. Not the six workspace write paths, not the
`status` ⟺ `completedDate` pair, no schema change, no i18n, no new UI.

---

## What is already true, measured on this branch

Read this before the units — two of the four entries are written as if code that now exists did not.

- `sendSeqRef` EXISTS (`useChatThreads`), is bumped in `ensureThreadForSend` BEFORE the file-mode
  bail so it counts sends rather than Turso sends, and is compared at BOTH of `retryLoad`'s settle
  paths as part of `preserveLive`.
- `retryLoad` computes `preserveLive` identically in its `.then` and its `.catch`, as
  `sendInFlightAtClick || abortRef.current !== null || sendSeqRef.current !== seqAtClick`.
- `runPersist` is the SINGLE funnel for every Turso write — four call sites (two `saveThread` on the
  send paths, one on rename/edit, one `deleteThreadRow`). This is what makes §317 fixable in one
  place.
- `mergeThreadsAfterLoad` and `resetThreadsAfterFailedLoad` are pure module-level functions above the
  hook, taking only values and returning an updater plus flags.
- `controller` is in scope at `submitPrompt`'s `finally` in `chat-panel.tsx`.

Line budget, read off the tools rather than quoted from prose:

| file | live | baseline | headroom |
|---|---|---|---|
| `src/app/chat-panel.tsx` | 996 | **996** | **zero — any growth fails `size:check`** |
| `src/app/use-chat-threads.ts` | 784 | not baselined | 16 (the limit is 800, and 800 PASSES) |

★★ `check-file-sizes.mjs` counts `split("\n").length`, which is `wc -l` PLUS ONE. Budget from the
node one-liner, never from `wc -l`.

---

## The correction this design makes to §317's own prescription

§317 says a fix "wants the same treatment the send got — something monotonic that a settle can
compare against". **A monotonic counter alone is not sufficient, and the file's existing comment
already proves it.**

That comment enumerates three orderings of a SEND relative to the reload window and states that
ordering (a) — in flight BEFORE the click, finishing before the settle — is caught by
`sendInFlightAtClick` "and by NOTHING else", because it bumped the counter before the sample was
taken. It says outright: "The counter does NOT subsume this disjunct."

§317's ordering IS (a): the busy-persist fires `saveThread`, and the user clicks Retry while that
write is unsettled. A counter captured at the click cannot see it. So persists need BOTH signals,
exactly as sends have both `abortRef` (liveness) and `sendSeqRef` (occurrence).

**Two monotonic counters answer both questions from one place:**

- `persistStartedRef` — bumped on entry to `runPersist`.
- `persistSettledRef` — bumped in `runPersist`'s `.then` AND its `.catch`.

Then, with no third ref:

- **liveness** at any instant is `started > settled` (a write is outstanding);
- **occurrence** across the window is `startedAtClick !== started` (a write began since the click).

★ This is a design decision, not a transcription of the entry. Record it in the source comment and in
the register closure, because a future reader comparing the entry to the code will otherwise think
the fix over-built.

★★ It must gate the SETTLE, never the FETCH. `retryLoad`'s own ★★★ comment records why: gating the
`loadThreads` call would let a write that never settles pin the reload branch closed forever and leave
the sidebar permanently stale. The existing `pendingRetryRef.current.size > 0` pre-reload gate is a
FAILED-write registry and stays exactly as it is — it answers a different question and this design
does not touch it.

---

## Units

Four units, four commits (Unit 0 may produce two), each independently green.

### Unit 0 — Probe §311, then close or fix it

§311 describes a send that starts after the Retry click and finishes before the settle, into an
EXISTING thread, and asserts that neither guard fires. That is ordering (c) in the file's own comment,
which says it is caught ONLY by `sendSeqRef.current !== seqAtClick` — and that test is present at both
settle paths today. **The entry therefore appears already fixed and stale**, written as though the
counter did not exist.

★★★ It is `never machine-verified`, so it does NOT close on a grep. Stage the exact ordering as a
test:

1. Render the hook in Turso mode with a live thread and an active `threadIdRef`.
2. Click Retry (invoke `retryLoad`), holding `loadThreads` unresolved.
3. While it is unresolved, run a send into the ALREADY-ACTIVE thread — so `threadIdRef` never moves
   and no thread is minted — and let it fully settle, clearing `abortRef`.
4. Resolve `loadThreads` with a different `loaded[0]`.
5. Assert the live conversation is PRESERVED (the stale branch ran), not replaced by `loaded[0]`.

**Green** → §311 is already fixed. Close it, with this test as its pin, and say in the closure that
the entry was stale rather than that this branch fixed it.
**Red** → §311 is live; fix it in this unit and the test becomes the regression pin.

Both outcomes ship the test. Neither is a failure of the unit.

★ Mutation proof either way: revert the `sendSeqRef.current !== seqAtClick` disjunct in BOTH settle
paths and confirm this block goes red. If it survives that mutant, the test is not staging the
ordering it claims and must be rewritten before anything is concluded from it.

### Unit 1 — §313: guard both settle paths with the project the reload was issued for

`retryLoad` guards neither settle path against a project switch. Click Retry on p1, switch to p2
before it settles: p1's `.then` runs holding p1's closure, `mergeThreadsAfterLoad` filters `prev` down
to p1's rows — dropping the rows p2's own fetch had put there — and `setLoadedProjectId(projectId)`
stamps p1. The sidebar reads `threads` off this hook directly and lists p1's conversations under p2.
The `.catch` has the identical hole via `resetThreadsAfterFailedLoad`.

**Fix.** A ref holding the project the reload was issued for, compared against the live `projectId` at
BOTH settle paths; bail before any `setThreads` / `setLoadedProjectId`.

★★★ It must NOT reuse the mount effect's `cancelled` local. `retryLoad` is called from an event
handler outside that effect's closure; reaching for that local is the obvious move and does not
compile into a correct guard.

★ The registry publish is already correct and that BOUNDS the blast radius: `threadsMatchProject`
compares `loadedProjectId` against the LIVE `projectId`, so with the slot stamped p1 under p2 it reads
false and `publishChatThreads` sends an empty list. Nothing outside the chat panel ever saw p1's rows.
Do not "fix" anything there.

**Tests.** Two separate `it()` blocks — the `.then` path and the `.catch` path. They are two
behaviours; one block asserting both leaves the second unproved, because vitest aborts at the first
failing hard assertion.

★ A positive control is required: assert that a reload settling under the SAME project still applies
its result. Without it, a guard that bails unconditionally passes the two negative assertions.

### Unit 2 — §317: make an unsettled persist visible to the settle

Sequence: a send finishes → the busy-persist effect fires `saveThread` with the full turn → the user
clicks Retry while that write is unsettled → `loadThreads` returns the row as `ensureThreadForSend`
first wrote it, carrying the USER MESSAGE ONLY → at settle every existing guard passes, the adopt
branch runs, and `setHistory` / `setDisplay` replace the transcript with a snapshot predating the
reply.

**Fix.** The two counters above. In `retryLoad`, capture at the click and re-evaluate at each settle,
folding both into the existing `preserveLive` disjunction rather than adding a second mechanism beside
it.

★ Severity is bounded and the bound belongs in the closure: the write completes, so nothing is lost
server-side and the reply returns on the next load. The loss is ON SCREEN, in a window of one round
trip, and needs a Retry click inside it.

**Tests.** Two separate blocks: the in-flight-at-click ordering (liveness), and the
began-and-settled-inside-the-window ordering (occurrence). They are proved by DIFFERENT mutants —
deleting the liveness disjunct must kill only the first, deleting the occurrence disjunct only the
second. If one mutant kills both, say so in the test comment: it then proves neither in isolation.

### Unit 3 — §312: spend the tripwire

`retryLoad`'s `abortRef.current !== null` guard means "a send is in flight" only while `submitPrompt`
is single-flight, which it is EFFECTIVELY (every call site is a separate DOM event, by which point
React has flushed `setBusy`) but not STRUCTURALLY (its bail reads `busy` from the render closure, so
two dispatches in one tick would both pass).

**Fix.** The identity clear at `submitPrompt`'s `finally`:

```
-      abortRef.current = null;
+      if (abortRef.current === controller) abortRef.current = null;
```

★★★ NET ZERO LINES. `chat-panel.tsx` is baselined at 996 and sits at 996, so ANY growth fails
`size:check`. The previous attempt at this fix grew the file to 1004 and was declined rather than
re-baseline a shared file unasked. One line in, one line out, no added comment in this file — the
explanation goes in the test and in the register closure, where it costs nothing.

**Test.** Dispatch twice within one tick and assert exactly one controller survives in `abortRef`.
★ If that test cannot be written — if there is genuinely no way to reach a same-tick double dispatch
from outside — say so explicitly and leave §312 OPEN with that finding recorded, rather than closing
it on an untestable claim. A guard nothing pins is what the entry is about; shipping a fix that
nothing pins would reproduce the defect one level up.

### Unit 4 — Headroom, only if needed

`use-chat-threads.ts` has 16 lines of headroom and Units 1-2 will likely exceed it once comments are
written.

**Fix.** Extract `mergeThreadsAfterLoad` and `resetThreadsAfterFailedLoad`, with their doc comments
and the `LoadSettleResult` / `FailedLoadSettleResult` interfaces, into a new pure
`src/app/chat-thread-load.ts`. They take only values and return an updater plus flags, so the move is
mechanical.

★★ A NEW `.ts` under `src/app` is coverage-GATED the moment it lands. It must ship with its own tests
or it drags the global floors. That is a WIN here — these two functions are currently exercised only
through the hook.
★ Check for an existing `chat-thread-load.tsx` before creating the `.ts`: a bare `./chat-thread-load`
import resolves `.ts` AHEAD of `.tsx`, so a new pure module silently hijacks a component import.
★ Do this FIRST if the budget demands it, as its own commit, so the guard commits are readable as
guard commits.

---

## Testing strategy

- **Unit tests are the only detector this surface will ever have.** It is Turso-gated, so `e2e/seed.ts`
  never renders it and the axe gate never scans it.
- **One behaviour per `it()`.** Vitest aborts a block at its first failing hard assertion, so a second
  behaviour in the same block is unproved by any mutant that kills the first.
- **Name which mutant backs which block**, in the test file. Where one mutant kills several blocks,
  record that it therefore proves none of them in isolation.
- **Every negative assertion needs a positive control.** "The stale branch ran" is only meaningful
  beside a case where the adopt branch demonstrably runs.
- Run the named files, not the full suite: the full suite exceeds the local cap, and CI owns the
  coverage floors and the shuffled run. NEVER two vitest processes at once; a red carrying
  "Failed to start forks worker" is contention, not evidence.

## Gates

`npx tsc --noEmit` (exits **2** on diagnostics, not 1) · `npx eslint --max-warnings=0` on the touched
files · `node scripts/check-file-sizes.mjs` · the named vitest files · `npm run docs:claims:check` and
`npm run followups:status:check` once the register is edited. Never read a gate's exit code through a
pipe — redirect, check unpiped, then read the file. Logs go in the session scratchpad, never `/tmp`.

## Register and release

★ Every `src/app/*.ts(x)` here is CRLF. Never the `Write` tool on an existing one (it re-lines to LF
invisibly to `git diff`); `Edit` is safe. A `\n`-only anchor is a guaranteed no-op.

Closing each § is a FOUR-place edit: heading marker · summary-table STATUS cell · summary-table
ANCHOR · `**Status:**` witness. A body line must never contain the word CLOSED.

★ Register/CHANGELOG/version edits are HELD until the peer session's slice lands on `origin/main`,
then merged on top of it. This slice is 0.272.0; the peer takes 0.271.0. Mint new follow-up numbers
above whatever the peer has filed — a number is reserved only once it is on `origin/main`.

★★★ The release itself — push, MR, poll, merge-on-green — is a SEPARATE step gated on the user saying
"release". This design does not authorise it.

## Non-goals

Not touching `pendingRetryRef`'s failed-write semantics. Not touching the mount effect. Not widening
any gate to skip the fetch. Not re-baselining `chat-panel.tsx`. Not §318, §8, or anything else in the
roadmap. No UI change.
