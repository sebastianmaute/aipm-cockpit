# Tooltip inventory

Snapshot taken 2026-08-07, on `176b823a` (branch `feat/ui-batch-slice-2`, Tasks 1–12 committed).

★★ An earlier revision cited `2d31abe5` here. **That object is NOT in the branch** — `git merge-base
--is-ancestor 2d31abe5 HEAD` exits 1. It is a dangling pre-amend duplicate of `176b823a` (identical
tree `908e56cf3d2a…`, identical parent) left behind when that commit's message was rewritten; it
resolves in the authoring clone until gc and nowhere else. Amending a commit invalidates every sha
already written into prose — check the citations after any amend.

## Re-measured 2026-08-21, on `6c4e4162` (0.253.0)

★★ **The snapshot below is NOT rewritten.** It is a dated audit of `176b823a`, including its
retractions, and renumbering it to today's tree destroys the record of how it failed. This section
records what the same scan finds now. **The Class A/B batch shipped and it holds** — nothing that
was fixed has regressed — but the open surface has been refilled by work that landed since.

### The scan, re-run unchanged

The script under "Reproduce" was extracted from this file verbatim and executed. No edits.

| measure | snapshot (2026-08-07) | today (2026-08-21) |
|---|---|---|
| button-family elements scanned | 573 | **621** |
| …carrying a `title=` | 142 | **178** |
| **icon/glyph-only** elements | 87 | **100** |
| …with `title=` — covered | 49 | **70** |
| …**without** `title=` — the classification surface | 38 | **30** |
| …**without any name prop** | 16 | **20** |

Plain greps from "Baseline": `title=` occurrences **388 → 438**; `<InfoTooltip` mounts
**147 → 147** (unmoved); files containing an `aria-label` **190 → 208**.

★★ **Titled coverage rose 49→70 out of a population that grew 87→100, and the untitled surface
fell 38→30.** That is the batch landing and staying landed. The rise in "without any name prop"
(16→20) is **not** a regression — see the decomposition below; all four new members are comment
prose.

### The 30 decompose exactly, and 8 of them are new Class A rows

| bucket | snapshot | today |
|---|---|---|
| comment prose (a `<button` written inside a comment) | 13 | **17** |
| a primitive's own internals | 2 | **2** |
| **real controls to classify** | 23 | **11** |

★ **The 17 / 2 / 11 sums to 30**, and the 17 + 2 + 1 name defect sums to the 20 unnamed — same
arithmetic the snapshot used, still checkable. The four new comment-prose lines are
`document-editor.tsx`, and `drag-handle.tsx` ×3; each was opened and each is a docstring
discussing native `<button>` semantics, not markup.

★★ **The real-control count fell 23 → 11: 21 of the original 23 were fixed, and 9 further sites
are reported today — 8 of them real rows and 1 a known scan phantom.**
The two that remain from the original 23 are exactly the two the snapshot left open on purpose:
**B1** (`settings-menu.tsx`, held pending the modern shell's own route to Settings) and the
**blocked-on-i18n** row (`stakeholder-recipient-input.tsx`, still a hardcoded English
``aria-label={`Remove ${name}`}``, still needing translation before it can be Class A).

The nine new ones, each opened and read at its site:

| Control | File | Existing accessible name | Class |
|---|---|---|---|
| Rename thread · Delete thread | `chat-thread-list.tsx` (×2) | `label={renameLabel}` · `label={t(lang, "chatThreadDelete", name)}` | **A** — verb + row-unique object |
| Move item up · down · Remove item | `document-block-editors.tsx` (×3) | ``aria-label={qualify(t(lang, "documentsMoveItemUp", …))}`` and peers | **A** — verb + object + index |
| Remove column · Remove row | `document-table-editor.tsx` (×2) | ``aria-label={qualify(t(lang, "documentsRemoveColumn", …))}`` and peer | **A** — verb + object + index |
| Block actions menu | `document-block-gutter.tsx` | `aria-label={rowName("documentsBlockActions")}` | **B, borderline** — see below |
| Restore version | `documents-history-modal.tsx` | — | **NOT A ROW** — see below |

★★ **The gutter's actions trigger goes to B, not A, and the precedent is B2 in this document.**
"Block actions" names a **container**, not an outcome, exactly as "More actions" does — and B2 was
demoted for that reason after being called the strongest candidate for reclassification. Applying
the rule the other way here would be the failure mode the Class section warns about: once the
mechanical fix ships, nobody reopens the row. ★ The other eight are clean Class A — the fix at
each is `title={<the same expression>}`, zero new strings, and every one of them sits beside a
control that already has one.

★★★ **`documents-history-modal.tsx`'s Restore button is the KNOWN scan false positive, and it has
recurred in the same file for the same reason.** The ★★★ under "Reproduce" measured this on
2026-08-08: an apostrophe inside a `//` comment **inside a JSX opening tag** opens a string the
scanner never closes, so it runs past the tag's `>` and swallows what follows. The offending
apostrophe today is in "workspace-context's", inside that button's own attribute block. The
control renders `{t(lang, "documentsRestore")}` as **visible text** — it is neither icon-only nor
untitled, and it is not a row. ★★ The warning predicted this would recur and it did, in the file
it was measured on. **Open the file before opening a row.**

### Still open, unchanged

- **name defect — 1 row.** `workspace-section-chrome.tsx`'s collapse/expand control still takes
  its accessible name from `title` alone, with no `aria-label`. The scan still reports it as the
  single element that is `hasTitle=true, named=false`. `title` is still never the fix; add an
  `aria-label` carrying the same expression and keep the `title`.
- **B1**, held for the reason stated in the snapshot.
- **The blocked-on-i18n row**, which needs translating before it becomes a plain Class A.
- **The 15 hardcoded-English accessible names** — `docs/open-followups.md` §109 still carries them
  and is still open.

### ★★★ The non-BMP grep warning in this file is too narrow, and the correction matters here

The warning under "Reproduce" says to keep **non-BMP** characters out of any grep attached to a
number. Measured today, the real rule is wider: in this environment (**GNU grep 3.0**,
`LC_CTYPE=C.UTF-8`, `LANG` unset) a bracket expression containing **any** multibyte character
degrades to matching individual **bytes**, so a class of purely BMP glyphs over-matches too:

```bash
S='em-dash \342\200\224\nen-dash \342\200\223\narrow \342\206\222\nascii\nstar \342\230\205\n'
printf "$S" | grep -nE '[★]'   # prints lines 1, 2, 3 AND 5 — four hits for a ONE-member class
printf "$S" | grep -nF '★'     # prints line 5 alone, which is correct
```

★ Nothing in **this** document is affected — its counts come from the node script, and `residue()`
is a JavaScript regex, which is not subject to this. It matters because this file's warning is
what a reader carries away, and `docs/handrolled-ui-inventory.md` — whose Part 2 totals **are**
built from bracket expressions — is broken by it today. That file's own re-measurement section
carries the detail and the node replacement.

### One census corrected

The closing section says `docs:symbols:check` "reported 9 doc(s)" and "reports 10 since main's
`docs/AGENTS/documents.md` merged". It reports **12** today (`AGENTS.md` plus eleven files in
`docs/AGENTS/`), which is the point that sentence was making: the figure is a census of a glob and
moves whenever anyone adds a subsystem doc. Read it off the gate's own summary line, and note the
substance is unchanged — **this file is still not in that glob**, so a green run says nothing
about any name in it.

