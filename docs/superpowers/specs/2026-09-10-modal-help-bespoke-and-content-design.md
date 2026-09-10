# Modal context help — the bespoke surfaces and the content behind them

**Date:** 2026-09-10
**Follows:** the `ModalHeader` half, shipped 0.299.0 "Yefremov" (2026-09-09)
**Closes if complete:** `docs/open-followups.md` §424, §453 gaps 1–3
**Explicitly NOT in scope:** §389, §424 gap 4, the `aria-modal` boundary question

---

## 1. Goal

Finish §424. The shipped slice reached the prop-reachable set only — the 20 `ModalHeader`
sites, via one prop and one passthrough. The headerless `Modal` sites and the hand-rolled
floating windows still render no help opener, and three of the entries the shipped icons
point at have no content about their dialog's subject.

This slice does three things: extracts the icon so a headerless site can render one, writes
the three missing Help entries, and triages every remaining surface to a recorded outcome.

---

## 2. What is actually there — measured 2026-09-10, not inherited

★★★ **THE REGISTER'S NUMBERS ARE WRONG IN THREE OF FOUR CELLS.** §424 carries 34 files /
36 sites / 20 headers / ~14 bespoke, and flags all four as inherited-and-unverified through
two slices. Re-measured today:

| | §424 says | measured |
|---|---|---|
| `Modal` files / sites | 34 / 36 | **33 / 33** |
| `ModalHeader` sites | 20 | **20** |
| headerless sites | ~14 | **13** |

★★ **NEITHER OBVIOUS INSTRUMENT IS TRUSTWORTHY ALONE, AND THEY FAIL IN OPPOSITE
DIRECTIONS.** A line-based `grep -rn "<Modal[ />]" src/app --include=*.tsx | grep -v
"\.test\.tsx:"` returns **22** — many call sites break the tag across lines, so the
character after `<Modal` is a newline and the class never matches. That is the multiline
undercount AGENTS.md warns about. A multiline regex scan without stripping comments returns
**37**, because four files carry the literal string `<Modal>` in a prose comment
("Escape, focus management, and backdrop-click are owned by `<Modal>`"). That is the
self-referential-grep trap: the comment describing the component matches the scan for the
component.

The four comment-only hits, named individually so the strip is verified rather than assumed:
`absence-edit-modal.tsx:65` · `edit-modal-chrome.tsx:38` · `jira-conflicts-modal.tsx:123` ·
`shift-edit-modal.tsx:102`. Raw 37 minus those 4 is 33, which is the answer.

★ `absence-edit-modal.tsx` drops out of the file list entirely — its only `<Modal>` was the
comment, so it renders none directly (it goes through `EditModalShell`).

**Reproduce:** rebuild the scan; do not trust the table above. It must walk `src/app`
recursively for non-test `.tsx`, strip `/* */`, `//` and `{/* */}` before matching, and match
`/<Modal(?=[\s/>])/` so `<ModalHeader`, `<ModalFieldError` and `<ModalEditFooter` are
excluded by the lookahead. ★★ Assert the strip with a positive control: `shift-edit-modal.tsx`
and `jira-conflicts-modal.tsx` must each go from 2 raw to 1 stripped. A strip that silently
removes nothing, or removes real code after a `//` inside a URL, is invisible without it.

### The 13 headerless sites

`actions-panel` · `alloc-plan-modal` · `calendar-pull-summary-modal` ·
`comm-send-preview-modal` · `insights/recommendation-review-modal` · `integration-disclaimer` ·
`pick-list-import-modal` · `raci-suggest-modal` · `steering-committee-panel` ·
`step0-import-panel` · `task-dedup-modal` · `timelog-panel` · `version-info`

### The floating windows — one, not two

§424 says two hand-rolled windows. `grep -rln "useDraggableWindow" src/app --include=*.tsx |
grep -v "\.test\."` returns **three** files: `help-menu.tsx`, `notes-window.tsx`,
`asset-preview-modal.tsx`.

- `asset-preview-modal.tsx` already carries a `ModalHeader`, so it is in the shipped set.
- `help-menu.tsx` **renders `HelpContentPane`** — it *is* the Help window. A help icon on Help
  is nonsense. Excluded, and the exclusion is recorded so a later reader does not "complete
  the pattern".
- `notes-window.tsx` (137 lines) is the only genuine window candidate.

### File sizes against the 1600 ratchet

Counted as `split("\n").length`, which is `wc -l` **plus one** — budget from this, never from
`wc -l`:

`modal-header.tsx` **265** · `popover-panel.tsx` 540 · `help-content.ts` 307 ·
`help-menu.tsx` 185 · `notes-window.tsx` 137 · `help-body-text.tsx` 70.

