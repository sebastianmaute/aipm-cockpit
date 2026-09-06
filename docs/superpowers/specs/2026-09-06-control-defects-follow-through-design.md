# Control-defects follow-through — design

**Date:** 2026-09-06
**Branch:** `feat/control-defects-follow-through` (to be created from `origin/main` at `33fa149c`)
**Predecessor:** the control-defects batch, shipped as 0.287.0 "Tiptree" (`33fa149c`)

## Goal

Close the debt the control-defects batch left behind, plus the one defect that blocks the most
valuable part of it. Four behaviour changes, one owed verification, one new register entry.

**No new persisted `Workspace` or `Settings` field anywhere in this slice**, so the six-write-paths
hard constraint (JSON/CSV/MD/Turso-single/Turso-tenant/IndexedDB) never engages. That is a
deliberate scoping property, not an accident — §408 records that a *persisted* "connection
confirmed" flag would be the six-path case and that a *transient* in-session result is not, and
this slice takes the transient shape for exactly that reason.

## Why this slice

The batch that shipped as 0.287.0 filed eight register entries, §407–414, and every one is open.
Three of them are debt that batch itself created. §414 is verification the user deferred rather
than skipped, so it is owed work with a named creditor.

★ **§337 is not from that batch and is included anyway**, because it blocks §408. §408 puts a
"Test connection" button in the Turso settings section; §337 is the defect that can hide that
section's fields entirely. Adding the button without fixing the predicate would build on top of
the bug.

## What is in scope

| § | What | Kind |
|---|---|---|
| 337 | A typo'd `NEXT_PUBLIC_TURSO_*` locks Turso out of the UI | user-facing defect |
| 408 | No Turso connection test exists (parity half only) | user-facing gap |
| 409 | Collapsing a document body commits a pending unblurred edit | product decision |
| 407 | `taskRowChangesBadge` reads "1 changes" (named instance only) | user-facing wording |
| 414 | The owed browser eye-verify | owed verification |

Plus two free bookkeeping corrections, each about one line:

- **§185's mechanism sentence is stale.** It says `capHtmlText`'s truncation branch returns
  `plainToHtml(text.slice(0, cut))`. §208 moved that into `degradeToPlain`. The entry's
  *user-visible* claim (all marks stripped on overflow) still holds, so the entry stays OPEN —
  only its body is corrected.
- **§284** is titled "FIXED 2026-08-29, end-to-end proof DISCHARGED 2026-08-29" and carries no
  CLOSED marker, so every parser counts it open. Bookkeeping close.

## What is deliberately out

- **§410, §411, §412** — the `SingleEntityPicker` / `EntityLinkPicker` duplication, its three
  untested mechanisms, and `TaskLinkPicker`'s missing suite. This is debt this batch created and
  it should be paid, but an extraction refactor must not ride in the same branch as four
  behaviour changes. Its own slice.
- **§413** — RAID breakdown hover-only. Already decided and filed as an ACCEPTED COST, not a
  defect. Nothing owed.
- **Cluster A** — §390, §392, §396–404, §406, eleven entries filed 2026-09-05/06 by the
  *preview-apply-parity* slice, all in `src/app/inline-ai-edit/` and its two sibling describers.
  The strongest slice candidate in the register today, and explicitly not this one.
- **The whole plural class** — see §407 below.

---

## 1. §337 — Turso configuration lockout

### The defect

Two predicates disagree, and both were read from source on 2026-09-06 rather than taken from the
entry:

- `src/app/settings-sections/integrations-section.tsx:181-182` computes
  `envTursoUrlSet = !!process.env.NEXT_PUBLIC_TURSO_DATABASE_URL` — a **presence** check. At
  `:505` and `:530` a true value replaces the URL and token `<Input>`s with a static
  `integrationsTursoUrlFromEnv` hint.
- `getTursoConfig` (`src/app/turso-config.ts:55-70`) resolves on **usability**:
  `const rawUrl = (envUrl && envUrl !== "" ? envUrl : settingsUrl) ?? ""`, then `toHttpUrl(rawUrl)`,
  returning `null` when that fails.

