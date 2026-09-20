# Sanitise the tree and rewrite history Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove every internal identifier from the working tree and from all history, strip the
session trailers, rewrite the commit identities, and remap the commit citations — ending with a
repository that could safely be made public, without making it public.

**Architecture:** Three phases. Phase A fixes the tree as ordinary reviewed commits with tests,
because the fixture and product changes need a test suite that a history-rewriting tool cannot
run. Phase B runs one `git filter-repo` pass over a throwaway clone to fix what only exists in
old commits — blob text, commit messages, and author/committer identities. Phase C remaps the
commit citations from the rewrite's own commit map and verifies the result with scans that each
carry a positive control.

**Tech Stack:** `git filter-repo` (Python, installed separately from git), Node scripts under
`scripts/`, vitest, the existing npm gate scripts.

**Spec:** `docs/superpowers/specs/2026-09-20-github-migration-phase1-design.md`

**Companion plan:** `docs/superpowers/plans/2026-09-20-brand-rename-and-settings-migration.md`
covers Phase A's brand rename, which ships on its own first. **That plan must be merged before
Task 7 of this plan runs**, or the rewrite will bake the old brand spelling into history and the
work will have to be redone.

## Global Constraints

- **Cite symbols, never line numbers, in any doc or plan text.** `npm run docs:claims:check` is a
  ratchet that FAILS on a newly added `path:LINE` citation. This overrides the writing-plans
  template's `path:123-145` form.
- **Never read an exit code through a pipe.** Redirect, echo `$?`, then read the file.
- **`src/app/*.ts(x)` are CRLF; `docs/`, `e2e/`, `scripts/` are LF.** Check `git ls-files --eol`
  before and after every file you touch. Never use `sed -i` — under Git Bash it re-lines a whole
  CRLF file to LF and `core.autocrlf=true` hides it from the diff.
- **Never edit `src/app/i18n.de.ts` with the Edit or Write tool** — it corrupts umlauts and curls
  quotes. Use a node utf8 write whose anchors match `\r\n`.
- **Never `git add -A` or `git add .`** — commit with `git commit --only <paths> -F <msgfile>`.
  Never `--amend`. Never a bare `git stash`. `git checkout --` and `git restore` are deny-blocked.
- **Never open, print or stage any `.env*` file.** An untracked `.bak` file in this project holds
  a live credential.
- **One vitest process at a time**, scoped to files: `npx vitest run <file> --maxWorkers=1
  --reporter=dot`. Another session shares this machine.
- **This plan does not make anything public and does not push to GitHub.** It also does not touch
  the GitLab project's settings.

## Review Focus

Failure modes the spec implies that no single task's happy path exercises. Each has a test in the
task that owns it.

1. **A scan that returns zero because it scanned nothing.** Every verification scan must be shown
   to return a specific nonzero count against the pre-rewrite clone before its zero is believed
   (Tasks 8, 9).
2. **Text replacement matching something nobody predicted.** A blind substitution over 8,422
   commits can silently alter unrelated content; the old-tip↔new-tip diff must contain only
   intended changes (Task 8).
3. **A citation remap that silently drops an unmappable entry**, passing a "do they all resolve?"
   check because the dropped one is no longer present to fail (Task 9).
4. **A golden-fixture regen that writes truncated fixtures over full ones and reports success.**
   This has happened in this repo before; compare fixture sizes, not exit codes (Task 3).
5. **The generated guide file silently reverting the fix** on the next regeneration, because the
   generated artifact was edited instead of its source (Task 4).

---

### Task 1: Make the policy link configurable

**Files:**
- Modify: `src/app/chat-panel.tsx` (the `POLICY_URL` constant and its single consumer)
- Test: `src/app/chat-panel.test.tsx`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: the link is rendered only when a policy URL is configured; no later task depends on
  the symbol's name.

Today `POLICY_URL` is a hard-coded deep link into a company wiki tenant, rendered in the chat
panel. In a public build it hands every user a link they cannot follow. The fix is a behaviour
change, not a string edit: no configured URL means no link.

- [ ] **Step 1: Read the current site.** `grep -n "POLICY_URL" src/app/chat-panel.tsx` — note the
  constant and the element that consumes it, and how neighbouring optional settings are read
  (this app reads optional config from `settings`, falling back to an env var).