★ `modal-header.tsx` roughly doubled last slice (130 → 265), almost entirely landmine
comments. Ample headroom, but ~90 of those lines are the help icon sitting inline in a
shared header — which is the extraction argument independent of the ratchet.

---

## 3. The content measurement, and a correction to §453

`HELP_ENTRIES` holds **66** entries: `concepts` 12 · `workflows` 6 · `features` 45 ·
`automated` 3.

★★★ **ANY PROBE THAT READS BODIES MUST ASSERT 66/66 RESOLVED BEFORE READING A SINGLE
COUNT.** §453 owns this rule and the reason: the obvious line-anchored shell form resolves
only 35 of 66 (multi-line and differently-indented values fall out) and therefore undercounts
every term, while a bare `grep -i` over `src/app/i18n.ts` fails the other way across ~3967
keys of which 66 are help bodies. Build the probe by indexing every `^ {2}([A-Za-z0-9_]+):`
in `i18n.ts` and slicing each key's value to the next such match. It is not committed;
rebuild it.

**Gap terms, body-scoped, at 66/66 — reproduced today and matching §453 exactly:**

| gap | terms | bodies |
|---|---|---|
| 1 meeting series | `meeting` / `recurr` / `series` | 3 / 1 / **0** |
| 2 images + assets | `image` / `asset` / `attach` | **0** / **0** / 2 |
| 3 task effort | `estimate` / `time spent` / `remaining` / `effort` | **0** / **0** / **0** / 1 |

★★★ **§453'S POSITIVE CONTROLS ARE OCCURRENCE COUNTS PRESENTED BESIDE BODY COUNTS, AND THE
PARAGRAPH DOES NOT SAY SO.** It records `task=59 budget=20 milestone=19 risk=10` under a
sentence whose findings are body counts ("meeting appears in 3 of the 66 bodies"). Measured
today: as **bodies** those controls are `28 / 14 / 13 / 8`; as **occurrences** they are
`59 / 20 / 19 / 10` — an exact match for the recorded four. So the controls are occurrences
and the findings are bodies, mixed in one paragraph with no label.

★ No conclusion changes: `image` and `asset` are 0 under both conventions, and `series` is 0
under both. But the next reader rebuilding the probe against those controls will calibrate
against the wrong convention and think their probe is broken. **This slice corrects §453 in
place, in the same commit that touches it** — a deferred correction gets restated, which is
this slice's own recorded failure mode.

**Body length** (source chars, i.e. as written in `i18n.ts` including escapes — NOT the
rendered string; the two conventions differ and mixing them is a recorded defect here):
max **1401** (`helpSecRichTextBody`), median **539** — ★★ CORRECTED 2026-09-10: the median does NOT reproduce (543 excluding quote delimiters, 545 including, 540.5 rendered; the two middle values are 537/549). Min and max are exact under the quotes-included convention, which is what made the median read as checked. Left in place as the record of what was designed against; the plan carries the measurement — min **268**
(`helpSecTemplateSuggestBody`). Use the median as the prose target.

---

## 4. Triage — and the yield is lower than §424 implies

Five of the 13 are structurally not help candidates. §424's own rule already covers them:
"a modal declaring NOTHING is the deliberate answer for confirmations and gates."

- **Transient progress**, gone before a user could click an icon: `actions-panel`
  (`actionAiAnalyzing`), `step0-import-panel` (`wizardImportReadingFiles` /
  `wizardImportAnalyzing`), `timelog-panel` (`loadingTimelog`).
- **Acknowledgement gate**: `integration-disclaimer` (`disclaimerTitle`) — the dialog *is*
  the explanation.
- **Already information**: `version-info` (`version`).

That leaves 8 candidates. Probing all 66 bodies for each candidate's subject:

| candidate | entry | verdict |
|---|---|---|
| `raci-suggest-modal` | `concept-raci` | WIRE |
| `steering-committee-panel` | `feature-steering` | WIRE |
| `insights/recommendation-review-modal` | `automated-insights` | WIRE |
| `alloc-plan-modal` | — `allocat` hits 1 body (`concept-resource`) | REFUSE-NO-CONTENT |
| `calendar-pull-summary-modal` | — `outlook` hits 3 bodies, all steering/activity | REFUSE-NO-CONTENT |
| `comm-send-preview-modal` | — `communicat\|email` hits 3, all incidental | REFUSE-NO-CONTENT |
| `pick-list-import-modal` | — `import` hits 2, both incidental | REFUSE-NO-CONTENT |
| `task-dedup-modal` | — `dedup\|duplicat` hits 4, all unrelated senses | REFUSE-NO-CONTENT |