So a malformed env value (`postgres://…`, a stray quote, a shell-mangled paste) is simultaneously
*present enough to hide the fields* and *unusable enough to yield no config*. The user sees "this
comes from the environment", has no input to correct, and Turso does not work. There is no route
back through the UI.

### The fix

Export a usability predicate from `turso-config.ts` — `toHttpUrl` is currently module-private —
and have both sites share it. Then:

- Env outranks settings **only when the env value is usable**. An unusable env value falls through
  to the settings value instead of poisoning the result.
- When an env var is set but unusable, the settings section renders the input **and** discloses
  why, rather than the "comes from the environment" hint.

One new i18n key (EN + DE) for that disclosure.

★★ **This changes `getTursoConfig`'s precedence rule, which is deployment-visible.** Today env
wins unconditionally; after this, env wins only when usable. An operator who deliberately set an
env var to a malformed value to force "no Turso" would now get the settings value instead. The
judgement recorded here is that this is strictly better — an unusable env value produces `null`
today, so nothing that works today stops working — but it is a behaviour change for env-var
deployments and must be called out in the CHANGELOG rather than filed as a pure bug fix.

★ `turso-config.ts`'s file header currently reads "Env vars (NEXT_PUBLIC_TURSO_*) win when set at
build time; Settings … are the fallback." That sentence becomes false with this change and must be
corrected **in the same commit** — a comment describing previous behaviour reads as current.

### Testing

Unit tests over `getTursoConfig` for the four-way matrix (env usable/unusable × settings
present/absent), and a component test asserting the input renders with the disclosure when the env
var is set but unusable. The usable-env case must keep rendering the existing hint — that is the
mutation to prove against, since a test that only exercises the unusable branch passes whether or
not the usable branch still works.

---

## 2. §408 — Turso test connection (parity half)

### Shape

A "Test connection" button in `integrations-section.tsx` beside the URL/token fields, mirroring
Jira and Timelog exactly. Both of those keep the outcome in local component state that resets on
reload (`jira-settings.tsx:147` calls `testConnection(creds)`; `timelog-settings.tsx` sets
`testResult` from `timelogTestOk` / `timelogTestFail`). This follows that pattern and stores
nothing.

The probe is a `SELECT 1` through the existing `runTursoPipeline`, which already discriminates the
three outcomes a result message needs (`turso-pipeline.ts:93-115`):

- network failure or timeout → `StorageNotReadyError("storage-unreachable")`
- HTTP 401 → `StorageNotReadyError("Turso auth token rejected…")`
- any other non-ok status → `Error("Turso returned {status}…")`

No new client code. Three new i18n keys (EN + DE): the button label, the success message, the
failure message.

### What this does NOT close

§408's deeper complaint stays open, and its Status line must say so explicitly rather than
implying the entry is done. `canMoveToTurso` in `integrations-section.tsx`, and the local
`tursoConfigured` in `projects-panel.tsx` and `project-empty-state.tsx`, all still gate on
`!!getTursoConfig(url, token)` — a shape check. A user whose URL/token pair is present but *wrong*
still gets an enabled control that cannot work. Feeding a probe result into those gates needs
session-scoped cross-panel state and a decision about what the untested state should render; that
is deliberately not in this slice.

---

## 3. §409 — collapsing a document body must not write history

### The defect

`documents-panel.tsx`'s `bodyCollapsed` state wraps `DocumentEditModeBody` in
`{!bodyCollapsed && (…)}`, so toggling it unmounts the editor subtree. `useBlockDraft`
(`document-block-editors.tsx`) holds a mount-only effect whose cleanup runs on **any** unmount,
blur or not: a dirty, non-no-op, non-superseded draft is normalised and committed. That commit
routes through `applyDocMutation`, the single document-mutation path, and can mint a `DocVersion`.

So a gesture whose own comment calls it transient — "collapsing is a momentary 'give me room'
gesture, not a preference. Nothing persists it." — can write persistent history.

★ **This is the safe direction, not data loss.** The edit is written, never discarded. It must not
be filed or fixed as a loss.

### The fix