---

## Status — updated 2026-08-07, after implementation

| Bucket | State |
|---|---|
| **Class A** — 19 rows | ✅ **ALL 19 IMPLEMENTED** (`1414b1c0`). 3 of 19 pinned by a test; the other 16 carry no assertion. |
| **Class B** — 14 rows | ✅ **13 IMPLEMENTED** (`4ea09b7c`), user-approved at row level. ⏸ **B1 HELD** — see below. |
| **keep** | unchanged, by design |
| **name defect** — 1 row | ❌ **OPEN** — `workspace-section-chrome.tsx`, needs `aria-label`, not a `title`. |
| **blocked on i18n** — 1 row | ❌ **OPEN** — `stakeholder-recipient-input.tsx`; translate first. |
| 15 hardcoded-English names | ❌ **OPEN** — adjacent finding, tracked in `docs/open-followups.md` §109 (filed as §103). |

★★ **B1 (settings cog) is the ONE Class B row still open**, held deliberately: that control renders
in the **classic** header only, outside the `ActionMenus` element `buildShellChrome` feeds the modern
shell's `topBarMenus` slot — and modern is the default layout. Establish the modern shell's own route
to Settings before wording its copy; the answer may be that a tooltip is not the finding there.

★★ **Implementation found something this document did not, and it changes how B5–B9 must be tested.**
`ToggleButton` **composes** the title: `[title, stateText].filter(Boolean).join(" · ") || undefined`. So those five render
`"<hint> · Currently on — click to turn off"`, **not** the bare hint. An equality assertion on them
fails; use `toContain`. The five also now announce hint *and* state on focus — existing primitive
behaviour, but five more controls joined it.

★★★ **RETRACTED — an earlier revision of this line was false, and it invented a defect.** It claimed
"twelve of the nineteen Class A lines were low by 2–6" and that `removable-chip-row`'s "pointed at the
component signature rather than the `aria-label`". Measured against `176b823a`: **all nineteen Class A
line numbers point exactly at their control's opening tag, and none drifted.** `removable-chip-row.tsx`
`:21` is the signature, `:25` is the `<button`, `:28` is the `aria-label` — the cited `:25` is correct
and ordinary. The "low by 2–6" figure was measuring the distance from the opening tag *down to the name
prop*, i.e. a different anchor convention, not an error. Seven of the nineteen have the name on the tag
line itself, which is why they looked exact.

★★ The retraction matters more than the numbers: the false version was then used to draw a standing
lesson ("cite the symbol, not the line") from a defect that did not exist. A rule justified by a
fabricated example is worse than no rule — the next reader distrusts nineteen correct citations. Cite
the symbol where a line genuinely rots; do not cite this as the reason.

★ Two lines HAVE since drifted, by +1, because an earlier row in the same file gained a `title`:
`history-panel.tsx:364` and `roles-editor.tsx:416`. That is real, small, and the opposite direction
from what the retracted claim described.

## Corrections to this branch's commit messages

★★★ These four claims live ONLY in commit messages — no tracked doc repeats them, and every count in
this file and in `docs/open-followups.md` §109/§110 (filed as §103/§104 — renumbered twice, since
main took 103/104 at the first merge and 105–108 at the second) was independently re-measured and reproduced
exactly. Recorded here because a commit message cannot be edited once it is an ancestor, and because
two of the four sit inside the RETRACTION above: **a correction is not self-verifying, and this branch
has now produced a wrong replacement figure twice.**

★★ **`6265b549` — FALSE.** It says `p-1` "is present pre-change as a substring of `px-2`/`py-0.5`".
Neither string contains `p-1`; the whole pre-change file contains no `p-1` at all (`gap-1` at `:75` is
the only near hit, and it does not contain it either). The *decision* it justifies is right for a
reason that is actually true: `p-1` is a substring of **`p-1.5`**, so an unbounded `p-1` assertion
would survive a move to `size="md"` — the very change the same commit makes to a sibling. The
load-bearing half is TRUE and was verified: `cursor-pointer` discriminates because `INTERACTIVE`
genuinely does not contain it. The surviving code comment (`dashboard-tip-card.test.tsx`) says only
"size-coupled" and does NOT repeat the false claim.

★★ **`36811ceb` — wrong under BOTH conventions.** "783 → 452" mixes two measures. The gate's own
metric (`readFileSync(f,"utf8").split("\n").length`, `scripts/check-file-sizes.mjs:21`) is
**783 → 453**; `wc -l` is 782 → 452. The stated pair is the one combination that is wrong either way.
"17 lines of headroom" is correct under the gate metric (800 − 783). ★ Do NOT phrase this as what the
gate *prints*: `size:check` emits a line only for a file OVER 800, so it prints nothing for this file
at any of these sizes. Cite the metric, not the command.

★★ **`c4dc67a4` — two problems inside the retraction itself.** "376 raw occurrences" mislabels the
measure: 376 is the WORD-BOUNDED count (`\bSie\b`); genuinely raw (`grep -o "Sie"`) is **379**. And
"not reproducible under any measure" is stronger than the evidence — **217** lines contain `\bSie\b`
at that revision, within 2 of the retracted 215 and the most likely origin of it. The correct claim is
narrower: no measure yields exactly 215. ★ "193 including Ihr/Ihre" could not be reproduced under any
measure tried (the `Sie|Ihr|Ihre|Ihren|Ihrem|Ihrer|Ihres` family gives 209 key-prefixed lines, 272 all
lines, 504 occurrences); whatever produced 193 is unrecorded. ★ Its "165 standalone" figure DOES
reproduce exactly, as does every other claim in that commit.

★★ **`dfdd0ea4` — FALSE, and it contradicts an earlier commit on this same branch.** It calls
`timelog-people-table` "the one conversion in the batch with no variant assertion". It is one of
**three**: `saved-views-menu` and `version-info` have no test file at all. `176b823a` stated this
correctly ("three of the 23 ship without a test"); `dfdd0ea4` narrowed it to one while adding the test
that closes exactly one of the three. **Two remain unpinned.** ★ Same commit, attribution slip: "the
commit that introduced it REPLACED the comment documenting the pairing requirement" names the wrong
commit — `176b823a` introduced the 4px split AND wrote the pairing comment; `6265b549` is the commit
that deleted it. The substance (the comment was removed while the pairing was broken) is TRUE.