★★★ **THESE ARE CANDIDATE VERDICTS FROM A TERM PROBE, NOT THE DECISION.** A term probe can
prove a subject is ABSENT from every body; it cannot prove a present term describes the
dialog. The union catches a MISTYPED id, never a well-spelled WRONG one, and last slice a
by-eye review of 20 pairings changed three. **Every WIRE verdict above is re-reviewed as
content against the entry's real title and body before it is wired**, and a REFUSE may flip
to WIRE only on the same evidence.

**Realistic yield: 3–4 bespoke sites wired plus `notes-window`, not 8.**

**REFUSE-NO-CONTENT is the recorded outcome, not new prose.** Writing five more entries
roughly doubles the writing in this slice and is deliberately deferred. Each of the five gets
a call-site comment recording the absence as deliberate (the same shape `calendarEvent` and
`taskTimeTracking` carry today) and one new register entry collecting all five.

★ `notes-window` is a candidate but is NOT a `Modal`. See §6 — its dismissal interaction is
the one genuine unknown in this slice.

---

## 5. Mechanism — extract `HelpIconButton`

New `src/app/help-icon-button.tsx`, taking `{ conceptId: HelpEntryId; lang: Lang;
dialogTitle: string }`. It owns everything the shipped icon owns today: the open state, the
trigger ref, the `HELP_ENTRIES` lookup, the **stable** `onClose` (`PopoverPanel` reads it
through effect dependencies, so it MUST be `useCallback`), the `QuestionMarkCircleIcon`
trigger, and the `PopoverPanel` holding its close button and `HelpBodyText`.

`ModalHeader` consumes it and keeps its `helpConceptId` prop. **The proof of a clean
extraction is that `modal-header.test.tsx` passes completely unchanged** — including the
accessible-name test and the mutation-proved Tab-containment test. If that file needs an
edit, the extraction changed behaviour and the change must be justified, not absorbed.

This is an EXTRACTION, not a second renderer — the same rule `HelpBodyText` was extracted
under last slice. There must be exactly one place that renders a help popover; 8 bespoke
sites growing their own is the `no-handroll-use-primitives` violation this exists to prevent.

★★★ **THE POPOVER'S CLOSE BUTTON IS LOAD-BEARING FOR FOCUS CONTAINMENT AND MUST MOVE WITH
THE COMPONENT.** `PopoverPanel` pushes `kind: "modal"`; `modal.tsx` stands its own Tab trap
down for the topmost `"modal"` entry; and `PopoverPanel`'s own cycle returns WITHOUT trapping
when the panel holds no focusable children. A text-only panel therefore stands **both** traps
down and Tab walks out of the dialog (WCAG 2.4.3). Measured last slice with twelve
`userEvent.tab()` presses in a `Modal` rendering one button outside itself: focus reached
`document.body` on press **4** and the outside control on press **5**. Deleting or disabling
that button is not a cosmetic change.

★ Escape is unaffected and needs no `kind` test: `escapeOwner()` in `dismissal-stack.ts` is
kind-AGNOSTIC — it walks the stack from the top and returns the first claiming entry. `kind`
means "traps Tab" and nothing else. Flipping the popover's `kind` left the whole file green
(15/15) last slice, which is why no test pins it.

---

## 6. `notes-window` — the one genuine unknown

Every surface wired so far renders inside `<Modal>`, so `PopoverPanel`'s `kind: "modal"` push
lands on top of a `Modal` entry that knows to defer. `notes-window` hand-rolls its chrome via
`useDraggableWindow` and pushes its own dismissal entry, so the stack shape is different and
nothing has measured what Tab does there.

**This is measured before it is wired, not reasoned about.** If the interaction is wrong,
`notes-window` becomes a REFUSE with the measurement recorded, and that is an acceptable
outcome for this slice. It is sequenced LAST so it cannot block the rest.

---

## 7. Content — three new Help entries

Gaps 1–3 of §453. Each is a `titleKey` + `bodyKey` in **both** dictionaries plus a
`HELP_ENTRIES` row, group `features`, with `relatedViews` where one applies. Target the
median body length (539 source chars).

1. **Meeting series** — the recurring meeting-series editor. Today `series` is in 0 bodies.
2. **Images and assets** — `image` and `asset` are each in 0 bodies, across titles and
   primers too. ★ **This is the only gap currently shipping the failure mode**: three
   documents/asset modals carry icons *today* pointing at entries with no content about what
   they do. Everything else in this slice is absence, which is honest; this one actively
   misleads.
3. **Task effort** — estimate / spent / remaining, each 0 bodies today.

Then re-wire the two modals that were deliberately unwired last slice rather than left
pointing somewhere plausible: `calendarEvent` → the meeting-series entry, `taskTimeTracking`
→ the task-effort entry. ★★ **Both call sites carry a comment recording the absence as
deliberate. Those comments are DELETED in the same commit that wires them** — a stale comment
asserting the opposite of the code is this slice's own dominant defect class.

