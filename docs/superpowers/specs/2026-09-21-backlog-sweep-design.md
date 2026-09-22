# Backlog sweep — close ten cheap defects and one stale record

**Date:** 2026-09-21
**Branch:** `fix/backlog-sweep` (from `origin/main` at `cf21eb91a`)
**Version:** 1.12.7, milestone line unchanged ("Child")
**Closes:** §365 · §541 · §542 · §544 · §564 · §565 · §566 · §570 · §571 · §576, and §391 as a record

## Goal

Take eleven entries off the OPEN list of `docs/open-followups.md`. Ten get fixed: each one is
small, has no open design decision, and can be pinned by a unit test. The eleventh, §391, closes
as a record, because the defect it names is already gone from the tree.

**What this slice is, stated honestly.** The owner chose a max-closure sweep over a themed batch,
knowing the trade. Six of the ten fixes are latent or cosmetic by their own entries' wording
(§544, §564, §565 as filed, §566, §571, §576), so this buys register hygiene more than
user-facing correctness. Recon changed two of them: **§565 is user-visible after all** (see Task 5),
and **§542 is materially larger than its entry says** (see Task 2).

## Corrections made while planning — binding

Writing the plan meant reading every edit site. That turned up five places where this spec was
wrong or incomplete. The plan (`docs/superpowers/plans/2026-09-21-backlog-sweep.md`) carries the
full detail; the sections below are corrected to match.

1. **§542: the existing load readers cannot be reused.** Both judge through `sanitizeIsoDate`
   and its 1900–2100 bound, so a stored meeting dated 2200 would be dropped. The optional reader
   also blanks a non-calendar value, and a blank recurrence `until` means the series never ends.
   Calendar events get their own load reader.
2. **§542: updates are a third path.** A strict sanitizer made every update of an event with an
   untouched stored invalid date fail. Updates carry an unchanged stored date verbatim, on the
   milestone `requiredIsoDateOnUpdate` precedent.
3. **§565: there is no correct Turso clear to mirror.** The site recon named is the wrap-mode
   toggle, not a clear. `commitTurso`'s passphrase branch also seals `""`.
4. **§564:** a long camelCase i18n key is added as a real negative case.
5. **§566 and §570:** the suite currently asserts the defective behaviour. Those assertions change
   as part of each fix.

## How the scope was chosen

Out of 118 OPEN entries, about twenty are real defects. The rest are feature requests, owed
eye-verifies and dependency bumps. A triage pass sorted twenty candidates into three groups. The
ten here are the ones that were TINY or SMALL, unblocked, and unit-pinnable. Excluded:

- **§463** (export drops enabled sections) names `task-manager.tsx`, which a concurrent branch
  modifies with new required props.
- **§351, §446, §470** each need a design decision nobody has made.
- **§409, §468, §486, §551, §574** each need something no local test can reach: a real Chromium
  focus order, a packaged Electron build, a Microsoft 365 tenant, a live Turso database, or a
  non-Chromium browser.

## Coordination with the concurrent branch

A peer session holds `fix/load-save-residuals`. As agreed on 2026-09-21:

- **Register numbers:** the peer's block is §596–§604, exact, and the branch is code-complete. Any
  defect this slice files starts at **§605**.
- **Version:** the peer's branch holds 1.12.6. This slice takes 1.12.7.
- **Files:** the two branches share **none**. The peer confirmed this from its own diff for the
  two proposal files. §570 turned out to need no i18n edit, which removed the last overlap.

## Four rules every task follows

Recon showed three of the entries' prescribed fixes were wrong: §365, §566 and §576. A fourth
entry, §565, undercounted its own class. So the rules below are requirements, not advice.

1. **Red before green, and read the failure message.** The new test fails against unfixed code,
   and it fails with the message the defect predicts. A failure from a missing export, an
   unstubbed dependency or a malformed fixture is a broken test, not a reproduction. (While
   scoping this slice, a probe of §576 printed STABLE on every row because each fixture decoded
   to `null`, and `null === null`.)
