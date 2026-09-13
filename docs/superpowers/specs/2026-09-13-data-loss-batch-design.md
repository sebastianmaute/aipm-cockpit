# Data-loss defect batch — design

**Date:** 2026-09-13 · **Branch:** `fix/data-loss-batch` (from `origin/main` 9880dfb5)
**Register entries:** §32, §106, §108, §422, §430 fixed; §150 closed as an accepted limit.
**Work items:** #97 (§32), #139 (§106), #140 (§108), #276 (§422), #280 (§430), #160 (§150).

## Why this batch

A verdict pass over the eight data-loss candidates on `origin/main` found none already fixed. §409
(collapse commits an edit — a write, not a loss) and §461 (absence email format — a documented policy,
not a loss) are out of scope and stay open. §150's residue is provably undecidable at the byte level, so
it is closed as accepted rather than coded.

## Global constraints

- Every fix ships with a test that FAILS on `origin/main` and passes after the change. Mutation-check the
  load-bearing guard of each fix (revert the one line, confirm red, restore, prove `git diff --stat` empty).
- `src/app/*.ts(x)` are CRLF: Edit tool only, never `sed -i`. Never Edit/Write `src/app/i18n.de.ts` —
  patch it with a node utf8 script using `\u` escapes and `\r\n` anchors. Docs are LF.
- Size ratchet LIMIT is 1600 counted as `split("\n").length`. `src/app/sanitize-records.ts` measures
  1585 today; the §108 change must not push it past the limit.
- No stored bytes may change for any value the app itself writes today, with one deliberate exception:
  §106 collapses a run of CRs before an LF on the first encode. `golden-workspace.test.ts` must stay
  green with NO fixture regeneration; a golden diff is a design failure, not a fixture update.
- Load paths never delete a value that loads today. Validation added by this batch lives at WRITE
  boundaries only.
- Gates per task: that task's test files (vitest `--maxWorkers=1 --reporter=dot`), `npx tsc --noEmit`,
  `npx eslint --max-warnings=0 src`, `npm run size:check`. Docs-touching tasks add
  `npm run docs:claims:check`, `npm run docs:symbols:check`, `npm run followups:index:check`,
  `npm run followups:workitems:check`. Codec tasks (1–3) add `golden-workspace.test.ts` and
  `codec-roundtrip.property.test.ts`. No full suite.
- Register closure per entry, in the same commit as its fix: heading suffix → `— CLOSED 2026-09-13`,
  index-table row (title, derived anchor, status cell), `**Status:**` witness naming the test that pins
  the fix, `**Work item:**` line removed, and every body sentence the fix falsifies — found by grepping
  for the changed symbol and the old behaviour's wording, never by re-reading. Also sweep `src/`
  docstrings that describe the defect as open or unfixable. GitLab issues are closed only after merge.
- No citations of the form `path:LINE` in docs (the doc-claims ratchet fails on new ones); cite symbols.

## 1. §32 — prose opening with a bracketed word is read as HTML

**Where:** `src/app/html-start.ts` — `htmlStartRe` (the three derived sinks) and `CONTAINS_TAG` (the
render sink).

**Defect:** after the tag name the pattern accepts any characters up to `>`. `<a note about pricing> is
attached` therefore classifies as HTML; the sanitizer or projection then drops `note about pricing`.
Tightening the character after the tag name does not help: `note`, `about` and `pricing` are
syntactically legal VALUELESS attribute names.

**Rule:** a tag is recognised only when every attribute after the tag name carries a value —
double-quoted, single-quoted, or unquoted — followed by optional whitespace, an optional `/`, and `>`. A
valueless attribute, or any token that is not an attribute name, means the text is prose.

**Why it is safe:** every attribute the app stores carries a value — `href`, `target`, `rel`,
`data-align`, `data-type`, `data-checked` (rich) plus `data-asset-id` and `alt` (document) — and
DOMPurify serialises attributes quoted. Unquoted-value legacy imports such as `<p class=MsoNormal>` stay
recognised. The docstring's accepted RESIDUE (`<a href> tags are banned`) is closed by the same rule.

**Scope:** apply the attribute grammar to BOTH `htmlStartRe` and `CONTAINS_TAG`, built from one shared
fragment so the four classifiers cannot drift. Keep every existing guard: tag must close, must start with
a letter, a closing tag never matches, the `\b`-equivalent boundary after the name (`<script>` must not
match via `s`), `/i`, and the `TAG_NAME` / `NEVER` guards.