★ **The merge commit is deliberately NOT listed here.** A fact-check of it found the same defect twice
more — "~30 source files" where the command returns 36 LINES across 18 FILES, and a "4 more" that read
as 4 additional files when 4 of the same 19 had starved again. Both were caught while the merge was
still unpushed and cited by nothing, so both were fixed IN the message by amending. Recording a
correction for a claim that no longer exists anywhere would make this section itself false. ★★ The
lesson still counts, and it is the third instance on this branch: a reproduce command was attached to
a number without being run. **The failure is not arithmetic — it is attaching evidence as decoration,
and it happens when the number supports a conclusion that is already correct.**

Scope: all of `src/app`, `*.tsx`, excluding `*.test.tsx`. The classification surface is the
**icon-only and glyph-only** controls — the ones a hover tooltip is actually for. A control with a
readable text label already tells a mouse user what it does; a bare `✕` or a cog does not.

★★ **Every row below was opened and read at its line.** The plan's candidate generator produced 26
rows; it is a *candidate generator, not the answer*, and it was wrong in both directions — see
"Where the generator failed" at the foot. The row set here comes from a full element scan (script
embedded below) whose no-`title` half was then read by hand, one file at a time.

---

## Baseline — reproduce, do not trust

Attribute-level, greppable:

```bash
grep -rho 'title=' src/app --include=*.tsx --exclude="*.test.tsx" | wc -l          # 388
grep -rho "<InfoTooltip" src/app --include=*.tsx --exclude="*.test.tsx" | wc -l    # 147
grep -rl "aria-label" src/app --include=*.tsx | grep -v "\.test\.tsx" | wc -l      # 190
```

| measure | this run (2026-08-07, `176b823a`) |
|---|---|
| `title=` occurrences, non-test `.tsx` | **388** |
| `<InfoTooltip` mounts, non-test `.tsx` | **147** |
| files containing an `aria-label` | **190** |

★★ Those three are **not** the denominator for this audit and must not be quoted as one. `title=` at
388 counts every element — `<span title>`, `<Input title>`, a `title` prop on `ToggleButton` and
`SegmentedControl` — not just buttons. The audit's denominator is element-level and needs a parser,
because an opening tag spans many lines and a `className` can contain a `>`.

Element-level, from the script in "Reproduce" below:

| measure | count |
|---|---|
| button-family elements scanned (`<button` · `<Button` · `<IconButton` · `<ToggleButton`) | **573** |
| …of those, carrying a `title=` | **142** |
| **icon/glyph-only** elements | **87** |
| …with `title=` — already covered | **49** |
| …**without** `title=` — the classification surface | **38** |
| …of the 38, comment prose (13) + a primitive's own internals (2) | **15** |
| **real controls to classify** | **23** |

★ The 15 subtracted are named individually in "The 15 non-sites" so the subtraction is checkable.
This mirrors `docs/handrolled-ui-inventory.md`'s 341 → 311 arithmetic and hits the same trap: a
`<button>` written inside a comment scans identically to one written in JSX.

---

## Classes

| Class | Meaning | Approval |
|---|---|---|
| **A** | Icon-only control whose existing accessible name genuinely names the **consequence**, and which has no `title`. Fix: `title={<the same existing expression>}`. Zero new strings. | none — mechanical |
| **B** | The name or visible label does **not** name the consequence — a bare noun, a bare verb with no object, or a state. Needs NEW EN+DE text. | required, row by row |
| **keep** | Neither applies. Carries a reason. | — |
| **name defect** | No `aria-label`/`label` at all. `title` is **never** the fix — it is hover-only: no keyboard focus, unreachable on touch. | filed separately |

★★★ **The A/B line is the whole deliverable.** A row is Class A only if the label names the
consequence. Copying a bare noun ("Settings") into a `title` produces the *appearance* of coverage
and delivers nothing — and once the mechanical fix has shipped, nobody re-opens the row. Where the
call was close, it went to **B**; every such call is listed in "Borderline calls" so the demotion is
visible rather than smoothed over.

★ `title` is a **supplement**, never the accessible name. All three primitives forward it: `Button`
and `IconButton` spread `...props` onto the underlying `<button>` (`button.tsx:62`,
`icon-button.tsx:70`), so `title` needs no primitive change.

★★ **Class A's fix is not a new idea — it is already the house pattern, in a shared component.**
`ResetSizeButton` (`task-manager-ui.tsx:189`) renders

```tsx
    <IconButton … label={t(lang, labelKey)} title={t(lang, labelKey)} …>
```

— label and title from the same expression, exactly what Class A proposes. Every Class A row is a
control that sits *beside* one of these and did not get the same treatment. Two of them (A3, A9) are
literally adjacent to a `ResetSizeButton` in the same header. That is the argument for the batch:
it removes an inconsistency, it does not introduce a convention.

---

## Tally

| Class | rows | sites |
|---|---|---|
| **A** | 19 | 19 |
| **A, blocked on i18n** | 1 | 1 |
| **B** | 14 | 16 |
| **keep** | 4 named + 1 family (~120 sites) | — |
| **name defect** | 1 | 1 |

★ **These do not sum to one population, and here is exactly how they decompose** — an unexplained
tally is how an audit starts looking complete:

- The **23 real controls** (icon-only, no `title`) split **19 A + 3 B (B1 · B2 · B3) + 1
  blocked-A** (`stakeholder-recipient-input.tsx:154`). That accounts for all 23.
- **B4** is icon-only-*adjacent* — its visible child is a `+` or a single letter — so it is outside
  the 23.
- **B5–B14** (10 rows / 12 sites — B10 and B11 are 2 sites each) are visible-label controls from a
  separate, explicitly scoped sweep; none is in the 23.
- The **name defect** is **not** in the 23 either: it already has a `title`, so it sits in the 49.
- The **keep** family (~120 modal-footer verbs) overlaps nothing above.

---

## Class A — 19 rows, mechanical, no new strings

Fix at every row: add `title={…}` carrying the **same expression already in the accessible name**.
Where the name is a template literal or a prop, the `title` takes that same value — there is no key
to reuse and inventing one would make the row Class B.