2. **Every mutant is predicted in writing and run on its own.** Each fix gets at least one mutant
   that must turn red. Where a fix has several independent members (four fields, four call
   sites, three load funnels), each member gets its own mutant. A combined mutant proves the set
   is load-bearing, never each member.
3. **Check the entry's prescription; do not transcribe it.** Where the shipped fix departs from
   the entry's fix-shape line, the closing Status line says so and says why.
4. **Pair every absence assertion with a presence assertion.** A test that something did not
   happen also passes when nothing ran at all.

A fifth rule follows from rule 2: **no guard ships without a mutant that kills it.** A guard whose
removal no test notices is either redundant or untested, and the task says which.

## Register closure protocol

Each fix task closes **its own** entry **in its own commit**, and writes the Status line from that
task's diff and mutant results. Closures deferred to the end drift away from their evidence. The
register's history shows this: closures that took five and six edits, and one CI failure caused
by a closed entry that kept its work-item line. Each closing commit:

- changes the heading's `— OPEN` suffix to `— CLOSED`, and the matching index row with it;
- **removes** the entry's `**Work item:**` line, because a closed entry must not carry one;
- writes a `**Status:**` line that names the test, the mutants run with predicted and actual
  results, and any departure from the entry's prescription;
- runs `npm run followups:index:check`, `followups:workitems:check` and `followups:status:check`,
  each unpiped, with the exit code read directly.

The GitLab issues close through the MR description, with one `Closes #NN` per line. After merge,
check each issue's state: auto-close has left issues open in this repo before.

**A defect found mid-slice** is filed at §605 or above, with its own GitLab issue, and is not
fixed in this slice unless it blocks one of the eleven.

---

## Task 1 — Extract `isRealCalendarDate`; TimeLog dated predicate (§544)

**The defect.** `aggregateActuals` (`timelog-actuals.ts`) decides whether a row is dated with a
shape-only regex. So a calendar-invalid day such as `2026-02-30` counts as dated. The monthly
period key then slices the string and files it under February. The weekly key builds a `Date`,
which rolls the day to 2 March. The same hours land in two different months depending on the
view.

**The shared helper.** §542 (Task 2) needs the same calendar round-trip. Today the only
implementation sits inside `sanitizeIsoDate` (`sanitize-core.ts`), bundled with a 1900–2100 year
bound that neither entry wants. Fixing both entries separately would leave three copies of one
check. So this task extracts:

- **`isRealCalendarDate(value: string): boolean`** — new, exported from `sanitize-core.ts`. True
  only if `value` matches `YYYY-MM-DD` **and** a `Date.UTC` round-trip gives back the same year,
  month and day. It applies no year bound. `sanitize-core.ts` is pure and i18n-free, so the new
  import edge from `timelog-actuals.ts` is clean.
- **`sanitizeIsoDate`** is rewired to call the helper and keep its own year bound. Its behaviour
  must not change, and its existing tests are the proof.

**The fix.** The `dated` predicate in `aggregateActuals` gains `&& isRealCalendarDate(it.date)`.
A calendar-invalid row then goes down the existing `!dated` branch into the `undated` bucket.
That bucket already exists and is already covered by discriminating tests. No new branch is
needed.

**Tests.** The helper gets a pure test. It must return true for `2024-02-29` and `2026-12-31`,
and false for `2026-02-29`, `2026-02-30`, `2026-04-31` and `2026-13-01`. The fix gets a test in
`timelog-actuals.test.ts`: a row dated `2026-02-30` lands in `undated`, **and** no month or week
period receives its hours. That second half is the presence assertion.

**Mutants.** (a) Make the helper skip the round-trip and accept on shape alone. (b) Drop the new
conjunct from `dated`. Each is run separately and must turn red.

## Task 2 — Calendar events: split the load path from the write path (§542)

**The defect.** `isoDateOrUndefined` (`calendar-event.ts`) validates with a regex plus
`Date.parse`, which rolls `2026-02-30` over to `2026-03-02` instead of rejecting it. So an event
written with that date renders on the wrong day, and it disagrees with every other date field in
the app, which §539 already made strict.