- [ ] **Step 2: Write the failing test.** Add to `src/app/chat-panel.test.tsx`, following the
  file's existing render helper rather than inventing one:

```tsx
it("renders no policy link when no policy URL is configured", () => {
  renderChatPanel({ /* default settings: no policy URL */ });
  expect(screen.queryByRole("link", { name: /policy/i })).toBeNull();
  // Positive control: the panel itself rendered, so the absence above is
  // an absence of the LINK, not an absence of the panel.
  expect(screen.getByRole("textbox")).toBeInTheDocument();
});
```

★★ The positive control is load-bearing. A bare `queryByRole(...)).toBeNull()` also passes when
the component threw, rendered nothing, or was never mounted — it cannot tell "no link" from "no
panel".

- [ ] **Step 3: Run it and watch it fail.** `npx vitest run src/app/chat-panel.test.tsx
  --maxWorkers=1 --reporter=dot > /tmp/t.log 2>&1; echo "EXIT=$?"` — expect FAIL, and read the
  message: it must be the link being found, not a render error.

- [ ] **Step 4: Implement.** Replace the hard-coded constant with a value read from settings
  (falling back to an env var if that is the neighbouring pattern), and render the link only when
  it is a non-empty string.

- [ ] **Step 5: Run the test again.** Expect PASS. Then `npx tsc --noEmit; echo "EXIT=$?"` —
  vitest never typechecks, and a test-only type error passes the suite and fails CI.

- [ ] **Step 6: Mutation row.** Revert the render guard so the link renders unconditionally.
  Predict RED on the new test, run it, confirm, then restore by writing the original bytes back
  and prove `git diff --stat` is empty. Report predicted vs actual.

- [ ] **Step 7: Commit.**

```bash
git commit --only src/app/chat-panel.tsx src/app/chat-panel.test.tsx -F <msgfile>
```

---

### Task 2: Neutralise the register entry's own quoting

**Files:**
- Modify: `docs/open-followups.md` (entry 200 only)

**Interfaces:**
- Consumes: nothing.
- Produces: an entry that survives Task 7's text replacement intact.

Entry 200 quotes the identifier strings it hunts, inside its own reproduce commands. Task 7
replaces those strings everywhere, which would rewrite the entry into instructions to grep for
the replacement string — destroying the record of why the rewrite happened.

- [ ] **Step 1: Read the entry in full**, including its Status line and its reproduce block.

- [ ] **Step 2: Restate the reproduce commands** so they describe what to search for without
  spelling the identifiers literally — e.g. a command that reads the pattern from a variable or a
  file, or prose naming the pattern class ("the employer's domain") with the concrete list kept in
  the scan script that Task 6 adds. The entry must still tell a reader exactly how to reproduce.

- [ ] **Step 3: Keep the Status line conforming.** `npm run followups:status:check` requires every
  OPEN entry to carry a `**Status:**` block with an ISO date and either a backticked command
  matching `grep|npm run|npx|node scripts` or the literal words `never machine-verified`. If your
  rewrite removes the backticked command, the gate fails — cite the new scan script instead.

- [ ] **Step 4: Run the register gates, unpiped.**

```bash
npm run followups:index:check; echo "EXIT=$?"
npm run followups:workitems:check; echo "EXIT=$?"
npm run followups:status:check; echo "EXIT=$?"
npm run docs:claims:check; echo "EXIT=$?"
```

All four must be 0. ★ `followups:index:check` exit 2 means "could not scan" and is worse than
exit 1 — report it loudly rather than retrying.

- [ ] **Step 5: Commit.** `git commit --only docs/open-followups.md -F <msgfile>`

---

### Task 3: Replace the identities in the sample fixtures

**Files:**
- Modify: `sample-workspace-small.json` (the hand-curated master, repo root)
- Regenerate: the scaled variants, via `scripts/generate-sample-workspace.ts`
- Regenerate: `src/app/__fixtures__/golden-workspace.csv` and `golden-workspace.md`
- Test: `src/app/golden-workspace.test.ts` (byte-pinned; it will go green on the NEW bytes)

**Interfaces:**
- Consumes: nothing.
- Produces: fixture data containing no real-looking company addresses.

The master carries 42 addresses at the employer's domain across five `firstname.lastname`
local-parts. The rest of the file is already neutralised (`example.sharepoint.com`,
`example.atlassian.net`), so this is an oversight, not a choice. Treat the addresses as real
personal data.