| # | Control | File:line | Surface | Existing accessible name (verbatim) | Resolves to (EN) | Reason it is A |
|---|---|---|---|---|---|---|
| A1 | AI-analysis dismiss | `actions-panel.tsx:156` | Next actions | `label={t(lang, "actionAiDismiss")}` | "Dismiss AI suggestions" | Verb + object. Says exactly what the ✕ removes — the suggestion block, not the panel. |
| A2 | Combobox open | `combobox-shared.tsx:76` | every combobox | `aria-label={t(lang, "comboToggle")}` | "Show options" | Verb + object. ★ `tabIndex={-1}` — the input owns the keyboard, so this control is **mouse-only** and a hover title is the only affordance it can have. |
| A3 | Help-panel close | `help-menu.tsx:140` | Help (floating) | `label={t(lang, "close")}` | "Close" | Closes the panel it sits in. The header beside it (`ResetSizeButton`) already carries a title, so this is the odd one out in its own cluster. |
| A4 | Cancel snapshot name | `history-panel.tsx:236` | Version history | `aria-label={t(lang, "cancel")}` | "Cancel" | Abandons the save-snapshot form it sits in. Bare `×` glyph, no icon. |
| A5 | Close diff view | `history-panel.tsx:364` | Version history | `aria-label={t(lang, "alertModalClose")}` | "Close" | Clears the whole comparison state. Bare `×` glyph. |
| A6 | Inline-AI cancel | `inline-ai-edit-popover.tsx:51` | inline AI edit | `label={t(lang, "cancel")}` | "Cancel" | Closes the popover without applying. The dialog is labelled `inlineAiEdit`, so the pairing reads. |
| A7 | Remove document link | `knowledge-links-field.tsx:60` | Knowledge / link fields | `label={t(lang, "documentsRemove")}` | "Remove link" | Verb + object, and the sibling `<a>` already carries `documentsOpen`. |
| A8 | Remove label chip | `labels-input.tsx:115` | task form | ``aria-label={`${t(lang, "remove")} ${label}`}`` | "Remove urgent" | Verb + the row-unique object. |
| A9 | Notes-window close | `notes-window.tsx:104` | Notes (floating) | `label={t(lang, "close")}` | "Close" | Same cluster as A3 — `ResetSizeButton` beside it has a title, this does not. |
| A10 | Import-modal close | `pick-list-import-modal.tsx:66` | Outlook contact / calendar import | `label={cancelLabel}` | "Cancel" (`outlookImportCancel` · `outlookCalImportCancel`) | Prop-driven; both callers pass a translated "Cancel". Fix is `title={cancelLabel}`. |
| A11 | Remove contact person | `project-form-fields.tsx:691` | project form | ``aria-label={`${t(lang, "remove")} ${cp.name}`}`` | "Remove Jane Doe" | Verb + object. Bare `×` glyph. |
| A12 | Remove from RACI filter | `raci-panel.tsx:226` | Stakeholders → RACI | `label={t(lang, "raciFilterRemove", s.name)}` | "Remove Jane Doe from filter" | The most explicit name in the set — it names the object *and* the scope. |
| A13 | Remove email row | `resource-edit-modal.tsx:294` | resource editor | ``label={`${t(lang, "resourceEmailRemove")} ${i + 1}`}`` | "Remove email 2" | Verb + object + row index. |
| A14 | Delete role | `roles-editor.tsx:300` | Settings → roles | ``label={`${t(lang, "delete")} – ${rowCtx}`}`` | "Delete – Architect · Senior" | Verb + row-unique object. |
| A15 | Delete discipline/grade | `roles-editor.tsx:400` | Settings → roles | ``label={`${t(lang, "delete")} – ${it.name}`}`` | "Delete – Backend" | Same shape as A14, second list. |
| A16 | Add discipline/grade | `roles-editor.tsx:416` | Settings → roles | `aria-label={addPlaceholder}` | "Add discipline" · "Add grade" (`rolesAddDiscipline` · `rolesAddGrade`) | ★ A `Button` whose only visible child is `+`, so it is icon-only in effect. Verb + object. Fix is `title={addPlaceholder}`. |
| A17 | Remove chip row | `settings-sections/removable-chip-row.tsx:25` | Settings → Localization · Timezones | `aria-label={ariaLabel}` | "Remove Germany" · "Remove – Europe/Berlin" (`remove` · `tzRemoveLabel`) | Both callers build verb + row object. Fix is `title={ariaLabel}` in the shared component — one edit, two surfaces. |
| A18 | Remove timelog user | `timelog-people-table.tsx:144` | Time bookings | `label={removeLabel}` | "Remove – jdoe" | Local const at `:84`, verb + object. Fix is `title={removeLabel}`. |
| A19 | Version-modal close | `version-info.tsx:37` | About / version modal | `label={t(lang, "alertModalClose")}` | "Close" | Closes the modal it heads. ★ **Unpinned** — `version-info.test.tsx` does not exist and `grep -rln "VersionInfoModal" src/app e2e` returns only `modern-shell.tsx`, `settings-view.tsx` and the file itself, so **no test anywhere renders this modal**. Task 11 recorded the same gap for the conversion; do not let a green suite imply this row is covered. |

★ **`stakeholder-recipient-input.tsx:154` would be A20 and is deliberately NOT listed as Class A.**
Its name is a **hardcoded English** template — ``aria-label={`Remove ${name}`}`` — not `t(lang, …)`.
The shape qualifies, but copying an untranslated string into a `title` doubles a bug rather than
fixing it. It sits under "Untranslated accessible names" below and must be translated first; after
that it is a plain Class A row.

---

## Class B — 14 rows / 16 sites, needs new EN+DE text and approval

Proposed EN is a **proposal**. DE is written at approval time, via the node utf8 write
(`i18n.de.ts` is CRLF and the Edit tool corrupts umlauts there).

### B(i) — demoted from Class A: icon-only, but the name is a bare noun, a bare verb, or a state

| # | Control | File:line | Surface | Existing accessible name | Resolves to | Proposed EN | Why not A |
|---|---|---|---|---|---|---|---|
| B1 | App settings | `settings-menu.tsx:59` | classic `AppHeader` only — see ★ | `aria-label={t(lang, "settings")}` | **"Settings"** | "Open settings — appearance, storage, integrations and AI" | The canonical bare noun. A cog whose tooltip says "Settings" tells a user nothing they did not already get from the cog. |
| B2 | Overflow menu | `action-cta-controls.tsx:141` | Next actions row + hero | ``aria-label={`${t(lang, "actionMoreActions")} – ${title}`}`` | "More actions – <action>" | "More ways to act on this item" | "More actions" names a *container*, not an outcome. ★ **Borderline** — see below. |
| B3 | Clear RACI role | `raci-chip-picker.tsx:120` | Stakeholders → RACI grid | `aria-label={t(lang, "raciClear")}` | **"Clear"** | "Clear this stakeholder's RACI role for this milestone" | Bare verb, no object. ★ It is also **not row-unique**: N identical "Clear" names in one grid is a WCAG 2.4.6 problem the axe gate cannot see (it needs several rows rendered). The Class B text fixes readability; the name still wants qualifying. |
| B4 | RACI chip trigger | `raci-chip-picker.tsx:77` | Stakeholders → RACI grid | ``aria-label={`${ariaPrefix} — ${triggerLabel}`}`` | "<milestone> · <stakeholder> — Set RACI" / "— Responsible" | "Set this stakeholder's RACI role for this milestone" | The name is a **location plus current state**, never the consequence. `raciSetLabel` = "Set RACI" is the closest it gets and only in the empty state. |