**Why this is not the one-line fix the entry suggests.** `sanitizeCalendarEvent` is a single
function that serves both **load** and **write**, and `startDate` is required: an invalid one
returns `null` and drops the whole event. So tightening the validator in place means every
already-stored event with a calendar-invalid `startDate` vanishes on its next load, with no
sign of it. §539 shipped exactly that regression for milestones and had to reverse it.

**The fix follows the milestone precedent.** Milestones already split load from write through
`milestoneWithDateReader`, with `sanitizeLoadedMilestone` wiring in the load-tolerant readers.
Calendar events get the same shape:

- **`calendarEventWithDateReader(input, readRequired, readOptional)`**: new and private. It holds
  the body of today's `sanitizeCalendarEvent`, with every date read routed through the two
  readers. That covers `startDate`, recurrence `until`, and exception `date` and `toDate`.
- **`sanitizeCalendarEvent`** stays the **strict** form, and every **write** path uses it. Its
  readers refuse a value that fails `isRealCalendarDate`. **It applies no year bound.** The entry
  asks calendar events to keep that choice, and today they accept any year.
- **`sanitizeLoadedCalendarEvent`**: new, the **load** form. The invariant it must hold is that
  **every value that loads today loads unchanged.** No event is dropped, and no recurrence `until`
  is blanked, because a blank `until` makes a bounded series unbounded. It uses a new
  calendar-specific reader, `calendarEventDateOnLoad` in `sanitize-load-date.ts`. That reader
  keeps what the old rule accepted (the ISO shape plus `Date.parse`'s field-range check, with no
  year bound) and reports a kept value that is not a real calendar date. ★ The existing readers
  `requiredIsoDateOnLoad` and `optionalIsoDateOnLoad` are **not** used: both carry
  `sanitizeIsoDate`'s year bound, and the optional one blanks.
- **`sanitizeCalendarEventForUpdate(input, stored)`**: new, the **update** form. A date equal to
  the stored one for that field is carried verbatim; any other date is judged strictly. Without
  this, the AI update tool, the calendar save handler and the modal refuse every edit to an event
  whose stored date is calendar-invalid, even when the edit never touched that date.

**Every call site, enumerated.** This comes from `git grep`, not from the entry, so a missed site
is visible in review. There are seven code call sites plus one test harness:

| Kind | Call site | Covers |
|---|---|---|
| **load** | `browser-backend.ts` (calendar-events load) | IndexedDB |
| **load** | `workspace.ts` (the JSON load path) | JSON |
| **load** | `buildCalendarEventFromObj` (`csv-codecs-core.ts`) | CSV, Markdown, **and both Turso layouts**, because it is the `fromObj` of the `calendar_events` entry in `ENTITY_SPECS` |
| create / update | `calendar-event-modal.tsx` (form submit) | strict when new, update form otherwise |
| create / update | `use-calendar-events.ts` (save handler) | strict when new, update form otherwise |
| create | `use-register-tools.ts` — AI create | strict |
| update | `use-register-tools.ts` — AI update | update form |
| harness | `src/test/sweep-probes.ts` (create and update probes) | stays strict: it models writes |

The three load sites switch to `sanitizeLoadedCalendarEvent`. Together they reach all six
backends. `acceptsEventDate`, the AI preview predicate, moves to the strict check. Three comments
currently describe the gap as stated but not fixed: the `calendar-event.ts` header,
`inline-ai-edit/entity-descriptor.ts` and `inline-ai-edit/plan.ts`. Each is **rewritten to
describe the new split**, not simply deleted.

**What the closure must say plainly.** A stored calendar-invalid date is **kept and reported, not
repaired**. It still rolls over when rendered, exactly as a stored milestone date does since
§539. The fix stops new bad dates at every write path. It does not rewrite old data.