Swap the conditional render for a `hidden` toggle so the subtree stays mounted. No unmount, so the
cleanup never fires, so the gesture writes nothing — which is what the comment already claims.

This follows the existing precedent in `workspace-section.tsx`, where `panel-chat` and `panel-raid`
are mounted unconditionally and merely `hidden`-toggled.

★★ **That precedent carries its own hazard and the fix must respect it.** AGENTS.md records that
for an always-mounted panel the danger inverts: a fresh mount can no longer be relied on to clear
anything, so state only valid under some condition must be reset explicitly. Here the relevant
state is `bodyCollapsed` itself, which `3f59c5a2` already resets on every selection change. Verify
that reset still fires once the subtree stops unmounting.

### Testing

A `documents-panel.test.tsx` test that a dirty unblurred draft survives a collapse/expand round
trip **without** committing and without minting a version — mirroring the existing "flushes a
pending unblurred edit to the OLD document on a switch" test, which pins the document-switch
instance of the same mechanism and must keep passing.

★★★ **Mutation-prove it against the conditional-render form.** A test written the obvious way
passes under both `hidden` and `{!bodyCollapsed && …}` if it never asserts on the absence of a
commit. Record the mutant as `N failed / M passed` whose sum equals the file's runtime test count.

---

## 4. §407 — plural agreement (the named instance, via the house idiom)

### The defect

`taskRowChangesBadge` is `"{0} changes"` (EN, `i18n.ts`) and `"{0} Änderungen"` (DE,
`i18n.de.ts:3365`), called with `changeRefs.length` at four sites — three in `task-row.tsx`
(`:376` `title`, `:377` `aria-label`, `:380` visible text) and one in `task-kanban-card.tsx:92`.
A task with exactly one linked change reads "1 changes" in EN and "1 Änderungen" in DE; the German
singular is "1 Änderung".

### Scope decision: the instance, not the class

★★★ **§407 names an instance of a 46-member class.** A call-site-verified survey of `i18n.ts` on
2026-09-06 bucketed all 423 placeholder-bearing keys: **46 TIER 1** (outright wrong at count 1,
live call site, count 1 reachable), 6 tier-1 by shape but count 1 unreachable, 12 dead, 63 dodged
with `(s)`, 296 count-safe. **DE is also wrong in 45 of the 46** — the lone asymmetry is
`timelogTestOk`, where DE "Benutzer" is invariant in the nominative plural, so only EN is wrong.

★★ **A regex scan alone over-reports this class in two directions, and both were measured.** A
bare-identifier grep over-reports liveness (`activityCount` matches a local variable in
`dashboard-panel.tsx` and a backticked comment mention; the key is dead). A **single-line**
call-site grep under-reports guards: `documentsVersionBlocks` and `documentsCardRemoved` look like
tier 1 because the `=== 1 ? "…One"` sits on the line **above** the matched line
(`documents-history-modal.tsx:356-358`, `chat-tool-block.tsx:284-286`). That correction alone moved
the count 48 → 46. Anyone briefed off a one-line grep will file those two as false defects.

### Mechanism: extend the house idiom, do NOT build a helper

★★★ **An earlier draft of this spec called for a `pluralize(lang, count, one, other)` helper. That
was wrong and is recorded here so it is not re-proposed.** Three reasons, in order of weight:

1. **A two-fragment API is the wrong shape for German.** DE breaks on noun *and* adjective *and*
   verb agreement at once: `{0} aktive Aufgaben sind…` needs "1 aktive Aufgabe ist…", and
   `Seit {0} Tagen` needs "Seit 1 Tag". The singular is a differently-worded sentence, not a suffix
   swap on a fragment. A whole second key expresses that; a `one`/`other` fragment fights it. The
   existing singular keys hardcode the numeral for exactly this reason —
   `bulkEditTitleOne: "Bulk edit (1 task)"`, `documentsVersionBlocksOne: "1 block"` — and take no
   placeholder at all.
