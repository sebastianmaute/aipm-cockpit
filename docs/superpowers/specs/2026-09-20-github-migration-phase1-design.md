# Sanitise the tree and settle history — GitHub migration, sub-project 1

**Date:** 2026-09-20
**Roadmap:** `2026-09-20-github-migration-roadmap.md` (sub-project 1 of five)
**Supersedes in scope:** register §200 / work item #185
**Re-baselined:** 2026-09-21, against release 1.13.0. See "Re-baseline 2026-09-21" at the end for
what changed and which decisions were taken; the sections above it are updated in place.

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
  fields — 8,452 on `main` as of 2026-09-21 — plus 90 commits by **two** CI-bot identities
  embedding the internal host and project id. (The first draft said "90 identities"; it is 90
  commits and 2 identities, 3 distinct identities in the whole history.)
  No sweep over file content can see this. It is the largest single class and the one that
  cannot be fixed after the fact by any means short of the rewrite this spec describes.
- **Commit messages and session URLs.** 3,144 commits on `main` carry a session trailer and 217
  carry an assistant co-author line; separately, 86 tracked plan/spec files contain session URLs
  in their body (347 occurrences). All three counts grow with every commit — re-measure on the
  day of the rewrite.

★★ This is worth stating plainly because it generalises: **a verification method has a shape,
and a finding outside that shape reads as absence.** §200 was not careless; it checked files, so
it found file problems, and the absence of metadata findings read as there being none.

## The seven classes

Re-measured 2026-09-21. The first draft had six; class 7 and most of class 2 were found by the
re-baseline.

| # | Class | Substrate | Fix shape |
|---|---|---|---|
| 1 | Internal hosts in URLs: the two product release URLs (app + desktop shell), the README "Releases page" links | tree | repoint, blocked on the GitHub org name |
| 2 | **Employer values the product ships as defaults or writes outside itself** — see the table below | tree | behaviour/config change with tests, one per item |
| 3 | A work address and an employer copyright line in guide content, **its generated copy, and an eval baseline copy** | tree | edit source, re-run both generators |
| 4 | Real-looking addresses **and employer company/organization fields** across the sample workspaces, plus one address in a unit test | tree | generated pipeline |
| 5 | Author/committer identities, and CI-bot identities | **metadata** | history rewrite |
| 6 | Session trailers, co-author lines, session URLs in plan files | **messages + tree** | history rewrite |
| 7 | Residual mentions: the employer name and brand trigram in test fixtures, i18n prose, comments, docs, CHANGELOG and an importable theme file | tree | ordinary sweep in Phase A |

The README pipeline/coverage badges the first draft listed as class 1 were already removed on
2026-09-14, before the spec was written.

### Class 2 in detail — every item is a protocol value or leaves the app

Each item is classified PROTOCOL (written to or read back from something outside this repository)
or OUTBOUND DISCLOSURE (written outside the app, never read back). None of them may go through
Phase B's blind substitution.

| Item | Kind | Decision (2026-09-21) |
|---|---|---|
| Outlook category prefix (`categoryFor`) | PROTOCOL — OData equality read-back | rename outright; empty installed base (see Phase A task 1) |
| Outlook event body text naming the brand | OUTBOUND DISCLOSURE | neutral text |
| AI-usage policy defaults (`DEFAULT_AI_POLICY_ORG` / `DEFAULT_AI_POLICY_URL`, 1.13.0) | renders in the product; a stored org name is compared against the default | no built-in default; build variables only |
| Export footer default (`export-footer.ts`, 1.13.0) | OUTBOUND DISCLOSURE — HTML/PDF/PPTX footers and the PPTX colour-scheme name | neutral built-in; add a build variable |
| Timelog tenant default (`defaultTimelogConfig`) | PROTOCOL — sent to the Timelog API and persisted in settings | move behind a build variable, empty built-in |
| Electron `appId` (`desktop/electron-builder.yml`) | PROTOCOL — installer identity and taskbar identity | rename; only the repository owner has an install, and removes the old copy by hand |
| Dead style value `"AIPM"` in the `CiStyle` union | persisted key, but never written any more | delete the member; the load path already forces `"custom"` |

★★ The installed-base premises above (calendar sync never run; one desktop install) are
point-in-time facts stated by the repository owner on 2026-09-20/21, not properties of the code.
Re-establish them before reusing this reasoning.

