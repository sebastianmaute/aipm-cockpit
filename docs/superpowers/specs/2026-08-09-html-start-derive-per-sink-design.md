# `HTML_START` derive-per-sink — design

**Date:** 2026-08-09
**Base:** `a20894b1` (branch `chore/codemap-header-stamp`, one docs commit ahead of `origin/main` = `e368c938` = 0.227.0 "Bolander")
**Closes:** open-followups §107 · §114 · §118
**Opens:** one new register entry (below), recorded as step 0 of the *unify rich text* program
**Roadmap position:** the *(before S3b)* row of §113's decomposition table

---

## Problem

`HTML_START` (`narrative-html.ts`) decides whether a stored value is "already HTML" from its
first tag:

```
/^\s*<(p|br|strong|em|ul|ol|li|a)\b[^>]*>/i
```

Eight tags. One constant. It is consumed by **two** classifiers serving **four** different
sinks. A value whose first tag is outside the eight is classified as legacy plain text, and
`plainToHtml` **escapes the whole value** — not just the unrecognised tag. The result is
permanent: literal `&lt;h1&gt;` in the field, in every reader, in every export.

Measured through `sanitizeAiRichText` (§107):

```
"<h1>Title</h1><p>body</p>"      -> "<p>&lt;h1&gt;Title&lt;/h1&gt;&lt;p&gt;body&lt;/p&gt;</p>"
"<u>Title</u><p>body</p>"        -> "<p>&lt;u&gt;Title&lt;/u&gt;&lt;p&gt;body&lt;/p&gt;</p>"
"<p>Title</p><h1>Section</h1>"   -> "<p>Title</p><h1>Section</h1>"          <- unaffected
```

**Position decides.** The same `<h1>` survives mid-value and destroys the entire value when it
leads. `u` / `h1` / `h2` are the sharp cases because `sanitizeTemplateHtml` — the sink for the
seven rich entity fields — explicitly permits them; the model is being escaped for writing
exactly what it is allowed to write. §114 is the same defect for the nine document-only tags
(`s code pre blockquote hr mark sub sup img`), where the only mitigation is an *instruction*
in `chat-tool-defs-documents.ts` telling the model to wrap paragraphs in `<p>`. An instruction
is not a guard.

### Why the obvious fix is wrong

Widening the shared constant fixes the description path by **re-breaking the narrative path**.
`narrative-html.ts` states the alignment as deliberate: the eight tags are exactly
`NOTE_ALLOWED_TAGS`, whose sink `sanitizeNoteHtml` sets `KEEP_CONTENT: false` and therefore
**deletes a non-listed element together with its text**. That bug was already found and fixed
once — `<h1>Q3</h1><p>ok</p>` rendered as just "ok", `<div>Status</div>` rendered as nothing.

> **Recognising a tag the sink STRIPS is worse than not recognising it at all.**

That is the rule. It is not "eight is correct"; it is "never recognise more than your own sink
keeps". One shared constant cannot express it for four sinks.

---

## What this slice is, and is not

**Is:** the classifier mechanism, per sink, plus the two register defects it unblocks.

**Is not:** any repair of already-corrupted stored values (decision 1), any change to what a
sink permits, and any editor work (decision 3).

---

## Decisions

### 1. Stop-the-bleed only — no repair of stored values

New writes classify correctly. A value already stored as `<p>&lt;h1&gt;…</p>` stays literal.

Rejected: **read-time repair** (detect the escaped-markup shape and un-escape it) — it is a
heuristic applied to user-typed text as well, so someone who legitimately typed `<h1>` into a
description gets it silently turned into a heading. That is §32's failure direction, where the
words are *deleted* rather than escaped, and the register records it as the worse one.

Rejected: **one-shot write migration** on the six load paths — it moves stored bytes on all six
backends and every golden fixture for values no user changed.

★ Consequence to state plainly: this slice makes the corruption **stop**, not **heal**.

### 2. Projection uses the widest list, and that is not a policy exception

`descriptionText` / `descriptionTextWithBreaks` (`rich-text-projection.ts`) call
`descriptionHtml` and then strip every tag. They feed search, AI digests, the inline-AI
preview, and **every export column** through `richCell`.