★ **B1's surface is narrower than "the top bar", and the difference was measured, not assumed.**
`grep -rn "SettingsMenu" src/app --include=*.tsx | grep -v test` returns `app-header.tsx` and the file itself and
nothing else. It renders at `app-header.tsx:149`, **outside** the `ActionMenus` element at `:142` —
and `ActionMenus` is what `buildShellChrome` puts in the modern shell's `topBarMenus` slot
(`shell-chrome.tsx:107`). So this cog is in the **classic** header only, while the modern shell is
the default layout. Not a tooltip finding, but it changes who ever sees the tooltip, and
`AGENTS.md` names "wire BOTH header mounts" as a standing landmine. Worth confirming the modern
shell's own route to Settings before wording B1's copy.

### B(ii) — visible-label controls whose label does not name the consequence

Scoped, not exhaustive. Filter: the visible label is a **bare noun, adjective, or a verb with no
object**, on a control whose effect is not derivable from its surroundings. Drawn by hand from the
198 untitled buttons whose visible label is ≤2 words (command under "Reproduce"); modal-footer verbs
("Save", "Cancel", "Back") are excluded as a family — see "keep".

| # | Control | File:line | Surface | Visible label | Proposed EN | Why |
|---|---|---|---|---|---|---|
| B5 | Dependencies toggle | `gantt-view-menu.tsx:104` | Gantt → View | `ganttShowDependencies` = "Dependencies" | "Draw arrows between dependent tasks" | Bare noun. |
| B6 | Holidays toggle | `gantt-view-menu.tsx:113` | Gantt → View | `ganttShowHolidays` = "Holidays" | "Shade non-working days across the chart" | Bare noun. |
| B7 | Absences toggle | `gantt-view-menu.tsx:122` | Gantt → View | `ganttShowAbsences` = "Absences" | "Shade each assignee's absences on their own row" | Bare noun. |
| B8 | Day-grid toggle | `gantt-view-menu.tsx:131` | Gantt → View | `ganttShowGrid` = "Day grid" | "Draw a dotted rule for every day" | Bare noun. |
| B9 | Milestones toggle | `gantt-view-menu.tsx:165` | Gantt → View | `ganttShowMilestones` = "Milestones" | "Show milestone markers on the chart" | Bare noun. |
| B10 | Acknowledge insight | `insights-panel.tsx:237` · `dashboard-sections/insights-card.tsx:102` | Insights · Dashboard | `insightAcknowledge` = "Acknowledge" | "Mark as seen. It stays in the list and still counts as open." | **Verified against `onAcknowledgeInsight` (`task-manager.tsx` — grep the symbol; `:821` at the time of writing, `:829` after main's merge)**: sets `status: "acknowledged"` + `acknowledgedAt`, and `insights/insight-prompt.ts:9`'s `SURFACED_STATUSES` still includes it (`new Set(["active", "acknowledged"])`) — so "Acknowledge" does *not* mean "done", which is exactly what the label implies. 2 sites. |
| B11 | Act on insight | `insights-panel.tsx:247` · `dashboard-sections/insights-card.tsx:111` | Insights · Dashboard | `insightAct` = "Act" | "Record that you acted, and capture today's metric as the baseline for measuring the outcome" | **Verified against `onActInsight` (`task-manager.tsx` — grep the symbol; `:832` at the time of writing, `:840` after main's merge)**: sets `status: "acted"` + `actedAt` **and** applies `metricAtActionPatch` — first act wins, so the click has a one-shot side effect the word "Act" gives no hint of. 2 sites. |
| B12 | Notes log | `task-form-fields.tsx:632` | task editor (unsaved task) | `noteLogTitle` = "Notes log" | "Open the dated note log for this task" | Bare noun on a button that opens a floating window. |
| B13 | Compare version | `meeting-report-panel.tsx:171` | Reports → meeting report | `reportDiff` = "Compare" | "Show what changed between this saved version and the current report" | Bare verb — compare *to what* is the missing half. Row-unique `aria-label` already carries the date, so only the target is unstated. |
| B14 | Clear narrative | `dashboard-sections/dashboard-narrative.tsx:133` | Dashboard | `dashboardStatusClear` = "Clear" | "Delete the saved status narrative, not just this draft" | **Verified against `clearNarrative` (`:91`)**: it empties the editor **and**, when `storedHtml !== ""`, deletes the stored value. Beside a "Save" button, "Clear" reads as "clear the draft". It is not. |

★★ B5–B9's precedent is already **inside the same file**, which is what makes them cheap and
defensible. `grep -n "<ToggleButton" src/app/gantt-view-menu.tsx` returns **eight** toggles
(`:104 :113 :122 :131 :140 :152 :165 :174`) and
`grep -n 'title={t(lang, "gantt' src/app/gantt-view-menu.tsx` returns titles on **three** of them —
critical path (`:145`, `ganttCriticalPathHint`), baseline (`:156`, `ganttBaselineHint`) and inline
milestone placement (`:181`, `ganttMilestonesInlineHint`). So **three of eight carry a hint and five
do not**, and the split is not by importance — it is by whoever wrote each one. B5–B9 are exactly
the five without. ★ The menu's own trigger already carries `ganttViewMenuHint` at `:86`.

---

## keep — 4 named rows + 1 family, each with a reason

| Control | File:line | Class | Reason |
|---|---|---|---|
| `Button`'s own `<button>` | `button.tsx:62` | keep | A primitive's internal element. It spreads `...props`, so `title` is the **caller's** to pass; hard-coding one here would put the same tooltip on ~200 buttons. |
| `TextButton`'s own `<button>` | `text-button.tsx:44` | keep | Same. |
| `IconButton`'s own `<button>` | `icon-button.tsx:70` | keep | Same, and it is the target of every Class A fix — the whole batch works *through* this element, never on it. |
| Detailed-planning toggle | `budget-bucket-modal.tsx:514` | keep | Visible label `budgetModeDetailed` = "Detailed" is a bare adjective, but the group heading two lines up already renders `<InfoTooltip text={t(lang, "budgetDetailedPlanningHint")} />`. A second tooltip on the control would duplicate it. |
| Modal-footer verbs — "Save" · "Cancel" · "Back" · "Close" · "Add" | the bulk of the 198 short-label sites | keep | A verb inside a labelled dialog takes its object from the dialog. "Cancel" in a modal titled "Edit RAID item" is unambiguous, and a tooltip repeating the dialog title on every footer button is noise. ★ This is a **family** keep — if a specific footer sits in a dialog with no visible title, it leaves the family and becomes B. ★★ "the bulk" is deliberately **not a number**: nobody counted them, and an invented count is the most-rotted claim shape in this repo's docs. The 198 total is measured (command under "Reproduce"); this subset is not. |

### Two sites reported to this audit as gaps — both are tooltip-complete, and only one is a real gap

★★ **`modal-header.tsx`'s two icon buttons (`:77` reset-layout, `:88` close, using `alertModalClose`)
are already `title`-complete.** Read and confirmed 2026-08-07: both carry `aria-label` **and**
`title`. Nothing for this document to do. But they *are* a real gap in
`docs/handrolled-ui-inventory.md`, and the mechanism is worth naming because it will recur: the file
appears there **exactly once**, in the "Distribution" block, listed among the thirteen files whose
`<button` occurrences are counted as **primitive internals and excluded from the offender tally**.
So its two hand-rolled `<button>`s were not missed by a grep — they were *subtracted* as a
primitive's own markup. `ModalHeader` is shared, but these two are hand-rolled chrome that should be
`IconButton`, and being inside a shared component is what hid them. ★ Separately, `:88` lacks the
shared `INTERACTIVE` atom that `:77` has — a focus-ring/transition inconsistency, not a tooltip one.

★★ **`knowledge-panel.tsx:444` and `:510` are already `title`-complete too** — both are
`IconButton variant="danger"` carrying `label` **and** `title={t(lang, "documentsRemove")}`, each
still passing a literal `✕` as its child instead of `XMarkIcon` (the glyph lines are `:451` and
`:517`). ★ **It was reported to this audit as an inventory miss and it is NOT one.**
`docs/handrolled-ui-inventory.md:396` already lists `knowledge-panel.tsx (×2)` at `451, 517` in the
Part 2 `replace` row, beside `roles-editor.tsx (×2)` at `299, 403`. What is true is narrower: it is
absent from **Task 12's** thirteen-file list, which took the twelve-site *IconButton-candidate*
family plus `roles-editor` — not the wider Part 2 glyph row. Glyph work, already inventoried, not
tooltip work.

---

## name defect — 1 row

`title` is **never** the fix for a missing name: it is hover-only, gets no keyboard focus, and is
unreachable on touch.

| Control | File:line | Surface | What it has | Why it is a defect |
|---|---|---|---|---|
| Workspace collapse/expand | `workspace-section-chrome.tsx:165` | workspace pane chrome (every view) | `title={t(lang, workspaceCollapsed ? "workspaceExpand" : "workspaceCollapse")}` · `aria-expanded` · `aria-controls` · an `aria-hidden` `ChevronDownIcon`. **No `aria-label`.** | The accessible name comes **only** from `title` — the last-resort source in the accname algorithm. It is a real name, so this is not "no name at all" and **axe passes it**; but it is the one place in the app where deleting a `title` would delete a control's name outright, which makes the attribute load-bearing in a way no other site here is. Fix: add `aria-label` with the same expression, and keep the `title`. |

★ It is the **only** one. Of the 87 icon-only elements, 16 carry no `aria-label`/`label` prop —
13 are `<button>` written inside a comment, 2 are primitive internals whose name comes from the
caller, and this is the remaining one. Reproduce with the script below (`WITHOUT any name prop`).

---

## Untranslated accessible names — adjacent finding, not a tooltip class

Found while recording the "existing name" column verbatim — **15 sites across 9 files**. These are
the accessible names this document quotes, so they belong here, but the fix is i18n, not tooltips.
`npx tsc --noEmit` enforces EN/DE **key parity** and structurally cannot see a string that never
became a key.

```bash
grep -rn 'aria-label="[A-Za-z]' src/app --include=*.tsx --exclude="*.test.tsx"
grep -rn 'aria-label={`[A-Za-z]' src/app --include=*.tsx --exclude="*.test.tsx"
```

| File:line | Hardcoded English name | Note |
|---|---|---|
| `create-project-wizard.tsx:389` · `:397` | `"Apply Simple preset"` · `"Apply Advanced preset"` | The visible labels beside them *are* translated (`modePresetSimple` · `modePresetAdvanced`), so a German user sees "Einfach" and hears "Apply Simple preset". |
| `settings-sections/mode-section.tsx:80` · `:88` | same two strings | Duplicate of the pair above. |
| `stakeholder-recipient-input.tsx:160` | ``` `Remove ${name}` ``` | Would otherwise be Class A — see the note under Class A. ★ `:154` is the `<button`, `:160` the `aria-label`; both numbers appear in this document and they are the same control. |
| `resource-directory.tsx:84` | ``` `Role for ${…}` ``` | |
| `resources-panel-rows.tsx:156` · `:168` | ``` `Utilization for …` ``` · ``` `Absence override for …` ``` | |
| `task-editor-raid-mini.tsx:59` · `:75` | ``` `RAID ${t(lang, …)}` ``` | Half-translated: the prefix "RAID" is literal, the rest is a key. Arguably fine — "RAID" is a proper noun in the DE UI too. |
| `chat-prompt-chips.tsx:33` · `workspace-section-chrome.tsx:57` · `:191` | `"Suggested prompts"` · `"Workspace tabs"` · `"Workspace sub-tabs"` | Landmark/group names, not controls. |
| `budget-panel-totals.tsx:94` · `:111` | ``` `budget-${ariaPrefix}` ``` · ``` `actual-${ariaPrefix}` ``` | Not English prose — a machine-readable test hook used as an accessible name. Different problem, worse: it is what a screen reader announces for every budget cell. |

---

## The 15 non-sites — why 38 becomes 23

★★ Named individually so the subtraction is checkable, and because the same trap cost
`docs/handrolled-ui-inventory.md` a correction: a `<button>` inside a comment scans exactly like one
in JSX. Each line below was opened and read.

**13 comment prose** — `button.tsx:3` · `button.tsx:43` · `entity-link-picker.tsx:304` ·
`file-picker-button.tsx:14` · `gantt-view-menu.tsx:12` · `info-tooltip.tsx:40` ·
`milestone-edit-modal.tsx:149` · `popover-panel.tsx:120` · `raid-edit-modal.tsx:399` ·
`resource-calendar-band.tsx:218` · `resource-calendar.tsx:222` · `stakeholder-edit-modal.tsx:177` ·
`text-button.tsx:6`.

**2 primitive internals** — `button.tsx:62` · `text-button.tsx:44` (both listed under "keep").

★ `icon-button.tsx:70` is a third primitive internal but does **not** appear in the 38 — or anywhere
in the 87. Its tag is `button` (it *renders* `IconButton`, it is not one) and its child is
`{children}`, so the icon-only filter never selects it. It is listed under "keep" all the same,
because a reader will look for it.

---

## Borderline calls — recorded, not smoothed over

★★ Over-classifying into **A** is the failure mode that cannot be caught later, because the
mechanical fix ships first and nobody re-opens a row that already "has a tooltip". Every close call
therefore went to **B**. These are the ones a reviewer could reasonably overturn:

1. **B2, `action-cta-controls.tsx:141` — the strongest candidate for reclassification to A.**
   "More actions" arguably *is* the consequence: click it, get more actions. Called B because it
   names a container rather than an outcome, and because the menu's contents are conditional
   (`markDone` / `draft` / `createTask` / `snooze` are each gated on a handler being present), so a
   tooltip enumerating them would be false on most rows. If the reviewer prefers A, the fix is
   `title={the same template literal}` and no new string.
2. **B3 / B4, `raci-chip-picker.tsx` — two rows, one control.** The trigger (`:77`) and the clear
   chip (`:120`) are the same widget seen twice, and a reviewer may want one tooltip rather than two.
   Split because they have different consequences and different existing names.
3. **B5–B9, the Gantt View toggles.** These follow the `ToggleButton` contract correctly — the label
   names the state that pressed=true enables, which `AGENTS.md` makes the rule. So the label is not
   *wrong*; it is just uninformative on its own. Called B because two of their siblings in the same
   menu already carry hints, which makes the inconsistency the defect. A reviewer who wants the
   contract to stand alone would make all five **keep**.
4. **The `milestoneAchieved` toggles (`milestone-edit-modal.tsx:235`, `milestones-panel.tsx:508`)
   were considered and went to keep, not B** — same `ToggleButton` contract as B5–B9, but "Achieved"
   on a milestone row has exactly one possible meaning. They are the control case for why B5–B9's
   bare nouns are different: nobody has to ask what "Achieved" toggles.
5. **A4 / A6 / A10 — "Cancel".** A bare verb, which the B rule would normally demote. Kept in A
   because each sits inside a dialog or form whose own visible title supplies the object — the same
   reasoning as the modal-footer keep family. A reviewer who rejects the family keep should demote
   these three with it.

---

## Where the plan's candidate generator failed

The plan's Step 2 script produced **26** rows. It is a candidate generator, and it missed and
over-reported in both directions — which is why every row here was read rather than accepted.

**Its 26 rows break down 4 / 1 / 3 / 1 / 17.** Nine of them are not rows in this document at all:

| Generator row | Why it is not a row here |
|---|---|
| `actions-panel.tsx:150` | `aria-label` is on a `<section>`. The real control is the `IconButton` six lines down (**A1**), which the generator *also* found — so this row is a duplicate as well as a false positive. |
| `inline-ai-edit-popover.tsx:46` | `aria-label` is on the `role="dialog"`. The real control is at `:51` (**A6**), also found. |
| `tasks-section.tsx:741` | `aria-label` is on a `role="dialog"`. The `<button>` that opens it is at `:728` and **already has a `title`**. |
| `gantt-chart.tsx:293` | `aria-label` is on the add-task **row** `<div>`, which renders visible text "Add task". Not a button, not icon-only. |
| `roles-editor.tsx:414` | An `<input>`, not a control this audit covers. |
| `calendar-chip.tsx` `CalendarChip` · `raid-panel-rows.tsx` `raidAddItem` add-row button · `tasks-section.tsx` `addTask` add-row button | Real buttons, but each renders **visible text** beside its icon. Not icon-only. |
| `icon-button.tsx:70` | The `IconButton` primitive's own element — listed under "keep". |

**Six real rows it missed**, and the reason is the same in five of them: its filter *requires*
`/Icon\b|IconButton/` in the window, so a control whose glyph is a literal character rather than a
heroicon component is invisible to it.

| Missed row | Why |
|---|---|
| `action-cta-controls.tsx:141` (**B2**) | Child is a literal `⋮`. No `Icon` token in the window. |
| `history-panel.tsx:236` (**A4**) · `:364` (**A5**) | Children are a literal `×`. Same cause. |
| `project-form-fields.tsx:691` (**A11**) | Child is a literal `×`. Same cause. |
| `roles-editor.tsx:416` (**A16**) | Child is a literal `+`, and the nearest `</IconButton>` at `:408` falls just outside the −6-line window. |
| `roles-editor.tsx:300` (**A14**) | The **opposite** failure: a real `IconButton`, but `title={t(lang, "rolesRateBasisHint")}` at `:296` sits inside the −6 window, so the `!/title=/` test rejects it. A `title` on a *neighbouring* control suppresses the row. |

★★★ And the one thing it structurally cannot find: `workspace-section-chrome.tsx:165`, the single
**name defect** in the app. It has no `aria-label=` and no `label={`, so the generator's entry
condition never fires. **A generator keyed on the presence of a name can never find a missing one** —
which is why the name-defect bucket had to come from a scan of the element population, not from the
candidate list.

★ Arithmetic: 26 = 4 false positives + 1 `<input>` + 3 visible-text buttons + 1 primitive internal +
**17 real rows**; and 17 + 6 missed = **23**, this document's real-control count.

---

## Reproduce

Every count above that is not a plain `grep` comes from this script. It is read-only; run it from the
repo root.

```js
// tooltip-scan.js — reproduces every derived count in docs/tooltip-inventory.md
const fs = require("fs"), path = require("path");

function walk(d, out = []) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith(".tsx") && !e.name.endsWith(".test.tsx")) out.push(p);
  }
  return out;
}