**Tests:** extend `html-start.test.ts` with the four §32 table rows (each must classify as prose on
`rich`, `document`, `projection`, `render`), `<a href> tags are banned`, and positive controls that must
still classify as HTML: `<p>x</p>`, `<a href="https://x.test" target="_blank" rel="noopener">x</a>`,
`<p data-align="center">x</p>`, `<ul data-type="taskList"><li data-checked="true">x</li></ul>`,
`<img src="x" alt="y">` on document/render, `<p class=MsoNormal>x</p>`, `<hr/>`, `<br />`. Extend
`rich-text-plain.test.ts` with a round trip: `descriptionHtml("<a note about pricing> is attached",
RICH_SINK)` keeps the words. Run the six files the `CONTAINS_TAG` docstring names plus
`golden-workspace.test.ts`.

**Docs:** rewrite the RESIDUE paragraph on `htmlStartRe`, the §32 trade paragraph on `DerivedSink`, and
the render-sink trade paragraph so none still claims the valueless case passes through. Register §32
closes.

## 2. §106 — a run of bare CRs erodes one CR per save/load cycle

**Where:** `src/app/markdown-codecs-core.ts` — `mdEscape`.

**Defect:** the newline rule consumes only the one CR adjacent to the LF; decode restores a bare LF, and
the next cycle finds a fresh CRLF. `"a\r\r\r\nb"` needs four cycles to settle.

**Fix:** the newline rule becomes `/\r*\n/g`, so the whole CR run before an LF collapses into the break
on the first encode. The result is a fixed point from the first cycle. Losing CRs on the first pass is
already accepted behaviour for this LF format (the entry says so). Bare CRs NOT followed by an LF are out
of scope and unchanged. The `<br` escape added in 1.3.0 is untouched.

**Tests:** in `codec-roundtrip.property.test.ts`, un-skip the `describe.skip` block for this defect and
make its deterministic `"a\r\r\r\nb"` companion pass (one cycle equals two cycles). If the unrestricted
property in that block still fails for a reason OTHER than CR-before-LF, narrow it and record why in the
block comment rather than leaving the defect's test skipped. Update the live property's comment that
excludes bare CR if its stated reason changes. Run `golden-workspace.test.ts`.

**Docs:** register §106 closes; sweep the skipped-block comment and the live property comment.

## 3. §108 — meeting report truncated mid-tag / mid-surrogate

**Where:** `src/app/sanitize-records.ts` — `sanitizeMeetingReport`.

**Defect:** `rr.html.slice(0, REPORT_HTML_MAX)` cuts raw UTF-16 units, so an over-cap report can end
inside a tag or split a surrogate pair.