2. **It would be a second competing mechanism.** The repo's idiom is a `*One` sibling key plus a
   `count === 1 ?` ternary at the call site, live at nine `*One` keys today
   (`bulkEditTitleOne` `:535`, `bulkApplyOne` `:537`, `bulkEditDoneOne` `:544`,
   `chatAttachmentSummaryOne` `:748`, `trendsGapOne` `:2676`, `documentsVersionBlocksOne` `:2842`,
   `documentsCardRemovedOne` `:2846`), two of them with dedicated singular/plural unit tests. There
   is also a richer entity-noun form in `undo/use-undo-stack.ts:111-116`
   (`ENTITY_SINGULAR`/`ENTITY_PLURAL` maps selected by `count === 1`).
3. **The class is not uniform enough to mechanise.** Of the 46, roughly 15 read better *reworded*
   than branched — `evmCoverage` → "estimates on {0} of {1} tasks", `chatProposalCount` →
   "{0} × write" — and a helper pushes authors toward mechanically doubling every key instead.

★ `Intl.PluralRules` would be the principled answer for a language with a non-binary plural system.
EN and DE are both two-form, so it buys nothing here over `=== 1`. No `Intl.PluralRules` exists in
the repo today, and the single `plural()` hit (`activity-recap.ts:32`) is not reusable: file-local,
hardcodes the English `+"s"`, takes no `Lang`, and its two call sites build an **AI prompt string**
rather than UI, so it sits outside the i18n system entirely.

### This slice therefore

1. Adds `taskRowChangesBadgeOne` in EN and DE and branches the four call sites on
   `changeRefs.length === 1`, matching the nine existing sites.
2. **Files a new register entry for the remaining 45 keys**, carrying the call-site-verified
   EN/DE/call-site table, the `timelogTestOk` EN-only asymmetry, the 6 unreachable and 12 dead
   exclusions, and both grep traps above. The mechanism question for the class — mass `*One` keys
   versus rewording versus something else — is recorded there as open, with this section's argument
   as the starting position.

Fixing all 45 across two languages is a slice of its own. Doing it here would swamp the Turso work
under string volume.

★ **`i18n.de.ts` must be patched by an anchored node/python utf8 write matching `\r\n`, with real
umlauts** — the Edit tool corrupts umlauts and curls double quotes in that file, and the
`i18n-encoding` test bans ASCII substitutions. EN/DE key parity is tsc-enforced, so a missing DE
sibling fails `npx tsc --noEmit` rather than shipping.

## 5. §414 — the owed eye-verify, as a measuring spec

### Why it cannot be a unit test

jsdom has no layout — no box, no overflow, no wrapping — and renders no native `title` tooltip.
Clipping, wrapping, reflow and hover-hint questions are outside the unit suite by construction.
The axe gate does not close the gap either, for two distinct reasons that must not be merged:
`A11Y_VIEWS` omits **Projects** and **Knowledge** outright, while Open Points and Documents *are*
scanned and axe simply has no rule for the properties in question.

### The technique: measure, do not look

The spec runs against a **fresh isolated dev server on port 3100**, never the long-running one on
port 3000. Six items:

1. **The Turso disabled-button hint.** The highest-value item. Three buttons across two surfaces
   (`projects-panel.tsx` Load-from-Turso and Move-to-Turso; `project-empty-state.tsx`
   Load-from-Turso) hang their hint on a wrapping `<span title=…>` and rely on
   `disabled:pointer-events-none` so the hit test falls through to the wrapper.
   ★★ A native tooltip's **rendering** is browser chrome and is genuinely unobservable. The
   **hit-test** is not: `document.elementFromPoint` at each button's centre must return the
   wrapper, or an element whose ancestor chain reaches the `title` carrier. That is the mechanism
   the item actually doubts, and it is measurable. Check Chromium **and** Firefox — this depends
   on each browser's own `title` lookup walking up from a disabled child.
   ★ The `aria-describedby` → `sr-only` half is NOT owed; it is already pinned by
   `toHaveAccessibleDescription` in both panels' unit tests. Only the pointer path is unverified.
2. **The Ask-Claude icon no longer clipping.** The leading `<Td>` in `task-row.tsx` got
   `padding="tight"` because the default `px-4` (32px) exceeds the `w-7` (28px) cell. Compare
   bounding boxes: glyph inside cell, no overlap with the checkbox, and leading alignment
   unregressed for rows where the trigger does not mount.