A correctly-stored value leading with `<h1>` — legal today, and mid-value it already survives —
is classified plain, escaped, and then survives the strip as **visible literal `<h1>Title</h1>`
text in search results and in every DOCX / PPTX / XLSX / PDF export**. That is a second,
independent user-visible defect of the same regex, and it is recorded in neither §107 nor §114.

The rule is "never recognise more than your sink KEEPS". A strip-all sink keeps **nothing**, so
the rule does not bind: over-recognising costs nothing there and under-recognising is the entire
defect. Projection therefore takes the widest list.

★ It gets its own sink NAME (`"projection"`) even though it equals `"document"` today, so a
reader sees *why* it is widest rather than reading it as a documents call.

### 3. The rich entity fields classify at their storage sink (11), and the editor gap is deferred

All **seven** edit through the **lean** `RichTextEditor` variant — `heading: false`, no
underline, Bold/Italic/lists/link only. Verified at every site: `raid-edit-modal.tsx` ×2,
`change-edit-modal.tsx` ×3, `milestone-edit-modal.tsx` ×1, `task-form-fields.tsx:588`. So a
third list exists and it is narrower than storage:

| Layer | Tags |
|---|---|
| classifier (`HTML_START`) today | 8 |
| storage allow-list (`sanitizeTemplateHtml`) | **11** — adds `u` `h1` `h2` |
| **editor schema (lean variant)** | ~8, and it cannot represent `u` / `h1` / `h2` |

★★ **`u` / `h1` / `h2` are write-only tags today.** No `dangerouslySetInnerHTML` sink renders
these fields: the only two `sanitizeTemplateHtml` render sinks are the comm-send preview and the
meeting report, neither of which is a description field. The fields' only surfaces are the lean
editor (drops them on parse) and the text projections (strip them). So classifying at 11 does
**not** make headings visible — its win is that projection, search and every export stop emitting
literal markup as text.

Residual, accepted: an AI-written heading is silently flattened when a human opens that modal and
saves. ★ That is **strictly better than today at every step** — today the same value is stored
escaped, shows as literal `&lt;h1&gt;` in the editor, and saving persists the literal markup
permanently. (3) degrades formatting the app cannot show anyway; today's behaviour destroys the
value.

**Two alternatives were considered and rejected.**

**Narrowing `sanitizeTemplateHtml` to 8** does not fix §107 at all. `sanitizeAiRichText` runs
layer 1 (`sanitizeRichText` → the classifier) **before** the allow-list, so a value leading `<h1>`
is escaped and never reaches DOMPurify; narrowing what DOMPurify permits changes nothing about the
escape. It also would not stay contained — `DOCUMENT_ALLOWED_TAGS` is built by spreading
`ALLOWED_TAGS`, so narrowing template silently strips `u` / `h1` / `h2` from documents too.

**Widening the editor** is bigger than "switch the six sites to `variant="full"`". The full variant
is plain `StarterKit`, which keeps markdown input rules for blockquote, code block, inline code,
strike and `---` — none of them in the 11-tag template list. Typing `> ` would render a blockquote
the sink silently flattens on save: precisely the shipped bug the lean variant was created to fix
(documented at `rich-text-editor.tsx:54`). Done properly it is a **fourth variant** configured to
exactly 11 tags with its own toolbar, and touching that toolbar pulls in the hand-rolled
`aria-pressed` `ToolbarButton` that S3b already lists as a §55/§56 defect site. ★★ And under the
*unify rich text* program (below) that fourth variant would be built only to be deleted.

### 4. §118 rides along, at the renderers, never at the load boundary

§118's fix is the composition that was implemented, measured and **reverted on 2026-08-08** —
`descriptionHtml` in front of `htmlToRichLines` — reverted because the 8-tag gate escaped a
paragraph already stored as valid `<blockquote>`, and the observed paragraph styles went from
`['Title','Quote','CodeBlock','CodeBlock']` to `['Title']`. Formatting did not degrade; it
vanished. With a document-sink classifier that composition becomes safe.

★★ **Not at the load boundary.** Composing the upgrade into `sanitizeDocumentRichFields` would fix
all three renderers from one place and would be a mutation on load that the next save persists:
it rewrites stored bytes on all six write paths for documents nobody edited, makes
`documentVersions` before-images record a diff no user made, and moves byte-stable goldens for an
input that did not legitimately change.

---

## Architecture

### A new DOM-free module: `html-start.ts`

