# Follow-up slice roadmap — derived from the 2026-08-31 triage of the open register

**What this is.** A triage of all 182 OPEN entries in `docs/open-followups.md`, clustered into slices
a single branch could close together. Written 2026-08-31, immediately after 0.270.0 "Tchaikovsky"
merged as `a5f51aa1`.

**What this is NOT.** It is not a commitment, not an ordering anyone has agreed to, and not a
replacement for the register. Every § below is described in one line; the entry body is the source of
truth and is usually much more precise than the summary here. Read the entry before briefing work
against it.

★★★ **Slices 1 and 2 are omitted deliberately — they were taken.** Slice 1 (chat-thread reload races,
§311 · §313 · §317 · §312) and slice 2 (document-image disclosure, §213 · §230 · §225 · §205) were
assigned the moment this triage landed. This document starts at slice 3 for that reason, not because
slices 1 and 2 do not exist.

---

## Provenance and how much to trust each row

The triage was performed by a subagent instructed to verify every path and count with its own
`grep`/`ls` rather than trusting register prose. Where it says a command returned a number, it ran the
command. Two qualifications that bound how far that goes:

- **A `never machine-verified` Status line means nobody has ever reproduced that entry.** Several of
  the slices below are built substantially out of such entries. They may not reproduce at all. The
  honest first task of any slice carrying them is a REPRODUCTION PROBE, whose acceptable outcome
  includes "this is not a defect, close it as such".
- ★★★ **An entry names the INSTANCE its author hit, never the CLASS.** Scoping a fix to what an entry
  names is the recurring way a closure ships false. Before briefing any slice here, enumerate the
  class yourself — rendered instances per view, not call sites per file — and adjudicate every site,
  including ones a previous entry waved off.

---

## Summary

| # | Slice | §§ | User-visible? | Size | Risk |
|---|---|---|---|---|---|
| 3 | Type-to-confirm + destructive-refusal recourse | 300 · 301 · 302 · 307 · 303 | yes (DE + AT users) | 5 src, new i18n keys | low, wide surface |
| 4a | Export fidelity: links — **TAKEN AND SHIPPED** | 119 · 30 | yes | 9 src + `ooxml-links.ts` | done; non-goals filed as 329 · 330 |
| 4b | Export i18n: translated column and section labels | 93 · 304 | yes | many i18n keys — see the split note | low per key, high volume |
| 5 | Budget panel correctness | 70 · 122 · 68 · 314 · 71 | yes | 4-5 src, 1-2 i18n | low |
| 6 | Row-unique names round 4 | 309 · 315 · 305 · 314 | yes (AT) | 3-4 src + tests | low |
| 7 | Colour-only state (WCAG 1.4.1) | 55 · 101 · 56 · 302 | yes | 10+ src | palette + a11y gates |
| 8 | Completion / audit truth | 299 · 64 (snapshot half) · 65 | yes | 3 src | **HIGHEST — do not bundle** |
| 9 | Focus/dismissal successor | 8 · 318 | yes (keyboard) | 2-3 src | low, now unblocked |
| 10 | Row-name scanner harness | 280 · 281 · 279 · 308 · 316 · 282 · 245 | no — gate hygiene | 3 files | low |
| 11 | Register + gate prose | 151 · 238 · 264 · 149 · 131 · 116 | no — docs | docs + scripts | low |

Ranked by user-visible defect closed per unit of blast radius. Rows 10 and 11 are hygiene and are
last for that reason — but see the note under slice 10, which is hygiene that certifies other work.

---

## Free closure available now

**§87 — "AI cannot read the activity log".** The entry's own body already says STALE, and the read
tool exists in the tree:

```bash
grep -c "search_history" src/app/chat-tool-defs.ts src/app/chat-tools.ts   # → 4 and 4
```

Heading-only edit, but remember closure is a FOUR-place edit: heading marker · summary-table STATUS
cell · summary-table ANCHOR · `**Status:**` witness line. A body line must never contain the word
CLOSED.

★ **§104 was checked the same way and REJECTED as not-yet-fixed** —
`grep -rn "activityViewOf" src/app --include=*.ts --include=*.tsx | grep -v "\.test\."` returns the
declaration plus one comment mention, so it still has zero production callers. Recorded here so the
next reader does not re-derive it.

---

## Slice 3 — Type-to-confirm and destructive-refusal recourse

§300 · §301 · §302 · §307 · §303

The German confirm phrase is broken and three of six confirm values cannot be translated at all.

