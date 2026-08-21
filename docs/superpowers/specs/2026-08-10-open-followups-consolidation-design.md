# Open-followups consolidation — design

**Date:** 2026-08-10
**Baseline:** `origin/main` @ `fba42c18` (0.229.0 "Marillier")
**Status:** approved, not started

---

## 1. Goal

One place for open work: `docs/open-followups.md`. Nothing that states an open
to-do lives in a source comment, in `AGENTS.md`, in `docs/AGENTS/*.md`, or in a
second register file. Every entry still in the register is verified to still
apply.

Two things this is explicitly **not**:

- It is **not** a sweep for `TODO`/`FIXME`. This repo has none — 2 hits tree-wide,
  both incidental (a `"XXX-1"` test fixture id; the word `TODO` inside
  `check-agents-symbols.mjs`'s doc comment).
- It is **not** the removal of `§NN` citations from source. Those are mostly
  provenance, not to-dos. See §3.

---

## 2. Measured starting state

All figures measured against `origin/main` @ `fba42c18`, not against a working
tree. Reproduce commands are given per figure; do not trust the numbers, re-run
them.

### 2.1 The register

| | |
|---|---|
| `docs/open-followups.md` | 8428 lines |
| numbered `## N.` entries | 129 |
| marked CLOSED (heading carries `CLOSED` or `~~`) | 37 |
| **not closed** | **92** |
| highest entry | §137 |
| **next free number** | **§138** |
| numbering holes (entries that never existed or were removed) | 17, 18, 19, 20, 23, 25, 26, 27 |

Three non-numbered `##` sections exist and are not entries: `Decided — do not
re-litigate`, `Provenance — where these items came from, and what already
closed`, `Standing notes for whoever picks these up`.

Reproduce:

```bash
git show origin/main:docs/open-followups.md | grep -cE '^## [0-9]+\. '
```

### 2.2 Citations from source

1712 files matching `^(src|scripts|e2e)/.*\.(ts|tsx|mjs)$` on `origin/main`:

| | count |
|---|---|
| `§NN` citations, total | 289 |
| → cite an entry marked **CLOSED** | **197** |
| → cite a **not-closed** entry | 88 |
| → cite `§17`, which does not exist | 4 |
| `open-followups` mentions | 132 across 83 files |
| not-closed entries **with** ≥1 code citation | 32 |
| not-closed entries with **none** | 60 |

**68% of source citations point at work that is already done.** One of the four
`§17` hits is `open-points-table-geometry.ts` citing **`CSS 2.1 §17.5.2.1`** — a
CSS spec section, not a register reference. The other three are genuine dangling
citations to a removed entry.

### 2.3 Orphans — open items stated outside the register

**Source comments: 5 hits, 4 real.**

```
src/app/raci-chip-picker.tsx:43          FALSE POSITIVE — "floating surface left
                                          open" is vocabulary, not an item
src/app/sanitize-html.ts:25              "…so it is its own slice"
src/app/task-form-fields.tsx:64          "Full removal is deferred to the
                                          contacts-retirement slice (SP4)"
src/app/task-kanban.ts:126               "…left open"
src/app/task-manager.popout-guard.test.tsx:51  "Not fixed here; a gate on the
                                          hotkey is the likely fix."
```

A sixth (`ai-rich-text.ts` — "Deliberately NOT fixed here … Deferred to its own
slice") existed at `e9211280` and **is gone on `origin/main`**, closed by
Marillier. This is why the baseline is pinned to a commit.

**`AGENTS.md` + `docs/AGENTS/*.md`: 5 lines carrying 4 distinct claims**, all in
`AGENTS.md`. Nothing in `docs/AGENTS/*.md` qualifies.

| Line(s) | Claim | Maps to |
|---|---|---|
| `AGENTS.md:902` | "Cosmetic (the log itself is safe now) — left open" | §50 (confirm) |
| `AGENTS.md:915` | "tasks are likely affected too — unverified" | §50 (confirm) |
| `AGENTS.md:1104-1105` | "the memo does NOT currently bail … aspirational, not in effect" | §1 (confirm) |
| `AGENTS.md:1233` | "Folding them in is a follow-up, not a claim about today" | §9 (confirm) |

**All four map to an entry that already exists.** So this target yields *zero*
new entries — the work is adding the missing `§NN` pointer and cutting the
duplicated prose, not authoring anything.

One earlier candidate, `docs/AGENTS/dashboard.md:237`, is a **false positive**:
the text is "editor **still open**s", matched by a pattern with no word boundary.
It is not an orphan and is not in scope.

Line numbers here are a grep starting point, not an address. Two of them already
drifted between `e9211280` and `fba42c18` (1077→1104, 1206→1233) purely because
Marillier inserted 30 lines above them — the exact failure mode §8.3 exists to
prevent. Re-locate by string.

### 2.4 The other register files

| File | Lines | Contents |
|---|---|---|
| `docs/tech-debt-register.md` | 49 | TD-6 (duplication, live); a **deferred dependency-upgrade table** with no register equivalent; an ESLint 10 row already covered by §53 |
| `docs/handrolled-ui-inventory.md` | 478 (140 table rows) | audit evidence behind §102 |
| `docs/tooltip-inventory.md` | 628 (110 table rows) | audit evidence behind §109 |

### 2.5 Why a keyword sweep does not work

A first sweep for `STILL OPEN|left open|follow-up|deferred|unverified|owed`
returned **216 "high-signal" hits**. Effectively all noise:

- `owed` matched `allowed`, `followed`, `showed`, `swallowed`
- `Deferred` is a real `ChangeStatus` enum member (`types.ts`, `i18n.ts`,
  6 panels, its own tests)
- "still open" is task-domain vocabulary (`completedDate` is `""` when a task is
  still open)
- "deferred frame" is `requestAnimationFrame`

The tight, comment-line-only, word-boundary-correct filter returns **5**. The
extraction criterion in §3 exists because of this, and no phase of this work may
substitute a regex for it.

---

## 3. The extraction criterion

> A passage is an **open item** if and only if it asserts that the current code
> is wrong, incomplete, or unverified **and** implies work not yet done.
>
> It is **not** an open item if it explains why the code is shaped as it is
> (rationale), warns against a change (prohibition), or records a closed defect
> as provenance for a guard or test.

**Decision test for ambiguous cases:** *if the described work were done, would
this sentence be deleted?*

- Yes → extract it.
- No → leave it exactly where it is.

Worked examples:

| Passage | Verdict |
|---|---|
| `use-storage-backend.ts:97` — "★★★ IDENTITY, NOT A LATCH (§77 — full rationale there)" | **stays.** §77 is closed; the sentence survives the fix. Provenance. |
| `use-tasks-dedup.test.tsx` — "★★ REGRESSION (§121): this hook had NO unmount cleanup" | **stays.** Explains why the test exists. |
| `ai-rich-text.ts` — "Deliberately NOT fixed here … Deferred to its own slice" | **extract.** The fix deletes it. |
| `AGENTS.md` — "evaluated and deliberately NOT built" | **stays.** Prohibition. Also an `ABSENCE_MARKER` the symbol gate depends on. |

---

## 4. Approach

Five phases, strictly ordered, one commit per phase (or per batch within a
phase). Fresh branch off `origin/main` — `feat/dependency-successor-linking` is
already merged and has zero local-only commits.

```
P0  criterion + harness   scripts/check-followup-claims.mjs + its unit test
P1  machine sweep         red/green table over all 92 open entries
P2  behavioural probes    read-only subagents; findings returned, not applied
P3  apply verdicts        register edits, serial, single writer
P4  extraction + strip    orphans in; AGENTS / tech-debt prose out
```

P4 runs last deliberately. Extraction appends entries; appending entries while a
verification sweep is mid-flight invalidates the baseline the sweep ran against.

Alternatives considered and rejected:

- **Sequential pass with no harness.** Every entry re-reads an 8428-line file;
  context churn dominates, not probing. Kept as the fallback if P0 shows the
  harness judges too little.
- **Parallel subagents writing the register.** It is one file — concurrent
  writers collide. Subagents are used, but read-only (see §6).

---

## 5. P0–P1 — the harness

`scripts/check-followup-claims.mjs`.

**Parse.** `## N. Title` → body, up to the next `## `. Skip the three prose
sections named in §2.1. Status from the heading: `CLOSED` or `~~…~~` → closed.

**Per not-closed entry, four machine-checkable classes.** All four reuse
existing, already-tested code rather than re-implementing it:

| Check | Reuses | Catches |
|---|---|---|
| backticked mixed-case identifiers resolve in `src`/`scripts`/`e2e` | `check-agents-symbols.mjs` predicate + its `ABSENCE_MARKERS` and allowlist | entry names a symbol the tree no longer has |
| `path:LINE` citations resolvable and in range | `doc-claims-lib.mjs` (already unit-tested) | cite past EOF, unresolvable file |
| bare file paths exist | new, trivial | the *an extraction moved the file* class `AGENTS.md` records twice |
| embedded reproduce command still exits 0 / still returns the stated count | new, **allowlisted commands only** (`grep`, `node -e`, `npm run <known script>`) | count drift |

`docs/open-followups.md` is already inside `docs:claims:check`'s scope, so the
cite-range check runs today — but reports at file level. The harness's
contribution is **per-entry attribution**: which `§NN` owns the broken cite.

**Verdicts.** One of `SYMBOL_MISSING` · `PATH_MISSING` · `CITE_BROKEN` ·
`COUNT_DRIFT` · `CLEAN` · `NO_MACHINE_CLAIM`.

**The harness never closes an entry.** It flags. `CLEAN` and `NO_MACHINE_CLAIM`
both route to P2 — clean-on-paper says nothing about whether a behaviour still
reproduces.

**Output.** A table, plus `docs/baselines/followup-claims.json` mirroring the
`doc-line-cites.json` ratchet shape.

**Testing.** `scripts/check-followup-claims.test.mjs`. `vitest.config.ts`
`include` already covers `scripts/**/*.{test,spec}.mjs`; coverage `include` stays
`src/**`, so it raises no floor. Every defect the sibling gate has shipped was a
regex defect found by running it against the real docs — same discipline here,
and mutation-test each guard.

**Build order.** Run the harness against 10 hand-picked entries and inspect the
verdict spread **before** finishing it. If the spread is mostly
`NO_MACHINE_CLAIM`, the harness has not earned its cost — stop and fall back to
the sequential pass.

---

## 6. P2 — behavioural probes

Read-only subagents. They write nothing: no register edits, no code edits. One
agent per subsystem batch — documents · rich-text/sanitize · budget · a11y/UI ·
storage/undo · AI/chat.

Each receives its entry numbers with full body text and returns, per entry:

```
verdict:   STILL_REPRODUCES | NO_LONGER_REPRODUCES | UNVERIFIABLE_HERE
evidence:  the exact command or probe run, verbatim
measured:  its actual output
reason:    required when UNVERIFIABLE_HERE
```

`UNVERIFIABLE_HERE` is a first-class outcome, not a failure. A large share of the
92 are a11y, CSS-geometry or eye-verify-owed items that jsdom and axe
structurally cannot judge; recording *why* is worth more than a guess. Legitimate
reasons include: jsdom has no layout; needs a real Turso database; eye-verify
only; axe has no rule for this class.

**Two binding rules**, both from recorded incidents:

1. Agents share the working tree, and a hold dispatched *after* a task cannot
   gate it. Batches go out with their complete instruction or not at all.
2. An agent's finding is a claim, not a result. Any `NO_LONGER_REPRODUCES` that
   would close an entry is re-run by the controller before the entry is marked.

---

## 7. P3–P4 — the change plan

| Target | Change | Size |
|---|---|---|
| **Source orphans** | Comments passing the §3 test move to `§138+`. The comment becomes a one-line `§NN` pointer if the site still needs a warning, else it is deleted. The 197 provenance citations are untouched. | 4 sites |
| **`AGENTS.md`** | 5 lines / 4 claims, all collapsing to a pointer at an entry that already exists (§50 ×2, §1, §9). No new entries. `docs/AGENTS/*.md` is untouched — it has no orphans. | 5 lines, always-loaded file |
| **`docs/tech-debt-register.md`** | TD-6 → new entry. The deferred dependency-upgrade table moves wholesale as one entry, table inline. The ESLint 10 row folds into §53. File then deleted. | 49 → 0 |
| **`docs/handrolled-ui-inventory.md`** | **Not folded.** §102 gains an `Evidence:` line naming it; the file gains a banner naming §102. | 2 + 2 lines |
| **`docs/tooltip-inventory.md`** | **Not folded.** Same treatment, §109. | 2 + 2 lines |

Rationale for not folding the inventories: 1106 lines of audit tables with their
own reproduce commands, counts, and corrections. They are the *evidence* behind
two entries, not to-do lists. Folding them would grow the register to ~9500 lines
and absorb two dated audit snapshots whose value is being un-renumbered records.

**Dangling `§17`:** repair the three genuine citations
(`export-ooxml.test.ts` ×3) by re-pointing them at the entry that superseded §17,
or by inlining the claim if none did. Leave
`open-points-table-geometry.ts`'s `CSS 2.1 §17.5.2.1` alone — it is not a
register reference.

---

## 8. Hard constraints

1. **Entry numbers are addresses and must never change.** 289 source citations
   resolve by number, 8 numbers are already holes. New entries append from §138.
   Closed entries stay in place, inline, unarchived — every `★★` in a closed
   entry transitively pins a measurement something else cites.
2. **`AGENTS.md` is gated and always loaded.** `docs:symbols:check` and
   `docs:claims:check` both scan it. Every byte removed is a real context win;
   every byte wrongly removed is a lost landmine.
3. **Cite the symbol, not the line.** An edit that inserts lines invalidates every
   `file:LINE` below it, including ones written moments earlier in the same
   commit.

---

## 9. Risks

| # | Risk | Mitigation |
|---|---|---|
| 1 | **Renumbering.** Fatal and silent — numbers are addresses. | Append-only. Closed entries never move. A harness assertion pins the number→title map against the baseline. |
| 2 | **`AGENTS.md` over-strip.** Deleting a prohibition that reads like an open item removes a guard. | The §3 decision test. `docs:symbols:check` catches an `ABSENCE_MARKER` orphaned by a deletion. |
| 3 | **The correction-round failure mode.** A fix round makes new false claims at a steady rate, always in prose. A pass scoped *only to correction commits* previously found 8 more, 8 of 8 inside correction text. | P3 and P4 each get a cold review **scoped to the diff**, not to the subject matter. |
| 4 | **Harness judges too little.** | The 10-entry spread check in §5 before finishing it. |
| 5 | **`origin/main` moves mid-slice.** It moved once during design. | Re-check at review time, not only at branch time. Every figure in §2 carries its reproduce command. |

---

## 10. Gates

Run in this order. **Unpiped** — a piped gate reports the pipe's exit status, not
the command's, in both directions.

```
npm run docs:symbols:check
npm run docs:claims:check
npx tsc --noEmit
npx eslint --max-warnings=0 src/app
npm run test:run
npm run size:check
npm run dup:check
```

`npm run lint` is bare `eslint` with no `--max-warnings`, so it exits 0 with
warnings present and does not reproduce the CI gate.

If P0 adds a new script, `scriptsDescriptions` needs an entry or
`docs:scripts:check` fails.

---

## 11. Out of scope

- Fixing any of the 92 open items. This slice verifies and consolidates them.
- Archiving or splitting closed entries (decided: leave in place).
- Folding the two inventories (decided: link as evidence).
- Removing provenance `§NN` citations from source (decided: keep).
- Turning the harness into a blocking CI gate. Build it as a script with a
  baseline; promoting it to blocking is a separate decision once its
  false-positive rate is known.