// Index of the `>` closing the opening tag that starts at `start`. Skips {…}
// expressions and "…"/'…'/`…` strings, so a `>` inside a className wins nothing.
//
// ★★★ KNOWN LIMITATION — IT PRODUCES FALSE POSITIVES, WHICH IS THE DANGEROUS
// DIRECTION FOR A RATCHET. An apostrophe inside a `//` comment that sits INSIDE
// a JSX opening tag opens a string that never closes, so the scan runs past the
// tag's `>` and swallows whatever follows. Measured 2026-08-08 on
// `documents-history-modal.tsx`: with the apostrophe in "workspace-context's"
// the opening tag "ends" at line 308; delete that one character and it ends at
// 244, correctly. The consequence was a Restore BUTTON — which renders
// `{t(lang, "documentsRestore")}` as visible text — reported as an untitled
// ICON-ONLY control, i.e. a phantom row in the open surface. `//` comments
// inside a JSX opening tag are legal and this codebase writes them often, so
// this WILL recur. Backticks are safe (they pair). Before opening a row for a
// newly-reported hit, OPEN THE FILE: a false positive costs a wasted task, and
// a doc that reports work that does not exist is worse than one that reports
// none.
function endOfOpenTag(s, start) {
  let i = start + 1, depth = 0;
  while (i < s.length) {
    const c = s[i];
    if (c === "{") { depth++; i++; continue; }
    if (c === "}") { depth--; i++; continue; }
    if (c === '"' || c === "'" || c === "`") {
      const q = c; i++;
      while (i < s.length && s[i] !== q) { if (s[i] === "\\") i++; i++; }
      i++; continue;
    }
    if (c === ">" && depth === 0) return i;
    i++;
  }
  return -1;
}