**Tests.** (a) The strict form refuses a `2026-02-30` `startDate`, omits an invalid `until`,
drops an exception with an invalid `date`, and turns a move exception with an invalid `toDate`
into a skip, which is today's behaviour for that case. (b) **Each of the three load sites**
receives a stored event with `startDate: "2026-02-30"` and returns it **present**, with the date
unchanged and a diagnostic emitted. Every load site is exercised, because the failure mode is a
single site left on the strict form. ★ The JSON load path needs a DOM in the test environment.

**Mutants, each run separately:** (a) the strict reader reverts to shape plus `Date.parse`, and
test (a) must turn red; (b), (c) and (d) put each load site back on the strict
`sanitizeCalendarEvent`, one at a time, and that site's test must turn red.

**Size ratchet.** `calendar-event.ts` grows. Check it against `LIMIT` in
`scripts/check-file-sizes.mjs`, remembering that the script counts one more line than `wc -l`.

## Task 3 — Stakeholder editor: Enter-submit skips the length caps (§541)

**The defect.** The name, organization, title and notes fields cap their length only in each
field's own `onBlur`. `handleSubmit` in `stakeholder-edit-modal.tsx` re-caps only email. So type
into a field and press Enter without leaving it, and the value is saved uncapped, even though the
toast says fields were adjusted. The save handler in `use-stakeholders.ts` does not sanitize. The
oversized value persists and exports until the next full load truncates it.

**The fix.** Extract one per-field normalizer, the cap plus the trim plus empty-to-undefined, and
call it from **both** the blur handlers and `handleSubmit`. Capping only on submit would still
leave Enter and blur disagreeing about trimming. The limits stay `BUDGET_NAME_MAX` for name,
organization and title, and `TEXTAREA_MAX` for notes.

**A caveat for the closure.** `name` also carries a native `maxLength` through `ResourcePicker`,
so a real browser already stops typing past the limit there. The other three fields have no DOM
cap. The JavaScript defect is the same for all four. RTL's change event bypasses `maxLength`, so
the test can still build an over-length name.

**Tests.** Follow the existing email test's submit-without-blur shape in
`stakeholder-edit-modal.test.tsx`. Cover each of the four fields: the saved value is truncated to
its limit, **and** a value under the limit comes through unchanged.

**Mutants.** Four, one per field: drop that field's normalizer call from `handleSubmit`. Each is
run separately and must turn red.

## Task 4 — TimeLog threshold: `min` and `step` both undersell the window (§365)

**The defect, as recon found it.** The code accepts any threshold with `0 < x ≤ MAX_HOURS_PER_DAY`
(24): `parseCap` in `timelog-settings.tsx`, `isCap` in `timelog-policy.ts`, and
`sanitizeTimelogPolicy` in `timelog-sanitize.ts` all agree. The input declares `min={1}`, which
the entry names. **The entry misses a second attribute.** The input has **no `step`**, so it
defaults to 1, and HTML takes the step base from `min`. The valid set in a real browser is
therefore 1, 2, 3 … 24, and `8.5` is already a `stepMismatch`.

**The fork, settled by the copy.** The user-facing notice `timelogThresholdNeeded` reads *"Enter a
cap above 0 and up to {0} hours"*, which describes the code's window. So **widen the attributes
to match the code**; do not narrow the code. No sample data or fixture stores a fractional
threshold, so nothing constrains the choice either way.

**The entry's prescription is wrong.** `min={0.5}` with the default step would make the valid set
0.5, 1.5, 2.5 …, so the ordinary value **8 becomes invalid**. The fix is `min={0}` plus
`step="any"`. HTML cannot express an exclusive lower bound, and `parseCap` already refuses 0 with
the "above 0" notice.

**Tests, and their limit, stated.** jsdom enforces neither `min` nor `step`. So the only
automated observable is the attributes themselves, plus a persistence test showing `0.5` and
`8.5` are stored. The persistence test passes today: it is a characterization guard, not a
reproduction, and its comment says so. The attribute assertions pin the fix.