- [ ] **Step 1: Enumerate what you are changing.**

```bash
grep -oE '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+' sample-workspace-small.json | sort | uniq -c | sort -rn
```

Record the five local-parts and the 42 occurrences. You will assert both counts afterwards.

- [ ] **Step 2: Record the current fixture sizes.** These are the baseline for Step 6.

```bash
wc -c sample-workspace-small.json src/app/__fixtures__/golden-workspace.csv src/app/__fixtures__/golden-workspace.md
```

- [ ] **Step 3: Edit the master only.** Replace each local-part with a fictional name at
  `example.com`, keeping the same five distinct people so the fixture's relationships still hold.
  Do not hand-edit the scaled variants or the goldens — they are generated.

- [ ] **Step 4: Regenerate the scaled variants.**

```bash
npx vite-node scripts/generate-sample-workspace.ts; echo "EXIT=$?"
```

- [ ] **Step 5: Regenerate the goldens** through the serializers, following the procedure in
  `src/app/golden-workspace.test.ts`'s own header comment (it documents how the fixtures are
  produced). Do not edit them by hand.

- [ ] **Step 6: Compare sizes, not exit codes.** Re-run the `wc -c` from Step 2. ★★★ A golden
  regen has previously written TRUNCATED fixtures over full ones and reported success. Each file
  must be within a few percent of its old size; a file that collapsed to a few hundred bytes is a
  failed regen wearing a green exit code.

- [ ] **Step 7: Assert the addresses are gone, with a positive control.**

```bash
grep -c "@example.com" sample-workspace-small.json   # must be 42
grep -cE '@[A-Za-z0-9.-]*consult' sample-workspace-small.json   # must be 0
```

The first command is the positive control: a zero from the second means nothing if the file was
truncated to nothing, and the first proves it was not.

- [ ] **Step 8: Run the byte-pinned test.**

```bash
npx vitest run src/app/golden-workspace.test.ts --maxWorkers=1 --reporter=dot > /tmp/t.log 2>&1; echo "EXIT=$?"
```

Expect PASS on the new bytes. A failure here means the regen did not match the serializers.

- [ ] **Step 9: Commit** the master, the generated variants and both goldens together — they are
  one logical change and a partial commit leaves the byte-pinned test red.

---

### Task 4: Fix the work address in the operating guide, at its source

