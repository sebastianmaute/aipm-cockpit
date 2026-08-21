# Help coverage — draining the ratchet and closing the feature gaps (slice 3)

**Status:** design approved (scope confirmed by the user 2026-08-05)
**Date:** 2026-08-05
**Slice:** 3 of 3

## Goal

Empty `KNOWN_UNCOVERED` and document the shipped features that have no Help
prose at all, in EN and DE, with every claim checked against the code that
implements it.

## The premise correction

Slice 1's spec described slice 3 as *"~18 new entries for features that have
none today."* The total is about right; the attribution is wrong, and it was
wrong in a way that would have produced duplicate content.

★★★ **Five of the fourteen baseline gaps need no new prose at all.** An entry
already describes the view in full and simply carries no `relatedViews`:

★★ This said "Six" until 2026-08-06, contradicting its own table two lines
below — which flags the sixth id, `stakeholder-map`, as described *falsely* and
then spends a whole section rewriting that prose. That one needed content. A
headline that disagrees with the table under it is the same defect this spec
was written to correct.

| Uncovered view | Entry that already describes it | Evidence |
|---|---|---|
| `activity` | `feature-activity` | full body; `relatedViews` absent entirely |
| `history` | `feature-version-history` | body says "Open the History view" |
| `directory` · `calendar` · `manage-roles` | `feature-resources` | body names all five sub-tabs by name |
| `stakeholder-map` | `concept-stakeholder` | body describes the matrix — falsely, see below |

Coverage is `relatedViews` membership, so a truthful, complete entry that never
lists a view reads to the gate as a gap. Writing a *second* entry for those six
would have been the visible outcome of trusting the spec over the code — the
same failure mode as slice 2, whose premise was also false.

★★ **A second, invisible gap class.** The ratchet measures **views**. A feature
that is not a view cannot appear in it, however undocumented. Probing the 139
`help*` strings finds zero prose for: saved views · PWA/offline · undo/redo ·
inline AI edit · weekly digest · column resize · print · reading level. The
gate is silent on all eight and always will be. Closing them is a judgement
call, not a ratchet result — which is why it is stated here rather than
enforced.

## Scope

**In:**

1. Wiring: `relatedViews` on the four entries above.
2. A truth fix forced by (1) — see below.
3. Six new entries for the view gaps that genuinely have no content.
4. Seven new entries for the non-view feature gaps.
5. `KNOWN_UNCOVERED` → `[]`.

**Out:** release, version bump, push, MR. Those need their own explicit
go-ahead. No change to the gate's *shape* — only its baseline.

## The truth fix

`helpConceptStakeholderBody` says, in **EN**:

> "Stakeholders are tracked in the Stakeholders view on an interest × power
> matrix."

★★ The "× power" wording is ENGLISH-ONLY. The German string already read
`"Interesse-×-Einfluss-Matrix"` — the correct axis — so only the view-location
half was wrong there. An earlier revision of this spec attributed both halves
to "(EN + DE)", which would have sent someone to correct German that was
already right.

Both halves are false in English:

- The axis is **Influence**, not power — `stakeholder-map-panel.tsx:3` ("Stakeholder
  Influence / Interest 2×2 grid"), `:143` (`quadrantAxisInfluence`), and
  `types.ts:368-369` (`influence` / `interest`).
- The 2×2 grid is the separate **`stakeholder-map`** view. The Stakeholders
  view is a table.

The audit reported this in slice 1 and it landed in the REPORTED-not-verified
bucket, so it shipped uncorrected. Wiring `stakeholder-map` onto this entry is
what forces the re-read — the cheap structural fix drags the truth fix along
with it, which is the argument for doing them in one slice rather than two.

## Entry inventory

★ No new entry lands in `concepts`, so none needs a primer
(`help-content.test.ts` pins primers to concepts in both directions). This is a
deliberate scope limit, not an oversight: a primer is Guided-level teaching
copy and every one added is another string to keep true.

**View gaps (6) — these are what drain the baseline:**

| id | group | relatedViews |
|---|---|---|
| `feature-projects` | features | `projects` |
| `feature-portfolio-health` | features | `portfolio-health` |
| `automated-insights` | automated | `insights` |
| `feature-timelog` | features | `timelog` |
| `feature-reports` | features | `reports`, `budget-report`, `raid-report`, `change-report` |
| `feature-help` | features | `help` |

★ One Reports entry, not three. `raid-report` and `change-report` are the same
feature applied to two registers; three near-identical bodies would be three
things to keep in step for no reader benefit. It lists `budget-report` too —
already covered by `concept-budget`, and set equality does not care, but the
Related line should be complete rather than arbitrarily truncated.

★ `feature-help` covers the Help view *and* absorbs the reading-level gap, so
the reading level is documented exactly once.

★★ `feature-projects`, `feature-portfolio-health` and `feature-timelog` name a
view a reader may not be able to reach: `portfolio-health` is in
`TURSO_ONLY_VIEWS`, and modules can be disabled per project. Precedent says
that is fine — `trends` is Turso-only and has been covered since slice 1 — but
each body must say what it depends on rather than implying the view is always
there.

**Non-view feature gaps (7):** `feature-saved-views` · `feature-offline` ·
`feature-undo` · `feature-inline-ai-edit` · `feature-digest` ·
`feature-table-columns` · `feature-print`. All `features`, all with
`relatedViews` where a view genuinely applies and none where it does not — an
invented relation is a false claim like any other.

Result: 51 → 64 entries.

## Method — how a body gets written

★★★ This is the whole risk of the slice. Slice 1 set out to correct two false
entries and found **~35 false claims across ~25 of 51**, writing no new prose
at all. Thirteen new entries in two languages is a larger surface than that
audit covered, produced faster.

The rule: **read the implementing module before writing the sentence, and cite
the symbol in the commit** — not `file:line`, which the writing commit can
itself invalidate. A claim that cannot be traced to a symbol does not go in.
Prefer omitting a detail to guessing it. Counts ("five sub-tabs", "six tours")
are the most expensive kind of claim and get a reproduce command or no number
at all.

## Gate

`KNOWN_UNCOVERED` becomes `[]`. Nothing else about
`help-content-gate.test.ts` changes: the assertion is already set equality, so
an empty baseline means "every nav view is covered" and any regression fails
immediately.

★ The marker-resolution half needs no change but does apply to the new bodies —
any `[[label]]` written into one must match a real dictionary value in all
three langs.

## Testing

- `help-content-gate.test.ts` — baseline empty; mutation-prove by deleting one
  new `relatedViews` entry and confirming the failure names that view.
- `help-content.test.ts` — the existing id-uniqueness, relation-resolution and
  valid-`AppView` assertions cover the new rows for free. Raise the
  `automated` minimum from 1 to 3 so the new automated entry cannot be silently
  deleted.
- EN/DE key parity is enforced by `tsc` via `TranslationKey`.
- `i18n-encoding` bans ASCII umlaut substitutions in the DE bodies.

★★ `i18n.ts` **and** `i18n.de.ts` are both CRLF. An LF-anchored node replace
matches nothing and no-ops silently; the Edit tool corrupts umlauts and curls
quotes in the DE file. Patch both by node UTF-8 write, verify at codepoint
level.

## Out of scope, still open

`aiConsentBullet2` — "your Anthropic API key is stored **unencrypted** in this
browser's localStorage" — remains false on the AI consent gate, which has more
reach than any Help body. Slice 1 flagged it as security copy needing the
user's decision. Still needs it.
