# Slice 3 — Type-to-confirm and destructive-refusal recourse

**Roadmap row:** slice 3 of `docs/superpowers/specs/2026-08-31-followup-slice-roadmap.md`.
**Entries:** §300 · §301 · §302 · §303 · §307.
**Branch:** `fix/type-to-confirm-recourse`, off `62d84fa3` (0.272.0 "Zoline").

## Provenance — what is measured and what is not

Every entry in this slice was REPRODUCED against the tree at `62d84fa3` by a read-only probe
before this design was written. Four of the five carried a `never machine-verified` Status line;
all four now have one. That is the only claim being made — reproducing a defect says nothing
about whether the fix below is right.

Two findings CHANGED the design away from the obvious fix. Both are recorded at the unit they
affect, so a reader who disagrees can re-derive them:

- §303's obvious fix (gate the forensic write on `refusalWasStanding`) is WRONG and would lose a
  real record. See Unit 4.
- §307 is not a testability gap. It is a consequence of the guard being correct. See Unit 5.

## Goal

Close §300, §301, §302, §303. Rewrite and close §307. File one new entry (§323) without fixing it.

User-visible outcome: a German user can complete a destructive confirmation at all — today three
of six confirm phrases are English-only, and the German prompt sentence is broken even for the one
phrase that IS translated. A screen-reader user is told whether storage is ready. The forensic log
stops recording one data-loss event twice.

## Non-goals

- No change to the refusal PREDICATE. `(fullWipe || massDelete) && !allowDestructive` stays as it
  is; this slice changes what is SAID about a refusal, never when one fires.
- No production test hook. See Unit 5.
- No `InfoTooltip` naming changes — a peer set an ordering precedent in slice 5 (§314) and this
  slice must not set a competing one.
- No fix for §323. Filed only; Unit 6 says why fixing it is the wrong direction.

---

## Unit 1 — `type-to-confirm-dialog.tsx` (§300)

**Defect, measured.** `const matched = typed === confirmValue` is bare equality with no
normalisation, and `disabled={!matched}` is its only consequence. The component contains no error
text, hint, or copy affordance. A user who mistypes is told nothing — the button stays dead.

Separately, the prompt interpolates the phrase undelimited. EN `"Type {0} to confirm"` is merely
ambiguous; DE `"Geben Sie {0} zur Bestätigung ein"` is broken, because German puts the separable
prefix *ein* last, so a comma-bearing phrase lands mid-sentence and reads as nonsense:

> Geben Sie ja, diese Löschung speichern zur Bestätigung ein

**Design.**

1. **Delimit the phrase** with typographic quotes in both locales. EN `Type “{0}” to confirm`;
   DE `Geben Sie „{0}“ zur Bestätigung ein`. Restructuring the German is not available — *ein*
   must stay final — so delimiting is the fix, not a cosmetic preference.
2. **Mismatch feedback.** New EN/DE key pair. Rendered when the field has been BLURRED and does
   not match. Wired with `aria-invalid` on the input and `aria-describedby` pointing at the
   message, inside an `aria-live="polite"` region.
   ★ Blur-gated deliberately. An error rendered on every keystroke makes a screen reader narrate
   a failure per character while the user is still typing a 30-character phrase. Polite-live plus
   blur-gating announces once, when the user has actually finished.
3. **`.trim()` the comparison.** Copy-paste from the prompt picks up a trailing space and the
   button stays dead with no explanation — the same silent-failure shape as the missing feedback.
   ★ Do NOT case-fold. That lowers a deliberate barrier on a destructive action, and every phrase
   in the app is already lowercase, so it would buy nothing.

**Tests.** `type-to-confirm-dialog.test.tsx` has exactly 3 tests today, none touching feedback or
localisation. Add: message appears only after blur; `aria-invalid`/`aria-describedby` are wired; a
trailing space still matches; a case difference does NOT match — that last one pins the deliberate
choice, so a later "helpful" case-fold goes red.

---

## Unit 2 — the three English confirm phrases (§301)

