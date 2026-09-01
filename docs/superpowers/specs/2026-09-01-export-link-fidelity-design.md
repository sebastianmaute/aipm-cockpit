# Export link fidelity — design

**Goal.** A link's ADDRESS survives every export. Where the format can hold a live hyperlink, emit
one; where it cannot, carry the address inline as visible text. No format loses it silently.

**Closes.** `docs/open-followups.md` §119 (`<a href>` dropped by both OOXML renderers) and §30 (a
link in a task description loses its address in document exports).

**Branch.** `fix/export-link-fidelity`, off `main` at `4650ed67` (0.275.0 "Nagata").

**Scope note.** This is HALF of the roadmap's slice 4. That slice bundled §119 · §30 · §93 · §304;
§304 alone is ~110 i18n keys (twelve `*_CSV_COLUMNS` constants, 110 distinct column strings, plus
five hand-written literal arrays), which is larger than everything else combined. §93 and §304 are
deferred to a separate branch — they share no file with this one. A peer session holds roadmap
slice 7 + §325 concurrently; the plausible seam with that work is `globals.css` and the shared
primitives, neither of which this branch touches.

---

## What is actually broken

Three sinks lose the address, and two of them lose it for the same reason.

`rich-text-runs.ts` parses rich HTML into `TextRun`s. `A` is in neither `MARK_BY_TAG` nor
`LINE_TAGS`, so an anchor falls through to the plain recursion and contributes only its text.
Everything downstream of that parse therefore sees a link as ordinary words:

- `doc-render-docx.ts` (document → .docx)
- `doc-render-pptx.ts` (document → .pptx)
- `ooxml-docx-primitives.ts`'s table-cell path, which takes `docxRichParagraphs(cell.html)` for a
  rich cell — so the WORKSPACE export loses it too, by the same mechanism

Separately, the flat sinks take `cellText(cell)` — the `.text` half of a `RichCell`, produced by
`descriptionTextWithBreaks` and ultimately by `htmlToText`, which is
`DOMPurify.sanitize(html, {ALLOWED_TAGS: [], ALLOWED_ATTR: []})`. That keeps the anchor's text and
drops its `href`:

- `export-xlsx.ts` — one shared-string cell per value
- `export-pptx.ts` and `doc-render-pptx.ts`'s table path — one whitespace-collapsed string per cell

`doc-render-html.ts` keeps `block.html` and is already correct. It is not touched.

Meanwhile `chat-tool-defs-documents.ts`'s block description tells the document-authoring model that
`a` is supported, so the model is invited to emit links that most export paths flatten.

Reproduce the parse gap:

```bash
grep -n "MARK_BY_TAG\|LINE_TAGS" src/app/rich-text-runs.ts       # A appears in neither
grep -n "only wraps" src/app/rich-text-runs.test.ts              # the test that PINS the defect
grep -rn "cellText" src/app --include=*.ts | grep -v "\.test\."  # the flat sinks
```

---

## Decisions taken

**1. Real hyperlinks where the format holds them; `text (url)` where it does not.**
Chosen over "accept the loss and disclose it" because the address being unrecoverable from the file
is §30's actual complaint, and over "`text (url)` everywhere" because that ships dead text in
formats that can hold a live link and re-opens the byte question in four renderers anyway.

**2. The `(url)` suffix comes from a NEW export-only projection, never from `htmlToText`.**
Widening `htmlToText` is the one thing §30 explicitly forbids, and the consumer list is why —
`inline-ai-edit/plan.ts`, `note-log-panel.tsx`, `note-log-policy.ts`, `note-log.ts`,
`rich-text-plain.ts`, `rich-text-projection.ts`, `sanitize-html.ts`. Search, the AI digests and the
inline-AI preview all read that projection and none of them wants an address spliced into its text.

**3. The flat projection applies to EVERY rich cell, not only task descriptions.**
§30 frames Tasks as the regression (before 0.210.0 that section emitted raw markup, so the export
became more readable and strictly less informative). But RAID, change and milestone descriptions
have been losing addresses for longer, and a reader given live addresses in one register and dead
text in three would read that as broken rather than as scoped. This is a judgement call recorded as
such, not something the register asked for.

**4. `href` is a FIELD on `TextRun`, not a `RunMark`.**
`RunMark` values are plain enum strings and `MARK_BY_TAG` is `Record<string, RunMark>` — a mark
carries no payload, so a URL cannot be one without changing what a mark is.