`sanitize-html.ts` exports its three tag arrays. `html-start.ts` imports them and builds one
regex per sink through a factory:

```ts
export function htmlStartRe(tags: readonly string[]): RegExp
```

- filters non-tag entries by `/^[a-z][a-z0-9]*$/` — this is what drops `#text` from the note
  list. Explicit and tested, never incidental.
- preserves both existing rules verbatim: **no leading closing tag** (no `\/?` — a stored value
  cannot legitimately begin with one, and passing it through makes the sink delete the literal
  characters), and `\b[^>]*>` so void spellings `<hr/>` and `<img …>` match.

`narrative-html.ts`'s `HTML_START` becomes `htmlStartRe(NOTE_ALLOWED_TAGS)`. ★ Its comment "the
set is EXACTLY `NOTE_ALLOWED_TAGS`" stops being a promise a human keeps and becomes true by
construction. **That is the structural win** — that alignment can never drift again.

Import direction, no cycle: `sanitize-html` ← `html-start` ← { `narrative-html`, `rich-text-plain` }.

★★ DOM-free holds. `rich-text-plain.ts` already imports `sanitize-html` for `plainToHtml`; only a
DOMPurify **call** needs a DOM, and the existing comment-stripped source scan continues to enforce
that. `html-start.ts` calls nothing.

### The sink map

Call sites name a **sink**, not a regex — a `RichTextSink` union, so an arbitrary regex cannot be
passed and every site is greppable by name:

| Sink | Tags | Sink function | Why |
|---|---|---|---|
| `"note"` | 8 | `sanitizeNoteHtml` | `KEEP_CONTENT: false` — over-recognising **deletes text** |
| `"template"` | 11 | `sanitizeTemplateHtml` | the six register fields, their entity sanitizers, and every AI rich write. ★ `Task.description` differs — see the finding below |
| `"document"` | 20 | `sanitizeDocumentHtml` | closes §114; also the §118 renderer sites |
| `"projection"` | 20 (widest) | none — `htmlToText` strips all | decision 2 |

★ A test asserts `"projection"` stays a superset of the other three. If the document list ever
narrows, that test is what catches it.

---

## Threading

Two signatures gain a **required** sink argument. No defaults — a default is the exact trap this
slice removes, and `tsc --noEmit` then enumerates every site for us.

### `descriptionHtml(stored, sink)` — 19 call sites

| Sink | Sites |
|---|---|
| `"note"` | `note-log.ts:157` (`sanitizeNoteHtml(descriptionHtml(value))`) |
| `"template"` | `change-edit-modal.tsx` ×7 · `raid-edit-modal.tsx` ×5 · `milestone-edit-modal.tsx` ×2 · `use-resource-planner.ts:427` (15) |
| `"projection"` | `rich-text-projection.ts:39` and `:61` |
| *threaded* | `rich-text-plain.ts:253`, inside `sanitizeRichText` — passes its caller's sink through |

### `sanitizeRichText(raw, max, sink)` — 11 call sites

| Sink | Sites |
|---|---|
| `"template"` | `sanitize-records.ts` ×6 · `templates.ts:146` · `ai-rich-text.ts:59` and `:65` (9) |
| `"document"` | `ai-rich-text.ts:137` and `:140` (2) |

★ Both `sanitizeRichText` calls inside each `ai-rich-text` function (the layer-1 upgrade and the
trailing re-run) take the same sink.

### Unchanged: the 49 projection callers

`descriptionText` / `descriptionTextWithBreaks` resolve their own sink internally, so none of
their callers change. **That is what keeps this slice's diff bounded** — the alternative
(threading a sink through the projection API) would touch ~49 sites for no decision anyone makes
per-call.

### §118 — three renderer sites

Compose the upgrade at `"document"` in front of each renderer's paragraph path:

- `doc-render-docx.ts:237` (`htmlToRichLines(html)`)
- `doc-render-pptx.ts:208` (`htmlToRichLines(block.html)`)
- `doc-render-html.ts:105` (`sanitizeDocumentHtml(block.html)`) — ★ **not enumerated by §118**,
  which names only the two OOXML sites. It feeds the sanitizer directly and has always collapsed;
  §118 records that as "HTML/PDF has ALWAYS collapsed it — that renderer never upgraded".

---

## Testing

