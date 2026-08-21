# Help reading level + surface cleanup (slice 2)

**Status:** design approved (three decisions taken 2026-08-05), not yet planned
**Date:** 2026-08-05
**Slice:** 2 of 3
**Predecessor:** [slice 1](2026-08-05-help-content-truth-and-gate-design.md)

## The premise correction that reshaped this slice

Slice 1's spec scoped slice 2 as **"surface split + reading level"**, on the
claim that *"the floating panel currently renders features-only (31 of 51
entries); concepts, workflows and 'what's automated' are invisible unless the
user finds the in-pane Help view."*

**That is false, and was already false when it was written.** `help-menu.tsx:164`
renders `<HelpContentPane lang={lang} query={query} />` with no group filter, and
`help-content-pane.tsx:54` maps the whole of `HELP_GROUP_ORDER`. All 51 entries
have been in the floating panel since the pane was shared.

★★ The claim came from `docs/AGENTS/ui-shell.md`, which **contradicts itself
inside one paragraph** — *"The floating top-bar Help panel stays features-only
via the derived `HELP_SECTIONS`"*, then six lines later *"★★ FLOATING panel
(`help-menu.tsx`) is CONTENT-PANE ONLY (`HelpContentPane` + its own search
box)"*. The same stale claim is repeated in `help-content.ts`'s own header
comment. `docs:symbols:check` passes both: `HELP_SECTIONS` is a real name.

★★ `HELP_SECTIONS` (`help-content.ts:95`) has **zero production consumers**. The
only reference outside its own definition is `help-content.test.ts:12`, which
asserts it equals the features filter — a test that pins the export to itself
and would keep passing if every surface stopped using it, which is exactly what
happened. A dead export plus a self-referential test plus ungated prose is how a
removed behaviour goes on being documented as current.

So slice 2 is **reading level + cleanup**, not a surface split.

## Goal

Let a user choose how much teaching the Help surfaces do, and delete the dead
code and false prose that produced the wrong premise above.

## Scope

**In:** a device-global `helpReadingLevel` setting with three levels; plain-
language primers on the 12 concept entries; group order varying by level;
removal of `HELP_SECTIONS` and the two stale prose claims.

**Out:** slice 3's ~18 new entries for the 14 uncovered views. No release,
version bump, push or MR — those need their own explicit go-ahead.

## Decisions taken

| Question | Choice | Why |
|---|---|---|
| Level shape | **Three** — Guided / Standard / Expert | Keeps approach C (group reorder) from the approved slice-1 design; Standard preserves today's behaviour so nobody is forced into an opinionated mode. |
| Setting scope | **Device-only** | Reading level follows the person, not the project. |
| Dead export | **Delete it, fix the docs** | Removes the exact prose that produced this slice's false premise. |

## Design

### 1. The three levels

```
Guided    concepts → workflows → features → automated   + primers
Standard  concepts → workflows → features → automated   (today's behaviour)
Expert    features → automated → workflows → concepts   no primers
```

Guided and Standard share today's order — the difference between them is
**only** the primers. Expert differs **only** in order. That keeps each level's
effect nameable in one clause, which matters because the Settings hint has to
describe all three in a sentence a user will actually read.

`HELP_GROUP_ORDER` stays exported as the standard order (its current value, its
current name) and gains a sibling pure function:

```ts
export function helpGroupOrder(level: HelpReadingLevel): readonly HelpGroup[]
```

★ Guided and Standard return `HELP_GROUP_ORDER` **by reference**; the pane only
reads it. Callers wanting a mutable array spread it — the same rule
`ALL_GANTT_STATUSES` carries.

### 2. Where the level lives

`Settings.helpReadingLevel?: HelpReadingLevel`, defaulting to `"standard"` in
`defaultSettings` (`settings-types.ts:648`).

★★ **Device-only is a deliberate exception and needs to say so at the field.**
Every other field in Settings → Appearance — `dashboardDensity`,
`showViewHints`, `tasksViewMode` — is per-project overridable via
`ProjectAppearancePref`. Adding the fourth without an override reads as an
oversight unless the type carries a comment saying it is intentional. It is
therefore absent from `ProjectAppearancePref`, `sanitizePref`, `prefsEqual` and
`resolveEffectiveSettings` **on purpose**, and because it is device-only the
effective-settings resolver never has to see it — the device value *is* the
effective value.

★ `HelpReadingLevel` is declared in `help-content.ts` and imported into
`settings-types.ts` as a **type-only** import. Type imports are erased, so no
runtime cycle is created even though `help-content.ts` has runtime exports.

### 3. Getting the level to the pane

`HelpContentPane` takes `readingLevel?: HelpReadingLevel`, defaulting to
`"standard"`. The pane stays presentational — its header comment already
promises that — and remains directly testable at every level without a
provider.

The two surfaces each call `useSettings()` and pass the value down:
`help-menu.tsx` (floating) and `help-view.tsx` (in-pane). Neither reads settings
today.

★★ **Do NOT thread this through `ActionMenus`.** `HelpMenu` is mounted at
`action-menus.tsx:68`, whose contract is guarded by `action-menus-sweep.test.ts`
and whose header comment documents a deliberate props-not-hooks rule for the
export config. Adding a settings prop there would widen a guarded contract and
add three hops for a value one component needs. A local `useSettings()` is
correct here because the module-level listener registry in `use-settings.ts`
already syncs every live instance on write — the "wouldn't reach it until a
reload" problem that motivated the props rule no longer exists for new callers.