const TAGS = ["IconButton", "button", "ToggleButton", "Button"];
const rows = [];
for (const f of walk("src/app")) {
  const src = fs.readFileSync(f, "utf8");
  for (const tag of TAGS) {
    const re = new RegExp("<" + tag + "(?=[\\s/>])", "g");
    let m;
    while ((m = re.exec(src)) !== null) {
      const start = m.index, end = endOfOpenTag(src, start);
      if (end < 0) continue;
      const open = src.slice(start, end + 1);
      let children = "";
      if (src[end - 1] !== "/") {
        const closeTag = "</" + tag + ">", openRe = new RegExp("<" + tag + "(?=[\\s/>])", "g");
        let j = end + 1, depth = 1;
        while (j < src.length && depth > 0) {
          const nc = src.indexOf(closeTag, j);
          if (nc < 0) break;
          openRe.lastIndex = j;
          const om = openRe.exec(src);
          if (om && om.index < nc) { depth++; j = om.index + 1; }
          else { depth--; j = nc + closeTag.length; }
        }
        children = src.slice(end + 1, Math.max(end + 1, j - closeTag.length));
      }
      rows.push({
        site: `${f.replace(/\\/g, "/")}:${src.slice(0, start).split(/\r?\n/).length}`,
        tag,
        hasTitle: /(?:^|\s)title=/.test(open),
        named: /(?:^|\s)aria-label=/.test(open) || /(?:^|\s)label=/.test(open),
        children: children.replace(/\s+/g, " ").trim(),
      });
    }
  }
}