The classifier factory:

- `#text` is filtered out of the note list
- a leading **closing** tag is rejected
- `<s>` is not swallowed by the `strong` alternative, and `<sub>` / `<sup>` likewise
- void spellings `<hr/>` and `<img src=…>` match
- case-insensitive; leading whitespace tolerated

Regression:

- §107's three measured strings, byte-for-byte
- §114's nine document-only tags, **one leading tag at a time** — the entry measured them
  individually and got a wrong count the first time by not doing so
- the superset invariant of decision 2

§118:

- the two OOXML expectations that went red on 2026-08-08 go **green**
  (`['Title','Quote','CodeBlock','CodeBlock']`). ★★ These are the slice's **falsification test**:
  a ready-made check, written before this design existed, of whether the split actually works.

Byte-stability:

- `htmlPlainProjection`'s hardcoded default-path suite stays byte-identical
- ★★★ **`__fixtures__/golden-*` must NOT move.** Decision 1 changes no stored value, so a moved
  golden means the sample workspace holds a value whose classification just changed. That is a
  **finding to investigate, never a regeneration.**

Gates: `npx tsc --noEmit` (the real coverage here — it enumerates the 30 threaded sites),
`npm run test:run`, `npm run test:shuffle`, `npx eslint --max-warnings=0 src/app`,
`npm run size:check`, `npm run dup:check`, `npm run docs:symbols:check`,
`npm run docs:claims:check`. No axe-scanned surface changes, so no e2e obligation beyond the
suite already running.

---

## Must verify during planning — `Task.description` does not match the other six

Found while self-reviewing this spec, not before it. `Task.description` is grouped with the six
throughout AGENTS.md, but its plumbing differs at three points and the sink map above must be
re-checked against it before any code is written:

- **Its human save sink is `sanitizeNoteHtml`, not `sanitizeTemplateHtml`** —
  `use-task-submit.ts:162` is `sanitizeNoteHtml(form.description ?? "")`. That is the 8-tag list
  **with `KEEP_CONTENT: false`**, which deletes a non-listed element together with its text. Its
  AI write path is `sanitizeAiRichText` → `sanitizeTemplateHtml` (11, keeps the words). **One
  field, two write sinks, different lists, and the stricter one deletes.**
- **No `descriptionHtml` call site.** `task-form-fields.tsx:588` passes `form.description`
  straight to the editor, where the other six wrap in `descriptionHtml`. So the task form has no
  classifier site to thread — but it also means a legacy plain-text task description is not
  upgraded on the way into the editor.
- **No `sanitizeRichText` on load.** `sanitize-records.ts` covers milestone, change and RAID
  only; the task sanitizer lives elsewhere and does not call it.

★ This does not change any decision above — there is no classifier site in the task form to
assign a sink to. It does mean the residual in decision 3 is **sharper for tasks than for the
six**: after this slice the AI can store a real `<h1>` in a task description, and the human save
path runs it through a `KEEP_CONTENT: false` sanitizer. In practice the lean editor should
normalise the value to its own schema first, so nothing outside the eight reaches that call —
but *should* is not a measurement. **Measure it in the plan** (feed a stored `<h1>` through the
lean editor and read what `onChange` emits) and fold the result into the new register entry.

---

## Docs, in the same commit

- open-followups **§107 · §114 · §118 → CLOSED**
- **new entry:** the six rich fields' editor cannot represent three tags their storage permits.
  ★ Not an orphan — it is step 0 of the *unify rich text* program below.
- `sanitize-html.ts:137` — the comment "`narrative-html.ts`'s `HTML_START` mirrors this list" is
  accurate but sits above `NOTE_ALLOWED_TAGS` while the drift is against the TEMPLATE list. After
  this slice the mirror is mechanical, so the comment changes meaning.
- `ai-rich-text.ts` lines 53 / 56 / 116 / 117 / 125 — the `HTML_START` caveat blocks, and the
  "deliberately NOT fixed here" note
- `chat-tool-defs-documents.ts:43-47` — the instruction-as-mitigation block, now superseded
- `use-document-tools.ts:257` — its `HTML_START` comment
- AGENTS.md's rich-text bullet

**Release:** user-visible, so bump to **0.228.0** + a new milestone codename, `CHANGELOG.md`
entry, and the five ungated version sites (`package.json`, `package-lock.json` ×2, the README
shields badge with codename, the five `docs/CODEMAPS/*.md` headers).