★ The AI-policy comparison needs care: a user who once saved the old default org name has it in
settings, and the resolver compares it with string equality against the built-in. Removing the
built-in must not turn that stored value into a surprising "custom org with no link" state.
The plan decides the exact behaviour and pins it with a test.

## Strategy — three phases

The fork worth recording is **what goes through the rewriting tool**. Classes 1–4 and 7 are product
and fixture changes that need tests; a history-rewriting tool is a blind text substitution over
blobs and cannot regenerate a fixture or run a suite. Putting them through it produces a history
whose fixtures no longer match their own generators.

### Phase A — ordinary commits, reviewed, CI-green

Fix classes 1–4 and 7 the normal way, on branches, each with its tests and the full pipeline.
★★ **Exit condition for Phase A: the tip carries ZERO identifier hits** outside text that names
them deliberately (marked with the leak gate's absence markers). Phase B then only has to touch
*old* commits, and its old-tip↔new-tip diff check can require an empty tip diff — the
strongest form of that check. The first draft left class 7 to Phase B's blind substitution, which
would have rewritten test fixtures and their assertions in step without any test ever running
against the result.

Tasks, each its own commit (the plans split them into two files):

1. **Brand rename** (brand-rename plan). ★★ Measured 2026-09-20/21, and it corrected this spec
   three times:
   - The `--AIPM-*` custom properties **do not exist**. They were renamed to `--ui-*` in an earlier
     release; what survives is stale comments and a stale document title.
   - The legacy built-in scheme id is **retired**, surviving only in a hand-built test fixture
     that exercises a generic built-in guard. No live scheme carries it.
   - The style axis is **always `"custom"`**: the load path rewrites any other stored value to
     `"custom"` and `data-style` is hard-wired. The `"AIPM"` member of `CiStyle` is therefore never
     produced. The first draft renamed it to a new value; that renames dead code. **Delete the
     member instead.** No migration is needed because the existing load path already is one, and
     a characterisation test pins it.

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
   re-establish the premise rather than inherit it from this paragraph. The reader already imports
   `categoryFor`, so there is one spelling to change. The event body text beside it names the
   brand too and changes in the same commit.
2. **Neutral defaults, overridable at build time** — the class-2 table: AI-usage policy (no
   built-in; build variables only), export footer (neutral built-in plus a build variable),
   Timelog tenant (empty built-in plus a build variable). Each is a behaviour change with a test.
   ★ The first draft's task here — "make the wiki link configurable" — was half-shipped by 1.13.0,
   which made it configurable but kept the employer values as the built-in defaults.
3. **Rename the Electron `appId`.** Blocked on the GitHub organisation name, like task 4.
4. **Repoint the product release URLs and the README release links**, keeping the text-comparison
   test that binds the two product copies. Blocked on the GitHub organisation name.
5. **Regenerate the sample fixtures.** Edit the hand-curated master (addresses **and** the
   company/organization fields), regenerate the scaled variants, regenerate the goldens with
   `scripts/regen-golden-fixtures.ts`. ★★ A golden regen has previously written truncated
   fixtures over full ones and reported success — compare fixture **sizes** afterwards, never
   just the exit code.
6. **Fix the guide at source and re-run its generators.** The address, and the copyright line
   (new owner and licence wording to be supplied by the repository owner). Two generated copies:
   the operating guide (regenerated by `prebuild` too) and the ai-eval rolling-prompt baseline.
   Editing a generated file is the trap; the next regen reverts it silently.
7. **Sweep class 7.** Employer name and trigram in test fixtures, i18n prose (DE through a node
   utf8 write), comments, docs, CHANGELOG, and the importable theme file. Dated records get their
   *names* replaced, not their content rewritten.
8. **Neutralise §200's own quoting.** The entry quotes the identifiers it hunts, so Phase B's
   blind replacement would rewrite the register entry explaining the rewrite into nonsense —
   its reproduce commands would instruct a reader to grep for the replacement string. Restate
   them so the entry survives Phase B. It is also stale on its own terms (it still describes the
   pre-1.13.0 policy constant and the removed badges).
9. **Add the leak gate** (see Verification) — last, because it can only go green once 1–8 are in.

### Phase B — one rewrite pass, on a throwaway clone

Only *old commits* remain, and no test can reach them. One pass over a disposable clone, never
the working tree:

- text replacement over historical blobs, for the identifier set and the session URLs
- a message callback dropping the session trailers and assistant co-author lines
- an identity mapping for the three distinct identities in history (the author, and two CI bots
  that authored 90 commits); the identity scan then checks set equality against a one-line allowlist
- **every ref, tags included.** The first draft assumed zero tags; five tags now exist on the
  remote (`git ls-remote --tags origin`), and a rewritten tag points at a new SHA — the GitLab
  releases hanging off the old ones are retired with GitLab itself, not migrated
- **keep the emitted old→new commit map** — Phase C depends on it

★★★ **Classify every candidate as *disclosure* or *protocol* before it enters the list.** A
disclosure is a mention; a protocol value is written to or read back from something outside this
repository, and `filter-repo` rewrites the **tip** as well as history — so including one silently
changes product behaviour in a way no test here can detect. The Outlook category prefix is the
known instance. It is renamed in Phase A (see above, and note the empty-installed-base premise
that permits it) rather than being swept up by a text substitution, because a protocol value's
change needs a deliberate decision and a migration story, even when the story turns out to be
"there is nothing to migrate".

★ The commits that mention the assistant *without* a trailer (89 when first counted; re-count
with a measure that excludes `CLAUDE.md` before relying on it) are legitimate product content:
the assistant's name is a shipped feature name and appears in real function names. They stay.
A blanket message filter damages them, so the callback matches trailer lines, not the word.

### Phase C — remap citations, then verify

Drive the backticked commit citations (1,114 on 2026-09-21: 1,105 resolve, 9 dangling; 526 of
them in the register) from the commit map, then run the verification
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

After the rewrite, the **trees** of the old tip and the new tip must be identical. Phase A
leaves nothing for the substitution to change there, so any difference at all is the text
replacement having matched something nobody predicted, the characteristic failure of blind
substitution. (The commit SHAs and messages differ by design; compare `tip^{tree}`, not the
commits.) This is the cheapest high-value check available, and requiring *empty* rather than
*only intended* removes the judgement call from it.

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
2. The old-tip and new-tip trees are identical.
3. Every commit citation in the docs resolves, the count is unchanged, and the pre-existing
   dangling references are listed as such.
4. Phase A's pipeline is green, including the byte-pinned golden fixtures at their new bytes.
5. Saved appearance settings survive the brand rename — proven by a test that loads the old
   stored literal.
6. The permanent leak gate is in CI, and has been shown to fail against a planted identifier.

## Open items

- The personal address for the commit identity is supplied at execution time and is deliberately
  not recorded here.
- The copyright owner and licence wording for the guide (class 3) are supplied by the repository
  owner; publication rights were confirmed 2026-09-21.
- The GitHub organisation and repository name are needed for the product URL replacements; until
  they exist, those tasks carry a placeholder and cannot be marked done.

## Re-baseline 2026-09-21

Re-checked against release 1.13.0 (119 commits after the first draft). Every number above that
carries a date was re-measured then; all commit-derived counts grow daily.

What changed, and why the earlier text was wrong or stale:

- **1.13.0 half-shipped the old policy-link task.** It made the AI-usage policy configurable but
  kept the employer name and wiki URL as built-in defaults, and added an export footer whose
  default names the employer. Both are now class 2 items.
- **Four protocol or outbound items the first draft missed:** the Timelog tenant default, the
  Electron `appId`, the export footer default, and the Outlook event body text. Class 2 is now a
  table rather than one link.
- **Class 7 is new.** About 230 mentions of the employer name across roughly 60 files, plus the
  brand trigram in about 45 files outside docs. The first draft implicitly left these to Phase B;
  Phase A now has to clear the tip, and the diff check is tightened to an empty tree diff.
- **The style rename renamed dead code.** Delete the member instead.
- **The badges were already gone** before the spec was written; the README release links remain.
- **Fixtures:** 43 addresses in the master, not 42, plus employer company/organization fields the
  first draft never counted, and one more address in a unit test. Goldens now regenerate through
  a dedicated script.
- **The guide has a third copy** (an eval baseline) and a copyright line; publication rights were
  confirmed by the repository owner.
- **Identities:** three in all of history, not ninety-plus.
- **Tags exist now** and must be rewritten with everything else.

Decisions taken 2026-09-21 by the repository owner: rename the `appId` (one install, the
owner's); the Timelog tenant moves behind a build variable with an empty built-in; the AI-policy
and export-footer defaults become build variables with neutral built-ins; publication has been
cleared.
