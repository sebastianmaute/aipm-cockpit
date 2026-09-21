# Brand rename Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the brand trigram from everything outside `docs/` and `CHANGELOG.md` — from the
Outlook category prefix and event body that reach external calendars, from the dead persisted
style value, and from the comments, i18n prose and theme file that still carry it.

**Architecture:** Three tasks. The first changes values the product writes to an external system
and is the only one carrying real risk; the second deletes a union member the app no longer
produces; the third is a classified sweep of mentions.

**Tech Stack:** TypeScript, vitest, the existing npm gate scripts.

**Spec:** `docs/superpowers/specs/2026-09-20-github-migration-phase1-design.md` (Phase A task 1)

**Companion plan:** `docs/superpowers/plans/2026-09-20-sanitise-and-rewrite-history.md`.
**This plan must be merged before that plan's history-rewrite task runs**, so the tip already
carries the new spellings and the old ones survive only in history.

**Re-baselined 2026-09-21** against release 1.13.0. The first version renamed the style member
(it is dead — now deleted), assumed the trigram was small in code (118 occurrences in 60 files
outside `docs/`), and missed the Outlook event body text.

## Scope boundary

This plan owns every trigram occurrence **outside `docs/` and `CHANGELOG.md`**. Those two are
swept by the companion plan's class-7 task together with the employer name, because a dated
record needs its names replaced without its content being rewritten, and that is one judgement
applied once.

Measure the boundary rather than trusting the count above:

```bash
git grep -cIiP '(?<![a-z0-9])AIPM(?![a-z0-9])' -- . ':!docs' ':!CHANGELOG.md'
```

## Why the risk sits where it does

- The `--AIPM-*` custom-property family **does not exist** — renamed to `--ui-*` in an earlier
  release. Only stale comments and a stale document title still claim otherwise.
- The legacy built-in scheme id is **retired**, surviving only in a hand-built test fixture.
- The style axis is **always `"custom"`**. `CiStyleProvider`'s initializer rewrites any other
  stored value to `"custom"`, `data-style` is hard-wired to `"custom"`, and the boot script says
  the same. The `"AIPM"` member of `CiStyle` is never produced — it survives only as the context's
  default value and in a test helper's parameter type.
- The real exposure is `categoryFor`, which writes the trigram as an **Outlook category onto every
  synced calendar event**, read back with OData string equality, plus the event body text that
  names the brand in every synced event.

★★★ `categoryFor` is renamed outright, with no compatibility shim, **only because the repository
owner states (2026-09-20) that no user has ever run a calendar sync**, so no event carries the old
prefix. This is a fact about the installed base, not about the code. The equality filter remains
unforgiving: the same rename after one real sync would silently stop two-way sync from recognising
every event created before it, and nothing in this repository could detect that. Re-establish the
premise before reusing this reasoning.

## Global Constraints

- **New prefix spelling:** `AIPM:` — the product's own initials.
- **New body text:** `Managed by AI PM Cockpit.`
- **Cite symbols, never line numbers, in any doc or plan text.** `npm run docs:claims:check` is a
  ratchet that FAILS on a newly added `path:LINE` citation.
- **Never read an exit code through a pipe.** Redirect, echo `$?`, read the file.
- **`src/app/*.ts(x)` are CRLF.** Check `git ls-files --eol` before and after each file. Never
  `sed -i`.
- **Never edit `src/app/i18n.de.ts` with the Edit or Write tool** — it corrupts umlauts and curls
  quotes. Use a node utf8 write whose anchors match `\r\n`, then re-verify the file.
- **Never `git add -A`/`git add .`**; commit with `git commit --only <paths> -F <msgfile>`. Never
  `--amend`. `git checkout --` and `git restore` are deny-blocked — revert by writing original
  bytes back and proving `git diff --stat` empty.
- **One vitest process at a time**, scoped to files, `--maxWorkers=1 --reporter=dot`.
- **Commit messages cite `§N` only** — never `#NN`, which GitLab reads as a closing reference.

## Review Focus

1. **A test that asserts the new prefix while the filter still sends the old one**, because it
   asserts on a constant rather than on the request actually issued (Task 1).
2. **The body text drifting between its seven copies** — hoist it before changing it (Task 1).
3. **The retired scheme-id fixture being renamed**, which would quietly stop exercising the
   generic built-in guard it exists for (Task 2 and Task 3).
