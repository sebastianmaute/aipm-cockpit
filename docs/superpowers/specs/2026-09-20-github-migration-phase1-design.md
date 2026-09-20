# Sanitise the tree and settle history — GitHub migration, sub-project 1

**Date:** 2026-09-20
**Roadmap:** `2026-09-20-github-migration-roadmap.md` (sub-project 1 of five)
**Supersedes in scope:** register §200 / work item #185

## Goal

End with a repository that could be made public without disclosing the author's employer, their
work mailbox, internal hosts, or per-session assistant URLs — in the working tree **and in all
history** — while keeping granular commit history and keeping every commit citation in the docs
resolvable.

This sub-project does **not** make anything public. The visibility flip is the last step of the
roadmap, deliberately.

## Why the tree is not enough

The GitHub mirror carries full history. A value deleted in commit N stays readable in commit N-1
forever, so sanitising the working tree is necessary and not sufficient. The history question
has to be settled **before** the visibility flip, because after it there is nothing to settle —
a clone taken inside the window keeps everything.

## What §200 missed, and why

§200 lists four classes of identifier and gives `git grep` sweeps as its reproduce commands.
Those sweeps read **one commit's files**. Two of the six real classes are therefore invisible to
its own verification method:

- **Commit metadata.** Every commit carries the employer address in both author and committer
  fields — 8,355 of them — plus 90 CI-bot identities embedding the internal host and project id.
  No sweep over file content can see this. It is the largest single class and the one that
  cannot be fixed after the fact by any means short of the rewrite this spec describes.
- **Commit messages and session URLs.** 3,048 commits carry a session trailer and 217 carry an
  assistant co-author line; separately, 83 tracked plan files contain session URLs in their
  body.

★★ This is worth stating plainly because it generalises: **a verification method has a shape,
and a finding outside that shape reads as absence.** §200 was not careless; it checked files, so
it found file problems, and the absence of metadata findings read as there being none.

## The six classes

| # | Class | Substrate | Fix shape |
|---|---|---|---|
| 1 | Badges pointing at the internal group path | tree | edit |
| 2 | A live wiki deep link that **renders in the product** | tree | behaviour change — make configurable |
| 3 | A work address in guide content **and its generated copy** | tree | edit source, re-run generator |
| 4 | Real-looking addresses across the sample workspaces | tree | 4-step generated pipeline |
| 5 | Author/committer identities, and CI-bot identities | **metadata** | history rewrite |
| 6 | Session trailers, co-author lines, session URLs in plan files | **messages + tree** | history rewrite |

Two further product strings join class 2: the release URL is hard-coded in both the app and the
desktop shell, kept in step only by a text-comparison test. They must move together.

## Strategy — three phases

The fork worth recording is **what goes through the rewriting tool**. Classes 1–4 are product
and fixture changes that need tests; a history-rewriting tool is a blind text substitution over
blobs and cannot regenerate a fixture or run a suite. Putting them through it produces a history
whose fixtures no longer match their own generators.

### Phase A — ordinary commits, reviewed, CI-green

Fix classes 1–4 and the product release URLs the normal way, on a branch, each with its tests
and the full pipeline. Afterwards the tip is clean in a way that is *verified* rather than
asserted.

Tasks, each its own commit:

1. **Brand rename.** ★★ Measured 2026-09-20, and it corrected this spec twice: the brand trigram
   is far smaller than assumed in code, and far larger than assumed outside it.
   - The `--AIPM-*` custom properties **do not exist**. They were renamed to `--ui-*` in an earlier
     release; all that survives is a stale comment claiming the rename is still pending, and a
     stale document title. Comment and doc cleanup, not a code change.
   - The legacy built-in scheme id is **retired**, surviving only in a hand-built test fixture
     that exercises a generic built-in guard. No live scheme carries it.
   - The persisted style value's load path **already normalises** any legacy value, and that
     behaviour is pinned by a test. So the read-compatible migration this task was created for is
     already shipped: renaming the union member is a type-declaration change.
   Chosen name: the style value becomes `standard` — deliberately **not** `classic`, which already
   names a *layout* here. ★ Note that `"standard"` already exists as an unrelated literal in the
   help reading-level union, surfaced in the same settings panel; not a build break, but the two
   must not be conflated by a future reader.

   ★★★ **ONE OCCURRENCE IS A PROTOCOL VALUE, NOT A MENTION — AND IT IS RENAMED DIRECTLY ONLY
   BECAUSE THE INSTALLED BASE IS EMPTY.** `categoryFor` in `outlook-calendar-write.ts` embeds a
   literal company-name prefix as the **Outlook category on every synced calendar event**, and
   the read side matches it with OData string equality. That value lives in users' Microsoft 365
   calendars, outside this repository and outside every test it has, so ordinarily a rename would
   need a dual-read shim and would orphan every previously synced event.
   **It is renamed outright, with no shim**, on the repository owner's statement (2026-09-20) that
   **no user has ever run a calendar sync**, so no event carrying the old prefix exists anywhere.
   ★★ That is a point-in-time fact about the installed base, not a property of the code: the
   equality filter is still unforgiving, and the same rename after a single real sync would
   silently break recognition of every event created before it. Anyone revisiting this must
   re-establish the premise rather than inherit it from this paragraph.
