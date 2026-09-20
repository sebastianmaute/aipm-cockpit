# Brand rename Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the brand trigram from the product — from the Outlook category prefix that
reaches external calendars, from the persisted style value, and from the stale comments and
document titles that still describe a rename which already happened.

**Architecture:** Two tasks. The first changes a value the product writes to an external system
and is the only one carrying real risk; the second is a type-declaration change plus prose
cleanup, because the migration it was originally scoped around turned out to already exist.

**Tech Stack:** TypeScript, vitest, the existing npm gate scripts.

**Spec:** `docs/superpowers/specs/2026-09-20-github-migration-phase1-design.md`

**Companion plan:** `docs/superpowers/plans/2026-09-20-sanitise-and-rewrite-history.md`.
**This plan must be merged before that plan's Task 7 (the history rewrite) runs**, so the tip
already carries the new spellings and the old ones survive only in history, where a text
replacement is correct and harmless.

## Why this is smaller than it looks, and where the risk actually sits

Measured 2026-09-20, correcting the spec's first draft in both directions:

- The `--AIPM-*` custom-property family **does not exist** — it was renamed to `--ui-*` in an
  earlier release. Only a stale comment and a stale document title still claim otherwise.
- The legacy built-in scheme id is **retired**, surviving only in a hand-built test fixture.
- The persisted style value's load path **already normalises** legacy values and is pinned by a
  test, so no new migration logic is needed.
- The real exposure is `categoryFor`, which writes the trigram as an **Outlook category onto every
  synced calendar event**, read back with OData string equality.

★★★ That last one is renamed outright, with no compatibility shim, **only because the repository
owner states (2026-09-20) that no user has ever run a calendar sync**, so no event carries the old
prefix. This is a fact about the installed base, not about the code. The equality filter remains
unforgiving: the same rename after one real sync would silently stop two-way sync from recognising
every event created before it, and nothing in this repository could detect that. Re-establish the
premise before reusing this reasoning.

## Global Constraints

- **New prefix spelling:** `AIPM:` — the product's own initials, neutral and self-describing.
- **New style value:** `standard`. Deliberately **not** `classic`, which already names a *layout*
  in this app. ★ Note `"standard"` also exists as an unrelated literal in the help reading-level
  union, surfaced in the same settings panel; the two must not be conflated.
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

## Review Focus

1. **The read filter and the write prefix drifting apart.** They are two symbols in two files; a
   rename that changes one silently stops sync from finding its own events (Task 1).
2. **A test that asserts the new prefix while the filter still sends the old one**, because it
   asserts on a constant rather than on the request actually issued (Task 1).
3. **The stale comment being "corrected" to describe a second rename** rather than deleted — it
   documents a rename that already shipped under a different name (Task 2).
4. **The retired scheme-id fixture being renamed**, which would quietly stop exercising the
   generic built-in guard it exists for (Task 2).
5. **DE i18n corruption** from editing the German dictionary with the wrong tool (Task 2).

---

### Task 1: Rename the Outlook category prefix

**Files:**
- Modify: `src/app/outlook-calendar-write.ts` (`categoryFor` and the prefix constant)
- Modify: `src/app/outlook-calendar-read.ts` (the OData category filter)
- Test: the existing Outlook calendar test files for those two modules

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `AIPM:` as the category prefix written and matched. The companion plan's Task 7
  relies on this being merged, so that the old spelling exists only in history.

- [ ] **Step 1: Find every site.** Both the writer and the reader, plus every call site:

```bash
git grep -n "categoryFor\|AIPM:" -- src
```

Record the count of write call sites and the read filter's exact shape. ★ If the prefix is
spelled inline at any call site rather than coming from one constant, hoist it to a single
exported constant **first**, as its own commit — two spellings of a protocol value is the defect
this task exists to prevent.

- [ ] **Step 2: Write the failing test.** Assert on **the request the reader actually issues**,
not on the constant, so the test cannot pass while the filter still sends the old value:

```ts
it("filters Outlook events by the current category prefix", async () => {
  const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ value: [] }) });
  vi.stubGlobal("fetch", fetchMock);

  await listSyncedEvents(/* the module's own args */);

  const url = String(fetchMock.mock.calls[0][0]);
  expect(url).toContain("AIPM:");
  expect(url).not.toContain("AIPM:");   // the half that fails if only the constant changed
});
```

★★ The negative assertion is the load-bearing one, and it needs the positive beside it: on its own
`not.toContain` also passes when no request was made at all.

- [ ] **Step 3: Run it and watch it fail.**

```bash
npx vitest run src/app/outlook-calendar-read.test.ts --maxWorkers=1 --reporter=dot > /tmp/t.log 2>&1; echo "EXIT=$?"
```

Expect FAIL on the `toContain("AIPM:")` assertion. ★ Read the message — a failure from a missing
export or an unstubbed fetch is a broken test, not a reproduced gap.