**Files:**
- Modify: `lib/project-leadership-operating-guide.md` (the SOURCE)
- Regenerate: `src/app/operating-guide-builtin.generated.ts` via `scripts/gen-operating-guide.mjs`
- Test: `src/app/operating-guide-builtin.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: guide content carrying no work address.

★★★ The generated file embeds the guide verbatim. Editing the generated file is the trap: the
next regeneration silently reverts it. Fix the markdown, then regenerate.

- [ ] **Step 1: Locate the address in the source.**

```bash
grep -nE '[A-Za-z0-9._%+-]+@' lib/project-leadership-operating-guide.md
```

- [ ] **Step 2: Confirm it is embedded in the generated file too.**

```bash
grep -c "BUILTIN_GUIDE_CONTENT" src/app/operating-guide-builtin.generated.ts
grep -cE '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]*consult' src/app/operating-guide-builtin.generated.ts
```

The second count must be nonzero now and zero after Step 4 — that pair is the whole check.

- [ ] **Step 3: Edit the markdown source only.** Remove the address or replace it with a neutral
  contact instruction. Do not touch the generated file.

- [ ] **Step 4: Regenerate.** There is no npm script for this generator; invoke it directly.

```bash
node scripts/gen-operating-guide.mjs; echo "EXIT=$?"
```

- [ ] **Step 5: Re-run the Step 2 counts.** The generated file's count must now be 0 while the
  file is still substantial (`wc -c` it — a generator that wrote an empty file also scores 0).

- [ ] **Step 6: Run the guide test.**

```bash
npx vitest run src/app/operating-guide-builtin.test.ts --maxWorkers=1 --reporter=dot > /tmp/t.log 2>&1; echo "EXIT=$?"
```

- [ ] **Step 7: Commit** the source and the regenerated file together.

---

### Task 5: Repoint the README badges

**Files:**
- Modify: `README.md`

**Interfaces:**
- Consumes: nothing.
- Produces: a README with no internal group path.

- [ ] **Step 1: Find them.** `grep -nE 'gitlab|badge|shields' README.md`

- [ ] **Step 2: Decide per badge.** A badge whose image URL is the internal host renders as a
  broken image for every public visitor AND discloses the internal group path. Either drop the
  badge or repoint it at a host-independent source (for example a shields.io endpoint reading a
  value from the repo). **Do not invent a GitHub URL** — the organisation and repository do not
  exist yet; that repoint belongs to the cut-over sub-project.

- [ ] **Step 3: Verify nothing internal remains.**

```bash
grep -cE 'gitlab|consult' README.md   # must be 0
wc -l README.md                        # must still be a real README
```

- [ ] **Step 4: Run the docs gates.** `npm run docs:claims:check; echo "EXIT=$?"` and
  `npm run docs:symbols:check; echo "EXIT=$?"` — both 0.

- [ ] **Step 5: Commit.**

---

### Task 6: Add the leak scan as a script, with its own tests

**Files:**
- Create: `scripts/check-identifier-leaks.mjs` (CLI: exit codes and I/O)
- Create: `scripts/identifier-leak-lib.mjs` (pure: pattern building and classification)
- Create: `scripts/identifier-leak-lib.test.mjs`
- Modify: `package.json` (add `leaks:check`), `CONTRIBUTING.md` (script description)

**Interfaces:**
- Consumes: nothing.
- Produces: `npm run leaks:check`, used by Task 8's verification and kept permanently in CI.
  The lib exports `buildPatterns()`, `classifyHit(path, line)` and `ABSENCE_MARKERS`.

This is the gate that stops a re-introduced identifier reaching a public repo. It scans the
**tree** (history is Task 9's job).

★★ It must not flag documents that legitimately name what they forbid — entry 200 and the
migration spec both do. Follow the existing convention in `scripts/check-agents-symbols.mjs`:
an `ABSENCE_MARKERS` list that suppresses a hit when the surrounding text marks it as a
deliberate mention. ★★★ Never widen the marker list to make a pipeline pass — a defeated gate
reports success.

- [ ] **Step 1: Split pure from I/O, following this repo's own precedent.** The parsing and
  classification go in `identifier-leak-lib.mjs` with no shebang (★ a `#!` on an imported `.mjs`
  makes vitest throw naming the WRONG file); the CLI owns `readFileSync`, stdout and exit codes.