**Mutant.** Remove `step="any"`; the attribute assertion must turn red. The closure notes that no
automated test can see the real-browser consequence. That is why the attributes themselves are
asserted.

## Task 5 — Clearing a token reseals an empty string instead of removing it (§565)

**The defect, as filed.** Clearing the Jira or TimeLog API token field seals an encrypted empty
string instead of deleting the sealed entry. The entry calls this harmless today.

**What recon found: four offenders, and one of them visibly wrong today.**

| Site | Today |
|---|---|
| `handleApiTokenChange` (`jira-settings.tsx`) | seals unconditionally |
| `handleToken` (`timelog-settings.tsx`) | seals unconditionally |
| `commitTurso` (`settings-sections/integrations-section.tsx`) | seals whatever the field holds, **then sets the stored-token flag to true unconditionally** |
| `confirmPortfolioModeSwitch` (same file) | seals `tursoToken ?? ""` |

On file storage, `commitTurso` runs on every keystroke. So when the user clears the Turso token,
the settings panel's stored-token badge **turns on**: the UI claims a device-sealed token exists
right after the user removed it. This was verified by reading the code, not inferred. The two
entries the register actually names have no such badge, so their exposure is real but invisible.

**The fix.** Each site follows the pattern the AI-key and dictation sections already use: empty
means `removeSealed(id)`, non-empty means seal. `commitTurso` also clears the stored flag on
empty. ★ `commitTurso` has a second, passphrase-mode branch that seals `tokenValue` under the
typed passphrase. Check whether it seals an empty value too, and fix it if it does. Removing on
empty must not break an edit in progress: clearing the field and then typing a new token re-seals
on the next commit. The test covers that sequence.

**Tests.** For each site: clearing to `""` calls `removeSealed` for that id, **and** does not call
`saveSecretValue` with `""`. For `commitTurso`, the stored-token badge is **absent** after a
clear and **present** again after a new token is typed. That is the user-visible observable.

**Mutants.** Four, one per site, each run separately: revert that site to unconditional sealing.

## Task 6 — Diagnostics redactor: a catch-all for opaque tokens (§564)

**The defect.** `SECRET_VALUE_PATTERNS` in `diagnostics-redact.ts` matches six vendor-shaped
forms. A raw token with no vendor prefix and no `key=` frame, sitting in free text, passes
through the redactor whole.

**The real risk is the fix, not the gap.** Legitimate long strings already flow through this
redactor. `sanitize-load-date.ts` reports string entity ids to `logDiag`, and several entity
families mint `crypto.randomUUID()` ids. The MSAL client and tenant ids are GUIDs, and they are
documented as public. Diagnostics also carry commit SHAs and stack frames. A naive length-only
rule, such as 32 or more of `[A-Za-z0-9_-]`, would destroy the very ids these diagnostics exist
to report.

**The fix.** Add a catch-all that matches a run of **at least 32** characters from
`[A-Za-z0-9_-]` **containing a lowercase letter, an uppercase letter and a digit.** The
mixed-class requirement is what does the work:

- canonical UUIDs and commit SHAs are single-case hex, so they are excluded;
- uppercase GUIDs have no lowercase letter, so they are excluded;
- long German compound words have no digit, so they are excluded;
- stack frames break into short runs at `/`, `:`, `(` and `.`.

**No separate UUID-shape exclusion.** With the class rule in place, removing such an exclusion
would change no output on any canonical UUID. It would be a guard with no killing mutant, which
the fifth rule forbids. If the implementer finds a plausible mixed-case UUID source, the
exclusion comes back together with a test that feeds it one.

**A known miss, recorded in the closure.** A token that is entirely single-case hex is not
caught. That is the price of keeping UUIDs and SHAs readable.

**Tests.** Positive: a mixed-class opaque token of 32 or more characters inside free text is
redacted. Negative, and **each must survive unchanged**: a lowercase UUID, an uppercase GUID, a
40-character commit SHA, a realistic stack frame of the shape `dataloss-forensics.ts` captures,
and a long German compound word. A redaction test with only the positive half proves nothing
about its cost.