- [ ] **Step 4: Write the matching writer test**, asserting the category array on the event body
the writer PUTs, in the same style.

- [ ] **Step 5: Implement.** Change the single prefix constant. Both modules must read it from one
place; if they cannot import across their boundary, pin them equal with a test that reads the
other file as text, following the precedent already used for the two release URLs.

- [ ] **Step 6: Run both tests** — expect PASS — then `npx tsc --noEmit; echo "EXIT=$?"`.

- [ ] **Step 7: Mutation rows, run individually, predicted in writing first.**

| # | Mutant | Prediction |
|---|---|---|
| 1 | revert the WRITE prefix only | RED on the writer test, GREEN on the reader test |
| 2 | revert the READ filter only | RED on the reader test, GREEN on the writer test |

★★★ Run them **separately**. A combined revert proves the pair is load-bearing and tells you
nothing about which test pins which side — and "the two drifted apart" is precisely the failure
this task guards against. Restore by writing original bytes back; prove `git diff --stat` empty
between rows. Report predicted vs actual, including any mismatch.

- [ ] **Step 8: Commit.**

---

### Task 2: Rename the persisted style value and clear the stale brand prose

**Files:**
- Modify: `src/app/style-ci.ts` (the `CiStyle` union)
- Modify: every file referencing the renamed member (find them, do not assume)
- Modify: `src/app/globals.css` (delete the stale comment)
- Modify: `docs/DESIGN-TOKENS.md` (the title)
- Modify: `src/app/i18n.ts` and `src/app/i18n.de.ts` (two prose mentions)
- Test: `src/app/use-style.test.tsx`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: no symbol other tasks depend on.

- [ ] **Step 1: Enumerate honestly.**

```bash
git grep -n "CiStyle" -- src
git grep -nI "AIPM\|AIPM" -- src docs e2e scripts
```

Classify each hit: the union member, the retired scheme-id fixture, stale prose, or a false
positive. ★ Some hits are substring matches inside unrelated identifiers — check each rather than
sweeping.

- [ ] **Step 2: Write the failing test** in `use-style.test.tsx`, beside the existing legacy-value
test, asserting that a stored legacy value still resolves and that the new member is accepted:

```tsx
it("accepts the renamed style value and still normalises the legacy one", () => {
  localStorage.setItem(STYLE_STORAGE_KEY, "AIPM");     // legacy, as previously stored
  const { result } = renderHook(() => useStyle(), { wrapper: CiStyleProvider });
  expect(result.current.style).toBe("custom");         // existing normalisation, unchanged
});
```

★★ This pins the behaviour that makes the rename safe. It is deliberately an assertion about the
EXISTING shim, because the shim is the reason no new migration is needed — if a future change
removes it, this test is what says so.

- [ ] **Step 3: Run it.** It may pass immediately, since the shim already exists. That is fine and
expected — record it as a characterisation test, and say so in its comment. ★ Do NOT manufacture a
red by weakening the shim; a test that documents existing behaviour is honest, a fabricated
failure is not.

- [ ] **Step 4: Rename the union member** to `standard` and fix every consumer tsc names.

- [ ] **Step 5: Leave the retired scheme-id fixture ALONE.** It exists to exercise a generic
built-in guard and a test asserting the id is absent from the live set. Renaming it would quietly
stop testing that guard. Add a one-line comment saying why the old spelling stays.

- [ ] **Step 6: Delete the stale CSS comment.** It claims the custom properties are still named
after the brand and that a neutral rename is coming. Both halves are false — the rename shipped
under a different name. **Delete it rather than rewriting it**; a corrected version would still
describe work nobody is going to do.

- [ ] **Step 7: Retitle the design-tokens doc**, and fix the two i18n prose mentions.
★★★ Patch `i18n.de.ts` with a node utf8 write anchored on `\r\n`, never the Edit or Write tool,
then verify: `git ls-files --eol src/app/i18n.de.ts` still reports `w/crlf`, and the DE file has
no ASCII umlaut substitutions.

- [ ] **Step 8: Run the gates, unpiped.**

```bash
npx vitest run src/app/use-style.test.tsx src/app/builtin-schemes.test.ts src/app/color-schemes.test.ts --maxWorkers=1 --reporter=dot > /tmp/t.log 2>&1; echo "EXIT=$?"
npx tsc --noEmit; echo "EXIT=$?"
npx eslint --max-warnings=0 src; echo "EXIT=$?"
npm run docs:claims:check; echo "EXIT=$?"
npm run docs:symbols:check; echo "EXIT=$?"
```

★ `tsc` enforces EN/DE key parity, so it is the check that catches a half-done i18n edit.

- [ ] **Step 9: Confirm the trigram is gone from the product**, with a positive control so the
zero means something:

```bash
git grep -cI "AIPM:" -- src ; echo "expect: no matches"
git grep -cI "AIPM:" -- src ; echo "expect: at least one"
```

- [ ] **Step 10: Commit.**