// "icon-only" = an IconButton (icon-only by contract), or children that reduce
// to nothing / a single glyph once icons, aria-hidden spans and JSX comments
// are removed. Prose mentions of `<button` inside comments land here too — they
// have no children at all — and are listed, not silently dropped.
function residue(kids) {
  let k = kids.replace(/\{\/\*[^]*?\*\/\}/g, ""), p;
  do { p = k; k = k.replace(/<[A-Za-z][A-Za-z0-9]*Icon\b[^>]*\/>/g, ""); } while (k !== p);
  return k.replace(/<span[^>]*aria-hidden[^>]*>[^<]*<\/span>/g, "").trim();
}
const iconOnly = rows.filter(
  (r) => r.tag === "IconButton" || residue(r.children) === "" ||
         /^[×✕⋮▸▾▼▲↑↓+•]{1,3}$/.test(residue(r.children)),
);

console.log("button-family elements scanned:", rows.length);              // 573
console.log("  carrying a title=      :", rows.filter((r) => r.hasTitle).length);       // 142
console.log("icon/glyph-only          :", iconOnly.length);                             // 87
console.log("  with title=            :", iconOnly.filter((r) => r.hasTitle).length);   // 49
console.log("  WITHOUT title=         :", iconOnly.filter((r) => !r.hasTitle).length);  // 38
console.log("  WITHOUT any name prop  :", iconOnly.filter((r) => !r.named).length);     // 16
for (const r of iconOnly.filter((x) => !x.hasTitle)) console.log(`${r.site}\t${r.tag}\tnamed=${r.named}`);
```

★★★ **Keep non-BMP characters out of any grep attached to a number here.** `grep` mishandles them in
**both** directions in this environment: a bracket expression containing one matches *every* non-BMP
emoji, and a literal search can return nothing though the glyph is present. Every glyph the script's
`residue()` regex uses (`× ✕ ⋮ ▸ ▾ ▼ ▲ ↑ ↓ + •`) is BMP and safe. Anything outside it must be checked
with node: `fs.readFileSync(f, "utf8").includes("\u{1F5D2}")`.

The Class B(ii) shortlist (198 untitled buttons with a ≤2-word visible label) comes from the same
scan, joined against the EN dictionary:

```js
// append to the script above
const en = fs.readFileSync("src/app/i18n.ts", "utf8"), dict = {};
const RE = /^  ([A-Za-z][A-Za-z0-9_]*): "((?:[^"\\]|\\.)*)",/gm;
let d; while ((d = RE.exec(en)) !== null) dict[d[1]] = d[2];
for (const r of rows) {
  if (r.hasTitle) continue;
  const km = residue(r.children).match(/^\{t\(lang, "([A-Za-z0-9_]+)"\)\}$/);
  const v = km && dict[km[1]];
  if (v && v.trim().split(/\s+/).length <= 2) console.log(`${r.site}\t${km[1]} = "${v}"`);
}
```

---

## What this document does NOT cover

Stated plainly, because an audit's silence reads as "checked and clean":

- **Non-`<button>` controls.** The scan covers `<button>` · `Button` · `IconButton` ·
  `ToggleButton` only. A `role="button"` `<span>` (e.g. `InfoTooltip`'s own trigger,
  `info-tooltip.tsx:44`), an icon-only `<a>`, and a bare `<input type="checkbox">` are all out of
  scope and unmeasured.
- **Whether an existing `title` is any good.** The 142 titled elements were counted, not read. A
  `title` that repeats a useless name is exactly the failure this document warns about in Class A,
  and there may be some already shipped.
- **`InfoTooltip` text quality.** 147 mounts, none read.
- **Class B(ii) exhaustiveness.** Ten sites were drawn by hand from a 198-row shortlist under a
  stated filter. A different filter — three-word labels, or labels on `<select>`/`<input>` — would
  find more. The shortlist command is above; the judgement is not automatable.
- **Anything gated — including by `docs:symbols:check`, which does not read this file.** Verified
  2026-08-07: `scripts/check-agents-symbols.mjs` builds its doc list as `AGENTS.md` plus
  `docs/AGENTS/*.md` (`DOC_DIR = "docs/AGENTS"`), and a passing run then reported **"9 doc(s)"** — it
  reports **10** since main's `docs/AGENTS/documents.md` merged in on 2026-08-08, which is the point:
  the figure is a census of that glob and moves whenever anyone adds a subsystem doc. Neither
  `docs/tooltip-inventory.md` nor `docs/handrolled-ui-inventory.md` nor `docs/open-followups.md` is
  in scope, so a green run says nothing whatsoever about the names in this document — not even the
  weak thing it says about `AGENTS.md` (that a backticked **mixed-case** name exists somewhere; it
  skips `SCREAMING_CASE` outright, and it never checks a claim). Every backticked name here was
  instead checked by hand against `src`. axe has no rule for a missing `title`, and the one name
  defect above is a control axe passes. **Nothing here is enforced by CI.** Re-measure before quoting
  any count above.
