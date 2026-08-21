# Prune the open-followups register — design

_Date: 2026-08-05. Target: `docs/open-followups.md`. Doc-only; no version bump._

## Problem

The register is **4490 lines**. Of that, **~1744 lines are the full bodies of 21 CLOSED items**, plus
~250 lines of `Decided` / `Provenance` / `Standing notes`. The 58 open items — the reason the file
exists — occupy **2358 lines**, under half the file, and are reached by scrolling past history.

Two secondary defects fall out of the same measurement:

- The index table's closed rows have grown into paragraphs. §72's row alone is 15 lines of prose; §76's
  and §85's are comparable. The table stopped being an index.
- The open bodies carry **107 bare paths, 63 `file:line` cites and 371 backticked symbols**, none of
  which any gate checks. `check-agents-symbols.mjs` globs `AGENTS.md` + `docs/AGENTS/*.md` only — this
  file is entirely ungated, and its own header records six false-claim clusters found by hand sweeps.

## Constraints discovered before design

**1. Closed entries are cited from shipped source. They cannot be deleted.**

| § | cited from |
|---|---|
| 72 | `use-storage-backend.ts`, `use-storage-backend.test.tsx` (11 refs), `use-scheduled-jobs.ts` |
| 74 | `timelog-guards.ts` (2), `timelog-panel.tsx` (4) |
| 75 | `modern-shell.test.tsx`, `use-storage-backend.test.tsx` (2) |
| 76 | `use-scheduled-jobs.ts`, `use-operating-guides.ts` |
| 85 | `strictmode.meta.test.tsx` (4), `use-storage-backend.test.tsx` |
| 2 | `use-reference-data.ts`, `use-resource-directory.ts` |
| 11 · 14 · 15 · 29 · 48 · 49 · 58 | `abort-error.ts` · `timelog-panel.tsx`+test · `file-picker-button.tsx` · `task-form-fields.tsx`+`task-form-modal.test.tsx` · `use-resource-planner.ts`+2 tests · `use-chat-dispatcher.test.tsx` · `layout.tsx`+`e2e/a11y.spec.ts` |

A code comment reading `See open-followups §74` must keep landing on real content. The numbers are
also declared stable identifiers in the file's own header ("closed ones are never reused"), cited from
`AGENTS.md` and `docs/CODEMAPS/*`.

