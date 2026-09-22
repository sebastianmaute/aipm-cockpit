# Pluralisation, picker consolidation and register hygiene — design

**Date:** 2026-09-07
**Branch:** `feat/plural-pickers-register-hygiene` (off `origin/main` at `2e70d35b`)
**Register entries addressed:** §415 (narrowed), §407 (stale heading closed — the code is already fixed), §422 (probe-then-decide),
§410, §411, §412, §421, §423

## Goal

Four independent, file-disjoint workstreams shipped as one release: a real per-language plural rule
across 31 i18n keys, a decision on the comma-email round-trip defect, one shared combobox core behind
the two entity pickers, and register/version-ledger hygiene with a gate that keeps the register's own
index honest.

## Why these four, and why together

They share no files. A single branch, one version bump and one pipeline is the cheapest packaging for
work that parallelises cleanly; the accepted cost is that a red gate anywhere blocks all four. The one
shared resource is vitest, which is never run by two processes at once.

`origin/main` is at `2e70d35b` (`0.289.0 "Mirrlees"`). The register's highest number is **423** — mint
new numbers from a HEADING scan against both trees, never from the index table, which is the artifact
§421 is about.

---

## A. Pluralisation (§415; §407 is already fixed in code)

### The problem

At least 31 keys interpolate a count into a sentence whose noun, adjective or verb never agrees:
`"{0} entries logged"` renders "1 entries logged"; `"{0} Snapshots löschen?"` renders "1 Snapshots
löschen?". DE is wrong in all 31. No gate can see plural agreement in an interpolated string, and none
ever will. They live across **23** call-site files (derive today's set by grepping each key name from
§415's table across `src/app`, excluding the dictionaries and tests).

★★ **§407 is NOT among them — it is already fixed and its heading is merely stale.** Verified
2026-09-07: `task-row.tsx` and `task-kanban-card.tsx` both branch on `count === 1` between
`taskRowChangesBadgeOne` and `taskRowChangesBadge`, and both files carry tests pinning the singular and
the plural, one of them in DE. What §407 needs is entry closure (heading suffix, Status line, index
row), which is workstream D; what it contributes to A is one more ternary to migrate.

### The existing house rule, and how this design relates to it

`i18n.ts` states, immediately above `taskRowChangesBadgeOne`:

> The house idiom is a `*One` key plus a `count === 1 ?` ternary at the call site (nine such keys
> today) — NOT a pluralize() helper. German breaks on noun AND adjective AND verb agreement at once,
> so a singular is a re-worded sentence, not a suffix swap on a fragment.

**The substance of that rule is kept and the mechanism is changed.** Its load-bearing claim — that a
singular is a re-worded sentence, so each form must be an independently authored complete string — is
correct and this design obeys it. What changes is only where the `count === 1` test lives: in one
helper rather than at 41 call sites. A helper that selected a *suffix* would violate the rule; a
helper that selects between two *complete authored strings* does not.

The comment's own parenthetical count is stale — it says "nine such keys today" and there are **ten**
(`grep -oE "^  [a-zA-Z]+One:" src/app/i18n.ts`), the tenth being the key the comment introduces. That
comment is rewritten as part of this work to describe the mechanism that then exists.

### The mechanism

A `tPlural(lang, baseKey, count, ...args)` in `i18n.ts` beside `t()`:

- selects `<baseKey>One` vs `<baseKey>` via `Intl.PluralRules(lang).select(count)`, mapping `"one"` to
  the `*One` key and every other category to the base key;
- delegates the actual lookup and placeholder interpolation to `t()`, so the DE lazy-dict resolution,
  the `en-GB` fallback and the `{0}`-positional substitution keep exactly one implementation;
- takes `count` as its own argument AND passes it through as `args[0]` where the string interpolates
  it, so a call site never has to pass the number twice.

`en-US`, `en-GB` and `de` all resolve to the two categories `one` / `other` under `Intl.PluralRules`,
so behaviour is identical to the ternary it replaces. The helper is written against the categories
rather than against `count === 1` so that a future language with more categories is a dictionary
change, not a code change.

### Scope

All 31 keys from §415's call-site-verified TIER 1 table, plus migration of the 10 existing `*One`
keys, giving 41 keys on one idiom. Verified 2026-09-07 before writing this spec: all 31 names exist
exactly once in **both** `i18n.ts` and `i18n.de.ts`; a control key `zzzNotARealKey` returns 0 in both,
so the scan is not vacuous.

**§415's 45-vs-31 gap stays OPEN.** This work pins one side of it by name — the 31-key membership list
is committed into §415, which no pass has done before — but it does not close the gap, because closing
it requires a genuinely independent re-derivation and this reuses the fresh pass's methodology. §415 is
narrowed and its Status line says exactly that.

### Constraints this work must respect

- `i18n.de.ts` is **never** edited with Edit or Write. Patch it via a `.mjs` written with the Write
  tool, matching `\r\n` anchors, writing real umlauts, never `\uXXXX` escapes (the `i18n-encoding` test
  bans ASCII substitutions and escape sequences).
- `tsc` enforces identical EN/DE key sets, so every `*One` key must land in both dicts in the same
  commit. That is the only automatic protection this work has and it is worth leaning on.
- Both dictionaries are exempt from the file-size ratchet (`EXEMPT` in `scripts/check-file-sizes.mjs`),
  so length is not a constraint here.
- A DE assertion in a test must `loadI18n("de")` first — the DE dict is lazy.

### Testing

- Unit tests for `tPlural` over all three `Lang` values at counts 0, 1, 2 — 0 and 2 must both take the
  `other` branch, which is the assertion a naive `count === 1` implementation also passes and a
  `count > 1` one does not.
- Per-key call-site tests are not written for all 41. Instead: a source-level test asserting that every
  `*One` key in the dictionary has a plural sibling, and that every `tPlural(` call names a base key
  whose `*One` sibling exists. That converts the naming convention into something a gate can see, which
  is the durable half of this work.
- The existing ten migrated call sites keep their current tests; those tests are the regression
  evidence that the migration changed no rendered string in the `other` case.

---

## B. Comma-bearing email addresses (§422) — probe, then decide

### What is actually established

`sanitizeEmailList` splits a delimited string on `[;,]`; `entity-descriptor.ts` projects
`resource.emails` for the preview by joining with `", "`. A stored `["a,b@x.com"]` therefore joins to
`"a,b@x.com"` and re-splits into two addresses. That much was probed on 2026-09-06.

`sanitizeEmail` is `sanitizeText(s, EMAIL_MAX)` and performs no format validation, which is why such an
address can be stored at all.

### What is NOT established, and must be probed first

§422 says "applying ANY unrelated edit" triggers the loss. The patch is built from `plan.updates` —
the fields the **model proposed** — not from every `diffField`, so an edit that never mentions
`emails` may well not round-trip it at all. The entry's trigger claim is therefore unverified.

**Task 1 of this workstream is a probe that establishes the real trigger and records it in §422**,
with its command or spec retained this time rather than deleted. Nothing is fixed before that probe
reports.

### The mechanism that was considered and is REJECTED

Adding `emails` to the descriptor's `arrayFields` is refuted by a ★★★ rationale already in
`entity-descriptor.ts`: `coerce` splits an `arrayFields` value on `","` **alone**, which is a second
parser for a format the writer already owns, and — decisively — would still destroy the comma. It is
worse than today, not better. Do not reach for it.

### The mechanism expected to survive the probe

A no-op guard: when the value the model proposes for `emails` is byte-identical to the string the
descriptor projected for `before`, the field is dropped from the patch, so an unedited list is never
re-parsed. This needs no new parser, respects the "one parser, the writer's" rule, and is correct
regardless of what the probe says about the trigger.

If the probe refutes the entry outright — no reachable gesture destroys the address — the honest
outcome is to correct §422's framing and close it as not-a-defect, and this workstream contributes a
register correction rather than a code change. That is an acceptable result and is not a failure.

### The residual, which is documented rather than fixed

A comma inside an address the user *genuinely edits* stays unrepresentable, because the delimited
transport is the writer's own storage format. That limit is stated in §422 and beside the sanitizer,
not papered over. Closing it would require either format validation at `sanitizeEmail`'s ~18 call
sites — including Jira and Outlook ingest, which today accept anything — or a non-delimited transport
for the field. Both are their own slice.

---

## C. Picker consolidation (§410, §411, §412)

### The problem

`single-entity-picker.tsx` (340 lines) and `entity-link-picker.tsx` (430 lines) are near-identical from
`const listId` to `return (`; their search-box blocks diff clean at exit 0. The real cost is the prose:
both carry multi-paragraph statements of the same `options` invariant, the same purity argument for
computing `next` outside the setState updater, the same `aria-activedescendant`-does-not-auto-scroll
justification for the `rAF`, and the same `preventDefault`-versus-`stopPropagation` analysis of the
Escape path. They already differ in wording and must be kept in step by hand. `dup:check` compares a
repo-wide total and cannot see ~80 duplicated lines.

### The mechanism

One `use*` hook holding the duplicated mechanics — the `prevQuery` render-time reconcile, the `active`
clamp, `move()`, and `onKeyDown` — parameterised by an **identity accessor** so `EntityLinkPicker`
keeps its `entryKey` routing and `SingleEntityPicker` its bare `value`. Plus extraction of the
`ClearableSearchInput` + `Input` search-box block, which already diffs clean and so can move with no
behaviour question at all.

Each picker keeps its own commit call (`onSelect` taking a value string vs `onAdd` taking a whole
entry) and its own React list key. **Those two differences are deliberately NOT parameterised into the
shared unit** — folding divergent commit contracts behind discriminating props is the shape AGENTS.md
warns against for the SSRF proxy helpers, and it is what separates this design from the
one-shared-component alternative that was considered and rejected.

The canonical prose moves to the hook and is deleted from both call sites, which is the outcome §410
actually asks for.

### Testing

- The extraction pins the hook's behaviour, but a seam test cannot see a break above it. Each picker
  therefore keeps a test asserting the hook is actually wired at that call site, not merely that the
  hook works.
- §411's three stated-but-untested rationales get tests: the render-time reconcile, the purity of the
  `next` computation, and the `rAF` scroll-into-view. Each is mutation-proved, and the mutant's token
  span is recorded, because a guard test that survives a one-token revert of the line it guards proves
  nothing.
- §412: `TaskLinkPicker` (74 lines) gets a direct suite. Its coverage today is real but entirely
  indirect.

---

## D. Register and version-ledger hygiene (§421, §423)

### §421 — the index table cannot see eight of its entries

§407–414 exist as headings with no index-table row, and a §321 ordering discrepancy sits in the same
table. This already caused a real defect: §420 was minted as §407, a number already taken, and shipped
in nine commits before anyone noticed. No gate can see it — `followups:status:check` reads `**Status:**`
lines, `docs:claims:check` reads `path:LINE` citations, `docs:symbols:check` reads backticked names, and
none compares the heading set against the index set.

**Fix:** the eight rows are written **by hand**. The in-file rebuild script would fill their summary and
provenance cells with `— | —`, which is not a repair — those cells hold content nobody has written, for
entries other slices own.

**Gate:** a new check comparing the heading set against the index set, failing on either direction of
drift, wired into the existing `followups` script family and into CI. It follows the two-exit-code
convention the neighbouring gates use: **1 is drift**, **2 is the gate unable to scan** (zero headings
parsed, unreadable register). The vacuity control is built deliberately and asserted in its unit test —
a gate that scans nothing passes everything, and this gate is authored against a register that is
currently broken, so it has no green baseline to inherit.

Order: the gate is written and demonstrated red against today's register **before** the repair, then
green after. That sequence is what proves it is not vacuous.

### §423 — the codename ledger

`APP_MILESTONE`'s docstring carries a hand-maintained ledger of past codenames with a one-line
biography each. Nothing reads it; the uniqueness check the same docstring prescribes greps
`CHANGELOG.md`, which already holds every codename in its headers. It has rotted three times, most
recently *inside the commit documenting the first rot*.

**Fix:** cut the ~53 biography lines. Keep the reuse and near-collision notes — 0.236.x "Sheldon" and
0.287.x "Tiptree" are the same person, and that observation is genuine repo knowledge with no other
home. Point at `CHANGELOG.md` as the single home for codenames, per AGENTS.md's doc-set rule.

The biographies are what make a ledger line expensive enough to skip, which is the argument for cutting
them rather than for catching up: the 0.289.0 bump added five attributions from memory alone.

---

## Execution

One branch, four file-disjoint commit groups, parallel subagents dispatched by disjointness:

| Workstream | Owns |
|---|---|
| A | `src/app/i18n.ts`, `src/app/i18n.de.ts`, the 23 call-site files, plural tests |
| B | `src/app/inline-ai-edit/entity-descriptor.ts`, `src/app/use-inline-entity-edit.ts`, §422 |
| C | `src/app/single-entity-picker.tsx`, `src/app/entity-link-picker.tsx`, `src/app/task-link-picker.tsx`, the new hook, their tests |
| D | `docs/open-followups.md`, `src/app/version.ts`, `scripts/`, `.gitlab-ci.yml` |

**A and D both touch nothing the other owns**, but D's register edits and A's §415 narrowing both write
`docs/open-followups.md` — those two are serialized against each other, not run in parallel.

Only one vitest process runs at a time, ever. Gates run at the end on explicit say-so; no full suite
before then.

Release: one version bump, one `CHANGELOG.md` entry, one MR, poll the pipeline, merge on green with
`--auto-merge=false`.

## What this design deliberately does NOT do

- Does not close §415's 45-vs-31 count gap (needs an independent pass).
- Does not add email format validation at `sanitizeEmail`'s ~18 call sites.
- Does not collapse the two pickers into one shared component.
- Does not run the register's rebuild script.
- Does not touch §391, §394, §405, §408, §409, §413, §414, §418, which stay open.