4. **A stale comment "corrected" to describe a second rename** rather than deleted (Task 3).
5. **DE i18n corruption** from editing the German dictionary with the wrong tool (Task 3).
6. **A sweep replacement that changes meaning** — a comment that named the brand palette as the
   *reason* for a contrast value must still say why after the edit (Task 3).

---

### Task 1: Rename the Outlook category prefix and the event body text

**Files:**
- Modify: `src/app/outlook-calendar-write.ts` (`categoryFor`, the body text)
- Modify: `src/app/outlook-calendar-read.ts` (docstring only — it imports `categoryFor`)
- Modify: `src/app/use-calendar-integrations.ts` (comment only)
- Test: `src/app/outlook-calendar-write.test.ts`, `src/app/outlook-calendar-read.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `AIPM:` as the category prefix written and matched; one exported body-text constant.

- [ ] **Step 1: Confirm there is one spelling of each.** Measured 2026-09-21: the reader imports
  `categoryFor`, so the prefix has one spelling; the body text is spelled inline seven times.

```bash
git grep -n "categoryFor\|AIPM:" -- src
git grep -n "PM Tracker" -- src
```

- [ ] **Step 2: Hoist the body text** to one exported constant in `outlook-calendar-write.ts`,
  with no text change, as its own commit. Run both Outlook test files — expect PASS unchanged. ★
  This proves the hoist changed nothing before the rename changes something.

- [ ] **Step 3: Write the failing tests.** The existing tests hard-code the old prefix in their
  expectations, so updating them is part of this task — but add one reader test that asserts on
  **the request actually issued**, not on the constant:

```ts
it("filters Outlook events by the current category prefix", async () => {
  // Arrange a fetch mock the way the neighbouring reader tests do; read them first.
  // Act: call the reader.
  const url = decodeURIComponent(String(fetchMock.mock.calls[0][0]));
  expect(url).toContain("AIPM:");
  expect(url).not.toContain("AIPM:");   // the half that fails if only a constant changed
});
```

★★ The negative assertion is the load-bearing one, and it needs the positive beside it: on its own
`not.toContain` also passes when no request was made at all.

And one writer test asserting that **no** event body the writer builds contains the trigram, for
every writer the file exports (milestone, task, RAID, change, absence, meeting and the seventh),
with a positive control that each body is non-empty.

- [ ] **Step 4: Run them and watch them fail.**

```bash
npx vitest run src/app/outlook-calendar-read.test.ts src/app/outlook-calendar-write.test.ts --maxWorkers=1 --reporter=dot > "$TMP/t.log" 2>&1; echo "EXIT=$?"
```

Expect FAIL on the new assertions only. ★ Read the message — a failure from a missing export or an
unstubbed fetch is a broken test, not a reproduced gap.

- [ ] **Step 5: Implement.** Change `categoryFor` and the body constant. Update the existing
  expectations that spell the old prefix. Update the reader's docstring and the comment in
  `use-calendar-integrations.ts`.

- [ ] **Step 6: Run both files again** — expect PASS — then `npx tsc --noEmit; echo "EXIT=$?"`.

- [ ] **Step 7: Mutation rows, predicted in writing first, run individually.**

| # | Mutant | Prediction |
|---|---|---|
| 1 | restore the old prefix in `categoryFor` only | RED on the new reader test AND on writer category tests |
| 2 | restore the old body text in the constant only | RED on the body test only |

Restore by writing original bytes back; prove `git diff --stat` shows only the intended change
between rows. Report predicted vs actual, including any mismatch.

- [ ] **Step 8: Commit.**

---

### Task 2: Delete the dead `"AIPM"` style member

**Files:**
- Modify: `src/app/style-ci.ts` (the `CiStyle` union)
- Modify: `src/app/use-style.tsx` (the context default)
- Modify: `src/app/settings-sections/appearance-section.test.tsx` (the helper's parameter type)
- Test: `src/app/use-style.test.tsx`

**Interfaces:**
- Consumes: nothing.
- Produces: `CiStyle` without `"AIPM"`. No other task depends on it.

- [ ] **Step 1: Enumerate.** `git grep -n "CiStyle\|\"AIPM\"" -- src`. Classify each hit: the union
  member, the context default, a test type, the retired scheme-id fixture, or the legacy-value
  characterisation test. ★ The last two stay.

- [ ] **Step 2: Confirm the characterisation test exists.** `use-style.test.tsx` already pins that
  a stored legacy `"AIPM"` normalises to `"custom"` (search for "legacy"). That test is why
  deleting the member needs no migration. Do not weaken or rename it; it must keep storing the
  old literal, because stored values on real devices are the old literal.

- [ ] **Step 3: Delete the member**, set the context default to `"custom"`, and narrow the test
  helper's parameter type. Run `npx tsc --noEmit; echo "EXIT=$?"` — expect 0. ★ tsc is the test
  here: any remaining producer of `"AIPM"` as a `CiStyle` fails to compile.

- [ ] **Step 4: Run** `npx vitest run src/app/use-style.test.tsx src/app/settings-sections/appearance-section.test.tsx src/app/builtin-schemes.test.ts --maxWorkers=1 --reporter=dot > "$TMP/t.log" 2>&1; echo "EXIT=$?"` — expect PASS.

- [ ] **Step 5: Mutation row.** Change the initializer so a stored legacy value is returned as-is
  instead of `"custom"`. Predict RED on the characterisation test. Run, confirm, restore, prove
  `git diff --stat` shows only this task's intended change.

- [ ] **Step 6: Commit.**

---

### Task 3: Sweep the remaining trigram mentions outside `docs/`

**Files:** every file the boundary command in "Scope boundary" lists after Tasks 1–2, including
`src/app/globals.css`, `src/app/i18n.ts`, `src/app/i18n.de.ts`, `public/themes/AIPM.json`,
`e2e/a11y.spec.ts`, `AGENTS.md` and `CONTRIBUTING.md`.

**Interfaces:** none.

- [ ] **Step 1: List and classify every hit** into a table in the task report, one row per hit:

| Kind | Action |
|---|---|
| Comment naming the palette or brand as a *fact* | neutral wording ("the brand palette", "the default palette") keeping the reason the comment gives |
| Comment describing a rename still to come (`--AIPM-*`) | **delete** — that rename shipped as `--ui-*` |
| The retired scheme-id fixture and the legacy-value test | **leave**, add a one-line comment saying why the old spelling stays |
| i18n prose (EN + DE) | reword; DE via node utf8 write anchored on `\r\n` |
| `public/themes/AIPM.json` | rename the file and its `"name"` to a neutral one; first `git grep` the filename across the repo, `e2e/` included |
| A substring inside an unrelated word | false positive; record it and leave it |

★ Classify before editing. A table written after the edits documents what was done, not what was
decided, and cannot catch a wrong decision.

- [ ] **Step 2: Apply the edits.** Check `git ls-files --eol` on each CRLF file before and after.

- [ ] **Step 3: Verify i18n.** `git ls-files --eol src/app/i18n.de.ts` still reports `w/crlf`; the
  DE file has no ASCII umlaut substitutions; `npx tsc --noEmit` passes (it enforces EN/DE parity).

- [ ] **Step 4: Run the gates, unpiped, one at a time.**

```bash
npx vitest run src/app/use-style.test.tsx src/app/builtin-schemes.test.ts src/app/color-schemes.test.ts src/app/i18n-encoding.test.ts --maxWorkers=1 --reporter=dot > "$TMP/t.log" 2>&1; echo "EXIT=$?"
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src; echo "EXIT=$?"
npm run docs:claims:check; echo "EXIT=$?"
npm run docs:symbols:check; echo "EXIT=$?"
```

Before relying on the vitest line, check every listed test file exists — a missing path mixed with
real ones is dropped silently at exit 0. Assert `Test Files N` in the log matches the count.

- [ ] **Step 5: Confirm the boundary is clean**, with a positive control so the zero means
  something:

```bash
git grep -cIiP '(?<![a-z0-9])AIPM(?![a-z0-9])' -- . ':!docs' ':!CHANGELOG.md'   # expect: only the kept fixture/test lines
git grep -cIiP '(?<![a-z0-9])AIPM(?![a-z0-9])' -- docs                          # positive control: nonzero
```

- [ ] **Step 6: Commit.**