**2. `Provenance` has no section for the last three slices.** It covers post-0.212.0, 0.211.1, the
audit campaign, 0.210.0 and R5. §72–§76, §80, §81, §84 and §85 — roughly 1000 of the 1744 closed lines
— have no compressed home. Moving them there means *writing new synthesis prose*, which is the single
act this file documents as most error-prone ("correcting a claim is when you are most likely to write a
new one", recorded twice).

**3. Nothing gates this file.** The diff is the only review.

## Decision — compress in place

Rejected: an archive doc (`docs/closed-followups.md`) contradicts the file's stated policy that closed
items move to Decided/Provenance and not to a separate document, and adds a second doc nobody loads.
Rejected: outright deletion — it strands ~20 live code pointers and evaporates the transferable
lessons, which are the file's actual product. Rejected: stub + a new Provenance sub-section per slice —
it costs a second hop for every code pointer and grows Provenance into a second register.

Each closed `§N` keeps its number and its position, and shrinks in place.

## Spine rule — compression by DELETION only

**Every sentence that survives is byte-identical to a sentence in the file today.** No re-phrasing, no
summarising, no merging two sentences into one. New prose is permitted in exactly two places, both one
line long and both derived from the entry's existing title: the `**Was:**` clause and the index row.

This is not a style preference. This file's history is a list of falsehoods introduced while correcting
other falsehoods; deletion cannot introduce one.

## Closed-entry template

```markdown
## 74. ~~The TimeLog refresh handlers omit a guard their button carries~~ — CLOSED post-0.214.0

**Was:** one clause, new prose, derived from the title.
**Closed by:** `timelog-guards.ts` — shared pure predicates; four button wirings DOM-pinned.
**Cited from:** `timelog-guards.ts`, `timelog-panel.tsx` ×4 — this entry cannot be deleted.
★★★ <transferable lesson, verbatim and uncut>
```

Target 6–12 lines per entry, from a current range of 22–230.

**Deleted:** measurement logs, probe traces, before/after transcripts, round-by-round review narrative,
fix options considered and not taken, and any passage restating `AGENTS.md` (replaced by a pointer —
one fact, one doc).

**Kept verbatim:** every ★★/★★★ transferable lesson; every negative result ("do not re-run this
sweep"); every symbol name a code comment points at. A `Cited from:` line is added to each entry that
has inbound code pointers, so the next pruner can see the entry is load-bearing.

**Slice attribution** in each compressed header is read off **that entry's own current header**, never
from memory or from the MR list — two independent records disagree about whether §76 closed in !346 or
!349, and the entry is the record that ships.

## Special cases

- **§58 "HALF CLOSED"** splits. The closed half compresses to the template; the open half stays a
  full-weight open entry under the same number.
- **§48-was** (35 lines) is a duplicate of §48 left behind when §48 closed. Folded into §48's compressed
  body. The number `48-was` disappears; `48` is not reused for anything else.
- **§80 and §81** are closed but their titles carry no strikethrough. Normalised to match the other 19.
- **`Decided — do not re-litigate`** is the destination for any rejected fix option that a compressed
  entry drops and that is worth not re-proposing. Moved verbatim, not rewritten.

## Index table

Closed rows keep their number and their `~~strikethrough~~` title, and shrink to:

```
| 74 | ~~The TimeLog refresh handlers omit a guard their button carries~~ | … | S | **CLOSED post-0.214.0** — shared pure predicates; four wirings DOM-pinned |
```

One clause after the state. The detail that clause replaces now lives 40 lines below it in the entry
itself, which is where a reader who cares is going anyway.

## Phase 2 — the mechanical claim check

A throwaway node script (scratchpad, **not committed** — this pass does not add a gate). It resolves
every citation in the open bodies, and every citation that survives compression in the closed ones.

| Cite class | Count in open bodies | Check |
|---|---|---|
| bare path | 107 | exists on disk, repo-root- and `src/app/`-relative |
| `file.ts:NNN` | 63 | file exists, has ≥ that many lines, **and** a symbol named in the same sentence appears within ±15 lines |
| backticked symbol | 371 | appears in `src` / `scripts` / `e2e`, with `check-agents-symbols.mjs`'s absence markers honoured so deliberate absences ("was removed", "do NOT reintroduce", "never existed") do not fire |
| markdown link | — | target exists; the header links `tech-debt-register.md`, `docs/security/threat-model.md` and four deleted docs |

### Disposition on a miss — three buckets, one of which edits a claim

1. **Provably repairable** — file moved, line drifted, symbol renamed with exactly one unambiguous
   successor. Fixed inline. A wrong `file:line` is replaced by a **symbol cite**, never by a fresh line
   number: a line number is broken by the next commit that touches the file.
2. **Not provable** — a count, a behavioural claim, an "X is guarded". The claim is left exactly as
   written and gains `★ UNVERIFIED 2026-08-05 — <what failed to resolve>` beside it. Nothing is
   invented and nothing is silently dropped.
3. **Disproved hard enough that the item may be dead** — flagged inline, **not closed**. Closing is
   re-triage, which is out of scope for this pass. Listed to the user at the end as a separate call.

### Counts

Any count carrying a reproduce command is re-run. Any greppable count without one gets the command
attached beside it, per the file's own doctrine ("a count is the easiest claim to check and the easiest
to leave rotting: put the reproduce command beside it"). Live instances: §40's **40 sites**, §55's
fourteen toggles, §22's ~54 call sites, §7's 17-files-vs-call-sites note.

## Verification

- Script re-run after every edit batch → zero unresolved cites except the explicitly `★ UNVERIFIED`-flagged.
- **Invariant: no OPEN section loses a line.** Open bodies may only gain an annotation or have a cite
  corrected. Any net deletion inside an open section is a bug in the pass, asserted mechanically by
  comparing per-section line counts before and after (allowing growth, forbidding shrinkage).
- Inbound-pointer check: every `§N` cited from `src`/`e2e`/`docs`/`AGENTS.md` still resolves to a
  section heading in the pruned file. Run before and after; the set must be identical.
- `git diff` read in full before each commit. This file is ungated; the diff is the review.

## Commits

Branch `docs/prune-open-followups`. Six commits — four grouped by the slice each closed entry belongs
to, then the index table, then the claim check — so
`git show` yields a clean per-slice record of what was dropped:

1. 0.210.0 + 0.211.1 entries (§34 · §11 · §14 · §15 · §29 · §45 · §48 + §48-was · §49)
2. post-0.212.0 + 0.213.0 (§2 · §58 split · §63)
3. machine-unblocking slices (§72 · §73 · §74 · §75 · §76)
4. 0.215.0 + strictmode (§80 · §81 · §84 · §85)
5. index-table compression + header line-count refresh
6. the claim-check corrections and `★ UNVERIFIED` flags

Doc-only: no version bump, no `CHANGELOG` entry, no push, no MR unless asked.

## Expected result

~1744 lines of closed bodies → ~250. File 4490 → ~2900. Every code pointer still lands. Every
transferable lesson still present, in the words it was written in. Every open item's citations either
resolved against HEAD or visibly flagged.

## Out of scope

Re-triaging the 58 open items, closing anything, ranking them, or implementing any fix. Adding a CI
gate for this file. Touching `tech-debt-register.md` (a different artifact class, owner-assigned,
next sweep 2026-10-03).