2. **Make the wiki deep link configurable**, hidden when unset. This is a behaviour change with
   a test, not a string edit: a public build must not hand every user a link into a tenant they
   cannot reach.
3. **Repoint the two product release URLs**, keeping the text-comparison test that binds them.
4. **Regenerate the sample fixtures.** Edit the hand-curated master, regenerate the scaled
   variants, regenerate the byte-pinned goldens. ★★ A golden regen has previously written
   truncated fixtures over full ones and reported success — compare fixture **sizes**
   afterwards, never just the exit code.
5. **Fix the guide address at source and re-run the generator.** Editing the generated file is
   the trap; the next regen reverts it silently.
6. **Repoint the badges.**
7. **Neutralise §200's own quoting.** The entry quotes the identifiers it hunts, so Phase B's
   blind replacement would rewrite the register entry explaining the rewrite into nonsense —
   its reproduce commands would instruct a reader to grep for the replacement string. Restate
   them so the entry survives Phase B.

### Phase B — one rewrite pass, on a throwaway clone

Only *old commits* remain, and no test can reach them. One pass over a disposable clone, never
the working tree:

- text replacement over historical blobs, for the identifier set and the session URLs
- a message callback dropping the session trailers and assistant co-author lines
- an identity mapping for the 8,355 author/committer records and the 90 bot identities
- **keep the emitted old→new commit map** — Phase C depends on it

★★★ **Classify every candidate as *disclosure* or *protocol* before it enters the list.** A
disclosure is a mention; a protocol value is written to or read back from something outside this
repository, and `filter-repo` rewrites the **tip** as well as history — so including one silently
changes product behaviour in a way no test here can detect. The Outlook category prefix is the
known instance. It is renamed in Phase A (see above, and note the empty-installed-base premise
that permits it) rather than being swept up by a text substitution, because a protocol value's
change needs a deliberate decision and a migration story, even when the story turns out to be
"there is nothing to migrate".

★ The 89 commits that mention the assistant *without* a trailer are legitimate product content:
the assistant's name is a shipped feature name and appears in real function names. They stay.
A blanket message filter damages them, so the callback matches trailer lines, not the word.

### Phase C — remap citations, then verify

Drive the ~1,095 backticked commit citations from the commit map, then run the verification
below. The citations are the reason the rewrite does not orphan the documentation: the map makes
them mechanically rewritable and the result checkable.

## Verification

Every check here can pass vacuously, so each is specified with the state it must distinguish.

### Three scans, because three substrates

A blob scan is structurally blind to metadata — that is precisely how §200 missed class 5.

- **Blobs.** Walk every object reachable from every ref, not the checked-out tree.
- **Messages.** Every commit message across all refs.
- **Identities.** The set of author and committer identities across all refs must equal a
  one-line allowlist. This is an equality check on a set, not a search for known-bad values, so
  an identity nobody predicted still fails it.

### Every scan needs a positive control

Run each scan against the **pre-rewrite** clone and require a specific nonzero count; then
against the rewritten clone and require zero. A single green run cannot distinguish "clean" from
"scanned nothing", and the exit code is identical in both cases.

### The diff check

After the rewrite, the difference between the old tip and the new tip must contain **only** the
intended substitutions. Anything else is the text replacement having matched something nobody
predicted, which is the characteristic failure of blind substitution. This is the cheapest
high-value check available.

### Citation remap has two failure modes

- Every cited SHA must resolve in the new history.
- The **count** must be preserved. A remap that silently drops an unmappable citation passes a
  "do they all resolve?" check trivially, because the dropped one is no longer there to fail.

★ A small share of cited SHAs do not resolve **today** — pre-existing dangling references. They
must be listed and left alone, not "repaired" into whatever the map happens to offer. ★★ Short
prefixes also get more collision-prone after a rewrite: each abbreviated citation must be
re-checked for uniqueness rather than assumed.

### A permanent gate

A CI job scanning the tree for the identifier set, so a reintroduction fails a pipeline instead
of a visibility flip. It needs the absence-marker handling the existing symbol gate already
uses, or it flags every document that legitimately names what it forbids — starting with §200
and with this spec.

## Rollback

Phase A is ordinary revertible commits. Phase B runs on a throwaway clone while the original
remains untouched, so the rollback for "the rewrite was wrong" is to discard the clone and redo
it — nothing needs recovering. The irreversible moment is the visibility flip, which this
sub-project does not perform.

## Success criteria

1. All three scans return zero over the rewritten history, each having returned a specific
   nonzero count against the original.
2. The old-tip↔new-tip difference contains only intended substitutions.
3. Every commit citation in the docs resolves, the count is unchanged, and the pre-existing
   dangling references are listed as such.
4. Phase A's pipeline is green, including the byte-pinned golden fixtures at their new bytes.
5. Saved appearance settings survive the brand rename — proven by a test that loads the old
   stored literal.
6. The permanent leak gate is in CI, and has been shown to fail against a planted identifier.

## Open items

- The personal address for the commit identity is supplied at execution time and is deliberately
  not recorded here.
- The GitHub organisation and repository name are needed for the product URL replacements; until
  they exist, those tasks carry a placeholder and cannot be marked done.