**5. Link relationship ids are minted after media, by the caller that already mints media ids.**
The richer alternative — a per-package `RelIdMinter` that both families draw from — was rejected:
it would rewrite the shipped S3c-2 media minting and its tests, and reworking working code adjacent
to a release is how several prior rounds introduced defects. The invariant is held instead by a
widened assertion in the builders (below), which makes it enforced rather than assumed.

---

## The change

### Parse

```ts
export type TextRun = { text: string; marks: RunMark[]; href?: string };
```

An `A` arm in the recursion carries a validated `href` down to the runs its subtree produces, the
way the mark arm carries marks down. `A` stays out of `MARK_BY_TAG` and out of `LINE_TAGS` — a link
neither styles a run nor breaks a line.

**Scheme allowlist at the parse boundary.** `sanitizeRichHtml` permits `<a href>` (`a` is in
`RICH_ALLOWED_TAGS`; `href` is in `ALLOWED_ATTR`), but these renderers write that value into a
package Word will follow. Admit `http`, `https` and `mailto` only; anything else yields a plain run
with no `href`, so a stored `javascript:` URL cannot ride into an OOXML relationship. This is a
second boundary, not a replacement for the sanitizer.

### DOCX

`buildDocxPackage` takes a fifth parameter beside `media`:

```ts
export type HyperlinkRel = { relId: string; target: string };
```

rendered into `word/_rels/document.xml.rels` as a relationship with **no part**:

```xml
<Relationship Id="rId7" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink"
              Target="https://intra/spec" TargetMode="External"/>
```

No `<Default>` entry, no zip entry, no content-type override. `TargetMode="External"` is what makes
the missing part legal.

★ The part-relative-Target rule the media comment warns about does NOT apply here. A media Target is
relative to `word/`; a hyperlink Target is the raw absolute URL. Making it part-relative would be
the same class of silent breakage in the opposite direction.

★ The URL is XML-escaped into the attribute. An `&` in a query string is the common case.

The body emits `<w:hyperlink r:id="...">` wrapping the runs.

### PPTX

`PptxSlide` gains the same field, scoped **per slide** — each slide has its own
`ppt/slides/_rels/slideN.xml.rels` where `rId1` is that slide's layout, so ids restart at `rId2`
on every slide. Media `path` is deck-wide unique and `relId` is per-slide; a link has no path, so
only the per-slide half applies. Runs emit `<a:hlinkClick r:id="..."/>`.

### Flat sinks

A new export-only helper renders a rich value to `the spec (https://intra/spec)`. Used by
`export-xlsx.ts` and the two flat PPTX cell paths. `htmlToText` is not touched.

★ This spec deliberately does NOT invent a name for that helper — §93 records why: a plausible
identifier written into prose gets grepped for, not found, and then re-created slightly differently
by the next person. Name it when you add it.

★ Real XLSX cell hyperlinks are deliberately NOT built: a worksheet hyperlink is one-per-cell, and a
description carrying two links cannot be represented that way. Filed rather than half-built.

---

## Contracts that must not break

**Additive by contract.** An empty `links` array must add no relationship, no part and no
content-type entry — exactly the rule `media` already carries. This is what keeps a link-free
package byte-identical, which in turn is why **`docs/baselines/ooxml-parts.json` must NOT move**.

★★ The roadmap document says adding hyperlink relationships MOVES the part manifest. That is wrong
under this contract, and the correction matters operationally: the manifest gate is a RATCHET, and a
baseline gate is blind immediately after its own regeneration. If the manifest goes red, the
additive contract has broken — the response is to fix the contract, never to run
`npm run ooxml:manifest`.

**Relationship id namespace.** Both builders today assert only `relId !== "rId1"`. With two families
minting into one namespace, a duplicated id is valid XML that resolves to whichever appears first —
an image silently becoming a link target, with no schema error and no visible symptom. The assertion
widens to: no duplicate `relId` across `media ∪ links`, per part in DOCX and per slide in PPTX.

**Zero new i18n keys.** The `(url)` form is punctuation, not prose. Nothing in this branch touches
`i18n.ts` or `i18n.de.ts`.

---

## Tests