- **§300** — `typeToConfirmPrompt` interpolates the required phrase undelimited, so the DE trailing
  `…ein` lands after a comma-bearing phrase and the sentence reads as nonsense. There is also no
  mismatch feedback: a user who types it wrong is told nothing.
- **§301** — 3 of 6 `confirmValue=` sites are hardcoded English. The bulk-delete one is BUILT AT
  RENDER from a count, so it is **untranslatable by string swap** — this is the one that forces a
  design decision rather than a find-and-replace.
- **§302** — the sidebar storage-readiness dot AND its shape marker are both `aria-hidden`, and
  `describe()` names the backend but never readiness. A screen-reader user is told nothing in either
  state. (§302 also appears in slice 7; it is one defect reachable from two clusters.)
- **§307** — no e2e can stage a refusal at all: the seed runs pre-load and both `__` globals are
  read-only. So the recourse path has never been observed working, by anyone.
- **§303** — one refusal writes two forensic entries.

Files: `type-to-confirm-dialog.tsx` · `tasks-section.tsx` · `settings-sections/general-section.tsx` ·
`notifications.tsx` · `sidebar-footer.tsx` · `i18n.ts` + `i18n.de.ts` · `e2e/`.

★ `type-to-confirm-dialog.tsx` imports `modal.tsx` but needs no edit to it.
★★ EN/DE key parity is tsc-enforced, and DE must carry real umlauts — do not touch `i18n.de.ts` with
an editor that re-lines CRLF or curls quotes; patch it with an anchored node utf8 write.
§301/§302/§303/§307 are all `never machine-verified`.

## Slice 4 — Export fidelity: links and export i18n

§119 · §30 · §93 · §304

The only slice here whose headline claim is MEASURED rather than never-verified.

★★★ **SPLIT INTO 4a AND 4b ON 2026-09-01, AND 4a HAS SHIPPED.** The two halves share a heading and
nothing else: 4a (§119 · §30) is renderer and package work with almost no strings, 4b (§93 · §304) is
i18n volume with no renderer work at all. Bundling them would have put a many-hundred-key translation
job behind a package-format change, and each half would have gated the other's review.

**The volume is what justified the split, and it is bigger than a first estimate suggested.** 4b has
to mint a display label — EN and DE — for every export column. Measured 2026-09-01: **14** column
constants carrying **139** distinct column strings, not the "12 constants, ~110 strings" an earlier
estimate gave. Derive it rather than trusting this line, because both numbers move on any schema
change:

```bash
grep -h "^export const [A-Z_]*CSV_COLUMNS" src/app/*.ts | wc -l
node -e '
const fs=require("fs");
const set=new Set();
for(const f of ["src/app/csv-codecs-core.ts","src/app/csv-codecs-config.ts","src/app/document-asset-codecs.ts"]){
  const s=fs.readFileSync(f,"utf8");
  const re=/export const ([A-Z_]*CSV_COLUMNS)[^=]*=\s*\[([\s\S]*?)\]/g; let m;
  while((m=re.exec(s))) for(const q of m[2].matchAll(/"([^"]+)"/g)) set.add(q[1]);
}
console.log(set.size);'
```

★ The count above covers only the builders that READ a `*_CSV_COLUMNS` constant. §304's own figure —
10 of 15 `ExportSection` builders — means five more hand-write their column arrays, and those are
outside the two commands above. Enumerate them from §304 before scoping 4b.

### 4a — links (§119 · §30) — SHIPPED on `fix/export-link-fidelity`

Both entries are closed. What landed:

- a shared `ooxml-links.ts` — `safeLinkTarget` (scheme allowlist), `createLinkSink`, `LinkSink` /
  `LinkRel`; `TextRun` gained an `href` FIELD (not a `RunMark`, which carries no payload) and the
  walk gained an `A` arm;
- real `<w:hyperlink>` in `.docx` and real `<a:hlinkClick>` in `.pptx` text boxes, both as
  `TargetMode="External"` relationships with NO part;