3. **The ID-column badge run not wrapping.** Confirm the run fits at a realistic column width and
   at the narrowest the user can drag it to.
   ★★ **Table row only.** Three of the four badges are shared components so the Kanban card
   inherits `whitespace-nowrap` for free; the fourth (changes) is a duplicated inline `<span>` and
   only `task-row.tsx`'s copy was touched. That is not a defect — the card has no ID column and
   its badge row is a `flex flex-wrap` container where wrapping is intended. Verify the card only
   for the shortened RAID text reading sensibly.
4. **Documents body collapse reflow.** Confirm the panel reflows sensibly on collapse and that the
   collapse resets when selection changes by a route other than a click. ★ Re-run this item
   **after** §409's `hidden` change, since that change alters what collapse does to the DOM.
5. **Knowledge attach-to picker**, keyboard-only operation of the combobox.
6. **Asset name as preview trigger**, discoverability. Turso-gated, so the e2e seed's file mode
   never mounts it.

### Outcome

Findings are **filed as register entries, not fixed inline**, unless a fix is trivial and
self-evident. An eye-verify that turns into an unplanned fix round is how a slice loses its
boundaries.

---

## Testing strategy

Per-item testing is described in each section above. Slice-wide:

- `npx tsc --noEmit` (exits **2** on diagnostics, not 1) — mandatory after any test edit, since
  `next build` does not typecheck test files and vitest never typechecks.
- `npx eslint --max-warnings=0 <touched files>` — `npm run lint` exits 1 from gitignored
  leftovers, so scope it to files.
- The touched vitest files, then `npm run test:run`. **Never two vitest processes at once.**
- `npm run test:shuffle` — new tests are added, and this is the only local reproduction of the
  `unit-tests-shuffled` gate.
- `npm run size:check` — LIMIT is 1600 and it counts `split("\n").length`, i.e. `wc -l` + 1.
  Headroom is comfortable: `integrations-section.tsx` is 756 lines and `documents-panel.tsx` 826.

★★★ **Never read a gate's exit code through a pipe** — you get the pipe's status. Redirect to the
session scratchpad, check unpiped, then grep the file. A `tail`'d test run reports 0 while tests
fail.

★★ **Grep for `Errors` alongside every test tally.** A mutant that makes a listener throw is
reported as an unhandled error, not a failure: the run prints `Tests N passed` *and* `Errors 1`
with a nonzero exit, and reading the tally alone calls that green.

## Working constraints

- All `src/app/*.ts(x)` are **CRLF** — Edit tool only, never Write, never `sed -i`.
  `docs/open-followups.md` and this file are LF.
- Never stage `sample-workspace-huge.json` (a foreign concurrent writer modifies it) or
  `not-in-use.env.local.bak` (untracked, NOT gitignored, holds live Turso credentials). Never
  `git add -A` or `git add .`; commit with `git commit --only <paths>`.
- Never echo, log, paste or commit the Turso URL or token.
- A peer session shares this worktree. End every task on `git diff HEAD` showing only the intended
  change — a green test run is not evidence of a clean tree.
- A follow-up register number is reserved only once it is on `origin/main`, but mint above the
  **branch** max to avoid duplicate headings in one document. Max on `origin/main` today is 414.

## Open questions

None. The five scope decisions (include §337; parity-half only for §408; `hidden` rather than
unmount for §409; the house `*One` idiom plus the named instance for §407; measure rather than look
for §414) are settled.

Two judgements worth re-reading before implementation, both recorded above as accepted rather than
open:

- **§337's precedence change is deployment-visible** and belongs in the CHANGELOG as a behaviour
  change, not as a bug fix.
- **§407's mechanism was reversed during design.** The first draft specified a
  `pluralize(lang, count, one, other)` helper; a call-site-verified survey of the class showed that
  shape cannot express the German singulars, which re-word noun, adjective and verb together. §4
  carries the full argument so the helper is not re-proposed by the next reader.