---

## Out of scope

- Repairing already-escaped stored values (decision 1)
- Widening or narrowing any allow-list (decision 3)
- Any editor change (decision 3)
- §32 — the same classifier failing the **opposite** way, where plain prose is taken for markup
  and the words are deleted. Different mechanism (the `TAG` pass at `rich-text-plain.ts:58`,
  not `KEEP_CONTENT`), different remediation. ★ Do not merge them into one "`HTML_START` is
  unreliable" note.
- S4 and S3b

★ **This slice does not close the whole class.** A model can lead with `<h3>`, `<div>` or
`<table>` — outside every allow-list — and those still escape. Deriving from the sink closes the
cases a sink *advertises*, which is the boundary that can be argued for; recognising arbitrary
tag-shaped text is §32's failure direction and worse.

---

## Sequel: the *unify rich text* program

Stated goal: **one rich-text editor everywhere, carrying the Tiptap Simple Editor template's
feature set.**

This is not currently planned. The roadmap touches that template exactly once — decision 1,
"harvest the Simple Editor template; do not install it" — scoped to documents and adding a
**third** variant. Unification and S3b's third variant are in tension, so the program spec must
reopen decision 1.

**This slice is its prerequisite.** Every unification step widens an allow-list. With
`HTML_START` hardcoded at 8, each widening silently re-creates §107 for the newly-added tags, in
the escape direction, permanently, with no gate that can see it. Derive-per-sink makes the
classifier follow its list: widening a sink becomes one edit instead of two, where forgetting the
second ships literal markup into storage.

Blockers the program spec must resolve — four of them are **storage-level, not editor-level**:

1. **Alignment cannot be markup in this app, at all.** DOMPurify's `ALLOWED_URI_REGEXP` is applied
   to *every* attribute value, not only URI-bearing ones — already why `target`/`rel` are stripped
   from every stored link (§38). `style="text-align:center"` and `class="text-center"` fail
   identically. Documents can have alignment only because `DocBlock` is a typed object with room
   for a field; the six rich entity fields are plain `string` columns with nowhere to put one.
2. **The dashboard narrative is single-line at rest.** The markdown backend writes it as one
   `- narrative: <value>` line and decodes with a single-line regex — which is why
   `normalizeNarrativeHtml` collapses newlines. Block structure there is a codec change.
3. **The note log's sink deletes text** (`KEEP_CONTENT: false`). Unifying its editor means
   widening `NOTE_ALLOWED_TAGS`, which the code flags as security-relevant *and* as changing how
   already-stored note HTML renders.
4. **New dependencies.** StarterKit 3.27.1 already bundles bold · italic · underline · strike ·
   code · codeBlock · blockquote · heading · horizontalRule · lists · link · hardBreak; only
   highlight, subscript and superscript need new packages, against a blocking dependency-audit.
   Images are Turso-gated and S3c-sized.
5. **§129, open and measured:** six of eight `RichTextEditor` call sites import it statically, so
   Tiptap already SSRs and ships in the initial bundle. One richer editor everywhere makes that
   worse before it makes it better.
6. **CSP.** 0.227.0 fixed Tiptap's stylesheet under the prod nonce-only policy (§54). More Tiptap
   UI is more of that surface, and `e2e:smoke:prod` is the only gate that sees it.

Surfaces to unify — measured by grepping `RichTextEditor` across non-test `.tsx`, then reading
each site's `variant`:

| Surface | Variant | Sink |
|---|---|---|
| dashboard narrative | `lean` | `sanitizeNoteHtml` |
| note log — composer and entry editor | `lean` ×2 | `sanitizeNoteHtml` |
| the seven rich entity fields | `lean` ×7 | mixed — see the finding below |
| comm templates | **`full`** (default, no `variant` prop) | `sanitizeTemplateHtml` |
| meeting report | **`full`** (default, no `variant` prop) | `sanitizeTemplateHtml` |
| document paragraph blocks | none yet — S3b's third variant | `sanitizeDocumentHtml` |

★ **Two** `full` consumers, not one, and neither passes the prop — they get it from
`props.variant ?? "full"`. A reader looking for `variant="full"` finds nothing and concludes the
variant is dead.