**Mutants, each run separately:** drop the uppercase requirement (the lowercase UUID gets
redacted, so a negative turns red); drop the digit requirement (the German word gets redacted);
lower the length floor below 32 (choose a negative case that sits just under the floor and must
survive).

## Task 7 — Jira proxy logs the raw fetch-rejection object (§566)

**The defect.** `src/app/api/jira/_helpers.ts` passes the whole caught error to `console.error`
when the upstream fetch fails. No credential is reachable today: recon checked the undici
source, and the rejection never carries the outgoing request's headers. The entry files this as
forward-looking robustness.

**The entry's prescription is wrong.** Node's `fetch` **always** rejects with
`TypeError("fetch failed", { cause })`. So logging `err.message` alone records the literal string
`"fetch failed"` for every real failure, and DNS failures, refused connections, TLS errors and
timeouts all disappear into `.cause`. That fix would throw away nearly all the diagnostic value
the entry sets out to keep.

**The fix.** Log a plain object `{ message, cause }`. `cause` is the cause's message, plus its
`code` when it has one, following the `err instanceof Error ? err.message : String(err)` idiom
used elsewhere in the repo. Apply it to **both** raw-`err` logs in the file: the upstream fetch
failure and the redirect body-cancel failure. The entry names only the first. The second has the
same shape and lower stakes.

**The existing test cannot see this, and it is fixed first.** The current fixture rejects with a
plain `Error("ECONNREFUSED")`. That is not the real shape, so it cannot tell "the cause was kept"
from "the cause was lost". The fixture changes **first** to
`new TypeError("fetch failed", { cause: <an Error with code ECONNREFUSED> })`, and only then is
anything asserted against it.

**Tests.** The logged payload is a plain object, **not** an `Error` instance. That assertion is
red against the unfixed code. And the payload contains `ECONNREFUSED`, so the cause survived.

**Mutant.** Log `err.message` alone. The `ECONNREFUSED` assertion must turn red.

## Task 8 — Chart readout: mid-sentence capital and the clamp boundary (§570, §571)

The two entries share one file pair, so they are one task with two commits: one per entry, each
closing its own register entry.

**§570.** `rowText` in `chart-readout.tsx` joins a sentence to its tip with `, `, and every tip
starts with a capital, in English and in German. A screen reader therefore hears a capital
mid-sentence. The fix joins with `. `. **No i18n change is needed.** Recon checked every German
tip: each starts with a function word, never a noun, so lower-casing would work today. The full
stop is still the right fix, because a future German tip that starts with a noun must keep its
capital. The joined string reaches only the `aria-live` screen-reader span, never a label, title
or visible text, so a full stop is safe everywhere it lands.
★ `chart-readout.test.tsx` **currently asserts the comma form**, so the suite pins the bug. That
assertion is updated as part of the fix. Add a test that walks **every** row kind, in English
and, after `loadI18n("de")`, in German, and asserts that no `, ` followed by a capital appears
anywhere in the readout. Mutant: revert to `, `.

**§571.** `anchorFor` in `use-chart-readout.ts` clamps the readout box into the chart only when
`rect.width > HALF * 2`, which is 352. **This slice changes the comparison to `>=`.** At exactly
352 the clamp range collapses to a single point: minimum equals maximum. The box then sits
exactly inside the chart. The current `>` sends that case to the raw pointer, which can push the
box up to 176 px outside the chart. Tests at widths 352 (clamped to the midpoint) and 351 (raw);
the existing tests use 640 and 200 only. The test file renders a harness through RTL; it is not
a bare hook test. Mutant: revert to `>`, and the 352 case must turn red.

## Task 9 — FX rates: key order unstable across a decode (§576)

**The defect, measured while scoping this slice.** `fxRatesWithDateReader`
(`sanitize-entities.ts`) loops over `SUPPORTED_CURRENCIES` with a keyed lookup, then sets
`rates.EUR = 1` after the loop. Decode an input, round-trip it through JSON, and decode again:

```
EUR absent (ECB-shaped)      decode1=USD,GBP,EUR  decode2=EUR,USD,GBP  UNSTABLE
EUR present, listed last     decode1=EUR,USD,GBP  decode2=EUR,USD,GBP  STABLE
EUR present, listed first    decode1=EUR,USD,GBP  decode2=EUR,USD,GBP  STABLE
control: 3/3 cases produced rates (probe is live)
```

**The entry's causal story is wrong about the mechanism.** Key order depends on whether EUR is
**present** in the input, not on where it sits: "listed last" is stable. The entry says the
golden fixture broke until the sample master listed EUR first. What actually matters is that the
master carries an explicit EUR entry at all.

**Consequences.** **No golden regeneration and no edit to the sample master.** The master
already carries EUR, and the goldens already read `EUR=1|USD=1.1|GBP=0.85`, which is the canonical
order. Do not touch `sample-workspace-small.json` for a no-op.

**The fix.** Assign EUR inside the loop, at its `SUPPORTED_CURRENCIES` position, without a
condition. USD and GBP stay conditional, so a missing currency still gets no key.

**The test trap.** `toEqual` ignores key order, which is why none of the three existing sanitize
suites could see this. The test must compare `Object.keys(rates)` across two decodes of an input
that has no EUR. The golden-workspace test must also stay byte-identical. That is the presence
half: the fix changes nothing that was already stable.

**Mutant.** Restore the assignment after the loop. The `Object.keys` assertion must turn red.

**The peer's §597** proposes a regenerate-and-diff ratchet for the scaled samples. §576 does
**not** block it on current data, because the master carries EUR. The peer is adding a one-line
caveat to §597, which may cite §576 by number once this closes.

## Task 10 — Release, and close §391 as a record

**§391.** Recon confirmed the defect is gone. `set_task_dependencies` has its own branch ahead
of the empty-plan fallback, and `chat-proposal-describe.test.ts` pins that. The entry's own
Status line already calls it a record. It closes as one.
**The stale comment.** The header of `chat-proposal-block.tsx` still lists `set_task_dependencies`
among the tools that produce an empty plan, which is now false. It also omits
`escalate_raid_item`. Rewrite it so that it **points at the test that pins the list** rather than
restating the list. The list has already drifted out of date once, and a comment that restates a
set drifts from it again.

**Release.** Bump `APP_VERSION` to 1.12.7 in `src/app/version.ts`, with `APP_BUILD_DATE`. The
milestone stays "Child". Propagate with `npm run version:sync`, then check with
`npm run version:check`. Add the `CHANGELOG.md` entry. No session URL goes in the CHANGELOG or the
MR description.

## Verification

- **Per task:** scoped vitest (`--maxWorkers=1 --reporter=dot`, never two runs at once),
  `npx tsc --noEmit`, and `npx eslint --max-warnings=0` over the touched files. Every exit code
  is read unpiped.
- **Tasks that add or reorder tests:** also run `npm run test:shuffle`, the only local
  reproduction of CI's shuffled gate.
- **Per closing commit:** the three `followups:*:check` gates.
- **Whole suite:** CI, per the owner's standing rule that full local gates are not run.
- **Line endings:** every touched `src/` file is `i/lf w/crlf` today. Check
  `git ls-files --eol` before and after each edit. Never `sed -i`. This slice touches **no**
  `i18n.de.ts` line.

## Success criteria

1. All ten fixes merged, each with a test that was red against unfixed code for the predicted
   reason, and every listed mutant red when run on its own.
2. §391 closed as a record, with the stale comment corrected.
3. Eleven headings changed from OPEN to CLOSED, with no `**Work item:**` line left on any of them.
   All three register gates green.
4. The eleven GitLab issues closed, **checked one by one after merge**.
5. No stored calendar event that loads on `origin/main` today fails to load after Task 2, with
   each of the three load sites tested.
6. The golden-workspace fixtures byte-identical to `origin/main`.