**One existing test is deliberately flipped.** `rich-text-runs.test.ts`'s
`"carries no mark for a tag that only wraps (a link)"` asserts the CURRENT, defective behaviour. It
is rewritten to pin the new behaviour, with a comment recording what it used to pin and why it
changed. Deleting it quietly is the failure mode; a test that pins a defect must be flipped on
purpose and in the open.

New coverage:

- href carried through nested marks (`<a><strong>text</strong></a>` and the reverse nesting)
- scheme allowlist: `mailto:` survives; `javascript:` degrades to a plain run with no `href`
- `<w:hyperlink r:id>` / `<a:hlinkClick r:id>` present, and the id RESOLVES to a relationship
- the relationship carries `TargetMode="External"` and the hyperlink `Type` URI
- **no zip entry is added for a link** — the property that separates this from a media part
- no duplicate `relId` across media and links (DOCX per part, PPTX per slide)
- a link-free package stays byte-identical; the manifest test stays green WITHOUT regeneration
- the flat projection emits `text (url)`, and `htmlToText` output is byte-unchanged — pinned
  positively, since that assertion is what protects search and the AI digests
- `&` in a query string survives XML escaping into the Target attribute

Unzip-and-assert follows the existing shape in `export-ooxml.test.ts`, which already carries an
`unzip` helper. Every guard is mutation-proved with a minimal one-token revert, and each mutant is
recorded as `N failed / M passed` against the file's runtime test count.

---

## Verification, and what it discharges

★★★ Structural tests prove the bytes and CANNOT prove Word or PowerPoint accepts the file. A wrong
relationship `Type` URI or a missing `TargetMode` unzips clean, asserts clean, and opens with the
link dead or the file repaired. Nothing in this repo can open a `.docx` or a `.pptx`.

The branch therefore produces four sample files — DOCX and PPTX, each from the document renderer and
from the workspace exporter — and DOES NOT SHIP until the user has opened them in Word and in
LibreOffice and confirmed the links are live. The samples are MEDIA-BEARING, so the same pass also
discharges §219, which has been owed since the last export slice.

★ Record exactly what was opened and what was confirmed. An owed eye-verify is a gate; a vague
"looked fine" is how the previous debt became invisible.

---

## Register and prose updates

- **§119** — its body currently says `buildDocxPackage` "would have to collect per-part
  relationships it does not model today". That is STALE: the S3c-2 media slice built exactly that,
  in both renderers, with the caller-mints-relId convention and per-slide scoping already handled.
  Correct the body BEFORE closing the entry, so the record does not close on a false cost estimate.
- **§30** — close with the decision recorded (real links where the format holds them, `text (url)`
  where it does not, `htmlToText` untouched).
- **§219** — discharge only what the manual pass actually covered; narrow the entry rather than
  closing it if the pass covers less.
- **The roadmap doc** (`2026-08-31-followup-slice-roadmap.md`) — record the 4a/4b split and correct
  the manifest warning.
- **New entries above 328** for what is deliberately not built: real XLSX cell hyperlinks, and the
  flat PPTX table cell keeping the inline form.

★★ Closing an entry is a FOUR-place edit (heading marker · summary-table STATUS cell · summary-table
ANCHOR · the `**Status:**` witness), and 2026-09-01 saw one take six and another five — the extras
being cross-reference anchors inside OTHER entries' bodies plus body claims the fix falsified. Sweep
for both. A body line must never contain the word CLOSED.

---

## Landmines specific to this branch

- `src/app/*.ts` are CRLF (`i/lf w/crlf`). **Edit preserves CRLF; Write re-lines to LF**, and
  `sed -i` re-lines a whole file invisibly to `git diff`. Use Edit for every source change here.
- `npx tsc --noEmit` exits **2** on diagnostics, not 1. `npm run lint` exits 1 from gitignored
  leftovers — use `npx eslint src`.
- Never read a gate's exit code through a pipe.
- `rich-text-runs.ts` is 668 lines, `ooxml-docx-primitives.ts` 680, `ooxml-pptx-primitives.ts` 669,
  against an 800 ratchet that counts `split("\n").length` — i.e. `wc -l` PLUS ONE. There is room,
  but measure with the node one-liner rather than `wc -l` before assuming it.
- Splitting rich HTML re-enters the per-sink `isHtmlStart` landmine: `CONTAINS_TAG` needs `<` plus a
  LETTER, so a fragment carrying only a CLOSING tag classifies as plain text and is escaped into the
  reader's document.