- [ ] **Step 2: Write the failing lib test** in `scripts/identifier-leak-lib.test.mjs`
  (`vitest.config.ts`'s `include` already covers `scripts/**/*.test.mjs`):

```js
import { describe, it, expect } from "vitest";
import { classifyHit } from "./identifier-leak-lib.mjs";

describe("classifyHit", () => {
  it("reports a bare identifier as a leak", () => {
    expect(classifyHit("src/app/foo.ts", 'const h = "acme-corp.example";').kind).toBe("leak");
  });

  it("suppresses a mention marked as deliberately absent", () => {
    const line = 'Do NOT reintroduce "acme-corp.example" here.';
    expect(classifyHit("docs/open-followups.md", line).kind).toBe("allowed");
  });

  it("does not suppress a leak merely because the file is a doc", () => {
    // The marker, not the file type, is what suppresses. A doc that names the
    // identifier WITHOUT a marker is still a leak.
    expect(classifyHit("docs/whatever.md", "host: acme-corp.example").kind).toBe("leak");
  });
});
```

★ The third case is the one that matters: a first cut that suppresses by file path would pass the
first two and make every document a blind spot.

- [ ] **Step 3: Run it and watch it fail.** `npx vitest run scripts/identifier-leak-lib.test.mjs
  --maxWorkers=1 --reporter=dot > /tmp/t.log 2>&1; echo "EXIT=$?"`

- [ ] **Step 4: Implement the lib, then the CLI.** The CLI exits **1** on a leak and **2** when it
  could not scan (no files matched, or the pattern list came back empty) — this repo's gates split
  those deliberately, because a scan that reads nothing passes everything. Include a minimum-files
  floor like the register gates use.

- [ ] **Step 5: Prove the vacuity guard.** Point the CLI at an empty directory and confirm it
  exits **2**, not 0.

- [ ] **Step 6: Run it against the real tree.** Expect exit 0 after Tasks 1–5. If it reports a
  hit, that is a real finding — fix it rather than widening the markers.

- [ ] **Step 7: Add the script-description entry.** `npm run build` runs a prebuild check that
  fails when a new script has no description. Read which docs participate rather than assuming:

```bash
git grep -lE "<!-- END AUTO-GENERATED --[>]" -- "*.md"
```

- [ ] **Step 8: Wire it into CI** as a blocking quality job beside the other gate jobs, then
  **commit**.

---

### Task 7: The history rewrite

**Files:**
- Create: `scripts/rewrite-history/replacements.txt` (the substitution list)
- Create: `scripts/rewrite-history/mailmap` (the identity mapping)
- Create: `scripts/rewrite-history/run.sh` (documented, re-runnable)
- **No repository file is modified by this task.** It operates on a throwaway clone.

**Interfaces:**
- Consumes: a merged brand-rename plan and Tasks 1–6 merged, so the tip is already clean.
- Produces: a rewritten clone at a known path, plus the commit map
  `.git/filter-repo/commit-map`, which Task 9 consumes.

**PRECONDITION — do not start this task until the companion brand-rename plan is merged**, or the
old brand spelling is baked into every rewritten commit and this task must be redone from scratch.

- [ ] **Step 1: Confirm the tool exists.** `git filter-repo --version` — it is a separate Python
  program, not part of git. If it is absent, stop and report; do not substitute `filter-branch`,
  which is slower and has different, worse semantics for this job.

- [ ] **Step 2: Make the throwaway clone.** A fresh `git clone --no-local --mirror` of the current
  repository into a scratch directory outside the working tree. ★ `filter-repo` refuses to run on
  a non-fresh clone by default, and that refusal is a safety feature — do not pass `--force` to
  silence it on your real checkout.

- [ ] **Step 3: Write the replacement list.** `replacements.txt` in `filter-repo`'s
  `literal:old==>new` form, one per line: the employer name in each spelling that occurs, the
  internal hosts, the wiki tenant host, the numeric project path, and the session URL prefix.
  Derive the list from the scan lib written in Task 6 so the two cannot drift.

  ★★★ **CLASSIFY EVERY CANDIDATE AS *disclosure* OR *protocol* FIRST.** A disclosure is a
  mention; a protocol value is written to or read back from something outside this repository.
  `filter-repo` rewrites the TIP as well as history, so sweeping a protocol value into this list
  silently changes product behaviour, and **no test in this repository can see it**.

  Enumerate the candidates and decide each one explicitly:

```bash
git grep -nIiE "ic[- ]consult|AIPM:" -- src desktop e2e scripts
```

  The known protocol value is the Outlook category prefix in `categoryFor`
  (`outlook-calendar-write.ts`), matched by OData string equality on the read side. It is renamed
  by the companion brand-rename plan **before** this task runs, so by the time you build this list
  the tip already carries the new prefix and the old one survives only in history — where
  replacing it is correct and harmless. If your enumeration turns up a protocol value that has
  NOT already been handled that way, stop and report it rather than adding it here.

- [ ] **Step 4: Write the mailmap.** Map the work address to the personal address supplied by the
  repository owner at execution time (it is deliberately not recorded in any tracked file), and
  map the 90 CI-bot identities to one neutral CI identity.

- [ ] **Step 5: Write the message callback.** It deletes lines beginning with the session trailer
  key and lines beginning with the assistant co-author key. ★★★ It must match the TRAILER LINES,
  never the assistant's name: 89 commits mention it legitimately because a shipped feature is
  named after it and a real function carries its name. A name-based filter corrupts those commits.

- [ ] **Step 6: Run the rewrite** on the clone, keeping the emitted commit map. Record the
  before/after commit counts — they must be equal, since nothing is being dropped.

- [ ] **Step 7: The diff check.** Compare the old tip against the new tip. The difference must
  contain **only** intended substitutions. Anything else is the replacement list having matched
  something you did not predict — the characteristic failure of blind substitution, and the
  cheapest check that catches it.

- [ ] **Step 8: Commit the scripts** (not the clone) so the rewrite is reproducible and reviewable.

---

### Task 8: Verify the rewritten history

**Files:**
- Create: `scripts/verify-rewrite.mjs`
- Create: `scripts/verify-rewrite.test.mjs`

**Interfaces:**
- Consumes: the rewritten clone and the original clone from Task 7.
- Produces: a pass/fail verdict over three substrates, each with a positive control.

★★★ **Every scan here runs twice: against the ORIGINAL clone, where it must find a specific
nonzero count, and against the REWRITTEN clone, where it must find zero.** A single zero cannot
distinguish "clean" from "scanned nothing", and the exit code is identical in both cases.

- [ ] **Step 1: Blobs.** Walk every object reachable from every ref — `git rev-list --all
  --objects` piped into `git cat-file --batch` — not the checked-out tree. A `git grep` sees one
  commit and would pass trivially.

- [ ] **Step 2: Messages.** `git log --all --format=%B` across every ref, for the trailer keys and
  the session URL.

- [ ] **Step 3: Identities.** `git log --all --format="%ae%n%ce" | sort -u` must **equal** a
  one-line allowlist. ★ This is a set-equality check, not a search for known-bad values, so an
  identity nobody predicted still fails it. A search-based check would pass on an address the
  author never thought to look for.

- [ ] **Step 4: Record the original-clone counts** for all three scans. Each must be nonzero, and
  the identity scan must report exactly the identities measured in the spec. If any is zero, the
  scan is broken — fix the scan before trusting any later zero.

- [ ] **Step 5: Run all three against the rewritten clone.** Each must be zero, except the
  identity set, which must equal the allowlist exactly.

- [ ] **Step 6: Write the lib test** covering the classification logic with fixtures, including
  one case per substrate, and one case proving the scan fails when handed a planted identifier.

- [ ] **Step 7: Commit.**

---

### Task 9: Remap the commit citations

**Files:**
- Create: `scripts/remap-commit-citations.mjs`
- Create: `scripts/remap-commit-citations.test.mjs`
- Modify: `docs/**` (the citations themselves, mechanically)

**Interfaces:**
- Consumes: `.git/filter-repo/commit-map` from Task 7, and the rewritten clone.
- Produces: docs whose backticked commit citations resolve in the new history.

There are roughly 1,095 backticked short SHAs across the docs, about 511 in the register alone.
A small share do not resolve **today** — pre-existing dangling references.

- [ ] **Step 1: Inventory before touching anything.**

```bash
git grep -ohE '`[0-9a-f]{7,10}`' -- docs '*.md' | wc -l
```

Record the number. It is the count that must be preserved.

- [ ] **Step 2: Classify every citation** against the ORIGINAL clone: resolvable, or already
  dangling. ★★ The dangling ones must be listed and LEFT ALONE, not "repaired" into whatever the
  map happens to offer — they were already broken and inventing a target hides that.

- [ ] **Step 3: Write the failing test** for the remap function: given a map and a doc string, it
  rewrites resolvable citations, leaves dangling ones untouched, and preserves the total count.

```js
it("preserves the citation count even when a citation cannot be mapped", () => {
  const map = new Map([["aaaaaaa", "1111111"]]);
  const out = remap("see `aaaaaaa` and `bbbbbbb`", map);
  expect(out).toContain("1111111");
  expect(out).toContain("bbbbbbb");           // untouched, not dropped
  expect(count(out)).toBe(2);                  // the failure mode that matters
});
```

- [ ] **Step 4: Run it and watch it fail**, then implement.

- [ ] **Step 5: Check abbreviation uniqueness.** Short prefixes get more collision-prone after a
  rewrite. For each remapped citation, confirm the abbreviated form still resolves to exactly one
  object in the new history; lengthen it if not.

- [ ] **Step 6: Apply, then verify both failure modes.** Every cited SHA resolves in the new
  history, AND the total count equals Step 1's number. The second check is the one that catches a
  silent drop, because a dropped citation cannot fail the first.

- [ ] **Step 7: Run the doc gates** — `docs:claims:check`, `followups:index:check`,
  `followups:status:check`, each unpiped, each 0.

- [ ] **Step 8: Commit.**

---

### Task 10: Record the outcome

**Files:**
- Modify: `docs/open-followups.md` (entry 200)

- [ ] **Step 1: Update entry 200** to state what is done and what remains. It stays OPEN: this
  plan sanitises, it does not make anything public, and the entry's own title is about the
  visibility flip. Say which of the six classes are closed and that the flip is sequenced last in
  the roadmap.

- [ ] **Step 2: Keep the Status line conforming** — ISO date plus a backticked command, and cite
  `npm run leaks:check`, which now exists and is the honest verification.

- [ ] **Step 3: Run the four register/doc gates unpiped**, all 0, then **commit**.