### 4. Primers

Each of the 12 `concepts` entries gains an optional `primerKey: TranslationKey`
— a two-sentence plain-language answer to "what is this and why do I care",
written for someone who has not run a project before.

Rendered **only at Guided**, above the body, in a `rounded border border-line
bg-surface-muted p-2` block inside the card. The card is `bg-surface` on a
`bg-surface-muted` scroller, so the primer reads as inset without a new token,
a gradient or a shadow.

★ Primer text runs through `parseHelpBody` like any body, so a primer may carry
`[[label]]` markers and they render and resolve identically.

★★ **A primer joins the search body only at the level that renders it.** Search
already strips markers because "searching the raw body would let a query match
markup that is never rendered" — matching text the user cannot see is the same
defect. So at Standard and Expert a primer is neither rendered nor searchable;
at Guided it is both. The consequence is deliberate: the same query can match
a different number of entries at different levels.

### 5. Gate extension

`help-content-gate.test.ts`'s marker half iterates `t(lang, e.bodyKey)`. It must
also walk `e.primerKey` when present, in all three languages. Without that, 12
new bodies of marker-carrying prose would be entirely ungated — the gate would
report success over content it never read.

The coverage ratchet is untouched: primers add no `relatedViews`, so
`KNOWN_UNCOVERED` stays exactly as slice 1 left it.

### 6. Cleanup

- Delete `HELP_SECTIONS` (`help-content.ts:95`).
- Delete its assertion (the `"HELP_SECTIONS is exactly the features group"`
  case) and drop the name from that file's import list.
- Correct `help-content.ts`'s header comment — the panel is not features-only.
- Correct `docs/AGENTS/ui-shell.md`'s "stays features-only via the derived
  `HELP_SECTIONS`" sentence, which is the source of the false premise, and which
  its own next paragraph already contradicts.

★ `docs:symbols:check` will fail on any surviving backticked `HELP_SECTIONS`
after the export is deleted — that is the gate working, and the fix is to remove
the mention, never to allowlist the name.

## Testing

Every new test is mutation-proved: break the line it guards, confirm it fails
**by name**, restore. A test that passes against the broken code is recorded as
vacuous and rewritten. ★ Never revert a mutation with `git checkout <file>` —
that discards unrelated working-tree edits.

- `help-content.test.ts` — `helpGroupOrder` returns the documented order for
  each of the three levels, and every `concepts` entry has a `primerKey`.
- `help-content-pane.test.tsx` — a primer renders at Guided and is absent at
  Standard and Expert; group headings appear in Expert's order; a query matching
  primer-only text finds the entry at Guided and does not at Standard.
  ★ The Expert-order test must assert the **rendered sequence** of group
  headings, not merely that all four are present — a presence assertion passes
  against the unchanged order and is vacuous.
- `help-content-gate.test.ts` — a broken marker inside a **primer** fails
  resolution, in EN and independently in DE. ★ Injecting an EN label into the EN
  primer fails only `en-US`/`en-GB`; the DE mirror needs its own injection,
  because the DE primer is a separate string.
- `appearance-section.test.tsx` — the control renders three options and writes
  the field.

## Verification

Gates run **serially** — `test:coverage` beside `dup:check` has produced a
spurious exit 1 with every test passing. Never read a gate's exit code through a
pipe.

`tsc` · `eslint --max-warnings=0 src/app` · `test:run` · `test:coverage` ·
`dup:check` · `size:check` · `docs:symbols:check` · `build`.

Axe: **Settings only.** Help is not in `A11Y_VIEWS` (`e2e/a11y.spec.ts:18`), so
the primer and the reordered groups are eye-verified, not gate-verified. The new
`SegmentedControl` lands in Settings → Appearance, which the Settings scan does
reach. Run it on a fresh isolated server (`PORT=3100`), never the user's
long-running tab.

## i18n

17 new keys × EN + DE: `helpReadingLevelLabel`, `helpReadingLevelHint`, three
option labels, and 12 primers.

`i18n.de.ts` is edited via a node UTF-8 write, never the Edit tool, and verified
at codepoint level afterwards (real umlauts, CRLF intact, no ASCII
substitutions). ★ The DE primers are written **for German readers**, not
translated clause-by-clause from the EN — slice 1 hit a case where mirroring an
English correction into German would have introduced a fresh mismatch, because
the German control genuinely uses a different word.

## Honest limits

The gate still proves structure, not truth. A primer that is fluent, resolves
every marker, and is **wrong** passes every assertion in this slice. The primers
are new prose about behaviour, so they carry exactly the decay risk slice 1
spent its whole budget correcting — each one is written against the code it
describes, not from memory or from AGENTS.md.

Nothing here measures whether the levels help anyone. Three levels is a
reasoned guess at a spread, not a researched finding.

## Success criteria

1. A user can pick Guided / Standard / Expert in Settings → Appearance, and both
   Help surfaces honour it.
2. Guided shows a primer on all 12 concept entries; Expert renders features
   first; Standard is byte-identical to today.
3. The marker gate reads primers, and fails on a broken marker in one.
4. `HELP_SECTIONS`, its test, and both stale prose claims are gone.
5. Full gate set green, serially; axe green on Settings; Help eye-verified.
