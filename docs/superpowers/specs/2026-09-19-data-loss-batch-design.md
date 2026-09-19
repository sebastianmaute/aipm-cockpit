# Data-loss batch — §567 · §548 · §534 · §546

**Date:** 2026-09-19 · **Branch:** `fix/data-loss-batch` (off `origin/main` at 1.10.1 merge `07af82d3`)
**Target version:** a patch on whatever `main` carries when this ships (1.11.1 if it lands after 1.11.0
"Grisham"); settled with the peer session at release time. New register entries, if any, start at **§586**
(§580–§585 are reserved by the spec-C session).

## Goal

Close three open register entries where user data is lost silently (§548 was deferred on 2026-09-19 — see Out of scope). Each is an independent, bounded fix to
existing code; they ship together because they share a theme and a review lens, not because they touch each
other.

| § | Issue | Loss today | Fix |
|---|---|---|---|
| 567 | #352 | a correctly sealed secret is dropped on read if its id is missing from a hardcoded list | derive both lists from `SECRET_IDS` |
| 534 | #324 | the chat card shows sibling fields as landing, Apply replays the whole call, the dispatcher throws, all are lost | strip plan-rejected fields before dispatch |
| 546 | #337 | a dated TimeLog Apply deletes a hand-typed other-granularity period total the confirm dialog never showed | disclose the deletion in the confirm dialog |

## Global constraints

- No hand-rolled UI controls; reuse existing primitives and existing notice paths. Ask if none fits.
- Only the gates each task needs, run per task, sequentially, exit codes read unpiped. vitest:
  `--maxWorkers=1 --reporter=dot`, never two runs at once. No full suite locally.
- `src/app/*.ts(x)` are CRLF (Edit tool only, never `sed -i`); docs are LF. Never edit `src/app/i18n.de.ts`
  with Edit/Write — patch it via a node utf8 write matching `\r\n`, and keep EN/DE key parity.
- New i18n strings need both EN and DE (real umlauts).
- Commits cite §N; `Closes #NN` only in the MR description. Explicit-path staging; never `--amend`.
- Every "this is covered" claim is backed by a mutation that turns the test red, named in the task report.

## 1. §567 — derive the secret id lists from `SECRET_IDS`

**Where:** `src/app/secrets.ts` (`isSealedSecret`), `src/app/secrets-store.ts` (`readStore`).

- `isSealedSecret` validates `id` by membership in `SECRET_IDS`, replacing the five-way `===` chain.
- `readStore` iterates `SECRET_IDS`, replacing its own five-element literal.
- Nothing else about either function changes (same shape checks, same tolerance of malformed entries).

**Tests:** one seal → store → read round-trip per id, generated from `SECRET_IDS` (so a sixth id is covered
without being named); `isSealedSecret` accepts every `SECRET_IDS` member and rejects an unknown id.
Mutation: remove one id from each derivation's source path → red.

**Docs:** AGENTS.md "Secrets at rest" lockstep list — the `isSealedSecret` allowlist and `readStore` loop
steps are no longer separate edits; say so, and cite the symbol (no line numbers). Close §567 in the register.

## 2. §548 — no edits until the first load lands

**Deferred 2026-09-19 — not part of this batch; see Out of scope. Kept as the starting brief for its own slice.**

**Principle:** an edit that cannot start cannot be lost. Until the project's first backend load has landed,
the workspace is read-only for editing.

- **Signal.** The storage hook exposes one boolean for "the first load for the current project has landed"
  (derive from existing state if one already means exactly that — e.g. `loadedBackend` — else add one).
  Planning must decide whether a PROJECT SWITCH reload opens the same window and, if so, include it; the
  register entry names only the first load, the load effect is shared.
- **UI writers.** `guardEdit` becomes `makeEditGuard(isPopout || !firstLoadDone, notify)`; `notify` shows a
  "project is still loading" notice through the same path the popout notice uses (distinct i18n string).
- **Writers outside `guardEdit`.** Template apply, chat Apply, insight-recommendation confirm and AI tool
  dispatch check the same signal and refuse with the same notice.
- **Background writers.** Calendar pull/auto-sync, scheduled jobs, snapshot capture and any other writer are
  either shown to start only after the load, or gated on the signal.
- **Writer inventory first.** Planning opens with a read-only survey listing EVERY workspace writer with one
  label each: `guardEdit` · gated-new · starts-after-load (with evidence) · not-a-workspace-writer. The plan
  is built from that table; an unlabelled writer is a plan defect. The table is committed in the plan.

**Tests:** each gated entry point refused while the load is pending and allowed after; one regression test
reproducing the §548 race shape — an edit attempted during a pending load is refused (notice shown), and the
landed load is intact. Mutation: drop the `!firstLoadDone` term → red.

**Docs:** register §548 closed; AGENTS.md only if an existing claim about `guardEdit` becomes false.

## 3. §534 — Apply sends only what the card showed

- New pure helper (name decided in planning, e.g. `stripRejectedFields(call, plan)`) returns the call's input
  with every field `describeEntityCalls` put in `plan.rejected` removed.
- `applyProposal` (`chat-proposal-apply.ts`) and `confirmInsightRecommendation`
  (`use-insight-recommendations.ts`) dispatch the stripped call. If nothing is left to write, nothing is
  dispatched and the row reports as rejected, never as applied.
- The inline editor is unchanged (it already builds from `plan.updates`).

**Tests:** the card's verdict and the dispatched input are computed from the same plan (a parity test); the
three known instances — resource `emails`, task `assigneeEmail`, and the recommendation route — each land the
valid sibling and omit the rejected field. Mutation: bypass the strip in each consumer → red.

**Docs:** register §534 closed; `docs/AGENTS/ai-assistant.md` if it describes Apply as replaying the model's
call verbatim.

## 4. §546 — the confirm dialog discloses the other-granularity delete

Option (a) from the register only. Re-keying the deleted total into days is ruled out: a bare period total has
no day breakdown, so any split would be a guess shown as data.

- `buildApplyPlan` / `describeApplyRows` (`timelog-apply.ts`) also emit a removal row for every
  other-granularity key the apply will delete: bucket · line · that key · current hours → 0.
- The set of keys shown and the set of keys deleted come from ONE function, so the dialog and the write
  cannot drift.
- `TimelogApplyConfirm` renders the removal rows with the existing row markup, labelled as removals.

**Tests:** the existing §543 test stays; a new test asserts the removal row is listed for the overlapping
month key, and a parity test asserts shown-removals ≡ deleted keys. Mutation: drop the removal emission → red.

**Docs:** register §546 closed; `docs/AGENTS/integrations.md` Timelog bullet updated to say the removal is now
disclosed.

## Order and review

Tasks in the order 567 → 534 → 546 (smallest blast radius first), then a docs-only task that records §548's
planning findings in the register; §548 itself stays OPEN. Subagent-driven: one implementer per task, a task review after each, a final cold
whole-branch review.

## Out of scope

§548, by user ruling on 2026-09-19: the writer inventory found 39 UI writers outside `guardEdit`, so the
complete fix is a whole-app hold, a UX change owed its own decision; it becomes its own slice (findings in the
register entry and in the plan appendix, `docs/superpowers/plans/2026-09-19-data-loss-batch.md`).

Anything the writer inventory turns up that is not a §548 writer; §575 (chat history re-sends attachments);
the tag-pair-walk timing flake (file separately as §586 on the user's say).
