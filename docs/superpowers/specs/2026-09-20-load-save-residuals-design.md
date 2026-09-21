# Load/save residuals — design

**Date:** 2026-09-20
**Branch (planned):** `fix/load-save-residuals`
**Base:** `main` at or after the 1.12.4 merge (MR !506)

## Goal

Close the four write-path defects left open after 1.12.4, and correct three
register/sample-data residuals that slice left behind.

Three of the four are filed and unreproduced: §588 (#372), §589 (#373),
§590 (#374). The fourth is new — the AI assistant's tool loop writes into a
project the user swapped to mid-call — and 1.12.4's MR described it as an
accepted residual in terms that understate it. See "A correction I owe" below.

## Why these four together

They are one subsystem and two of them share a mechanism. §588 and §589 both
need something `use-storage-backend.ts` does not have: a pointer to the backend
that is live *right now*, readable after an await. Building that pointer once
and using it twice is most of the work for both. §590 is the same file family
(`use-storage-file-ops.ts`) and the same failure class. The tool-loop entry is a
different file family but the identical question — "is the project I am about to
write to still the project I started in?" — and the answer the rest of the app
already uses is `scope-epoch.ts`.

## A correction I owe

1.12.4's MR body and `docs/AGENTS/platform.md` say the assistant's tool loop
"can still write into a project swapped mid-call", listed under "Known and
accepted". Read against the code, that is too soft in one direction and too
vague in the other, and the softening is mine:

- It is not a race. `chat-panel.tsx` contains exactly one `useEffect` cleanup
  and it only detaches a keydown listener. Nothing sets `cancelledRef` or aborts
  the controller on unmount, so an in-flight `submitPrompt` survives the §548
  load hold as an orphaned closure and runs to completion.
- The existing `stale()` guard cannot catch it. The load hold swaps the panel
  for `PanelSkeleton` rather than changing the dying instance's `projectId`
  prop, so that instance's `projectIdRef` is never bumped past the captured
  `sendProjectId`. `stale()` reads *not stale* for that closure permanently.
- The write lands in the live workspace, not a discarded one. `setTasks` and
  its siblings come from `useStorageBackend`, called in `TaskManager`, which
  does **not** unmount under the hold — only its child JSX is swapped.

So the accurate statement is that an AI turn in flight across a project swap
*will* write into the new project, every time, and no existing guard sees it.
The closure text must be corrected wherever the soft version was written, in the
same commit as the fix.

## The shared mechanism (§588 + §589)

Backends are plain class instances from `createBackend` (`storage.ts:39-70`) and
are already compared with `===` throughout `use-storage-backend.ts`
(`loadedBackend === backend`, `settledBackend !== backend`,
`savesAllowedFor === backend`). No id is needed.

What does not exist: an independent "which backend is live" pointer. The load
effect's `let cancelled` (`use-storage-backend.ts:471`) is private to one effect
run and invisible to other callers; `savesAllowedForRef`, `loadedBackend` and
`settledBackend` are each *written* by the very callers that would need to read
them. Verified by grep: no `backendRef`, `instanceId`, `backendId` or nonce.

**Add `backendRef`, assigned during render.**

★★★ The render-phase assignment is load-bearing and is the first thing to
verify, not to assume. React runs every effect cleanup before any effect body,
so a ref mirrored in an effect still holds the OLD backend at the moment §589's
cleanup reads it — which is the one moment that matters. It must therefore be
written in the render body.

A sweep of `src/app` found **no existing render-phase ref write** in this repo:
the candidates in `chat-panel.tsx` (`:364`, `:380`, `:422`) are all inside
effects. There is no precedent to lean on, and `npm run lint` is
`--max-warnings=0` over 25 rules including a `react-hooks` purity rule that
bans impure render bodies. **Task 1 is to confirm `npx eslint --max-warnings=0`
accepts a render-phase ref write in this file, before any behaviour is built on
it.** If it does not, the fallback is an explicit generation counter bumped in
the same `useMemo` that builds the backend, which is a render-phase write of a
different shape and must be re-checked the same way.

## §588 — a superseded caller shuts the new backend's gate

**Today:** `allowSavesTo(target)` (`use-storage-backend.ts:240-243`) sets
`savesAllowedForRef` and `savesAllowedFor`; the save effect gates on
`savesAllowedFor !== null && savesAllowedFor === backend` (`:237`, checked
`:589`). Both `reloadCurrentProject` (`:954-991`) and `onPickStorageFile`
(`use-storage-file-ops.ts:409-422`) reach `allowSavesTo` through
`applyWorkspaceFromLoad` (`:412-414`) or `allowSavesToActiveBackend` (`:940`),
each closing over the render-scope `backend` captured before their await. If a
settings-driven rebuild (§587) replaced the backend during that await, they open
the gate for the OLD instance, which moves it away from the new one. Nothing is
written wrong — it is a silent stall, because `loadPause` is published only for
an instance whose load failed or was refused, so no banner and no toast appear.

**Fix:** both callers compare their captured `backend` against
`backendRef.current` after their await and return without applying when they
differ. `reloadCurrentProject` additionally has no `cancelled` check of the kind
the load effect has, so it also applies the superseded target's *data* — the same
comparison covers both.

**Probe first:** drive a rebuild during an awaited reload and assert the new
backend's gate is shut and no pause is announced. Unreproduced today.

## §589 — an edit inside the debounce is dropped by a rebuild

**Today:** the save effect (`use-storage-backend.ts:550-786`) lists `backend` in
its deps (`:786`) and returns `scheduleDebouncedSave(doSave, SAVE_DEBOUNCE_MS)`
(`:776`). That cleanup (`debounced-save.ts:52-56`) clears the timer and removes
the hide/`pagehide` listeners **without flushing**. A switch op's own
`flushCurrent` (`use-load-truncation.ts:721-730`) covers the nine `holdDuring`
op paths; a bare settings rebuild is not one of them and has no flush. Once the
new target's load applies, the edit leaves memory too.

**Fix:** flush the pending save to the OLD backend when the cause is a backend
change, gated as §586 requires — only when that old instance's gate is open
(`savesAllowedForRef.current === backend`). The cleanup cannot currently know
why it is running: it closes over the timer, the flush and the two listeners,
not even `backend`. So `scheduleDebouncedSave` gains a caller-supplied
should-flush predicate; the save effect passes one that compares its closed-over
`backend` with `backendRef.current`.

**Probe first:** edit, rebuild the backend inside 500 ms, assert the edit
reached the old target. Unreproduced today.

## §590 — Pick storage file overwrites a real project after a failed load

**Today:** `onPickStorageFile` (`use-storage-file-ops.ts:409-422`) checks
`wouldRefuseWrite()`, picks, then `guardedWrite`s the live workspace — which
after a failed load is the empty boot one — and opens the gate. The cold review
deliberately kept Pick ungated: it is the only way a first-time local-file user,
whose load fails with no file picked, can create a file. So blocking it is not
available.

**Decided behaviour:** read the picked file first; if it already holds a
non-empty workspace *and the live workspace is empty*, do not write, and offer
to load it instead.

★★★ **The live-side condition was missing from this paragraph and its absence
was a defect in this spec, corrected after implementation measured it.** Stated
unconditionally, the rule breaks legitimate Save-As: `pickFile` goes through
`showSaveFilePicker` (`fs-access.ts:74`), which is a SAVE dialog, so a user
with real work who deliberately picks an existing file is overwriting it on
purpose. Refusing there removes their ability to overwrite at all, which is
worse than the defect being fixed.

★★ **THE CARRYING CLAUSE IS *WHAT* THE OS ASKS, NOT *THAT* IT ASKS.** An
earlier revision of this paragraph argued "the OS already prompted for
overwrite, so a second question is redundant" — which does not separate the two
cases at all, because the OS prompts in the §590 case too. What distinguishes
them is that the OS asks about **replacing a file**, never about **replacing it
with nothing**. A user who knows what they are writing has answered the only
question that matters; a user whose load silently failed has answered a
question that was not the dangerous one. §590's actual harm is the user who does
**not know** their workspace is empty, because a load failed. That is the case
this closes. Do not "restore" the unconditional wording.

★★ A second correction from implementation: the emptiness test cannot be
`isWorkspaceEmpty` or `workspaceRecordCount` as this spec originally named
them. Decoding any workspace JSON seeds 4 disciplines and 6 grades
(`migrateWorkspaceV5`), and both helpers count them — so every parseable file,
including one the app itself just created, reads as "already holds a project
with 10 records". The predicate must discount that seeded reference data.

The machinery exists. `pickFile()` uses `showSaveFilePicker` (`fs-access.ts:74`)
and the returned handle supports `getFile()` (`fs-access.ts:61`);
`loadFromHandleForBackend` (`storage.ts:99-105`) plus `workspaceRecordCount` /
`nonEmptyCollectionCount` are already the pair `reloadCurrentProject` and the
load effect use to size a workspace before deciding. ★★ NOT `onOpenStorageFile`,
as an earlier revision of this line said — that op sizes on `deps.tasks.length`
and touches neither helper, and the `:608-609` it cited is the
destructive-save-guard comment, not a sizing decision. Cite the symbol, not a
line range. ★★★ **The offer CANNOT use `useConfirm()` here, and this spec was wrong to
require it.** Measured during implementation: `useStorageBackend` is called in
`TaskManagerInner`'s body, and the only two `ConfirmProvider` mounts in the
tree are inside that same component's returned JSX — so `useConfirm()` there
reads the context default, `() => Promise.resolve(false)`
(`confirm-dialog.tsx`), and resolves **false unconditionally**. The offer would
have been declined for every user, every time: a feature that looks
implemented, passes tests written against the same wrong assumption, and never
works once.

The offer therefore uses `window.confirm`, which is what the two sibling gates
in the same function already use, so the file stays internally consistent. ★ This
is against the project's direction of travel — Tasks "Clear all" now routes
through `TypeToConfirmDialog` — and is accepted only because the alternative
honouring this spec's letter is dead code. The real fix is to hoist
`ConfirmProvider` above `TaskManagerInner`; that is a two-site change to the
app shell (classic and modern layouts both mount one) and is filed rather than
done at the end of a slice. No hand-rolled control either way.

**The wrinkle — ★★★ CORRECTED AFTER IMPLEMENTATION MEASURED IT. Do not build what
the struck-through version below prescribes.** The wrinkle is real: `pickFile()`
persists the new handle via `idbSet` *before* anything is read or written, so by
the time we ask, the app is already pointed at the picked file.

~~Declining must therefore restore the previous handle … that requires
`pickFile()` to stop swallowing the handle and return it — a backend contract
change — and the first-time case (no previous handle to restore) must be handled
explicitly rather than falling through to a null.~~

**What was built instead, and why it is strictly better.** Nothing restores
anything, because nothing is ever bound before the accept. `pickFile()` is
UNTOUCHED — a sibling `pickFileHandle()` was added beside it, returning the handle
without the `idbSet`, and `onPickStorageFile` binds through `setBackendFileHandle`
inside whichever branch the user chose. So there is no previous handle to restore
and no first-time case to handle: Cancel means nothing happened because nothing
had happened yet.

★★ The struck-through prescription is left visible rather than deleted because it
is the dangerous kind of stale: it asks for a contract change to a method that
`createProject` and `onRequestStorageSwitch` still depend on, and a reader working
from the spec would make it. Verify with
`grep -rnE "pickFileForBackend[(]" src --include=*.ts --include=*.tsx | grep -v "[.]test[.]"`,
which returns the facade helper's declaration plus those two call sites.

**Probe first:** fail a load, pick a file holding a real project, assert the
file is unchanged and the offer appeared. Unreproduced today.

## The AI tool loop — both halves

`submitPrompt` (`chat-panel.tsx:487-800`) drives the loop at `:576-747`:
`callClaude` (`:578`), then per tool-use block `await runTool(...)` (`:692`).
`stale()` (`:544-545`) is checked at `:577`, `:587` and `:616` — but not between
individual tool calls in the inner loop (`:687-714`). Write tools call their
entity setters directly (`use-chat-dispatcher.ts`, `use-register-tools.ts`);
there is no single write seam to guard, so the guard goes in the loop.

The existing `expectedToken` concurrency check (`chat-proposal-apply.ts:182-189`,
`requireToken` in `chat-tools-updates.ts`) hashes entity *content* and answers
"did this row change since I read it". It is orthogonal to scope and does not
help here.

**Half 1 — cancel on unmount.** An effect cleanup that sets `cancelledRef` and
aborts the controller. Kills the orphaned closure and its remaining API calls.
Small, and it is the half that closes the unconditional case.

**Half 2 — the epoch.** Capture `getScopeEpoch()` at submit, alongside
`sendProjectId` (`:505`), and re-check with `dropStaleScopeWrite` at the three
existing `stale()` points and between tool calls. This is the half that catches
a target change which keeps the project id — a Turso URL/token change, a
SharePoint target swap, a same-project reload — where `projectIdRef` never
moves but the epoch does. `getScopeEpoch` is already threaded into
`useInsightRecommendations` (`task-manager.tsx:2101`), `useCalendarIntegrations`
(`:2367`) and the Tasks-section calendar push/pull (`:2677`); `ChatPanel` takes
no such prop today.

Both halves ship together. Half 1 alone leaves the same-id target change open;
half 2 alone leaves a dead closure running and paying for tokens it will drop.

## Register-only commit

No code. Three residuals from the §577 work in 1.12.4:

1. `sample-workspace-big.json` and `sample-workspace-huge.json` still carry the
   stale pre-§577 curated insight. Only the generator reads them, which is why
   the CI fix deliberately left them; that drift is now recorded rather than
   remembered.
2. The §577 closure note omits that a detector change moves curated sample data.
   That omission is exactly what made pipeline 7271 fail: no repo-wide sweep was
   run for tests the detector change invalidated.
3. The curated insight's `severity` is pinned by nothing — no test compares it,
   so it can drift from the detector silently the way `variancePct` did.

## Register numbers

Four entries are needed: one for the tool loop, three for the residuals above.
`origin/main` tops out at §594 and the peer session is holding §595, so this
slice provisionally takes **§596–§599**. A § is only reserved once it is on
`origin/main` — re-verify immediately before push, not merely before filing, and
renumber if the peer landed first. Each new entry needs its GitLab issue
(`**Work item:** #NN`, `§NNN:` title, `source::register`) per the one-to-one rule.

## Verification

- Every defect here is read-from-code and unreproduced. Each fix is preceded by
  a probe that fails against today's tree and passes after. A fix without a
  failing probe first is fixing a theory.
- Per-file unit tests; each coverage claim backed by a **named** mutation that
  turns the named test red, then reverted.
- Render-phase ref write: `npx eslint --max-warnings=0` on the touched file,
  read unpiped, as Task 1 — before anything is built on it.
- `npx tsc --noEmit` after any test edit (vitest never typechecks).
- CI owns the full suite and the shuffle.

## Out of scope

- The five remaining open security-audit entries (§562, §564, §565, §566, plus
  §578/§579) — a separate slice.
- §544, §545, §551 (the budget-forecast tail) — a separate slice.
- The hash/deep-link cluster (§535, §536, §540) — the peer session is working in
  that area.