**Fix:** replace the slice with `sanitizeRichText(rr.html, REPORT_HTML_MAX, RICH_SINK)` from
`rich-text-plain.ts` (DOM-free, so the load path stays SSR-safe). Over the cap it degrades to plain text
through `degradeToPlain`, which cannot re-emit severed markup or a lone surrogate. Accepted semantic
change (approved): the cap now bounds VISIBLE text at 100,000, with raw size bounded by the shared
ceiling (`max * 32 + 1024`). If `sanitizeRichText` returns `""` (a visually empty report) the function
returns `undefined`, matching its existing empty-html rule. Update the docstring ("does NOT sanitize the
HTML … only caps size") to say what it now does. Line count must stay within the 1600 LIMIT — reuse an
existing import line from `rich-text-plain` / `html-start` if one exists.

**Tests:** extend `sanitize-records.test.ts` (or the existing test file that reaches
`sanitizeMeetingReport` through its public decoder — find the caller, the function is not exported) with:
an over-cap html ending mid-tag, and one whose cut lands between a surrogate pair; assert no lone
surrogate and no `<` without a matching `>` at the tail. Positive control: an under-cap report is
returned byte-identical.

**Docs:** register §108 closes.

## 4. §422 — a comma inside a stored email address (stop at write)

**Where:** new helper beside `isValidEmail` in `src/app/sanitize-core.ts`; the resource editor
`src/app/resource-edit-modal.tsx`; the AI resource write handlers (`create_resource` / `update_resource`
— locate the handler via `use-register-tools.ts` / `use-resource-directory.ts` / `chat-proposal-apply.ts`,
tracing the real call path); the inline-edit plan (`src/app/inline-ai-edit/plan.ts` /
`entity-descriptor.ts`).

**Defect:** `resource.emails` crosses the inline edit as a `", "`-joined string and `sanitizeEmailList`
re-splits it on `,` and `;`, so a stored address containing either becomes two.

**Fix (approved: stop at write, never on load):**
- `isDelimiterSafeEmail(s)`: true when the trimmed value contains neither `,` nor `;`. Pure, no format
  validation beyond that (format validation of resource emails is not this slice).
- **Resource editor:** save refuses when any additional email fails the helper, with an inline error
  using one new i18n key (EN + DE, real umlauts). Same error surface the modal already uses for its name
  error. No hand-rolled controls.
- **AI create/update resource:** a call whose `emails` array holds a failing value is refused with a tool
  error naming the field; nothing is written. Also apply to the primary `email` only if the same tool path
  already validates it — do not widen primary-email policy here.
- **Inline edit:** when the diff for `emails` is changed AND the stored list holds an address that fails
  the helper, the field goes to the plan's rejected set with a reason, and is not patched. Other fields in
  the same edit still apply. Do NOT add `emails` to `arrayFields` (the descriptor records why).
- `sanitizeEmailList` and the load/decode paths are NOT changed. External ingest (`jira-api.ts`,
  `outlook-contacts.ts`) writes no `resource.emails` today and is out of scope.

**Tests:** convert `src/app/inline-ai-edit/emails-roundtrip.probe.test.ts` into a real regression test
(stored `["a,b@x.com"]`, tool input with a changed `emails` → rejected, stored value intact; an unrelated
field in the same call still applies). Unit test the helper. Editor test: typing `a,b@x.com` as an
additional email blocks save and shows the error. AI tool test: refusal and no write. Run
`plan.sanitizer-parity.test.ts` and `plan.offered-surface-sweep.test.ts` — the sweep may need its
`emails` probe updated; a sweep change must be justified in the commit, not silently re-baselined.

**Docs:** register §422 closes; sweep the descriptor comment and `resource-directory.tsx` comment if they
describe the split as unguarded.

## 5. §430 — one oversized TimeLog cache entry is still written over budget

**Where:** `src/app/timelog-actuals-store.ts` — `saveActualsCache`.

**Defect:** stages 2–4 all skip the entry being saved; `users` / `projectRefs` are unbounded; a single
entry over `MAX_ACTUALS_TOTAL_CHARS` is written anyway and the quota error is swallowed, losing the whole
fetch.

**Fix (approved: shed whole, never trim):** add stage 5, after stage 4: if the map is still over budget,
shed the SAVED entry's own `users` and `projectRefs` together (a copy, not a mutation). `aggregates`,
`partial`, `fetchedAt` and the roll fields are kept. Rationale is the file's own stage-3 argument: both
fields are read only as lazy initial state with `?? []`, so the cost is an empty People/Projects table
until the next fetch. The per-entry roll is already capped at `MAX_DAILY_ROLL_CHARS`, so after stage 5 a
real entry fits; nothing further is shed. Update the "FOUR STAGES" docstring and every "cannot be fixed
here" / "Bounding `users` would close it" sentence on `saveActualsCache`, `MAX_ACTUALS_TOTAL_CHARS` and
`MAX_DAILY_ROLL_CHARS`.

**Tests:** extend `timelog-actuals-store.test.ts` "map-level size budget": one entry whose `users` alone
serialises past the budget → after save the stored map is within budget, the entry is present with its
`aggregates` intact and `users`/`projectRefs` absent. Control: an over-budget map that stages 2–4 can fix
still keeps the saved entry's `users`. Control: an under-budget save keeps `users`.

**Docs:** register §430 closes.

## 6. §150 — close as an accepted limit (docs only)

**Where:** `docs/open-followups.md` §150.

Close per the global closure rule. Status witness: the undecidable residue is accepted — a balanced,
well-positioned stray quote pair is byte-identical to a legitimate quoted cell (the entry's own proof),
the app's encoder can never produce one, and the detectable malformed subset already pauses saving
(`npx vitest run src/app/csv-section-split.test.ts -t "swallows a section marker"`). No code change.
Grep `src/` and `docs/` for `§150` references that call it open and update them. GitLab #160 closes at
merge with a pointer to the entry.

## Out of scope

§409, §461, primary-email format validation, bare CRs not followed by LF, external ingest email paths,
version bump / CHANGELOG / release (only on the user's say).

## Review

Per-task review after each task; one cold whole-branch review at the end on the most capable model.