**Defect, measured.** Exactly 6 `confirmValue=` sites. Two pass an entity NAME
(`project-empty-state.tsx`, `projects-panel.tsx`) and are correctly untranslated. One is already
localised (`notifications.tsx`). Three are English:

| Site | Value today |
|---|---|
| `settings-sections/general-section.tsx` | `RESET_CONFIRM_PHRASE` = `"yes, reset everything"` |
| `tasks-section.tsx` (clear all) | `CLEAR_TASKS_CONFIRM_PHRASE` = `"yes, clear all tasks"` |
| `tasks-section.tsx` (bulk delete) | a template literal built at render from `selectedIds.size` |

**Design.** The first two become i18n keys — mechanical, since they are already fixed module
constants.

The third is the design decision the roadmap flagged, and it is NOT fixable by a string swap: it
interpolates a live count into a phrase the user must type character-for-character. German needs
plural agreement (*Aufgabe* / *Aufgaben*) and different word order, which a positional placeholder
inside a must-match-exactly string cannot express safely; and the count can change under the user
mid-type, silently invalidating what they have already typed.

**Decision (user's call, taken 2026-08-31): the typed phrase carries no number.** It becomes a
fixed localisable string — EN `yes, delete the selected tasks`, DE `ja, ausgewählte Aufgaben
löschen`. The count stays visible in `tasksDeleteSelectedDialogMessage`, which already
interpolates it.

★ The trade accepted: the user reads the magnitude instead of transcribing it. Transcription is
the stronger deliberateness gate, and it is being given up on purpose — because today a German
user must type an English sentence, which is a worse barrier and an accidental one.

★★ This CHANGES STRINGS USERS TYPE. Every test and e2e spec that types an old phrase must move
with it. Enumerate them rather than assuming; the voice `clearAll` command also routes to this
dialog and its path must be re-checked.

---

## Unit 3 — storage readiness spoken to AT (§302)

**Defect, measured.** In `sidebar-footer.tsx` both the readiness dot and the trailing ⚠ shape
marker are `aria-hidden`, and the paragraph's only other content is the storage description.
`use-storage-backend.ts` calls `isReady()` and `describe()` separately and only `describe()`'s
result reaches the footer. So a screen-reader user hears the backend NAME and nothing about
readiness, in either state.

`SavingPausedButton` is the one spoken disclosure and renders only when saving is paused, so it
does not cover a plain not-ready backend.

**Design.** Thread `ready` through to the footer and render an sr-only readiness sentence beside
the description. New EN/DE key pair for the two states.

★ The dot and the ⚠ stay `aria-hidden`. Once the state is spoken they are decorative, and
exposing both would announce the same fact three times.

★ §302 is reachable from slice 3 AND slice 7. Closing it here means slice 7 must not re-close it —
record that in the entry, not only here.

---

## Unit 4 — the double forensic write (§303)

**Defect, measured.** In `use-storage-backend.ts`, `recordDataLossEvent` fires unconditionally
whenever the verdict refuses, BEFORE the `if (!refusalWasStanding)` check that gates the toast.
The effect's dependency array includes the refusal, so a refusal whose identity is re-minted
re-runs the effect and records again.

**★★★ The obvious fix is wrong.** Moving the write inside the `!refusalWasStanding` guard would
suppress a genuinely SECOND event. Two cases share the predicate and need opposite treatment:

- **Case A — duplicate.** Baseline and counts unchanged from the standing refusal. `evaluate()`
  computes the same shape, `sameRefusal` is true, the existing object is kept. Recording again is
  the §303 bug.
- **Case B — a second real event.** The user deletes further while paused, so the magnitude is now
  WORSE. `sameRefusal` is false and a fresh object is set. Forensics should capture this
  separately.

`refusalWasStanding` says only "was some refusal up" — it cannot tell A from B, so gating on it
loses Case B.

**Design.** The discriminator ALREADY EXISTS and is thrown away: `evaluate()` computes
`sameRefusal(cur, next)` internally to decide whether to mint a new object. Expose it on the
verdict and gate the forensic write on THAT.

★ Why this is worth doing rather than tolerating: the diagnostic log is capped, and `capRing`
evicts `info`-level entries first. A refusal write is `warn`-level, so duplicates are NOT
preferentially evicted — they compete with, and evict, real diagnostic history. A duplicate-write
bug against a small cap destroys the record it exists to preserve.

**Tests.** Case A (duplicate suppressed) and Case B (worse magnitude still recorded). ★ Case B is
currently unpinned in EITHER direction, so the Case B test is new coverage, not a regression pin —
it must be shown to fail against the unfixed code, or it proves nothing.

★ Changing the verdict's shape touches every consumer. Enumerate them before editing.

---

## Unit 5 — §307, rewritten and closed

**Finding.** §307 says no e2e can stage a refusal. That is TRUE, and it is not a gap.

The predicate is `(fullWipe || massDelete) && !allowDestructive`, and every legitimate bulk path
arms. A refusal therefore fires only on data loss that nothing in the app explains. An e2e could
only stage one by manufacturing corruption.

**Design.** Cover the refusal and its recourse at unit level, where it is already reachable
(`notifications.test.tsx` pins both confirm tiers today). Rewrite §307's body to record WHY the
path is not e2e-stageable, and close it as not-a-defect.

★ Honest residual, stated in the entry rather than hidden: the recourse path is still never
observed in a real browser, so a prod-only CSP- or focus-class defect in it would not be caught
here. That blind spot is real; it is accepted rather than papered over.

★ Rejected: a dev-only injector global. A global that forces a destructive-save state is a
security surface, the NODE_ENV strip would have to be PROVEN rather than assumed, and a hook
stripped in prod means the e2e exercises a path users never run.

---

## Unit 6 — §323, filed and not fixed

`use-task-row-handlers.ts`'s `onDelete` never calls `allowDestructiveSave`, while every other
entity's single-item delete arms unconditionally.

**Why filed rather than fixed.** It cannot be reached: a probe found exactly two callers, both
single-id and never looped, so it cannot cross the mass-delete floor (≥5 removed in ONE commit,
each confirmed delete being its own evaluate/baseline cycle). And not-arming is the SAFER side —
arming SUPPRESSES the guard. "Completing the pattern" here would weaken a safety check to buy
consistency.

★ §323 is minted on this branch. A number is only reserved once it is on `origin/main`; a peer
holds §324 for a separate finding. Re-check both on merge.

---

## Testing strategy

Unit tests only; no new e2e (Unit 5). Every behaviour above gets a test shown to FAIL against the
unfixed code — a test written after the fix, never seen red, pins nothing.

Gates: `npx tsc --noEmit` (enforces EN/DE key parity), `npm run lint`, targeted vitest per unit,
then the full unit suite and `npm run test:shuffle` before release. Axe is NOT a detector for
anything in this slice.

## Landmines

★★★ **`src/app/i18n.de.ts` must not be touched with the Edit tool.** It is CRLF with real umlauts;
the editor corrupts umlauts and curls quotes. Patch it with an anchored node utf8 write matching
`\r\n`, then verify by code point.

★★ The `i18n-encoding` test BANS ASCII substitutions (fuer/druecken) AND `\u00XX` escapes. The
German strings and the typographic quotes must be written as real characters.

★★ EN/DE key parity is tsc-enforced, so a key added to one file and not the other fails the build,
not a test.

★ Register closure is a FOUR-place edit — heading marker, summary-table STATUS cell, summary-table
ANCHOR, and the `**Status:**` witness — plus every cross-reference elsewhere in the file, because
anchors change when a heading does. An OPEN entry's Status line must never contain the word CLOSED.

★★ Do NOT run the register's own index-rebuild recipe. It claims idempotence, derives the State
cell from the heading alone, and silently destroys hand-written parentheticals. Filed as §319.

★ `docs/superpowers/` is EXCLUDED from `doc-claims-check`, so this file's citations are ungated.
That is a reason to cite symbols rather than line numbers, not a licence not to.

## Release

Release is a SEPARATE, FINAL step and happens ONLY on the user's explicit say-so. Merge only after
a green pipeline; never `--auto-merge` (`glab mr merge` defaults it to true — pass `=false`).