### i18n constraints — non-negotiable

- ★★★ **`i18n.de.ts` is NEVER touched with Edit or Write.** The Edit tool corrupts umlauts
  and curls double quotes there. Patch by node utf8 write with `\r\n` anchors (a `\n` anchor
  silently no-ops on a CRLF file) and real German umlauts — the `i18n-encoding` test BANS
  ASCII substitutes (`fuer`, `druecken`) and `\u00XX` escapes.
- EN and DE key sets must be identical; `tsc` enforces it.
- ★★★ **BOTH DICTIONARIES ARE SHARED WITH PEER SESSION `aipm-wt-a-b7`.** Coordinating with
  them is a **step in the plan before either file is opened**, not a note. 0.299.0 already
  added `modalHelpAbout` to both; that session was notified on 2026-09-09 and told to rebase.

---

## 8. Testing and anti-vacuity

The rule this slice inherits: **a negative assertion needs a positive observable in the same
test, and a collision test needs a genuine collision seed.** A single-modal fixture satisfies
a distinctness check trivially and is vacuous.

- **Extraction proof:** `modal-header.test.tsx` passes unchanged. Stated as an acceptance
  criterion, not an observation.
- **Every declared id resolves** to a real `HELP_ENTRIES` entry. ★ This is the one assertion
  that survives the `HelpEntryId` union being abandoned, and the only detector for a row
  pointing at a deleted entry.
- **Wiring test** (`help-content.test.ts`) extends to the new rows, keeping the
  `MULTI_SITE_KEYS` allowlist shape: a key may have more than one call site only through an
  explicit entry carrying its reason, plus the assertion that every allowlisted key genuinely
  HAS more than one site, so the allowlist cannot rot into exempting a key that dropped back
  to one.
- **Icon-absent assertions** for the REFUSE sites carry a positive observable in the same
  test — the ✕ IS present — or they pass against a component that failed to render at all.
- **Stacked-naming test** carries a real collision seed: two dialogs with genuinely different
  titles. ★★ No gate can see a duplicate accessible name in any view at any seed size, and
  `e2e/a11y.spec.ts` opens no `Modal` at all — its only three clicks are the Board toggle, the
  Notes badge and Documents' "Edit blocks". A unit test is the ONLY possible detector, in
  either layer.
- **Acceptance mutants:** each its own fixture, each recorded as "N failed / M passed", with
  the sum equal to that file's runtime test count. ★ A `failed/passed` tally with no sum check
  cannot distinguish a killed mutant from a suite that silently did not run.
- **Every mutant reverted** by an anchored inverse edit with a uniqueness assertion in BOTH
  directions, ending on an empty `git diff --stat`. `git checkout -- <file>` and `git restore`
  are deny-blocked; `git stash` must never be run in this worktree; never `--amend`.

★★ **AXE WILL PROVE NOTHING ABOUT THIS FEATURE**, and a green run must not be reported as if
it did. It means "nothing regressed", never "the new control was scanned".

---

## 9. Out of scope — recorded so it is not rediscovered

- **§389** (`ModalHeader` names every ✕ identically, so any two stacked modals collide).
  Its own tractable next step is an ENUMERATION of which modals can actually stack, not a
  rename; the register calls the global default-rename "the cheap wrong-shaped fix".
- **§424 gap 4**, the `HelpMenu` deep-link input. Shipping the popover means the deep-link
  route was never needed, so this is a separate want with no caller pushing it — lower
  priority than §424 originally implied, not higher.
- **The `aria-modal` boundary.** The help prose portals to `document.body`, outside the
  `aria-modal` container, so browse-mode screen readers may not reach it. Unverifiable
  without a real screen reader; no gate or test here can answer it. Stays open.
- **The five REFUSE-NO-CONTENT subjects**, deferred to a new register entry.
- **Prose for `EditModalShell` consumers, the flip-above branch, the viewport clamp under
  stress, the three >1000-char bodies, and non-Chromium browsers** — all recorded unmeasured
  in §424 and unchanged by this slice.

---

## 10. Standing constraints

- `src/app/**.ts(x)` and `src/test/**.ts` are **CRLF** — Edit tool only, never `sed -i`.
  `docs/**` is LF-only.
- Never read a gate's exit code through a pipe: redirect, `echo "EXIT=$?"` unpiped, then grep
  the log.
- Never run two vitest processes at once.
- Never stage `sample-workspace-huge.json` or `not-in-use.env.local.bak`. Never `git add -A`
  or `git add .`.
- The slice ENDS at a green local gate chain plus the §424 / §453 Status updates. No version
  bump, no `CHANGELOG` entry, no push, no MR — release is a separate explicit instruction.

Claude-Session: https://[session link removed]