- a new `cellTextWithLinks` in `export-sections.ts` rendering `text (url)` for the FLAT sinks
  (`export-xlsx.ts`, `export-pptx.ts`, `doc-render-pptx.ts`'s cell path). ★ SUPERSEDED IN PART
  2026-09-01: `export-pptx.ts` left that list — a manual pass found its row slides emitting dead
  `text (url)` from the same action that produced live `.docx` links, and since nothing on a row
  slide is flattened it now mints real relationships through `cellLinkedLines` instead. The two
  remaining flat sinks are unchanged; §330's scope clause carries the split. `htmlToText` was NOT
  widened, and is now held byte-unchanged by a positive test, because search, the note logs and the
  AI digests read it.

★★ **Two deliberate non-goals came out of it and are filed so nobody reads them as unfinished work:**
§329 (real XLSX cell hyperlinks — the format's unit is the CELL, so a multi-link description cannot
be represented without dropping addresses) and §330 (the flat PPTX table cell keeps the inline form
because `flattenCell` has already collapsed the runs a relationship would attach to).

★★★ **THE PART-MANIFEST TRAP DESCRIBED HERE DOES NOT EXIST, and this row asserted it did.** The
original text said "adding hyperlink relationships MOVES the part manifest — regenerate
deliberately". It does not move it, and there was nothing to regenerate: a hyperlink relationship
adds NO zip entry and NO `[Content_Types].xml` Default, which is exactly what `TargetMode="External"`
licenses. `docs/baselines/ooxml-parts.json` is byte-unchanged across the whole slice, and the
additive property is now pinned by name — `ooxml-package-manifest.test.ts` carries a per-subject
"an empty links list adds nothing to the package". ★ The prove-RED-after-regeneration discipline is
still right in general; it simply had no subject here. Do not carry the false half into 4b.

★ The `isHtmlStart` warning below WAS live and was hit: splitting rich HTML re-enters the per-sink
landmine — `CONTAINS_TAG` needs `<` plus a LETTER, so a fragment carrying only a CLOSING tag
classifies as plain text and gets escaped into the reader's document.

★★★ **Nothing in this repo can open a `.docx` or a `.pptx`.** Verification is unzip-and-byte-compare
plus an OWED manual pass in Word and LibreOffice. That debt is REAL for 4a and is §219's;
`scripts/sample-link-exports.ts` emits four link-bearing sample files for it. Do not read 4a's green
gates as covering it.

### 4b — export i18n (§93 · §304) — NOT started

- **§93** — a hardcoded English frame wraps an already-translated section title, producing
  "Showing the first 100 of 125 **Aufgaben** rows".
- **§304** — no `ExportSection` builder puts a translated label in `columns`; 10 of 15 take them from
  `*_CSV_COLUMNS`, so a German user gets raw storage field names as export headers.

★★ EN/DE key parity is tsc-enforced and DE must carry real umlauts — at this key volume that is the
whole risk. Patch `i18n.de.ts` with an anchored node utf8 write, never an editor that re-lines CRLF
or curls quotes.
★ The two closed entries are still worth reading before starting: §30 records why `htmlToText` must
not be widened, and both record what the flat projection now emits, which 4b's labels sit beside.

**For the record — what the original slice-4 row said about §119 and §30, now historical:**

- **§119** — verified: `grep -c "hyperlink\|hlinkClick"` returns **0** in all four of
  `doc-render-docx.ts`, `doc-render-pptx.ts`, `ooxml-docx-primitives.ts`, `ooxml-pptx-primitives.ts`.
  A link exports as dead text in DOCX and PPTX while HTML and PDF keep it — and the AI document model
  is told the `a` tag is supported, so it will keep emitting them.
- **§30** — the export projection ends in `htmlToText` with `ALLOWED_TAGS: []`, so a task
  description's `href` is unrecoverable in PDF, DOCX, XLSX and PPTX alike. ★ That list was one too
  long even then: PDF goes through `exportCellHtml`, which emits `sanitizeRichHtml` markup for a
  rich cell and has kept `<a href>` since §141(b). The claim held for DOCX, XLSX and PPTX.

## Slice 5 — Budget panel correctness

§70 · §122 · §68 · §314 · §71

Two numbers on screen, both called "booked", sourced differently.

- **§70** — the "Total" column and row are narrowed by the role filter (three `rowsForTotals` hits)
  while the CCI tiles above them are not. A filtered view therefore shows a total that disagrees with
  the tiles directly above it.
- **§122** — the role row renders the persisted `a.actualHours[p.key]` while the people rows beneath
  render a live figure. Two stacked numbers, both labelled booked, computed from different sources.
- **§68** — two `<tr className="border-t border-line">` rules never paint, because these tables are
  `border-collapse: separate`. A `<tr>` border in these tables has never painted; put the rule on the
  CELLS.
- **§314** — `grep -c budgetRateOverrideHint` returns 2, both `InfoTooltip` with no `label`, so the
  two triggers share one accessible name.
- **§71** — `cellBudget` is evaluated three times per (row, period).

Files: `budget-panel.tsx` · `budget-panel-totals.tsx` · `budget-panel-people-rows.tsx` ·
`budget-bucket-modal.tsx` · `budget-bucket-people.ts` · `globals.css`.
No write paths, no status pair. None of these are `never machine-verified`.

## Slice 6 — Row-unique names, round 4

§309 · §315 · §305 · §314

- **§309** — `projects-panel.tsx` carries TWO row-naming conventions in one file: the ARCHIVED list
  uses `buildRowTokens`, the ACTIVE list raw-interpolates (`grep 'aria-label={`'` → 3).
- **§315** — `{row.weeklyHours}` is button CONTENT at two sites (the managed AND unlinked tables), so
  a team where several people work 40h gives N buttons all named "40".
- **§305** — `version-diff-view.tsx` renders `{c.recordLabel}` bare in both layouts, with the
  occurrence index reaching only the `aria-label`.
- **§314** — the shared `InfoTooltip` label defect; also in slice 5.

★★★ **axe is provably blind to this entire class** — none of the 69 rules carrying the four tags the
gate requests flags two controls sharing an accessible name, at any seed size, in any view. Unit tests
are the only detector that will ever exist.
★★ Use the shared `src/test/row-unique-names.ts`, and turn `requireCollisionSeed` ON for any test
claiming to cover a collision — without it a one-row fixture passes and reads as coverage.
★ A per-item component cannot disambiguate itself; the token map must be built by whoever renders the
LIST and threaded down as a prop.

## Slice 7 — Colour-only state (WCAG 1.4.1)

§55 · §101 · §56 · §302

- **§55** — verified: **12** hand-rolled `aria-pressed` toggles across **9** files
  (`create-project-wizard` · `dictation-mic` · `influence-interest-matrix` · `knowledge-panel` ·
  `raci-chip-picker` · `settings-sections/comm-templates-section` · `step0-import-panel` ·
  `task-form-fields` · `voice-button`) signal their on-state by fill alone.
- **§101** — `SegmentedControl`'s selected fill measures 2.38 / 2.43 / 2.25:1 in the three dark
  schemes.
- **§56** — `ToggleButton`'s pressed border measures 1.03–1.22:1 dark.
- **§302** — storage readiness never disclosed to AT; shared with slice 3.

★★ **Scope this correctly or it flags conformant code.** The three LIGHT schemes already conform —
Understanding 1.4.1 counts a ≥3:1 lightness difference as the required additional distinction, and the
light-scheme borders measure 7.71–9.30:1. The DARK maps are the actual failure.
★ The fix pattern already exists: `ToggleButton`'s `data-pressed-marker` glyph, always rendered and
merely `invisible` when off so the button keeps one width. Do not hand-roll a thirteenth toggle.
★ `segmented-control.tsx` is consumed by `popover-panel.tsx` — that was a blocker while a peer held
the popover files and is NOT one any more, as of `a5f51aa1`.

## Slice 8 — Completion and audit truth

§299 · §64 (snapshot half) · §65

★★★ **Flagged HIGHEST risk by the triage and explicitly DO NOT BUNDLE.** It touches the
`status` ⟺ `completedDate` invariant AND the activity log at once.

- **§299** — `TASK_UNDO_GROUPS` is `["status", "completedDate"]` and `use-undo-stack.ts` logs only
  undo/redo (4 sites). So an undo FLIPS a task's delivered-ness while writing no completion and no
  reopening entry — the audit trail disagrees with the data.
- **§64 (snapshot half)** — `snapshot.ts`'s persisted `pctComplete` still reads 0% for an
  all-cancelled project.
- **§65** — a `Done` task with no `completedDate` shows the cross while its tooltip says "completed".

★ **§64's OTHER half is the landing-state writer in `dashboard-panel.tsx`**, which feeds
`use-landing-delta.ts` → `trends.complete` → the KPI strip. That half was blocked while a peer held
the file; it is free now. Whether to take both halves at once is a judgement call — the register
records it as HALF FIXED and the two halves have different blast radii.
★★ Read `docs/AGENTS/task-status.md` in full before touching any status write. FIVE paths write the
pair, each by a different mechanism, and "completing the pattern" by routing one through another is
the recurring defect. §299 is `never machine-verified`.

## Slice 9 — Focus and dismissal successor

§8 · §318

**Newly unblocked.** §100, §297 and §124 closed in 0.270.0; these two were deliberately left open and
unowned by the session that closed the others, on the reasoning that they want to be closed ON TOP OF
a merged `kind: "modal"` rather than alongside it. That merge has landed.

- **§8** — `tour-overlay.tsx` claims `role="dialog"` and `aria-modal="true"` and imports
  `useDismissable`, but has NO `useFocusTrap`. It announces itself as modal and does not trap Tab.
- **§318** — `use-focus-trap` runs a Tab trap that never joins the dismissal stack.

★★★ **The measurement that cost the previous slice two dead implementations:** Chromium dispatches
`focusout` with `relatedTarget === null` SYNCHRONOUSLY as a focused node is removed; Firefox and jsdom
dispatch none. So any focus-restore-on-unmount logic reading containment in a passive effect cleanup
is green across the entire unit suite and dead in the browser we ship. There is no in-handler
discriminator. The full record is in `docs/AGENTS/ui-shell.md`'s dismissal section — read it there,
not here.
★★ `npm run e2e:crossengine` (own config, own test dir, port 3300, NOT in CI) runs these checks in
real Chromium AND real Firefox. It is the only layer that can see this class.
★★ A dismissal-stack test asserting on FINAL focus is structurally blind to `isTopmostOfKind`: both
traps are `document` keydown listeners firing in registration order, so whichever surface opened last
silently corrects the other. The only shape that kills the mutant is a NON-EDGE Tab inside the
layered-above modal.

## Slice 10 — Row-name scanner harness (gate hygiene)

§280 · §281 · §279 · §308 · §316 · §282 · §245

Not user-visible, but it is the harness that CERTIFIES the user-visible row-name work in slice 6 — a
wrong scanner reports uncovered surfaces as covered, which is worse than no scanner.

- **§280** — `matchDelimiters` counts brackets without skipping strings or comments.
- **§281** — `moduleKey` is basename-only, so directory-distinct modules collapse to one coverage key.
- **§279** — `controlNames` reads `aria-label || textContent`, so an `<input>` reports the empty
  string.
- **§316** — the scanner's `DATA` leg has NEVER been adjudicated. ★★★ This is the one that matters:
  the defect class lives in `DATA` ("some other value reaches the name — collides when that value
  repeats"), NOT in the alarming-sounding `FIXED` leg. A previous closure adjudicated `FIXED` alone and
  shipped false; a later review found five live collisions in `DATA` inside the two files that closure
  had just fixed.
- **§282 · §245** — related harness defects.

★ **A candidate leg is not a defect list.** A `DATA` site is fine when the value cannot repeat (a
React key, a numeric id) and a defect when it is free text. No static report can decide that — the
honest move is a read-and-adjudicate task with a verdict recorded per site, not a bulk fix.

## Slice 11 — Register and gate prose (docs hygiene)

§151 · §238 · §264 · §149 · §131 · §116

- **§151** — a retracted "runs under bare node" rationale is still asserted as live.
- **§238** — generated sample workspaces with no consumer and no regeneration gate.
- **§264** — the i18n sweep is blind to a literal inside a ternary.
- **§149** — date-dependent tests detonate on a calendar rollover. ★ This one has a deadline nobody
  set: it fails on a date, not on a commit.
- **§131 · §116** — gate-parsing debts.

★★ Anything touching `docs/**` outside `docs/superpowers/` is inside `doc-claims-check`'s scan set,
which is a RATCHET: cite SYMBOLS and commands, never `path:LINE`.

---

## Known corruption, owned

**2 control bytes in `docs/open-followups.md`** — U+0008 ×2, from two lost backslashes turning `\b`
into a literal backspace inside a `grep -rln` reproduce command. The command as written cannot answer
its own claim. Pre-existing, present at `a5f51aa1`, found by code-point scan:

```bash
node -e "const s=require('fs').readFileSync('docs/open-followups.md','utf8');const bad=[];for(let i=0;i<s.length;i++){const c=s.codePointAt(i);if(c<9||(c>10&&c<32)||c===127)bad.push(s.slice(0,i).split('\n').length);}console.log(bad);"
```

★ Do NOT quote a line number for it — it shifts on every register edit, and has already been quoted
wrong twice from a stale count. Re-scan.

★★★ **Do not run the register's own index-rebuild recipe.** It claims idempotence and is not: it
derives the State cell from the HEADING alone and harvests only Origin/Size, silently destroying any
hand-written parenthetical in a State cell. It wiped four rows' annotations in one branch and the diff
looked clean. This is filed as §319.
